"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  createInitUserInstruction,
  createInitPlayerInstruction,
  createCreateProgressInstruction,
  createCreateEstateInstruction,
  createBuyPlotInstruction,
  createPurchaseItemInstruction,
  createBuildBuildingInstruction,
  createBuildingSpeedupInstruction,
  createCompleteBuildingInstruction,
  createHireUnitsInstruction,
  noviToDeci,
  parseTransactionError,
  GameError,
  BuildingType,
} from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { refetchAccounts } from "@/lib/store/refetch";
import type { CityChoice } from "@/components/arrival/Arrival";
import type { JumpStep, JumpPhase } from "@/components/arrival/JumpAhead";
import { type JumpRecipe, buildingName, jumpTierLamports } from "./recipes";
import { loadJump, saveJump, clearJump, type PersistedJump } from "./persist";

/**
 * Executor for the jump-ahead. The recipe becomes an ordered list of steps,
 * each one transaction, run strictly in dependency order (estate needs the
 * player, buildings need the estate). Every step is atomic, so a failed step
 * changes nothing on-chain.
 *
 * Build steps are *calibrated*: `build + N×speedup + complete` only completes
 * when N speedups collapse the construction timer to zero, and N differs per
 * building. We find the exact N by **simulating** candidate transactions
 * (free, no signature) and sending the one that succeeds — too few speedups
 * leaves time on the clock, one too many over-runs a speedup, so exactly one N
 * works.
 *
 * Progress is journalled to localStorage as each step confirms (see
 * persist.ts); `resume` replays only the steps the journal hasn't recorded.
 */

type PlannedStep =
  | {
      kind: "fixed";
      id: string;
      label: string;
      instructions: TransactionInstruction[];
      computeUnits: number;
    }
  | { kind: "build"; id: string; label: string; buildingType: BuildingType };

interface JumpContext {
  owner: PublicKey;
  gameEngine: PublicKey;
  treasury: PublicKey;
  city: CityChoice;
}

/** Speedup counts to probe for a build. A build longer than this fails honestly. */
const MAX_SPEEDUPS = 18;
const BUILD_CU = 900_000;
/** Speedup counts simulated per RPC burst — bounds concurrency and, with the
 *  ascending early-exit, lets a typical small-N build resolve in one burst. */
const PROBE_CHUNK = 6;
/** A fresh estate ships with 1 plot = 4 building slots; each extra plot adds 4.
 *  A recipe with more buildings than slots must buy plots first, or the build
 *  halts with BuildingSlotFull. */
const INITIAL_BUILDING_SLOTS = 4;
const SLOTS_PER_PLOT = 4;

/** `build + N×speedup + complete` for one building — the calibrated build tx. */
function buildSpeedupIxs(
  accounts: { owner: PublicKey; gameEngine: PublicKey },
  buildingType: BuildingType,
  speedups: number,
): TransactionInstruction[] {
  const ix: TransactionInstruction[] = [
    createBuildBuildingInstruction(accounts, { buildingType }),
  ];
  for (let i = 0; i < speedups; i++) {
    ix.push(
      createBuildingSpeedupInstruction(accounts, {
        buildingType,
        speedupTier: 2,
      }),
    );
  }
  ix.push(createCompleteBuildingInstruction(accounts, { buildingType }));
  return ix;
}

// `purchase_item` gates non-gem items on a built Market; gem packs (shop
// item_type 50) bypass that gate, so they can run in the estate step before
// any building exists. Everything else is deferred until after the Market is
// built — see the "stock" step below.
const GEM_PACK_ITEM_IDS = new Set<number>([7, 8]);

