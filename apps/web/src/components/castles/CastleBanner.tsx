import type { CastleAccount } from "novus-mundus-sdk";
import {
  CASTLE_TIER_NAMES,
  CASTLE_STATUS_NAMES,
  isCastleStatusDanger,
} from "@/lib/world/castles";

interface CastleBannerProps {
  castle: CastleAccount;
}

// The landmark art is keyed off the chain `castleId` — the global
// landmark index (0..=22) from sdks/.../cli/data/castles.ts, which is
// also the export filename. Tier / status are runtime overlays on the
// static full-color art per docs/design/CASTLE_BANNERS.md.
export function CastleBanner({ castle }: CastleBannerProps) {
  const tier = castle.tier ?? 0;
  const status = castle.status ?? 0;
  const danger = isCastleStatusDanger(status);

  return (
    <div
      className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-border-default"
      style={{
        backgroundImage: `url(/img/castles/${castle.castleId}.webp)`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-zinc-50 [text-shadow:0_1px_2px_rgba(0,0,0,0.95),0_2px_10px_rgba(0,0,0,0.85)]">
            {castle.name || `Castle ${castle.castleId}`}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-text-gold [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">
            {CASTLE_TIER_NAMES[tier] ?? "Outpost"}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
            danger
              ? "bg-red-950/70 text-red-300 ring-1 ring-red-500/40"
              : "bg-black/50 text-zinc-200 ring-1 ring-white/10"
          }`}
        >
          {CASTLE_STATUS_NAMES[status] ?? "Vacant"}
        </span>
      </div>
    </div>
  );
}
