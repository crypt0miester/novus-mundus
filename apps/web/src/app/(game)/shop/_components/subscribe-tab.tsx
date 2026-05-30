"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { animate, createTimeline, stagger, utils } from "animejs";
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
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { SETTLE } from "@/lib/motion/tokens";
import {
  PaymentMethodSelector,
  formatPaymentPrice,
  formatPriceUsd,
  type PaymentMethod,
} from "./PaymentMethodSelector";
import {
  createPurchaseSubscriptionInstruction,
  deciToNovi,
  getEffectiveTier,
} from "novus-mundus-sdk";
import { tierPalette } from "@/lib/hooks/useTierTheme";
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

// Fallback featured tier for a player with no charter — the middle paid tier
// is the classic decoy anchor (don't push a brand-new player to the top tier).
const ANCHOR_TIER = 2;

// Per-tier accent for the subscribe tiles. Reads from the shared
// `TIER_PALETTE` so the tile colour for tier N matches the global theme
// when `data-tier=N` is active. Was previously a local copy ("iron / bronze /
// silver / gold") that drifted from the green / blue / purple / gold ladder.
const theme = tierPalette;

// "No Charter" muted palette. Deliberately distinct from theme(0) — the
// current-charter card uses this when sub.active is false so the box
// reads as absence (cool zinc, no glow) instead of as a paying Rookie
// tile, preserving the loss-aversion framing recommended elsewhere in
// this file. theme(0) keeps its tier-0 visual signal for in-grid tiles
// that represent the actual Rookie purchase choice.
const NO_CHARTER_THEME = {
  accent: "#3f3f46", // zinc-700
  bright: "#a1a1aa", // zinc-400
} as const;

