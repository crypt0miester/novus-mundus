"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useEncounters } from "@/lib/hooks/useEncounters";
import { useCityPlayers } from "@/lib/hooks/useCityPlayers";
import { useCombatPower } from "@/lib/hooks/useDerived";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { StatBar } from "@/components/shared/StatBar";
import { TabNav } from "@/components/shared/TabNav";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { shortenAddress, bpsToPercent } from "@/lib/utils";
import {
  isTraveling,
  getEncounterStaminaCost,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  calculateDamageOutput,
  calculateDefensivePower,
  getTotalDefensiveUnits,
  getTotalOperativeUnits,
  calculateDistanceMeters,
} from "novus-mundus-sdk";

type CombatTab = "encounter" | "pvp";

const RARITY_LABELS = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const RARITY_COLORS = [
  "text-zinc-400",
  "text-green-400",
  "text-blue-400",
  "text-fuchsia-400",
  "text-amber-400",
];
const RARITY_BORDERS = [
  "border-zinc-700",
  "border-green-800",
  "border-blue-800",
  "border-purple-800",
  "border-amber-800",
];

export function BattleTab() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("type") === "pvp" ? "pvp" : "encounter";

  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const { data: geData } = useGameEngine();
  const power = useCombatPower();
  const { data: encounterData } = useEncounters(player?.currentCity);
  const { data: cityPlayers, isLoading: playersLoading } = useCityPlayers(player?.currentCity);

  const [tab, setTab] = useState<CombatTab>(initialTab);

  // Encounter and PvP detail both live in the global RightPanel — opening one
  // is a store action; the lists highlight whichever target the panel shows.
  const showPanel = useRightPanelStore((s) => s.show);
  const rpContentKey = useRightPanelStore((s) => s.contentKey);
  const rpContentProps = useRightPanelStore((s) => s.contentProps);

  const encounters = encounterData || [];

  // Attack ranges. Encounter range mirrors the program's compile-time
  // ENCOUNTER_ATTACK_RANGE_METERS constant (attack_encounter.rs enforces that,
  // not the GameEngine CombatConfig field — which a live kingdom may still
  // hold at the old 10m). PvP still reads config.
  const encounterRange = 16;
  const pvpRange = geData?.account?.combatConfig?.pvpAttackRangeMeters ?? 15;

  // Batch-resolve domain names for city player wallets
  const cityPlayerOwners = useMemo(
    () => cityPlayers?.map((p) => p.account.owner) ?? [],
    [cityPlayers],
  );
  const domainNames = useDomainNames(cityPlayerOwners);

  const now = Math.floor(Date.now() / 1000);

  // Time-of-day attack multiplier
  const attackTimeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = (player.currentLong ?? 0) / 10000;
    const tod = getCurrentTimeOfDay(now, longitude);
    const mult = getActivityMultiplier('attacking' as any, tod);
    return { name: getTimeOfDayName(tod), mult };
  }, [player, now]);

  // Distance to each encounter
  const encounterDistances = useMemo(() => {
    if (!player) return [];
    return encounters.map((enc) => {
      const dist = calculateDistanceMeters(
        player.currentLat,
        player.currentLong,
        enc.account.locationLat,
        enc.account.locationLong,
      );
      return { distance: dist, inRange: dist <= encounterRange };
    });
  }, [player, encounters, encounterRange]);

  // Level band — the program rejects an attack when |encounter.level −
  // player.level| exceeds maxEncounterLevelDiff (attack_encounter.rs), and
  // travelling there first does not help. Surface it before either.
  const maxLevelDiff =
    geData?.account?.gameplayConfig?.maxEncounterLevelDiff ?? 30;
  const encounterLevels = useMemo(() => {
    const lvl = player?.level ?? 0;
    return encounters.map((enc) => {
      const encLevel = enc.account.level ?? 0;
      const diff = Math.abs(encLevel - lvl);
      return { level: encLevel, diff, inBand: diff <= maxLevelDiff };
    });
  }, [player, encounters, maxLevelDiff]);

  // Distance to each city player
  const playerDistances = useMemo(() => {
    if (!player || !cityPlayers) return new Map<string, { distance: number; inRange: boolean }>();
    const map = new Map<string, { distance: number; inRange: boolean }>();
    for (const p of cityPlayers) {
      const dist = calculateDistanceMeters(
        player.currentLat,
        player.currentLong,
        p.account.currentLat,
        p.account.currentLong,
      );
      map.set(p.pubkey.toBase58(), { distance: dist, inRange: dist <= pvpRange });
    }
    return map;
  }, [player, cityPlayers, pvpRange]);

  const playerStamina = player?.encounterStamina?.toNumber?.() ?? 0;

  // Estimated damage output
  const estimatedDamage = useMemo(() => {
    if (!player) return null;
    const defUnits = getTotalDefensiveUnits(player).toNumber();
    const offUnits = getTotalOperativeUnits(player).toNumber();
    const weapons = (player.meleeWeapons?.toNumber?.() ?? 0) + (player.rangedWeapons?.toNumber?.() ?? 0) + (player.siegeWeapons?.toNumber?.() ?? 0);
    try {
      return calculateDamageOutput(defUnits + offUnits, weapons, false);
    } catch {
      return null;
    }
  }, [player]);

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Your Forces — compact */}
      {player && (
        <div className="card accent-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-xl font-bold text-text-gold">
                  <GoldNumber value={power.total} />
                </div>
                <div className="text-[10px] text-text-muted">COMBAT POWER</div>
              </div>
              <div className="h-8 w-px bg-border-default" />
              <div>
                <div className="text-sm font-bold text-text-secondary"><GoldNumber value={power.defense} size="sm" /></div>
                <div className="text-[10px] text-text-muted">GARRISON</div>
              </div>
              {estimatedDamage != null && (
                <>
                  <div className="h-8 w-px bg-border-default" />
                  <div>
                    <div className="text-sm font-bold text-red-400">{estimatedDamage.toLocaleString()}</div>
                    <div className="text-[10px] text-text-muted">EST. DAMAGE</div>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span>Stamina: <span className="font-mono text-text-gold">{playerStamina}</span></span>
              {attackTimeInfo && (
                <span>
                  {attackTimeInfo.name}
                  {attackTimeInfo.mult > 1 && (
                    <span className="ml-1 text-green-400">+{((attackTimeInfo.mult - 1) * 100).toFixed(0)}%</span>
                  )}
                  {attackTimeInfo.mult < 1 && (
                    <span className="ml-1 text-red-400">{((attackTimeInfo.mult - 1) * 100).toFixed(0)}%</span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab Selector */}
      <TabNav
        tabs={[
          { key: "encounter", label: `Encounters (${encounters.length})` },
          { key: "pvp", label: `Players (${cityPlayers?.length ?? 0})` },
        ]}
        activeTab={tab}
        onTabChange={(key) => setTab(key as CombatTab)}
      />

      {/* ── ENCOUNTERS ── */}
      {tab === "encounter" && (
        <div className="space-y-2">
            {encounters.length === 0 ? (
              <div className="card">
                <p className="text-sm text-text-muted">No encounters in your city. Check back later or travel to another city.</p>
              </div>
            ) : (
              encounters.map((enc, i) => {
                const hp = enc.account.health.toNumber();
                const maxHp = enc.account.maxHealth.toNumber();
                const rarity = enc.account.rarity ?? 0;
                const dist = encounterDistances[i];
                const lvl = encounterLevels[i];
                const isSelected =
                  rpContentKey === "encounter-detail" &&
                  rpContentProps.encounterPubkey === enc.pubkey.toBase58();
                const staminaCost = getEncounterStaminaCost(rarity);

                return (
                  <button
                    key={enc.account.id.toString()}
                    onClick={() =>
                      showPanel(
                        `${RARITY_LABELS[rarity]} Encounter`,
                        "encounter-detail",
                        { encounterPubkey: enc.pubkey.toBase58() },
                      )
                    }
                    className={`w-full rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? `${RARITY_BORDERS[rarity]} bg-surface-raised ring-1 ring-amber-600/30`
                        : `border-zinc-800 hover:border-zinc-700`
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-sm font-bold ${RARITY_COLORS[rarity]}`}>
                          {RARITY_LABELS[rarity]?.[0]}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-text-primary">
                              {RARITY_LABELS[rarity]} Encounter
                            </span>
                            <span className="text-[10px] text-text-muted">#{enc.account.id.toString()}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-text-muted">
                            <span className={lvl && !lvl.inBand ? "font-semibold text-red-400" : ""}>
                              Lv {lvl?.level ?? enc.account.level}
                            </span>
                            <span>{hp.toLocaleString()} / {maxHp.toLocaleString()} HP</span>
                            <span>Cost: {staminaCost} stamina</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                        {lvl && !lvl.inBand && (
                          <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                            LEVEL GAP
                          </span>
                        )}
                        {dist && (
                          dist.inRange ? (
                            <span className="text-[10px] font-medium text-text-muted">
                              ✓ {dist.distance.toFixed(1)}m
                            </span>
                          ) : (
                            <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                              {dist.distance.toFixed(1)}m away
                            </span>
                          )
                        )}
                      </div>
                    </div>
                    <div className="mt-2">
                      <StatBar current={hp} max={maxHp} color="health" size="sm" showValues={false} />
                    </div>
                  </button>
                );
              })
            )}
        </div>
      )}

      {/* ── PVP ── */}
      {tab === "pvp" && (
        <div className="space-y-2">
            {playersLoading ? (
              <div className="card">
                <p className="text-sm text-text-muted">Scanning for nearby players...</p>
              </div>
            ) : (cityPlayers?.length ?? 0) === 0 ? (
              <div className="card">
                <p className="text-sm text-text-muted">
                  No other players in your city. Travel to a busier city to find targets.
                </p>
              </div>
            ) : (
              cityPlayers!.map((p) => {
                const def = calculateDefensivePower(
                  p.account.defensiveUnit1.toNumber(),
                  p.account.defensiveUnit2.toNumber(),
                  p.account.defensiveUnit3.toNumber(),
                );
                const totalOps = p.account.operativeUnit1.toNumber()
                  + p.account.operativeUnit2.toNumber()
                  + p.account.operativeUnit3.toNumber();
                const isProtected = p.account.newPlayerProtectionUntil.toNumber() > now;
                const isSelected =
                  rpContentKey === "pvp-detail" &&
                  rpContentProps.playerPubkey === p.pubkey.toBase58();
                const isTargetTraveling = isTraveling(p.account);
                const dist = playerDistances.get(p.pubkey.toBase58());

                return (
                  <button
                    key={p.pubkey.toBase58()}
                    onClick={() =>
                      !isProtected && !isTargetTraveling
                        ? showPanel(
                            p.account.name ||
                              domainNames.get(p.account.owner.toBase58()) ||
                              shortenAddress(p.account.owner.toBase58()),
                            "pvp-detail",
                            { playerPubkey: p.pubkey.toBase58() },
                          )
                        : undefined
                    }
                    disabled={isProtected || isTargetTraveling}
                    className={`w-full rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? "border-red-600 bg-red-900/20 ring-1 ring-red-600/30"
                        : isProtected || isTargetTraveling
                          ? "border-zinc-900 opacity-50"
                          : "border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div>
                          <Link
                            href={`/world/players/${p.account.owner.toBase58()}`}
                            className="text-sm font-semibold text-text-primary hover:text-text-gold transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.account.name || domainNames.get(p.account.owner.toBase58()) || shortenAddress(p.account.owner.toBase58())}
                          </Link>
                          <div className="flex items-center gap-2 text-[10px] text-text-muted">
                            <span>Lv {p.account.level}</span>
                            <span>&middot;</span>
                            <span>NW <GoldNumber value={p.account.networth.toNumber()} size="sm" /></span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right mr-2">
                          <div className="text-xs text-text-secondary">{def.toLocaleString()}</div>
                          <div className="text-[10px] text-text-muted">POWER</div>
                        </div>
                        {def === 0 && totalOps > 0 && (
                          <span className="rounded bg-red-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                            EXPOSED
                          </span>
                        )}
                        {isProtected && (
                          <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                            PROTECTED
                          </span>
                        )}
                        {isTargetTraveling && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                            TRAVELING
                          </span>
                        )}
                        {dist && !isProtected && !isTargetTraveling && (
                          dist.inRange ? (
                            <span className="text-[10px] font-medium text-text-muted">
                              ✓ in range
                            </span>
                          ) : (
                            <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                              {dist.distance.toFixed(1)}m
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
        </div>
      )}

      {/* Game Parameters */}
      {geData?.account && (() => {
        const ge = geData.account;
        const gp = ge.gameplayConfig;
        const cc = ge.combatConfig;
        return (
          <GameInfoPanel>
            <InfoGrid items={[
              { label: "Safebox Protection", value: bpsToPercent(gp.safeboxProtectionPercent), highlight: true },
              { label: "PvP Loot Base", value: bpsToPercent(gp.pvpLootPercentageBase) },
              { label: "Armor Reduction", value: bpsToPercent(gp.armorDamageReductionBps) },
              { label: "Armor Reduction Cap", value: bpsToPercent(gp.armorDamageReductionCapBps) },
              { label: "Weapon Loot Rate", value: bpsToPercent(cc.weaponLootRateBps) },
              { label: "Armory Raid (Ops)", value: bpsToPercent(cc.armoryRaidWithOperativesBps) },
              { label: "Armory Undefended", value: bpsToPercent(cc.armoryRaidUndefendedBps) },
              { label: "Siege Capture Rate", value: bpsToPercent(cc.siegeCaptureRateBps) },
              { label: "Dmg Dist T1", value: bpsToPercent(gp.damageUnit1Percent) },
              { label: "Dmg Dist T2", value: bpsToPercent(gp.damageUnit2Percent) },
              { label: "Dmg Dist T3", value: bpsToPercent(gp.damageUnit3Percent) },
              { label: "PvP Range", value: cc.pvpAttackRangeMeters.toLocaleString(), suffix: "m" },
              { label: "Siege Dmg/Weapon", value: cc.damagePerSiegeWeapon.toNumber().toLocaleString() },
              { label: "Encounter Range", value: cc.encounterAttackRangeMeters.toLocaleString(), suffix: "m" },
            ]} />
          </GameInfoPanel>
        );
      })()}
    </div>
  );
}
