// GET /heroes/<pubkey>/image
//
// Returns the 1024² procedural PNG portrait for a minted hero. The metadata
// JSON at /heroes/<pubkey> points here via its `image` field — that's the
// MPL Core / Metaplex convention (URI -> metadata JSON -> image field).
//
// Dev preview (skips chain fetch):
//   /heroes/<anything>/image?preview=1&template=10&level=20&locked=1
// `<anything>` is hashed into 32 bytes for fingerprint entropy when not a
// real base58 pubkey. Optional flags: &threatened=1.

import { PublicKey } from "@solana/web3.js";
import { fingerprintFromPubkey, type HeroState } from "@/lib/hero-image/fingerprint";
import { composeHeroImage } from "@/lib/hero-image/compose";
import { getTemplateMeta } from "@/lib/hero-image/template-map";
import { fetchHero } from "@/lib/chain/heroes";
import { serverConnection } from "@/lib/server/game-authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ pubkey: string }> },
): Promise<Response> {
  const { pubkey: pubkeyParam } = await ctx.params;
  const url = new URL(req.url);

  if (url.searchParams.get("preview") === "1") {
    return renderPreview(pubkeyParam, url);
  }

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(pubkeyParam);
  } catch {
    return new Response("invalid pubkey", { status: 400 });
  }

  const hero = await fetchHero(serverConnection(), pubkey);
  if (!hero) return new Response("hero not found", { status: 404 });

  const meta = getTemplateMeta(hero.state.templateId);
  const buffs = meta?.buffs ?? [];
  const meditationCity = meta?.meditationCity ?? 0;

  const params = fingerprintFromPubkey(pubkey.toBytes(), hero.state);
  const png = await composeHeroImage({
    templateId: hero.state.templateId,
    tier: hero.state.tier,
    level: hero.state.level,
    locked: hero.state.locked,
    buffs,
    meditationCity,
    params,
  });

  // Pubkey + asset.seq in the ETag so CDN dedup keyed on ETag can't serve
  // hero A's PNG for hero B's URL, and updates to the AssetV1 (level-up,
  // attribute edit) bust the cache automatically.
  const etag = `"h:${pubkey.toBase58()}:${hero.asset.seq}:${hero.state.templateId}:${hero.state.tier}:${hero.state.level}:${hero.state.locked ? 1 : 0}:v1"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      ETag: etag,
      "Cache-Control": "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

async function renderPreview(pubkeyParam: string, url: URL): Promise<Response> {
  const tplStr = url.searchParams.get("template");
  if (!tplStr) {
    return new Response("preview mode requires ?template=N", { status: 400 });
  }
  const templateId = parseInt(tplStr, 10);
  const meta = getTemplateMeta(templateId);
  if (!meta) {
    return new Response(`unknown templateId ${templateId}`, { status: 404 });
  }

  const lvlStr = url.searchParams.get("level") ?? "1";
  const level = Math.max(1, parseInt(lvlStr, 10) || 1);
  const locked = url.searchParams.get("locked") === "1";
  const threatened = url.searchParams.get("threatened") === "1";

  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = new PublicKey(pubkeyParam).toBytes();
  } catch {
    const enc = new TextEncoder().encode(pubkeyParam || "preview");
    pubkeyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      pubkeyBytes[i] = enc[i % enc.length] ?? 0;
    }
  }

  const state: HeroState = { templateId, tier: meta.tier, level, locked };
  const params = fingerprintFromPubkey(pubkeyBytes, state);
  const png = await composeHeroImage({
    templateId,
    tier: meta.tier,
    level,
    locked,
    threatened,
    buffs: meta.buffs,
    meditationCity: meta.meditationCity,
    params,
  });

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
