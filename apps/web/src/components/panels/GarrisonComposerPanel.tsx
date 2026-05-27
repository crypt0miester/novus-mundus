"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createJoinGarrisonInstruction,
  isNullPubkey,
  isTraveling,
} from "novus-mundus-sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTeam } from "@/lib/hooks/useTeam";
import { useCastle } from "@/lib/hooks/useCastle";
import { useLockedHeroes, NO_HERO_SLOT } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import {
  TripleCountInput,
  DEFENSIVE_UNIT_LABELS,
  DEFENSIVE_UNIT_ICONS,
  WEAPON_LABELS,
  WEAPON_ICONS,
} from "@/components/shared/TripleCountInput";
import { bnToSafeNumber } from "@/lib/utils";
import { useIsMountedRef } from "@/lib/hooks/useIsMountedRef";

interface GarrisonComposerPanelProps {
  /** Castle's city ID — derives the castle PDA. */
  cityId: number;
  /** Castle ID within that city. */
  castleId: number;
  /** Optional close handler — when provided, takes precedence over the
   *  global RightPanel store's close. Set by callers that mount this
   *  panel outside the RightPanel store. */
  onClose?: () => void;
}

/**
 * Garrison composer — contribute defensive units, weapons, and optionally a
 * hero to a castle's garrison. Chain-side gate at
 * programs/.../castle/join_garrison.rs requires `player.team == castle.team`,
 * so this panel refuses to render the form when the team check fails.
 */
export function GarrisonComposerPanel({ cityId, castleId, onClose }: GarrisonComposerPanelProps) {
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const storeClose = useRightPanelStore((s) => s.close);
  const close = onClose ?? storeClose;
  const isMounted = useIsMountedRef();

  const { data: castleData } = useCastle(cityId, castleId);
  const castle = castleData?.account;
  const teamPubkey = player?.team && !isNullPubkey(player.team) ? player.team : null;
  const { data: teamData } = useTeam(teamPubkey);
  const teamId = teamData?.account?.id;

  const lockedHeroes = useLockedHeroes();
  const [heroSlot, setHeroSlot] = useState(NO_HERO_SLOT);
  const [units, setUnits] = useState<[number, number, number]>([0, 0, 0]);
  const [weapons, setWeapons] = useState<[number, number, number]>([0, 0, 0]);

  useEffect(() => {
    setUnits([0, 0, 0]);
    setWeapons([0, 0, 0]);
    setHeroSlot(NO_HERO_SLOT);
  }, [cityId, castleId]);

  const ownedUnits: [number, number, number] = [
    bnToSafeNumber(player?.defensiveUnit1),
    bnToSafeNumber(player?.defensiveUnit2),
    bnToSafeNumber(player?.defensiveUnit3),
  ];
  const ownedWeapons: [number, number, number] = [
    bnToSafeNumber(player?.meleeWeapons),
    bnToSafeNumber(player?.rangedWeapons),
    bnToSafeNumber(player?.siegeWeapons),
  ];

  const traveling = player ? isTraveling(player) : false;
  const hasAnyCommitment = units.some((n) => n > 0) || weapons.some((n) => n > 0);

  const sameTeam = useMemo(() => {
    if (!castle || !teamPubkey) return false;
    const castleTeamStr = castle.team.toBase58();
    if (castleTeamStr === "11111111111111111111111111111111") return false;
    return castleTeamStr === teamPubkey.toBase58();
  }, [castle, teamPubkey]);

  const handleJoin = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Wallet not connected");
    if (!teamId) throw new Error("You must be on a team to garrison");
    if (!hasAnyCommitment) throw new Error("Choose units or weapons to contribute");
    const hero = heroSlot < 3 ? lockedHeroes[heroSlot] : null;
    const ix = createJoinGarrisonInstruction(
      {
        owner: publicKey,
        gameEngine: client.gameEngine,
        cityId,
        castleId,
      },
      {
        units: [units[0], units[1], units[2]],
        weapons: [weapons[0], weapons[1], weapons[2]],
        heroSlot: hero ? heroSlot : NO_HERO_SLOT,
        heroMint: hero?.mint,
        heroTemplateId: hero?.templateId,
      },
    );
    const sig = await transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["castle"]],
        successMessage: "Joined the garrison!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
    if (isMounted.current) close();
    return sig;
  };

  // Submit lives on the MorphTabBar — matches the rally/reinforce composers.
  const submitDisabled =
    !castle || !teamId || !sameTeam || traveling || !hasAnyCommitment;
  useMorphActions([
    {
      id: "join-garrison",
      label: "Join Garrison",
      variant: "primary",
      disabled: submitDisabled,
      onClick: handleJoin,
    },
  ]);

  // ─── Early states ───────────────────────────────────────────────

  if (!castle) {
    return <p className="text-sm text-text-muted">Loading castle…</p>;
  }

  if (!teamId) {
    return (
      <p className="text-sm text-text-muted">Join a team to garrison a castle.</p>
    );
  }

  if (!sameTeam) {
    return (
      <p className="text-sm text-text-muted">
        Only the castle&apos;s team may garrison it.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-text-muted">Castle</div>
        <div className="text-sm text-text-primary">
          {castle.name?.trim() || `Castle #${castle.castleId}`}
        </div>
        <div className="mt-0.5 text-[11px] text-text-muted">
          Garrison {castle.garrisonCount}/{castle.maxGarrison}
        </div>
      </div>

      {traveling && (
        <div className="rounded-lg border border-border-gold bg-accent/20 px-3 py-2 text-xs text-danger">
          You are currently traveling — garrison actions may be restricted.
        </div>
      )}

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Defensive Units
        </div>
        <TripleCountInput
          labels={DEFENSIVE_UNIT_LABELS}
          icons={DEFENSIVE_UNIT_ICONS}
          available={ownedUnits}
          value={units}
          onChange={setUnits}
          dense
        />
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Weapons
        </div>
        <TripleCountInput
          labels={WEAPON_LABELS}
          icons={WEAPON_ICONS}
          available={ownedWeapons}
          value={weapons}
          onChange={setWeapons}
          dense
        />
      </div>

      {lockedHeroes.some((h) => h !== null) && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Hero (optional)
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHeroSlot(NO_HERO_SLOT)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                heroSlot === NO_HERO_SLOT
                  ? "border-border-gold/50 bg-accent/30 text-text-gold"
                  : "border-zinc-700 bg-surface text-text-secondary hover:bg-surface/70"
              }`}
            >
              None
            </button>
            {lockedHeroes.map((h, i) =>
              h ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => setHeroSlot(i)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    heroSlot === i
                      ? "border-border-gold/50 bg-accent/30 text-text-gold"
                      : "border-zinc-700 bg-surface text-text-secondary hover:bg-surface/70"
                  }`}
                >
                  {h.name}
                </button>
              ) : null,
            )}
          </div>
        </div>
      )}

      <TxButton
        onClick={handleJoin}
        disabled={submitDisabled}
        className="hidden md:block"
      >
        Join Garrison
      </TxButton>
    </div>
  );
}
