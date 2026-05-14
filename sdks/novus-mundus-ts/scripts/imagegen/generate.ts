#!/usr/bin/env bun
/**
 * AI Image Generation Script for 3D Model Pipeline
 *
 * Generates reference images for every 3D model in the game using
 * Google GenAI Imagen API. Each model gets N images saved in its own folder.
 * These images are then fed into Tripo3D to produce .glb files.
 *
 * Usage:
 *   bun run scripts/imagegen/generate.ts [options]
 *
 *   --category <name>    Filter: buildings, heroes, npcs, animals, props, mountains, estate
 *   --model <id>         Single model by ID (e.g. "zeus", "mansion-t1")
 *   --count <n>          Images per model (default: 3)
 *   --dry-run            Show plan without calling API
 *   --prompt             Print prompt(s) to stdout for copy-paste (no API call)
 *   --status             Show progress and exit
 *   --check-quota        Test API key and quota, then exit
 *   --no-quota-check     Skip the pre-flight quota check
 *   --api-model <name>   API model (default: "gemini-3-pro-image-preview")
 *   --rpm <n>            Requests per minute limit (default: 5)
 */

import { GoogleGenAI } from '@google/genai';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { MODEL_DEFINITIONS, type ModelDefinition, type ModelCategory } from './prompts';

// CLI arg parsing

interface CliOptions {
  category?: ModelCategory;
  model?: string;
  count: number;
  dryRun: boolean;
  prompt: boolean;
  status: boolean;
  checkQuota: boolean;
  noQuotaCheck: boolean;
  apiModel: string;
  rpm: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    count: 3,
    dryRun: false,
    prompt: false,
    status: false,
    checkQuota: false,
    noQuotaCheck: false,
    apiModel: 'gemini-3-pro-image-preview',
    rpm: 5,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--category':
        opts.category = args[++i] as ModelCategory;
        break;
      case '--model':
        opts.model = args[++i];
        break;
      case '--count':
        opts.count = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--prompt':
        opts.prompt = true;
        break;
      case '--status':
        opts.status = true;
        break;
      case '--check-quota':
        opts.checkQuota = true;
        break;
      case '--no-quota-check':
        opts.noQuotaCheck = true;
        break;
      case '--api-model':
        opts.apiModel = args[++i];
        break;
      case '--rpm':
        opts.rpm = parseInt(args[++i], 10);
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  return opts;
}

// Paths

const SDK_ROOT = resolve(import.meta.dir, '../..');
const OUTPUT_ROOT = join(SDK_ROOT, 'assets', 'imagegen');

function modelOutputDir(def: ModelDefinition): string {
  return join(OUTPUT_ROOT, def.category, def.id);
}

// Resume: count existing PNGs

function countExistingImages(def: ModelDefinition): number {
  const dir = modelOutputDir(def);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith('.png')).length;
}

// Filter models

function filterModels(opts: CliOptions): ModelDefinition[] {
  let models = MODEL_DEFINITIONS;

  if (opts.category) {
    models = models.filter((m) => m.category === opts.category);
  }

  if (opts.model) {
    // Exact match first, fall back to prefix match
    const exact = models.filter((m) => m.id === opts.model);
    models = exact.length > 0 ? exact : models.filter((m) => m.id.startsWith(opts.model!));
  }

  return models;
}

// Status display

function showStatus(models: ModelDefinition[], targetCount: number) {
  const categories = ['buildings', 'heroes', 'npcs', 'animals', 'props', 'mountains', 'estate'] as const;

  let totalModels = 0;
  let totalDone = 0;
  let totalImages = 0;

  for (const cat of categories) {
    const catModels = models.filter((m) => m.category === cat);
    if (catModels.length === 0) continue;

    let catDone = 0;
    let catImages = 0;

    console.log(`\n  ${cat.toUpperCase()} (${catModels.length} models)`);
    console.log('  ' + '-'.repeat(50));

    for (const m of catModels) {
      const existing = countExistingImages(m);
      const done = existing >= targetCount;
      const status = done ? '  DONE' : `  ${existing}/${targetCount}`;
      console.log(`    ${m.id.padEnd(30)} ${status}`);

      if (done) catDone++;
      catImages += existing;
    }

    console.log(`  ${cat}: ${catDone}/${catModels.length} complete (${catImages} images)`);
    totalModels += catModels.length;
    totalDone += catDone;
    totalImages += catImages;
  }

  console.log(`\n  TOTAL: ${totalDone}/${totalModels} models complete (${totalImages} images)\n`);
}

// Dry run display

