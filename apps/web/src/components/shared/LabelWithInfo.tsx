"use client";

import type { ElementType, ReactNode } from "react";
import { InfoButton } from "./InfoButton";

interface LabelWithInfoProps {
  /** The label content — text or rich nodes. */
  children: ReactNode;
  /** The explanation shown by the trailing InfoButton. */
  info: ReactNode;
  /** Wrapping element. Defaults to a span so it sits inline with body text. */
  as?: ElementType;
  /** Classes on the wrapper (carry the label's own styling here). */
  className?: string;
  /** InfoButton icon size in px, forwarded through. */
  infoSize?: number;
}

/**
 * A label followed by an InfoButton — the recurring "text + i" shape. Owns the
 * spacing so call sites don't re-spell `{label}{" "}<InfoButton>…</InfoButton>`
 * at every use. Pass the label's styling via `className`; the wrapper element
 * defaults to a span but can be any tag via `as`.
 *
 *   <LabelWithInfo className="text-text-muted" info={NET_WORTH_INFO}>Net Worth</LabelWithInfo>
 */
export function LabelWithInfo({
  children,
  info,
  as: As = "span",
  className,
  infoSize,
}: LabelWithInfoProps) {
  return (
    <As className={className}>
      {children} <InfoButton size={infoSize}>{info}</InfoButton>
    </As>
  );
}
