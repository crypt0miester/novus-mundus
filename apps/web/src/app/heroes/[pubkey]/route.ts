// GET /heroes/<pubkey>
//
// Returns MPL Core / Metaplex-standard JSON metadata for a minted hero. The
// asset's on-chain `uri` field points here (see programs/novus_mundus/src/
// utils/hero_uri.rs). The `image` field of the JSON points at the sibling
// /heroes/<pubkey>/image route that returns the procedural PNG.
//
// Dev preview (skips chain fetch):
//   /heroes/<anything>?preview=1&template=10&level=20
// Useful before any hero is minted.

import { PublicKey } from "@solana/web3.js";
import { getTemplateMeta, BUFF_SLUG } from "@/lib/hero-image/template-map";
import { fetchHero } from "@/lib/chain/heroes";
import { serverConnection } from "@/lib/server/game-authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HERO_DESCRIPTION =
  "A hero in Novus Mundus. Procedural portrait composed from baked Bonsai layers; attributes are read directly from the on-chain MPL Core Asset.";

const TIER_NAME = ["Common", "Rare", "Epic", "Legendary", "Mythic"] as const;
const CATEGORY_NAME = ["Historical", "Mythological", "CryptoIcons", "Gaming", "Original"] as const;

interface HeroMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url: string;
  attributes: Array<{ trait_type: string; value: string | number }>;
  properties: {
    files: Array<{ uri: string; type: string }>;
    category: string;
  };
}

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
  if (!meta) return new Response("template not found", { status: 404 });

  const imageUrl = buildImageUrl(url, pubkeyParam, hero.state.level);

  const metadata: HeroMetadata = {
    name: hero.asset.name || `Hero #${hero.state.templateId}`,
    symbol: "HERO",
    description: HERO_DESCRIPTION,
    image: imageUrl,
    external_url: "https://novusmundus.gg",
    attributes: [
      { trait_type: "Template", value: hero.state.templateId },
      { trait_type: "Tier", value: TIER_NAME[hero.state.tier] },
      { trait_type: "Category", value: CATEGORY_NAME[meta.category] },
      { trait_type: "Level", value: hero.state.level },
      { trait_type: "Meditation City", value: meta.meditationCity },
      ...meta.buffs.map((id, i) => ({
        trait_type: `Buff ${i + 1}`,
        value: BUFF_SLUG[id] ?? `stat-${id}`,
      })),
    ],
    properties: {
      files: [{ uri: imageUrl, type: "image/png" }],
      category: "image",
    },
  };

  // Include the pubkey in the ETag so two heroes that happen to share
  // (templateId,tier,level,locked) don't collide on any CDN that performs
  // ETag-keyed dedup. asset.seq increments on chain whenever the AssetV1
  // is updated (level-ups, attribute edits) — folding it in busts caches
  // automatically when the underlying asset changes.
  const etag = `"m:${pubkey.toBase58()}:${hero.asset.seq}:${hero.state.templateId}:${hero.state.tier}:${hero.state.level}:${hero.state.locked ? 1 : 0}:v1"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return Response.json(metadata, {
    headers: {
      ETag: etag,
      "Cache-Control": "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

function buildImageUrl(reqUrl: URL, pubkey: string, level: number): string {
  return `${reqUrl.origin}/heroes/${pubkey}/image?v=${level}`;
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

  const level = Math.max(1, parseInt(url.searchParams.get("level") ?? "1", 10) || 1);
  // Preview image keeps preview params so the image route renders the same
  // synthetic hero (level, locked, etc.) the metadata describes.
  const previewQuery = url.searchParams.toString();
  const imageUrl = `${url.origin}/heroes/${pubkeyParam}/image?${previewQuery}`;

  const metadata: HeroMetadata = {
    name: meta.name,
    symbol: "HERO",
    description: HERO_DESCRIPTION,
    image: imageUrl,
    external_url: "https://novusmundus.gg",
    attributes: [
      { trait_type: "Template", value: templateId },
      { trait_type: "Tier", value: TIER_NAME[meta.tier] },
      { trait_type: "Category", value: CATEGORY_NAME[meta.category] },
      { trait_type: "Level", value: level },
      { trait_type: "Meditation City", value: meta.meditationCity },
      ...meta.buffs.map((id, i) => ({
        trait_type: `Buff ${i + 1}`,
        value: BUFF_SLUG[id] ?? `stat-${id}`,
      })),
    ],
    properties: {
      files: [{ uri: imageUrl, type: "image/png" }],
      category: "image",
    },
  };

  return Response.json(metadata, {
    headers: { "Cache-Control": "no-store" },
  });
}
