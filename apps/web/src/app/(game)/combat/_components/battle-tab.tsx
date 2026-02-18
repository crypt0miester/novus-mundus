"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useEncounters } from "@/lib/hooks/useEncounters";
import { useCityPlayers } from "@/lib/hooks/useCityPlayers";
import { useCombatPower } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { TabNav } from "@/components/shared/TabNav";
import { UnitGrid } from "@/components/shared/UnitGrid";
import { shortenAddress, bpsToPercent } from "@/lib/utils";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import {
  derivePlayerPda,
  deriveLootPda,
  deriveLocationPda,
  toGrid,
  createAttackEncounterInstruction,
  createAttackPlayerInstruction,
  createPurchaseStaminaInstruction,
  isTraveling,
  getEncounterStaminaCost,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  calculateDamageOutput,
  calculateDefensivePower,
  getTotalDefensiveUnits,
  getTotalOperativeUnits,
} from "@/lib/sdk";

type CombatTab = "encounter" | "pvp";

export function BattleTab() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("type") === "pvp" ? "pvp" : "encounter";

  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const { data: geData } = useGameEngine();
  const power = useCombatPower();
  const { data: encounterData } = useEncounters(player?.currentCity);
  const { data: cityPlayers, isLoading: playersLoading } = useCityPlayers(player?.currentCity);
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const [tab, setTab] = useState<CombatTab>(initialTab);
  const [selectedEncounter, setSelectedEncounter] = useState<number | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<PublicKey | null>(null);
  const [driveBy, setDriveBy] = useState(false);

  const encounters = encounterData || [];

  // Batch-resolve domain names for city player wallets
  const cityPlayerOwners = useMemo(
    () => cityPlayers?.map((p) => p.account.owner) ?? [],
    [cityPlayers],
  );
  const domainNames = useDomainNames(cityPlayerOwners);

  const playerTraveling = player ? isTraveling(player) : false;

  const now = Math.floor(Date.now() / 1000);

  // Time-of-day attack multiplier
  const attackTimeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = (player.currentLong ?? 0) / 10000;
    const tod = getCurrentTimeOfDay(now, longitude);
    const mult = getActivityMultiplier('attacking' as any, tod);
    return { name: getTimeOfDayName(tod), mult };
  }, [player, now]);

  // Stamina info for selected encounter
  const encounterStaminaCost = useMemo(() => {
    if (selectedEncounter == null || !encounters[selectedEncounter]) return null;
    const rarity = encounters[selectedEncounter].account.rarity ?? 0;
    return getEncounterStaminaCost(rarity);
  }, [selectedEncounter, encounters]);

  const playerStamina = player?.encounterStamina?.toNumber?.() ?? 0;
  const hasStamina = encounterStaminaCost != null ? playerStamina >= encounterStaminaCost : true;

  // Estimated damage output (simplified)
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

  // Selected player data for display
  const selectedPlayerData = useMemo(() => {
    if (!selectedPlayer || !cityPlayers) return null;
    return cityPlayers.find((p) => p.pubkey.equals(selectedPlayer)) ?? null;
  }, [selectedPlayer, cityPlayers]);

  const handleAttackEncounter = async (reportPhase: (p: TxPhase) => void) => {
    if (selectedEncounter == null || !publicKey || !player) throw new Error("No target selected");
    const ge = client.gameEngine;
    const encounter = encounters[selectedEncounter];
    const enc = encounter.account;

    // Derive death accounts so kills work (loot creation + location cleanup)
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [loot] = deriveLootPda(playerPda, player.lootCounter.toNumber());
    const [encounterLocation] = deriveLocationPda(
      ge, enc.cityId, toGrid(enc.locationLat), toGrid(enc.locationLong)
    );
    // Location rent refund goes to game engine authority (crank)
    const locationCreatorRefund = geData?.account?.authority ?? publicKey;

    const ix = createAttackEncounterInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        encounter: encounter.pubkey,
        loot,
        encounterLocation,
        locationCreatorRefund,
      },
      { encounterId: enc.id }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["encounters"], ["loot"]],
      successMessage: "Attack landed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleAttackPlayer = async (reportPhase: (p: TxPhase) => void) => {
    if (!selectedPlayer || !publicKey || !player) throw new Error("No target");
    const ge = client.gameEngine;
    const defenderData = cityPlayers?.find((p) => p.pubkey.equals(selectedPlayer));
    if (!defenderData) throw new Error("Target not found");

    const ix = createAttackPlayerInstruction(
      {
        attacker: publicKey,
        gameEngine: ge,
        defenderPlayer: selectedPlayer,
        attackerCityId: player.currentCity,
        defenderCityId: defenderData.account.currentCity,
      },
      { driveBy }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["cityPlayers"]],
      successMessage: "PvP attack executed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleStaminaAndAttack = async (reportPhase: (p: TxPhase) => void) => {
    if (selectedEncounter == null || !publicKey || !player) throw new Error("No target selected");
    const ge = client.gameEngine;
    const encounter = encounters[selectedEncounter];
    const enc = encounter.account;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [loot] = deriveLootPda(playerPda, player.lootCounter.toNumber());
    const [encounterLocation] = deriveLocationPda(
      ge, enc.cityId, toGrid(enc.locationLat), toGrid(enc.locationLong)
    );
    const locationCreatorRefund = geData?.account?.authority ?? publicKey;
    const staminaIx = createPurchaseStaminaInstruction(
      { player: playerPda, gameEngine: ge, owner: publicKey },
      { amount: 1 }
    );
    const attackIx = createAttackEncounterInstruction(
      {
        owner: publicKey, gameEngine: ge, encounter: encounter.pubkey,
        loot, encounterLocation, locationCreatorRefund,
      },
      { encounterId: enc.id }
    );
    return transact.mutateAsync({
      instructions: [staminaIx, attackIx],
      invalidateKeys: [["player"], ["encounters"], ["loot"]],
      successMessage: "Bought stamina & attacked!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      {/* Traveling Warning */}
      {playerTraveling && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-300">
          You are currently traveling. Complete or cancel travel before attacking.
        </div>
      )}

      {/* Your Forces */}
      {player && (
        <div className="card accent-border">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Your Forces
          </h3>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-text-gold">
                <GoldNumber value={power.total} />
              </div>
              <div className="text-xs text-text-muted">Total Combat Power</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-text-muted">Garrison Power</div>
              <GoldNumber value={power.defense} size="sm" />
            </div>
          </div>
          {power.defense === 0 && player && (player.operativeUnit1.toNumber() + player.operativeUnit2.toNumber() + player.operativeUnit3.toNumber()) > 0 && (
            <div className="mb-3 rounded border border-red-800/50 bg-red-900/20 px-3 py-2 text-xs text-red-300">
              Your garrison is empty — operatives are exposed to attack damage
            </div>
          )}
          <UnitGrid
            defense={[
              player.defensiveUnit1.toNumber(),
              player.defensiveUnit2.toNumber(),
              player.defensiveUnit3.toNumber(),
            ]}
            offense={[
              player.operativeUnit1.toNumber(),
              player.operativeUnit2.toNumber(),
              player.operativeUnit3.toNumber(),
            ]}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            {attackTimeInfo && (
              <div className="text-text-muted">
                {attackTimeInfo.name}
                {attackTimeInfo.mult > 1 && (
                  <span className="ml-1 text-green-400">+{((attackTimeInfo.mult - 1) * 100).toFixed(0)}% attack bonus</span>
                )}
                {attackTimeInfo.mult < 1 && (
                  <span className="ml-1 text-red-400">{((attackTimeInfo.mult - 1) * 100).toFixed(0)}% attack penalty</span>
                )}
              </div>
            )}
            {estimatedDamage != null && (
              <div className="text-text-muted">
                Est. Damage: <span className="text-text-gold">{estimatedDamage.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Selector */}
      <TabNav
        tabs={[
          { key: "encounter", label: "Encounters (PvE)" },
          { key: "pvp", label: "Players (PvP)" },
        ]}
        activeTab={tab}
        onTabChange={(key) => {
          setTab(key as CombatTab);
          if (key === "encounter") setSelectedPlayer(null);
          else setSelectedEncounter(null);
        }}
        size="compact"
      />

      {/* Encounter Targets */}
      {tab === "encounter" && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-text-primary">Encounters in City</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {encounters.length === 0 ? (
              <div className="card col-span-2">
                <p className="text-sm text-text-muted">No encounters available in your city.</p>
              </div>
            ) : (
              encounters.map((enc, i) => {
                const hp = enc.account.health.toNumber();
                const maxHp = enc.account.maxHealth.toNumber();
                const selected = selectedEncounter === i;
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedEncounter(i)}
                    className={`card text-left transition-all ${
                      selected ? "accent-border-bright" : "hover:"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-text-primary">
                        Encounter #{enc.account.id.toString()}
                      </span>
                      <span className="text-xs text-text-muted">
                        {hp}/{maxHp} HP
                      </span>
                    </div>
                    <StatBar current={hp} max={maxHp} color="gold" size="sm" showValues={false} />
                  </button>
                );
              })
            )}
          </div>

          {selectedEncounter != null && (
            <div className="mt-4">
              {encounterStaminaCost != null && (
                <div className="mb-2 text-center text-xs text-text-muted">
                  Stamina cost: <span className={hasStamina ? "text-text-secondary" : "text-red-400"}>{encounterStaminaCost}</span>
                  {" / "}Current: <span className={hasStamina ? "text-green-400" : "text-red-400"}>{playerStamina}</span>
                  {!hasStamina && <span className="ml-2 text-red-400">Insufficient stamina</span>}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-center gap-3">
                <TxButton onClick={handleAttackEncounter} className="px-8 py-3 text-lg" disabled={playerTraveling || !hasStamina}>
                  ATTACK ENCOUNTER
                </TxButton>
                <TxButton
                  onClick={handleStaminaAndAttack}
                  variant="secondary"
                  className="text-xs"
                  disabled={playerTraveling}
                >
                  +Stamina &amp; Attack
                </TxButton>
              </div>
            </div>
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

      {/* PvP Targets */}
      {tab === "pvp" && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-text-primary">Players in City</h2>
          <p className="mb-3 text-xs text-text-muted">
            You can attack players in the same city within range. Players must not be under new player protection.
          </p>

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
            <div className="space-y-2">
              {cityPlayers!.map((p) => {
                const def = calculateDefensivePower(
                  p.account.defensiveUnit1.toNumber(),
                  p.account.defensiveUnit2.toNumber(),
                  p.account.defensiveUnit3.toNumber(),
                );
                const totalOps = p.account.operativeUnit1.toNumber()
                  + p.account.operativeUnit2.toNumber()
                  + p.account.operativeUnit3.toNumber();
                const isProtected = p.account.newPlayerProtectionUntil.toNumber() > Math.floor(Date.now() / 1000);
                const isSelected = selectedPlayer?.equals(p.pubkey);
                const isTargetTraveling = isTraveling(p.account);

                return (
                  <button
                    key={p.pubkey.toBase58()}
                    onClick={() => !isProtected && !isTargetTraveling ? setSelectedPlayer(p.pubkey) : undefined}
                    disabled={isProtected || isTargetTraveling}
                    className={`w-full rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? "border-red-600 bg-red-900/20"
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
                          <div className="text-xs text-text-muted">
                            Lv {p.account.level} &middot; NW <GoldNumber value={p.account.networth.toNumber()} size="sm" />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <div className="text-[10px] text-text-muted">POWER</div>
                          <div className="text-xs text-text-secondary">{def.toLocaleString()}</div>
                        </div>
                        {totalOps > 0 && (
                          <div>
                            <div className="text-[10px] text-text-muted">OPS</div>
                            <div className={`text-xs ${def === 0 ? "text-red-400" : "text-text-secondary"}`}>{totalOps.toLocaleString()}</div>
                          </div>
                        )}
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
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Attack Controls */}
          {selectedPlayer && selectedPlayerData && (
            <div className="mt-4 space-y-3">
              <div className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-text-muted">Target</div>
                    <div className="text-sm font-semibold text-text-primary">
                      {selectedPlayerData.account.name || domainNames.get(selectedPlayerData.account.owner.toBase58()) || shortenAddress(selectedPlayerData.account.owner.toBase58())}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-text-muted">Cash on Hand</div>
                    <GoldNumber value={selectedPlayerData.account.cashOnHand.toNumber()} prefix="$" size="sm" />
                  </div>
                </div>

                {/* Operative exposure hint */}
                {(() => {
                  const tDef = calculateDefensivePower(
                    selectedPlayerData.account.defensiveUnit1.toNumber(),
                    selectedPlayerData.account.defensiveUnit2.toNumber(),
                    selectedPlayerData.account.defensiveUnit3.toNumber(),
                  );
                  const tOps = selectedPlayerData.account.operativeUnit1.toNumber()
                    + selectedPlayerData.account.operativeUnit2.toNumber()
                    + selectedPlayerData.account.operativeUnit3.toNumber();
                  if (tOps > 0 && (tDef === 0 || (estimatedDamage != null && estimatedDamage > tDef * 2)))
                    return (
                      <div className="mt-3 rounded border border-red-800/30 bg-red-900/10 px-3 py-2 text-xs text-red-300">
                        {tDef === 0
                          ? `Garrison is empty — ${tOps.toLocaleString()} operatives will take full damage`
                          : `If garrison is wiped, ${tOps.toLocaleString()} operatives will also take damage`}
                      </div>
                    );
                  return null;
                })()}

                {/* Drive-by Toggle */}
                <div className="mt-3 flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      checked={driveBy}
                      onChange={(e) => setDriveBy(e.target.checked)}
                      className="rounded border-zinc-700"
                    />
                    Drive-by Attack
                  </label>
                  <span className="text-xs text-text-muted">
                    (10k+ units required, 25% damage penalty)
                  </span>
                </div>
              </div>

              <div className="flex justify-center">
                <TxButton onClick={handleAttackPlayer} variant="danger" className="px-8 py-3 text-lg" disabled={playerTraveling}>
                  ATTACK PLAYER
                </TxButton>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
