"use client";

import { usePlayer } from "@/lib/hooks/usePlayer";
import { useLoot } from "@/lib/hooks/useLoot";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { PageTransition } from "@/components/shared/PageTransition";
import { Badge } from "@/components/shared/Badge";
import { WeaponGrid } from "@/components/shared/WeaponGrid";
import {
  derivePlayerPda,
  createClaimLootInstruction,
} from "@/lib/sdk";

const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const RARITY_VARIANTS: ("common" | "uncommon" | "rare" | "epic" | "legendary")[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

export default function InventoryPage() {
  const { data: playerData } = usePlayer();
  const { data: lootData } = useLoot();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const lootItems = lootData || [];

  const handleClaimLoot = async (lootPubkey: PublicKey, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const ix = createClaimLootInstruction({
      player: playerPda,
      loot: lootPubkey,
      gameEngine: ge,
      owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["loot"]],
      successMessage: "Loot claimed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimAll = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || lootItems.length === 0) throw new Error("No loot");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const instructions = lootItems.slice(0, 5).map((loot) =>
      createClaimLootInstruction({
        player: playerPda,
        loot: loot.pubkey,
        gameEngine: ge,
        owner: publicKey,
      })
    );
    return transact.mutateAsync({
      instructions,
      invalidateKeys: [["player"], ["loot"]],
      successMessage: `Claimed ${Math.min(5, lootItems.length)} loot drops!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">INVENTORY</h1>

        {/* Equipment Overview */}
        {player && (
          <div className="card accent-border">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Equipment
            </h3>
            <WeaponGrid
              melee={player.meleeWeapons?.toNumber?.() ?? 0}
              ranged={player.rangedWeapons?.toNumber?.() ?? 0}
              siege={player.siegeWeapons?.toNumber?.() ?? 0}
              armor={player.armorPieces?.toNumber?.() ?? 0}
            />
          </div>
        )}

        {/* Materials */}
        {player && (
          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Materials & Consumables
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <div className="text-xs text-text-muted">Fragments</div>
                <GoldNumber value={player.fragments?.toNumber?.() ?? 0} prefix="◇ " />
              </div>
              <div>
                <div className="text-xs text-text-muted">Common</div>
                <GoldNumber value={player.commonMaterials?.toNumber?.() ?? 0} glow={false} />
              </div>
              <div>
                <div className="text-xs text-text-muted">Uncommon</div>
                <GoldNumber value={player.uncommonMaterials?.toNumber?.() ?? 0} glow={false} />
              </div>
              <div>
                <div className="text-xs text-text-muted">Rare</div>
                <GoldNumber value={player.rareMaterials?.toNumber?.() ?? 0} glow={false} />
              </div>
            </div>
          </div>
        )}

        {/* Unclaimed Loot */}
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">
              Unclaimed Loot ({lootItems.length})
            </h2>
            {lootItems.length > 0 && (
              <TxButton onClick={handleClaimAll} variant="primary" className="text-xs">
                Claim All (max 5)
              </TxButton>
            )}
          </div>
          {lootItems.length === 0 ? (
            <div className="card mt-3">
              <p className="text-sm text-text-muted">
                No unclaimed loot. Fight encounters or complete dungeons to earn rewards!
              </p>
            </div>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {lootItems.map((loot, i) => {
                const rarity = loot.account.sourceRarity;
                return (
                  <div key={i} className="card group">
                    <div className="flex items-center justify-between">
                      <Badge variant={RARITY_VARIANTS[rarity] || "default"}>
                        {RARITY_NAMES[rarity] || "Unknown"}
                      </Badge>
                      <span className="text-xs text-text-muted">
                        #{loot.account.lootId.toString()}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-text-muted">Cash: </span>
                        <span className="text-text-gold">
                          ${loot.account.cash.toNumber()}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-muted">Gems: </span>
                        <span className="text-text-primary">
                          {loot.account.gems.toNumber()}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <TxButton
                        onClick={(reportPhase) => handleClaimLoot(loot.pubkey, reportPhase)}
                        variant="secondary"
                        className="w-full text-xs"
                      >
                        Claim
                      </TxButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
