"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useHeroBuffs } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { Badge } from "@/components/shared/Badge";
import {
  derivePlayerPda,
  deriveHeroTemplatePda,
  createMintHeroInstruction,
  createLevelUpHeroInstruction,
  createBurnHeroInstruction,
  isNullPubkey,
  isTraveling,
} from "@/lib/sdk";

export function HeroesTab() {
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const heroBuffs = useHeroBuffs();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const [selectedTemplate, setSelectedTemplate] = useState(0);

  const traveling = player ? isTraveling(player) : false;
  const fragments = player?.fragments?.toNumber?.() ?? 0;
  const emptySlots = player ? player.activeHeroes.filter((h: any) => isNullPubkey(h)).length : 0;
  const filledSlots = 3 - emptySlots;

  const handleMint = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [templatePda] = deriveHeroTemplatePda(selectedTemplate);
    const ix = createMintHeroInstruction(
      {
        player: playerPda,
        heroTemplate: templatePda,
        gameEngine: ge,
        owner: publicKey,
      },
      { templateId: selectedTemplate }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Hero minted!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleLevelUp = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const ix = createLevelUpHeroInstruction({
      player: playerPda,
      gameEngine: ge,
      owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Hero leveled up!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const [burnTemplateId, setBurnTemplateId] = useState(0);

  const handleBurnHero = async (slotIndex: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Wallet not connected");
    const heroAsset = player.activeHeroes[slotIndex];
    if (!heroAsset || isNullPubkey(heroAsset)) throw new Error("No hero in this slot");
    const ge = client.gameEngine;
    const ix = createBurnHeroInstruction(
      { owner: publicKey, gameEngine: ge, heroAsset },
      { templateId: burnTemplateId },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Hero burned! NOVI credited.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const heroSlots = player
    ? player.activeHeroes.map((hero, i) => ({
        pubkey: hero,
        isEmpty: isNullPubkey(hero),
        isDefensive: player.defensiveHeroSlot === i,
        isMeditating: player.meditatingHeroSlot === i,
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* Hero Buffs */}
      {heroBuffs.length > 0 && (
        <div className="card accent-border">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Hero Buffs
          </h3>
          <div className="flex flex-wrap gap-3">
            {heroBuffs.map((buff) => (
              <div
                key={buff.label}
                className="rounded-lg border border-zinc-800 px-3 py-2 text-center"
              >
                <div className="text-xs text-text-muted">{buff.label}</div>
                <div className="text-sm font-bold text-text-gold">
                  +{(buff.bps / 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {player && (
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span>Heroes: {filledSlots}/3 slots used</span>
          <span>Fragments: {fragments.toLocaleString()}</span>
          {traveling && <span className="text-amber-400">Traveling — some actions restricted</span>}
        </div>
      )}

      {/* Hero Slots */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-text-primary">Your Heroes</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {heroSlots.map((slot, i) => (
            <div
              key={i}
              className={`card text-center ${
                slot.isMeditating ? "accent-border-bright" : ""
              }`}
            >
              <div className="text-3xl">
                {!slot.isEmpty ? "⚔" : "◌"}
              </div>
              <div className="mt-2 text-sm font-semibold text-text-primary">
                {!slot.isEmpty ? `Hero #${i + 1}` : "Empty Slot"}
              </div>
              {!slot.isEmpty && (
                <>
                  <div className="text-xs text-text-muted">
                    {slot.isDefensive ? "Defensive" : slot.isMeditating ? "Meditating" : "Active"}
                  </div>
                  <Badge
                    variant={slot.isMeditating ? "gold" : "default"}
                  >
                    {slot.isMeditating ? "Meditating" : "Ready"}
                  </Badge>
                  <TxButton
                    onClick={(rp) => handleBurnHero(i, rp)}
                    variant="danger"
                    className="mt-2 text-xs"
                  >
                    Burn Hero
                  </TxButton>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Mint Hero */}
      <div className="card">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Mint New Hero
        </h3>
        <div className="flex items-center gap-4">
          <label className="text-sm text-text-muted">Template ID:</label>
          <input
            type="number"
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-24 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
            min={0}
          />
          {emptySlots === 0 && (
            <p className="text-xs text-amber-400">All hero slots are occupied</p>
          )}
          <TxButton onClick={handleMint} disabled={traveling || emptySlots === 0}>Mint Hero</TxButton>
          <TxButton onClick={handleLevelUp} variant="secondary" disabled={traveling}>
            Level Up
          </TxButton>
        </div>
      </div>

      {/* Burn Hero */}
      <div className="card">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Burn Hero
        </h3>
        <p className="mb-3 text-xs text-text-muted">
          Destroy a hero NFT and credit locked NOVI. Use the Burn button on a hero slot above.
        </p>
        <div className="flex items-center gap-4">
          <label className="text-sm text-text-muted">Burn Template ID:</label>
          <input
            type="number"
            value={burnTemplateId}
            onChange={(e) => setBurnTemplateId(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-24 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
            min={0}
          />
        </div>
      </div>
    </div>
  );
}
