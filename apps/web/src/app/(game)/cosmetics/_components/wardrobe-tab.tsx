"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { createEquipCosmeticInstruction, CosmeticKind, ExtensionFlags } from "novus-mundus-sdk";
import { animate, createTimeline, svg, utils, type JSAnimation, type Timeline } from "animejs";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { TxButton, type TxPhase } from "@/components/shared/TxButton";
import { CosmeticBadge } from "@/components/cosmetics/CosmeticBadge";
import {
  COSMETIC_BADGES,
  COSMETIC_TITLES,
  COSMETIC_COLORS,
  COSMETIC_FRAMES,
  RARITY_BORDER,
  getCosmeticBadge,
  getCosmeticTitle,
  getCosmeticColor,
  getCosmeticFrame,
  cosmeticColorAnimationClass,
  type CosmeticRarity,
} from "@/lib/config/cosmetics-catalog";
import { CosmeticFrame } from "@/components/cosmetics/CosmeticFrame";
import { prefersReducedMotion } from "@/lib/utils";

// Walk a u64 ownership bitmask and return the ids the player owns.
// id=0 is the equip-instruction's unequip sentinel (`createEquipCosmetic` with
// id=0 clears the slot), but the on-chain `fulfill_item` writes the matching
// `owned_<kind> |= 1u64 << (item_type - BASE)` and item_type==BASE legitimately
// flips bit 0. Walk the full 0..63 so an id-0 cosmetic — should one ever ship
// — is visible in the wardrobe (the Equip button is suppressed for id=0 since
// equipping id=0 means unequip; the user can still see they own it).
interface BitMaskLike {
  testn(bit: number): boolean;
}
function ownedIds(mask: BitMaskLike | undefined | null): number[] {
  if (!mask) return [];
  const out: number[] = [];
  for (let id = 0; id < 64; id++) {
    if (mask.testn(id)) out.push(id);
  }
  return out;
}

