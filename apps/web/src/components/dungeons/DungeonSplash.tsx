import { dungeonSplashPath, dungeonAccent } from "@/lib/dungeons/splash";

interface DungeonSplashProps {
  dungeonId: number;
  boss?: boolean;
  /** Headline overlaid on the art (dungeon name, "Boss" reveal, etc). */
  title?: string;
  /** Small uppercase label below the title (theme, depth, etc). */
  subtitle?: string;
}

// Atmospheric splash banner for a dungeon. Renders the base or boss art
// keyed off `dungeonId`, framed by the dungeon's accent ring. Returns
// null when the id has no art so callers can drop it cleanly.
export function DungeonSplash({ dungeonId, boss = false, title, subtitle }: DungeonSplashProps) {
  const src = dungeonSplashPath(dungeonId, boss);
  if (!src) return null;
  const accent = dungeonAccent(dungeonId) ?? undefined;

  return (
    <div
      className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border"
      style={{
        backgroundImage: `url(${src})`,
        backgroundSize: "cover",
        backgroundPosition: "center 35%",
        borderColor: accent ? `${accent}66` : undefined,
      }}
    >
      {(title || subtitle) && (
        <div className="absolute inset-x-0 bottom-0 p-4">
          {title && (
            <div className="text-base font-semibold text-zinc-50 [text-shadow:0_1px_2px_rgba(0,0,0,0.95),0_2px_10px_rgba(0,0,0,0.85)]">
              {title}
            </div>
          )}
          {subtitle && (
            <div
              className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]"
              style={{ color: accent }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
