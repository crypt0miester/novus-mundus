"use client";

import { useEffect, useMemo, useState } from "react";
import { Swords, Shield, Crosshair, Hammer, User } from "lucide-react";
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
import { NumberField } from "@/components/shared/NumberField";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { InfoButton } from "@/components/shared/InfoButton";
import { bnToSafeNumber, cn, shortenAddress } from "@/lib/utils";

// One configurable count in the loadout, paired with the player's owned total
// for advisory guidance. The chain trusts the loadout values, so owned is a
// soft ceiling on the slider, never a hard gate.
interface SlotState {
  defense1: number;
  defense2: number;
  defense3: number;
  melee: number;
  ranged: number;
  siege: number;
  armor: number;
}

const ZERO_SLOTS: SlotState = {
  defense1: 0,
  defense2: 0,
  defense3: 0,
  melee: 0,
  ranged: 0,
  siege: 0,
  armor: 0,
};

export function ArenaLoadoutForm() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: loadoutData } = useArenaLoadout();
  const lockedHeroes = useLockedHeroes();
  const client = useNovusMundusClient();
  const transact = useTransact();

  const player = playerData?.account;
  const loadout = loadoutData?.account;

  // Owned counts — advisory ceilings shown next to each control.
  const owned = useMemo(() => {
    if (!player) return ZERO_SLOTS;
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

  const [slots, setSlots] = useState<SlotState>(ZERO_SLOTS);
  const [heroMint, setHeroMint] = useState<string>("");

  // Preload from the on-chain loadout once it resolves. Re-running on the
  // loadout identity keeps the form in sync after a successful save.
  useEffect(() => {
    if (!loadout) return;
    setSlots({
      defense1: bnToSafeNumber(loadout.defensiveUnits[0] ?? 0n),
      defense2: bnToSafeNumber(loadout.defensiveUnits[1] ?? 0n),
      defense3: bnToSafeNumber(loadout.defensiveUnits[2] ?? 0n),
      melee: bnToSafeNumber(loadout.meleeWeapons),
      ranged: bnToSafeNumber(loadout.rangedWeapons),
      siege: bnToSafeNumber(loadout.siegeWeapons),
      armor: bnToSafeNumber(loadout.armorPieces),
    });
    setHeroMint(isNullPubkey(loadout.arenaHero) ? "" : loadout.arenaHero.toBase58());
  }, [loadout]);

  const setSlot = (key: keyof SlotState) => (next: number) =>
    setSlots((s) => ({ ...s, [key]: next }));

  const totalPower = useMemo(
    () =>
      slots.defense1 +
      slots.defense2 +
      slots.defense3 +
      slots.melee +
      slots.ranged +
      slots.siege +
      slots.armor,
    [slots],
  );

  // A slider's ceiling is the larger of the owned count and the currently
  // committed value, so a loadout that exceeds current stock (units spent
  // elsewhere) still renders without snapping down.
  const ceiling = (key: keyof SlotState) => Math.max(owned[key], slots[key], 1);

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
    const ix = await createUpdateLoadoutInstruction(
      { owner: publicKey, gameEngine: ge },
      {
        arenaHero,
        defensiveUnits: [
          BigInt(slots.defense1),
          BigInt(slots.defense2),
          BigInt(slots.defense3),
        ],
        meleeWeapons: BigInt(slots.melee),
        rangedWeapons: BigInt(slots.ranged),
        siegeWeapons: BigInt(slots.siege),
        armorPieces: BigInt(slots.armor),
      },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["arenaLoadout"], ["arenaParticipant"]],
        successMessage: "Loadout saved!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

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

  const disabledReason = !publicKey
    ? "Connect your wallet to set a loadout."
    : !heroValid
      ? "Enter a valid hero address or leave it blank."
      : totalPower === 0
        ? "An all-zero loadout battles at 0 power and only draws. Add units, weapons, or armor."
        : null;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Arena Loadout
          <InfoButton>
            Your loadout is what fights in arena battles. Counts are trusted on-chain, so the owned
            totals shown are guidance, not a hard cap. A loadout left at zero battles at 0 power and
            can only draw.
          </InfoButton>
        </h3>
        <div className="text-right">
          <div className="text-[11px] text-text-muted">Loadout Strength</div>
          <div
            className={cn(
              "font-mono text-sm font-semibold tabular-nums",
              totalPower > 0 ? "text-text-gold" : "text-red-400",
            )}
          >
            {totalPower.toLocaleString()}
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

      <div className="space-y-3">
        <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
          <Shield className="h-3.5 w-3.5" />
          Defensive Units
        </div>
        <NumberField
          label="Unit I"
          value={slots.defense1}
          onChange={setSlot("defense1")}
          max={ceiling("defense1")}
          size="sm"
          info={`Owned: ${owned.defense1.toLocaleString()}`}
        />
        <NumberField
          label="Unit II"
          value={slots.defense2}
          onChange={setSlot("defense2")}
          max={ceiling("defense2")}
          size="sm"
          info={`Owned: ${owned.defense2.toLocaleString()}`}
        />
        <NumberField
          label="Unit III"
          value={slots.defense3}
          onChange={setSlot("defense3")}
          max={ceiling("defense3")}
          size="sm"
          info={`Owned: ${owned.defense3.toLocaleString()}`}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
          <Swords className="h-3.5 w-3.5" />
          Weapons & Armor
        </div>
        <NumberField
          label="Melee Weapons"
          value={slots.melee}
          onChange={setSlot("melee")}
          max={ceiling("melee")}
          size="sm"
          info={`Owned: ${owned.melee.toLocaleString()}`}
        />
        <NumberField
          label="Ranged Weapons"
          value={slots.ranged}
          onChange={setSlot("ranged")}
          max={ceiling("ranged")}
          size="sm"
          info={`Owned: ${owned.ranged.toLocaleString()}`}
        />
        <NumberField
          label="Siege Weapons"
          value={slots.siege}
          onChange={setSlot("siege")}
          max={ceiling("siege")}
          size="sm"
          info={`Owned: ${owned.siege.toLocaleString()}`}
        />
        <NumberField
          label="Armor Pieces"
          value={slots.armor}
          onChange={setSlot("armor")}
          max={ceiling("armor")}
          size="sm"
          info={`Owned: ${owned.armor.toLocaleString()}`}
        />
      </div>

      <div className="flex flex-col items-center gap-2">
        <TxButton onClick={handleSave} disabled={disabledReason != null}>
          Save Loadout
        </TxButton>
        {disabledReason && (
          <p className="flex items-center gap-1 text-center text-[11px] text-text-muted">
            <Crosshair className="h-3 w-3 shrink-0" />
            {disabledReason}
          </p>
        )}
      </div>

      <p className="flex items-center gap-1 text-[11px] text-text-muted">
        <Hammer className="h-3 w-3 shrink-0" />
        Recruit units, forge weapons, and craft armor across your estate to raise these totals.
      </p>
    </div>
  );
}
