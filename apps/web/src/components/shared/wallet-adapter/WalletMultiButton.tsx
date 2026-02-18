import React, { Suspense, useEffect, useState } from "react";

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

export function WalletMultiButton(props: ButtonProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <Suspense>
      {isClient && <BaseWalletMultiButton {...props} labels={LABELS} />}
    </Suspense>
  );
}
