"use client";

import { WorldHeader } from "@/components/layout/WorldHeader";
import { WorldNav } from "@/components/layout/WorldNav";

export default function WorldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <WorldHeader />
      <WorldNav />
      <main className="flex-1 p-4 lg:p-6">{children}</main>
    </div>
  );
}
