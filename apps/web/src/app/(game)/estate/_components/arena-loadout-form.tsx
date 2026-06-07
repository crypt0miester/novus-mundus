"use client";

import { useEffect, useMemo, useState } from "react";
import { Crosshair, Hammer, User, Pencil } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import {
  createUpdateLoadoutInstruction,
  isNullPubkey,
  NULL_PUBKEY,
} from "novus-mundus-sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useArenaLoadout } from "@/lib/hooks/useArena";
import { useLockedHeroes } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { InfoButton } from "@/components/shared/InfoButton";
import { bnToSafeNumber, cn, shortenAddress } from "@/lib/utils";

// The loadout's unit/weapon/armor counts are not escrowed, and arena power is
// min(loadout, owned) (challenge_player.calculate_arena_power clamps each count
// to current assets). So committing your full owned army is always optimal and
// committing less only caps you lower. We always save the player's current owned
// totals; the only real choice is the arena hero.
interface ArmyCounts {
  defense1: number;
  defense2: number;
  defense3: number;
  melee: number;
  ranged: number;
  siege: number;
  armor: number;
}

const ZERO_ARMY: ArmyCounts = {
  defense1: 0,
  defense2: 0,
  defense3: 0,
  melee: 0,
  ranged: 0,
  siege: 0,
  armor: 0,
};

// Ordered field metadata, shared by the editor list and the committed summary.
const ARMY_FIELDS: { key: keyof ArmyCounts; label: string; short: string }[] = [
  { key: "defense1", label: "Defensive Unit I", short: "Def I" },
  { key: "defense2", label: "Defensive Unit II", short: "Def II" },
  { key: "defense3", label: "Defensive Unit III", short: "Def III" },
  { key: "melee", label: "Melee Weapons", short: "Melee" },
  { key: "ranged", label: "Ranged Weapons", short: "Ranged" },
  { key: "siege", label: "Siege Weapons", short: "Siege" },
  { key: "armor", label: "Armor Pieces", short: "Armor" },
];

const armySum = (a: ArmyCounts) => ARMY_FIELDS.reduce((sum, f) => sum + a[f.key], 0);

