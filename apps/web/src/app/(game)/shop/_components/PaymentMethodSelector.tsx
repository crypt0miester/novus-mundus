"use client";

import { useMemo } from "react";
import type { PublicKey } from "@solana/web3.js";
import { formatLamportsAsSol } from "novus-mundus-sdk";
import { useAllowedTokens, type AllowedToken } from "@/lib/hooks/useAllowedTokens";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { selectShopTile } from "./views/shared";

/**
 * What the user chose to pay with. Maps directly onto the on-chain payment
 * routing: `kind: "sol"` to `paymentType = 0`, `kind: "token"` to
 * `paymentType = 2` plus the relevant `tokenPayment` accounts.
 */
export type PaymentMethod =
  | { kind: "sol" }
  | {
      kind: "token";
      mint: PublicKey;
      pegged: boolean;
      decimals: number;
      symbol: string;
    };

/**
 * What the caller knows about the product's price. Exactly one of
 * `usdCents` (USD-denominated, e.g. subscriptions) or `solLamports` (SOL-priced,
 * e.g. shop items) should be set.
 */
export interface ProductPrice {
  /** USD price in cents. The on-chain converter scales pegged tokens directly
   *  (`cents × 10^(decimals - 2)`); for SOL we divide by the SOL/USD rate. */
  usdCents?: number;
  /** SOL price in lamports. Pegged tokens cannot pay this — the chain rejects
   *  them. Oracle-priced tokens convert via Pyth/Switchboard. */
  solLamports?: number;
  /** SOL/USD rate from `game_engine.usd_price_cents` (cents per 1 SOL).
   *  Required to convert `usdCents` to a SOL-display amount. */
  solUsdRateCents?: number;
}

/** Format a product's price as it would be paid in `method`. */
export function formatPaymentPrice(method: PaymentMethod, price: ProductPrice): string {
  if (method.kind === "sol") {
    if (price.solLamports != null) return formatLamportsAsSol(price.solLamports);
    if (price.usdCents != null && price.solUsdRateCents && price.solUsdRateCents > 0) {
      const lamports = Math.floor((price.usdCents * 1_000_000_000) / price.solUsdRateCents);
      return formatLamportsAsSol(lamports);
    }
    return "—";
  }

  // Token payment
  if (method.pegged) {
    if (price.usdCents == null) return "—"; // chain rejects pegged for SOL-priced
    // `cost_usd_cents × 10^(decimals - 2)`, displayed as the human amount.
    const amount = price.usdCents / 100;
    return `${formatTokenAmount(amount, method.decimals)} ${method.symbol}`;
  }

  // Oracle-priced token. We can't compute exact amount without a live quote,
  // so be honest: show the symbol with an "≈" placeholder. The on-chain
  // converter will settle the exact units at confirmation.
  return `≈ ${method.symbol} (oracle)`;
}

/** Trim trailing zeros while keeping at least 2 decimals where relevant. */
function formatTokenAmount(amount: number, decimals: number): string {
  if (amount === 0) return "0";
  // For USD-pegged stablecoins, two decimals is the natural format.
  const dp = Math.min(decimals, 2);
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: Math.min(decimals, 6),
  });
}

/** Format a product's USD price as a "$X.XX" hint (for muted secondary lines). */
export function formatPriceUsd(price: ProductPrice): string | null {
  if (price.usdCents == null) return null;
  return `$${(price.usdCents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface PaymentMethodSelectorProps {
  /** What product type the selector is choosing payment for. Determines which
   *  token options are valid. Subscriptions are USD-priced; shop items are
   *  SOL-priced. */
  product: "usd" | "sol";
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  className?: string;
}

/**
 * Tab selector for product payment method (SOL / stablecoins / oracle tokens).
 *
 * Reads the live AllowedToken whitelist from the on-chain account store. Hides
 * tokens that can't legally pay for the product type — pegged stablecoins are
 * disabled for SOL-priced shop items because the chain has no USD basis to
 * convert from (see `process_token_payment_flow`).
 */
export function PaymentMethodSelector({
  product,
  value,
  onChange,
  className,
}: PaymentMethodSelectorProps) {
  const { data: tokens } = useAllowedTokens();
  const reduce = useReducedMotion();

  // Only show tokens the chain will actually accept for this product type.
  const validTokens = useMemo<AllowedToken[]>(() => {
    if (product === "usd") return tokens; // all valid — pegged and oracle
    // SOL-priced: pegged tokens are rejected by the helper; only oracle tokens work.
    return tokens.filter((t) => !t.pegged);
  }, [tokens, product]);

  // Nothing to choose between — keep the SOL tab so layout doesn't jump, but
  // skip rendering the row entirely if it's the only option.
  if (validTokens.length === 0) {
    return null;
  }

  const isSelected = (m: PaymentMethod): boolean => {
    if (m.kind === "sol") return value.kind === "sol";
    if (value.kind !== "token") return false;
    return value.mint.equals(m.mint);
  };

  const options: { method: PaymentMethod; label: string; sublabel?: string }[] = [
    { method: { kind: "sol" }, label: "SOL", sublabel: "Native" },
    ...validTokens.map<{ method: PaymentMethod; label: string; sublabel?: string }>((t) => ({
      method: {
        kind: "token",
        mint: t.mint,
        pegged: t.pegged,
        decimals: t.decimals,
        symbol: t.symbol,
      },
      label: t.symbol,
      sublabel: t.pegged ? "USD-pegged" : "Oracle",
    })),
  ];

  return (
    <div className={className}>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-text-muted">Pay with</div>
      <div
        className="inline-flex rounded-lg border border-zinc-800 bg-surface p-0.5"
        role="tablist"
        aria-label="Payment method"
      >
        {options.map((opt) => {
          const active = isSelected(opt.method);
          return (
            <button
              key={opt.label}
              type="button"
              role="tab"
              data-shop-tile
              aria-selected={active}
              onClick={(e) => {
                selectShopTile(e.currentTarget, reduce);
                onChange(opt.method);
              }}
              className={`min-w-[68px] rounded-md px-3 py-1.5 text-center text-xs transition-colors ${
                active
                  ? "bg-surface-raised text-text-primary shadow-inner"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <div className={`font-semibold ${active ? "text-text-gold" : ""}`}>{opt.label}</div>
              {opt.sublabel && (
                <div className="text-[9px] uppercase tracking-wider opacity-70">{opt.sublabel}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