/** Recipe to ordered steps. Pure. */
function buildSteps(recipe: JumpRecipe, ctx: JumpContext): PlannedStep[] {
  const { owner, gameEngine, treasury, city } = ctx;
  const accounts = { owner, gameEngine };
  const steps: PlannedStep[] = [];

  const gemPurchases = recipe.purchases.filter((p) => GEM_PACK_ITEM_IDS.has(p.itemId));
  const marketGatedPurchases = recipe.purchases.filter(
    (p) => !GEM_PACK_ITEM_IDS.has(p.itemId),
  );

  // 1. Stake the claim — init_user + init_player + create_progress.
  steps.push({
    kind: "fixed",
    id: "stake",
    label: "Stake your claim",
    computeUnits: 600_000,
    instructions: [
      createInitUserInstruction({ owner, gameEngine }),
      createInitPlayerInstruction({
        owner,
        gameEngine,
        startingCityId: city.cityId,
        cityLatitude: city.latitude,
        cityLongitude: city.longitude,
      }),
      createCreateProgressInstruction({ owner, gameEngine }),
    ],
  });

  // 2. Raise the estate + the tier's gem-pack purchases — gems fund the build
  //    speedups and bypass the Market gate, so they're safe to buy now.
  steps.push({
    kind: "fixed",
    id: "estate",
    label: "Raise the estate",
    computeUnits: 400_000 + 80_000 * gemPurchases.length,
    instructions: [
      createCreateEstateInstruction(accounts, { cityId: city.cityId }),
      ...gemPurchases.map((p) =>
        createPurchaseItemInstruction(
          { buyer: owner, gameEngine, itemId: p.itemId, treasury },
          { quantity: p.quantity },
        ),
      ),
    ],
  });

  // 2b. Buy land plots when the recipe outgrows the estate's 4 starting slots
  //     — the Mansion plus every recipe building each needs a slot, or the
  //     build halts with BuildingSlotFull.
  const buildingCount = 1 + recipe.buildings.length; // Mansion is prepended
  const extraPlots = Math.max(
    0,
    Math.ceil((buildingCount - INITIAL_BUILDING_SLOTS) / SLOTS_PER_PLOT),
  );
  if (extraPlots > 0) {
    steps.push({
      kind: "fixed",
      id: "plots",
      label:
        extraPlots === 1
          ? "Expand the estate"
          : `Expand the estate (${extraPlots} plots)`,
      computeUnits: 200_000 * extraPlots,
      instructions: Array.from({ length: extraPlots }, () =>
        createBuyPlotInstruction(accounts),
      ),
    });
  }

  // 3. Buildings — Mansion is the prerequisite for every other building.
  for (const buildingType of [BuildingType.Mansion, ...recipe.buildings]) {
    steps.push({
      kind: "build",
      id: `build-${buildingType}`,
      label: `Build the ${buildingName(buildingType)}`,
      buildingType,
    });
  }

  // 4. Stock the reserve — NOVI packs (and any other Market-gated purchases)
  //    have to wait until the Market is built. Skipped when the recipe has
  //    only gem packs.
  if (marketGatedPurchases.length > 0) {
    steps.push({
      kind: "fixed",
      id: "stock",
      label: "Stock the reserve",
      computeUnits: 100_000 + 80_000 * marketGatedPurchases.length,
      instructions: marketGatedPurchases.map((p) =>
        createPurchaseItemInstruction(
          { buyer: owner, gameEngine, itemId: p.itemId, treasury },
          { quantity: p.quantity },
        ),
      ),
    });
  }

  // 5. Muster the garrison — hires run last (Barracks must stand first).
  // `h.novi` in the recipes is in display NOVI; the chain consumes raw
  // deci-NOVI (mint decimals=1), so convert exactly like every other hire
  // call site.
  if (recipe.hires.length > 0) {
    steps.push({
      kind: "fixed",
      id: "muster",
      label: "Muster the garrison",
      computeUnits: 350_000,
      instructions: recipe.hires.map((h) =>
        createHireUnitsInstruction(accounts, {
          unitType: h.unitType,
          noviAmount: noviToDeci(h.novi),
        }),
      ),
    });
  }

  return steps;
}

export interface JumpAheadState {
  steps: JumpStep[];
  phase: JumpPhase | "idle";
  elapsedMs: number;
  log: string[];
}

