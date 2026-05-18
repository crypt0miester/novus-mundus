/**
 * DOM-nesting / hydration smoke test.
 *
 * Loads every route and fails if React reports invalid DOM nesting — the
 * `<button>`-inside-`<button>` (and `<a>`-in-`<a>`, `<p>`-wraps-`<div>`, …)
 * class of bug. These are invisible to `tsc` and to static lint when the
 * nesting happens through component composition (a `<Button>` rendered inside
 * another `<Button>`); they only surface in the resolved render tree, which is
 * exactly what a real browser load exposes.
 *
 * React 19 logs these as `console.error`, prefixed `In HTML, <x> cannot be a
 * descendant of <y>` (older React: `validateDOMNesting`). We also treat the
 * generic hydration-failure message as a failure.
 *
 * Wallet-gated `(game)` route *content* is not exercised here (no wallet is
 * connected) — but the layout chrome, navigation, panels and connect screens
 * still render, so nesting bugs in those are caught. Deeper coverage would
 * need a mocked wallet adapter (future follow-up).
 */
import { test, expect } from '@playwright/test';

/** Routes to smoke. Dynamic segments use values seeded by `novus init all`. */
const ROUTES = [
  '/',
  '/world',
  '/world/cities',
  '/world/cities/0',
  '/world/leaderboard',
  '/world/teams',
  '/dashboard',
  '/combat',
  '/estate',
  '/events',
  '/leaderboard',
  '/map',
  '/settings',
  '/shop',
  '/team',
];

/** Console/error text that indicates an invalid-nesting or hydration bug. */
const NESTING_PATTERNS = [
  /cannot be a descendant of/i,
  /cannot appear as a descendant of/i,
  /cannot contain a nested/i,
  /validateDOMNesting/i,
  /In HTML, <\w+>/i,
  /hydrat\w* (failed|error|mismatch)/i,
];

const isNestingError = (text: string) => NESTING_PATTERNS.some((re) => re.test(text));

for (const route of ROUTES) {
  test(`no invalid DOM nesting on ${route}`, async ({ page }) => {
    const violations: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isNestingError(text)) violations.push(text);
    });
    page.on('pageerror', (err) => {
      if (isNestingError(err.message)) violations.push(err.message);
    });

    await page.goto(route, { waitUntil: 'domcontentloaded' });
    // Give React time to render + hydrate so nesting warnings fire.
    await page.waitForTimeout(3_000);

    expect(violations, `Invalid DOM nesting on ${route}:\n${violations.join('\n')}`)
      .toEqual([]);
  });
}