export function ArenaLoadoutForm() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: loadoutData } = useArenaLoadout();
  const lockedHeroes = useLockedHeroes();
  const client = useNovusMundusClient();
  const transact = useTransact();

  const player = playerData?.account;
  const loadout = loadoutData?.account;
  const hasCommitted = !!loadout;

  // The committed army is always the player's full owned totals.
  const owned = useMemo<ArmyCounts>(() => {
    if (!player) return ZERO_ARMY;
    return {
      defense1: bnToSafeNumber(player.defensiveUnit1),
      defense2: bnToSafeNumber(player.defensiveUnit2),
      defense3: bnToSafeNumber(player.defensiveUnit3),
      melee: bnToSafeNumber(player.meleeWeapons),
      ranged: bnToSafeNumber(player.rangedWeapons),
      siege: bnToSafeNumber(player.siegeWeapons),
      armor: bnToSafeNumber(player.armorPieces),
    };
  }, [player]);

  // What is currently committed on-chain (drives the compact summary).
  const committed = useMemo<ArmyCounts>(() => {
    if (!loadout) return ZERO_ARMY;
    return {
      defense1: bnToSafeNumber(loadout.defensiveUnits[0] ?? 0n),
      defense2: bnToSafeNumber(loadout.defensiveUnits[1] ?? 0n),
      defense3: bnToSafeNumber(loadout.defensiveUnits[2] ?? 0n),
      melee: bnToSafeNumber(loadout.meleeWeapons),
      ranged: bnToSafeNumber(loadout.rangedWeapons),
      siege: bnToSafeNumber(loadout.siegeWeapons),
      armor: bnToSafeNumber(loadout.armorPieces),
    };
  }, [loadout]);

  const ownedPower = useMemo(() => armySum(owned), [owned]);
  const committedPower = useMemo(() => armySum(committed), [committed]);

  const committedHeroName = useMemo(() => {
    if (!loadout || isNullPubkey(loadout.arenaHero)) return null;
    const mint = loadout.arenaHero.toBase58();
    const hero = lockedHeroes.find((h) => h?.mint.toBase58() === mint);
    return hero?.name ?? shortenAddress(mint, 4);
  }, [loadout, lockedHeroes]);

  const [heroMint, setHeroMint] = useState<string>("");
  // The compact committed card is the default once a loadout exists; "Edit"
  // opens the full editor.
  const [editing, setEditing] = useState(false);

  // Preload the hero choice from the on-chain loadout once it resolves (the
  // counts are always max, so only the hero needs syncing).
  useEffect(() => {
    if (!loadout) return;
    setHeroMint(isNullPubkey(loadout.arenaHero) ? "" : loadout.arenaHero.toBase58());
  }, [loadout]);

  const heroValid = useMemo(() => {
    const trimmed = heroMint.trim();
    if (trimmed.length === 0) return true;
    try {
      new PublicKey(trimmed);
      return true;
    } catch {
      return false;
    }
  }, [heroMint]);

  const handleSave = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    let arenaHero = NULL_PUBKEY;
    const trimmed = heroMint.trim();
    if (trimmed.length > 0) {
      try {
        arenaHero = new PublicKey(trimmed);
      } catch {
        throw new Error("Hero is not a valid address");
      }
    }
    // Always commit the full owned army (counts are not escrowed).
    const ix = await createUpdateLoadoutInstruction(
      { owner: publicKey, gameEngine: ge },
      {
        arenaHero,
        defensiveUnits: [BigInt(owned.defense1), BigInt(owned.defense2), BigInt(owned.defense3)],
        meleeWeapons: BigInt(owned.melee),
        rangedWeapons: BigInt(owned.ranged),
        siegeWeapons: BigInt(owned.siege),
        armorPieces: BigInt(owned.armor),
      },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["arenaLoadout"], ["arenaParticipant"]],
        successMessage: "Loadout saved!",
        onPhase: reportPhase,
      })
      .then((r) => {
        setEditing(false); // collapse back to the compact summary
        return r.signature;
      });
  };

  // Committed and not editing: the compact summary card.
  if (hasCommitted && !editing) {
    const grew = ownedPower - committedPower;
    return (
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Arena Loadout
            <InfoButton>
              Your loadout is your full army at the time you saved it. Nothing is escrowed. Recruit
              more, then update to bring them in.
            </InfoButton>
          </h3>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-border-gold hover:text-text-primary"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] text-text-muted">Loadout Strength</div>
            <div className="font-mono text-lg font-semibold tabular-nums text-text-gold">
              {committedPower.toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-text-muted">Hero</div>
            <div className="flex items-center justify-end gap-1 text-sm text-text-primary">
              <User className="h-3.5 w-3.5 text-text-muted" />
              {committedHeroName ?? "None"}
            </div>
          </div>
        </div>

        {committedPower > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {ARMY_FIELDS.filter((f) => committed[f.key] > 0).map((f) => (
              <span
                key={f.key}
                className="rounded-md bg-surface-overlay px-2 py-1 text-[11px] text-text-secondary"
              >
                {f.short}{" "}
                <span className="font-mono tabular-nums text-text-primary">
                  {committed[f.key].toLocaleString()}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-text-muted">No army committed yet.</p>
        )}

        {grew > 0 && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full rounded-lg border border-[var(--tier-accent)] bg-accent/10 px-3 py-2 text-left text-[11px] tier-accent-text transition-colors hover:bg-accent/20"
          >
            Your army grew by {grew.toLocaleString()}. Update your loadout to commit it.
          </button>
        )}
      </div>
    );
  }

  // First-time setup, or editing an existing loadout: the full editor.
  const disabledReason = !publicKey
    ? "Connect your wallet to set a loadout."
    : !heroValid
      ? "Enter a valid hero address or leave it blank."
      : ownedPower === 0
        ? "You have no army yet. Recruit units, forge weapons, or craft armor first."
        : null;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Arena Loadout
          <InfoButton>
            Your loadout is your full army: every unit, weapon, and piece of armor you own fights in
            arena battles. Nothing is escrowed, so saving just commits your current totals.
          </InfoButton>
        </h3>
        <div className="text-right">
          <div className="text-[11px] text-text-muted">Loadout Strength</div>
          <div
            className={cn(
              "font-mono text-sm font-semibold tabular-nums",
              ownedPower > 0 ? "text-text-gold" : "text-red-400",
            )}
          >
            {ownedPower.toLocaleString()}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-1 text-xs text-text-muted">
          <User className="h-3.5 w-3.5" />
          Arena Hero
          <InfoButton>
            Optional. Pick one of your locked heroes to lead the loadout, or leave it empty for none.
          </InfoButton>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setHeroMint("")}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs transition-colors",
              heroMint.trim().length === 0
                ? "border-[var(--tier-accent)] bg-accent/15 text-text-primary"
                : "border-border-default text-text-secondary hover:text-text-primary",
            )}
          >
            None
          </button>
          {lockedHeroes
            .filter((h): h is NonNullable<typeof h> => h !== null)
            .map((h) => {
              const mint = h.mint.toBase58();
              const selected = heroMint.trim() === mint;
              return (
                <button
                  key={mint}
                  type="button"
                  onClick={() => setHeroMint(mint)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                    selected
                      ? "border-[var(--tier-accent)] bg-accent/15 text-text-primary"
                      : "border-border-default text-text-secondary hover:text-text-primary",
                  )}
                >
                  {h.name}
                </button>
              );
            })}
        </div>
        {heroMint.trim().length > 0 && (
          <p className="mt-1.5 font-mono text-[11px] text-text-muted">
            {heroValid ? shortenAddress(heroMint.trim(), 6) : "Invalid address"}
          </p>
        )}
      </div>

      {/* The army being committed is always your full owned totals (read-only). */}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Full Army
        </div>
        {ARMY_FIELDS.map((f) => (
          <div key={f.key} className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">{f.label}</span>
            <span className="font-mono tabular-nums text-text-primary">
              {owned[f.key].toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-2">
        <TxButton onClick={handleSave} disabled={disabledReason != null}>
          {hasCommitted ? "Update Loadout" : "Save Loadout"}
        </TxButton>
        {hasCommitted && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-[11px] text-text-muted transition-colors hover:text-text-secondary"
          >
            Cancel
          </button>
        )}
        {disabledReason && (
          <p className="flex items-center gap-1 text-center text-[11px] text-text-muted">
            <Crosshair className="h-3 w-3 shrink-0" />
            {disabledReason}
          </p>
        )}
      </div>

      <p className="flex items-center gap-1 text-[11px] text-text-muted">
        <Hammer className="h-3 w-3 shrink-0" />
        Recruit units, forge weapons, and craft armor across your estate to raise these totals, then
        save to commit them.
      </p>
    </div>
  );
}