export function WardrobeTab() {
  const { data: playerData } = usePlayer();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const client = useNovusMundusClient();
  const ge = client.gameEngine;
  const player = playerData?.account;

  const ownedBadgeIds = useMemo(() => ownedIds(player?.ownedBadges), [player?.ownedBadges]);
  const ownedTitleIds = useMemo(() => ownedIds(player?.ownedTitles), [player?.ownedTitles]);
  const ownedColorIds = useMemo(() => ownedIds(player?.ownedColors), [player?.ownedColors]);
  const ownedFrameIds = useMemo(() => ownedIds(player?.ownedFrames), [player?.ownedFrames]);

  // EXT_COSMETICS is unlocked by the chain on the first cosmetic purchase.
  // Until then, equip would error with ExtensionPrerequisite and the user
  // pays the signature fee for a guaranteed-fail tx. Surface the gate as
  // a panel-wide notice so the call never goes out.
  const cosmeticsUnlocked = player ? (player.extensions & ExtensionFlags.COSMETICS) !== 0 : false;

  const equip = async (kind: CosmeticKind, id: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!cosmeticsUnlocked) {
      throw new Error("Buy a cosmetic from the shop to unlock the wardrobe.");
    }
    const ix = createEquipCosmeticInstruction({ owner: publicKey, gameEngine: ge }, { kind, id });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: id === 0 ? "Cosmetic removed" : "Cosmetic equipped",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  if (!player) {
    return (
      <div className="card">
        <p className="text-sm text-text-muted">Loading wardrobe...</p>
      </div>
    );
  }

  if (!cosmeticsUnlocked) {
    return (
      <div className="card">
        <p className="text-sm text-text-muted">
          Buy a cosmetic from the shop to unlock the wardrobe — equip is gated on the chain until
          you own one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Badges"
        kind={CosmeticKind.Badge}
        equippedId={player.equippedBadge}
        ownedIds={ownedBadgeIds}
        renderTile={(id) => {
          const entry = getCosmeticBadge(id);
          if (!entry) return null;
          return {
            rarity: entry.rarity,
            name: entry.name,
            flavor: entry.flavorText ?? null,
            visual: <CosmeticBadge id={id} size={48} />,
          };
        }}
        catalogIds={Object.keys(COSMETIC_BADGES).map(Number)}
        equip={equip}
      />

      <Section
        title="Titles"
        kind={CosmeticKind.Title}
        equippedId={player.equippedTitle}
        ownedIds={ownedTitleIds}
        renderTile={(id) => {
          const entry = getCosmeticTitle(id);
          if (!entry) return null;
          return {
            rarity: entry.rarity,
            name: entry.displayName,
            flavor: null,
            visual: (
              <span
                aria-hidden
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 6,
                  border: `2px solid ${RARITY_BORDER[entry.rarity]}`,
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                  color: RARITY_BORDER[entry.rarity],
                  flexShrink: 0,
                }}
              >
                T
              </span>
            ),
          };
        }}
        catalogIds={Object.keys(COSMETIC_TITLES).map(Number)}
        equip={equip}
      />

      <Section
        title="Name Colours"
        kind={CosmeticKind.NameColor}
        equippedId={player.equippedNameColor}
        ownedIds={ownedColorIds}
        renderTile={(id) => {
          const entry = getCosmeticColor(id);
          if (!entry) return null;
          // Apply the animation class to the swatch so animated colors
          // preview correctly in the wardrobe (a static swatch wouldn't
          // tell you what you're buying).
          const animClass = cosmeticColorAnimationClass(entry);
          return {
            rarity: entry.rarity,
            name: entry.name,
            flavor: null,
            visual: (
              <span
                aria-hidden
                className={animClass ?? undefined}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 6,
                  border: `2px solid ${RARITY_BORDER[entry.rarity]}`,
                  background: entry.hex,
                  // For aurora (color cycles), the keyframe drives the
                  // background via the `color` property — bridge via
                  // currentColor so the swatch fill animates too.
                  ...(entry.animation === "vesper"
                    ? { background: "currentColor", color: entry.hex }
                    : null),
                  flexShrink: 0,
                }}
              />
            ),
          };
        }}
        catalogIds={Object.keys(COSMETIC_COLORS).map(Number)}
        equip={equip}
      />

      <Section
        title="Avatar Frames"
        kind={CosmeticKind.AvatarFrame}
        equippedId={player.equippedAvatarFrame}
        ownedIds={ownedFrameIds}
        renderTile={(id) => {
          const entry = getCosmeticFrame(id);
          if (!entry) return null;
          return {
            rarity: entry.rarity,
            name: entry.name,
            flavor: entry.flavorText ?? null,
            // Preview the frame around a small parchment swatch so the
            // ring + glow read at the tile size.
            visual: (
              <CosmeticFrame id={id} size={48}>
                <span
                  aria-hidden
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--readout-tint, #efe2c4)",
                  }}
                />
              </CosmeticFrame>
            ),
          };
        }}
        catalogIds={Object.keys(COSMETIC_FRAMES).map(Number)}
        equip={equip}
      />
    </div>
  );
}

interface TileMeta {
  rarity: CosmeticRarity;
  name: string;
  flavor: string | null;
  visual: React.ReactNode;
}

interface SectionProps {
  title: string;
  kind: CosmeticKind;
  equippedId: number;
  ownedIds: number[];
  catalogIds: number[];
  renderTile: (id: number) => TileMeta | null;
  equip: (kind: CosmeticKind, id: number, rp: (p: TxPhase) => void) => Promise<string>;
}

