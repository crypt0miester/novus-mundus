import React, { Suspense, useSyncExternalStore } from "react";

import { BaseWalletMultiButton } from "./BaseWalletMultiButton";
import type { ButtonProps } from "./Button";

const LABELS = {
  "change-wallet": "Change wallet",
  connecting: "Connecting ...",
  "copy-address": "Copy address",
  copied: "Copied",
  disconnect: "Disconnect",
  "has-wallet": "Connect",
  "no-wallet": "Connect Wallet",
} as const;

const emptySubscribe = () => () => {};

export function WalletMultiButton(props: ButtonProps) {
  const isClient = useSyncExternalStore(emptySubscribe, () => true, () => false);

  return (
    <Suspense>
      {isClient && <BaseWalletMultiButton {...props} labels={LABELS} />}
    </Suspense>
  );
}
