import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Economy | Novus Mundus",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
