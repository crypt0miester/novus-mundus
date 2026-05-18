"use client";

import { useMemo, type ReactNode } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useSubscriptionStatus } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { formatNumber } from "@/lib/utils";
import {
  createPurchaseSubscriptionInstruction,
  getEffectiveTier,
  formatLamportsAsSol,
} from "novus-mundus-sdk";
import {
  Database,
  ShoppingCart,
  Percent,
  Gift,
  Users,
  Swords,
  Wind,
  Award,
  Crown,
  Check,
  Sparkles,
  Clock,
  type LucideIcon,
} from "lucide-react";

// Charter accent ramp — a metal ladder (iron → bronze → silver → gold) that
// matches the Free/Bronze/Silver/Gold names the rest of the app uses.
const TIER_THEME = [
  { accent: "#71717a", bright: "#a1a1aa", glow: "rgba(113,113,122,0)" },
  { accent: "#c87b3e", bright: "#e6a063", glow: "rgba(200,123,62,0.22)" },
  { accent: "#9aa6b2", bright: "#d4dde6", glow: "rgba(154,166,178,0.22)" },
  { accent: "#daa520", bright: "#f1af09", glow: "rgba(218,165,32,0.30)" },
];

// Fallback featured tier for a player with no charter — the middle paid tier
// is the classic decoy anchor (don't push a brand-new player to the top tier).
const ANCHOR_TIER = 2;

const theme = (i: number) => TIER_THEME[i] ?? TIER_THEME[TIER_THEME.length - 1];

/** BN | number | undefined → number */
function num(v: unknown): number {
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

/** 1 → "1×", 2.5 → "2.5×" */
function asMultiplier(r: number): string {
  return Number.isInteger(r) ? `${r}×` : `${r.toFixed(1)}×`;
}

/**
 * SOL cost of a charter, in lamports — mirrors the on-chain purchase formula
 * (subscription/purchase.rs): sol_cost = cost_in_usd_cents × 1e9 ÷ usd_price_cents.
 * The price is USD-denominated but settled in SOL at the live SOL/USD rate.
 */
function solCostLamports(costUsdCents: number, usdPriceCents: number): number {
  if (usdPriceCents <= 0 || costUsdCents <= 0) return 0;
  return Math.floor((costUsdCents * 1_000_000_000) / usdPriceCents);
}

interface PerkRowProps {
  icon: LucideIcon;
  color: string;
  strong?: boolean;
  children: ReactNode;
}

function PerkRow({ icon: Icon, color, strong, children }: PerkRowProps) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-snug">
      <span
        className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded"
        style={strong ? { background: `${color}26`, color } : { color: "#52525b" }}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className={strong ? "text-text-primary" : "text-text-secondary"}>
        {children}
      </span>
    </li>
  );
}

