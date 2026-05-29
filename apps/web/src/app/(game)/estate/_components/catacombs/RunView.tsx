"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  createFleeInstruction,
  createClaimDungeonInstruction,
  DungeonStatus,
  ENCOUNTER_STAMINA_COSTS,
  type DungeonRunAccount,
  type DungeonTemplateAccount,
} from "novus-mundus-sdk";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useCoSign } from "@/lib/cosign";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { ROOM_INFO, THEMES, relicById, relicsFromMask, synergyStates } from "@/lib/dungeon-lore";
import { DungeonSplash } from "@/components/dungeons/DungeonSplash";
import { DEFENSIVE_UNIT_LABELS } from "@/components/shared/TripleCountInput";

const SPEC_NAMES = ["Warrior", "Guardian", "Scout", "Tactician"];
/** HP per defensive unit tier — mirrors DungeonRun::apply_unit_damage. */
const TIER_HP = [100, 250, 600];

interface RunViewProps {
  run: DungeonRunAccount;
  template: DungeonTemplateAccount | null;
  playerStamina: number;
  playerMaxStamina: number;
}

/** BN | number to number, defensively. */
function n(v: { toNumber?: () => number } | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return v.toNumber?.() ?? 0;
}

function fmt(x: number): string {
  return x.toLocaleString();
}

// ── Run log ──────────────────────────────────────────────────────────
// Each action invalidates the run query; we diff the new run against the
// previous snapshot to narrate what just happened.

function describeChange(prev: DungeonRunAccount, next: DungeonRunAccount): string | null {
  if (next.status === DungeonStatus.Completed && prev.status !== next.status)
    return "The dungeon is cleared — claim your spoils.";
  if (next.status === DungeonStatus.Failed && prev.status !== next.status)
    return "Your party was overwhelmed. Resume from the last checkpoint?";
  if (next.status === DungeonStatus.Fled && prev.status !== next.status)
    return "You escaped the dungeon.";

  const facts: string[] = [];
  const dealt = n(next.totalDamageDealt) - n(prev.totalDamageDealt);
  const taken = n(next.totalDamageTaken) - n(prev.totalDamageTaken);
  const prevUnits = prev.remainingUnits.reduce((a, b) => a + n(b), 0);
  const nextUnits = next.remainingUnits.reduce((a, b) => a + n(b), 0);
  const unitDelta = nextUnits - prevUnits;
  const xp = n(next.pendingXp) - n(prev.pendingXp);
  const novi = n(next.pendingNovi) - n(prev.pendingNovi);
  const kills = next.enemiesKilled - prev.enemiesKilled;
  const relics = next.relicsCollected - prev.relicsCollected;

  if (dealt > 0) facts.push(`dealt ${fmt(dealt)}`);
  if (taken > 0) facts.push(`took ${fmt(taken)}`);
  if (kills > 0) facts.push(`felled ${kills} foe${kills > 1 ? "s" : ""}`);
  if (unitDelta < 0) facts.push(`lost ${fmt(-unitDelta)} units`);
  if (unitDelta > 0) facts.push(`recovered ${fmt(unitDelta)} units`);
  if (relics > 0) facts.push("claimed a relic");
  if (xp > 0) facts.push(`+${fmt(xp)} XP`);
  if (novi > 0) facts.push(`+$${fmt(novi)}`);
  if (next.currentFloor > prev.currentFloor) facts.push(`descended to floor ${next.currentFloor}`);
  if (next.darknessLevel > prev.darknessLevel) facts.push("the dark deepens");

  if (facts.length === 0) return null;
  return `Floor ${prev.currentFloor} — ${facts.join(", ")}.`;
}

// ── Sub-views ────────────────────────────────────────────────────────

