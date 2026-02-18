"use client";

import { usePlayer } from "@/lib/hooks/usePlayer";
import { useCity } from "@/lib/hooks/useCity";
import { useEncounters } from "@/lib/hooks/useEncounters";
import { useStamina } from "@/lib/hooks/useStamina";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { PageTransition } from "@/components/shared/PageTransition";
import { LoadingSequence, getLoadingSteps } from "@/components/loading/LoadingSequence";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import Link from "next/link";

const ENCOUNTER_RARITY = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "World Event"];
const RARITY_COLORS = [
  "text-zinc-400",
  "text-green-400",
  "text-blue-400",
  "text-purple-400",
  "text-amber-400",
  "text-red-400",
];

export default function CityPage() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const player = playerData?.account;
  const cityId = player?.currentCity;
  const { data: cityData, isSuccess: cityReady } = useCity(cityId);
  const { data: encounterData, isSuccess: encountersReady } = useEncounters(cityId);

  const stamina = useStamina(
    player?.encounterStamina?.toNumber(),
    player?.lastStaminaUpdate?.toNumber(),
    player?.maxEncounterStamina?.toNumber(),
    player ? 1 / 60 : undefined
  );

  const [completedKeys] = useState(() => new Set<string>());
  if (cityReady) completedKeys.add("city");
  if (encountersReady) completedKeys.add("encounters");
  if (playerReady) completedKeys.add("players");

  const city = cityData?.account;
  const encounters = encounterData || [];

  return (
    <LoadingSequence steps={getLoadingSteps("city")} completedKeys={completedKeys}>
      <PageTransition>
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="tier-title font-display text-3xl font-bold tracking-wide">
              {city?.name || `CITY ${cityId ?? "?"}`}
            </h1>
            <Link
              href="/travel"
              className="accent-border rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text-gold transition-all"
            >
              Travel
            </Link>
          </div>

          {/* City Stats */}
          {city && (
            <div className="card accent-border">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <div className="text-xs text-text-muted">Type</div>
                  <div className="text-sm font-semibold text-text-primary">
                    {["Capital", "Resource", "Combat", "Trade"][city.cityType] || "Unknown"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Players</div>
                  <GoldNumber value={city.playersPresent ?? 0} size="sm" />
                </div>
                <div>
                  <div className="text-xs text-text-muted">Encounters</div>
                  <GoldNumber value={encounters.length} size="sm" glow={encounters.length > 0} />
                </div>
                <div>
                  <div className="text-xs text-text-muted">Your Stamina</div>
                  <GoldNumber value={stamina.current} suffix={`/${stamina.max}`} size="sm" />
                </div>
              </div>
            </div>
          )}

          {/* Stamina Bar */}
          {player && (
            <div className="card">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Encounter Stamina
              </h3>
              <StatBar current={stamina.current} max={stamina.max} color="gold" />
              {stamina.current < stamina.max && (
                <div className="mt-1 text-xs text-text-muted">
                  Next point in ~{Math.ceil((1 - (stamina.current % 1)) * 60)}s
                </div>
              )}
            </div>
          )}

          {/* Encounters */}
          <div>
            <h2 className="mb-3 text-lg font-semibold text-text-primary">Active Encounters</h2>
            {encounters.length === 0 ? (
              <div className="card">
                <p className="text-sm text-text-muted">
                  No encounters in this city. Check back soon or travel to another city.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {encounters.map((enc, i) => {
                  const rarity = enc.account.rarity ?? 0;
                  const hp = enc.account.health.toNumber();
                  const maxHp = enc.account.maxHealth.toNumber();
                  return (
                    <div key={i} className="card group cursor-pointer transition-all">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className={`text-xs font-semibold uppercase ${RARITY_COLORS[rarity]}`}>
                            {ENCOUNTER_RARITY[rarity]}
                          </span>
                          <div className="mt-1 text-sm text-text-primary">
                            Encounter #{enc.account.id.toString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-text-muted">HP</div>
                          <GoldNumber value={hp} suffix={`/${maxHp}`} size="sm" />
                        </div>
                      </div>
                      <div className="mt-2">
                        <StatBar current={hp} max={maxHp} color="gold" size="sm" showValues={false} />
                      </div>
                      <Link
                        href={`/combat?type=encounter&id=${enc.account.id.toString()}`}
                        className="mt-2 block text-center text-xs font-semibold text-text-gold opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        ATTACK
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-3">
            <Link
              href="/combat"
              className="accent-border rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text-gold"
            >
              Combat
            </Link>
            <Link
              href="/economy"
              className="accent-border rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text-gold"
            >
              Collect Resources
            </Link>
            <Link
              href="/travel?tab=expedition"
              className="accent-border rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text-gold"
            >
              Expedition
            </Link>
          </div>
        </div>
      </PageTransition>
    </LoadingSequence>
  );
}
