import { api } from "./api";
import { getContext } from "./sound";

/**
 * One pronunciation path for every trigger on both iPads (Nana's
 * Pronunciation button, the partner iPad receiving the broadcast, the
 * Words We're Learning list). US English Google voice decoded into Web
 * Audio so we can lift its level: while the video call holds the mic,
 * iOS plays page media noticeably quieter. Falls back to the device's own
 * US voice when the clip can't be fetched or decoded in time.
 */

const FALLBACK_AFTER_MS = 2500;
const clipCache = new Map<string, AudioBuffer>();
const inflight = new Map<string, Promise<AudioBuffer | null>>();

function cleanWord(word: string): string {
  return word.replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'-]/gu, "").replace(/^['-]+|['-]+$/g, "");
}

/** Resume the shared AudioContext. Call from any user gesture so later
 *  remote-triggered pronunciations can play without one. */
export function primeAudio(): void {
  const c = getContext();
  if (c && c.state !== "running") c.resume().catch(() => {});
}

function loadClip(word: string): Promise<AudioBuffer | null> {
  const key = word.toLowerCase();
  const cached = clipCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    const c = getContext();
    if (!c) return null;
    const res = await fetch(api.tts.audioUrl(key));
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength < 100) return null;
    const buf = await new Promise<AudioBuffer>((resolve, reject) => c.decodeAudioData(bytes, resolve, reject));
    clipCache.set(key, buf);
    return buf;
  })()
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function peakOf(buf: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

async function ensureRunning(): Promise<boolean> {
  const c = getContext();
  if (!c) return false;
  if (c.state === "running") return true;
  try {
    await Promise.race([c.resume(), new Promise(r => window.setTimeout(r, 300))]);
  } catch {}
  return (c.state as AudioContextState) === "running";
}

function playBuffer(buf: AudioBuffer): boolean {
  const c = getContext();
  if (!c || c.state !== "running") return false;
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    // Normalize to full scale, then push into a limiter so the clip
    // reads loud without clipping.
    const peak = peakOf(buf);
    const gain = c.createGain();
    gain.gain.value = (peak > 0.01 ? 1 / peak : 1) * 2.2;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 4;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    src.connect(gain);
    gain.connect(limiter);
    limiter.connect(c.destination);
    src.start();
    return true;
  } catch {
    return false;
  }
}

function pickUsVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  const voices = synth.getVoices();
  const us = voices.filter(v => v.lang.replace("_", "-").toLowerCase() === "en-us");
  return (
    us.find(v => /samantha/i.test(v.name)) ??
    us.find(v => v.localService) ??
    us[0] ??
    voices.find(v => v.lang.toLowerCase().startsWith("en"))
  );
}

/** Speak with the device voice, always preferring a US English voice. */
export function speakWithDevice(text: string, rate = 0.85): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const synth = window.speechSynthesis;
    if (synth.paused) synth.resume();
    synth.cancel();
    const say = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.pitch = 1.0;
      u.lang = "en-US";
      const v = pickUsVoice(synth);
      if (v) u.voice = v;
      synth.speak(u);
    };
    if (synth.getVoices().length === 0) {
      let spoken = false;
      const onVoices = () => {
        synth.removeEventListener("voiceschanged", onVoices);
        if (!spoken) { spoken = true; say(); }
      };
      synth.addEventListener("voiceschanged", onVoices);
      window.setTimeout(() => {
        synth.removeEventListener("voiceschanged", onVoices);
        if (!spoken) { spoken = true; say(); }
      }, 200);
    } else {
      say();
    }
  } catch {}
}

/** Pronounce a single word. Resolves once playback has started (or the
 *  fallback voice has been asked to speak). Never throws. */
export async function pronounce(word: string): Promise<"clip" | "device" | "none"> {
  const w = cleanWord(word);
  if (!w) return "none";
  primeAudio();
  let settled = false;
  const fallback = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    speakWithDevice(w);
  }, FALLBACK_AFTER_MS);
  const buf = await loadClip(w);
  const running = buf ? await ensureRunning() : false;
  if (settled) return "device";
  settled = true;
  window.clearTimeout(fallback);
  if (buf && running && playBuffer(buf)) return "clip";
  speakWithDevice(w);
  return "device";
}

/** Warm the cache for a word the user is likely to hear next. */
export function preloadPronunciation(word: string): void {
  const w = cleanWord(word);
  if (w) void loadClip(w);
}