function showDryRun(queue: ModelDefinition[], targetCount: number, apiModel: string) {
  console.log(`\n  DRY RUN — would generate images with model: ${apiModel}`);
  console.log(`  Target: ${targetCount} images per model\n`);

  const categories = ['buildings', 'heroes', 'npcs', 'animals', 'props', 'mountains', 'estate'] as const;

  let totalCalls = 0;

  for (const cat of categories) {
    const catQueue = queue.filter((m) => m.category === cat);
    if (catQueue.length === 0) continue;

    console.log(`  ${cat.toUpperCase()} (${catQueue.length} models to generate)`);
    for (const m of catQueue) {
      const existing = countExistingImages(m);
      const needed = targetCount - existing;
      console.log(`    ${m.id.padEnd(30)} ${needed} image(s) needed`);
      totalCalls += needed;
    }
    console.log();
  }

  const delayPerCall = 13;
  const estMinutes = Math.ceil((totalCalls * delayPerCall) / 60);
  console.log(`  Total API calls: ${totalCalls}`);
  console.log(`  Estimated time: ~${estMinutes} minutes\n`);
}

// API: generate image

async function generateImage(
  ai: InstanceType<typeof GoogleGenAI>,
  apiModel: string,
  prompt: string,
): Promise<Buffer | null> {
  const response = await ai.models.generateContent({
    model: apiModel,
    contents: prompt,
    config: {
      responseModalities: ['image', 'text'],
    },
  });

  // Extract inline image data from response parts
  const candidates = (response as any).candidates ?? [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts ?? [];
    for (const part of parts) {
      if (part?.inlineData?.mimeType?.startsWith('image/')) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }
  }

  return null;
}

// Quota detection & details

/**
 * Parsed quota details from a 429 error response.
 * Google returns structured error details:
 *   error.details[] contains QuotaFailure, Help, and RetryInfo objects.
 */
interface QuotaDetails {
  status: string;         // e.g. "RESOURCE_EXHAUSTED"
  message: string;        // human-readable message
  quotaMetric?: string;   // e.g. "generativelanguage.googleapis.com/generate_content_free_tier_requests"
  quotaId?: string;       // e.g. "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
  quotaLimit?: string;    // e.g. "250"
  model?: string;         // e.g. "gemini-2.5-flash"
  location?: string;      // e.g. "global"
  retryDelay?: string;    // e.g. "1s"
  reason?: string;        // e.g. "RATE_LIMIT_EXCEEDED"
  helpLinks?: string[];   // URLs from Help details
}

/** Parse structured quota details from a Google API error. */
function parseQuotaDetails(err: any): QuotaDetails | null {
  const status = err?.status ?? err?.httpStatusCode ?? 0;
  if (status !== 429) return null;

  const details: QuotaDetails = {
    status: 'UNKNOWN',
    message: err?.message ?? String(err),
  };

  // Try to extract structured details from the error
  // The SDK may expose error details in different ways:
  //   err.errorDetails, err.details, or nested in the error message as JSON
  const errorDetails: any[] =
    err?.errorDetails ?? err?.details ?? err?.error?.details ?? [];

  // Also try parsing JSON from the error message itself
  if (errorDetails.length === 0) {
    try {
      const msgStr = err?.message ?? '';
      const jsonMatch = msgStr.match(/\{[\s\S]*"error"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed?.error?.details) {
          errorDetails.push(...parsed.error.details);
        }
        details.status = parsed?.error?.status ?? details.status;
      }
    } catch { /* ignore parse errors */ }
  }

  // Extract status from error directly
  if (err?.error?.status) details.status = err.error.status;
  const msgLower = details.message.toLowerCase();
  if (msgLower.includes('resource_exhausted')) details.status = 'RESOURCE_EXHAUSTED';

  for (const detail of errorDetails) {
    const type = detail?.['@type'] ?? detail?.type ?? '';

    // QuotaFailure — contains the specific quota metric, limit, and model
    if (type.includes('QuotaFailure') || detail?.violations) {
      const violations = detail?.violations ?? [];
      for (const v of violations) {
        details.quotaMetric = v?.quotaMetric ?? v?.subject ?? details.quotaMetric;
        details.quotaId = v?.quotaId ?? details.quotaId;
        details.quotaLimit = v?.quotaValue ?? details.quotaLimit;
        if (v?.quotaDimensions) {
          details.model = v.quotaDimensions.model ?? details.model;
          details.location = v.quotaDimensions.location ?? details.location;
        }
      }
    }

    // RetryInfo — when to retry
    if (type.includes('RetryInfo') || detail?.retryDelay != null) {
      details.retryDelay = detail.retryDelay ?? details.retryDelay;
    }

    // Help — documentation links
    if (type.includes('Help') || detail?.links) {
      details.helpLinks = (detail.links ?? [])
        .map((l: any) => l?.url)
        .filter(Boolean);
    }

    // ErrorInfo — reason code
    if (type.includes('ErrorInfo') || detail?.reason) {
      details.reason = detail.reason ?? details.reason;
    }
  }

  return details;
}

