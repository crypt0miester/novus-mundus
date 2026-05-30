"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  type PublicKey,
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
  createPurchaseSubscriptionInstruction,
  createMintHeroInstruction,
  createStartResearchInstruction,
  createSpeedUpResearchInstruction,
  createCompleteResearchInstruction,
  getResearchName,
  parseTransactionError,
  GameError,
  BuildingType,
} from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { getTemplateMeta } from "@/lib/hero-image/template-map";
import { refetchAccounts } from "@/lib/store/refetch";
import type { CityChoice } from "@/components/arrival/Arrival";
import type { JumpStep, JumpPhase } from "@/components/arrival/JumpAhead";
import { type JumpRecipe, buildingName, jumpTierLamports, subscriptionTierName } from "./recipes";
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

/** One atomic transaction inside a batched step. Journalled on its own id so a
 *  partial run resumes past the chunks that already confirmed. */
interface BatchTx {
  id: string;
  instructions: TransactionInstruction[];
  computeUnits: number;
  /** Ephemeral co-signers (the hero-mint keypairs) that partial-sign before
   *  the wallet signs as fee payer. */
  signers?: Keypair[];
}

type PlannedStep =
  | {
      kind: "fixed";
      id: string;
      label: string;
      instructions: TransactionInstruction[];
      computeUnits: number;
      /** Extra signers (e.g. an ephemeral hero-mint keypair) that must
       *  partial-sign before the wallet signs as fee payer. */
      signers?: Keypair[];
      /** Marks a step that pays SOL (subscription, hero mint, gem/NOVI packs).
       *  The first such step in the plan is where the pre-flight balance check
       *  runs — derived from the plan rather than re-encoding step order. */
      spendsSol?: boolean;
    }
  | { kind: "build"; id: string; label: string; buildingType: BuildingType }
  | {
      // One displayed line that runs as several atomic transactions (hero
      // mints, chunked under the packet limit). See the recruit step below.
      kind: "batch";
      id: string;
      label: string;
      txs: BatchTx[];
      spendsSol?: boolean;
    };

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
/** Hero mints packed per transaction. Three keeps even the 5-hero veteran tier
 *  (two chunks) under the 1232-byte packet limit with margin; one tx of five
 *  overflows. */
const HEROES_PER_TX = 3;