// One kind of cosmetic. Lists every owned slot as a tile; the currently-
// equipped slot wears a gold ring. Tiles render even when the catalog has
// no entry — fall back to a numbered placeholder so the player sees that
// they own something, even if its display metadata hasn't shipped yet.
function Section({
  title,
  kind,
  equippedId,
  ownedIds,
  catalogIds,
  renderTile,
  equip,
}: SectionProps) {
  // Unique ids: union of what we own + what the catalog knows about. The
  // catalog is shown dimmed so the player can see what's available to buy.
  const allIds = useMemo(() => {
    const set = new Set<number>([...ownedIds, ...catalogIds]);
    return Array.from(set).sort((a, b) => a - b);
  }, [ownedIds, catalogIds]);
  const owns = (id: number) => ownedIds.includes(id);

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">{title}</h2>
        {equippedId !== 0 && (
          <TxButton onClick={(rp) => equip(kind, 0, rp)} className="text-xs w-auto">
            Take off
          </TxButton>
        )}
      </div>
      {allIds.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing in this slot yet — visit the shop.</p>
      ) : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {allIds.map((id) => {
            const meta = renderTile(id);
            return (
              <Tile
                key={id}
                id={id}
                kind={kind}
                meta={meta}
                owned={owns(id)}
                equipped={id === equippedId}
                equip={equip}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

interface TileProps {
  id: number;
  kind: CosmeticKind;
  meta: TileMeta | null;
  owned: boolean;
  equipped: boolean;
  equip: (kind: CosmeticKind, id: number, rp: (p: TxPhase) => void) => Promise<string>;
}

// One wardrobe tile. Owns the equip ceremony: on the equipped edge a reversible
// timeline morphs the border to the seal colour, blooms the rarity glow into a
// breathing halo, and self-draws a checkmark. Unequip plays the same timeline in
// reverse via anim.reverse().
function Tile({ id, kind, meta, owned, equipped, equip }: TileProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The reversible ceremony timeline, held across renders so unequip can reverse
  // the exact instance that played the equip (tiles re-render on the player
  // refetch that follows the equip tx, so this MUST survive re-render).
  const ceremonyRef = useRef<Timeline | null>(null);
  // The settled breathing halo, kept separate so unequip stops exactly it
  // (rather than removing every animation on the element, which would also wipe
  // the ceremony timeline we are about to reverse).
  const haloRef = useRef<JSAnimation | null>(null);
  // Edge-detect equipped: tiles re-render on every player refetch, so play the
  // ceremony only when this tile's equipped flag actually flips, not on mount or
  // an unrelated poll. Seeded to the current value so an already-equipped tile
  // mounting (page reload) does not fire.
  const wasEquippedRef = useRef<boolean>(equipped);
  // Stable id for the checkmark path so createDrawable keeps targeting the same
  // node across the re-renders that follow an equip.
  const checkId = `equip-check-${useId().replace(/:/g, "")}`;

  const border = meta ? RARITY_BORDER[meta.rarity] : "rgba(110,78,36,0.55)";
  // The rarity colour drives the bloom glow so the ceremony reads the item's tier.
  const glowColor = border;

  // Equip / unequip ceremony, edge-detected. Driven from a plain effect rather
  // than useAnimeScope because the reversible timeline must OUTLIVE a single
  // `equipped` value: it is built on the equip edge and reversed on the unequip
  // edge, so its lifetime cannot be tied to a deps:[equipped] scope (which would
  // cancel it on the very transition that wants to reverse it). Cleanup is
  // handled manually on unmount. Tiles re-render on every player refetch, so the
  // edge guard (wasEquippedRef) keeps the ceremony from re-firing on a poll.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const checkEl = root.querySelector<SVGPathElement>(`#${CSS.escape(checkId)}`);

    const justEquipped = equipped && !wasEquippedRef.current;
    const justUnequipped = !equipped && wasEquippedRef.current;
    wasEquippedRef.current = equipped;

    const reduce = prefersReducedMotion();

    const stopHalo = () => {
      haloRef.current?.cancel();
      haloRef.current = null;
    };
    const startHalo = () => {
      if (reduce) return;
      stopHalo();
      // A soft box-shadow halo is intrinsically main-thread paint; keep it
      // gentle and cheap. It is cancelled the instant we unequip / unmount.
      haloRef.current = animate(root, {
        boxShadow: [`0 0 16px ${glowColor}`, `0 0 26px ${glowColor}`, `0 0 16px ${glowColor}`],
        duration: 2600,
        ease: "inOutQuad",
        loop: true,
      });
    };

    // Reduced motion: commit the final visible state directly, no choreography.
    if (reduce) {
      if (checkEl) utils.set(checkEl, { opacity: equipped ? 1 : 0 });
      utils.set(root, { boxShadow: equipped ? `0 0 18px ${glowColor}` : "none" });
      return;
    }

    // No transition this render (an unrelated refetch): leave the resting state
    // alone so a mid-breathe re-render does not snap; re-arm the halo if equipped.
    if (!justEquipped && !justUnequipped) {
      if (equipped && !haloRef.current) startHalo();
      return () => stopHalo();
    }

    if (justEquipped) {
      const [check] = checkEl ? svg.createDrawable(checkEl) : [null];
      const tl = createTimeline({ defaults: { ease: "outQuad" } });
      // Resolve --seal to a concrete colour: anime color tweens need real stops,
      // not an unresolved CSS var(). Fall back to the rarity border if the var
      // is empty so the morph never animates to an invalid value.
      const seal = getComputedStyle(root).getPropertyValue("--seal").trim() || border;
      // Border morphs to the seal colour + the rarity glow blooms.
      tl.add(root, { borderColor: [border, seal], duration: 360 }, 0);
      tl.add(
        root,
        { boxShadow: ["0 0 0 rgba(0,0,0,0)", `0 0 22px ${glowColor}`], duration: 520 },
        0,
      );
      // The checkmark self-draws as the seal lands.
      if (check) {
        tl.add(check, { draw: ["0 0", "0 1"], opacity: [0, 1], duration: 420 }, 160);
      }
      ceremonyRef.current = tl;
      // Once the bloom settles, hand off to the low-cost breathing halo.
      tl.then(() => {
        if (rootRef.current && wasEquippedRef.current) startHalo();
      });
      return () => stopHalo();
    }

    // Unequip: stop the halo, then run the same ceremony backward (anim.reverse).
    stopHalo();
    const ceremony = ceremonyRef.current;
    if (ceremony) {
      ceremony.reverse();
      ceremony.play();
    } else {
      utils.set(root, { boxShadow: "none", borderColor: border });
      if (checkEl) utils.set(checkEl, { opacity: 0 });
    }
    return () => stopHalo();
  }, [equipped, border, glowColor, checkId]);

  // Final unmount cleanup: cancel the ceremony timeline (the per-render effect
  // owns the halo). Kept separate so it runs only on unmount, not on every edge.
  useEffect(() => {
    return () => {
      ceremonyRef.current?.cancel();
      ceremonyRef.current = null;
      haloRef.current?.cancel();
      haloRef.current = null;
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-2 rounded-lg border p-3 transition-opacity"
      style={{
        borderColor: equipped ? "var(--seal)" : border,
        opacity: owned ? 1 : 0.45,
        background: equipped ? "var(--readout-tint)" : undefined,
      }}
      title={meta?.flavor ?? meta?.name ?? `#${id}`}
    >
      <div className="flex items-center gap-2">
        {meta?.visual ?? (
          <span
            aria-hidden
            style={{
              width: 48,
              height: 48,
              borderRadius: 6,
              border: `2px solid ${border}`,
              display: "grid",
              placeItems: "center",
              color: "var(--ink-soft)",
              flexShrink: 0,
            }}
          >
            #{id}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider" style={{ color: border }}>
            {meta?.rarity ?? "unknown"}
          </div>
          <div className="text-sm font-semibold text-text-primary truncate">
            {meta?.name ?? `Slot ${id}`}
          </div>
        </div>
        {/* The self-drawing equip seal checkmark. Hidden until the ceremony
            etches it; lives in the tile so it travels with the equipped item. */}
        <svg
          role="img"
          aria-label="Equipped"
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0"
          style={{ color: "var(--seal)" }}
        >
          <path
            id={checkId}
            d="M5 12.5 L10 17.5 L19 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: equipped ? 1 : 0 }}
          />
        </svg>
      </div>
      {equipped ? (
        <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--seal)" }}>
          Equipped
        </div>
      ) : owned ? (
        <TxButton onClick={(rp) => equip(kind, id, rp)} className="text-xs">
          Equip
        </TxButton>
      ) : (
        <span className="text-[10px] uppercase tracking-wider text-text-muted">Locked</span>
      )}
    </div>
  );
}
