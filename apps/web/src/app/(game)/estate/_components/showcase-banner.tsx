import type { ReactNode } from "react";
import { GameIcon, type GameIconId } from "@/components/shared/GameIcon";

interface ShowcaseBannerProps {
  /** Path to the backdrop illustration under /public. */
  image: string;
  /** Relief icon for the currently selected thing. */
  icon: GameIconId;
  /** Selected thing's name. */
  title: string;
  /** Small uppercase accent label beside the title (e.g. "16x defensive power"). */
  tag?: string;
  /** Body — lore line and/or a stat line. Use text-zinc-300 / text-zinc-400. */
  children: ReactNode;
  /** Optional content pinned to the bottom of the art, over a bottom gradient,
   *  for status that belongs on the image rather than in a separate card. */
  footer?: ReactNode;
}

/**
 * A wide illustration-backed panel that doubles as the selected-item showcase
 * on estate tabs. The backdrop image is dark-graded left-to-right so the icon
 * and text stay legible while the art shows through on the right. The panel
 * holds the art's native 16:9 ratio so the full illustration shows with no
 * crop and no letterbox bars; it scales with the column width.
 */
export function ShowcaseBanner({ image, icon, title, tag, children, footer }: ShowcaseBannerProps) {
  return (
    <div
      className="relative flex aspect-[16/9] flex-col justify-center overflow-hidden rounded-lg border border-border-default"
      style={{
        backgroundImage: `url(${image})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/80 to-black/40" />
      <div className="relative flex items-center gap-3 p-4 sm:gap-4 sm:p-5">
        <GameIcon
          id={icon}
          size={72}
          // The banner gradient is dark in both themes, so pin the glyph to a
          // warm bone tone instead of inheriting the page text color (which is
          // dark in light mode and vanishes against the gradient).
          className="shrink-0 text-[#e6dcc6] drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]"
        />
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-base font-semibold text-zinc-50">{title}</span>
            {tag && (
              <span className="text-[10px] uppercase tracking-wider text-text-gold/80">{tag}</span>
            )}
          </div>
          {children}
        </div>
      </div>
      {footer && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 pt-10 sm:px-5">
          {footer}
        </div>
      )}
    </div>
  );
}
