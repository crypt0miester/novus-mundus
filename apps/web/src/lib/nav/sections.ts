import { PRIMARY } from "@/components/layout/nav-config";

// The two-tier rail derives the drawer's contextual content from the active
// route: which primary section owns the current page. The children themselves
// (the section deep-links) are pulled from the resolved nav list in the rail and
// drawer (see useNavItems), so the section table here only needs the owner's
// base route and header label, and the views can never drift from nav-config.

// A primary section keyed by its base route. `key` is the primary `href`'s
// pathname (no query) so `sectionForPath` can match it; `label` is the header
// the drawer shows.
export interface SectionDef {
  key: string;
  label: string;
}

// Strip the query/hash from an href so a base-path comparison is clean. The
// SECONDARY deep-links carry query strings (e.g. `/estate?building=arena`);
// the section owner is just the base route.
function basePath(href: string): string {
  const q = href.indexOf("?");
  const h = href.indexOf("#");
  let end = href.length;
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  return href.slice(0, end);
}

// Whether a route is active for a given nav href: the pathname is the href's
// base route or a child of it. Shared by the rail and the drawer so their
// active-state matching is identical.
export function isActiveRoute(pathname: string | null | undefined, href: string): boolean {
  const base = basePath(href);
  return pathname === base || !!pathname?.startsWith(`${base}/`);
}

// The section table: the PRIMARY owners by base route + header label. The
// PRIMARY bases (/dashboard /estate /team /shop /map) never prefix one another,
// so a pathname matches at most one section.
export const SECTIONS: SectionDef[] = PRIMARY.filter((p) => p.href).map((primary) => ({
  key: basePath(primary.href!),
  label: primary.label,
}));

// Resolve which primary section owns a pathname. Returns null for routes that no
// primary owns (e.g. the standalone browse/personal screens), where the drawer
// renders just the resource footer.
export function sectionForPath(pathname: string | null | undefined): SectionDef | null {
  if (!pathname) return null;
  return SECTIONS.find((s) => pathname === s.key || pathname.startsWith(`${s.key}/`)) ?? null;
}
