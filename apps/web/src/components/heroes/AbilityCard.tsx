"use client";

import { PublicKey } from "@solana/web3.js";
import {
  type HeroTemplateAccount,
  getAbilityKindMeta,
  getAbilityDescription,
  hasAbility,
  formatDurationCompact,
  AbilityKind,
} from "novus-mundus-sdk";
import { TxButton } from "@/components/shared/TxButton";
import {
  useHeroAbilityCooldown,
  useUseAbility,
  usePendingEffect,
} from "@/lib/hooks/useHeroAbility";

interface AbilityCardProps {
  template: HeroTemplateAccount;
  /** When omitted: read-only card (template browser). When present: interactive (locked-hero detail). */
  interactive?: {
    heroMint: PublicKey;
    slotIndex: number;
  };
}

/**
 * Renders a hero's signature ability. Two modes:
 *  - Read-only (template detail): shows kind, description, cooldown duration.
 *  - Interactive (locked-hero detail): adds Use Ability button + live cooldown.
 *
 * Hidden entirely when the template has no ability configured (kind 0).
 */
export function AbilityCard({ template, interactive }: AbilityCardProps) {
  if (!hasAbility(template)) return null;

  const meta = getAbilityKindMeta(template.abilityKind);
  const description = getAbilityDescription(template);

  return (
    <div className="rounded-md border border-zinc-800 bg-surface px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Signature Ability
        </div>
        <span className={`text-xs font-bold ${meta.accentClass}`}>
          {meta.icon} {meta.label}
        </span>
      </div>

      <p className="text-xs leading-snug text-text-secondary">{description}</p>

      <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted">
        <span>Cooldown</span>
        <span className="font-mono">{formatDurationCompact(template.abilityCooldownSecs)}</span>
      </div>

      {interactive && (
        <InteractiveTrigger
          template={template}
          heroMint={interactive.heroMint}
          slotIndex={interactive.slotIndex}
        />
      )}
    </div>
  );
}

interface InteractiveTriggerProps {
  template: HeroTemplateAccount;
  heroMint: PublicKey;
  slotIndex: number;
}

/** Live cooldown countdown + Use Ability button. Re-renders every second. */
function InteractiveTrigger({ template, heroMint, slotIndex }: InteractiveTriggerProps) {
  const cd = useHeroAbilityCooldown(slotIndex, template.abilityCooldownSecs);
  const pending = usePendingEffect();
  const useAbility = useUseAbility();

  // The pending banner shows kind already; if THIS hero's kind sets a pending
  // one-shot and it matches, surface that here too for clarity.
  const armedHere =
    pending !== null &&
    pending.kind === template.abilityKind &&
    template.abilityKind <= AbilityKind.EncounterSkip;

  return (
    <div className="mt-2 space-y-2">
      {armedHere && (
        <div className="rounded border border-border-gold/40 bg-accent/15 px-2 py-1 text-[10px] text-text-gold">
          Armed — fires on next matching action.
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <TxButton
          onClick={(rp) =>
            useAbility(heroMint, template.templateId, slotIndex, rp).then((r) => r.signature)
          }
          disabled={!cd.ready}
          variant="primary"
          className="flex-1 text-xs"
        >
          {cd.ready ? "Use Ability" : `On Cooldown`}
        </TxButton>
        <div className="min-w-[70px] text-right font-mono text-[11px] text-text-secondary">
          {cd.ready ? "Ready" : formatDurationCompact(cd.remainingSecs)}
        </div>
      </div>
    </div>
  );
}
