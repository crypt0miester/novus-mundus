"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  createSendReinforcementInstruction,
  derivePlayerPda,
  parsePlayer,
  isNullPubkey,
  isTraveling,
} from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTeam } from "@/lib/hooks/useTeam";
import { useLockedHeroes, NO_HERO_SLOT } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DomainName } from "@/components/shared/DomainName";
import {
  TripleCountInput,
  DEFENSIVE_UNIT_LABELS,
  DEFENSIVE_UNIT_ICONS,
  WEAPON_LABELS,
  WEAPON_ICONS,
} from "@/components/shared/TripleCountInput";
import { bnToSafeNumber } from "@/lib/utils";
import { useIsMountedRef } from "@/lib/hooks/useIsMountedRef";

interface ReinforceComposerPanelProps {
  /** Recipient wallet (base58) — preselected from the EntityPanel. */
  targetWallet: string;
  /** Optional close handler — when provided, takes precedence over the
   *  global RightPanel store's close. Set by callers that mount this
   *  panel outside the RightPanel store (e.g. the in-place swap inside
   *  the realm map's floating detail panel). */
  onClose?: () => void;
}

/**
 * Reinforce composer — the send form from the old /team Reinforce tab,
 * reshaped as a RightPanel content with the target preselected. The
 * in-flight list stays in the Reinforce tab; this panel only sends.
 *
 * Lifecycle:
 *  - Resolves the target's PlayerAccount to read their currentCity
 *    (required for the send instruction).
 *  - Submits createSendReinforcementInstruction, then closes the panel.
 *
 * Targets that are self, on no team, or that have no PlayerAccount yet
 * render an explanatory state instead of the form — the chain would
 * reject the tx anyway and we'd rather say so upfront.
 */
export function ReinforceComposerPanel({ targetWallet, onClose }: ReinforceComposerPanelProps) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const storeClose = useRightPanelStore((s) => s.close);
  const close = onClose ?? storeClose;
  const isMounted = useIsMountedRef();

  const targetKey = useMemo(() => new PublicKey(targetWallet), [targetWallet]);
  const teamPubkey = player?.team && !isNullPubkey(player.team) ? player.team : null;
  const { data: teamData } = useTeam(teamPubkey);
  const teamId = teamData?.account?.id;

  // Fetch the recipient PlayerAccount once — we need their currentCity for
  // the instruction. Cached for 30s; the recipient's city rarely flips.
  const { data: targetPlayer } = useQuery({
    queryKey: ["reinforce-composer", "target", targetWallet, client.gameEngine.toBase58()],
    queryFn: async () => {
      const [pda] = await derivePlayerPda(client.gameEngine, targetKey);
      const info = await connection.getAccountInfo(pda);
      return info ? parsePlayer(info) : null;
    },
    staleTime: 30_000,
  });

  const lockedHeroes = useLockedHeroes();
  const [heroSlot, setHeroSlot] = useState(NO_HERO_SLOT);
  const [units, setUnits] = useState<[number, number, number]>([0, 0, 0]);
  const [weapons, setWeapons] = useState<[number, number, number]>([0, 0, 0]);

  // Reset draft on target change — opening the panel for a different player
  // shouldn't carry the previous picker state.
  useEffect(() => {
    setUnits([0, 0, 0]);
    setWeapons([0, 0, 0]);
    setHeroSlot(NO_HERO_SLOT);
  }, [targetWallet]);

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

  const isSelf = publicKey ? publicKey.equals(targetKey) : false;
  const traveling = player ? isTraveling(player) : false;
  const hasAnyCommitment = units.some((n) => n > 0) || weapons.some((n) => n > 0);
  const submitDisabled = isSelf || !teamId || !targetPlayer || traveling || !hasAnyCommitment;

  const handleSend = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Wallet not connected");
    if (!teamId) throw new Error("You must be on a team to send reinforcements");
    if (!targetPlayer) throw new Error("Target player not found on chain");
    if (!hasAnyCommitment) throw new Error("Choose units or weapons to send");
    const hero = heroSlot < 3 ? lockedHeroes[heroSlot] : null;
    const ix = await createSendReinforcementInstruction(
      {
        sender: publicKey,
        gameEngine: client.gameEngine,
        destinationOwner: targetKey,
        senderCityId: player.currentCity,
        destinationCityId: targetPlayer.currentCity,
        teamId: Number(teamId),
        heroNft: hero?.mint,
      },
      {
        defensiveUnit1: units[0],
        defensiveUnit2: units[1],
        defensiveUnit3: units[2],
        meleeWeapons: weapons[0],
        rangedWeapons: weapons[1],
        siegeWeapons: weapons[2],
        heroSlot: hero ? heroSlot : NO_HERO_SLOT,
      },
    );
    const total = units.reduce((a, b) => a + b, 0);
    const sig = await transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Sent ${total.toLocaleString()} units in reinforcement!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
    if (isMounted.current) close();
    return sig;
  };

  // Submit lives on the MorphTabBar — matches the rally/garrison composers
  // and the rest of the RightPanel actions.
  useMorphActions([
    {
      id: "send-reinforcement",
      label: "Send Reinforcement",
      variant: "primary",
      disabled: submitDisabled,
      onClick: handleSend,
    },
  ]);

  // ─── Early states ───────────────────────────────────────────────

  if (isSelf) {
    return <p className="text-sm text-text-muted">You can&apos;t reinforce yourself.</p>;
  }

  if (!teamId) {
    return <p className="text-sm text-text-muted">Join a team to send reinforcements.</p>;
  }

  // Same-team gate — chain-side check at programs/.../reinforcement/send.rs:
  // sender and destination must share a team. Surface the rejection up front
  // instead of letting the user fill the form and eat a tx failure.
  if (targetPlayer && teamPubkey) {
    const targetTeam = (targetPlayer as { team?: { toBase58: () => string } }).team;
    const targetTeamStr = targetTeam?.toBase58?.();
    const myTeamStr = teamPubkey.toBase58();
    const sameTeam =
      !!targetTeamStr &&
      targetTeamStr !== "11111111111111111111111111111111" &&
      targetTeamStr === myTeamStr;
    if (!sameTeam) {
      return (
        <p className="text-sm text-text-muted">Reinforcements can only be sent to teammates.</p>
      );
    }
  }

  return (
    <div className="space-y-4">
      {/* Target identity */}
      <div className="rounded-lg border border-zinc-800 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-text-muted">To</div>
        <div className="font-mono text-sm text-text-primary">
          <DomainName pubkey={targetKey} chars={6} />
        </div>
        {targetPlayer && (
          <div className="mt-0.5 text-[11px] text-text-muted">
            {targetPlayer.name?.trim() || `Player #${targetPlayer.level}`} · Lv {targetPlayer.level}
          </div>
        )}
      </div>

      {traveling && (
        <div className="rounded-lg border border-border-gold bg-accent/20 px-3 py-2 text-xs text-danger">
          You are currently traveling.
        </div>
      )}

      {/* Defensive units committed */}
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

      {/* Weapons committed */}
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

      {/* Hero picker — only when the player has at least one locked hero. */}
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

      {/* Desktop submit — mirrors the morph-bar action so users without a
          mobile morph bar (md+ viewport) still have a primary button. */}
      <TxButton onClick={handleSend} disabled={submitDisabled} className="hidden md:block">
        Send Reinforcement
      </TxButton>
    </div>
  );
}
