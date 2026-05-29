"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Read+write a single integer URL param. Mirrors `useTabParam`'s
 *  contract (the default value is deleted from the URL so canonical
 *  URLs stay short) but with integer parsing — `Number` + `Number.isInteger`
 *  so `?foo=2.5` or `?foo=2x` falls back to the default rather than
 *  silently selecting via `parseInt`'s prefix scan. */
export function useUrlIntParam(
  name: string,
  defaultValue: number,
): [number, (value: number) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const value = useMemo(() => {
    const raw = searchParams.get(name);
    if (raw == null) return defaultValue;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : defaultValue;
  }, [searchParams, name, defaultValue]);

  const setValue = useCallback(
    (next: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === defaultValue) params.delete(name);
      else params.set(name, String(next));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname, name, defaultValue],
  );

  return [value, setValue];
}

/** Returns a function that patches multiple URL params at once. Keys
 *  whose value is `null` are deleted; string values are set. Use for
 *  cross-tab redirects ("Locate" / "Open in Castles") where several
 *  params change in lockstep — the equivalent inline boilerplate
 *  (`new URLSearchParams(searchParams.toString()) → mutate → router.replace`)
 *  appeared in 4+ places before this. */
export function useUrlPatch(): (mutations: Record<string, string | null>) => void {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    (mutations) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(mutations)) {
        if (val == null) params.delete(key);
        else params.set(key, val);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname],
  );
}
