"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useUser } from "@/lib/hooks/useUser";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useAllCities } from "@/lib/hooks/useAllCities";
import { useTransact } from "@/lib/hooks/useTransact";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { cn } from "@/lib/utils";
import {
  createInitUserInstruction,
  createInitPlayerInstruction,
} from "@/lib/sdk";

const CITY_TYPE_NAMES = ["Capital", "Trade", "Combat", "Resource"];
const CITY_TYPE_ICONS = ["♛", "◆", "⚔", "⛏"];

type Step = "checking" | "pick-city" | "complete";

export function OnboardingFlow() {
  const { publicKey } = useWallet();
  const { data: userData, isLoading: userLoading } = useUser();
  const { data: playerData, isLoading: playerLoading } = usePlayer();
  const { data: geData } = useGameEngine();
  const { data: cities } = useAllCities();
  const transact = useTransact();
  const [step, setStep] = useState<Step>("checking");
  const [selectedCityId, setSelectedCityId] = useState<number | null>(null);

  const needsUser = !userData?.exists;
  const selectedCity = cities.find((c) => c.account.cityId === selectedCityId) ?? null;
  useEffect(() => {
    if (userLoading || playerLoading) {
      setStep("checking");
      return;
    }
    if (!playerData?.exists) {
      setStep("pick-city");
    } else {
      setStep("complete");
    }
  }, [userData, playerData, userLoading, playerLoading]);

  if (step === "checking") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <h2 className="tier-title text-2xl font-semibold">NOVUS MUNDUS</h2>
        <p className="animate-pulse text-sm text-text-muted">
          Checking your status...
        </p>
      </div>
    );
  }

  if (step === "complete") {
    return null;
  }

  const ready = !!publicKey && !!geData?.account && !!selectedCity;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-8">
      <h2 className="tier-title font-display text-3xl font-bold tracking-wide">
        WELCOME, WARRIOR
      </h2>
      <p className="text-sm text-text-secondary">
        Choose your starting city
      </p>

      {cities.length === 0 ? (
        <p className="animate-pulse text-sm text-text-muted">Loading cities...</p>
      ) : (
        <div className="mx-auto grid w-full max-w-lg grid-cols-2 gap-3 px-4">
          {cities.map((c) => {
            const city = c.account;
            const active = selectedCityId === city.cityId;
            return (
              <button
                key={city.cityId}
                onClick={() => setSelectedCityId(city.cityId)}
                className={cn(
                  "card flex flex-col items-start gap-1 p-4 text-left transition-all",
                  active
                    ? "accent-border ring-1 ring-amber-500/40"
                    : "border border-zinc-800 hover:border-zinc-700"
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-semibold text-text-primary">
                    {CITY_TYPE_ICONS[city.cityType] ?? "◈"} {city.name}
                  </span>
                  {active && <span className="text-xs text-amber-400">●</span>}
                </div>
                <span className="text-xs text-text-muted">
                  {CITY_TYPE_NAMES[city.cityType] ?? "City"} — {city.playersPresent} players
                </span>
              </button>
            );
          })}
        </div>
      )}

      <TxButton
        disabled={!ready}
        onClick={async (reportPhase: (p: TxPhase) => void) => {
          if (!publicKey || !geData?.account || !selectedCity)
            throw new Error("Not ready");

          const instructions = [];

          if (needsUser) {
            instructions.push(
              createInitUserInstruction({
                owner: publicKey,
                gameEngine: geData.pubkey,
              })
            );
          }

          instructions.push(
            createInitPlayerInstruction({
              owner: publicKey,
              gameEngine: geData.pubkey,
              startingCityId: selectedCity.account.cityId,
              cityLatitude: selectedCity.account.latitude,
              cityLongitude: selectedCity.account.longitude,
            })
          );

          await transact.mutateAsync({
            instructions,
            invalidateKeys: [
              ["user", publicKey.toBase58()],
              ["player", publicKey.toBase58()],
            ],
            successMessage: "Welcome to Novus Mundus!",
            onPhase: reportPhase,
          });
          return "";
        }}
      >
        {selectedCity
          ? `Enter ${selectedCity.account.name}`
          : "Select a city"}
      </TxButton>

    </div>
  );
}
