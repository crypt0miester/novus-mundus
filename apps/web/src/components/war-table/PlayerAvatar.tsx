"use client";

// PlayerAvatar renders ONLY the circular avatar for a player: an optional
// equipped cosmetic frame ring, an inner disc, and an optional 1-2 char
// monogram. It does NOT render names; pair it with DomainName for labels.
//
// Accept exactly one of `wallet` (the base58 signing wallet carried on a
// WtMessage) or `playerPda` (a PlayerAccount PDA base58). A wallet is resolved
// to its PDA via derivePlayerPda; a PDA is looked up directly. The resolved
// PlayerCore drives the cosmetic frame and name-color disc; when the player is
// unknown or the chain client is not ready yet, we fall through to a
// deterministic gradient from the raw input string.

import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useShallow } from "zustand/react/shallow";
import { derivePlayerPda, type PlayerCore } from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";
import { getCosmeticColor } from "@/lib/config/cosmetics-catalog";
import { CosmeticFrame } from "@/components/cosmetics/CosmeticFrame";

interface AccountEntry<T> {
  pubkey: PublicKey;
  account: T;
}

export interface PlayerAvatarProps {
  // base58 signing WALLET (WtMessage.senderWallet). Derives the PDA internally.
  wallet?: string;
  // base58 PlayerAccount PDA (DmConvo.peerPlayerPda, /messages route param). Used directly.
  playerPda?: string;
  // diameter in CSS px, default 36
  size?: number;
  // optional hover title supplied by caller (e.g. resolved domain)
  title?: string;
}

// Deterministic two-stop gradient seeded by the input key. Identical input
// always yields the same gradient, giving each unknown player a stable look.
function gradientFromKey(base58: string): string {
  let h = 0;
  for (let i = 0; i < base58.length; i++) h = (h * 31 + base58.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${(hue + 40) % 360} 50% 22%))`;
}

// First 1-2 alphanumeric chars of the address, uppercased, as a light identity hint.
function monogramFromKey(base58: string): string {
  const cleaned = base58.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned.slice(0, 2).toUpperCase();
}

export function PlayerAvatar({ wallet, playerPda, size = 36, title }: PlayerAvatarProps) {
  const client = useNovusMundusClient();
  const gameEngine = client.gameEngine;

  // Snapshot only the slices we need so an unrelated WS tick does not churn
  // every avatar in a long thread.
  const { otherPlayers, myPlayerPda, selfPlayer } = useAccountStore(
    useShallow((s) => ({
      otherPlayers: s.otherPlayers,
      myPlayerPda: s.myPlayerPda,
      selfPlayer: s.player,
    })),
  );

  // The raw key used both for store lookup hints and the fallback gradient.
  // Exactly one of wallet / playerPda is expected; branch explicitly rather
  // than shimming a default.
  const rawKey = playerPda ?? wallet ?? "";

  const [resolved, setResolved] = useState<AccountEntry<PlayerCore> | null>(null);
  useEffect(() => {
    if (playerPda) {
      // PDA path: look it up directly, and match the self slot by PDA.
      if (myPlayerPda === playerPda && selfPlayer) setResolved(selfPlayer);
      else setResolved(otherPlayers.get(playerPda) ?? null);
      return;
    }

    if (wallet) {
      // Wallet path needs the chain client's gameEngine to derive the PDA.
      // gameEngine not ready yet is a real not-loaded state, not a shim.
      if (!gameEngine) {
        setResolved(null);
        return;
      }

      let pk: PublicKey;
      try {
        pk = new PublicKey(wallet);
      } catch {
        // Malformed wallet string: fall through to the gradient monogram.
        setResolved(null);
        return;
      }

      // Self match by wallet (the connected player's PlayerCore.owner).
      if (selfPlayer && selfPlayer.account.owner.equals(pk)) {
        setResolved(selfPlayer);
        return;
      }

      let cancelled = false;
      derivePlayerPda(gameEngine, pk)
        .then(([pda]) => {
          if (!cancelled) setResolved(otherPlayers.get(pda.toBase58()) ?? null);
        })
        .catch(() => {
          if (!cancelled) setResolved(null);
        });
      return () => {
        cancelled = true;
      };
    }

    setResolved(null);
  }, [wallet, playerPda, gameEngine, otherPlayers, myPlayerPda, selfPlayer]);

  // Inner disc fill: name-color hex when the player has one equipped (STATIC,
  // no animation in chat for cost), else the deterministic gradient fallback.
  const discBackground = useMemo(() => {
    const colorEntry = resolved ? getCosmeticColor(resolved.account.equippedNameColor) : null;
    if (colorEntry) return colorEntry.hex;
    return gradientFromKey(rawKey);
  }, [resolved, rawKey]);

  const monogram = monogramFromKey(rawKey);

  // CosmeticFrame falls through cleanly on id 0 / unknown ids (no ring), so it
  // is safe to render unconditionally. The `?? 0` is a DISPLAY catalog id, not
  // required app state, matching CosmeticFrame's documented contract.
  return (
    <CosmeticFrame id={resolved?.account.equippedAvatarFrame ?? 0} size={size}>
      <div
        title={title}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: discBackground,
          display: "grid",
          placeItems: "center",
          fontSize: Math.max(9, Math.round(size * 0.32)),
          fontWeight: 600,
          lineHeight: 1,
        }}
        className="select-none text-text-secondary"
      >
        {monogram}
      </div>
    </CosmeticFrame>
  );
}
