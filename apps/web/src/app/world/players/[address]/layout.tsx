import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Player Profile | Novus Mundus",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
