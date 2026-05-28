// Template metadata lookup — tier + category + buff-stat ids per templateId.
//
// TEMPLATE_META / getTemplateMeta / TemplateMeta live in template-map.generated.ts
// and are codegenned from sdks/novus-mundus-ts/cli/data/heroes.ts so they cannot
// drift from the on-chain roster. To regenerate after a roster edit:
//   bun run apps/web/scripts/gen-template-map.ts
// (Also runs automatically before `bun run build` via the prebuild hook.)
//
// BUFF_SLUG stays here — it maps a chain BuffStat enum to an icon asset path,
// not roster data, so codegen would buy nothing.

export {
  TEMPLATE_META,
  getTemplateMeta,
  type TemplateMeta,
} from "./template-map.generated";

// BuffStat enum id -> file slug for apps/web/public/img/icons/game/buff-<slug>.webp.
// Matches the order in programs/novus_mundus/src/state/hero.rs BuffStat.
export const BUFF_SLUG: Readonly<Record<number, string>> = {
  1: "attack-power",
  2: "defense-power",
  3: "cash-collection-rate",
  4: "xp-gain",
  5: "training-cost-reduction",
  6: "rally-capacity",
  7: "critical-hit-chance",
  8: "synchrony-bonus",
  9: "resource-capacity",
  10: "weapon-efficiency",
  11: "stamina-regen",
  12: "produce-generation",
  13: "unit-capacity",
  14: "encounter-damage",
  15: "loot-bonus",
  16: "armor-efficiency",
  17: "mining-affinity",
  18: "fishing-affinity",
};