/** Format quota details for display. */
function formatQuotaDetails(d: QuotaDetails): string {
  const lines: string[] = [];
  lines.push(`  Status:       ${d.status}`);
  lines.push(`  Message:      ${d.message}`);
  if (d.quotaMetric)  lines.push(`  Quota Metric: ${d.quotaMetric}`);
  if (d.quotaId)      lines.push(`  Quota ID:     ${d.quotaId}`);
  if (d.quotaLimit)   lines.push(`  Quota Limit:  ${d.quotaLimit} requests`);
  if (d.model)        lines.push(`  Model:        ${d.model}`);
  if (d.location)     lines.push(`  Location:     ${d.location}`);
  if (d.reason)       lines.push(`  Reason:       ${d.reason}`);
  if (d.retryDelay)   lines.push(`  Retry After:  ${d.retryDelay}`);
  if (d.helpLinks?.length) {
    lines.push(`  Help:`);
    for (const link of d.helpLinks) lines.push(`    - ${link}`);
  }
  return lines.join('\n');
}

/** Signals that the free-tier quota is fully exhausted — no point retrying. */
class QuotaExhaustedError extends Error {
  details: QuotaDetails | null;
  constructor(message: string, details: QuotaDetails | null) {
    super(message);
    this.name = 'QuotaExhaustedError';
    this.details = details;
  }
}

function isQuotaExhausted(err: any): boolean {
  const msg = (err?.message ?? err?.toString?.() ?? '').toLowerCase();
  const status = err?.status ?? err?.httpStatusCode ?? 0;
  if (status !== 429) return false;
  return (
    msg.includes('resource_exhausted') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('quota') ||
    msg.includes('free_tier')
  );
}

/**
 * Pre-flight quota check — sends a tiny text-only request to verify the API
 * key works and quota is available.
 */
async function checkQuota(
  ai: InstanceType<typeof GoogleGenAI>,
  apiModel: string,
): Promise<{ ok: boolean; message: string; details?: QuotaDetails }> {
  try {
    const response = await ai.models.generateContent({
      model: apiModel,
      contents: 'Reply with the single word OK.',
      config: { responseModalities: ['text'] },
    });

    // Show token usage from the successful response
    const usage = (response as any)?.usageMetadata;
    let msg = 'API key valid, quota available.';
    if (usage) {
      msg += ` (prompt: ${usage.promptTokenCount ?? '?'} tokens, total: ${usage.totalTokenCount ?? '?'} tokens)`;
    }
    return { ok: true, message: msg };
  } catch (err: any) {
    const status = err?.status ?? err?.httpStatusCode ?? 0;
    const quotaDetails = parseQuotaDetails(err);

    if (status === 401 || status === 403) {
      return { ok: false, message: `Authentication failed (${status}): ${err?.message ?? err}` };
    }
    if (quotaDetails) {
      return { ok: false, message: `Quota issue detected.`, details: quotaDetails };
    }
    return { ok: false, message: `API error (${status}): ${err?.message ?? err}` };
  }
}

// Retry with backoff

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(
  ai: InstanceType<typeof GoogleGenAI>,
  apiModel: string,
  prompt: string,
  maxRetries = 3,
): Promise<Buffer | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await generateImage(ai, apiModel, prompt);
    } catch (err: any) {
      // Quota exhaustion — abort the entire run, no point retrying
      if (isQuotaExhausted(err)) {
        const details = parseQuotaDetails(err);
        throw new QuotaExhaustedError(
          `Free-tier quota exhausted. ${err?.message ?? err}`,
          details,
        );
      }

      const status = err?.status ?? err?.httpStatusCode ?? 0;
      const isRateLimit = status === 429;
      const isRetryable = isRateLimit || status >= 500;

      if (!isRetryable || attempt === maxRetries) {
        console.error(`    ERROR: ${err?.message ?? err}`);
        return null;
      }

      const backoffMs = isRateLimit ? 60_000 : Math.pow(2, attempt + 1) * 1000;
      console.log(`    Retry ${attempt + 1}/${maxRetries} in ${backoffMs / 1000}s (status ${status})...`);
      await sleep(backoffMs);
    }
  }

  return null;
}

