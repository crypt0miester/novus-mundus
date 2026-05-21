import type { Metadata } from "next";
import { JetBrains_Mono, Cinzel } from "next/font/google";
import { GameProviders } from "@/lib/solana/provider";
import { NotificationToast } from "@/components/layout/NotificationToast";
import { TransitionOverlay } from "@/components/layout/TransitionOverlay";
import "./globals.css";

const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const cinzel = Cinzel({ subsets: ["latin"], variable: "--font-cinzel" });

export const metadata: Metadata = {
  title: "Novus Mundus",
  description: "Conquer kingdoms, forge empires, command armies — on-chain.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${jetbrains.variable} ${cinzel.variable}`}>
      <body className="min-h-screen bg-surface font-mono">
        <GameProviders>
          {children}
          <NotificationToast />
          <TransitionOverlay />
        </GameProviders>
      </body>
    </html>
  );
}
