import type { Metadata } from "next";
import { WorldShell } from "./_components/world-shell";

export const metadata: Metadata = {
  title: "World | Novus Mundus",
};

export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return <WorldShell>{children}</WorldShell>;
}
