import { useEffect, useState } from "react";
import { Clock, Moon, Sun, Sunrise } from "lucide-react";
import {
  NEXT_THEME,
  READING_THEME_LABEL,
  READING_THEMES,
  type ReadingTheme,
} from "./themes";

/**
 * Compact pill that shows session reading time + page progress.
 * Mounted at the top of the reading view (above the open book).
 *
 * "Page 3 of 8" + a dot for each page (filled if read) + "4:21".
 */
export function ProgressPill({
  currentPage,
  totalPages,
  sessionStart,
  theme,
}: {
  currentPage: number;
  totalPages: number;
  sessionStart: number;
  theme: ReadingTheme;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsedSec = Math.max(0, Math.floor((now - sessionStart) / 1000));
  const mm = Math.floor(elapsedSec / 60);
  const ss = String(elapsedSec % 60).padStart(2, "0");

  const colors = READING_THEMES[theme];

  return (
    <div
      role="status"
      aria-label={`Page ${currentPage} of ${totalPages}, reading for ${mm} minutes ${ss} seconds`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 12px",
        borderRadius: 999,
        backgroundColor: theme === "night" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
        border: `1px solid ${theme === "night" ? "rgba(255,255,255,0.10)" : "rgba(92,58,30,0.18)"}`,
        color: colors.muted,
        fontFamily: "Inter, DM Sans, sans-serif",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ color: colors.accent, fontWeight: 700 }}>
          Page {currentPage}
        </span>
        <span style={{ opacity: 0.6 }}>of {totalPages}</span>
      </span>

      <PageDots current={currentPage} total={totalPages} accent={colors.accent} muted={colors.muted} />

      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: 0.85 }}>
        <Clock size={11} strokeWidth={2.2} aria-hidden />
        <span>{mm}:{ss}</span>
      </span>
    </div>
  );
}

function PageDots({
  current,
  total,
  accent,
  muted,
}: {
  current: number;
  total: number;
  accent: string;
  muted: string;
}) {
  // Cap dots at 12 to avoid overflow; for longer books just show a slim bar.
  if (total > 12) {
    const pct = Math.min(100, Math.max(0, (current / total) * 100));
    return (
      <div
        aria-hidden
        style={{
          width: 60,
          height: 4,
          borderRadius: 2,
          backgroundColor: `${muted}33`,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${pct}%`,
            backgroundColor: accent,
            transition: "width 280ms cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        />
      </div>
    );
  }
  return (
    <div aria-hidden style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {Array.from({ length: total }, (_, i) => {
        const isRead = i + 1 <= current;
        return (
          <span
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              backgroundColor: isRead ? accent : `${muted}55`,
              transition: "background-color 260ms ease",
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Sticky chapter heading bar shown above the open book in reading mode.
 * The chapter title comes from the page's `leftChapter` field — extracts
 * "Chapter X" + the chapter name. Hidden if the page isn't a chapter
 * opener (i.e., title page).
 */
export function StickyChapter({
  chapterText,
  bookTitle,
  theme,
}: {
  chapterText: string | null;
  bookTitle: string;
  theme: ReadingTheme;
}) {
  if (!chapterText) return null;

  const parts = chapterText.split(" · ");
  const chapterNum = parts.length > 1 ? parts[0] : null;
  const chapterName = parts.length > 1 ? parts.slice(1).join(" · ") : chapterText;
  const colors = READING_THEMES[theme];

  // Avoid the duplicate book-title problem on the title page where
  // chapterName === bookTitle. In that case the running headers on each
  // page already carry the title, so just show the chapter number (or
  // hide entirely if there's nothing chapter-specific to add).
  const isTitlePage = !chapterNum && chapterName.toLowerCase() === bookTitle.toLowerCase();
  if (isTitlePage) return null;

  return (
    <div
      role="banner"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        color: colors.muted,
        fontFamily: "Playfair Display, serif",
      }}
    >
      {chapterNum && (
        <span style={{
          color: colors.accent,
          fontFamily: "DM Sans, sans-serif",
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
        }}>
          {chapterNum}
        </span>
      )}
      {chapterNum && chapterName !== chapterNum && (
        <span aria-hidden style={{ width: 4, height: 4, borderRadius: "50%", backgroundColor: colors.accent, opacity: 0.55 }} />
      )}
      {chapterName && chapterName !== chapterNum && (
        <span style={{ fontSize: 12, fontStyle: "italic", fontWeight: 600, opacity: 0.85 }}>
          {chapterName}
        </span>
      )}
    </div>
  );
}

/**
 * Theme switcher cycles day → sepia → night → day.
 * Visible only to Nana (Perry doesn't choose; she follows).
 */
export function ThemeSwitcher({
  theme,
  onChange,
}: {
  theme: ReadingTheme;
  onChange: (next: ReadingTheme) => void;
}) {
  const Icon = theme === "day" ? Sun : theme === "sepia" ? Sunrise : Moon;
  return (
    <button
      onClick={() => onChange(NEXT_THEME[theme])}
      aria-label={`Reading theme: ${READING_THEME_LABEL[theme]}. Tap to change.`}
      title={`Theme: ${READING_THEME_LABEL[theme]} — tap to cycle`}
      style={{
        width: 36,
        height: 36,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.18)",
        backgroundColor: "rgba(255,255,255,0.06)",
        color: "#F7F0E3",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        WebkitTapHighlightColor: "transparent",
        transition: "background-color 160ms ease",
      }}
    >
      <Icon size={16} strokeWidth={2} aria-hidden />
    </button>
  );
}
