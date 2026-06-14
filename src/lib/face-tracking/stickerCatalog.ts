import type { Sticker } from "./types";

// Curated for Nana + grandchild fun. Head stickers ride above the forehead
// and tilt with head roll. Mask stickers sit on the nose and cover the
// whole face. Floaters are the legacy CSS-positioned decorations — kept
// because some entries (stars, hearts, rainbow) are joyful ambient art
// that doesn't need a face anchor.
export const STICKERS: Sticker[] = [
  // ── Head stickers (anchored above forehead, tilt with head) ──
  { id: "crown",    emoji: "👑", label: "Crown",    kind: "head", yOffset: -0.55, scale: 1.0  },
  { id: "tiara",    emoji: "👸", label: "Princess", kind: "head", yOffset: -0.45, scale: 0.9  },
  { id: "tophat",   emoji: "🎩", label: "Top Hat",  kind: "head", yOffset: -0.6,  scale: 0.95 },
  { id: "wizard",   emoji: "🧙", label: "Wizard",   kind: "head", yOffset: -0.6,  scale: 1.1  },
  { id: "cowboy",   emoji: "🤠", label: "Cowboy",   kind: "head", yOffset: -0.5,  scale: 1.0  },
  { id: "partyhat", emoji: "🎉", label: "Party!",   kind: "head", yOffset: -0.55, scale: 0.95 },
  { id: "bunny",    emoji: "🐰", label: "Bunny",    kind: "head", yOffset: -0.5,  scale: 1.15 },
  { id: "cat",      emoji: "🐱", label: "Kitty",    kind: "head", yOffset: -0.45, scale: 1.1  },
  { id: "unicorn",  emoji: "🦄", label: "Unicorn",  kind: "head", yOffset: -0.55, scale: 1.15 },
  { id: "halo",     emoji: "😇", label: "Angel",    kind: "head", yOffset: -0.55, scale: 0.95 },

  // ── Face-mask stickers (centered on nose, cover the whole face) ──
  { id: "clown_face",   emoji: "🤡", label: "Clown",  kind: "mask", scale: 1.5  },
  { id: "alien_face",   emoji: "👽", label: "Alien",  kind: "mask", scale: 1.5  },
  { id: "robot_face",   emoji: "🤖", label: "Robot",  kind: "mask", scale: 1.5  },
  { id: "puppy_face",   emoji: "🐶", label: "Puppy",  kind: "mask", scale: 1.55 },
  { id: "panda_face",   emoji: "🐼", label: "Panda",  kind: "mask", scale: 1.55 },
  { id: "pig_face",     emoji: "🐷", label: "Piggy",  kind: "mask", scale: 1.55 },
  { id: "lion_face",    emoji: "🦁", label: "Lion",   kind: "mask", scale: 1.55 },
  { id: "monkey_face",  emoji: "🐵", label: "Monkey", kind: "mask", scale: 1.5  },
  { id: "cool_shades",  emoji: "😎", label: "Cool",   kind: "mask", scale: 1.5  },
  { id: "nerd_glasses", emoji: "🤓", label: "Nerd",   kind: "mask", scale: 1.5  },

  // ── Floaters (legacy CSS-positioned ambient decorations) ──
  { id: "stars",    emoji: "⭐", label: "Stars",    kind: "floater" },
  { id: "flowers",  emoji: "🌸", label: "Flowers",  kind: "floater" },
  { id: "rainbow",  emoji: "🌈", label: "Rainbow",  kind: "floater" },
  { id: "hearts",   emoji: "💖", label: "Hearts",   kind: "floater" },
  { id: "sparkles", emoji: "✨", label: "Sparkles", kind: "floater" },
];

export function findSticker(id: string): Sticker | undefined {
  return STICKERS.find(s => s.id === id);
}

// Legacy ids from the pre-tracking sticker list. Bare emoji ids like "clown"
// referred to a CSS-positioned floater of the clown emoji; the new world has
// a face-anchored "clown_face" mask instead. Keep "wizard" / "unicorn" /
// "tophat" / "bunny" pointing at their head-mounted equivalents (same id).
// Falls through unchanged for anything we don't recognise.
const LEGACY_MAP: Record<string, string> = {
  tophat: "tophat",
  clown: "clown_face",
  lion: "lion_face",
  wizard: "wizard",
  unicorn: "unicorn",
  robot: "robot_face",
  alien: "alien_face",
  none: "none",
};

export function mapLegacyFilterId(id: string): string {
  return LEGACY_MAP[id] ?? id;
}