export function useJumpAhead() {
  const { publicKey, signTransaction } = useWallet();
  const client = useNovusMundusClient();
  const { data: geData } = useGameEngine();

  const [state, setState] = useState<JumpAheadState>({
    steps: [],
    phase: "idle",
    elapsedMs: 0,
    log: [],
  });
  // Wallet SOL balance (lamports) — polled while halted so an airdrop landing
  // reflects in the halt notice without needing a manual retry first.
  const [walletSol, setWalletSol] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Retained so `resume` can rebuild the exact same plan.
  const recipeRef = useRef<JumpRecipe | null>(null);
  const cityRef = useRef<CityChoice | null>(null);
  // One run at a time — a double-tap on the tier picker can call `start` twice
  // before `phase` flips to "running" (the journal read is awaited first),
  // which would drive two overlapping `runPlan` loops.
  const runningRef = useRef(false);

  // Stop the elapsed-time interval if the hook unmounts mid-run (e.g. the
  // player retreats out of the Arrival) so it can't setState on a dead hook.
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  const refetchBalance = useCallback(async () => {
    if (!publicKey) {
      setWalletSol(null);
      return;
    }
    try {
      setWalletSol(await client.connection.getBalance(publicKey));
    } catch {
      /* RPC hiccup — keep the last value rather than flicker null. */
    }
  }, [publicKey, client]);

  // Poll the balance only while halted. A successful run doesn't need it, and
  // 3s is responsive enough to catch a fresh airdrop without hammering the RPC.
  useEffect(() => {
    if (!publicKey || state.phase !== "failed") return;
    refetchBalance();
    const id = setInterval(refetchBalance, 3000);
    return () => clearInterval(id);
  }, [publicKey, state.phase, refetchBalance]);

  const appendLog = useCallback((line: string) => {
    setState((s) => ({ ...s, log: [...s.log, line] }));
  }, []);

  const setStepStatus = useCallback(
    (id: string, status: JumpStep["status"], detail?: string) => {
      setState((s) => ({
        ...s,
        steps: s.steps.map((st) =>
          st.id === id ? { ...st, status, detail: detail ?? st.detail } : st,
        ),
      }));
    },
    [],
  );

  /** Poll a signature to confirmation; throws on on-chain error. */
  const confirm = useCallback(
    async (signature: string) => {
      const conn = client.connection;
      for (let i = 0; i < 40; i++) {
        const { value } = await conn.getSignatureStatus(signature);
        if (value?.err) {
          throw new Error(parseTransactionError(value.err).message);
        }
        if (
          value?.confirmationStatus === "confirmed" ||
          value?.confirmationStatus === "finalized"
        ) {
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("Transaction confirmation timed out");
    },
    [client],
  );

  /**
   * Calibrate a build: simulate `build + n×speedup + complete` and return the
   * smallest n whose simulation succeeds. Probed in ascending bursts of
   * PROBE_CHUNK with an early exit — the answer is small for early-game
   * buildings, so this avoids both a wide RPC burst and most of the sims.
   * `replaceRecentBlockhash` lets the RPC swap a fresh blockhash in, so the
   * one we compile the candidates with never has to be current.
   */
  const probeBuildSpeedups = useCallback(
    async (
      buildingType: BuildingType,
      owner: PublicKey,
      gameEngine: PublicKey,
    ): Promise<number> => {
      const accounts = { owner, gameEngine };
      const { blockhash } = await client.connection.getLatestBlockhash();
      let lastErr: unknown = null;
      for (let base = 0; base <= MAX_SPEEDUPS; base += PROBE_CHUNK) {
        const counts: number[] = [];
        for (
          let n = base;
          n <= Math.min(base + PROBE_CHUNK - 1, MAX_SPEEDUPS);
          n++
        ) {
          counts.push(n);
        }
        const sims = await Promise.all(
          counts.map(async (n) => {
            const tx = await client.buildVersionedTransaction(
              buildSpeedupIxs(accounts, buildingType, n),
              owner,
              { computeUnits: BUILD_CU, recentBlockhash: blockhash },
            );
            const { value } = await client.connection.simulateTransaction(tx, {
              sigVerify: false,
              replaceRecentBlockhash: true,
              commitment: "confirmed",
            });
            return { n, err: value.err };
          }),
        );
        const hit = sims.find((s) => s.err === null);
        if (hit) return hit.n;
        lastErr = sims[sims.length - 1].err;
      }
      // No speedup count cleared the build. A stubborn construction timer
      // means it's genuinely beyond the jump's speedup ceiling; any other
      // on-chain error (no slot, short on NOVI/gems) is a real blocker that
      // more speedups would never fix — surface it humanized either way.
      const { code, message } = parseTransactionError(lastErr);
      const reason =
        code === GameError.ConstructionNotComplete
          ? `can't be rushed within ${MAX_SPEEDUPS} speedups`
          : message;
      throw new Error(`${buildingName(buildingType)}: ${reason}`);
    },
    [client],
  );

  /** Run the planned steps not yet recorded in `journal`, in order. */
  const runPlan = useCallback(
    async (planned: PlannedStep[], journal: PersistedJump) => {
      if (!publicKey || !signTransaction) return;

      const startedAt = Date.now();
      if (timerRef.current) clearInterval(timerRef.current);
      // 250ms keeps the footer readout live without re-rendering the whole
      // stepper at 10Hz — the difference is imperceptible at two decimals.
      timerRef.current = setInterval(() => {
        setState((s) => ({ ...s, elapsedMs: Date.now() - startedAt }));
      }, 250);
      const stopTimer = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };

      const toRun = planned.filter((p) => !journal.done.includes(p.id));
      let activeStepId: string | null = null;
      try {
        for (const step of toRun) {
          activeStepId = step.id;
          setStepStatus(step.id, "active");

          // Build the transaction — calibrated for build steps. The tx is
          // built here, right before signing, so its blockhash is current
          // when the wallet prompt finally returns.
          let tx: VersionedTransaction;
          if (step.kind === "fixed") {
            tx = await client.buildVersionedTransaction(
              step.instructions,
              publicKey,
              { computeUnits: step.computeUnits },
            );
          } else {
            appendLog(`${step.label} — calibrating speedups…`);
            const speedups = await probeBuildSpeedups(
              step.buildingType,
              publicKey,
              client.gameEngine,
            );
            setStepStatus(step.id, "active", `${speedups} speedups`);
            tx = await client.buildVersionedTransaction(
              buildSpeedupIxs(
                { owner: publicKey, gameEngine: client.gameEngine },
                step.buildingType,
                speedups,
              ),
              publicKey,
              { computeUnits: BUILD_CU },
            );
          }

          const signed = await signTransaction(tx);
          const sig = await client.connection.sendRawTransaction(
            signed.serialize(),
            { skipPreflight: false },
          );
          appendLog(`${step.label} — sent ${sig.slice(0, 8)}…`);
          await confirm(sig);

          // Journal the step the instant it confirms — a refresh now resumes
          // past it. Build steps are atomic, so a recorded one is fully done
          // and never needs the calibration repeated.
          journal.done.push(step.id);
          saveJump(journal);

          setStepStatus(step.id, "done", "done");
          appendLog(`${step.label} — confirmed.`);
        }

        // The jump is done on-chain — clear the journal so a stale entry can't
        // keep the Arrival re-opening this completed run.
        clearJump();

        // Best-effort: seed zustand with the new accounts so the realm renders
        // immediately rather than waiting on the WS. A failure here must not
        // fail an already-done jump — the WS subscription catches up anyway.
        // Estate is fetched after player so `refetchAccounts` can derive its PDA.
        try {
          await refetchAccounts(["player"], client, publicKey);
          await refetchAccounts(["estate"], client, publicKey);
        } catch {
          /* non-fatal */
        }

        stopTimer();
        setState((s) => ({ ...s, phase: "done" }));
      } catch (e) {
        stopTimer();
        const msg = parseTransactionError(e).message || "Jump failed.";
        setState((s) => ({
          ...s,
          phase: "failed",
          steps: s.steps.map((st) =>
            st.id === activeStepId ? { ...st, status: "failed" } : st,
          ),
          log: [...s.log, `Halted: ${msg}`],
        }));
      }
    },
    [
      publicKey,
      signTransaction,
      client,
      appendLog,
      setStepStatus,
      confirm,
      probeBuildSpeedups,
    ],
  );

  const start = useCallback(
    async (recipe: JumpRecipe, city: CityChoice) => {
      const treasury = geData?.account?.treasuryWallet;
      if (!publicKey || !treasury) {
        setState((s) => ({
          ...s,
          phase: "failed",
          log: [...s.log, "Wallet or kingdom not ready."],
        }));
        return;
      }
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        recipeRef.current = recipe;
        cityRef.current = city;

        const planned = buildSteps(recipe, {
          owner: publicKey,
          gameEngine: client.gameEngine,
          treasury,
          city,
        });

        // Resume the existing journal when it's for this very jump; otherwise
        // start a fresh one. Either way the journal is the single source of
        // truth for which steps are already done.
        const existing = loadJump();
        const journal: PersistedJump =
          existing &&
          existing.tier === recipe.tier &&
          existing.city.cityId === city.cityId
            ? existing
            : { tier: recipe.tier, city, done: [] };
        saveJump(journal);

        // Don't take it on faith that the wallet is funded — the gem pack in
        // the "estate" step is the run's real SOL cost, so while that step is
        // still pending, verify the balance covers the tier price up front.
        if (!journal.done.includes("estate")) {
          let balance: number | null = null;
          try {
            balance = await client.connection.getBalance(publicKey);
          } catch {
            /* RPC hiccup — skip the courtesy check; the run will surface a
               real failure on its own. */
          }
          if (balance !== null) setWalletSol(balance);
          const costLamports = jumpTierLamports(recipe);
          if (balance !== null && balance < costLamports) {
            setState((s) => ({
              ...s,
              phase: "failed",
              log: [
                ...s.log,
                `Not enough SOL — ${recipe.label} costs ${costLamports / LAMPORTS_PER_SOL} SOL.`,
              ],
            }));
            return;
          }
        }

        const skipCount = planned.filter((p) =>
          journal.done.includes(p.id),
        ).length;
        setState({
          steps: planned.map((p) => {
            const done = journal.done.includes(p.id);
            return {
              id: p.id,
              label: p.label,
              status: done ? "done" : "pending",
              detail: done ? "already done" : undefined,
            };
          }),
          phase: "running",
          elapsedMs: 0,
          log: [
            `Jump ahead — ${recipe.label}. ${planned.length} steps` +
              (skipCount ? `, ${skipCount} already done.` : "."),
          ],
        });
        await runPlan(planned, journal);
      } finally {
        runningRef.current = false;
      }
    },
    [publicKey, geData, client, runPlan],
  );

  /**
   * Resume — re-run `start`, which reads the localStorage journal, so any
   * confirmed step (this session or a previous one) is skipped.
   */
  const resume = useCallback(async () => {
    if (recipeRef.current && cityRef.current) {
      await start(recipeRef.current, cityRef.current);
    }
  }, [start]);

  return { ...state, walletSol, refetchBalance, start, resume };
}
