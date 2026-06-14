import { useCallback, useState, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BookHeart,
  BookOpen,
  CalendarDays,
  CalendarHeart,
  Camera as CameraIcon,
  ChevronLeft,
  Clapperboard,
  Disc,
  Film,
  Hand,
  Home as HomeIcon,
  Library as LibraryIcon,
  Mail,
  PhoneOff,
  Play,
  Plus as PlusIcon,
  Save,
  Search,
  Smartphone,
  Smile,
  Sparkles as SparklesIcon,
  Star as StarIcon,
  Users,
  Video as VideoIcon,
  Volume2,
  X as XIcon,
} from "lucide-react";
import { Button, IconButton, InstallHint, TileButton, TileGrid } from "./lib/ui";
import { api, ApiError, type SafeUser, type ReadingSession, type Child } from "./lib/api";
import { haptic, playPageTurn, playTap } from "./lib/sound";
import {
  Avatar,
  DraggablePiP,
  FaceVideo,
  FaceVideoStage,
  ReactionOverlay,
  VideoControls,
  VideoSessionProvider,
  getRoleLabel,
  REACTION_KEYS,
  getReactionGlyph,
  getReactionLabel,
  type ReactionEmoji,
  type ReactionEvent,
} from "./lib/video";
import {
  ProgressPill,
  StickyChapter,
  ThemeSwitcher,
} from "./lib/reading/ReadingChrome";
import { READING_THEMES, type ReadingTheme } from "./lib/reading/themes";
import { STICKERS } from "./lib/face-tracking/stickerCatalog";
import { FaceTrackedOverlay } from "./lib/face-tracking/FaceTrackedOverlay";
import * as FaceTracker from "./lib/face-tracking/FaceTracker";

const NAVY      = "#1B2B4B";
const AMBER     = "#C9922A";
const CREAM     = "#F7F0E3";
const PARCHMENT = "#F2E4C4";
const LEATHER   = "#5C3A1E";
const BOOK_TEXT = "#2D1A08";

// Goodbye countdown phase durations (ms). Phases 0-4 = countdown digits 5→1.
// Phases 5 = Blow kisses, 6 = I love you, 7 = final Goodbye screen.
const GOODBYE_PHASE_DURATIONS = [1000, 1000, 1000, 1000, 1000, 3000, 2500];

type Mode = "home" | "greeting" | "icebreaker" | "library" | "reading" | "chat" | "showandtell" | "parentcheck" | "sillyfaces" | "goodbye" | "vault" | "familystories" | "onboarding" | "bookrequests" | "settings";

// Reading-mode layout variations. Nana picks; the chosen layout is
// broadcast to Perry so both iPads render the same arrangement.
const READING_LAYOUTS = ["classic", "immersive", "storytime", "cozy", "kids"] as const;
type ReadingLayout = typeof READING_LAYOUTS[number];
const READING_LAYOUT_META: Record<ReadingLayout, { label: string; sub: string; icon: string }> = {
  classic:   { label: "Classic",   sub: "Familiar reader · book + sidebar",      icon: "📖" },
  immersive: { label: "Immersive", sub: "Distraction-free · book full screen",   icon: "🎯" },
  storytime: { label: "Storytime", sub: "Big video on top · book below",         icon: "🎭" },
  cozy:      { label: "Cozy",      sub: "Vintage library · sepia + leather",     icon: "🪵" },
  kids:      { label: "Kids",      sub: "Playful · pastel + chunky reactions",   icon: "🎨" },
};
type ChallengeState = "idle" | "counting" | "flash" | "holding" | "result";
const INVITE_CODE = "NEVMIS";
type FamilyStoriesSubMode = "write" | "browse";

interface FamilyStoryEntry {
  id: number;
  date: string;
  book: string;
  bookEmoji: string;
  bookColor: string;
  note: string;
  seen: boolean;
  isNew?: boolean;
}

const INITIAL_STORIES: FamilyStoryEntry[] = [];
type ScheduleProposal = { date: Date; time: string; proposedBy: "nana" | "perry" };

/** Light-weight {placeholder} substitution for prompt strings. Unmatched
 *  placeholders are stripped so you never get raw {childName} on screen. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? "").trim());
}

function combineDateAndTime(date: Date, time: string): Date {
  const m = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return date;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  const out = new Date(date);
  out.setHours(h, min, 0, 0);
  return out;
}

function formatForGoogle(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const end = new Date(date.getTime() + 45 * 60000);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=NeverMiss+Reading+Session&dates=${fmt(date)}/${fmt(end)}&details=Time+to+read+together+on+NeverMiss!`;
}

function formatForOutlook(date: Date): string {
  const end = new Date(date.getTime() + 45 * 60000);
  return `https://outlook.live.com/calendar/0/deeplink/compose?subject=NeverMiss+Reading+Session&startdt=${date.toISOString()}&enddt=${end.toISOString()}&body=Time+to+read+together+on+NeverMiss!`;
}

function downloadICS(date: Date): void {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const end = new Date(date.getTime() + 45 * 60000);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
    "SUMMARY:NeverMiss Reading Session",
    `DTSTART:${fmt(date)}`, `DTEND:${fmt(end)}`,
    "DESCRIPTION:Time to read together on NeverMiss!",
    "END:VEVENT", "END:VCALENDAR"
  ].join("\n");
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "nevermiss-reading.ics"; a.click();
  URL.revokeObjectURL(url);
}

const showAndTellPrompts = [
  "Tell me more about that — how did you make it?",
  "What's your favorite part of it?",
  "How long did it take you to build or learn that?",
  "Did anyone help you, or did you do it all by yourself?",
  "Can you show me your favorite part up close?",
  "What made you decide to show me this one?",
  "Can you do that one more time? I want to watch again!",
  "Where did you get the idea for that?",
  "I am so proud of you! This is amazing.",
  "Would you teach me how to do that someday?",
];

const icebreakerPrompts = [
  "How was your day today, {childName}?",
  "What was the best thing that happened to you today?",
  "What made you smile or laugh today?",
  "Tell me about your best friend — what makes them so great?",
  "What's something that's been on your mind lately?",
  "Tell me about a teacher you really like — what makes them cool?",
  "What was the worst part of your day? I want to hear it all!",
  "What's something funny that happened this week?",
  "If you could do anything tomorrow, what would you pick?",
  "Is there anything coming up you're excited or nervous about?",
];

const childIcebreakerPrompts = [
  "Nana, what was it like to be my age when you were a little girl?",
  "What was the most important thing happening in the world when you were young?",
  "How did you meet Papa?",
  "How old were you when you got married?",
  "What was your favorite thing to do for fun when you were a kid?",
  "Did you have a best friend growing up? What were they like?",
  "What was school like when you were my age?",
  "What was the first job you ever had?",
  "What's the best trip or adventure you've ever been on?",
  "What's something you wish you had known when you were my age?",
];

// "Normal" is the no-sticker state — leads the picker so tapping it
// clears whatever's currently on your partner's face. STICKERS itself
// deliberately omits this entry (it's not a sticker, it's the absence
// of one) so FaceTrackedOverlay's lookup naturally short-circuits.
const sillyFilters = [
  { id: "none", label: "Normal", emoji: "😊" },
  ...STICKERS.map(s => ({ id: s.id, label: s.label, emoji: s.emoji })),
];

export function FilterOverlay({ filter }: { filter: string }) {
  if (!filter || filter === "none") return null;
  const overlays: Record<string, React.ReactNode> = {
    bunny: (
      <>
        <span style={{ position: "absolute", top: "3%", left: "20%", fontSize: "72px", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.6))", pointerEvents: "none", display: "inline-block", animation: "wiggle-l 0.65s ease-in-out infinite", transformOrigin: "bottom center" }}>🐰</span>
        <span style={{ position: "absolute", top: "3%", right: "16%", fontSize: "72px", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.6))", pointerEvents: "none", display: "inline-block", animation: "wiggle-r 0.65s ease-in-out infinite 0.18s", transformOrigin: "bottom center" }}>🐰</span>
        <span style={{ position: "absolute", top: "38%", left: "50%", transform: "translateX(-50%)", fontSize: "34px", pointerEvents: "none", display: "inline-block", animation: "pulse-sm 1.2s ease-in-out infinite" }}>🩷</span>
      </>
    ),
    crown: (
      <div style={{ position: "absolute", top: "1%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
        <span style={{ fontSize: "92px", display: "inline-block", animation: "crown-glow 1.6s ease-in-out infinite" }}>👑</span>
      </div>
    ),
    stars: (
      <>
        <span style={{ position: "absolute", top: "4%",  left: "7%",  fontSize: "46px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.7s ease-in-out infinite" }}>⭐</span>
        <span style={{ position: "absolute", top: "2%",  left: "50%",  transform: "translateX(-50%)", fontSize: "44px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.7s ease-in-out infinite 0.35s" }}>✨</span>
        <span style={{ position: "absolute", top: "4%",  right: "7%", fontSize: "46px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.7s ease-in-out infinite 0.18s" }}>💫</span>
        <span style={{ position: "absolute", top: "24%", left: "4%",  fontSize: "36px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.7s ease-in-out infinite 0.55s" }}>✨</span>
        <span style={{ position: "absolute", top: "24%", right: "4%", fontSize: "36px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.7s ease-in-out infinite 0.72s" }}>⭐</span>
      </>
    ),
    flowers: (
      <>
        <span style={{ position: "absolute", top: "9%",  left: "9%",  fontSize: "50px", pointerEvents: "none", display: "inline-block", animation: "sway-l 2.1s ease-in-out infinite", transformOrigin: "bottom center" }}>🌸</span>
        <span style={{ position: "absolute", top: "5%",  left: "28%", fontSize: "52px", pointerEvents: "none", display: "inline-block", animation: "float-sm 2.1s ease-in-out infinite 0.25s" }}>🌷</span>
        <div style={{ position: "absolute", top: "3%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <span style={{ fontSize: "58px", display: "inline-block", animation: "float-sm 2.3s ease-in-out infinite" }}>🌻</span>
        </div>
        <span style={{ position: "absolute", top: "5%",  right: "23%", fontSize: "52px", pointerEvents: "none", display: "inline-block", animation: "float-sm 2.1s ease-in-out infinite 0.45s" }}>🌷</span>
        <span style={{ position: "absolute", top: "9%",  right: "5%", fontSize: "50px", pointerEvents: "none", display: "inline-block", animation: "sway-r 2.1s ease-in-out infinite 0.3s", transformOrigin: "bottom center" }}>🌸</span>
      </>
    ),
    alien: (
      <>
        <div style={{ position: "absolute", top: "1%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <span style={{ fontSize: "92px", display: "inline-block", animation: "bob 1.4s ease-in-out infinite" }}>👽</span>
        </div>
        <span style={{ position: "absolute", top: "2%", left: "13%",  fontSize: "42px", pointerEvents: "none", display: "inline-block", animation: "float-sm 1.9s ease-in-out infinite 0.4s" }}>🛸</span>
        <span style={{ position: "absolute", top: "2%", right: "11%", fontSize: "38px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.3s ease-in-out infinite 0.2s" }}>⭐</span>
      </>
    ),
    nerd: (
      <div style={{ position: "absolute", top: "28%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
        <span style={{ fontSize: "80px", display: "inline-block", animation: "float-sm 2s ease-in-out infinite" }}>🤓</span>
      </div>
    ),
    rainbow: (
      <>
        <div style={{ position: "absolute", top: "1%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <span style={{ fontSize: "92px", display: "inline-block", animation: "shimmer 2.5s ease-in-out infinite" }}>🌈</span>
        </div>
        <span style={{ position: "absolute", top: "18%", left: "4%",  fontSize: "38px", pointerEvents: "none", display: "inline-block", animation: "float-sm 3s ease-in-out infinite" }}>☁️</span>
        <span style={{ position: "absolute", top: "18%", right: "4%", fontSize: "38px", pointerEvents: "none", display: "inline-block", animation: "float-sm 3s ease-in-out infinite 0.5s" }}>☁️</span>
      </>
    ),
    tophat: (
      <>
        <div style={{ position: "absolute", top: "1%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <span style={{ fontSize: "92px", display: "inline-block", animation: "bob 1.8s ease-in-out infinite" }}>🎩</span>
        </div>
        <span style={{ position: "absolute", top: "38%", right: "12%", fontSize: "44px", pointerEvents: "none", display: "inline-block", animation: "float-sm 2.2s ease-in-out infinite" }}>🧐</span>
      </>
    ),
    clown: (
      <>
        <div style={{ position: "absolute", top: "1%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <span style={{ fontSize: "84px", display: "inline-block", animation: "bob 1.2s ease-in-out infinite" }}>🤡</span>
        </div>
        <span style={{ position: "absolute", top: "12%", left: "6%",  fontSize: "40px", pointerEvents: "none", display: "inline-block", animation: "sway-l 1.5s ease-in-out infinite" }}>🎈</span>
        <span style={{ position: "absolute", top: "12%", right: "6%", fontSize: "40px", pointerEvents: "none", display: "inline-block", animation: "sway-r 1.5s ease-in-out infinite 0.3s" }}>🎈</span>
      </>
    ),
    lion: (
      <>
        <div style={{ position: "absolute", top: "1%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <span style={{ fontSize: "92px", display: "inline-block", animation: "pulse-sm 1.8s ease-in-out infinite" }}>🦁</span>
        </div>
        <span style={{ position: "absolute", top: "15%", left: "4%",  fontSize: "38px", pointerEvents: "none", display: "inline-block", animation: "sway-l 2s ease-in-out infinite" }}>🌟</span>
        <span style={{ position: "absolute", top: "15%", right: "4%", fontSize: "38px", pointerEvents: "none", display: "inline-block", animation: "sway-r 2s ease-in-out infinite 0.4s" }}>🌟</span>
      </>
    ),
    wizard: (
      <>
        <div style={{ position: "absolute", top: "1%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <span style={{ fontSize: "100px", display: "inline-block", animation: "shimmer 2.5s ease-in-out infinite" }}>🧙</span>
        </div>
        <span style={{ position: "absolute", top: "8%",  left: "9%",  fontSize: "32px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.3s ease-in-out infinite" }}>⭐</span>
        <span style={{ position: "absolute", top: "5%",  right: "11%", fontSize: "28px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.3s ease-in-out infinite 0.4s" }}>✨</span>
        <span style={{ position: "absolute", top: "22%", left: "5%",  fontSize: "26px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.8s ease-in-out infinite 0.7s" }}>💫</span>
      </>
    ),
    unicorn: (
      <>
        <div style={{ position: "absolute", top: "1%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <span style={{ fontSize: "92px", display: "inline-block", animation: "bob 2s ease-in-out infinite" }}>🦄</span>
        </div>
        <div style={{ position: "absolute", top: "18%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <span style={{ fontSize: "56px", display: "inline-block", animation: "float-sm 2.5s ease-in-out infinite" }}>🌈</span>
        </div>
        <span style={{ position: "absolute", top: "10%", left: "7%",  fontSize: "30px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.6s ease-in-out infinite" }}>🌸</span>
        <span style={{ position: "absolute", top: "10%", right: "7%", fontSize: "30px", pointerEvents: "none", display: "inline-block", animation: "twinkle 1.6s ease-in-out infinite 0.5s" }}>🌸</span>
      </>
    ),
    robot: (
      <>
        <div style={{ position: "absolute", top: "1%", left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <span style={{ fontSize: "92px", display: "inline-block", animation: "pulse-sm 1.1s ease-in-out infinite" }}>🤖</span>
        </div>
        <span style={{ position: "absolute", top: "9%", left: "8%",  fontSize: "34px", pointerEvents: "none", display: "inline-block", animation: "twinkle 0.8s ease-in-out infinite" }}>⚡</span>
        <span style={{ position: "absolute", top: "9%", right: "8%", fontSize: "34px", pointerEvents: "none", display: "inline-block", animation: "twinkle 0.8s ease-in-out infinite 0.2s" }}>⚡</span>
      </>
    ),
  };

  const overlay = overlays[filter];
  if (!overlay) return null;
  return <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}>{overlay}</div>;
}

interface BookPage {
  leftEmoji: string;
  leftChapter: string;
  leftBody: string;
  rightTitle: string | null;
  rightTitleSub: string | null;
  rightBody: string;
  rightIsTitle: boolean;
  cue: string;
  nanaPrompt: string;
  /** When set, the book area renders this image full-bleed (object-fit: contain)
   *  instead of the text spread. For fixed-layout picture books imported from
   *  EPUB / PDF where each page is a complete illustration. The text fields
   *  can be left empty. */
  imageUrl?: string;
}

/** A chapter in a chapter book — multi-session reads where each chapter
 *  ends at a natural narrative boundary. Picture books and starter readers
 *  don't have chapters; only books that span 4–10 sessions need this. */
interface BookChapter {
  /** Stable slug, e.g. "ch1-darling-house". Used for analytics + bookmark keying. */
  id: string;
  /** Display title, e.g. "Chapter 1 · My Early Home". */
  title: string;
  /** One-sentence recap. Used by the Continue card (Library) so a returning
   *  family sees where they paused. NOT shown on the chapter-end card —
   *  Rick: "the recap feels like homework, the kids just lived through it." */
  summary: string;
  /** Optional chapter-specific reflection question for the chapter-end card.
   *  Open-ended, warm, specific to the chapter's emotional beat — invites
   *  Perry to retell, not to be tested. If omitted, the card falls back to
   *  a generic question from DEFAULT_CHAPTER_QUESTIONS. */
  question?: string;
  /** Optional one-line teaser for the NEXT chapter, shown on the chapter-end
   *  card below the question. No spoilers — just the emotional pull. Should
   *  be omitted on the final chapter of the book (nothing to tease). */
  teaser?: string;
  /** Pages belonging to this chapter. The book's flat `pages` array is the
   *  concatenation of every chapter's pages, in order. Use `chapterBook()`
   *  to build a Book from chapters without maintaining both lists by hand. */
  pages: BookPage[];
}

/** Generic fallback reflection questions for chapters that don't define
 *  their own. Picked by chapter index modulo length so a book without
 *  custom questions still varies its prompt instead of asking the same
 *  thing every chapter. Add new entries here, never replace existing
 *  ones in-place — the modulo index is stable. */
// Reflection bank — Rick: "the current explanation feels like a recap of
// what was just read… something like 'What was your favorite part of that
// chapter?' to encourage the child to reflect and retell." All questions
// here lean OPEN-ended (no single right answer) and forward-feeling, so a
// 6-year-old can retell rather than be quizzed. New entries added across
// favorite / surprise / feeling / personalize / hypothetical so the bank
// stays varied across chapters in long books.
const DEFAULT_CHAPTER_QUESTIONS = [
  "What was your favorite part of that chapter?",
  "Was there a part that surprised you?",
  "Who do you wish you could meet from this chapter?",
  "If you were in this chapter, what would you have done?",
  "What was the kindest moment in that chapter?",
  "If you could change one thing that happened, what would it be?",
  "Did anyone in this chapter remind you of someone you know?",
  "What's something you'd ask the main character right now?",
  "What was the silliest or funniest moment for you?",
  "Was there a moment that felt scary or worrying?",
  "What do you hope happens next?",
  "If this chapter was a picture, what would you draw?",
];

interface Book {
  id: string;
  title: string;
  author: string;
  emoji: string;
  spineColor: string;
  tagline: string;
  ageRange: string;
  readingLevel: string;
  lexile?: string;
  coverUrl: string;
  gutenbergUrl: string;
  standardEbooksUrl: string;
  tier?: number;
  /** Flat list of pages — source of truth for the renderer. For chapter
   *  books, this is the flattened concat of every chapter's pages and
   *  should match `chapters.flatMap(c => c.pages)`. */
  pages: BookPage[];
  /** Optional chapter structure. When present, this is a "chapter book":
   *  multi-session reads with Continue/Resume, chapter-end celebration
   *  cards, and chapter-aware library progress. When absent, the book
   *  is treated as a single-session read (picture books, starter readers,
   *  Aubree's House image book). */
  chapters?: BookChapter[];
}

/** Build a Book from an array of chapters. The flat `pages` array is
 *  computed automatically so authors don't have to maintain it by hand.
 *  Example:
 *    const blackBeauty = chapterBook({ id: "blackbeauty", title: "Black Beauty", ... }, [
 *      { id: "ch1", title: "Chapter 1 · My Early Home", summary: "...", pages: [...] },
 *      { id: "ch2", title: "Chapter 2 · The Hunt",      summary: "...", pages: [...] },
 *    ]);
 */
function chapterBook(meta: Omit<Book, "pages" | "chapters">, chapters: BookChapter[]): Book {
  return { ...meta, chapters, pages: chapters.flatMap(c => c.pages) };
}

/** Resolve the chapter that contains the given (1-based) page number.
 *  Returns null for books that don't have a `chapters` array (picture
 *  books, flat books). The `pageInChapter` field is 1-based, matching
 *  the way `currentPage` is stored elsewhere. */
function getChapterForPage(
  book: Book,
  page: number,
): { chapter: BookChapter; chapterIndex: number; pageInChapter: number; pagesInChapter: number } | null {
  if (!book.chapters || book.chapters.length === 0) return null;
  let runningStart = 0;
  for (let i = 0; i < book.chapters.length; i++) {
    const c = book.chapters[i];
    const start = runningStart + 1;
    const end = runningStart + c.pages.length;
    if (page >= start && page <= end) {
      return { chapter: c, chapterIndex: i, pageInChapter: page - runningStart, pagesInChapter: c.pages.length };
    }
    runningStart += c.pages.length;
  }
  return null;
}

/** True when the given page is the LAST page of its chapter — used to
 *  decide whether to show the celebratory chapter-end card after a
 *  forward page turn lands on the next chapter's first page.
 *  Forward-only: callers gate on `next > old`. */
function isChapterEnd(book: Book, page: number): boolean {
  const info = getChapterForPage(book, page);
  return info != null && info.pageInChapter === info.pagesInChapter;
}

/** 1-based page number where the given chapter starts. Used by the
 *  chapter-end card's "Next Chapter" button. */
function getChapterStartPage(book: Book, chapterIndex: number): number {
  if (!book.chapters) return 1;
  let n = 1;
  for (let i = 0; i < chapterIndex && i < book.chapters.length; i++) {
    n += book.chapters[i].pages.length;
  }
  return n;
}

/** True for books that should use the chapter-aware UX (Continue card,
 *  chapter-end cards, per-card progress with "Chapter 3 of 12" label). */
function isChapterBook(book: Book): boolean {
  return !!book.chapters && book.chapters.length > 0;
}

/** How many source pages get merged into one displayed spread for the
 *  given book at the given Nana fontScale.
 *
 *  Wish 2: chapter book pages feel sparse at smaller fonts. We pack
 *  multiple source pages per displayed spread when the font is small
 *  enough that the body wouldn't overflow. The chunk decision keys off
 *  Nana's authoritative fontScale (NEVER Perry's possibly-overridden
 *  local scale) so both iPads always agree on which source pages map
 *  to which displayed spread index.
 *
 *  Conservative defaults: XL/L → 1 (no chunking, iPad-mini safe),
 *  M → 2 (real-book density), S → 3 (extra-dense for tiny font).
 *  Picture / non-chapter books always return 1 — they're authored to
 *  one-spread-per-image. */
function chunkSizeFor(book: Book, nanaScale: number): number {
  if (!isChapterBook(book)) return 1;
  if (nanaScale >= 1.25) return 1;
  if (nanaScale >= 1.0)  return 2;
  return 3;
}

/** Snap an arbitrary source-page number to the start of the displayed
 *  spread that contains it, given the current chunk size. Stepping
 *  forward by `chunkSize` from this anchor lands on the next spread. */
function chunkStartPage(sourcePage: number, chunkSize: number): number {
  if (chunkSize <= 1) return sourcePage;
  // 1-based pages → translate to 0-based chunk index, then back.
  const zeroBased = sourcePage - 1;
  return Math.floor(zeroBased / chunkSize) * chunkSize + 1;
}

/**
 * PAGINATION CONTRACT — read this before adding/editing any page body.
 *
 * Both `leftBody` and `rightBody` MUST fit on the page at the LARGEST
 * font scale (1.5x) without overflow. The reading container is locked
 * to `overflow: hidden`, so anything that doesn't fit is silently
 * clipped — which Rick has explicitly rejected ("you couldn't read the
 * last couple sentence"). At smaller font sizes (1.0x / 1.25x), pages
 * just leave whitespace at the bottom.
 *
 * Practical limit at 1.5x: ~380 characters per body side. Longer than
 * that — split into two pages on a natural narrative break (paragraph
 * break, sentence end). The audit script `audit-pages.mjs` flags
 * anything over the threshold; run `node audit-pages.mjs` after edits.
 *
 * This rule is what guarantees Nana on 1.5x and Perry on 1.0x see the
 * same content per page and turn pages at exactly the same point.
 */
const booksLibrary: Record<string, Book> = {
  alice: {
    id: "alice",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    emoji: "🐇",
    spineColor: "#4A6FA5",
    coverUrl: "/cover-alice.jpg",
    ageRange: "6–10",
    readingLevel: "Grade 7–8",
    lexile: "1000L",
    tagline: "A curious girl tumbles into a world where nothing is quite as it seems.",
    gutenbergUrl: "https://www.gutenberg.org/ebooks/11",
    standardEbooksUrl: "https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland",
    pages: [
      { leftEmoji: "🐇", leftChapter: "Alice's Adventures in Wonderland", leftBody: "A girl named Alice follows a white rabbit down a rabbit-hole — and discovers a world where the impossible happens before breakfast.", rightTitle: "Alice's Adventures in Wonderland", rightTitleSub: "by Lewis Carroll", rightBody: "A curious girl tumbles into Wonderland — a world where nothing is quite as it seems, and the most peculiar things make perfect sense.", rightIsTitle: true, cue: "If you could follow a rabbit anywhere, where would you go?", nanaPrompt: "Ask Perry: if you could fall into any magical world, what would it look like?" },
      { leftEmoji: "🕳️", leftChapter: "Chapter 1 · Down the Rabbit-Hole", leftBody: "Alice was beginning to get very tired of sitting by her sister on the bank, when she spotted something very peculiar — a white rabbit with pink eyes running past.", rightTitle: null, rightTitleSub: null, rightBody: '"In another moment down went Alice after it, never once considering how in the world she was to get out again. The rabbit-hole went straight on like a tunnel for some way, and then dipped suddenly down — so suddenly that Alice had not a moment to think about stopping herself before she found herself falling down what seemed to be a very deep well."', rightIsTitle: false, cue: "Would you have followed the rabbit?", nanaPrompt: "Tell Perry about a time you did something without thinking it through first. Then ask her: have you ever just gone for it without knowing what would happen?" },
      { leftEmoji: "🕳️", leftChapter: "Chapter 1 · Down the Rabbit-Hole", leftBody: "The fall went on and on. Alice had so much time on the way down that her thoughts wandered — and she began to look about her, wondering what could possibly be at the bottom.", rightTitle: null, rightTitleSub: null, rightBody: '"Either the well was very deep, or she fell very slowly, for she had plenty of time as she went down to look about her and to wonder what was going to happen next."', rightIsTitle: false, cue: "How long would the fall feel?", nanaPrompt: "Ask Perry: have you ever waited for something that felt like it took forever?" },
      { leftEmoji: "🕳️", leftChapter: "Chapter 1 · Down the Rabbit-Hole", leftBody: "Alice peered into the dark, and as her eyes adjusted she began to make out the strangest sight — the walls of the well were not empty at all.", rightTitle: null, rightTitleSub: null, rightBody: '"First, she tried to look down and make out what she was coming to, but it was too dark to see. Then she looked at the sides of the well, and noticed that they were filled with cupboards and bookshelves: here and there she saw maps and pictures hung upon pegs."', rightIsTitle: false, cue: "What would YOU notice on the way down?", nanaPrompt: "Ask Perry: if you were falling down a magical hole, what would you want to find on the walls — what books, what pictures?" },
      { leftEmoji: "🍰", leftChapter: "Chapter 2 · Curiouser and Curiouser!", leftBody: "Alice grew and shrank with every bite and sip. She found herself crying a great pool of tears — until she swam her way out and met a very wet collection of animals.", rightTitle: null, rightTitleSub: null, rightBody: '"Curiouser and curiouser!" cried Alice. She was so surprised that for the moment she quite forgot how to speak good English. "Now I\'m opening out like the largest telescope that ever was! Goodbye, feet!" For when she looked down at her feet, they seemed to be almost out of sight, they were getting so far off.', rightIsTitle: false, cue: "What does 'curiouser' mean? Is it a real word?", nanaPrompt: "Carroll made up 'curiouser' — ask Perry: do you have a made-up word or a silly nickname? What does it mean?" },
      { leftEmoji: "🍰", leftChapter: "Chapter 2 · Curiouser and Curiouser!", leftBody: "Alice's feet now seemed miles away. Worried they'd feel forgotten, she began to plan how she could send presents down to her own toes — by carrier, of course.", rightTitle: null, rightTitleSub: null, rightBody: '"Oh, my poor little feet, I wonder who will put on your shoes and stockings for you now, dears? I\'m sure I shan\'t be able! I shall be a great deal too far off to trouble myself about you." And she went on planning to herself how she should manage it. "They must go by the carrier," she thought, "and how funny it\'ll seem, sending presents to one\'s own feet!"', rightIsTitle: false, cue: "Have you ever lost track of part of yourself?", nanaPrompt: "Tell Perry a silly story about getting big and small. Ask: if YOU could send a present to your own feet, what would you send?" },
      { leftEmoji: "🐛", leftChapter: "Chapter 5 · Advice from a Caterpillar", leftBody: "Alice found a large blue caterpillar perched on top of a mushroom, smoking a hookah. He fixed her with a steady gaze and asked the one question she could not answer.", rightTitle: null, rightTitleSub: null, rightBody: '"Who are YOU?" said the Caterpillar. Alice replied rather shyly, "I — I hardly know, sir, just at present — at least I know who I was when I got up this morning, but I think I must have changed several times since then."', rightIsTitle: false, cue: "If someone asked 'Who are you?', what would you say?", nanaPrompt: "Ask Perry: if you could be someone completely different for one whole day, who would you pick and why?" },
      { leftEmoji: "🐛", leftChapter: "Chapter 5 · Advice from a Caterpillar", leftBody: "The Caterpillar was not satisfied. He demanded an explanation — but how do you explain yourself when you keep changing size every few minutes?", rightTitle: null, rightTitleSub: null, rightBody: '"What do you mean by that?" said the Caterpillar sternly. "Explain yourself!" "I can\'t explain myself, I\'m afraid, sir," said Alice, "because I\'m not myself, you see." "I don\'t see," said the Caterpillar. "I\'m afraid I can\'t put it more clearly," Alice replied politely, "for I can\'t understand it myself, and being so many different sizes in a day is very confusing."', rightIsTitle: false, cue: "Have you ever had to explain something you didn't understand yourself?", nanaPrompt: "Ask Perry: have you ever felt confused about how you were feeling, and not been able to put words to it?" },
      { leftEmoji: "👶", leftChapter: "Chapter 6 · Pig and Pepper", leftBody: "In the Duchess's kitchen, pepper filled every breath and everyone sneezed except the cook. A baby howled. Then, in Alice's arms, the baby slowly turned into something else entirely.", rightTitle: null, rightTitleSub: null, rightBody: '"Alice was just beginning to think that it was going to make a remarkably ugly child: but it makes rather a handsome pig," she thought. Alice gently put down the little creature and felt quite relieved to see it trot quietly into the wood.', rightIsTitle: false, cue: "Would you rather meet a baby that turns into a pig, or a pig that acts like a baby?", nanaPrompt: "Ask Perry: what's the silliest thing you can imagine happening in a kitchen?" },
      { leftEmoji: "🐱", leftChapter: "Chapter 6 · Pig and Pepper", leftBody: "Just then Alice noticed a grin floating among the leaves of a tree. A whole cat slowly came into view around it — the famous Cheshire Cat, who had advice that wasn't really advice at all.", rightTitle: null, rightTitleSub: null, rightBody: '"Cheshire Puss," Alice began timidly, "which way ought I to go from here?" "That depends on where you want to get to," said the Cat. "I don\'t much care where —" said Alice. "Then it doesn\'t matter which way you go," said the Cat. "— so long as I get somewhere," Alice added. "Oh, you\'re sure to do that," said the Cat, "if you only walk long enough."', rightIsTitle: false, cue: "Was that helpful advice, or just clever?", nanaPrompt: "Ask Perry: if she could ask the Cheshire Cat one question, what would she ask?" },
      { leftEmoji: "☕", leftChapter: "Chapter 7 · A Mad Tea-Party", leftBody: "Alice came upon the strangest tea party she had ever seen — the March Hare, the Mad Hatter, and a sleeping Dormouse sat crowded at one end of a very long table.", rightTitle: null, rightTitleSub: null, rightBody: '"Have some wine," the March Hare said encouragingly. Alice looked round the table but there was nothing on it but tea. "I don\'t see any wine," she remarked. "There isn\'t any," said the March Hare. "Then it wasn\'t very civil of you to offer it," said Alice angrily.', rightIsTitle: false, cue: "Why offer wine you don't have?", nanaPrompt: "Ask Perry: have you ever pretended to offer something you didn't really have, just for fun?" },
      { leftEmoji: "🎩", leftChapter: "Chapter 7 · A Mad Tea-Party", leftBody: "The Hatter chimed in with personal remarks about Alice's hair, the March Hare scolded her for sitting without an invitation, and Alice tried to keep up with the strange manners of her new hosts.", rightTitle: null, rightTitleSub: null, rightBody: '"It wasn\'t very civil of you to sit down without being invited," said the March Hare. "I didn\'t know it was your table," said Alice. "It\'s laid for a great many more than three." "Your hair wants cutting," said the Hatter. "You should learn not to make personal remarks," Alice said with some severity. "It\'s very rude."', rightIsTitle: false, cue: "What rude thing has the Hatter just said?", nanaPrompt: "Ask Perry: what would she say if a stranger told her her hair needed cutting?" },
      { leftEmoji: "👑", leftChapter: "Chapter 8 · The Queen's Croquet-Ground", leftBody: "The Queen of Hearts was fond of only one expression — and she used it for almost every occasion. Flamingoes were used as mallets, hedgehogs as balls, playing-card soldiers as hoops.", rightTitle: null, rightTitleSub: null, rightBody: '"Off with their heads!" the Queen shouted. Nobody paid much attention, for the soldiers were always getting up and walking off to do something else. Alice began to feel quite uneasy.', rightIsTitle: false, cue: "Would you like the Queen of Hearts as your ruler?", nanaPrompt: "Ask Perry: if you were in charge for one whole day, what's the very first rule you would make?" },
      { leftEmoji: "🦩", leftChapter: "Chapter 8 · The Queen's Croquet-Ground", leftBody: "The croquet match was chaos — players never waited for turns, soldiers wandered off, and the Queen worked herself into a furious temper. Alice quietly began to plan her escape.", rightTitle: null, rightTitleSub: null, rightBody: 'The players all played at once without waiting for turns, quarrelling all the while, and fighting for the hedgehogs. The Queen was soon in a furious passion, shouting "Off with his head!" about once a minute. Alice felt very anxious. "How are you getting on?" said the Cat, appearing out of thin air.', rightIsTitle: false, cue: "What would you do if you were in Alice's shoes?", nanaPrompt: "Ask Perry: if she had to escape a chaotic place, what would she do first — hide, sneak, or run?" },
      { leftEmoji: "⚖️", leftChapter: "Chapter 12 · Alice's Evidence", leftBody: "Alice found herself in the strangest courtroom ever: the King and Queen of Hearts presided, the jury was twelve nervous creatures, and she was the very last witness.", rightTitle: null, rightTitleSub: null, rightBody: '"I\'m not afraid of you!" said Alice. "Who cares for you? You\'re nothing but a pack of cards!" At this the whole pack rose up into the air and came flying down upon her; she gave a little scream, half of fright and half of anger, and tried to beat them off.', rightIsTitle: false, cue: "What gave Alice the courage to speak up?", nanaPrompt: "Ask Perry: when has she felt brave enough to stand up to something scary?" },
      { leftEmoji: "💭", leftChapter: "Chapter 12 · Alice's Evidence", leftBody: "And then — the cards, the courtroom, all of Wonderland faded. Alice found herself back on the riverbank with her sister beside her, the leaves drifting gently down.", rightTitle: null, rightTitleSub: null, rightBody: 'Then she found herself lying on the bank, with her head in the lap of her sister, who was gently brushing dead leaves that had fluttered down upon her face. "Wake up, Alice dear!" said her sister. "Why, what a long sleep you\'ve had!" And so Alice woke up from her long strange dream — though she half wondered, for a moment, if it had been a dream at all.', rightIsTitle: false, cue: "What do you think the dream meant?", nanaPrompt: "Tell Perry about a dream you remember that felt very real. Ask her: have you ever had a dream like that — what happened in it?" },
    ],
  },
  velveteen: {
    id: "velveteen",
    title: "The Velveteen Rabbit",
    author: "Margery Williams",
    emoji: "🐰",
    spineColor: "#8B4C3A",
    coverUrl: "/cover-velveteen.jpg",
    ageRange: "4–8",
    readingLevel: "Grade 4–5",
    lexile: "930L",
    tagline: "A toy rabbit learns what it truly means to be Real.",
    gutenbergUrl: "https://www.gutenberg.org/ebooks/11757",
    standardEbooksUrl: "https://standardebooks.org/ebooks/margery-williams/the-velveteen-rabbit",
    pages: [
      { leftEmoji: "🐰", leftChapter: "The Velveteen Rabbit", leftBody: "A toy rabbit sits on a boy's bed, wondering what it means to be real. His journey to discover the answer will change everything.", rightTitle: "The Velveteen Rabbit", rightTitleSub: "by Margery Williams", rightBody: "Or How Toys Become Real — a timeless story about love, loyalty, and what it truly means to be alive.", rightIsTitle: true, cue: "Do you have a favorite stuffed animal?", nanaPrompt: "Ask Perry: do you have a favorite stuffed animal or toy? What makes it special?" },
      { leftEmoji: "🧸", leftChapter: "Christmas Morning", leftBody: "The Velveteen Rabbit was new at first — fat and bunchy, spotted brown and white, with real thread whiskers. But on Christmas morning, the Boy barely noticed him.", rightTitle: null, rightTitleSub: null, rightBody: '"There was once a velveteen rabbit, and in the beginning he was really splendid. He was fat and bunchy, as a rabbit should be; his coat was spotted brown and white, he had real thread whiskers, and his ears were lined with pink sateen."', rightIsTitle: false, cue: "What does your favorite toy look like?", nanaPrompt: "Ask Perry to describe her favorite stuffed animal — what does it look like, what does it feel like, and what's its name?" },
      { leftEmoji: "🐎", leftChapter: "What is REAL?", leftBody: "In the nursery lived a wise old Skin Horse. He told the Rabbit something wonderful one afternoon — something that changed the way the Rabbit saw everything.", rightTitle: null, rightTitleSub: null, rightBody: '"What is REAL?" asked the Rabbit. "Real isn\'t how you are made," said the Skin Horse. "It\'s a thing that happens to you. When a child loves you for a long, long time — REALLY loves you — then you become Real."', rightIsTitle: false, cue: "What do you think 'Real' means?", nanaPrompt: "Ask Perry: have you ever loved a toy so much it almost felt alive? What made it special?" },
      { leftEmoji: "🎪", leftChapter: "The Nursery", leftBody: "In the nursery, the mechanical toys were very grand and rather superior. They looked down on the Rabbit. But the Skin Horse — old and threadbare — had a wisdom none of them possessed.", rightTitle: null, rightTitleSub: null, rightBody: '"The mechanical toys were very superior, and looked down upon everyone else. They were full of modern ideas, and pretended they were real. The model boat would never admit that his paint was peeling. That is the sort of thing that happens to mechanical toys."', rightIsTitle: false, cue: "Do you think new things are always better than old things?", nanaPrompt: "Ask Perry: is there something old that means a lot to you — maybe something passed down from family? Tell her about one of yours." },
      { leftEmoji: "🌿", leftChapter: "The Woods", leftBody: "Spring came, and the Boy brought the Rabbit outside for the first time. Among the bracken and ferns, the Rabbit met real rabbits — and started to wonder what he truly was.", rightTitle: null, rightTitleSub: null, rightBody: '"Does it hurt?" asked the Rabbit. "Sometimes," said the Skin Horse, for he was always truthful. "When you are Real you don\'t mind being hurt. It doesn\'t happen all at once. It takes a long time."', rightIsTitle: false, cue: "What do you think it takes to become Real?", nanaPrompt: "Ask Perry: what are you working on right now that takes real patience — something you have to keep at, little by little?" },
      { leftEmoji: "🤒", leftChapter: "The Scarlet Fever", leftBody: "The Boy fell very ill with scarlet fever. Night after night the Velveteen Rabbit lay close beside him, giving all the comfort a rabbit can give — which is more than you might think.", rightTitle: null, rightTitleSub: null, rightBody: '"During the long nights the Rabbit lay close beside the Boy. The little rabbit listened. He was so tired himself that he did not care what happened next, as long as they were together."', rightIsTitle: false, cue: "What do you do when someone you love is sick?", nanaPrompt: "Ask Perry: when you're sick, what makes you feel better? Tell her what Nana used to do as a little girl." },
      { leftEmoji: "✨", leftChapter: "The Nursery Magic", leftBody: "The Boy recovered, but the Rabbit was taken away to be burned. Then — in the moonlight — a fairy appeared, and everything the Rabbit had been promised came true at last.", rightTitle: null, rightTitleSub: null, rightBody: '"She gave him a kiss. She put him down on the grass. \"Run and play, little Rabbit!\" Then two little arms were round his neck, for a moment she held him close. And when he came to himself, he was a Real Rabbit at last."', rightIsTitle: false, cue: "How did this story make you feel?", nanaPrompt: "Give Perry a quiet moment. Then ask: who in your life makes you feel completely loved just as you are?" },
      { leftEmoji: "🌸", leftChapter: "Spring Returns", leftBody: "In the wood, among the bracken and ferns, a real wild rabbit twitched his nose. He had lived there all his life — free and wild. But he watched the Boy from a distance, and remembered.", rightTitle: null, rightTitleSub: null, rightBody: '"He was a Real Rabbit at last, at home with the other rabbits. And when spring came and the Boy went to play in the garden, the little rabbit came and watched. But the Boy never knew."', rightIsTitle: false, cue: "Do you think the Rabbit remembered being loved?", nanaPrompt: "Ask Perry: what's one memory from your life that you'd want to hold onto forever, no matter what?" },
    ],
  },
  peter: {
    id: "peter",
    title: "The Tale of Peter Rabbit",
    author: "Beatrix Potter",
    emoji: "🥕",
    spineColor: "#3D6B4A",
    coverUrl: "/cover-peter.jpg",
    ageRange: "4–7",
    readingLevel: "Grade 2–3",
    lexile: "700L",
    tagline: "The mischievous adventures of the most famous rabbit in children's literature.",
    gutenbergUrl: "https://www.gutenberg.org/ebooks/14838",
    standardEbooksUrl: "https://standardebooks.org/ebooks/beatrix-potter/the-tale-of-peter-rabbit",
    pages: [
      {
        leftEmoji: '🐰🌸🌿',
        leftChapter: '✨ The Tale of Peter Rabbit',
        leftBody: 'Once upon a time there were four little rabbits. Their names were Flopsy, Mopsy, Cottontail — and Peter.',
        rightTitle: 'The Tale of Peter Rabbit',
        rightTitleSub: 'by Beatrix Potter',
        rightBody: 'They lived with their mother in a cozy burrow underneath the root of a very big fir tree. It was the most wonderful home.',
        rightIsTitle: true,
        cue: 'Can you name all four rabbits?',
        nanaPrompt: 'Can she name all four rabbits? Flopsy, Mopsy, Cottontail — and naughty Peter! Ask her which name she likes best.',
      },
      {
        leftEmoji: '🧺🍰🍷',
        leftChapter: '🐰 Mother\'s Warning',
        leftBody: 'Mrs. Rabbit packed her basket and said: "You may go into the fields or down the lane — but do NOT go into Mr. McGregor\'s garden!"',
        rightTitle: null,
        rightTitleSub: null,
        rightBody: 'Flopsy, Mopsy, and Cottontail were good little bunnies. They went to gather blackberries. But Peter ran straight to Mr. McGregor\'s garden!',
        rightIsTitle: false,
        cue: 'What did Mother tell them not to do?',
        nanaPrompt: 'What is the hardest rule for her to follow — and why? Tell her about a rule you had as a little girl.',
      },
      {
        leftEmoji: '🥕🥦🌿🥬',
        leftChapter: '🌱 Inside the Garden',
        leftBody: 'Peter squeezed under the gate. He ate some lettuces. He ate some French beans. He ate some radishes. He felt rather sick.',
        rightTitle: null,
        rightTitleSub: null,
        rightBody: 'Then — round the end of a cucumber frame — Peter came face to face with Mr. McGregor! Mr. McGregor jumped up and chased after him with a rake!',
        rightIsTitle: false,
        cue: 'What should Peter have done?',
        nanaPrompt: 'Do you think Peter was brave or foolish? What would she have done in his place?',
      },
      {
        leftEmoji: '🏃💨🌿🌿',
        leftChapter: '😱 The Chase!',
        leftBody: 'Peter ran as fast as his legs could carry him! He lost one shoe in the cabbages and the other shoe amongst the potatoes.',
        rightTitle: null,
        rightTitleSub: null,
        rightBody: 'He jumped into a watering can to hide. It was very wet and cold inside. He could hear Mr. McGregor\'s footsteps getting closer and closer...',
        rightIsTitle: false,
        cue: 'Have you ever had to hide somewhere unexpected?',
        nanaPrompt: 'What is the best hiding spot she has ever found? Tell her yours from when you were little!',
      },
      {
        leftEmoji: '🐱💧🐠🪴',
        leftChapter: '😢 Lost in the Garden',
        leftBody: 'Peter was lost. He sat down and began to cry. Then he found a garden shed — and crept inside. A friendly robin came to watch.',
        rightTitle: null,
        rightTitleSub: null,
        rightBody: 'Peter peeked out the window. He spotted the gate! But Mr. McGregor was right there — planting cabbages. What could Peter do?',
        rightIsTitle: false,
        cue: 'What would you do if you were lost and scared?',
        nanaPrompt: 'If she were ever lost or scared, who is the first person she would look for? Remind her you would always come running.',
      },
      {
        leftEmoji: '🦅💨🐰',
        leftChapter: '🏠 The Escape!',
        leftBody: 'Peter ran for his life — straight through the gate! He never stopped running until he reached home under the big fir tree.',
        rightTitle: null,
        rightTitleSub: null,
        rightBody: 'Peter felt so ill that his mother put him to bed. She made him chamomile tea. Flopsy, Mopsy, and Cottontail had bread and milk and blackberries for supper.',
        rightIsTitle: false,
        cue: 'Do you think Peter learned his lesson?',
        nanaPrompt: 'Do you think he learned his lesson? What should he do differently next time? Tell her about a time you got into a little trouble as a child.',
      },
    ],
  },
  secretgarden: {
    id: "secretgarden",
    title: "The Secret Garden",
    author: "Frances Hodgson Burnett",
    emoji: "🌹",
    spineColor: "#4A7C59",
    coverUrl: "/cover-secretgarden.jpg",
    ageRange: "8–12",
    readingLevel: "Grade 6–7",
    lexile: "970L",
    tagline: "A lonely, unloved girl discovers a hidden garden — and finds herself growing alongside it.",
    gutenbergUrl: "https://www.gutenberg.org/ebooks/113",
    standardEbooksUrl: "https://standardebooks.org/ebooks/frances-hodgson-burnett/the-secret-garden",
    pages: [
      { leftEmoji: "🌹", leftChapter: "The Secret Garden", leftBody: "Mary Lennox is ten years old, cross, and certain that nobody in the world loves her. She is wrong about many things — but right that a secret is waiting to be found.", rightTitle: "The Secret Garden", rightTitleSub: "by Frances Hodgson Burnett", rightBody: "A story about a locked garden, a lonely girl, and the extraordinary things that happen when something — or someone — begins to grow.", rightIsTitle: true, cue: "Do you think a garden can change a person?", nanaPrompt: "Ask Perry: is there a place — a room, a yard, a special spot outside — where you feel completely like yourself? Describe it." },
      { leftEmoji: "🇮🇳", leftChapter: "Chapter I · There is No One Left", leftBody: "Mary Lennox was born in India, where she was raised by servants and ignored by her beautiful mother. Then cholera came to the bungalow — and when the soldiers arrived, they found only Mary.", rightTitle: null, rightTitleSub: null, rightBody: '"It is the child no one ever saw!" exclaimed the man. "She has actually been forgotten!" "Why was I forgotten?" Mary said, stamping her foot. "Why does nobody come?" The young man looked at her very sadly. "Poor little kid!" he said. "There is nobody left to come."', rightIsTitle: false, cue: "How do you think Mary felt in that moment?", nanaPrompt: "Tell Perry about a time you felt left out or alone — even for just an afternoon. Then ask: have you ever felt that way? What helped?" },
      { leftEmoji: "🌧️", leftChapter: "Chapter II · Mistress Mary Quite Contrary", leftBody: "Mary was sent to England — to the great, gloomy Misselthwaite Manor on the moors. She was disagreeable. She was spoiled. But somewhere inside her, something was beginning to stir.", rightTitle: null, rightTitleSub: null, rightBody: '"Mistress Mary, quite contrary, how does your garden grow?" the children sang. The crosser Mary got, the more they sang. She had never had anyone to play with. She had never learned how. She didn\'t know — yet — that she was going to."', rightIsTitle: false, cue: "Why do you think Mary was so unpleasant? Was it her fault?", nanaPrompt: "Ask Perry: can you feel sorry for someone who is being unkind? Have you ever looked past someone\'s grumpy outside to see what\'s underneath?" },
      { leftEmoji: "🔑", leftChapter: "Chapter VII · The Key to the Garden", leftBody: "On the moors Mary began to walk — and as she walked she wondered about the one garden that was always locked. The gardener Ben Weatherstaff had told her why. Then, in the earth, her stick struck something.", rightTitle: null, rightTitleSub: null, rightBody: '"She dug and pulled and found it was a key — a little rusty key which looked as if it had been buried a long time. She looked at it with an almost frightened delight. She buried it again — oh, so carefully! — and covered it with a flat stone, for she wanted to think about it before she did anything."', rightIsTitle: false, cue: "What would you do if you found a mysterious key?", nanaPrompt: "Ask Perry: if you found a mysterious old key, what would you hope it unlocked?" },
      { leftEmoji: "🐦", leftChapter: "Chapter VIII · The Robin Who Showed the Way", leftBody: "A round red-breasted little robin had become Mary's friend on the moors. One day he landed near a patch of disturbed earth — and beneath the ivy, Mary saw something she had not dared hope for.", rightTitle: null, rightTitleSub: null, rightBody: '"She put her hands under the leaves and began to pull and push them aside. Thick as the ivy hung, it nearly all was a loose and swinging curtain, though some had crept over wood and iron. Mary\'s heart began to thump and her hands to shake a little in her delight and excitement. The robin kept singing. She had found the door."', rightIsTitle: false, cue: "Have you ever found something you'd been searching for? How did it feel?", nanaPrompt: "Tell Perry about a time you discovered something wonderful that had been hidden from you. Ask her: have you ever had that feeling of finding something surprising?" },
      { leftEmoji: "🧑‍🌾", leftChapter: "Chapter X · Dickon", leftBody: "Mary met a boy sitting on the grass playing a rough wooden pipe. The animals on the moors came to him as if he were a friend they had known always. His name was Dickon, and he could make things grow.", rightTitle: null, rightTitleSub: null, rightBody: '"A boy was sitting under a tree, with his back against it, playing on a rough wooden pipe. Two rabbits were sitting up and sniffing at him. Two squirrels were watching from a nearby branch. He was a funny looking boy about twelve, and he looked clean and like the open country itself."', rightIsTitle: false, cue: "Would you trust Dickon? Why or why not?", nanaPrompt: "Ask Perry: do you have a friend who makes everyone around them feel calm or happy just by being there? What makes that person special?" },
      { leftEmoji: "🕯️", leftChapter: "Chapter XIV · A Young Rajah", leftBody: "Late one night Mary heard crying through the walls of the manor. She followed the sound through dark corridor after corridor — until she found something no one had ever told her was there: a boy.", rightTitle: null, rightTitleSub: null, rightBody: '"I am Colin," said the boy, "I am always ill and I am going to die." He said it as if he had said it so often he had ceased to feel much about it. "Mary stared at him. She had never seen so strange a creature. He was pale and seemed too thin for his height."', rightIsTitle: false, cue: "Why do you think no one told Mary about Colin?", nanaPrompt: "Ask Perry: what would you say to a kid who had given up and felt like nothing would ever get better?" },
      { leftEmoji: "☀️", leftChapter: "Chapter XXVII · In Ben Weatherstaff's Garden", leftBody: "Spring came to the secret garden. Colin — who had never walked without help — ran. He dug and planted and felt the sun on his face. Mary watched, and in watching, understood what the garden had done for her, too.", rightTitle: null, rightTitleSub: null, rightBody: '"It\'s a secret garden," said Mary. Colin swept his arm around. "And I shall live forever and ever and ever!" he cried. Ben Weatherstaff rubbed his eyes. He had been crying. "Aye," he said, "tha\' will." And there was something in the way he said it that Mary knew was true."', rightIsTitle: false, cue: "What did the secret garden give to each person in the story?", nanaPrompt: "Ask Perry: what\'s one thing you want to grow — in yourself or in the world — this year? Nana can share hers too." },
    ],
  },
  oz: {
    id: "oz",
    title: "The Wonderful Wizard of Oz",
    author: "L. Frank Baum",
    emoji: "🌪️",
    spineColor: "#7B9E3B",
    coverUrl: "/cover-oz.jpg",
    ageRange: "7–11",
    readingLevel: "Grade 5–6",
    lexile: "1000L",
    tagline: "A Kansas girl is swept away to a magical land — and discovers the power was inside her all along.",
    gutenbergUrl: "https://www.gutenberg.org/ebooks/55",
    standardEbooksUrl: "https://standardebooks.org/ebooks/l-frank-baum/the-wonderful-wizard-of-oz",
    pages: [
      { leftEmoji: "🌪️", leftChapter: "The Wonderful Wizard of Oz", leftBody: "Dorothy lives in the grey Kansas prairies with Aunt Em, Uncle Henry, and her little black dog Toto. She has never imagined a world of colour. Then the cyclone comes.", rightTitle: "The Wonderful Wizard of Oz", rightTitleSub: "by L. Frank Baum", rightBody: "A Kansas girl whisked to a magical land of emerald cities, talking scarecrows, and witches both wicked and good — a story about what it means to find your way home.", rightIsTitle: true, cue: "If a cyclone could take you anywhere, where would you want to land?", nanaPrompt: "Ask Perry: what does 'home' mean to you? Is it a place, a feeling, or the people you're with?" },
      { leftEmoji: "🏡", leftChapter: "Chapter I · The Cyclone", leftBody: "The sky turned green-grey and the wind shrieked. Dorothy ran inside but couldn't reach the cellar in time. The house rose slowly into the sky. And Dorothy — with Toto beside her — was carried miles and miles away.", rightTitle: null, rightTitleSub: null, rightBody: '"The house whirled around two or three times and rose slowly through the air. Dorothy felt as if she were going up in a balloon. Hour after hour passed, and slowly Dorothy got over her fright; but she felt quite lonely. At last she crawled to her bed and lay down, and Toto lay beside her, and Dorothy fell fast asleep."', rightIsTitle: false, cue: "How would you feel if your house was lifted into the sky?", nanaPrompt: "Ask Perry: if you had to pick one person to be with during a scary adventure, who would you choose and why?" },
      { leftEmoji: "🧙‍♀️", leftChapter: "Chapter II · The Council with the Munchkins", leftBody: "Dorothy's house had landed on the Wicked Witch of the East. A little old woman with white hair appeared and bowed. The Munchkins were free. And Dorothy was — accidentally — a heroine.", rightTitle: null, rightTitleSub: null, rightBody: '"You are welcome, most noble Sorceress, to the land of the Munchkins. We are so grateful to you for having killed the Wicked Witch of the East." Dorothy listened with wonder. "There must be some mistake," she said. "I have not killed anything." "Your house did, anyway," replied the little old woman, with a laugh."', rightIsTitle: false, cue: "Can you be a hero by accident?", nanaPrompt: "Ask Perry: have you ever done something good by accident, without even trying? What happened?" },
      { leftEmoji: "🌾", leftChapter: "Chapter III · How Dorothy Saved the Scarecrow", leftBody: "Dorothy and Toto set off down the yellow brick road to the Emerald City. On the way, she met a Scarecrow who wanted a brain more than anything else in the world — and came along anyway.", rightTitle: null, rightTitleSub: null, rightBody: '"Do you think," he asked, "if I go to the Emerald City with you, that Oz would give me some brains?" "I cannot tell," she returned, "but you may come with me, if you like. If Oz will not give you any brains you will be no worse off than you are now." "That is true," said the Scarecrow."', rightIsTitle: false, cue: "Is it brave or foolish to travel with someone you just met?", nanaPrompt: "Ask Perry: if you could have one — a great brain, a kind heart, or real courage — which would you pick? Which do you think you already have?" },
      { leftEmoji: "🪓", leftChapter: "Chapter V · The Rescue of the Tin Woodman", leftBody: "Deep in the forest they found a man made entirely of tin, so rusted he could not move his jaw to call for help. He had stood there for over a year — waiting. He wanted only a heart.", rightTitle: null, rightTitleSub: null, rightBody: '"My greatest wish," said the Tin Woodman, "is to get a heart. The Munchkins are lucky to have theirs. I shall ask Oz to give me one." He spoke so earnestly that Dorothy looked at him with surprise. "If I only had a heart," he said again, and sighed."', rightIsTitle: false, cue: "Why do you think the Tin Woodman wanted a heart so badly?", nanaPrompt: "Ask Perry: what does it mean to have a big heart? Who do you know that has one? Tell her why Nana thinks she does." },
      { leftEmoji: "🦁", leftChapter: "Chapter VI · The Cowardly Lion", leftBody: "A great Lion leaped out and roared — and Toto barely escaped. Dorothy slapped the Lion on the nose. He began to cry. He was the King of Beasts, he said, and he was completely, utterly terrified of everything.", rightTitle: null, rightTitleSub: null, rightBody: '"Isn\'t he a coward?" asked Dorothy. "Certainly," said the Lion, wiping his eye with the tip of his tail. "I have always known it. It is my great sorrow, and makes my life very unhappy. But whenever there is danger my heart begins to beat fast." "Maybe you have heart disease," said the Tin Woodman."', rightIsTitle: false, cue: "Is the Lion really a coward if he still moves forward even when scared?", nanaPrompt: "Ask Perry: what\'s something you\'re a little scared of but you do anyway? Tell her that\'s exactly what real courage looks like." },
      { leftEmoji: "🐒", leftChapter: "Chapter XII · The Search for the Wicked Witch", leftBody: "The Wicked Witch of the West sent wolves, crows, and bees against Dorothy — and finally called her Winged Monkeys. Dorothy and her friends were captured. But Dorothy had something the Witch wanted.", rightTitle: null, rightTitleSub: null, rightBody: '"The Wicked Witch looked down at Dorothy\'s feet, and seeing the Silver Shoes, began to tremble with fear — for she knew what a powerful charm belonged to them. \"I can make her my slave,\" said the Witch to herself, \"for I do not know yet how to use her shoes\' magic. But I\'ll watch her carefully.\""', rightIsTitle: false, cue: "Why is Dorothy so dangerous to the Witch without even knowing it?", nanaPrompt: "Ask Perry: have you ever discovered a strength you didn\'t know you had until someone pointed it out? What was it?" },
      { leftEmoji: "✨", leftChapter: "Chapter XXIII · Glinda the Good Witch of the South", leftBody: "Glinda listened to Dorothy\'s whole story. Then she smiled. The Silver Shoes, she said, could have taken Dorothy home from the very first day. The power was hers all along.", rightTitle: null, rightTitleSub: null, rightBody: '"Your Silver Shoes will carry you over the desert," said Glinda. "If you had known their power you could have gone back to your Aunt Em the very first day you came to this country." Dorothy hugged the Lion, kissed the Tin Woodman, took the Scarecrow\'s hands and held them, and then she tapped her heels together three times."', rightIsTitle: false, cue: "Does it make you feel sad or hopeful that Dorothy had the power all along?", nanaPrompt: "Ask Perry: what\'s something wonderful you already have inside you — kindness, bravery, or creativity — that you sometimes forget is there?" },
    ],
  },
  goldilocks: {
    id: "goldilocks",
    title: "Goldilocks and the Three Bears",
    author: "Traditional",
    emoji: "🐻",
    spineColor: "#8B6914",
    tier: 1,
    ageRange: "Ages 4–5",
    readingLevel: "Grade K–1",
    tagline: "A curious little girl visits a cottage that doesn't belong to her.",
    coverUrl: "",
    gutenbergUrl: "",
    standardEbooksUrl: "",
    pages: [
      { leftEmoji: "🐻🐻🐻", leftChapter: "Goldilocks and the Three Bears", leftBody: "Once upon a time, three bears lived in a cozy cottage in the woods — a great big Papa Bear, a middle-sized Mama Bear, and a tiny little Baby Bear.", rightTitle: "Goldilocks and the Three Bears", rightTitleSub: "A traditional tale", rightBody: "One morning, the bears made porridge for breakfast. But it was too hot to eat! So they went for a walk in the woods while it cooled down.", rightIsTitle: true, cue: "Have you ever had to wait for something to cool down?", nanaPrompt: "Do you like porridge or oatmeal? What is your favorite breakfast? Tell me — and I will tell you mine from when I was little." },
      { leftEmoji: "🏠🌲🌸", leftChapter: "The Cottage in the Woods", leftBody: "While the bears were away, a little girl with golden curls came walking through the woods. She saw the cottage and peeked inside. Nobody was home!", rightTitle: null, rightTitleSub: null, rightBody: "Goldilocks knocked on the door. No answer! She turned the handle and walked right in. On the table she saw three bowls of porridge — and her tummy gave a rumble.", rightIsTitle: false, cue: "Was it okay for Goldilocks to go inside?", nanaPrompt: "Was it okay for Goldilocks to go inside someone's house without being invited? What should she have done instead?" },
      { leftEmoji: "🥣🥣🥥", leftChapter: "Too Hot! Too Cold! Just Right!", leftBody: "Goldilocks tasted Papa Bear's porridge — too hot! She tried Mama Bear's porridge — too cold! Then she tried Baby Bear's porridge.", rightTitle: null, rightTitleSub: null, rightBody: '"Just right!" said Goldilocks — and she ate every last drop. Every single drop. Baby Bear\'s bowl was completely empty.', rightIsTitle: false, cue: "What things have to be just right for you?", nanaPrompt: "Is there something that has to be just right for you before you enjoy it? Maybe food, or the temperature of something? There is something like that for me too — I will tell you what it is." },
      { leftEmoji: "🪑🪑🪑", leftChapter: "Three Chairs", leftBody: "Next Goldilocks tried the chairs. Papa Bear's chair was too hard. Mama Bear's chair was too soft. Baby Bear's chair was just right — but when she sat down, it broke!", rightTitle: null, rightTitleSub: null, rightBody: '"This chair is too hard!" said Goldilocks. "This chair is too soft!" Then she sat in Baby Bear\'s little chair. "This is just right!" CRACK! The chair broke into pieces.', rightIsTitle: false, cue: "Have you ever accidentally broken something?", nanaPrompt: "Have you ever broken something by accident? What happened — did you tell someone? I broke something when I was little too. Want to hear what happened?" },
      { leftEmoji: "🛏️🛏️🛏️", leftChapter: "Three Beds", leftBody: "Upstairs Goldilocks found three beds. Papa Bear's bed was too hard. Mama Bear's bed was too soft. Baby Bear's tiny little bed was just right.", rightTitle: null, rightTitleSub: null, rightBody: "She pulled the covers up to her chin, closed her eyes, and in a moment she was fast asleep — dreaming peacefully, not knowing what was coming through the front door.", rightIsTitle: false, cue: "What helps you fall asleep at night?", nanaPrompt: "What is your bedtime routine? What helps you feel cozy and safe at night? When I was little I had something special that helped me sleep — I will tell you what it was." },
      { leftEmoji: "🐻🐻🐻🏠", leftChapter: "The Bears Come Home", leftBody: "The three bears came home from their walk. Papa Bear looked at his porridge and growled. Mama Bear looked at her chair. And Baby Bear looked at his little bed — and started to cry.", rightTitle: null, rightTitleSub: null, rightBody: '"Somebody has been eating my porridge!" growled Papa Bear. "Somebody has been sitting in my chair!" cried Mama Bear. "Somebody is sleeping in MY bed — and here she is!" squeaked Baby Bear.', rightIsTitle: false, cue: "How do you think Baby Bear felt?", nanaPrompt: "How do you think Baby Bear felt when he found someone in his bed? Has anyone ever touched something of yours without asking? How did that feel?" },
      { leftEmoji: "🏃‍♀️💨🌲", leftChapter: "Goldilocks Runs Away", leftBody: "Goldilocks woke up and saw three bears staring at her. She jumped out of bed, ran down the stairs, out the door, and all the way home through the woods — and never came back.", rightTitle: null, rightTitleSub: null, rightBody: "Goldilocks screamed and jumped out of bed. She ran to the window, jumped out, and ran as fast as her legs could carry her. The three bears never saw her again.", rightIsTitle: false, cue: "What do you think Goldilocks told her mom?", nanaPrompt: "What do you think Goldilocks said when she got home? Do you think she told the truth? What do you think she learned — and do you think the bears ever forgave her?" },
    ],
  },
  threepigs: {
    id: "threepigs",
    title: "The Three Little Pigs",
    author: "Traditional",
    emoji: "🐷",
    spineColor: "#C25B3A",
    tier: 1,
    ageRange: "Ages 4–5",
    readingLevel: "Grade K–1",
    tagline: "Three little pigs build three very different houses — and meet a very big wolf.",
    coverUrl: "",
    gutenbergUrl: "",
    standardEbooksUrl: "",
    pages: [
      { leftEmoji: "🐷🐷🐷", leftChapter: "The Three Little Pigs", leftBody: "Once upon a time, three little pigs left home to seek their fortune. Their mother warned them to beware of the Big Bad Wolf — and to build their houses strong.", rightTitle: "The Three Little Pigs", rightTitleSub: "A traditional tale", rightBody: "The first little pig was in a hurry. The second little pig was not much better. But the third little pig was patient — and determined to build the very best house he could.", rightIsTitle: true, cue: "Which pig do you think made the right choice?", nanaPrompt: "If you were building a house, what would you make it out of? I will tell you what my first home was like." },
      { leftEmoji: "🌾🏠🐷", leftChapter: "The House of Straw", leftBody: "The first little pig built his house out of straw. It was quick and easy! He was done by lunchtime and spent the rest of the day playing.", rightTitle: null, rightTitleSub: null, rightBody: "The first little pig gathered armfuls of straw and piled them up into a little house. He was done by noon. \"Best house ever!\" he said — and went off to play.", rightIsTitle: false, cue: "Is it better to be fast or careful?", nanaPrompt: "Is it always good to do things fast? Can you think of something where you need to be slow and careful? I rushed something once and wished I hadn't — want to hear about it?" },
      { leftEmoji: "🪵🏠🐷", leftChapter: "The House of Sticks", leftBody: "The second little pig built his house out of sticks. It took a little longer than straw, but he was still done by afternoon — and went off to play with his brother.", rightTitle: null, rightTitleSub: null, rightBody: "The second little pig gathered sticks from the forest and built a little house. It looked quite good! \"Strong enough!\" he said — and went off to play too.", rightIsTitle: false, cue: "Do you think sticks are stronger than straw?", nanaPrompt: "Why do you think the second pig chose sticks instead of bricks? What would you have chosen — and why?" },
      { leftEmoji: "🧱🏠🐷", leftChapter: "The House of Bricks", leftBody: "The third little pig worked hard all day long — and all the next day too. Brick by brick, he built a strong, solid house. He was very tired, but very proud.", rightTitle: null, rightTitleSub: null, rightBody: "The third pig mixed mortar and laid brick after brick. His brothers laughed at him for working so hard. But the third pig just smiled and kept building.", rightIsTitle: false, cue: "Have you ever worked really hard at something?", nanaPrompt: "Can you huff and puff like the Big Bad Wolf? Try it! What is the scariest thing you can imagine coming to your door? I would always protect you — no matter what." },
      { leftEmoji: "🐺💨🌾", leftChapter: "The Wolf Comes", leftBody: "Then came the Big Bad Wolf! He knocked on the first pig's straw house. \"Little pig, little pig, let me come in!\" \"Not by the hair of my chinny chin chin!\" \"Then I'll huff and I'll puff!\"", rightTitle: null, rightTitleSub: null, rightBody: "The wolf huffed and puffed and blew the straw house down! The first little pig ran as fast as he could to his brother's house of sticks.", rightIsTitle: false, cue: "Can you huff and puff like the Big Bad Wolf?", nanaPrompt: "Where do you go when you feel scared or unsafe? I want you to know that I am always a safe place for you. When I was little I ran to someone too — I will tell you who." },
      { leftEmoji: "🐺💨🪵", leftChapter: "The Second House Falls", leftBody: "The wolf followed the pigs to the house of sticks. \"Little pigs, little pigs, let me come in!\" \"Not by the hair of our chinny chin chins!\" So the wolf huffed and puffed again.", rightTitle: null, rightTitleSub: null, rightBody: "The wolf huffed and puffed and blew the stick house down too! Both little pigs ran as fast as their trotters could carry them — straight to their brother's brick house.", rightIsTitle: false, cue: "Where would you run if you needed to be safe?", nanaPrompt: "Why couldn't the wolf blow down the brick house? What is something in your life that is strong and safe — a person, a place, or a feeling?" },
      { leftEmoji: "🐺🧱🏠", leftChapter: "The Brick House Holds", leftBody: "The wolf tried with all his might! He huffed and he puffed and he huffed and he puffed — but the brick house did not move. Not even a little bit.", rightTitle: null, rightTitleSub: null, rightBody: "The wolf huffed and puffed until he was quite out of breath. But the brick house stood firm. At last the wolf gave up and went home hungry. The three pigs were safe!", rightIsTitle: false, cue: "What do the pigs learn about hard work?", nanaPrompt: "The pigs worked together and outsmarted the wolf! Can you think of a time you solved a problem by being clever instead of scared?" },
    ],
  },
  littleredridinghood: {
    id: "littleredridinghood",
    title: "Little Red Riding Hood",
    author: "Brothers Grimm",
    emoji: "🧺",
    spineColor: "#B22222",
    tier: 1,
    ageRange: "Ages 4–5",
    readingLevel: "Grade K–1",
    tagline: "A little girl in a red cloak walks through the woods to visit her grandmother.",
    coverUrl: "",
    gutenbergUrl: "",
    standardEbooksUrl: "",
    pages: [
      { leftEmoji: "👧🧺🌸", leftChapter: "Little Red Riding Hood", leftBody: "Once upon a time there was a dear little girl who was loved by everyone. Her grandmother had given her a little red velvet cloak — and she wore it so often, everyone called her Little Red Riding Hood.", rightTitle: "Little Red Riding Hood", rightTitleSub: "by the Brothers Grimm", rightBody: "One day her mother called her and said: 'Come, Little Red Riding Hood. Your grandmother is ill. Take her this basket of cake and wine. And remember — stay on the path!'", rightIsTitle: true, cue: "Do you have a nickname? How did you get it?", nanaPrompt: "Before we start — I want to tell you about a special piece of clothing I had when I was little. Something that was just mine. Do you have something like that?" },
      { leftEmoji: "🌲🌲🌲", leftChapter: "Into the Woods", leftBody: "Little Red Riding Hood set off through the forest with her basket. The trees were tall and the path was narrow. She had been told to go straight to grandmother's house.", rightTitle: null, rightTitleSub: null, rightBody: "Her mother's words echoed in her head: stay on the path, do not talk to strangers, go straight there. Little Red Riding Hood skipped along, swinging her basket and singing to herself.", rightIsTitle: false, cue: "What rules does your family have to keep you safe?", nanaPrompt: "What are the most important rules in our family? Why do you think those rules exist? I had a rule when I was little — want to hear what happened when I didn't follow it?" },
      { leftEmoji: "🐺🌸👧", leftChapter: "The Wolf", leftBody: "In the forest she met a big wolf. He seemed very friendly and polite. 'Where are you going, little girl?' he asked with a wide smile. Little Red Riding Hood told him all about grandmother.", rightTitle: null, rightTitleSub: null, rightBody: "The wolf bowed and smiled. 'How kind you are!' he said. But inside he was thinking about grandmother's cottage — and how to get there first. He ran ahead through the deep dark woods.", rightIsTitle: false, cue: "Should you talk to strangers you meet alone?", nanaPrompt: "What should you do if a stranger talks to you when you are alone? You never have to talk to a stranger — you can always say no and walk away. What would you do?" },
      { leftEmoji: "🏡🐺🛏️", leftChapter: "Grandmother's House", leftBody: "The wolf arrived at grandmother's cottage first. He knocked on the door, pretended to be Little Red Riding Hood, and went inside. He gobbled up grandmother and put on her clothes and cap.", rightTitle: null, rightTitleSub: null, rightBody: "When Little Red Riding Hood arrived and knocked, the wolf called out in his best grandmother voice: 'Come in, my dear!' She pushed open the door — and saw her grandmother in bed.", rightIsTitle: false, cue: "Did anything seem strange about grandmother?", nanaPrompt: "Have you ever visited someone and noticed something seemed different or strange? Always trust your feelings — if something feels wrong, tell a grown-up right away." },
      { leftEmoji: "👁️👂👃🦷", leftChapter: "What Big Eyes You Have", leftBody: "'Grandmother, what big eyes you have!' 'All the better to see you with, my dear.' 'Grandmother, what big ears you have!' 'All the better to hear you with, my dear.' 'Grandmother, what big teeth you have!'", rightTitle: null, rightTitleSub: null, rightBody: "'All the better to EAT you with!' cried the wolf — and he leaped out of bed! Little Red Riding Hood screamed and screamed as loudly as she could.", rightIsTitle: false, cue: "Can you finish the pattern? What comes next?", nanaPrompt: "Let's read this page together slowly — I will pause and you fill in the answer! What is the scariest thing you can imagine? I will always come running if you call for me." },
      { leftEmoji: "🪓🌲🦺", leftChapter: "The Woodcutter", leftBody: "A woodcutter passing by heard the screaming and rushed inside. He chased away the wolf — and grandmother came out safe. Little Red Riding Hood was very glad to see her!", rightTitle: null, rightTitleSub: null, rightBody: "Little Red Riding Hood hugged her grandmother tight. She had learned her lesson. She would always stay on the path, never talk to strangers — and next time, she would bring the woodcutter too.", rightIsTitle: false, cue: "What did Little Red Riding Hood learn?", nanaPrompt: "What did Little Red Riding Hood learn? If you were ever in trouble, who would you call first? I want you to know — I would always come running. Always." },
    ],
  },
  aesopfables: {
    id: "aesopfables",
    title: "Aesop's Fables",
    author: "Aesop",
    emoji: "🦁",
    spineColor: "#6B4C11",
    tier: 1,
    ageRange: "Ages 4–5",
    readingLevel: "Grade K–1",
    tagline: "Tiny tales of talking animals — each with a lesson worth remembering.",
    coverUrl: "",
    gutenbergUrl: "https://www.gutenberg.org/ebooks/11339",
    standardEbooksUrl: "",
    pages: [
      { leftEmoji: "🦁🐭🌿", leftChapter: "Aesop's Fables", leftBody: "Long, long ago a storyteller named Aesop told tales of animals who talked and thought and learned lessons — lessons that are just as true today as they were thousands of years ago.", rightTitle: "Aesop's Fables", rightTitleSub: "retold from Aesop", rightBody: "Each little story ends with a lesson called a moral. Can you guess the lesson before you reach the end? Let's find out!", rightIsTitle: true, cue: "What is your favorite animal?", nanaPrompt: "Before we start — what is your favorite animal and why? Tell me and I will tell you mine. If that animal could talk, what do you think it would say?" },
      { leftEmoji: "🐢🐇🏁", leftChapter: "The Tortoise and the Hare", leftBody: "A fast hare laughed at a slow tortoise. 'You are so slow!' said the hare. 'I could beat you in a race a hundred times over!' The tortoise smiled quietly. 'Shall we find out?' he said.", rightTitle: null, rightTitleSub: null, rightBody: "The hare ran ahead — so far ahead that he decided to take a nap. He was sure he could win even if he slept a while. But the tortoise kept going, one slow step at a time. And when the hare woke up — the tortoise had won.", rightIsTitle: false, cue: "Are you more like the tortoise or the hare?", nanaPrompt: "Are you more like the tortoise or the hare? I will tell you which one I was as a child — and which one I try to be now. Can you think of something where slow and steady is the best way?" },
      { leftEmoji: "🐺🐑😱", leftChapter: "The Boy Who Cried Wolf", leftBody: "A shepherd boy was bored watching his sheep on the hill. 'Wolf! Wolf!' he shouted — even though there was no wolf. The villagers ran up to help — and found no wolf at all. The boy laughed.", rightTitle: null, rightTitleSub: null, rightBody: "The next day he cried wolf again — still no wolf. The villagers were angry. Then one day a real wolf came! He cried wolf with all his might — but nobody came. They did not believe him anymore.", rightIsTitle: false, cue: "Why is it so important to tell the truth?", nanaPrompt: "Why is it so important always to tell the truth? Have you ever told a small fib that caused a problem later? I will tell you about a time honesty was hard for me — but made everything better." },
      { leftEmoji: "🦁🐭🕸️", leftChapter: "The Lion and the Mouse", leftBody: "A tiny mouse accidentally woke a sleeping lion. The lion caught the mouse in his great paw. 'Please spare me!' squeaked the mouse. 'One day I might help you!' The lion laughed — but let the mouse go.", rightTitle: null, rightTitleSub: null, rightBody: "Later, the lion was caught in a hunter's net. He roared and struggled but could not get free. Then he heard a tiny voice. The little mouse gnawed through the ropes — and set the lion free.", rightIsTitle: false, cue: "Has someone small ever helped you in a big way?", nanaPrompt: "Has someone younger or smaller than you ever helped you in a big way? I want to tell you about a time someone unexpected helped me. Everyone has something to give — no matter their size." },
      { leftEmoji: "🦅🦊🍶", leftChapter: "The Fox and the Crow", leftBody: "A crow found a piece of cheese and sat in a tree to eat it. A clever fox came along. 'Oh Crow,' said the fox sweetly, 'you are so beautiful! Your voice must be the most wonderful thing!'", rightTitle: null, rightTitleSub: null, rightBody: "The crow was so flattered that she opened her beak to sing — and the cheese fell right into the fox's waiting mouth. 'Thank you!' called the fox, trotting away. Do not trust flattery.", rightIsTitle: false, cue: "Has anyone ever used nice words to get something from you?", nanaPrompt: "Has anyone ever said something very nice to you to get something from you? Here is something important: if someone is ONLY being nice to get something, that is not true kindness." },
      { leftEmoji: "🍇🦊😤", leftChapter: "The Fox and the Grapes", leftBody: "A hungry fox saw beautiful grapes hanging high on a vine. He jumped and jumped — but could not reach them. He tried and tried until he was exhausted. Then he walked away.", rightTitle: null, rightTitleSub: null, rightBody: "'Those grapes were probably sour anyway,' said the fox with a sniff. But we know the truth — he wanted those grapes very much. It is easy to say we do not want something we cannot have.", rightIsTitle: false, cue: "Have you ever pretended you didn't want something?", nanaPrompt: "Have you ever pretended you didn't want something because you couldn't have it? It is okay — we all do it sometimes. What is one thing you really want but have to wait for?" },
      { leftEmoji: "🌬️☀️🧥", leftChapter: "The Wind and the Sun", leftBody: "The wind and the sun argued about who was stronger. They saw a traveller wearing a coat. 'Whoever can make that man take off his coat is the strongest,' they agreed.", rightTitle: null, rightTitleSub: null, rightBody: "The wind blew as hard as he could — but the man pulled his coat tighter! Then the sun shone warmly and gently. The man got warmer and warmer — and took off his coat himself. Kindness is more powerful than force.", rightIsTitle: false, cue: "Is it better to be warm and kind or strong and forceful?", nanaPrompt: "Can you think of a time when being gentle worked better than being pushy? How do you like to be treated when you are upset? I will tell you about a time kindness worked better than anything else." },
    ],
  },
  mothergoose: {
    id: "mothergoose",
    title: "The Real Mother Goose",
    author: "Traditional",
    emoji: "🪿",
    spineColor: "#2E6B9E",
    tier: 1,
    ageRange: "Ages 4–5",
    readingLevel: "Grade K–1",
    tagline: "The classic nursery rhymes children have loved for hundreds of years.",
    coverUrl: "",
    gutenbergUrl: "",
    standardEbooksUrl: "",
    pages: [
      { leftEmoji: "🪿📖✨", leftChapter: "The Real Mother Goose", leftBody: "For hundreds of years, children have laughed and clapped and stomped their feet to these rhymes. Some are silly. Some are sweet. Some are strange. But all of them are wonderful.", rightTitle: "The Real Mother Goose", rightTitleSub: "Traditional nursery rhymes", rightBody: "Nana probably knows every single one of these rhymes by heart. Ask her — she might even remember the tune! Let's read them together.", rightIsTitle: true, cue: "Does Nana know any of these rhymes?", nanaPrompt: "Before we start — I want to tell you the nursery rhyme I loved most when I was your age. I am going to recite it for you. Which one is your favorite — and do you know it by heart?" },
      { leftEmoji: "🥚🧱💥", leftChapter: "Humpty Dumpty", leftBody: "Humpty Dumpty sat on a wall. Humpty Dumpty had a great fall. All the king's horses and all the king's men couldn't put Humpty together again.", rightTitle: null, rightTitleSub: null, rightBody: "Nobody knows for sure what Humpty Dumpty really was — some people think he was an egg! But the lesson might be: some things, once broken, cannot be fixed. It is better to be careful.", rightIsTitle: false, cue: "Have you ever had something that broke and couldn't be fixed?", nanaPrompt: "Have you ever had something break that couldn't be fixed? How did that feel? I lost something precious once — I will tell you about it and what I learned." },
      { leftEmoji: "👦💧⛰️", leftChapter: "Jack and Jill", leftBody: "Jack and Jill went up the hill to fetch a pail of water. Jack fell down and broke his crown — and Jill came tumbling after.", rightTitle: null, rightTitleSub: null, rightBody: "Poor Jack and Jill! But they went together — and that is something. It is always better to do hard things with a friend or someone you love beside you.", rightIsTitle: false, cue: "Who do you like to do things with?", nanaPrompt: "Have you ever had a tumble and kept going anyway? I had a fall when I was little that I still remember. What do you do when something goes wrong — do you get back up?" },
      { leftEmoji: "🐑🌿👦", leftChapter: "Mary Had a Little Lamb", leftBody: "Mary had a little lamb, its fleece was white as snow. And everywhere that Mary went, the lamb was sure to go. It followed her to school one day — which was against the rule.", rightTitle: null, rightTitleSub: null, rightBody: "The lamb loved Mary so much it would follow her anywhere. Ask your grandchild: what is something — or someone — that follows YOU everywhere? A toy? A pet? A little brother or sister?", rightIsTitle: false, cue: "Does anything or anyone follow you around?", nanaPrompt: "What or who follows you around? I had a pet when I was little that I took everywhere. If you had a pet lamb, what would you name it?" },
      { leftEmoji: "⭐🌙🌟", leftChapter: "Twinkle Twinkle Little Star", leftBody: "Twinkle twinkle little star, how I wonder what you are. Up above the world so high, like a diamond in the sky. Twinkle twinkle little star, how I wonder what you are.", rightTitle: null, rightTitleSub: null, rightBody: "Stars have made people wonder since the very beginning of time. Nana has looked at the same stars you look at — when she was exactly your age, under the same sky.", rightIsTitle: false, cue: "Have you ever watched the stars?", nanaPrompt: "Tell me about a time you watched the stars at night. Where were you? Have you ever seen a shooting star and made a wish? What did you wish for? I will tell you what I would wish for." },
      { leftEmoji: "🕯️🏃‍♂️🕯️", leftChapter: "Jack Be Nimble", leftBody: "Jack be nimble, Jack be quick! Jack jump over the candlestick!", rightTitle: null, rightTitleSub: null, rightBody: "That's the whole rhyme — quick as a jump! Some things are better fast. Can you jump like Jack? Stand up and try! Jump as high as you can.", rightIsTitle: false, cue: "Can you jump as high as Jack?", nanaPrompt: "Jump with me if you can — even on video! What are you really quick at? What is something you are good at that surprises people?" },
      { leftEmoji: "🌙🐮🐱🍽️", leftChapter: "Hey Diddle Diddle", leftBody: "Hey diddle diddle, the cat and the fiddle! The cow jumped over the moon. The little dog laughed to see such sport — and the dish ran away with the spoon!", rightTitle: null, rightTitleSub: null, rightBody: "Nonsense! Pure wonderful nonsense. A cow jumping over the moon. A dish running away with a spoon. Sometimes the silliest things are the most delightful.", rightIsTitle: false, cue: "Can you make up your own silly rhyme?", nanaPrompt: "Let's make up a silly rhyme together right now! You say one line and I will say the next. It does not have to make sense — the sillier the better!" },
    ],
  },
  aapplepie: {
    id: "aapplepie",
    title: "A Apple Pie",
    author: "Kate Greenaway",
    emoji: "🍎",
    spineColor: "#8B0000",
    tier: 1,
    ageRange: "Ages 4–5",
    readingLevel: "Grade K–1",
    tagline: "An old-fashioned alphabet book about one wonderful apple pie.",
    coverUrl: "",
    gutenbergUrl: "",
    standardEbooksUrl: "",
    pages: [
      { leftEmoji: "🍎🥧✨", leftChapter: "A Apple Pie", leftBody: "A, B, C, D, E, F, G — this book goes all the way through the alphabet following one wonderful apple pie and all the children who wanted a piece of it.", rightTitle: "A Apple Pie", rightTitleSub: "by Kate Greenaway", rightBody: "Kate Greenaway drew the most beautiful pictures of children in the 1880s. This alphabet book has been delighting little ones for over a hundred years.", rightIsTitle: true, cue: "Can you sing the alphabet?", nanaPrompt: "Before we start — do you like apple pie? What is your favorite kind of pie or dessert? I will tell you mine from when I was your age." },
      { leftEmoji: "🅰️🍎🥧", leftChapter: "A · B · C · D", leftBody: "A was an apple pie. B bit it. C cut it. D dealt it.", rightTitle: null, rightTitleSub: null, rightBody: "Every letter wants a piece of the wonderful apple pie! B takes a big bite. C cuts it carefully. D deals out the slices. Who will get the biggest piece?", rightIsTitle: false, cue: "What letter does your name start with?", nanaPrompt: "What would you do with the apple pie if it were yours — bite it, share it, or hide it? I will tell you about my favorite dessert from when I was little." },
      { leftEmoji: "🅴🅵🅶🅷", leftChapter: "E · F · G · H", leftBody: "E ate it. F fought for it. G got it. H had it.", rightTitle: null, rightTitleSub: null, rightBody: "Everyone wants the apple pie! E gobbles it right up. F fights to get more. G grabs a piece. H holds it tight. The pie is getting smaller and smaller!", rightIsTitle: false, cue: "Have you ever fought over the last piece of something yummy?", nanaPrompt: "Have you ever really wanted something that someone else had? What happened? I will tell you about a time I had to share something I really wanted to keep." },
      { leftEmoji: "🅸🅹🅺🅻", leftChapter: "I · J · K · L", leftBody: "I inspected it. J joined in. K kept it. L longed for it.", rightTitle: null, rightTitleSub: null, rightBody: "I looks very carefully at every slice. J jumps in to get a piece. K keeps their slice safe. And poor L can only look and wish and long for a taste.", rightIsTitle: false, cue: "Have you ever wanted something you couldn't have?", nanaPrompt: "Have you ever wanted something really badly and had to wait? Was the waiting hard? I will tell you about something I wanted when I was your age and had to be patient for. Did I ever get it? Listen and find out!" },
      { leftEmoji: "🅼🅽🅾🅿️", leftChapter: "M · N · O · P", leftBody: "M mourned for it. N nodded at it. O opened it. P peeped in it.", rightTitle: null, rightTitleSub: null, rightBody: "M is sad because the pie is almost gone. N nods wisely. O opens up what's left. P peeks inside to see what's there. Almost every last crumb has been eaten!", rightIsTitle: false, cue: "What is your favorite letter and why?", nanaPrompt: "What letter does your name start with — and what would that letter do with the pie? Let's make up a silly action for your letter together!" },
      { leftEmoji: "🆀🆁🆂🆃", leftChapter: "Q · R · S · T", leftBody: "Q quartered it. R ran for it. S sang for it. T took it.", rightTitle: null, rightTitleSub: null, rightBody: "Q cuts what's left into quarters — every last crumb! R races to get some. S sings sweetly hoping for a taste. And T simply takes the last piece without asking.", rightIsTitle: false, cue: "Is it polite to just take things without asking?", nanaPrompt: "Q quarters it — that means cutting it into four pieces. If you were sharing a pie with four people you love, who would you invite? I will tell you who I would invite." },
      { leftEmoji: "🆄🆅🆆🆇🆈🆉", leftChapter: "U · V · W · X · Y · Z", leftBody: "U upset it. V viewed it. W wanted it. X, Y, Z and ampersand — all wished for a piece of the apple pie. But it was all gone!", rightTitle: null, rightTitleSub: null, rightBody: "From A to Z — every letter wanted a piece! But the pie is gone. All that is left are crumbs and happy memories. The best things are always worth sharing.", rightIsTitle: false, cue: "What would YOUR magical apple pie taste like?", nanaPrompt: "Every single letter wanted a piece! If you could share something wonderful with everyone in the world — not just pie — what would you choose to give?" },
    ],
  },
  jemimapuddleduck: {
    id: "jemimapuddleduck",
    title: "The Tale of Jemima Puddle-Duck",
    author: "Beatrix Potter",
    emoji: "🦆",
    spineColor: "#4B7A6C",
    tier: 1,
    ageRange: "Ages 4–5",
    readingLevel: "Grade K–1",
    tagline: "A determined duck sets out to hatch her own eggs — and meets a most polite stranger.",
    coverUrl: "",
    gutenbergUrl: "https://www.gutenberg.org/ebooks/14814",
    standardEbooksUrl: "",
    pages: [
      { leftEmoji: "🦆🥚🌾", leftChapter: "The Tale of Jemima Puddle-Duck", leftBody: "Jemima Puddle-Duck was a very determined duck. She wanted nothing more than to hatch her own eggs — but the farmer's wife kept taking them away to put under a hen.", rightTitle: "The Tale of Jemima Puddle-Duck", rightTitleSub: "by Beatrix Potter", rightBody: "Jemima was tired of being told what to do. She decided to fly away and find a secret place to lay her eggs — all by herself. It was a very bold plan.", rightIsTitle: true, cue: "Have you ever wanted to do something all by yourself?", nanaPrompt: "Before we start — have you ever really wanted to do something all by yourself, without any help? I will tell you about something I was determined to do alone when I was little. Did I manage it? Listen and find out!" },
      { leftEmoji: "🦆🌲🪺", leftChapter: "Jemima Flies Away", leftBody: "Jemima put on her best bonnet and shawl and flew away over the fields. She had never flown far before! She landed in a wood and looked about for a nice dry nesting place.", rightTitle: null, rightTitleSub: null, rightBody: "The wood was very beautiful. Tall trees. Soft moss. Patches of sunlight. Jemima waddled about looking for just the right spot. She was very pleased with herself for being so adventurous.", rightIsTitle: false, cue: "If you could fly, where would you go?", nanaPrompt: "Have you ever wandered somewhere you weren't supposed to go? I went exploring once when I was little — I will tell you where I ended up!" },
      { leftEmoji: "🦊🎩😊", leftChapter: "The Polite Gentleman", leftBody: "In the wood she met a very polite gentleman with sandy-colored whiskers and a black tail. He bowed deeply. 'What are you looking for?' he asked most kindly. Jemima told him everything.", rightTitle: null, rightTitleSub: null, rightBody: "The gentleman was so very helpful! He showed Jemima a lovely wood shed full of feathers and offered it as a nesting place. Jemima was delighted. What a wonderful new friend!", rightIsTitle: false, cue: "Should you trust someone just because they are polite?", nanaPrompt: "Do you think Jemima should trust this stranger? What makes someone truly trustworthy? Here is something important: polite is nice — but trust is something you earn over time. Who do you really trust — and why?" },
      { leftEmoji: "🥚🥚🥚🦊", leftChapter: "The Nest", leftBody: "Jemima laid her eggs in the shed and felt very proud. She visited every day. The gentleman always made her feel so welcome — but he kept asking strange questions about herbs and onions.", rightTitle: null, rightTitleSub: null, rightBody: "Jemima began to feel a little uneasy — but she could not quite say why. She did not know that the gentleman was a fox, and that he was planning a very nasty dinner indeed.", rightIsTitle: false, cue: "Have you ever had a funny feeling that something was wrong?", nanaPrompt: "Have you ever kept a secret that turned out to be harder than you expected? I kept a secret when I was little — I will tell you whether it was a good secret or a worrying one." },
      { leftEmoji: "🐕🐕💨🦊", leftChapter: "The Rescue", leftBody: "A collie dog named Kep saw what was happening. He and two fox hound puppies came running! They chased the fox away — and Jemima was saved. She was very shaken but unharmed.", rightTitle: null, rightTitleSub: null, rightBody: "Jemima was very grateful to Kep. She had nearly come to a terrible end because she trusted a stranger too quickly. Sometimes the ones who help you most are the friends you already have.", rightIsTitle: false, cue: "Who came to Jemima's rescue?", nanaPrompt: "Has anyone ever helped you when you really needed it? I want to tell you about a time someone came to my rescue. The people who love you will always run to help — just like Kep ran for Jemima." },
      { leftEmoji: "🦆🥚💔", leftChapter: "The End of the Story", leftBody: "Sadly, the puppies also got to the eggs before Jemima did. Only four eggs were saved. Jemima hatched them herself at last — though she was never a very good judge of character.", rightTitle: null, rightTitleSub: null, rightBody: "Jemima sat on her four little eggs and hatched them all. She was very proud. And she learned — slowly — to be a little more careful about who she trusted with her most precious things.", rightIsTitle: false, cue: "What did Jemima learn?", nanaPrompt: "What do you think Jemima learned? What is the most precious thing you have — something you would want to protect? I will tell you what MY most precious thing was at your age." },
    ],
  },
  tiggy: {
    id: "tiggy",
    title: "The Tale of Mrs. Tiggy-Winkle",
    author: "Beatrix Potter",
    emoji: "🦔",
    spineColor: "#7B6D4A",
    tier: 1,
    ageRange: "Ages 4–5",
    readingLevel: "Grade K–1",
    tagline: "A little girl finds a magical washerwoman hedgehog living inside a hill.",
    coverUrl: "",
    gutenbergUrl: "https://www.gutenberg.org/ebooks/15077",
    standardEbooksUrl: "",
    pages: [
      { leftEmoji: "🦔🧺👗", leftChapter: "The Tale of Mrs. Tiggy-Winkle", leftBody: "Little Lucie lived on a farm in the hills. One day she lost her handkerchiefs — and her pinafore too! She looked everywhere but could not find them at all.", rightTitle: "The Tale of Mrs. Tiggy-Winkle", rightTitleSub: "by Beatrix Potter", rightBody: "Lucie climbed up the hillside looking for her things. She found a little door in a hillside — and inside was the most extraordinary laundry she had ever seen.", rightIsTitle: true, cue: "Have you ever lost something important?", nanaPrompt: "Before we start — have you ever lost something that really mattered to you? Did you find it? I lost something when I was little — I will tell you whether I ever found it." },
      { leftEmoji: "🚪⛰️✨", leftChapter: "The Little Door", leftBody: "Behind the little door in the hillside, Lucie found a small, warm, steamy kitchen. Sitting at an ironing board was the most interesting person she had ever met.", rightTitle: null, rightTitleSub: null, rightBody: "The little woman was very round and very small. She wore a striped petticoat and a cap. And she was covered — all over — in prickles. She was a hedgehog!", rightIsTitle: false, cue: "Have you ever found something surprising behind a door?", nanaPrompt: "Have you ever discovered something surprising or magical when you weren't expecting it? I found something wonderful completely by accident once — I will tell you about it." },
      { leftEmoji: "🦔👩‍🍳🧺", leftChapter: "Mrs. Tiggy-Winkle", leftBody: "'My name is Mrs. Tiggy-Winkle,' said the hedgehog, bobbing a curtsy. 'And I am a washerwoman!' Her little kitchen was full of freshly ironed things — Peter Rabbit's jacket, Sally Henny-Penny's cloak, and more.", rightTitle: null, rightTitleSub: null, rightBody: "Mrs. Tiggy-Winkle worked so hard! Washing and ironing all day long. She smoothed and folded and pressed. And everything she touched came out perfectly clean and perfectly flat.", rightIsTitle: false, cue: "What chores do you help with at home?", nanaPrompt: "What chores do you help with at home? I will tell you about the chores I had to do as a child — did I like any of them? I will tell you! And I want you to know — helping your family matters more than you might think." },
      { leftEmoji: "👗🧺🔍", leftChapter: "Lucie's Things", leftBody: "And there among the laundry were Lucie's very own handkerchiefs — and her pinafore too! They were freshly washed and beautifully ironed, folded in a neat pile.", rightTitle: null, rightTitleSub: null, rightBody: "'Oh Mrs. Tiggy-Winkle!' cried Lucie. 'However did you find them?' Mrs. Tiggy-Winkle smiled and handed them over with a little bob. Everything was clean and good as new.", rightIsTitle: false, cue: "Have you ever had someone do something kind for you that you didn't expect?", nanaPrompt: "Has anyone ever done something really kind for you that you didn't expect? I want to tell you about a time someone surprised me with an act of kindness. How did it feel?" },
      { leftEmoji: "🌅🦔💨", leftChapter: "The Walk Home", leftBody: "Mrs. Tiggy-Winkle walked down the hill with Lucie, carrying the clean laundry. The sun was setting over the fields. Lucie held her handkerchiefs tight.", rightTitle: null, rightTitleSub: null, rightBody: "Then Lucie turned around — and Mrs. Tiggy-Winkle was gone! Running back up the hill was a small brown hedgehog, without any cap or apron. Had it all been a dream?", rightIsTitle: false, cue: "Do you think it was real or a dream?", nanaPrompt: "Do you think Mrs. Tiggy-Winkle was real or just a dream? I will tell you something magical I believed in completely when I was your age. Did I ever stop believing — and how did that feel?" },
      { leftEmoji: "🦔❤️🌿", leftChapter: "A Wonderful Friend", leftBody: "Real or not, Mrs. Tiggy-Winkle had been a wonderful friend. She had cared for things that mattered to someone else — and done it with love and kindness.", rightTitle: null, rightTitleSub: null, rightBody: "The best helpers in the world are like Mrs. Tiggy-Winkle — they notice what needs to be done, and they do it quietly and well. Is there someone in your life like that?", rightIsTitle: false, cue: "Who is someone who takes care of things for you?", nanaPrompt: "If you could have a magical friend like Mrs. Tiggy-Winkle — someone who could fix any problem — what problem would you ask them to solve? I will tell you what I would have asked for when I was little." },
    ],
  },
  littleengine: {
    id: 'littleengine',
    title: 'The Little Engine That Could',
    author: 'Watty Piper',
    emoji: '🚂',
    spineColor: '#1a5fa8',
    tier: 1,
    ageRange: 'Ages 4–6',
    readingLevel: 'Grade K–1',
    tagline: 'A little blue engine faces a big mountain — and finds the courage to try.',
    coverUrl: '',
    gutenbergUrl: '',
    standardEbooksUrl: '',
    pages: [
      { leftEmoji: '🚂🎪🧸', leftChapter: 'The Little Engine That Could', leftBody: 'Chug, chug, chug. Puff, puff, puff. Ding-dong, ding-dong. The little train rumbled over the tracks. She was a happy little train for she had such a jolly load to carry.', rightTitle: 'The Little Engine That Could', rightTitleSub: 'retold by Watty Piper · 1930', rightBody: 'Her cars were filled with good things for boys and girls — toy animals, dolls, a gay little clown, and all sorts of good things to eat. She was carrying them to the children on the other side of the mountain.', rightIsTitle: true, cue: 'What do you think is in the train cars?', nanaPrompt: 'Before we start — I want to tell you about a toy I loved when I was your age. What is YOUR favorite toy right now?' },
      { leftEmoji: '😟🛑💔', leftChapter: 'She Could Not Go', leftBody: 'Then all of a sudden she stopped with a jerk. She simply could not go another inch. She tried and she tried, but her wheels would not turn.', rightTitle: null, rightTitleSub: null, rightBody: 'What were all those good little boys and girls on the other side of the mountain going to do without the jolly toys to play with and the wholesome food to eat?', rightIsTitle: false, cue: 'Oh no! What should they do?', nanaPrompt: 'Have you ever tried really hard at something and got stuck? What did you do? I will tell you about a time that happened to me.' },
      { leftEmoji: '🚄✨😤', leftChapter: 'The Shiny New Engine', leftBody: '"Please, Shiny New Engine, do carry our train over the mountain!" cried all the dolls and toys. But the Shiny New Engine snorted: "I pull you? I am a Passenger Engine. Indeed not!"', rightTitle: null, rightTitleSub: null, rightBody: 'And off he steamed to the roundhouse, where engines live when they are not busy. How sad the little train and all the dolls and toys felt!', rightIsTitle: false, cue: 'Was that nice of the big engine?', nanaPrompt: 'Have you ever asked someone for help and they said no? How did that feel? I will tell you what I think real kindness looks like.' },
      { leftEmoji: '🚂💨😔', leftChapter: 'The Old Engine', leftBody: '"Please, Kind Engine, do pull our train over the mountain," cried all the dolls and toys. But the rusty old engine sighed: "I am so tired. I can not. I can not. I can not."', rightTitle: null, rightTitleSub: null, rightBody: 'And off he rumbled to the roundhouse, chugging sadly. "I can not. I can not. I can not." Then the little train was very, very sad, and the dolls and toys were ready to cry.', rightIsTitle: false, cue: 'Can you say it like the old engine? "I can not. I can not."', nanaPrompt: 'Has anyone ever counted on YOU for something important? What did you do? I am going to tell you about a time someone needed me and I had to decide whether to help.' },
      { leftEmoji: '🔵🚂💭', leftChapter: 'The Little Blue Engine', leftBody: 'Then the little clown called out: "Here is another engine coming — a little blue engine, a very little one — but perhaps she will help us!"', rightTitle: null, rightTitleSub: null, rightBody: '"I am not very big," said the Little Blue Engine. "They use me only for switching in the yard. I have never been over the mountain." She looked up and saw the tears in the doll\'s eyes.', rightIsTitle: false, cue: 'What do you think the Little Blue Engine will do?', nanaPrompt: 'Have you ever done something brave even though you were not sure you could do it? Tell me about it! I will tell you about the bravest thing I ever did.' },
      { leftEmoji: '💪🔵🏔️', leftChapter: 'I Think I Can', leftBody: 'Then the Little Blue Engine said: "I think I can. I think I can. I think I can." And she hitched herself to the little train. She tugged and pulled and pulled and tugged.', rightTitle: null, rightTitleSub: null, rightBody: 'Puff, puff, chug, chug, went the little blue engine. "I think I can — I think I can — I think I can." Up, up, up. Faster and faster the little engine climbed until at last they reached the top of the mountain!', rightIsTitle: false, cue: 'Say it with me! "I think I can! I think I can!"', nanaPrompt: 'Say it together three times — as loud as you can! "I think I can!" Now tell me — what is something YOU think you can do that is hard right now?' },
      { leftEmoji: '🏔️🎉🌇', leftChapter: 'I Thought I Could', leftBody: '"Hurrah, hurrah!" cried the gay little clown and all the dolls and toys. "The good little boys and girls in the city will be happy because you helped us, kind Little Blue Engine!"', rightTitle: null, rightTitleSub: null, rightBody: 'And the Little Blue Engine smiled and seemed to say as she puffed steadily down the mountain: "I thought I could. I thought I could. I thought I could."', rightIsTitle: false, cue: 'Say it with me! "I thought I could! I thought I could!"', nanaPrompt: 'Every time you try something hard — even if it takes a while — I want you to remember the Little Blue Engine. And I want you to know: I think YOU can do anything you set your mind to. I really do.' },
    ],
  },
  dickandjane: {
    id: 'dickandjane',
    title: 'Dick and Jane',
    author: 'William S. Gray & Zerna Sharp',
    emoji: '👧👦🐶',
    spineColor: '#c8392b',
    tier: 1,
    ageRange: 'Ages 4–6',
    readingLevel: 'Grade K–1',
    tagline: 'The classic first reader that taught a generation of Americans to read.',
    coverUrl: '',
    gutenbergUrl: '',
    standardEbooksUrl: '',
    pages: [
      { leftEmoji: '👧👦🏡', leftChapter: 'Dick and Jane', leftBody: 'See Dick. See Jane. See Dick and Jane. Funny, funny Dick and Jane.', rightTitle: 'Dick and Jane', rightTitleSub: 'from the Elson-Gray Basic Readers · 1930', rightBody: 'This is the book that taught millions of grandparents to read. The same words. The same Dick. The same Jane. Now you can read them together.', rightIsTitle: true, cue: 'Can you say the names? Dick. Jane.', nanaPrompt: 'I learned to read with Dick and Jane when I was your age. The very same words! How does it feel to read the same book I read when I was little?' },
      { leftEmoji: '🐶🏃💨', leftChapter: 'See Spot', leftBody: 'See Spot. See Spot run. Run, Spot, run! See Spot run and run.', rightTitle: null, rightTitleSub: null, rightBody: 'Dick said, "Run, Spot, run!" Jane said, "Run, run, run!" And Spot ran and ran and ran.', rightIsTitle: false, cue: 'Can you run in place like Spot?', nanaPrompt: 'Did you ever have a dog or a pet that liked to run? Tell me about it! If you could have any pet in the world, what would you choose?' },
      { leftEmoji: '⚽🎈😄', leftChapter: 'See the Ball', leftBody: 'See the ball. See Dick. Dick said, "See the ball. See the big ball." Jane said, "See the big red ball."', rightTitle: null, rightTitleSub: null, rightBody: 'Dick and Jane looked at the ball. It was a big, big ball. A big red ball. "Oh," said Jane. "Oh, oh, oh! It is a big red ball!"', rightIsTitle: false, cue: 'What is your favorite color ball?', nanaPrompt: 'When I was little I had a ball just like that. What games do you like to play outside? Tell me your very favorite outdoor game.' },
      { leftEmoji: '👧🐱💛', leftChapter: 'See Puff', leftBody: 'See Puff. See little Puff. Jane said, "Oh, oh. See little Puff. See little funny Puff."', rightTitle: null, rightTitleSub: null, rightBody: '"Come, Puff," said Jane. "Come, come, come." Puff looked at Jane. Puff came to Jane. "Oh, Puff," said Jane. "Little funny Puff."', rightIsTitle: false, cue: 'Can you say it like Jane? "Come, come, come!"', nanaPrompt: 'Have you ever called an animal and had it come to you? Tell me about it! What would you name a little yellow cat if you had one?' },
      { leftEmoji: '👨‍👩‍👧‍👦🏠❤️', leftChapter: 'See Mother', leftBody: 'See Mother. See Mother come. Dick said, "Come, Mother, come. See Dick. See Jane. See Spot and Puff."', rightTitle: null, rightTitleSub: null, rightBody: 'Mother came. She looked at Dick. She looked at Jane. She looked at Spot and Puff. "Oh, oh, oh," said Mother. "I see Dick. I see Jane. I see Spot and Puff."', rightIsTitle: false, cue: 'Who do you love to see come home?', nanaPrompt: 'Who is the person you love to see walk through the door most of all? I want you to know — you are always that person for me.' },
      { leftEmoji: '👨🌳😊', leftChapter: 'See Father', leftBody: 'See Father. See Father come. Jane said, "Come, Father, come. Come and see. Come and see Dick and Jane."', rightTitle: null, rightTitleSub: null, rightBody: '"Oh, oh," said Father. "I see Dick. I see Jane." Dick said, "See, Father. See Spot. See Spot run." Father laughed. "Funny, funny Spot," said Father.', rightIsTitle: false, cue: 'Can you laugh like Father? Ha! Ha! Ha!', nanaPrompt: 'I want to tell you something. When your mom or dad was little — just like you are right now — I used to laugh just like that with them. I love you just like Father loves Dick and Jane.' },
      { leftEmoji: '📖✨👶', leftChapter: 'You Can Read!', leftBody: 'See Dick. See Jane. See Spot. See Puff. See Father. See Mother. You read them all! You are a reader now.', rightTitle: null, rightTitleSub: null, rightBody: 'Dick and Jane taught millions of children to read — including your Nana. And now you have read them too. The very same words. The very same story. Across all those years.', rightIsTitle: false, cue: 'You did it! You read a whole book!', nanaPrompt: 'You just read the same book I read when I was your age. That makes my heart so happy I can hardly say it. You are a reader now. And I am so proud of you.' },
    ],
  },
  aubrees: {
    id: "aubrees",
    title: "There's a Mouse in Aubree's House!",
    author: "A NeverMiss Family Story",
    emoji: "🐭",
    spineColor: "#E48BB0",
    coverUrl: "/books/aubrees/cover.jpg",
    ageRange: "4–7",
    readingLevel: "Grade 1–2",
    lexile: "AD400L",
    tagline: "A messy room, a clever cat, and one very sneaky little mouse.",
    gutenbergUrl: "",
    standardEbooksUrl: "",
    // Image-page book — each page is a full illustrated spread from the
    // original picture book. The verse and artwork are baked together in
    // each JPG; the renderer uses imageUrl and ignores the text fields.
    pages: ([
      { src: "cover.jpg",  cue: "Ready to meet Aubree?",                                          nanaPrompt: "Ask: are you ready to read a book about a sweet girl and a sneaky little mouse?" },
      { src: "p1.jpg",     cue: "Is your room tidy or messy right now?",                          nanaPrompt: "Ask: is your room tidy or a little messy right now? Tell her about your room when YOU were little." },
      { src: "p2.jpg",     cue: "Plop, drop, flop — say it with me!",                             nanaPrompt: "Practice the sounds together — plop, drop, flop, FLOP. Big voice, small voice, silly voice!" },
      { src: "p3.jpg",     cue: "Have you ever lost something in a messy pile?",                  nanaPrompt: "Ask: have you ever lost a toy in a pile of clothes? What was it?" },
      { src: "p4.jpg",     cue: "What do cats love to jump on?",                                  nanaPrompt: "Ask: have you ever seen a cat get into a pile of clothes? What do cats love to do?" },
      { src: "p5.jpg",     cue: "Where would you hide if you were a mouse?",                      nanaPrompt: "Ask: if YOU were a tiny mouse in this room, where would you hide?" },
      { src: "p6.jpg",     cue: "A mouse from the skies — what a surprise!",                      nanaPrompt: "Big surprised face together! Ask: where did the mouse come from? Was he hiding up high?" },
      { src: "p7.jpg",     cue: "Why is the mouse so quiet?",                                     nanaPrompt: "Ask: have you ever had to be super-quiet so no one would find you? What were you doing?" },
      { src: "p8.jpg",     cue: "If you were the mouse, where would you hide?",                   nanaPrompt: "Ask: that mouse dove deep into the clothes! Where would YOU pick to hide?" },
      { src: "p9.jpg",     cue: "Where would you look first?",                                    nanaPrompt: "Ask: if you were hunting for the mouse, where would you check first?" },
      { src: "p10.jpg",    cue: "Have you ever lost something and never found it?",               nanaPrompt: "Tell her about a time YOU lost something and could never find it. Ask if that's ever happened to her." },
      { src: "p11.jpg",    cue: "What snack would the mouse pick at your house?",                 nanaPrompt: "Ask: if a sneaky mouse visited YOUR kitchen, what snack would he grab?" },
      { src: "p12.jpg",    cue: "Sniff sniff sniff — what's the mouse doing?",                    nanaPrompt: "Make the sniff and lick sounds together! Ask: what do you think the mouse is licking?" },
      { src: "p13.jpg",    cue: "Have you ever cleaned your room and felt proud?",                nanaPrompt: "Ask: when you finish cleaning, how does it feel? Tell her about a clean-up YOU did as a kid." },
      { src: "p14.jpg",    cue: "Sebastian is purring — why?",                                    nanaPrompt: "Ask: why is the cat so happy now? What changed?" },
      { src: "p15.jpg",    cue: "Why is Aubree smiling so big?",                                  nanaPrompt: "Ask: why is Aubree happy? How does a clean room make YOU feel?" },
      { src: "p16.jpg",    cue: "What's the rule about messy rooms?",                             nanaPrompt: "Recite together: 'Clean your room — don't delay… or a mouse might come in and stay!'" },
      { src: "moral.jpg",  cue: "What's the moral of the story?",                                 nanaPrompt: "Ask: what did Aubree learn? What do YOU think the moral is in your own words?" },
      { src: "end.jpg",    cue: "The end!",                                                       nanaPrompt: "Ask: did you like the story? What was your favourite part?" },
    ] as Array<{ src: string; cue: string; nanaPrompt: string }>).map(({ src, cue, nanaPrompt }) => ({
      leftEmoji: "",
      leftChapter: "",
      leftBody: "",
      rightTitle: null,
      rightTitleSub: null,
      rightBody: "",
      rightIsTitle: false,
      cue,
      nanaPrompt,
      imageUrl: `/books/aubrees/${src}`,
    })),
  },
  blackbeauty: chapterBook(
    {
      id: "blackbeauty",
      title: "Black Beauty",
      author: "Anna Sewell",
      emoji: "🐴",
      spineColor: "#1F1A17",
      coverUrl: "",
      ageRange: "8–12",
      readingLevel: "Grade 5–7",
      lexile: "1010L",
      tagline: "A gentle horse tells his own story — from a sunny meadow childhood to the hard streets of London, and home again at last.",
      gutenbergUrl: "https://www.gutenberg.org/ebooks/271",
      standardEbooksUrl: "https://standardebooks.org/ebooks/anna-sewell/black-beauty",
      tier: 1,
    },
    [
      {
        id: "ch1-early-home",
        title: "Chapter 1 · My Early Home",
        summary: "A young horse remembers the meadow where he was born, the wise advice of his mother, and the day he first learned that the world is not always kind.",
        question: "What was the most important thing Beauty's mother taught him?",
        teaser: "Coming up: a wild chase through the meadow, and a day Beauty never forgets.",
        pages: [
          { leftEmoji: "🐴", leftChapter: "Chapter 1 · My Early Home", leftBody: "The first place I remember was a wide green meadow with a clear pond at one end. Tall trees leaned over the water, and reeds grew where it was deepest. I lived there happily with my mother.", rightTitle: "Black Beauty", rightTitleSub: "by Anna Sewell", rightBody: "A gentle horse tells his own story — from a sunny meadow childhood to the hard streets of London, and home again at last.", rightIsTitle: true, cue: "Can you picture the meadow?", nanaPrompt: "Ask Perry to close her eyes and imagine it. What color is the grass? What does the air smell like?" },
          { leftEmoji: "🐴", leftChapter: "Chapter 1 · My Early Home", leftBody: "I drank my mother's milk when I was small. By day I trotted at her side. At night I slept close beside her. We had a warm shed for cold weather, and the trees made shade when the sun was hot.", rightTitle: null, rightTitleSub: null, rightBody: "Six other young horses lived in the meadow with us. They were older and bigger than I was. We were a little herd of friends, even when we played a bit rough.", rightIsTitle: false, cue: "Six big horses to play with!", nanaPrompt: "Ask Perry: who do you love playing with most? What's your favorite game together?" },
          { leftEmoji: "🐎", leftChapter: "Chapter 1 · My Early Home", leftBody: "We galloped together round and round the field, as fast as we could go. The play was sometimes rough — biting and kicking, even though no one meant any harm. We were only learning.", rightTitle: null, rightTitleSub: null, rightBody: "One afternoon, after a wild gallop, my mother called me over with a soft whinny. 'I would like you to listen carefully,' she said. 'I have something important to tell you.'", rightIsTitle: false, cue: "What's she going to say?", nanaPrompt: "Lean in like a secret is coming. Ask: what does your mom say when she really needs you to listen?" },
          { leftEmoji: "💗", leftChapter: "Chapter 1 · My Early Home", leftBody: "'The colts here are good,' said my mother, 'but they are cart-horse colts, and they have never been taught manners. You come from a fine family. Your grandfather was a famous racing horse.'", rightTitle: null, rightTitleSub: null, rightBody: "'Your grandmother had the sweetest temper of any horse I ever knew. You have never seen me bite or kick. I want you to grow up gentle and good, and never to learn any bad ways.'", rightIsTitle: false, cue: "What does 'gentle and good' mean?", nanaPrompt: "Ask Perry: when your mom or dad teaches you something important, what do they say? Share one of your own family lessons." },
          { leftEmoji: "🌾", leftChapter: "Chapter 1 · My Early Home", leftBody: "'Lift your feet up nicely when you trot. Do your work well. Never bite or kick — not even in fun.' I never forgot what she told me that day. My mother was wise, and I tried very hard to listen.", rightTitle: null, rightTitleSub: null, rightBody: "Our master was a kind man with gentle hands. He gave us good food and warm shelter, and he spoke to us as softly as he did to his own little children. We all loved him very much.", rightIsTitle: false, cue: "What makes a good master?", nanaPrompt: "Ask Perry: how do you know when someone is being kind to you? What do they do or say?" },
          { leftEmoji: "🦊", leftChapter: "Chapter 1 · My Early Home", leftBody: "One bright morning I heard a strange sound — first far away, then louder. It was the horn of a hunt. The other colts pricked up their ears. 'The hounds are coming!' the eldest cried, and galloped to the hedge.", rightTitle: null, rightTitleSub: null, rightBody: "We all followed and peered over the fence. In the next field we saw riders in bright red coats, and a pack of dogs running fast — noses to the ground, men galloping close behind.", rightIsTitle: false, cue: "What are they chasing?", nanaPrompt: "Ask Perry: have you ever heard dogs barking far away? What did it sound like?" },
          { leftEmoji: "😨", leftChapter: "Chapter 1 · My Early Home", leftBody: "Suddenly a frightened hare darted across our meadow. The hounds and riders crashed in after her. Then I saw a young rider's horse stumble at the brook and fall. The rider was thrown to the ground and lay very still.", rightTitle: null, rightTitleSub: null, rightBody: "He was a tall young man — much loved in our country. There was shouting and crying all around. I could not bear to look any longer, so I turned my head away and pressed close to my mother's side.", rightIsTitle: false, cue: "Is he hurt very badly?", nanaPrompt: "Ask Perry: how do you feel when you see someone fall down? Does your tummy go funny?" },
          { leftEmoji: "💔", leftChapter: "Chapter 1 · My Early Home", leftBody: "My mother was quiet for a long time after. She told me she had known the horse who fell. His name was Rob Roy, and he was good and brave. After that day, she would never walk to that part of the meadow again.", rightTitle: null, rightTitleSub: null, rightBody: "A few days later we heard the church bell ringing for a long, long time. A long black coach passed slowly by, with more black coaches behind it. I was very small. I did not yet understand what it meant.", rightIsTitle: false, cue: "Why so sad a day?", nanaPrompt: "Ask Perry: have you ever felt sad about something even when you didn't fully understand it?" },
        ],
      },
      {
        id: "ch2-the-hunt",
        title: "Chapter 2 · The Hunt",
        summary: "Beauty witnesses a hunt up close — a chase, a tragedy, and his mother's careful lesson about the difference between thoughtful and careless men.",
        question: "Was the colt wrong to say 'it serves him right'? What do you think?",
        teaser: "Coming up: Beauty grows up, and learns what it really means to wear a saddle.",
        pages: [
          { leftEmoji: "📯", leftChapter: "Chapter 2 · The Hunt", leftBody: "Before I was two years old, something happened that I would never forget. It was early spring. The morning was bright. A thin silver mist hung over the small woods and meadows like a soft veil.", rightTitle: null, rightTitleSub: null, rightBody: "I and the other colts were eating grass at the lower end of the meadow. From far away we heard a sound — many dogs barking at once. The eldest colt lifted his head and pricked his ears.", rightIsTitle: false, cue: "What is that sound?", nanaPrompt: "Make a long 'awooooo' together. Ask Perry: have you ever heard a sound and wondered what it was?" },
          { leftEmoji: "🐇", leftChapter: "Chapter 2 · The Hunt", leftBody: "Then a hare came tearing past us, wild with fear, and ran for the woods. Right behind her came the hounds. They jumped the bank, leaped the stream, and dashed across the meadow with the riders close behind.", rightTitle: null, rightTitleSub: null, rightBody: "Six or eight men jumped their horses clean over the hedge after the dogs. The hare tried to slip through the fence, but it was too thick. She turned around to make for the road — but it was already too late.", rightIsTitle: false, cue: "Can the hare get away?", nanaPrompt: "Ask Perry: who do you root for in a chase — the one running, or the ones chasing?" },
          { leftEmoji: "🌊", leftChapter: "Chapter 2 · The Hunt", leftBody: "The dogs caught her. They were all over her at once. A huntsman rode up and pulled them off, holding her up by one leg for the others to see. The men in red coats seemed very pleased about it all.", rightTitle: null, rightTitleSub: null, rightBody: "I had been so caught up in watching that I did not see what was happening at the brook. When I did look, my heart sank. Two horses were down — one struggling in the water, the other lying still on the grass.", rightIsTitle: false, cue: "What's happening at the brook?", nanaPrompt: "Ask Perry: have you ever been so busy watching one thing that you missed something else important?" },
          { leftEmoji: "🌿", leftChapter: "Chapter 2 · The Hunt", leftBody: "One rider was climbing out of the water, all covered in mud. The other lay on the grass and did not move. 'His neck is broken,' my mother said quietly. I shivered, even though the day was warm.", rightTitle: null, rightTitleSub: null, rightBody: "'It serves him right,' said one of the colts beside me. I thought the same — but my mother turned sharply. 'No,' she said. 'You must never be glad when anyone is hurt. It is wrong, even when it is a person.'", rightIsTitle: false, cue: "Was the colt right to say that?", nanaPrompt: "Ask Perry: have you ever felt a little glad when someone got in trouble, then felt bad for feeling glad? Share one from your own life." },
          { leftEmoji: "😢", leftChapter: "Chapter 2 · The Hunt", leftBody: "Rob Roy — the black horse — was hurt too badly to live. A man with a gun came up to the field. He spoke quietly to the horse. Then there was a sharp loud crack, and a cry, and after that all was very still.", rightTitle: null, rightTitleSub: null, rightBody: "My mother was very sad. She had known Rob Roy for many years. He was brave and good, she said, and there was no badness in him. After that day, she never walked to that part of the meadow again.", rightIsTitle: false, cue: "Why does mother stay away now?", nanaPrompt: "Ask Perry: are there places that feel different to you because of something that happened there? Tell her about one of yours." },
          { leftEmoji: "🌅", leftChapter: "Chapter 2 · The Hunt", leftBody: "When I grew older, I often wondered why people did this for sport. The man was killed. The horse was killed. The little hare was killed. Many people were in tears. And the hare was so very small, after all.", rightTitle: null, rightTitleSub: null, rightBody: "I did not understand it then, and I am not sure I understand it now. But that day I learned something important: the world has sweet meadows in it, and hard sorrows too. Horses do not always choose which.", rightIsTitle: false, cue: "Was the hunt worth the cost?", nanaPrompt: "Ask Perry: when something costs a lot — in feelings, not money — and the prize is tiny, was it worth doing? Why or why not?" },
          { leftEmoji: "👦", leftChapter: "Chapter 2 · The Hunt", leftBody: "After that day my mother spoke often about people. 'There are many kinds of men,' she said. 'Thoughtful kind men, like our master — any horse would be proud to serve them. And cruel men, who should never own any animal at all.'", rightTitle: null, rightTitleSub: null, rightBody: "'And then there are foolish men — careless, vain, never stopping to think. They spoil more horses than the cruel ones, just because they never think. A horse never knows who will buy him. I can only hope you fall into good hands.'", rightIsTitle: false, cue: "What kind of person should you be?", nanaPrompt: "Ask Perry: what does it mean to be a 'thoughtful' person? Can she name one thoughtful grown-up she knows?" },
          { leftEmoji: "🌳", leftChapter: "Chapter 2 · The Hunt", leftBody: "'Always do your best work, and keep up your good name. Then you will be treated well wherever you go. As for me, I am getting old, and I shall stay in this meadow as long as my master will keep me.'", rightTitle: null, rightTitleSub: null, rightBody: "I felt so proud to have such a wise mother. I made a promise in my heart that day: I would grow up to be like her. I would be gentle and good. I would never disgrace her name. From that day on, I tried.", rightIsTitle: false, cue: "What does Beauty promise himself?", nanaPrompt: "Ask Perry: what is one promise you've made to yourself that you'd like to keep? You can share one of yours, too." },
        ],
      },
      {
        id: "ch3-breaking-in",
        title: "Chapter 3 · My Breaking In",
        summary: "At four years old, Beauty learns to wear a bit, a saddle, and iron shoes — and finally, on a railway-bordered meadow, he learns not to fear the world.",
        question: "What helped Beauty be brave when the loud trains rushed past?",
        teaser: "Coming up: a brand-new home, two new friends, and a beautiful name.",
        pages: [
          { leftEmoji: "🌱", leftChapter: "Chapter 3 · My Breaking In", leftBody: "I grew tall and strong. My coat turned a deep glossy black, with a white star on my forehead and one white sock. My master would not sell me until I was four. He said a horse should not work hard while still a child.", rightTitle: null, rightTitleSub: null, rightBody: "When I turned four, Squire Gordon — a fine gentleman who lived nearby — came to look at me. He felt my legs and watched me trot. At last he nodded: he would buy me. But first, my master said, I had to be 'broken in.'", rightIsTitle: false, cue: "What does 'broken in' mean?", nanaPrompt: "Ask Perry: what do you think 'broken in' means? It sounds scary, but it just means learning a new job." },
          { leftEmoji: "😣", leftChapter: "Chapter 3 · My Breaking In", leftBody: "To be broken in means learning to wear a saddle and a bridle. It also means learning to carry a person on your back, or to pull a cart behind you. It is not easy at all. The hardest part for me was the bit.", rightTitle: null, rightTitleSub: null, rightBody: "A bit is a cold iron bar. They slip it into your mouth, between your teeth, and there it stays for hours. I tossed my head and tried to spit it out. But my master gave me a soft pat and a little oats, and slowly I got used to it.", rightIsTitle: false, cue: "Would you like a bar in your mouth?", nanaPrompt: "Ask Perry: imagine wearing something on your face all day that you didn't choose. How would you feel? Could you get used to it?" },
          { leftEmoji: "🪧", leftChapter: "Chapter 3 · My Breaking In", leftBody: "Next came the saddle. It was strange at first — a heavy weight settling on my back — but it did not hurt, and my master spoke softly the whole time. Soon I could trot and canter with it on, as easily as if it weren't there.", rightTitle: null, rightTitleSub: null, rightBody: "After many days of practice, my master climbed gently up into the saddle. I could feel him sitting on my back. It was a very strange feeling at first. But he was kind, and he rode me only a little farther each day.", rightIsTitle: false, cue: "Did Beauty buck him off?", nanaPrompt: "Ask Perry: have you ever tried something new and felt wobbly at first? What helped you get steadier?" },
          { leftEmoji: "🔩", leftChapter: "Chapter 3 · My Breaking In", leftBody: "Then came the iron shoes. The smith took my hoof onto his lap, pared away a little of the bottom, and nailed a cold iron shoe onto each one. It made my feet feel heavy and stiff, and at first I did not like it one bit.", rightTitle: null, rightTitleSub: null, rightBody: "After a few days I stopped noticing the shoes at all. The smith said they were to protect my hooves from rocky roads. He was right. Once I went out onto the lanes, I was glad to have them on. They made the hard work easier.", rightIsTitle: false, cue: "Nailed to your foot?", nanaPrompt: "Ask Perry: have you ever worn boots so heavy you felt clumpy at first? How long before you forgot they were on?" },
          { leftEmoji: "🪢", leftChapter: "Chapter 3 · My Breaking In", leftBody: "Last of all, my master taught me to wear the harness. There were stiff leather straps, a heavy collar that pressed on my shoulders, and a strap that went under my tail. I did not like that strap one bit.", rightTitle: null, rightTitleSub: null, rightBody: "But my master was patient and kind. He spoke softly. He gave me a little something nice when I did well. Step by step I learned what each pull and each call meant, until I could pull a cart almost without thinking.", rightIsTitle: false, cue: "What's the trick to learning?", nanaPrompt: "Ask Perry: when you learn something new, does it help when someone is patient with you? Tell her about a good teacher you remember." },
          { leftEmoji: "🚂", leftChapter: "Chapter 3 · My Breaking In", leftBody: "There was one more test. The farmer next door had a meadow right beside the railway tracks. My master borrowed it, and for two whole weeks I lived right beside the trains. The first time a train roared past, I thought the world was ending!", rightTitle: null, rightTitleSub: null, rightBody: "I trembled and almost ran. But after a few days, I learned the trains were not coming for me. I could stand quietly while the great machines rushed by, even when they whistled. After that, nothing on the road could frighten me.", rightIsTitle: false, cue: "What would you do if a train roared by?", nanaPrompt: "Ask Perry: have you ever heard something so loud it scared you? What helped you not be scared the next time?" },
          { leftEmoji: "👋", leftChapter: "Chapter 3 · My Breaking In", leftBody: "On the day I was to leave, my master came to say goodbye. My mother stood quietly while he spoke. 'Goodbye, Darkie,' he said, putting his hand softly on my neck. 'You are a brave, good colt. I shall miss you very much.'", rightTitle: null, rightTitleSub: null, rightBody: "My mother had her last words for me too. 'Be a good horse,' she said. 'Always do your best, and keep up your good name. Then no matter where you go, you will have done well.' I never saw her again.", rightIsTitle: false, cue: "How does Beauty feel?", nanaPrompt: "Ask Perry: have you ever had to say goodbye to someone you loved? It's okay if it makes you a little teary." },
          { leftEmoji: "🛤️", leftChapter: "Chapter 3 · My Breaking In", leftBody: "I was loaded into a railway car for the very first time. It was rattly and strange, and the noise was great. But I remembered my training with the trains, and I stood quite steady. After a long ride, the door opened in a new place.", rightTitle: null, rightTitleSub: null, rightBody: "A man was waiting for me. His name was John Manly, and he was the coachman at Birtwick Park. He led me out gently, looked me over with a smile, and said quietly, 'Well, young one. Let's get you home.'", rightIsTitle: false, cue: "What will Birtwick Park be like?", nanaPrompt: "Ask Perry: how does she feel when she goes somewhere brand new? Excited? Nervous? A little of both?" },
        ],
      },
      {
        id: "ch4-birtwick-park",
        title: "Chapter 4 · Birtwick Park",
        summary: "Beauty arrives at his new home, meets cheerful Merrylegs and fiery Ginger, earns the name 'Black Beauty', and begins the happiest years of his life.",
        question: "Why do you think Ginger was so cross when Beauty first met her?",
        teaser: "Coming up: a wild storm, a flooded river, and a choice only Beauty can make.",
        pages: [
          { leftEmoji: "🏰", leftChapter: "Chapter 4 · Birtwick Park", leftBody: "Birtwick Park was a beautiful place. There were great trees, soft lawns, and a long avenue leading up to the master's house. The stables were clean and bright, with two rows of stalls and a wide door for fresh air.", rightTitle: null, rightTitleSub: null, rightBody: "John led me to my own stall. It was a 'loose box,' which meant I was not tied up. I could move around as I pleased. The straw was fresh and golden, and the manger was full of good oats. I had never seen such a fine stable.", rightIsTitle: false, cue: "What makes a stable feel like home?", nanaPrompt: "Ask Perry: when you go to bed at night, what makes your room feel cozy? Is it soft sheets, a special toy, a favorite blanket?" },
          { leftEmoji: "🐎", leftChapter: "Chapter 4 · Birtwick Park", leftBody: "In the next stall was a small fat grey pony with a thick mane and tail. I greeted him politely over the low wall. 'Hello,' he said cheerfully. 'My name is Merrylegs. I am very handsome — and I belong to the children of the house.'", rightTitle: null, rightTitleSub: null, rightBody: "Merrylegs was kind and chatty. He told me everything I needed to know — when meals came, when John brushed us down, where the best grass in the paddock was. He had been at Birtwick a long time, and he was very proud of it.", rightIsTitle: false, cue: "What kind of friend is Merrylegs?", nanaPrompt: "Ask Perry: who is the friend in her life who tells her everything? Do you have a Merrylegs friend yourself?" },
          { leftEmoji: "🔥", leftChapter: "Chapter 4 · Birtwick Park", leftBody: "In the stall on my other side was a chestnut mare with a long, beautiful neck and a fiery eye. She did not say hello. She turned her head and asked sharply, 'And who are you, to come in and take MY stall?'", rightTitle: null, rightTitleSub: null, rightBody: "Her name was Ginger, and she was not friendly that day. Merrylegs told me later that Ginger had a habit of nipping people, and that she had not had a kind life before coming to Birtwick. I felt sorry for her, even when she snapped.", rightIsTitle: false, cue: "Why is Ginger so cross?", nanaPrompt: "Ask Perry: have you ever met someone who seemed grumpy at first but turned out to be kind? Sometimes grumpy people are sad inside." },
          { leftEmoji: "🕯️", leftChapter: "Chapter 4 · Birtwick Park", leftBody: "One quiet evening Ginger told me her story. Her mother had been taken from her when she was very young. She had been broken in roughly, by men with whips and harsh hands, who never spoke a single gentle word to her.", rightTitle: null, rightTitleSub: null, rightBody: "She had learned, she said, that the world was a cruel place. So she bit and kicked, because it was the only way she knew to stand up for herself. 'I had no kindness,' she told me, 'so I had no kindness to give.' I listened, and I was very sorry.", rightIsTitle: false, cue: "Why does Ginger bite?", nanaPrompt: "Ask Perry: when someone is mean, do you think they are mean because they like it, or because something hurt them long ago? Big question." },
          { leftEmoji: "🌳", leftChapter: "Chapter 4 · Birtwick Park", leftBody: "The next morning, John saddled me and took me for my first ride. He was a fine rider — light in the saddle, gentle with his hands. We trotted down the lane and through the village. I felt the wind in my mane and the world flying past.", rightTitle: null, rightTitleSub: null, rightBody: "When we came back, John spoke to the master. 'He is a fine, fast goer, sir — and gentle as a lamb.' The master patted my neck and said, 'Take him out tomorrow with the mistress. We'll see how he goes with her.'", rightIsTitle: false, cue: "How was the first ride?", nanaPrompt: "Ask Perry: what is the most fun part of riding in a car or a bike — the wind? The speed? Tell her about your favorite ride." },
          { leftEmoji: "✨", leftChapter: "Chapter 4 · Birtwick Park", leftBody: "That evening the master and mistress came together to look at me. 'He is a perfect black, John,' the mistress said. 'With such a soft eye. He should have a beautiful name.' 'What about Black Beauty?' said the master.", rightTitle: null, rightTitleSub: null, rightBody: "'Black Beauty — yes,' she answered with a smile. 'It is a very pretty name, and he is a very pretty horse.' From that day, I had a new name. It would be the name they called me here — and it would stay with me, wherever I went.", rightIsTitle: false, cue: "Do you like the name 'Black Beauty'?", nanaPrompt: "Ask Perry: if you could pick a brand-new name for yourself, what would it be? And why?" },
          { leftEmoji: "👒", leftChapter: "Chapter 4 · Birtwick Park", leftBody: "The next day the mistress drove me herself. She had small, gentle hands on the reins, and she spoke softly to me through the whole drive. We went a long way through the green countryside, past hedges full of wild roses.", rightTitle: null, rightTitleSub: null, rightBody: "When we came home, she patted my neck and told the master, 'I love him already. He is a great gentleman of a horse.' I felt very proud — for I had remembered my mother's advice, and I had tried my best the whole way.", rightIsTitle: false, cue: "What did the mistress think?", nanaPrompt: "Ask Perry: how does it feel when someone notices you doing something well? Have you ever done your best and had someone really see it?" },
          { leftEmoji: "🏡", leftChapter: "Chapter 4 · Birtwick Park", leftBody: "And so I settled at Birtwick Park. I had Merrylegs to chat with, Ginger to keep me company, John to take care of me, and a master and mistress who were always kind. The days went by like good, warm dreams.", rightTitle: null, rightTitleSub: null, rightBody: "I had work to do, and I did it gladly. I carried the family wherever they wished to go. I came to know every road and lane for miles around. I was strong and happy. In those early years, I thought it would never, ever end.", rightIsTitle: false, cue: "Will it last forever?", nanaPrompt: "Ask Perry: have you ever had a perfect day or a perfect summer? What made it feel so good? Share one of yours." },
        ],
      },
      {
        id: "ch5-stormy-day",
        title: "Chapter 5 · A Stormy Day",
        summary: "A river bridge gives way in a storm. Beauty refuses to cross — and his master learns that sometimes the wisest one in the carriage isn't the human.",
        question: "Have you ever 'just known' something was wrong, like Beauty did?",
        teaser: "Coming up: a candle left burning, and a quiet voice in the smoke.",
        pages: [
          { leftEmoji: "☁️", leftChapter: "Chapter 5 · A Stormy Day", leftBody: "Late in the autumn the master had a long journey to make on business. The carriage was brought round. John drove, and I and another horse — a big strong gray — were harnessed up. The master got in, and we set off through the morning.", rightTitle: null, rightTitleSub: null, rightBody: "The wind was rising before we reached town. By afternoon the clouds had grown thick and dark. We finished our business — but as we started home, the rain came down in great gray sheets, and the wind began to howl through the trees.", rightIsTitle: false, cue: "Looks like a bad storm ahead!", nanaPrompt: "Ask Perry: do you like the sound of rain? Or thunder? Are storms exciting, scary, or both?" },
          { leftEmoji: "🌬️", leftChapter: "Chapter 5 · A Stormy Day", leftBody: "As we drove home, the storm grew worse. Whole branches snapped from the trees and came down across the road. We had to pick our way carefully, for the path was wet and slippery. The river beside us was running higher and higher.", rightTitle: null, rightTitleSub: null, rightBody: "Then, just as we turned the bend by the woods, a great oak tree crashed down — right across the road, only a few yards ahead. John pulled us up sharp. The master leapt out to look, but the tree was much too heavy to move.", rightIsTitle: false, cue: "Now what?", nanaPrompt: "Ask Perry: have you ever been blocked from where you were going and had to find another way? What did you do?" },
          { leftEmoji: "🗺️", leftChapter: "Chapter 5 · A Stormy Day", leftBody: "'There is another way home,' said the master. 'We can go round by the wooden bridge, just below the meadow.' John was uneasy — the river was so high, and the bridge sat low. But there was nothing else to be done.", rightTitle: null, rightTitleSub: null, rightBody: "The light was failing as we came down the long lane toward the bridge. The rain had thinned a little, but the wind was still wild. Ahead, just visible in the gloom, the wooden boards of the bridge stretched across the rushing water.", rightIsTitle: false, cue: "Will it hold?", nanaPrompt: "Ask Perry: when you have to do something a little scary, does it help to take a deep breath first? Try one together!" },
          { leftEmoji: "🛑", leftChapter: "Chapter 5 · A Stormy Day", leftBody: "As we drew near the bridge, I felt with my hooves that something was very wrong. The boards underfoot were strange. The river was high — too high. I stopped, all on my own. I would not take another step forward.", rightTitle: null, rightTitleSub: null, rightBody: "John shook the reins. 'Get up, Beauty,' he said. 'Get up!' But I would not move. The master leaned out. 'Come on, Beauty, what is the matter?' Still I did not move. I knew with all my heart that the bridge was not safe.", rightIsTitle: false, cue: "Why won't Beauty move?", nanaPrompt: "Ask Perry: have you ever had a deep-down feeling that something wasn't right — and you couldn't say why? Tell her about it." },
          { leftEmoji: "🔦", leftChapter: "Chapter 5 · A Stormy Day", leftBody: "Then, on the far side of the bridge, a lantern came swinging up the road. A man was waving and shouting. The wind tore his words away. He ran up close, and at last we could hear him through the storm.", rightTitle: null, rightTitleSub: null, rightBody: "'The bridge is broken!' he cried. 'The middle has given way! It went down in the flood not ten minutes ago. If you had driven on, you would all be in the river!' The master and John both went pale. They looked at the bridge — then at me.", rightIsTitle: false, cue: "Beauty saved them all!", nanaPrompt: "Cheer with Perry for Black Beauty! Ask: did you feel proud of him? Tell her about a time you 'just knew' something." },
          { leftEmoji: "🕯️", leftChapter: "Chapter 5 · A Stormy Day", leftBody: "We turned around once more and took the long way home, through the village. By the time we reached Birtwick Park, the lamps were lit and the mistress was standing at the doorway, very worried indeed.", rightTitle: null, rightTitleSub: null, rightBody: "She had been waiting for hours. 'Oh,' she cried, 'you are safe! I have been so afraid!' The master told her everything that had happened — and how the storm had nearly cost them their lives. And then he told her about me.", rightIsTitle: false, cue: "Will they praise Beauty?", nanaPrompt: "Ask Perry: when someone has been worried about you and you come home safe, what's the best part of that hug?" },
          { leftEmoji: "🌟", leftChapter: "Chapter 5 · A Stormy Day", leftBody: "John brought me to the stable that night, very tired and very glad. He rubbed me down with extra care, gave me a warm bran mash, and patted my neck for a long time. 'You are a brave good horse,' he said. 'I shall not forget what you did tonight.'", rightTitle: null, rightTitleSub: null, rightBody: "The master, before he went into the house, had stopped at my stall too. He put his hand softly on my nose. 'You saved us all tonight, Beauty,' he said. 'You knew what we did not. You are a wise and good horse.' I felt full of pride.", rightIsTitle: false, cue: "What did he learn?", nanaPrompt: "Ask Perry: when someone really thanks you for something you did, what does it feel like inside? Tell her about a time you helped someone." },
          { leftEmoji: "💡", leftChapter: "Chapter 5 · A Stormy Day", leftBody: "The next morning, while John was brushing me, the master came in. 'It is wonderful,' the master said, 'how God has given the animals such sense. They know things by feeling that we know only by thinking about it for a long time.'", rightTitle: null, rightTitleSub: null, rightBody: "'Aye, sir,' said John. 'And if we would only listen to them when they tell us something is wrong, we'd be the better for it.' From that day on, when I did not want to go forward, John always stopped to find out why.", rightIsTitle: false, cue: "What does it mean to listen?", nanaPrompt: "Ask Perry: who is good at really listening to you? What's the difference between hearing someone and really, really listening?" },
        ],
      },
      {
        id: "ch6-the-fire",
        title: "Chapter 6 · The Fire",
        summary: "A careless candle in an inn stable becomes a midnight fire. James, a young groom, walks into the smoke with a quiet voice — and earns the right to be called brave.",
        question: "What made James brave that night — was it being unafraid, or something else?",
        teaser: "Coming up: a fancy visitor, a cruel new rule, and Ginger has had enough.",
        pages: [
          { leftEmoji: "🧳", leftChapter: "Chapter 6 · The Fire", leftBody: "Soon after, the master and mistress went on a long journey to visit friends, and they took Ginger and me to pull the carriage. James, the second coachman — who was only seventeen years old — came along to take care of us.", rightTitle: null, rightTitleSub: null, rightBody: "It was a long, hot day's drive. By evening we were tired, and the master decided to stop at a fine old inn we had passed before. The stables were good, and there were many other horses staying there for the night.", rightIsTitle: false, cue: "Why stop at an inn?", nanaPrompt: "Ask Perry: have you ever stayed somewhere new overnight? Was it strange to sleep in a different place?" },
          { leftEmoji: "🐴", leftChapter: "Chapter 6 · The Fire", leftBody: "The stables were a big square building with two rows of stalls and a wide loft full of hay overhead. James settled Ginger and me into our stalls and brushed us down. We had good food and clean straw, and very soon we were feeling sleepy.", rightTitle: null, rightTitleSub: null, rightBody: "Many other horses were in the same building — all strangers to us. The grooms were busy. One of them was talking to a friend, and as he went out to fetch a pitchfork, he carelessly left a candle burning on a barrel in the corner.", rightIsTitle: false, cue: "Is that safe?", nanaPrompt: "Ask Perry: what should you never, never leave burning by itself? Tell her about fire safety in your house." },
          { leftEmoji: "🌫️", leftChapter: "Chapter 6 · The Fire", leftBody: "In the deep of the night I was wakened by a strange smell. It was not the good smell of the stable. It was sharp, and it stung my nose. I stood up. The air was thick. Somewhere inside the building, I heard a soft, quick crackling sound.", rightTitle: null, rightTitleSub: null, rightBody: "I began to be afraid. Ginger, next to me, was awake too, snorting and trying to get loose. The other horses grew restless. Then the door opened, and a man with a lantern came hurrying in. He looked around — and gave a great shout of fear.", rightIsTitle: false, cue: "Oh no — what's happening?", nanaPrompt: "Ask Perry: have you ever smelled smoke and had to act fast? Practice the 'smoke alarm' face together!" },
          { leftEmoji: "😨", leftChapter: "Chapter 6 · The Fire", leftBody: "Up in the loft, the hay was on fire. Flames were already crackling along the rafters. The man tried to lead one horse out — but the horse was so frightened he would not go. He could see the flames, and he was sure they meant his end.", rightTitle: null, rightTitleSub: null, rightBody: "The smoke grew thicker by the moment. I could hardly breathe. I was very afraid, but I knew I had to keep my head. I stood as still as I could in my stall, and I listened — for any voice I knew, for any kind word that might guide me out.", rightIsTitle: false, cue: "What should the horses do?", nanaPrompt: "Ask Perry: when you're scared, what helps you most — being still, being held, hearing a familiar voice?" },
          { leftEmoji: "🦸", leftChapter: "Chapter 6 · The Fire", leftBody: "Then I heard a quick step on the stones outside. The door of my stall swung open. It was James — my James! 'Come, Beauty,' he said, in a quiet steady voice. 'Come, my fine fellow. It is time to come out.' He spoke as if there were no fire at all.", rightTitle: null, rightTitleSub: null, rightBody: "He took a cloth from his shoulder and gently wrapped it around my eyes, so I could not see the flames. Then he led me with one hand, talking to me the whole way. 'Steady now, Beauty. Good boy. Just a few steps more.' And I followed him.", rightIsTitle: false, cue: "Why cover his eyes?", nanaPrompt: "Ask Perry: why did James cover Beauty's eyes? Because sometimes not seeing is the braver way." },
          { leftEmoji: "🌌", leftChapter: "Chapter 6 · The Fire", leftBody: "James led me out into the cold, fresh air of the yard. He handed me to a man who held me tight by the bridle. Then — without a single moment of rest — James turned right around and ran back into the burning stable. I could only nicker after him.", rightTitle: null, rightTitleSub: null, rightBody: "In a moment he was out again, leading Ginger. She was wild with fear, snorting and rolling her eyes, but James had not let her go. He had used the same cloth, the same quiet voice. The two of us stood trembling in the yard — safe, but not yet sure of it.", rightIsTitle: false, cue: "Brave James!", nanaPrompt: "Ask Perry: what does it mean to be brave? Is it being not-afraid, or doing the right thing even when you ARE afraid?" },
          { leftEmoji: "🔥", leftChapter: "Chapter 6 · The Fire", leftBody: "Some of the other horses were led out too. But not all were so lucky. As soon as the last horse was clear of the doors, a great roar came from inside the stable, and the roof caved in with a crash. The fire shot up high into the night sky.", rightTitle: null, rightTitleSub: null, rightBody: "The yard filled with people in their nightclothes, carrying buckets and shouting. The master came running, half-dressed, looking for us. When he saw Ginger and me safe — and James safe with us — he caught James by the hand and could hardly speak. 'My brave lad,' he said.", rightIsTitle: false, cue: "What if James had been a moment later?", nanaPrompt: "Ask Perry: have you ever made it 'just in time' for something? It feels like your heart catches up to you afterwards." },
          { leftEmoji: "💛", leftChapter: "Chapter 6 · The Fire", leftBody: "We left the inn the next morning. Ginger and I were both well, though we had to be coaxed past the burned stable. We took the road for home. When we got there, John came running out, and the master told him the whole story — every part.", rightTitle: null, rightTitleSub: null, rightBody: "John looked at James and could not speak for a moment. Then he held out his hand. 'I always said you were a good lad,' he told him quietly. 'Now I know it.' James turned a little red. He patted my neck. 'Beauty did his part too,' he said. 'He trusted me.'", rightIsTitle: false, cue: "What did Beauty learn?", nanaPrompt: "Ask Perry: when something is hard and scary, why is trust so important? Who do you trust to help you when you're afraid?" },
        ],
      },
      {
        id: "ch7-strike-for-liberty",
        title: "Chapter 7 · A Strike for Liberty",
        summary: "A fashionable visitor insists on the cruel bearing rein. Beauty endures it; Ginger refuses. A single act of rebellion changes one good master's mind for good.",
        question: "Was Ginger right to fight back, even though it cost her home?",
        teaser: "Coming up: many years later, an old friend at a busy London cab stand.",
        pages: [
          { leftEmoji: "👒", leftChapter: "Chapter 7 · A Strike for Liberty", leftBody: "Not long after, a fine lady came to stay at Birtwick. Her name was Mrs. Whitebrook. She was the master's cousin, and she lived in a great city far away. She brought her own ideas about how horses should be dressed and driven.", rightTitle: null, rightTitleSub: null, rightBody: "On the second day of her visit, she came into the stable yard to see the horses. She watched John harness Ginger and me to the carriage. Then she frowned. 'But John,' she said sharply, 'where is the bearing rein? It should be put up at once.'", rightIsTitle: false, cue: "What's a bearing rein?", nanaPrompt: "Ask Perry: have you ever been told to do something a new way that just didn't feel right? Tell her about it." },
          { leftEmoji: "⛓️", leftChapter: "Chapter 7 · A Strike for Liberty", leftBody: "A bearing rein is a strap that runs from the bit up over the horse's neck and down to a hook. When the strap is tight, the horse cannot lower his head. He must hold it high in the air, even when he wants to pull. Many fine ladies thought it looked smart.", rightTitle: null, rightTitleSub: null, rightBody: "But for the horse it is a misery. With his head held high, he cannot lean into his work. He cannot drink water. He cannot ease his neck. Even his breath feels short, for his throat is bent the wrong way. It is a small cruelty, done for fashion.", rightIsTitle: false, cue: "Would you want to hold your head up all day?", nanaPrompt: "Ask Perry: try holding your chin up high, very stiff. Now imagine doing it for hours. Not fun, is it?" },
          { leftEmoji: "🤔", leftChapter: "Chapter 7 · A Strike for Liberty", leftBody: "The mistress did not like bearing reins. She believed it was wrong to make horses uncomfortable just for the sake of looking fashionable. But Mrs. Whitebrook insisted. 'Without bearing reins, your horses look so awkwardly free,' she said.", rightTitle: null, rightTitleSub: null, rightBody: "At last, to keep the peace, the master nodded. John was told to fasten the bearing reins on. He grumbled, but he obeyed. He fastened the first one to Ginger, then to me. Each click of the buckle made my neck tighter — and my heart smaller.", rightIsTitle: false, cue: "Why did the master give in?", nanaPrompt: "Ask Perry: sometimes adults say yes to something they don't really agree with. Why do you think they do? It's complicated." },
          { leftEmoji: "🌳", leftChapter: "Chapter 7 · A Strike for Liberty", leftBody: "We started off — but not as we usually did. My neck was held in the air. Ginger's neck too. We could not lean into the harness, and the pulling was twice as hard. Up a long hill, my breath came short, and my eyes grew dim.", rightTitle: null, rightTitleSub: null, rightBody: "By the time we reached the top, both of us were trembling. The mistress called out, 'John! Please, go more slowly. They are working too hard.' But Mrs. Whitebrook only laughed. 'They look very smart. You worry too much, my dear.'", rightIsTitle: false, cue: "Is this fair?", nanaPrompt: "Ask Perry: when something looks pretty but hurts to wear, what should we choose — the pretty, or the not-hurting?" },
          { leftEmoji: "💥", leftChapter: "Chapter 7 · A Strike for Liberty", leftBody: "Days passed, each one worse than the last. Then one afternoon, as we were being harnessed up, Ginger had had enough. The moment John tightened her bearing rein, she gave a great kick. The straps snapped. The buckle flew across the yard. Ginger was free.", rightTitle: null, rightTitleSub: null, rightBody: "She kicked again and again, fighting like a wild thing. John talked to her, soft and steady, and never struck her once. But the harness was ruined. Mrs. Whitebrook came running out, stood by the yard fence, shook her head, and looked very cross indeed.", rightIsTitle: false, cue: "Was Ginger wrong?", nanaPrompt: "Ask Perry: when is it okay to say 'no, this is too much'? Even for kids, even for horses. Sometimes 'no' is the right answer." },
          { leftEmoji: "🚂", leftChapter: "Chapter 7 · A Strike for Liberty", leftBody: "The next day, Mrs. Whitebrook left Birtwick in a huff. She told the master his horses were poorly trained. But by then, the master had made up his own mind. He took the bearing reins off — for good. He kept them off all his horses, forever after.", rightTitle: null, rightTitleSub: null, rightBody: "But Ginger was changed. She was given to one of the master's friends, who said he wanted a horse with spirit. He promised to be kind. I tried to be glad — but I missed her badly. I knew her temper might carry her into hard places, sooner or later.", rightIsTitle: false, cue: "Will Ginger be all right?", nanaPrompt: "Ask Perry: have you ever had to say goodbye to a friend you weren't sure would be okay? What did you do to feel a little better?" },
          { leftEmoji: "🍀", leftChapter: "Chapter 7 · A Strike for Liberty", leftBody: "Without the bearing reins, every drive felt easy again. I could lower my head, and I could pull with all my strength. The mistress took great pleasure in driving me, and the master often said, 'There — that is how a horse should look. Free and well.'", rightTitle: null, rightTitleSub: null, rightBody: "Other horse-owners in the neighborhood noticed. Some of them began to take their own bearing reins off too. Slowly — just a little — the fashion began to change. One small bit of cruelty grew a little smaller, because one good man would not put up with it.", rightIsTitle: false, cue: "How do small changes start?", nanaPrompt: "Ask Perry: can one person change anything? Sometimes yes — by doing the right thing where others can see." },
          { leftEmoji: "🌌", leftChapter: "Chapter 7 · A Strike for Liberty", leftBody: "I often thought about what Ginger had done that day. She had fought back when nothing else would work. She had broken the harness. She had stood up — even though it had cost her her home. I knew I could not have done it. But I was glad someone had.", rightTitle: null, rightTitleSub: null, rightBody: "I thought, too, about how many small cruelties are done in the world — not from anger, but from carelessness, or fashion, or because no one wants to be the first to speak up. I hoped, when my turn came, I would have the courage to do my small part.", rightIsTitle: false, cue: "What's a 'small cruelty'?", nanaPrompt: "Ask Perry: can you think of an unkindness people do without thinking? What would happen if everyone stopped doing it?" },
        ],
      },
      {
        id: "ch8-poor-ginger",
        title: "Chapter 8 · Poor Ginger",
        summary: "Years later, in a London cab stand, Beauty meets a thin and broken horse he barely recognizes. It is Ginger — and her last words to him are about rest.",
        question: "What would you have said to Ginger if you'd been standing there with Beauty?",
        teaser: "Coming up: a freezing Christmas Eve, and harder days than Beauty has ever known.",
        pages: [
          { leftEmoji: "📅", leftChapter: "Chapter 8 · Poor Ginger", leftBody: "Many years went by. The good days at Birtwick Park came to an end when the mistress fell ill, and the family moved far away to a warmer country. Ginger and I were sold to different masters. We did not say goodbye — we did not even know.", rightTitle: null, rightTitleSub: null, rightBody: "I had been through many places by then. Some were kind. Some were not. By the time of this story, I was pulling a cab on the streets of London. My driver was a man named Jeremiah Barker — Jerry — and he was as kind a master as I had ever known.", rightIsTitle: false, cue: "Where is Beauty now?", nanaPrompt: "Ask Perry: what is a 'cab'? Have you ever been in one? Tell her about how people used to travel in cities long ago." },
          { leftEmoji: "🚕", leftChapter: "Chapter 8 · Poor Ginger", leftBody: "Every morning, Jerry and I went out to our cab stand. The other cabmen and their horses were there too. We waited in a long row for people to come and hire us. There was always someone nearby with a bit of bread or a kind word for the horses.", rightTitle: null, rightTitleSub: null, rightBody: "On one bright morning in early summer, I was standing in my place, half-asleep in the sun. A new cab pulled up across the way. The horse pulling it was a thin chestnut mare. She moved slowly, her head hung low. My heart almost stopped.", rightIsTitle: false, cue: "Could it be...?", nanaPrompt: "Build the suspense! Ask Perry: do you think Beauty knows this horse? Watch her eyes when you read the next page." },
          { leftEmoji: "💔", leftChapter: "Chapter 8 · Poor Ginger", leftBody: "She was so thin you could count her ribs. Her coat, once bright chestnut, was rough and dull. Her once-proud neck had drooped. Her hip bones stuck out. Her sides were marked with old whip-stripes. Her eyes were tired — so tired.", rightTitle: null, rightTitleSub: null, rightBody: "But there was something about the way she held her ear, and the small white snip on her muzzle, and the small turn of her head — that I could not mistake. I looked again. I looked once more. And then I knew. It was Ginger.", rightIsTitle: false, cue: "Oh, Ginger...", nanaPrompt: "Ask Perry: have you ever seen someone you used to know who looked very different? How did it make you feel?" },
          { leftEmoji: "🗣️", leftChapter: "Chapter 8 · Poor Ginger", leftBody: "I called to her, softly. She lifted her head, and slowly her dim eyes brightened. 'Beauty,' she whispered. 'Is it you?' We stood quietly together for a while, our heads close. Then, in her own quiet way, she told me what had happened to her.", rightTitle: null, rightTitleSub: null, rightBody: "She had been passed from master to master. Each one had been harder than the one before. The bearing rein had come back into her life. She had been worked too long, in all weathers, on too little food. Her spirit, she said, was almost broken.", rightIsTitle: false, cue: "Why did this happen to her?", nanaPrompt: "Ask Perry: when someone has a hard life, is it always their fault? Tell her — almost never." },
          { leftEmoji: "🌧️", leftChapter: "Chapter 8 · Poor Ginger", leftBody: "'I have been worked very, very hard,' she said. 'And no one has spoken a kind word to me for a long time. I am almost glad to be near the end of it.' Her voice was so soft I could barely hear her. I thought of the proud, fiery mare she had been.", rightTitle: null, rightTitleSub: null, rightBody: "'Beauty,' she said, 'I wish I could die where I stand. I am so tired. I would want only one thing now — that they would let me rest, and not whip me any more.' I did not know what to say. I touched my nose to hers. We stood like that.", rightIsTitle: false, cue: "What would help her?", nanaPrompt: "Ask Perry: when a friend is very sad, what is the most loving thing you can do? Sometimes it is just being there." },
          { leftEmoji: "🕯️", leftChapter: "Chapter 8 · Poor Ginger", leftBody: "Her driver came back from his lunch, climbed up onto the box, and clucked his tongue. Ginger gave a small sigh. She turned her head once more towards me. 'Goodbye, Beauty,' she said. 'You were always a good friend.' Then she pulled the cab away into the city.", rightTitle: null, rightTitleSub: null, rightBody: "I watched until the cab turned a corner and was gone. I never saw Ginger again. A few weeks later, I saw a cart go past the stand carrying a horse no longer alive. The horse had a chestnut coat and a white snip. The carter tipped his cap as it passed.", rightIsTitle: false, cue: "Was that Ginger?", nanaPrompt: "This is a sad page. Ask Perry: is it okay to feel sad about a story? Yes — it means we cared." },
          { leftEmoji: "🫂", leftChapter: "Chapter 8 · Poor Ginger", leftBody: "I stood in the cab stand for a long time after, very still. Jerry came to me at last, and patted my neck, and said nothing. He could see I was unhappy — though of course he could not know why. He gave me an extra handful of oats that night, just for kindness.", rightTitle: null, rightTitleSub: null, rightBody: "'You're a thinking sort of a horse, Beauty,' he said, scratching gently behind my ear. 'I sometimes wonder what goes on in that head of yours. Whatever it is, old fellow — I'm glad you're with me, and not somewhere worse.' I leaned into his shoulder.", rightIsTitle: false, cue: "Why is kindness so important?", nanaPrompt: "Ask Perry: even when nothing fixes a sad thing — does a kind hand still help? Tell her about a hug that helped you once." },
          { leftEmoji: "🌅", leftChapter: "Chapter 8 · Poor Ginger", leftBody: "Long after, I would still think of Ginger. I thought of her in the green Birtwick meadow, fiery and beautiful and alive. I thought of her at the cab stand, thin and broken. And I thought of all the other Gingers in the world — too tired even to complain.", rightTitle: null, rightTitleSub: null, rightBody: "If a horse had a prayer, mine would be this: let me serve good people. And let the cruel masters of the world be made gentle, before they meet another horse — or another child — or any other living thing that could be hurt and could not run away.", rightIsTitle: false, cue: "What's Beauty's prayer for?", nanaPrompt: "Ask Perry: if you could pray for one thing for all animals everywhere, what would it be?" },
        ],
      },
      {
        id: "ch9-hard-times",
        title: "Chapter 9 · Hard Times",
        summary: "Beauty's kind cab-driver falls ill on a freezing Christmas Eve. Sold from master to crueler master, Beauty's strength is finally broken on a London hill.",
        question: "When Beauty had nothing left, what kept the smallest bit of hope alive in him?",
        teaser: "Coming up: a tired old horse at a fair, and a face he never thought he'd see again.",
        pages: [
          { leftEmoji: "🌃", leftChapter: "Chapter 9 · Hard Times", leftBody: "I should tell you more about Jerry. He was a strong, broad man with a quick smile and a kind voice. He had a wife named Polly and two children named Harry and Dolly. They lived in a small house near the cab stand. They were a very happy family.", rightTitle: null, rightTitleSub: null, rightBody: "Cab work in London was hard. The streets were crowded with people and carts and great horse-drawn buses. The roads were stony, and there were many places to slip. The hours were very long. But Jerry never struck me, and he always gave me my rest.", rightIsTitle: false, cue: "What's Jerry like as a master?", nanaPrompt: "Ask Perry: what kind of family would you want to live near, if you were a horse? Tell her about Polly, Harry, and Dolly!" },
          { leftEmoji: "💗", leftChapter: "Chapter 9 · Hard Times", leftBody: "Polly often came out to the stand at midday with Jerry's dinner in a covered basket. She always brought a carrot or a slice of apple for me too. She would pat my nose and say, 'You are a good horse, Beauty. You take such good care of our Jerry.'", rightTitle: null, rightTitleSub: null, rightBody: "I came to love their voices — Polly's calm, Jerry's hearty, Harry's eager, little Dolly's bird-like piping. They were the sweetest sounds I knew. On hot days when the city was loud, I would think of them, and the streets would not feel so very hard.", rightIsTitle: false, cue: "What makes life sweet?", nanaPrompt: "Ask Perry: what are the little things in your day that you look forward to most? They count for a lot." },
          { leftEmoji: "❄️", leftChapter: "Chapter 9 · Hard Times", leftBody: "One Christmas Eve, Jerry was hired to drive some gentlemen to a great theatre and wait for them outside until the play was over. The night was bitter cold. I stood for hours in the freezing wind. The snow blew in long stripes across my back.", rightTitle: null, rightTitleSub: null, rightBody: "It was nearly midnight when the gentlemen came out at last. They were laughing and warm, with hot dinners in their bellies. They paid Jerry only the smallest of fares — and not a penny extra for the long, cold wait. Jerry said nothing. We went home.", rightIsTitle: false, cue: "Was that fair?", nanaPrompt: "Ask Perry: have you ever waited a very long time for someone, in the cold? What does it feel like?" },
          { leftEmoji: "🤒", leftChapter: "Chapter 9 · Hard Times", leftBody: "By morning, Jerry was very sick. He had taken a deep chill on Christmas Eve. The doctor came, and the news was not good. Polly cried, quietly, in the kitchen. For days Jerry lay in bed, and I stood in the stable, eating less and less. I missed him much.", rightTitle: null, rightTitleSub: null, rightBody: "When at last Jerry was a little better, the doctor came to speak to Polly. 'He must give up cab work,' he said. 'Another winter on the streets will kill him.' Polly nodded, brave as ever. She had a brother in the country who would help find Jerry quieter work.", rightIsTitle: false, cue: "What will happen now?", nanaPrompt: "Ask Perry: have you ever had to make a big change because something stopped working? How did it feel?" },
          { leftEmoji: "👋", leftChapter: "Chapter 9 · Hard Times", leftBody: "On the day they left, Jerry came down to the stable. He was pale and thin, but he could walk a little. He put both arms around my neck and laid his cheek against me. He did not speak for a long time. Then at last he said, 'Goodbye, my Beauty.'", rightTitle: null, rightTitleSub: null, rightBody: "He sold me to a baker who needed a quiet horse to pull his cart around the streets. The baker himself was not a bad man — but he had a head man who was cruel and lazy. The bearing rein came out of its drawer again. And the work, day after day, was very hard.", rightIsTitle: false, cue: "How does Beauty feel?", nanaPrompt: "Ask Perry: have you ever had to leave a place you loved? What did you do to remember it?" },
          { leftEmoji: "🌑", leftChapter: "Chapter 9 · Hard Times", leftBody: "I was sold once more, and then again. Each new master cared less than the one before. There were drivers who whipped me up hills until I was trembling. There were drivers who let the stable run filthy. There was little hay, and that little was poor.", rightTitle: null, rightTitleSub: null, rightBody: "I worked from before sunrise to long after dark. The streets in winter were like ice. In summer the heat blew up from the stones. The cab was old and heavy. The driver was heavy too — and short of temper. My coat lost its shine. My eyes lost their light.", rightIsTitle: false, cue: "Will it ever get better?", nanaPrompt: "Ask Perry: even in a hard time, what can you hold on to inside? Beauty held on to his memories — and his hope." },
          { leftEmoji: "🪨", leftChapter: "Chapter 9 · Hard Times", leftBody: "One day a driver took my cab and put far too many people in it. We had to climb a long, steep hill. The driver shouted and laid the whip on hard. I tried — but my legs would not move any faster. Halfway up the hill, my front knees gave way. I went down on the stones.", rightTitle: null, rightTitleSub: null, rightBody: "There was a great deal of shouting. The passengers tumbled out. The driver kicked me. I could not get up. Strangers gathered round. One old gentleman knelt by my head and said quietly, 'This horse is exhausted. He is not vicious. Treat him gently, or you'll answer for it.'", rightIsTitle: false, cue: "Is this the end?", nanaPrompt: "Ask Perry: have you ever been so tired you couldn't go one more step? What did you need then?" },
          { leftEmoji: "🕯️", leftChapter: "Chapter 9 · Hard Times", leftBody: "They got me to my feet at last. I was led, very slowly, back to the cab yard. The owner came out, looked at me, and shook his head. 'He is done,' he said. 'I'll take him to the horse fair on Friday. Someone will buy him cheap and be glad of it.'", rightTitle: null, rightTitleSub: null, rightBody: "I had thought, at Birtwick, that life was kind. I had thought, with Jerry, that even hard life could be gentle. Now I knew it could be cruel too. Friday came. I was led to the horse fair with the others — all thin, all tired, all almost at the end.", rightIsTitle: false, cue: "Will anyone be kind?", nanaPrompt: "Ask Perry: have you ever hoped — even when you didn't quite believe? Sometimes that's all there is." },
        ],
      },
      {
        id: "ch10-last-home",
        title: "Chapter 10 · My Last Home",
        summary: "A tired old horse at a fair catches the eye of a kind farmer. Slowly mended in a country meadow, Beauty finds his very last home — and a familiar face waiting.",
        question: "What part of Beauty's whole story do you think you'll remember the longest?",
        pages: [
          { leftEmoji: "🐴", leftChapter: "Chapter 10 · My Last Home", leftBody: "The horse fair was a noisy place. Dealers shouted. Crowds of buyers walked up and down, looking at one horse and then another. We stood in a long, sad line. The thin ones, like me, were tied at the cheap end of the field, where the prices were lowest.", rightTitle: null, rightTitleSub: null, rightBody: "Most of the men who came to look were rough sorts. They poked our ribs and stared into our mouths and shook their heads. I lowered my eyes. I had no hope left in the day. I only wanted it to be over, whatever 'over' would mean. I did not look up at all.", rightIsTitle: false, cue: "Has Beauty given up?", nanaPrompt: "Ask Perry: have you ever felt so tired you didn't want to look up? It's okay to have those days. What helps you raise your head again?" },
          { leftEmoji: "👴", leftChapter: "Chapter 10 · My Last Home", leftBody: "Then a quiet voice spoke close beside me. 'There's some good in this one yet,' it said. I lifted my head — just a little — and saw a tall old gentleman in a wide hat. He had a kind, weathered face. He ran his hand slowly along my neck and looked into my eyes.", rightTitle: null, rightTitleSub: null, rightBody: "A boy was with him — his grandson, no older than twelve. 'Grandfather,' the boy said, 'his eye is bright. Look — he sees us.' The old man nodded. 'Yes. There is still spirit there. He has been a fine horse once. He might be a fine horse again, with care.'", rightIsTitle: false, cue: "Will the kind man buy him?", nanaPrompt: "Ask Perry: how can you tell when someone is really paying attention to you? Show the difference — pretend look, real look." },
          { leftEmoji: "🤝", leftChapter: "Chapter 10 · My Last Home", leftBody: "The old gentleman's name was Mr. Thoroughgood. He had a small farm in the country, and he often came to the fair to look for tired horses he could make whole again. He offered the dealer a fair price. The dealer agreed gladly, for I was worth almost nothing to him.", rightTitle: null, rightTitleSub: null, rightBody: "Mr. Thoroughgood led me out himself, walking slowly, talking to me in a calm, gentle voice. The boy walked along the other side. They led me to a quiet meadow not far from the fair, and there they let me loose. The grass under my hooves was so soft I could hardly believe it.", rightIsTitle: false, cue: "Is this a dream?", nanaPrompt: "Ask Perry: when something wonderful happens after a hard time, sometimes it feels too good to be true. Tell her about a time you felt that way." },
          { leftEmoji: "🌾", leftChapter: "Chapter 10 · My Last Home", leftBody: "I lived at Mr. Thoroughgood's small farm for many months. There was no work at first — only good grass, sweet hay, and quiet days. The boy came every day to brush me and to bring me apples. Slowly, my coat began to shine again. My ribs filled out. My eye grew bright.", rightTitle: null, rightTitleSub: null, rightBody: "Mr. Thoroughgood would stand at the fence and watch me grazing. 'He is becoming himself again,' he would say to the boy. 'A horse like this should not end his days pulling a heavy cab. He should end them with people who will love him.' And he set himself to find such a home.", rightIsTitle: false, cue: "What kind of new home?", nanaPrompt: "Ask Perry: who are the people in your life who would love you no matter what? Tell her about them." },
          { leftEmoji: "🏡", leftChapter: "Chapter 10 · My Last Home", leftBody: "Word came one day of three ladies — sisters — who lived in a country house and wanted a gentle horse. They would not need him to work hard; only to carry one of them on quiet rides, or to pull their little carriage to church on Sundays. They were known for their kindness.", rightTitle: null, rightTitleSub: null, rightBody: "Mr. Thoroughgood drove me to their house himself. The three ladies came out — one tall, one round, one small — and they gathered round me. They patted my neck and looked into my eyes and ran their soft hands along my sides. 'Oh,' said the tall one, 'he is a perfect dear.'", rightIsTitle: false, cue: "Do they like him?", nanaPrompt: "Ask Perry: imagine you are the horse. How does it feel to be looked at with such kind eyes? Try it with her — soft eyes!" },
          { leftEmoji: "👀", leftChapter: "Chapter 10 · My Last Home", leftBody: "They led me round to the stable. A young groom came out, smiling, to take charge of me. He looked at me carefully, then his eyes grew wide. He looked again. He bent down, parted my forelock, and looked at the white star on my forehead — and at my old white sock.", rightTitle: null, rightTitleSub: null, rightBody: "'It can't be,' he whispered. 'Black Beauty. It can't be.' His voice was quiet and full of wonder. The three ladies looked at him in surprise. He turned to them. 'Ma'am,' he said, 'I think I know this horse. I think — yes — this is Black Beauty, from Birtwick Park.'", rightIsTitle: false, cue: "Who is this groom?", nanaPrompt: "Ask Perry: have you ever met someone you knew long ago, who you hadn't seen for years? What was that like?" },
          { leftEmoji: "🌟", leftChapter: "Chapter 10 · My Last Home", leftBody: "His name was Joe Green. He had been the stable boy at Birtwick when I was a young horse. He had grown up since then — but I remembered him at once. I bent my head to his shoulder and breathed in the familiar smell of him. He laughed and cried at the same time.", rightTitle: null, rightTitleSub: null, rightBody: "'I always wondered what happened to you,' he said. 'I have been looking for you for years.' He told the ladies all about me — the night of the storm, the fire at the inn, my brave kind days at Birtwick. The ladies listened with shining eyes, and at the end they patted me gently.", rightIsTitle: false, cue: "Is Beauty finally home?", nanaPrompt: "Ask Perry: imagine being recognized by someone who loved you long ago. That's the best kind of welcome." },
          { leftEmoji: "🌅", leftChapter: "Chapter 10 · My Last Home", leftBody: "And so I came at last to my final home. The work is gentle. The meadows are wide. The ladies are kind, and Joe is always near. Sometimes, when I am dozing in the sun, my mother's old advice drifts through my mind: do your best, keep up your good name, be gentle.", rightTitle: null, rightTitleSub: null, rightBody: "I have had a long life — and a hard one in places. But I have known many good people, and a few brave ones, and I have loved them all. I am only an old black horse with a white star, and one white foot. But I have done my best. And here, at the end, I am home.", rightIsTitle: false, cue: "Did Beauty get his happy ending?", nanaPrompt: "Hug Perry. Ask: what was your favorite part of Beauty's story? What part will you remember the longest?" },
        ],
      },
    ],
  ),
};

/* ─── Book content — true two-page open-book spread ─────── */

/**
 * Splits a body string into word-level spans, each tagged with a stable
 * `data-w` attribute. The reading-mode tap handler uses these tags to
 * identify exactly which word Nana pointed at, then both screens highlight
 * the same word — far more useful than a generic "Nana pointed somewhere"
 * dot.
 */
function WordWrapped({
  text,
  side,
  highlightIndex,
}: {
  text: string;
  side: "L" | "R";
  highlightIndex: number | null;
}) {
  // Split keeps both words AND whitespace so spacing is preserved exactly.
  const tokens = text.split(/(\s+)/);
  let wordIdx = -1;
  return (
    <>
      {tokens.map((tok, i) => {
        if (/^\s+$/.test(tok)) return tok;
        wordIdx += 1;
        const idx = wordIdx;
        const active = highlightIndex === idx;
        return (
          // `key` is stable per-word-index so the span identity (and any
          // React-internal event-handler bindings) survive re-renders
          // when font-scale or theme changes. Rick: "did not work at
          // all after the initial test" — we want to rule out handler
          // tear-off as a cause.
          <span
            key={`${side}-${idx}`}
            data-w={`${side}-${idx}`}
            style={{
              // Brighter highlight in the night theme (suppression of
              // the gold over very dark page backgrounds was visually
              // ambiguous — Rick wondered if "nighttime theme affected
              // the word tap targets").
              backgroundColor: active ? "rgba(255,201,80,0.78)" : "transparent",
              color: active ? "#1B2B4B" : undefined,
              borderRadius: 4,
              padding: "2px 3px",
              margin: "0 -1px",
              cursor: "pointer",
              touchAction: "manipulation",
              // We only suppress the iOS long-press callout (Look Up /
              // Search Web). `user-select: none` is intentionally NOT
              // set here because on iOS Safari it sometimes prevents
              // click events from firing on `<span>` children of a
              // tappable parent — which was the leading hypothesis for
              // word taps "stopping working" mid-session.
              WebkitTouchCallout: "none",
              transition: "background-color 180ms ease, color 180ms ease",
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            {tok}
          </span>
        );
      })}
    </>
  );
}

interface WordHighlightState {
  page: number;
  side: "L" | "R";
  index: number;
  ts: number;
}

function BookContent({
  page,
  bookPages,
  bookTitle,
  fontScale = 1,
  wordHighlight = null,
  theme = "day",
  pageMode = "double",
  pageSide = "L",
  chunkSize = 1,
}: {
  page: number;
  bookPages: BookPage[];
  bookTitle: string;
  fontScale?: number;
  wordHighlight?: WordHighlightState | null;
  theme?: ReadingTheme;
  /** "double" = open-book spread (both pages side-by-side). "single" =
   *  one page at a time; advancePage in single mode flips through L → R
   *  → next-spread-L so each tap shows one page. */
  pageMode?: "single" | "double";
  /** Which page of the spread is visible in single mode. Ignored in
   *  double mode. */
  pageSide?: "L" | "R";
  /** Wish 2: number of source pages to merge into one displayed spread.
   *  Default 1 (no chunking — historical behavior). When > 1, the
   *  displayed left column gets the first ceil(N/2) source pages'
   *  bodies joined; right column gets the rest. Title pages and
   *  in-chunk chapter heading collisions defer to the first source
   *  page's metadata. */
  chunkSize?: number;
}) {
  const themeColors = READING_THEMES[theme];
  // Diagnostic log so we can see exactly what BookContent renders with —
  // Rick reported "not syncing to perry" while all chain logs (publish,
  // server receive, server broadcast, perry SSE receive) confirmed the
  // state update fired. If pageMode here disagrees with what perry-sse
  // logged, props aren't reaching the render; if it agrees but the right
  // page still shows, the condition logic is wrong.
  // eslint-disable-next-line no-console
  console.log(`[BookContent] render pageMode=${pageMode} pageSide=${pageSide} page=${page}`);
  // Clamp the requested page index into the actual book's range. Without
  // this, an out-of-range `page` (e.g. cached page=10 from a different
  // book, or a stale state from before a Phase C page-split) returns
  // `undefined` and renders a blank page — Rick's "blank G-page" report.
  const safePage = Math.max(1, Math.min(page, bookPages.length));
  // Chunk assembly. When `chunkSize > 1` we pack consecutive source
  // pages into one displayed spread. The synthesized "page" reuses the
  // first source page's metadata (chapter heading, emoji, rightIsTitle
  // flag) and concatenates bodies so the left column gets the front
  // half and the right column the back half of the chunk.
  const chunkPages: BookPage[] = (() => {
    const n = Math.max(1, chunkSize);
    if (n <= 1) return [bookPages[safePage - 1] ?? bookPages[0]];
    const slice = bookPages.slice(safePage - 1, Math.min(safePage - 1 + n, bookPages.length));
    return slice.length ? slice : [bookPages[safePage - 1] ?? bookPages[0]];
  })();
  const first = chunkPages[0];
  const isTitleSpread = !!first.rightIsTitle;
  // Title spreads (cover) are intentionally sparse — never chunk them.
  const effectiveChunk = isTitleSpread ? [first] : chunkPages;
  // Split the chunk's body halves evenly across left/right columns.
  // For 1 source page: behave exactly as before (leftBody / rightBody).
  // For ≥2 source pages: each source page contributes both halves as
  // sentence runs joined with a single space; midpoint of the combined
  // half list goes between the two columns. Examples:
  //   N=2 → left = p0.left + p0.right, right = p1.left + p1.right
  //   N=3 → left = p0.left + p0.right + p1.left, right = p1.right + p2.left + p2.right
  const p: BookPage = (() => {
    if (effectiveChunk.length <= 1) return first;
    const halves: string[] = [];
    for (const sp of effectiveChunk) {
      if (sp.leftBody)  halves.push(sp.leftBody);
      if (sp.rightBody) halves.push(sp.rightBody);
    }
    const mid = Math.ceil(halves.length / 2);
    const join = (xs: string[]) => xs.join(" ").trim();
    return {
      ...first,
      leftBody:  join(halves.slice(0, mid)),
      rightBody: join(halves.slice(mid)),
    };
  })();
  // Page-number labels: show a range when the chunk spans multiple
  // source pages so the reader sees "12–15" instead of just "12".
  const chunkLastSourcePage = safePage + effectiveChunk.length - 1;
  const leftPageNum  = safePage === 1 ? null : (safePage - 1) * 2;
  const rightPageNum = safePage === 1 ? null : (chunkLastSourcePage - 1) * 2 + 1;
  const bodyFs = fontScale >= 1.5 ? "clamp(16px, 2.4vw, 22px)" : fontScale >= 1.25 ? "clamp(13px, 1.8vw, 17px)" : "clamp(10px, 1.3vw, 13px)";
  const headFs = fontScale >= 1.5 ? "clamp(20px, 2.8vw, 30px)" : fontScale >= 1.25 ? "clamp(17px, 2.4vw, 25px)" : "clamp(14px, 2vw, 20px)";
  const subFs  = fontScale >= 1.5 ? "clamp(14px, 1.8vw, 18px)" : fontScale >= 1.25 ? "clamp(12px, 1.6vw, 16px)" : "clamp(10px, 1.35vw, 13px)";

  const leftRef = useRef<HTMLParagraphElement>(null);
  const rightRef = useRef<HTMLParagraphElement>(null);

  // Apply fontScale and auto-shrink symmetrically until BOTH pages fit.
  //
  // History: an earlier asymmetric loop shrank only the longer page —
  // Rick: "font only changes the left page." That was fixed by removing
  // the loop and hard-coding 100/125/150%. But on iPad mini and other
  // smaller tiles, 150% pushed long bodies past the page bottom — and
  // because the body container is `overflow: hidden`, the last lines
  // silently vanished (Rick: "large font cuts off lines at the bottom").
  //
  // This version starts at the user's target scale, then steps DOWN in
  // 5% increments (applied to BOTH pages in lockstep) until neither
  // container overflows. Floor at 70% so even worst-case dense pages on
  // iPad mini fit; text is still legible at 70% × 16px ≈ 11px. Same
  // scale on both sides → page-turn sync invariant preserved.
  //
  // Ultimate fallback: if even the 70% floor still overflows (very rare
  // — would require a page exceeding any reasonable iPad render area),
  // toggle the body container to `overflow-y: auto` so the last lines
  // become scrollable instead of silently hidden. Restored to default
  // (CSS-inherited hidden) on the next render where content fits.
  useEffect(() => {
    const target = fontScale >= 1.5 ? 150 : fontScale >= 1.25 ? 125 : 100;
    const apply = (pct: number) => {
      if (leftRef.current)  leftRef.current.style.fontSize  = `${pct}%`;
      if (rightRef.current) rightRef.current.style.fontSize = `${pct}%`;
    };
    const containers = () =>
      ([leftRef.current, rightRef.current]
        .filter(Boolean) as HTMLElement[])
        .map(p => p.parentElement)
        .filter(Boolean) as HTMLElement[];
    const overflows = () =>
      // +1px slack absorbs sub-pixel rounding so we don't churn at
      // a "fits exactly" boundary.
      containers().some(c => c.scrollHeight > c.clientHeight + 1);
    let scale = target;
    apply(scale);
    let attempts = 0;
    while (overflows() && scale > 70 && attempts < 18) {
      scale -= 5;
      apply(scale);
      attempts += 1;
    }
    // Wish 2 polish: if NEITHER container overflows AND at least one is
    // significantly under-filled (body uses <65% of available height),
    // step up to fill the page so chapter books don't look sparse.
    // Cap at 160% — anything bigger pushes past the visual character of
    // a book page. Skip on title spreads (those are intentionally airy).
    const underFilled = () => {
      const cs = containers();
      if (cs.length === 0) return false;
      // Treat "fills less than 65%" as significant whitespace worth
      // closing. Title pages render `rightIsTitle` and have their own
      // ornament layout — leftRef/rightRef aren't used there, so cs
      // will be empty and this branch never fires.
      return cs.every(c => c.scrollHeight < c.clientHeight * 0.65);
    };
    if (!overflows() && underFilled()) {
      let growAttempts = 0;
      while (underFilled() && scale < 160 && growAttempts < 12) {
        scale += 5;
        apply(scale);
        growAttempts += 1;
      }
      // If grow pushed into overflow on the last step, back off one.
      if (overflows() && scale > 70) {
        scale -= 5;
        apply(scale);
      }
    }
    // Scroll fallback only when the floor wasn't enough.
    containers().forEach(c => {
      c.style.overflowY = c.scrollHeight > c.clientHeight + 1 ? "auto" : "";
    });
  }, [page, fontScale, p?.leftBody, p?.rightBody, p?.rightIsTitle]);

  return (
    <div style={{
      display: "flex", width: "100%", height: "100%",
      boxShadow: "0 8px 32px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.3)",
      position: "relative",
    }}>
      {/* Premium book typography settings — applied via class so both
          pages and the chapter heading inherit consistent hyphenation,
          ligatures, and legibility hints. Keeps the iPad rendering
          closer to a real eReader (Rick: "the book feel matters"). */}
      <style>{`
        .nm-book-page {
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          font-feature-settings: "kern", "liga", "clig", "calt", "onum", "dlig";
          font-variant-numeric: oldstyle-nums;
        }
        .nm-book-body {
          hyphens: auto;
          -webkit-hyphens: auto;
          word-spacing: 0.01em;
          letter-spacing: 0.005em;
        }
        /* Subtle parchment grain — only visible on day/sepia, invisible on night */
        .nm-book-page::before {
          content: "";
          position: absolute; inset: 0;
          background-image: radial-gradient(rgba(92,58,30,0.022) 1px, transparent 1px);
          background-size: 3px 3px;
          pointer-events: none;
          opacity: 0.55;
        }
        .nm-book-page-night::before { display: none; }
        /* Subtle warm vignette toward the spine for depth — invisible on night */
        .nm-book-page::after {
          content: "";
          position: absolute; inset: 0;
          background: linear-gradient(to right, transparent 70%, rgba(92,58,30,0.05) 100%);
          pointer-events: none;
        }
        .nm-book-page-right::after {
          background: linear-gradient(to left, transparent 70%, rgba(92,58,30,0.05) 100%) !important;
        }
        .nm-book-page-night::after { display: none !important; }

        /* Drop cap — real publishing convention: first letter of the
           first paragraph on a chapter/title body is enlarged, embossed
           into 3 lines of text. Only applied where the parent has
           .nm-book-dropcap so we don't mid-paragraph drop-cap regular
           pages. */
        .nm-book-dropcap > *:first-child::first-letter {
          font-family: "Playfair Display", serif;
          font-weight: 700;
          font-size: 3.4em;
          float: left;
          line-height: 0.9;
          padding: 0.06em 0.08em 0 0;
          margin-right: 0.04em;
          color: var(--nm-dropcap, #5C3A1E);
        }

        /* ── Per-layout book treatments — make the book ITSELF look
           visibly different in each layout, not just the chrome. ── */

        /* IMMERSIVE — Looser leading and dimmed running header so the
           book breathes more. The body font itself stays user-controlled
           (the JS auto-shrink in BookContent sets inline font-size from
           fontScale; if we !important-bumped it here it would override
           the S/M/L/XL picker for this layout only). The big visual
           identity for immersive — full-bleed book with no inline
           sidebar — lives in the layout JSX below, not in CSS. */
        [data-bk-layout="immersive"] .nm-book-body {
          line-height: 1.78 !important;
        }
        [data-bk-layout="immersive"] .nm-book-page > div:first-of-type {
          opacity: 0.35 !important;
        }

        /* STORYTIME — Slightly tighter line-height (book takes less
           vertical space because banner is on top). Cool sage page. */
        [data-bk-layout="storytime"] .nm-book-page {
          background-color: #ecefe2 !important;
        }
        [data-bk-layout="storytime"] .nm-book-body {
          line-height: 1.6 !important;
        }

        /* COZY — Deep sepia parchment, warm brown ink, heavier inset
           shadow. Reads like a leather-bound novel. */
        [data-bk-layout="cozy"] .nm-book-page {
          background-color: #e8d4a0 !important;
          color: #3a2a14 !important;
          box-shadow: inset -10px 0 22px rgba(82,48,20,0.35) !important;
        }
        [data-bk-layout="cozy"] .nm-book-page-right {
          box-shadow: inset 10px 0 22px rgba(82,48,20,0.35) !important;
        }
        [data-bk-layout="cozy"] .nm-book-body { color: #3a2a14 !important; }

        /* KIDS — Pastel-tinted pages (pink left, mint right), rounder
           feel, pastel ink. Friendly and gamified. */
        [data-bk-layout="kids"] .nm-book-page {
          background-color: #fef0f5 !important;
        }
        [data-bk-layout="kids"] .nm-book-page-right {
          background-color: #f0faf2 !important;
        }
        [data-bk-layout="kids"] .nm-book-page::before,
        [data-bk-layout="kids"] .nm-book-page::after { display: none !important; }
        [data-bk-layout="kids"] .nm-book-body {
          line-height: 1.75 !important;
          letter-spacing: 0.005em !important;
        }
      `}</style>

      {/* ── LEFT PAGE ──
          In single-page mode we hide the left page when pageSide==="R",
          and let it grow to fill the frame when pageSide==="L". Spine
          + right page are hidden symmetrically below. We keep the page-1
          (cover) special case from collapsing — there the right side is
          the title page and the left has no content, so we always show
          the right in single mode regardless of pageSide. */}
      {!(pageMode === "single" && (pageSide === "R" || safePage === 1)) && (
      <div className={`nm-book-page${theme === "night" ? " nm-book-page-night" : ""}`} style={{
        position: "relative",
        flex: 1, backgroundColor: themeColors.page,
        display: "flex", flexDirection: "column",
        padding: "10px 14px 10px 18px",
        boxShadow: `inset -5px 0 14px ${themeColors.spineShadow}`,
        overflow: "hidden",
        transition: "background-color 240ms ease",
      }}>
        {/* Running header — small caps, refined letter-spacing */}
        <div style={{ borderBottom: `1px solid ${LEATHER}`, paddingBottom: "4px", marginBottom: "10px", display: "flex", justifyContent: "center", opacity: 0.55 }}>
          <span style={{ color: LEATHER, fontFamily: "Merriweather, serif", fontSize: "9px", fontStyle: "italic", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            {bookTitle}
          </span>
        </div>

        {/* Illustration motif — small, centered, no boxed frame.
            Mirrors the printed-book convention of a small spot
            illustration above a chapter opener (Rick / NOOK feedback:
            "the book remains central, no clutter"). */}
        <div style={{
          textAlign: "center",
          margin: "0 0 6px",
          padding: 0,
        }}>
          <span style={{
            fontSize: "clamp(36px, 5.4vw, 56px)",
            lineHeight: 1,
            display: "inline-block",
            letterSpacing: "-2px",
            opacity: 0.88,
            filter: theme === "night" ? "none" : "saturate(0.85)",
          }}>{p.leftEmoji}</span>
        </div>

        {/* Chapter heading — small caps eyebrow for "Chapter X" + serif
            italic title + ornamental rule. Closer to a printed chapter
            opener than a dashboard heading. */}
        {p.leftChapter && (() => {
          const parts = p.leftChapter.split(" · ");
          const chapterNum  = parts.length > 1 ? parts[0] : null;
          const chapterName = parts.length > 1 ? parts.slice(1).join(" · ") : p.leftChapter;
          return (
            <div style={{ textAlign: "center", marginBottom: "12px" }}>
              {chapterNum && (
                <span style={{ display: "block", color: LEATHER, fontFamily: "Merriweather, serif", fontSize: "10px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: "6px", opacity: 0.65 }}>
                  {chapterNum}
                </span>
              )}
              <span style={{ display: "block", color: BOOK_TEXT, fontFamily: "Playfair Display, serif", fontSize: headFs, fontWeight: 700, lineHeight: 1.15, marginBottom: "4px", letterSpacing: "0.005em" }}>
                {chapterName}
              </span>
              {/* Ornamental rule — tiny diamond between two short lines */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8, opacity: 0.45 }}>
                <span style={{ width: 24, height: 1, backgroundColor: LEATHER }} />
                <span style={{ color: LEATHER, fontSize: 8, transform: "translateY(-1px)" }}>◆</span>
                <span style={{ width: 24, height: 1, backgroundColor: LEATHER }} />
              </div>
            </div>
          );
        })()}

        {/* Left page body text — `overflow: hidden` is intentional.
            Source data is paginated such that every page's body fits at
            the largest font scale (1.5x). Smaller font sizes naturally
            leave whitespace at the bottom; nothing gets clipped because
            no page exceeds the 1.5x capacity. This is what makes page
            turns sync identically regardless of which font size each
            side picked (Rick: "everyone always sees the same lines per
            page and turns at exactly the same point — regardless of
            which font size they have chosen"). */}
        <div className={p.leftChapter ? "nm-book-dropcap" : undefined} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", zIndex: 1 }}>
          <p ref={leftRef} className="book-body nm-book-body" style={{
            color: themeColors.text,
            margin: 0,
            opacity: 0.96,
            textAlign: "justify",
            textJustify: "inter-word",
            animation: "page-arrived 280ms ease-out",
            transition: "color 240ms ease",
          }}>
            <WordWrapped
              text={p.leftBody}
              side="L"
              highlightIndex={
                wordHighlight && wordHighlight.page === page && wordHighlight.side === "L"
                  ? wordHighlight.index
                  : null
              }
            />
          </p>
          {/* End-of-section fleuron — small printed-book ornament that
              fills the empty space when body doesn't reach the gutter.
              Soft enough to feel like a real chapter break. */}
          <div aria-hidden style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 10, opacity: 0.32, marginTop: "auto", paddingTop: 12,
            color: LEATHER, fontSize: 14,
          }}>
            <span style={{ width: 28, height: 1, backgroundColor: LEATHER }} />
            ❦
            <span style={{ width: 28, height: 1, backgroundColor: LEATHER }} />
          </div>
        </div>

        {/* Page number — centered, refined */}
        {leftPageNum && (
          <div style={{ textAlign: "center", marginTop: 4, position: "relative", zIndex: 1 }}>
            <span style={{ color: LEATHER, fontFamily: "Merriweather, serif", fontSize: 9, opacity: 0.5, letterSpacing: "0.1em", fontVariantNumeric: "oldstyle-nums" }}>· {leftPageNum} ·</span>
          </div>
        )}
      </div>
      )}

      {/* ── SPINE ── only between two visible pages. Always shown in
          double mode (including cover, which historically rendered the
          spine even with the blank-ish left side). In single mode the
          off-side page is hidden, so the spine has nothing to bisect. */}
      {pageMode === "double" && (
      <div style={{
        width: "4px", flexShrink: 0,
        backgroundColor: themeColors.spine,
        boxShadow: "-3px 0 8px rgba(0,0,0,0.18), 3px 0 8px rgba(0,0,0,0.18)",
        transition: "background-color 240ms ease",
      }} />
      )}

      {/* ── RIGHT PAGE ── hidden in single mode when pageSide==="L"
          (except on the cover page, where the right side IS the content
          and we always render it). */}
      {!(pageMode === "single" && pageSide === "L" && safePage !== 1) && (
      <div className={`nm-book-page nm-book-page-right${theme === "night" ? " nm-book-page-night" : ""}`} style={{
        position: "relative",
        flex: 1, backgroundColor: themeColors.page,
        display: "flex", flexDirection: "column",
        padding: "10px 18px 10px 14px",
        boxShadow: `inset 5px 0 14px ${themeColors.spineShadow}`,
        overflow: "hidden",
        transition: "background-color 240ms ease",
      }}>
        {/* Running header — author from page 1 subtitle, stripped of "by " */}
        <div style={{ borderBottom: `1px solid ${LEATHER}`, paddingBottom: "4px", marginBottom: "10px", display: "flex", justifyContent: "center", opacity: 0.55 }}>
          <span style={{ color: LEATHER, fontFamily: "Merriweather, serif", fontSize: "9px", fontStyle: "italic", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            {(bookPages[0]?.rightTitleSub ?? "").replace(/^by\s*/i, "")}
          </span>
        </div>

        {/* Right page content — see left-page comment above; same
            `overflow: hidden` contract: source data is paginated so
            content always fits at 1.5x. */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", overflow: "hidden" }}>
          {p.rightIsTitle ? (
            <>
              <h2 style={{ color: BOOK_TEXT, fontFamily: "Playfair Display, serif", fontSize: headFs, fontWeight: 700, textAlign: "center", marginBottom: 8, marginTop: 14, lineHeight: 1.2, letterSpacing: "0.005em" }}>
                {p.rightTitle}
              </h2>
              <p style={{ color: LEATHER, fontStyle: "italic", fontFamily: "Merriweather, serif", fontSize: subFs, textAlign: "center", marginBottom: 14, opacity: 0.8 }}>
                {p.rightTitleSub}
              </p>
              {/* Ornamental rule */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, margin: "4px auto 16px", opacity: 0.4 }}>
                <span style={{ width: 36, height: 1, backgroundColor: LEATHER }} />
                <span style={{ color: LEATHER, fontSize: 9, transform: "translateY(-1px)" }}>◆</span>
                <span style={{ width: 36, height: 1, backgroundColor: LEATHER }} />
              </div>
              <p className="nm-book-body" style={{ color: BOOK_TEXT, fontFamily: "Merriweather, serif", fontSize: bodyFs, lineHeight: 1.85, textAlign: "center", opacity: 0.92 }}>
                {p.rightBody}
              </p>
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", zIndex: 1 }}>
              <p ref={rightRef} className="book-body nm-book-body" style={{
                color: themeColors.text,
                margin: 0,
                opacity: 0.96,
                textAlign: "justify",
                textJustify: "inter-word",
                animation: "page-arrived 280ms ease-out",
                transition: "color 240ms ease",
              }}>
                <WordWrapped
                  text={p.rightBody}
                  side="R"
                  highlightIndex={
                    wordHighlight && wordHighlight.page === page && wordHighlight.side === "R"
                      ? wordHighlight.index
                      : null
                  }
                />
              </p>
              {/* End ornament — same fleuron when there's empty space below body */}
              <div aria-hidden style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 10, opacity: 0.32, marginTop: "auto", paddingTop: 12,
                color: LEATHER, fontSize: 14,
              }}>
                <span style={{ width: 28, height: 1, backgroundColor: LEATHER }} />
                ❦
                <span style={{ width: 28, height: 1, backgroundColor: LEATHER }} />
              </div>
            </div>
          )}
        </div>

        {/* Page number — centered, refined */}
        {rightPageNum && (
          <div style={{ textAlign: "center", marginTop: 4, position: "relative", zIndex: 1 }}>
            <span style={{ color: LEATHER, fontFamily: "Merriweather, serif", fontSize: 9, opacity: 0.5, letterSpacing: "0.1em", fontVariantNumeric: "oldstyle-nums" }}>· {rightPageNum} ·</span>
          </div>
        )}
      </div>
      )}

    </div>
  );
}

/* ─── Chat Mode — fills device frame with video ──────────── */

function ChatModePrompt({ text, fontScale = 1 }: { text: string; fontScale?: number }) {
  const m = text.match(/^(Ask|Tell|Quiz|Give)\s+Perry\s*[:\s]/i);
  const prefix = m ? m[0].replace(/\s*[:\s]+$/, '').trim() : null;
  const body   = m ? text.slice(m[0].length).trim() : text;
  const rawParts = body.split('? ');
  const sentences = rawParts
    .map((p, i) => (i < rawParts.length - 1 ? p.trim() + '?' : p.trim()))
    .filter(p => p.length > 0);
  // Scale base font sizes by fontScale (Rick: "Please add an
  // adjustable font size option in chat mode. There's ample screen
  // real estate and larger text would significantly improve usability
  // for users who wear reading glasses.")
  const baseSize = 15 * fontScale;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "14px", overflow: "auto" }}>
      {prefix && (
        <span style={{ color: "rgba(201,146,42,0.45)", fontFamily: "Merriweather, serif", fontSize: baseSize, fontWeight: 600, fontStyle: "italic" }}>
          {prefix}
        </span>
      )}
      {sentences.map((s, i) => (
        <p key={i} style={{ color: CREAM, fontFamily: "Merriweather, serif", fontSize: baseSize, fontWeight: 700, lineHeight: 1.55, margin: 0 }}>
          {s}
        </p>
      ))}
    </div>
  );
}

/**
 * NEED 1 — prominent Home control rendered consistently on every screen
 * where Nana would otherwise have to navigate "forward" to escape.
 *
 * Rick: "Every screen needs a prominent Home button — not a small icon
 * at the top, but something visible and deliberate, consistent with the
 * Home button treatment on the Memory Vault page."
 *
 * Pill rather than full TileButton because most gap screens have an
 * existing primary CTA (Pick a Book, End Goodbye, Back to Reading)
 * that should still own the visual weight. Home is the SECONDARY
 * escape — deliberately styled, always discoverable, never a tiny
 * top-right icon.
 *
 * Returns null when no onClick is provided so callers can safely do
 * `<ProminentHomePill onClick={isNana ? onGoHome : undefined} />`
 * without conditional rendering boilerplate at every callsite.
 */
function ProminentHomePill({
  onClick,
  label = "Home",
}: {
  onClick?: () => void;
  label?: string;
}) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "rgba(247,201,93,0.10)",
        color: AMBER,
        border: "1px solid rgba(247,201,93,0.45)",
        borderRadius: 999,
        padding: "11px 20px",
        fontFamily: "DM Sans, sans-serif",
        fontSize: "clamp(13px, 1.55vw, 15px)",
        fontWeight: 800,
        letterSpacing: "0.04em",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: 44,
        touchAction: "manipulation",
      }}
    >
      <span aria-hidden style={{ fontSize: 16 }}>🏠</span>
      <span>{label}</span>
    </button>
  );
}

function ChatModeView({
  isNana,
  nanaPromptText,
  onStartReading,
  childName,
  nanaName,
  fontScale = 1,
  onCycleFontScale,
  onGoHome,
}: {
  isNana: boolean;
  nanaPromptText: string;
  onStartReading: () => void;
  childName: string;
  nanaName: string;
  fontScale?: number;
  onCycleFontScale?: () => void;
  /** NEED 1 — direct Home escape from the chat overlay; high-severity
   *  gap (audit). Previously Nana had to tap Back→Reading then Home. */
  onGoHome?: () => void;
}) {
  const videoName = isNana ? (childName || getRoleLabel("child")) : (nanaName || getRoleLabel("nana"));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden" }}>

      {/* ── LEFT: Workspace panel ───────────────────────────── */}
      <div style={{ width: "44%", display: "flex", flexDirection: "column", backgroundColor: "#0b172e", padding: "14px 12px 14px", gap: "12px", borderRight: "1px solid rgba(255,255,255,0.08)", overflow: "hidden", flexShrink: 0 }}>

        {/* Book badge — decorative book-spine icon. Title is announced via aria-label. */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            role="img"
            aria-label="Charlotte's Web"
            style={{ backgroundColor: PARCHMENT, border: `2px solid ${LEATHER}`, borderRadius: "5px", width: "28px", height: "35px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <span style={{ fontSize: "16px", lineHeight: 1 }} aria-hidden>🕷️</span>
          </div>
          <span style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1.3 }}>
            {isNana ? "📖 READING PROMPT" : "📖 STORY TIME CHAT"}
          </span>
        </div>

        {/* Main prompt / message */}
        {isNana ? (
          <ChatModePrompt text={nanaPromptText} fontScale={fontScale} />
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "10px" }}>
            <span style={{ fontSize: 32 * fontScale, textAlign: "center" }}>👂</span>
            <p style={{ color: "rgba(134,239,172,0.95)", fontFamily: "Merriweather, serif", fontSize: 16 * fontScale, fontWeight: 700, lineHeight: 1.6, margin: 0, textAlign: "center" }}>
              Nana has a question about the story!
            </p>
            <p style={{ color: "rgba(255,255,255,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: 11 * fontScale, margin: 0, textAlign: "center", lineHeight: 1.4 }}>
              Listen carefully and tell her what you think.
            </p>
          </div>
        )}

        {/* Primary actions — Nana only. Rick: "a young child could tap
            it accidentally on Perry's side." Perry just sees the prompt
            and listens; Nana drives the navigation. */}
        {isNana && (
          <>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, flexShrink: 0 }}>
              <TileButton
                icon="←"
                label="Back to"
                sublabel="Reading"
                tone="primary"
                size="md"
                onClick={onStartReading}
              />
              {onCycleFontScale && (
                <TileButton
                  icon={`A${fontScale >= 1.5 ? "﹢﹢" : fontScale >= 1.25 ? "﹢" : ""}`}
                  label="Font"
                  sublabel={fontScale >= 1.5 ? "X-Large" : fontScale >= 1.25 ? "Large" : fontScale >= 1 ? "Medium" : "Small"}
                  tone="secondary"
                  size="md"
                  onClick={onCycleFontScale}
                  ariaLabel="Cycle chat font size"
                />
              )}
            </div>
            {/* NEED 1 — direct Home pill. Previously Nana had to chain
                Back→Reading then Home (2 taps); now it's one. */}
            <div style={{ display: "flex", justifyContent: "center", flexShrink: 0 }}>
              <ProminentHomePill onClick={onGoHome} />
            </div>
          </>
        )}

      </div>

      {/* ── RIGHT: Live video panel ──────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <FaceVideo
          person={isNana ? "child" : "nana"}
          width="100%"
          height="100%"
          showLabel={false}
          hideQualityDot
          borderRadius={0}
          autoMirror={false}
          style={{ border: "none", boxShadow: "none" }}
        />
        <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.12) 0%, transparent 30%, transparent 65%, rgba(0,0,0,0.65) 100%)", pointerEvents: "none" }} />
        {/* Name + live dot */}
        <div style={{ position: "absolute", bottom: "14px", left: "12px", display: "flex", alignItems: "center", gap: "7px", zIndex: 10 }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#22c55e", boxShadow: "0 0 8px #22c55e", flexShrink: 0 }} />
          <span style={{ color: "white", fontFamily: "DM Sans, sans-serif", fontSize: "15px", fontWeight: 700, textShadow: "0 1px 8px rgba(0,0,0,0.9)" }}>{videoName}</span>
        </div>
      </div>

    </div>
  );
}

/* ─── Greeting / "Say Hello" View ───────────────────────────
 * Rick: "When both Nana and Perry are logged in, it might be nice if
 * they could see each other briefly and say hello before the book is
 * picked — kind of a 'both cameras on' moment before going to the
 * home screen." Sits between Start Reading and the icebreaker — a 10s
 * soft beat where the structured prompts haven't started yet and the
 * only thing on screen is two faces and a friendly nudge to wave.
 *
 * Auto-advances to icebreaker after the countdown completes; Nana also
 * has an explicit "We're ready →" button to skip ahead. Perry's side
 * has no controls (she just watches and waves) — the transition is
 * driven entirely by Nana's iPad publishing the next phase_change.
 */
function GreetingView({
  isNana,
  childName,
  nanaName,
  onReady,
  onShowPrompts,
  onGoHome,
}: {
  isNana: boolean;
  childName: string;
  nanaName: string;
  /** Nana-side primary action: "Pick a Book →". Routes to library (or
   *  directly to reading if a pre-selected book is set from the home
   *  dashboard). Perry never calls this — she follows via phase_change. */
  onReady: () => void;
  /** Optional secondary path that drops into the icebreaker view with
   *  rotating conversation prompts. Preserves the warm-up feature for
   *  pairs that want it; not a forced step. */
  onShowPrompts?: () => void;
  /** NEED 1 — Nana-side escape back to the dashboard. */
  onGoHome?: () => void;
}) {
  const otherName = isNana ? (childName || getRoleLabel("child")) : (nanaName || getRoleLabel("nana"));
  const selfName  = isNana ? (nanaName  || getRoleLabel("nana"))  : (childName || getRoleLabel("child"));
  // Rick: "I would prefer Nana to control when they move from chat to
  // the library, not a timer. This gives them time to say hello, get
  // settled, and then Nana taps a button to move forward when they are
  // ready." The 10-second auto-advance + countdown that used to live
  // here is gone. The screen now sits indefinitely until Nana taps one
  // of the two buttons below. Video stays alive via VideoSessionProvider
  // — no resource concern with leaving the chat open.

  return (
    <div style={{
      flex: 1,
      display: "flex", flexDirection: "column",
      backgroundColor: "#080f1e",
      overflow: "hidden",
    }}>
      {/* Contain mode shows face at natural framing — bigger tile OK now. */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, position: "relative", overflow: "hidden" }}>
        <div style={{ width: "100%", maxWidth: 800, height: "100%", position: "relative" }}>
        <FaceVideoStage
          bigPerson={isNana ? "child" : "nana"}
          pipPerson={isNana ? "nana" : "child"}
          bigName={otherName}
          pipName={selfName}
          // Contain — face at natural framing, dark padding fills any
          // aspect mismatch. Matches the reading-mode "perfect" look.
          bigObjectFit="contain"
        />
        {/* Soft banner — pinned to the top of the video. Copy changed
            from "Say hello to X!" (which felt rushed alongside the
            10s countdown) to "Take your time" — matches the new
            no-timer flow. */}
        <div style={{
          position: "absolute", top: 16, left: "50%",
          transform: "translateX(-50%)",
          zIndex: 5,
          background: "linear-gradient(135deg, rgba(201,146,42,0.95), rgba(141,98,28,0.95))",
          color: NAVY,
          fontFamily: "Playfair Display, serif",
          fontSize: "clamp(15px, 2vw, 19px)",
          fontWeight: 700,
          letterSpacing: "0.02em",
          padding: "9px 18px",
          borderRadius: 999,
          boxShadow: "0 8px 24px rgba(0,0,0,0.45), 0 0 0 1px rgba(247,201,93,0.45)",
          animation: "phase-card-up 0.4s cubic-bezier(0.22,1,0.36,1)",
          display: "inline-flex", alignItems: "center", gap: 10,
          maxWidth: "calc(100% - 32px)",
          textAlign: "center",
        }}>
          <span style={{ fontSize: 20 }}>💬</span>
          <span>Take your time — say hi, get settled.</span>
        </div>
        </div>
      </div>

      {/* Bottom strip — Nana gets two buttons (primary "Pick a Book",
          secondary "Conversation Starters"); Perry gets a friendly
          waiting message. No timer/countdown anywhere. */}
      <div style={{
        flexShrink: 0,
        backgroundColor: "#0b172e",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        padding: "12px 16px 14px",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        flexWrap: "wrap",
      }}>
        {isNana ? (
          <>
            <ProminentHomePill onClick={onGoHome} />
            {onShowPrompts && (
              <button
                onClick={onShowPrompts}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: CREAM,
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 999,
                  padding: "11px 18px",
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: "clamp(12px, 1.5vw, 14px)",
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 8,
                  touchAction: "manipulation",
                  minHeight: 44,
                }}
              >
                <span style={{ fontSize: 15 }}>💬</span>
                <span>Conversation Starters</span>
              </button>
            )}
            <button
              onClick={onReady}
              style={{
                background: "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)",
                color: NAVY,
                border: "none",
                borderRadius: 999,
                padding: "12px 26px",
                fontFamily: "DM Sans, sans-serif",
                fontSize: "clamp(13px, 1.7vw, 16px)",
                fontWeight: 800,
                letterSpacing: "0.04em",
                cursor: "pointer",
                boxShadow: "0 6px 18px rgba(201,146,42,0.42)",
                display: "inline-flex", alignItems: "center", gap: 8,
                touchAction: "manipulation",
                minHeight: 44,
              }}
            >
              <span style={{ fontSize: 17 }}>📚</span>
              <span>Pick a Book</span>
              <span style={{ fontSize: 17 }}>→</span>
            </button>
          </>
        ) : (
          <div style={{
            color: "rgba(247,240,227,0.7)",
            fontFamily: "Merriweather, serif",
            fontSize: 14,
            fontStyle: "italic",
            textAlign: "center",
            lineHeight: 1.4,
          }}>
            👋 {otherName} is here — she'll pick a book when you're ready!
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Icebreaker Mode View ───────────────────────────────── */

function IcebreakerView({
  isNana,
  promptIndex,
  childPromptIndex,
  showChildPrompts,
  onNextPrompt,
  onNextChildPrompt,
  onToggleChildPrompts,
  onStartReading,
  childName,
  nanaName,
  onGoHome,
}: {
  isNana: boolean;
  promptIndex: number;
  childPromptIndex: number;
  showChildPrompts: boolean;
  onNextPrompt: () => void;
  onNextChildPrompt: () => void;
  onToggleChildPrompts: () => void;
  onStartReading: () => void;
  childName: string;
  nanaName: string;
  /** NEED 1 — Nana-side escape; high-severity gap (audit). */
  onGoHome?: () => void;
}) {
  const otherName = isNana ? (childName || getRoleLabel("child")) : (nanaName || getRoleLabel("nana"));
  const selfName  = isNana ? (nanaName  || getRoleLabel("nana"))  : (childName || getRoleLabel("child"));
  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      backgroundColor: "#080f1e",
      overflow: "hidden",
    }}>
      {/* Centered video tile with contain mode — face shows at natural
          framing regardless of source aspect. Bigger maxWidth/height
          since we no longer worry about cover zoom. */}
      <div style={{ flex: "0 0 58%", display: "flex", alignItems: "center", justifyContent: "center", padding: 12, position: "relative", overflow: "hidden" }}>
        <div style={{ width: "100%", maxWidth: 800, height: "100%", position: "relative" }}>
          <FaceVideoStage
            bigPerson={isNana ? "child" : "nana"}
            pipPerson={isNana ? "nana" : "child"}
            bigName={otherName}
            pipName={selfName}
            bigObjectFit="contain"
          />
        </div>
      </div>

      {/* Bottom strip */}
      {isNana ? (
        <div style={{
          backgroundColor: "#0b172e",
          padding: "12px 14px 14px",
          display: "flex", flexDirection: "column", gap: "10px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          flex: 1, overflow: "hidden auto",
        }}>
          {/* Prompt */}
          <div style={{
            backgroundColor: "rgba(201,146,42,0.12)",
            border: `1px solid ${AMBER}`,
            borderRadius: "10px",
            padding: "10px 12px",
          }}>
            <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "4px" }}>
              💬 CONVERSATION STARTER
            </div>
            <p style={{
              color: CREAM, fontFamily: "Merriweather, serif", fontSize: "12px",
              fontWeight: 700, lineHeight: 1.5, margin: 0,
            }}>
              {fill(icebreakerPrompts[promptIndex], { childName, nanaName })}
            </p>
          </div>

          {/* Buttons — bumped from cramped 9px/12px pills to a proper
              44px+ tap target. Rick: "buttons feel cramped and are
              easy to miss." */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={onNextPrompt}
              style={{
                flex: 1,
                backgroundColor: "transparent",
                color: CREAM,
                border: `1px solid rgba(255,255,255,0.25)`,
                borderRadius: "24px", padding: "12px 14px",
                fontSize: "14px", fontFamily: "DM Sans, sans-serif", fontWeight: 700,
                cursor: "pointer",
                minHeight: 44,
                touchAction: "manipulation",
              }}
            >
              Next Prompt →
            </button>
            <button
              onClick={onStartReading}
              style={{
                flex: 1,
                backgroundColor: AMBER, color: NAVY, border: "none",
                borderRadius: "24px", padding: "12px 14px",
                fontSize: "14px", fontFamily: "DM Sans, sans-serif", fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 4px 14px rgba(201,146,42,0.45)",
                minHeight: 44,
                touchAction: "manipulation",
              }}
            >
              📚 Pick Your Book
            </button>
          </div>

          {/* Prompt counter */}
          <div style={{ display: "flex", justifyContent: "center", gap: "5px" }}>
            {icebreakerPrompts.map((_, i) => (
              <div key={i} style={{
                width: "5px", height: "5px", borderRadius: "50%",
                backgroundColor: i === promptIndex ? AMBER : "rgba(255,255,255,0.2)",
                transition: "background-color 0.3s",
              }} />
            ))}
          </div>

          {/* Toggle for Perry's questions */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button
              onClick={onToggleChildPrompts}
              style={{
                backgroundColor: showChildPrompts ? "rgba(201,146,42,0.15)" : "transparent",
                color: showChildPrompts ? AMBER : "rgba(247,240,227,0.38)",
                border: `1px solid ${showChildPrompts ? AMBER : "rgba(255,255,255,0.13)"}`,
                borderRadius: "20px", padding: "5px 14px",
                fontSize: "10px", fontFamily: "DM Sans, sans-serif", fontWeight: 600,
                cursor: "pointer", letterSpacing: "0.04em", transition: "all 0.2s",
              }}
            >
              {showChildPrompts ? "✓ Perry's questions on" : "Show Perry questions"}
            </button>
          </div>

          {/* NEED 1 — prominent Home escape so Nana isn't forced to keep
              tapping Next Prompt or Pick Your Book to leave the icebreaker.
              High-severity gap from the audit. */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 2 }}>
            <ProminentHomePill onClick={onGoHome} />
          </div>
        </div>
      ) : (
        /* Perry's iPad: "Ask Nana" questions — only if Nana has enabled them */
        <div style={{
          backgroundColor: "#0b172e",
          padding: showChildPrompts ? "12px 14px 14px" : "14px",
          display: "flex", flexDirection: "column", gap: "10px",
          justifyContent: showChildPrompts ? "flex-start" : "center",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          flex: 1, overflow: "hidden auto",
        }}>
          {showChildPrompts ? (
            <>
              <div style={{
                backgroundColor: "rgba(99,179,237,0.12)",
                border: "1px solid #63b3ed",
                borderRadius: "10px",
                padding: "10px 12px",
              }}>
                <div style={{ color: "#63b3ed", fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "4px" }}>
                  🌟 ASK NANA
                </div>
                <p style={{
                  color: CREAM, fontFamily: "Merriweather, serif", fontSize: "12px",
                  fontWeight: 700, lineHeight: 1.5, margin: 0,
                }}>
                  {childIcebreakerPrompts[childPromptIndex]}
                </p>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={onNextChildPrompt}
                  style={{
                    flex: 1,
                    backgroundColor: "transparent",
                    color: CREAM,
                    border: "1px solid rgba(255,255,255,0.25)",
                    borderRadius: "24px", padding: "12px 14px",
                    fontSize: "14px", fontFamily: "DM Sans, sans-serif", fontWeight: 700,
                    cursor: "pointer",
                    minHeight: 44,
                    touchAction: "manipulation",
                  }}
                >
                  Next Question →
                </button>
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: "5px" }}>
                {childIcebreakerPrompts.map((_, i) => (
                  <div key={i} style={{
                    width: "5px", height: "5px", borderRadius: "50%",
                    backgroundColor: i === childPromptIndex ? "#63b3ed" : "rgba(255,255,255,0.2)",
                    transition: "background-color 0.3s",
                  }} />
                ))}
              </div>
            </>
          ) : (
            <p style={{
              color: "rgba(247,240,227,0.32)", fontFamily: "DM Sans, sans-serif",
              fontSize: "10px", textAlign: "center", margin: 0, lineHeight: 1.6,
            }}>
              Chat with Nana! She'll start reading soon.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Show & Tell Mode View ──────────────────────────────── */

function ShowAndTellView({
  isNana,
  showAndTellPromptIndex,
  onNextShowAndTellPrompt,
  onBackToReading,
  onStartParentCheck,
  onStartSillyFaces,
  onGoHome,
  childName,
  nanaName,
}: {
  isNana: boolean;
  showAndTellPromptIndex: number;
  onNextShowAndTellPrompt: () => void;
  onBackToReading: () => void;
  onStartParentCheck: () => void;
  /** Rick's Feature 5: Show & Tell is the natural junction where Nana
   *  picks the wrap-up order. Either path (Schedule first, or Silly
   *  Faces first) is exposed here so she can sequence as the session
   *  calls for. */
  onStartSillyFaces: () => void;
  onGoHome?: () => void;
  childName: string;
  nanaName: string;
}) {
  const otherName = isNana ? (childName || getRoleLabel("child")) : (nanaName || getRoleLabel("nana"));
  const selfName  = isNana ? (nanaName  || getRoleLabel("nana"))  : (childName || getRoleLabel("child"));
  const totalPrompts = showAndTellPrompts.length;

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      backgroundColor: "#000", overflow: "hidden",
    }}>
      <style>{`
        @keyframes sat-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes sat-twinkle { 0%,100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.1); } }
        @keyframes sat-pulse-dot { 0%,100% { box-shadow: 0 0 8px #22c55e; } 50% { box-shadow: 0 0 14px #22c55e, 0 0 0 4px rgba(34,197,94,0.18); } }
        @keyframes sat-mascot-bob { 0%,100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-6px) rotate(3deg); } }
      `}</style>

      {/* Contain mode shows face at natural framing — bigger tile OK now.
          Flex 1 (was "0 0 70%") so the video stage shrinks to give the
          bottom strip whatever room it needs. The previous fixed 70%
          allocation clipped the reaction-prompt text and the new
          Wrap Up junction when the bottom strip's content grew past
          its 30% allowance (Rick: "next prompt is empty and the
          layout does not fix properly"). */}
      <div style={{ flex: "1 1 0", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, position: "relative", overflow: "hidden" }}>
        <div style={{ width: "100%", maxWidth: 900, height: "100%", position: "relative" }}>
          <FaceVideoStage
            bigPerson={isNana ? "child" : "nana"}
            pipPerson={isNana ? "nana" : "child"}
            bigName={otherName}
            pipName={selfName}
            bigObjectFit="contain"
          />
          {/* Tiny floating mode badge on the video so users always know
              where they are without leaving the video full-bleed. */}
          <div style={{
            position: "absolute", top: 12, left: 12, zIndex: 4,
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 10px", borderRadius: 999,
            backgroundColor: "rgba(11,23,46,0.7)",
            border: "1px solid rgba(247,201,93,0.45)",
            backdropFilter: "blur(6px)",
            color: AMBER,
            fontFamily: "DM Sans, sans-serif", fontSize: 10, fontWeight: 800,
            letterSpacing: "0.16em",
          }}>
            🎭 SHOW &amp; TELL
          </div>
        </div>
      </div>

      {/* Bottom strip — auto-sizes to its content (was flex: 1 with
          a 70% top stage, which clipped the new Wrap Up section).
          Now the strip is exactly as tall as it needs, the video
          stage above takes the remaining height. */}
      {isNana ? (
        <div style={{
          flexShrink: 0,
          backgroundColor: "#0b172e",
          backgroundImage: "radial-gradient(560px 280px at 80% 120%, rgba(201,146,42,0.22), transparent 70%), radial-gradient(420px 260px at -10% 120%, rgba(167,139,250,0.18), transparent 70%)",
          padding: "12px 14px 14px",
          display: "flex", flexDirection: "column", gap: 10,
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}>
          {/* Animated prompt card */}
          <div style={{
            position: "relative",
            backgroundImage: "linear-gradient(135deg, rgba(247,201,93,0.18) 0%, rgba(201,146,42,0.10) 100%)",
            border: `1px solid ${AMBER}`,
            borderRadius: 14,
            padding: "12px 16px",
            animation: "sat-rise 0.4s both",
            overflow: "hidden",
          }}>
            <span style={{ position: "absolute", top: -4, left: 14, fontSize: 11, animation: "sat-twinkle 2.4s ease-in-out infinite" }}>✨</span>
            <span style={{ position: "absolute", top: -2, right: 18, fontSize: 9, animation: "sat-twinkle 2.4s 0.6s ease-in-out infinite" }}>⭐</span>
            <span style={{ position: "absolute", bottom: -3, left: 22, fontSize: 9, animation: "sat-twinkle 2.4s 1.1s ease-in-out infinite" }}>💫</span>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 10, fontWeight: 800, letterSpacing: "0.16em" }}>🎭 REACTION PROMPT</span>
              <span style={{ color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: 10 }}>· {showAndTellPromptIndex + 1} / {totalPrompts}</span>
            </div>
            <p style={{
              color: CREAM,
              fontFamily: "Merriweather, serif",
              fontSize: "clamp(15px, 2.4vw, 20px)",
              fontWeight: 700, lineHeight: 1.4, margin: 0,
            }}>
              {showAndTellPrompts[showAndTellPromptIndex]}
            </p>
          </div>

          {/* All four actions live in ONE row of square TileButtons —
              Rick: "rather than large individual buttons taking up a
              lot of vertical space, consider a single clean row of
              four compact buttons — similar in size to the book
              selection buttons." The earlier layout had two stacked
              2-col grids with a "WRAP UP — PICK YOUR ORDER" eyebrow
              between them, which felt cramped and split the four
              actions into two visual groups. Now they're equal-weight
              peers in one tap-friendly row. Color coding still
              communicates intent: purple = stay-in-mode prompt refresh,
              info-blue = back to book, success-green = scheduling,
              purple = silly faces. */}
          {/* Bumped to size md (96×96) — Rick (recurring): "those
              buttons feel cramped and are easy to miss." The sm
              (80×80) tiles were below the iPad finger-tap comfort
              zone once the icon + two-line label was stacked
              inside. md gives more breathing room around the icon
              and lets the label render at a more readable weight. */}
          <TileGrid columns={4} gap={10}>
            <TileButton
              icon="🎲"
              label="Next"
              sublabel="prompt"
              tone="purple"
              size="md"
              onClick={onNextShowAndTellPrompt}
            />
            <TileButton
              icon="📖"
              label="Back"
              sublabel="to book"
              tone="info"
              size="md"
              onClick={onBackToReading}
            />
            <TileButton
              icon="📅"
              label="Schedule"
              sublabel="next"
              tone="success"
              size="md"
              onClick={onStartParentCheck}
            />
            <TileButton
              icon="🎭"
              label="Silly"
              sublabel="Faces"
              tone="purple"
              size="md"
              onClick={onStartSillyFaces}
            />
          </TileGrid>

          {/* Home button was here as a tertiary pill — removed now that
              the global NavStrip in DeviceFrame's top chrome provides
              Home (plus Schedule / Silly Faces / Goodbye) on every
              navigable screen. */}

          {/* Progress dots */}
          <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 2 }}>
            {showAndTellPrompts.map((_, i) => (
              <div key={i} style={{
                width: i === showAndTellPromptIndex ? 16 : 5,
                height: 5, borderRadius: 999,
                backgroundColor: i === showAndTellPromptIndex ? AMBER : "rgba(255,255,255,0.2)",
                transition: "all 0.3s",
              }} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{
          backgroundColor: "#0b172e",
          backgroundImage: "radial-gradient(560px 280px at 50% 130%, rgba(34,197,94,0.18), transparent 70%)",
          padding: "16px 14px",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          flex: 1, overflow: "hidden",
        }}>
          <div style={{ fontSize: 36, animation: "sat-mascot-bob 2.2s ease-in-out infinite", filter: "drop-shadow(0 6px 14px rgba(34,197,94,0.35))" }}>🌟</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "#22c55e", animation: "sat-pulse-dot 1.6s ease-in-out infinite", flexShrink: 0 }} />
            <span style={{ color: "rgba(255,255,255,0.85)", fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700 }}>
              Nana can see you!
            </span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.55)", fontFamily: "Merriweather, serif", fontSize: 12, fontStyle: "italic", textAlign: "center", lineHeight: 1.5, maxWidth: 240 }}>
            Show Nana something special from your room
          </span>
          <span style={{ color: "rgba(255,255,255,0.32)", fontFamily: "DM Sans, sans-serif", fontSize: 10, textAlign: "center", letterSpacing: "0.04em" }}>
            She'll react with a prompt on her screen ✨
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Book Spread (Reading Mode) ─────────────────────────── */

function BookSpread({
  displayPage,
  isNana,
  flipping,
  flipFromPage,
  flipToPage,
  flipDirection,
  onStartChat,
  bookPages,
  bookTitle,
  onSwipePrev,
  onSwipeNext,
  fontScale = 1,
  isRecording = false,
  pointerHighlight = null,
  onPointer,
  wordHighlight = null,
  onWord,
  readingTheme = "day",
  readingStartedAt,
  pageMode = "double",
  pageSide = "L",
  chunkSize = 1,
}: {
  displayPage: number;
  isNana: boolean;
  flipping: boolean;
  flipFromPage: number;
  flipToPage: number;
  flipDirection?: "forward" | "backward";
  onStartChat: () => void;
  bookPages: BookPage[];
  bookTitle: string;
  onSwipePrev?: () => void;
  onSwipeNext?: () => void;
  fontScale?: number;
  isRecording?: boolean;
  pointerHighlight?: { x: number; y: number; page: number; ts: number } | null;
  onPointer?: (x: number, y: number, page: number) => void;
  wordHighlight?: WordHighlightState | null;
  onWord?: (side: "L" | "R", index: number, page: number) => void;
  readingTheme?: ReadingTheme;
  readingStartedAt?: number;
  pageMode?: "single" | "double";
  pageSide?: "L" | "R";
  /** Wish 2: passed straight through to BookContent so chapter books
   *  pack multiple source pages per displayed spread at smaller fonts. */
  chunkSize?: number;
}) {
  // Clamp the requested page so we never deref past the end of the book.
  // Cached `displayPage` from a previous session (or pre-Phase-C splits)
  // could exceed `bookPages.length` and produce a blank render.
  const safeDisplayPage = Math.max(1, Math.min(displayPage, bookPages.length));
  const p = bookPages[safeDisplayPage - 1] ?? bookPages[0];
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const bookAreaRef = useRef<HTMLDivElement>(null);

  // Prime the Web Speech API on first user gesture. iOS Safari needs the
  // first speak() call to come from a user gesture context, AND Safari
  // can quietly suspend speechSynthesis after the page is backgrounded
  // or when WebRTC audio takes over the audio session. Calling resume()
  // on every tap is cheap and forgives both situations.
  const speakWord = (word: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      const synth = window.speechSynthesis;
      // Safari may have paused itself silently — re-arm before speaking.
      if (synth.paused) synth.resume();
      synth.cancel();
      const cleaned = word.replace(/[^\p{L}\p{N}'-]/gu, "");
      if (!cleaned) return;
      const utter = () => {
        const u = new SpeechSynthesisUtterance(cleaned);
        u.rate = 0.85;
        u.pitch = 1.0;
        u.lang = "en-US";
        // Pick an English voice if voices have loaded; otherwise the
        // system default is used and that's fine.
        const voices = synth.getVoices();
        const en = voices.find(v => v.lang.startsWith("en"));
        if (en) u.voice = en;
        synth.speak(u);
      };
      // Voices load asynchronously on Safari. If they're not ready
      // yet, wait one event-loop tick and try again — this prevents
      // the very first tap of a session from being a silent no-op.
      if (synth.getVoices().length === 0) {
        const onVoices = () => {
          synth.removeEventListener("voiceschanged", onVoices);
          utter();
        };
        synth.addEventListener("voiceschanged", onVoices);
        // Belt-and-suspenders: also try after a 150ms timeout in case
        // the voiceschanged event never fires (some Safari builds).
        window.setTimeout(() => {
          synth.removeEventListener("voiceschanged", onVoices);
          if (synth.speaking) return;
          utter();
        }, 150);
      } else {
        utter();
      }
    } catch {
      // Speech synthesis unavailable on this device — silent.
    }
  };

  const handleBookTap = (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    // BOTH Nana and Perry can tap words and the highlight broadcasts so the
    // other side sees what was pointed at. But only Perry's device pronounces
    // the word out loud — that's an early-reader "what does this say?" hint.
    // Speaking on Nana's side would talk over her while she's reading.

    // A swipe just turned the page — don't also count the gesture's
    // tail-end as a tap on whatever word is now under the finger.
    if (justSwipedRef.current) return;

    const target = e.target as HTMLElement | null;
    const closestWordEl = target?.closest?.("[data-w]") as HTMLElement | null;
    const wordRef = target?.dataset?.w ?? closestWordEl?.dataset?.w;
    const wordText = closestWordEl?.textContent ?? target?.textContent ?? "";

    if (wordRef && onWord) {
      const dash = wordRef.indexOf("-");
      if (dash > 0) {
        const side = wordRef.slice(0, dash) as "L" | "R";
        const idx = Number(wordRef.slice(dash + 1));
        if ((side === "L" || side === "R") && Number.isFinite(idx)) {
          // Dev-only diagnostic so we can verify in screen recordings
          // that taps are firing even when the highlight or speech
          // doesn't visibly happen.
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.log("[word-tap]", { side, idx, page: displayPage, isNana, word: wordText.trim() });
          }
          onWord(side, idx, displayPage);
          // Local pronunciation — Perry only.
          if (!isNana && wordText.trim()) speakWord(wordText.trim());
          // Trigger a soft haptic / visible pulse (the visible pulse
          // fallback inside haptic() is what actually shows on iPad).
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            try { (navigator as Navigator).vibrate?.(8); } catch {}
          }
          return;
        }
      }
    }

    // Fall back to x/y dot — bidirectional. Rick: "Nana's gold
    // highlight and circle pointer are syncing to the child's iPad
    // correctly. However, the child cannot initiate highlights or
    // circles from her iPad" — both sides now broadcast pointer dots.
    if (!onPointer) return;
    const el = bookAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onPointer(x, y, displayPage);
  };
  // The conversation prompt used to live as a 218px bookmark panel
  // floating in the book corner (with a minimize-to-badge toggle and a
  // left/right toggle). Rick: "doesn't need to display text on screen
  // alongside the book. A cleaner approach might be a prompt that slides
  // in from the side, or one that's tucked in with the existing
  // controls." Moved entirely into the reading toolbar (PromptButton in
  // a popover next to Prev/Next). The book area is now untouched —
  // promptState/promptMinimized state, the side-toggle button, and the
  // minimize handling all gone with that change.

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  // When the user swipes to turn the page we DON'T want the tap handler
  // to also fire (e.g. picking up a stray word at the end of the swipe).
  // The flag is checked by handleBookTap; cleared automatically on the
  // next pointer down via touchStart resetting.
  const justSwipedRef = useRef(false);

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    justSwipedRef.current = true;
    // Clear the flag a tick later — long enough to suppress the
    // synthetic pointerUp that follows but short enough that the next
    // intentional tap goes through.
    window.setTimeout(() => { justSwipedRef.current = false; }, 350);
    if (dx < 0) onSwipeNext?.();
    else onSwipePrev?.();
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Top chrome bar — sticky chapter heading (left) + progress pill
          (right). Slim padding so the book gets more vertical space.
          Rick: "maximize the book display area." */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 8px",
          gap: 8,
          flexShrink: 0,
          backgroundColor: "rgba(0,0,0,0.18)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          minHeight: 0,
        }}
      >
        <StickyChapter chapterText={p?.leftChapter ?? null} bookTitle={bookTitle} theme={readingTheme} />
        <ProgressPill
          currentPage={displayPage}
          totalPages={bookPages.length}
          sessionStart={readingStartedAt ?? Date.now()}
          theme={readingTheme}
        />
      </div>

      {/* Book — fills all available space.
          We listen on `onPointerUp` instead of `onClick` for the word
          tap. iOS Safari's `click` synthesis adds a 300ms delay AND can
          drop the synthetic click entirely after some types of touch
          gestures (e.g. when an ancestor briefly receives focus). Pointer
          events fire reliably on every touch end. The swipe handlers
          stay on `onTouchStart/End` because they need raw touch coords
          for direction detection. */}
      <div
        ref={bookAreaRef}
        style={{ flex: 1, position: "relative", overflow: "hidden", cursor: isNana ? "crosshair" : "default" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onPointerUp={handleBookTap}
      >
        {/* Pointer highlight ring — visible on both devices when Nana taps the book */}
        {pointerHighlight && pointerHighlight.page === displayPage && (
          <div
            key={pointerHighlight.ts}
            aria-hidden
            style={{
              position: "absolute",
              left: `${pointerHighlight.x * 100}%`,
              top: `${pointerHighlight.y * 100}%`,
              transform: "translate(-50%, -50%)",
              width: 64,
              height: 64,
              borderRadius: "50%",
              border: "3px solid #C9922A",
              boxShadow: "0 0 0 3px rgba(201,146,42,0.30), 0 0 24px rgba(201,146,42,0.65)",
              backgroundColor: "rgba(201,146,42,0.08)",
              animation: "pointer-highlight 2.4s ease-out forwards",
              pointerEvents: "none",
              zIndex: 30,
            }}
          />
        )}

        {/* Static book layer */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundColor: READING_THEMES[readingTheme].page,
          borderTop: `3px solid ${READING_THEMES[readingTheme].spine}`,
          borderBottom: `3px solid ${READING_THEMES[readingTheme].spine}`,
          display: "flex", overflow: "hidden",
          transition: "background-color 240ms ease, border-color 240ms ease",
        }}>
          {/* REC badge — only when recording is actually active */}
          {isRecording && (
            <div
              role="status"
              aria-label="Session is being recorded"
              style={{
                position: "absolute", top: "8px", left: "10px", zIndex: 5,
                color: "#fff", fontSize: "9px", fontFamily: "Inter, DM Sans, sans-serif", fontWeight: 700,
                letterSpacing: "0.08em",
                backgroundColor: "rgba(239,68,68,0.92)",
                padding: "3px 8px", borderRadius: 999,
                display: "flex", alignItems: "center", gap: "5px",
                boxShadow: "0 2px 8px rgba(239,68,68,0.45)",
              }}
            >
              <span
                style={{
                  display: "inline-block", width: "6px", height: "6px",
                  borderRadius: "50%", backgroundColor: "#fff",
                  animation: "rec-pulse 1.4s ease-in-out infinite",
                }}
              />
              REC
            </div>
          )}

          {/* Image-page mode — for fixed-layout picture books imported from
              EPUB or PDF where each page is a complete illustration (verse
              and artwork baked together). When `imageUrl` is set on the
              current page, render the image full-bleed instead of our
              two-page text spread. Pointer-highlight ring and Nana prompt
              panel still overlay correctly because both are rendered as
              siblings inside the same bookAreaRef container. */}
          {(() => {
            const idxPage = flipping ? flipToPage : displayPage;
            const safeIdx = Math.max(1, Math.min(idxPage, bookPages.length));
            const imagePage = bookPages[safeIdx - 1];
            if (imagePage?.imageUrl) {
              return (
                <div
                  data-bk-image-page
                  style={{
                    width: "100%", height: "100%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    backgroundColor: READING_THEMES[readingTheme].page,
                    overflow: "hidden",
                  }}
                >
                  <img
                    src={imagePage.imageUrl}
                    alt={imagePage.leftChapter || bookTitle || `Page ${idxPage}`}
                    draggable={false}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      objectFit: "contain",
                      display: "block",
                      userSelect: "none",
                      WebkitUserSelect: "none",
                      WebkitTouchCallout: "none",
                      pointerEvents: "none",
                    }}
                  />
                </div>
              );
            }
            return (
              <BookContent
                page={idxPage}
                bookPages={bookPages}
                bookTitle={bookTitle}
                fontScale={fontScale}
                wordHighlight={wordHighlight}
                theme={readingTheme}
                pageMode={pageMode}
                pageSide={pageSide}
                chunkSize={chunkSize}
              />
            );
          })()}
        </div>

        {/* Page-flip overlay (child only) */}
        {!isNana && flipping && (() => {
          const back = flipDirection === "backward";
          return (
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
              <div style={{
                position: "absolute", top: 0,
                left: back ? "0" : "50%",
                width: "50%", height: "100%",
                transformOrigin: back ? "right center" : "left center",
                backgroundColor: PARCHMENT,
                borderTop: `3px solid ${LEATHER}`,
                borderBottom: `3px solid ${LEATHER}`,
                ...(back
                  ? { borderLeft: `3px solid ${LEATHER}` }
                  : { borderRight: `3px solid ${LEATHER}` }),
                animation: `${back ? "page-flip-back" : "page-flip"} 0.5s cubic-bezier(0.32, 0.72, 0, 1) forwards`,
                willChange: "transform",
                overflow: "hidden", zIndex: 20,
              }}>
                <div style={{
                  position: "absolute", inset: 0,
                  background: back
                    ? "linear-gradient(to right, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.18) 40%, rgba(0,0,0,0.35) 100%)"
                    : "linear-gradient(to left, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.18) 60%, rgba(0,0,0,0.35) 100%)",
                  pointerEvents: "none",
                }} />
              </div>
            </div>
          );
        })()}

        {/* Conversation prompt was removed from the book area. It now
            lives in the reading toolbar (PromptButton, below) so the
            book never has anything floating on top of the text. */}
      </div>

      {/* Bottom strip — cue only on Nana's view, progress bar on both.
          Kept deliberately minimal so the book stays central (Rick's
          NOOK feedback: "no clutter, the book remains central"). */}
      <div style={{
        backgroundColor: "#0b172e",
        padding: "4px 12px 5px",
        display: "flex", flexDirection: "column", gap: 2,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}>
        {isNana && (
          <span style={{ color: AMBER, fontFamily: "Merriweather, serif", fontWeight: 600, fontSize: 12, textAlign: "center", lineHeight: 1.4, fontStyle: "italic", opacity: 0.9, letterSpacing: "0.01em" }}>
            {p.cue}
          </span>
        )}
        <div style={{ height: 2, backgroundColor: "rgba(201,146,42,0.16)", borderRadius: 2, marginTop: isNana ? 2 : 0 }}>
          <div style={{
            height: "100%", width: `${(displayPage / bookPages.length) * 100}%`,
            backgroundColor: AMBER, borderRadius: 2,
            transition: "width 0.4s ease",
            boxShadow: "0 0 6px rgba(201,146,42,0.45)",
          }} />
        </div>
      </div>
    </div>
  );
}

/* ─── Library View ───────────────────────────────────────── */

function LibraryView({
  selectedBookId,
  onSelectBook,
  onConfirmBook,
  progress = [],
  onCancel,
  readOnly = false,
  onScroll,
  scrollTop,
}: {
  selectedBookId: string;
  onSelectBook: (id: string) => void;
  onConfirmBook: (startPage: number) => void;
  progress?: Array<{ bookId: string; currentPage: number; lastReadAt: string }>;
  onCancel?: () => void;
  /** Perry's mirrored view. Rick: "Perry's screen mirrored the library
   *  view (read-only) while Nana scrolls through books. Perry should
   *  NOT be able to select a book — view only for now." When true:
   *  - Header copy switches to "Watching with Nana"
   *  - Search bar + status filter chips are hidden (no need on a
   *    follower-only view; future: optionally sync Nana's filter state)
   *  - Book cards are not interactive — tap is a no-op
   *  - Start Reading / Resume + "Start over" CTAs are hidden
   *  - Back / Cancel button is hidden (Perry follows Nana's navigation)
   *  The highlighted book still updates in real-time via the tentative
   *  book_change broadcast from Nana's handleSelectBook. */
  readOnly?: boolean;
  /** Nana-side: fired on every scroll of the bookshelf (rAF-throttled
   *  in the parent) so the position can be published over SSE to Perry. */
  onScroll?: (top: number) => void;
  /** Perry-side: incoming scrollTop from Nana — applied imperatively to
   *  the bookshelf scroll container so her view tracks Nana's scrolling. */
  scrollTop?: number;
}) {
  // Ref to the bookshelf scroll container. Nana publishes its scrollTop;
  // Perry receives a target scrollTop and applies it imperatively.
  const shelfRef = useRef<HTMLDivElement | null>(null);
  // Apply incoming scroll position on Perry's side. Guard with a small
  // epsilon to avoid feedback if the same value is re-applied.
  useEffect(() => {
    if (!readOnly) return;
    const el = shelfRef.current;
    if (!el) return;
    if (typeof scrollTop !== "number") return;
    if (Math.abs(el.scrollTop - scrollTop) < 1) return;
    el.scrollTop = scrollTop;
  }, [readOnly, scrollTop]);
  // Search + status filter — Rick: "The library is growing, so we'll
  // eventually need a search and/or filter function to keep it
  // manageable." Filters apply locally over Object.values(booksLibrary);
  // no server round-trip. Search is case-insensitive across title,
  // author, and tagline. Status filter uses the per-book progress
  // record from the prop above.
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "in-progress" | "not-started" | "finished">("all");

  const progressByBookId = new Map(progress.map(p => [p.bookId, p]));
  const allBooks = Object.values(booksLibrary);
  const totalCount = allBooks.length;
  const q = searchQuery.trim().toLowerCase();
  const filteredBooks = allBooks.filter(book => {
    if (q) {
      const haystack = `${book.title} ${book.author} ${book.tagline ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (statusFilter !== "all") {
      const p = progressByBookId.get(book.id);
      const total = book.pages.length;
      const hasProgress = (p?.currentPage ?? 0) >= 1;
      const isFinished = hasProgress && (p!.currentPage >= total);
      const inProgress = hasProgress && !isFinished;
      if (statusFilter === "in-progress" && !inProgress) return false;
      if (statusFilter === "not-started" && hasProgress) return false;
      if (statusFilter === "finished" && !isFinished) return false;
    }
    return true;
  });

  // Counts for each chip so Nana sees how many will match before tapping.
  const counts = {
    all: totalCount,
    "in-progress": allBooks.filter(b => {
      const p = progressByBookId.get(b.id);
      return p && p.currentPage >= 1 && p.currentPage < b.pages.length;
    }).length,
    "not-started": allBooks.filter(b => !progressByBookId.get(b.id)).length,
    finished: allBooks.filter(b => {
      const p = progressByBookId.get(b.id);
      return p && p.currentPage >= b.pages.length;
    }).length,
  };

  const STATUS_CHIPS: Array<{ key: typeof statusFilter; label: string; icon: string }> = [
    { key: "all",          label: "All",         icon: "📚" },
    { key: "in-progress",  label: "Reading",     icon: "📖" },
    { key: "not-started",  label: "New",         icon: "✨" },
    { key: "finished",     label: "Finished",    icon: "✓" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", overflow: "hidden" }}>
      {/* Header — back chevron on the left, centered title, balance spacer right.
          In readOnly (Perry's mirrored view) the back button disappears
          and the subtitle changes to a "Watching with Nana" hint. */}
      <div style={{ padding: "10px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0, display: "grid", gridTemplateColumns: "32px 1fr 32px", alignItems: "center" }}>
        {(!readOnly && onCancel) ? (
          <button
            onClick={onCancel}
            aria-label="Back"
            title="Back"
            style={{ width: 28, height: 28, borderRadius: "50%", backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(247,240,227,0.7)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
          >
            <ChevronLeft size={15} strokeWidth={2.2} aria-hidden />
          </button>
        ) : <span />}
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-flex", color: AMBER }} aria-hidden>
            <LibraryIcon size={20} strokeWidth={1.6} />
          </div>
          <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: 15, fontWeight: 700, marginTop: 2 }}>
            {readOnly ? "Picking a Book Together" : "Choose Your Book"}
          </div>
          <div style={{ color: "rgba(247,240,227,0.45)", fontFamily: "Inter, DM Sans, sans-serif", fontSize: 11, marginTop: 2, letterSpacing: "0.04em" }}>
            {readOnly ? "👀 Watching with Nana" : "Tap to select · both sides see your choice"}
          </div>
        </div>
        <span />
      </div>

      {/* Search + status filter row — pinned above the scroll so it stays
          visible as the bookshelf grows. Hidden in readOnly (Perry's
          mirror) so her view doesn't show interactive search/filter
          controls she can't usefully drive — they'd just confuse the
          read-only contract. Future: optionally sync Nana's filter
          state so Perry's view stays in lockstep. */}
      {!readOnly && (
      <div style={{ padding: "10px 12px 8px", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <span aria-hidden style={{
            position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
            color: "rgba(247,240,227,0.45)", fontSize: 14, lineHeight: 1, pointerEvents: "none",
          }}>🔎</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, author, or description"
            aria-label="Search books"
            style={{
              width: "100%",
              padding: "10px 36px 10px 36px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              backgroundColor: "rgba(255,255,255,0.05)",
              color: CREAM,
              fontFamily: "DM Sans, sans-serif",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `${AMBER}`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              title="Clear search"
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                width: 22, height: 22, borderRadius: "50%",
                background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
                color: "rgba(247,240,227,0.7)", fontSize: 13, lineHeight: 1, fontWeight: 700,
                cursor: "pointer", padding: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}
            >×</button>
          )}
        </div>

        <div role="tablist" aria-label="Filter by reading status" style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" as const }}>
          {STATUS_CHIPS.map(chip => {
            const active = statusFilter === chip.key;
            const n = counts[chip.key];
            return (
              <button
                key={chip.key}
                role="tab"
                aria-selected={active}
                onClick={() => setStatusFilter(chip.key)}
                style={{
                  flexShrink: 0,
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: active ? "rgba(201,146,42,0.18)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${active ? "rgba(201,146,42,0.55)" : "rgba(255,255,255,0.10)"}`,
                  color: active ? AMBER : "rgba(247,240,227,0.75)",
                  fontFamily: "DM Sans, sans-serif", fontSize: 11.5, fontWeight: 700,
                  cursor: "pointer", letterSpacing: "0.02em",
                  touchAction: "manipulation",
                }}
              >
                <span style={{ fontSize: 12, lineHeight: 1 }}>{chip.icon}</span>
                <span>{chip.label}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: active ? NAVY : "rgba(247,240,227,0.55)",
                  background: active ? AMBER : "rgba(255,255,255,0.08)",
                  borderRadius: 999,
                  padding: "1px 6px",
                  minWidth: 16, textAlign: "center",
                }}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* Bookshelf — Nana's scroll is published to Perry so her mirror
          tracks in real time. Rick: "as nana scrolls then child should
          also see scroll." */}
      <div
        ref={shelfRef}
        onScroll={readOnly || !onScroll ? undefined : (e) => onScroll((e.currentTarget as HTMLDivElement).scrollTop)}
        style={{ flex: 1, padding: "0 10px 0", overflow: "auto", display: "flex", flexDirection: "column", gap: "12px" }}
      >
        {/* Empty-state when search/filter yields no matches. */}
        {filteredBooks.length === 0 && (
          <div style={{
            margin: "32px auto",
            maxWidth: 320,
            textAlign: "center",
            color: "rgba(247,240,227,0.55)",
            fontFamily: "DM Sans, sans-serif",
            padding: "20px 16px",
            border: "1px dashed rgba(255,255,255,0.14)",
            borderRadius: 14,
            background: "rgba(255,255,255,0.025)",
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ color: CREAM, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>No books match</div>
            <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
              {q ? <>Nothing matches "<span style={{ color: AMBER }}>{searchQuery}</span>"</> : "Try a different filter"}
              {q && statusFilter !== "all" ? <> in <span style={{ color: AMBER }}>{statusFilter.replace("-", " ")}</span></> : null}
              .
            </div>
            <button
              onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}
              style={{
                background: "rgba(201,146,42,0.18)",
                border: `1px solid ${AMBER}`,
                borderRadius: 999,
                padding: "6px 14px",
                color: AMBER,
                fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 700,
                cursor: "pointer",
              }}
            >Clear filters</button>
          </div>
        )}
        {filteredBooks.map(book => {
          const sel = book.id === selectedBookId;
          // Per-card progress: small bar + "Chapter 3 of 12" (chapter books)
          // or "Page 47 of 80" (flat books) + relative date. ✓ when finished.
          const cardSaved = progress.find(p => p.bookId === book.id);
          const cardPage = cardSaved?.currentPage ?? 0;
          const cardTotal = book.pages.length;
          const cardHasProgress = cardPage >= 1 && cardTotal > 0;
          const cardIsFinished = cardHasProgress && cardPage >= cardTotal;
          const cardChapterInfo = cardHasProgress ? getChapterForPage(book, cardPage) : null;
          const cardPercent = cardTotal > 0 ? Math.min(100, Math.round((cardPage / cardTotal) * 100)) : 0;
          const relTime = (iso: string) => {
            const ms = Date.now() - new Date(iso).getTime();
            if (ms < 60_000) return "just now";
            if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
            if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
            const days = Math.floor(ms / 86_400_000);
            if (days === 1) return "yesterday";
            if (days < 7) return `${days} days ago`;
            if (days < 30) return `${Math.floor(days / 7)} wk ago`;
            return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          };
          const cardProgressLabel = cardIsFinished
            ? "Finished"
            : cardChapterInfo
              ? `Chapter ${cardChapterInfo.chapterIndex + 1} of ${book.chapters!.length}`
              : `Page ${cardPage} of ${cardTotal}`;
          return (
            <button
              key={book.id}
              onClick={readOnly ? undefined : () => onSelectBook(book.id)}
              disabled={readOnly}
              aria-disabled={readOnly}
              style={{
                display: "flex", alignItems: "center", gap: "14px",
                backgroundColor: sel ? "rgba(201,146,42,0.10)" : "rgba(255,255,255,0.035)",
                border: `1px solid ${sel ? AMBER : "rgba(255,255,255,0.10)"}`,
                borderLeft: `6px solid ${book.spineColor}`,
                borderRadius: "10px",
                padding: "16px 18px 16px 14px",
                cursor: readOnly ? "default" : "pointer",
                textAlign: "left",
                boxShadow: sel ? `0 0 18px rgba(201,146,42,0.22)` : "none",
                transition: "all 0.15s",
                width: "100%",
                flexShrink: 0,
              }}
            >
              <div style={{
                position: "relative",
                width: "64px", height: "88px", flexShrink: 0,
                borderRadius: "6px", boxShadow: "2px 3px 10px rgba(0,0,0,0.5)",
                border: `2px solid ${book.spineColor}`,
                backgroundColor: book.spineColor,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "34px",
              }}>
                {book.emoji}
                {/* Gold completion checkmark — Rick's spec: "Completed books
                    show a gold checkmark" on the cover/spine. Only shown
                    for books where saved progress >= total pages. */}
                {cardIsFinished && (
                  <div
                    aria-label="Book completed"
                    style={{
                      position: "absolute", top: "-7px", right: "-7px",
                      width: "26px", height: "26px", borderRadius: "50%",
                      backgroundColor: AMBER, color: "#1B2B4B",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "15px", fontWeight: 800,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.45), 0 0 0 2px rgba(11,23,46,0.85)",
                    }}
                  >
                    ✓
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "20px", fontWeight: 700, lineHeight: 1.2, marginBottom: "2px" }}>
                  {book.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <span style={{ color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: "13px", fontWeight: 600, letterSpacing: "0.04em" }}>
                    {book.author}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "4px", flexWrap: "wrap" }}>
                  <span style={{
                    backgroundColor: sel ? "rgba(201,146,42,0.22)" : "rgba(255,255,255,0.08)",
                    color: sel ? AMBER : "rgba(247,240,227,0.85)",
                    fontFamily: "DM Sans, sans-serif", fontSize: "11px", fontWeight: 700,
                    borderRadius: "8px", padding: "3px 9px", letterSpacing: "0.04em",
                  }}>
                    Ages {book.ageRange}
                  </span>
                  <span style={{
                    backgroundColor: sel ? "rgba(192,132,252,0.18)" : "rgba(255,255,255,0.06)",
                    color: sel ? "#c084fc" : "rgba(192,132,252,0.9)",
                    fontFamily: "DM Sans, sans-serif", fontSize: "11px", fontWeight: 700,
                    borderRadius: "8px", padding: "3px 9px", letterSpacing: "0.04em",
                  }}>
                    {book.readingLevel}
                  </span>
                  {book.lexile && (
                    <span style={{
                      backgroundColor: sel ? "rgba(20,184,166,0.2)" : "rgba(255,255,255,0.06)",
                      color: sel ? "#2dd4bf" : "rgba(247,240,227,0.38)",
                      fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700,
                      borderRadius: "8px", padding: "2px 7px", letterSpacing: "0.04em",
                    }}>
                      {book.lexile.replace(/L$/, " Lexile")}
                    </span>
                  )}
                </div>
                <div style={{ color: "rgba(247,240,227,0.8)", fontFamily: "Merriweather, serif", fontSize: "13px", fontStyle: "italic", lineHeight: 1.55, marginBottom: "6px" }}>
                  {book.tagline}
                </div>
                {/* Per-card progress strip — shown for books with saved
                    reading progress. Tiny bar + "Chapter 3 of 12" (chapter
                    books) or "Page 47 of 80" (flat books) + relative time. */}
                {cardHasProgress && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}>
                    <div style={{
                      flex: "0 0 60px", height: "4px", borderRadius: "999px",
                      backgroundColor: "rgba(255,255,255,0.08)",
                      overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${cardPercent}%`, height: "100%",
                        backgroundColor: cardIsFinished ? "#22c55e" : AMBER,
                        transition: "width 0.3s ease",
                      }} />
                    </div>
                    <span style={{
                      color: cardIsFinished ? "#86efac" : "rgba(201,146,42,0.85)",
                      fontFamily: "DM Sans, sans-serif", fontSize: "9.5px", fontWeight: 700,
                      letterSpacing: "0.02em",
                    }}>
                      {cardIsFinished && "✓ "}{cardProgressLabel}
                    </span>
                    <span style={{
                      color: "rgba(247,240,227,0.35)",
                      fontFamily: "DM Sans, sans-serif", fontSize: "9px",
                    }}>
                      · {relTime(cardSaved!.lastReadAt)}
                    </span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
                  <span style={{ color: "rgba(247,240,227,0.32)", fontFamily: "DM Sans, sans-serif", fontSize: "10px" }}>Read free:</span>
                  <a href={book.standardEbooksUrl} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      color: sel ? "#60a5fa" : "rgba(147,197,253,0.7)",
                      fontFamily: "DM Sans, sans-serif", fontSize: "10px", fontWeight: 700,
                      textDecoration: "none", letterSpacing: "0.03em",
                      backgroundColor: "rgba(96,165,250,0.10)", borderRadius: "5px", padding: "1px 5px",
                      border: "1px solid rgba(96,165,250,0.25)",
                    }}>
                    Standard Ebooks ↗
                  </a>
                  <a href={book.gutenbergUrl} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      color: sel ? "#86efac" : "rgba(134,239,172,0.65)",
                      fontFamily: "DM Sans, sans-serif", fontSize: "10px", fontWeight: 700,
                      textDecoration: "none", letterSpacing: "0.03em",
                      backgroundColor: "rgba(134,239,172,0.08)", borderRadius: "5px", padding: "1px 5px",
                      border: "1px solid rgba(134,239,172,0.22)",
                    }}>
                    Project Gutenberg ↗
                  </a>
                </div>
              </div>
              {/* Right-side indicator — fills the trailing real estate
                  that used to be dead space on every card. When the book
                  is selected, a filled amber circle with a tick reads
                  as "this one is yours." When not, a subtle chevron tells
                  the user the card is tappable. Either way the right
                  edge now has visual weight and the card feels balanced. */}
              {!readOnly && (
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {sel ? (
                    <div
                      aria-label="Selected"
                      style={{
                        width: 36, height: 36, borderRadius: "50%",
                        backgroundColor: AMBER, color: NAVY,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 20, fontWeight: 800,
                        boxShadow: "0 4px 14px rgba(201,146,42,0.45)",
                      }}
                    >✓</div>
                  ) : (
                    <span aria-hidden style={{ color: "rgba(247,240,227,0.35)", fontSize: 22, lineHeight: 1 }}>›</span>
                  )}
                </div>
              )}
            </button>
          );
        })}

        {/* Add a book — coming soon. Hidden on Perry's read-only mirror;
            she can't add a book and the placeholder would just be noise. */}
        {!readOnly && (
          <button style={{
            display: "flex", alignItems: "center", gap: "10px",
            backgroundColor: "transparent",
            border: "1px dashed rgba(255,255,255,0.13)",
            borderRadius: "8px",
            padding: "9px 11px",
            cursor: "default",
            width: "100%",
            opacity: 0.45,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: "18px", flexShrink: 0 }}>📎</span>
            <div>
              <div style={{ color: "rgba(247,240,227,0.6)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", fontWeight: 700, textAlign: "left" }}>
                Add a Book
              </div>
              <div style={{ color: "rgba(247,240,227,0.35)", fontFamily: "DM Sans, sans-serif", fontSize: "8px", marginTop: "2px", textAlign: "left" }}>
                Standard eBooks · Project Gutenberg · PDF / ePub upload · Coming soon
              </div>
            </div>
          </button>
        )}
      </div>

      {/* Start Reading / Resume — hidden in readOnly so Perry can't
          trigger a session start. Confirm is a Nana-only action. */}
      {!readOnly && (() => {
        const saved = progress.find(p => p.bookId === selectedBookId);
        const book = booksLibrary[selectedBookId];
        const pagesTotal = book?.pages.length ?? 0;
        const savedPage = saved?.currentPage ?? 0;
        const hasProgress = savedPage > 1 && savedPage < pagesTotal;
        // Prefer the structured chapter data when the book has chapters[]
        // (real chapter books). Fall back to parsing the legacy
        // `leftChapter` string ("Chapter 6 · Pig and Pepper") for older
        // flat books where chapters live only as page-level labels.
        let chapterRef = "";
        let chapterTitle = "";
        let chapterCounter = ""; // "Chapter 3 of 12" — only set for structured chapter books
        if (hasProgress && book) {
          const info = getChapterForPage(book, savedPage);
          if (info) {
            // Real chapter book — use structured data.
            const [refPart, ...titleParts] = info.chapter.title.split(" · ");
            chapterRef = refPart ?? `Chapter ${info.chapterIndex + 1}`;
            chapterTitle = titleParts.join(" · ");
            chapterCounter = `Chapter ${info.chapterIndex + 1} of ${book.chapters!.length}`;
          } else {
            // Legacy flat book — derive chapter from leftChapter string.
            const chapterLabel = book.pages[savedPage - 1]?.leftChapter ?? "";
            chapterRef = chapterLabel.split(" · ")[0];
            chapterTitle = chapterLabel.split(" · ").slice(1).join(" · ");
          }
        }
        const formatShort = (iso: string) => {
          const d = new Date(iso);
          return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        };
        return (
          <div style={{ padding: "10px 12px 12px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
            {hasProgress && (
              <div style={{ marginBottom: "8px", backgroundColor: "rgba(201,146,42,0.08)", border: "1px solid rgba(201,146,42,0.22)", borderRadius: "10px", padding: "8px 10px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "15px" }}>🔖</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: "9.5px", fontWeight: 700 }}>
                    {book?.title} · {chapterRef} · Page {savedPage} of {pagesTotal}
                  </div>
                  <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "8px", marginTop: "1px" }}>
                    {chapterTitle && <span>{chapterTitle} · </span>}
                    {chapterCounter && <span>{chapterCounter} · </span>}
                    Last read {formatShort(saved!.lastReadAt)}
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={() => onConfirmBook(hasProgress ? savedPage : 1)}
              style={{
                // Hero-tier CTA — Rick (recurring): "the Continue
                // Reading button is a bit small, could use some
                // size." Previous bump (padding 18, font 15/17,
                // minHeight 56) still read as small surrounded by
                // 80-100px-tall book cards. Pushed to minHeight 64,
                // font 17/20, padding 20px, stronger glow + amber
                // gradient so it visually anchors the bottom of the
                // library view.
                width: "100%",
                background: "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)",
                color: "#1B2B4B",
                border: "none", borderRadius: "32px", padding: "20px",
                fontSize: hasProgress ? "17px" : "20px",
                fontFamily: "DM Sans, sans-serif", fontWeight: 800,
                cursor: "pointer", letterSpacing: "0.02em",
                marginBottom: hasProgress ? "10px" : 0,
                boxShadow: "0 10px 28px rgba(201,146,42,0.55), 0 0 0 1px rgba(247,201,93,0.30)",
                minHeight: 64,
                touchAction: "manipulation",
              }}
            >
              {hasProgress
                ? `Continue reading · ${chapterRef}, page ${savedPage} of ${pagesTotal} →`
                : "Start Reading →"}
            </button>
            {hasProgress && (
              <button
                onClick={() => onConfirmBook(1)}
                style={{
                  width: "100%", backgroundColor: "transparent", color: "rgba(247,240,227,0.55)",
                  border: "1px solid rgba(255,255,255,0.14)", borderRadius: "28px", padding: "12px",
                  fontSize: "12px", fontFamily: "DM Sans, sans-serif", fontWeight: 600,
                  cursor: "pointer", letterSpacing: "0.02em",
                  minHeight: 40,
                }}
              >
                Start over from page 1
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/* ─── Onboarding View ───────────────────────────────────── */

function OnboardingView({
  isNana,
  step,
  nanaDisplayName,
  inviteToken,
  authError,
  authLoading,
  perryInviteError,
  perryLookupNanaName,
  onNanaAuth,
  onNanaCodeSent,
  onPerryCodeSubmit,
  onChildProfileConfirm,
  onBeginSession,
  onBeginWithBook,
  onSkip,
  onBack,
  perryPinMode = false,
  perryPinChildName = "",
  perryPinError = "",
  perryPinLoading = false,
  onPerryPinLogin,
  onUseDifferentInvite,
  onAddSibling,
  dashboardLoading = false,
  dashboardPerryName = "",
  dashboardProgress = [],
  onSwitchUser,
  /** All siblings on this connection. Shown as avatar pills above the
   *  Perry-side PIN keypad so the parent can see which kids exist on
   *  this iPad before typing. Pure UI hint — PIN matching is still
   *  server-side across all children. */
  pinScreenChildren = [],
  pinScreenExpectedChild = null,
}: {
  isNana: boolean;
  step: number;
  nanaDisplayName: string;
  inviteToken: string;
  authError: string;
  authLoading: boolean;
  perryInviteError: string;
  perryLookupNanaName: string;
  onNanaAuth: (isLogin: boolean, data: { displayName: string; firstName: string; lastName: string; email: string; password: string }) => Promise<void>;
  onNanaCodeSent: () => void;
  onPerryCodeSubmit: (code: string) => void;
  onChildProfileConfirm: (name: string, birthday: string | null, pin: string) => void;
  onBeginSession: () => void;
  onBeginWithBook?: (bookId: string, startPage: number) => void;
  onSkip: () => void;
  onBack?: () => void;
  perryPinMode?: boolean;
  perryPinChildName?: string;
  perryPinError?: string;
  perryPinLoading?: boolean;
  onPerryPinLogin?: (pin: string) => void;
  onUseDifferentInvite?: () => void;
  /** Same family/connection, but onboard a NEW child (sibling). Skips
   * invite-code re-entry — goes straight to profile setup. */
  onAddSibling?: () => void;
  dashboardLoading?: boolean;
  dashboardPerryName?: string;
  dashboardProgress?: Array<{ bookId: string; currentPage: number; lastReadAt: string }>;
  /** Explicit escape hatch from any unauthenticated onboarding screen
   *  back to the splash. Rick: "Trapped on Nana login screen with no
   *  way out." The tiny `⇄ switch` header pill was too easy to miss. */
  onSwitchUser?: () => void;
  pinScreenChildren?: Child[];
  /** When Nana has switched her active sibling away from the child
   *  currently authenticated on this iPad, surface a "It's Cooper's
   *  turn!" banner so the parent knows which PIN to enter. */
  pinScreenExpectedChild?: Child | null;
}) {
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [dashSelectedBook, setDashSelectedBook] = useState<{ bookId: string; startPage: number } | null>(null);
  const [displayName, setDisplayName] = useState(nanaDisplayName);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codeEntry, setCodeEntry] = useState("");
  const [childName, setChildName] = useState("");
  const [pinEntry, setPinEntry] = useState("");
  const [birthdayOptOut, setBirthdayOptOut] = useState(false);
  const [childBirthMonth, setChildBirthMonth] = useState("");
  const [childBirthDay, setChildBirthDay] = useState("");
  const [childBirthYear, setChildBirthYear] = useState("");
  const childBirthday = !birthdayOptOut && childBirthYear.length === 4 && childBirthMonth && childBirthDay
    ? `${childBirthYear}-${childBirthMonth.padStart(2, "0")}-${childBirthDay.padStart(2, "0")}`
    : null;
  const birthdayValid = birthdayOptOut || (childBirthYear.length === 4 && !!childBirthMonth && !!childBirthDay);
  const childPin_ref = useRef<HTMLInputElement>(null);
  const birthDayRef = useRef<HTMLInputElement>(null);
  const birthYearRef = useRef<HTMLInputElement>(null);
  const [childPin, setChildPin] = useState("");
  const [pinFocus, setPinFocus] = useState(false);
  // COPPA parental affirmation. Privacy Policy v3 §3 commits to capturing
  // explicit parental consent before any child data is stored. The act of
  // checking this box + tapping "All set!" IS the consent record — the
  // server stamps the child row's createdAt as the consent timestamp. The
  // checkbox sits above the CTA so it can't be bypassed by an accidental
  // tap; the CTA stays disabled until it's checked.
  const [parentalConsentChecked, setParentalConsentChecked] = useState(false);

  // Onboarding progress bar — replaces the bare "STEP n OF total" text
  // with a row of amber pills (filled for completed/current, hollow for
  // upcoming). Rick: "login flow is a bit clunky." Visual progress gives
  // the user a sense of "almost there" and reduces the feeling of
  // wading through a multi-step form.
  const renderStepNav = (stepNum: number, total: number) => (
    <div style={{ display: "flex", flexDirection: "column", marginBottom: "10px", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {onBack ? (
          <button onClick={onBack} style={{ background: "none", border: "none", color: "rgba(247,240,227,0.45)", fontSize: "16px", cursor: "pointer", padding: "0 6px 0 0", lineHeight: 1, flexShrink: 0 }}>
            ←
          </button>
        ) : (
          <div style={{ width: "22px" }} />
        )}
        <div style={{ flex: 1, textAlign: "center", color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", letterSpacing: "0.12em", fontWeight: 700 }}>
          STEP {stepNum} OF {total}
        </div>
        <div style={{ width: "22px" }} />
      </div>
      <div style={{ display: "flex", gap: 4, padding: "0 8px" }}>
        {Array.from({ length: total }, (_, i) => {
          const idx = i + 1;
          const isDone = idx < stepNum;
          const isCurrent = idx === stepNum;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 999,
                background: isDone ? AMBER : isCurrent ? "rgba(247,201,93,0.65)" : "rgba(255,255,255,0.10)",
                transition: "background 240ms ease",
                boxShadow: isCurrent ? "0 0 8px rgba(247,201,93,0.4)" : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );

  const card: React.CSSProperties = {
    backgroundColor: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: "16px", padding: "18px 16px",
    display: "flex", flexDirection: "column", gap: "12px",
  };
  const inputStyle: React.CSSProperties = {
    backgroundColor: "rgba(255,255,255,0.07)", border: "1px solid rgba(201,146,42,0.3)",
    borderRadius: "10px", padding: "10px 12px", color: CREAM,
    fontFamily: "DM Sans, sans-serif", fontSize: "11px", outline: "none",
    width: "100%", boxSizing: "border-box",
  };
  const primaryBtn: React.CSSProperties = {
    width: "100%", backgroundColor: AMBER, color: NAVY,
    border: "none", borderRadius: "24px", padding: "11px",
    fontSize: "12px", fontFamily: "DM Sans, sans-serif", fontWeight: 800,
    cursor: "pointer",
  };

  if (isNana) {
    if (step === 0) {
      const canSubmitRegister = displayName.trim() && firstName.trim() && lastName.trim() && email.trim() && password.length >= 8;
      const canSubmitLogin = email.trim() && password.length >= 1;
      const polishedInput: React.CSSProperties = {
        backgroundColor: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(201,146,42,0.32)",
        borderRadius: 12,
        padding: "9px 12px",
        color: CREAM,
        fontFamily: "DM Sans, sans-serif",
        fontSize: 13,
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
        transition: "border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease",
      };
      return (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0b172e",
          backgroundImage: "radial-gradient(700px 380px at 80% -20%, rgba(201,146,42,0.20), transparent 70%), radial-gradient(560px 360px at -10% 110%, rgba(167,139,250,0.16), transparent 70%)",
          // Tightened from 18×20×20 → 10×16×12 so the form fits the
          // iPad viewport without overflow on most device sizes. Rick:
          // "here why scroll? all screens should be properly fit."
          padding: "10px 16px 12px",
          overflow: "auto",
          position: "relative",
        }}>
          <style>{`
            @keyframes onb-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes onb-mascot { 0%,100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-6px) rotate(2deg); } }
            .onb-input:focus { border-color: ${AMBER} !important; background-color: rgba(255,255,255,0.10) !important; box-shadow: 0 0 0 3px rgba(201,146,42,0.18) !important; }
            .onb-cta { background: linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%) !important; box-shadow: 0 10px 28px rgba(201,146,42,0.45) !important; }
            .onb-cta:not(:disabled):hover { transform: translateY(-1px); }
          `}</style>

          {/* Always-visible escape hatch. Rick: tapped Book Requests on
              the splash → flipped to Nana login → couldn't get back.
              The header `⇄ switch` pill is too easy to miss. */}
          {onSwitchUser && (
            <button
              onClick={onSwitchUser}
              style={{
                alignSelf: "flex-start",
                display: "inline-flex", alignItems: "center", gap: 6,
                marginBottom: 6,
                padding: "6px 12px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(247,201,93,0.45)",
                borderRadius: 999,
                color: AMBER,
                fontFamily: "DM Sans, sans-serif",
                fontSize: 11, fontWeight: 700,
                letterSpacing: "0.02em",
                cursor: "pointer",
                touchAction: "manipulation",
              }}
            >
              <span aria-hidden>←</span>
              <span>Back to home</span>
            </button>
          )}

          {/* Hero illustration + welcome */}
          <div style={{ textAlign: "center", marginBottom: 8, animation: "onb-rise 0.5s both" }}>
            <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", animation: "onb-mascot 2.8s ease-in-out infinite", filter: "drop-shadow(0 8px 20px rgba(201,146,42,0.35))" }}>
              <IllustReadStar color={AMBER} size={48} />
            </div>
            <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: 18, fontWeight: 700, marginTop: 2 }}>
              Welcome to <span style={{ color: AMBER }}>NeverMiss</span>
            </div>
            <div style={{ color: "rgba(247,240,227,0.55)", fontFamily: "Merriweather, serif", fontSize: 10, fontStyle: "italic", marginTop: 2 }}>
              Reading together, across any distance
            </div>
          </div>

          {/* Auth mode toggle */}
          <div style={{ display: "flex", backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 3, marginBottom: 8, animation: "onb-rise 0.55s 0.05s both" }}>
            {(["register", "login"] as const).map(m => (
              <button key={m} onClick={() => setAuthMode(m)} style={{
                flex: 1, border: "none", borderRadius: 10, padding: "7px 6px",
                fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 800,
                cursor: "pointer", transition: "all 0.18s",
                background: authMode === m ? "linear-gradient(135deg, #f7c95d, #C9922A)" : "transparent",
                color: authMode === m ? NAVY : "rgba(247,240,227,0.6)",
                boxShadow: authMode === m ? "0 4px 14px rgba(201,146,42,0.4)" : undefined,
                letterSpacing: "0.02em",
              }}>
                {m === "register" ? "Create Account" : "Log In"}
              </button>
            ))}
          </div>

          <div style={{
            backgroundColor: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 16,
            padding: "12px 14px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 9,
            backdropFilter: "blur(8px)",
            animation: "onb-rise 0.6s 0.1s both",
          }}>
            {authMode === "register" ? (
              <>
                <div>
                  <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", marginBottom: 6 }}>WHAT DO YOUR GRANDCHILDREN CALL YOU?</div>
                  <input className="onb-input" value={displayName} onChange={e => setDisplayName((e.target as HTMLInputElement).value)} placeholder="Nana, Grandma, Papa, Oma…" style={polishedInput} autoFocus />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="onb-input" value={firstName} onChange={e => setFirstName((e.target as HTMLInputElement).value)} placeholder="First name" style={{ ...polishedInput, flex: 1 }} />
                  <input className="onb-input" value={lastName} onChange={e => setLastName((e.target as HTMLInputElement).value)} placeholder="Last name" style={{ ...polishedInput, flex: 1 }} />
                </div>
                <input className="onb-input" value={email} onChange={e => setEmail((e.target as HTMLInputElement).value)} placeholder="Email address" type="email" style={polishedInput} />
                <input className="onb-input" value={password} onChange={e => setPassword((e.target as HTMLInputElement).value)} placeholder="Password (min 8 characters)" type="password" style={polishedInput} />
              </>
            ) : (
              <>
                <input className="onb-input" value={email} onChange={e => setEmail((e.target as HTMLInputElement).value)} placeholder="Email address" type="email" style={polishedInput} autoFocus />
                <input className="onb-input" value={password} onChange={e => setPassword((e.target as HTMLInputElement).value)} placeholder="Password" type="password" style={polishedInput} />
              </>
            )}
            {authError && (
              <div style={{
                color: "#fca5a5",
                fontFamily: "DM Sans, sans-serif", fontSize: 11, textAlign: "center", lineHeight: 1.45,
                backgroundColor: "rgba(239,68,68,0.10)",
                border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: 10,
                padding: "8px 10px",
              }}>{authError}</div>
            )}
            <button
              className="onb-cta"
              disabled={authLoading || (authMode === "register" ? !canSubmitRegister : !canSubmitLogin)}
              onClick={() => onNanaAuth(authMode === "login", { displayName, firstName, lastName, email, password })}
              style={{
                width: "100%",
                color: NAVY,
                border: "none",
                borderRadius: 999,
                padding: "11px 18px",
                fontSize: 13,
                fontFamily: "DM Sans, sans-serif",
                fontWeight: 800,
                letterSpacing: "0.02em",
                cursor: "pointer",
                opacity: (authLoading || (authMode === "register" ? !canSubmitRegister : !canSubmitLogin)) ? 0.4 : 1,
                transition: "transform 160ms cubic-bezier(0.22,1,0.36,1), opacity 160ms",
              }}
            >
              {authLoading ? "Please wait…" : authMode === "register" ? "Create Account →" : "Log In →"}
            </button>
            {/* Apple Guideline 5.1.1 + Privacy Policy v3 §11 require that
                account creation be an active opt-in to the Terms + Privacy
                Policy. Linked inline rather than a separate checkbox so
                the friction is minimal (one-tap principle) while still
                being a clear pre-account-creation disclosure. Shown only
                on register; logging in is a returning user. */}
            {authMode === "register" && (
              <div style={{
                color: "rgba(247,240,227,0.5)",
                fontFamily: "DM Sans, sans-serif",
                fontSize: 10,
                lineHeight: 1.55,
                textAlign: "center",
                marginTop: 2,
              }}>
                By creating an account, you agree to our{" "}
                <a
                  href="https://nevermiss.family/data/NeverMiss_Terms_of_Use_v2%20(1).pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: AMBER, textDecoration: "underline" }}
                >
                  Terms of Use
                </a>{" "}
                and{" "}
                <a
                  href="https://nevermiss.family/data/NeverMiss_Privacy_Policy_v3.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: AMBER, textDecoration: "underline" }}
                >
                  Privacy Policy
                </a>.
              </div>
            )}
            {authLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  border: '3px solid rgba(201,146,42,0.25)',
                  borderTopColor: AMBER,
                  animation: 'spin 0.9s linear infinite',
                }} />
                <span style={{ color: 'rgba(247,240,227,0.65)', fontFamily: 'DM Sans, sans-serif', fontSize: 11, textAlign: 'center', lineHeight: 1.45 }}>
                  Creating your reading room…<br/>
                  <span style={{ fontSize: 10, opacity: 0.7 }}>This takes a moment on first visit</span>
                </span>
              </div>
            )}
          </div>

          {/* Trust strip + skip */}
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, animation: "onb-rise 0.65s 0.15s both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: 9, letterSpacing: "0.08em" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>🔒 Private to your family</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>🇺🇸 Built for iPad</span>
            </div>
            <button onClick={onSkip} style={{ background: "none", border: "none", color: "rgba(247,240,227,0.35)", fontFamily: "DM Sans, sans-serif", fontSize: 10, cursor: "pointer", textDecoration: "underline" }}>
              Skip setup (demo mode)
            </button>
          </div>
        </div>
      );
    }

    if (step === 1) return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        backgroundColor: "#0b172e",
        backgroundImage: "radial-gradient(700px 380px at 80% -20%, rgba(201,146,42,0.18), transparent 70%), radial-gradient(560px 360px at -10% 110%, rgba(96,165,250,0.14), transparent 70%)",
        padding: "18px 20px 20px", overflow: "auto",
      }}>
        <style>{`
          @keyframes onb-rise2 { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes onb-shine { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        `}</style>
        {renderStepNav(2, 3)}
        <div style={{ textAlign: "center", marginBottom: 14, animation: "onb-rise2 0.5s both" }}>
          <div style={{ display: "inline-flex", filter: "drop-shadow(0 8px 22px rgba(201,146,42,0.35))" }}>
            <IllustPhone color={AMBER} size={56} />
          </div>
          <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: 20, fontWeight: 700, marginTop: 4 }}>
            Share this <span style={{ color: AMBER }}>code</span>
          </div>
          <div style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: 11, marginTop: 2 }}>
            {/* Pre-connection — we don't yet know the grandchild's name
                (her parent enters it on the other iPad after they join).
                Rick: "grandchild name can be anyone... at that screen it
                is hard coded." */}
            Send it to your grandchild's family to connect your iPads
          </div>
        </div>
        <div style={{
          backgroundColor: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 18,
          padding: "20px 18px 16px",
          display: "flex", flexDirection: "column", gap: 14,
          animation: "onb-rise2 0.55s 0.05s both",
        }}>
          <div style={{ textAlign: "center", position: "relative" }}>
            <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 9, letterSpacing: "0.18em", fontWeight: 800, marginBottom: 10 }}>FAMILY INVITE CODE</div>
            <div style={{
              position: "relative",
              background: "linear-gradient(135deg, rgba(247,201,93,0.14) 0%, rgba(201,146,42,0.18) 100%)",
              border: "2px solid rgba(201,146,42,0.55)",
              borderRadius: 14,
              padding: "16px 14px",
              fontFamily: "DM Sans, sans-serif", fontSize: 30, fontWeight: 900,
              color: AMBER, letterSpacing: "0.20em", fontVariantNumeric: "tabular-nums",
              boxShadow: "0 8px 24px rgba(201,146,42,0.20), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}>
              {/* Corner sparkles */}
              <span style={{ position: "absolute", top: -6, left: -6, fontSize: 12, animation: "nm-twinkle 2.4s ease-in-out infinite" }}>✨</span>
              <span style={{ position: "absolute", top: -4, right: -4, fontSize: 10, animation: "nm-twinkle 2.4s 0.6s ease-in-out infinite" }}>⭐</span>
              <span style={{ position: "absolute", bottom: -4, left: -4, fontSize: 10, animation: "nm-twinkle 2.4s 1.1s ease-in-out infinite" }}>💫</span>
              <span style={{ position: "absolute", bottom: -6, right: -6, fontSize: 12, animation: "nm-twinkle 2.4s 1.5s ease-in-out infinite" }}>✨</span>
              {inviteToken || "……"}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                onClick={() => { try { navigator.clipboard.writeText(inviteToken); } catch {} }}
                disabled={!inviteToken}
                style={{
                  flex: 1,
                  backgroundColor: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 10,
                  color: CREAM,
                  fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 700,
                  padding: "9px 12px",
                  cursor: inviteToken ? "pointer" : "not-allowed",
                  opacity: inviteToken ? 1 : 0.5,
                }}
              >
                📋 Copy code
              </button>
              <button
                onClick={() => {
                  if (!inviteToken) return;
                  const text = `Join me on NeverMiss to read together! Use this code: ${inviteToken}`;
                  try {
                    if ((navigator as Navigator & { share?: (data: { text: string }) => Promise<void> }).share) {
                      void (navigator as Navigator & { share: (data: { text: string }) => Promise<void> }).share({ text });
                    } else {
                      void navigator.clipboard.writeText(text);
                    }
                  } catch {}
                }}
                disabled={!inviteToken}
                style={{
                  flex: 1,
                  backgroundColor: "rgba(96,165,250,0.14)",
                  border: "1px solid rgba(96,165,250,0.55)",
                  borderRadius: 10,
                  color: "#cfe3ff",
                  fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 700,
                  padding: "9px 12px",
                  cursor: inviteToken ? "pointer" : "not-allowed",
                  opacity: inviteToken ? 1 : 0.5,
                }}
              >
                📤 Share
              </button>
            </div>
            <div style={{ color: "rgba(247,240,227,0.38)", fontFamily: "DM Sans, sans-serif", fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>
              Text or share this code with your grandchild's family
            </div>
          </div>
          <button
            onClick={onNanaCodeSent}
            style={{
              width: "100%",
              background: "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)",
              color: NAVY,
              border: "none",
              borderRadius: 999,
              padding: "13px 18px",
              fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 800,
              letterSpacing: "0.02em",
              cursor: "pointer",
              boxShadow: "0 10px 28px rgba(201,146,42,0.42)",
            }}
          >
            I've sent it! →
          </button>
          <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: 10, textAlign: "center", lineHeight: 1.5 }}>
            Read this code to your grandchild out loud, or copy and text it to their parent
          </div>
        </div>
      </div>
    );

    // Perry step 2 — logged in via PIN, waiting for Nana to kick off the session
    if (!isNana && step === 2) return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", padding: "20px 16px", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: "200px" }}>
          <div style={{ fontSize: "42px", marginBottom: "12px" }}>📚</div>
          <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "15px", fontWeight: 700, marginBottom: "8px" }}>You're in!</div>
          <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", lineHeight: 1.6 }}>
            Waiting for {nanaDisplayName} to start the session…
          </div>
          <div style={{ marginTop: "14px", display: "flex", gap: "5px", justifyContent: "center" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: AMBER, animation: `dot-bounce 1.4s ease-in-out ${i * 0.16}s infinite` }} />
            ))}
          </div>
        </div>
      </div>
    );

    if (step === 2) return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        backgroundColor: "#0b172e",
        backgroundImage: "radial-gradient(700px 400px at 50% -10%, rgba(201,146,42,0.16), transparent 70%), radial-gradient(560px 360px at -10% 110%, rgba(167,139,250,0.16), transparent 70%)",
        padding: "18px 20px 20px", gap: 14,
      }}>
        <style>{`
          @keyframes onb-pulse-ring { 0% { transform: scale(1); opacity: 0.55; } 100% { transform: scale(2.1); opacity: 0; } }
          @keyframes onb-mascot-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
          @keyframes onb-rise3 { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        `}</style>
        {renderStepNav(3, 3)}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
          <div style={{ textAlign: "center", animation: "onb-rise3 0.5s both" }}>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 90, height: 90 }}>
              {/* Pulsing rings */}
              <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `2px solid ${AMBER}`, animation: "onb-pulse-ring 2.2s ease-out infinite" }} />
              <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `2px solid ${AMBER}`, animation: "onb-pulse-ring 2.2s 1.1s ease-out infinite" }} />
              <div style={{ animation: "onb-mascot-float 2.6s ease-in-out infinite", filter: "drop-shadow(0 6px 18px rgba(201,146,42,0.35))" }}>
                <IllustMail color={AMBER} size={62} />
              </div>
            </div>
            <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: 18, fontWeight: 700, marginTop: 12, marginBottom: 6 }}>
              {/* Pre-connection — grandchild's name isn't known yet, so
                  generic phrasing instead of the literal "Perry". */}
              Waiting for <span style={{ color: AMBER }}>your grandchild's family</span>…
            </div>
            <div style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: 11, lineHeight: 1.55, maxWidth: 240, margin: "0 auto" }}>
              Once they enter the code on their iPad, you'll be connected automatically.
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 6, justifyContent: "center" }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: AMBER, animation: `dot-bounce 1.4s ease-in-out ${i * 0.16}s infinite` }} />
              ))}
            </div>
          </div>
          <div style={{
            background: "linear-gradient(135deg, rgba(247,201,93,0.10) 0%, rgba(201,146,42,0.16) 100%)",
            border: "1px dashed rgba(201,146,42,0.55)",
            borderRadius: 14, padding: "12px 18px",
            maxWidth: 240, textAlign: "center",
            animation: "onb-rise3 0.55s 0.05s both",
          }}>
            <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 9, fontWeight: 800, letterSpacing: "0.16em", marginBottom: 6 }}>INVITE CODE</div>
            <div style={{ color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: 20, fontWeight: 900, letterSpacing: "0.18em", fontVariantNumeric: "tabular-nums" }}>
              {inviteToken || "……"}
            </div>
            <div style={{ color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: 10, marginTop: 4 }}>
              Read this code to your grandchild out loud
            </div>
          </div>
          <button onClick={onSkip} style={{
            background: "none",
            border: "1px solid rgba(247,240,227,0.22)",
            borderRadius: 999,
            color: "rgba(247,240,227,0.55)",
            fontFamily: "DM Sans, sans-serif", fontSize: 10, fontWeight: 600,
            cursor: "pointer", padding: "8px 18px",
          }}>
            Skip onboarding →
          </button>
        </div>
      </div>
    );

    if (isNana) {
      const perryName = dashboardPerryName || getRoleLabel("child");
      const sortedProgress = [...dashboardProgress].sort(
        (a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime()
      );
      const lastSession = sortedProgress[0];
      const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      };
      return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", padding: "16px", overflow: "auto", gap: "10px" }}>
          {/* Greeting */}
          <div style={{ textAlign: "center", paddingTop: "6px" }}>
            <div style={{ color: "rgba(247,240,227,0.35)", fontFamily: "DM Sans, sans-serif", fontSize: "8px", letterSpacing: "0.1em", marginBottom: "2px" }}>NEVERMISS</div>
            <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "15px", fontWeight: 700 }}>
              Welcome back, {nanaDisplayName}!
            </div>
          </div>

          {/* Invite code — prominent so Nana can always share. Uses the
              dynamic perryName (= dashboardPerryName || "your grandchild")
              instead of a literal "Perry" so the label reads correctly
              for any grandchild name. */}
          {inviteToken && (
            <div style={{ backgroundColor: "rgba(201,146,42,0.10)", border: "1px solid rgba(201,146,42,0.45)", borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: "8px", fontWeight: 700, letterSpacing: "0.09em", marginBottom: "6px" }}>{perryName.toUpperCase()}'S INVITE CODE — tell {perryName} this code</div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: "22px", fontWeight: 900, letterSpacing: "0.22em", flex: 1 }}>{inviteToken}</div>
                <button
                  onClick={() => navigator.clipboard.writeText(inviteToken).catch(() => {})}
                  style={{ backgroundColor: "rgba(201,146,42,0.2)", border: "1px solid rgba(201,146,42,0.5)", borderRadius: "8px", color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700, cursor: "pointer", padding: "5px 10px", flexShrink: 0 }}
                >
                  📋 Copy
                </button>
              </div>
            </div>
          )}

          {/* Perry connection card */}
          <div style={{ backgroundColor: "rgba(247,240,227,0.04)", border: "1px solid rgba(247,240,227,0.10)", borderRadius: "12px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", backgroundColor: "rgba(201,146,42,0.18)", border: "2px solid rgba(201,146,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", flexShrink: 0 }}>
              👧
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: "13px", fontWeight: 700 }}>{perryName}</div>
              <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "8px", marginTop: "2px" }}>
                {lastSession
                  ? `Last read ${formatDate(lastSession.lastReadAt)}`
                  : "Ready for your first session!"}
              </div>
            </div>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#22c55e", flexShrink: 0 }} />
          </div>

          {/* Reading history */}
          <div>
            <div style={{ color: "rgba(247,240,227,0.35)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", marginBottom: "6px" }}>
              READING HISTORY
            </div>
            {dashboardLoading ? (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ display: "inline-flex", gap: "4px" }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: AMBER, opacity: 0.6, animation: `dot-bounce 1.4s ease-in-out ${i * 0.16}s infinite` }} />
                  ))}
                </div>
              </div>
            ) : sortedProgress.length === 0 ? (
              <div style={{ textAlign: "center", padding: "14px", backgroundColor: "rgba(247,240,227,0.03)", border: "1px dashed rgba(247,240,227,0.12)", borderRadius: "10px" }}>
                <div style={{ fontSize: "22px", marginBottom: "5px" }}>📖</div>
                <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", lineHeight: 1.5 }}>
                  This will be your first session together!<br />Choose a book below to get started.
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {sortedProgress.map(p => {
                  const book = booksLibrary[p.bookId];
                  if (!book) return null;
                  const pagesTotal = book.pages.length;
                  const pct = Math.round((p.currentPage / pagesTotal) * 100);
                  const isFinished = p.currentPage >= pagesTotal;
                  const isSelected = dashSelectedBook?.bookId === p.bookId;
                  const startPage = isFinished ? 1 : p.currentPage;
                  return (
                    <div
                      key={p.bookId}
                      onClick={() => setDashSelectedBook(isSelected ? null : { bookId: p.bookId, startPage })}
                      style={{
                        backgroundColor: isSelected ? "rgba(201,146,42,0.10)" : "rgba(247,240,227,0.04)",
                        border: isSelected ? `1px solid ${AMBER}` : "1px solid rgba(247,240,227,0.08)",
                        borderRadius: "9px", padding: "8px 10px", cursor: "pointer",
                        transition: "border-color 0.2s, background-color 0.2s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                        <div style={{ fontSize: "16px" }}>{book.emoji}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700 }}>{book.title}</div>
                          <div style={{ color: "rgba(247,240,227,0.35)", fontFamily: "DM Sans, sans-serif", fontSize: "11px" }}>
                            {isFinished
                              ? `Finished · ${formatDate(p.lastReadAt)}`
                              : `Page ${p.currentPage} of ${pagesTotal} · ${formatDate(p.lastReadAt)}`}
                          </div>
                        </div>
                        {isFinished
                          ? <div style={{ color: "#22c55e", fontSize: "10px" }}>✓</div>
                          : isSelected
                            ? <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: "8px", fontWeight: 700 }}>Selected ✓</div>
                            : <div style={{ color: "rgba(247,240,227,0.25)", fontFamily: "DM Sans, sans-serif", fontSize: "8px" }}>Tap to pick</div>
                        }
                      </div>
                      <div style={{ height: "3px", backgroundColor: "rgba(247,240,227,0.08)", borderRadius: "2px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, backgroundColor: book.spineColor || AMBER, borderRadius: "2px", transition: "width 0.4s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tagline */}
          <div style={{ textAlign: "center", padding: "6px 0 2px" }}>
            <div style={{ color: "rgba(247,240,227,0.38)", fontFamily: "Playfair Display, serif", fontSize: "9.5px", fontStyle: "italic", lineHeight: 1.55, letterSpacing: "0.01em" }}>
              Reading is the vehicle.<br />Relationship is the destination.
            </div>
          </div>

          {/* Start session */}
          {dashSelectedBook ? (() => {
            const db = booksLibrary[dashSelectedBook.bookId];
            const fullChap = db?.pages[dashSelectedBook.startPage - 1]?.leftChapter ?? "";
            const chapRef = fullChap.split(" · ")[0];
            return (
              <button
                onClick={() => onBeginWithBook?.(dashSelectedBook.bookId, dashSelectedBook.startPage)}
                style={{ ...primaryBtn, marginTop: "auto", fontSize: "11px" }}
              >
                Continue {db?.title ?? "reading"} · {chapRef}, page {dashSelectedBook.startPage} →
              </button>
            );
          })() : (
            <button onClick={onBeginSession} style={{ ...primaryBtn, marginTop: "auto" }}>
              Start session →
            </button>
          )}
        </div>
      );
    }

    // Perry's post-login waiting screen
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", padding: "20px 16px", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", animation: "fade-in 0.5s ease-out", maxWidth: "220px" }}>
          <div style={{ fontSize: "40px", marginBottom: "14px" }}>📖</div>
          <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "15px", fontWeight: 700, marginBottom: "8px" }}>
            Ready to read!
          </div>
          <div style={{ color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", lineHeight: 1.7, marginBottom: "18px" }}>
            Waiting for {nanaDisplayName} to start the session…
          </div>
          <div style={{ display: "flex", gap: "5px", justifyContent: "center" }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: AMBER, animation: `dot-bounce 1.4s ease-in-out ${i * 0.16}s infinite` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Perry's returning device — PIN login
  if (!isNana && perryPinMode) {
    const name = perryPinChildName || getRoleLabel("child");
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", padding: "20px 16px", alignItems: "center", justifyContent: "center", position: "relative" }}>
        {onSwitchUser && (
          <button
            onClick={onSwitchUser}
            style={{
              position: "absolute", top: 14, left: 14,
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 13px",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(247,201,93,0.45)",
              borderRadius: 999,
              color: AMBER,
              fontFamily: "DM Sans, sans-serif",
              fontSize: 12, fontWeight: 700,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            <span aria-hidden>←</span>
            <span>Back to home</span>
          </button>
        )}
        <div style={{ width: "100%", maxWidth: "280px" }}>
          <div style={{ textAlign: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "36px", marginBottom: "8px" }}>🔐</div>
            <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "15px", fontWeight: 700 }}>
              Reading with {nanaDisplayName}
            </div>
            <div style={{ color: "rgba(247,240,227,0.65)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", marginTop: "6px", lineHeight: 1.5 }}>
              {pinScreenExpectedChild
                ? <>It's <strong>{pinScreenExpectedChild.name}</strong>'s turn — enter your 4-digit PIN to take over.</>
                : pinScreenChildren.length > 1
                  ? "Tap your name, then enter your 4-digit PIN."
                  : <>Last visit was <strong>{name}</strong>. Enter <strong>your</strong> 4-digit PIN — different brothers and sisters can each use their own PIN here.</>}
            </div>
          </div>

          {/* Sibling avatar row — visual reminder that the iPad serves
              multiple kids. Pure UI hint; PIN matching still happens
              server-side across all children. Tapping an avatar focuses
              the PIN input. Only renders for multi-child connections. */}
          {pinScreenChildren.length > 1 && (
            <div
              role="group"
              aria-label="Brothers and sisters on this iPad"
              style={{
                display: "flex", gap: 8, justifyContent: "center",
                flexWrap: "wrap", marginBottom: 12,
                padding: "0 4px",
              }}
            >
              {pinScreenChildren.map((c) => {
                const pal = paletteForChild(c.id);
                const initial = c.name.trim().charAt(0).toUpperCase() || "?";
                return (
                  <div
                    key={c.id}
                    style={{
                      display: "inline-flex", flexDirection: "column",
                      alignItems: "center", gap: 4,
                      width: 56,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 44, height: 44, borderRadius: "50%",
                        backgroundColor: pal.bg,
                        border: `2px solid ${pal.border}`,
                        color: pal.text,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "DM Sans, sans-serif",
                        fontSize: 18, fontWeight: 800,
                      }}
                    >{initial}</span>
                    <span style={{
                      color: "rgba(247,240,227,0.78)",
                      fontFamily: "DM Sans, sans-serif",
                      fontSize: 11, fontWeight: 700,
                      letterSpacing: "0.02em",
                      textAlign: "center",
                      lineHeight: 1.2,
                      maxWidth: 56,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>{c.name || "Unnamed"}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div style={card}>
            <input
              value={pinEntry}
              onChange={e => setPinEntry((e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              inputMode="numeric"
              maxLength={4}
              type="password"
              autoFocus
              style={{
                ...inputStyle,
                textAlign: "center", fontSize: "24px", fontWeight: 800,
                letterSpacing: "0.3em",
                borderColor: perryPinError ? "#ef4444" : "rgba(201,146,42,0.3)",
              }}
            />
            {perryPinError && (
              <div style={{ color: "#ef4444", fontFamily: "DM Sans, sans-serif", fontSize: "11px", textAlign: "center" }}>
                {perryPinError}
              </div>
            )}
            <button
              disabled={pinEntry.length !== 4 || perryPinLoading}
              onClick={() => onPerryPinLogin?.(pinEntry)}
              style={{ ...primaryBtn, opacity: pinEntry.length === 4 && !perryPinLoading ? 1 : 0.4 }}
            >
              {perryPinLoading ? "Checking…" : "Join Nana →"}
            </button>
          </div>
          {/* Switch Reader — promoted to a proper secondary CTA tier
              matching "Join Nana →" in size and prominence. Rick:
              "Switch Reader button is hard to find — I saw it once
              and cannot find it again." Was an unobtrusive 12px green
              outline below the PIN; now a full-width two-line pill
              that sits at the top of the secondary actions so a family
              with multiple readers finds it on every launch. */}
          <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "10px", alignItems: "stretch" }}>
            <button
              onClick={() => onAddSibling?.()}
              style={{
                width: "100%",
                background: "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(34,197,94,0.08) 100%)",
                border: "1.5px solid #22c55e",
                borderRadius: 16,
                color: "#dcfce7",
                fontFamily: "DM Sans, sans-serif",
                cursor: "pointer",
                padding: "12px 14px",
                textAlign: "left",
                display: "flex", alignItems: "center", gap: 12,
                minHeight: 56,
                boxShadow: "0 6px 18px rgba(34,197,94,0.18)",
                touchAction: "manipulation",
              }}
            >
              <span aria-hidden style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>👥</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.01em", color: "#86efac" }}>
                  Switch Reader
                </div>
                <div style={{ fontSize: 11, fontWeight: 500, marginTop: 2, color: "rgba(220,252,231,0.75)", lineHeight: 1.35 }}>
                  Brother or sister here? Tap to set them up.
                </div>
              </div>
              <span aria-hidden style={{ fontSize: 18, opacity: 0.7, color: "#86efac" }}>→</span>
            </button>
            <button
              onClick={() => onUseDifferentInvite?.()}
              style={{
                alignSelf: "center",
                background: "none", border: "none",
                borderRadius: 999,
                color: "rgba(247,240,227,0.55)",
                fontFamily: "DM Sans, sans-serif",
                fontSize: 11, fontWeight: 600,
                cursor: "pointer",
                padding: "6px 12px",
                textAlign: "center",
                textDecoration: "underline",
                textDecorationColor: "rgba(247,240,227,0.25)",
                textUnderlineOffset: 3,
              }}
            >
              A different family / invite code
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Perry's parent side
  if (step === 0) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", padding: "20px 16px", overflow: "auto" }}>
      {onSwitchUser && (
        <button
          onClick={onSwitchUser}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex", alignItems: "center", gap: 6,
            marginBottom: 8,
            padding: "7px 13px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(247,201,93,0.45)",
            borderRadius: 999,
            color: AMBER,
            fontFamily: "DM Sans, sans-serif",
            fontSize: 12, fontWeight: 700,
            cursor: "pointer",
            touchAction: "manipulation",
          }}
        >
          <span aria-hidden>←</span>
          <span>Back to home</span>
        </button>
      )}
      <div style={{ textAlign: "center", marginBottom: "16px" }}>
        <div style={{ fontSize: "32px", marginBottom: "6px" }}>📬</div>
        <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "14px", fontWeight: 700 }}>You've been invited!</div>
        <div style={{ color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", marginTop: "3px" }}>
          {perryLookupNanaName ? `Connecting to ${perryLookupNanaName}'s family` : "Enter the code from your grandparent"}
        </div>
      </div>
      <div style={card}>
        <div style={{ color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: "10px", fontWeight: 600 }}>Family code</div>
        <input
          value={codeEntry}
          onChange={e => setCodeEntry((e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          placeholder="e.g. D36UZ6"
          maxLength={6}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          style={{
            ...inputStyle,
            textAlign: "center", fontSize: "20px", fontWeight: 800,
            letterSpacing: "0.15em",
            borderColor: perryInviteError ? "#ef4444" : perryLookupNanaName ? "#22c55e" : "rgba(201,146,42,0.3)",
          }}
          autoFocus
        />
        {perryInviteError && (
          <div style={{ color: "#ef4444", fontFamily: "DM Sans, sans-serif", fontSize: "11px", textAlign: "center" }}>
            {perryInviteError}
          </div>
        )}
        {perryLookupNanaName && !perryInviteError && (
          <div style={{ color: "#22c55e", fontFamily: "DM Sans, sans-serif", fontSize: "11px", textAlign: "center" }}>
            ✓ Connected to {perryLookupNanaName}'s family!
          </div>
        )}
        <button
          disabled={authLoading}
          onClick={() => codeEntry.trim().length === 6 && onPerryCodeSubmit(codeEntry.trim())}
          style={{ ...primaryBtn, opacity: (codeEntry.trim().length === 6 && !authLoading) ? 1 : 0.4 }}
        >
          {authLoading ? "Checking…" : "Connect →"}
        </button>
      </div>
      {/* ── TEST CODE SHORTCUT ── */}
      <div style={{ marginTop: "10px", padding: "8px 10px", backgroundColor: "rgba(139,92,246,0.08)", border: "1px dashed rgba(139,92,246,0.35)", borderRadius: "10px", textAlign: "center" }}>
        <div style={{ color: "rgba(167,139,250,0.7)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: "0.07em", marginBottom: "5px" }}>🧪 TESTING</div>
        <button
          onClick={() => setCodeEntry("TEST99")}
          style={{ background: "none", border: "1px solid rgba(139,92,246,0.45)", borderRadius: "20px", color: "rgba(167,139,250,0.9)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700, cursor: "pointer", padding: "4px 14px" }}
        >
          Fill test code →
        </button>
        <div style={{ color: "rgba(167,139,250,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: "10px", marginTop: "4px" }}>
          invite code: TEST99
        </div>
      </div>

      <button onClick={onSkip} style={{ background: "none", border: "none", color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", cursor: "pointer", marginTop: "8px", textAlign: "center" }}>
        Skip setup (demo mode)
      </button>
    </div>
  );

  if (step === 1) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", padding: "16px", overflow: "auto" }}>
      {/* Escape row — Rick: "when granchild goes to the screen where
          he adds the name age and pin etc, also he can't move." Adds
          Back (to invite-code entry) and Back to home (out of
          onboarding entirely). Mirrors step 0's escape pattern. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 13px",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(247,201,93,0.45)",
              borderRadius: 999,
              color: AMBER,
              fontFamily: "DM Sans, sans-serif",
              fontSize: 12, fontWeight: 700,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            <span aria-hidden>←</span>
            <span>Back</span>
          </button>
        )}
        {onSwitchUser && (
          <button
            onClick={onSwitchUser}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 13px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 999,
              color: "rgba(247,240,227,0.7)",
              fontFamily: "DM Sans, sans-serif",
              fontSize: 12, fontWeight: 700,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            <span aria-hidden>⇄</span>
            <span>Back to home</span>
          </button>
        )}
      </div>
      {renderStepNav(2, 2)}
      <div style={{ textAlign: "center", marginBottom: "14px" }}>
        <div style={{ fontSize: "26px", marginBottom: "4px" }}>📚</div>
        <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "13px", fontWeight: 700 }}>Tell us about your reader</div>
      </div>
      <div style={card}>
        <div>
          <div style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: "8px", marginBottom: "5px" }}>CHILD'S NAME</div>
          <input value={childName} onChange={e => setChildName((e.target as HTMLInputElement).value)} placeholder="e.g. Perry" style={inputStyle} autoFocus />
        </div>
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "6px" }}>
            <input
              type="checkbox"
              checked={birthdayOptOut}
              onChange={e => setBirthdayOptOut((e.target as HTMLInputElement).checked)}
              style={{ accentColor: AMBER, width: "13px", height: "13px" }}
            />
            <span style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: "8px", lineHeight: 1.4 }}>
              Skip birthday — don't show my child's age in the Memory Vault
            </span>
          </label>
          {!birthdayOptOut && (
            <>
              <div style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: "8px", marginBottom: "5px" }}>DATE OF BIRTH</div>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
                  <input
                    value={childBirthMonth}
                    onChange={e => {
                      const v = (e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 2);
                      setChildBirthMonth(v);
                      if (v.length === 2) birthDayRef.current?.focus();
                    }}
                    placeholder="MM"
                    inputMode="numeric"
                    maxLength={2}
                    style={{ ...inputStyle, width: "38px", textAlign: "center", padding: "10px 4px" }}
                  />
                  <span style={{ color: "rgba(247,240,227,0.25)", fontFamily: "DM Sans, sans-serif", fontSize: "10px", marginTop: "2px" }}>Month</span>
                </div>
                <span style={{ color: "rgba(247,240,227,0.3)", fontSize: "14px", paddingBottom: "14px" }}>/</span>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
                  <input
                    ref={birthDayRef}
                    value={childBirthDay}
                    onChange={e => {
                      const v = (e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 2);
                      setChildBirthDay(v);
                      if (v.length === 2) birthYearRef.current?.focus();
                    }}
                    placeholder="DD"
                    inputMode="numeric"
                    maxLength={2}
                    style={{ ...inputStyle, width: "38px", textAlign: "center", padding: "10px 4px" }}
                  />
                  <span style={{ color: "rgba(247,240,227,0.25)", fontFamily: "DM Sans, sans-serif", fontSize: "10px", marginTop: "2px" }}>Day</span>
                </div>
                <span style={{ color: "rgba(247,240,227,0.3)", fontSize: "14px", paddingBottom: "14px" }}>/</span>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                  <input
                    ref={birthYearRef}
                    value={childBirthYear}
                    onChange={e => {
                      const v = (e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 4);
                      setChildBirthYear(v);
                      if (v.length === 4) childPin_ref.current?.focus();
                    }}
                    placeholder="YYYY"
                    inputMode="numeric"
                    maxLength={4}
                    style={{ ...inputStyle, width: "56px", textAlign: "center", padding: "10px 4px" }}
                  />
                  <span style={{ color: "rgba(247,240,227,0.25)", fontFamily: "DM Sans, sans-serif", fontSize: "10px", marginTop: "2px" }}>Year</span>
                </div>
              </div>
              <div style={{ color: "rgba(247,240,227,0.3)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", marginTop: "4px" }}>
                Used to show your child's age at the time of each reading in the Memory Vault.
              </div>
            </>
          )}
        </div>
        <div>
          <div style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: "8px", marginBottom: "5px" }}>4-DIGIT PIN (for your child to log in)</div>
          <input
            ref={childPin_ref}
            value={childPin}
            onChange={e => setChildPin((e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 4))}
            placeholder="••••"
            type={pinFocus ? "text" : "password"}
            onFocus={() => setPinFocus(true)}
            onBlur={() => setPinFocus(false)}
            inputMode="numeric"
            style={{ ...inputStyle, letterSpacing: "0.2em", textAlign: "center", fontSize: "16px" }}
          />
        </div>
        {/* COPPA parental affirmation — required before child data can
            be stored. Privacy Policy v3 §3. The checkbox + tap is the
            consent moment Apple's reviewers look for. */}
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            backgroundColor: "rgba(247,201,93,0.06)",
            border: parentalConsentChecked ? `1px solid ${AMBER}` : "1px solid rgba(247,201,93,0.30)",
            borderRadius: 12,
            padding: "10px 12px",
            cursor: "pointer",
            transition: "border-color 160ms ease, background-color 160ms ease",
          }}
        >
          <input
            type="checkbox"
            checked={parentalConsentChecked}
            onChange={(e) => setParentalConsentChecked((e.target as HTMLInputElement).checked)}
            style={{
              width: 18, height: 18, marginTop: 1,
              accentColor: AMBER,
              cursor: "pointer",
              flexShrink: 0,
            }}
          />
          <div style={{
            color: "rgba(247,240,227,0.75)",
            fontFamily: "DM Sans, sans-serif",
            fontSize: 10, lineHeight: 1.5,
          }}>
            I am the parent or legal guardian of <strong style={{ color: CREAM }}>{childName.trim() || "this child"}</strong>{" "}
            and I consent to NeverMiss collecting their first name, optional date of birth, and 4-digit PIN to enable family reading sessions, as described in our{" "}
            <a
              href="https://nevermiss.family/data/NeverMiss_Privacy_Policy_v3.pdf"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ color: AMBER, textDecoration: "underline" }}
            >
              Privacy Policy
            </a>.
          </div>
        </label>
        <button
          disabled={authLoading}
          onClick={() => {
            if (childName.trim() && birthdayValid && childPin.length === 4 && parentalConsentChecked) {
              onChildProfileConfirm(childName.trim(), childBirthday, childPin);
            }
          }}
          style={{ ...primaryBtn, opacity: (childName.trim() && birthdayValid && childPin.length === 4 && parentalConsentChecked && !authLoading) ? 1 : 0.4 }}
        >
          All set! →
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", padding: "20px 16px", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", animation: "fade-in 0.5s ease-out" }}>
        <div style={{ fontSize: "44px", marginBottom: "12px" }}>🎉</div>
        <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "15px", fontWeight: 700, marginBottom: "6px" }}>
          You're connected with {nanaDisplayName}!
        </div>
        <div style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", lineHeight: 1.6, marginBottom: "20px" }}>
          All set! Your reading adventure begins now.
        </div>
        <button onClick={onBeginSession} style={{ ...primaryBtn, width: "auto", padding: "11px 24px" }}>
          Begin first session →
        </button>
      </div>
    </div>
  );
}

/* ─── Memory Vault View ──────────────────────────────────── */

function computeAge(birthday: string, sessionDate: string): number {
  const bd = new Date(birthday);
  const sd = new Date(sessionDate);
  let age = sd.getFullYear() - bd.getFullYear();
  const m = sd.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && sd.getDate() < bd.getDate())) age--;
  return age;
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/* ─── Home / Landing screen for Nana ───────────────────────
 *
 * Rick's design (received as a mockup): a stable landing page Nana
 * sees BEFORE she begins a reading session. Lets her see who's coming
 * up next, jump straight into reading, and access the Memory Vault /
 * Library / Schedule outside of an active session. Solves three real
 * problems: video startup delay perception, no way to reach the vault
 * between sessions, and no "between sessions" identity.
 */

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Hello";
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  if (h < 22) return "Good Evening";
  return "Hello";
}

/** Perry-side passive waiting screen — shown when Nana is on one of her
 *  dashboard screens (home / library / vault / settings / book requests).
 *  Perry can't drive those flows, so we replace the actual view with a
 *  contextual message about what Nana is doing. Rick: "perry should
 *  wait at the getting started screen for nana to connect" — she needs
 *  to see what's happening so she's not staring at a static screen. */
function PerryAwaitingView({
  nanaName,
  forMode,
  onExit,
}: {
  nanaName: string;
  forMode: "home" | "library" | "vault" | "bookrequests" | "settings";
  /** NEED 1 — Perry's escape from the awaiting screen. Without this
   *  she's locked watching the "waiting for Nana" message until Nana
   *  navigates back into a session mode. Rick called this out as a
   *  high-severity gap ("easy to get trapped with no way back").
   *  Wired in App to drop Perry back to the PIN/Switch User screen. */
  onExit?: () => void;
}) {
  const nameOrNana = nanaName || "Nana";
  const contextLine = (() => {
    switch (forMode) {
      case "home":         return `${nameOrNana} is here!`;
      case "library":      return `${nameOrNana} is choosing a book…`;
      case "vault":        return `${nameOrNana} is looking back at memories…`;
      case "bookrequests": return `${nameOrNana} is checking book requests…`;
      case "settings":     return `${nameOrNana} is adjusting settings…`;
    }
  })();
  const emoji = (() => {
    switch (forMode) {
      case "home":         return "🐰";
      case "library":      return "📚";
      case "vault":        return "📼";
      case "bookrequests": return "📬";
      case "settings":     return "⚙️";
    }
  })();
  return (
    <div style={{
      flex: 1,
      display: "flex", flexDirection: "column",
      backgroundColor: "#0b172e",
      padding: "20px 16px",
      alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ textAlign: "center", maxWidth: "260px" }}>
        <div style={{
          fontSize: "56px", marginBottom: "14px",
          animation: "bob 2.4s ease-in-out infinite",
        }}>{emoji}</div>
        {/* Top line: what Nana is doing right now — gives Perry awareness
            of the off-screen activity she can't drive. */}
        <div style={{
          color: AMBER,
          fontFamily: "Playfair Display, serif",
          fontSize: "16px", fontWeight: 700,
          marginBottom: "12px",
          lineHeight: 1.3,
        }}>
          {contextLine}
        </div>
        {/* Bottom line: the explicit "wait for Nana" cue. Rick: "we need
            to show msg at her/his screen that waiting for nana to start
            session." Without this, Perry sees the contextual line and
            isn't sure whether to tap anything — making the wait
            requirement explicit removes that ambiguity. */}
        <div style={{
          color: "rgba(247,240,227,0.7)",
          fontFamily: "DM Sans, sans-serif",
          fontSize: "12px", fontWeight: 500,
          lineHeight: 1.55,
          marginBottom: "4px",
        }}>
          Waiting for {nameOrNana} to start the session…
        </div>
        <div style={{
          marginTop: 14,
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "6px 12px",
          background: "rgba(247,201,93,0.08)",
          border: "1px solid rgba(247,201,93,0.22)",
          borderRadius: 999,
          color: "rgba(247,201,93,0.85)",
          fontFamily: "DM Sans, sans-serif",
          fontSize: 10, fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: AMBER,
            animation: "nm-twinkle 1.4s ease-in-out infinite",
          }} />
          Hang tight
        </div>
        {/* NEED 1 — explicit escape so Perry isn't trapped while Nana
            is off in a non-session screen. Tapping returns her to the
            Switch User / PIN entry. */}
        {onExit && (
          <div style={{ marginTop: 22 }}>
            <button
              type="button"
              onClick={onExit}
              style={{
                background: "rgba(255,255,255,0.06)",
                color: AMBER,
                border: "1px solid rgba(247,201,93,0.45)",
                borderRadius: 999,
                padding: "10px 18px",
                fontFamily: "DM Sans, sans-serif",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.04em",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                minHeight: 44,
                touchAction: "manipulation",
              }}
            >
              <span aria-hidden style={{ fontSize: 14 }}>⇄</span>
              <span>Switch user</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function NanaHomeView({
  nanaName,
  childName,
  scheduleProposal,
  onStartReading,
  onOpenLibrary,
  onOpenVault,
  onOpenSchedule,
  onOpenBookRequests,
  onOpenSettings,
  onSwitchDevice,
  publicMode = false,
  onSignIn,
  onJoinAsChild,
  perryConnected = false,
  // Family Journal — Rick: "doesn't feel prominent to me right now —
  // worth revisiting." Adding a sidebar nav item, a home quick-tile,
  // and a hero "Latest Memory" surface so the journal stops being a
  // hidden corner of the reading-mode toolbar.
  onOpenFamilyStories,
  familyStoryEntries = [],
  // Multi-child support — list of siblings on this connection plus the
  // current active one. Empty list = single-child legacy path; the
  // picker hides itself. Rick: "real workflow gap — Nana reads with
  // Perry, finishes, now wants to read with Cooper."
  childrenList = [],
  activeChildId = null,
  onSelectChild,
  onOpenAddChild,
}: {
  nanaName: string;
  childName: string;
  scheduleProposal: ScheduleProposal | null;
  onStartReading: () => void;
  onOpenLibrary: () => void;
  onOpenVault: () => void;
  onOpenSchedule: () => void;
  onOpenBookRequests: () => void;
  onOpenSettings: () => void;
  onSwitchDevice: () => void;
  /** When true, show the homepage to a logged-out visitor with a Sign In CTA. */
  publicMode?: boolean;
  onSignIn?: () => void;
  onJoinAsChild?: () => void;
  /** When true, show a "Perry is here, waiting" badge in the hero. Drives
   *  Nana's awareness that Perry is currently connected and waiting for
   *  her to start the session. */
  perryConnected?: boolean;
  onOpenFamilyStories?: () => void;
  familyStoryEntries?: FamilyStoryEntry[];
  childrenList?: Child[];
  activeChildId?: string | null;
  onSelectChild?: (childId: string) => void;
  onOpenAddChild?: () => void;
}) {
  const greeting = publicMode ? "Welcome" : timeOfDayGreeting();
  const nextSessionLabel = publicMode
    ? "Sign in to schedule your next reading session."
    : scheduleProposal
    ? `${scheduleProposal.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} at ${scheduleProposal.time}`
    : "Not scheduled yet — start a session anytime";

  return (
    <div
      className={`nm-home ${publicMode ? "nm-home-public" : ""}`}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "row",
        backgroundColor: "#0b172e",
        backgroundImage: "radial-gradient(900px 480px at 85% -10%, rgba(201,146,42,0.18), transparent 70%), radial-gradient(700px 420px at -10% 110%, rgba(96,165,250,0.14), transparent 70%)",
        overflow: "auto",
        minHeight: "100%",
      }}
    >
      <style>{`
        .nm-home { font-family: "DM Sans", sans-serif; }

        /* ─── Playful animations for the kids-friendly homepage ─── */
        @keyframes nm-bounce-soft { 0%,100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-12px) rotate(3deg); } }
        @keyframes nm-float-slow  { 0%,100% { transform: translateY(0) translateX(0); } 50% { transform: translateY(-10px) translateX(6px); } }
        @keyframes nm-spin-slow   { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes nm-twinkle     { 0%,100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
        @keyframes nm-pulse-glow  { 0%,100% { box-shadow: 0 8px 28px rgba(201,146,42,0.45), 0 0 0 0 rgba(201,146,42,0.4); } 50% { box-shadow: 0 12px 36px rgba(201,146,42,0.6), 0 0 0 14px rgba(201,146,42,0); } }
        @keyframes nm-rainbow-shift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes nm-tilt-wobble { 0%,100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
        @keyframes nm-rise-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes nm-pop-in { 0% { opacity: 0; transform: scale(0.6); } 70% { transform: scale(1.08); } 100% { opacity: 1; transform: scale(1); } }

        .nm-home .nm-home-hero-illus { position: relative; overflow: hidden; }
        .nm-home .nm-home-hero-illus::before {
          content: "";
          position: absolute; inset: -10% -10% auto auto;
          width: 220px; height: 220px; border-radius: 50%;
          background: radial-gradient(closest-side, rgba(247,201,93,0.30), transparent 70%);
          animation: nm-float-slow 6s ease-in-out infinite;
          pointer-events: none;
        }
        .nm-home .nm-home-hero-illus::after {
          content: "";
          position: absolute; inset: auto auto -20% -10%;
          width: 200px; height: 200px; border-radius: 50%;
          background: radial-gradient(closest-side, rgba(167,139,250,0.25), transparent 70%);
          animation: nm-float-slow 7s ease-in-out infinite reverse;
          pointer-events: none;
        }
        .nm-floater { position: absolute; pointer-events: none; user-select: none; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.25)); }
        .nm-mascot { animation: nm-bounce-soft 2.6s ease-in-out infinite; transform-origin: center bottom; }
        .nm-cta-primary { animation: nm-pulse-glow 2.4s ease-in-out infinite; }
        .nm-cta-primary:hover { transform: translateY(-2px) scale(1.02); }
        .nm-cta-primary:active { transform: translateY(0) scale(0.98); }

        /* Game-like quick tiles: gradient border + lift + animated icon — applies in both modes */
        .nm-home .nm-home-tile { transition: transform 220ms cubic-bezier(0.22,1,0.36,1), box-shadow 220ms ease, border-color 220ms ease; }
        .nm-home .nm-home-tile:hover { transform: translateY(-6px) scale(1.02); box-shadow: 0 18px 40px rgba(0,0,0,0.35); }
        .nm-home .nm-home-tile:hover .nm-tile-icon { animation: nm-tilt-wobble 0.6s ease-in-out infinite; }

        /* Sparkles scattered behind the hero */
        .nm-spark { position: absolute; pointer-events: none; font-size: 14px; animation: nm-twinkle 2.2s ease-in-out infinite; }

        /* Steps strip */
        .nm-step-card { animation: nm-rise-in 0.6s both; }

        /* Desktop ≥1200px — generous breathing room, larger sidebar/typography */
        @media (min-width: 1200px) {
          .nm-home-aside { width: 220px !important; padding: 22px 14px !important; gap: 14px !important; }
          .nm-home-aside .nm-profile-avatar { width: 72px !important; height: 72px !important; font-size: 30px !important; }
          .nm-home-aside .nm-profile-name { font-size: 16px !important; }
          .nm-home-aside .nm-sidebar-label { font-size: 14px !important; }
          .nm-home-header { padding: 22px 36px 14px !important; }
          .nm-home-hero-pad { padding: 14px 36px 18px !important; }
          .nm-home-hero { padding: 22px 24px !important; gap: 24px !important; }
          .nm-home-hero-eyebrow-title { font-size: 26px !important; }
          .nm-home-tiles-pad { padding: 12px 36px 28px !important; }
          .nm-home-tiles { gap: 16px !important; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) !important; }
          .nm-home-tile { padding: 22px 14px 20px !important; }
        }

        /* Wide-enough tablets/laptops 900–1199 — keep balanced */
        @media (min-width: 900px) and (max-width: 1199px) {
          .nm-home-hero-pad { padding: 10px 26px 14px !important; }
          .nm-home-hero { padding: 16px 20px !important; gap: 18px !important; }
          .nm-home-tiles-pad { padding: 10px 26px 22px !important; }
          .nm-home-tiles { gap: 14px !important; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)) !important; }
        }

        /* Narrow tablet — collapse sidebar to icon-only rail but keep hero side-by-side */
        @media (max-width: 900px) {
          .nm-home-aside { width: 68px !important; padding: 14px 6px !important; }
          .nm-home-aside .nm-sidebar-label { display: none !important; }
          .nm-home-aside .nm-profile-name { display: none !important; }
          .nm-home-aside .nm-profile-avatar { width: 44px !important; height: 44px !important; font-size: 20px !important; }
        }

        /* Phone-ish — stack hero banner vertically + 2-col tiles + 1-col steps + bigger touch targets */
        @media (max-width: 700px) {
          .nm-home-hero { flex-direction: column !important; align-items: stretch !important; gap: 10px !important; padding: 14px !important; }
          .nm-home-hero > .nm-mascot { align-self: center; }
          .nm-hero-cta-wrap { flex-direction: row !important; }
          .nm-hero-cta-wrap button { flex: 1 !important; }
          .nm-home-tiles { grid-template-columns: repeat(2, 1fr) !important; }
          .nm-steps { grid-template-columns: 1fr !important; }
          .nm-home-tile { padding: 14px 10px 12px !important; }
        }

        /* Tiny phones — single-column tiles, single-column CTA */
        @media (max-width: 420px) {
          .nm-home-tiles { grid-template-columns: 1fr !important; }
          .nm-home-header { padding: 12px 14px 6px !important; }
          .nm-hero-cta-wrap { flex-direction: column !important; }
        }

        /* Phone — stack everything, hide sidebar entirely on public mode */
        @media (max-width: 600px) {
          .nm-home-public .nm-home-aside { display: none !important; }
          .nm-home-header { flex-wrap: wrap !important; gap: 10px !important; padding: 12px 16px 8px !important; }
          .nm-home-header-cta { width: 100% !important; justify-content: stretch !important; }
          .nm-home-header-cta button { flex: 1 !important; padding: 10px 14px !important; font-size: 12px !important; }
          .nm-home-hero-pad { padding: 8px 16px 12px !important; }
          .nm-home-tiles-pad { padding: 8px 16px 24px !important; }
          .nm-home-hero-illus { padding: 22px 16px !important; }
          .nm-home-hero-illus-emoji { font-size: 64px !important; }
          .nm-home-hero-headline { font-size: 22px !important; }
          .nm-home-hero-eyebrow-title { font-size: 22px !important; }
        }
      `}</style>

      {/* ── LEFT SIDEBAR ─────────────────────────────────────── */}
      <aside
        className="nm-home-aside"
        style={{
          width: 168,
          flexShrink: 0,
          backgroundColor: "rgba(8,18,38,0.65)",
          borderRight: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          flexDirection: "column",
          padding: "14px 8px",
          gap: 10,
          backdropFilter: "blur(6px)",
        }}
      >
        {/* Profile pill */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 4px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 6 }}>
          <div
            className="nm-profile-avatar"
            style={{
              width: 56, height: 56, borderRadius: "50%",
              backgroundColor: publicMode ? "rgba(201,146,42,0.18)" : "#A66B2E",
              color: publicMode ? AMBER : "#FFF8EC",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 24,
              border: `2px solid ${publicMode ? "rgba(201,146,42,0.55)" : "rgba(255,255,255,0.16)"}`,
            }}
          >
            {publicMode ? "📖" : ((nanaName || "Nana").trim()[0]?.toUpperCase() ?? "N")}
          </div>
          <div className="nm-profile-name" style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontWeight: 700, fontSize: 14, textAlign: "center" }}>
            {publicMode ? "NeverMiss" : (nanaName || "Nana")}
          </div>
        </div>

        <SidebarItem label="Home" icon="🏠" active onClick={() => {}} />
        <SidebarItem label="Library" icon="📚" onClick={onOpenLibrary} />
        {/* Family Journal in the main nav — promoted from a small toolbar
            icon. Sits between Vault and Schedule because Journal and Vault
            are both "memory" surfaces, while Schedule and Book Requests
            are forward-looking planning. */}
        {onOpenFamilyStories && (
          <SidebarItem label="Family Journal" icon="📖" onClick={onOpenFamilyStories} />
        )}
        <SidebarItem label="Memory Vault" icon="📼" onClick={onOpenVault} />
        <SidebarItem label="Schedule" icon="📅" onClick={onOpenSchedule} />
        <SidebarItem label="Book Requests" icon="✉️" onClick={onOpenBookRequests} />

        {/* Subtle divider instead of a flex-grow spacer that pushed
            Settings/Switch User off the bottom of the iPad viewport. */}
        <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.06)", margin: "6px 4px" }} />
        <SidebarItem label="Settings" icon="⚙️" onClick={onOpenSettings} />
        {/* Hide Switch User on the splash. The splash IS the device-picker
            so there's nowhere to "switch" to, and leaving the item visible
            invited the bug where tapping it set deviceView="perry" and
            wrote the choice to localStorage. */}
        {!publicMode && <SidebarItem label="Switch User" icon="🔄" onClick={onSwitchDevice} />}
      </aside>

      {/* ── RIGHT CONTENT ────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minWidth: 0 }}>

        {/* Top header row */}
        <div className="nm-home-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 4px", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: "clamp(18px, 2.4vw, 22px)", fontWeight: 700 }}>NeverMiss</span>
            <span style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 9, letterSpacing: "0.16em", opacity: 0.85 }}>READ · CONNECT · REMEMBER</span>
          </div>
          {publicMode ? (
            <div className="nm-home-header-cta" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={onJoinAsChild}
                style={{
                  background: "none",
                  color: "#cfe3ff",
                  border: "1px solid rgba(96,165,250,0.55)",
                  borderRadius: 999,
                  padding: "10px 18px",
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                🧒 Join as Grandchild
              </button>
              <button
                type="button"
                onClick={onSignIn}
                style={{
                  backgroundColor: AMBER,
                  color: NAVY,
                  border: "none",
                  borderRadius: 999,
                  padding: "10px 22px",
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: 14,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  boxShadow: "0 6px 18px rgba(201,146,42,0.42)",
                  touchAction: "manipulation",
                }}
              >
                👵 Sign In as Grandparent →
              </button>
            </div>
          ) : (
            <div style={{ color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: 18, fontWeight: 600 }}>
              {greeting}, <span style={{ color: AMBER, fontWeight: 800 }}>{nanaName || "Nana"}!</span>
            </div>
          )}
        </div>

        {/* Hero banner — single horizontal row that fits any viewport */}
        <div className="nm-home-hero-pad" style={{ padding: "6px 16px 10px" }}>
          <div className="nm-home-hero nm-home-hero-illus" style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 14,
            backgroundColor: "rgba(201,146,42,0.08)",
            border: "1px solid rgba(201,146,42,0.22)",
            borderRadius: 18,
            padding: "14px 16px",
            overflow: "hidden",
          }}>
            {/* Decorative twinkles + floaters absolutely positioned */}
            <span className="nm-spark" style={{ top: "18%", left: "8%", animationDelay: "0s" }}>✨</span>
            <span className="nm-spark" style={{ top: "60%", left: "15%", animationDelay: "0.4s", fontSize: 14 }}>⭐</span>
            <span className="nm-spark" style={{ top: "20%", right: "32%", animationDelay: "0.9s", fontSize: 13 }}>💫</span>
            <span className="nm-spark" style={{ bottom: "18%", right: "30%", animationDelay: "1.3s" }}>✨</span>

            {/* Mascot — always small + bouncing, never grows monstrously */}
            <div
              className="nm-mascot"
              style={{
                fontSize: "clamp(44px, 5.6vw, 72px)",
                lineHeight: 1,
                flexShrink: 0,
                position: "relative",
                zIndex: 1,
                filter: "drop-shadow(0 6px 16px rgba(201,146,42,0.35))",
              }}
            >
              🐰
            </div>

            {/* Middle text block — eyebrow, headline, body */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, position: "relative", zIndex: 1 }}>
              <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: "0.16em" }}>
                {publicMode ? "GET STARTED" : "NEXT READING SESSION"}
              </div>
              <div className="nm-home-hero-eyebrow-title" style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: "clamp(18px, 2.6vw, 26px)", fontWeight: 700, lineHeight: 1.2 }}>
                {publicMode ? "Read together, even apart" : (childName || "Your grandchild")}
              </div>
              {/* Bumped body line from clamp(10–12)→clamp(13–16). Rick:
                  "Font sizes throughout could generally be a bit larger —
                  the proposed time display in particular could use a bump."
                  This is where the scheduled-session time renders on home. */}
              <div style={{ color: "rgba(247,240,227,0.8)", fontFamily: "DM Sans, sans-serif", fontSize: "clamp(13px, 1.6vw, 16px)", fontWeight: 500, lineHeight: 1.45 }}>
                {publicMode
                  ? "The iPad co-reading app for grandparents & grandkids."
                  : nextSessionLabel}
              </div>
              {/* Connection status — show both states. Connected = green
                  "Perry's ready" pulse, not-connected = amber "Waiting for
                  Perry…" so Nana always knows where she stands without
                  having to guess. Rick: "session start sequencing" polish. */}
              {!publicMode && (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  marginTop: 6, alignSelf: "flex-start",
                  background: perryConnected ? "rgba(134,239,172,0.10)" : "rgba(247,201,93,0.10)",
                  border: `1px solid ${perryConnected ? "rgba(134,239,172,0.35)" : "rgba(247,201,93,0.35)"}`,
                  borderRadius: 999,
                  padding: "4px 10px",
                  color: perryConnected ? "#86efac" : "#fbd07a",
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.04em",
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: perryConnected ? "#86efac" : "#fbd07a",
                    boxShadow: perryConnected ? "0 0 8px rgba(134,239,172,0.7)" : "0 0 8px rgba(247,201,93,0.55)",
                    animation: "nm-twinkle 1.6s ease-in-out infinite",
                  }} />
                  {perryConnected
                    ? `${childName || "your grandchild"} is here — start when you're ready`
                    : `Waiting for ${childName || "your grandchild"} to join…`}
                </div>
              )}

              {/* Multi-child picker — only renders for real connections.
                  Single-child families still see "+ Add a sibling" so the
                  feature is discoverable. Switching child wipes the active
                  book selection (handled by App.handleSelectChild) so
                  Cooper doesn't inherit Perry's mid-pick state. */}
              {!publicMode && onSelectChild && onOpenAddChild && (
                <div style={{ marginTop: 10 }}>
                  <div style={{
                    color: "rgba(247,240,227,0.5)",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: 9, fontWeight: 800, letterSpacing: "0.16em",
                    marginBottom: 5,
                  }}>READING WITH</div>
                  <ChildPicker
                    children={childrenList}
                    activeChildId={activeChildId}
                    onSelect={onSelectChild}
                    onAddNew={onOpenAddChild}
                  />
                </div>
              )}
            </div>

            {/* Primary CTA — sized for the row, never overflows */}
            <div className="nm-hero-cta-wrap" style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch", position: "relative", zIndex: 1 }}>
              <button
                onClick={publicMode ? onSignIn : onStartReading}
                className="nm-cta-primary"
                style={{
                  background: "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)",
                  color: NAVY,
                  border: "none",
                  borderRadius: 999,
                  padding: "11px 18px",
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: "clamp(12px, 1.5vw, 14px)",
                  fontWeight: 800,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  boxShadow: "0 8px 24px rgba(201,146,42,0.45)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  whiteSpace: "nowrap",
                  touchAction: "manipulation",
                  // Pulse glow when Perry is connected and waiting — draws
                  // Nana's eye to the "your move" CTA.
                  animation: !publicMode && perryConnected ? "nm-pulse-glow 2.4s ease-in-out infinite" : undefined,
                }}
              >
                {publicMode ? "👵 Sign In →" : "📖 Start Reading →"}
              </button>
              {publicMode && (
                <button
                  onClick={onJoinAsChild}
                  style={{
                    backgroundColor: "rgba(96,165,250,0.14)",
                    color: "#cfe3ff",
                    border: "1px solid rgba(96,165,250,0.55)",
                    borderRadius: 999,
                    padding: "9px 16px",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: "clamp(11px, 1.3vw, 12px)",
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    whiteSpace: "nowrap",
                    touchAction: "manipulation",
                  }}
                >
                  🧒 Join as Grandchild
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Latest Memory — surfaces the most recent Family Journal entry
            right on the home page so the journal feels alive instead of
            buried in a sub-screen. When there are no entries yet, shows
            an empty-state CTA inviting Nana to write her first memory.
            Rick: "I like the concept, but it doesn't feel prominent to me
            right now — worth revisiting." Only on the logged-in view. */}
        {!publicMode && onOpenFamilyStories && (
          <div style={{ padding: "0 16px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingLeft: 2 }}>
              <span aria-hidden style={{ fontSize: 13 }}>📖</span>
              <span style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: "0.18em" }}>FAMILY JOURNAL</span>
              <span style={{ flex: 1, height: 1, background: "linear-gradient(to right, rgba(201,146,42,0.4), transparent)" }} />
              <button
                onClick={onOpenFamilyStories}
                style={{
                  background: "none", border: "none",
                  color: AMBER, fontFamily: "DM Sans, sans-serif",
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                  cursor: "pointer", padding: "2px 4px",
                }}
              >
                {familyStoryEntries.length > 0 ? `See all ${familyStoryEntries.length} →` : "Open →"}
              </button>
            </div>
            {familyStoryEntries.length > 0 ? (() => {
              const latest = familyStoryEntries[0];
              return (
                <button
                  onClick={onOpenFamilyStories}
                  style={{
                    width: "100%", textAlign: "left",
                    display: "flex", alignItems: "stretch", gap: 12,
                    background: "linear-gradient(135deg, rgba(244,114,182,0.12) 0%, rgba(244,114,182,0.04) 60%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(244,114,182,0.32)",
                    borderRadius: 16,
                    padding: "14px 16px",
                    cursor: "pointer",
                    boxShadow: "0 4px 16px rgba(244,114,182,0.10)",
                    transition: "transform 180ms cubic-bezier(0.22,1,0.36,1), box-shadow 180ms ease, border-color 180ms ease",
                    color: CREAM,
                    fontFamily: "DM Sans, sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 12px 32px rgba(244,114,182,0.22)";
                    e.currentTarget.style.borderColor = "rgba(244,114,182,0.55)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 4px 16px rgba(244,114,182,0.10)";
                    e.currentTarget.style.borderColor = "rgba(244,114,182,0.32)";
                  }}
                >
                  {/* Mini book-spine on the left */}
                  <div style={{
                    width: 44, height: 60,
                    borderRadius: 6,
                    background: latest.bookColor,
                    border: `2px solid ${latest.bookColor}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 24, flexShrink: 0,
                    boxShadow: "2px 3px 8px rgba(0,0,0,0.4)",
                  }}>
                    {latest.bookEmoji}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ color: "#f9a8d4", fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                        💝 Latest memory
                      </span>
                      <span style={{ color: "rgba(247,240,227,0.45)", fontSize: 10 }}>·</span>
                      <span style={{ color: "rgba(247,240,227,0.6)", fontSize: 11, fontWeight: 600 }}>
                        {latest.date}
                      </span>
                    </div>
                    <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: 14, fontWeight: 700, lineHeight: 1.25, marginBottom: 4 }}>
                      {latest.book}
                    </div>
                    <div style={{
                      color: "rgba(247,240,227,0.85)", fontFamily: "Merriweather, serif",
                      fontSize: 13, fontStyle: "italic", lineHeight: 1.55,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical" as const,
                      overflow: "hidden",
                    }}>
                      "{latest.note}"
                    </div>
                  </div>
                </button>
              );
            })() : (
              <button
                onClick={onOpenFamilyStories}
                style={{
                  width: "100%", textAlign: "left",
                  display: "flex", alignItems: "center", gap: 14,
                  background: "linear-gradient(135deg, rgba(244,114,182,0.10) 0%, rgba(244,114,182,0.03) 70%)",
                  border: "1px dashed rgba(244,114,182,0.45)",
                  borderRadius: 16,
                  padding: "16px 18px",
                  cursor: "pointer",
                  color: CREAM,
                  fontFamily: "DM Sans, sans-serif",
                  transition: "border-color 180ms ease, background 180ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(244,114,182,0.75)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(244,114,182,0.45)"; }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: "50%",
                  background: "rgba(244,114,182,0.22)",
                  border: "1px solid rgba(244,114,182,0.45)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, flexShrink: 0,
                }}>💝</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
                    Start your family journal
                  </div>
                  <div style={{ color: "rgba(247,240,227,0.65)", fontSize: 12, lineHeight: 1.45 }}>
                    Save a note after each session — a moment {(childName || "your grandchild")} will be able to read for years.
                  </div>
                </div>
                <span style={{ color: "#f9a8d4", fontSize: 18, flexShrink: 0 }}>→</span>
              </button>
            )}
          </div>
        )}

        {/* How it works — playful 3-step strip (publicMode only) */}
        {publicMode && (
          <div style={{ padding: "4px 20px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingLeft: 2 }}>
              <SparklesIcon size={14} color={AMBER} strokeWidth={2.4} />
              <span style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: "0.18em" }}>HOW IT WORKS</span>
              <span style={{ flex: 1, height: 1, background: "linear-gradient(to right, rgba(201,146,42,0.4), transparent)" }} />
            </div>
            <div className="nm-steps" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <HowItWorksStep n={1} Illust={IllustFamily} title="Set up the family" body="Create your circle in 2 minutes — no tech help needed." color="#f7c95d" delay="0s" />
              <HowItWorksStep n={2} Illust={IllustPhone} title="Open and tap" body="Tap your grandkid's photo to start a face-to-face call." color="#60a5fa" delay="0.15s" />
              <HowItWorksStep n={3} Illust={IllustReadStar} title="Read together" body="Pages turn in sync. Earn stars. Save the memory." color="#a78bfa" delay="0.3s" />
            </div>
          </div>
        )}

        {/* Bottom 4 quick-tile row */}
        <div className="nm-home-tiles-pad" style={{ padding: "4px 16px 12px" }}>
          {publicMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingLeft: 2 }}>
              <StarIcon size={14} color={AMBER} strokeWidth={2.4} />
              <span style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: "0.18em" }}>WHAT'S INSIDE</span>
              <span style={{ flex: 1, height: 1, background: "linear-gradient(to right, rgba(201,146,42,0.4), transparent)" }} />
            </div>
          )}
          <div className="nm-home-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
            <HomeQuickTile Illust={IllustLibrary} title="Library" subtitle="Pick a book" onClick={onOpenLibrary} accent="#C9922A" />
            {/* Family Journal — added as a first-class tile so it sits in
                the same row of affordances Nana already scans. Pink accent
                pairs with the heart in the open-book illustration. */}
            {onOpenFamilyStories && (
              <HomeQuickTile Illust={IllustJournal} title="Family Journal" subtitle="Save a memory" onClick={onOpenFamilyStories} accent="#f472b6" />
            )}
            <HomeQuickTile Illust={IllustVault} title="Memory Vault" subtitle="Past readings" onClick={onOpenVault} accent="#a78bfa" />
            <HomeQuickTile Illust={IllustSchedule} title="Schedule" subtitle="Plan a session" onClick={onOpenSchedule} accent="#60a5fa" />
            <HomeQuickTile Illust={IllustMail} title="Book Requests" subtitle="From the family" onClick={onOpenBookRequests} accent="#f87171" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({ label, icon, active, onClick }: { label: string; icon: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid " + (active ? "rgba(201,146,42,0.6)" : "transparent"),
        backgroundColor: active ? "rgba(201,146,42,0.20)" : "transparent",
        color: active ? CREAM : "rgba(247,240,227,0.78)",
        fontFamily: "DM Sans, sans-serif",
        fontSize: 13,
        fontWeight: active ? 700 : 600,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        touchAction: "manipulation",
        transition: "background-color 160ms ease, border-color 160ms ease, color 160ms ease",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <span aria-hidden style={{ fontSize: 18, lineHeight: 1, width: 22, textAlign: "center", flexShrink: 0 }}>{icon}</span>
      <span className="nm-sidebar-label" style={{ flex: 1 }}>{label}</span>
    </button>
  );
}

function HomeQuickTile({ Illust, title, subtitle, onClick, accent }: { Illust: React.ComponentType<{ color: string; size?: number }>; title: string; subtitle: string; onClick: () => void; accent: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="nm-home-tile"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        padding: "10px 8px 10px",
        backgroundImage: `linear-gradient(155deg, color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.04)) 0%, rgba(255,255,255,0.04) 70%)`,
        backgroundColor: "rgba(255,255,255,0.05)",
        border: `1px solid color-mix(in srgb, ${accent} 38%, rgba(255,255,255,0.10))`,
        borderRadius: 18,
        color: CREAM,
        cursor: "pointer",
        touchAction: "manipulation",
        overflow: "hidden",
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = "translateY(-4px) scale(0.98)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = ""; }}
    >
      <span
        aria-hidden
        className="nm-tile-icon nm-home-tile-illust-wrap"
        style={{
          width: 48, height: 48,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 1,
          filter: `drop-shadow(0 4px 12px color-mix(in srgb, ${accent} 55%, transparent))`,
        }}
      >
        <Illust color={accent} size={42} />
      </span>
      <div style={{ fontFamily: "Playfair Display, serif", fontWeight: 700, fontSize: 13 }}>{title}</div>
      <div style={{ fontFamily: "DM Sans, sans-serif", fontSize: 10, color: "rgba(247,240,227,0.62)", textAlign: "center" }}>{subtitle}</div>
    </button>
  );
}

/* ─── Illustrated SVG icons — gradient-filled, layered, kid-friendly ─── */

function IllustGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity="1" />
      <stop offset="100%" stopColor={color} stopOpacity="0.55" />
    </linearGradient>
  );
}

function IllustLibrary({ color, size = 56 }: { color: string; size?: number }) {
  const id = "il-lib";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs><IllustGradient id={id} color={color} /></defs>
      <rect x="6"  y="18" width="11" height="34" rx="2.5" fill={`url(#${id})`} opacity="0.55" transform="rotate(-6 11.5 35)" />
      <rect x="20" y="12" width="11" height="40" rx="2.5" fill={`url(#${id})`} opacity="0.92" />
      <rect x="34" y="20" width="11" height="32" rx="2.5" fill={`url(#${id})`} opacity="0.78" transform="rotate(4 39.5 36)" />
      <rect x="22" y="20" width="7"  height="2.5" rx="1" fill="#fff" opacity="0.45" />
      <rect x="36" y="28" width="7"  height="2.5" rx="1" fill="#fff" opacity="0.45" transform="rotate(4 39.5 29.5)" />
      <path d="M52 14 l1.6 -3.2 l1.6 3.2 l3.2 1.6 l-3.2 1.6 l-1.6 3.2 l-1.6 -3.2 l-3.2 -1.6 z" fill="#FFF6DC" opacity="0.95" />
      <circle cx="55" cy="46" r="1.8" fill="#FFF6DC" opacity="0.75" />
      <circle cx="9"  cy="10" r="1.6" fill="#FFF6DC" opacity="0.7" />
    </svg>
  );
}

function IllustVault({ color, size = 56 }: { color: string; size?: number }) {
  const id = "il-vault";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs><IllustGradient id={id} color={color} /></defs>
      <rect x="8" y="16" width="48" height="32" rx="6" fill={`url(#${id})`} />
      <rect x="6" y="20" width="6" height="6" rx="1" fill="#0b172e" opacity="0.85" />
      <rect x="6" y="30" width="6" height="6" rx="1" fill="#0b172e" opacity="0.85" />
      <rect x="6" y="40" width="6" height="6" rx="1" fill="#0b172e" opacity="0.85" />
      <rect x="52" y="20" width="6" height="6" rx="1" fill="#0b172e" opacity="0.85" />
      <rect x="52" y="30" width="6" height="6" rx="1" fill="#0b172e" opacity="0.85" />
      <rect x="52" y="40" width="6" height="6" rx="1" fill="#0b172e" opacity="0.85" />
      <rect x="16" y="22" width="32" height="20" rx="3" fill="#FFF6DC" opacity="0.92" />
      <path d="M32 26 l1.6 3.4 l3.7 0.4 l-2.8 2.6 l0.8 3.7 l-3.3 -1.9 l-3.3 1.9 l0.8 -3.7 l-2.8 -2.6 l3.7 -0.4 z" fill={color} />
      <path d="M50 8 l1.4 -2.8 l1.4 2.8 l2.8 1.4 l-2.8 1.4 l-1.4 2.8 l-1.4 -2.8 l-2.8 -1.4 z" fill="#FFF6DC" opacity="0.85" />
    </svg>
  );
}

function IllustSchedule({ color, size = 56 }: { color: string; size?: number }) {
  const id = "il-cal";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs><IllustGradient id={id} color={color} /></defs>
      <rect x="8" y="14" width="48" height="42" rx="6" fill={`url(#${id})`} />
      <rect x="8" y="14" width="48" height="12" rx="6" fill={color} opacity="0.92" />
      <rect x="16" y="8" width="4" height="12" rx="2" fill="#0b172e" opacity="0.85" />
      <rect x="44" y="8" width="4" height="12" rx="2" fill="#0b172e" opacity="0.85" />
      <rect x="14" y="32" width="6" height="6" rx="1.2" fill="#FFF6DC" opacity="0.6" />
      <rect x="24" y="32" width="6" height="6" rx="1.2" fill="#FFF6DC" opacity="0.6" />
      <rect x="34" y="32" width="6" height="6" rx="1.2" fill="#FFF6DC" />
      <rect x="44" y="32" width="6" height="6" rx="1.2" fill="#FFF6DC" opacity="0.6" />
      <rect x="14" y="42" width="6" height="6" rx="1.2" fill="#FFF6DC" opacity="0.6" />
      <rect x="24" y="42" width="6" height="6" rx="1.2" fill="#FFF6DC" opacity="0.6" />
      <path d="M37 33.4 l-3.5 3.5 l-1.6 -1.6" stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M52 6 l1.2 -2.5 l1.2 2.5 l2.5 1.2 l-2.5 1.2 l-1.2 2.5 l-1.2 -2.5 l-2.5 -1.2 z" fill="#FFF6DC" opacity="0.85" />
    </svg>
  );
}

function IllustMail({ color, size = 56 }: { color: string; size?: number }) {
  const id = "il-mail";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs><IllustGradient id={id} color={color} /></defs>
      <rect x="6" y="18" width="52" height="34" rx="5" fill={`url(#${id})`} />
      <path d="M6 22 L32 40 L58 22" stroke="#FFF6DC" strokeWidth="2.2" fill="none" strokeLinejoin="round" opacity="0.9" />
      <path d="M28 36 q4 4 8 0 q-2 4 -4 4 q-2 0 -4 -4 z" fill="#FFF6DC" opacity="0.92" />
      <circle cx="32" cy="34" r="6" fill="#fff" opacity="0.95" />
      <path d="M32 36 l-3 -3 a2 2 0 1 1 3 -2 a2 2 0 1 1 3 2 z" fill={color} />
      <path d="M52 8 l1.2 -2.5 l1.2 2.5 l2.5 1.2 l-2.5 1.2 l-1.2 2.5 l-1.2 -2.5 l-2.5 -1.2 z" fill="#FFF6DC" opacity="0.85" />
    </svg>
  );
}

function IllustJournal({ color, size = 56 }: { color: string; size?: number }) {
  const id = "il-jrn";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs><IllustGradient id={id} color={color} /></defs>
      {/* Open book — two pages meeting at a center spine. */}
      <path d="M8 18 q4 -3 12 -3 q8 0 12 4 q4 -4 12 -4 q8 0 12 3 v34 q-4 -3 -12 -3 q-8 0 -12 4 q-4 -4 -12 -4 q-8 0 -12 3 z" fill={`url(#${id})`} />
      {/* Page rule lines for visual texture. */}
      <line x1="14" y1="26" x2="28" y2="26" stroke="#FFF6DC" strokeWidth="1.4" opacity="0.6" strokeLinecap="round" />
      <line x1="14" y1="32" x2="26" y2="32" stroke="#FFF6DC" strokeWidth="1.4" opacity="0.5" strokeLinecap="round" />
      <line x1="36" y1="26" x2="50" y2="26" stroke="#FFF6DC" strokeWidth="1.4" opacity="0.6" strokeLinecap="round" />
      <line x1="36" y1="32" x2="48" y2="32" stroke="#FFF6DC" strokeWidth="1.4" opacity="0.5" strokeLinecap="round" />
      {/* Heart at the center spine — the "memory" mark that distinguishes
          this from the plain Library tile. */}
      <path
        d="M32 46 l-7 -6 a4.5 4.5 0 1 1 7 -5 a4.5 4.5 0 1 1 7 5 z"
        fill="#FFF6DC"
        opacity="0.96"
      />
      {/* Small sparkle to echo the other home tiles. */}
      <path d="M54 10 l1 -2 l1 2 l2 1 l-2 1 l-1 2 l-1 -2 l-2 -1 z" fill="#FFF6DC" opacity="0.85" />
    </svg>
  );
}

function IllustFamily({ color, size = 36 }: { color: string; size?: number }) {
  const id = "il-fam";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs><IllustGradient id={id} color={color} /></defs>
      <circle cx="20" cy="22" r="9" fill={`url(#${id})`} />
      <circle cx="44" cy="22" r="9" fill={`url(#${id})`} opacity="0.85" />
      <circle cx="32" cy="40" r="7" fill={`url(#${id})`} opacity="0.95" />
      <path d="M8 54 q12 -10 24 0 q12 -10 24 0 v8 H8 z" fill={`url(#${id})`} opacity="0.7" />
      <path d="M32 14 l1 -2 l1 2 l2 1 l-2 1 l-1 2 l-1 -2 l-2 -1 z" fill="#FFF6DC" opacity="0.9" />
    </svg>
  );
}

function IllustPhone({ color, size = 36 }: { color: string; size?: number }) {
  const id = "il-phn";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs><IllustGradient id={id} color={color} /></defs>
      <rect x="18" y="6" width="28" height="52" rx="6" fill={`url(#${id})`} />
      <rect x="22" y="12" width="20" height="36" rx="2" fill="#0b172e" opacity="0.9" />
      <circle cx="32" cy="53" r="2" fill="#FFF6DC" opacity="0.85" />
      <circle cx="32" cy="30" r="6"  stroke={color} strokeWidth="2" fill="none" opacity="0.4" />
      <circle cx="32" cy="30" r="10" stroke={color} strokeWidth="2" fill="none" opacity="0.25" />
      <circle cx="32" cy="30" r="3.2" fill={color} />
      <path d="M50 16 l1 -2 l1 2 l2 1 l-2 1 l-1 2 l-1 -2 l-2 -1 z" fill="#FFF6DC" opacity="0.85" />
    </svg>
  );
}

function IllustReadStar({ color, size = 36 }: { color: string; size?: number }) {
  const id = "il-rd";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs><IllustGradient id={id} color={color} /></defs>
      <path d="M8 18 q12 -8 24 -2 q12 -6 24 2 v32 q-12 -6 -24 0 q-12 -6 -24 0 z" fill={`url(#${id})`} />
      <path d="M32 16 v34" stroke="#0b172e" strokeWidth="1.5" opacity="0.4" />
      <path d="M14 24 h12 M14 30 h10" stroke="#FFF6DC" strokeWidth="1.4" opacity="0.85" strokeLinecap="round" />
      <path d="M38 24 h12 M40 30 h10" stroke="#FFF6DC" strokeWidth="1.4" opacity="0.85" strokeLinecap="round" />
      <path d="M50 6 l1.6 3.2 l3.4 0.4 l-2.6 2.4 l0.7 3.4 l-3.1 -1.7 l-3.1 1.7 l0.7 -3.4 l-2.6 -2.4 l3.4 -0.4 z" fill="#FFF6DC" />
    </svg>
  );
}

function HowItWorksStep({ n, Illust, title, body, color, delay }: { n: number; Illust: React.ComponentType<{ color: string; size?: number }>; title: string; body: string; color: string; delay: string }) {
  return (
    <div
      className="nm-step-card"
      style={{
        position: "relative",
        backgroundImage: `linear-gradient(150deg, color-mix(in srgb, ${color} 18%, rgba(255,255,255,0.03)) 0%, rgba(255,255,255,0.03) 70%)`,
        border: `1px solid color-mix(in srgb, ${color} 38%, rgba(255,255,255,0.10))`,
        borderRadius: 16,
        padding: "12px 16px",
        animationDelay: delay,
      }}
    >
      <div style={{
        position: "absolute", top: -10, left: 14,
        width: 24, height: 24, borderRadius: "50%",
        backgroundColor: color, color: "#0b172e",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "DM Sans, sans-serif", fontWeight: 800, fontSize: 12,
        boxShadow: `0 6px 18px color-mix(in srgb, ${color} 45%, transparent)`,
      }}>
        {n}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <span style={{ flexShrink: 0, filter: `drop-shadow(0 4px 12px color-mix(in srgb, ${color} 55%, transparent))` }}>
          <Illust color={color} size={42} />
        </span>
        <div>
          <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{title}</div>
          <div style={{ color: "rgba(247,240,227,0.72)", fontFamily: "DM Sans, sans-serif", fontSize: 12, lineHeight: 1.4 }}>
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Stub: Book Requests + Settings ──────────────────────── */

/* ─── Real Settings page ─────────────────────────────────── */

function SettingsView({
  onBack,
  onSwitchDevice,
  onSignOut,
  nanaName,
  childName,
  // Wired to App state — these used to be local-only stubs that looked
  // like they worked but didn't persist or affect reading mode. Rick:
  // "Settings is a good place for users to adjust defaults, and I thought
  // that feature was a nice touch. More items could live there."
  readingTheme,
  onThemeChange,
  fontScale,
  onFontScaleChange,
  pageMode,
  onPageModeChange,
  readingLayout,
  onLayoutChange,
  onResetHelpPrompts,
  sillyChallengeEnabled,
  onToggleSillyChallenge,
  openWith = "home",
  onOpenWithChange,
}: {
  onBack: () => void;
  onSwitchDevice: () => void;
  onSignOut?: () => void;
  nanaName: string;
  childName: string;
  readingTheme?: ReadingTheme;
  onThemeChange?: (t: ReadingTheme) => void;
  fontScale?: number;
  onFontScaleChange?: (s: number) => void;
  pageMode?: "single" | "double";
  onPageModeChange?: (m: "single" | "double") => void;
  readingLayout?: ReadingLayout;
  onLayoutChange?: (l: ReadingLayout) => void;
  /** Clears every `nevermiss_card_skip_*` key + re-arms the master help
   *  toggle. Wired to App.handleResetHelpPrompts. */
  onResetHelpPrompts?: () => void;
  /** Per-device opt-out for the Silly Faces first-to-laugh mini-game.
   *  Default ON. */
  sillyChallengeEnabled?: boolean;
  onToggleSillyChallenge?: (next: boolean) => void;
  /** "home" = current behaviour (dashboard tiles after login). "video"
   *  = Nana lands directly on the live FaceTime-style greeting stage
   *  with Perry on screen, so they can say hi before picking a book.
   *  Rick: "open on a big live video view … so Nana and the child can
   *  see each other right away." Default "home". */
  openWith?: "home" | "video";
  onOpenWithChange?: (next: "home" | "video") => void;
}) {
  // Notifications + auto-record are still UI-only stubs (the server
  // doesn't yet enforce them). Kept here so the toggles look alive.
  const [pushNotif, setPushNotif] = useState(true);
  const [emailReminder, setEmailReminder] = useState(true);
  const [autoRecord, setAutoRecord] = useState(false);
  // Help & guidance toggle — same source of truth as HelpToggle (the
  // corner pill). Reading localStorage lazily so the initial state
  // matches whatever the user last picked anywhere in the app.
  const [helpCardsOn, setHelpCardsOn] = useState<boolean>(() => {
    try { return localStorage.getItem("nevermiss_phase_cards") !== "off"; }
    catch { return true; }
  });
  // Live with the corner toggle: when the user flips Help on/off from
  // anywhere else, this card stays in sync. Reading the latest value
  // from localStorage on every storage event keeps both surfaces honest.
  useEffect(() => {
    const sync = () => setHelpCardsOn(localStorage.getItem("nevermiss_phase_cards") !== "off");
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const toggleHelpCards = (next: boolean) => {
    setHelpCardsOn(next);
    try {
      localStorage.setItem("nevermiss_phase_cards", next ? "on" : "off");
      window.dispatchEvent(new StorageEvent("storage", { key: "nevermiss_phase_cards", newValue: next ? "on" : "off" }));
    } catch {}
    if (next) {
      // Mirror HelpToggle: re-show the current phase's card immediately
      // when re-enabling so the user sees the change take effect.
      window.dispatchEvent(new CustomEvent("nm:help-reactivated"));
    }
  };
  const [helpResetConfirmed, setHelpResetConfirmed] = useState(false);
  const handleHelpReset = () => {
    onResetHelpPrompts?.();
    setHelpResetConfirmed(true);
    window.setTimeout(() => setHelpResetConfirmed(false), 2400);
  };

  // Account-deletion modal. Type-to-confirm "DELETE" gates the action so
  // a misplaced tap can't erase the family's reading history. Privacy
  // Policy v3 §8 commits to deletion within 30 days; the runtime executes
  // it immediately. Apple App Store Guideline 5.1.1(v) requires the
  // delete action be accessible in-app without contacting support.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const handleDeleteAccount = async () => {
    if (deleteText.trim().toUpperCase() !== "DELETE") return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.account.delete();
      // Server clears the session cookie in the same response; reload to
      // pick up the now-unauthenticated app state from a clean slate.
      window.location.reload();
    } catch (err) {
      setDeleteBusy(false);
      setDeleteError(err instanceof Error ? err.message : "Could not delete account. Try again or email privacy@nevermiss.family.");
    }
  };

  // Parental-consent withdrawal. Drops every child profile + session
  // history on this user's connections without touching the adult
  // account. Privacy Policy v3 §8 + §3 (COPPA).
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawDone, setWithdrawDone] = useState<{ children: number; sessions: number } | null>(null);
  const handleWithdrawConsent = async () => {
    setWithdrawBusy(true);
    try {
      const r = await api.account.withdrawParentalConsent();
      setWithdrawDone({ children: r.childrenRemoved, sessions: r.sessionsRemoved });
    } catch {
      setWithdrawDone({ children: 0, sessions: 0 });
    } finally {
      setWithdrawBusy(false);
    }
  };

  // Data export. Browser download of the full JSON blob the server
  // returns. We bypass `api.account.export()` here because we want the
  // raw Response so we can hand the blob to a download <a>.
  const [exportBusy, setExportBusy] = useState(false);
  const handleExportData = async () => {
    setExportBusy(true);
    try {
      const res = await fetch("/api/account/export", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `nevermiss-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      // Silent — the request boundary is small; a follow-up toast is
      // overkill for a once-in-a-blue-moon action.
    } finally {
      setExportBusy(false);
    }
  };
  // Derive the current theme + font-size from the wired props; fall back
  // to local stub if the parent didn't pass them in (defensive).
  const defaultTheme: "day" | "sepia" | "night" = readingTheme ?? "day";
  const setDefaultTheme = (t: "day" | "sepia" | "night") => onThemeChange?.(t);
  const fontSizeFromScale: "S" | "M" | "L" | "XL" =
    fontScale == null ? "M"
    : fontScale >= 1.5 ? "XL"
    : fontScale >= 1.25 ? "L"
    : fontScale >= 1 ? "M"
    : "S";
  const defaultFontSize: "S" | "M" | "L" | "XL" = fontSizeFromScale;
  const setDefaultFontSize = (s: "S" | "M" | "L" | "XL") => {
    const scale = s === "XL" ? 1.5 : s === "L" ? 1.25 : s === "M" ? 1 : 0.85;
    onFontScaleChange?.(scale);
  };

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      backgroundColor: "#0b172e",
      backgroundImage: "radial-gradient(700px 380px at 80% -20%, rgba(201,146,42,0.16), transparent 70%), radial-gradient(560px 360px at -10% 110%, rgba(96,165,250,0.14), transparent 70%)",
      overflow: "auto",
    }}>
      <style>{`
        @keyframes settings-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button onClick={onBack} style={{
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 999, padding: "6px 12px", color: CREAM,
          fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer",
        }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: "clamp(18px, 2.4vw, 22px)", fontWeight: 700, lineHeight: 1.1 }}>Settings</div>
          <div style={{ color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: 11, marginTop: 2 }}>Tune your reading room</div>
        </div>
      </div>

      <div className="settings-grid" style={{ padding: "12px 16px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <style>{`
          @media (max-width: 600px) { .settings-grid { grid-template-columns: 1fr !important; padding: 10px 14px 14px !important; } }
        `}</style>

        {/* Opening screen — Rick's Wish 1. Land Nana on home dashboard
            tiles OR drop her straight into the live video greeting so
            she and the child can say hi before picking a book. Both
            paths reach the library; this just controls which screen
            shows first after login. */}
        {onOpenWithChange && (
        <SettingsCard title="Opening screen" icon="🏠" delay="0s">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>WHERE TO START</div>
            <div style={{ display: "flex", gap: 8 }}>
              {([
                { k: "home" as const,  icon: "🏠", title: "Home menu",   sub: "Dashboard with tiles" },
                { k: "video" as const, icon: "📹", title: "Video chat",  sub: "See each other first" },
              ]).map(o => {
                const active = openWith === o.k;
                return (
                  <button
                    key={o.k}
                    onClick={() => onOpenWithChange(o.k)}
                    style={{
                      flex: 1,
                      padding: "12px 10px",
                      borderRadius: 14,
                      border: active ? `2px solid ${AMBER}` : "1px solid rgba(255,255,255,0.12)",
                      backgroundColor: active ? "rgba(201,146,42,0.14)" : "rgba(255,255,255,0.04)",
                      color: active ? AMBER : CREAM,
                      fontFamily: "DM Sans, sans-serif",
                      cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                      boxShadow: active ? `0 6px 18px color-mix(in srgb, ${AMBER} 30%, transparent)` : "none",
                      touchAction: "manipulation",
                    }}
                  >
                    <span aria-hidden style={{ fontSize: 26, lineHeight: 1 }}>{o.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>{o.title}</span>
                    <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 500 }}>{o.sub}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: 11, marginTop: 2, lineHeight: 1.5 }}>
              {openWith === "video"
                ? "After login you'll land on the live video stage. Tap Pick a Book when you're ready."
                : "After login you'll land on the home menu. Tap Start Reading to begin a session."}
            </div>
          </div>
        </SettingsCard>
        )}

        {/* Profile card */}
        <SettingsCard title="Account" icon="👤" delay="0s">
          <SettingsRow label="Name" value={nanaName || "Nana"} />
          <SettingsRow label="Reading with" value={childName || "Your grandchild"} />
          <SettingsRow label="Plan" value={<span style={{ color: AMBER, fontWeight: 700 }}>Founding Family</span>} />
        </SettingsCard>

        {/* Reading defaults */}
        <SettingsCard title="Reading defaults" icon="📖" delay="0.05s">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>THEME</div>
            <div style={{ display: "flex", gap: 8 }}>
              {([{k:"day",label:"Day",bg:"#FFF8EC",fg:"#0b172e"},{k:"sepia",label:"Sepia",bg:"#F4E4BC",fg:"#3a2f1b"},{k:"night",label:"Night",bg:"#1a2540",fg:"#cbd5e1"}] as const).map(t => (
                <button key={t.k} onClick={() => setDefaultTheme(t.k)} style={{
                  flex: 1, padding: "10px 12px", borderRadius: 12,
                  border: defaultTheme === t.k ? `2px solid ${AMBER}` : "1px solid rgba(255,255,255,0.12)",
                  backgroundColor: t.bg, color: t.fg,
                  fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  boxShadow: defaultTheme === t.k ? `0 6px 18px color-mix(in srgb, ${AMBER} 35%, transparent)` : "none",
                }}>{t.label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            <div style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>FONT SIZE</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["M","L","XL"] as const).map(s => (
                <button key={s} onClick={() => setDefaultFontSize(s)} style={{
                  flex: 1, padding: "10px 12px", borderRadius: 12,
                  border: defaultFontSize === s ? `2px solid ${AMBER}` : "1px solid rgba(255,255,255,0.12)",
                  backgroundColor: defaultFontSize === s ? "rgba(201,146,42,0.18)" : "rgba(255,255,255,0.05)",
                  color: defaultFontSize === s ? AMBER : CREAM,
                  fontFamily: "Merriweather, serif",
                  fontSize: s === "M" ? 14 : s === "L" ? 16 : 18,
                  fontWeight: 700, cursor: "pointer",
                }}>{s}</button>
              ))}
            </div>
            <div style={{ color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: 11, marginTop: 2 }}>
              Applies to the open book in Reading Mode. Same control as the AA toggle in the reading toolbar — change here to set the default.
            </div>
          </div>
          {/* Page mode: single page per tap vs the open-book spread. Same
              setting as the dropdown in the reading toolbar, surfaced here
              so it can be set as a default before a session starts. */}
          {onPageModeChange && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              <div style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>PAGE MODE</div>
              <div style={{ display: "flex", gap: 8 }}>
                {([{k: "double" as const, label: "Two pages", icon: "📖"}, {k: "single" as const, label: "One page", icon: "📄"}]).map(m => {
                  const active = (pageMode ?? "double") === m.k;
                  return (
                    <button key={m.k} onClick={() => onPageModeChange(m.k)} style={{
                      flex: 1, padding: "10px 12px", borderRadius: 12,
                      border: active ? `2px solid ${AMBER}` : "1px solid rgba(255,255,255,0.12)",
                      backgroundColor: active ? "rgba(201,146,42,0.18)" : "rgba(255,255,255,0.05)",
                      color: active ? AMBER : CREAM,
                      fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    }}>
                      <span style={{ fontSize: 16 }}>{m.icon}</span>
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* Reading layout — surface alongside the in-toolbar dropdown so
              Nana can pick a default layout that applies the moment she
              enters reading mode (instead of every time she taps in). */}
          {onLayoutChange && readingLayout && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              <div style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>READING LAYOUT</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                {READING_LAYOUTS.map(k => {
                  const m = READING_LAYOUT_META[k];
                  const active = k === readingLayout;
                  return (
                    <button key={k} onClick={() => onLayoutChange(k)} style={{
                      padding: "10px 8px", borderRadius: 12,
                      border: active ? `2px solid ${AMBER}` : "1px solid rgba(255,255,255,0.12)",
                      backgroundColor: active ? "rgba(201,146,42,0.18)" : "rgba(255,255,255,0.05)",
                      color: active ? AMBER : CREAM,
                      fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                    }}>
                      <span style={{ fontSize: 18 }}>{m.icon}</span>
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </SettingsCard>

        {/* Notifications */}
        <SettingsCard title="Notifications" icon="🔔" delay="0.1s">
          <SettingsToggle label="Push notifications" sub="Get pinged when your grandchild's iPad joins" value={pushNotif} onChange={setPushNotif} />
          <SettingsToggle label="Email reminders" sub="Day-before reminder for scheduled sessions" value={emailReminder} onChange={setEmailReminder} />
        </SettingsCard>

        {/* Recording */}
        <SettingsCard title="Recording" icon="🎬" delay="0.15s">
          <SettingsToggle label="Auto-save sessions to Memory Vault" sub="Recordings are private to your family" value={autoRecord} onChange={setAutoRecord} />
        </SettingsCard>

        {/* Help & guidance — master toggle + per-phase reset. The
            corner HelpToggle handles in-the-moment on/off; this card
            owns the recovery flow for users who tapped "Don't show
            again" on individual phase cards earlier. Rick (Feature 3):
            "The permanent option should probably live in Settings as
            well so families can re-enable if needed." */}
        <SettingsCard title="Help & guidance" icon="💡" delay="0.175s">
          <SettingsToggle
            label="Show help cards"
            sub="Friendly intros when entering each phase"
            value={helpCardsOn}
            onChange={toggleHelpCards}
          />
          {onResetHelpPrompts && (
            <button
              onClick={handleHelpReset}
              disabled={helpResetConfirmed}
              style={{
                width: "100%", textAlign: "left", marginTop: 8,
                backgroundColor: helpResetConfirmed ? "rgba(134,239,172,0.10)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${helpResetConfirmed ? "rgba(134,239,172,0.40)" : "rgba(255,255,255,0.10)"}`,
                borderRadius: 12, padding: "12px 14px", color: helpResetConfirmed ? "#86efac" : CREAM,
                fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700,
                cursor: helpResetConfirmed ? "default" : "pointer",
                display: "flex", alignItems: "center", gap: 10,
                transition: "all 0.2s",
              }}
            >
              <span style={{ fontSize: 18 }}>{helpResetConfirmed ? "✓" : "🔄"}</span>
              <div style={{ flex: 1 }}>
                <div>{helpResetConfirmed ? "Help prompts restored" : "Reset dismissed help prompts"}</div>
                <div style={{ color: "rgba(247,240,227,0.5)", fontSize: 11, fontWeight: 500, marginTop: 2 }}>
                  {helpResetConfirmed
                    ? "All cards will appear again next time you enter each phase."
                    : "Bring back every \"Don't show again\" dismiss"}
                </div>
              </div>
            </button>
          )}
        </SettingsCard>

        {/* Silly Faces — per-device opt-out for the laughing challenge
            mini-game. Hides the CHALLENGE pill from this iPad but does
            not block an incoming challenge initiated by the partner. */}
        {onToggleSillyChallenge && (
          <SettingsCard title="Silly Faces" icon="🎭" delay="0.19s">
            <SettingsToggle
              label="Show Challenge button"
              sub="First-to-laugh mini-game during Silly Faces"
              value={sillyChallengeEnabled ?? true}
              onChange={onToggleSillyChallenge}
            />
          </SettingsCard>
        )}

        {/* Account actions */}
        <SettingsCard title="Account" icon="🔄" delay="0.2s">
          <button onClick={onSwitchDevice} style={{
            width: "100%", textAlign: "left",
            backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 12, padding: "12px 14px", color: CREAM,
            fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 20 }}>🔄</span>
            <div style={{ flex: 1 }}>
              <div>Switch user</div>
              <div style={{ color: "rgba(247,240,227,0.5)", fontSize: 11, fontWeight: 500, marginTop: 2 }}>Hand the iPad to someone else</div>
            </div>
            <span style={{ color: "rgba(247,240,227,0.4)" }}>→</span>
          </button>
          {onSignOut && (
            <button
              onClick={onSignOut}
              style={{
                width: "100%", textAlign: "left", marginTop: 8,
                backgroundColor: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: 12, padding: "12px 14px", color: "#fca5a5",
                fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10,
              }}
            >
              <span style={{ fontSize: 20 }}>🚪</span>
              <div style={{ flex: 1 }}>Sign out</div>
              <span style={{ opacity: 0.5 }}>→</span>
            </button>
          )}
        </SettingsCard>

        {/* YOUR DATA — Privacy Policy v3 §8 rights surfaced as one-tap
            controls. Download, withdraw parental consent, delete account.
            All three are required for App Store compliance: the policy
            commits to them and Apple checks. */}
        <SettingsCard title="Your data" icon="🛡️" delay="0.21s">
          <button
            onClick={handleExportData}
            disabled={exportBusy}
            style={{
              width: "100%", textAlign: "left",
              backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 12, padding: "12px 14px", color: CREAM,
              fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700,
              cursor: exportBusy ? "wait" : "pointer", opacity: exportBusy ? 0.6 : 1,
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <span style={{ fontSize: 20 }}>📥</span>
            <div style={{ flex: 1 }}>
              <div>{exportBusy ? "Preparing…" : "Download my data"}</div>
              <div style={{ color: "rgba(247,240,227,0.5)", fontSize: 11, fontWeight: 500, marginTop: 2 }}>JSON copy of everything we hold on you</div>
            </div>
            <span style={{ color: "rgba(247,240,227,0.4)" }}>→</span>
          </button>
          <button
            onClick={() => setWithdrawOpen(true)}
            style={{
              width: "100%", textAlign: "left", marginTop: 8,
              backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 12, padding: "12px 14px", color: CREAM,
              fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <span style={{ fontSize: 20 }}>🛑</span>
            <div style={{ flex: 1 }}>
              <div>Withdraw parental consent</div>
              <div style={{ color: "rgba(247,240,227,0.5)", fontSize: 11, fontWeight: 500, marginTop: 2 }}>Deletes child profiles + sessions only</div>
            </div>
            <span style={{ color: "rgba(247,240,227,0.4)" }}>→</span>
          </button>
          <button
            onClick={() => { setDeleteOpen(true); setDeleteText(""); setDeleteError(null); }}
            style={{
              width: "100%", textAlign: "left", marginTop: 8,
              backgroundColor: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.35)",
              borderRadius: 12, padding: "12px 14px", color: "#fca5a5",
              fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <span style={{ fontSize: 20 }}>🗑️</span>
            <div style={{ flex: 1 }}>
              <div>Delete my account</div>
              <div style={{ color: "rgba(252,165,165,0.7)", fontSize: 11, fontWeight: 500, marginTop: 2 }}>Permanently erase account and all family data</div>
            </div>
            <span style={{ opacity: 0.5 }}>→</span>
          </button>
        </SettingsCard>

        {/* LEGAL — Privacy Policy + Terms of Use links + contact +
            patent disclosure. Apple wants a privacy policy URL reachable
            from inside the app; this is that link. */}
        <SettingsCard title="Legal" icon="📜" delay="0.22s">
          <a
            href="https://nevermiss.family/data/NeverMiss_Privacy_Policy_v3.pdf"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              width: "100%", textAlign: "left", textDecoration: "none",
              boxSizing: "border-box",
              backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 12, padding: "12px 14px", color: CREAM,
              fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <span style={{ fontSize: 20 }}>🔒</span>
            <div style={{ flex: 1 }}>Privacy Policy</div>
            <span style={{ color: "rgba(247,240,227,0.4)" }}>↗</span>
          </a>
          <a
            href="https://nevermiss.family/data/NeverMiss_Terms_of_Use_v2%20(1).pdf"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              width: "100%", textAlign: "left", textDecoration: "none",
              boxSizing: "border-box",
              marginTop: 8,
              backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 12, padding: "12px 14px", color: CREAM,
              fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <span style={{ fontSize: 20 }}>📄</span>
            <div style={{ flex: 1 }}>Terms of Use</div>
            <span style={{ color: "rgba(247,240,227,0.4)" }}>↗</span>
          </a>
          <a
            href="mailto:privacy@nevermiss.family"
            style={{
              width: "100%", textAlign: "left", textDecoration: "none",
              boxSizing: "border-box",
              marginTop: 8,
              backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 12, padding: "12px 14px", color: CREAM,
              fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <span style={{ fontSize: 20 }}>✉️</span>
            <div style={{ flex: 1 }}>
              <div>Contact us</div>
              <div style={{ color: "rgba(247,240,227,0.5)", fontSize: 11, fontWeight: 500, marginTop: 2 }}>privacy@nevermiss.family</div>
            </div>
            <span style={{ color: "rgba(247,240,227,0.4)" }}>↗</span>
          </a>
          <div style={{
            marginTop: 12,
            color: "rgba(247,240,227,0.4)",
            fontFamily: "DM Sans, sans-serif",
            fontSize: 10, lineHeight: 1.6, textAlign: "center",
          }}>
            © 2026 Spoonbill Investments, Inc.<br/>
            Patent Pending USPTO 64/009,182 &amp; 64/014,326
          </div>
        </SettingsCard>

        <div style={{ textAlign: "center", color: "rgba(247,240,227,0.32)", fontFamily: "DM Sans, sans-serif", fontSize: 10, marginTop: 6 }}>
          NeverMiss · Built for the family across the miles
        </div>
      </div>

      {/* Account deletion confirmation modal — type-to-confirm gate so a
          misplaced tap can't erase the family history. Privacy Policy v3
          §8 + Apple App Store Guideline 5.1.1(v). */}
      {deleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            backgroundColor: "rgba(11,23,46,0.78)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
            animation: "settings-rise 0.18s ease-out",
          }}
        >
          <div style={{
            backgroundColor: "#0d1e38",
            border: "1px solid rgba(239,68,68,0.45)",
            borderRadius: 18, padding: "22px 22px 18px",
            maxWidth: 440, width: "100%",
            boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 24 }}>⚠️</span>
              <div id="delete-account-title" style={{ color: "#fca5a5", fontFamily: "Playfair Display, serif", fontSize: 20, fontWeight: 700 }}>
                Delete your account
              </div>
            </div>
            <div style={{ color: "rgba(247,240,227,0.78)", fontFamily: "DM Sans, sans-serif", fontSize: 13, lineHeight: 1.55, marginBottom: 14 }}>
              This permanently removes your NeverMiss account and{" "}
              <strong>every connection, child profile, reading session, progress entry, and Memory Vault recording</strong>{" "}
              tied to it. This action is immediate and cannot be undone.
            </div>
            <div style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: 11, marginBottom: 6 }}>
              Type <strong style={{ color: AMBER, letterSpacing: "0.08em" }}>DELETE</strong> to confirm:
            </div>
            <input
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="DELETE"
              style={{
                width: "100%", boxSizing: "border-box",
                backgroundColor: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(239,68,68,0.45)",
                borderRadius: 10, padding: "10px 12px",
                color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: 14,
                letterSpacing: "0.08em",
                outline: "none",
              }}
            />
            {deleteError && (
              <div style={{ color: "#fca5a5", fontFamily: "DM Sans, sans-serif", fontSize: 11, marginTop: 8 }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button
                onClick={() => { setDeleteOpen(false); setDeleteText(""); setDeleteError(null); }}
                disabled={deleteBusy}
                style={{
                  backgroundColor: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: CREAM,
                  borderRadius: 999, padding: "9px 18px",
                  fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 700,
                  cursor: deleteBusy ? "wait" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteText.trim().toUpperCase() !== "DELETE" || deleteBusy}
                style={{
                  backgroundColor: deleteText.trim().toUpperCase() === "DELETE" ? "#ef4444" : "rgba(239,68,68,0.25)",
                  border: "none",
                  color: "#fff",
                  borderRadius: 999, padding: "9px 18px",
                  fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 800,
                  letterSpacing: "0.04em",
                  cursor: deleteText.trim().toUpperCase() === "DELETE" && !deleteBusy ? "pointer" : "not-allowed",
                  opacity: deleteText.trim().toUpperCase() === "DELETE" ? 1 : 0.55,
                }}
              >
                {deleteBusy ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Parental-consent withdrawal modal — distinct from full account
          delete: only child data is dropped, adult account stays. */}
      {withdrawOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            backgroundColor: "rgba(11,23,46,0.78)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
            animation: "settings-rise 0.18s ease-out",
          }}
        >
          <div style={{
            backgroundColor: "#0d1e38",
            border: "1px solid rgba(247,201,93,0.45)",
            borderRadius: 18, padding: "22px 22px 18px",
            maxWidth: 440, width: "100%",
            boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 24 }}>🛑</span>
              <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: 20, fontWeight: 700 }}>
                Withdraw parental consent
              </div>
            </div>
            {withdrawDone ? (
              <>
                <div style={{ color: "rgba(247,240,227,0.85)", fontFamily: "DM Sans, sans-serif", fontSize: 13, lineHeight: 1.55, marginBottom: 14 }}>
                  Done. Removed <strong>{withdrawDone.children}</strong> child profile{withdrawDone.children === 1 ? "" : "s"}
                  {withdrawDone.sessions ? <> and <strong>{withdrawDone.sessions}</strong> reading session{withdrawDone.sessions === 1 ? "" : "s"}</> : null}.
                  Your account is untouched.
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => { setWithdrawOpen(false); setWithdrawDone(null); }}
                    style={{
                      backgroundColor: AMBER,
                      border: "none",
                      color: NAVY,
                      borderRadius: 999, padding: "9px 18px",
                      fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ color: "rgba(247,240,227,0.78)", fontFamily: "DM Sans, sans-serif", fontSize: 13, lineHeight: 1.55, marginBottom: 14 }}>
                  This deletes every child profile + reading session on your account, as guaranteed by §8 of the Privacy Policy.
                  Your adult account, email, and family connection itself stay in place — you can add a child back later.
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setWithdrawOpen(false)}
                    disabled={withdrawBusy}
                    style={{
                      backgroundColor: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.18)",
                      color: CREAM,
                      borderRadius: 999, padding: "9px 18px",
                      fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 700,
                      cursor: withdrawBusy ? "wait" : "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleWithdrawConsent}
                    disabled={withdrawBusy}
                    style={{
                      backgroundColor: AMBER,
                      border: "none",
                      color: NAVY,
                      borderRadius: 999, padding: "9px 18px",
                      fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 800,
                      cursor: withdrawBusy ? "wait" : "pointer",
                    }}
                  >
                    {withdrawBusy ? "Removing…" : "Yes, withdraw"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsCard({ title, icon, children, delay = "0s" }: { title: string; icon: string; children: React.ReactNode; delay?: string }) {
  return (
    <div style={{
      backgroundColor: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: 14, padding: "12px 14px",
      animation: "settings-rise 0.5s both",
      animationDelay: delay,
      minHeight: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: "0.14em" }}>{title.toUpperCase()}</span>
      </div>
      {children}
    </div>
  );
}

function SettingsRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ color: "rgba(247,240,227,0.65)", fontFamily: "DM Sans, sans-serif", fontSize: 12 }}>{label}</span>
      <span style={{ color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function SettingsToggle({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 12px", borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        cursor: "pointer", textAlign: "left",
        width: "100%", color: CREAM,
        marginBottom: 6,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 700 }}>{label}</div>
        {sub && <div style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: 11, marginTop: 2, fontWeight: 500 }}>{sub}</div>}
      </div>
      <div style={{
        width: 38, height: 22, borderRadius: 999,
        backgroundColor: value ? AMBER : "rgba(255,255,255,0.18)",
        position: "relative", flexShrink: 0,
        transition: "background-color 180ms ease",
      }}>
        <div style={{
          position: "absolute", top: 2, left: value ? 18 : 2,
          width: 18, height: 18, borderRadius: "50%",
          backgroundColor: value ? NAVY : "#FFF8EC",
          transition: "left 180ms cubic-bezier(0.22,1,0.36,1)",
        }} />
      </div>
    </button>
  );
}

/* ─── Real Book Requests page ────────────────────────────── */

function BookRequestsView({ onBack, childName, nanaName }: { onBack: () => void; childName: string; nanaName: string }) {
  const childLabel = childName || "Your grandchild";
  const nanaLabel = nanaName || "Nana";
  const sample = [
    { from: childLabel, title: "Where the Wild Things Are", note: "I want to see the monsters!", color: "#f7c95d" },
    { from: childLabel, title: "Bluey - The Pool", note: "Daddy's favorite", color: "#60a5fa" },
    { from: `${childLabel}'s mom`, title: "The Very Hungry Caterpillar", note: "Old favorite — hers too as a kid 💛", color: "#a78bfa" },
  ];
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      backgroundColor: "#0b172e",
      backgroundImage: "radial-gradient(700px 380px at 80% -20%, rgba(248,113,113,0.16), transparent 70%), radial-gradient(560px 360px at -10% 110%, rgba(201,146,42,0.14), transparent 70%)",
      overflow: "auto",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button onClick={onBack} style={{
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 999, padding: "6px 12px", color: CREAM,
          fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer",
        }}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: "clamp(18px, 2.4vw, 22px)", fontWeight: 700, lineHeight: 1.1 }}>Book Requests</div>
          <div style={{ color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: 11, marginTop: 2 }}>From {childLabel} & family</div>
        </div>
        <span style={{
          backgroundColor: "rgba(248,113,113,0.16)", border: "1px solid rgba(248,113,113,0.45)",
          borderRadius: 999, padding: "4px 10px", color: "#fca5a5",
          fontFamily: "DM Sans, sans-serif", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
          whiteSpace: "nowrap",
        }}>{sample.length} NEW</span>
      </div>

      <div className="bookreq-grid" style={{ padding: "12px 16px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
        <style>{`
          @media (max-width: 600px) { .bookreq-grid { grid-template-columns: 1fr !important; padding: 10px 14px 14px !important; } }
          .bookreq-hint { grid-column: 1 / -1; }
        `}</style>
        {sample.map((req, i) => (
          <div key={i} style={{
            backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${req.color} 12%, rgba(255,255,255,0.04)), rgba(255,255,255,0.03) 70%)`,
            border: `1px solid color-mix(in srgb, ${req.color} 35%, rgba(255,255,255,0.10))`,
            borderRadius: 14, padding: "12px 14px",
            display: "flex", gap: 10, alignItems: "flex-start",
            minHeight: 0,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              backgroundColor: `color-mix(in srgb, ${req.color} 22%, transparent)`,
              border: `1px solid color-mix(in srgb, ${req.color} 50%, transparent)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22,
            }}>📚</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 9, fontWeight: 800, letterSpacing: "0.14em" }}>FROM {req.from.toUpperCase()}</div>
              <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: 16, fontWeight: 700, marginTop: 2 }}>{req.title}</div>
              <div style={{ color: "rgba(247,240,227,0.65)", fontFamily: "Merriweather, serif", fontSize: 12, fontStyle: "italic", marginTop: 4 }}>"{req.note}"</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button style={{
                  background: `linear-gradient(135deg, ${req.color}, color-mix(in srgb, ${req.color} 70%, #d97706))`,
                  color: NAVY, border: "none", borderRadius: 999,
                  padding: "8px 14px", fontFamily: "DM Sans, sans-serif",
                  fontSize: 11, fontWeight: 800, cursor: "pointer",
                }}>Add to Library</button>
                <button style={{
                  background: "transparent", color: "rgba(247,240,227,0.6)",
                  border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999,
                  padding: "8px 14px", fontFamily: "DM Sans, sans-serif",
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>Save for later</button>
              </div>
            </div>
          </div>
        ))}

        <div className="bookreq-hint" style={{
          marginTop: 4, padding: "12px 14px", borderRadius: 14,
          backgroundColor: "rgba(96,165,250,0.08)", border: "1px dashed rgba(96,165,250,0.4)",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{ fontSize: 22 }}>💡</span>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#cfe3ff", fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 700 }}>Tell {childLabel}'s family how to send requests</div>
            <div style={{ color: "rgba(247,240,227,0.6)", fontFamily: "DM Sans, sans-serif", fontSize: 11, marginTop: 2 }}>They tap 📚 in their app and send a wish — you'll see it here.</div>
          </div>
          <button style={{
            background: "rgba(96,165,250,0.18)", border: "1px solid rgba(96,165,250,0.55)",
            borderRadius: 999, padding: "8px 14px", color: "#cfe3ff",
            fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 800, cursor: "pointer",
            whiteSpace: "nowrap",
          }}>Share invite</button>
        </div>
      </div>
    </div>
  );
}

function StubScreen({ icon, title, subtitle, onBack }: { icon: string; title: string; subtitle: string; onBack: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: "#0b172e", padding: 24, gap: 14 }}>
      <div style={{ fontSize: 64 }}>{icon}</div>
      <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: 24, fontWeight: 700 }}>{title}</div>
      <div style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: 13, textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
        {subtitle}
      </div>
      <button
        onClick={onBack}
        style={{
          marginTop: 14,
          backgroundColor: "rgba(255,255,255,0.07)",
          color: CREAM,
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 999,
          padding: "10px 24px",
          fontFamily: "DM Sans, sans-serif",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        ← Back to Home
      </button>
    </div>
  );
}

function VaultView({ onGoHome, connectionId, activeChildId }: { onGoHome: () => void; connectionId?: string; activeChildId?: string | null }) {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [child, setChild] = useState<Child | null>(null);
  // Per-entry delete confirmation. Apple expects irreversible actions
  // to be at least one tap of friction; Privacy Policy v3 §8 commits
  // to letting users delete specific items. Lightweight inline
  // "Are you sure?" rather than a full modal — the action is scoped
  // to one row, the row stays visible during the confirm so the user
  // sees what they're about to lose.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Re-fetch on activeChildId change so the memory feed scopes to the
  // currently-selected sibling. Without activeChildId the call returns
  // the whole connection's history (back-compat for single-child setups).
  useEffect(() => {
    if (!connectionId) { setLoading(false); return; }
    setLoading(true);
    api.sessionLog.list(connectionId, activeChildId ?? undefined)
      .then(({ sessions: s, child: c }) => { setSessions(s); setChild(c); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [connectionId, activeChildId]);

  const handleDeleteSession = async (sessionId: string) => {
    setDeletingId(sessionId);
    try {
      await api.sessionLog.remove(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      // Best-effort — if the request fails the entry stays. A toast
      // would be the right follow-up if this turns out to fail often.
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  };

  const childName = child?.name ?? getRoleLabel("child");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px 8px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
        <div style={{ display: "inline-flex", color: AMBER }} aria-hidden>
          <Disc size={22} strokeWidth={1.6} />
        </div>
        <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: "14px", fontWeight: 700, marginTop: "3px" }}>
          Memory Vault
        </div>
        <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", marginTop: "2px", letterSpacing: "0.04em" }}>
          Your reading memories · growing over time
        </div>
      </div>

      <div style={{ flex: 1, padding: "10px", overflow: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: "20px", color: "rgba(247,240,227,0.3)", fontFamily: "DM Sans, sans-serif", fontSize: "9px" }}>
            Loading memories…
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div style={{ textAlign: "center", padding: "20px" }}>
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>📚</div>
            <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "Merriweather, serif", fontSize: "9px", fontStyle: "italic", lineHeight: 1.6 }}>
              Your reading memories will appear here after your first session.
            </div>
          </div>
        )}

        {!loading && sessions.map((entry, idx) => {
          const book = booksLibrary[entry.bookId] ?? { title: entry.bookId, emoji: "📖", spineColor: "#4A6FA5", pages: [] };
          const isNew = (Date.now() - new Date(entry.sessionDate).getTime()) < 7 * 24 * 60 * 60 * 1000;
          const isLatest = idx === 0;
          const age = child?.birthday ? computeAge(child.birthday, entry.sessionDate) : null;
          const pagesRead = Math.max(0, entry.endPage - entry.startPage);
          return (
            <div key={entry.id} style={{
              display: "flex", alignItems: "center", gap: "10px",
              backgroundColor: isLatest ? "rgba(201,146,42,0.08)" : "rgba(255,255,255,0.035)",
              border: `1px solid ${isLatest ? "rgba(201,146,42,0.35)" : "rgba(255,255,255,0.08)"}`,
              borderLeft: `4px solid ${book.spineColor}`,
              borderRadius: "8px", padding: "14px 16px 14px 14px",
            }}>
              <div style={{
                width: "52px", height: "52px", borderRadius: "50%",
                backgroundColor: book.spineColor,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "26px", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
              }}>
                {book.emoji}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "2px" }}>
                  <span style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "16px", fontWeight: 700 }}>
                    {childName}{age !== null ? ` · Age ${age}` : ""}
                  </span>
                  {isNew && (
                    <span style={{ backgroundColor: AMBER, color: NAVY, fontSize: "10px", fontWeight: 800, borderRadius: "4px", padding: "1px 4px", letterSpacing: "0.05em" }}>NEW</span>
                  )}
                </div>
                <div style={{ color: CREAM, fontFamily: "Merriweather, serif", fontSize: "15px", fontStyle: "italic", marginBottom: "1px", lineHeight: 1.3 }}>
                  {book.title}
                </div>
                <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "13px" }}>
                  {formatSessionDate(entry.sessionDate)}{pagesRead > 0 ? ` · ${pagesRead} page${pagesRead !== 1 ? "s" : ""} read` : ""}
                </div>
              </div>
              <button
                disabled
                aria-label="Playback not yet available"
                title="Recording playback — coming soon"
                style={{
                  backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: "8px", padding: "9px 14px", color: "rgba(247,240,227,0.35)",
                  fontFamily: "Inter, DM Sans, sans-serif", fontSize: "12px", fontWeight: 600,
                  cursor: "not-allowed", flexShrink: 0,
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <Play size={12} strokeWidth={2.2} aria-hidden /> Play
              </button>
              {/* Per-entry delete — Privacy Policy v3 §8 commits to
                  letting users remove specific Memory Vault items.
                  Inline two-tap confirm rather than a modal so it
                  doesn't disrupt browsing. */}
              {confirmingId === entry.id ? (
                <div style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => setConfirmingId(null)}
                    disabled={deletingId === entry.id}
                    aria-label="Cancel delete"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.18)",
                      borderRadius: "8px", padding: "9px 10px",
                      color: CREAM,
                      fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDeleteSession(entry.id)}
                    disabled={deletingId === entry.id}
                    aria-label="Confirm delete this memory"
                    style={{
                      backgroundColor: "#ef4444",
                      border: "none",
                      borderRadius: "8px", padding: "9px 12px",
                      color: "#fff",
                      fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 800,
                      cursor: deletingId === entry.id ? "wait" : "pointer",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {deletingId === entry.id ? "…" : "Delete"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingId(entry.id)}
                  aria-label="Delete this memory"
                  title="Delete this memory"
                  style={{
                    backgroundColor: "transparent",
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: "8px", padding: "9px 10px",
                    color: "rgba(247,240,227,0.5)",
                    cursor: "pointer", flexShrink: 0,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <span aria-hidden style={{ fontSize: 14 }}>🗑️</span>
                </button>
              )}
            </div>
          );
        })}

        <div style={{
          marginTop: "4px", padding: "10px", borderRadius: "8px",
          border: "1px dashed rgba(255,255,255,0.1)",
          textAlign: "center",
        }}>
          <div style={{ color: "rgba(247,240,227,0.3)", fontFamily: "Merriweather, serif", fontSize: "13px", fontStyle: "italic", lineHeight: 1.6 }}>
            "{childName} at 7" — "{childName} at 10" — "{childName} at 13"
          </div>
          <div style={{ color: "rgba(247,240,227,0.2)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", marginTop: "3px" }}>
            A decade of memories · growing here over time
          </div>
        </div>
      </div>

      <div style={{ padding: "10px 12px 12px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0, display: "flex", justifyContent: "center" }}>
        {/* Single "Home" tile replaces the old multi-tap Back flow. Rick:
            "Memory Vault back button requires multiple taps and kills the
            camera." The old Back returned to whatever screen opened the
            vault (icebreaker mid-session, splash post-end-call), so Nana
            had to chain extra taps to reach home — and the splash path
            tore down the call object. Home goes straight to her dashboard
            in one tap; the roaming PiP keeps Perry on screen. */}
        <TileButton
          icon="🏠"
          label="Home"
          tone="secondary"
          size="md"
          onClick={onGoHome}
        />
      </div>
    </div>
  );
}

/* ─── Our Family Journal View ────────────────────────────────── */

function StoriesEntryCard({ entry }: { entry: FamilyStoryEntry }) {
  return (
    <div style={{
      backgroundColor: entry.isNew ? "rgba(201,146,42,0.07)" : "rgba(255,255,255,0.032)",
      border: `1px solid ${entry.isNew ? "rgba(201,146,42,0.3)" : "rgba(255,255,255,0.07)"}`,
      borderLeft: `4px solid ${entry.bookColor}`,
      borderRadius: "8px", padding: "10px 11px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "6px" }}>
        <span style={{ fontSize: "14px" }}>{entry.bookEmoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "15px", fontWeight: 700, lineHeight: 1.2 }}>
            {entry.book}
          </div>
          <div style={{ color: "rgba(247,240,227,0.35)", fontFamily: "DM Sans, sans-serif", fontSize: "13px" }}>
            {entry.date}
          </div>
        </div>
        {entry.isNew && (
          <span style={{ backgroundColor: AMBER, color: NAVY, fontSize: "10px", fontWeight: 800, borderRadius: "4px", padding: "1px 4px" }}>NEW</span>
        )}
        {!entry.isNew && (
          <span style={{ fontSize: "10px", opacity: 0.5 }} title={entry.seen ? "Seen by Perry" : "Not yet seen"}>
            {entry.seen ? "❤️" : "🤍"}
          </span>
        )}
      </div>
      <p style={{ color: CREAM, fontFamily: "Merriweather, serif", fontSize: "15px", fontStyle: "italic", lineHeight: 1.7, margin: 0, opacity: 0.85 }}>
        "{entry.note}"
      </p>
    </div>
  );
}

function FamilyStoriesView({
  isNana,
  subMode,
  currentBookTitle,
  currentBookEmoji,
  currentBookSpineColor,
  entries,
  onSave,
  onSkip,
  onClose,
  // Multi-child — post-save splash surfaces "Read with another child?"
  // so Nana doesn't have to navigate Home → child picker → start. Only
  // shows when there are 2+ siblings (single-child connections still
  // see the regular "Memory saved!" splash plus a Home button).
  childrenList = [],
  activeChildId = null,
  onSelectChild,
  onOpenAddChild,
  /** Returns Nana to her home dashboard. Wired to App.handleGoHome. */
  onGoHome,
  /** NEED 3 — chain another book in the same reading session without
   *  the goodbye sequence. Renders as a third pill on the write screen
   *  alongside "Not today" and "Save Memory". Only available to Nana. */
  onReadAnotherBook,
  /** Explicit "we're done — disconnect" path so the grandchild's iPad
   *  also drops back to PIN. Rick's follow-up to NEED 3: needed an
   *  intentional end-of-session button on the save-memory screen so
   *  the grandchild doesn't sit indefinitely on a waiting screen after
   *  Nana wanders off. Nana-only — Perry never disconnects herself. */
  onDisconnectSession,
}: {
  isNana: boolean;
  subMode: FamilyStoriesSubMode;
  currentBookTitle: string;
  currentBookEmoji: string;
  currentBookSpineColor: string;
  entries: FamilyStoryEntry[];
  onSave: (note: string) => void;
  onSkip: () => void;
  onClose: () => void;
  childrenList?: Child[];
  activeChildId?: string | null;
  onSelectChild?: (childId: string) => void;
  onOpenAddChild?: () => void;
  onGoHome?: () => void;
  onReadAnotherBook?: () => void;
  onDisconnectSession?: () => void;
}) {
  // Resolve the active child's name from the multi-child list so the
  // textarea placeholder and other inline child references read like
  // real text ("Tonight Cooper laughed…") instead of a hardcoded
  // "Perry" — Rick: "double check there should be no hard coded perry
  // name as I saw in multple places."
  const activeChildName = (
    childrenList.find((c) => c.id === activeChildId)?.name ??
    childrenList[0]?.name ??
    ""
  ).trim() || "your grandchild";
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const trimmed = text.trim();
    if (!trimmed) { onSkip(); return; }
    // Save IMMEDIATELY — iOS PWA standalone mode is known to pause JS timers
    // when the tab loses focus, which previously left users stuck on the
    // "Memory saved!" splash forever. The brief animation still plays as
    // the parent navigates onward.
    setSaved(true);
    onSave(trimmed);
  };

  if (isNana && subMode === "write") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", overflow: "hidden" }}>
        <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "28px", height: "34px", borderRadius: "4px", backgroundColor: currentBookSpineColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0 }}>
              {currentBookEmoji}
            </div>
            <div>
              <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "18px", fontWeight: 700 }}>Add a Memory</div>
              <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "14px", marginTop: "1px" }}>{currentBookTitle}</div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, padding: "12px", display: "flex", flexDirection: "column", gap: "10px", overflow: "hidden" }}>
          {!saved ? (
            <>
              {/* Save / Skip buttons FIRST so the iPad keyboard doesn't
                  cover them when the textarea is focused (Rick: "Save
                  button at the TOP of the screen, not the bottom").
                  Save Memory now uses the same FOOTER_CTA rhythm as the
                  Quick Check-In primary CTAs — Rick: "the full-width
                  Save a Memory button is a good example of inconsistency
                  — does not match the style of other buttons and feels
                  out of place." Centered, capped at 360px, sized like
                  Propose Time / Goodbye footer CTAs elsewhere. */}
              <div style={{ flexShrink: 0, display: "flex", gap: "10px", justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  onClick={onSkip}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.16)", color: "rgba(247,240,227,0.7)",
                    borderRadius: 999, padding: "10px 18px",
                    fontFamily: "DM Sans, sans-serif", fontSize: "13px", fontWeight: 600,
                    cursor: "pointer",
                    minHeight: 44,
                    touchAction: "manipulation",
                  }}
                >
                  Not today
                </button>
                {onReadAnotherBook && (
                  <button
                    onClick={onReadAnotherBook}
                    style={{
                      background: "rgba(96,165,250,0.14)",
                      border: "1px solid rgba(96,165,250,0.45)",
                      color: "#93c5fd",
                      borderRadius: 999,
                      padding: "10px 18px",
                      fontFamily: "DM Sans, sans-serif",
                      fontSize: "13px",
                      fontWeight: 700,
                      cursor: "pointer",
                      minHeight: 44,
                      touchAction: "manipulation",
                      display: "inline-flex", alignItems: "center", gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 15 }}>📖</span>
                    Read another
                  </button>
                )}
                <button
                  onClick={handleSave}
                  style={{
                    background: "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)",
                    color: NAVY,
                    border: "none",
                    borderRadius: 999,
                    padding: "14px 24px",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: "clamp(14px, 1.7vw, 16px)",
                    fontWeight: 800,
                    letterSpacing: "0.04em",
                    cursor: "pointer",
                    boxShadow: "0 6px 22px rgba(201,146,42,0.45)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
                    minHeight: 56, minWidth: 220, maxWidth: 360,
                    touchAction: "manipulation",
                  }}
                >
                  <span style={{ fontSize: 20 }}>💛</span>
                  Save Memory
                </button>
              </div>
              {/* Explicit "end session for everyone" — publishes
                  session_complete which the grandchild's SSE handler
                  drops to her PIN screen. Sits in its own row beneath
                  the save row so it reads as a separate finality
                  action, not another save variant. Rick: "there should
                  be another button to disconnect grandchild from
                  grandparent and then grandchild disconnects." */}
              {onDisconnectSession && (
                <div style={{ flexShrink: 0, display: "flex", justifyContent: "center" }}>
                  <button
                    onClick={onDisconnectSession}
                    style={{
                      background: "linear-gradient(135deg, rgba(192,132,252,0.20) 0%, rgba(139,92,246,0.20) 100%)",
                      color: "#e0d4ff",
                      border: "1px solid rgba(192,132,252,0.55)",
                      borderRadius: 999,
                      padding: "10px 20px",
                      fontFamily: "DM Sans, sans-serif",
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                      cursor: "pointer",
                      minHeight: 44,
                      touchAction: "manipulation",
                      display: "inline-flex", alignItems: "center", gap: 8,
                    }}
                  >
                    <span aria-hidden style={{ fontSize: 14 }}>👋</span>
                    Disconnect & end
                  </button>
                </div>
              )}
              <div style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: "16px", lineHeight: 1.5 }}>
                What will {activeChildName} remember about today's session?
              </div>
              <textarea
                value={text}
                onChange={e => setText((e.target as HTMLTextAreaElement).value)}
                placeholder={`"Tonight ${activeChildName} laughed so hard at the Mad Hatter..."`}
                style={{
                  flex: 1, backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(201,146,42,0.3)",
                  borderRadius: "10px", padding: "10px 12px", color: CREAM,
                  fontFamily: "Merriweather, serif", fontSize: "15px", lineHeight: 1.75,
                  resize: "none", outline: "none", fontStyle: text ? "normal" : "italic",
                }}
                autoFocus
              />
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "20px 16px", animation: "fade-in 0.4s ease-out", overflowY: "auto" }}>
              <div style={{ fontSize: 48 }}>💛</div>
              <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: 22, fontWeight: 700, textAlign: "center" }}>Memory saved!</div>
              <div style={{ color: "rgba(247,240,227,0.6)", fontFamily: "Merriweather, serif", fontSize: 13, fontStyle: "italic", textAlign: "center", lineHeight: 1.55, maxWidth: 320 }}>
                {activeChildName}'s family will be able to read this whenever they like.
              </div>

              {/* Post-session multi-child switcher. Only shows when there
                  is actually a second sibling on the connection — the
                  "Add a sibling" tile is always available. Tapping a
                  sibling switches active child + drops the saved book so
                  Cooper's library opens fresh on Nana's home. */}
              {onSelectChild && onOpenAddChild && childrenList.length > 0 && (
                <div style={{ width: "100%", maxWidth: 420, marginTop: 6 }}>
                  <div style={{
                    color: "rgba(247,240,227,0.5)",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: 10, fontWeight: 800, letterSpacing: "0.16em",
                    textAlign: "center", marginBottom: 8,
                  }}>READ WITH ANOTHER CHILD?</div>
                  <ChildPicker
                    children={childrenList}
                    activeChildId={activeChildId}
                    onSelect={(id) => {
                      onSelectChild(id);
                      if (onGoHome) onGoHome();
                    }}
                    onAddNew={onOpenAddChild}
                    layout="grid"
                  />
                </div>
              )}

              {onGoHome && (
                <button
                  onClick={onGoHome}
                  style={{
                    marginTop: 8,
                    background: "transparent",
                    border: "1px solid rgba(247,201,93,0.45)",
                    color: AMBER,
                    borderRadius: 999,
                    padding: "10px 20px",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: 13, fontWeight: 700,
                    cursor: "pointer", letterSpacing: "0.04em",
                    minHeight: 44,
                    touchAction: "manipulation",
                  }}
                >
                  🏠 Back to home
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!isNana && subMode === "write") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", overflow: "hidden" }}>
        <div style={{ padding: "10px 14px 8px", display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
          {/* Perry-side Back — Rick: "you are completely trapped on that
              screen." She landed here from session_end; tapping Back
              returns her to her PIN/splash so she can rejoin or wait. */}
          <button
            onClick={onClose}
            aria-label="Back"
            title="Back"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 999,
              padding: "6px 12px",
              color: CREAM,
              fontFamily: "DM Sans, sans-serif",
              fontSize: 12, fontWeight: 700,
              cursor: "pointer",
            }}
          >← Back</button>
          <div style={{ textAlign: "center" }}>
            <div style={{ display: "inline-flex", color: AMBER }} aria-hidden>
              <BookHeart size={20} strokeWidth={1.6} />
            </div>
            <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: "13px", fontWeight: 700, marginTop: "3px" }}>Our Family Journal</div>
          </div>
          <span />
        </div>
        <div style={{ padding: "14px 12px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", backgroundColor: "rgba(201,146,42,0.07)", borderRadius: "8px", padding: "9px 10px", border: "1px solid rgba(201,146,42,0.2)" }}>
            <div style={{ fontSize: "20px", animation: "pulse-sm 2s ease-in-out infinite" }}>✍️</div>
            <div>
              <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700 }}>Nana is writing a memory...</div>
              <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", marginTop: "1px" }}>about today's reading session</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, padding: "10px", overflow: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ color: "rgba(247,240,227,0.3)", fontFamily: "DM Sans, sans-serif", fontSize: "8px", letterSpacing: "0.06em", marginBottom: "2px" }}>PAST MEMORIES</div>
          {entries.length === 0 ? (
            <div style={{
              flex: 1,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              textAlign: "center",
              padding: "20px 16px",
              gap: 10,
              color: "rgba(247,240,227,0.55)",
              fontFamily: "DM Sans, sans-serif",
            }}>
              <div style={{ fontSize: 36 }}>💌</div>
              <div style={{ color: CREAM, fontSize: 13, fontWeight: 700 }}>The first memory is on its way!</div>
              <div style={{ fontSize: 11, lineHeight: 1.5, maxWidth: 220 }}>
                Nana is writing about today right now. Once she saves it, it'll appear here.
              </div>
            </div>
          ) : (
            entries.map(e => <StoriesEntryCard key={e.id} entry={e} />)
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#0b172e", overflow: "hidden" }}>
      {/* Header — Rick: "When you open the Family Journal it shows a
          blank screen with nothing to interact with. There is no way to
          exit — you are completely trapped on that screen." Hero, body
          and footer were all there but rendered so faintly (9px italic at
          25% opacity for the empty state; 11px outlined Back button) that
          on an iPad it read as a blank panel. Bumped every level. */}
      <div style={{ padding: "12px 16px 10px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
        {/* Back button visible to both Nana and Perry. App-level
            handleCloseFamilyStories routes Perry back to her PIN/splash
            so she has an explicit way out of the journal. Rick: "no way
            to exit — you are completely trapped on that screen." */}
        <button
          onClick={onClose}
          aria-label="Back"
          title="Back"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 999,
            padding: "6px 12px",
            color: CREAM,
            fontFamily: "DM Sans, sans-serif",
            fontSize: 12, fontWeight: 700,
            cursor: "pointer",
            flexShrink: 0,
            display: "inline-flex", alignItems: "center", gap: 4,
          }}
        >← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: "clamp(18px, 2.4vw, 22px)", fontWeight: 700, lineHeight: 1.1, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden style={{ fontSize: 22 }}>📖</span>
            Our Family Journal
          </div>
          <div style={{ color: "rgba(247,240,227,0.6)", fontFamily: "DM Sans, sans-serif", fontSize: 12, marginTop: 2 }}>
            {isNana ? `Your memories for ${activeChildName}` : "Nana's memories for you"}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, padding: "14px 16px", overflow: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
        {entries.length === 0 ? (
          <div style={{
            flex: 1,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            textAlign: "center",
            padding: "24px 16px",
            gap: 12,
          }}>
            <div style={{ fontSize: 56 }}>💝</div>
            <div style={{
              color: CREAM,
              fontFamily: "Playfair Display, serif",
              fontSize: "clamp(17px, 2vw, 20px)",
              fontWeight: 700,
              lineHeight: 1.3,
              maxWidth: 380,
            }}>
              Your memories will live here.
            </div>
            <div style={{
              color: "rgba(247,240,227,0.72)",
              fontFamily: "Merriweather, serif",
              fontSize: 14,
              fontStyle: "italic",
              lineHeight: 1.55,
              maxWidth: 360,
            }}>
              {isNana
                ? `Save a note at the end of each reading session, and ${activeChildName} will be able to read it for years to come.`
                : "When Nana finishes a session with you, she'll save a memory here. They'll be waiting whenever you want to read them again."}
            </div>
            <button
              onClick={onClose}
              style={{
                marginTop: 8,
                background: "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)",
                color: NAVY,
                border: "none",
                borderRadius: 999,
                padding: "12px 24px",
                fontFamily: "DM Sans, sans-serif",
                fontSize: 14, fontWeight: 800,
                letterSpacing: "0.02em",
                cursor: "pointer",
                boxShadow: "0 6px 18px rgba(201,146,42,0.42)",
                display: "inline-flex", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>📚</span>
              Back to Home
            </button>
          </div>
        ) : (
          entries.map(e => <StoriesEntryCard key={e.id} entry={e} />)
        )}
      </div>
      {entries.length > 0 && (
        <div style={{ padding: "10px 16px 14px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{
              width: "100%",
              backgroundColor: "rgba(255,255,255,0.08)",
              color: CREAM,
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 999,
              padding: "12px",
              fontSize: 14,
              fontFamily: "DM Sans, sans-serif", fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.02em",
              minHeight: 44,
            }}
          >
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Silly Faces Mode View ──────────────────────────────── */

/* ─── Goodbye View ───────────────────────────────────────── */

const GOODBYE_NUMS  = [5, 4, 3, 2, 1];
const GOODBYE_HANDS = ["🖐️", "🖖", "🤟", "✌️", "☝️"];

function GoodbyeView({
  isNana,
  goodbyePhase,
  goodbyeStartTime,
  onBeginCountdown,
  onSkipToGoodbye,
  onEndSession,
  childName,
  nanaName,
  sessionSummary,
  onGoHome,
}: {
  isNana: boolean;
  goodbyePhase: number;
  /** null until Nana taps "Start countdown" — drives the Ready stage. */
  goodbyeStartTime: number | null;
  onBeginCountdown: () => void;
  onSkipToGoodbye: () => void;
  onEndSession: () => void;
  childName: string;
  nanaName: string;
  /** Optional per-session stats shown in the top "wonderful reading session"
   *  panel. Built by App from currentBook + pages read + chapter info. */
  sessionSummary?: {
    bookTitle: string;
    pagesRead: number;
    /** "Chapter 3 · My Early Home" — only set when book has chapters. */
    chapterCompleted?: string;
    /** "Chapter 3 of 12" — only set when book has chapters. */
    chapterProgress?: string;
  } | null;
  /** NEED 1 — Nana-side prominent Home escape. */
  onGoHome?: () => void;
}) {
  const bigName = isNana ? (childName || getRoleLabel("child")) : (nanaName || getRoleLabel("nana"));
  const selfName = isNana ? (nanaName || getRoleLabel("nana")) : (childName || getRoleLabel("child"));

  // "Ready?" pre-countdown stage: we're in goodbye mode but Nana hasn't
  // tapped Start yet. Both devices show the same shared explanation;
  // only Nana's screen has the Start button. Rick: "give Nana a Start
  // Countdown button she presses when she and Perry are both ready."
  const isReadyStage = goodbyeStartTime === null && goodbyePhase === 0;
  const isCountdown = !isReadyStage && goodbyePhase <= 4;
  const isKisses    = goodbyePhase === 5;
  const isLove      = goodbyePhase === 6;
  const isGoodbye   = goodbyePhase === 7;

  const steps = [
    { emoji: "🖐️", label: "Count down",  phases: [0,1,2,3,4] },
    { emoji: "💋",  label: "Blow kisses", phases: [5] },
    { emoji: "❤️",  label: "I love you",  phases: [6] },
    { emoji: "👋",  label: "Goodbye!",    phases: [7] },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#000", overflow: "hidden" }}>
      <div style={{
        backgroundColor: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(201,146,42,0.25)",
        borderRadius: "14px", padding: "18px 16px",
        marginBottom: "16px", textAlign: "center",
      }}>
        <div style={{ fontSize: "28px", marginBottom: "10px", letterSpacing: "-1px" }}>📖 ✨ 💕</div>
        <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "15px", fontWeight: 700, marginBottom: "6px" }}>
          What a wonderful reading session!
        </div>
        {/* Per-session stats: pages read + chapter completion (chapter
            books). Shown only when we have something meaningful to say
            (pagesRead > 0). For picture books just shows pages. For
            chapter books, also surfaces "Chapter 3 · Title complete!". */}
        {sessionSummary && sessionSummary.pagesRead > 0 && (
          <div style={{
            color: "rgba(247,240,227,0.85)",
            fontFamily: "DM Sans, sans-serif", fontSize: "11.5px", fontWeight: 600,
            lineHeight: 1.5, marginTop: "6px", marginBottom: "8px",
            padding: "8px 10px",
            backgroundColor: "rgba(201,146,42,0.08)",
            borderRadius: "8px",
            display: "inline-block",
          }}>
            Today you read <span style={{ color: AMBER, fontWeight: 800 }}>{sessionSummary.pagesRead}</span>
            {" "}page{sessionSummary.pagesRead === 1 ? "" : "s"} of
            {" "}<span style={{ color: AMBER, fontWeight: 800 }}>{sessionSummary.bookTitle}</span>.
            {sessionSummary.chapterCompleted && (
              <>
                <br/>
                <span style={{ color: "#86efac", fontWeight: 700 }}>
                  ✓ {sessionSummary.chapterCompleted} complete
                </span>
                {sessionSummary.chapterProgress && (
                  <span style={{ color: "rgba(247,240,227,0.55)" }}>
                    {" "}· {sessionSummary.chapterProgress}
                  </span>
                )}
              </>
            )}
          </div>
        )}
        <div style={{ color: "rgba(247,240,227,0.65)", fontFamily: "Merriweather, serif", fontSize: "10px", fontStyle: "italic", lineHeight: 1.7 }}>
          Reading is the vehicle.<br/>The relationship is the destination.
        </div>
      </div>
      {/* Goodbye stage with the main video tile restored. Rick: "on
          goodbye screen, no video showing — main tile video should be."
          Ceremony overlays (Ready / Countdown / Kisses / Love / Goodbye)
          paint over the video as absolutely-positioned siblings. The
          video uses contain so the face shows at natural framing. */}
      <div style={{
        flex: "0 0 50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 12, position: "relative", overflow: "hidden",
        backgroundColor: "#0b172e",
        backgroundImage: "radial-gradient(720px 460px at 80% -10%, rgba(247,201,93,0.16), transparent 70%), radial-gradient(580px 420px at -10% 110%, rgba(248,113,113,0.18), transparent 70%)",
      }}>
        <div style={{ width: "100%", maxWidth: 700, height: "100%", position: "relative" }}>
          <FaceVideoStage
            bigPerson={isNana ? "child" : "nana"}
            pipPerson={isNana ? "nana" : "child"}
            bigName={bigName}
            pipName={selfName}
            bigObjectFit="contain"
          />
        </div>
        {/* === Ready? — pre-countdown shared explanation === */}
        {isReadyStage && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 22,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            backgroundColor: "rgba(11,23,46,0.78)",
            backdropFilter: "blur(6px)",
            padding: "20px",
            textAlign: "center",
            animation: "phase-intro-fade 0.3s ease-out",
          }}>
            <div style={{ fontSize: "44px", marginBottom: "12px", letterSpacing: "-1px" }}>🖐️ → 💋</div>
            <div style={{
              color: AMBER,
              fontFamily: "Playfair Display, serif",
              fontSize: "22px", fontWeight: 700,
              lineHeight: 1.3, marginBottom: "12px",
              maxWidth: "420px",
            }}>
              OK! Out loud together, count down from 5 …
            </div>
            <div style={{
              color: CREAM,
              fontFamily: "Merriweather, serif",
              fontSize: "15px", lineHeight: 1.6,
              maxWidth: "380px", marginBottom: "20px",
              opacity: 0.85,
              fontStyle: "italic",
            }}>
              … then blow kisses goodbye! Ready?
            </div>
            {isNana ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <ProminentHomePill onClick={onGoHome} />
                <button
                  onClick={onBeginCountdown}
                  style={{
                    backgroundColor: AMBER,
                    color: NAVY,
                    border: "none",
                    borderRadius: "999px",
                    padding: "14px 28px",
                    fontSize: "16px",
                    fontFamily: "DM Sans, sans-serif",
                    fontWeight: 800,
                    letterSpacing: "0.04em",
                    cursor: "pointer",
                    boxShadow: "0 6px 22px rgba(201,146,42,0.45)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  Start Countdown →
                </button>
              </div>
            ) : (
              <div style={{
                color: "rgba(247,240,227,0.55)",
                fontFamily: "DM Sans, sans-serif",
                fontSize: "13px",
                letterSpacing: "0.06em",
                display: "inline-flex", alignItems: "center", gap: "8px",
                padding: "10px 18px",
                border: "1px dashed rgba(255,255,255,0.18)",
                borderRadius: "999px",
              }}>
                <span style={{ fontSize: "16px", animation: "pulse-sm 1.4s ease-in-out infinite" }}>⏳</span>
                Waiting for {nanaName || "Nana"} to start…
              </div>
            )}
          </div>
        )}

        {/* === Countdown === Rick: "Make the font larger and use white
            so the countdown text is much more visible and pronounced." */}
        {isCountdown && (
          <div
            key={`countdown-${goodbyePhase}`}
            className="nm-num-pop"
            style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", zIndex: 20, pointerEvents: "none" }}
          >
            <div style={{ fontSize: "180px", lineHeight: 0.9, fontWeight: 900, fontFamily: "DM Sans, sans-serif", color: "#ffffff", textShadow: "0 6px 36px rgba(0,0,0,1.0), 0 0 80px rgba(255,255,255,0.45), 0 0 140px rgba(255,255,255,0.30)" }}>
              {GOODBYE_NUMS[goodbyePhase]}
            </div>
            <div style={{ fontSize: "56px", marginTop: "10px" }}>{GOODBYE_HANDS[goodbyePhase]}</div>
          </div>
        )}

        {/* === Kisses === */}
        {isKisses && (
          <div style={{ position: "absolute", inset: 0, zIndex: 20, overflow: "hidden", pointerEvents: "none" }}>
            {[0,1,2,3,4].map(i => (
              <span key={i} style={{ position: "absolute", top: `${14 + i * 13}%`, left: "50%", fontSize: i % 2 === 0 ? "38px" : "30px", display: "inline-block", animation: `${i % 2 === 0 ? "kiss-lr" : "kiss-rl"} 1.5s ease-in-out ${i * 0.38}s infinite`, pointerEvents: "none" }}>💋</span>
            ))}
            <div style={{ position: "absolute", bottom: "14%", left: "50%", transform: "translateX(-50%)", color: "white", fontFamily: "DM Sans, sans-serif", fontSize: "17px", fontWeight: 700, textShadow: "0 2px 10px rgba(0,0,0,0.9)", whiteSpace: "nowrap", animation: "fade-in 0.4s ease-out forwards" }}>
              Blow kisses! 😘
            </div>
          </div>
        )}

        {/* === I Love You === */}
        {isLove && (
          <div style={{ position: "absolute", top: "45%", left: "50%", transform: "translateX(-50%) translateY(-50%)", textAlign: "center", zIndex: 20, animation: "fade-in 0.5s ease-out forwards", pointerEvents: "none" }}>
            <span style={{ fontSize: "76px", display: "inline-block", animation: "heart-beat 0.9s ease-in-out infinite" }}>❤️</span>
            <div style={{ color: "white", fontFamily: "Playfair Display, serif", fontSize: "24px", fontWeight: 700, textShadow: "0 2px 14px rgba(0,0,0,0.95)", marginTop: "10px", whiteSpace: "nowrap" }}>
              I Love You!
            </div>
          </div>
        )}

        {/* === Goodbye === */}
        {isGoodbye && (
          <div style={{ position: "absolute", top: "42%", left: "50%", transform: "translateX(-50%) translateY(-50%)", textAlign: "center", zIndex: 20, animation: "fade-in 0.5s ease-out forwards", pointerEvents: "none" }}>
            <span style={{ fontSize: "76px", display: "inline-block", animation: "wave-hand 1.2s ease-in-out infinite", transformOrigin: "bottom center" }}>👋</span>
            <div style={{ color: "white", fontFamily: "Playfair Display, serif", fontSize: "26px", fontWeight: 700, textShadow: "0 2px 14px rgba(0,0,0,0.95)", marginTop: "10px" }}>
              Goodbye! 💕
            </div>
            <div style={{ color: "rgba(255,255,255,0.68)", fontFamily: "Playfair Display, serif", fontSize: "12px", fontStyle: "italic", textShadow: "0 1px 8px rgba(0,0,0,0.95)", marginTop: "10px", whiteSpace: "nowrap" }}>
              Turn the page, strengthen the bond.
            </div>
          </div>
        )}

        {/* Corner instruction card — bottom-left */}
        <div style={{ position: "absolute", bottom: "12px", left: "12px", zIndex: 10, backgroundColor: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)", borderRadius: "10px", padding: "8px 10px 6px", border: "1px solid rgba(255,255,255,0.11)" }}>
          {steps.map(step => {
            const active = step.phases.includes(goodbyePhase);
            return (
              <div key={step.label} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px", opacity: active ? 1 : 0.28, transition: "opacity 0.5s" }}>
                <span style={{ fontSize: "13px" }}>{step.emoji}</span>
                <span style={{ color: "white", fontFamily: "DM Sans, sans-serif", fontSize: "10px", fontWeight: active ? 700 : 400 }}>{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* Name dot — bottom-right */}
        <div style={{ position: "absolute", bottom: "12px", right: "14px", display: "flex", alignItems: "center", gap: "6px", zIndex: 10 }}>
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
          <span style={{ color: "white", fontFamily: "DM Sans, sans-serif", fontSize: "12px", fontWeight: 700, textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>{bigName}</span>
        </div>
      </div>

      {/* Bottom strip */}
      <div style={{
        backgroundColor: "#0b172e",
        padding: "12px 16px",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex", gap: "10px",
        alignItems: "center",
        justifyContent: isGoodbye ? "center" : "space-between",
      }}>
        {!isGoodbye ? (
          <>
            <span style={{ flex: 1, color: "rgba(255,255,255,0.42)", fontFamily: "DM Sans, sans-serif", fontSize: "11px" }}>
              {isCountdown ? `${GOODBYE_NUMS[goodbyePhase]} — put up your fingers!` : isKisses ? "Blow kisses back and forth!" : "Say I love you! ❤️"}
            </span>
            {/* Skip button — Nana-only. Rick: "remove [Skip] from
                the child's UI." */}
            {isNana && (
              <TileButton
                icon="⏭"
                label="Skip"
                tone="ghost"
                size="sm"
                onClick={onSkipToGoodbye}
              />
            )}
          </>
        ) : (
          /* Centered pill matching the FOOTER_CTA pattern in
             ParentCheckView. Rick: "the full-width Save a Memory button
             is a good example of inconsistency — does not match the
             style of other buttons and feels out of place." Now sits
             at the same 56px height / 14×24 padding rhythm as Propose
             Time, Silly Faces, and Goodbye footer CTAs. */
          <button
            onClick={onEndSession}
            style={{
              background: "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)",
              color: NAVY,
              border: "none",
              borderRadius: 999,
              padding: "14px 24px",
              fontFamily: "DM Sans, sans-serif",
              fontSize: "clamp(14px, 1.7vw, 16px)",
              fontWeight: 800,
              letterSpacing: "0.04em",
              cursor: "pointer",
              boxShadow: "0 6px 22px rgba(201,146,42,0.45)",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
              minHeight: 56, minWidth: 220, maxWidth: 360,
              touchAction: "manipulation",
            }}
          >
            <span style={{ fontSize: 20 }}>💛</span>
            Save a Memory →
          </button>
        )}
      </div>
    </div>
  );
}

function SillyFacesView({
  isNana,
  isRecording,
  myFilter,
  theirFilter,
  onSetMyFilter,
  sillyChallenge,
  sillyCountNum,
  onStartChallenge,
  laughWinner,
  onLaughedFirst,
  onStartGoodbye,
  onStartParentCheck,
  onEndChallenge,
  onEndSession,
  childName,
  nanaName,
  currentReaction,
  onReact,
  challengeEnabled,
  onGoHome,
}: {
  isNana: boolean;
  isRecording: boolean;
  myFilter: string;
  theirFilter: string;
  onSetMyFilter: (f: string) => void;
  sillyChallenge: ChallengeState;
  sillyCountNum: number;
  onStartChallenge: () => void;
  laughWinner: "nana" | "perry" | null;
  onLaughedFirst: (who: "nana" | "perry") => void;
  onStartGoodbye: () => void;
  /** Rick's Feature 5: lets Nana detour to the scheduler from Silly
   *  Faces. If she chose Silly Faces first as her wrap-up step, this
   *  is how she comes back to "Schedule Next Reading" without having
   *  to navigate elsewhere. */
  onStartParentCheck: () => void;
  /** Reset challenge state — break out of locked challenge screens. */
  onEndChallenge: () => void;
  onEndSession: () => void;
  childName: string;
  nanaName: string;
  /** Same reaction plumbing as reading mode — Rick: "bring some of the
   *  emoji features from reading mode into the Silly Faces panel." */
  currentReaction?: ReactionEvent | null;
  onReact?: (e: ReactionEmoji) => void;
  /** When false the CHALLENGE pill is hidden on this device. Per-device
   *  opt-out from Settings — incoming challenges from the partner still
   *  drive the screen (so we don't desync mid-session). */
  challengeEnabled: boolean;
  /** NEED 1 — prominent Nana-side Home escape. The tiny NavStrip icon
   *  in the top chrome wasn't visible enough; Rick wants a deliberate
   *  pill in the action area. */
  onGoHome?: () => void;
}) {
  const childLabel = childName || getRoleLabel("child");
  const nanaLabel = nanaName || getRoleLabel("nana");

  const challengeActive = sillyChallenge !== "idle";
  // The rule is "first to laugh LOSES". `laughWinner` stores who
  // laughed first — that's the GAME LOSER. The other person wins.
  // The previous names (`winnerName` / `loserName`) were misleading
  // — Rick: "when we click that perry laugh first, it still always
  // show that nana wins." Renamed to make the inverse relationship
  // explicit and unambiguous in the UI.
  const laughedFirstName = laughWinner === "nana" ? nanaLabel : laughWinner === "perry" ? childLabel : "";
  const roundWinnerName  = laughWinner === "nana" ? childLabel : laughWinner === "perry" ? nanaLabel : "";
  // Wish 1: the CHALLENGE game ("first to laugh loses") is unwinnable
  // when either face has a filter on — the filter is the comedy, you
  // can't help but laugh. Hide the start button while any filter is
  // active and surface a hint pill instead so the user understands
  // why the button disappeared and how to bring it back.
  const filtersActive = myFilter !== "none" || theirFilter !== "none";

  // Preload MediaPipe the moment Silly Faces opens. Without this, the
  // first sticker tap triggers a 3–5s WASM + model download that makes
  // the picker feel broken ("nothing happened for a few seconds"). Fire
  // and forget — if it fails, FaceTrackedOverlay falls back to the
  // legacy CSS overlay on a per-tile basis.
  useEffect(() => {
    void FaceTracker.getInstance();
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#000", overflow: "hidden" }}>
      {/* Two equal full-bleed tiles per Rick's Feature 4 — the filter I
          pick lands on the OTHER person's tile face, so both sides see
          what the other looks like with the swap applied. Wrapper holds
          the two FaceVideo tiles plus all challenge / reaction overlays
          as absolute siblings so they paint across both halves. */}
      {/* Tile row caps each tile at ~540px max-height and centers them in
          the available column so the wrapper never stretches both videos
          into extreme portrait columns on tall device frames. Rick: had to
          zoom out to see both faces because tiles ran the full height.
          On portrait viewports (iPhone in portrait) tiles stack vertically
          via the .nm-silly-stack class + media query below — otherwise
          side-by-side 4:3 tiles get crushed into tiny narrow rectangles. */}
      <div className="nm-silly-stack" style={{ position: "relative", flex: 1, display: "flex", gap: 12, padding: 12, background: "#000", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
        <style>{`
          @media (orientation: portrait) and (max-width: 700px) {
            .nm-silly-stack { flex-direction: column !important; }
            .nm-silly-stack > div[role="img"],
            .nm-silly-stack > * > video {
              max-width: 100% !important;
            }
          }
        `}</style>
        <FaceVideo
          person="nana"
          width="100%"
          height="100%"
          label={nanaLabel}
          showLabel
          borderRadius={16}
          // CONTAIN — shows the natural source framing without
          // cover-cropping. Face appears at its actual proportion in the
          // source (~25-35% of tile) instead of being scaled up to fill
          // tile width and creating the zoomed-face look. Dark padding
          // around the video blends with the tile background.
          objectFit="contain"
          hideQualityDot={false}
          autoMirror={isNana}
          compact={false}
          isRecording={isRecording}
          overlay={<FaceTrackedOverlay
            filterId={isNana ? theirFilter : myFilter}
            mirrored={isNana}
            paused={sillyChallenge === "counting" || sillyChallenge === "flash" || sillyChallenge === "holding"}
          />}
          // Aspect + max dims match reading-mode PiP characteristics
          // (116x96 = aspect 1.21). Reading mode's "perfect" look is
          // not about objectFit/objectPosition (those are inherited
          // already) — it's about tile size + aspect. Big landscape
          // tiles + portrait sources = aggressive crop. Squarer +
          // smaller tile = face appears at proper proportion.
          // Restored larger maxHeight now that contain is used — face
          // shows at natural proportion regardless of tile size.
          style={{ flex: "1 1 0", maxWidth: "calc(50% - 6px)", maxHeight: 420, flexShrink: 1 }}
        />
        <FaceVideo
          person="child"
          width="100%"
          height="100%"
          label={childLabel}
          showLabel
          borderRadius={16}
          hideQualityDot={false}
          autoMirror={!isNana}
          compact={false}
          isRecording={isRecording}
          overlay={<FaceTrackedOverlay
            filterId={isNana ? myFilter : theirFilter}
            mirrored={!isNana}
            paused={sillyChallenge === "counting" || sillyChallenge === "flash" || sillyChallenge === "holding"}
          />}
          // Aspect + max dims match reading-mode PiP characteristics
          // (116x96 = aspect 1.21). Reading mode's "perfect" look is
          // not about objectFit/objectPosition (those are inherited
          // already) — it's about tile size + aspect. Big landscape
          // tiles + portrait sources = aggressive crop. Squarer +
          // smaller tile = face appears at proper proportion.
          // Restored larger maxHeight now that contain is used — face
          // shows at natural proportion regardless of tile size.
          style={{ flex: "1 1 0", maxWidth: "calc(50% - 6px)", maxHeight: 420, flexShrink: 1 }}
        />

        {/* ── Challenge Overlays ── */}

        {/* Countdown */}
        {sillyChallenge === "counting" && (
          <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" }}>
            <div
              key={sillyCountNum}
              className="nm-num-pop"
              style={{ backgroundColor: "rgba(0,0,0,0.75)", borderRadius: "50%", width: "130px", height: "130px", display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #c084fc", boxShadow: "0 0 40px rgba(192,132,252,0.7)" }}
            >
              <span style={{ fontSize: "80px", fontFamily: "DM Sans, sans-serif", fontWeight: 900, color: "white", lineHeight: 1 }}>{sillyCountNum}</span>
            </div>
            <div style={{ color: "rgba(255,255,255,0.75)", fontFamily: "DM Sans, sans-serif", fontSize: "13px", marginTop: "14px", letterSpacing: "0.08em" }}>Get your silliest face ready…</div>
          </div>
        )}

        {/* Flash */}
        {sillyChallenge === "flash" && (
          <div style={{ position: "absolute", inset: 0, zIndex: 20, backgroundColor: "white", animation: "flash-fade 0.45s ease-out forwards" }} />
        )}

        {/* Holding — keep that face! */}
        {sillyChallenge === "holding" && (
          <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" }}>
            <span style={{ fontSize: "72px", display: "inline-block", animation: "pulse-sm 0.55s ease-in-out infinite" }}>😬</span>
            <div style={{ color: "white", fontFamily: "DM Sans, sans-serif", fontSize: "22px", fontWeight: 900, letterSpacing: "0.06em", marginTop: "8px", textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}>HOLD IT!</div>
            <div style={{ color: "rgba(255,255,255,0.65)", fontFamily: "DM Sans, sans-serif", fontSize: "12px", marginTop: "4px" }}>First to laugh loses 😂</div>
          </div>
        )}

        {/* Result — who laughed first? */}
        {sillyChallenge === "result" && !laughWinner && (
          <div style={{ position: "absolute", inset: 0, zIndex: 20, backgroundColor: "rgba(0,0,0,0.68)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", padding: "20px" }}>
            <span style={{ fontSize: "42px" }}>😂</span>
            <div style={{ color: "white", fontFamily: "DM Sans, sans-serif", fontSize: "15px", fontWeight: 800, textAlign: "center" }}>Who cracked up first?</div>
            <div style={{ color: "rgba(255,255,255,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", textAlign: "center", marginTop: -4 }}>
              First to laugh loses — the OTHER person wins.
            </div>
            {/* Buttons explicitly name the action ("X laughed") so
                tappers aren't surprised when "Y wins" appears next.
                Rick: "when we click that perry laugh first, it still
                always show that nana wins" — clarifying that the
                action is "declare who laughed", and the winner is
                inferred from the rule. */}
            <TileGrid columns={2} gap={10}>
              <TileButton
                icon="😂"
                label={childLabel}
                sublabel="laughed"
                tone="purple"
                size="md"
                onClick={() => onLaughedFirst("perry")}
              />
              <TileButton
                icon="😂"
                label={nanaLabel}
                sublabel="laughed"
                tone="primary"
                size="md"
                onClick={() => onLaughedFirst("nana")}
              />
            </TileGrid>
            {/* Escape hatch — Rick: "We need an exit option that lets
                the user continue to Silly Faces or proceed to the end
                countdown." Nana can break out of the result lock.
                Restyled from a faint outline to a solid amber pill —
                Rick: "The 'Skip Back to Silly Faces' button is currently
                just an outline — it would benefit from being more
                visually prominent." Matches the amber primary CTA pattern
                used by the home-screen Start Reading button. */}
            {isNana && (
              <button
                onClick={onEndChallenge}
                aria-label="Skip and return to Silly Faces"
                title="Skip — return to Silly Faces"
                style={{
                  marginTop: 8,
                  background: "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)",
                  color: NAVY,
                  border: "none",
                  borderRadius: 999,
                  padding: "12px 24px",
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: 14, fontWeight: 800,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  boxShadow: "0 8px 22px rgba(201,146,42,0.45), 0 0 0 1px rgba(247,201,93,0.35)",
                  display: "inline-flex", alignItems: "center", gap: 8,
                  touchAction: "manipulation",
                  minHeight: 48,
                }}
              >
                <span style={{ fontSize: 16 }}>🎭</span>
                Skip — back to Silly Faces
              </button>
            )}
          </div>
        )}

        {/* Winner reveal — the GAME WINNER is whoever did NOT laugh
            first. The copy is unambiguous now: big trophy + winner
            name on top, smaller "(X laughed first)" caveat below. */}
        {laughWinner && (
          <div style={{ position: "absolute", inset: 0, zIndex: 20, backgroundColor: "rgba(0,0,0,0.68)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "20px" }}>
            <span style={{ fontSize: "52px", display: "inline-block", animation: "bob 1s ease-in-out infinite" }}>🏆</span>
            <div style={{ color: "#fde68a", fontFamily: "Playfair Display, serif", fontSize: "22px", fontWeight: 800, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {roundWinnerName} wins!
            </div>
            <div style={{ color: "rgba(255,255,255,0.65)", fontFamily: "DM Sans, sans-serif", fontSize: "12px", textAlign: "center" }}>
              {laughedFirstName} cracked up first 😂
            </div>
            {/* Three paths forward — Rick: "We need an exit option that
                lets the user continue to Silly Faces or proceed to the
                end countdown — their choice." */}
            <TileGrid columns={3} gap={8}>
              <TileButton
                icon="⚡"
                label="Play"
                sublabel="Again"
                tone="purple"
                size="sm"
                onClick={onStartChallenge}
              />
              <TileButton
                icon="🎭"
                label="Silly"
                sublabel="Faces"
                tone="ghost"
                size="sm"
                onClick={onEndChallenge}
              />
              <TileButton
                icon="👋"
                label="End"
                sublabel="Countdown"
                tone="primary"
                size="sm"
                onClick={onStartGoodbye}
              />
            </TileGrid>
          </div>
        )}
        {/* Reaction burst — same overlay used in reading mode. Last
            absolute sibling so it z-stacks above the challenge overlays
            and paints across both tiles. */}
        <ReactionOverlay reaction={currentReaction ?? null} />
      </div>

      {/* Bottom strip — gaps tightened from 8 → 6 and padding pulled in so
          the row stays comfortably within the viewport on small iPads. */}
      <div style={{ backgroundColor: "#0b172e", padding: "6px 12px 8px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0 }}>
        {/* Filter label + Clear button row. The Clear pill resets MY
            pick so the OTHER person's face goes back to plain video.
            Rick: "add a button to reset or clean faces." Sits at the
            right of the label so it's obvious without crowding the
            sticker circles below. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ color: "rgba(255,255,255,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em" }}>
            🎭 YOUR FILTER
          </div>
          {myFilter !== "none" && (
            <button
              onClick={() => onSetMyFilter("none")}
              aria-label="Clear my filter"
              style={{
                background: "rgba(239,68,68,0.18)",
                border: "1px solid rgba(239,68,68,0.55)",
                color: "#fca5a5",
                borderRadius: 999,
                padding: "3px 10px",
                fontFamily: "DM Sans, sans-serif",
                fontSize: 10, fontWeight: 700,
                cursor: "pointer",
                letterSpacing: "0.04em",
                display: "inline-flex", alignItems: "center", gap: 4,
                touchAction: "manipulation",
              }}
            >
              <span>✕</span>
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* Scrollable filter circles — 50→42px so 13 filters fit on screen
            with less wasted height. Centered horizontally so the row
            doesn't look hung from the left edge on iPads wide enough to
            fit all 13 emojis with room to spare. When the row overflows
            on narrower devices, `flex-start` re-asserts and the row
            scrolls — `justifyContent: center` only takes effect when
            content actually fits. */}
        <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "2px", scrollbarWidth: "none" as const, justifyContent: "center" }}>
          {sillyFilters.map(f => {
            const sel = myFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => onSetMyFilter(f.id)}
                style={{
                  flexShrink: 0, width: "42px", height: "42px", borderRadius: "50%",
                  backgroundColor: sel ? "rgba(192,132,252,0.35)" : "rgba(255,255,255,0.08)",
                  border: `2px solid ${sel ? "#c084fc" : "rgba(255,255,255,0.16)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", transition: "all 0.15s",
                  boxShadow: sel ? "0 0 14px rgba(192,132,252,0.55)" : "none",
                }}
              >
                <span style={{ fontSize: "22px", lineHeight: 1 }}>{f.emoji}</span>
              </button>
            );
          })}
        </div>

        {/* Reactions row — label folded into a single thin row alongside
            the four tiles (instead of stacked) to save a full 14px of
            vertical height. Same four reactions as reading mode; tapping
            publishes the same `reaction` event so the burst overlay paints
            on BOTH sides over the video tile. */}
        {onReact && (
          <div role="toolbar" aria-label="Send a reaction" style={{ display: "flex", gap: "6px", alignItems: "center", justifyContent: "center" }}>
            <span style={{
              color: "rgba(255,255,255,0.45)", fontFamily: "DM Sans, sans-serif",
              fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em",
              whiteSpace: "nowrap", marginRight: 4,
            }}>💛 REACT</span>
            {([
              { key: "heart" as const,     accent: "#fbbf24" },
              { key: "star" as const,      accent: "#f59e0b" },
              { key: "clap" as const,      accent: "#fcd34d" },
              { key: "celebrate" as const, accent: "#a78bfa" },
            ]).map(({ key, accent }) => (
              <button
                key={key}
                onClick={() => onReact(key)}
                aria-label={`Send ${getReactionLabel(key)}`}
                title={`Send ${getReactionLabel(key)}`}
                style={{
                  width: 44, height: 34,
                  borderRadius: 10,
                  border: `1px solid color-mix(in srgb, ${accent} 35%, rgba(255,255,255,0.10))`,
                  backgroundImage: `linear-gradient(155deg, color-mix(in srgb, ${accent} 20%, rgba(255,255,255,0.04)) 0%, rgba(255,255,255,0.04) 70%)`,
                  backgroundColor: "rgba(255,255,255,0.04)",
                  color: "#fff",
                  fontSize: 18,
                  lineHeight: 1,
                  cursor: "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  padding: 0,
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                  transition: "transform 140ms cubic-bezier(0.22,1,0.36,1)",
                  flexShrink: 0,
                }}
                onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.92)"; }}
                onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
              >
                <span style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.35))" }}>
                  {getReactionGlyph(key)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Challenge button — idle state. Switched from a tall portrait
            tile (~120px) to a wide landscape pill (~56px) so the nav
            row below sits roughly 60px higher in the viewport. Still the
            most prominent thing in the bottom strip via gradient + glow.
            Hidden when either face has a filter on (Wish 1) and when the
            user has disabled the mini-game from Settings. */}
        {!challengeActive && challengeEnabled && !filtersActive && (
          <button
            onClick={onStartChallenge}
            style={{
              width: "100%",
              background: "linear-gradient(135deg, #c084fc 0%, #a78bfa 55%, #8b5cf6 100%)",
              color: NAVY,
              border: "none",
              borderRadius: 999,
              padding: "12px 24px",
              fontFamily: "DM Sans, sans-serif",
              fontSize: "clamp(14px, 1.7vw, 16px)",
              fontWeight: 800,
              letterSpacing: "0.04em",
              cursor: "pointer",
              boxShadow: "0 8px 22px rgba(167,139,250,0.45), 0 0 0 1px rgba(167,139,250,0.25)",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
              touchAction: "manipulation",
              minHeight: 50,
            }}
          >
            <span style={{ fontSize: 20 }}>⚡</span>
            <span>CHALLENGE!</span>
            <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, letterSpacing: "0.02em" }}>
              First to laugh loses
            </span>
          </button>
        )}

        {/* Filter-conflict hint — only when the user would otherwise see
            the CHALLENGE button. Tells them why it's missing and gives a
            one-tap "Clear my filter" out so they can play immediately. */}
        {!challengeActive && challengeEnabled && filtersActive && (
          <div
            role="status"
            style={{
              width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              minHeight: 50,
              padding: "10px 18px",
              borderRadius: 999,
              background: "rgba(192,132,252,0.10)",
              border: "1px dashed rgba(192,132,252,0.45)",
              color: "rgba(247,240,227,0.85)",
              fontFamily: "DM Sans, sans-serif",
              fontSize: "clamp(12px, 1.4vw, 14px)",
              fontWeight: 600,
              letterSpacing: "0.02em",
              flexWrap: "wrap",
            }}
          >
            <span aria-hidden style={{ fontSize: 16 }}>🎭</span>
            <span>Clear filters to play the Challenge</span>
            {myFilter !== "none" && (
              <button
                onClick={() => onSetMyFilter("none")}
                style={{
                  background: "rgba(239,68,68,0.18)",
                  border: "1px solid rgba(239,68,68,0.55)",
                  color: "#fca5a5",
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: 11, fontWeight: 700,
                  cursor: "pointer",
                  touchAction: "manipulation",
                  letterSpacing: "0.04em",
                }}
              >
                Clear my filter
              </button>
            )}
          </div>
        )}

        {/* While counting/holding (not yet result) */}
        {challengeActive && !laughWinner && sillyChallenge !== "result" && (
          <div style={{ textAlign: "center", color: "#c084fc", fontFamily: "DM Sans, sans-serif", fontSize: "12px", fontWeight: 700, animation: "pulse-sm 0.8s ease-in-out infinite" }}>
            😬 Hold that face…
          </div>
        )}

        {/* Nav row — three options: Save / Schedule / Goodbye. Rick's
            Feature 5: "Schedule Next Reading" is reachable here so if
            Nana started the wrap-up with Silly Faces, she can detour
            to scheduling without going home first. Save Session
            short-circuits the ceremony entirely; Goodbye is the
            normal "complete the session" path. */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onEndSession}
            style={{
              flex: 1,
              minHeight: 44,
              backgroundColor: "rgba(255,255,255,0.06)",
              color: CREAM,
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 999,
              padding: "10px 12px",
              fontSize: 12,
              fontFamily: "DM Sans, sans-serif", fontWeight: 700,
              cursor: "pointer", letterSpacing: "0.02em",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              touchAction: "manipulation",
            }}
          >
            <span style={{ fontSize: 14 }}>💾</span>
            Save
          </button>
          <button
            onClick={onStartParentCheck}
            style={{
              flex: 1,
              minHeight: 44,
              background: "linear-gradient(135deg, rgba(34,197,94,0.22) 0%, rgba(34,197,94,0.10) 100%)",
              color: "#86efac",
              border: "1px solid rgba(34,197,94,0.55)",
              borderRadius: 999,
              padding: "10px 12px",
              fontSize: 12,
              fontFamily: "DM Sans, sans-serif", fontWeight: 700,
              cursor: "pointer", letterSpacing: "0.02em",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              touchAction: "manipulation",
              boxShadow: "0 4px 14px rgba(34,197,94,0.18)",
            }}
          >
            <span style={{ fontSize: 14 }}>📅</span>
            Schedule
          </button>
          <button
            onClick={onStartGoodbye}
            style={{
              flex: 1.6,
              minHeight: 44,
              background: "linear-gradient(135deg, rgba(192,132,252,0.30) 0%, rgba(139,92,246,0.30) 100%)",
              color: "#e0d4ff",
              border: "1px solid rgba(192,132,252,0.65)",
              borderRadius: 999,
              padding: "10px 14px",
              fontSize: 13,
              fontFamily: "DM Sans, sans-serif", fontWeight: 800,
              cursor: "pointer", letterSpacing: "0.02em",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              touchAction: "manipulation",
              boxShadow: "0 4px 14px rgba(167,139,250,0.22)",
            }}
          >
            <span style={{ fontSize: 14 }}>👋</span>
            Goodbye →
          </button>
        </div>
        {/* NEED 1 — explicit Home pill so the small NavStrip icon at the
            top of the chrome isn't the only Home affordance. */}
        {isNana && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
            <ProminentHomePill onClick={onGoHome} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Drum-roll picker column (transform-based; no native scroll) ─── */

function DrumColumn({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  const ROW = 28;
  const CONTAINER_H = 120;
  const idx = Math.max(0, items.indexOf(value));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wheelAccumRef = useRef(0);
  const wheelTimerRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ y: number; idx: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      wheelAccumRef.current += e.deltaY;
      const STEP_PX = 24;
      const steps = Math.trunc(wheelAccumRef.current / STEP_PX);
      if (steps !== 0) {
        wheelAccumRef.current -= steps * STEP_PX;
        const next = Math.max(0, Math.min(items.length - 1, idx + steps));
        if (next !== idx) onChange(items[next]);
      }
      if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = window.setTimeout(() => { wheelAccumRef.current = 0; }, 200);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current);
    };
  }, [idx, items, onChange]);

  const onTouchStart = (e: React.TouchEvent) => {
    dragStartRef.current = { y: e.touches[0].clientY, idx };
    setIsDragging(true);
    setDragOffset(0);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = dragStartRef.current;
    if (!s) return;
    e.preventDefault();
    setDragOffset(e.touches[0].clientY - s.y);
  };
  const onTouchEnd = () => {
    const s = dragStartRef.current;
    if (!s) return;
    const stepCount = Math.round(-dragOffset / ROW);
    const next = Math.max(0, Math.min(items.length - 1, s.idx + stepCount));
    onChange(items[next]);
    dragStartRef.current = null;
    setIsDragging(false);
    setDragOffset(0);
  };

  const baseY = CONTAINER_H / 2 - ROW / 2 - idx * ROW;
  const translateY = baseY + dragOffset;

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{ flex: 1, position: "relative", overflow: "hidden", borderRadius: "8px", backgroundColor: "rgba(255,255,255,0.04)", touchAction: "none", userSelect: "none", cursor: "ns-resize" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "40px", background: "linear-gradient(to bottom, rgba(11,23,46,0.9), transparent)", pointerEvents: "none", zIndex: 3 }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40px", background: "linear-gradient(to top, rgba(11,23,46,0.9), transparent)", pointerEvents: "none", zIndex: 3 }} />
      <button
        type="button"
        onClick={() => idx > 0 && onChange(items[idx - 1])}
        disabled={idx === 0}
        aria-label="Up"
        style={{ position: "absolute", top: 2, left: 0, right: 0, height: "14px", background: "transparent", border: "none", color: idx === 0 ? "rgba(247,240,227,0.15)" : "rgba(247,240,227,0.55)", cursor: idx === 0 ? "default" : "pointer", zIndex: 4, fontSize: "10px", padding: 0, lineHeight: 1 }}
      >▲</button>
      <button
        type="button"
        onClick={() => idx < items.length - 1 && onChange(items[idx + 1])}
        disabled={idx === items.length - 1}
        aria-label="Down"
        style={{ position: "absolute", bottom: 2, left: 0, right: 0, height: "14px", background: "transparent", border: "none", color: idx === items.length - 1 ? "rgba(247,240,227,0.15)" : "rgba(247,240,227,0.55)", cursor: idx === items.length - 1 ? "default" : "pointer", zIndex: 4, fontSize: "10px", padding: 0, lineHeight: 1 }}
      >▼</button>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${translateY}px)`, transition: isDragging ? "none" : "transform 0.18s ease-out", willChange: "transform" }}>
        {items.map(item => (
          <div key={item} style={{ height: `${ROW}px`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "DM Sans, sans-serif", fontSize: item === value ? "15px" : "12px", fontWeight: item === value ? 800 : 400, color: item === value ? AMBER : "rgba(247,240,227,0.5)" }}>{item}</div>
        ))}
      </div>
    </div>
  );
}

/* ─── Recording Consent Overlay ─────────────────────────── */

function ParentCheckView({
  isNana,
  onStartSillyFaces,
  onStartGoodbye,
  proposal,
  myAccepted,
  otherAccepted,
  onPropose,
  onAccept,
  onResetProposal,
  onGoHome,
  childName,
  nanaName,
  partnerRequestedReschedule,
}: {
  isNana: boolean;
  onStartSillyFaces: () => void;
  /** Rick's Feature 5: lets Nana skip Silly Faces and go straight to
   *  the Goodbye countdown after scheduling. Useful when she already
   *  did Silly Faces earlier in the wrap-up flow, or when the session
   *  just needs to end without the laughing-game beat. */
  onStartGoodbye: () => void;
  proposal: ScheduleProposal | null;
  myAccepted: boolean;
  otherAccepted: boolean;
  onPropose: (date: Date, time: string) => void;
  onAccept: () => void;
  /** Reset the booking back to the picker. Surfaced in all three
   *  confirmed states (waiting / incoming / all-booked) so either
   *  side can change the time after proposing or accepting. */
  onResetProposal: () => void;
  onGoHome?: () => void;
  childName: string;
  nanaName: string;
  /** Names the role that just wiped the proposal — surfaced as a
   *  transient banner so the OTHER side knows their partner asked
   *  for a different time (rather than the picker silently snapping
   *  back). Cleared automatically by the parent after a few seconds. */
  partnerRequestedReschedule?: "nana" | "perry" | null;
}) {
  const [pickedDate, setPickedDate] = useState<Date | null>(null);
  const [calMonth, setCalMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selHour, setSelHour] = useState<string>("7");
  const [selMin, setSelMin] = useState<string>("00");
  const [selAmPm, setSelAmPm] = useState<string>("PM");
  const pickedTime = `${selHour}:${selMin} ${selAmPm}`;

  const childLabel = childName || getRoleLabel("child");
  const nanaLabel = nanaName || getRoleLabel("nana");
  const bigName = isNana ? childLabel : nanaLabel;
  const selfName = isNana ? nanaLabel : childLabel;
  const otherName = isNana ? `${childLabel}'s family` : nanaLabel;

  const DAY_NAMES   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const FULL_DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const nanaOffset = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() ?? '';

  const canPropose = pickedDate !== null && !proposal;
  const proposeLabel = canPropose ? "Propose This Time →" : "Pick a day first";

  const formatDate = (d: Date, t: string, convertToLocal = false) => {
    if (convertToLocal) {
      const combined = combineDateAndTime(d, t);
      const localTime = combined.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true
      });
      const localTZ = combined.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() ?? '';
      const localDay = FULL_DAYS[combined.getDay()];
      const localMonth = MONTH_NAMES[combined.getMonth()];
      const localDate = combined.getDate();
      return `${localDay}, ${localMonth} ${localDate} at ${localTime} ${localTZ}`;
    }
    return `${FULL_DAYS[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()} at ${t}`;
  };

  const bothConfirmed = myAccepted && otherAccepted;

  // ── Determine which panel to show ──
  // 1. No proposal yet → show picker
  // 2. Proposal exists, I haven't accepted → I'm the receiver → show incoming proposal
  // 3. Proposal exists, I proposed (myAccepted=true) but other hasn't → waiting
  // 4. Both accepted → all booked
  const showPicker   = !proposal;
  const showIncoming = !!proposal && !myAccepted;
  const showWaiting  = !!proposal && myAccepted && !otherAccepted;
  const proposerName = proposal?.proposedBy === "nana" ? nanaLabel : `${childLabel}'s family`;

  // Shared style constants for the Quick Check-In view. Rick
  // (recurring, 4th round): "buttons in the Quick Check-In are
  // inconsistent — different sizes with irregular spacing." Previous
  // rounds tried to communicate hierarchy via size (primary 44px,
  // secondary 36px) AND color, which read as "different sizes" — the
  // size mismatch was louder than the color signal. This round:
  // EVERY inline panel button is dimensionally identical (same
  // padding, font, height, full-panel-width stretch). Hierarchy is
  // signalled by background/color only.
  //
  // The PANEL_BTN base is shared by both PRIMARY_BTN and
  // SECONDARY_BTN below — they spread it and override ONLY the
  // surface colors. Footer-tier CTAs (Propose / Silly Faces /
  // Goodbye) remain distinct via the larger FOOTER_CTA tier, which
  // is the only intentional size difference in the view.
  const PANEL_PAD = "16px";
  const PANEL_GAP = 12;
  // Panel pills now share the SAME height (56) and font (clamp 14-16)
  // as the footer CTAs below — Rick (4th round): "buttons that are
  // different sizes and unevenly spaced. Should be uniform size and
  // consistent spacing throughout." Previously panel pills were 48
  // and footer pills were 56, which gave two button heights for what
  // are functionally peer buttons (just in different positions on
  // the screen). Now ALL pills on this page share one height; only
  // the calendar tiles remain a distinct visual class (square 96×96)
  // because they represent external integrations, not in-flow
  // actions.
  const PANEL_BTN_BASE: React.CSSProperties = {
    borderRadius: 999,
    padding: "14px 24px",
    fontFamily: "DM Sans, sans-serif",
    fontSize: "clamp(14px, 1.7vw, 16px)",
    fontWeight: 800,
    letterSpacing: "0.04em",
    cursor: "pointer",
    minHeight: 56,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    touchAction: "manipulation",
    alignSelf: "stretch",
  };
  const PRIMARY_BTN: React.CSSProperties = {
    ...PANEL_BTN_BASE,
    backgroundColor: AMBER,
    color: NAVY,
    border: "none",
    boxShadow: "0 3px 16px rgba(201,146,42,0.45)",
  };
  const SECONDARY_BTN: React.CSSProperties = {
    ...PANEL_BTN_BASE,
    background: "transparent",
    border: "1px solid rgba(247,201,93,0.45)",
    color: AMBER,
  };
  // Footer-tier CTAs — Propose / Silly Faces / Goodbye sit side-by-side
  // and must read as equal peers in size. They differ ONLY in
  // background/border (visual tier) and animation; padding, font, height,
  // and minWidth are identical across all three so a row of three feels
  // deliberate instead of a stack of mismatched chips.
  const FOOTER_CTA: React.CSSProperties = {
    borderRadius: 999,
    padding: "14px 24px",
    fontFamily: "DM Sans, sans-serif",
    fontSize: "clamp(14px, 1.7vw, 16px)",
    fontWeight: 800,
    letterSpacing: "0.04em",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    touchAction: "manipulation",
    minHeight: 56,
    minWidth: 200,
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#000", overflow: "hidden" }}>
      <style>{`
        @keyframes pcv-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pcv-twinkle { 0%,100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.1); } }
        @keyframes pcv-pulse-ring { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(1.8); opacity: 0; } }
        /* Soft pulsing glow on the Silly Faces CTA so the eye lands on it.
           Local copy (NanaHomeView also defines an identical keyframe,
           but that style block isn't mounted when Perry lands here
           directly from a fresh app load). */
        @keyframes pcv-cta-glow {
          0%,100% { box-shadow: 0 12px 32px rgba(167,139,250,0.55), 0 0 0 0 rgba(167,139,250,0.45); }
          50%     { box-shadow: 0 14px 38px rgba(167,139,250,0.65), 0 0 0 16px rgba(167,139,250,0); }
        }
        /* Amber sibling for the Propose This Time button so it gets the
           same eye-grabbing pulse but in the warm/scheduling palette
           rather than the silly-faces purple. */
        @keyframes pcv-cta-glow-amber {
          0%,100% { box-shadow: 0 12px 32px rgba(201,146,42,0.55), 0 0 0 0 rgba(247,201,93,0.45); }
          50%     { box-shadow: 0 14px 38px rgba(201,146,42,0.65), 0 0 0 16px rgba(247,201,93,0); }
        }
      `}</style>

      {/* Mode badge — the right side previously held a duplicate Home
          pill; that's now provided by the global NavStrip in
          DeviceFrame's top chrome, so this strip just shows the badge
          and saves vertical space for the panels below. */}
      <div style={{
        flexShrink: 0,
        padding: "10px 14px 8px",
        display: "flex", alignItems: "center", justifyContent: "flex-start",
        gap: 10,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        backgroundColor: "rgba(11,23,46,0.55)",
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 10px", borderRadius: 999,
          backgroundColor: "rgba(34,197,94,0.10)",
          border: "1px solid rgba(34,197,94,0.55)",
          color: "#86efac",
          fontFamily: "DM Sans, sans-serif", fontSize: 10, fontWeight: 800,
          letterSpacing: "0.16em",
        }}>
          💬 QUICK CHECK-IN
        </div>
      </div>

      {/* Scrollable scheduler panel — full height now that the video
          stage is gone. Inner column is capped at 560px and centered
          so the booked / waiting / incoming panels and the calendar
          picker don't stretch edge-to-edge on Nana's wide iPad and
          leave the content feeling sparse. On Perry's mini the
          container is already narrower so the cap is a no-op. */}
      <div style={{
        flex: 1, overflowY: "auto",
        backgroundColor: "#0b172e",
        backgroundImage: "radial-gradient(680px 360px at 80% -10%, rgba(34,197,94,0.16), transparent 70%), radial-gradient(560px 360px at -10% 110%, rgba(201,146,42,0.14), transparent 70%)",
        padding: "12px 14px 16px",
        display: "flex", flexDirection: "column", alignItems: "center",
      }}>
      <div style={{
        width: "100%", maxWidth: 560,
        display: "flex", flexDirection: "column", gap: 10,
      }}>

        {/* Hello card — gradient + sparkle + animated icon */}
        <div style={{
          position: "relative",
          backgroundImage: "linear-gradient(135deg, rgba(34,197,94,0.16) 0%, rgba(34,197,94,0.06) 100%)",
          border: "1px solid rgba(34,197,94,0.45)",
          borderRadius: 14, padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
          animation: "pcv-rise 0.4s both",
          overflow: "hidden",
        }}>
          <span style={{ position: "absolute", top: -3, right: 12, fontSize: 11, animation: "pcv-twinkle 2.4s ease-in-out infinite" }}>✨</span>
          <span style={{ position: "absolute", bottom: -3, right: 30, fontSize: 9, animation: "pcv-twinkle 2.4s 0.7s ease-in-out infinite" }}>⭐</span>
          <div style={{ position: "relative", flexShrink: 0, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(34,197,94,0.55)", animation: "pcv-pulse-ring 2.2s ease-out infinite" }} />
            <span style={{ fontSize: 24, position: "relative", zIndex: 1 }}>💬</span>
          </div>
          {/* Warm, kid-direct phrasing for Perry — Rick: "'Do you want
              your parents to say hi?' isn't quite right for a 6–7 year
              old. Something warmer and more direct would work better."
              Also fixed the hardcoded names so it uses the actual nana /
              child display names instead of literal "Perry" / "Nana". */}
          <span style={{ color: "#dcfce7", fontFamily: "DM Sans, sans-serif", fontSize: "clamp(13px, 1.7vw, 15px)", fontWeight: 700, lineHeight: 1.4, flex: 1, position: "relative", zIndex: 1 }}>
            {isNana
              ? `Want to catch up with ${childLabel}'s family for a minute?`
              : `Go grab Mom or Dad — ${nanaLabel} wants to catch up with them!`}
          </span>
        </div>

        {/* Section divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginTop: 2 }}>
          <div style={{ flex: 1, height: 1, background: "linear-gradient(to right, transparent, rgba(201,146,42,0.4))" }} />
          <span style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", whiteSpace: "nowrap" }}>📅 BOOK NEXT READING</span>
          <div style={{ flex: 1, height: 1, background: "linear-gradient(to left, transparent, rgba(201,146,42,0.4))" }} />
        </div>

        {/* Partner-requested-reschedule banner — surfaces when the OTHER
            side wiped a proposal (own resets pass through without showing
            this). Rick: "when nana propose times, and parents asks to
            rechange it, it does not proper signal to nana that parent
            is asking to change time." Without this, the proposal just
            silently disappears and the picker snaps back, leaving the
            proposer wondering whether the partner ever saw it. */}
        {partnerRequestedReschedule && (
          (isNana && partnerRequestedReschedule === "perry") ||
          (!isNana && partnerRequestedReschedule === "nana")
        ) && (
          <div
            role="status"
            aria-live="polite"
            style={{
              backgroundImage: "linear-gradient(135deg, rgba(247,201,93,0.18) 0%, rgba(247,201,93,0.06) 100%)",
              border: `1px solid ${AMBER}`,
              borderRadius: 12,
              padding: "11px 14px",
              display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
              animation: "pcv-rise 0.35s both",
            }}
          >
            <span style={{ fontSize: 22 }}>🔁</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
              <span style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: "0.02em" }}>
                {isNana
                  ? `${childLabel}'s family asked for a different time`
                  : `${nanaLabel} asked for a different time`}
              </span>
              <span style={{ color: "rgba(247,240,227,0.7)", fontFamily: "DM Sans, sans-serif", fontSize: 12, lineHeight: 1.4 }}>
                {isNana ? "Pick another day and time to propose." : "Hang tight — Nana will suggest a new time."}
              </span>
            </div>
          </div>
        )}

        {/* ── PANEL: Both confirmed ── */}
        {bothConfirmed && proposal && (
          <div style={{ backgroundColor: "rgba(201,146,42,0.10)", border: `1px solid ${AMBER}`, borderRadius: "12px", padding: PANEL_PAD, display: "flex", flexDirection: "column", gap: PANEL_GAP, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "22px" }}>✅</span>
              <span style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: "18px", fontWeight: 700 }}>All booked!</span>
            </div>
            <p style={{ color: CREAM, fontFamily: "Merriweather, serif", fontSize: "18px", fontWeight: 700, lineHeight: 1.45, margin: 0 }}>
              {formatDate(proposal.date, proposal.time)} <span style={{ fontSize: "14px", fontWeight: 400, opacity: 0.6 }}>({nanaOffset})</span>
            </p>
            {!isNana && (
              <div style={{ color: "rgba(247,240,227,0.7)", fontFamily: "DM Sans, sans-serif", fontSize: "14px", marginTop: "4px" }}>
                {formatDate(proposal.date, proposal.time, true)}
              </div>
            )}
            <p style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: "13px", lineHeight: 1.5, margin: 0 }}>
              📱 ✉️ Text &amp; email reminders will be sent to Nana and the family before the session.
            </p>
            {(() => {
              const scheduledDate = combineDateAndTime(proposal.date, proposal.time);
              return (
                <div style={{ marginTop: "10px" }}>
                  <div style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", letterSpacing: "0.08em", textAlign: "center", marginBottom: "10px", fontWeight: 700 }}>
                    {isNana ? "ADD TO CALENDAR" : "SEND TO A PARENT — ADD TO THEIR CALENDAR"}
                  </div>
                  {/* All four calendar destinations now use the SAME
                      structural element — bare TileButton with an
                      onClick. Previously Google and Outlook were
                      wrapped in <a href> tags while Apple and Copy
                      were bare buttons; iOS Safari treats anchor
                      taps differently (focus ring, tap-highlight,
                      link cursor) and the visual mismatch was
                      visible. Rick (repeated): "Google Calendar and
                      Apple Calendar buttons in the scheduler are
                      not consistent with each other." Using window.open
                      from the onClick is safe here because the
                      handler runs synchronously inside a user-gesture
                      event (popup-blocker doesn't fire). Tile size,
                      tone, and onClick wiring are now structurally
                      identical across all four. */}
                  <TileGrid columns={4} gap={8} maxWidth={440}>
                    <TileButton
                      icon="📅"
                      label="Google"
                      tone="secondary"
                      size="md"
                      style={{ width: "100%" }}
                      onClick={() => window.open(formatForGoogle(scheduledDate), "_blank", "noopener,noreferrer")}
                    />
                    <TileButton
                      icon="📅"
                      label="Apple"
                      tone="secondary"
                      size="md"
                      style={{ width: "100%" }}
                      onClick={() => downloadICS(scheduledDate)}
                    />
                    <TileButton
                      icon="📅"
                      label="Outlook"
                      tone="secondary"
                      size="md"
                      style={{ width: "100%" }}
                      onClick={() => window.open(formatForOutlook(scheduledDate), "_blank", "noopener,noreferrer")}
                    />
                    <TileButton
                      icon="📋"
                      label="Copy"
                      tone="secondary"
                      size="md"
                      style={{ width: "100%" }}
                      onClick={() => {
                        const tz = scheduledDate.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() ?? '';
                        const msg = `NeverMiss Reading Session: ${scheduledDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${scheduledDate.toLocaleTimeString([], {hour: "2-digit", minute:"2-digit"})} ${tz}. Open NeverMiss to join! nevermiss.family`;
                        navigator.clipboard.writeText(msg);
                      }}
                    />
                  </TileGrid>
                </div>
              );
            })()}
            {/* Change-time escape hatch. Rick: "whenever we select a parent
                check-in time we can't modify or edit it." Reachable from
                every confirmed state — wiping the proposal on both
                iPads via `schedule_reset` returns the picker. */}
            <button onClick={onResetProposal} style={SECONDARY_BTN}>
              <span aria-hidden>✏️</span>
              Change time
            </button>
          </div>
        )}

        {/* ── PANEL: Incoming proposal (other side proposed, I haven't accepted) ──
            Rick: "the proposed time display in particular could use a bump."
            Eyebrow 10→12px, date itself 14→20px (now reads at arm's length
            on an iPad without leaning in). */}
        {showIncoming && proposal && (
          <div style={{ backgroundColor: "rgba(201,146,42,0.08)", border: `1px solid ${AMBER}`, borderRadius: "12px", padding: PANEL_PAD, display: "flex", flexDirection: "column", gap: PANEL_GAP, flexShrink: 0 }}>
            <div style={{ color: "rgba(247,240,227,0.7)", fontFamily: "DM Sans, sans-serif", fontSize: "12px", fontWeight: 700, letterSpacing: "0.05em" }}>
              {proposerName} wants to book:
            </div>
            <p style={{ color: CREAM, fontFamily: "Merriweather, serif", fontSize: "clamp(18px, 2.4vw, 22px)", fontWeight: 700, lineHeight: 1.35, margin: 0 }}>
              {formatDate(proposal.date, proposal.time, !isNana)}
            </p>
            <button onClick={onAccept} style={PRIMARY_BTN}>
              ✓ Accept This Time
            </button>
            <button onClick={onResetProposal} style={SECONDARY_BTN}>
              <span aria-hidden>✏️</span>
              Suggest different time
            </button>
          </div>
        )}

        {/* ── PANEL: Waiting for other to accept (I proposed) ──
            Same font bump as the incoming-proposal panel above. */}
        {showWaiting && proposal && (
          <div style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px", padding: PANEL_PAD, display: "flex", flexDirection: "column", gap: PANEL_GAP, flexShrink: 0 }}>
            <div style={{ color: "rgba(247,240,227,0.6)", fontFamily: "DM Sans, sans-serif", fontSize: "12px", fontWeight: 700, letterSpacing: "0.05em" }}>
              You proposed:
            </div>
            <p style={{ color: CREAM, fontFamily: "Merriweather, serif", fontSize: "clamp(18px, 2.4vw, 22px)", fontWeight: 700, lineHeight: 1.35, margin: 0 }}>
              {formatDate(proposal.date, proposal.time, !isNana)}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
              <span style={{ fontSize: "16px", animation: "pulse-sm 1.6s ease-in-out infinite" }}>⏳</span>
              <span style={{ color: "rgba(247,240,227,0.55)", fontFamily: "DM Sans, sans-serif", fontSize: "13px" }}>
                Waiting for {otherName} to confirm…
              </span>
            </div>
            <button onClick={onResetProposal} style={SECONDARY_BTN}>
              <span aria-hidden>✏️</span>
              Change time
            </button>
          </div>
        )}

        {/* ── PANEL: Perry waiting (no proposal yet, child side) ── */}
        {showPicker && !isNana && (
          <div style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px", padding: PANEL_PAD, display: "flex", flexDirection: "column", alignItems: "center", gap: PANEL_GAP, flexShrink: 0, textAlign: "center" }}>
            <span style={{ fontSize: "26px" }}>⏳</span>
            <span style={{ color: "rgba(247,240,227,0.65)", fontFamily: "DM Sans, sans-serif", fontSize: "13px", fontWeight: 600, lineHeight: 1.5 }}>
              Waiting for Nana to suggest a time…
            </span>
            <span style={{ color: "rgba(247,240,227,0.35)", fontFamily: "DM Sans, sans-serif", fontSize: "10px" }}>
              She'll pick a day and time for your next reading.
            </span>
          </div>
        )}

        {/* ── PANEL: Date/time picker (no proposal yet, Nana side) ── */}
        {showPicker && isNana && (
          <>
            {/* Side-by-side: calendar (left) + 3-column drum-roll time picker (right) */}
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", flexShrink: 0 }}>

              {/* LEFT — Compact calendar.
                  Pinned to a fixed inner width (7 × 32px = 224px grid) so
                  the day buttons stay tight circles regardless of the
                  outer panel width. Previously the column was `width:55%`
                  + `repeat(7, 1fr)`, which after the device-frame
                  max-width bump (840→1180) stretched the buttons into wide
                  ovals with big gaps. Rick: "the calendar buttons seem to
                  be spreading apart — could we tighten those back up?" */}
              <div style={{ flex: "0 0 auto", width: 240, minWidth: 0 }}>
                <div style={{ color: "rgba(255,255,255,0.38)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "6px" }}>PICK A DAY</div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: 224, margin: "0 auto 8px" }}>
                  {/* Month-nav chevrons bumped from 2x6 padding (~10px
                      tall) to a proper 32x32 circular touch target so a
                      finger can land on them reliably. */}
                  <button
                    aria-label="Previous month"
                    onClick={() => setCalMonth(m => { const d = new Date(m); d.setMonth(d.getMonth() - 1); return d; })}
                    style={{
                      width: 32, height: 32, borderRadius: "50%",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      color: AMBER, fontSize: 14, cursor: "pointer",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      padding: 0, touchAction: "manipulation",
                    }}
                  >◀</button>
                  <span style={{ color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: "13px", fontWeight: 700 }}>
                    {MONTH_NAMES[calMonth.getMonth()]} {calMonth.getFullYear()}
                  </span>
                  <button
                    aria-label="Next month"
                    onClick={() => setCalMonth(m => { const d = new Date(m); d.setMonth(d.getMonth() + 1); return d; })}
                    style={{
                      width: 32, height: 32, borderRadius: "50%",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      color: AMBER, fontSize: 14, cursor: "pointer",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      padding: 0, touchAction: "manipulation",
                    }}
                  >▶</button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 32px)", gap: "0px", marginBottom: "2px", width: "fit-content", margin: "0 auto 2px" }}>
                  {["S","M","T","W","T","F","S"].map((d, i) => (
                    <div key={i} style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontFamily: "DM Sans, sans-serif", fontSize: "10px", fontWeight: 700, padding: "1px 0" }}>{d}</div>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 32px)", gap: "0px", width: "fit-content", margin: "0 auto" }}>
                  {(() => {
                    const today = new Date(); today.setHours(0,0,0,0);
                    const firstDay = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
                    const lastDay  = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0);
                    const cells: React.ReactNode[] = [];
                    for (let i = 0; i < firstDay.getDay(); i++) cells.push(<div key={`p${i}`} />);
                    for (let d = 1; d <= lastDay.getDate(); d++) {
                      const date = new Date(calMonth.getFullYear(), calMonth.getMonth(), d);
                      const isPast  = date < today;
                      const isToday = date.toDateString() === today.toDateString();
                      const isSel   = pickedDate?.toDateString() === date.toDateString();
                      cells.push(
                        <button key={d} onClick={() => !isPast && setPickedDate(date)} disabled={isPast}
                          style={{
                            height: "32px", width: "32px", border: "none",
                            borderRadius: "50%",
                            backgroundColor: isSel ? AMBER : "transparent",
                            outline: isToday && !isSel ? `1px solid ${AMBER}` : "none",
                            color: isPast ? "rgba(255,255,255,0.15)" : isSel ? NAVY : CREAM,
                            fontFamily: "DM Sans, sans-serif", fontSize: "13px",
                            fontWeight: isSel || isToday ? 800 : 400,
                            cursor: isPast ? "default" : "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            padding: 0,
                          }}
                        >{d}</button>
                      );
                    }
                    return cells;
                  })()}
                </div>
              </div>

              {/* RIGHT — Three-column drum-roll time picker */}
              <div style={{ flexShrink: 0, width: "130px" }}>
                <div style={{ color: "rgba(255,255,255,0.38)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "6px" }}>PICK A TIME</div>
                <div style={{ color: "rgba(247,240,227,0.65)", fontFamily: "DM Sans, sans-serif", fontSize: "12px", letterSpacing: "0.04em", marginBottom: "4px", textAlign: "center" }}>{nanaOffset}</div>

                <div style={{ display: "flex", gap: "2px", marginBottom: "2px" }}>
                  {["HR","MIN","AM/PM"].map(l => (
                    <div key={l} style={{ flex: 1, textAlign: "center", color: "rgba(255,255,255,0.3)", fontFamily: "DM Sans, sans-serif", fontSize: "10px", fontWeight: 700 }}>{l}</div>
                  ))}
                </div>

                <div style={{ position: "relative", height: "120px", display: "flex", gap: "2px" }}>
                  <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: "28px", transform: "translateY(-50%)", backgroundColor: "rgba(201,146,42,0.15)", borderTop: "1px solid rgba(201,146,42,0.4)", borderBottom: "1px solid rgba(201,146,42,0.4)", pointerEvents: "none", zIndex: 2, borderRadius: "6px" }} />
                  <DrumColumn items={["12","1","2","3","4","5","6","7","8","9","10","11"]} value={selHour} onChange={setSelHour} />
                  <DrumColumn items={["00","15","30","45"]} value={selMin} onChange={setSelMin} />
                  <DrumColumn items={["AM","PM"]} value={selAmPm} onChange={setSelAmPm} />
                </div>
              </div>
            </div>

            {/* Propose button used to live here, inside the scrolling
                scheduler. Rick: "After Nana picks a time and goes to hit
                Propose Time, the button isn't visible — it appears to
                slide below the iPad frame." Moved to the fixed footer
                below alongside Silly Faces so both CTAs stay pinned. */}
          </>
        )}

      </div>
      </div>

      {/* Pinned CTA footer — Propose Time (when Nana is mid-pick) sits
          beside Let's Do Silly Faces. Rick: "Could we make [Propose Time]
          a fixed button similar to the Silly Faces button and keep them
          side by side? Maybe make Propose Time a bit more prominent."
          Both buttons share the same visual weight (size, shadow, glow)
          so neither feels secondary; they wrap to a new row on very
          narrow screens via flex-wrap. */}
      <div style={{
        flexShrink: 0,
        padding: "12px 16px 14px",
        display: "flex", gap: PANEL_GAP, justifyContent: "center", flexWrap: "wrap",
        background: "linear-gradient(180deg, transparent 0%, rgba(11,23,46,0.95) 35%, rgba(11,23,46,1) 100%)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}>
        {/* Propose This Time — visible only when Nana is in the picker
            state. All three footer buttons share FOOTER_CTA base
            (padding, font, height, minWidth) so they sit as visually
            equal peers; only the background tier differs. The animated
            glow keeps Propose visually primary without being a different
            size. */}
        {showPicker && isNana && (
          <button
            onClick={() => canPropose && onPropose(pickedDate!, pickedTime)}
            disabled={!canPropose}
            style={{
              ...FOOTER_CTA,
              background: canPropose
                ? "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)"
                : "rgba(255,255,255,0.06)",
              color: canPropose ? NAVY : "rgba(255,255,255,0.35)",
              border: canPropose ? "none" : "1px solid rgba(255,255,255,0.12)",
              cursor: canPropose ? "pointer" : "not-allowed",
              boxShadow: canPropose
                ? "0 12px 32px rgba(201,146,42,0.55), 0 0 0 1px rgba(247,201,93,0.30)"
                : "none",
              animation: canPropose ? "pcv-cta-glow-amber 2.4s ease-in-out infinite" : undefined,
              opacity: canPropose ? 1 : 0.7,
            }}
          >
            <span style={{ fontSize: 20 }}>📅</span>
            {proposeLabel}
          </button>
        )}
        <button
          onClick={onStartSillyFaces}
          style={{
            ...FOOTER_CTA,
            background: "linear-gradient(135deg, #c084fc 0%, #a78bfa 55%, #8b5cf6 100%)",
            color: NAVY,
            border: "none",
            boxShadow: "0 12px 32px rgba(167,139,250,0.55), 0 0 0 1px rgba(167,139,250,0.25)",
            animation: "pcv-cta-glow 2.4s ease-in-out infinite",
          }}
        >
          <span style={{ fontSize: 20 }}>🎭</span>
          Silly Faces →
        </button>
        {/* Goodbye Countdown — Rick's Feature 5: skip Silly Faces and
            go straight to Goodbye if Nana already did the laughing
            game earlier in the wrap-up, or just wants to end now. */}
        <button
          onClick={onStartGoodbye}
          style={{
            ...FOOTER_CTA,
            background: "rgba(255,255,255,0.06)",
            color: CREAM,
            border: "1px solid rgba(255,255,255,0.20)",
          }}
        >
          <span style={{ fontSize: 20 }}>👋</span>
          Goodbye →
        </button>
      </div>
    </div>
  );
}

/* ─── Recording Consent Overlay ──────────────────────────── */

function RecordingConsentOverlay({
  isNana, recordingOn, onToggleRecording, onDismiss,
}: { isNana: boolean; recordingOn: boolean; onToggleRecording: () => void; onDismiss: () => void; }) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 50, backgroundColor: "rgba(11,23,46,0.88)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ backgroundColor: "#0d1e38", border: "1px solid rgba(201,146,42,0.35)", borderRadius: "16px", padding: "22px 18px", width: "100%", textAlign: "center" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          backgroundColor: "rgba(201,146,42,0.15)",
          border: "1px solid rgba(201,146,42,0.45)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: AMBER, marginBottom: 10,
        }} aria-hidden>
          <VideoIcon size={26} strokeWidth={1.8} />
        </div>
        <div style={{ color: "#C9922A", fontFamily: "Playfair Display, serif", fontSize: "14px", fontWeight: 700, marginBottom: "6px" }}>Memory Vault Recording</div>
        <div style={{ color: "rgba(247,240,227,0.65)", fontFamily: "DM Sans, sans-serif", fontSize: "10px", lineHeight: 1.55, marginBottom: "16px" }}>
          This session can be recorded and saved for future generations to watch.
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: "10px", padding: "10px 12px", marginBottom: "14px" }}>
          <div style={{ textAlign: "left" }}>
            <div style={{ color: "#F7F0E3", fontFamily: "DM Sans, sans-serif", fontSize: "11px", fontWeight: 700 }}>Record this session</div>
            <div style={{ color: "rgba(247,240,227,0.4)", fontFamily: "DM Sans, sans-serif", fontSize: "9px", marginTop: "2px" }}>
              {isNana ? "Nana's consent" : "Parent's consent"}
            </div>
          </div>
          <div
            onClick={onToggleRecording}
            style={{ width: "38px", height: "21px", borderRadius: "11px", backgroundColor: recordingOn ? "#C9922A" : "rgba(255,255,255,0.14)", position: "relative", cursor: "pointer", transition: "background-color 0.2s", flexShrink: 0 }}
          >
            <div style={{ position: "absolute", top: "2.5px", left: recordingOn ? "19px" : "2.5px", width: "16px", height: "16px", borderRadius: "50%", backgroundColor: "white", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }} />
          </div>
        </div>
        <button
          onClick={onDismiss}
          style={{ width: "100%", backgroundColor: "#C9922A", color: "#1B2B4B", border: "none", borderRadius: "24px", padding: "10px", fontSize: "12px", fontFamily: "DM Sans, sans-serif", fontWeight: 700, cursor: "pointer" }}
        >
          Got it — Start Session →
        </button>
      </div>
    </div>
  );
}

/* ─── Device Frame ───────────────────────────────────────── */

function DeviceFrame({
  label,
  isNana,
  displayPage,
  flipping,
  flipFromPage,
  flipToPage,
  flipDirection,
  mode,
  promptIndex,
  childPromptIndex,
  showAndTellPromptIndex,
  myFilter,
  theirFilter,
  onSetMyFilter,
  sillyChallenge,
  sillyCountNum,
  onStartChallenge,
  laughWinner,
  onLaughedFirst,
  onEndChallenge,
  sillyChallengeEnabled,
  onToggleSillyChallenge,
  openWith,
  onOpenWithChange,
  onStartChat,
  onStartReading,
  onGreetingReady,
  onGreetingShowPrompts,
  onNextPrompt,
  onNextChildPrompt,
  onStartShowAndTell,
  onNextShowAndTellPrompt,
  onBackToReading,
  onStartParentCheck,
  onStartSillyFaces,
  onBackFromSillyFaces,
  goodbyePhase,
  goodbyeStartTime,
  onStartGoodbye,
  onBeginGoodbyeCountdown,
  onSkipToGoodbye,
  onEndSession,
  showConsentOverlay,
  recordingOn,
  onToggleRecording,
  onDismissConsent,
  isRecording,
  scheduleProposal,
  myScheduleAccepted,
  otherScheduleAccepted,
  onPropose,
  onScheduleAccept,
  onScheduleReset,
  partnerRequestedReschedule = null,
  selectedBookId,
  onSelectBook,
  onConfirmBook,
  bookPages,
  onOpenVault,
  onCloseVault,
  onStartReadingSession,
  onOpenLibraryFromHome,
  onOpenScheduleFromHome,
  onOpenBookRequests,
  onOpenSettings,
  onSwitchDevice,
  childrenList,
  activeChildId,
  onSelectChild,
  onOpenAddChild,
  pinScreenExpectedChild,
  familyStoriesSubMode,
  familyStoryEntries,
  currentBookTitle,
  currentBookEmoji,
  currentBookSpineColor,
  onSaveFamilyStory,
  onSkipFamilyStory,
  onReadAnotherBook,
  onDisconnectSession,
  onOpenFamilyStories,
  onCloseFamilyStories,
  onboardingStep,
  nanaDisplayName,
  inviteToken,
  authError,
  authLoading,
  perryInviteError,
  perryLookupNanaName,
  onNanaAuth,
  onNanaCodeSent,
  onPerryCodeSubmit,
  onChildProfileConfirm,
  onBeginSession,
  onBeginWithBook,
  onSkipOnboarding,
  onOnboardingBack,
  phaseIntro,
  onDismissPhaseCard,
  onDisablePhaseCard,
  onResetHelpPrompts,
  perryPinMode,
  perryPinChildName,
  perryPinError,
  perryPinLoading,
  onPerryPinLogin,
  onUseDifferentInvite,
  onAddSibling,
  showChildIcebreakerPrompts = false,
  onToggleChildIcebreakerPrompts,
  dashboardLoading = false,
  dashboardPerryName = "",
  dashboardProgress = [],
  vaultConnectionId,
  onSwipePrev,
  onSwipeNext,
  fontScale = 1,
  onOpenLibrary,
  onCycleFontScale,
  onFontScaleChange,
  onGoHome,
  pointerHighlight = null,
  onPointer,
  wordHighlight = null,
  onWord,
  readingTheme = "day",
  onThemeChange,
  readingLayout,
  onLayoutChange,
  pageMode = "double",
  pageSide = "L",
  onPageModeChange,
  chunkSize = 1,
  currentReaction = null,
  onReact,
  readingStartedAt = Date.now(),
  sessionSummary = null,
  perryConnected = false,
  perryAuthenticated = false,
  onLibraryScroll,
  libraryScrollTop,
  onSignOut,
}: {
  label: string;
  isNana: boolean;
  displayPage: number;
  flipping: boolean;
  flipFromPage: number;
  flipToPage: number;
  flipDirection?: "forward" | "backward";
  mode: Mode;
  promptIndex: number;
  childPromptIndex: number;
  showAndTellPromptIndex: number;
  myFilter: string;
  theirFilter: string;
  onSetMyFilter: (f: string) => void;
  sillyChallenge: ChallengeState;
  sillyCountNum: number;
  onStartChallenge: () => void;
  laughWinner: "nana" | "perry" | null;
  onLaughedFirst: (who: "nana" | "perry") => void;
  /** Per-device opt-out for the Silly Faces first-to-laugh mini-game.
   *  Default true. When false the CHALLENGE pill hides on this iPad. */
  sillyChallengeEnabled?: boolean;
  onToggleSillyChallenge?: (next: boolean) => void;
  /** Wish 1: pick where Nana lands after login — home dashboard
   *  (default) or live video greeting stage. */
  openWith?: "home" | "video";
  onOpenWithChange?: (next: "home" | "video") => void;
  onStartChat: () => void;
  onStartReading: () => void;
  /** Greeting → Icebreaker handoff. Fires when Nana taps "We're ready"
   *  or the auto-advance countdown completes. Nana side only. */
  onGreetingReady?: () => void;
  /** Greeting → IcebreakerView handoff. Optional secondary action so
   *  Nana can access conversation prompts on demand without it being
   *  forced on every session. */
  onGreetingShowPrompts?: () => void;
  onNextPrompt: () => void;
  onNextChildPrompt: () => void;
  onStartShowAndTell: () => void;
  onNextShowAndTellPrompt: () => void;
  onBackToReading: () => void;
  onStartParentCheck: () => void;
  onStartSillyFaces: () => void;
  onBackFromSillyFaces: () => void;
  goodbyePhase: number;
  goodbyeStartTime: number | null;
  onStartGoodbye: () => void;
  onBeginGoodbyeCountdown: () => void;
  onSkipToGoodbye: () => void;
  onEndChallenge: () => void;
  onEndSession: () => void;
  showConsentOverlay: boolean;
  recordingOn: boolean;
  onToggleRecording: () => void;
  onDismissConsent: () => void;
  isRecording: boolean;
  scheduleProposal: ScheduleProposal | null;
  myScheduleAccepted: boolean;
  otherScheduleAccepted: boolean;
  onPropose: (date: Date, time: string) => void;
  onScheduleAccept: () => void;
  /** Reset the booking so the picker comes back on both iPads.
   *  Wired to App.handleScheduleReset which publishes schedule_reset. */
  onScheduleReset: () => void;
  /** Role that just initiated a schedule reset (from the SSE payload).
   *  ParentCheckView shows a transient banner when this names the
   *  OTHER side so the local user knows their partner asked for a
   *  different time. */
  partnerRequestedReschedule?: "nana" | "perry" | null;
  selectedBookId: string;
  onSelectBook: (id: string) => void;
  onConfirmBook: (startPage: number) => void;
  bookPages: BookPage[];
  onOpenVault: () => void;
  onCloseVault: () => void;
  // Home-screen wiring (Nana side only; Perry never lands on home).
  onStartReadingSession?: () => void;
  onOpenLibraryFromHome?: () => void;
  onOpenScheduleFromHome?: () => void;
  onOpenBookRequests?: () => void;
  onOpenSettings?: () => void;
  onSwitchDevice?: () => void;
  familyStoriesSubMode: FamilyStoriesSubMode;
  familyStoryEntries: FamilyStoryEntry[];
  childrenList: Child[];
  activeChildId: string | null;
  onSelectChild: (childId: string) => void;
  onOpenAddChild: () => void;
  pinScreenExpectedChild?: Child | null;
  currentBookTitle: string;
  currentBookEmoji: string;
  currentBookSpineColor: string;
  onSaveFamilyStory: (note: string) => void;
  onSkipFamilyStory: () => void;
  /** NEED 3 — chain to another book inside the same reading session. */
  onReadAnotherBook?: () => void;
  /** Rick: "another button to disconnect grandchild from grandparent
   *  and then grandchild disconnects." Wired on the save-memory write
   *  screen. Publishes session_complete which the grandchild's SSE
   *  handler converts into a return to the PIN screen. */
  onDisconnectSession?: () => void;
  onOpenFamilyStories: () => void;
  onCloseFamilyStories: () => void;
  onboardingStep: number;
  nanaDisplayName: string;
  inviteToken: string;
  authError: string;
  authLoading: boolean;
  perryInviteError: string;
  perryLookupNanaName: string;
  onNanaAuth: (isLogin: boolean, data: { displayName: string; firstName: string; lastName: string; email: string; password: string }) => Promise<void>;
  onNanaCodeSent: () => void;
  onPerryCodeSubmit: (code: string) => void;
  onChildProfileConfirm: (name: string, birthday: string | null, pin: string) => void;
  onBeginSession: () => void;
  onBeginWithBook?: (bookId: string, startPage: number) => void;
  onSkipOnboarding: () => void;
  onOnboardingBack?: () => void;
  phaseIntro: Mode | null;
  onDismissPhaseCard: () => void;
  onDisablePhaseCard: () => void;
  /** Clears every per-phase skip + re-arms the master help toggle.
   *  Surfaced inside SettingsView's "Help & guidance" card. */
  onResetHelpPrompts?: () => void;
  perryPinMode?: boolean;
  perryPinChildName?: string;
  perryPinError?: string;
  perryPinLoading?: boolean;
  onPerryPinLogin?: (pin: string) => void;
  onUseDifferentInvite?: () => void;
  onAddSibling?: () => void;
  showChildIcebreakerPrompts?: boolean;
  onToggleChildIcebreakerPrompts?: () => void;
  dashboardLoading?: boolean;
  dashboardPerryName?: string;
  dashboardProgress?: Array<{ bookId: string; currentPage: number; lastReadAt: string }>;
  vaultConnectionId?: string;
  onSwipePrev?: () => void;
  onSwipeNext?: () => void;
  fontScale?: number;
  onOpenLibrary?: () => void;
  onCycleFontScale?: () => void;
  /** Direct setter for fontScale — surfaced so SettingsView can set a
   *  specific size instead of cycling. The reading toolbar still uses
   *  onCycleFontScale; this is for the discrete S/M/L/XL picker. */
  onFontScaleChange?: (s: number) => void;
  onGoHome?: () => void;
  pointerHighlight?: { x: number; y: number; page: number; ts: number } | null;
  onPointer?: (x: number, y: number, page: number) => void;
  wordHighlight?: WordHighlightState | null;
  onWord?: (side: "L" | "R", index: number, page: number) => void;
  readingTheme?: ReadingTheme;
  onThemeChange?: (t: ReadingTheme) => void;
  readingLayout?: ReadingLayout;
  onLayoutChange?: (l: ReadingLayout) => void;
  pageMode?: "single" | "double";
  pageSide?: "L" | "R";
  onPageModeChange?: (m: "single" | "double") => void;
  /** Wish 2 chunking — passed to BookSpread → BookContent. */
  chunkSize?: number;
  currentReaction?: ReactionEvent | null;
  onReact?: (emoji: ReactionEmoji) => void;
  readingStartedAt?: number;
  sessionSummary?: {
    bookTitle: string;
    pagesRead: number;
    chapterCompleted?: string;
    chapterProgress?: string;
  } | null;
  /** Forwarded to NanaHomeView for the "Perry is here" badge. */
  perryConnected?: boolean;
  /** Perry's side passes its local `perryAuthenticated` flag through so
   *  the roaming PiP overlay only renders on her iPad once she's PIN-
   *  authenticated (avoids a PiP on the invite-code entry screen). */
  perryAuthenticated?: boolean;
  /** Nana publishes scroll position via this callback; Perry receives
   *  the latest value through libraryScrollTop and mirrors the scroll. */
  onLibraryScroll?: (top: number) => void;
  libraryScrollTop?: number;
  /** Nana-side sign out — publishes session_reset to Perry, logs out
   *  server-side, and returns the device to the splash screen. */
  onSignOut?: () => void;
}) {
  const isOnboarding      = mode === "onboarding";
  const isHome            = mode === "home";
  const isChatMode        = mode === "chat";
  const isIcebreaker      = mode === "icebreaker";
  const isGreeting        = mode === "greeting";
  const isLibrary         = mode === "library";
  const isShowAndTell     = mode === "showandtell";
  const isParentCheck     = mode === "parentcheck";
  const isSillyFaces      = mode === "sillyfaces";
  const isGoodbyeMode     = mode === "goodbye";
  const isVault           = mode === "vault";
  const isBookRequests    = mode === "bookrequests";
  const isSettings        = mode === "settings";
  // Unified child name. Nana side gets it from the dashboard; Perry side
  // gets it from her cached connection. Falls back to the generic role label.
  const childName = (perryPinChildName || dashboardPerryName || "").trim();
  const nanaName = (nanaDisplayName || "").trim();
  const isFamilyStories   = mode === "familystories";
  const isReadingMode     = mode === "reading";

  // Inline confirm modal for End Call. window.confirm() is unreliable inside
  // iPad Safari running as an installed PWA — sometimes silently dismissed —
  // which is why the red hang-up button "did nothing." This drives a custom
  // dialog that always renders.
  const [endCallConfirmOpen, setEndCallConfirmOpen] = useState(false);

  const modeLabel = isOnboarding ? "Setting Up" : isGreeting ? "Chat Mode 💬" : isIcebreaker ? "Conversation Starters 💬" : isLibrary ? "Book Library 📚" : isChatMode ? "Chat Mode" : isShowAndTell ? "Show & Tell" : isParentCheck ? "Quick Check-In 💬" : isSillyFaces ? "Silly Faces 🎭" : isGoodbyeMode ? "Goodbye 💕" : isVault ? "Memory Vault 📼" : isFamilyStories ? "Our Family Journal 📖" : "Reading Mode";
  // Include reading mode so the header consistently shows nav buttons (Home,
  // Family Journal, Vault, Hang up) — the dual face tile lives in the
  // floating draggable PiP overlay during reading instead of the ribbon.
  const modeHighlight = isReadingMode || isGreeting || isIcebreaker || isLibrary || isChatMode || isShowAndTell || isParentCheck || isSillyFaces || isGoodbyeMode || isVault || isFamilyStories;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, minWidth: 0 }}>
      <p style={{ color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", marginBottom: "1px", opacity: 0.6 }}>
        {label}
      </p>
      <div
        className="nm-device-frame"
        data-layout={isReadingMode ? readingLayout : undefined}
        style={{
          border: "2px solid rgba(255,255,255,0.10)",
          borderRadius: "14px",
          backgroundColor: "#0b172e",
          boxShadow: "0 10px 40px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.06)",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          height: "100%",
          position: "relative",
        }}
      >
        <style>{`
          /* Animated transition between layouts so the switch is visible */
          .nm-device-frame { transition: background 320ms ease, border-color 320ms ease, box-shadow 320ms ease; }
          .nm-device-frame > div:first-of-type { transition: background 320ms ease, padding 240ms ease, opacity 240ms ease; }

          /* Tagline hides on layouts that prefer minimal chrome */
          .nm-device-frame[data-layout="immersive"] .nm-tagline,
          .nm-device-frame[data-layout="kids"] .nm-tagline { display: none; }

          /* ── IMMERSIVE — minimal chrome, dim mode label ── */
          .nm-device-frame[data-layout="immersive"] > div:first-of-type {
            padding: 3px 10px !important;
          }

          /* ── STORYTIME — green "live" tinted top border ── */
          .nm-device-frame[data-layout="storytime"] > div:first-of-type {
            border-bottom: 1px solid rgba(34,197,94,0.30) !important;
          }

          /* ── COZY — walnut wood frame, warm tones throughout ── */
          .nm-device-frame[data-layout="cozy"] {
            background: linear-gradient(135deg, #3a2418 0%, #2a1810 60%, #1f110a 100%) !important;
            border-color: #5C3A1E !important;
            box-shadow: 0 12px 44px rgba(0,0,0,0.8), inset 0 0 0 4px rgba(92,58,30,0.6), inset 0 0 0 5px rgba(247,201,93,0.18) !important;
          }
          .nm-device-frame[data-layout="cozy"] > div:first-of-type {
            background: linear-gradient(180deg, #2a1810 0%, #1f110a 100%) !important;
            border-bottom: 1px solid rgba(92,58,30,0.7) !important;
          }

          /* ── KIDS — bright pastel frame, soft warm border ── */
          .nm-device-frame[data-layout="kids"] {
            background: linear-gradient(135deg, #fde9f1 0%, #e9f5ff 50%, #e9f9ec 100%) !important;
            border-color: rgba(247,201,93,0.45) !important;
            box-shadow: 0 12px 44px rgba(247,201,93,0.18), inset 0 0 0 2px rgba(247,201,93,0.18) !important;
          }
          .nm-device-frame[data-layout="kids"] > div:first-of-type {
            background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.3) 100%) !important;
            border-bottom: 1px dashed rgba(201,146,42,0.45) !important;
            color: #4a3a1a !important;
          }
          .nm-device-frame[data-layout="kids"] > div:first-of-type * {
            color: #4a3a1a !important;
          }
        `}</style>
        {/* Top bar — slim chrome so the book gets more vertical real estate
            (Rick: "utilize some more real estate" for the reading area). */}
        <div style={{
          background: "linear-gradient(180deg, #1B2B4B 0%, #14223e 100%)",
          padding: "6px 12px",
          display: "flex", alignItems: "center",
          borderBottom: "1px solid rgba(201,146,42,0.18)",
          flexShrink: 0,
          gap: 12,
        }}>
          {/* Left — layout picker (Nana only) + wordmark + recording indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {isReadingMode && isNana && readingLayout !== undefined && onLayoutChange && (
              <LayoutSwitcher current={readingLayout} onChange={onLayoutChange} />
            )}
            {isReadingMode && isNana && onPageModeChange && (
              <PageModeSwitcher current={pageMode} onChange={onPageModeChange} />
            )}
            {isRecording && (
              <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#ef4444", animation: "rec-pulse 1.4s ease-in-out infinite", flexShrink: 0 }} />
            )}
            <span style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: 17, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.005em" }}>
              NeverMiss
            </span>
            <span className="nm-tagline" style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 8, letterSpacing: "0.18em", opacity: 0.7, fontWeight: 700 }}>
              READ · CONNECT · REMEMBER
            </span>
          </div>

          {/* Center — current mode label, fills remaining space */}
          <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", minWidth: 0 }}>
            <span style={{
              color: modeHighlight ? AMBER : "rgba(247,240,227,0.5)",
              fontFamily: "DM Sans, sans-serif",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              transition: "all 0.3s",
              whiteSpace: "nowrap",
            }}>
              {modeLabel.replace(/\s*[📚💬🎭💕📼📖]\s*/g, "").trim()}
            </span>
          </div>

          {/* Right — Change Book + icon controls */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {isReadingMode && isNana && (
              <button
                onClick={onOpenLibrary}
                style={{
                  background: "rgba(201,146,42,0.14)",
                  color: AMBER,
                  border: "1px solid rgba(201,146,42,0.45)",
                  borderRadius: 999,
                  padding: "5px 12px",
                  fontFamily: "DM Sans, sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                  display: "inline-flex", alignItems: "center", gap: 5,
                  flexShrink: 0,
                }}
              >
                <LibraryIcon size={12} strokeWidth={2.4} />
                Change Book
              </button>
            )}
            {(modeHighlight && !isOnboarding) ? (
              <>
                {/* Global nav — Home / Schedule / Silly Faces / Goodbye,
                    minus whichever destination this screen IS. Rick:
                    "give almost every screen a consistent set of exit
                    options … the app should feel much more fluid and
                    less like you can get trapped in a mode." Centralized
                    in NavStrip so every navigable mode renders the same
                    cluster instead of each view rolling its own Home
                    pill at different sizes. */}
                {isNana && onGoHome && (
                  <NavStrip
                    variant="inline"
                    currentDestination={
                      isHome          ? "home"
                      : isParentCheck ? "schedule"
                      : isSillyFaces  ? "sillyfaces"
                      : isGoodbyeMode ? "goodbye"
                      : null
                    }
                    onGoHome={onGoHome}
                    onStartParentCheck={onStartParentCheck}
                    onStartSillyFaces={onStartSillyFaces}
                    onStartGoodbye={onStartGoodbye}
                  />
                )}
                {isNana && (
                  <IconButton
                    icon={isFamilyStories
                      ? <XIcon size={15} strokeWidth={2.5} aria-hidden />
                      : <BookHeart size={15} strokeWidth={2} aria-hidden />}
                    label={isFamilyStories ? "Close Our Family Journal" : "Open Our Family Journal"}
                    size="sm"
                    active={isFamilyStories}
                    onClick={isFamilyStories ? onCloseFamilyStories : onOpenFamilyStories}
                  />
                )}
                {isNana && (
                  <IconButton
                    icon={isVault
                      ? <XIcon size={15} strokeWidth={2.5} aria-hidden />
                      : <Disc size={15} strokeWidth={2} aria-hidden />}
                    label={isVault ? "Close Memory Vault" : "Open Memory Vault"}
                    size="sm"
                    active={isVault}
                    onClick={isVault ? onCloseVault : onOpenVault}
                  />
                )}
                {isNana && (
                  <IconButton
                    icon={<PhoneOff size={15} strokeWidth={2.2} aria-hidden />}
                    label="End the call"
                    size="sm"
                    tone="danger"
                    onClick={() => setEndCallConfirmOpen(true)}
                  />
                )}
              </>
            ) : null /* dual-face tile lives in the floating PiP during reading mode */}
          </div>
        </div>

        {/* Phase intro card — shown to both Nana and Perry. Coaching-specific
            prompt language stays in Nana's reading-mode UI; this card is just
            the friendly "Hey, this is what happens next" intro and works
            equally for both roles. */}
        {phaseIntro && (
          <PhaseIntroCard
            phaseMode={phaseIntro}
            childName={childName}
            onDismissForSession={onDismissPhaseCard}
            onDismissForever={onDisablePhaseCard}
          />
        )}

        {/* Content */}
        {isOnboarding ? (
          <OnboardingView
            isNana={isNana}
            step={onboardingStep}
            nanaDisplayName={nanaDisplayName}
            inviteToken={inviteToken}
            authError={authError}
            authLoading={authLoading}
            perryInviteError={perryInviteError}
            perryLookupNanaName={perryLookupNanaName}
            onNanaAuth={onNanaAuth}
            onNanaCodeSent={onNanaCodeSent}
            onPerryCodeSubmit={onPerryCodeSubmit}
            onChildProfileConfirm={onChildProfileConfirm}
            onBeginSession={onBeginSession}
            onBeginWithBook={onBeginWithBook}
            onSkip={onSkipOnboarding}
            onBack={onOnboardingBack}
            perryPinMode={perryPinMode}
            perryPinChildName={perryPinChildName}
            perryPinError={perryPinError}
            perryPinLoading={perryPinLoading}
            onPerryPinLogin={onPerryPinLogin}
            onUseDifferentInvite={onUseDifferentInvite}
            onAddSibling={onAddSibling}
            dashboardLoading={dashboardLoading}
            dashboardPerryName={dashboardPerryName}
            dashboardProgress={dashboardProgress}
            onSwitchUser={onSwitchDevice}
            pinScreenChildren={childrenList}
            pinScreenExpectedChild={pinScreenExpectedChild ?? null}
          />
        ) : isHome && isNana ? (
          <NanaHomeView
            nanaName={nanaName}
            childName={childName}
            scheduleProposal={scheduleProposal}
            onStartReading={onStartReadingSession ?? (() => {})}
            onOpenLibrary={onOpenLibraryFromHome ?? (() => {})}
            onOpenVault={onOpenVault}
            onOpenSchedule={onOpenScheduleFromHome ?? (() => {})}
            onOpenBookRequests={onOpenBookRequests ?? (() => {})}
            onOpenSettings={onOpenSettings ?? (() => {})}
            onSwitchDevice={onSwitchDevice ?? (() => {})}
            perryConnected={perryConnected}
            onOpenFamilyStories={onOpenFamilyStories}
            familyStoryEntries={familyStoryEntries}
            childrenList={childrenList}
            activeChildId={activeChildId}
            onSelectChild={onSelectChild}
            onOpenAddChild={onOpenAddChild}
          />
        ) : isHome && !isNana ? (
          // Perry on home: she's not supposed to navigate Nana's dashboard.
          // This branch hits when polling syncs Perry's mode to "home" while
          // Nana is on her homepage — surface a contextual waiting screen
          // instead of leaving Perry blank.
          <PerryAwaitingView nanaName={nanaName} forMode="home" onExit={onSwitchDevice} />
        ) : isBookRequests && !isNana ? (
          <PerryAwaitingView nanaName={nanaName} forMode="bookrequests" onExit={onSwitchDevice} />
        ) : isSettings && !isNana ? (
          <PerryAwaitingView nanaName={nanaName} forMode="settings" onExit={onSwitchDevice} />
        ) : isVault && !isNana ? (
          <PerryAwaitingView nanaName={nanaName} forMode="vault" onExit={onSwitchDevice} />
        ) : isBookRequests ? (
          <BookRequestsView
            onBack={() => onGoHome?.()}
            childName={childName}
            nanaName={nanaName}
          />
        ) : isSettings ? (
          <SettingsView
            onBack={() => onGoHome?.()}
            onSwitchDevice={onSwitchDevice ?? (() => {})}
            onSignOut={onSignOut}
            nanaName={nanaName}
            childName={childName}
            readingTheme={readingTheme}
            onThemeChange={onThemeChange}
            fontScale={fontScale}
            onFontScaleChange={onFontScaleChange}
            pageMode={pageMode}
            onPageModeChange={onPageModeChange}
            readingLayout={readingLayout}
            onLayoutChange={onLayoutChange}
            onResetHelpPrompts={onResetHelpPrompts}
            sillyChallengeEnabled={sillyChallengeEnabled}
            onToggleSillyChallenge={onToggleSillyChallenge}
            openWith={openWith}
            onOpenWithChange={onOpenWithChange}
          />
        ) : isFamilyStories ? (
          <FamilyStoriesView
            isNana={isNana}
            subMode={familyStoriesSubMode}
            currentBookTitle={currentBookTitle}
            currentBookEmoji={currentBookEmoji}
            currentBookSpineColor={currentBookSpineColor}
            entries={familyStoryEntries}
            onSave={onSaveFamilyStory}
            onSkip={onSkipFamilyStory}
            onClose={onCloseFamilyStories}
            childrenList={childrenList}
            activeChildId={activeChildId}
            onSelectChild={onSelectChild}
            onOpenAddChild={onOpenAddChild}
            onGoHome={isNana ? onGoHome : undefined}
            onReadAnotherBook={isNana ? onReadAnotherBook : undefined}
            onDisconnectSession={isNana ? onDisconnectSession : undefined}
          />
        ) : isVault ? (
          <VaultView onGoHome={onCloseVault} connectionId={vaultConnectionId} activeChildId={activeChildId} />
        ) : isGreeting ? (
          <GreetingView
            isNana={isNana}
            childName={childName}
            nanaName={nanaName}
            onReady={onGreetingReady ?? (() => {})}
            onShowPrompts={onGreetingShowPrompts}
            onGoHome={isNana ? onGoHome : undefined}
          />
        ) : isIcebreaker ? (
          <IcebreakerView
            isNana={isNana}
            promptIndex={promptIndex}
            childPromptIndex={childPromptIndex}
            showChildPrompts={showChildIcebreakerPrompts}
            onNextPrompt={onNextPrompt}
            onNextChildPrompt={onNextChildPrompt}
            onToggleChildPrompts={() => onToggleChildIcebreakerPrompts?.()}
            onStartReading={onStartReading}
            childName={childName}
            nanaName={nanaName}
            onGoHome={isNana ? onGoHome : undefined}
          />
        ) : isLibrary ? (
          // Rick: "It would be nice if Perry's screen mirrored the
          // library view (read-only) while Nana scrolls through books.
          // Perry should NOT be able to select a book — view only for
          // now." Perry now renders the same LibraryView with
          // readOnly=true. Her selectedBookId follows Nana's via the
          // tentative book_change broadcast from handleSelectBook —
          // the highlight on her screen updates in real-time as Nana
          // taps cards. Search/filter and Confirm CTAs are hidden;
          // book cards are non-interactive.
          <LibraryView
            selectedBookId={selectedBookId}
            onSelectBook={onSelectBook}
            onConfirmBook={onConfirmBook}
            progress={dashboardProgress}
            onCancel={isNana ? onGoHome : undefined}
            readOnly={!isNana}
            onScroll={isNana ? onLibraryScroll : undefined}
            scrollTop={!isNana ? libraryScrollTop : undefined}
          />
        ) : isShowAndTell ? (
          <ShowAndTellView
            isNana={isNana}
            showAndTellPromptIndex={showAndTellPromptIndex}
            onNextShowAndTellPrompt={onNextShowAndTellPrompt}
            onBackToReading={onBackToReading}
            onStartParentCheck={onStartParentCheck}
            onStartSillyFaces={onStartSillyFaces}
            onGoHome={isNana ? onGoHome : undefined}
            childName={childName}
            nanaName={nanaName}
          />
        ) : isParentCheck ? (
          <ParentCheckView
            isNana={isNana}
            onStartSillyFaces={onStartSillyFaces}
            onStartGoodbye={onStartGoodbye}
            proposal={scheduleProposal}
            myAccepted={myScheduleAccepted}
            otherAccepted={otherScheduleAccepted}
            onPropose={onPropose}
            onAccept={onScheduleAccept}
            onResetProposal={onScheduleReset}
            onGoHome={isNana ? onGoHome : undefined}
            childName={childName}
            nanaName={nanaName}
            partnerRequestedReschedule={partnerRequestedReschedule}
          />
        ) : isSillyFaces ? (
          <SillyFacesView
            isNana={isNana}
            isRecording={isRecording}
            myFilter={myFilter}
            theirFilter={theirFilter}
            onSetMyFilter={onSetMyFilter}
            sillyChallenge={sillyChallenge}
            sillyCountNum={sillyCountNum}
            onStartChallenge={onStartChallenge}
            laughWinner={laughWinner}
            onLaughedFirst={onLaughedFirst}
            onStartGoodbye={onStartGoodbye}
            onStartParentCheck={onStartParentCheck}
            onEndChallenge={onEndChallenge}
            onEndSession={onEndSession}
            childName={childName}
            nanaName={nanaName}
            currentReaction={currentReaction}
            onReact={onReact}
            challengeEnabled={sillyChallengeEnabled ?? true}
            onGoHome={isNana ? onGoHome : undefined}
          />
        ) : isGoodbyeMode ? (
          <GoodbyeView
            isNana={isNana}
            goodbyePhase={goodbyePhase}
            goodbyeStartTime={goodbyeStartTime}
            onBeginCountdown={onBeginGoodbyeCountdown}
            onSkipToGoodbye={onSkipToGoodbye}
            onEndSession={onEndSession}
            childName={childName}
            nanaName={nanaName}
            sessionSummary={sessionSummary}
            onGoHome={isNana ? onGoHome : undefined}
          />
        ) : isChatMode ? (
          <ChatModeView
            isNana={isNana}
            nanaPromptText={bookPages[Math.max(0, Math.min(displayPage - 1, bookPages.length - 1))]?.nanaPrompt ?? ""}
            onStartReading={onBackToReading}
            childName={childName}
            nanaName={nanaName}
            fontScale={fontScale}
            onCycleFontScale={onCycleFontScale}
            onGoHome={isNana ? onGoHome : undefined}
          />
        ) : (
          (() => {
            // Reading mode layout — Nana's choice of arrangement.
            // Each layout gives a different emphasis between the book
            // and the "presence" sidebar (video tiles + reactions).
            const layout: ReadingLayout = readingLayout ?? "classic";
            const bookEl = (
              <BookSpread
                displayPage={displayPage}
                isNana={isNana}
                flipping={flipping}
                flipFromPage={flipFromPage}
                flipToPage={flipToPage}
                flipDirection={flipDirection}
                onStartChat={onStartChat}
                bookPages={bookPages}
                bookTitle={booksLibrary[selectedBookId]?.title ?? ""}
                onSwipePrev={onSwipePrev}
                onSwipeNext={onSwipeNext}
                fontScale={fontScale}
                isRecording={isRecording}
                pointerHighlight={pointerHighlight}
                onPointer={onPointer}
                wordHighlight={wordHighlight}
                onWord={onWord}
                readingTheme={readingTheme}
                readingStartedAt={readingStartedAt}
                pageMode={pageMode}
                pageSide={pageSide}
                chunkSize={chunkSize}
              />
            );
            const sidebar = (
              <ReadingPiPSidebar
                isNana={isNana}
                isRecording={isRecording}
                nanaName={nanaName}
                childName={childName}
                onReact={onReact}
                readingTheme={readingTheme}
                onThemeChange={onThemeChange}
              />
            );

            // ============================================================
            // IMMERSIVE — Book takes the entire frame. Video tiles move
            // into a draggable floating PiP in the corner; Nana's
            // reactions / theme / video controls live in a slim
            // translucent strip pinned to the bottom edge so they don't
            // overlap text but stay one tap away. The big visible
            // contrast with Classic ("[book | fixed sidebar]") is the
            // absence of the inline sidebar — book gets ~120px more
            // horizontal real estate. Previously this layout only
            // differed by 14px of sidebar width + a slightly bigger
            // body font, which Rick correctly called out as looking
            // "exactly the same" as Classic.
            // ============================================================
            if (layout === "immersive") {
              return (
                <div data-bk-layout="immersive" style={{
                  position: "relative",
                  display: "flex", flex: 1, minHeight: 0, overflow: "hidden",
                  background: "#0b172e",
                }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    {bookEl}
                  </div>

                  {/* Floating videos — draggable, snap-to-corner. Uses
                      the same persisted-corner pattern as the roaming
                      PiP elsewhere in the app, with a distinct storage
                      key so Immersive remembers its own position. */}
                  <DraggablePiP
                    storageKey={`nm_immersive_pip_${isNana ? "nana" : "perry"}`}
                    defaultCorner="tr"
                    margin={10}
                    zIndex={45}
                  >
                    <div style={{
                      display: "flex", flexDirection: "column", gap: 6,
                      padding: 6,
                      background: "rgba(11,23,46,0.78)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 14,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                      width: 108,
                    }}>
                      <FaceVideo
                        person="nana"
                        width="100%"
                        height={80}
                        showLabel={false}
                        label={nanaName || getRoleLabel("nana")}
                        borderRadius={10}
                        compact
                        objectPosition="center 35%"
                        isRecording={isRecording}
                      />
                      <FaceVideo
                        person="child"
                        width="100%"
                        height={80}
                        showLabel={false}
                        label={childName || getRoleLabel("child")}
                        borderRadius={10}
                        compact
                        objectPosition="center 35%"
                        isRecording={isRecording}
                      />
                    </div>
                  </DraggablePiP>

                  {/* Slim bottom action strip — reactions for both sides;
                      theme + recording controls only for Nana. Stays out
                      of the text body (sits below the book frame). */}
                  <div style={{
                    position: "absolute", left: 12, right: 12, bottom: 8,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 10,
                    padding: "4px 10px",
                    background: "rgba(11,23,46,0.55)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 999,
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                    pointerEvents: "auto",
                    zIndex: 30,
                  }}>
                    {onReact && <ReactionRow onReact={onReact} />}
                    {isNana && <VideoControls compact showRecording />}
                    {isNana && onThemeChange && (
                      <ThemeSwitcher theme={readingTheme} onChange={onThemeChange} />
                    )}
                  </div>
                </div>
              );
            }

            // ============================================================
            // STORYTIME — Book full-bleed, floating PiP corner, slim
            // bottom toolbar. Mirrors Immersive's content-forward
            // structure (Rick: "if we could apply a similar layout
            // approach — content forward, controls at the bottom — it
            // would look more polished") while keeping the green LIVE
            // READING identity via PiP accent border + a top-left chip.
            // ============================================================
            if (layout === "storytime") {
              return (
                <div data-bk-layout="storytime" style={{
                  position: "relative",
                  display: "flex", flex: 1, minHeight: 0, overflow: "hidden",
                  background: "linear-gradient(180deg, #0d1d3c 0%, #0b172e 60%, #0b172e 100%)",
                }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    {bookEl}
                  </div>

                  {/* "🟢 LIVE READING TOGETHER" chip — keeps Storytime's
                      original signature. Pinned top-left, doesn't compete
                      with the floating PiP in the top-right. */}
                  <div style={{
                    position: "absolute", top: 8, left: 12, zIndex: 40,
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "5px 10px",
                    background: "rgba(34,197,94,0.16)",
                    border: "1px solid rgba(34,197,94,0.45)",
                    borderRadius: 999,
                    color: "#86efac",
                    fontFamily: "DM Sans, sans-serif",
                    fontSize: 9, fontWeight: 800, letterSpacing: "0.18em",
                    boxShadow: "0 6px 16px rgba(34,197,94,0.22)",
                    pointerEvents: "none",
                  }}>
                    🟢 LIVE READING TOGETHER
                  </div>

                  <DraggablePiP
                    storageKey={`nm_storytime_pip_${isNana ? "nana" : "perry"}`}
                    defaultCorner="tr"
                    margin={10}
                    zIndex={45}
                  >
                    <div style={{
                      display: "flex", flexDirection: "column", gap: 6,
                      padding: 6,
                      background: "rgba(11,23,46,0.78)",
                      border: "1.5px solid rgba(34,197,94,0.55)",
                      borderRadius: 14,
                      boxShadow: "0 8px 24px rgba(34,197,94,0.25), 0 8px 24px rgba(0,0,0,0.45)",
                      width: 108,
                    }}>
                      <FaceVideo
                        person="nana"
                        width="100%"
                        height={80}
                        showLabel={false}
                        label={nanaName || getRoleLabel("nana")}
                        borderRadius={10}
                        compact
                        objectPosition="center 35%"
                        isRecording={isRecording}
                      />
                      <FaceVideo
                        person="child"
                        width="100%"
                        height={80}
                        showLabel={false}
                        label={childName || getRoleLabel("child")}
                        borderRadius={10}
                        compact
                        objectPosition="center 35%"
                        isRecording={isRecording}
                      />
                    </div>
                  </DraggablePiP>

                  <div style={{
                    position: "absolute", left: 12, right: 12, bottom: 8,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 10,
                    padding: "4px 10px",
                    background: "rgba(11,23,46,0.55)",
                    border: "1px solid rgba(34,197,94,0.30)",
                    borderRadius: 999,
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                    pointerEvents: "auto",
                    zIndex: 30,
                  }}>
                    {onReact && <ReactionRow onReact={onReact} />}
                    {isNana && <VideoControls compact showRecording />}
                    {isNana && onThemeChange && (
                      <ThemeSwitcher theme={readingTheme} onChange={onThemeChange} />
                    )}
                  </div>
                </div>
              );
            }

            // ============================================================
            // COZY — Single warm walnut wrapper, book in a soft leather
            // frame, narrow gold-trim sidebar on the right. No noisy
            // wood-grain stripes (those looked like a barcode).
            // ============================================================
            if (layout === "cozy") {
              return (
                <div data-bk-layout="cozy" style={{
                  display: "flex", flex: 1, minHeight: 0, overflow: "hidden",
                  padding: 8, gap: 8,
                  background: "linear-gradient(135deg, #2a1810 0%, #1f110a 100%)",
                }}>
                  <div style={{
                    flex: 1, minWidth: 0,
                    display: "flex", flexDirection: "column",
                    borderRadius: 10,
                    border: "2px solid #5C3A1E",
                    overflow: "hidden",
                    boxShadow: "0 8px 22px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(247,201,93,0.18)",
                  }}>
                    {bookEl}
                  </div>
                  <div style={{
                    width: 130, flexShrink: 0,
                    display: "flex", flexDirection: "column",
                    background: "rgba(255,255,255,0.02)",
                    border: "2px solid #5C3A1E",
                    borderRadius: 10,
                    boxShadow: "inset 0 0 0 2px rgba(247,201,93,0.18)",
                    overflow: "hidden",
                  }}>
                    {sidebar}
                  </div>
                </div>
              );
            }

            // ============================================================
            // KIDS — Book full-bleed on the pastel background, floating
            // PiP corner, slim bottom toolbar. Mirrors Immersive's
            // content-forward structure while preserving the playful
            // pastel identity (drifting bunny mascot + sparkles +
            // pink/blue/mint background). Rick: "Kids and Storytime
            // wastes a lot of space, especially around where the video
            // sits at the top — apply a similar layout approach."
            // ============================================================
            if (layout === "kids") {
              return (
                <div data-bk-layout="kids" style={{
                  position: "relative",
                  display: "flex", flex: 1, minHeight: 0, overflow: "hidden",
                  background: "linear-gradient(135deg, #fde9f1 0%, #e9f5ff 50%, #e9f9ec 100%)",
                }}>
                  {/* Background mascot + sparkles — unchanged from prior
                      version, just now drifting across the full-bleed
                      book area instead of inside a tiny top banner. */}
                  <div aria-hidden style={{
                    position: "absolute", top: 6, left: "30%",
                    fontSize: 22, animation: "kids-drift 9s ease-in-out infinite",
                    filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.15))",
                    pointerEvents: "none", zIndex: 3,
                  }}>🐰</div>
                  <div aria-hidden style={{
                    position: "absolute", top: 8, left: 14,
                    fontSize: 14, animation: "kids-twinkle 2.4s ease-in-out infinite",
                    pointerEvents: "none", zIndex: 3,
                  }}>✨</div>
                  <div aria-hidden style={{
                    position: "absolute", bottom: 60, left: 14,
                    fontSize: 14, animation: "kids-twinkle 2.4s 0.8s ease-in-out infinite",
                    pointerEvents: "none", zIndex: 3,
                  }}>⭐</div>

                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    {bookEl}
                  </div>

                  <DraggablePiP
                    storageKey={`nm_kids_pip_${isNana ? "nana" : "perry"}`}
                    defaultCorner="tr"
                    margin={10}
                    zIndex={45}
                  >
                    <div style={{
                      display: "flex", flexDirection: "column", gap: 6,
                      padding: 6,
                      background: "rgba(255,255,255,0.78)",
                      border: "1.5px solid rgba(247,201,93,0.55)",
                      borderRadius: 16,
                      boxShadow: "0 8px 24px rgba(247,201,93,0.30), 0 8px 24px rgba(0,0,0,0.18)",
                      width: 108,
                    }}>
                      <FaceVideo
                        person="nana"
                        width="100%"
                        height={80}
                        showLabel={false}
                        label={nanaName || getRoleLabel("nana")}
                        borderRadius={12}
                        compact
                        objectPosition="center 35%"
                        isRecording={isRecording}
                      />
                      <FaceVideo
                        person="child"
                        width="100%"
                        height={80}
                        showLabel={false}
                        label={childName || getRoleLabel("child")}
                        borderRadius={12}
                        compact
                        objectPosition="center 35%"
                        isRecording={isRecording}
                      />
                    </div>
                  </DraggablePiP>

                  <div style={{
                    position: "absolute", left: 12, right: 12, bottom: 8,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 10,
                    padding: "4px 10px",
                    background: "rgba(255,255,255,0.70)",
                    border: "1px dashed rgba(201,146,42,0.45)",
                    borderRadius: 999,
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                    pointerEvents: "auto",
                    zIndex: 30,
                    boxShadow: "0 4px 14px rgba(0,0,0,0.10)",
                  }}>
                    {onReact && <ReactionRow onReact={onReact} />}
                    {isNana && <VideoControls compact showRecording />}
                    {isNana && onThemeChange && (
                      <ThemeSwitcher theme={readingTheme} onChange={onThemeChange} />
                    )}
                  </div>

                  <style>{`
                    @keyframes kids-drift { 0%,100% { transform: translateX(0) translateY(0); } 25% { transform: translateX(40px) translateY(-3px); } 50% { transform: translateX(80px) translateY(2px); } 75% { transform: translateX(40px) translateY(-2px); } }
                    @keyframes kids-twinkle { 0%,100% { opacity: 0.4; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
                  `}</style>
                </div>
              );
            }

            // ============================================================
            // CLASSIC — original [book ··· sidebar] split
            // ============================================================
            return (
              <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  {bookEl}
                </div>
                {sidebar}
              </div>
            );
          })()
        )}

        {/* Recording consent overlay — sits above all iPad content */}
        {showConsentOverlay && !isOnboarding && (
          <RecordingConsentOverlay
            isNana={isNana}
            recordingOn={recordingOn}
            onToggleRecording={onToggleRecording}
            onDismiss={onDismissConsent}
          />
        )}

        {/* Help toggle — bottom corner. Hidden in modes whose own UI
            occupies the corner (countdown numbers, scheduler accept
            buttons, parent-check hello card) so it never covers them.
            Rick: "the Parent Check-In box was covered by the Help box." */}
        {/* Help toggle — Nana-only. Rick: "The Help button on the
            child's iPad is currently disconnected. Please remove it
            from the child's UI entirely." */}
        {isNana && !isGoodbyeMode && !isSillyFaces && !isParentCheck && (
          <div style={{
            position: "absolute",
            bottom: "12px",
            right: "12px",
            zIndex: 20,
            backgroundColor: "rgba(201,146,42,0.15)",
            border: "1.5px solid rgba(201,146,42,0.5)",
            borderRadius: "10px",
            padding: "4px 8px",
          }}>
            <HelpToggle size="compact" />
          </div>
        )}

        {/* Reactions overlay — full-bleed inside the device frame, animates
            up from below when either side sends a reaction. */}
        <ReactionOverlay reaction={currentReaction} />

        {/* The floating draggable PiP that used to sit over the book in
            reading mode has been removed in favor of the fixed
            `<ReadingPiPSidebar>` rendered inline next to <BookSpread>
            (Rick: "vertical strip to the side of the blue banner so
            they never overlap the reading content at all"). */}

        {/* ── Roaming PiP overlay ────────────────────────────────────
            Rick: "Video should stay active at all times — not just during
            reading or chat modes. When full-screen video is not essential
            (library, journal, scheduler, goodbye), both Nana and Perry
            should always have small thumbnails of each other visible on
            screen." The Daily call object stays alive across all
            in-session modes — only the visual presence was missing in
            library / journal / vault / (now) parentcheck / home. A single
            draggable thumbnail of the OTHER person, snap-to-corner, with
            position persisted per-role so dev "both" view doesn't have
            them fight over the same localStorage key.

            For Nana, also gated on (mode !== "home" || perryConnected) so
            her pre-session dashboard doesn't render an empty avatar
            placeholder when Perry hasn't connected yet. Perry's side
            doesn't gate on connection (when she's on her PIN/waiting
            screen, mode is "onboarding" which already skips the PiP). */}
        {(() => {
          const PIP_OVERLAY_MODES = new Set<Mode>([
            "library",
            "familystories",
            "vault",
            "parentcheck",
            // goodbye intentionally excluded — GoodbyeView now renders
            // the main video tile itself, so the roaming PiP would
            // duplicate it. Rick: "on goodbye timer video, should not
            // insert the small video tile."
            "home",
            "bookrequests",
            "settings",
            // Perry's "Waiting for Nana" screen uses mode==="onboarding".
            // Rick: "Neither person should ever feel like the other has
            // disappeared." Including onboarding here lets Perry see
            // Nana's face while she waits. Gated below on isNana so
            // Nana's own signup forms don't get a PiP overlay.
            "onboarding",
          ]);
          if (!PIP_OVERLAY_MODES.has(mode)) return null;
          // On Nana's iPad, suppress the PiP on pure-Nana planning screens
          // when Perry hasn't connected yet — otherwise she'd see a
          // permanent grayed-out "P" avatar floating in her dashboard.
          const isPreSessionScreen = mode === "home" || mode === "bookrequests" || mode === "settings";
          if (isNana && isPreSessionScreen && !perryConnected) return null;
          // Nana on her own signup/login flow (mode==="onboarding" but
          // she's NOT authenticated yet) — no PiP. Once she's logged in
          // she'd be on mode==="home" anyway, handled above.
          if (isNana && mode === "onboarding") return null;
          // Perry on early onboarding (pre-PIN, invite-code entry) — no
          // PiP. Only render after PIN auth completes (perryAuthenticated).
          // The Provider's `enabled` gate also requires perryAuthenticated,
          // so this is belt-and-suspenders.
          if (!isNana && mode === "onboarding" && !perryAuthenticated) return null;
          const otherLabel = isNana ? (childName || getRoleLabel("child")) : (nanaName || getRoleLabel("nana"));
          return (
            <DraggablePiP
              storageKey={`nm_session_pip_${isNana ? "nana" : "perry"}`}
              defaultCorner="tr"
              margin={12}
              zIndex={40}
            >
              <div style={{
                // Match the reading-mode sidebar PiP aspect (116×96 →
                // 1.21). Previously 1.48-ish aspect cropped iPhone
                // portrait sources too aggressively → face filled
                // ~82% of tile (vs reading's 67%). Bringing the
                // width-to-height ratio in line keeps the proportions
                // consistent everywhere.
                width: "clamp(97px, 13vw, 130px)",
                height: "clamp(80px, 11vw, 108px)",
                borderRadius: 14,
                overflow: "hidden",
                boxShadow: "0 8px 24px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)",
              }}>
                <FaceVideo
                  person={isNana ? "child" : "nana"}
                  width="100%"
                  height="100%"
                  label={otherLabel}
                  showLabel
                  borderRadius={14}
                  compact
                  // Reading-mode recipe (cover + objectPosition "center
                  // 35%" inherited from FaceVideo default). Same look
                  // as the in-session sidebar PiPs.
                  isRecording={isRecording}
                  autoMirror={false}
                />
              </div>
            </DraggablePiP>
          );
        })()}

        {endCallConfirmOpen && (
          <EndCallConfirm
            onCancel={() => setEndCallConfirmOpen(false)}
            onConfirm={() => {
              setEndCallConfirmOpen(false);
              onEndSession();
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Fixed vertical sidebar that lives next to the BookSpread in reading
 * mode. Replaces the old draggable floating PiP (which kept landing on
 * top of book text) and frees up horizontal real-estate for the book.
 * Rick: "vertical strip to the side of the blue banner so they never
 * overlap the reading content at all."
 */
function ReadingPiPSidebar({
  isNana,
  isRecording,
  nanaName,
  childName,
  onReact,
  readingTheme,
  onThemeChange,
}: {
  isNana: boolean;
  isRecording: boolean;
  nanaName: string;
  childName: string;
  onReact?: (e: ReactionEmoji) => void;
  readingTheme: ReadingTheme;
  onThemeChange?: (t: ReadingTheme) => void;
}) {
  return (
    <aside
      role="complementary"
      aria-label="Reading session controls"
      style={{
        // 130px wide — gives ~118px inner room, enough to fit two 52px
        // compact buttons side-by-side with a 6px gap (110px total).
        // Layout rule: face tiles flex-shrink to fill remaining space
        // while controls stay fixed-size at the bottom. In Cozy mode
        // (slightly shorter content area due to the warm-frame chrome),
        // the faces shrink instead of forcing a scroll bar. Earlier
        // attempt used overflowY:auto which surfaced a scroll bar in
        // Cozy — Rick: "in cozy u added the scroll, maybe we should
        // resize the icons a bit smaller so they can adjust or fix
        // layout for these buttons."
        width: 130,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 6px",
        backgroundColor: "rgba(11,23,46,0.85)",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "inset 4px 0 14px rgba(0,0,0,0.25)",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      {/* Face tiles share the elastic top region. Each takes equal share
          and is allowed to shrink down to 56px when vertical space is
          tight (Cozy). Capped at 96px so on tall frames the tiles
          don't balloon. */}
      <div style={{ flex: "1 1 0", minHeight: 56, maxHeight: 96, display: "flex", minWidth: 0 }}>
        <FaceVideo
          person="nana"
          width="100%"
          height="100%"
          showLabel={false}
          label={nanaName || getRoleLabel("nana")}
          borderRadius={12}
          compact
          objectPosition="center 35%"
          isRecording={isRecording}
        />
      </div>
      <div style={{ flex: "1 1 0", minHeight: 56, maxHeight: 96, display: "flex", minWidth: 0 }}>
        <FaceVideo
          person="child"
          width="100%"
          height="100%"
          showLabel={false}
          label={childName || getRoleLabel("child")}
          borderRadius={12}
          compact
          objectPosition="center 35%"
          isRecording={isRecording}
        />
      </div>
      {/* Mic / Cam / Rec — VideoControls uses flex-wrap so the buttons
          flow into 2 columns inside the 118px inner width. With Blur
          hidden on iPad/Safari (UA-gated in VideoControls), Nana sees
          Mic + Cam on the top row and Rec on the bottom. On desktop
          Chrome where Blur shows, it's Mic/Cam top, Blur/Rec bottom. */}
      {isNana && (
        <div style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 4 }}>
          <VideoControls compact showRecording />
        </div>
      )}
      {/* Reactions in 2x2 grid (default — no `vertical` prop). 4 × 48
          + gaps comfortably fit the 118px inner width. */}
      {onReact && (
        <div style={{ flexShrink: 0 }}>
          <ReactionRow onReact={onReact} />
        </div>
      )}
      {isNana && onThemeChange && (
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "center" }}>
          <ThemeSwitcher theme={readingTheme} onChange={onThemeChange} />
        </div>
      )}
    </aside>
  );
}

function EndCallConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-call-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 80,
        backgroundColor: "rgba(8,15,30,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "phase-intro-fade 0.2s ease-out",
      }}
    >
      <div
        style={{
          backgroundColor: "#162240",
          border: "1px solid rgba(201,146,42,0.35)",
          borderRadius: 18,
          padding: "22px 22px 18px",
          width: "100%",
          maxWidth: 360,
          textAlign: "center",
          boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
          animation: "phase-card-up 0.28s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <div id="end-call-title" style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: 20, fontWeight: 700 }}>
          End this session?
        </div>
        <div style={{ color: "rgba(247,240,227,0.78)", fontFamily: "DM Sans, sans-serif", fontSize: 13, lineHeight: 1.55, marginTop: 8, marginBottom: 18 }}>
          The call ends for both screens and you'll be taken to the memory journal to save a note about today.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1, backgroundColor: "rgba(255,255,255,0.06)", color: CREAM,
              border: "1px solid rgba(255,255,255,0.14)", borderRadius: 24, padding: "12px",
              fontFamily: "DM Sans, sans-serif", fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}
          >
            Keep reading
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              flex: 1, backgroundColor: "#ef4444", color: "white",
              border: "none", borderRadius: 24, padding: "12px",
              fontFamily: "DM Sans, sans-serif", fontWeight: 800, fontSize: 14, cursor: "pointer",
              boxShadow: "0 6px 22px rgba(239,68,68,0.35)",
            }}
          >
            End call
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Global Nav Strip ─────────────────────────────────────
 * Persistent top-right cluster on Nana-side in-session screens so no
 * mode is a dead-end. Three destinations always: Home / Schedule /
 * Silly Faces / Goodbye — minus whichever one is the current screen,
 * so the strip is always exactly 3 buttons (predictable spacing).
 * Rick: "give almost every screen a consistent set of exit options …
 * the app should feel much more fluid and less like you can get
 * trapped in a mode."
 * ────────────────────────────────────────────────────────── */

type NavDestination = "home" | "schedule" | "sillyfaces" | "goodbye";

function NavStrip({
  currentDestination,
  onGoHome,
  onStartParentCheck,
  onStartSillyFaces,
  onStartGoodbye,
  /** Renders inline (for the reading-mode chrome) vs absolute-positioned
   *  floating top-right (the default for all other navigable modes). */
  variant = "floating",
}: {
  currentDestination: NavDestination | null;
  onGoHome: () => void;
  onStartParentCheck: () => void;
  onStartSillyFaces: () => void;
  onStartGoodbye: () => void;
  variant?: "floating" | "inline";
}) {
  const items: Array<{ key: NavDestination; label: string; icon: ReactNode; onClick: () => void; tone?: "default" | "amber" | "good" | "danger" }> = [
    { key: "home",       label: "Home",         icon: <HomeIcon size={15} strokeWidth={2} aria-hidden />,     onClick: onGoHome },
    { key: "schedule",   label: "Schedule",     icon: <CalendarDays size={15} strokeWidth={2} aria-hidden />, onClick: onStartParentCheck },
    { key: "sillyfaces", label: "Silly Faces",  icon: <Smile size={15} strokeWidth={2} aria-hidden />,        onClick: onStartSillyFaces },
    { key: "goodbye",    label: "Goodbye",      icon: <Hand size={15} strokeWidth={2} aria-hidden />,         onClick: onStartGoodbye },
  ];
  const visible = items.filter((i) => i.key !== currentDestination);

  return (
    <div
      role="navigation"
      aria-label="Quick navigation"
      style={{
        position: variant === "floating" ? "absolute" : "static",
        top: variant === "floating" ? 10 : undefined,
        right: variant === "floating" ? 10 : undefined,
        zIndex: variant === "floating" ? 20 : undefined,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        // Subtle backdrop for the floating variant so the icons stay
        // legible over varying view backgrounds (the bright Goodbye
        // hand emojis, the gold ParentCheck gradient, etc.).
        padding: variant === "floating" ? "6px" : 0,
        borderRadius: variant === "floating" ? 999 : 0,
        background: variant === "floating" ? "rgba(11,23,46,0.55)" : "transparent",
        backdropFilter: variant === "floating" ? "blur(8px)" : undefined,
        border: variant === "floating" ? "1px solid rgba(255,255,255,0.08)" : undefined,
      }}
    >
      {visible.map((item) => (
        <IconButton
          key={item.key}
          icon={item.icon}
          label={item.label}
          size="sm"
          tone={item.tone ?? "default"}
          onClick={item.onClick}
        />
      ))}
    </div>
  );
}

/* ─── Child Picker + Add-Sibling Modal ─────────────────────
 * Used on Nana's home + the post-session SwitchChildPrompt to flip
 * between siblings on the same connection. Rick: "Nana reads with
 * Perry, they finish, and now she wants to read with Cooper who is
 * a different age with his own book list."
 * ────────────────────────────────────────────────────────── */

const CHILD_AVATAR_PALETTE = [
  { bg: "rgba(96,165,250,0.22)",  border: "#60a5fa", text: "#60a5fa" }, // blue
  { bg: "rgba(167,139,250,0.22)", border: "#a78bfa", text: "#a78bfa" }, // violet
  { bg: "rgba(34,197,94,0.22)",   border: "#22c55e", text: "#22c55e" }, // green
  { bg: "rgba(247,201,93,0.22)",  border: "#f7c95d", text: "#f7c95d" }, // amber
  { bg: "rgba(239,68,68,0.22)",   border: "#ef4444", text: "#ef4444" }, // red
];
function paletteForChild(id: string) {
  // Stable index from id so the same child always gets the same color.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return CHILD_AVATAR_PALETTE[Math.abs(h) % CHILD_AVATAR_PALETTE.length];
}

function ChildPicker({
  children: childList,
  activeChildId,
  onSelect,
  onAddNew,
  layout = "row",
}: {
  children: Child[];
  activeChildId: string | null;
  onSelect: (childId: string) => void;
  onAddNew: () => void;
  /** "row" = horizontal scroll (home hero), "grid" = wraps (post-session). */
  layout?: "row" | "grid";
}) {
  const isGrid = layout === "grid";
  return (
    <div
      role="radiogroup"
      aria-label="Which sibling are you reading with?"
      style={{
        display: isGrid ? "grid" : "flex",
        gridTemplateColumns: isGrid ? "repeat(auto-fill, minmax(110px, 1fr))" : undefined,
        gap: 10,
        flexWrap: isGrid ? undefined : "nowrap",
        overflowX: isGrid ? undefined : "auto",
        padding: "2px 2px 6px",
        scrollbarWidth: "none" as const,
      }}
    >
      {childList.map((c) => {
        const active = c.id === activeChildId;
        const pal = paletteForChild(c.id);
        const initial = c.name.trim().charAt(0).toUpperCase() || "?";
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(c.id)}
            style={{
              display: "inline-flex",
              flexDirection: isGrid ? "column" : "row",
              alignItems: "center",
              gap: isGrid ? 6 : 8,
              padding: isGrid ? "10px 8px" : "6px 12px 6px 6px",
              borderRadius: isGrid ? 14 : 999,
              backgroundColor: active ? "rgba(201,146,42,0.12)" : "rgba(255,255,255,0.04)",
              border: `1.5px solid ${active ? AMBER : "rgba(255,255,255,0.12)"}`,
              cursor: "pointer",
              flexShrink: 0,
              minHeight: 44,
              boxShadow: active ? "0 4px 14px rgba(201,146,42,0.25)" : "none",
              transition: "all 160ms ease",
              touchAction: "manipulation",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 32, height: 32, borderRadius: "50%",
                backgroundColor: pal.bg,
                border: `1.5px solid ${pal.border}`,
                color: pal.text,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontFamily: "DM Sans, sans-serif",
                fontSize: 14, fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {initial}
            </span>
            <span style={{
              color: active ? AMBER : CREAM,
              fontFamily: "DM Sans, sans-serif",
              fontSize: 13, fontWeight: 700,
              whiteSpace: "nowrap",
            }}>
              {c.name || "Unnamed"}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAddNew}
        aria-label="Add a sibling"
        style={{
          display: "inline-flex",
          flexDirection: isGrid ? "column" : "row",
          alignItems: "center",
          gap: isGrid ? 6 : 8,
          padding: isGrid ? "10px 8px" : "6px 14px 6px 8px",
          borderRadius: isGrid ? 14 : 999,
          backgroundColor: "transparent",
          border: "1.5px dashed rgba(247,201,93,0.45)",
          color: AMBER,
          cursor: "pointer",
          flexShrink: 0,
          minHeight: 44,
          fontFamily: "DM Sans, sans-serif",
          fontSize: 13, fontWeight: 700,
          touchAction: "manipulation",
        }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>＋</span>
        <span>Add a sibling</span>
      </button>
    </div>
  );
}

function AddChildModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  /** Returns a promise so the modal can display submitting/error state. */
  onConfirm: (body: { name: string; birthday: string | null; pin: string }) => Promise<Child>;
}) {
  const [name, setName] = useState("");
  const [age, setAge] = useState<number | "">("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const valid = name.trim().length > 0 && /^\d{4}$/.test(pin) && (age === "" || (typeof age === "number" && age >= 1 && age <= 14));

  const handleSubmit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      // Birthday is the year/month/day that would put the child at the
      // entered age today — gives the backend a normalized date even if
      // the user only knows their age. Future age-appropriate book
      // filtering can read off birthday without forcing parents to
      // remember the exact date here.
      let birthday: string | null = null;
      if (typeof age === "number") {
        const d = new Date();
        d.setFullYear(d.getFullYear() - age);
        birthday = d.toISOString().slice(0, 10);
      }
      await onConfirm({ name: name.trim(), birthday, pin });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add child. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-child-title"
      style={{
        position: "absolute", inset: 0, zIndex: 90,
        backgroundColor: "rgba(8,15,30,0.78)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
        animation: "phase-intro-fade 0.2s ease-out",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        backgroundColor: "#162240",
        border: "1px solid rgba(201,146,42,0.35)",
        borderRadius: 18,
        padding: "22px 22px 18px",
        width: "100%", maxWidth: 380,
        boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
        animation: "phase-card-up 0.28s cubic-bezier(0.22,1,0.36,1)",
      }}>
        <div id="add-child-title" style={{
          color: AMBER, fontFamily: "Playfair Display, serif",
          fontSize: 22, fontWeight: 700, textAlign: "center",
          marginBottom: 4,
        }}>
          Add a sibling
        </div>
        <div style={{
          color: "rgba(247,240,227,0.65)", fontFamily: "DM Sans, sans-serif",
          fontSize: 12, lineHeight: 1.5, textAlign: "center",
          marginBottom: 18,
        }}>
          They'll log in on the kids' iPad with a 4-digit PIN.<br />
          Pick something simple they'll remember.
        </div>

        {/* Name */}
        <label style={{
          display: "block", color: "rgba(247,240,227,0.78)",
          fontFamily: "DM Sans, sans-serif", fontSize: 11,
          fontWeight: 700, letterSpacing: "0.08em",
          marginBottom: 5,
        }}>NAME</label>
        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder="Cooper"
          maxLength={30}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "12px 14px", marginBottom: 14,
            borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)",
            backgroundColor: "rgba(255,255,255,0.05)",
            color: CREAM, fontFamily: "DM Sans, sans-serif",
            fontSize: 15, outline: "none",
          }}
        />

        {/* Age */}
        <label style={{
          display: "block", color: "rgba(247,240,227,0.78)",
          fontFamily: "DM Sans, sans-serif", fontSize: 11,
          fontWeight: 700, letterSpacing: "0.08em",
          marginBottom: 5,
        }}>AGE</label>
        <select
          value={age}
          onChange={(e) => setAge(e.target.value ? Number(e.target.value) : "")}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "12px 14px", marginBottom: 14,
            borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)",
            backgroundColor: "rgba(255,255,255,0.05)",
            color: CREAM, fontFamily: "DM Sans, sans-serif",
            fontSize: 15, outline: "none",
            appearance: "none" as const,
          }}
        >
          <option value="" style={{ background: "#0b172e" }}>Pick an age…</option>
          {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n} style={{ background: "#0b172e" }}>{n} years old</option>
          ))}
        </select>

        {/* PIN */}
        <label style={{
          display: "block", color: "rgba(247,240,227,0.78)",
          fontFamily: "DM Sans, sans-serif", fontSize: 11,
          fontWeight: 700, letterSpacing: "0.08em",
          marginBottom: 5,
        }}>4-DIGIT PIN</label>
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{4}"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="1234"
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "12px 14px", marginBottom: 6,
            borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)",
            backgroundColor: "rgba(255,255,255,0.05)",
            color: CREAM, fontFamily: "DM Sans, sans-serif",
            fontSize: 18, letterSpacing: "0.4em", textAlign: "center",
            outline: "none",
          }}
        />

        {error && (
          <div style={{
            color: "#fca5a5", fontFamily: "DM Sans, sans-serif",
            fontSize: 12, marginTop: 6, textAlign: "center",
          }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              flex: 1, backgroundColor: "rgba(255,255,255,0.06)",
              color: CREAM, border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 24, padding: "12px",
              fontFamily: "DM Sans, sans-serif", fontWeight: 700,
              fontSize: 14, cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.5 : 1,
              minHeight: 44,
            }}
          >Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || submitting}
            style={{
              flex: 1,
              background: valid && !submitting
                ? "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)"
                : "rgba(255,255,255,0.08)",
              color: valid && !submitting ? NAVY : "rgba(247,240,227,0.4)",
              border: "none", borderRadius: 24, padding: "12px",
              fontFamily: "DM Sans, sans-serif", fontWeight: 800,
              fontSize: 14, cursor: valid && !submitting ? "pointer" : "not-allowed",
              boxShadow: valid && !submitting ? "0 6px 22px rgba(201,146,42,0.45)" : "none",
              minHeight: 44,
            }}
          >{submitting ? "Adding…" : "Add child"}</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Phase Intro Card ───────────────────────────────────── */

const PHASE_INTROS: Partial<Record<Mode, { emoji: string; title: string; description: string }>> = {
  icebreaker:    { emoji: "🎲", title: "Warm-Up Time",      description: "Before you open the book, take turns answering a fun question together — there are no right or wrong answers. It's just a chance to laugh a little and hear each other's voice before the reading begins." },
  library:       { emoji: "📚", title: "Choose Your Book",  description: "Browse the bookshelf together and decide which story you want to read today. Take a look at the cover and the first few lines, then pick the adventure that calls to you both." },
  reading:       { emoji: "📖", title: "Reading Time",      description: "Time to settle in! Take turns reading pages aloud — Nana reads one page, then {child} reads the next. Go at your own pace. Nana, use the prompts on your screen any time you want a great question to spark a conversation about the book." },
  chat:          { emoji: "💬", title: "Chat Break",        description: "Put a bookmark in and talk about the story! What's happening with the characters right now? Was there a surprising moment? What do you think is going to happen next? There are no wrong answers — just good conversation about the book." },
  showandtell:   { emoji: "🎁", title: "Show & Tell",       description: "Ask {child} to find one special object — a drawing, a toy, anything — and bring it to the camera. See if you can guess what it is before {child} tells you the story behind it." },
  parentcheck:   { emoji: "🤝", title: "Quick Check-In",    description: "Time for the grown-ups to connect. Ask {child} to grab a parent or guardian for a few minutes. You can chat about how today's reading went and pick a time for the next session — then it's back to {child} for the grand finale!" },
  // sillyfaces intentionally omitted. Rick: "In Silly Faces specifically,
  // help prompts should never appear — they break the mood completely."
  // The card surface itself doesn't render this mode; the `if (PHASE_INTROS[mode])`
  // gate in the showPhaseCards effect short-circuits.
  goodbye:       { emoji: "💕", title: "Goodbye Time",      description: "Almost time to say goodbye — but not before your special send-off! Get your wave, your blown kiss, or your secret sign ready. Make it a good one to remember until next time." },
  familystories: { emoji: "🌟", title: "Our Family Journal",    description: "Today's reading is finished, but the memory doesn't have to end here. Save a voice message or a short note to the Memory Vault so this moment stays with your family forever." },
};

function HelpToggle({ size = "normal" }: { size?: "normal" | "compact" }) {
  const [on, setOn] = useState(() => localStorage.getItem("nevermiss_phase_cards") !== "off");
  useEffect(() => {
    const h = () => setOn(localStorage.getItem("nevermiss_phase_cards") !== "off");
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);
  const toggle = (val: boolean) => {
    setOn(val);
    localStorage.setItem("nevermiss_phase_cards", val ? "on" : "off");
    window.dispatchEvent(new StorageEvent("storage", { key: "nevermiss_phase_cards", newValue: val ? "on" : "off" }));
    // When the user re-enables help, force the current phase's intro to
    // show right now — without this, `showPhaseCards` flips on but the
    // shownThisSession set + per-phase skip flag silently swallow it,
    // which is what users were reporting as "help prompts not working."
    if (val) {
      window.dispatchEvent(new CustomEvent("nm:help-reactivated"));
    }
  };
  const fs = size === "compact" ? "9px" : "11px";
  const pad = size === "compact" ? "3px 10px" : "5px 14px";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center" }}>
      <span style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: fs, letterSpacing: "0.06em" }}>Need help?</span>
      <div style={{ display: "flex", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: "20px", padding: "2px" }}>
        <button onClick={() => toggle(true)} style={{ padding: pad, borderRadius: "18px", border: "none", backgroundColor: on ? AMBER : "transparent", color: on ? NAVY : "rgba(247,240,227,0.35)", fontFamily: "DM Sans, sans-serif", fontSize: fs, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>Yes</button>
        <button onClick={() => toggle(false)} style={{ padding: pad, borderRadius: "18px", border: "none", backgroundColor: !on ? AMBER : "transparent", color: !on ? NAVY : "rgba(247,240,227,0.35)", fontFamily: "DM Sans, sans-serif", fontSize: fs, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>No</button>
      </div>
    </div>
  );
}

function PhaseIntroCard({
  phaseMode,
  childName,
  onDismissForSession,
  onDismissForever,
}: {
  phaseMode: Mode;
  /** Name used when the card text contains `{child}` placeholder.
   *  Falls back to "your grandchild" so the copy still reads naturally
   *  before Nana has finished onboarding. */
  childName?: string;
  /** Close the card for this session only. Re-shows next time the user
   *  enters this phase in a future session. */
  onDismissForSession: () => void;
  /** Close + persist a per-phase skip flag so this card never shows
   *  again on this device unless cleared from Settings. */
  onDismissForever: () => void;
}) {
  const info = PHASE_INTROS[phaseMode];
  // Hooks must run unconditionally — early return for an unknown
  // phaseMode happens AFTER the hook call below.
  const [closing, setClosing] = useState(false);
  if (!info) return null;
  // Interpolate `{child}` in the description so Nana-facing cards
  // (showandtell, parentcheck) read with the actual child's name
  // instead of the literal placeholder. Rick: the showandtell card
  // used to address Perry directly ("Perry, go find one special
  // object…") even though only Nana sees the card. Now phrased as
  // Nana-coaching ("Ask {child} to grab…") with the name plugged in.
  const safeChildName = (childName || "").trim() || "your grandchild";
  const description = info.description.replace(/\{child\}/g, safeChildName);
  // Smooth exit. Without this, tapping a dismiss button instantly
  // unmounts the card — feels like a pop rather than a transition.
  // We hold the card mounted with a fade-out animation for 220ms,
  // then call the actual dismiss callback to unmount. Guard against
  // double-taps during the exit window so we don't call the callback
  // twice or run two timers.
  const close = (kind: "session" | "forever") => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      if (kind === "session") onDismissForSession();
      else onDismissForever();
    }, 220);
  };
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      backgroundColor: "rgba(11,23,46,0.88)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: closing
        ? "phase-intro-fadeout 0.22s ease-in forwards"
        : "phase-intro-fade 0.4s ease-out",
    }}>
      <div style={{
        backgroundColor: "#162240",
        border: "1px solid rgba(201,146,42,0.4)",
        borderRadius: "24px",
        padding: "28px 40px 32px",
        maxWidth: "480px",
        width: "90%",
        textAlign: "center",
        boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
        animation: closing
          ? "phase-card-down 0.22s ease-in forwards"
          : "phase-card-up 0.42s cubic-bezier(0.22,1,0.36,1)",
      }}>
        <div style={{ color: "rgba(201,146,42,0.65)", fontFamily: "DM Sans, sans-serif", fontSize: "12px", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: "18px" }}>
          WHAT'S COMING NEXT
        </div>
        <div style={{ fontSize: "68px", lineHeight: 1, marginBottom: "12px" }}>{info.emoji}</div>
        <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "30px", fontWeight: 700, lineHeight: 1.2, marginBottom: "12px" }}>{info.title}</div>
        <div style={{ width: "48px", height: "2px", backgroundColor: "rgba(201,146,42,0.35)", margin: "0 auto 16px" }} />
        <div style={{ color: "rgba(247,240,227,0.88)", fontFamily: "DM Sans, sans-serif", fontSize: "17px", lineHeight: 1.6, marginBottom: "22px" }}>{description}</div>
        <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => close("session")}
            disabled={closing}
            style={{ backgroundColor: AMBER, color: NAVY, border: "none", borderRadius: "50px", padding: "14px 30px", fontFamily: "DM Sans, sans-serif", fontWeight: 800, fontSize: "15px", letterSpacing: "0.03em", cursor: closing ? "default" : "pointer", boxShadow: "0 4px 20px rgba(201,146,42,0.35)", opacity: closing ? 0.7 : 1 }}
          >
            Got it
          </button>
          <button
            onClick={() => close("forever")}
            disabled={closing}
            style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "rgba(247,240,227,0.78)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: "50px", padding: "14px 22px", fontFamily: "DM Sans, sans-serif", fontWeight: 700, fontSize: "13px", letterSpacing: "0.02em", cursor: closing ? "default" : "pointer", opacity: closing ? 0.7 : 1 }}
          >
            Don't show again
          </button>
        </div>
        <div style={{ color: "rgba(247,240,227,0.45)", fontFamily: "DM Sans, sans-serif", fontSize: "11px", marginTop: "14px", letterSpacing: "0.02em" }}>
          Turn help back on anytime from the corner toggle or Settings.
        </div>
      </div>
    </div>
  );
}

/* ─── Session-transition overlays ──────────────────────────
 *
 * Three small full-screen cards that paint over the device frame for
 * brief moments to make session-start sequencing feel deliberate:
 *
 *   1. PerryWelcomeOverlay — "✓ You're in!" after Perry's PIN-login
 *      (~1.6s). Closes the loop on her tap with positive feedback.
 *   2. SessionBeginOverlay — "📖 Beginning your reading time…" on
 *      both iPads when Nana taps Start (~1.2s). Makes the start
 *      moment feel synchronized, not silent.
 *   3. PartnerLeftOverlay — "👋 [Nana] stepped away" for Perry when
 *      session_reset fires mid-session (~2.5s before she drops to
 *      the PIN screen). Avoids the dead-end where she'd otherwise
 *      see the in-session UI suddenly turn into PIN entry.
 *
 * Each is z-indexed above everything else and renders unconditionally
 * when its flag is set — flags are App-level state cleared via
 * setTimeout. No animation engine needed; CSS fade-in only.
 */

function PerryWelcomeOverlay({ name }: { name: string }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      backgroundColor: "rgba(11,23,46,0.92)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "phase-intro-fade 0.3s ease-out",
      pointerEvents: "auto",
    }}>
      <div style={{ textAlign: "center", animation: "phase-card-up 0.45s cubic-bezier(0.22,1,0.36,1)" }}>
        <div style={{ fontSize: "72px", marginBottom: "14px", animation: "bob 1.4s ease-in-out infinite" }}>✨</div>
        <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "32px", fontWeight: 700, marginBottom: "8px" }}>
          You're in{name ? `, ${name}` : ""}!
        </div>
        <div style={{ color: "rgba(247,240,227,0.7)", fontFamily: "DM Sans, sans-serif", fontSize: "15px" }}>
          Nana's almost ready…
        </div>
      </div>
    </div>
  );
}

function SessionBeginOverlay() {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      backgroundColor: "rgba(11,23,46,0.95)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "phase-intro-fade 0.25s ease-out",
      pointerEvents: "auto",
    }}>
      <div style={{ textAlign: "center", animation: "phase-card-up 0.4s cubic-bezier(0.22,1,0.36,1)" }}>
        <div style={{ fontSize: "84px", marginBottom: "16px", animation: "bob 1.4s ease-in-out infinite" }}>📖</div>
        <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "30px", fontWeight: 700, marginBottom: "8px" }}>
          Beginning your reading time…
        </div>
        <div style={{ color: "rgba(247,240,227,0.65)", fontFamily: "DM Sans, sans-serif", fontSize: "13px", letterSpacing: "0.04em" }}>
          Take a breath together.
        </div>
      </div>
    </div>
  );
}

function PartnerLeftOverlay({ nanaName }: { nanaName: string }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      backgroundColor: "rgba(11,23,46,0.94)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "phase-intro-fade 0.3s ease-out",
      pointerEvents: "auto",
    }}>
      <div style={{ textAlign: "center", maxWidth: 320, padding: "0 24px", animation: "phase-card-up 0.45s cubic-bezier(0.22,1,0.36,1)" }}>
        <div style={{ fontSize: "64px", marginBottom: "14px" }}>👋</div>
        <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "26px", fontWeight: 700, marginBottom: "10px", lineHeight: 1.3 }}>
          {nanaName || "Nana"} stepped away
        </div>
        <div style={{ color: "rgba(247,240,227,0.75)", fontFamily: "DM Sans, sans-serif", fontSize: "14px", lineHeight: 1.55 }}>
          Taking a break together. You can rejoin anytime — just tap your PIN when {nanaName || "Nana"}'s back.
        </div>
      </div>
    </div>
  );
}

/* ─── WhoIsReadingScreen ─────────────────────────────────── */

function WhoIsReadingScreen({ onSelect }: { onSelect: (view: "nana" | "perry" | "both") => void }) {
  return (
    <div style={{ height: "100dvh", backgroundColor: NAVY, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", fontFamily: "DM Sans, sans-serif", boxSizing: "border-box" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;700&display=swap');
        @keyframes splash-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        @keyframes splash-in    { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        .splash-btn:hover .splash-avatar { transform:scale(1.07) !important; box-shadow:0 14px 52px rgba(0,0,0,0.6) !important; }
        .splash-btn:active .splash-avatar { transform:scale(0.96) !important; }
      `}</style>

      <div style={{ textAlign: "center", marginBottom: "44px", animation: "splash-in 0.5s ease-out" }}>
        <div style={{ fontSize: "48px", marginBottom: "10px" }}>📖</div>
        <h1 style={{ color: "white", fontFamily: "Playfair Display, serif", fontSize: "clamp(28px, 6vw, 44px)", fontWeight: 700, margin: "0 0 8px" }}>NeverMiss</h1>
        <p style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: "11px", letterSpacing: "0.2em", margin: 0 }}>READ · CONNECT · REMEMBER</p>
      </div>

      <h2 style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: "clamp(20px, 4vw, 30px)", fontWeight: 400, margin: "0 0 44px", animation: "splash-in 0.5s ease-out 0.1s both" }}>
        Who's reading today?
      </h2>

      <div style={{ display: "flex", gap: "clamp(24px, 6vw, 56px)", justifyContent: "center", marginBottom: "48px" }}>
        <SplashRoleCard
          onClick={() => onSelect("nana")}
          person="nana"
          title={getRoleLabel("nana")}
          subtitle="GRANDPARENT"
          accent="rgba(201,146,42,0.55)"
          subtitleColor={AMBER}
          delay="0.2s"
        />
        <SplashRoleCard
          onClick={() => onSelect("perry")}
          person="child"
          title={getRoleLabel("child")}
          subtitle="GRANDCHILD"
          accent="rgba(120,180,255,0.45)"
          subtitleColor="#78b4ff"
          delay="0.3s"
        />
      </div>

      <button onClick={() => onSelect("both")} style={{ background: "none", border: "1px solid rgba(247,240,227,0.18)", borderRadius: "20px", color: "rgba(247,240,227,0.38)", fontFamily: "DM Sans, sans-serif", fontSize: "12px", cursor: "pointer", padding: "8px 20px", letterSpacing: "0.05em", animation: "splash-in 0.5s ease-out 0.4s both" }}>
        View demo (both screens) →
      </button>
    </div>
  );
}

/**
 * Small button bar for sending reactions. Both Nana and Perry can tap.
 * Each emoji broadcasts a `reaction` SSE event — the receiving side
 * shows the floating burst via ReactionOverlay.
 */
function ReactionRow({ onReact, vertical = false }: { onReact?: (e: ReactionEmoji) => void; vertical?: boolean }) {
  if (!onReact) return null;
  // 2×2 grid of refined reaction tiles by default. When `vertical` is
  // true (slim sidebars like Reading mode's PiP), collapse to a single
  // column so the row doesn't overflow horizontally — Rick saw the
  // right column clipping past the iPad edge in the Reading mode
  // sidebar.
  const REACTIONS: { key: ReactionEmoji; accent: string }[] = [
    { key: "heart",     accent: "#fbbf24" }, // gold
    { key: "star",      accent: "#f59e0b" }, // amber
    { key: "clap",      accent: "#fcd34d" }, // light gold
    { key: "celebrate", accent: "#a78bfa" }, // violet
  ];
  return (
    <div
      role="toolbar"
      aria-label="Send a reaction"
      style={{
        display: "grid",
        gridTemplateColumns: vertical ? "1fr" : "1fr 1fr",
        gap: 6,
        padding: 4,
        justifyItems: vertical ? "center" : "stretch",
      }}
    >
      {REACTIONS.map(({ key, accent }) => (
        <button
          key={key}
          onClick={() => onReact(key)}
          aria-label={`Send ${getReactionLabel(key)}`}
          title={`Send ${getReactionLabel(key)}`}
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            border: `1px solid color-mix(in srgb, ${accent} 32%, rgba(255,255,255,0.10))`,
            backgroundImage: `linear-gradient(155deg, color-mix(in srgb, ${accent} 18%, rgba(255,255,255,0.04)) 0%, rgba(255,255,255,0.04) 70%)`,
            backgroundColor: "rgba(255,255,255,0.04)",
            color: "#fff",
            fontSize: 26,
            lineHeight: 1,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            touchAction: "manipulation",
            WebkitTapHighlightColor: "transparent",
            transition: "transform 160ms cubic-bezier(0.22,1,0.36,1), border-color 160ms ease, box-shadow 160ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px) scale(1.06)";
            e.currentTarget.style.boxShadow = `0 8px 22px color-mix(in srgb, ${accent} 35%, transparent)`;
            e.currentTarget.style.borderColor = `color-mix(in srgb, ${accent} 65%, rgba(255,255,255,0.10))`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0) scale(1)";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.borderColor = `color-mix(in srgb, ${accent} 32%, rgba(255,255,255,0.10))`;
          }}
          onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.94)"; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = "translateY(-2px) scale(1.06)"; }}
        >
          <span style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.35))" }}>
            {getReactionGlyph(key)}
          </span>
        </button>
      ))}
    </div>
  );
}

function SplashRoleCard({
  onClick,
  person,
  title,
  subtitle,
  accent,
  subtitleColor,
  delay,
}: {
  onClick: () => void;
  person: "nana" | "child";
  title: string;
  subtitle: string;
  accent: string;
  subtitleColor: string;
  delay: string;
}) {
  return (
    <button
      className="splash-btn"
      onClick={onClick}
      aria-label={`Continue as ${title}`}
      style={{
        background: "none", border: "none", cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: "18px", padding: 0,
        animation: `splash-in 0.5s ease-out ${delay} both`,
      }}
    >
      <div
        className="splash-avatar"
        style={{
          width: "clamp(120px, 22vw, 160px)",
          height: "clamp(120px, 22vw, 160px)",
          borderRadius: "50%",
          border: `3px solid ${accent}`,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          animation: `splash-float 3.2s ease-in-out infinite ${delay}`,
          transition: "transform 0.2s, box-shadow 0.2s",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <Avatar person={person} label={title} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: CREAM, fontFamily: "Playfair Display, serif", fontSize: "clamp(18px, 3.5vw, 24px)", fontWeight: 700 }}>
          {title}
        </div>
        <div style={{ color: subtitleColor, fontFamily: "DM Sans, sans-serif", fontSize: "11px", letterSpacing: "0.12em", marginTop: "3px" }}>
          {subtitle}
        </div>
      </div>
    </button>
  );
}

/* ─── Layout switcher (Nana picks one of 5 designs, broadcast to Perry) ─── */

function LayoutSwitcher({ current, onChange }: { current: ReadingLayout; onChange: (l: ReadingLayout) => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Recompute the popover screen position every time it opens or the
  // window is resized — the popover renders via portal at <body>, so
  // it's never clipped by the device frame's overflow: hidden.
  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setAnchor({ top: r.bottom + 6, left: r.left });
    };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open]);

  // Click-outside dismissal — works against both the button and the
  // portal-rendered popover.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const meta = READING_LAYOUT_META[current];
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Reading layout: ${meta.label}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 10px",
          borderRadius: 999,
          background: "rgba(201,146,42,0.14)",
          border: "1px solid rgba(201,146,42,0.45)",
          color: AMBER,
          fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 700,
          cursor: "pointer", letterSpacing: "0.02em",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>{meta.icon}</span>
        <span>{meta.label}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>
      {open && anchor && createPortal(
        <div
          ref={popRef}
          role="menu"
          style={{
            position: "fixed",
            top: anchor.top, left: anchor.left,
            zIndex: 9999,
            minWidth: 240,
            backgroundColor: "#0f1d36",
            border: "1px solid rgba(201,146,42,0.55)",
            borderRadius: 14,
            padding: 6,
            boxShadow: "0 14px 36px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", padding: "6px 10px 4px" }}>
            READING LAYOUT
          </div>
          {READING_LAYOUTS.map(k => {
            const m = READING_LAYOUT_META[k];
            const active = k === current;
            return (
              <button
                key={k}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { onChange(k); setOpen(false); }}
                style={{
                  width: "100%", textAlign: "left",
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: active ? "rgba(201,146,42,0.18)" : "transparent",
                  border: active ? "1px solid rgba(201,146,42,0.45)" : "1px solid transparent",
                  color: CREAM,
                  cursor: "pointer",
                  fontFamily: "DM Sans, sans-serif",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 18, width: 28, textAlign: "center", flexShrink: 0 }}>{m.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: active ? AMBER : CREAM }}>{m.label}</div>
                  <div style={{ fontSize: 10, opacity: 0.6, marginTop: 1 }}>{m.sub}</div>
                </span>
                {active && <span style={{ color: AMBER, fontSize: 12, fontWeight: 800 }}>✓</span>}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

/* ─── Page-mode switcher — toggles between two-page spread and one-page-per-tap ─── */

/**
 * Sibling of LayoutSwitcher. Toggles `pageMode` between "double" (the
 * default open-book spread) and "single" (one page at a time; advancePage
 * steps L → R → next-spread-L). Rick: "if user selects one page then
 * one page will be displayed at reading mode and if two pages then it
 * will be two pages as we have, and it will also sync to perry."
 *
 * Same dropdown pattern as LayoutSwitcher — portal-rendered popover so
 * the device frame's overflow: hidden doesn't clip it, click-outside
 * dismissal, recompute on resize/scroll.
 */
function PageModeSwitcher({ current, onChange }: { current: "single" | "double"; onChange: (m: "single" | "double") => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setAnchor({ top: r.bottom + 6, left: r.left });
    };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const meta = current === "double"
    ? { icon: "📖", label: "Two pages", sub: "Open-book spread" }
    : { icon: "📄", label: "One page", sub: "One page per tap" };
  const options: Array<{ key: "double" | "single"; icon: string; label: string; sub: string }> = [
    { key: "double", icon: "📖", label: "Two pages", sub: "Open-book spread" },
    { key: "single", icon: "📄", label: "One page", sub: "One page per tap" },
  ];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Page mode: ${meta.label}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 10px",
          borderRadius: 999,
          background: "rgba(201,146,42,0.14)",
          border: "1px solid rgba(201,146,42,0.45)",
          color: AMBER,
          fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 700,
          cursor: "pointer", letterSpacing: "0.02em",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>{meta.icon}</span>
        <span>{meta.label}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>
      {open && anchor && createPortal(
        <div
          ref={popRef}
          role="menu"
          style={{
            position: "fixed",
            top: anchor.top, left: anchor.left,
            zIndex: 9999,
            minWidth: 220,
            backgroundColor: "#0f1d36",
            border: "1px solid rgba(201,146,42,0.55)",
            borderRadius: 14,
            padding: 6,
            boxShadow: "0 14px 36px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", padding: "6px 10px 4px" }}>
            PAGE MODE
          </div>
          {options.map(o => {
            const active = o.key === current;
            return (
              <button
                key={o.key}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { onChange(o.key); setOpen(false); }}
                style={{
                  width: "100%", textAlign: "left",
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: active ? "rgba(201,146,42,0.18)" : "transparent",
                  border: active ? "1px solid rgba(201,146,42,0.45)" : "1px solid transparent",
                  color: CREAM,
                  cursor: "pointer",
                  fontFamily: "DM Sans, sans-serif",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 18, width: 28, textAlign: "center", flexShrink: 0 }}>{o.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: active ? AMBER : CREAM }}>{o.label}</div>
                  <div style={{ fontSize: 10, opacity: 0.6, marginTop: 1 }}>{o.sub}</div>
                </span>
                {active && <span style={{ color: AMBER, fontSize: 12, fontWeight: 800 }}>✓</span>}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

/* ─── Conversation-prompt button — toolbar popover replacing the in-book panel ─── */

/**
 * Lives in the reading toolbar next to Prev / Next / Font / Show & Tell.
 * Tap reveals a popover containing the current page's conversation
 * prompt and the "Start Conversation" CTA. Replaces the older floating
 * bookmark panel that sat over the book corner.
 *
 * The panel is hidden by default — the book area stays untouched. Same
 * popover pattern as LayoutSwitcher / PageModeSwitcher (portal, click-
 * outside dismissal, recompute on resize/scroll). The trigger button
 * gently pulses when a fresh prompt is available so Nana notices the
 * prompt rotated on page-turn even with the popover closed.
 *
 * `prompt === null` (e.g. a page that intentionally has no prompt)
 * collapses the button to disabled state instead of hiding entirely —
 * keeps the toolbar layout stable as pages turn.
 */
function PromptButton({ prompt, onStartChat }: { prompt: string | null; onStartChat: () => void }) {
  // Rick: "The button that currently says 'Prompt' should instead say
  // 'Start a Conversation' — and just clicking it goes straight to the
  // chat screen. The yellow/orange styling stays, and the label stays
  // on the button so it's clear what it does." Stripped the popover
  // entirely — the prompt text is no longer surfaced in the toolbar;
  // Chat Mode itself shows the prompt once Nana lands there. Button is
  // disabled-styled when the current page has no prompt so Nana gets a
  // visual cue, but staying tappable wouldn't hurt either — chat mode
  // works regardless of whether the current page has a written prompt.
  const disabled = !prompt;
  return (
    <button
      onClick={() => { if (!disabled) onStartChat(); }}
      disabled={disabled}
      aria-label={disabled ? "No conversation prompt on this page" : "Start a conversation"}
      title={disabled ? "No conversation prompt on this page" : "Start a conversation"}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        height: 40,
        padding: "0 16px",
        borderRadius: 12,
        background: disabled
          ? "rgba(255,255,255,0.04)"
          : "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)",
        border: disabled
          ? "1px solid rgba(255,255,255,0.10)"
          : "none",
        color: disabled ? "rgba(247,240,227,0.4)" : NAVY,
        fontFamily: "DM Sans, sans-serif", fontSize: 13, fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: "0.02em",
        flexShrink: 0,
        boxShadow: disabled ? "none" : "0 6px 18px rgba(201,146,42,0.42)",
        touchAction: "manipulation",
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>💬</span>
      <span>Start a Conversation</span>
    </button>
  );
}

/* ─── Unified reading-toolbar button — consistent height + visual weight ─── */

function ReadingToolbarBtn({
  children, onClick, disabled = false, ariaLabel, kind,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  kind: "primary" | "ghost" | "success";
}) {
  const palette = kind === "primary"
    ? {
        background: "linear-gradient(135deg, #f7c95d 0%, #C9922A 55%, #d97706 100%)",
        color: "#0b172e", border: "none",
        shadow: "0 6px 18px rgba(201,146,42,0.42)",
      }
    : kind === "success"
    ? {
        background: "linear-gradient(135deg, #34d399 0%, #10b981 100%)",
        color: "#0b172e", border: "none",
        shadow: "0 6px 18px rgba(16,185,129,0.35)",
      }
    : {
        background: "rgba(11,23,46,0.55)",
        color: CREAM, border: "1px solid rgba(255,255,255,0.14)",
        shadow: "none",
      };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        height: 40, minWidth: 40,
        padding: "0 16px", borderRadius: 12,
        background: disabled ? "rgba(255,255,255,0.04)" : palette.background,
        color: disabled ? "rgba(247,240,227,0.25)" : palette.color,
        border: palette.border,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontFamily: "DM Sans, sans-serif",
        fontSize: 12, fontWeight: 800, letterSpacing: "0.02em",
        boxShadow: disabled ? "none" : palette.shadow,
        whiteSpace: "nowrap", flexShrink: 0,
        transition: "transform 160ms cubic-bezier(0.22,1,0.36,1), box-shadow 160ms ease, opacity 160ms",
        opacity: disabled ? 0.55 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
    >
      {children}
    </button>
  );
}

/* ─── App ────────────────────────────────────────────────── */

export default function App() {
  const [mode, setMode] = useState<Mode>("onboarding");
  const [phaseIntro, setPhaseIntro] = useState<Mode | null>(null);
  // Default "Need help?" intros to ON for new users. Rick: "Please
  // confirm it is on by default and let me know how to toggle it."
  // The toggle UI is in the bottom-right corner of every phase except
  // goodbye/silly-faces (where it would overlap the countdown numbers).
  const [showPhaseCards, setShowPhaseCards] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("nevermiss_phase_cards");
      if (v === "off") return false;
      if (v !== "on") {
        // First load (or unrecognized value) — explicitly opt in so the
        // comparison can never silently drift to off.
        localStorage.setItem("nevermiss_phase_cards", "on");
      }
    } catch {}
    return true;
  });
  const shownThisSession = useRef<Set<string>>(new Set());

  const handleTogglePhaseCards = () => {
    const next = !showPhaseCards;
    localStorage.setItem("nevermiss_phase_cards", next ? "on" : "off");
    setShowPhaseCards(next);
  };

  const handleDisablePhaseCards = () => {
    if (phaseIntro) localStorage.setItem(`nevermiss_card_skip_${phaseIntro}`, "yes");
    setPhaseIntro(null);
  };

  // Clear all per-phase "Don't show again" flags + the shown-this-
  // session set. Surfaced in SettingsView so families who dismissed
  // help cards earlier can bring them all back without remembering
  // which phases they hit. Also flips the master help toggle ON so a
  // user who'd previously turned it off discovers it's back.
  const handleResetHelpPrompts = () => {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("nevermiss_card_skip_")) keysToRemove.push(key);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      localStorage.setItem("nevermiss_phase_cards", "on");
      // Match HelpToggle's pattern: dispatch a synthetic storage event so
      // any other subscriber in this window (the corner HelpToggle, the
      // SettingsView master toggle) flips visually in lockstep with the
      // localStorage write. Real `storage` events only fire across tabs.
      window.dispatchEvent(new StorageEvent("storage", { key: "nevermiss_phase_cards", newValue: "on" }));
    } catch {}
    shownThisSession.current.clear();
    setShowPhaseCards(true);
    setPhaseIntro(null);
    // Re-trigger the current phase's card if any. Without this, the
    // user resets but doesn't see anything change until they navigate
    // to a different phase.
    if (PHASE_INTROS[mode]) {
      shownThisSession.current.add(mode);
      setPhaseIntro(mode);
    }
  };

  useEffect(() => {
    const handler = () => setShowPhaseCards(localStorage.getItem("nevermiss_phase_cards") !== "off");
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    if (showPhaseCards && PHASE_INTROS[mode]) {
      const skipped = localStorage.getItem(`nevermiss_card_skip_${mode}`) === "yes";
      const alreadyShown = shownThisSession.current.has(mode);
      if (!skipped && !alreadyShown) {
        shownThisSession.current.add(mode);
        setPhaseIntro(mode);
      }
    }
  }, [mode, showPhaseCards]);

  // When the user re-enables Help via the toggle, clear the suppression
  // flags for the current phase (per-session shown set + persisted "skip"
  // flag). Without this the toggle is no-op for any phase the user already
  // dismissed once.
  useEffect(() => {
    const reactivate = () => {
      shownThisSession.current.delete(mode);
      try { localStorage.removeItem(`nevermiss_card_skip_${mode}`); } catch {}
      if (PHASE_INTROS[mode]) {
        shownThisSession.current.add(mode);
        setPhaseIntro(mode);
      }
    };
    window.addEventListener("nm:help-reactivated", reactivate);
    return () => window.removeEventListener("nm:help-reactivated", reactivate);
  }, [mode]);

  // Auth & onboarding state
  const [nanaOnboardingStep, setNanaOnboardingStep] = useState(0);
  const [perryOnboardingStep, setPerryOnboardingStep] = useState(0);
  const [nanaDisplayName, setNanaDisplayName] = useState<string>(() => {
    try {
      const stored = localStorage.getItem("nm_perry_conn");
      if (stored) {
        const data = JSON.parse(stored) as { nanaName?: string };
        if (data.nanaName) return data.nanaName;
      }
    } catch {}
    return "Nana";
  });
  const [currentUser, setCurrentUser] = useState<SafeUser | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [perryInviteError, setPerryInviteError] = useState("");
  const [perryLookupNanaName, setPerryLookupNanaName] = useState("");

  // Device view: null = splash, "nana" = Nana only, "perry" = Perry only, "both" = demo side-by-side
  const [deviceViewRaw, setDeviceViewRaw] = useState<"nana" | "perry" | "both" | null>(() => {
    try { return (localStorage.getItem("nm_device_view") as "nana" | "perry" | "both") || null; }
    catch { return null; }
  });
  // Wrapped setter that logs every change with a stack trace. Rick saw
  // "Nana's iPad disappeared and both devices were showing Perry's view."
  // Only handleSelectDevice and handleSwitchDevice should ever change
  // deviceView, so any other call site that surfaces in the trace is a
  // bug. Cheap to leave in — runs at most twice per session.
  const setDeviceView = (view: "nana" | "perry" | "both" | null) => {
    if (typeof window !== "undefined" && view !== deviceViewRaw) {
      // eslint-disable-next-line no-console
      console.log(`[deviceView] ${deviceViewRaw} → ${view}`, new Error().stack);
    }
    setDeviceViewRaw(view);
  };
  const deviceView = deviceViewRaw;
  const handleSelectDevice = (view: "nana" | "perry" | "both") => {
    try {
      if (view === "both") localStorage.removeItem("nm_device_view");
      else localStorage.setItem("nm_device_view", view);
    } catch {}
    setDeviceView(view);
  };
  const handleSwitchDevice = () => {
    try { localStorage.removeItem("nm_device_view"); } catch {}
    setDeviceView(null);
  };
  // Sign out — Rick: "if nana logouts while session and perry will be
  // lost." Publish session_reset BEFORE killing the auth session so
  // Perry's SSE handler clears her perryHasJoined and re-arms the mode
  // jail (otherwise she stays in stale reading mode while Nana lands on
  // a fresh login screen). Then logout server-side and return to splash.
  const handleSignOut = async () => {
    if (connectionId) {
      try { await api.sessions.publishEvent(connectionId, "session_reset", {}); } catch {}
    }
    try { await api.auth.logout(); } catch {}
    setCurrentUser(null);
    setConnectionId(null);
    setInviteToken("");
    sessionStartedFiredRef.current = false;
    try { localStorage.removeItem("nm_device_view"); } catch {}
    setDeviceView(null);
  };

  // Auto-route a signed-in Nana past the splash. Rick reported a
  // collision: after a session ends, handleSwitchDevice clears her
  // deviceView to null but leaves currentUser set — she lands on the
  // splash and an accidental tap of "Join as Grandchild" pulls Perry's
  // onboarding up on her iPad while the real Perry iPad is still mid-
  // session. Since she's already authenticated, she shouldn't be re-
  // asked to choose her role — flip her back to the Nana view as soon
  // as the splash would otherwise mount.
  useEffect(() => {
    if (deviceView === null && currentUser) {
      handleSelectDevice("nana");
      return;
    }
    // Symmetric auto-route for Perry: if the device has a cached Perry
    // profile (nm_perry_conn) and there's no signed-in Nana, jump
    // straight to the Perry PIN screen instead of forcing the user to
    // tap through the splash every time. Rick: "login flow is a bit
    // clunky." Returning families save a tap.
    if (deviceView === null && !currentUser) {
      let hasPerryCache = false;
      try { hasPerryCache = !!localStorage.getItem("nm_perry_conn"); } catch {}
      if (hasPerryCache) {
        handleSelectDevice("perry");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceView, currentUser]);

  // Perry PIN login (returning user) — lazy-init from localStorage so there's no flash on returning visits
  const perryConnRef = useRef<{ connectionId: string; childName: string; nanaName: string } | null>(
    (() => {
      try {
        const stored = localStorage.getItem("nm_perry_conn");
        return stored ? JSON.parse(stored) as { connectionId: string; childName: string; nanaName: string } : null;
      } catch { return null; }
    })()
  );
  const [perryPinMode, setPerryPinMode] = useState<boolean>(() => {
    try { return !!localStorage.getItem("nm_perry_conn"); } catch { return false; }
  });
  const [perryPinError, setPerryPinError] = useState("");
  const [perryPinLoading, setPerryPinLoading] = useState(false);
  const [perryAuthenticated, setPerryAuthenticated] = useState(false);

  // Server-clock offset (NTP-lite). Updated by every SSE message + every
  // /state poll response — the server stamps `serverTs` on each payload,
  // and we keep an exponentially-weighted moving average of
  // (serverTs - clientReceiveTs). Used to convert server-clock
  // timestamps (countdown startAt, holding endsAt) into this iPad's
  // local clock so the goodbye + silly-faces countdowns advance at
  // the same wall-clock moment on Nana's and Perry's iPads regardless
  // of their device-level clock skew.
  //
  // Naive estimator: assumes one-way network latency is ~0, so
  // `serverOffset = serverTs - localReceiveTs`. Real one-way latency
  // adds bounded error (typically <100ms via Cloudflare, <30ms on LAN)
  // which is below the perceptible threshold for the 1-second-per-
  // phase countdowns this drives. The EMA smoothing damps jitter
  // from individual packet delays.
  const serverOffsetMsRef = useRef<number>(0);
  const serverOffsetSeededRef = useRef<boolean>(false);
  const updateServerOffset = useCallback((serverTs: number) => {
    if (typeof serverTs !== "number" || !Number.isFinite(serverTs)) return;
    const observed = serverTs - Date.now();
    if (!serverOffsetSeededRef.current) {
      serverOffsetMsRef.current = observed;
      serverOffsetSeededRef.current = true;
    } else {
      // EMA — weight new sample at 15%, retain 85% of history.
      // Smooths transient packet-delay spikes without lagging too
      // long behind real clock-drift changes.
      serverOffsetMsRef.current = 0.85 * serverOffsetMsRef.current + 0.15 * observed;
    }
  }, []);
  /** Convert a server-clock timestamp to this iPad's local clock. */
  const serverToLocal = useCallback((serverTs: number): number => {
    return serverTs - serverOffsetMsRef.current;
  }, []);
  // The child whose PIN actually authenticated this iPad. Used to
  // detect "Nana switched to a different sibling" and prompt re-login
  // when there's a mismatch with activeChildId. Persisted so a reload
  // doesn't lose the binding. Null means no one is currently logged
  // in on this iPad (it's at the PIN keypad or pre-onboarding).
  const [authenticatedChildId, setAuthenticatedChildIdState] = useState<string | null>(() => {
    try { return localStorage.getItem("nm_authed_child_id"); } catch { return null; }
  });
  const setAuthenticatedChildId = useCallback((id: string | null) => {
    setAuthenticatedChildIdState(id);
    try {
      if (id) localStorage.setItem("nm_authed_child_id", id);
      else localStorage.removeItem("nm_authed_child_id");
    } catch {}
  }, []);

  // Nana connection dashboard — fetched when step 3 is reached
  const [dashboardLoading, setDashboardLoading] = useState(false);
  // Full list of siblings on this connection. Replaces the old single-
  // child `dashboardPerryName` so Nana can switch between Perry / Cooper /
  // etc. Loaded by `api.children.list` after onboarding step 3.
  const [children, setChildren] = useState<Child[]>([]);
  // Which sibling is currently active for Nana's session. Drives
  // per-child progress + session log + "child name" copy throughout
  // the app. Initialized from localStorage so a reload remembers
  // who Nana was reading with last.
  const [activeChildId, setActiveChildIdRaw] = useState<string | null>(() => {
    try { return localStorage.getItem("nm_active_child_id"); } catch { return null; }
  });
  // Wrap the setter so every selection persists to localStorage AND
  // broadcasts to Perry's iPad. Broadcasts are fire-and-forget; the
  // active child also lives in server session state via the SSE event
  // handler so polling clients can backfill if SSE is buffered.
  const setActiveChildId = useCallback((nextId: string | null) => {
    setActiveChildIdRaw(nextId);
    try {
      if (nextId) localStorage.setItem("nm_active_child_id", nextId);
      else localStorage.removeItem("nm_active_child_id");
    } catch {}
    if (nextId && connectionId) {
      api.sessions.publishEvent(connectionId, "active_child_change", { childId: nextId }).catch(() => {});
    }
  }, [connectionId]);
  // Derived: the active child object + display name. All existing
  // callsites that referenced `dashboardPerryName` continue to read
  // this — semantics unchanged for single-child families.
  const activeChild = children.find((c) => c.id === activeChildId) ?? children[0] ?? null;
  const dashboardPerryName = activeChild?.name ?? "";
  const [dashboardProgress, setDashboardProgress] = useState<Array<{ bookId: string; currentPage: number; lastReadAt: string; childId?: string | null }>>([]);

  // SSE for cross-device sync
  const sseRef = useRef<EventSource | null>(null);
  const nanaSseRef = useRef<EventSource | null>(null);
  // True once Perry has received her first LIVE phase_change OR session_started
  // event after PIN login. Until then, Perry is JAILED on the "Waiting for
  // Nana" screen — even if some code path tries to set her mode to reading
  // (stale local state, polling stomp, anything), the mode-jail effect
  // immediately forces her back. Reset on every PIN login. State (not ref)
  // so the jail effect re-runs on flip.
  const [perryHasJoined, setPerryHasJoined] = useState(false);
  const perryActiveRef = useRef(false);
  // True for ~1s after Perry's PIN-login succeeds — drives the
  // "✓ You're in!" celebration banner so her tap has visible positive
  // feedback before the static waiting screen appears.
  const [perryJustLoggedIn, setPerryJustLoggedIn] = useState(false);
  // True for ~1.2s after a session_started event arrives (or fires
  // locally on Nana's side) — drives the shared "Beginning your reading
  // time…" overlay both iPads see at the same moment.
  const [sessionBeginShown, setSessionBeginShown] = useState(false);
  // True when Perry receives a session_reset event WHILE she was in an
  // in-session mode — drives the "Nana stepped away" friendly card she
  // sees for ~2.5s before dropping to the PIN/onboarding screen.
  const [partnerLeftShown, setPartnerLeftShown] = useState(false);

  // Last-applied timestamps per transient event, used by the polling fallback
  // so we don't re-fire stale reactions/highlights when SSE is healthy. The
  // poll only forwards an event if its server ts is newer than what the SSE
  // path (or a previous poll) already applied.
  const lastAppliedReactionTsRef = useRef<number>(0);
  const lastAppliedPointerTsRef = useRef<number>(0);
  const lastAppliedWordTsRef = useRef<number>(0);
  const lastAppliedChallengeTsRef = useRef<number>(0);
  const lastAppliedLaughTsRef = useRef<number>(0);
  const lastAppliedSillyNanaRef = useRef<string | null>(null);
  const lastAppliedSillyPerryRef = useRef<string | null>(null);
  const lastAppliedSessionEndTsRef = useRef<number>(0);
  const lastAppliedSessionCompleteTsRef = useRef<number>(0);
  // Last time ANY SSE message arrived — used by the health check to
  // detect "open but silent" sockets (Cloudflare buffering). Initialized
  // generously so the first 30s after mount don't accidentally trigger a
  // reconnect before any message has had a chance to arrive.
  const lastSseMessageTsRef = useRef<number>(Date.now());
  // Last time SSE-driven mode change applied — polling-driven mode
  // updates within 1.5s of this are skipped so a buffered/late poll
  // doesn't stomp a fresh SSE-applied mode. Pattern matches the existing
  // lastPageChangeRef race guard.
  const lastAppliedModeTsRef = useRef<number>(0);
  // Same race guard for bookId and page on Perry's side — Cloudflare
  // Quick Tunnels buffer polling responses by 200ms–2s, so a polling read
  // fired BEFORE the latest SSE publish can resolve AFTER SSE delivery
  // and carry a stale value. Rick: "Nana ended up on Velveteen Rabbit,
  // Perry still showed Three Little Pigs." Stamped in every SSE handler
  // that applies bookId/page so polling skips within 1.5s of a fresh
  // SSE-applied value.
  const lastAppliedBookIdTsRef = useRef<number>(0);
  const lastAppliedPageTsRef = useRef<number>(0);
  // Definitive book-change backstop. Server stamps `state.lastBookChange
  // = { bookId, page?, ts }` whenever it processes a book_change or
  // bookId-bearing phase_change. Perry's polling compares against this
  // ref and force-applies any newer change WITHOUT the 1.5s
  // anti-clobber guard. Recovers the case where SSE was buffered by
  // Cloudflare so the SSE book_change handler never fired — same
  // pattern as `lastAppliedScheduleResetTsRef`.
  const lastAppliedBookChangeTsRef = useRef<number>(0);
  // Same guard for fontScale. Either side can tap the font cycler now;
  // when Perry does, her local setState + publish race the 400ms polling
  // tick — server hasn't processed font_change yet, so polling reads the
  // OLD scale and snaps her font back, then forward again once the
  // publish lands. Rick: "font size change on Perry's iPad causes
  // jitter." Stamped in applyFontScale (local) and the SSE handler;
  // polling skips fontScale apply within 1.5s of either.
  const lastAppliedFontTsRef = useRef<number>(0);

  // Anti-clobber timestamp for scheduleProposal / scheduleAccepted.
  // Stamped on every local schedule mutation (propose, accept, reset)
  // and on schedule SSE events. Polling skips re-applying schedule
  // state for 1.5s after a stamp. Without this, the race was: Perry
  // taps "Suggest different time" → local clears → schedule_reset
  // publish is in-flight → polling tick reads still-stale state from
  // the server → re-applies the old proposal/accepted-by-Nana to
  // local state → Nana snapped back to "Waiting for Perry" and the
  // proposal popped back up for Perry. Rick: "it again popup same
  // time and when again click to change, then it still same nana
  // stucks there for waiting for perry."
  const lastAppliedScheduleTsRef = useRef<number>(0);

  // Polling backstop for `schedule_reset` when SSE is buffered by a
  // tunnel (Cloudflare Quick Tunnels). The server stamps
  // `state.lastScheduleReset = { by, ts }` whenever it processes a
  // schedule_reset event; polling compares against this ref and, if
  // newer, clears local schedule state + surfaces the banner to the
  // OTHER role. Without this, Cloudflare-buffered schedule_reset SSE
  // left Nana stuck on "Waiting for Perry's family to confirm" while
  // Perry's picker came back fine — Rick: "no, still issue. when
  // grandchild clicks on the suggest a new time button then he waits
  // and nana also waits." Same pattern as lastAppliedSessionEndTsRef.
  const lastAppliedScheduleResetTsRef = useRef<number>(0);

  // Authoritative Nana fontScale — driven by Nana's `font_change`
  // broadcasts only. NEVER affected by Perry's local override. Used as
  // the shared seed for chapter-book chunking so both iPads agree on
  // which source pages fall into which displayed spread, even when
  // Perry's visual display font is overridden (Feature 2 + Wish 2).
  const [nanaFontScale, setNanaFontScale] = useState<number>(() => {
    // Prefer the explicit Nana-scale key; fall back to the shared
    // fontScale key so existing users (who had a fontScale set before
    // Wish 2 shipped) don't see a one-render mismatch between their
    // actual font and the chunking decision.
    const explicit = localStorage.getItem("nm_nana_font_scale");
    if (explicit) return Number(explicit);
    const shared = localStorage.getItem("nm_font_scale");
    return shared ? Number(shared) : 1;
  });
  const nanaFontScaleRef = useRef(nanaFontScale);
  useEffect(() => { nanaFontScaleRef.current = nanaFontScale; }, [nanaFontScale]);
  // Font scale. Architecture (Rick's spec, Feature 2):
  //   - Nana is the default driver: her tap publishes font_change so
  //     Perry mirrors.
  //   - Perry can override locally. Once she taps the cycler on her
  //     own iPad we mark her as overridden, persist the flag, and
  //     STOP applying any further Nana-originated font changes on her
  //     side. Useful on iPad mini where Nana's XL pick would clip but
  //     Perry can pick L for her smaller screen.
  // The override is sticky across reloads (localStorage). No UI yet to
  // clear it explicitly — the cycler still works for Perry, it just
  // means each tap re-confirms her own override.
  const [fontScale, setFontScale] = useState<number>(() => {
    const s = localStorage.getItem("nm_font_scale");
    return s ? Number(s) : 1;
  });
  const [perryFontOverride, setPerryFontOverride] = useState<boolean>(() => {
    try { return localStorage.getItem("nm_perry_font_override") === "1"; } catch { return false; }
  });
  // Ref mirror so SSE/polling closures can read the current value
  // without being recreated on every flip.
  const perryFontOverrideRef = useRef(perryFontOverride);
  useEffect(() => { perryFontOverrideRef.current = perryFontOverride; }, [perryFontOverride]);
  const cycleFontScale = () => {
    const next = fontScale >= 1.5 ? 1 : fontScale >= 1.25 ? 1.5 : 1.25;
    applyFontScale(next);
  };
  // Discrete setter used by SettingsView (S/M/L/XL picker). Same side
  // effects as cycleFontScale — localStorage persistence + (Nana-side
  // only) font_change publish so Perry mirrors immediately.
  const applyFontScale = (next: number) => {
    lastAppliedFontTsRef.current = Date.now();
    setFontScale(next);
    try { localStorage.setItem("nm_font_scale", String(next)); } catch {}
    // Perry override path: mark + persist, don't publish. Nana keeps
    // her own font choice unaffected.
    if (deviceView === "perry") {
      if (!perryFontOverrideRef.current) {
        setPerryFontOverride(true);
        try { localStorage.setItem("nm_perry_font_override", "1"); } catch {}
      }
      return;
    }
    // Nana side (or "both" dev mode) — this tap IS the authoritative
    // Nana fontScale. Mirror to nanaFontScale + persist + publish.
    setNanaFontScale(next);
    try { localStorage.setItem("nm_nana_font_scale", String(next)); } catch {}
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "font_change", { scale: next }).catch(() => {});
    }
  };

  // Live mode ref so SSE/poll closures can read the current mode
  // without being re-created on every mode change. Used to suppress
  // book-id overrides while the user is in the library picking a book.
  const modeRef = useRef<Mode>(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);


  // Cleanup SSE on unmount
  useEffect(() => {
    return () => { sseRef.current?.close(); nanaSseRef.current?.close(); };
  }, []);

  // Mobile-Safari resilience: when the tab returns to the foreground (or
  // regains focus after a network blip), force the SSE connection to re-open.
  // EventSource auto-reconnect is unreliable on iOS Safari after long
  // background pauses — this guarantees the receiver re-fetches `current_state`
  // and catches up on any missed phase_change / book_change broadcasts.
  useEffect(() => {
    if (!connectionId) return;
    const reconnect = () => {
      if (document.visibilityState !== "visible") return;
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
        startPerrySSE(connectionId);
      }
      if (nanaSseRef.current) {
        nanaSseRef.current.close();
        nanaSseRef.current = null;
        startNanaSSE(connectionId);
      }
    };
    document.addEventListener("visibilitychange", reconnect);
    window.addEventListener("focus", reconnect);
    window.addEventListener("online", reconnect);
    // Periodic SSE health check — Rick: "two devices fell out of sync …
    // each was on a different page." EventSource silently transitions to
    // CLOSED (readyState 2) on some network blips and doesn't fire onerror
    // reliably, so the visibility/focus/online triggers above can miss
    // long mid-session drops where the tab stayed foregrounded. Every
    // 15 seconds we check both SSE refs and force a reconnect if either
    // shows CLOSED. The reconnect routes through startPerry/NanaSSE which
    // re-subscribes AND replays current_state, healing whatever state
    // drift accumulated during the silent disconnect.
    const HEALTH_INTERVAL_MS = 15_000;
    // SSE is considered "stale" if no message has arrived in this long even
    // though readyState is OPEN. Cloudflare Quick Tunnels can buffer the
    // event stream silently — the socket stays OPEN, no error fires, but
    // nothing actually flows. Force a reconnect so the next reply replays
    // current_state and heals the drift. Threshold is well above the
    // server's keepalive cadence (it emits a `current_state` on connect
    // plus broadcasts on every event) so we only catch true stalls.
    const SSE_STALE_MS = 35_000;
    const healthCheck = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const SSE_CLOSED = 2;
      const stale = Date.now() - lastSseMessageTsRef.current > SSE_STALE_MS;
      if (sseRef.current) {
        const closed = sseRef.current.readyState === SSE_CLOSED;
        if (closed || stale) {
          // eslint-disable-next-line no-console
          console.log(`[sse-health] perry SSE ${closed ? "closed" : "stale"}, reconnecting`);
          sseRef.current = null;
          startPerrySSE(connectionId);
          lastSseMessageTsRef.current = Date.now();
        }
      }
      if (nanaSseRef.current) {
        const closed = nanaSseRef.current.readyState === SSE_CLOSED;
        if (closed || stale) {
          // eslint-disable-next-line no-console
          console.log(`[sse-health] nana SSE ${closed ? "closed" : "stale"}, reconnecting`);
          nanaSseRef.current = null;
          startNanaSSE(connectionId);
          lastSseMessageTsRef.current = Date.now();
        }
      }
    }, HEALTH_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", reconnect);
      window.removeEventListener("focus", reconnect);
      window.removeEventListener("online", reconnect);
      window.clearInterval(healthCheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  // ── Polling fallback for SSE-buffering proxies (Cloudflare Quick Tunnel) ──
  // Cloudflare Quick Tunnels sometimes buffer event-stream responses, so the
  // SSE bridge between Nana and Perry can stall silently. Every 2s we GET the
  // current sessionState and reconcile any drift. Same payload shape as the
  // `current_state` SSE event; idempotent (React skips no-op renders).
  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    const isPerry = perryAuthenticated;
    const poll = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const state = await api.sessions.getState(connectionId);
        if (cancelled) return;
        // Server stamps every /state response with its wall-clock time.
        // Refresh the offset estimate on every poll so server-anchored
        // timestamps downstream convert accurately.
        if (state.serverTs) updateServerOffset(state.serverTs);

        // Session-end backstop: if the SSE session_end was eaten by a
        // buffering proxy, the server still records lastSessionEndTs.
        // Acting on it here transitions BOTH sides into FamilyStories
        // (memory screen) reliably and prevents a "bounce back to call"
        // when SSE silently dropped the event.
        if (
          state.lastSessionEndTs &&
          state.lastSessionEndTs > lastAppliedSessionEndTsRef.current
        ) {
          lastAppliedSessionEndTsRef.current = state.lastSessionEndTs;
          setFamilyStoriesSubMode("write");
          // Also drop the chapter-end card here — same reasoning as the
          // SSE session_end handler, but for the polling-only path.
          setChapterEndOverlay(null);
          setMode((current) =>
            current === "onboarding" || current === "familystories"
              ? current
              : "familystories",
          );
          // After session end, server has wiped book/page/mode — skip the
          // rest of the reconciliation this tick to avoid flickering back.
          return;
        }

        // Session-complete backstop: when Nana taps Back from the
        // post-session vault, both sides should drop to splash / PIN.
        // If SSE was buffered Perry stayed stuck on the vault — Rick:
        // "They should both transition together."
        if (
          state.lastSessionCompleteTs &&
          state.lastSessionCompleteTs > lastAppliedSessionCompleteTsRef.current
        ) {
          lastAppliedSessionCompleteTsRef.current = state.lastSessionCompleteTs;
          if (isPerry) {
            setMode("onboarding");
            setPerryPinMode(true);
          } else {
            // Nana's local handleCloseVault already ran handleSwitchDevice;
            // the polling tick is just a safety net for that path.
          }
          return;
        }

        // Core: book + page. Nana drives both — she's the one tapping
        // book cards and turning pages, then publishing `book_change` /
        // `page_change` events for Perry to follow. Nana never reads
        // her own server state, so polling-driven updates of these
        // fields only apply on Perry's iPad. Without this guard,
        // confirming a book races the polling tick: Nana taps Confirm,
        // setSelectedBookId locally, mode goes to "reading", polling
        // fires before book_change reaches the server, reads the still-
        // stale state.bookId="alice", reverts Nana's choice. Rick:
        // "nana needs to select the 2-3 times then it start reading."
        // Mirrors the mode-source-of-truth fix one block down.
        // Race guard: same 1.5s skip as mode polling. A polling response
        // can resolve AFTER the SSE delivery that already advanced
        // bookId/page (Cloudflare buffers polling responses 200ms–2s);
        // applying it would stomp the fresh value back. Rick: "Nana ended
        // up on Velveteen Rabbit, Perry still showed Three Little Pigs."
        if (isPerry && state.bookId && Date.now() - lastAppliedBookIdTsRef.current >= 1500) {
          setSelectedBookId(state.bookId);
        }
        // Definitive book-change backstop. Server stamps lastBookChange
        // = { bookId, page?, ts } on every book_change OR phase_change
        // that carries a bookId. If this is newer than what we've
        // applied, force-apply regardless of the 1.5s guard above —
        // the timestamp comparison is the de-duplication, so SSE +
        // polling can't double-fire. This is what catches the case
        // where SSE was buffered by a Cloudflare tunnel and the SSE
        // book_change handler never ran. Rick: "the two devices were
        // completely disconnected on book selection — neither page
        // turns nor book changes were propagating to Perry."
        if (
          isPerry &&
          state.lastBookChange &&
          typeof state.lastBookChange.ts === "number" &&
          state.lastBookChange.ts > lastAppliedBookChangeTsRef.current
        ) {
          lastAppliedBookChangeTsRef.current = state.lastBookChange.ts;
          lastAppliedBookIdTsRef.current = Date.now();
          setSelectedBookId(state.lastBookChange.bookId);
          if (state.lastBookChange.page != null) {
            const pg = state.lastBookChange.page;
            lastAppliedPageTsRef.current = Date.now();
            childPageRef.current = pg;
            setChildPage(pg);
            nanaPageRef.current = pg;
            setNanaPage(pg);
          }
        }
        // Perry's page guard checks BOTH timestamps:
        //   - lastAppliedPageTsRef: protects against Nana's SSE update
        //     being stomped by a later-arriving polling response.
        //   - lastPageChangeRef: protects against Perry's OWN local
        //     advancePage being stomped before her publish lands at the
        //     server. Without this second check, Perry's tap shows the
        //     new page, polling 400ms later reads the STILL-OLD server
        //     state, and snaps Perry back. Mirrors the Nana-side guard
        //     at line ~9659.
        const pageGuardOk =
          Date.now() - lastAppliedPageTsRef.current >= 1500 &&
          Date.now() - lastPageChangeRef.current >= 1500;
        if (isPerry && state.page != null && pageGuardOk) {
          const pg = state.page;
          childPageRef.current = pg;
          setChildPage(pg);
          // Same fix as the SSE page_change handler — Perry's advancePage
          // computes `nanaPageRef.current + dir` to derive the next page,
          // so this ref MUST track the current canonical page on Perry's
          // iPad too, not just childPage. Without this, polling-only
          // recovery (SSE buffered by Cloudflare) leaves Perry's nanaPage
          // permanently stale and her next-tap publishes the wrong page,
          // dragging Nana backward.
          nanaPageRef.current = pg;
          setNanaPage(pg);
        }
        // Nana-side page-sync fallback. Rick: "if perry change the page,
        // it does not change on the nana side." Root cause: the polling
        // page-sync block above was gated on `isPerry`, so Nana had no
        // safety net if her SSE was buffered (Cloudflare Quick Tunnels
        // routinely buffer SSE for seconds at a time). Perry's
        // page_change publish hits the server fine and Perry's own SSE
        // receives it, but Nana's never does — her view stays stuck
        // until SSE flushes or she navigates away.
        //
        // Race guard: skip applying when Nana JUST initiated a change
        // herself (within 1.5s) — otherwise polling could read the
        // pre-publish state.page and snap her back to the old page
        // before the server has processed her own publish.
        //
        // We also check pageSide independently because in single-page
        // mode a side-flip-within-spread (L→R on the same `page`) is a
        // real page change that Nana needs to see — but the SAME page
        // number, so the `state.page !== nanaPageRef.current` check
        // alone would miss it.
        if (!isPerry) {
          const sinceLocalChange = Date.now() - lastPageChangeRef.current;
          if (sinceLocalChange > 1500) {
            const pageNeedsUpdate = state.page != null && state.page !== nanaPageRef.current;
            const sideNeedsUpdate = (state.pageSide === "L" || state.pageSide === "R") && state.pageSide !== pageSideRef.current;
            if (pageNeedsUpdate && state.page != null) {
              const pg = state.page;
              nanaPageRef.current = pg;
              setNanaPage(pg);
              // Also bring childPage along so flip animations elsewhere
              // (and per-tile displays in "both" view) stay coherent.
              childPageRef.current = pg;
              setChildPage(pg);
            }
            if (sideNeedsUpdate && (state.pageSide === "L" || state.pageSide === "R")) {
              setPageSide(state.pageSide);
            }
            // NOTE: deliberately no Nana-side polling for `bookId`.
            // Bug 2 ("Nana selected Black Beauty but Perry stayed on
            // Three Little Pigs") is a Perry-RECEIVES problem, fixed
            // upstream by adding `book_change` to dev-server LIFECYCLE.
            // The reverse direction (Perry driving a book change) does
            // not exist in product — only Nana picks books. A polling
            // fallback here would actively REGRESS the UX: when Nana
            // tentatively taps a book in the library but exits without
            // confirming, the next polling tick would read the LAST
            // CONFIRMED bookId from server and snap her selection back,
            // erasing the tentative pick.
          }
        }

        // Mode (defended against overwrites of local-nav screens).
        //   - Nana's onboarding/familystories: local auth + memory-writing
        //     flows that polling shouldn't stomp.
        //   - Perry's familystories: same — she writes the memory locally.
        //   - Perry's onboarding: protected UNTIL she has received her first
        //     LIVE phase_change/session_started event via SSE. Without this
        //     gate, a Perry connecting to a server with stale sessionAlive=true
        //     state from a prior round would be yanked into reading mode the
        //     instant her polling fired — even though Nana is sitting on her
        //     home screen. After Perry has received a live event (perryActiveRef),
        //     polling resumes its normal job of catching up missed mode changes.
        //   - Nana-only dashboard screens (home/vault/bookrequests/
        //     settings/library): protected for Nana so polling doesn't
        //     yank her back to a previous mode mid-navigation.
        // UNJAIL PATH for Perry: when the server reports any `mode` for the
        // connection, it means Nana has fired a phase_change (the only path
        // that sets state.mode server-side). That's an authoritative signal
        // Perry should follow — sessionAlive is not required, because Nana
        // may be on home/library/bookrequests/settings which don't auto-fire
        // session_started but still publish phase_change. The defense against
        // stale-state replay lives elsewhere (isSessionExpired wipes idle
        // sessions, mode-jail prevents accidental reading-mode entry).
        // Rick: "if nana first goto library nothing synced."
        if (isPerry && state.mode && !perryActiveRef.current) {
          perryActiveRef.current = true;
          setPerryHasJoined(true);
        }
        if (state.mode) {
          setMode((current) => {
            if (!isPerry && (current === "onboarding" || current === "familystories")) return current;
            if (isPerry && current === "familystories") return current;
            // Cold-start gate: until Perry has received her first live SSE
            // event (session_started or phase_change), don't let polling
            // drag her into a previous session's mode. Without the
            // icebreaker check, a Perry who finished onboarding (so
            // current=icebreaker, not onboarding) would still get yanked
            // into reading mode by stale server state — exactly what Rick
            // hit ("Perry's iPad opened to Alice before Nana had done
            // anything").
            if (isPerry && !perryActiveRef.current && (current === "onboarding" || current === "icebreaker")) return current;
            // Race guard: skip if SSE just applied a fresh mode within
            // the last 1.5s. Polling fetches server state asynchronously
            // and a Cloudflare-buffered read could carry a stale `mode`
            // that arrives AFTER an SSE phase_change already advanced
            // Perry to the next mode. Without this, polling stomps the
            // SSE-set mode back to the previous one and the user sees a
            // flicker. Same pattern as lastPageChangeRef above.
            if (isPerry && Date.now() - lastAppliedModeTsRef.current < 1500) return current;
            // Nana drives her own mode. She publishes `phase_change`
            // events that update server state for Perry to read; she
            // does NOT need polling to tell her where she is. Without
            // this guard, the sequence is: Nana taps "Start Reading"
            // → `setMode("icebreaker")` locally → fire-and-forget
            // phase_change publish hits the wire → next polling tick
            // (400ms cadence after the recent bump) reads the still-
            // stale `state.mode === "home"` from the server → reverts
            // her mode back → user sees a flash and has to tap again.
            // Rick: "flashes sometimes and we need to tap two-three
            // times then it opens." Polling only changes Perry's mode.
            if (!isPerry) return current;
            return state.mode as Mode;
          });
        }

        // Scheduler proposal — only Perry needs to receive Nana's via poll.
        // Anti-clobber: skip applying schedule polling for 1.5s after any
        // local schedule mutation OR a fresh schedule SSE event. Without
        // this, the race was: Perry taps "Suggest different time" →
        // local clears → schedule_reset is in-flight to the server →
        // polling tick reads still-stale `state.scheduleAccepted` →
        // re-applies it → Nana snapped back to "Waiting for Perry" and
        // the proposal popped back up for Perry. The window is identical
        // to the existing mode / fontScale guards in this file.
        const scheduleFresh =
          Date.now() - lastAppliedScheduleTsRef.current < 1500;
        if (state.scheduleProposal && isPerry && !scheduleFresh) {
          setScheduleProposal({
            date: new Date(state.scheduleProposal.date),
            time: state.scheduleProposal.time,
            proposedBy: state.scheduleProposal.proposedBy,
          });
        }
        if (state.scheduleAccepted && !scheduleFresh) {
          setNanaScheduleAccepted(state.scheduleAccepted.nana);
          setPerryScheduleAccepted(state.scheduleAccepted.perry);
        }

        // Schedule-reset backstop: server stamps `lastScheduleReset =
        // { by, ts }` whenever it processes a schedule_reset event.
        // If the SSE event was eaten by a buffering tunnel, this is
        // how the OTHER side learns to drop the proposal and surface
        // the "asked for a different time" banner. Compare against
        // the ref so we apply each reset at most once per ts.
        if (
          state.lastScheduleReset &&
          typeof state.lastScheduleReset.ts === "number" &&
          state.lastScheduleReset.ts > lastAppliedScheduleResetTsRef.current
        ) {
          lastAppliedScheduleResetTsRef.current = state.lastScheduleReset.ts;
          lastAppliedScheduleTsRef.current = Date.now();
          setScheduleProposal(null);
          setNanaScheduleAccepted(false);
          setPerryScheduleAccepted(false);
          const by = state.lastScheduleReset.by as "nana" | "perry" | undefined;
          // Banner shows only when the OTHER side initiated. Perry's
          // partner is Nana, Nana's partner is Perry.
          const ownRole: "nana" | "perry" = isPerry ? "perry" : "nana";
          if (by && by !== ownRole) {
            setPartnerRequestedReschedule(by);
            window.setTimeout(() => setPartnerRequestedReschedule(null), 5000);
          }
        }

        // Goodbye — Perry computes phase locally from startTime so even if
        // every single goodbye_phase event is buffered, the countdown still
        // ticks accurately on her side.
        if (state.goodbyeStartTime != null && isPerry) {
          // goodbyeStartTime is stored in SERVER clock — convert to
          // local via the EMA offset before scheduling. Without this
          // conversion, polling-fallback recovery would re-introduce
          // the cross-device skew that the SSE path now avoids.
          // Guarded: only set when local is null (SSE didn't deliver)
          // — overwriting an already-set anchor with a freshly-
          // converted value would reset the local-tick effect's
          // setTimeout chain and could re-fire the keyed countdown
          // animation as the offset EMA refines mid-countdown.
          const newStart = serverToLocal(state.goodbyeStartTime);
          setGoodbyeStartTime((prev) => (prev === null ? newStart : prev));
          setMode((current) => current === "goodbye" ? current : "goodbye");
        }
        if (state.goodbyePhase != null && isPerry) {
          // Monotonic guard — only advance, never snap back. Perry's
          // local 100ms tick computes phase from the shared startTime;
          // network-lagged polling/SSE values arriving AFTER she has
          // already ticked would otherwise pull her back a number, the
          // next tick would re-advance, and the keyed countdown div
          // would re-mount twice in 100ms (visible jitter). Phase 0 is
          // allowed through so a fresh-session reset still lands.
          // Rick: "small but noticeable jitter on the countdown numbers
          // on Perry's iPad."
          const incoming = state.goodbyePhase;
          setGoodbyePhase((prev) => (incoming === 0 || incoming >= prev ? incoming : prev));
        }

        // Reading theme / layout / font / child-prompt toggle.
        // Nana drives ALL of these — she's the one tapping the theme
        // swatches, layout picker, font-scale cycler, and prompts
        // toggle. Each tap fires the corresponding `_change` event
        // for Perry's iPad to mirror. On Nana's own iPad polling
        // would race the publish and snap her choice back to the
        // stale server value (same root cause as mode/bookId flicker).
        // Gate on isPerry so only the follower-side applies these.
        if (isPerry && state.readingTheme && state.readingTheme !== readingTheme) {
          setReadingTheme(state.readingTheme as ReadingTheme);
        }
        if (isPerry && state.readingLayout && (READING_LAYOUTS as readonly string[]).includes(state.readingLayout)) {
          setReadingLayout((curr) => curr === state.readingLayout ? curr : state.readingLayout as ReadingLayout);
        }
        // Page mode + side — Nana drives both via the dropdown / advancePage.
        // Same source-of-truth gate as theme/layout: only the follower
        // (Perry) applies polling-derived values, so Nana's own toggle
        // never races her local state.
        if (isPerry && (state.pageMode === "single" || state.pageMode === "double")) {
          setPageMode((curr) => curr === state.pageMode ? curr : state.pageMode as "single" | "double");
        }
        if (isPerry && (state.pageSide === "L" || state.pageSide === "R")) {
          setPageSide((curr) => curr === state.pageSide ? curr : state.pageSide as "L" | "R");
        }
        if (isPerry && typeof state.fontScale === "number") {
          const nextScale = state.fontScale;
          // Authoritative Nana scale always updates (chunking seed).
          setNanaFontScale((curr) => curr === nextScale ? curr : nextScale);
          // Visual display only if no override and no recent local apply.
          if (!perryFontOverrideRef.current && Date.now() - lastAppliedFontTsRef.current >= 1500) {
            setFontScale((curr) => curr === nextScale ? curr : nextScale);
          }
        }
        if (isPerry && typeof state.showChildIcebreakerPrompts === "boolean") {
          const nextShow = state.showChildIcebreakerPrompts;
          setShowChildIcebreakerPrompts((curr) => curr === nextShow ? curr : nextShow);
        }

        // ── Transient events (Cloudflare-buffered SSE backstop) ──────────
        // Reactions, word/pointer highlights, silly filters, challenge
        // state, and laugh winner all fire as one-shot SSE events. When
        // the tunnel buffers them, the polling channel re-delivers using
        // monotonic timestamps so we never replay a stale event.
        // ReactionEvent.from speaks the legacy "nana" | "child" enum; the
        // server stores "nana" | "perry" historically. They mean the same
        // sides — accept either here when checking sender identity.
        const localSide = isPerry ? "perry" : "nana";

        if (state.lastReaction && state.lastReaction.ts > lastAppliedReactionTsRef.current) {
          lastAppliedReactionTsRef.current = state.lastReaction.ts;
          // Don't re-show the sender their own reaction via poll — the SSE
          // optimistic path already animated it locally.
          if (state.lastReaction.from !== localSide && state.lastReaction.emoji) {
            setCurrentReaction({
              emoji: state.lastReaction.emoji as ReactionEmoji,
              from: state.lastReaction.from === "perry" ? "child" : "nana",
              ts: state.lastReaction.ts,
            });
          }
        }

        if (state.lastPointer && state.lastPointer.ts > lastAppliedPointerTsRef.current) {
          lastAppliedPointerTsRef.current = state.lastPointer.ts;
          // Pointer broadcasts only flow Nana→Perry, but stamping the ref
          // on both sides keeps the suppression symmetric in case of
          // role/mode swaps mid-session.
          if (isPerry) {
            setPointerHighlight({
              x: state.lastPointer.x,
              y: state.lastPointer.y,
              page: state.lastPointer.page,
              ts: state.lastPointer.ts,
            });
          }
        }

        if (state.lastWord && state.lastWord.ts > lastAppliedWordTsRef.current) {
          lastAppliedWordTsRef.current = state.lastWord.ts;
          const w = state.lastWord;
          // Word highlights only flow Nana→Perry — Perry never publishes
          // word highlights, so polling-driven word updates only make
          // sense on Perry's iPad. Skipping this gate would let Nana's
          // polling re-apply her own old highlight from the server.
          if (isPerry && (w.side === "L" || w.side === "R") && Number.isFinite(w.index)) {
            setWordHighlight({ side: w.side, index: w.index, page: w.page, ts: w.ts });
          }
        }

        // Silly-faces filters: each side drives its OWN filter (Nana
        // picks Nana's filter, Perry picks Perry's). Polling mirrors
        // the OTHER side's choice so each can see the other's filter.
        // The same-side gate prevents the chooser from having her own
        // selection reverted by a stale server value mid-tap.
        if (isPerry && state.lastSillyFilterNana && state.lastSillyFilterNana !== lastAppliedSillyNanaRef.current) {
          lastAppliedSillyNanaRef.current = state.lastSillyFilterNana;
          setNanaSillyFilter(state.lastSillyFilterNana);
        }
        if (!isPerry && state.lastSillyFilterPerry && state.lastSillyFilterPerry !== lastAppliedSillyPerryRef.current) {
          lastAppliedSillyPerryRef.current = state.lastSillyFilterPerry;
          setPerrySillyFilter(state.lastSillyFilterPerry);
        }

        if (state.lastChallenge && state.lastChallenge.ts > lastAppliedChallengeTsRef.current) {
          lastAppliedChallengeTsRef.current = state.lastChallenge.ts;
          // Apply the same host re-derivation as the SSE handlers so polling
          // doesn't leave a stale host ref locking out future rounds.
          if (state.lastChallenge.host === "nana" || state.lastChallenge.host === "perry") {
            const myRole = isPerry ? "perry" : "nana";
            challengeHostRef.current = (state.lastChallenge.host === myRole);
          }
          // Holding endsAt — applies on BOTH host and non-host so a
          // polling-only recovery still wakes the local setTimeout that
          // ends the "first to laugh" hold and transitions to result.
          if (state.lastChallenge.state === "holding" && typeof state.lastChallenge.endsAt === "number") {
            sillyHoldingEndsAtLocalRef.current = serverToLocal(state.lastChallenge.endsAt);
          }
          // Counting anchor — same dual-side update as the SSE handler:
          // both host and non-host refresh sillyChallengeStartTsRef
          // from the server-stamped startAt so the rAF tick on both
          // iPads anchors to the same wall-clock moment.
          const startAtRaw = state.lastChallenge.startAt ?? state.lastChallenge.startTs;
          if (state.lastChallenge.state === "counting" && typeof startAtRaw === "number") {
            const localStartTs = state.lastChallenge.startAt != null
              ? serverToLocal(startAtRaw)
              : startAtRaw; // legacy fallback
            sillyChallengeStartTsRef.current = localStartTs;
          }
          if (!challengeHostRef.current && state.lastChallenge.state) {
            if (state.lastChallenge.state === "counting" && typeof startAtRaw === "number") {
              // Non-host: transition state immediately (rAF tick is
              // already anchored from the block above).
              setLaughWinner(null);
              setSillyChallenge("counting");
              setSillyCountNum(3);
            } else {
              setSillyChallenge(state.lastChallenge.state as ChallengeState);
              if (state.lastChallenge.countNum != null) setSillyCountNum(state.lastChallenge.countNum);
            }
          }
        }

        if (state.lastLaughWinner && state.lastLaughWinner.ts > lastAppliedLaughTsRef.current) {
          lastAppliedLaughTsRef.current = state.lastLaughWinner.ts;
          setLaughWinner(state.lastLaughWinner.who);
        }

        // Chapter-end celebration overlay — polling fallback. If a fresh
        // chapter_end event arrived since we last applied, raise the
        // overlay locally. If the server has cleared lastChapterEnd, the
        // dismiss has already happened — drop the overlay.
        if (state.lastChapterEnd && state.lastChapterEnd.ts > lastAppliedChapterEndTsRef.current) {
          lastAppliedChapterEndTsRef.current = state.lastChapterEnd.ts;
          setChapterEndOverlay({
            chapterIndex: state.lastChapterEnd.chapterIndex,
            chapterTitle: state.lastChapterEnd.chapterTitle,
            chapterQuestion: state.lastChapterEnd.chapterQuestion,
            chapterTeaser: state.lastChapterEnd.chapterTeaser,
            isLastChapter: state.lastChapterEnd.isLastChapter,
            intendedNextPage: state.lastChapterEnd.intendedNextPage,
          });
        } else if (!state.lastChapterEnd) {
          // Server has no chapter-end card — drop ours unconditionally.
          // The previous version threw in a `Date.now() - ref > 1000`
          // threshold "to avoid clearing too early." That was the bug
          // Rick kept hitting: ref gets bumped by the SSE handler to
          // Date.now() (client clock), the server's lastChapterEnd.ts
          // lives on a different clock, and combined with Cloudflare
          // buffering the threshold could keep the overlay painted
          // indefinitely — "Chapter Complete stays on permanently."
          // setChapterEndOverlay(null) is idempotent when already null
          // (React bails on identical setState values), so firing every
          // poll tick where server is empty is free. The set branch
          // above is still guarded by `ts > ref`, so we won't clear a
          // chapter_end we haven't applied yet.
          setChapterEndOverlay(null);
        }
      } catch {
        // Silent — next tick will retry.
      }
    };
    // Fire once immediately so a freshly-mounted client catches up without
    // waiting the full interval. 400ms cadence: keeps the challenge
    // countdown perceived-instant on Cloudflare-buffered SSE (Rick: "the
    // challenge countdown lags behind Nana on Perry's iPad by approximately
    // one second"). Was 1000ms — worst case 1s delay before Perry's
    // "counting" screen appeared, which matched exactly his observation.
    void poll();
    const interval = setInterval(poll, 400);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, perryAuthenticated]);

  // ── PERRY MODE JAIL ──────────────────────────────────────────────────
  // Defensive backstop the comment on `perryHasJoined` (line ~7966)
  // promised for ages but never actually wrote. Rick keeps reporting:
  // "Perry's iPad opened to Alice before Nana had done anything."
  // The polling/SSE gates are best-effort and a few code paths still
  // slip through. The jail is the last line of defense — when Perry is
  // authenticated but has NOT yet received her first LIVE
  // phase_change/session_started event, ANY mode other than "onboarding"
  // is bogus by definition (Nana hasn't started a session), so force her
  // back to the waiting screen. The console.log captures the source
  // of the bad transition so we can fix the root cause on next repro.
  // Once `perryHasJoined` flips true the jail is permanently off until
  // the next PIN-login / invite reset.
  useEffect(() => {
    if (!perryAuthenticated) return;
    if (perryHasJoined) return;
    if (mode === "onboarding") return;
    // eslint-disable-next-line no-console
    console.log(`[mode-jail] Perry forced back to onboarding from mode="${mode}"`, new Error().stack);
    setMode("onboarding");
  }, [mode, perryAuthenticated, perryHasJoined]);

  const handleNanaAuth = async (isLogin: boolean, data: { displayName: string; firstName: string; lastName: string; email: string; password: string }) => {
    setAuthLoading(true);
    setAuthError("");
    try {
      let user: SafeUser;
      if (isLogin) {
        const res = await api.auth.login({ email: data.email, password: data.password });
        user = res.user;
      } else {
        const res = await api.auth.register({
          firstName: data.firstName,
          lastName: data.lastName,
          displayName: data.displayName,
          email: data.email,
          password: data.password,
          role: "nana",
        });
        user = res.user;
      }
      setCurrentUser(user);
      setNanaDisplayName(user.displayName || user.firstName);

      if (isLogin) {
        // On login, reuse existing connections rather than creating a new one every time
        const connsRes = await api.connections.list();
        const active = connsRes.connections.find(c => c.connection.status === "active");
        const pending = connsRes.connections.find(c => c.connection.status === "pending");
        const existing = active ?? pending;
        if (existing) {
          setConnectionId(existing.connection.id);
          setInviteToken(existing.connection.inviteToken);
          // Reset any stale server-side session state. Without this, if Nana
          // was mid-reading-session and just refreshed her browser (no clean
          // session_end fired), Perry's next connect would replay the stale
          // `mode: "reading"` from the server and yank her into reading
          // mode while Nana sits on her splash/login screen.
          api.sessions.publishEvent(existing.connection.id, "session_reset", {}).catch(() => {});
          // Local flag too — next mode change will re-fire session_started
          // and re-arm the broadcast gate on the server.
          sessionStartedFiredRef.current = false;
          // If there's already an active connection, Perry is already set up — skip to "You're connected!"
          setNanaOnboardingStep(existing.connection.status === "active" ? 3 : 2);
          return;
        }
      }

      // New registration (or no existing connections found) — create a fresh invite
      const invRes = await api.connections.invite();
      setInviteToken(invRes.inviteToken);
      setConnectionId(invRes.connection.id);
      setNanaOnboardingStep(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      if (msg.toLowerCase().includes("already exists")) {
        setAuthError("That email is already registered. Use the Log In tab instead.");
      } else {
        setAuthError(msg);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleNanaCodeSent = () => setNanaOnboardingStep(2);

  const handlePerryCodeSubmit = async (code: string) => {
    setAuthLoading(true);
    setPerryInviteError("");
    try {
      const res = await api.connections.lookup(code);
      setPerryLookupNanaName(res.nanaName);
      setConnectionId(res.connectionId);
      setNanaDisplayName(res.nanaName);
      if (res.needsPin) {
        // Perry already registered — skip profile setup and go straight to PIN
        perryConnRef.current = { connectionId: res.connectionId, childName: "", nanaName: res.nanaName };
        setPerryPinMode(true);
      } else {
        setPerryOnboardingStep(1);
      }
    } catch (err) {
      setPerryInviteError(err instanceof Error ? err.message : "Code not found. Double-check with your grandparent!");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleChildProfileConfirm = async (name: string, birthday: string | null, pin: string) => {
    if (!connectionId) return;
    setAuthLoading(true);
    try {
      await api.children.create({ connectionId, name, birthday, pin });
      // Save Perry's connection info to localStorage for PIN login next time
      const connData = { connectionId, childName: name, nanaName: nanaDisplayName };
      localStorage.setItem("nm_perry_conn", JSON.stringify(connData));
      perryConnRef.current = connData;
      // Same jail-arming as the PIN-login path: ensure Perry stays on the
      // "Waiting for Nana" screen even if any stale state on her side
      // tries to push her into reading mode before Nana publishes a live
      // session_started/phase_change event.
      setMode("onboarding");
      setSelectedBookId("alice");
      setNanaPage(1);
      setChildPage(1);
      perryActiveRef.current = false;
      setPerryHasJoined(false);
      startPerrySSE(connectionId);
      setPerryAuthenticated(true);
      setPerryOnboardingStep(2);
      setNanaOnboardingStep(3);
    } catch (err) {
      setPerryInviteError(err instanceof Error ? err.message : "Couldn't save profile. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  // SSE subscription for Perry's device (cross-device page/phase sync)
  const startPerrySSE = (connId: string) => {
    if (sseRef.current) sseRef.current.close();
    // withCredentials so the session cookie travels with the SSE
    // request when the api is on a different subdomain in production.
    // No-op in dev (same-origin via the Vite proxy).
    const es = new EventSource(api.sessions.streamUrl(connId), { withCredentials: true });
    sseRef.current = es;
    es.onmessage = (event) => {
      // Track the last time ANY message arrived. The health check below
      // uses this to detect "open but silent" SSE — Cloudflare Quick
      // Tunnels can leave the socket readyState=OPEN while buffering for
      // minutes; the previous CLOSED-only check wouldn't catch it.
      lastSseMessageTsRef.current = Date.now();
      try {
        const msg = JSON.parse(event.data) as { type: string; payload: Record<string, unknown>; serverTs?: number };
        // Refresh server-clock offset estimate on every message so any
        // server-anchored timestamp downstream (countdown startAt,
        // holding endsAt, etc.) converts to an accurate local time.
        if (msg.serverTs) updateServerOffset(msg.serverTs);
        if (msg.type === "page_change") {
          const newPage = msg.payload.page as number;
          const side = msg.payload.side as "L" | "R" | undefined;
          const samePage = newPage === childPageRef.current;
          // Apply side immediately — both spread-change and side-flip cases.
          // Side flips within the same spread happen in single-page mode
          // when advancePage steps L → R on Nana's side; we don't run the
          // page-flip animation for those (no actual paper turn).
          if (side === "L" || side === "R") setPageSide(side);
          // Keep `nanaPage` / `nanaPageRef` in lockstep with the page Nana
          // is actually on. Rick reported: "Perry can't control Nana's
          // pages — they get out of sync." Root cause: `advancePage` reads
          // `nanaPageRef.current` to compute the next page, but Perry's
          // SSE handler was only updating `childPage`. So on Perry's iPad
          // `nanaPage` stayed at 1 forever, and Perry's next-tap would
          // publish `page=2` regardless of where Nana actually was —
          // yanking Nana backward. Updating both refs here makes
          // `advancePage` work identically on either side.
          lastAppliedPageTsRef.current = Date.now();
          nanaPageRef.current = newPage;
          setNanaPage(newPage);
          if (samePage) return;
          setFlipDirection(newPage > childPageRef.current ? "forward" : "backward");
          setFlipFromPage(childPageRef.current);
          setFlipToPage(newPage);
          setChildFlipping(true);
          // Both sides hear the page turn — Perry's page audibly arrives the
          // moment Nana flips. Tactile + auditory sync.
          playPageTurn();
          haptic("light");
          setTimeout(() => { setChildPage(newPage); setChildFlipping(false); }, 500);
        } else if (msg.type === "page_mode") {
          // Nana toggled the page-mode dropdown — mirror exactly.
          const m = msg.payload.mode as "single" | "double" | undefined;
          const side = msg.payload.side as "L" | "R" | undefined;
          // eslint-disable-next-line no-console
          console.log(`[perry-sse] page_mode received: mode=${m} side=${side}`);
          if (m === "single" || m === "double") setPageMode(m);
          if (side === "L" || side === "R") setPageSide(side);
        } else if (msg.type === "book_change") {
          if (msg.payload.bookId) {
            lastAppliedBookIdTsRef.current = Date.now();
            setSelectedBookId(msg.payload.bookId as string);
          }
          if (msg.payload.page != null) {
            const pg = msg.payload.page as number;
            lastAppliedPageTsRef.current = Date.now();
            childPageRef.current = pg;
            setChildPage(pg);
            // Same fix applied in the page_change handler — keep
            // nanaPageRef in lockstep so Perry's advancePage computes
            // the right next page when she taps. Without this, opening
            // a chapter book at Chapter 2 (page 10) leaves Perry's
            // nanaPage stuck at 1; her first next-tap publishes page=2
            // and yanks Nana backward. Rick: "The Mouse in the House /
            // Chapter Books — child can't control pages."
            nanaPageRef.current = pg;
            setNanaPage(pg);
          }
          // Stamp so polling's lastBookChange backstop doesn't
          // re-apply this same event. Uses the server timestamp
          // from the SSE envelope so it matches what polling reads.
          if (typeof msg.serverTs === "number") {
            lastAppliedBookChangeTsRef.current = msg.serverTs;
          }
        } else if (msg.type === "library_scroll") {
          // Mirror Nana's bookshelf scroll position on Perry's side.
          // LibraryView applies it imperatively via useEffect.
          if (typeof msg.payload.top === "number") {
            setLibraryScrollTop(msg.payload.top);
          }
        } else if (msg.type === "session_reset") {
          // Nana refreshed / re-logged in. Server wiped its session state.
          // Re-arm Perry's mode-jail so she's not still showing a stale
          // reading-mode UI on a session that no longer exists. The next
          // session_started or in-session phase_change from Nana releases
          // her again. Rick: "if nana logouts while session and perry
          // will be lost as nana login again and perry will be on previous
          // session and nana will be on new." Without this case Perry's
          // SSE silently dropped session_reset events — server's state was
          // gone but her client kept rendering the prior mode.
          //
          // If Perry was in a session mode (not onboarding / not just
          // logged in), show the friendly "Nana stepped away" card for
          // 2.5s before her mode-jail drops her back to PIN. Avoids the
          // jarring "UI suddenly becomes login screen" experience.
          const wasInSession = modeRef.current !== "onboarding" && perryHasJoined;
          perryActiveRef.current = false;
          setPerryHasJoined(false);
          // Drop the silly-challenge host flag too. Otherwise the next
          // session inherits the prior round's host assignment and the
          // first challenge_state event collides with stale state on the
          // non-host iPad — part of the "iPads can't talk to each other"
          // lock Rick hit after the Three Little Pigs crash.
          challengeHostRef.current = false;
          if (wasInSession) {
            setPartnerLeftShown(true);
            window.setTimeout(() => setPartnerLeftShown(false), 2500);
          }
        } else if (msg.type === "current_state") {
          // Apply book + page first (no mode-jail concern with these — they
          // just sync the UI underneath whatever mode is active).
          if (msg.payload.bookId) {
            lastAppliedBookIdTsRef.current = Date.now();
            setSelectedBookId(msg.payload.bookId as string);
          }
          if (msg.payload.page != null) {
            const pg = msg.payload.page as number;
            lastAppliedPageTsRef.current = Date.now();
            childPageRef.current = pg;
            setChildPage(pg);
            nanaPageRef.current = pg;
            setNanaPage(pg);
          }
          // UNJAIL: when the server replays current_state, sessionAlive is
          // already guaranteed true (the server-side gate at dev-server
          // line ~401 only sends current_state when sessionAlive). So if
          // Perry is joining a real, active session, this is her cue to
          // follow Nana's current mode — not stay stuck on waiting.
          // Without this, Perry joining AFTER Nana already pressed Start
          // sat on the waiting screen forever ("can't move from the
          // screen, begin first session"). The previous-bug guard
          // (preventing stale-state replay from dragging her in) is
          // already handled server-side by isSessionExpired + sessionAlive.
          if (msg.payload.mode) {
            perryActiveRef.current = true;
            setPerryHasJoined(true);
            lastAppliedModeTsRef.current = Date.now();
            setMode(msg.payload.mode as Mode);
          }
          // Apply layout / theme / font / child-prompts immediately so when
          // Perry DOES transition, she's already in sync with Nana's reading
          // chrome. These don't move her off the waiting screen on their own.
          const layout = msg.payload.readingLayout as ReadingLayout | undefined;
          if (layout && (READING_LAYOUTS as readonly string[]).includes(layout)) {
            setReadingLayout(layout);
          }
          const theme = msg.payload.readingTheme as ReadingTheme | undefined;
          if (theme === "day" || theme === "sepia" || theme === "night") {
            setReadingTheme(theme);
          }
          const pgMode = msg.payload.pageMode as "single" | "double" | undefined;
          if (pgMode === "single" || pgMode === "double") setPageMode(pgMode);
          const pgSide = msg.payload.pageSide as "L" | "R" | undefined;
          if (pgSide === "L" || pgSide === "R") setPageSide(pgSide);
          if (typeof msg.payload.fontScale === "number") {
            const scale = msg.payload.fontScale as number;
            // Always sync the authoritative Nana scale for chunking,
            // even when Perry has overridden display.
            setNanaFontScale(scale);
            try { localStorage.setItem("nm_nana_font_scale", String(scale)); } catch {}
            if (!perryFontOverrideRef.current) setFontScale(scale);
          }
          if (typeof msg.payload.showChildIcebreakerPrompts === "boolean") {
            setShowChildIcebreakerPrompts(msg.payload.showChildIcebreakerPrompts as boolean);
          }
        } else if (msg.type === "phase_change") {
          // Apply book + page BEFORE mode so the receiver never lands in "reading"
          // with a stale selectedBookId.
          if (msg.payload.bookId) setSelectedBookId(msg.payload.bookId as string);
          if (msg.payload.page != null) {
            const pg = msg.payload.page as number;
            childPageRef.current = pg;
            setChildPage(pg);
            // Mirror to nanaPage too — see page_change handler comment.
            nanaPageRef.current = pg;
            setNanaPage(pg);
          }
          // Reset stale goodbye state when entering goodbye fresh — without
          // this, Perry's local `goodbyePhase` could still be 7 from a prior
          // session and she'd skip the new Ready stage entirely. The actual
          // countdown only starts when a separate `goodbye_start` event
          // arrives (Nana taps "Start Countdown").
          if (msg.payload.mode === "goodbye") {
            setGoodbyePhase(0);
            setGoodbyeStartTime(null);
          }
          // Apply subMode for familystories so Perry doesn't see a stale
          // "Nana is writing a memory" panel when Nana actually opened
          // the journal in browse mode from her home dashboard.
          if (msg.payload.mode === "familystories" && (msg.payload.subMode === "browse" || msg.payload.subMode === "write")) {
            setFamilyStoriesSubMode(msg.payload.subMode as FamilyStoriesSubMode);
          }
          // Stamp the bookId/page race guards if this phase_change carried
          // either field, so polling can't stomp the fresh value.
          if (msg.payload.bookId) lastAppliedBookIdTsRef.current = Date.now();
          if (msg.payload.page != null) lastAppliedPageTsRef.current = Date.now();
          // Also stamp the definitive lastBookChange ref so polling's
          // backstop doesn't re-apply this same change moments later.
          if (msg.payload.bookId && typeof msg.serverTs === "number") {
            lastAppliedBookChangeTsRef.current = msg.serverTs;
          }
          // Mark Perry as active — Nana actively published a mode change
          // for the live session, so polling can now apply mode normally
          // and the mode jail no longer applies.
          perryActiveRef.current = true;
          setPerryHasJoined(true);
          lastAppliedModeTsRef.current = Date.now();
          // Shared "Beginning your reading time…" beat on EVERY transition
          // into reading mode — fires on book confirmation, including
          // mid-session book changes. Previously this only fired on
          // `session_started`, which is one-shot per app lifecycle —
          // Perry missed the overlay on subsequent book confirms.
          // Rick: "this appears on nana side only why? it should be on
          // perry side too with fully sync."
          if (msg.payload.mode === "reading" && modeRef.current !== "reading") {
            setSessionBeginShown(true);
            window.setTimeout(() => setSessionBeginShown(false), 1200);
          }
          setMode(msg.payload.mode as Mode);
        } else if (msg.type === "pointer_highlight") {
          const p = msg.payload as { x: number; y: number; page: number };
          if (typeof p.x === "number" && typeof p.y === "number") {
            const ts = Date.now();
            lastAppliedPointerTsRef.current = ts;
            setPointerHighlight({ x: p.x, y: p.y, page: p.page, ts });
          }
        } else if (msg.type === "word_highlight") {
          const p = msg.payload as { side: "L" | "R"; index: number; page: number };
          if ((p.side === "L" || p.side === "R") && Number.isFinite(p.index)) {
            const ts = Date.now();
            lastAppliedWordTsRef.current = ts;
            setWordHighlight({ side: p.side, index: p.index, page: p.page, ts });
          }
        } else if (msg.type === "layout_change") {
          const l = msg.payload?.layout as ReadingLayout | undefined;
          if (l && (READING_LAYOUTS as readonly string[]).includes(l)) {
            setReadingLayout(l);
          }
        } else if (msg.type === "theme_change") {
          const t = msg.payload?.theme as ReadingTheme | undefined;
          if (t === "day" || t === "sepia" || t === "night") {
            setReadingTheme(t);
          }
        } else if (msg.type === "reaction") {
          const r = msg.payload as unknown as ReactionEvent;
          if (r?.emoji) {
            const ts = r.ts ?? Date.now();
            lastAppliedReactionTsRef.current = ts;
            setCurrentReaction({ ...r, ts });
          }
        } else if (msg.type === "session_started") {
          // Live signal that Nana started a session — Perry can now follow.
          perryActiveRef.current = true;
          setPerryHasJoined(true);
          // Shared "Beginning your reading time…" beat. Mirrors Nana's
          // local fire in handleConfirmBook so both iPads show the
          // overlay together. Cleared after 1.2s.
          setSessionBeginShown(true);
          window.setTimeout(() => setSessionBeginShown(false), 1200);
          // NOTE: do NOT setMode here. Nana always follows session_started
          // with a phase_change (~50-150ms later) that carries her actual
          // current mode (typically "greeting"). Setting mode to a default
          // "icebreaker" here caused a visible flash of the IcebreakerView
          // before phase_change arrived and overrode it — Rick: "briefly
          // showed what looked like the Show and Tell or Start a
          // Conversation video screen, blinked and immediately disappeared,
          // jumping straight into the book." The 1.2s SessionBeginOverlay
          // above visually covers the brief gap until phase_change lands.
        } else if (msg.type === "font_change") {
          const scale = msg.payload.scale as number;
          // Always track Nana's authoritative scale — chunking for
          // chapter books (Wish 2) keys off this so Perry's display
          // chunks the same way Nana's does even when Perry has
          // overridden her local display font.
          setNanaFontScale(scale);
          try { localStorage.setItem("nm_nana_font_scale", String(scale)); } catch {}
          // Perry override gate: once Perry has picked her own font on
          // this iPad, ignore Nana-originated font_change for VISUAL
          // display. Her tap (deviceView==="perry" branch in
          // applyFontScale) sets the persisted override flag.
          if (perryFontOverrideRef.current) return;
          lastAppliedFontTsRef.current = Date.now();
          setFontScale(scale);
          localStorage.setItem("nm_font_scale", String(scale));
        } else if (msg.type === "session_end") {
          lastAppliedSessionEndTsRef.current = Date.now();
          // Drop the chapter-end celebration card if it's still up. Without
          // this, Stop-Here from a chapter-end card leaves Perry's overlay
          // painted on top of the familystories screen permanently — the
          // dismiss event raced with session_end and the polling clear path
          // couldn't see it. Rick: "Chapter Complete stays on permanently."
          setChapterEndOverlay(null);
          setFamilyStoriesSubMode("write");
          setMode("familystories");
        } else if (msg.type === "session_complete") {
          // Nana finished saving her memory and tapped Back. Take Perry
          // back to the PIN screen so both iPads end the session
          // together — Rick: "They should both transition together."
          setMode("onboarding");
          setPerryPinMode(true);
        } else if (msg.type === "schedule_proposal") {
          lastAppliedScheduleTsRef.current = Date.now();
          const date = new Date(msg.payload.date as string);
          const time = msg.payload.time as string;
          setScheduleProposal({ date, time, proposedBy: "nana" });
          setNanaScheduleAccepted(true);
          setPerryScheduleAccepted(false);
        } else if (msg.type === "schedule_accept") {
          lastAppliedScheduleTsRef.current = Date.now();
          if (msg.payload.by === "nana") setNanaScheduleAccepted(true);
          else if (msg.payload.by === "perry") setPerryScheduleAccepted(true);
        } else if (msg.type === "schedule_reset") {
          // Either side tapped "Change time" — wipe the booked proposal
          // on this iPad so the picker comes back. The publisher already
          // cleared their own local state before publishing.
          lastAppliedScheduleTsRef.current = Date.now();
          setScheduleProposal(null);
          setNanaScheduleAccepted(false);
          setPerryScheduleAccepted(false);
          // Surface a banner only when the OTHER side initiated. Perry's
          // SSE handler — partner is Nana, so `by === "nana"` triggers.
          // Own-side echoes (`by === "perry"`) don't show a banner.
          if (msg.payload.by === "nana") {
            setPartnerRequestedReschedule("nana");
            window.setTimeout(() => setPartnerRequestedReschedule(null), 5000);
          }
        } else if (msg.type === "child_added") {
          // Nana added a sibling on her iPad — refetch the children list
          // so Perry-side's PIN screen can show the new avatar without
          // requiring a page reload.
          if (connectionId) {
            api.children.list(connectionId).then(setChildren).catch(() => {});
          }
        } else if (msg.type === "active_child_change") {
          // Nana picked a different sibling from her home or the
          // post-session prompt. Mirror it locally so Perry-side reads
          // the new active child. Use the raw setter (not setActiveChildId)
          // to avoid publishing the event back to the server.
          const nextId = msg.payload?.childId as string | undefined;
          if (nextId) {
            setActiveChildIdRaw(nextId);
            try { localStorage.setItem("nm_active_child_id", nextId); } catch {}
          }
        } else if (msg.type === "challenge_state") {
          // If the publisher tagged itself as host, re-derive challengeHostRef.
          // Without this, Perry tapping "Play Again" after a round Nana
          // hosted leaves Nana's ref=true and her handler stops applying
          // events for Round 2.
          if (msg.payload.host === "nana" || msg.payload.host === "perry") {
            const myRole = perryAuthenticated ? "perry" : "nana";
            challengeHostRef.current = (msg.payload.host === myRole);
          }
          // Capture the holding endsAt for BOTH host and non-host —
          // both sides schedule their own setTimeout to transition
          // out of holding into result at the shared server-clock
          // moment, instead of the non-host waiting for Nana's SSE
          // round trip after her local 6s timeout. Stored as a
          // local-clock target via serverToLocal so the local
          // setTimeout fires accurately on each iPad.
          if (msg.payload.state === "holding" && typeof msg.payload.endsAt === "number") {
            sillyHoldingEndsAtLocalRef.current = serverToLocal(msg.payload.endsAt as number);
          }
          // Sync the 3-2-1 countdown anchor for BOTH host and non-host.
          // Without this, the host's anchor was `Date.now() + 1500`
          // (her local clock at tap) while the non-host's anchor was
          // `serverToLocal(serverNow_at_publish + 1500)` — these
          // differ by the publisher→server propagation time, leaving
          // Perry's countdown ~full-RTT behind Nana's. Updating the
          // host's ref to the server-stamped value lets both rAF
          // ticks anchor identically and tick in lockstep. The
          // monotonic-decreasing guard on the rAF tick keeps "3"
          // displayed throughout the ref adjustment, so the update
          // is invisible.
          const startAtRaw = (msg.payload.startAt as number | undefined) ?? (msg.payload.startTs as number | undefined);
          if (msg.payload.state === "counting" && typeof startAtRaw === "number") {
            const localStartTs = msg.payload.startAt != null
              ? serverToLocal(startAtRaw)
              : startAtRaw; // legacy path — publisher clock as-is
            sillyChallengeStartTsRef.current = localStartTs;
          }
          if (!challengeHostRef.current) {
            lastAppliedChallengeTsRef.current = Date.now();
            if (msg.payload.state === "counting" && typeof startAtRaw === "number") {
              // Non-host: transition to counting state IMMEDIATELY so the
              // result panel hides and the countdown overlay appears.
              // The rAF tick (anchored to localStartTs set above)
              // freezes at "3" until the server-stamped moment is
              // reached, then ticks 3→2→1 in lockstep with the host.
              setLaughWinner(null);
              setSillyChallenge("counting");
              setSillyCountNum(3);
            } else {
              // Non-counting states (flash, holding, result) are short
              // and only published by the host — applying immediately
              // is fine and keeps those transitions snappy.
              setSillyChallenge(msg.payload.state as ChallengeState);
              if (msg.payload.countNum != null) setSillyCountNum(msg.payload.countNum as number);
            }
          }
        } else if (msg.type === "silly_filter") {
          if (msg.payload.who === "nana") {
            const f = msg.payload.filter as string;
            lastAppliedSillyNanaRef.current = f;
            setNanaSillyFilter(f);
          } else if (msg.payload.who === "perry") {
            const f = msg.payload.filter as string;
            lastAppliedSillyPerryRef.current = f;
            setPerrySillyFilter(f);
          }
        } else if (msg.type === "laugh_winner") {
          lastAppliedLaughTsRef.current = Date.now();
          // `who: null` is the reset signal sent by handleEndChallenge —
          // both sides drop back to the regular Silly Faces screen.
          const who = msg.payload.who;
          setLaughWinner(who === "nana" || who === "perry" ? who : null);
        } else if (msg.type === "chapter_end") {
          // Nana crossed a chapter boundary — both iPads show the
          // celebratory overlay until she taps Next Chapter or End here.
          lastAppliedChapterEndTsRef.current = Date.now();
          setChapterEndOverlay({
            chapterIndex: msg.payload.chapterIndex as number,
            chapterTitle: msg.payload.chapterTitle as string,
            chapterQuestion: msg.payload.chapterQuestion as string,
            chapterTeaser: msg.payload.chapterTeaser as string | undefined,
            isLastChapter: !!msg.payload.isLastChapter,
            intendedNextPage: msg.payload.intendedNextPage as number,
          });
        } else if (msg.type === "chapter_end_dismiss") {
          setChapterEndOverlay(null);
        } else if (msg.type === "toggle_child_prompts") {
          setShowChildIcebreakerPrompts(msg.payload.show as boolean);
        } else if (msg.type === "goodbye_start") {
          // Convert the server-stamped startAt to THIS iPad's local
          // clock via the EMA-tracked offset. Guarded: if a local
          // anchor was already set (publisher tap), don't overwrite
          // it. Receiver-side (Perry) has goodbyeStartTime=null here
          // so the converted value is applied as her anchor.
          const startAt = (msg.payload.startAt as number) ?? (msg.payload.startTime as number);
          const localStart = typeof startAt === "number" ? serverToLocal(startAt) : Date.now();
          setGoodbyeStartTime((prev) => (prev !== null ? prev : localStart));
          setGoodbyePhase(0);
          setMode("goodbye");
        } else if (msg.type === "goodbye_phase") {
          // Monotonic guard — see polling handler above. Phase 0
          // (explicit reset) and 7 (terminal skip) both go through; the
          // monotonic test only filters interior 1-6 races where a late
          // Nana publish would otherwise yank Perry's countdown back.
          const phase = msg.payload.phase as number;
          setGoodbyePhase((prev) => (phase === 0 || phase >= prev ? phase : prev));
          if (phase === 7) setMode("goodbye");
        }
      } catch {}
    };
  };

  // SSE subscription for Nana's device — receives phase changes Perry initiates + schedule accepts
  const startNanaSSE = (connId: string) => {
    if (nanaSseRef.current) nanaSseRef.current.close();
    // withCredentials so the session cookie travels with the SSE
    // request when the api is on a different subdomain in production.
    // No-op in dev (same-origin via the Vite proxy).
    const es = new EventSource(api.sessions.streamUrl(connId), { withCredentials: true });
    nanaSseRef.current = es;
    es.onmessage = (event) => {
      lastSseMessageTsRef.current = Date.now();
      try {
        const msg = JSON.parse(event.data) as { type: string; payload: Record<string, unknown>; serverTs?: number };
        // Refresh server-clock offset estimate on every message so any
        // server-anchored timestamp downstream (countdown startAt,
        // holding endsAt, etc.) converts to an accurate local time.
        if (msg.serverTs) updateServerOffset(msg.serverTs);
        if (msg.type === "page_change") {
          const newPage = msg.payload.page as number;
          const side = msg.payload.side as "L" | "R" | undefined;
          // Apply pageSide first — Rick: "if its one page selected on
          // top, then perry needs to tap twice to change, if its two
          // page selected then it works fine." Root cause: in
          // single-page mode, Perry's first tap publishes a page_change
          // with the SAME page number but a flipped `side` (L→R within
          // the same spread). Without applying `side`, Nana saw a no-op
          // for that first tap. The second tap then advances the spread
          // and finally surfaces a visible change.
          if (side === "L" || side === "R") setPageSide(side);
          // Snapshot the OLD ref value for direction/from-page calculation
          // BEFORE we overwrite it. Then bump the ref synchronously so a
          // second page_change arriving moments later doesn't recompute
          // the direction off the (now stale) ref value while React is
          // still mid-render of the first update.
          const oldRef = nanaPageRef.current;
          nanaPageRef.current = newPage;
          setNanaPage(newPage);
          const dir: "forward" | "backward" = newPage > oldRef ? "forward" : "backward";
          setFlipDirection(dir);
          setFlipFromPage(oldRef);
          setFlipToPage(newPage);
          setBusy(true);
          setTimeout(() => { setBusy(false); }, 500);
        } else if (msg.type === "phase_change") {
          // Atomic mode + book + page application — eliminates race conditions
          // when Nana's own events echo back via SSE.
          if (msg.payload.bookId) setSelectedBookId(msg.payload.bookId as string);
          if (msg.payload.page != null) {
            const pg = msg.payload.page as number;
            nanaPageRef.current = pg;
            setNanaPage(pg);
          }
          // Symmetric with Perry's handler: reset stale goodbye state when
          // entering goodbye fresh, so the Ready stage shows even if a
          // prior session ended at phase 7.
          if (msg.payload.mode === "goodbye") {
            setGoodbyePhase(0);
            setGoodbyeStartTime(null);
          }
          setMode(msg.payload.mode as Mode);
        } else if (msg.type === "pointer_highlight") {
          const p = msg.payload as { x: number; y: number; page: number };
          if (typeof p.x === "number" && typeof p.y === "number") {
            const ts = Date.now();
            lastAppliedPointerTsRef.current = ts;
            setPointerHighlight({ x: p.x, y: p.y, page: p.page, ts });
          }
        } else if (msg.type === "word_highlight") {
          const p = msg.payload as { side: "L" | "R"; index: number; page: number };
          if ((p.side === "L" || p.side === "R") && Number.isFinite(p.index)) {
            const ts = Date.now();
            lastAppliedWordTsRef.current = ts;
            setWordHighlight({ side: p.side, index: p.index, page: p.page, ts });
          }
        } else if (msg.type === "layout_change") {
          const l = msg.payload?.layout as ReadingLayout | undefined;
          if (l && (READING_LAYOUTS as readonly string[]).includes(l)) {
            setReadingLayout(l);
          }
        } else if (msg.type === "theme_change") {
          const t = msg.payload?.theme as ReadingTheme | undefined;
          if (t === "day" || t === "sepia" || t === "night") {
            setReadingTheme(t);
          }
        } else if (msg.type === "reaction") {
          const r = msg.payload as unknown as ReactionEvent;
          if (r?.emoji) {
            const ts = r.ts ?? Date.now();
            lastAppliedReactionTsRef.current = ts;
            setCurrentReaction({ ...r, ts });
          }
        } else if (msg.type === "current_state") {
          // Resync after a mid-session SSE reconnect. Nana is authoritative
          // for her own mode — every screen she enters is published by her,
          // so the server's `state.mode` is always either echoing her last
          // publish or stale. Only restore mode from the server when she
          // genuinely has no local mode of her own (true refresh recovery
          // from "onboarding"). Otherwise a stale current_state replay can
          // race with a freshly-entered mode and yank her off the screen
          // she just opened — e.g. Start Reading lands her in "greeting",
          // then a stale "sillyfaces" replay drops her into Silly Faces.
          if (msg.payload.mode && modeRef.current === "onboarding") {
            setMode(msg.payload.mode as Mode);
          }
          if (msg.payload.bookId && modeRef.current !== "library") setSelectedBookId(msg.payload.bookId as string);
          if (msg.payload.page != null) {
            const pg = msg.payload.page as number;
            nanaPageRef.current = pg;
            setNanaPage(pg);
          }
        } else if (msg.type === "book_change") {
          if (msg.payload.bookId) setSelectedBookId(msg.payload.bookId as string);
          if (msg.payload.page != null) {
            const pg = msg.payload.page as number;
            nanaPageRef.current = pg;
            setNanaPage(pg);
          }
        } else if (msg.type === "schedule_accept") {
          lastAppliedScheduleTsRef.current = Date.now();
          if (msg.payload.by === "perry") setPerryScheduleAccepted(true);
          else if (msg.payload.by === "nana") setNanaScheduleAccepted(true);
        } else if (msg.type === "schedule_reset") {
          // Symmetric with the Perry-side handler — wipe the proposal
          // on this iPad so the picker reappears whichever side hit
          // "Change time".
          lastAppliedScheduleTsRef.current = Date.now();
          setScheduleProposal(null);
          setNanaScheduleAccepted(false);
          setPerryScheduleAccepted(false);
          // Nana's SSE — partner is Perry, so `by === "perry"` is the
          // partner-initiated case. Show the banner so Nana knows
          // why the picker reappeared. Own echoes (`by === "nana"`)
          // skip the banner.
          if (msg.payload.by === "perry") {
            setPartnerRequestedReschedule("perry");
            window.setTimeout(() => setPartnerRequestedReschedule(null), 5000);
          }
        } else if (msg.type === "child_added") {
          // Mirrors the Perry-side handler — refetch children list so
          // multi-iPad Nana setups (rare but possible) see the new
          // sibling without a reload.
          if (connectionId) {
            api.children.list(connectionId).then(setChildren).catch(() => {});
          }
        } else if (msg.type === "active_child_change") {
          const nextId = msg.payload?.childId as string | undefined;
          if (nextId) {
            setActiveChildIdRaw(nextId);
            try { localStorage.setItem("nm_active_child_id", nextId); } catch {}
          }
        } else if (msg.type === "goodbye_start") {
          // Convert the server-stamped startAt to this iPad's local
          // clock via the EMA-tracked offset. Guarded: if a local
          // anchor was already set by handleBeginGoodbyeCountdown
          // (publisher tap), don't overwrite it — the tap-time
          // anchor matches the user's tap moment exactly, while the
          // echo-time conversion would shift Nana's countdown by the
          // publish RTT (~50ms) for no visible benefit. Perry's
          // goodbyeStartTime is null at this point so she gets the
          // converted value as her anchor.
          const startAt = (msg.payload.startAt as number) ?? (msg.payload.startTime as number);
          const localStart = typeof startAt === "number" ? serverToLocal(startAt) : Date.now();
          setGoodbyeStartTime((prev) => (prev !== null ? prev : localStart));
          setGoodbyePhase(0);
          setMode("goodbye");
        } else if (msg.type === "goodbye_phase") {
          // Mirror the Perry-side handler — both iPads guard against
          // backward writes from late-arriving SSE events.
          const phase = msg.payload.phase as number;
          setGoodbyePhase((prev) => (phase === 0 || phase >= prev ? phase : prev));
          if (phase === 7) setMode("goodbye");
        } else if (msg.type === "challenge_state") {
          // Re-derive host so Round-N publisher's identity is respected
          // (matches the Perry-side handler at line ~7948).
          if (msg.payload.host === "nana" || msg.payload.host === "perry") {
            const myRole = perryAuthenticated ? "perry" : "nana";
            challengeHostRef.current = (msg.payload.host === myRole);
          }
          // Capture the holding endsAt for BOTH host and non-host —
          // both sides schedule their own setTimeout to transition
          // out of holding into result at the shared server-clock
          // moment, instead of the non-host waiting for Nana's SSE
          // round trip after her local 6s timeout. Stored as a
          // local-clock target via serverToLocal so the local
          // setTimeout fires accurately on each iPad.
          if (msg.payload.state === "holding" && typeof msg.payload.endsAt === "number") {
            sillyHoldingEndsAtLocalRef.current = serverToLocal(msg.payload.endsAt as number);
          }
          // Sync the 3-2-1 countdown anchor for BOTH host and non-host.
          // Without this, the host's anchor was `Date.now() + 1500`
          // (her local clock at tap) while the non-host's anchor was
          // `serverToLocal(serverNow_at_publish + 1500)` — these
          // differ by the publisher→server propagation time, leaving
          // Perry's countdown ~full-RTT behind Nana's. Updating the
          // host's ref to the server-stamped value lets both rAF
          // ticks anchor identically and tick in lockstep. The
          // monotonic-decreasing guard on the rAF tick keeps "3"
          // displayed throughout the ref adjustment, so the update
          // is invisible.
          const startAtRaw = (msg.payload.startAt as number | undefined) ?? (msg.payload.startTs as number | undefined);
          if (msg.payload.state === "counting" && typeof startAtRaw === "number") {
            const localStartTs = msg.payload.startAt != null
              ? serverToLocal(startAtRaw)
              : startAtRaw; // legacy path — publisher clock as-is
            sillyChallengeStartTsRef.current = localStartTs;
          }
          if (!challengeHostRef.current) {
            lastAppliedChallengeTsRef.current = Date.now();
            if (msg.payload.state === "counting" && typeof startAtRaw === "number") {
              // Non-host: transition to counting state IMMEDIATELY so the
              // result panel hides and the countdown overlay appears.
              // The rAF tick (anchored to localStartTs set above)
              // freezes at "3" until the server-stamped moment is
              // reached, then ticks 3→2→1 in lockstep with the host.
              setLaughWinner(null);
              setSillyChallenge("counting");
              setSillyCountNum(3);
            } else {
              // Non-counting states (flash, holding, result) are short
              // and only published by the host — applying immediately
              // is fine and keeps those transitions snappy.
              setSillyChallenge(msg.payload.state as ChallengeState);
              if (msg.payload.countNum != null) setSillyCountNum(msg.payload.countNum as number);
            }
          }
        } else if (msg.type === "silly_filter") {
          if (msg.payload.who === "nana") {
            const f = msg.payload.filter as string;
            lastAppliedSillyNanaRef.current = f;
            setNanaSillyFilter(f);
          } else if (msg.payload.who === "perry") {
            const f = msg.payload.filter as string;
            lastAppliedSillyPerryRef.current = f;
            setPerrySillyFilter(f);
          }
        } else if (msg.type === "laugh_winner") {
          lastAppliedLaughTsRef.current = Date.now();
          // `who: null` is the reset signal sent by handleEndChallenge —
          // both sides drop back to the regular Silly Faces screen.
          const who = msg.payload.who;
          setLaughWinner(who === "nana" || who === "perry" ? who : null);
        } else if (msg.type === "chapter_end") {
          // Nana's own publish echoes back via SSE — applying is idempotent
          // (her local state was already set by changePage interception).
          // Apply anyway so a reconnect-after-fire still recovers the overlay.
          lastAppliedChapterEndTsRef.current = Date.now();
          setChapterEndOverlay({
            chapterIndex: msg.payload.chapterIndex as number,
            chapterTitle: msg.payload.chapterTitle as string,
            chapterQuestion: msg.payload.chapterQuestion as string,
            chapterTeaser: msg.payload.chapterTeaser as string | undefined,
            isLastChapter: !!msg.payload.isLastChapter,
            intendedNextPage: msg.payload.intendedNextPage as number,
          });
        } else if (msg.type === "chapter_end_dismiss") {
          setChapterEndOverlay(null);
        }
      } catch {}
    };
  };

  // Perry returning: PIN login
  const resetPerryToInviteEntry = (errorMessage?: string) => {
    try { localStorage.removeItem("nm_perry_conn"); } catch {}
    perryConnRef.current = null;
    setPerryPinMode(false);
    setPerryPinError("");
    setConnectionId(null);
    setPerryAuthenticated(false);
    setAuthenticatedChildId(null);
    setPerryOnboardingStep(0);
    if (errorMessage) setPerryInviteError(errorMessage);
  };

  const handlePerryPinLogin = async (pin: string) => {
    const data = perryConnRef.current;
    if (!data) return;
    setPerryPinLoading(true);
    setPerryPinError("");
    try {
      const res = await api.children.pinLogin(data.connectionId, pin);
      setConnectionId(res.connectionId);
      setNanaDisplayName(res.nanaName);
      // Bind this iPad to the child who just authenticated. Mismatch
      // with activeChildId (set by Nana's home picker) triggers a
      // re-login prompt — that's how Cooper takes the iPad over from
      // Perry without a stale session.
      if (res.child?.id) {
        setAuthenticatedChildId(res.child.id);
        // Broadcast that this child is now the active sibling so
        // Nana's iPad updates her picker without waiting for the next
        // poll tick.
        setActiveChildId(res.child.id);
      }
      // Update the cached child name to whichever child PIN-matched. This is
      // how multi-child support works: Cooper's PIN authenticates as Cooper,
      // Perry's PIN as Perry — even on the same device.
      const connData = {
        connectionId: res.connectionId,
        childName: res.child?.name ?? data.childName,
        nanaName: res.nanaName,
      };
      try { localStorage.setItem("nm_perry_conn", JSON.stringify(connData)); } catch {}
      perryConnRef.current = connData;
      setPerryPinMode(false);
      // Force Perry to her waiting screen on every fresh PIN-login. Without
      // this, any stale React state (mode='reading', a previous bookId,
      // a previous layout) preserved across reloads or HMR keeps Perry
      // showing the prior session's UI instead of the "Waiting for Nana"
      // screen. From here she can only transition out via a fresh LIVE
      // event from a session that becomes active AFTER she connects.
      setMode("onboarding");
      setSelectedBookId("alice");
      setNanaPage(1);
      setChildPage(1);
      // Block polling AND jail Perry on her waiting screen until she
      // receives her first LIVE phase_change/session_started event.
      perryActiveRef.current = false;
      setPerryHasJoined(false);
      startPerrySSE(res.connectionId);
      setPerryAuthenticated(true);
      setPerryOnboardingStep(2);
      // Brief celebration so the PIN tap has visible positive feedback.
      // Cleared after 1.6s — long enough to read, short enough not to
      // delay Nana's first phase_change reaching the waiting view.
      setPerryJustLoggedIn(true);
      window.setTimeout(() => setPerryJustLoggedIn(false), 1600);
    } catch (err) {
      // If the cached connection is gone server-side (dev-server restarted,
      // invite expired, etc.), don't get stuck on the PIN screen — auto-clear
      // the stale localStorage and bounce back to the invite-code entry.
      if (err instanceof ApiError && (err.reason === "connection_gone" || err.reason === "no_child")) {
        resetPerryToInviteEntry(
          err.reason === "connection_gone"
            ? "That invite is no longer active — please ask Nana for a fresh code."
            : "No grandchild profile here yet. Use a fresh invite code to set one up."
        );
        return;
      }
      setPerryPinError(err instanceof Error ? err.message : "Incorrect PIN. Try again!");
    } finally {
      setPerryPinLoading(false);
    }
  };

  const handleUseDifferentInvite = () => resetPerryToInviteEntry();

  /**
   * Add a sibling to the SAME family/connection. Skips invite-code
   * entry — keeps the existing connectionId, drops PIN mode, and goes
   * straight to the child profile setup. Rick: "I went to switch from
   * Perry to Cooper, put Perry's PIN in by mistake, and then could not
   * get back to enter Cooper's PIN."
   *
   * Pre-condition: perryConnRef.current is non-null (we have a cached
   * connection from Perry's prior login). The PIN screen only shows in
   * that case, so this handler is only callable from there.
   */
  const handleAddSibling = () => {
    const cached = perryConnRef.current;
    if (cached?.connectionId) {
      // Make sure App-level connectionId is set so handleChildProfileConfirm
      // can write the new child against the right connection.
      setConnectionId(cached.connectionId);
      setNanaDisplayName(cached.nanaName);
    }
    setPerryPinError("");
    setPerryPinMode(false);
    setPerryOnboardingStep(1);
  };

  // ── PERRY-CONNECTED INDICATOR ────────────────────────────────────────
  // Once Perry has entered her PIN or invite code, the server flips the
  // connection's status to "active". Nana's home screen shows a "Perry
  // is here, waiting" badge based on this. Polls every 3s as long as
  // Nana is authenticated and a connection exists. Rick: "even perry is
  // waiting at connected screen and nana is on homepage, then nana
  // should be informed here."
  const [perryConnected, setPerryConnected] = useState(false);

  // Controls the AddChildModal visibility. Opened from NanaHomeView's
  // ChildPicker "Add a sibling" tile and (Phase C) from the
  // post-session SwitchChildPrompt.
  const [addChildModalOpen, setAddChildModalOpen] = useState(false);
  // Transient "Cooper added" toast — explains the next step ("he'll
  // use the same iPad as Perry, just have him enter his PIN") so Nana
  // isn't left wondering whether she needs to send a new invite or
  // configure anything on the kid's side. Cleared by setTimeout below.
  const [addChildToast, setAddChildToast] = useState<{ name: string } | null>(null);

  // ── Multi-child handlers (used by NanaHomeView's ChildPicker + the
  // post-session SwitchChildPrompt) ───────────────────────────────────
  // Switch Nana's active sibling. Local state + persistence are handled
  // by `setActiveChildId`, which also broadcasts the active_child_change
  // SSE event. Clears any in-flight book selection so Cooper doesn't
  // inherit Perry's mid-pick state.
  const handleSelectChild = useCallback((childId: string) => {
    if (childId === activeChildId) return;
    setActiveChildId(childId);
    // Drop the currently-selected book — each sibling lands on the
    // library / continue-reading widget fresh. Without this, Nana's
    // home dashboard would show the previous child's "Continue X"
    // suggestion against Cooper's freshly-loaded progress rows.
    setSelectedBookId("");
  }, [activeChildId, setActiveChildId]);

  // Create a new sibling on this connection. Called from the home
  // ChildPicker's "Add a sibling" tile. The created child becomes the
  // new active sibling immediately so Nana can start a session with
  // them without an extra tap. Broadcasts `child_added` so any open
  // Perry iPad refreshes its PIN-screen avatar list.
  const handleAddChild = useCallback(async (body: { name: string; birthday: string | null; pin: string }) => {
    if (!connectionId) throw new Error("No active connection");
    const created = await api.children.create({ connectionId, ...body });
    setChildren((curr) => [...curr, created]);
    setActiveChildId(created.id);
    api.sessions.publishEvent(connectionId, "child_added", { childId: created.id }).catch(() => {});
    // Surface a brief "What's next?" hint so Nana isn't left guessing.
    // The kid's iPad already has the family's invite — Cooper just
    // needs to enter his PIN there. No new URL to send.
    setAddChildToast({ name: created.name });
    return created;
  }, [connectionId, setActiveChildId]);

  // Auto-clear the toast 8s after it appears (long enough to read,
  // short enough not to linger past the moment).
  useEffect(() => {
    if (!addChildToast) return;
    const t = window.setTimeout(() => setAddChildToast(null), 8000);
    return () => window.clearTimeout(t);
  }, [addChildToast]);
  useEffect(() => {
    if (!connectionId || perryAuthenticated) return; // Nana side only
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const { status } = await api.connections.status(connectionId);
        if (!cancelled) setPerryConnected(status === "active");
      } catch {}
    };
    void poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [connectionId, perryAuthenticated]);

  // Nana polls for Perry joining while on the waiting screen
  useEffect(() => {
    if (nanaOnboardingStep !== 2 || !connectionId) return;
    const interval = setInterval(async () => {
      try {
        const { status } = await api.connections.status(connectionId);
        if (status === "active") setNanaOnboardingStep(3);
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [nanaOnboardingStep, connectionId]);

  // Perry-side: pre-fetch the children list whenever she lands on the
  // PIN keypad. The OnboardingView shows an avatar pill for each
  // sibling so the parent can see who exists on this iPad before
  // typing. Cheap call, idempotent — re-fetched on every PIN-screen
  // entry in case Nana added a sibling between Perry sessions and
  // the child_added SSE event missed (offline iPad, etc.).
  useEffect(() => {
    if (!perryPinMode || !connectionId) return;
    api.children.list(connectionId).then(setChildren).catch(() => {});
  }, [perryPinMode, connectionId]);

  // Cooper-takeover prompt — when Nana switches her active sibling
  // (via the home picker or the post-session Switch-Child prompt) to
  // a child OTHER than the one currently logged in on this iPad,
  // bounce back to the PIN keypad so the new sibling can authenticate.
  // Without this, Nana's app would record progress against Cooper
  // while Perry was still in front of the camera, and the kid's iPad
  // would happily keep showing Perry's session UI. Gated tight so it
  // can't fire pre-auth (both states must be non-null) and can't
  // fire on Nana's iPad (perryAuthenticated is false there).
  useEffect(() => {
    if (!perryAuthenticated) return;
    if (!authenticatedChildId || !activeChildId) return;
    if (authenticatedChildId === activeChildId) return;
    // Mismatch — drop back to PIN entry. Don't wipe perryConnRef so
    // the kid's iPad stays bound to the family connection; only the
    // child-level auth gets reset. Children list is already loaded
    // (or will refetch via the perryPinMode effect above).
    setPerryAuthenticated(false);
    setAuthenticatedChildId(null);
    setPerryPinMode(true);
    setMode("onboarding");
  }, [activeChildId, authenticatedChildId, perryAuthenticated, setAuthenticatedChildId]);

  // Fetch dashboard data when Nana reaches step 3 (connected). Loads
  // every sibling on the connection (not just children[0]) so the
  // home picker can render them all. activeChildId is preserved from
  // localStorage if it points to a still-existing child; otherwise
  // we fall back to the first sibling so Nana isn't stuck on an empty
  // selection after one of the kids is removed.
  useEffect(() => {
    if (nanaOnboardingStep !== 3 || !connectionId) return;
    setDashboardLoading(true);
    Promise.all([
      api.children.list(connectionId),
      api.progress.all(connectionId),
    ]).then(([childList, progressRes]) => {
      setChildren(childList);
      const savedId = (() => {
        try { return localStorage.getItem("nm_active_child_id"); } catch { return null; }
      })();
      const validSaved = childList.find((c) => c.id === savedId);
      const next = validSaved ?? childList[0] ?? null;
      if (next && next.id !== activeChildId) {
        setActiveChildId(next.id);
      }
      // First-load: filter the unscoped progress by the resolved child
      // so the dashboard doesn't briefly flash with rows belonging to
      // other siblings while the scoped re-fetch below is in flight.
      setDashboardProgress(
        next
          ? progressRes.progress.filter((p) => p.childId === next.id || p.childId == null)
          : progressRes.progress,
      );
    }).catch(() => {}).finally(() => setDashboardLoading(false));
    // activeChildId intentionally excluded — we read it once on fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nanaOnboardingStep, connectionId]);

  // Whenever the active sibling changes (via Nana's home picker or
  // the post-session "Read with another child" prompt), re-fetch the
  // per-child progress so the home dashboard + library Continue widget
  // show that sibling's bookmarks, not the previous child's. Gated on
  // nanaOnboardingStep so Perry's iPad doesn't pull a dashboard she
  // never renders.
  useEffect(() => {
    if (nanaOnboardingStep !== 3 || !connectionId || !activeChildId) return;
    api.progress.all(connectionId, activeChildId)
      .then((r) => setDashboardProgress(r.progress))
      .catch(() => {});
  }, [nanaOnboardingStep, connectionId, activeChildId]);

  // Rick's Wish 1: optional "video chat first" opening. Default lands
  // Nana on her home dashboard (current behaviour); flipping the
  // Settings toggle to "video" lands her directly on the greeting
  // stage instead — FaceTime-style live view of Perry, with a
  // "Pick a Book →" CTA when they're ready to start.
  const [openWith, setOpenWithState] = useState<"home" | "video">(() => {
    try {
      const stored = localStorage.getItem("nm_open_with");
      return stored === "video" ? "video" : "home";
    } catch { return "home"; }
  });
  const setOpenWith = useCallback((next: "home" | "video") => {
    setOpenWithState(next);
    try { localStorage.setItem("nm_open_with", next); } catch {}
  }, []);

  // After onboarding (step 3 dashboard), Nana lands on either the
  // home screen (default) or the live greeting stage (Wish 1 toggle).
  // SSE for her side starts here so server-pushed state is wired up
  // the moment she's logged in. In "video" mode we also fire
  // session_started so Perry's iPad transitions out of her waiting
  // screen and the two faces meet immediately.
  const handleBeginSession = () => {
    if (connectionId) {
      startNanaSSE(connectionId);
    }
    if (openWith === "video") {
      if (connectionId) {
        api.sessions.publishEvent(connectionId, "session_started", {}).catch(() => {});
        sessionStartedFiredRef.current = true;
      }
      shownThisSession.current.clear();
      setShowChildIcebreakerPrompts(false);
      setMode("greeting");
    } else {
      setMode("home");
    }
  };
  // Fire the actual reading-session start — published `session_started`
  // is what tells Perry's iPad to transition from her "Waiting for
  // Nana" screen into the icebreaker. This is now triggered by the
  // home screen's "Start Reading" button (or the dashboard's
  // "Begin with this book" shortcut).
  const handleStartReadingSession = () => {
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "session_started", {}).catch(() => {});
      // Mark fired locally so the auto-fire effect (which also covers the
      // dashboard-direct-to-library path) doesn't double-publish.
      sessionStartedFiredRef.current = true;
      startNanaSSE(connectionId);
    }
    // Re-arm the per-session "first-time" help cards. Same rationale as
    // the auto-fire path — without this, a Nana who does multiple
    // reading sessions back-to-back in one browser instance only sees
    // help cards on session 1. Auto-fire path also clears, but that
    // branch is skipped here because sessionStartedFiredRef is already
    // true after the line above.
    shownThisSession.current.clear();
    setShowChildIcebreakerPrompts(false);
    // Detour through the greeting view — Rick: "When both Nana and Perry
    // are logged in, it might be nice if they could see each other
    // briefly and say hello before the book is picked — kind of a 'both
    // cameras on' moment." 10s soft beat with both faces + a warm
    // banner, then Nana's countdown / "We're ready" button advances
    // everyone into the icebreaker. The phase_change effect picks up
    // setMode("greeting") and publishes it so Perry's screen follows.
    setMode("greeting");
  };
  // Greeting → primary "Pick a Book →" tap. Rick: "I would prefer Nana
  // to control when they move from chat to the library, not a timer."
  // Routes through handleStartReading which already handles both the
  // "Nana has a preSelectedBook from a home tile" path (skip library,
  // go straight to reading) and the normal "no pre-selection" path
  // (open library so Nana can pick). Also stash `closeReturnsTo` so if
  // Nana taps back inside the library, she returns to chat rather than
  // home / icebreaker.
  const handleGreetingReady = () => {
    setCloseReturnsTo("greeting");
    handleStartReading();
  };
  // Optional secondary path on the greeting screen: drops into the
  // existing IcebreakerView with rotating conversation prompts. Not the
  // default flow — only used when Nana taps "Conversation Starters".
  // From icebreaker, her existing "Pick Your Book" button continues to
  // work (also routes through handleStartReading).
  const handleGreetingShowPrompts = () => {
    setMode("icebreaker");
  };
  const handleBeginWithBook = (bookId: string, startPage: number) => {
    setPreSelectedBook({ bookId, startPage });
    handleStartReadingSession();
  };
  const handleSkipOnboarding = () => setMode("home");
  const handleNanaBack = () => setNanaOnboardingStep(s => Math.max(0, s - 1));
  const handlePerryBack = () => {
    if (perryOnboardingStep === 1) {
      setPerryOnboardingStep(0);
      setNanaOnboardingStep(2);
      setPerryInviteError("");
      setPerryLookupNanaName("");
    } else {
      setPerryOnboardingStep(s => Math.max(0, s - 1));
    }
  };

  const [promptIndex, setPromptIndex] = useState(0);
  const [childPromptIndex, setChildPromptIndex] = useState(0);
  const [showChildIcebreakerPrompts, setShowChildIcebreakerPrompts] = useState(false);
  const [showAndTellPromptIndex, setShowAndTellPromptIndex] = useState(0);
  const [nanaPage, setNanaPage] = useState(1);
  const [childPage, setChildPage] = useState(1);
  const childPageRef = useRef(1);
  useEffect(() => { childPageRef.current = childPage; }, [childPage]);
  const nanaPageRef = useRef(1);
  useEffect(() => { nanaPageRef.current = nanaPage; }, [nanaPage]);
  const [childFlipping, setChildFlipping] = useState(false);
  const [flipFromPage, setFlipFromPage] = useState(1);
  const [flipToPage, setFlipToPage] = useState(1);
  const [flipDirection, setFlipDirection] = useState<"forward" | "backward">("forward");
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedBookId, setSelectedBookId] = useState("alice");
  // Defensive: never let a stale or unknown bookId crash the render.
  // Falls back to the first book so the UI stays usable while the real
  // bookId arrives via SSE / current_state.
  const currentBook = booksLibrary[selectedBookId] ?? Object.values(booksLibrary)[0];
  const sessionStartPageRef = useRef(1);
  const [preSelectedBook, setPreSelectedBook] = useState<{ bookId: string; startPage: number } | null>(null);

  // Library scroll sync — Rick: "as nana scrolls then child should
  // also see scroll." Nana's scroll position publishes over SSE, Perry
  // receives it and applies it to her mirrored bookshelf. rAF throttle
  // so we don't fire dozens of publishes per scroll tick.
  const [libraryScrollTop, setLibraryScrollTop] = useState(0);
  const libraryScrollPendingRef = useRef(false);
  const libraryScrollLatestRef = useRef(0);
  const handleLibraryScroll = useCallback((top: number) => {
    libraryScrollLatestRef.current = top;
    if (libraryScrollPendingRef.current) return;
    libraryScrollPendingRef.current = true;
    requestAnimationFrame(() => {
      libraryScrollPendingRef.current = false;
      if (!connectionId) return;
      api.sessions.publishEvent(connectionId, "library_scroll", { top: libraryScrollLatestRef.current }).catch(() => {});
    });
  }, [connectionId]);

  // Pointer-highlight sync: Nana taps somewhere non-textual on the open book
  // (illustration, header, page edge), both devices show a soft amber ring
  // at that exact spot for ~2.5s.
  const [pointerHighlight, setPointerHighlight] = useState<
    { x: number; y: number; page: number; ts: number } | null
  >(null);
  useEffect(() => {
    if (!pointerHighlight) return;
    const t = setTimeout(() => setPointerHighlight(null), 2500);
    return () => clearTimeout(t);
  }, [pointerHighlight]);
  const handleBookPointer = (x: number, y: number, page: number) => {
    const payload = { x, y, page };
    setPointerHighlight({ ...payload, ts: Date.now() });
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "pointer_highlight", payload).catch(() => {});
    }
  };

  // Word-highlight sync: Nana taps a SPECIFIC WORD on the page → both screens
  // highlight that exact word with an amber background for ~2.5s. This is the
  // "industry-standard co-reading pointer" — Caribu used the same pattern.
  const [wordHighlight, setWordHighlight] = useState<WordHighlightState | null>(null);
  useEffect(() => {
    if (!wordHighlight) return;
    const t = setTimeout(() => setWordHighlight(null), 2500);
    return () => clearTimeout(t);
  }, [wordHighlight]);
  const handleBookWord = (side: "L" | "R", index: number, page: number) => {
    const payload = { side, index, page };
    setWordHighlight({ ...payload, ts: Date.now() });
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "word_highlight", payload).catch(() => {});
    }
  };

  // Reading theme — synced both sides. Nana cycles day → sepia → night, the
  // page colors update on Perry's screen at the same time. Persists per-user
  // for next session.
  const [readingTheme, setReadingTheme] = useState<ReadingTheme>(() => {
    try {
      const v = localStorage.getItem("nm_reading_theme");
      if (v === "day" || v === "sepia" || v === "night") return v;
    } catch {}
    return "day";
  });
  useEffect(() => {
    try { localStorage.setItem("nm_reading_theme", readingTheme); } catch {}
  }, [readingTheme]);
  const handleThemeChange = (next: ReadingTheme) => {
    setReadingTheme(next);
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "theme_change", { theme: next }).catch(() => {});
    }
  };

  // Background-blur is handled entirely by Daily.co's built-in
  // processor (`updateInputSettings({ video: { processor: { type:
  // 'background-blur' } } })`). MediaPipe runs at the source on
  // Nana's device, Daily encodes the blurred frames, Perry receives
  // the already-blurred stream natively over WebRTC. No client-side
  // segmentation, no SSE sync, no body classes — Daily's own API
  // handles everything. See VideoControls.toggleBlur. Browser support
  // is Chromium-based desktop + improving Safari; older Safari may
  // silently no-op which is a vendor limitation, not ours.

  // Reading layout — Nana picks one of 5 designs, broadcast to Perry
  // so both iPads render the same arrangement. Persisted to
  // localStorage so re-launching keeps the chosen layout.
  const [readingLayout, setReadingLayout] = useState<ReadingLayout>(() => {
    try {
      const v = localStorage.getItem("nm_reading_layout");
      if (v && (READING_LAYOUTS as readonly string[]).includes(v)) return v as ReadingLayout;
    } catch {}
    return "classic";
  });
  useEffect(() => {
    try { localStorage.setItem("nm_reading_layout", readingLayout); } catch {}
  }, [readingLayout]);
  const handleLayoutChange = (next: ReadingLayout) => {
    setReadingLayout(next);
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "layout_change", { layout: next }).catch(() => {});
    }
  };
  // Layout-sync authority: when Nana enters reading mode, broadcast
  // her current layout so Perry's screen converges. Same pattern as
  // theme sync above.
  useEffect(() => {
    if (mode !== "reading") return;
    if (!connectionId) return;
    if (deviceView !== "nana" && deviceView !== "both") return;
    api.sessions.publishEvent(connectionId, "layout_change", { layout: readingLayout }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, connectionId]);

  // Page mode — "double" (current two-page open-book spread) or "single"
  // (one page at a time). Rick: "if user selects one page then one page
  // will be displayed at reading mode and if two pages then it will be
  // two pages as we have, and it will also sync to perry." nanaPage
  // still indexes the SPREAD (one nanaPage = pages 2N and 2N+1); in
  // single mode we additionally track which side of the spread is
  // visible via pageSide so advancePage can step L → R → L of the
  // next spread instead of skipping pages.
  const [pageMode, setPageMode] = useState<"single" | "double">(() => {
    try {
      const v = localStorage.getItem("nm_page_mode");
      if (v === "single" || v === "double") return v;
    } catch {}
    return "double";
  });
  useEffect(() => {
    try { localStorage.setItem("nm_page_mode", pageMode); } catch {}
  }, [pageMode]);
  // Which side of the current spread is showing in single mode. Reset to
  // "L" whenever pageMode flips so Nana never lands on a half-hidden
  // mid-spread state. Not persisted — single-mode reading starts at L
  // each session, which is also what a paper book does after closing.
  const [pageSide, setPageSide] = useState<"L" | "R">("L");
  const pageSideRef = useRef<"L" | "R">("L");
  useEffect(() => { pageSideRef.current = pageSide; }, [pageSide]);

  const handlePageModeChange = (next: "single" | "double") => {
    setPageMode(next);
    // Always restart from L when toggling, both directions. Avoids
    // flashing R-only on a freshly-collapsed spread.
    setPageSide("L");
    // eslint-disable-next-line no-console
    console.log(`[nana] handlePageModeChange → ${next} (publishing to connId=${connectionId?.slice(0,8) ?? "none"})`);
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "page_mode", { mode: next, side: "L" })
        .then(r => {
          // eslint-disable-next-line no-console
          console.log(`[nana] page_mode publish OK, ${r.subscribers ?? "?"} subs`);
        })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.warn(`[nana] page_mode publish FAILED`, e);
        });
    }
  };
  // Authority broadcast — same pattern as theme/layout. When Nana lands
  // in reading mode, push her current pageMode/pageSide so Perry's
  // screen converges (even if she didn't toggle the dropdown this
  // session).
  useEffect(() => {
    if (mode !== "reading") return;
    if (!connectionId) return;
    if (deviceView !== "nana" && deviceView !== "both") return;
    api.sessions.publishEvent(connectionId, "page_mode", { mode: pageMode, side: pageSide }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, connectionId]);

  // Theme-sync authority: when Nana enters reading mode, broadcast her
  // current theme so Perry's screen converges to it. Without this each
  // device starts from its own localStorage and they desync until Nana
  // toggles (Rick: "Perry's side stayed on nighttime while Nana's was
  // on day"). Nana is authoritative; she's the reader.
  useEffect(() => {
    if (mode !== "reading") return;
    if (!connectionId) return;
    if (deviceView !== "nana" && deviceView !== "both") return;
    api.sessions.publishEvent(connectionId, "theme_change", { theme: readingTheme }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, connectionId]);

  // Reaction emojis — Nana taps 💛 / 🌟 / 👏 / 😊 / ✨ / 🎉, both screens see
  // the burst floating up. Transient (no polling, no replay) — missing one
  // is not a sync failure, just a small joy lost.
  const [currentReaction, setCurrentReaction] = useState<ReactionEvent | null>(null);
  const handleSendReaction = (emoji: ReactionEmoji) => {
    const payload: ReactionEvent = { emoji, ts: Date.now(), from: deviceView === "perry" ? "child" : "nana" };
    setCurrentReaction(payload);
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "reaction", payload).catch(() => {});
    }
  };

  // Reading-session start time — used by the ProgressPill to show
  // "Reading for 4:21" elapsed time.
  const [readingStartedAt, setReadingStartedAt] = useState<number>(() => Date.now());
  useEffect(() => {
    if (mode === "reading") {
      // Reset clock at the moment we enter reading mode.
      setReadingStartedAt(Date.now());
    }
  }, [mode]);

  const lastPageChangeRef = useRef(0);
  // Chapter-end celebration overlay. Set when Nana crosses a chapter
  // boundary forward — the page advance is paused, both iPads show the
  // celebratory card, and Nana taps "Next Chapter" or "End here" to
  // continue. Synced via SSE so Perry sees the same card.
  const [chapterEndOverlay, setChapterEndOverlay] = useState<{
    chapterIndex: number;
    chapterTitle: string;
    /** Open-ended reflection question for Perry — replaces the old recap.
     *  Chapter-specific when the chapter defines it, otherwise a rotating
     *  generic question keyed off the chapter index. */
    chapterQuestion: string;
    /** One-line teaser for the NEXT chapter. Omitted on the final chapter
     *  of the book — when absent, the card shows a "you finished the book"
     *  celebration line instead of a "coming up:" hook. */
    chapterTeaser?: string;
    /** True when this card sits at the END of the last chapter — drives the
     *  closing celebration variant of the card. */
    isLastChapter: boolean;
    /** The page Nana was trying to advance to (first page of next chapter). */
    intendedNextPage: number;
  } | null>(null);
  const lastAppliedChapterEndTsRef = useRef<number>(0);

  /**
   * One-step navigation that respects the current pageMode.
   *  - In "double" mode this is equivalent to changePage(nanaPage + dir):
   *    each step moves to the next/previous spread.
   *  - In "single" mode it steps L → R within the spread, then advances
   *    to the next spread's L (or backwards to the previous spread's R).
   *    The publish event carries both the spread index and the side so
   *    Perry mirrors exactly which page is showing.
   * Wire all single-step page taps/swipes through this helper. Direct
   * `changePage(N)` calls remain valid for jumps to a known spread
   * (e.g., resuming after chapter-end dismiss); they reset side to L.
   */
  const advancePage = (dir: 1 | -1) => {
    const current = nanaPageRef.current;
    // Image-page picture books (e.g. Aubrees) render each spread as one
    // full-bleed illustration; the BookContent two-page render is bypassed.
    // L→R within the same spread would just paint the same image again,
    // so single-page mode is meaningless for them — always step spreads.
    const isImageBook = currentBook.pages.some(p => !!p.imageUrl);
    if (pageMode === "double" || isImageBook) {
      // Wish 2: for chapter books at smaller fonts we pack multiple
      // source pages per displayed spread. Step by chunkSize so each
      // advance lands on the next chunk-start; the cover (page 1) is
      // never chunked. Keyed off nanaFontScale so Nana and Perry agree.
      const step = chunkSizeFor(currentBook, nanaFontScaleRef.current);
      if (current === 1 && dir === 1 && step > 1) {
        // Cover → first chunked spread starting at page 2.
        changePage(2);
        return;
      }
      const stride = step > 1 && current > 1 ? step : 1;
      const next = current + dir * stride;
      // Stepping backward past page 2 must land on the cover, not at
      // page 0 (which `changePage` would block). The cover is its own
      // standalone "spread" regardless of chunkSize, so it's the
      // natural previous step from the first chunked spread at page 2.
      if (next < 2 && dir === -1 && current > 1) {
        changePage(1);
        return;
      }
      changePage(next);
      return;
    }
    const side = pageSideRef.current;
    // Cover (spread 1) is a typographic title page — only the right side
    // carries content. Treat it as a single combined page in single mode
    // so we don't surface a blank "left of cover" beat.
    if (current === 1) {
      if (dir === 1) {
        // Cover → page 1 of spread 2, side L.
        changePage(2);
      }
      // dir === -1 on cover: stay put.
      return;
    }
    if (dir === 1) {
      if (side === "L") {
        // Same spread, flip to right.
        setPageSide("R");
        if (connectionId) {
          api.sessions.publishEvent(connectionId, "page_change", { page: current, side: "R" }).catch(() => {});
        }
      } else {
        // Advance spread, reset to left.
        changePage(current + 1);
      }
    } else {
      if (side === "R") {
        setPageSide("L");
        if (connectionId) {
          api.sessions.publishEvent(connectionId, "page_change", { page: current, side: "L" }).catch(() => {});
        }
      } else {
        // Going back from spread N side L → spread N-1 side R.
        // Set side BEFORE changePage so the publish includes the right
        // side. changePage resets side to L by default; we override with
        // a follow-up setPageSide + publish.
        const prev = current - 1;
        if (prev < 1) return;
        // Hand off to changePage to handle chapter-end detection
        // (irrelevant on backward, but keeps the publish/animation path
        // consistent), then jump side to R.
        changePage(prev);
        // Race-free: changePage's publish goes out with no side, then
        // we follow with a side update. Both Nana's local state and
        // Perry's mirror end up at (prev, "R").
        setPageSide("R");
        if (connectionId) {
          api.sessions.publishEvent(connectionId, "page_change", { page: prev, side: "R" }).catch(() => {});
        }
      }
    }
  };

  const changePage = (newPage: number, opts?: { skipChapterEndDetection?: boolean }) => {
    if (newPage < 1 || newPage > currentBook.pages.length || busy) return;
    const now = Date.now();
    if (now - lastPageChangeRef.current < 100) return;
    lastPageChangeRef.current = now;
    // Chapter-end interception — only on FORWARD navigation in books with
    // structured chapters, and only when the page being LEFT is the last
    // page of its chapter. We pause the advance, show the celebratory
    // overlay on both iPads, and resume on the user's tap. Backward
    // navigation and books without chapters[] skip this entirely.
    const old = nanaPageRef.current;
    if (
      !opts?.skipChapterEndDetection &&
      newPage > old &&
      isChapterEnd(currentBook, old)
    ) {
      const info = getChapterForPage(currentBook, old);
      if (info) {
        const totalChapters = currentBook.chapters?.length ?? 0;
        const isLastChapter = info.chapterIndex === totalChapters - 1;
        // Prefer the chapter's own question; otherwise pull a random one
        // from the reflection bank. Previously we keyed on
        // chapterIndex % bank.length, which felt deterministic and canned
        // when a family re-read the same book — chapter 1 always got the
        // same prompt. Random keeps the question feeling fresh and avoids
        // Rick's "recap" complaint by surfacing a new angle each time.
        const chapterQuestion = info.chapter.question
          ?? DEFAULT_CHAPTER_QUESTIONS[Math.floor(Math.random() * DEFAULT_CHAPTER_QUESTIONS.length)];
        const payload = {
          chapterIndex: info.chapterIndex,
          chapterTitle: info.chapter.title,
          chapterQuestion,
          // Skip the teaser on the final chapter — there's nothing to tease.
          ...(isLastChapter ? {} : (info.chapter.teaser ? { chapterTeaser: info.chapter.teaser } : {})),
          isLastChapter,
          intendedNextPage: newPage,
        };
        setChapterEndOverlay(payload);
        if (connectionId) {
          api.sessions.publishEvent(connectionId, "chapter_end", payload).catch(() => {});
        }
        lastPageChangeRef.current = 0; // allow immediate retry after dismiss
        return; // pause advance until Nana taps Next Chapter
      }
    }
    // Tactile feedback — soft page-turn whoosh + iOS haptic if available.
    playPageTurn();
    haptic("light");
    setBusy(true);
    setNanaPage(newPage);
    // Whenever the SPREAD changes, default the visible side back to L so
    // Nana doesn't land mid-spread on a freshly jumped-to target (e.g.,
    // chapter-end dismiss → next chapter's first page). advancePage()
    // emits an explicit side follow-up when it wants R after a backward
    // step.
    setPageSide("L");
    const dir: "forward" | "backward" = newPage > childPageRef.current ? "forward" : "backward";
    if (connectionId) {
      // Include side="L" so Perry's mirror matches the local reset above.
      // In double mode side is harmless metadata; in single mode it
      // ensures Perry's pageSide tracks Nana's exactly.
      api.sessions.publishEvent(connectionId, "page_change", { page: newPage, side: "L" }).catch(() => {});
    }
    setFlipDirection(dir);
    setFlipFromPage(childPageRef.current);
    setFlipToPage(newPage);
    setChildFlipping(true);
    timerRef.current = setTimeout(() => { setChildPage(newPage); setChildFlipping(false); setBusy(false); }, 500);
  };

  /** Nana taps "Next Chapter" on the chapter-end card. Dismisses the
   *  overlay on both iPads and resumes the paused page advance. */
  const handleChapterEndNext = () => {
    const overlay = chapterEndOverlay;
    if (!overlay) return;
    setChapterEndOverlay(null);
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "chapter_end_dismiss", {}).catch(() => {});
    }
    // Resume the paused advance, bypassing chapter-end detection so we
    // don't re-fire the overlay on the same boundary.
    changePage(overlay.intendedNextPage, { skipChapterEndDetection: true });
  };

  /** Nana taps "End here for today" — natural chapter-end stopping point. */
  const handleChapterEndStopHere = () => {
    setChapterEndOverlay(null);
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "chapter_end_dismiss", {}).catch(() => {});
    }
    handleEndSession();
  };

  /** Snapshot of this session for the goodbye summary card. Pages read
   *  is `nanaPage - sessionStartPageRef.current`. For chapter books the
   *  chapter the family ended in is included. Picture books and flat
   *  books get bookTitle + pagesRead only. Recomputed per render — cheap. */
  const sessionSummary = (() => {
    const pagesRead = Math.max(0, nanaPage - sessionStartPageRef.current);
    const chapInfo = isChapterBook(currentBook)
      ? getChapterForPage(currentBook, nanaPage)
      : null;
    return {
      bookTitle: currentBook.title,
      pagesRead,
      ...(chapInfo
        ? {
            chapterCompleted: chapInfo.chapter.title,
            chapterProgress: `Chapter ${chapInfo.chapterIndex + 1} of ${currentBook.chapters!.length}`,
          }
        : {}),
    };
  })();

  const prevModeRef = useRef<Mode | null>(null);
  // Tracks whether we've fired session_started this app lifecycle.
  // Without this, dashboard entries like "Open Library" or "Open Schedule"
  // skip handleStartReadingSession entirely and the server stays at
  // sessionAlive=false, which means the broadcast gate suppresses every
  // subsequent phase_change/book_change/etc. and Perry stays on her
  // waiting screen forever even though Nana is mid-reading. Reset to false
  // on session_end so the next round re-fires it.
  const sessionStartedFiredRef = useRef(false);
  // Track latest selectedBookId/nanaPage in refs so the phase_change
  // effect can read them WITHOUT having them as React deps. With them
  // in deps, every library tap (which changes selectedBookId) re-fires
  // the effect — and even though the inner guard prevents publishing,
  // React's batching could let a stale read through. Rick's bug:
  // "Hovering over / highlighting a book is already pushing the title
  // to the child's iPad" — fixed by gating the effect to mode changes
  // only.
  const phaseSelectedBookRef = useRef(selectedBookId);
  const phasePageRef = useRef(nanaPage);
  useEffect(() => { phaseSelectedBookRef.current = selectedBookId; }, [selectedBookId]);
  useEffect(() => { phasePageRef.current = nanaPage; }, [nanaPage]);
  useEffect(() => {
    // Auto-fire session_started the first time NANA enters an in-session
    // mode. The server's broadcast gate suppresses every event while
    // sessionAlive=false, so without this Perry never receives anything
    // when Nana navigates from her dashboard straight into Library or
    // Reading (skipping the "Start Reading" tile that does this explicitly).
    // Only fire from Nana's side — Perry's mode changes come from receiving
    // SSE/polling events, never from initiating a session.
    const isNanaSide = deviceView === "nana" || deviceView === "both";
    // "library" is intentionally excluded — Nana browsing books from her
    // dashboard is pre-session, not a started session. Perry should stay
    // on her waiting screen during library browsing. session_started
    // fires the moment Nana commits to a book (which transitions her to
    // "reading"), at which point the mode change here triggers it.
    const SESSION_MODES = new Set(["greeting", "icebreaker", "reading", "chat", "showandtell", "parentcheck", "sillyfaces", "goodbye", "vault"]);
    const inSession = SESSION_MODES.has(mode);
    if (connectionId && isNanaSide && inSession && !sessionStartedFiredRef.current) {
      sessionStartedFiredRef.current = true;
      api.sessions.publishEvent(connectionId, "session_started", {}).catch(() => {});
      // Re-arm the "first-time" help cards for every new reading session.
      // Without this, a family doing back-to-back sessions in the same
      // browser instance only sees the help cards on the FIRST session —
      // `shownThisSession` is module-level and accumulates across
      // sessions. Clearing here gives each session the same intro-card
      // experience as a fresh app launch. "Don't show again" flags
      // (localStorage) survive — only the per-session shown set is reset.
      shownThisSession.current.clear();
    }
  }, [mode, connectionId, deviceView]);
  useEffect(() => {
    // CRITICAL: only Nana publishes phase_change. Without this gate,
    // Perry's iPad — which mirrors Nana's mode via SSE — also fires this
    // effect on every mode transition, publishing phase_change with
    // Perry's local `phaseSelectedBookRef.current` (which is the default
    // "alice" since Perry never picks books). That stomps the server's
    // bookId from whatever Nana actually picked back to "alice" — and the
    // next polling tick yanks Nana's UI back to alice too. User: "whatever
    // nana selects the book, it again change to first book always."
    if (deviceView !== "nana" && deviceView !== "both") return;
    // Broadcast Nana's navigation so Perry's iPad can show the matching
    // PerryAwaitingView ("Nana is choosing a book…", etc.). Previously
    // home/bookrequests/settings were excluded because they would have
    // rendered blank on Perry's side — now they render the awaiting
    // screen, so they're safe to push. `onboarding` and `familystories`
    // stay excluded: onboarding is Nana's local signup flow, and
    // familystories is the per-session memory-writing flow that ends a
    // session (broadcasting it would yank Perry through end-of-session
    // transitions twice). Rick: "if nana go to library or anyother
    // menu perry can't see or do."
    if (
      !connectionId ||
      mode === "onboarding" ||
      mode === "familystories"
    ) return;
    // Fire phase_change on every mode change AFTER we leave the onboarding
    // signup. Previously this required prevModeRef.current !== null, which
    // meant the very first transition out of onboarding (e.g. onboarding →
    // home) silently skipped the broadcast. Perry then never learned that
    // Nana made it to her dashboard. We still skip when the new mode is
    // the same as the previous (no actual transition), but null prev now
    // counts as a real first transition.
    if (prevModeRef.current !== mode) {
      // Carry bookId + page in phase_change so the receiver atomically
      // transitions to the new mode WITH the right book/page. We do
      // NOT include the bookId when entering "library" — the user is
      // browsing, and broadcasting their tentative selection makes
      // Perry's iPad flicker between books on every tap.
      //
      // (familystories has its own sync path — Nana enters it locally on
      // both end-of-session AND home-dashboard-open; Perry follows via
      // session_end or stays put. Broadcasting phase_change for
      // familystories would yank Perry through the end transition twice,
      // hence the early-return above.)
      const goingToLibrary = mode === "library";
      api.sessions.publishEvent(connectionId, "phase_change", {
        mode,
        ...(goingToLibrary ? {} : { bookId: phaseSelectedBookRef.current }),
        page: phasePageRef.current,
      }).catch(() => {});
    }
    prevModeRef.current = mode;
  }, [mode, connectionId, deviceView]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const [nanaSillyFilter, setNanaSillyFilter] = useState("none");
  const [perrySillyFilter, setPerrySillyFilter] = useState("none");
  // Per-device opt-out for the first-to-laugh challenge mini-game (Rick:
  // "It would be fine to either put it behind an on/off toggle in
  // Settings"). Default ON. When off, the CHALLENGE pill hides from this
  // device entirely; an incoming challenge_state from the other side
  // still drives the screen so a partner-initiated game still works.
  const [sillyChallengeEnabled, setSillyChallengeEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("nm_silly_challenge_enabled") !== "off"; }
    catch { return true; }
  });
  const toggleSillyChallenge = (next: boolean) => {
    setSillyChallengeEnabled(next);
    try { localStorage.setItem("nm_silly_challenge_enabled", next ? "on" : "off"); } catch {}
  };
  const [sillyChallenge, setSillyChallenge] = useState<ChallengeState>("idle");
  const [sillyCountNum, setSillyCountNum] = useState(3);
  const [laughWinner, setLaughWinner] = useState<"nana" | "perry" | null>(null);
  const challengeHostRef = useRef(false);
  // When the counting phase started — shared between Nana and Perry via the
  // `state: "counting"` event payload. Rick: "The challenge countdown lags
  // behind Nana on Perry's iPad by approximately one second." Old design
  // published one event per tick (3→2→1), each subject to SSE + Cloudflare
  // buffering — typically 1s late on Perry. New design publishes the start
  // timestamp ONCE; both iPads derive the displayed count locally from
  // (now - startTs), so the visible number stays in lockstep regardless of
  // network jitter.
  const sillyChallengeStartTsRef = useRef<number>(0);
  // Local-clock target for the holding-state transition to "result".
  // Stored when entering the holding state (set by both SSE handlers
  // from the server-stamped endsAt). Both iPads schedule their own
  // setTimeout for this moment so the "Who laughed first?" reveal
  // fires at the same wall-clock time on Nana's and Perry's screens
  // instead of Perry waiting for Nana's SSE round trip.
  const sillyHoldingEndsAtLocalRef = useRef<number>(0);
  // Scheduled-start deferral mechanism removed. Previously this
  // state + effect waited 1.5s after the publish before transitioning
  // sillyChallenge to "counting" — the goal was to align both iPads'
  // state transitions to the same wall-clock moment. But during the
  // 1.5s wait, sillyChallenge was still "result" with laughWinner
  // cleared, so the "Who cracked up first?" panel re-appeared, looking
  // stuck. Rick: "if nana retries it stuck." Now both handlers
  // transition immediately; the rAF tick's monotonic-decreasing guard
  // keeps the displayed number frozen at 3 until sillyChallengeStartTsRef
  // is reached, so the visible countdown still begins at the synced
  // moment without the deferred-state confusion.

  useEffect(() => {
    if (sillyChallenge === "idle") { challengeHostRef.current = false; return; }
    if (!challengeHostRef.current) return; // Non-host device: skip — driven by SSE
    // Stamp every state-machine publish with the host role so receivers can
    // re-derive their own challengeHostRef on each event. Without this, when
    // Perry taps "Play Again" after a round Nana hosted, Nana's stale
    // ref=true causes her SSE handler to skip subsequent challenge_state
    // events and the screens desync.
    const myRole: "nana" | "perry" = deviceView === "perry" ? "perry" : "nana";
    const pub = (state: string) => {
      if (connectionId) api.sessions.publishEvent(connectionId, "challenge_state", { state, host: myRole }).catch(() => {});
    };
    if (sillyChallenge === "counting") {
      // Host schedules the single transition to "flash" at 2700ms from the
      // shared startTs. The visible 3-2-1 countdown ticks locally on both
      // sides via the rAF effect below — no per-tick network round trip.
      const elapsed = Date.now() - sillyChallengeStartTsRef.current;
      const remaining = Math.max(0, 2700 - elapsed);
      const t = setTimeout(() => { setSillyChallenge("flash"); pub("flash"); }, remaining);
      return () => clearTimeout(t);
    }
    if (sillyChallenge === "flash") {
      const t = setTimeout(() => { setSillyChallenge("holding"); pub("holding"); }, 450);
      return () => clearTimeout(t);
    }
    // Holding → result is no longer scheduled here. Moved to a separate
    // effect (below) that runs on BOTH sides anchored to the server-
    // stamped endsAt, so the reveal fires at the same wall-clock moment
    // on Nana's and Perry's iPads instead of Perry waiting for Nana's
    // SSE round trip after her 6-second timeout.
    return undefined;
  }, [sillyChallenge, connectionId]);

  // Shared "holding → result" transition. Runs on BOTH iPads when the
  // challenge enters the holding state. Each side schedules its own
  // local setTimeout against the server-stamped endsAt converted via
  // serverToLocal — so the reveal "Who laughed first?" appears at the
  // same wall-clock moment on both screens regardless of RTT. Host
  // additionally publishes the result transition so the polling
  // backstop + late-joiners observe it.
  useEffect(() => {
    if (sillyChallenge !== "holding") return;
    let endsAtLocal = sillyHoldingEndsAtLocalRef.current;
    // Defensive fallback: if endsAt wasn't carried in the event (older
    // server, or local-only entry into holding for the host before its
    // own SSE echo arrived), anchor to "now + 6s" so the timer still
    // fires roughly correctly.
    if (!endsAtLocal || endsAtLocal <= Date.now()) {
      endsAtLocal = Date.now() + 6000;
      sillyHoldingEndsAtLocalRef.current = endsAtLocal;
    }
    const delay = Math.max(0, endsAtLocal - Date.now());
    const t = window.setTimeout(() => {
      setSillyChallenge((prev) => (prev === "holding" ? "result" : prev));
      if (challengeHostRef.current && connectionId) {
        const myRole: "nana" | "perry" = deviceView === "perry" ? "perry" : "nana";
        api.sessions.publishEvent(connectionId, "challenge_state", { state: "result", host: myRole }).catch(() => {});
      }
    }, delay);
    return () => window.clearTimeout(t);
  }, [sillyChallenge, connectionId, deviceView]);

  // Local countdown ticker — runs on BOTH iPads while `state === "counting"`.
  // Reads the shared startTs and recomputes the displayed countNum every
  // animation frame. Network jitter no longer affects the visible count;
  // Nana and Perry see the same number within a frame of each other.
  useEffect(() => {
    if (sillyChallenge !== "counting") return;
    if (!sillyChallengeStartTsRef.current) return;
    let raf = 0;
    const tick = () => {
      const elapsed = Date.now() - sillyChallengeStartTsRef.current;
      // 0–899ms → 3, 900–1799ms → 2, 1800–2699ms → 1.
      const n = Math.max(1, 3 - Math.floor(elapsed / 900));
      // Monotonic-decreasing guard — count only goes 3→2→1, never
      // back up. Without this, a cross-iPad clock skew (Perry's
      // wall-clock briefly ahead of Nana's startTs reference) would
      // briefly compute a HIGHER n than the current state, snapping
      // the number back up and remounting the keyed pop animation.
      // Same root cause as the goodbye stutter — Rick: "countdown
      // starts … is not sync properly." Initial reset to 3 happens
      // via plain setSillyCountNum(3) when the counting state is
      // entered, so this guard only filters in-flight tick writes.
      setSillyCountNum((prev) => (n <= prev ? n : prev));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sillyChallenge]);

  const [familyStoriesSubMode, setFamilyStoriesSubMode] = useState<FamilyStoriesSubMode>("browse");
  const [familyStoryEntries, setFamilyStoryEntries] = useState<FamilyStoryEntry[]>(INITIAL_STORIES);

  // True from the moment the user taps End Call until they leave the
  // post-session vault. While set, "Back" from the vault returns to the
  // splash screen (deviceView=null) instead of icebreaker — that's what
  // actually disconnects the Daily.co call. Without this, "Back" was
  // dropping users into Getting Started with the camera still live.
  const [postEndCall, setPostEndCall] = useState(false);

  // Where to go when the user closes vault / library / schedule / stub
  // screens. "home" when they were opened from the new home screen,
  // "icebreaker" when they were opened mid-session.
  const [closeReturnsTo, setCloseReturnsTo] = useState<"home" | "icebreaker" | "greeting">("icebreaker");

  const handleOpenVault   = () => { setPostEndCall(false); setCloseReturnsTo(modeRef.current === "home" ? "home" : "icebreaker"); setMode("vault"); };
  const handleOpenLibraryFromHome = () => {
    // Refresh per-book progress so the "Continue Chapter 3" indicators
    // reflect the latest save. Scoped to the active sibling so Cooper's
    // library doesn't show Perry's bookmarks.
    if (connectionId) {
      api.progress.all(connectionId, activeChildId ?? undefined)
        .then(r => setDashboardProgress(r.progress))
        .catch(() => {});
    }
    setCloseReturnsTo("home");
    setMode("library");
  };
  const handleOpenScheduleFromHome = () => { setCloseReturnsTo("home"); setMode("parentcheck"); };
  const handleOpenBookRequests = () => setMode("bookrequests");
  const handleOpenSettings = () => setMode("settings");
  const handleGoHome = () => setMode("home");
  const handleCloseVault  = () => {
    // Single-tap exit straight to home. Rick: "Memory Vault back button
    // requires multiple taps and kills the camera." Old behavior hopped
    // through icebreaker (mid-session open) or splash (post-end-call open),
    // which forced extra taps and tore down the call object. Home keeps
    // Nana's PiP camera tile alive (home is in PIP_OVERLAY_MODES) and
    // lands her directly where she can start the next action.
    if (postEndCall) {
      // Post-end-call vault: still broadcast `session_complete` so Perry's
      // iPad transitions in lockstep with Nana's. Without this Perry stays
      // stuck on the Memory Vault screen — Rick: "they should both
      // transition together." Nana lands on home (not splash) so her
      // dashboard stays available for the next session.
      if (connectionId) {
        api.sessions.publishEvent(connectionId, "session_complete", {}).catch(() => {});
      }
      setPostEndCall(false);
    }
    setMode("home");
  };
  const handleOpenFamilyStories  = () => {
    // Remember where Nana came FROM so the journal's Back button puts
    // her back in the right place. Default "icebreaker" was wrong when
    // she opened the journal from home — Back dumped her into
    // icebreaker mode without a live session.
    setCloseReturnsTo(modeRef.current === "home" ? "home" : "icebreaker");
    setFamilyStoriesSubMode("browse");
    setMode("familystories");
  };
  const handleCloseFamilyStories = () => {
    // Perry's family-journal exit goes to her PIN/splash screen — same
    // effect as session_complete on her side. Rick: "When you open the
    // Family Journal it shows a blank screen with nothing to interact
    // with… you are completely trapped on that screen." She lands in
    // familystories only after session_end, with no way out until Nana
    // finishes the vault flow; this gives her an explicit escape.
    if (deviceView === "perry") {
      setMode("onboarding");
      setPerryPinMode(true);
      return;
    }
    setMode(closeReturnsTo);
  };

  const handleAfterFamilyStory = () => {
    if (isRecording) {
      const today = new Date();
      const dateStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      const childLabel = dashboardPerryName.trim() || getRoleLabel("child");
      const nanaLabel = nanaDisplayName.trim() || getRoleLabel("nana");
      setRecordingName(`${childLabel} · ${nanaLabel} · ${dateStr}`);
      setShowSaveDialog(true);
    } else {
      setMode("vault");
    }
  };

  const handleSaveFamilyStory = (note: string) => {
    const today = new Date();
    const dateStr = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    setFamilyStoryEntries(prev => [{
      id: Date.now(),
      date: dateStr,
      book: currentBook.title,
      bookEmoji: currentBook.emoji,
      bookColor: currentBook.spineColor,
      note,
      seen: false,
      isNew: true,
    }, ...prev]);
    handleAfterFamilyStory();
  };

  const handleSkipFamilyStory = () => {
    // NEED 2: "don't save" should not detour through Memory Vault. Send
    // the family straight to the goodbye sequence so saying-goodbye is
    // one tap from end-of-book instead of three (vault → home → end).
    // Rick: "'don't save' option should come before Memory Vault.
    // Currently the skip option appears after landing on Memory Vault.
    // Move it earlier to reduce unnecessary taps."
    handleStartGoodbye();
  };

  /**
   * NEED 3: chain another book in the same reading session. Clears
   * the current book's local state (selection, page, chapter overlay,
   * post-end flag) and returns to the library WITHOUT firing
   * session_end / session_complete. Connection, active child, and the
   * Daily video room stay alive. Rick: "Families with short picture
   * books will want to read two or three in a row. We need a clean
   * path back to the library without a full restart."
   *
   * Note: if the user hit "Save Memory" first, that entry is already
   * persisted in familyStoryEntries — they keep the memory AND get
   * to pick another book. If they tapped this button straight from
   * the chapter-end overlay (without saving), no memory is recorded
   * for this book, which matches the intent.
   */
  /**
   * Rick: "when all done on the end countdown to say goodbye when its
   * done and user asked to save as memory, there should be another
   * button to disconnect grandchild from grandparent and then
   * grandchild disconnects."
   *
   * Publishes session_complete — the grandchild's existing SSE handler
   * (see App.tsx:13005) catches that event and drops her back to the
   * PIN / Switch User screen so both iPads end the session together.
   * Nana returns to her own home dashboard.
   *
   * The user is on Family Stories' "write" screen when this fires, so
   * session_end has already been published earlier by handleEndSession.
   * This is the explicit "we're really done now" follow-up; no extra
   * confirmation modal because the button label + tone are clear and
   * a confirmation would add a tap the one-tap principle says to avoid.
   */
  const handleDisconnectSession = () => {
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "session_complete", {}).catch(() => {});
    }
    setPostEndCall(false);
    setChapterEndOverlay(null);
    setMode("home");
  };

  const handleReadAnotherBook = () => {
    setChapterEndOverlay(null);
    setPostEndCall(false);
    // selectedBookId is `string` (defaults to "alice"); use the empty
    // string sentinel that the rest of the codebase uses to mean
    // "no book selected" (see also line ~13556 in handleSwitchDevice).
    setSelectedBookId("");
    setNanaPage(1);
    setChildPage(1);
    nanaPageRef.current = 1;
    childPageRef.current = 1;
    sessionStartPageRef.current = 1;
    // Re-arm session_started so the next book reuses the live session
    // cleanly (the next phase_change to "reading" doesn't double-fire).
    sessionStartedFiredRef.current = true;
    setMode("library");
  };

  const handleStartChat = () => setMode("chat");
  const handleStartReading = () => {
    if (preSelectedBook) {
      setSelectedBookId(preSelectedBook.bookId);
      sessionStartPageRef.current = preSelectedBook.startPage;
      setNanaPage(preSelectedBook.startPage);
      setChildPage(preSelectedBook.startPage);
      setPreSelectedBook(null);
      setMode("reading");
    } else {
      setMode("library");
    }
  };
  const handleSelectBook = (id: string) => {
    setSelectedBookId(id);
    // Broadcast the tentative selection so Perry's read-only library
    // view mirrors Nana's highlight in real-time. Rick: "It would be
    // nice if Perry's screen mirrored the library view (read-only)
    // while Nana scrolls through books." Payload includes only bookId
    // (no page) — this is a highlight change, not a confirmed switch.
    // book_change is in LIFECYCLE so it broadcasts unconditionally.
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "book_change", { bookId: id }).catch(() => {});
    }
  };
  // Refresh per-book progress every time the library opens. Rick: "if we
  // stopped at Chapter 2 and came back, there was no indicator in the
  // library and we had to start over." Root cause was that dashboardProgress
  // is fetched ONCE at step-3 connect and never refetched, so the save
  // that fires at end-of-session never made it back into the in-memory
  // state the library reads from. Doing it on every library entry is
  // cheap (one HTTP call) and guarantees the cards show the freshest
  // chapter / page progress.
  const refreshProgress = () => {
    if (!connectionId) return;
    api.progress.all(connectionId, activeChildId ?? undefined)
      .then(r => setDashboardProgress(r.progress))
      .catch(() => {});
  };
  const handleOpenLibrary = () => {
    refreshProgress();
    setMode("library");
  };
  const handleConfirmBook = async (startPage: number = 1) => {
    sessionStartPageRef.current = startPage;
    setNanaPage(startPage);
    setChildPage(startPage);
    // Shared "Beginning your reading time…" beat on both iPads. Fires
    // locally on Nana's side BEFORE the publishes go out so the overlay
    // appears at the moment she taps Start, not after a network round
    // trip. Perry's side sets the same flag in her session_started SSE
    // handler so the two iPads see the overlay within a frame of each
    // other. Cleared after 1.2s.
    setSessionBeginShown(true);
    window.setTimeout(() => setSessionBeginShown(false), 1200);
    // Always start a fresh book at the left page of the chosen spread.
    // Without this, if Nana ended the previous book on side R, the next
    // book opens mid-spread on R — which on the cover spread (page 1)
    // means landing on the title page first.
    setPageSide("L");
    shownThisSession.current.add("reading");
    setPhaseIntro(null);
    if (connectionId) {
      // CRITICAL ORDERING: session_started MUST arrive at the server BEFORE
      // book_change / phase_change. The server's broadcast gate suppresses
      // non-lifecycle events while sessionAlive=false. fetch() is async, so
      // even if we call publishEvent in code order, the network can re-order
      // requests; book_change tends to land first and gets suppressed.
      // AWAIT the session_started publish so the next two fires only run
      // after the server has flipped sessionAlive=true.
      if (!sessionStartedFiredRef.current) {
        sessionStartedFiredRef.current = true;
        try { await api.sessions.publishEvent(connectionId, "session_started", {}); } catch {}
      }
      api.sessions.publishEvent(connectionId, "book_change", { bookId: selectedBookId, page: startPage }).catch(() => {});
      api.sessions.publishEvent(connectionId, "phase_change", { mode: "reading", bookId: selectedBookId, page: startPage }).catch(() => {});
    }
    setMode("reading");
  };
  const handleStartShowAndTell = () => { setShowAndTellPromptIndex(0); setMode("showandtell"); };
  const handleNextPrompt = () => setPromptIndex(i => (i + 1) % icebreakerPrompts.length);
  const handleNextChildPrompt = () => setChildPromptIndex(i => (i + 1) % childIcebreakerPrompts.length);
  const handleNextShowAndTellPrompt = () => setShowAndTellPromptIndex(i => (i + 1) % showAndTellPrompts.length);
  const handleBackToReading = () => setMode("reading");
  const handleStartParentCheck = () => { setNanaSillyFilter("none"); setPerrySillyFilter("none"); setSillyChallenge("idle"); setLaughWinner(null); setMode("parentcheck"); };
  const handleStartSillyFaces  = () => setMode("sillyfaces");
  const handleSetNanaFilter = (f: string) => {
    setNanaSillyFilter(f);
    if (connectionId) api.sessions.publishEvent(connectionId, "silly_filter", { who: "nana", filter: f }).catch(() => {});
  };
  const handleSetPerryFilter = (f: string) => {
    setPerrySillyFilter(f);
    if (connectionId) api.sessions.publishEvent(connectionId, "silly_filter", { who: "perry", filter: f }).catch(() => {});
  };
  const handleStartChallenge = () => {
    // Debounce: ignore re-tap if a transition is already scheduled
    // within the next 2s. Prevents the "both tap Try Again
    // simultaneously" race where each side becomes host of its own
    // event, then both downgrade to non-host on receiving each other's
    // event → no one drives the state machine and both stuck.
    const pending = sillyChallengeStartTsRef.current;
    if (pending && Date.now() < pending && pending - Date.now() < 2000) return;

    challengeHostRef.current = true;
    // Transition to counting state IMMEDIATELY on tap. The rAF tick
    // anchors to sillyChallengeStartTsRef.current (set 1500ms in the
    // future) and its monotonic-decreasing guard keeps the display at
    // "3" until that anchor is reached — so the countdown number
    // doesn't flash forward, the rAF just renders "3" then ticks
    // 3→2→1 starting exactly at the anchor.
    //
    // Previously this set `scheduledStartTs` and waited 1.5s before
    // transitioning sillyChallenge. During that wait, sillyChallenge
    // was still "result" with laughWinner cleared — which made the
    // "Who cracked up first?" panel re-appear for 1.5s, looking
    // stuck. Rick: "if nana retries it stuck."
    //
    // Server still stamps a canonical startAt for Perry to convert
    // via her server-clock offset, so the tick anchors match within
    // ~RTT/2 on both iPads.
    const startTs = Date.now() + 1500;
    sillyChallengeStartTsRef.current = startTs;
    setLaughWinner(null);
    setSillyChallenge("counting");
    setSillyCountNum(3);
    const myRole: "nana" | "perry" = deviceView === "perry" ? "perry" : "nana";
    if (connectionId) api.sessions.publishEvent(connectionId, "challenge_state", { state: "counting", delayMs: 1500, host: myRole }).catch(() => {});
  };
  const handleLaughedFirst = (who: "nana" | "perry") => {
    setLaughWinner(who);
    if (connectionId) api.sessions.publishEvent(connectionId, "laugh_winner", { who }).catch(() => {});
  };
  // Reset the challenge state machine so the user is no longer locked
  // on the result/winner screen. Both sides converge to the regular
  // Silly Faces screen (filters + Challenge button).
  const handleEndChallenge = () => {
    setSillyChallenge("idle");
    setLaughWinner(null);
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "challenge_state", { state: "idle" }).catch(() => {});
      api.sessions.publishEvent(connectionId, "laugh_winner", { who: null }).catch(() => {});
    }
  };
  const handleBackFromSillyFaces = () => { setGoodbyePhase(0); setMode("goodbye"); };

  const [goodbyePhase, setGoodbyePhase] = useState(0);

  // ── Shared scheduling state (lives here so both iPads react in sync) ──
  const [scheduleProposal, setScheduleProposal] = useState<ScheduleProposal | null>(null);
  const [nanaScheduleAccepted, setNanaScheduleAccepted] = useState(false);
  const [perryScheduleAccepted, setPerryScheduleAccepted] = useState(false);
  const [recordingName, setRecordingName] = useState<string>("");
  const [showSaveDialog, setShowSaveDialog] = useState<boolean>(false);

  const handlePropose = (date: Date, time: string, by: "nana" | "perry") => {
    lastAppliedScheduleTsRef.current = Date.now();
    setScheduleProposal({ date, time, proposedBy: by });
    if (by === "nana") {
      setNanaScheduleAccepted(true);
      if (connectionId) {
        api.sessions.publishEvent(connectionId, "schedule_proposal", { date: date.toISOString(), time }).catch(() => {});
      }
    } else {
      setPerryScheduleAccepted(true);
    }
  };
  const handleNanaAccept  = () => {
    lastAppliedScheduleTsRef.current = Date.now();
    setNanaScheduleAccepted(true);
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "schedule_accept", { by: "nana" }).catch(() => {});
    }
  };
  const handlePerryAccept = () => {
    lastAppliedScheduleTsRef.current = Date.now();
    setPerryScheduleAccepted(true);
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "schedule_accept", { by: "perry" }).catch(() => {});
    }
  };
  // Transient signal so the OTHER side knows a partner asked for a
  // different time (vs. the user clearing the proposal themselves).
  // Set by SSE handlers when an incoming schedule_reset's `by` field
  // names the OTHER role; cleared after 5s. ParentCheckView reads
  // this to show "Perry's family asked for a different time" /
  // "Nana asked for a different time" above the picker.
  const [partnerRequestedReschedule, setPartnerRequestedReschedule] = useState<"nana" | "perry" | null>(null);
  // Reset the next-session booking. Surfaced in ParentCheckView's three
  // confirmed states (waiting / incoming / all-booked) so either side
  // can change their mind after proposing or accepting. Clears local
  // state on both iPads via the schedule_reset SSE event; the server
  // also wipes state.scheduleProposal + state.scheduleAccepted so a
  // fresh polling read can't replay the old proposal.
  //
  // Takes an explicit `by` role rather than reading `deviceView` because:
  //   - In single-device demo mode (deviceView === "both"), both Nana's
  //     and Perry's DeviceFrames render and either one can tap "Change
  //     time" — the global state can't disambiguate.
  //   - On a real two-iPad session the role is still known statically
  //     at the call site, so passing it through is more honest.
  // Without this fix, Perry tapping "Suggest different time" emitted
  // `{by: "nana"}` and Nana's SSE handler ignored it (because she only
  // shows the banner when `by === "perry"`), so she never got the
  // "Perry's family asked for a different time" signal.
  const handleScheduleReset = (by: "nana" | "perry") => {
    lastAppliedScheduleTsRef.current = Date.now();
    setScheduleProposal(null);
    setNanaScheduleAccepted(false);
    setPerryScheduleAccepted(false);
    setPartnerRequestedReschedule(null); // self-initiated, no banner
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "schedule_reset", { by }).catch(() => {});
    }
  };

  const [nanaConsentSeen, setNanaConsentSeen] = useState(false);
  const [childConsentSeen, setChildConsentSeen] = useState(false);
  const [nanaRecordingOn, setNanaRecordingOn] = useState(true);
  const [childRecordingOn, setChildRecordingOn] = useState(true);
  const isRecording = nanaConsentSeen && childConsentSeen && nanaRecordingOn && childRecordingOn;


  // Nana drives the countdown locally and publishes each phase change to Perry via SSE.
  const [goodbyeStartTime, setGoodbyeStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (mode !== "goodbye" || goodbyeStartTime === null) return;
    // Both sides compute phase from the shared startTime locally — this
    // makes the countdown resilient to dropped SSE events. Only Nana's
    // device publishes phase milestones (so the server-side state knows
    // for late-joining clients); Perry just observes her own clock.
    //
    // Rick (multiple rounds): "Perry's countdown numbers have a slight
    // jitter." Root cause was a 100ms setInterval that called
    // setGoodbyePhase 10× per second on Perry's side, racing with
    // SSE/polling writers. Even with monotonic guards, the constant
    // tick contributed to render churn and the keyed countdown div's
    // num-pop animation could subtly re-fire from inline-style
    // reapplication. New design: setTimeout chain that schedules
    // exactly the next phase boundary, so the tick function runs at
    // most 8 times per session (one per phase + final) instead of
    // ~150 times. SSE / polling backstops still cover dropped events.
    const isPublisher = deviceView === "nana" || deviceView === "both";
    let cumulative = 0;
    const thresholds = GOODBYE_PHASE_DURATIONS.map(d => { cumulative += d; return cumulative; });
    let lastPublished = -1;
    let timeoutId = 0;
    let cancelled = false;

    const scheduleNext = (currentPhase: number) => {
      if (cancelled) return;
      if (currentPhase >= thresholds.length) return; // already at phase 7 (terminal)
      const nextBoundary = thresholds[currentPhase];
      const elapsedNow = Date.now() - goodbyeStartTime;
      const delay = Math.max(0, nextBoundary - elapsedNow);
      timeoutId = window.setTimeout(advance, delay);
    };

    const advance = () => {
      if (cancelled) return;
      const elapsed = Date.now() - goodbyeStartTime;
      const idx = thresholds.findIndex((t) => elapsed < t);
      const phase = idx === -1 ? 7 : idx;
      // Monotonic guard — phase only advances. Defensive against an
      // SSE/polling write landing in the same render cycle with a
      // stale value. Phase 7 (terminal) is treated as monotonic too;
      // phase 0 (reset) only comes from explicit handlers, never this
      // tick.
      setGoodbyePhase((prev) => (phase >= prev ? phase : prev));
      if (isPublisher && phase !== lastPublished && connectionId) {
        lastPublished = phase;
        api.sessions.publishEvent(connectionId, "goodbye_phase", { phase }).catch(() => {});
      }
      if (phase === 7) {
        setGoodbyeStartTime(null);
        return;
      }
      scheduleNext(phase);
    };

    advance();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [mode, goodbyeStartTime, deviceView, connectionId]);

  // Enter goodbye mode in the "Ready?" pre-stage — both screens see the
  // shared explanation, but the countdown does NOT auto-start. Nana
  // taps `handleBeginGoodbyeCountdown` when she and Perry are both
  // ready (Rick: "give Nana a Start Countdown button she presses when
  // she and Perry are both ready").
  const handleStartGoodbye = () => {
    setGoodbyeStartTime(null);
    setGoodbyePhase(0);
    setMode("goodbye");
    // The mode-change effect will publish a phase_change(mode:"goodbye")
    // SSE event so Perry's screen also lands in the Ready stage. We do
    // NOT publish goodbye_start here — that event only fires once Nana
    // taps Start Countdown.
  };

  const handleBeginGoodbyeCountdown = () => {
    // Small grace window so both devices have time to render the first
    // number before the clock starts ticking. 800ms is enough for the
    // SSE / 1s-poll round trip in worst-case Cloudflare buffer.
    //
    // Two anchors, one purpose: the publisher (Nana) sets her own
    // goodbyeStartTime LOCALLY here using her clock + delayMs so her
    // countdown starts immediately without waiting for an SSE round
    // trip. She publishes `delayMs` so the SERVER can stamp a
    // canonical `startAt` (in server clock) for the receiver (Perry)
    // to convert via her own EMA-tracked server-clock offset. Perry's
    // local startTime ends up at her local-clock equivalent of the
    // same server moment Nana's anchor maps to — so both iPads tick
    // in lockstep within ~RTT/2. The SSE goodbye_start handler is
    // guarded below so Nana's own echo doesn't overwrite this
    // tap-time anchor with the slightly-later echo-time conversion.
    const localStart = Date.now() + 800;
    setGoodbyeStartTime(localStart);
    setGoodbyePhase(0);
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "goodbye_start", { delayMs: 800 }).catch(() => {});
    }
  };
  const handleSkipToGoodbye  = () => {
    setGoodbyeStartTime(null);
    setGoodbyePhase(7);
    if (connectionId) api.sessions.publishEvent(connectionId, "goodbye_phase", { phase: 7 }).catch(() => {});
  };

  // Bookmark progress without ending the session. Rick: "if we stopped at
  // Chapter 2 and came back, there was no indicator in the library and we
  // had to start over." Root cause: progress only saved when Nana tapped
  // End Session — any other exit path (Home button, Switch Device, app
  // closure, iPad locked) left the server with no record. This helper
  // posts the same payload the End Session handler does so the progress
  // map gets refreshed on the server side. Side effect: a session record
  // is appended to the log on each call. That's acceptable for v1; if it
  // gets noisy we can split into a progress-only endpoint later.
  const lastBookmarkRef = useRef<{ bookId: string; page: number; ts: number } | null>(null);
  const saveProgressBookmark = () => {
    if (!connectionId) return;
    if (!selectedBookId) return;
    const pg = nanaPageRef.current;
    // Don't bookmark page 1 (cover) — same gate handleEndSession uses.
    if (pg <= 1) return;
    // De-dupe: skip if we just saved the same (book, page) within 30s
    // (rapid mode changes, double-fired visibilitychange events on iOS).
    const last = lastBookmarkRef.current;
    if (last && last.bookId === selectedBookId && last.page === pg && Date.now() - last.ts < 30_000) return;
    lastBookmarkRef.current = { bookId: selectedBookId, page: pg, ts: Date.now() };
    const chapterIdx = getChapterForPage(currentBook, pg)?.chapterIndex;
    api.sessionLog.save(connectionId, {
      bookId: selectedBookId,
      startPage: sessionStartPageRef.current,
      endPage: pg,
      ...(chapterIdx != null ? { chapterIndex: chapterIdx } : {}),
      ...(activeChildId ? { childId: activeChildId } : {}),
    }).then(() => {
      // Refresh local dashboardProgress so the Library card reflects the
      // bookmark even if Nana taps directly into the library without
      // going through handleOpenLibrary. Scoped to the active sibling.
      api.progress.all(connectionId, activeChildId ?? undefined)
        .then(r => setDashboardProgress(r.progress))
        .catch(() => {});
    }).catch(() => {});
  };

  // Auto-bookmark on mode-exit-from-reading. Watches the local `mode`
  // state with a ref-tracked previous value so we only fire on the
  // transition (not on every render). Belt-and-suspenders alongside
  // handleEndSession's explicit save: covers Home / Switch Device /
  // Open Vault / "I just navigated away" paths that historically left
  // progress unsaved.
  const prevReadingModeRef = useRef<Mode>(mode);
  useEffect(() => {
    const prev = prevReadingModeRef.current;
    prevReadingModeRef.current = mode;
    if (prev === "reading" && mode !== "reading") {
      saveProgressBookmark();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Auto-bookmark on visibility-hidden while reading. iPad PWA fires
  // visibilitychange when the user backgrounds the app, locks the iPad,
  // or switches to a different app. iOS Safari can kill JS shortly
  // afterwards so we don't get a clean shutdown — save synchronously
  // (fetch keepalive would be nicer, but fire-and-forget covers the
  // common case where the tab survives long enough to send the request).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && modeRef.current === "reading") {
        saveProgressBookmark();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetToHome = () => {
    setMode("icebreaker");
    setGoodbyePhase(0);
    setGoodbyeStartTime(null);
    setNanaPage(1);
    setChildPage(1);
    setNanaConsentSeen(false);
    setChildConsentSeen(false);
    setScheduleProposal(null);
    setNanaScheduleAccepted(false);
    setPerryScheduleAccepted(false);
  };
  const handleEndSession = () => {
    if (connectionId && selectedBookId && nanaPage > 1) {
      // For chapter books, also persist which chapter the family ended
      // in. Picture books / flat books have no chapters, so chapterIndex
      // stays undefined and the server stores null. Used later by the
      // Library Continue widget to show "Chapter 3 of 12" without the
      // legacy leftChapter string-parsing.
      const chapterIdx = getChapterForPage(currentBook, nanaPage)?.chapterIndex;
      api.sessionLog.save(connectionId, {
        bookId: selectedBookId,
        startPage: sessionStartPageRef.current,
        endPage: nanaPage,
        ...(chapterIdx != null ? { chapterIndex: chapterIdx } : {}),
        ...(activeChildId ? { childId: activeChildId } : {}),
      }).catch(() => {});
    }
    if (connectionId) {
      api.sessions.publishEvent(connectionId, "session_end", {}).catch(() => {});
    }
    // Clear so the next session re-fires session_started when Nana navigates
    // back into an in-session mode after the post-session vault.
    sessionStartedFiredRef.current = false;
    setPostEndCall(true);
    setFamilyStoriesSubMode("write");
    setMode("familystories");
  };

  const btnStyle = (disabled: boolean) => ({
    backgroundColor: disabled ? "rgba(201,146,42,0.25)" : AMBER,
    color: disabled ? "rgba(247,240,227,0.35)" : NAVY,
    border: "none", borderRadius: "12px", padding: "9px 18px",
    fontSize: "12px", fontFamily: "DM Sans, sans-serif", fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer", transition: "all 0.15s",
    flexShrink: 0,
  });

  if (deviceView === null) {
    const goSignIn = () => handleSelectDevice("nana");
    // Belt-and-suspenders against the Rick-reported collision: "Sign in
    // as Grandchild caused a collision. I accidentally tapped it and it
    // pulled up Perry's screen on Nana's iPad while Perry still had her
    // own screen." A signed-in Nana who lands back on the splash (post-
    // session handleSwitchDevice cleared her deviceView but kept her
    // auth) gets her grandchild card visually muted + inert so she
    // can't tap herself into Perry mode. The auto-redirect effect at
    // ~9821 also pulls her past this screen on the next tick so she
    // shouldn't even see the splash in practice — this is belt-and-
    // suspenders for the one-paint flash before the effect runs.
    const childChoiceDisabled = !!currentUser;
    const goJoinAsChild = childChoiceDisabled
      ? () => { /* signed in — no-op to prevent role collision */ }
      : () => handleSelectDevice("perry");
    // Two-card splash. Rick: "The current login screen has Nana and
    // Grandchild options but they are not prominent enough — easy to
    // miss or confuse." Previous splash reused NanaHomeView publicMode,
    // which rendered a full faux-dashboard (sidebar, library tiles,
    // schedule card) with the actual role choice scattered across four
    // small pills; most accidental taps fell through to onSignIn. This
    // replaces that surface with two dominant cards that ARE the screen.
    return (
      <>
        <InstallHint />
        <div style={{
          height: "100dvh",
          backgroundColor: NAVY,
          display: "flex", flexDirection: "column",
          padding: "16px",
          fontFamily: "DM Sans, sans-serif",
          overflow: "hidden",
          boxSizing: "border-box",
        }}>
          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;700&display=swap');
            .nm-role-cards { display: flex; flex-direction: row; gap: 20px; flex: 1; min-height: 0; }
            @media (max-width: 640px) {
              .nm-role-cards { flex-direction: column; gap: 14px; }
            }
            .nm-role-card { transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease; }
            .nm-role-card:not([aria-disabled="true"]):hover { transform: translateY(-2px); }
            .nm-role-card:not([aria-disabled="true"]):active { transform: translateY(0); }
          `}</style>

          {/* Wordmark — small, single line, no nav chrome. The screen's
              job is "pick a role," not "navigate the app." */}
          <div style={{
            flexShrink: 0,
            display: "flex", flexDirection: "column", alignItems: "center",
            paddingBottom: 16,
          }}>
            <div style={{
              color: CREAM,
              fontFamily: "Playfair Display, serif",
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: 700,
            }}>
              📖 NeverMiss
            </div>
            <div style={{
              color: AMBER,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.22em",
              marginTop: 4,
              opacity: 0.85,
            }}>
              READ · CONNECT · REMEMBER
            </div>
          </div>

          {/* The two cards — fill the rest of the screen. Each card is
              the full tap target so a stray finger anywhere on the card
              still routes to the right role. */}
          <div className="nm-role-cards">
            <button
              type="button"
              onClick={goSignIn}
              aria-label="I'm a Grandparent — sign in"
              className="nm-role-card"
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 14, padding: "24px 20px",
                background: "linear-gradient(135deg, rgba(247,201,93,0.18) 0%, rgba(201,146,42,0.32) 100%)",
                border: "2px solid rgba(247,201,93,0.55)",
                borderRadius: 22,
                boxShadow: "0 12px 36px rgba(201,146,42,0.28), inset 0 0 0 1px rgba(247,201,93,0.18)",
                cursor: "pointer",
                color: CREAM,
                fontFamily: "DM Sans, sans-serif",
                textAlign: "center",
                touchAction: "manipulation",
              }}
            >
              <div style={{
                fontSize: "clamp(64px, 10vw, 110px)",
                lineHeight: 1,
                filter: "drop-shadow(0 6px 14px rgba(201,146,42,0.45))",
              }} aria-hidden>👵</div>
              <div style={{
                color: AMBER,
                fontFamily: "Playfair Display, serif",
                fontSize: "clamp(22px, 3vw, 32px)",
                fontWeight: 700,
                lineHeight: 1.1,
              }}>
                I'm a Grandparent
              </div>
              <div style={{
                color: "rgba(247,240,227,0.82)",
                fontSize: "clamp(13px, 1.5vw, 16px)",
                fontWeight: 500,
                lineHeight: 1.4,
                maxWidth: 280,
              }}>
                Sign in to read with your grandchild.
              </div>
            </button>

            <button
              type="button"
              onClick={goJoinAsChild}
              aria-label={childChoiceDisabled ? "Already signed in as grandparent" : "I'm a Grandchild — join with a code"}
              aria-disabled={childChoiceDisabled || undefined}
              className="nm-role-card"
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 14, padding: "24px 20px",
                background: childChoiceDisabled
                  ? "rgba(96,165,250,0.05)"
                  : "linear-gradient(135deg, rgba(96,165,250,0.16) 0%, rgba(59,130,246,0.28) 100%)",
                border: `2px solid ${childChoiceDisabled ? "rgba(96,165,250,0.18)" : "rgba(96,165,250,0.55)"}`,
                borderRadius: 22,
                boxShadow: childChoiceDisabled
                  ? "none"
                  : "0 12px 36px rgba(59,130,246,0.25), inset 0 0 0 1px rgba(96,165,250,0.18)",
                cursor: childChoiceDisabled ? "not-allowed" : "pointer",
                color: CREAM,
                fontFamily: "DM Sans, sans-serif",
                textAlign: "center",
                opacity: childChoiceDisabled ? 0.45 : 1,
                touchAction: "manipulation",
              }}
            >
              <div style={{
                fontSize: "clamp(64px, 10vw, 110px)",
                lineHeight: 1,
                filter: childChoiceDisabled ? "none" : "drop-shadow(0 6px 14px rgba(59,130,246,0.45))",
              }} aria-hidden>🧒</div>
              <div style={{
                color: childChoiceDisabled ? "rgba(207,227,255,0.45)" : "#cfe3ff",
                fontFamily: "Playfair Display, serif",
                fontSize: "clamp(22px, 3vw, 32px)",
                fontWeight: 700,
                lineHeight: 1.1,
              }}>
                I'm a Grandchild
              </div>
              <div style={{
                color: "rgba(247,240,227,0.72)",
                fontSize: "clamp(13px, 1.5vw, 16px)",
                fontWeight: 500,
                lineHeight: 1.4,
                maxWidth: 280,
              }}>
                {childChoiceDisabled
                  ? "A grandparent is already signed in on this iPad."
                  : "Join with the code your grandparent shared."}
              </div>
            </button>
          </div>

          {/* Footer hint — soft, doesn't compete with the cards */}
          <div style={{
            flexShrink: 0,
            paddingTop: 14,
            textAlign: "center",
            color: "rgba(247,240,227,0.4)",
            fontSize: 11,
            fontStyle: "italic",
            letterSpacing: "0.04em",
          }}>
            Read together, even apart
          </div>
        </div>
      </>
    );
  }

  return (
    <div style={{
      height: "100dvh",
      backgroundColor: NAVY,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "6px 2px 6px",
      fontFamily: "DM Sans, sans-serif",
      overflow: "hidden",
      boxSizing: "border-box",
    }}>
      <InstallHint />
      {/* Session-transition overlays — see component definitions for the
          rationale. Each is shown briefly via setTimeout-cleared flags so
          the moments around login + session-start feel deliberate. */}
      {perryJustLoggedIn && <PerryWelcomeOverlay name={(perryConnRef.current?.childName ?? "").trim()} />}
      {sessionBeginShown && <SessionBeginOverlay />}
      {partnerLeftShown && <PartnerLeftOverlay nanaName={nanaDisplayName.trim()} />}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Merriweather:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@400;500;700&display=swap');

        @keyframes page-flip {
          0%   { transform: perspective(700px) rotateY(0deg);    box-shadow:  2px 0 14px rgba(0,0,0,0.25); }
          40%  { transform: perspective(700px) rotateY(-90deg);  box-shadow: -6px 0 22px rgba(0,0,0,0.45); }
          100% { transform: perspective(700px) rotateY(-180deg); box-shadow:  0px 0 0px rgba(0,0,0,0); }
        }

        /* ── Filter emoji animations ── */
        @keyframes wiggle-l   { 0%,100%{transform:rotate(-20deg)} 50%{transform:rotate(-34deg)} }
        @keyframes wiggle-r   { 0%,100%{transform:rotate(20deg) scaleX(-1)} 50%{transform:rotate(34deg) scaleX(-1)} }
        @keyframes crown-glow { 0%,100%{transform:scale(1);filter:drop-shadow(0 3px 8px rgba(0,0,0,0.7))} 50%{transform:scale(1.13);filter:drop-shadow(0 4px 26px rgba(255,215,0,0.9))} }
        @keyframes twinkle    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.38;transform:scale(0.68)} }
        @keyframes sway-l     { 0%,100%{transform:rotate(-15deg)} 50%{transform:rotate(-7deg)} }
        @keyframes sway-r     { 0%,100%{transform:rotate(15deg)}  50%{transform:rotate(7deg)}  }
        @keyframes bob        { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-9px)} }
        @keyframes float-sm   { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-5px)} }
        @keyframes pulse-sm   { 0%,100%{transform:scale(1)}       50%{transform:scale(1.18)} }
        @keyframes shimmer    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.68;transform:scale(1.07)} }

        /* ── Goodbye animations ── */
        @keyframes num-pop  {
          0%   { transform:translate(-50%,-50%) scale(0.3); opacity:0; }
          30%  { transform:translate(-50%,-50%) scale(1.16); opacity:1; }
          100% { transform:translate(-50%,-50%) scale(1);    opacity:1; }
        }
        /* Animation lives on a class instead of inline style — Safari
           occasionally restarts CSS animations when the same inline
           "animation" value is reapplied during React style diffing,
           which manifested as countdown stutter on Perry's iPad. With
           the animation on a fixed class, the rule is applied once at
           mount and never reapplied. */
        .nm-num-pop { animation: num-pop 0.45s ease-out forwards; }
        @keyframes kiss-lr  { 0%{transform:translateX(-280px);opacity:0} 12%{opacity:1} 88%{opacity:1} 100%{transform:translateX(280px);opacity:0} }
        @keyframes kiss-rl  { 0%{transform:translateX(280px);opacity:0}  12%{opacity:1} 88%{opacity:1} 100%{transform:translateX(-280px);opacity:0} }
        @keyframes heart-beat { 0%,100%{transform:scale(1)} 25%{transform:scale(1.32)} 55%{transform:scale(1.08)} }
        @keyframes wave-hand  { 0%,100%{transform:rotate(0deg)} 20%{transform:rotate(22deg)} 40%{transform:rotate(-14deg)} 60%{transform:rotate(22deg)} 80%{transform:rotate(-8deg)} }
        @keyframes fade-in    { 0%{opacity:0} 100%{opacity:1} }
        @keyframes rec-pulse  { 0%,100%{opacity:1;box-shadow:0 0 6px #ef4444} 50%{opacity:0.35;box-shadow:0 0 2px #ef4444} }
        @keyframes pulse-sm   { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.65;transform:scale(0.88)} }
        @keyframes phase-intro-fade { 0%{opacity:0} 100%{opacity:1} }
        @keyframes phase-card-up    { 0%{opacity:0;transform:translateY(28px) scale(0.96)} 100%{opacity:1;transform:translateY(0) scale(1)} }
        /* Exit pair — drives the dismiss animation in PhaseIntroCard so
           tapping "Got it" / "Don't show again" fades the card out
           rather than instantly unmounting it. forwards holds the end
           state (opacity 0) during the 220ms before the parent finally
           sets phaseIntro=null and unmounts. */
        @keyframes phase-intro-fadeout { 0%{opacity:1} 100%{opacity:0} }
        @keyframes phase-card-down     { 0%{opacity:1;transform:translateY(0) scale(1)} 100%{opacity:0;transform:translateY(10px) scale(0.97)} }
        @keyframes phase-progress   { 0%{width:100%} 100%{width:0%} }
        @keyframes flash-fade       { 0%{opacity:1} 100%{opacity:0} }
        @keyframes spin             { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .time-picker-scroll::-webkit-scrollbar { display: none; }

        * { box-sizing: border-box; }
      `}</style>

      {/* Header — Switch User pill. Was a tiny 10px / 0.28-opacity link
          that Rick "did not see" when trapped on Nana login. Bumped to
          a proper amber-bordered pill at higher contrast so it reads
          as an actionable button at a glance. */}
      <div style={{ flexShrink: 0, position: "relative", width: "100%", height: "32px" }}>
        <button
          onClick={handleSwitchDevice}
          aria-label="Switch user"
          style={{
            position: "absolute", top: 4, right: 8,
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "rgba(247,201,93,0.10)",
            border: "1px solid rgba(247,201,93,0.45)",
            color: AMBER,
            fontFamily: "DM Sans, sans-serif",
            fontSize: 12, fontWeight: 700,
            cursor: "pointer",
            padding: "6px 12px",
            borderRadius: 999,
            letterSpacing: "0.02em",
            touchAction: "manipulation",
          }}
        >
          <span aria-hidden>⇄</span>
          <span>Switch user</span>
        </button>
      </div>

      {/* Device frames */}
      <div style={{
        display: "flex",
        gap: deviceView === "both" ? "clamp(8px, 1.5vw, 20px)" : 0,
        width: "100%",
        // Single-device cap bumped from 840px → 1180px so the device frame
        // fills the iPad in landscape (typical iPad landscape widths are
        // 1024–1366px). Previously, ~190px of navy gutter sat on either
        // side of the cream book area on Rick's iPads. The 98vw lower bound
        // keeps a thin breathing edge so the frame's border doesn't kiss
        // the device bezel. Demo "both" cap unchanged.
        maxWidth: deviceView === "both" ? "min(98vw, 1620px)" : "min(98vw, 1180px)",
        flex: 1,
        minHeight: 0,
        alignItems: "stretch",
        justifyContent: "center",
      }}>
        {(deviceView === "nana" || deviceView === "both") && <VideoSessionProvider
          connectionId={connectionId}
          role="nana"
          enabled={connectionId !== null && (mode !== "onboarding" || perryAuthenticated)}
        ><DeviceFrame
          label="NANA'S iPAD"
          isNana={true}
          displayPage={nanaPage}
          flipping={false}
          flipFromPage={nanaPage}
          flipToPage={nanaPage}
          mode={mode}
          promptIndex={promptIndex}
          childPromptIndex={childPromptIndex}
          showAndTellPromptIndex={showAndTellPromptIndex}
          myFilter={nanaSillyFilter}
          theirFilter={perrySillyFilter}
          onSetMyFilter={handleSetNanaFilter}
          sillyChallenge={sillyChallenge}
          sillyCountNum={sillyCountNum}
          onStartChallenge={handleStartChallenge}
          laughWinner={laughWinner}
          onLaughedFirst={handleLaughedFirst}
          onEndChallenge={handleEndChallenge}
          onStartChat={handleStartChat}
          onStartReading={handleStartReading}
          onGreetingReady={handleGreetingReady}
          onGreetingShowPrompts={handleGreetingShowPrompts}
          onNextPrompt={handleNextPrompt}
          onNextChildPrompt={handleNextChildPrompt}
          onStartShowAndTell={handleStartShowAndTell}
          onNextShowAndTellPrompt={handleNextShowAndTellPrompt}
          onBackToReading={handleBackToReading}
          onStartParentCheck={handleStartParentCheck}
          onStartSillyFaces={handleStartSillyFaces}
          onBackFromSillyFaces={handleBackFromSillyFaces}
          goodbyePhase={goodbyePhase}
          goodbyeStartTime={goodbyeStartTime}
          onStartGoodbye={handleStartGoodbye}
          onBeginGoodbyeCountdown={handleBeginGoodbyeCountdown}
          onSkipToGoodbye={handleSkipToGoodbye}
          onEndSession={handleEndSession}
          showConsentOverlay={!nanaConsentSeen}
          recordingOn={nanaRecordingOn}
          onToggleRecording={() => setNanaRecordingOn(v => !v)}
          onDismissConsent={() => setNanaConsentSeen(true)}
          isRecording={isRecording}
          scheduleProposal={scheduleProposal}
          myScheduleAccepted={nanaScheduleAccepted}
          otherScheduleAccepted={perryScheduleAccepted}
          onPropose={(date, time) => handlePropose(date, time, "nana")}
          onScheduleAccept={handleNanaAccept}
          onScheduleReset={() => handleScheduleReset("nana")}
          partnerRequestedReschedule={partnerRequestedReschedule}
          selectedBookId={selectedBookId}
          onSelectBook={handleSelectBook}
          onConfirmBook={handleConfirmBook}
          bookPages={currentBook.pages}
          onOpenVault={handleOpenVault}
          onCloseVault={handleCloseVault}
          onStartReadingSession={handleStartReadingSession}
          onOpenLibraryFromHome={handleOpenLibraryFromHome}
          onOpenScheduleFromHome={handleOpenScheduleFromHome}
          onOpenBookRequests={handleOpenBookRequests}
          onOpenSettings={handleOpenSettings}
          onGoHome={handleGoHome}
          onSwitchDevice={handleSwitchDevice}
          childrenList={children}
          activeChildId={activeChildId}
          onSelectChild={handleSelectChild}
          onOpenAddChild={() => setAddChildModalOpen(true)}
          pinScreenExpectedChild={(activeChildId && activeChildId !== authenticatedChildId) ? children.find((c) => c.id === activeChildId) ?? null : null}
          familyStoriesSubMode={familyStoriesSubMode}
          familyStoryEntries={familyStoryEntries}
          currentBookTitle={currentBook.title}
          currentBookEmoji={currentBook.emoji}
          currentBookSpineColor={currentBook.spineColor}
          onSaveFamilyStory={handleSaveFamilyStory}
          onSkipFamilyStory={handleSkipFamilyStory}
          onReadAnotherBook={handleReadAnotherBook}
          onDisconnectSession={handleDisconnectSession}
          onOpenFamilyStories={handleOpenFamilyStories}
          onCloseFamilyStories={handleCloseFamilyStories}
          onboardingStep={nanaOnboardingStep}
          nanaDisplayName={nanaDisplayName}
          inviteToken={inviteToken}
          authError={authError}
          authLoading={authLoading}
          perryInviteError={perryInviteError}
          perryLookupNanaName={perryLookupNanaName}
          onNanaAuth={handleNanaAuth}
          onNanaCodeSent={handleNanaCodeSent}
          onPerryCodeSubmit={handlePerryCodeSubmit}
          onChildProfileConfirm={handleChildProfileConfirm}
          onBeginSession={handleBeginSession}
          onBeginWithBook={handleBeginWithBook}
          onSkipOnboarding={handleSkipOnboarding}
          onOnboardingBack={nanaOnboardingStep > 0 ? handleNanaBack : undefined}
          phaseIntro={showPhaseCards ? phaseIntro : null}
          // Two-button dismiss (Rick's Feature 3): "Got it" closes for
          // this session only (shownThisSession prevents re-show); "Don't
          // show again" persists the per-phase skip flag. Users can
          // re-enable from the HelpToggle ("Need help? Yes") or from
          // Settings → "Reset dismissed help prompts."
          onDismissPhaseCard={() => setPhaseIntro(null)}
          onDisablePhaseCard={handleDisablePhaseCards}
          onResetHelpPrompts={handleResetHelpPrompts}
          sillyChallengeEnabled={sillyChallengeEnabled}
          onToggleSillyChallenge={toggleSillyChallenge}
          openWith={openWith}
          onOpenWithChange={setOpenWith}
          dashboardLoading={dashboardLoading}
          dashboardPerryName={dashboardPerryName}
          dashboardProgress={dashboardProgress}
          showChildIcebreakerPrompts={showChildIcebreakerPrompts}
          onToggleChildIcebreakerPrompts={() => {
            const next = !showChildIcebreakerPrompts;
            setShowChildIcebreakerPrompts(next);
            if (connectionId) api.sessions.publishEvent(connectionId, "toggle_child_prompts", { show: next }).catch(() => {});
          }}
          vaultConnectionId={connectionId || undefined}
          onSwipePrev={() => advancePage(-1)}
          onSwipeNext={() => advancePage(1)}
          fontScale={fontScale}
          onOpenLibrary={handleOpenLibrary}
          onCycleFontScale={cycleFontScale}
          onFontScaleChange={applyFontScale}
          pointerHighlight={pointerHighlight}
          onPointer={handleBookPointer}
          wordHighlight={wordHighlight}
          onWord={handleBookWord}
          readingTheme={readingTheme}
          onThemeChange={handleThemeChange}
          readingLayout={readingLayout}
          onLayoutChange={handleLayoutChange}
          pageMode={pageMode}
          pageSide={pageSide}
          onPageModeChange={handlePageModeChange}
          chunkSize={chunkSizeFor(currentBook, nanaFontScale)}
          currentReaction={currentReaction}
          onReact={handleSendReaction}
          readingStartedAt={readingStartedAt}
          sessionSummary={sessionSummary}
          perryConnected={perryConnected}
          perryAuthenticated={perryAuthenticated}
          onLibraryScroll={handleLibraryScroll}
          libraryScrollTop={libraryScrollTop}
          onSignOut={handleSignOut}
        /></VideoSessionProvider>}
        {(deviceView === "perry" || deviceView === "both") && <VideoSessionProvider
          connectionId={connectionId}
          role="perry"
          enabled={connectionId !== null && (mode !== "onboarding" || perryAuthenticated)}
        ><DeviceFrame
          label="PERRY'S iPAD"
          isNana={false}
          displayPage={childPage}
          flipping={childFlipping}
          flipFromPage={flipFromPage}
          flipToPage={flipToPage}
          flipDirection={flipDirection}
          mode={perryAuthenticated ? mode : "onboarding"}
          promptIndex={promptIndex}
          childPromptIndex={childPromptIndex}
          showAndTellPromptIndex={showAndTellPromptIndex}
          myFilter={perrySillyFilter}
          theirFilter={nanaSillyFilter}
          onSetMyFilter={handleSetPerryFilter}
          sillyChallenge={sillyChallenge}
          sillyCountNum={sillyCountNum}
          onStartChallenge={handleStartChallenge}
          laughWinner={laughWinner}
          onLaughedFirst={handleLaughedFirst}
          onEndChallenge={handleEndChallenge}
          onStartChat={handleStartChat}
          onStartReading={handleStartReading}
          onGreetingReady={handleGreetingReady}
          onGreetingShowPrompts={handleGreetingShowPrompts}
          onNextPrompt={handleNextPrompt}
          onNextChildPrompt={handleNextChildPrompt}
          onStartShowAndTell={handleStartShowAndTell}
          onNextShowAndTellPrompt={handleNextShowAndTellPrompt}
          onBackToReading={handleBackToReading}
          onStartParentCheck={handleStartParentCheck}
          onStartSillyFaces={handleStartSillyFaces}
          onBackFromSillyFaces={handleBackFromSillyFaces}
          goodbyePhase={goodbyePhase}
          goodbyeStartTime={goodbyeStartTime}
          onStartGoodbye={handleStartGoodbye}
          onBeginGoodbyeCountdown={handleBeginGoodbyeCountdown}
          onSkipToGoodbye={handleSkipToGoodbye}
          onEndSession={handleEndSession}
          showConsentOverlay={!childConsentSeen}
          recordingOn={childRecordingOn}
          onToggleRecording={() => setChildRecordingOn(v => !v)}
          onDismissConsent={() => setChildConsentSeen(true)}
          isRecording={isRecording}
          scheduleProposal={scheduleProposal}
          myScheduleAccepted={perryScheduleAccepted}
          otherScheduleAccepted={nanaScheduleAccepted}
          onPropose={(date, time) => handlePropose(date, time, "perry")}
          onScheduleAccept={handlePerryAccept}
          onScheduleReset={() => handleScheduleReset("perry")}
          partnerRequestedReschedule={partnerRequestedReschedule}
          selectedBookId={selectedBookId}
          onSelectBook={handleSelectBook}
          onConfirmBook={handleConfirmBook}
          bookPages={currentBook.pages}
          onOpenVault={handleOpenVault}
          onCloseVault={handleCloseVault}
          onStartReadingSession={handleStartReadingSession}
          onOpenLibraryFromHome={handleOpenLibraryFromHome}
          onOpenScheduleFromHome={handleOpenScheduleFromHome}
          onOpenBookRequests={handleOpenBookRequests}
          onOpenSettings={handleOpenSettings}
          // Perry never sees home / book-requests / settings — those
          // are Nana-side dashboard screens. Top-bar Home stays in-session.
          onGoHome={() => setMode("icebreaker")}
          childrenList={children}
          activeChildId={activeChildId}
          onSelectChild={handleSelectChild}
          onOpenAddChild={() => setAddChildModalOpen(true)}
          pinScreenExpectedChild={(activeChildId && activeChildId !== authenticatedChildId) ? children.find((c) => c.id === activeChildId) ?? null : null}
          familyStoriesSubMode={familyStoriesSubMode}
          familyStoryEntries={familyStoryEntries}
          currentBookTitle={currentBook.title}
          currentBookEmoji={currentBook.emoji}
          currentBookSpineColor={currentBook.spineColor}
          onSaveFamilyStory={handleSaveFamilyStory}
          onSkipFamilyStory={handleSkipFamilyStory}
          onReadAnotherBook={handleReadAnotherBook}
          onDisconnectSession={handleDisconnectSession}
          onOpenFamilyStories={handleOpenFamilyStories}
          onCloseFamilyStories={handleCloseFamilyStories}
          onboardingStep={perryOnboardingStep}
          nanaDisplayName={nanaDisplayName}
          inviteToken={inviteToken}
          authError={authError}
          authLoading={authLoading}
          perryInviteError={perryInviteError}
          perryLookupNanaName={perryLookupNanaName}
          onNanaAuth={handleNanaAuth}
          onNanaCodeSent={handleNanaCodeSent}
          onPerryCodeSubmit={handlePerryCodeSubmit}
          onChildProfileConfirm={handleChildProfileConfirm}
          onBeginSession={handleBeginSession}
          onSkipOnboarding={handleSkipOnboarding}
          onOnboardingBack={perryOnboardingStep > 0 ? handlePerryBack : undefined}
          // Phase intro cards intentionally suppressed on Perry's iPad
          // (Rick: "Nana directs Perry — the prompts are noise for the
          // child"). Cards still render for Nana via the Nana DeviceFrame.
          phaseIntro={null}
          onDismissPhaseCard={() => setPhaseIntro(null)}
          onDisablePhaseCard={handleDisablePhaseCards}
          onResetHelpPrompts={handleResetHelpPrompts}
          sillyChallengeEnabled={sillyChallengeEnabled}
          onToggleSillyChallenge={toggleSillyChallenge}
          openWith={openWith}
          onOpenWithChange={setOpenWith}
          perryPinMode={perryPinMode}
          perryPinChildName={perryConnRef.current?.childName ?? ""}
          perryPinError={perryPinError}
          perryPinLoading={perryPinLoading}
          onPerryPinLogin={handlePerryPinLogin}
          onUseDifferentInvite={handleUseDifferentInvite}
          onAddSibling={handleAddSibling}
          showChildIcebreakerPrompts={showChildIcebreakerPrompts}
          vaultConnectionId={connectionId || undefined}
          onSwipePrev={() => advancePage(-1)}
          onSwipeNext={() => advancePage(1)}
          fontScale={fontScale}
          onCycleFontScale={cycleFontScale}
          pointerHighlight={pointerHighlight}
          onPointer={handleBookPointer}
          wordHighlight={wordHighlight}
          onWord={handleBookWord}
          readingTheme={readingTheme}
          readingLayout={readingLayout}
          pageMode={pageMode}
          pageSide={pageSide}
          chunkSize={chunkSizeFor(currentBook, nanaFontScale)}
          currentReaction={currentReaction}
          onReact={handleSendReaction}
          readingStartedAt={readingStartedAt}
          sessionSummary={sessionSummary}
          perryConnected={perryConnected}
          perryAuthenticated={perryAuthenticated}
          onLibraryScroll={handleLibraryScroll}
          libraryScrollTop={libraryScrollTop}
          onSignOut={handleSignOut}
        /></VideoSessionProvider>}
      </div>

      {/* Perry's combined controls — single row to prevent wrapping on iPad mini */}
      {mode === "reading" && deviceView === "perry" && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexShrink: 0, flexWrap: "nowrap", justifyContent: "center" }}>
          <TileButton
            icon="←"
            label="Prev"
            tone="primary"
            size="sm"
            onClick={() => advancePage(-1)}
            disabled={childPage === 1 || busy}
          />
          <div style={{ textAlign: "center", minWidth: "80px" }}>
            <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: "9px", fontWeight: 600, opacity: 0.8, letterSpacing: "0.02em" }}>{currentBook.title}</div>
            <div style={{ color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: "11px", opacity: 0.7 }}>Page {childPage} / {currentBook.pages.length}</div>
          </div>
          <TileButton
            icon="→"
            label="Next"
            tone="primary"
            size="sm"
            onClick={() => advancePage(1)}
            disabled={childPage === currentBook.pages.length || busy}
          />
          <TileButton
            icon={`A${fontScale >= 1.5 ? "﹢﹢" : fontScale >= 1.25 ? "﹢" : ""}`}
            label="Size"
            tone="secondary"
            size="sm"
            onClick={cycleFontScale}
            ariaLabel="Cycle font size"
          />
        </div>
      )}

      {/* Reading toolbar — separate buttons with consistent height (40px)
          and unified styling. No outer pill container that forces
          mismatched proportions. */}
      {mode === "reading" && deviceView !== "perry" && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 8, marginTop: 8, flexShrink: 0,
        }}>
          <ReadingToolbarBtn
            kind="primary"
            onClick={() => advancePage(-1)}
            disabled={nanaPage === 1 || busy}
            ariaLabel="Previous page"
          >
            <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, marginRight: 4 }}>←</span>
            <span>Prev</span>
          </ReadingToolbarBtn>

          <div style={{
            height: 40,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "0 16px", minWidth: 140,
            backgroundColor: "rgba(11,23,46,0.55)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
          }}>
            <div style={{ color: AMBER, fontFamily: "DM Sans, sans-serif", fontSize: 9, fontWeight: 800, opacity: 0.85, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.1 }}>{currentBook.title}</div>
            <div style={{ color: CREAM, fontFamily: "DM Sans, sans-serif", fontSize: 11, fontWeight: 600, opacity: 0.85, fontVariantNumeric: "oldstyle-nums", marginTop: 2 }}>
              Page {nanaPage} <span style={{ opacity: 0.55 }}>of {currentBook.pages.length}</span>
              {childPage !== nanaPage && (
                <span style={{ marginLeft: 8, color: AMBER, fontSize: 10, opacity: 0.7 }}>· Child {childPage}</span>
              )}
            </div>
          </div>

          <ReadingToolbarBtn
            kind="primary"
            onClick={() => advancePage(1)}
            disabled={nanaPage === currentBook.pages.length || busy}
            ariaLabel="Next page"
          >
            <span>Next</span>
            <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, marginLeft: 4 }}>→</span>
          </ReadingToolbarBtn>

          {/* Conversation prompt — was a floating bookmark panel over the
              book area. Rick: "doesn't need to display text on screen
              alongside the book." Tucked into the toolbar as a popover
              that only appears when Nana taps the button. */}
          <PromptButton
            prompt={currentBook.pages[nanaPage - 1]?.nanaPrompt ?? null}
            onStartChat={handleStartChat}
          />

          <ReadingToolbarBtn
            kind="ghost"
            onClick={cycleFontScale}
            ariaLabel="Cycle font size"
          >
            <span style={{ fontFamily: "Playfair Display, serif", fontSize: 13, fontWeight: 700 }}>A</span>
            <span style={{ fontFamily: "Playfair Display, serif", fontSize: 17, fontWeight: 700, marginLeft: 1 }}>A</span>
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", opacity: 0.7 }}>
              {fontScale >= 1.5 ? "XL" : fontScale >= 1.25 ? "L" : fontScale >= 1 ? "M" : "S"}
            </span>
          </ReadingToolbarBtn>

          <ReadingToolbarBtn kind="success" onClick={handleStartShowAndTell} ariaLabel="Start Show & Tell">
            <span style={{ fontSize: 14, marginRight: 4 }}>🎭</span>
            <span>Show &amp; Tell</span>
          </ReadingToolbarBtn>
        </div>
      )}

      {showSaveDialog && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
        }}>
          <div style={{
            backgroundColor: "#0b172e",
            border: "1px solid rgba(201,146,42,0.5)",
            borderRadius: "16px", padding: "24px", width: "300px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
          }}>
            <div style={{ color: AMBER, fontFamily: "Playfair Display, serif", fontSize: "16px", fontWeight: 700, marginBottom: "4px", display: "flex", alignItems: "center", gap: 8 }}>
              <Save size={16} strokeWidth={2} aria-hidden />
              Save to Memory Vault
            </div>
            <div style={{ color: "rgba(247,240,227,0.5)", fontFamily: "DM Sans, sans-serif", fontSize: "10px", marginBottom: "14px" }}>
              Give this memory a name before saving
            </div>
            <input
              type="text"
              value={recordingName}
              onChange={e => setRecordingName((e.target as HTMLInputElement).value)}
              placeholder="Name this memory..."
              autoFocus
              style={{
                width: "100%", backgroundColor: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.2)", borderRadius: "10px",
                padding: "10px 14px", color: CREAM,
                fontFamily: "DM Sans, sans-serif", fontSize: "13px",
                marginBottom: "14px", boxSizing: "border-box",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => { setShowSaveDialog(false); setRecordingName(""); }}
                style={{
                  flex: 1, backgroundColor: "rgba(255,255,255,0.06)",
                  color: "rgba(247,240,227,0.6)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "10px", padding: "10px",
                  fontFamily: "DM Sans, sans-serif", fontSize: "12px", cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (recordingName.trim()) {
                    setShowSaveDialog(false);
                    setRecordingName("");
                  }
                }}
                disabled={!recordingName.trim()}
                style={{
                  flex: 2, backgroundColor: recordingName.trim() ? AMBER : "rgba(201,146,42,0.3)",
                  color: recordingName.trim() ? "#0b172e" : "rgba(247,240,227,0.3)",
                  border: "none", borderRadius: "10px", padding: "10px",
                  fontFamily: "DM Sans, sans-serif", fontSize: "12px",
                  fontWeight: 700, cursor: recordingName.trim() ? "pointer" : "default",
                  transition: "all 0.15s", display: "inline-flex",
                  alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                <Save size={14} strokeWidth={2.2} aria-hidden /> Save Memory
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chapter-end celebration overlay — top-level fixed modal so it
          sits above the device frame on both Nana and Perry sides.
          Synced via the `chapter_end` event; dismissed via Nana's tap
          on "Next Chapter" or "End here for today". */}
      {chapterEndOverlay && (
        <div
          role="dialog"
          aria-label="Chapter complete"
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
            backgroundColor: "rgba(11, 23, 46, 0.85)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            animation: "page-arrived 320ms ease-out",
            padding: 24,
          }}
        >
          <div
            style={{
              maxWidth: 520, width: "100%",
              background: "linear-gradient(160deg, #14264a 0%, #0d1d3c 100%)",
              border: `1.5px solid ${AMBER}`,
              borderRadius: 20,
              padding: "28px 28px 24px",
              boxShadow: "0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(247,201,93,0.18)",
              textAlign: "center",
              color: CREAM,
            }}
          >
            {/* ── BEAT 1: CELEBRATE ── 🎉 + badge + chapter title.
                Pure positive moment — no text wall. */}
            <div style={{ fontSize: 64, marginBottom: 8, animation: "bob 1.6s ease-in-out infinite" }}>🎉</div>
            <div style={{
              color: "#86efac",
              fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 800,
              letterSpacing: "0.18em", textTransform: "uppercase",
              marginBottom: 10,
            }}>
              Chapter Complete!
            </div>
            <div style={{
              color: AMBER,
              fontFamily: "Playfair Display, serif", fontSize: 22, fontWeight: 700,
              lineHeight: 1.25, marginBottom: 18,
            }}>
              {chapterEndOverlay.chapterTitle}
            </div>

            {/* ── BEAT 2: REFLECT ── chapter-specific question for Perry.
                Boxed off so it reads as a prompt, not a recap. Replaces
                the old summary line — Rick: "the recap feels like
                homework, the kids just lived through it." */}
            <div style={{
              background: "rgba(247,201,93,0.08)",
              border: "1px solid rgba(247,201,93,0.22)",
              borderRadius: 14,
              padding: "14px 18px",
              marginBottom: chapterEndOverlay.chapterTeaser ? 14 : 22,
            }}>
              <div style={{
                color: "rgba(247,201,93,0.85)",
                fontFamily: "DM Sans, sans-serif", fontSize: 10, fontWeight: 800,
                letterSpacing: "0.16em", textTransform: "uppercase",
                marginBottom: 8,
              }}>
                Ask {(dashboardPerryName || perryConnRef.current?.childName || "your grandchild").trim()}
              </div>
              <div style={{
                color: CREAM,
                fontFamily: "Merriweather, serif", fontSize: 15,
                lineHeight: 1.45, fontStyle: "italic",
              }}>
                {chapterEndOverlay.chapterQuestion}
              </div>
            </div>

            {/* ── BEAT 3: TEASE ── one-line hook into the next chapter.
                Skipped when the chapter has no teaser (final chapter, or
                a book whose author didn't write one). Bumped from a 12px
                muted footnote to its own bordered card with a "NEXT TIME"
                eyebrow — Rick: "it might be more valuable to surface a
                teaser for the next chapter." The teaser is the part that
                pulls the family back tomorrow, so it earns real visual
                weight, not a dim line below the question. */}
            {chapterEndOverlay.chapterTeaser && (
              <div style={{
                background: "rgba(96,165,250,0.10)",
                border: "1px solid rgba(96,165,250,0.32)",
                borderRadius: 14,
                padding: "12px 16px",
                marginBottom: 22,
                display: "flex", flexDirection: "column", gap: 6,
                textAlign: "left",
              }}>
                <div style={{
                  color: "rgba(147,197,253,0.95)",
                  fontFamily: "DM Sans, sans-serif", fontSize: 10, fontWeight: 800,
                  letterSpacing: "0.16em", textTransform: "uppercase",
                }}>
                  Next time →
                </div>
                <div style={{
                  color: "rgba(247,240,227,0.92)",
                  fontFamily: "Merriweather, serif", fontSize: 14,
                  lineHeight: 1.5, fontStyle: "italic",
                }}>
                  {chapterEndOverlay.chapterTeaser}
                </div>
              </div>
            )}

            {/* Action buttons — Nana drives the navigation. Perry sees a
                gentle "Waiting for Nana" message instead so she can
                celebrate alongside without accidentally tapping.
                When this is the last chapter of the book, "Next Chapter"
                doesn't apply — instead show the NEED 3 "Read another"
                shortcut so families can chain a short picture book
                straight into the next one without the full goodbye. */}
            {(deviceView === "nana" || deviceView === "both") ? (
              <div style={{ display: "flex", gap: 10, flexDirection: "column" }}>
                {!chapterEndOverlay.isLastChapter && (
                  <button
                    onClick={handleChapterEndNext}
                    style={{
                      backgroundColor: AMBER, color: NAVY,
                      border: "none", borderRadius: 24, padding: "12px 22px",
                      fontFamily: "DM Sans, sans-serif", fontSize: 14, fontWeight: 800,
                      cursor: "pointer", letterSpacing: "0.02em",
                      boxShadow: "0 4px 14px rgba(201,146,42,0.35)",
                    }}
                  >
                    Next Chapter →
                  </button>
                )}
                {chapterEndOverlay.isLastChapter && (
                  <button
                    onClick={() => {
                      setChapterEndOverlay(null);
                      if (connectionId) {
                        api.sessions.publishEvent(connectionId, "chapter_end_dismiss", {}).catch(() => {});
                      }
                      handleReadAnotherBook();
                    }}
                    style={{
                      backgroundColor: AMBER, color: NAVY,
                      border: "none", borderRadius: 24, padding: "12px 22px",
                      fontFamily: "DM Sans, sans-serif", fontSize: 14, fontWeight: 800,
                      cursor: "pointer", letterSpacing: "0.02em",
                      boxShadow: "0 4px 14px rgba(201,146,42,0.35)",
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 16 }}>📖</span>
                    Read another book →
                  </button>
                )}
                <button
                  onClick={handleChapterEndStopHere}
                  style={{
                    backgroundColor: "transparent", color: "rgba(247,240,227,0.7)",
                    border: "1px solid rgba(255,255,255,0.18)", borderRadius: 24,
                    padding: "10px 18px",
                    fontFamily: "DM Sans, sans-serif", fontSize: 12, fontWeight: 700,
                    cursor: "pointer", letterSpacing: "0.02em",
                  }}
                >
                  {chapterEndOverlay.isLastChapter ? "Save & say goodbye" : "End here for today"}
                </button>
              </div>
            ) : (
              <div style={{
                color: "rgba(247,240,227,0.5)",
                fontFamily: "DM Sans, sans-serif", fontSize: 12, fontStyle: "italic",
                padding: "10px",
              }}>
                Waiting for {nanaDisplayName || "Nana"} to choose what's next…
              </div>
            )}
          </div>
        </div>
      )}

      {/* Multi-child add-sibling modal — opened from NanaHomeView's
          ChildPicker (and Phase C's post-session SwitchChildPrompt). */}
      {addChildModalOpen && (
        <AddChildModal
          onClose={() => setAddChildModalOpen(false)}
          onConfirm={handleAddChild}
        />
      )}

      {/* Toast that fires after a successful Add-Sibling. Explains the
          next step ("same iPad as Perry, just enter the PIN") so Nana
          isn't waiting for an invite link that doesn't exist. */}
      {addChildToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 18px",
            maxWidth: "min(92vw, 480px)",
            borderRadius: 14,
            backgroundColor: "rgba(34,197,94,0.16)",
            border: "1px solid rgba(34,197,94,0.55)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            color: "#dcfce7",
            fontFamily: "DM Sans, sans-serif",
            animation: "phase-card-up 0.32s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          <span aria-hidden style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>👋</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, lineHeight: 1.4 }}>
            <div style={{ color: "#86efac", fontSize: 14, fontWeight: 800 }}>
              {addChildToast.name} added!
            </div>
            <div style={{ fontSize: 12, color: "rgba(220,252,231,0.85)" }}>
              Same iPad as the others — have {addChildToast.name} enter the new PIN to take over.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAddChildToast(null)}
            aria-label="Dismiss"
            style={{
              marginLeft: 4,
              background: "transparent",
              border: "none",
              color: "rgba(220,252,231,0.6)",
              cursor: "pointer",
              fontSize: 18,
              padding: 4,
              flexShrink: 0,
            }}
          >×</button>
        </div>
      )}

    </div>
  );
}
