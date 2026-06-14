/**
 * Tiny audio helpers for tactile feedback. We synthesize sounds via Web
 * Audio API rather than ship audio assets — keeps the bundle small, lets
 * us tweak tone live, and respects user preference for reduced motion.
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

function reducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Soft "whoosh" for page turns. ~200ms, low-pass-filtered noise burst.
 * Honors prefers-reduced-motion.
 */
export function playPageTurn(): void {
  if (reducedMotion()) return;
  const c = getContext();
  if (!c) return;
  try {
    // Resume on user gesture if needed
    if (c.state === "suspended") c.resume();
    const now = c.currentTime;
    const duration = 0.22;

    // Noise source (paper texture).
    const buffer = c.createBuffer(1, c.sampleRate * duration, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.45;
    }
    const noise = c.createBufferSource();
    noise.buffer = buffer;

    // Low-pass filter — give it a soft, papery tone (no harsh hiss).
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2200, now);
    filter.frequency.exponentialRampToValueAtTime(800, now + duration);
    filter.Q.value = 0.7;

    // Volume envelope — quick swell, gentle decay.
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);

    noise.start(now);
    noise.stop(now + duration);
  } catch {
    // Silent — audio isn't critical.
  }
}

/**
 * Soft tap chime — for tap-to-pronounce confirmation. ~100ms,
 * sine-based blip at 880Hz.
 */
export function playTap(): void {
  if (reducedMotion()) return;
  const c = getContext();
  if (!c) return;
  try {
    if (c.state === "suspended") c.resume();
    const now = c.currentTime;

    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.08);

    const gain = c.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch {
    // Silent.
  }
}

/**
 * Tactile feedback. On Android Chrome / Firefox uses `navigator.vibrate`.
 * iOS Safari has no Web haptic API at all (the user just feels nothing),
 * so we ALSO trigger a short visible pulse on the device frame as a
 * fallback — Rick: "I did not notice the haptic." A subtle 200ms inset
 * shadow on the body confirms a tap landed.
 */
export function haptic(intensity: "light" | "medium" = "light"): void {
  if (reducedMotion()) return;
  // Android / generic vibration motor.
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      (navigator as Navigator).vibrate?.(intensity === "light" ? 6 : 12);
    } catch {
      // Silent.
    }
  }
  // Visible flash (works on every platform — primary feedback on iOS).
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.remove("nm-tap-pulse");
    // Force reflow so the animation restarts even on rapid sequential taps.
    void root.offsetHeight;
    root.classList.add("nm-tap-pulse");
    window.setTimeout(() => root.classList.remove("nm-tap-pulse"), 220);
  }
}