// Main

async function main() {
  const opts = parseArgs();

  // Validate
  if (opts.category && !['buildings', 'heroes', 'npcs', 'animals', 'props', 'mountains', 'estate'].includes(opts.category)) {
    console.error(`Invalid category: ${opts.category}`);
    process.exit(1);
  }

  const allModels = filterModels(opts);

  if (allModels.length === 0) {
    console.error('No models matched the given filters.');
    process.exit(1);
  }

  // --status
  if (opts.status) {
    showStatus(allModels, opts.count);
    return;
  }

  // --prompt: print prompts for copy-paste into web UI
  if (opts.prompt) {
    for (const m of allModels) {
      console.log(`--- ${m.category}/${m.id} — ${m.name} ---`);
      console.log(m.prompt);
      console.log();
    }
    return;
  }

  // Build queue: skip models with enough images
  const queue = allModels.filter((m) => countExistingImages(m) < opts.count);

  if (queue.length === 0) {
    console.log('All matching models already have enough images. Nothing to do.');
    return;
  }

  // --dry-run
  if (opts.dryRun) {
    showDryRun(queue, opts.count, opts.apiModel);
    return;
  }

  // Require API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY environment variable is required.');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  // --check-quota: test API access and exit
  if (opts.checkQuota) {
    console.log(`\nChecking quota for model: ${opts.apiModel}...\n`);
    const result = await checkQuota(ai, opts.apiModel);
    if (result.ok) {
      console.log(`  OK: ${result.message}\n`);
    } else {
      console.error(`  FAILED: ${result.message}\n`);
      if (result.details) {
        console.error(formatQuotaDetails(result.details));
        console.error();
      }
      process.exit(1);
    }
    return;
  }

  // Pre-flight quota check (skip with --no-quota-check)
  if (!opts.noQuotaCheck) {
    process.stdout.write('Pre-flight quota check... ');
    const result = await checkQuota(ai, opts.apiModel);
    if (!result.ok) {
      console.log('FAILED\n');
      if (result.details) {
        console.error(formatQuotaDetails(result.details));
      } else {
        console.error(`  ${result.message}`);
      }
      console.error('\n  Use --no-quota-check to skip this check.\n');
      process.exit(1);
    }
    console.log('OK');
  }

  const delayMs = Math.ceil(60_000 / opts.rpm) + 1000; // e.g. 13s for 5 RPM

  console.log(`\nGenerating images with: ${opts.apiModel}`);
  console.log(`Target: ${opts.count} per model | RPM limit: ${opts.rpm} (${delayMs / 1000}s delay)`);
  console.log(`Queue: ${queue.length} models\n`);

  let totalGenerated = 0;
  let totalFailed = 0;

  for (let qi = 0; qi < queue.length; qi++) {
    const def = queue[qi];
    const dir = modelOutputDir(def);
    const existing = countExistingImages(def);
    const needed = opts.count - existing;

    console.log(`[${qi + 1}/${queue.length}] ${def.category}/${def.id} — ${def.name} (${needed} needed)`);

    mkdirSync(dir, { recursive: true });

    for (let i = 0; i < needed; i++) {
      const imgNum = existing + i + 1;
      const filename = `ref-${String(imgNum).padStart(2, '0')}.png`;
      const filepath = join(dir, filename);

      process.stdout.write(`  Generating ${filename}...`);

      const imageData = await generateWithRetry(ai, opts.apiModel, def.prompt);

      if (imageData) {
        writeFileSync(filepath, imageData);
        console.log(` saved (${(imageData.length / 1024).toFixed(1)} KB)`);
        totalGenerated++;
      } else {
        console.log(' FAILED');
        totalFailed++;
      }

      // Rate limit delay (skip after last image of last model)
      const isLast = qi === queue.length - 1 && i === needed - 1;
      if (!isLast) {
        await sleep(delayMs);
      }
    }
  }

  console.log(`\nDone! Generated: ${totalGenerated} | Failed: ${totalFailed}`);
}

main().catch((err) => {
  if (err instanceof QuotaExhaustedError) {
    console.error(`\n\n  QUOTA EXHAUSTED — Free-tier limit reached.\n`);
    if (err.details) {
      console.error(formatQuotaDetails(err.details));
    } else {
      console.error(`  ${err.message}`);
    }
    console.error(`\n  Wait for quota reset (resets daily at midnight PT) or upgrade your plan.\n`);
    process.exit(2);
  }
  console.error('Fatal error:', err);
  process.exit(1);
});