/** BN | number | undefined to number */
function num(v: unknown): number {
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

/** 1 to "1×", 2.5 to "2.5×" */
function asMultiplier(r: number): string {
  return Number.isInteger(r) ? `${r}×` : `${r.toFixed(1)}×`;
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
      <span className={strong ? "text-text-primary" : "text-text-secondary"}>{children}</span>
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

  // Default to SOL; user can flip to USDC/USDT (or any whitelisted token).
  // The selector hides options the chain would reject.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>({ kind: "sol" });

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

  // No charter = unsubscribed (chain falls back to tier 0 config as the
  // baseline, but the player has bought nothing). Distinct from Rookie active.
  const noCharter = !sub.active;

  // Featured tier: decoy-anchor (Epic) for unsubscribed players, otherwise
  // their realistic next purchase (current + 1).
  const recommendedTier = noCharter
    ? Math.min(tiers.length - 1, ANCHOR_TIER)
    : Math.min(tiers.length - 1, effectiveTier + 1);

  const tierName = (i: number) => tiers[i]?.name ?? `Tier ${i}`;

  const handlePurchase = async (tierId: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const geAccount = geData?.account;
    if (!geAccount) throw new Error("Game engine not loaded");

    /*
     * Non-pegged tokens require oracle accounts (Pyth pair or Switchboard
     * triple) — the subscribe flow has no UI to surface those yet, so reject
     * here rather than send an ix the chain would respond to with a generic
     * NotEnoughAccountKeys. The selector currently doesn't filter, so this
     * guard is the only line of defence.
     */
    if (paymentMethod.kind === "token" && !paymentMethod.pegged) {
      throw new Error(
        `${paymentMethod.symbol ?? "this token"} is oracle-priced; pegged-stablecoin payments only for now.`,
      );
    }

    /*
     * Build the ix in the right mode for the selected payment method. SOL is
     * a direct lamport transfer; tokens go through `process_token_payment_flow`
     * which dispatches by `AllowedTokenAccount.pegged_to_usd`.
     */
    const ix =
      paymentMethod.kind === "sol"
        ? createPurchaseSubscriptionInstruction(
            {
              owner: publicKey,
              gameEngine: ge,
              paymentAuthority: publicKey,
              treasury: geAccount.treasuryWallet,
            },
            { paymentType: 0, tier: tierId },
          )
        : createPurchaseSubscriptionInstruction(
            {
              owner: publicKey,
              gameEngine: ge,
              paymentAuthority: publicKey,
              treasury: geAccount.treasuryWallet,
              tokenPayment: {
                tokenMint: paymentMethod.mint,
                /*
                 * Pegged → no oracle accounts. Non-pegged token selections
                 * are blocked by the guard above.
                 */
              },
            },
            { paymentType: 2, tier: tierId },
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
  const curTheme = noCharter ? NO_CHARTER_THEME : theme(effectiveTier);
  const cur = tiers[effectiveTier];
  // NOVI-denominated tier fields (generationMultiplier, maxLockedNovi, novi
  // grant) are stored on-chain as raw deci-NOVI (mint decimals=1). Convert
  // once here so every downstream display reads as real NOVI.
  const curGen = deciToNovi(num(cur?.generationMultiplier));
  const baseGen = deciToNovi(num(baseTier?.generationMultiplier));
  const curGenRatio = baseGen > 0 ? curGen / baseGen : null;
  const daysLeft = sub.active && sub.expiresAt > 0 ? (sub.expiresAt - nowSec) / 86_400 : null;
  const expiringSoon = daysLeft != null && daysLeft < 3;

  // The whole tab (current charter + ladder). The expiry pulse lives in the
  // current-charter card; the deal-in + float live in the grid. Both scope off
  // refs within this subtree.
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Deal the cards in left-to-right (spring rise), cascade each card's perk list
  // as it lands, and float the recommended tier higher on an outElastic spring
  // (replacing the static md:-translate-y-3 lift). Keyed on the tier count + the
  // recommended index so it replays only when the ladder shape changes, not on
  // the per-second nowSec tick.
  useAnimeScope({ root: gridRef, deps: [tiers.length, recommendedTier] }, ({ reduce }) => {
    const cards = gridRef.current?.querySelectorAll<HTMLElement>("[data-tier-card]");
    const floatEl = gridRef.current?.querySelector<HTMLElement>("[data-recommended-float]");

    if (reduce) {
      // Set the final resting state directly, skip the choreography.
      if (cards) for (const c of cards) utils.set(c, { opacity: 1, translateY: 0 });
      if (floatEl) utils.set(floatEl, { translateY: -12 });
      return;
    }

    const tl = createTimeline({ defaults: { ease: SETTLE } });

    // Cards rise into place, dealt left-to-right. Perk lists cascade down just
    // behind the cards so each list reads as landing with its card.
    if (cards && cards.length > 0) {
      tl.add(cards, { opacity: [0, 1], translateY: [22, 0], duration: 520, delay: stagger(90) }, 0);
      tl.add(
        "[data-perks] > li",
        { opacity: [0, 1], translateY: [8, 0], duration: 360, delay: stagger(45) },
        120,
      );
    }

    // The recommended tier floats higher on a springy outElastic settle so the
    // lift reads as physics rather than a static class offset.
    if (floatEl) {
      tl.add(floatEl, { translateY: [0, -12], ease: "outElastic(1, .6)", duration: 900 }, 240);
    }
  });

  // Conditional expiry pulse, keyed on the real subscription_end via
  // expiringSoon. A looping breathe (scale/opacity) on the lapse readout that
  // early-returns under reduced motion and only runs while actually lapsing soon.
  useAnimeScope({ root: rootRef, deps: [expiringSoon] }, ({ reduce }) => {
    if (reduce || !expiringSoon) return;
    const pulseEl = rootRef.current?.querySelector<HTMLElement>("[data-expiry-pulse]");
    if (!pulseEl) return;
    animate(pulseEl, {
      scale: [1, 1.04, 1],
      opacity: [0.85, 1, 0.85],
      duration: 1400,
      ease: "inOutQuad",
      loop: true,
    });
  });

  return (
    <div ref={rootRef} className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-primary">
          A Patron&apos;s Charter
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          A charter is a standing arrangement with a patron, it multiplies your NOVI generator,
          widens your vault, and grants a signing bounty the moment it is sealed. Higher charters
          compound everything below.
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
              <div className="text-lg font-bold leading-tight" style={{ color: curTheme.bright }}>
                {noCharter ? "No Charter" : tierName(effectiveTier)}
              </div>
            </div>
          </div>
          {sub.active && sub.expiresAt > 0 && (
            <div data-expiry-pulse className="text-right">
              <div
                className={`flex items-center justify-end gap-1 text-[10px] uppercase tracking-wider ${
                  expiringSoon ? "text-danger" : "text-text-muted"
                }`}
              >
                {expiringSoon && <Clock className="h-3 w-3 animate-pulse" />}
                {expiringSoon ? "Lapses soon" : "Expires"}
              </div>
              <GoldCountdown endsAt={sub.expiresAt} format="full" />
            </div>
          )}
        </div>

        {/* Downgrade preview — loss aversion. Only meaningful above tier 0,
            since on-chain tier 0 (Rookie) is the fallback config for everyone. */}
        {sub.active && effectiveTier > 0 && curGenRatio != null && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-surface/60 px-3 py-2 text-[11px] text-text-muted">
            <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-text-gold" />
            <span>
              {expiringSoon ? "Renew before it lapses — " : "If this charter lapses, "}
              your generator drops{" "}
              <span className="font-semibold text-text-secondary">
                {asMultiplier(curGenRatio)} to 1×
              </span>{" "}
              and your vault shrinks to{" "}
              <span className="font-semibold text-text-secondary">
                {formatNumber(deciToNovi(num(baseTier?.maxLockedNovi)))} NOVI
              </span>
              .
            </span>
          </div>
        )}
        {sub.active && effectiveTier === 0 && (
          <p className="mt-3 text-[11px] text-text-muted">
            Your Rookie charter is active — renewing keeps the signing bounty flowing. Stepping up
            to Expert and above multiplies your NOVI generator on top.
          </p>
        )}
        {noCharter && (
          <p className="mt-3 text-[11px] text-text-muted">
            You hold no charter. Each charter below pays a signing bounty up front, and the higher
            ones multiply your NOVI generator on top.
          </p>
        )}
      </div>

      {/* Payment method — SOL by default, or any whitelisted token. The
          selector hides options the chain can't honor for a USD-priced product. */}
      <PaymentMethodSelector product="usd" value={paymentMethod} onChange={setPaymentMethod} />

      {/* ─── Tier ladder (paid charters) ─── */}
      <div ref={gridRef} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiers.map((t) => {
          const idx = t.tierIndex ?? tiers.indexOf(t);
          const th = theme(idx);
          const isCurrent = sub.active && idx === effectiveTier;
          const isRecommended = idx === recommendedTier && !isCurrent;
          // The chain rejects buying a tier below your active charter.
          const isLocked = sub.active && idx < effectiveTier;
          const durationDays = t.durationDays ?? 0;

          // Live cost — USD-denominated, settled in SOL at the chain rate
          // The selector + helper convert this USD-cent amount into whichever
          // method the user picked (SOL / USDC / USDT / ...).
          const costUsdCents = num(t.costInUsdCents);
          const priceKnown = costUsdCents > 0 && usdPriceCents > 0;
          // Upgrade delta — USD-cents (so it renders in whichever payment method).
          const curTierCostUsdCents = sub.active ? num(tiers[effectiveTier]?.costInUsdCents) : 0;
          const upgradeDeltaUsdCents =
            sub.active && idx > effectiveTier ? costUsdCents - curTierCostUsdCents : 0;

          // Real perks, derived from on-chain config
          const gen = deciToNovi(num(t.generationMultiplier));
          const genRatio = baseGen > 0 ? gen / baseGen : null;
          const perHour = gen * 12;
          const cap = deciToNovi(num(t.maxLockedNovi));
          const dailyCap = num(npc?.noviSubDailyCap?.[idx]) / 10;
          const buyBonusBps = npc?.noviSubBonusBps?.[idx] ?? 0;
          const dr = num(t.dailyRewardMultiplier);
          const dr0 = num(baseTier?.dailyRewardMultiplier);
          const drRatio = dr0 > 0 ? dr / dr0 : null;
          const team = t.maxTeamMembers ?? 0;
          const rally = t.rallyCaps?.maxRallySize ?? 0;
          const travelBps = t.travelSpeedBonusBps ?? 0;

          // Signing grant summary. Drays (the chain `vehicles` field) are listed
          // separately from weapons/armor — they're a transport resource in the
          // lore, not gear you swing in a fight.
          const grantNovi = deciToNovi(num(t.novi));
          const grantCash = num(t.cash);
          const troops =
            num(t.du1) + num(t.du2) + num(t.du3) + num(t.op1) + num(t.op2) + num(t.op3);
          const gear =
            num(t.meleeWeapons) + num(t.rangedWeapons) + num(t.siegeWeapons) + num(t.armor);
          const grantDrays = num(t.vehicles);
          const grantParts: string[] = [];
          if (grantNovi) grantParts.push(`${formatNumber(grantNovi)} NOVI`);
          if (grantCash) grantParts.push(`${formatNumber(grantCash)} cash`);
          if (troops) grantParts.push(`${formatNumber(troops)} troops`);
          if (gear) grantParts.push(`${formatNumber(gear)} gear`);
          if (grantDrays) grantParts.push(`${formatNumber(grantDrays)} drays`);

          return (
            <div
              key={idx}
              data-tier-card
              {...(isRecommended ? { "data-recommended-float": "" } : {})}
              className={`relative flex flex-col rounded-xl border bg-surface-raised p-5 ${
                isLocked ? "opacity-60" : ""
              }`}
              style={{
                borderColor: th.accent,
              }}
            >
              {/* Always rendered (opacity-toggled, not display-toggled) so the
                  badge never flashes in on the float beat. */}
              <div
                className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-black"
                style={{
                  background: th.bright,
                  opacity: isRecommended ? 1 : 0,
                  pointerEvents: isRecommended ? undefined : "none",
                }}
              >
                <Sparkles className="h-3 w-3" />
                {effectiveTier === 0 ? "Most Popular" : "Your Next Step"}
              </div>
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
              <div className="text-base font-bold" style={{ color: th.bright }}>
                {t.name}
              </div>

              {/* Cost — live, from chain. Renders in the selected payment
                  method (SOL / USDC / USDT / ...) with a $ hint underneath. */}
              <div className="mt-1 flex items-baseline gap-2">
                {priceKnown ? (
                  <>
                    <span className="text-lg font-bold leading-none text-text-gold">
                      {formatPaymentPrice(paymentMethod, {
                        usdCents: costUsdCents,
                        solUsdRateCents: usdPriceCents,
                      })}
                    </span>
                    <span className="text-[11px] text-text-muted">
                      ≈ {formatPriceUsd({ usdCents: costUsdCents })}
                      {durationDays > 0 && ` · ${durationDays}-day charter`}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-text-muted">Price unavailable</span>
                )}
              </div>

              {/* Headline — generation multiplier */}
              <div
                className="mt-4 rounded-lg px-3 py-3 text-center"
                style={{ background: `${th.accent}1a` }}
              >
                <div
                  className="font-mono text-xl font-bold leading-none tabular-nums"
                  style={{ color: th.bright }}
                >
                  {genRatio != null ? asMultiplier(genRatio) : perHour.toLocaleString()}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-text-muted">
                  NOVI Generation
                </div>
                <div className="text-[10px] text-text-muted">
                  ≈ {perHour.toLocaleString()}/hr · {gen}/5m
                </div>
              </div>

              {/* Perks */}
              <ul data-perks className="mt-4 flex-1 space-y-2">
                <PerkRow icon={Database} color={th.bright} strong>
                  Vault holds{" "}
                  <span className="font-semibold text-text-gold">{formatNumber(cap)} NOVI</span>{" "}
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
                    +{(buyBonusBps / 100).toFixed(0)}% bonus NOVI on every purchase
                  </PerkRow>
                )}
                {drRatio != null && drRatio > 1 && (
                  <PerkRow icon={Gift} color={th.bright}>
                    {asMultiplier(drRatio)} daily rewards
                  </PerkRow>
                )}
                {grantParts.length > 0 && (
                  <PerkRow icon={Award} color={th.bright} strong>
                    Bonus: <span className="text-text-secondary">{grantParts.join(" · ")}</span>
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
                      {durationDays > 0 ? `Extend charter +${durationDays}d` : "Extend charter"}
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
                    {sub.active && upgradeDeltaUsdCents > 0 && (
                      <p className="mt-1.5 text-center text-[11px] text-text-muted">
                        +
                        {formatPaymentPrice(paymentMethod, {
                          usdCents: upgradeDeltaUsdCents,
                          solUsdRateCents: usdPriceCents,
                        })}{" "}
                        over your current charter
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