/** `build + N×speedup + complete` for one building — the calibrated build tx. */
function buildSpeedupIxs(
  accounts: { owner: PublicKey; gameEngine: PublicKey },
  buildingType: BuildingType,
  speedups: number,
): TransactionInstruction[] {
  const ix: TransactionInstruction[] = [createBuildBuildingInstruction(accounts, { buildingType })];
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
  const marketGatedPurchases = recipe.purchases.filter((p) => !GEM_PACK_ITEM_IDS.has(p.itemId));

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
        cityLatitude: city.spawnLat,
        cityLongitude: city.spawnLong,
      }),
      createCreateProgressInstruction({ owner, gameEngine }),
    ],
  });

  // 2. Activate the subscription. Its bundle (units, weapons, NOVI, cash) is the
  //    army the jump used to hand-hire, and its XP grant lifts the player's
  //    level past each hero's rarity gate, so it must run before the heroes.
  //    Paid in SOL to the treasury; needs EXT_RESEARCH (set in the stake step).
  if (recipe.subscriptionTier !== null) {
    steps.push({
      kind: "fixed",
      id: "subscribe",
      label: `Activate ${subscriptionTierName(recipe.subscriptionTier)} patronage`,
      computeUnits: 120_000,
      spendsSol: true,
      instructions: [
        createPurchaseSubscriptionInstruction(
          { owner, gameEngine, paymentAuthority: owner, treasury },
          { paymentType: 0, tier: recipe.subscriptionTier },
        ),
      ],
    });
  }

  // 3. Recruit heroes. Shown as a single step (not one line per hero), minted
  //    in size-bounded chunks so even the largest tier stays under the
  //    1232-byte packet limit: five mints in one tx overflows, so HEROES_PER_TX
  //    chunks it (settled/established fit one tx, veteran takes two). Each chunk
  //    is one atomic tx with its mints' ephemeral keypairs as co-signers, and is
  //    journalled on its own id so a partial run resumes past confirmed chunks.
  //    SOL to the treasury; run after the subscription so its XP has cleared
  //    each hero's level gate.
  if (recipe.heroes.length > 0) {
    const txs: BatchTx[] = [];
    for (let i = 0; i < recipe.heroes.length; i += HEROES_PER_TX) {
      const chunk = recipe.heroes.slice(i, i + HEROES_PER_TX);
      const signers: Keypair[] = [];
      const instructions = chunk.map((h) => {
        const heroMint = Keypair.generate();
        signers.push(heroMint);
        return createMintHeroInstruction(
          { minter: owner, gameEngine, heroMint: heroMint.publicKey, treasury },
          { templateId: h.templateId },
        );
      });
      txs.push({
        id: `heroes-${i / HEROES_PER_TX}`,
        instructions,
        computeUnits: 90_000 * chunk.length,
        signers,
      });
    }
    const first = recipe.heroes[0];
    steps.push({
      kind: "batch",
      id: "heroes",
      label:
        recipe.heroes.length === 1
          ? `Recruit ${getTemplateMeta(first.templateId)?.name ?? `Hero ${first.templateId}`}`
          : `Recruit ${recipe.heroes.length} heroes`,
      spendsSol: true,
      txs,
    });
  }

  // 4. Raise the estate and the tier's gem-pack purchases. Gems fund the build
  //    and research speedups and bypass the Market gate, so they're safe now.
  steps.push({
    kind: "fixed",
    id: "estate",
    label: "Raise the estate",
    computeUnits: 400_000 + 80_000 * gemPurchases.length,
    spendsSol: gemPurchases.length > 0,
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

  // 4b. Buy land plots when the recipe outgrows the estate's 4 starting slots.
  //     The Mansion plus every recipe building each needs a slot, or the build
  //     halts with BuildingSlotFull.
  const buildingCount = 1 + recipe.buildings.length; // Mansion is prepended
  const extraPlots = Math.max(
    0,
    Math.ceil((buildingCount - INITIAL_BUILDING_SLOTS) / SLOTS_PER_PLOT),
  );
  if (extraPlots > 0) {
    steps.push({
      kind: "fixed",
      id: "plots",
      label: extraPlots === 1 ? "Expand the estate" : `Expand the estate (${extraPlots} plots)`,
      computeUnits: 200_000 * extraPlots,
      instructions: Array.from({ length: extraPlots }, () => createBuyPlotInstruction(accounts)),
    });
  }

  // 5. Buildings. The Mansion is the prerequisite for every other building.
  for (const buildingType of [BuildingType.Mansion, ...recipe.buildings]) {
    steps.push({
      kind: "build",
      id: `build-${buildingType}`,
      label: `Build the ${buildingName(buildingType)}`,
      buildingType,
    });
  }

  // 6. Stock the reserve. NOVI packs (and any other Market-gated purchase) have
  //    to wait until the Market is built. Skipped when the recipe has only gem
  //    packs.
  if (marketGatedPurchases.length > 0) {
    steps.push({
      kind: "fixed",
      id: "stock",
      label: "Stock the reserve",
      computeUnits: 100_000 + 80_000 * marketGatedPurchases.length,
      spendsSol: true,
      instructions: marketGatedPurchases.map((p) =>
        createPurchaseItemInstruction(
          { buyer: owner, gameEngine, itemId: p.itemId, treasury },
          { quantity: p.quantity },
        ),
      ),
    });
  }

  // 7. Research. One step per Battle node, driving the line to its target
  //    level. Each level is `start + speedup(0) + complete` in one atomic tx:
  //    speedup(0) collapses the whole research timer (the same gem-funded trick
  //    a build uses), and complete settles on the same clock. create_progress
  //    (the EXT_RESEARCH unlock) already ran in the stake step, and the Academy
  //    built above clears the Battle-category gate at Lv1.
  for (const r of recipe.research) {
    const instructions: TransactionInstruction[] = [];
    for (let level = 1; level <= r.targetLevel; level++) {
      instructions.push(
        createStartResearchInstruction({ owner, gameEngine, researchType: r.researchType }),
        createSpeedUpResearchInstruction(
          { owner, gameEngine, researchType: r.researchType },
          { speedUpSeconds: 0 },
        ),
        createCompleteResearchInstruction({
          payer: owner,
          playerOwner: owner,
          gameEngine,
          researchType: r.researchType,
        }),
      );
    }
    steps.push({
      kind: "fixed",
      id: `research-${r.researchType}`,
      label: `Research ${getResearchName(r.researchType)} to Lv${r.targetLevel}`,
      computeUnits: 60_000 + 50_000 * r.targetLevel,
      instructions,
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

  // The subscription's SOL cost is oracle-derived (cost_usd_cents × 1e9 /
  // usd_price_cents), so it's read live from the GameEngine rather than baked
  // into the recipe's fixed price. Returns 0 when the recipe has no
  // subscription or the oracle price isn't loaded yet.
  const subscriptionLamports = useCallback(
    (recipe: JumpRecipe): number => {
      if (recipe.subscriptionTier === null) return 0;
      const acct = geData?.account;
      const tierCfg = acct?.subscriptionTiers?.[recipe.subscriptionTier];
      const usdPriceCents = acct?.usdPriceCents?.toNumber?.() ?? 0;
      const costCents = tierCfg?.costInUsdCents?.toNumber?.() ?? 0;
      if (!usdPriceCents || !costCents) return 0;
      return Math.floor((costCents * LAMPORTS_PER_SOL) / usdPriceCents);
    },
    [geData],
  );

  // Full pre-flight / display price: the fixed packs + hero mints, plus the
  // live subscription lamports.
  const tierPriceLamports = useCallback(
    (recipe: JumpRecipe): number => jumpTierLamports(recipe) + subscriptionLamports(recipe),
    [subscriptionLamports],
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

  const setStepStatus = useCallback((id: string, status: JumpStep["status"], detail?: string) => {
    setState((s) => ({
      ...s,
      steps: s.steps.map((st) =>
        st.id === id ? { ...st, status, detail: detail ?? st.detail } : st,
      ),
    }));
  }, []);

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
        for (let n = base; n <= Math.min(base + PROBE_CHUNK - 1, MAX_SPEEDUPS); n++) {
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

          // Batched step (hero mints): one displayed line, one wallet prompt per
          // size-bounded chunk. Each chunk is journalled the instant it confirms,
          // so a partial run resumes past the chunks already done and never
          // re-mints them. Detail tracks "k/n" chunks across the run.
          if (step.kind === "batch") {
            const total = step.txs.length;
            let completed = step.txs.filter((t) => journal.done.includes(t.id)).length;
            if (completed === total) {
              setStepStatus(step.id, "done", "done");
              continue;
            }
            setStepStatus(step.id, "active", `${completed}/${total}`);
            for (const unit of step.txs) {
              if (journal.done.includes(unit.id)) continue;
              const utx = await client.buildVersionedTransaction(unit.instructions, publicKey, {
                computeUnits: unit.computeUnits,
              });
              if (unit.signers?.length) utx.sign(unit.signers);
              const usigned = await signTransaction(utx);
              const usig = await client.connection.sendRawTransaction(usigned.serialize(), {
                skipPreflight: false,
              });
              appendLog(`${step.label} — sent ${usig.slice(0, 8)}…`);
              await confirm(usig);
              journal.done.push(unit.id);
              saveJump(journal);
              completed += 1;
              const allDone = completed === total;
              setStepStatus(
                step.id,
                allDone ? "done" : "active",
                allDone ? "done" : `${completed}/${total}`,
              );
            }
            appendLog(`${step.label} — confirmed.`);
            continue;
          }

          setStepStatus(step.id, "active");

          // Build the transaction — calibrated for build steps. The tx is
          // built here, right before signing, so its blockhash is current
          // when the wallet prompt finally returns.
          let tx: VersionedTransaction;
          if (step.kind === "fixed") {
            tx = await client.buildVersionedTransaction(step.instructions, publicKey, {
              computeUnits: step.computeUnits,
            });
            // Hero-mint steps carry ephemeral keypairs that must co-sign the new
            // NFT asset; they partial-sign before the wallet signs as fee payer.
            if (step.signers?.length) tx.sign(step.signers);
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
          const sig = await client.connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
          });
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
          steps: s.steps.map((st) => (st.id === activeStepId ? { ...st, status: "failed" } : st)),
          log: [...s.log, `Halted: ${msg}`],
        }));
      }
    },
    [publicKey, signTransaction, client, appendLog, setStepStatus, confirm, probeBuildSpeedups],
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
          existing && existing.tier === recipe.tier && existing.city.cityId === city.cityId
            ? existing
            : { tier: recipe.tier, city, done: [] };
        saveJump(journal);

        // Don't take it on faith that the wallet is funded. While the first
        // SOL-spending step (the subscription, then heroes, then the estate gem
        // packs) is still pending, verify the balance covers the full tier price
        // (fixed packs/heroes + the live subscription). The step is read off the
        // plan via its `spendsSol` flag, so the gate can't drift from step order.
        const firstSolStep = planned.find(
          (p) => (p.kind === "fixed" || p.kind === "batch") && p.spendsSol,
        );
        if (firstSolStep && !journal.done.includes(firstSolStep.id)) {
          let balance: number | null = null;
          try {
            balance = await client.connection.getBalance(publicKey);
          } catch {
            /* RPC hiccup — skip the courtesy check; the run will surface a
               real failure on its own. */
          }
          if (balance !== null) setWalletSol(balance);
          const costLamports = tierPriceLamports(recipe);
          if (balance !== null && balance < costLamports) {
            setState((s) => ({
              ...s,
              phase: "failed",
              log: [
                ...s.log,
                `Not enough SOL. ${recipe.label} costs about ${(costLamports / LAMPORTS_PER_SOL).toFixed(2)} SOL.`,
              ],
            }));
            return;
          }
        }

        const skipCount = planned.filter((p) => journal.done.includes(p.id)).length;
        setState({
          steps: planned.map((p) => {
            // A batch's id is never journalled (its chunks are), so read its
            // initial status from how many chunks are already done.
            if (p.kind === "batch") {
              const total = p.txs.length;
              const doneCount = p.txs.filter((t) => journal.done.includes(t.id)).length;
              const allDone = doneCount === total;
              return {
                id: p.id,
                label: p.label,
                status: (allDone ? "done" : "pending") as JumpStep["status"],
                detail: allDone
                  ? "already done"
                  : doneCount > 0
                    ? `${doneCount}/${total}`
                    : undefined,
              };
            }
            const done = journal.done.includes(p.id);
            return {
              id: p.id,
              label: p.label,
              status: (done ? "done" : "pending") as JumpStep["status"],
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
    [publicKey, geData, client, runPlan, tierPriceLamports],
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

  // Pre-check shortfall: rewrite the stale "Not enough SOL" line once an
  // airdrop lands. The balance poll above already keeps `walletSol` fresh; this
  // closes the loop on the body text so the halt notice doesn't lie. Only
  // fires for the pre-check bail (no planned steps yet) — a mid-run failure
  // with a populated `steps` array keeps its original log.
  const displayLog = useMemo(() => {
    if (
      state.phase !== "failed" ||
      state.steps.length > 0 ||
      walletSol === null ||
      !recipeRef.current
    ) {
      return state.log;
    }
    const cost = tierPriceLamports(recipeRef.current);
    if (walletSol < cost) return state.log;
    return state.log.map((line) =>
      line.startsWith("Not enough SOL")
        ? `Balance now ${(walletSol / LAMPORTS_PER_SOL).toFixed(2)} SOL. Resume when ready.`
        : line,
    );
  }, [state.log, state.phase, state.steps.length, walletSol, tierPriceLamports]);

  return { ...state, log: displayLog, walletSol, refetchBalance, tierPriceLamports, start, resume };
}
