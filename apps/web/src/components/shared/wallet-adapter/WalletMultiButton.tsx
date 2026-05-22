import React, { Suspense, useSyncExternalStore } from "react";

import { BaseWalletMultiButton } from "./BaseWalletMultiButton";
import type { ButtonProps } from "./Button";

const LABELS = {
  "change-wallet": "change wallet",
  connecting: "connecting ...",
  "copy-address": "copy address",
  copied: "copied",
  disconnect: "disconnect",
  "has-wallet": "connect",
  "no-wallet": "connect wallet",
} as const;

const emptySubscribe = () => () => {};

export function WalletMultiButton(props: ButtonProps) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  return <Suspense>{isClient && <BaseWalletMultiButton {...props} labels={LABELS} />}</Suspense>;
}
