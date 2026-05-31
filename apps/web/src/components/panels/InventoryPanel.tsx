"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { createClaimLootInstruction } from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useLoot } from "@/lib/hooks/useLoot";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import { Badge } from "@/components/shared/Badge";
import { WeaponGrid } from "@/components/shared/WeaponGrid";

const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const RARITY_VARIANTS: ("common" | "uncommon" | "rare" | "epic" | "legendary")[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

/**
 * Inventory — opened in the RightPanel via the `inventory` content key.
 * Unclaimed loot (claim rewards), equipment, and materials in one column.
 */
export function InventoryPanel() {
  const { data: playerData } = usePlayer();
  const { data: lootData } = useLoot();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const lootItems = lootData || [];

  const handleClaimLoot = async (
    lootPubkey: PublicKey,
    creator: PublicKey,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = await createClaimLootInstruction({
      loot: lootPubkey,
      gameEngine: client.gameEngine,
      owner: publicKey,
      creator,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["loot"]],
        successMessage: "Loot claimed!",
        onPhase: reportPhase,
      })
      .then((r) => {
        // useLoot is backed by the zustand store, not react-query — the claimed
        // loot account is gone on-chain, so drop it from the store directly.
        useAccountStore.getState().removeLoot(lootPubkey.toBase58());
        return r.signature;
      });
  };

  const handleClaimAll = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || lootItems.length === 0) throw new Error("No loot");
    const claimed = lootItems.slice(0, 5);
    const instructions = await Promise.all(
      claimed.map((loot) =>
        createClaimLootInstruction({
          loot: loot.pubkey,
          gameEngine: client.gameEngine,
          owner: publicKey,
          creator: loot.account.creator,
        }),
      ),
    );
    return transact
      .mutateAsync({
        instructions,
        invalidateKeys: [["player"], ["loot"]],
        successMessage: `Claimed ${claimed.length} loot drops!`,
        onPhase: reportPhase,
      })
      .then((r) => {
        const store = useAccountStore.getState();
        for (const loot of claimed) store.removeLoot(loot.pubkey.toBase58());
        return r.signature;
      });
  };

  const morphActions =
    lootItems.length > 0
      ? [
          {
            id: "claim-all-loot",
            label: `Claim All (${Math.min(lootItems.length, 5)})`,
            variant: "primary" as const,
            onClick: handleClaimAll,
          },
        ]
      : null;
  useMorphActions(morphActions);

  return (
    <div className="space-y-4">
      {/* Unclaimed loot — the claim-rewards section */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Unclaimed Loot ({lootItems.length})
          </h3>
          {lootItems.length > 0 && (
            <TxButton
              onClick={handleClaimAll}
              className="hidden text-[11px] px-2.5 py-1 lg:inline-flex"
            >
              Claim All
            </TxButton>
          )}
        </div>
        {lootItems.length === 0 ? (
          <p className="text-xs text-text-muted">
            No unclaimed loot. Fight encounters or clear dungeons to earn rewards.
          </p>
        ) : (
          <div className="space-y-2">
            {lootItems.map((loot) => {
              const rarity = loot.account.sourceRarity;
              return (
                <div
                  key={loot.account.lootId.toString()}
                  className="rounded-lg border border-border-default bg-surface/60 p-3"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant={RARITY_VARIANTS[rarity] || "default"}>
                      {RARITY_NAMES[rarity] || "Unknown"}
                    </Badge>
                    <span className="text-[10px] text-text-muted">
                      #{loot.account.lootId.toString()}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-4 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <span className="text-text-muted">Cash</span>
                      <GameIcon id="resource-cash" size={14} />
                      <span className="text-text-gold">{Number(loot.account.cash)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-text-muted">Gems</span>
                      <GameIcon id="resource-gem" size={14} />
                      <span className="text-text-primary">{Number(loot.account.gems)}</span>
                    </span>
                  </div>
                  <TxButton
                    onClick={(rp) => handleClaimLoot(loot.pubkey, loot.account.creator, rp)}
                    variant="secondary"
                    className="mt-2 w-full text-xs"
                  >
                    Claim
                  </TxButton>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Equipment */}
      {player && (
        <div className="border-t border-border-default pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Equipment
          </h3>
          <WeaponGrid
            melee={Number(player.meleeWeapons ?? 0n)}
            ranged={Number(player.rangedWeapons ?? 0n)}
            siege={Number(player.siegeWeapons ?? 0n)}
            armor={Number(player.armorPieces ?? 0n)}
          />
          {/* Provisions — produce (rations) and drays (transport). Both are
              first-class on-chain resources that ride alongside the army; gear
              swings, provisions move. */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="flex items-center justify-between rounded-md bg-surface/40 px-2.5 py-1.5">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Produce</div>
                <div className="text-[11px] text-text-muted">Rations from the ash-fed soil</div>
              </div>
              <GoldNumber value={Number(player.produce ?? 0n)} size="sm" />
            </div>
            <div className="flex items-center justify-between rounded-md bg-surface/40 px-2.5 py-1.5">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Drays</div>
                <div className="text-[11px] text-text-muted">Wagons, beasts, salvaged engines</div>
              </div>
              <GoldNumber value={Number(player.vehicles ?? 0n)} size="sm" />
            </div>
          </div>
        </div>
      )}

      {/* Materials */}
      {player && (
        <div className="border-t border-border-default pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Materials
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-text-muted">Fragments</div>
              <span className="inline-flex items-center gap-1">
                <GameIcon id="resource-fragments" size={14} />
                <GoldNumber value={Number(player.fragments ?? 0n)} />
              </span>
            </div>
            <div>
              <div className="text-[10px] text-text-muted">Common</div>
              <GoldNumber value={Number(player.commonMaterials ?? 0n)} glow={false} />
            </div>
            <div>
              <div className="text-[10px] text-text-muted">Uncommon</div>
              <GoldNumber value={Number(player.uncommonMaterials ?? 0n)} glow={false} />
            </div>
            <div>
              <div className="text-[10px] text-text-muted">Rare</div>
              <GoldNumber value={Number(player.rareMaterials ?? 0n)} glow={false} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
