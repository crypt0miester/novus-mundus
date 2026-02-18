import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import React, { useMemo } from "react";

import { BaseWalletConnectionButton } from "./BaseWalletConnectionButton";
import type { ButtonProps } from "./Button";

type ButtonState = "connecting" | "connected" | "has-wallet" | "no-wallet";

type Props = ButtonProps & {
  labels: Record<ButtonState, string>;
};

export function BaseWalletConnectButton({
  children,
  disabled,
  labels,
  onClick,
  ...props
}: Props) {
  const { wallet, connect, connecting, connected, publicKey } = useWallet();

  const buttonState = useMemo((): ButtonState => {
    if (connecting) return "connecting";
    if (connected) return "connected";
    if (wallet) return "has-wallet";
    return "no-wallet";
  }, [connecting, connected, wallet]);

  return (
    <BaseWalletConnectionButton
      {...props}
      disabled={disabled || (!wallet && buttonState !== "no-wallet")}
      onClick={(e) => {
        if (onClick) onClick(e);
        if (e.defaultPrevented) return;
        if (wallet && !connected) {
          if (wallet.readyState === WalletReadyState.NotDetected) {
            localStorage.removeItem("walletName");
            window.location.reload();
          } else if (connect) {
            connect().catch(() => {});
          }
        }
      }}
      walletIcon={wallet?.adapter.icon}
      walletName={wallet?.adapter.name}
    >
      {children ? children : labels[buttonState]}
    </BaseWalletConnectionButton>
  );
}