export function SubscribeTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const player = playerData?.account;
  const sub = useSubscriptionStatus();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const nowSec = Math.floor(Date.now() / 1000);
  const effectiveTier = useMemo(() => {
    if (!player) return 0;
    return getEffectiveTier(player, nowSec);
  }, [player, nowSec]);

  const tiers = geData?.account?.subscriptionTiers ?? [];
  const npc = geData?.account?.noviPurchaseConfig;
  const baseTier = tiers[0];
  // SOL/USD rate (USD cents per 1 SOL) — drives the live charter price.
  const usdPriceCents = num(geData?.account?.usdPriceCents);

  // The featured tier follows the player up the ladder: always their realistic
  // next purchase (current + 1), floored at the anchor tier for new players.
  const recommendedTier = Math.min(
    tiers.length - 1,
    Math.max(effectiveTier + 1, ANCHOR_TIER)
  );

  const tierName = (i: number) => tiers[i]?.name ?? `Tier ${i}`;

  const handlePurchase = async (tierId: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const geAccount = geData?.account;
    if (!geAccount) throw new Error("Game engine not loaded");
    const ix = createPurchaseSubscriptionInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        paymentAuthority: publicKey,
        treasury: geAccount.treasuryWallet,
      },
      { paymentType: 0, tier: tierId }
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `${tierName(tierId)} charter held.`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  // ─── Current-charter framing ───────────────────────────────────────────
  const curTheme = theme(effectiveTier);
  const cur = tiers[effectiveTier];
  const curGen = num(cur?.generationMultiplier);
  const baseGen = num(baseTier?.generationMultiplier);
  const curGenRatio = baseGen > 0 ? curGen / baseGen : null;
  const daysLeft = sub.active && sub.expiresAt > 0
    ? (sub.expiresAt - nowSec) / 86_400
    : null;
  const expiringSoon = daysLeft != null && daysLeft < 3;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-primary">
          A Patron&apos;s Charter
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          A charter is a standing arrangement with a patron, it multiplies your
          NOVI generator, widens your vault, and grants a signing bounty the
          moment it is sealed. Higher charters compound everything below.
        </p>
      </div>

      {/* ─── Current charter ─── */}
      <div
        className="rounded-xl border bg-surface-raised p-4"
        style={{ borderColor: curTheme.accent }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Crown className="h-5 w-5" style={{ color: curTheme.bright }} />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted">
                Current Charter
              </div>
              <div
                className="text-lg font-bold leading-tight"
                style={{ color: curTheme.bright }}
              >
                {tierName(effectiveTier)}
              </div>
            </div>
          </div>
          {sub.active && sub.expiresAt > 0 && (
            <div className="text-right">
              <div
                className={`flex items-center justify-end gap-1 text-[10px] uppercase tracking-wider ${
                  expiringSoon ? "text-amber-400" : "text-text-muted"
                }`}
              >
                {expiringSoon && <Clock className="h-3 w-3 animate-pulse" />}
                {expiringSoon ? "Lapses soon" : "Expires"}
              </div>
              <GoldCountdown endsAt={sub.expiresAt} format="full" />
            </div>
          )}
        </div>

        {/* Downgrade preview — loss aversion */}
        {effectiveTier > 0 && curGenRatio != null && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-surface/60 px-3 py-2 text-[11px] text-text-muted">
            <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500/80" />
            <span>
              {expiringSoon ? "Renew before it lapses — " : "If this charter lapses, "}
              your generator drops{" "}
              <span className="font-semibold text-text-secondary">
                {asMultiplier(curGenRatio)} to 1×
              </span>{" "}
              and your vault shrinks to{" "}
              <span className="font-semibold text-text-secondary">
                {formatNumber(num(baseTier?.maxLockedNovi))} NOVI
              </span>
              .
            </span>
          </div>
        )}
        {effectiveTier === 0 && (
          <p className="mt-3 text-[11px] text-text-muted">
            You hold the free charter. Every paid charter below multiplies your
            NOVI generator and pays a signing bounty up front.
          </p>
        )}
      </div>

      {/* ─── Tier ladder (paid charters) ─── */}
      <div className="grid gap-4 md:grid-cols-3">
        {tiers.slice(1).map((t) => {
          const idx = t.tierIndex ?? tiers.indexOf(t);
          const th = theme(idx);
          const isCurrent = sub.active && idx === effectiveTier;
          const isRecommended = idx === recommendedTier && !isCurrent;
          // The chain rejects buying a tier below your active charter.
          const isLocked = sub.active && idx < effectiveTier;
          const durationDays = t.durationDays ?? 0;

          // Live cost — USD-denominated, settled in SOL at the chain rate
          const costUsdCents = num(t.costInUsdCents);
          const costLamports = solCostLamports(costUsdCents, usdPriceCents);
          const priceKnown = costLamports > 0;
          const curTierCost =
            effectiveTier > 0
              ? solCostLamports(
                  num(tiers[effectiveTier]?.costInUsdCents),
                  usdPriceCents
                )
              : 0;
          const upgradeDelta =
            idx > effectiveTier ? costLamports - curTierCost : 0;

          // Real perks, derived from on-chain config
          const gen = num(t.generationMultiplier);
          const genRatio = baseGen > 0 ? gen / baseGen : null;
          const perHour = gen * 12;
          const cap = num(t.maxLockedNovi);
          const dailyCap = num(npc?.noviSubDailyCap?.[idx]) / 10;
          const buyBonusBps = npc?.noviSubBonusBps?.[idx] ?? 0;
          const dr = num(t.dailyRewardMultiplier);
          const dr0 = num(baseTier?.dailyRewardMultiplier);
          const drRatio = dr0 > 0 ? dr / dr0 : null;
          const team = t.maxTeamMembers ?? 0;
          const rally = t.rallyCaps?.maxRallySize ?? 0;
          const travelBps = t.travelSpeedBonusBps ?? 0;

          // Signing grant summary
          const grantNovi = num(t.novi);
          const grantCash = num(t.cash);
          const troops =
            num(t.du1) + num(t.du2) + num(t.du3) +
            num(t.op1) + num(t.op2) + num(t.op3);
          const gear =
            num(t.meleeWeapons) + num(t.rangedWeapons) +
            num(t.siegeWeapons) + num(t.armor);
          const grantParts: string[] = [];
          if (grantNovi) grantParts.push(`${formatNumber(grantNovi)} NOVI`);
          if (grantCash) grantParts.push(`${formatNumber(grantCash)} cash`);
          if (troops) grantParts.push(`${formatNumber(troops)} troops`);
          if (gear) grantParts.push(`${formatNumber(gear)} gear`);

          return (
            <div
              key={idx}
              className={`relative flex flex-col rounded-xl border bg-surface-raised p-5 transition-transform ${
                isRecommended ? "md:-translate-y-3" : ""
              } ${isLocked ? "opacity-60" : ""}`}
              style={{
                borderColor: th.accent,
                boxShadow:
                  isRecommended || isCurrent
                    ? `0 8px 36px ${th.glow}`
                    : undefined,
              }}
            >
              {isRecommended && (
                <div
                  className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-black"
                  style={{ background: th.bright }}
                >
                  <Sparkles className="h-3 w-3" />
                  {effectiveTier === 0 ? "Most Popular" : "Your Next Step"}
                </div>
              )}
              {isCurrent && (
                <div
                  className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: `${th.accent}33`, color: th.bright }}
                >
                  <Check className="h-3 w-3" />
                  Held
                </div>
              )}

              {/* Name */}
              <div className="text-xl font-bold" style={{ color: th.bright }}>
                {t.name}
              </div>

              {/* Cost — live, from chain (USD price settled in SOL) */}
              <div className="mt-1 flex items-baseline gap-2">
                {priceKnown ? (
                  <>
                    <span className="text-3xl font-bold leading-none text-text-gold">
                      {formatLamportsAsSol(costLamports)}
                    </span>
                    <span className="text-[11px] text-text-muted">
                      ≈ ${(costUsdCents / 100).toLocaleString()}
                      {durationDays > 0 && ` · ${durationDays}-day charter`}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-text-muted">
                    Price unavailable
                  </span>
                )}
              </div>

              {/* Headline — generation multiplier */}
              <div
                className="mt-4 rounded-lg px-3 py-3 text-center"
                style={{ background: `${th.accent}1a` }}
              >
                <div
                  className="font-mono text-4xl font-bold leading-none tabular-nums"
                  style={{ color: th.bright }}
                >
                  {genRatio != null
                    ? asMultiplier(genRatio)
                    : perHour.toLocaleString()}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-text-muted">
                  NOVI Generation
                </div>
                <div className="text-[10px] text-text-muted">
                  ≈ {perHour.toLocaleString()}/hr · {gen}/5m
                </div>
              </div>

              {/* Perks */}
              <ul className="mt-4 flex-1 space-y-2">
                <PerkRow icon={Database} color={th.bright} strong>
                  Vault holds{" "}
                  <span className="font-semibold text-text-gold">
                    {formatNumber(cap)} NOVI
                  </span>{" "}
                  before it fills
                </PerkRow>
                {dailyCap > 0 && (
                  <PerkRow icon={ShoppingCart} color={th.bright} strong>
                    Buy up to{" "}
                    <span className="font-semibold text-text-gold">
                      {dailyCap.toLocaleString()} NOVI
                    </span>{" "}
                    every day
                  </PerkRow>
                )}
                {buyBonusBps > 0 && (
                  <PerkRow icon={Percent} color={th.bright}>
                    +{(buyBonusBps / 100).toFixed(0)}% bonus NOVI on every
                    purchase
                  </PerkRow>
                )}
                {drRatio != null && drRatio > 1 && (
                  <PerkRow icon={Gift} color={th.bright}>
                    {asMultiplier(drRatio)} daily rewards
                  </PerkRow>
                )}
                {grantParts.length > 0 && (
                  <PerkRow icon={Award} color={th.bright} strong>
                    Bonus:{" "}
                    <span className="text-text-secondary">
                      {grantParts.join(" · ")}
                    </span>
                  </PerkRow>
                )}
                {team > 0 && (
                  <PerkRow icon={Users} color={th.bright}>
                    Command a team of up to {team}
                  </PerkRow>
                )}
                {rally > 0 && (
                  <PerkRow icon={Swords} color={th.bright}>
                    Lead rallies up to {rally} strong
                  </PerkRow>
                )}
                {travelBps > 0 && (
                  <PerkRow icon={Wind} color={th.bright}>
                    +{(travelBps / 100).toFixed(0)}% travel speed
                  </PerkRow>
                )}
              </ul>

              {/* Action */}
              <div className="mt-4">
                {isCurrent ? (
                  <>
                    <TxButton
                      onClick={(reportPhase) => handlePurchase(idx, reportPhase)}
                      variant="secondary"
                      className="w-full"
                    >
                      {durationDays > 0
                        ? `Extend charter +${durationDays}d`
                        : "Extend charter"}
                    </TxButton>
                    {sub.expiresAt > 0 && durationDays > 0 && (
                      <p className="mt-1.5 text-center text-[11px] text-text-muted">
                        Stacks onto your term — new expiry{" "}
                        {new Date(
                          (sub.expiresAt + durationDays * 86_400) * 1000,
                        ).toLocaleDateString()}
                      </p>
                    )}
                  </>
                ) : isLocked ? (
                  <div className="rounded-lg border border-zinc-800 bg-surface py-2.5 text-center text-[11px] text-text-muted">
                    Available once your current charter ends
                  </div>
                ) : (
                  <>
                    <TxButton
                      onClick={(reportPhase) => handlePurchase(idx, reportPhase)}
                      variant={isRecommended ? "primary" : "secondary"}
                      className="w-full"
                    >
                      Move to this charter
                    </TxButton>
                    {effectiveTier > 0 && upgradeDelta > 0 && (
                      <p className="mt-1.5 text-center text-[11px] text-text-muted">
                        +{formatLamportsAsSol(upgradeDelta)} over your current
                        charter
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
