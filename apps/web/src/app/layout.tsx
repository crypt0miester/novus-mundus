import type { Metadata } from "next";
import { GameProviders } from "@/lib/solana/provider";
import { NotificationToast } from "@/components/layout/NotificationToast";
import { TransitionOverlay } from "@/components/layout/TransitionOverlay";
import "./globals.css";

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
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
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