function DepthLadder({
  run,
  totalFloors,
  roomsPerFloor,
  checkpointInterval,
}: {
  run: DungeonRunAccount;
  totalFloors: number;
  roomsPerFloor: number;
  checkpointInterval: number;
}) {
  const floors = Array.from({ length: totalFloors }, (_, i) => i + 1);
  const rooms = Array.from({ length: roomsPerFloor }, (_, i) => i + 1);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {floors.map((f) => {
          const here = f === run.currentFloor;
          const done = f < run.currentFloor;
          const isBoss = f === totalFloors;
          const isCheckpoint = checkpointInterval > 0 && f % checkpointInterval === 0 && !isBoss;
          return (
            <div
              key={f}
              title={
                isBoss
                  ? `Floor ${f} — Boss`
                  : isCheckpoint
                    ? `Floor ${f} — Checkpoint`
                    : `Floor ${f}`
              }
              className={`flex h-6 min-w-6 items-center justify-center rounded px-1 text-[10px] font-semibold ${
                here
                  ? "bg-gold-500 text-black"
                  : done
                    ? "bg-accent/40 text-text-gold"
                    : "border border-zinc-800 text-text-muted"
              }`}
            >
              {isBoss ? "☠" : isCheckpoint ? `${f}◈` : f}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">Room</span>
        {rooms.map((r) => (
          <span
            key={r}
            className={`h-2 w-2 rounded-full ${
              r < run.currentRoom
                ? "bg-accent"
                : r === run.currentRoom
                  ? "bg-gold-400"
                  : "bg-zinc-700"
            }`}
          />
        ))}
        <span className="ml-1 text-[10px] text-text-muted">
          {run.currentRoom}/{roomsPerFloor}
        </span>
      </div>
    </div>
  );
}

function EnemyCard({ run }: { run: DungeonRunAccount }) {
  const hp = n(run.enemyHealth);
  const maxHp = Math.max(1, n(run.enemyMaxHealth));
  const pct = Math.round((hp / maxHp) * 100);
  const shield = n(run.bossShield);
  return (
    <div
      className={`rounded-lg border p-3 ${
        run.isBoss ? "border-red-700/60 bg-red-950/20" : "border-zinc-800 bg-surface/60"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-sm font-semibold ${run.isBoss ? "text-red-400" : "text-text-primary"}`}
        >
          {run.isBoss ? "☠ Floor Boss" : `Floor ${run.currentFloor} Enemy`}
        </span>
        <span className="text-xs text-text-muted">
          Power {fmt(run.enemyPower)} · Def {(run.enemyDefense / 100).toFixed(0)}%
        </span>
      </div>
      <div className="mt-2">
        <div className="mb-1 flex justify-between text-[10px] text-text-muted">
          <span>Health</span>
          <span>
            {fmt(hp)} / {fmt(maxHp)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-red-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {run.isBoss && (
        <div className="mt-2 space-y-1">
          <div className="flex justify-between text-[10px] text-text-muted">
            <span>Wrath {run.bossWrath}/100</span>
            <span>
              {run.bossAbilityActive
                ? "ability active!"
                : run.bossWrath >= 50
                  ? "ability imminent"
                  : "ability at 50"}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-fuchsia-500"
              style={{ width: `${Math.min(100, run.bossWrath)}%` }}
            />
          </div>
          {shield > 0 && <div className="text-[10px] text-sky-400">Shield: {fmt(shield)}</div>}
        </div>
      )}
    </div>
  );
}

function PartyTiers({ run }: { run: DungeonRunAccount }) {
  // Only the tiers the player actually committed — a tier with no original
  // units is not part of this party and would just render an empty bar.
  const tiers = [0, 1, 2]
    .map((t) => ({
      t,
      remaining: n(run.remainingUnits[t]),
      original: n(run.originalUnits[t]),
    }))
    .filter((x) => x.original > 0);
  const totalHp = tiers.reduce((a, x) => a + x.remaining * TIER_HP[x.t], 0);
  const maxHp = tiers.reduce((a, x) => a + x.original * TIER_HP[x.t], 0);
  return (
    <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Your Party
        </span>
        <span className="text-xs text-text-muted">
          {fmt(totalHp)} / {fmt(maxHp)} HP
        </span>
      </div>
      <div className="space-y-1.5">
        {tiers.map(({ t, remaining, original }) => {
          const pct = original > 0 ? (remaining / original) * 100 : 0;
          const lost = original - remaining;
          return (
            <div key={t}>
              <div className="mb-0.5 flex justify-between text-[10px] text-text-muted">
                <span>{DEFENSIVE_UNIT_LABELS[t]}</span>
                <span className={lost > 0 ? "text-red-400" : ""}>
                  {fmt(remaining)} / {fmt(original)}
                  {lost > 0 ? ` (−${fmt(lost)})` : ""}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RelicShelf({ run }: { run: DungeonRunAccount }) {
  const relics = relicsFromMask(run.relicMask);
  const synergies = synergyStates(relics).filter((s) => s.tier > 0);
  return (
    <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        Relics ({relics.length})
      </div>
      {relics.length === 0 ? (
        <p className="text-[11px] text-text-muted">
          No relics yet — you choose one between floors. Match a relic&apos;s colour to stack a
          synergy bonus.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {relics.map((r) => (
            <span
              key={r.id}
              title={r.effect}
              className="rounded border border-border-gold/50 bg-accent/30 px-1.5 py-0.5 text-[10px] text-text-secondary"
            >
              🔮 {r.name}
            </span>
          ))}
        </div>
      )}
      {synergies.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {synergies.map((s) => (
            <span
              key={s.id}
              title={`${s.count} ${s.name} relics`}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                s.tier === 3 ? "bg-fuchsia-900/40 text-fuchsia-300" : "bg-sky-900/40 text-sky-300"
              }`}
            >
              {s.name} {s.tier}pc · {s.bonus}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RunLog({ log }: { log: string[] }) {
  const [open, setOpen] = useState(false);
  if (log.length === 0) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-surface/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-3 text-xs font-semibold uppercase tracking-wider text-text-muted"
      >
        <span>Run Log ({log.length})</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-1 px-3 pb-3">
          {log.map((line, i) => (
            <p
              key={i}
              className={`text-[11px] ${i === 0 ? "text-text-secondary" : "text-text-muted"}`}
            >
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────

export function RunView({ run, template, playerStamina, playerMaxStamina }: RunViewProps) {
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { requestCoSign, requestGetJson } = useCoSign();
  const ownerStr = publicKey?.toBase58() ?? null;

  const totalFloors = template?.totalFloors ?? 10;
  const roomsPerFloor = template?.roomsPerFloor ?? 3;
  const checkpointInterval = template?.checkpointInterval ?? 3;
  const theme = THEMES[run.dungeonTheme] ?? THEMES[0];
  const roomInfo = ROOM_INFO[run.roomType] ?? ROOM_INFO[0];
  // A boss fight is a combat room whatever room_type says — the program keys
  // boss combat off status/isBoss, not the room_type byte.
  const isBossFight = run.isBoss || run.status === DungeonStatus.BossFight;
  const isCombat = roomInfo.combat || isBossFight;
  const displayRoom = isBossFight
    ? {
        icon: "☠",
        name: "Boss Fight",
        blurb: "The floor's master stands before you — end it.",
      }
    : roomInfo;

  const roomStaminaCost = ENCOUNTER_STAMINA_COSTS[0] ?? 10;
  const maxAttacks = Math.min(5, Math.floor(playerStamina / roomStaminaCost));
  const [attackCount, setAttackCount] = useState(1);
  const effectiveAttacks = Math.min(attackCount, Math.max(1, maxAttacks));

  // Run log — diff the run snapshot on every refetch.
  const prevRef = useRef<DungeonRunAccount | null>(null);
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = run;
    if (!prev) return;
    const line = describeChange(prev, run);
    if (line) setLog((l) => [line, ...l].slice(0, 10));
  }, [run]);

  // Relic offer — only while awaiting a choice.
  const awaitingRelic = run.status === DungeonStatus.AwaitingRelic;
  const { data: relicOffer } = useQuery({
    queryKey: ["dungeonRelicOffer", ownerStr, run.currentFloor],
    queryFn: () =>
      requestGetJson<{ relicOptions: number[]; firstRoomType: number }>(
        "/api/cosign/dungeon/choose-relic",
      ),
    enabled: !!ownerStr && awaitingRelic,
    staleTime: 10_000,
  });

  // ── Actions ──
  const handleAdvance = async (rp: (p: TxPhase) => void) => {
    if (!ownerStr) throw new Error("Wallet not connected");
    if (!isCombat) {
      const vtx = await requestCoSign("/api/cosign/dungeon/interact");
      return transact
        .mutateAsync({
          versionedTx: vtx,
          invalidateKeys: [["dungeonRun"], ["player"]],
          successMessage: "Room resolved.",
          onPhase: rp,
        })
        .then((r) => r.signature);
    }
    const count = effectiveAttacks;
    const vtx =
      count > 1
        ? await requestCoSign("/api/cosign/dungeon/attack-multi", {
            attackCount: count,
          })
        : await requestCoSign("/api/cosign/dungeon/attack");
    return transact
      .mutateAsync({
        versionedTx: vtx,
        invalidateKeys: [["dungeonRun"], ["player"]],
        successMessage: count > 1 ? `Struck ×${count}` : "Struck!",
        onPhase: rp,
      })
      .then((r) => r.signature);
  };

  const handleChooseRelic = async (relicId: number, rp: (p: TxPhase) => void) => {
    const vtx = await requestCoSign("/api/cosign/dungeon/choose-relic", {
      relicId,
    });
    return transact
      .mutateAsync({
        versionedTx: vtx,
        invalidateKeys: [["dungeonRun"], ["player"]],
        successMessage: "Relic claimed — descending.",
        onPhase: rp,
      })
      .then((r) => r.signature);
  };

  const handleFlee = async (rp: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = createFleeInstruction({
      gameEngine: client.gameEngine,
      owner: publicKey,
      heroMint: run.heroMint,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["dungeonRun"], ["player"]],
        successMessage: "Escaped the dungeon.",
        onPhase: rp,
      })
      .then((r) => r.signature);
  };

  const handleClaim = async (rp: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = createClaimDungeonInstruction({
      gameEngine: client.gameEngine,
      owner: publicKey,
      heroMint: run.heroMint,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["dungeonRun"], ["player"]],
        successMessage: "Rewards claimed.",
        onPhase: rp,
      })
      .then((r) => r.signature);
  };

  // Ended runs — the recap + claim live in the DungeonClaimPanel (RightPanel);
  // dungeon-tab opens it and renders the entry screen here instead.
  if (
    run.status === DungeonStatus.Completed ||
    run.status === DungeonStatus.Failed ||
    run.status === DungeonStatus.Fled
  ) {
    return null;
  }

  const floorsToBoss = Math.max(0, totalFloors - run.currentFloor);

  return (
    <div className="space-y-3">
      <DungeonSplash
        dungeonId={run.dungeonId}
        boss={isBossFight}
        title={isBossFight ? "Floor Boss" : template?.name}
        subtitle={isBossFight ? "The master stands before you" : theme.name}
      />
      {/* Slim header — theme, depth, stamina on one line */}
      <div className="card accent-border flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-base font-semibold text-text-primary">{theme.name}</h3>
          <span className="text-xs text-text-muted">
            Floor {run.currentFloor}
            {run.currentFloor <= totalFloors ? `/${totalFloors}` : " · Endless"} ·{" "}
            {SPEC_NAMES[run.heroSpecialization] ?? "Champion"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          {run.darknessLevel > 0 && (
            <span className="text-indigo-400">Darkness Lv {run.darknessLevel}</span>
          )}
          <span>
            {run.isBoss || run.status === DungeonStatus.BossFight
              ? "Boss floor"
              : floorsToBoss > 0
                ? `${floorsToBoss} to the boss`
                : "Boss ahead"}
          </span>
          <span>
            Stamina{" "}
            <span className={playerStamina > 0 ? "text-green-400" : "text-red-400"}>
              {playerStamina}
            </span>
            /{playerMaxStamina}
          </span>
        </div>
      </div>

      {/* Two-column board — the status rail, and the active turn */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* Left — persistent run state */}
        <div className="space-y-3 lg:col-span-1">
          <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
            <DepthLadder
              run={run}
              totalFloors={totalFloors}
              roomsPerFloor={roomsPerFloor}
              checkpointInterval={checkpointInterval}
            />
          </div>
          <PartyTiers run={run} />
          <RelicShelf run={run} />
          <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Carried Loot
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>
                <span className="text-text-muted">NOVI </span>
                <span className="font-semibold text-text-gold">${fmt(n(run.pendingNovi))}</span>
              </span>
              <span>
                <span className="text-text-muted">XP </span>
                <span className="font-semibold text-text-primary">{fmt(n(run.pendingXp))}</span>
              </span>
              <span>
                <span className="text-text-muted">Fragments </span>
                <span className="font-semibold text-text-primary">{fmt(n(run.pendingGems))}</span>
              </span>
            </div>
            <p className="mt-1 text-[10px] text-text-muted">
              Loot to your last checkpoint is safe; fleeing forfeits a share of the rest.
            </p>
          </div>
          <RunLog log={log} />
        </div>

        {/* Right — the room, and the action it demands */}
        <div className="space-y-3 lg:col-span-2">
          {/* Room + enemy — fixed min height so the actions below never jump
              as combat rooms (with an enemy) swap with quieter ones. */}
          <div className="card min-h-[240px]">
            <div className="flex items-center gap-2">
              <span className="text-xl">{displayRoom.icon}</span>
              <div>
                <div className="text-sm font-semibold text-text-primary">{displayRoom.name}</div>
                <div className="text-[11px] text-text-muted">{displayRoom.blurb}</div>
              </div>
            </div>
            {isCombat && (
              <div className="mt-3">
                <EnemyCard run={run} />
              </div>
            )}
          </div>

          {/* Actions — sticky, and sat below a fixed-height room, so the
              buttons hold their place through every re-render. */}
          {awaitingRelic ? (
            <div className="card accent-border sticky bottom-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Choose a Relic
              </h3>
              <p className="mb-3 text-[11px] text-text-muted">
                A floor cleared. Pick one relic to carry on — stacking a synergy colour unlocks
                bigger bonuses.
              </p>
              {!relicOffer ? (
                <p className="text-sm text-text-muted">Reading the offering…</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  {relicOffer.relicOptions.map((relicId) => {
                    const info = relicById(relicId);
                    return (
                      <TxButton
                        key={relicId}
                        onClick={(rp) => handleChooseRelic(relicId, rp)}
                        variant="secondary"
                        className="py-2"
                      >
                        <span className="flex flex-col items-center gap-0.5">
                          <span className="text-sm">🔮 {info?.name ?? `Relic #${relicId}`}</span>
                          <span className="text-[10px] font-normal text-text-muted">
                            {info?.effect ?? ""}
                          </span>
                        </span>
                      </TxButton>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="card sticky bottom-3 space-y-2">
              {/* Fixed-height strikes slot — reserved so toggling it never
                  shoves the buttons. */}
              <div className="flex h-7 items-center justify-center gap-1">
                {isCombat && maxAttacks > 1 && (
                  <>
                    <span className="text-[11px] text-text-muted">Strikes:</span>
                    {Array.from({ length: maxAttacks }, (_, i) => i + 1).map((nn) => (
                      <button
                        key={nn}
                        onClick={() => setAttackCount(nn)}
                        className={`h-6 w-6 rounded text-xs transition-colors ${
                          effectiveAttacks === nn
                            ? "bg-primary text-white"
                            : "border border-zinc-700 text-text-muted hover:border-zinc-500"
                        }`}
                      >
                        {nn}
                      </button>
                    ))}
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <TxButton
                  onClick={handleAdvance}
                  className="px-8"
                  disabled={isCombat && playerStamina < effectiveAttacks * roomStaminaCost}
                >
                  {isCombat
                    ? effectiveAttacks > 1
                      ? `${displayRoom.icon} Strike ×${effectiveAttacks}`
                      : `${displayRoom.icon} Strike`
                    : `${displayRoom.icon} Resolve Room`}
                </TxButton>
                <TxButton onClick={handleFlee} variant="secondary">
                  Flee
                </TxButton>
              </div>
              {isCombat && playerStamina < effectiveAttacks * roomStaminaCost && (
                <p className="text-center text-[11px] text-red-400">
                  Not enough stamina ({playerStamina}/{effectiveAttacks * roomStaminaCost})
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
