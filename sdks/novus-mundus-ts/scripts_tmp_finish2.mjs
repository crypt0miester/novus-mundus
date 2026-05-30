// Prove the deadlock + the route out. For ONE controlled participant:
//   1. process_return once -> chain STARTS their return (sets return_started_at,
//      return_duration) and returns ReturnNotComplete (7181). Read the timer.
//   2. Return-speedup tier 2 repeatedly until the timer collapses (needs gems;
//      these test players were funded with 10100 gems).
//   3. process_return again -> should now succeed, troops recovered, participant closed.
import { NovusMundusClient } from "./src/client";
import {
  createRallySpeedupInstruction,
  createRallyProcessReturnInstruction,
  RallySpeedupType,
  derivePlayerPda,
  deriveRallyParticipantPda,
} from "./src/index";
import { deserializePlayer } from "./src/state/player";
import { parseRallyParticipant } from "./src/state/rally";
import {
  Connection, Keypair, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const conn = new Connection("http://127.0.0.1:8899", "confirmed");
const c = new NovusMundusClient({ connection: conn, kingdomId: 0 });
const ge = c.gameEngine;
const num = (v) => (v == null ? null : Number(v.toString ? v.toString() : v));

const keysDir = "keys/players";
const byWallet = new Map();
for (const f of readdirSync(keysDir).filter((f) => /^player-\d+\.json$/.test(f))) {
  try { const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(keysDir, f), "utf8")))); byWallet.set(kp.publicKey.toBase58(), kp); } catch {}
}

const r = (await c.fetchActiveRallies())[0];
const rally = r.account;
const rallyId = rally.id.toNumber();
const parts = await c.fetchRallyParticipants(r.pubkey, rally);
const target = parts.find((p) => !p.account.isLeader && !p.account.returned && byWallet.has(p.account.participant.toBase58()) &&
  (!p.account.hero || p.account.hero.toBase58() === "11111111111111111111111111111111"));

const out = { owner: target?.account.participant.toBase58().slice(0,8) ?? null, steps: [] };
if (!target) { writeFileSync("/tmp/f2.json", JSON.stringify(out,null,2)); console.log("no target"); process.exit(0); }
const owner = target.account.participant;
const kp = byWallet.get(owner.toBase58());
const [partPda] = deriveRallyParticipantPda(ge, rally.creator, rallyId, owner);

const grab = async (e) => { try { return (await e.getLogs?.()) ?? null; } catch { return null; } };
const reReturn = async () => {
  const ix = createRallyProcessReturnInstruction({
    gameEngine: ge, rally: r.pubkey, rallyCreator: rally.creator, rallyId,
    participantOwner: owner, rallyCityId: rally.rallyCity, homeCityId: target.account.homeCity,
  });
  return sendAndConfirmTransaction(conn, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 90_000 }), ix), [kp], { commitment: "confirmed" });
};
const readPart = async () => {
  const info = await conn.getAccountInfo(partPda);
  if (!info) return null;
  const a = parseRallyParticipant({ ...info, data: info.data });
  if (!a) return null;
  return { returnStartedAt: num(a.returnStartedAt), returnDuration: num(a.returnDuration), returned: !!a.returned };
};

// step 1: kick off the return
try { await reReturn(); out.steps.push({ step: "return#1", ok: true }); }
catch (e) { out.steps.push({ step: "return#1", ok: false, code: (e.message||"").match(/0x[0-9a-f]+/)?.[0], note: "expected 7181 ReturnNotComplete (chain just started the return)" }); }

const slot = await conn.getSlot(); const now = await conn.getBlockTime(slot);
let p1 = await readPart();
out.afterStart = p1 ? { ...p1, remainingSec: p1.returnStartedAt + p1.returnDuration - now } : null;

// step 2: collapse return timer
let speedups = 0;
for (let i = 0; i < 24; i++) {
  try {
    const ix = createRallySpeedupInstruction(
      { owner, gameEngine: ge, rally: r.pubkey, rallyCreator: rally.creator, rallyId, participant: owner },
      { speedupType: RallySpeedupType.Return, speedupTier: 2 },
    );
    await sendAndConfirmTransaction(conn, new Transaction().add(ix), [kp], { commitment: "confirmed" });
    speedups++;
  } catch (e) { out.steps.push({ step: "speedup", stoppedAt: speedups, code: (e.message||"").match(/0x[0-9a-f]+/)?.[0] }); break; }
}
out.speedups = speedups;
const slot2 = await conn.getSlot(); const now2 = await conn.getBlockTime(slot2);
let p2 = await readPart();
out.afterSpeedup = p2 ? { ...p2, remainingSec: p2.returnStartedAt + p2.returnDuration - now2 } : null;

// step 3: final return
try { const sig = await reReturn(); out.steps.push({ step: "return#2", ok: true, sig: sig.slice(0,16) }); }
catch (e) { out.steps.push({ step: "return#2", ok: false, code: (e.message||"").match(/0x[0-9a-f]+/)?.[0], logs: (await grab(e))?.slice(-6) }); }

const after = await c.fetchRally(rally.creator, rallyId);
out.afterReturnedCount = after.account ? num(after.account.returnedCount) : "(closed)";
out.participantClosed = (await conn.getAccountInfo(partPda)) === null;
writeFileSync("/tmp/f2.json", JSON.stringify(out, null, 2));
console.log("done");
