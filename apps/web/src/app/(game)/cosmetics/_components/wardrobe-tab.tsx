"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { createEquipCosmeticInstruction, CosmeticKind, ExtensionFlags } from "novus-mundus-sdk";
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
            const owned = owns(id);
            const equipped = id === equippedId;
            const border = meta ? RARITY_BORDER[meta.rarity] : "rgba(110,78,36,0.55)";
            return (
              <div
                key={id}
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
                </div>
                {equipped ? (
                  <div
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--seal)" }}
                  >
                    Equipped
                  </div>
                ) : owned ? (
                  <TxButton onClick={(rp) => equip(kind, id, rp)} className="text-xs">
                    Equip
                  </TxButton>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-text-muted">
                    Locked
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
