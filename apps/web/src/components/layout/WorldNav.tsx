"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/world", label: "Overview", exact: true },
  { href: "/world/leaderboard", label: "Leaderboard" },
  { href: "/world/teams", label: "Teams" },
  { href: "/world/cities", label: "Cities" },
];

export function WorldNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border-default bg-surface-raised px-4 py-2 scrollbar-none">
      {NAV_ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname?.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-amber-900/40 text-text-gold"
                : "text-text-muted hover:bg-surface-overlay hover:text-text-secondary"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
