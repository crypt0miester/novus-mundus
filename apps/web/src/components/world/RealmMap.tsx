"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { GameIcon } from "@/components/shared/GameIcon";
import {
  useWorldCities,
  useWorldPlayers,
  useWorldTeams,
  useWorldGameEngine,
  useCitizenStatus,
} from "@/lib/hooks/world";
import { convexHull, inflate, smoothClosedPath, type Pt } from "./util/hull";
import { useZoomPan } from "./util/useZoomPan";
import styles from "./RealmMap.module.css";
import { getCityLore } from "@/lib/cityLore";

export { styles as realmMapStyles };

/** A projected city — what the renderSelected callback receives. */
export interface RealmCityNode {
  city: {
    name: string;
    cityType: number;
    cityId: number;
    playersPresent: number;
    minEncounterLevel: number;
    maxEncounterLevel: number;
    latitude: number;
    longitude: number;
    activeEncounters?: { toNumber: () => number };
  };
  key: string;
  x: number;
  y: number;
  size: number;
}

export interface RealmMapDefaultContext {
  typeCounts: number[];
  kingdom: string;
  theme: string;
  start: number;
}

export interface RealmMapSelectedContext {
  node: RealmCityNode;
  isHome: boolean;
}

/* City type → glyph + label + icon. Index must match the on-chain CityType
 * enum: Capital=0, Resource=1, Combat=2, Trade=3. Colour is deliberately
 * absent — type is signalled by the glyph engraved beside each city's dot.
 * `glyph` stays for the tiny in-SVG markers; `icon` is the engraved GameIcon
 * used in the HTML legend and detail panels. */
const TYPE_META = [
  { label: "Capital", glyph: "♛", icon: "map-capital" },
  { label: "Resource", glyph: "⛏", icon: "map-resource" },
  { label: "Combat", glyph: "⚔", icon: "map-combat" },
  { label: "Trade", glyph: "◆", icon: "map-trade" },
] as const;

const THEMES = ["Medieval", "Cyberpunk", "Sci-Fi", "Modern", "Post-Apocalyptic"];

const typeIdx = (t: number) => Math.max(0, Math.min(3, t | 0));

/** Read a possibly-BN numeric field. */
function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const bn = v as { toNumber?: () => number };
  return typeof bn.toNumber === "function" ? bn.toNumber() : Number(v) || 0;
}

// Map viewBox — keeps the SVG math in clean units, scales to the sheet's
// aspect ratio (7:5 matches the .sheet CSS).
const VB_W = 1000;
const VB_H = 720;
const PAD = 80;

/** Project city lat/long into the viewBox, north up. */
function project(cities: { account: { latitude: number; longitude: number } }[]): {
  lat0: number;
  lon0: number;
  latR: number;
  lonR: number;
} {
  const lats = cities.map((c) => c.account.latitude);
  const lons = cities.map((c) => c.account.longitude);
  const lat0 = Math.min(...lats);
  const lon0 = Math.min(...lons);
  const latR = Math.max(...lats) - lat0 || 1;
  const lonR = Math.max(...lons) - lon0 || 1;
  return { lat0, lon0, latR, lonR };
}

export interface RealmMapProps {
  /** Replace the selected-city scroll panel. Default: city detail + "Walk
   *  its gates" link to /world/cities/[id]. */
  renderSelected?: (ctx: RealmMapSelectedContext) => ReactNode;
  /** Replace the no-selection scroll panel. Default: legend + realm meta. */
  renderDefault?: (ctx: RealmMapDefaultContext) => ReactNode;
  /** Controlled selection — supply with `onSelectChange` to manage selection
   *  externally (e.g., bind to a travel "destinationCity" state). Omit both
   *  for the standalone, internal-state mode used by /world. */
  selectedId?: number | null;
  onSelectChange?: (id: number | null) => void;
  /** Override the small all-caps header above the scroll panel. */
  scrollHead?: string;
}

export function RealmMap({
  renderSelected,
  renderDefault,
  selectedId: controlledId,
  onSelectChange,
  scrollHead,
}: RealmMapProps = {}) {
  const { data: cities, isLoading: citiesLoading } = useWorldCities();
  const { data: players } = useWorldPlayers();
  const { data: teams } = useWorldTeams();
  const { data: engineData } = useWorldGameEngine();
  const citizen = useCitizenStatus();

  const [internalId, setInternalId] = useState<number | null>(null);
  const isControlled = controlledId !== undefined;
  const selectedId = isControlled ? controlledId : internalId;
  const setSelectedId = (id: number | null) => {
    if (!isControlled) setInternalId(id);
    onSelectChange?.(id);
  };

  // Zoom/pan transforms the inner SVG <g>. Compass, ornaments, and scale bar
  // live outside the SVG so they stay anchored to the sheet.
  const zoom = useZoomPan({ vbWidth: VB_W, vbHeight: VB_H });

  const engine = (engineData as { account?: unknown })?.account ?? engineData;
  const eng = engine as
    | {
        kingdomName?: string;
        kingdomTheme?: number;
        kingdomStartTime?: unknown;
        totalPlayers?: unknown;
      }
    | undefined;

  const homeCity = citizen.isCitizen ? citizen.player?.currentCity : undefined;

  // Project lat/long into the viewBox, then run a small collision pass so
  // dense clusters don't pile on top of each other.
  const nodes = useMemo(() => {
    if (!cities || cities.length === 0) return [];
    const { lat0, lon0, latR, lonR } = project(cities);
    const maxPlayers = Math.max(1, ...cities.map((c) => c.account.playersPresent));
    const placed = cities.map((c) => ({
      city: c.account,
      key: c.pubkey.toBase58(),
      x: PAD + ((c.account.longitude - lon0) / lonR) * (VB_W - 2 * PAD),
      // Invert Y so north is up.
      y: PAD + (1 - (c.account.latitude - lat0) / latR) * (VB_H - 2 * PAD),
      size: 5 + 5 * Math.sqrt(c.account.playersPresent / maxPlayers),
    }));

    // GAP is the minimum edge-to-edge gap between any two dots. Larger values
    // give labels room at the cost of geographic accuracy; 28 is the sweet
    // spot for the current dataset.
    const GAP = 28;
    for (let iter = 0; iter < 60; iter++) {
      let moved = false;
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i]!;
          const b = placed[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const minDist = a.size + b.size + GAP;
          if (dist < minDist) {
            const push = (minDist - dist) / 2;
            const ux = dx / dist;
            const uy = dy / dist;
            a.x -= ux * push;
            a.y -= uy * push;
            b.x += ux * push;
            b.y += uy * push;
            moved = true;
          }
        }
      }
      for (const p of placed) {
        p.x = Math.max(PAD, Math.min(VB_W - PAD, p.x));
        p.y = Math.max(PAD, Math.min(VB_H - PAD, p.y));
      }
      if (!moved) break;
    }
    return placed;
  }, [cities]);

  // Larger dots first so smaller (later-painted) dots stay clickable.
  const renderOrder = useMemo(() => [...nodes].sort((a, b) => b.size - a.size), [nodes]);

  const labelSide = useMemo(() => {
    const NEIGHBOR_R = 110;
    const map = new Map<string, "above" | "below">();
    for (const n of nodes) {
      let above = 0;
      let below = 0;
      for (const m of nodes) {
        if (m === n) continue;
        const dx = m.x - n.x;
        const dy = m.y - n.y;
        if (Math.hypot(dx, dy) > NEIGHBOR_R) continue;
        if (dy < 0) above++;
        else if (dy > 0) below++;
      }
      // SVG y increases downward — fewer neighbours above means it's safe to
      // point the label up.
      map.set(n.key, above <= below ? "above" : "below");
    }
    return map;
  }, [nodes]);

  const kingdomPath = useMemo(() => {
    if (nodes.length < 3) return "";
    const pts: Pt[] = nodes.map((n) => ({ x: n.x, y: n.y }));
    const hull = convexHull(pts);
    const fat = inflate(hull, 56);
    return smoothClosedPath(fat, 0.55);
  }, [nodes]);

  const roads = useMemo(() => {
    const cap = nodes.find((n) => typeIdx(n.city.cityType) === 0);
    if (!cap) return [];
    return nodes
      .filter((n) => n !== cap)
      .map((n) => ({ x1: cap.x, y1: cap.y, x2: n.x, y2: n.y, key: n.key }));
  }, [nodes]);

  const selected = nodes.find((n) => n.city.cityId === selectedId) ?? null;

  const typeCounts = useMemo(() => {
    const counts = [0, 0, 0, 0];
    nodes.forEach((n) => counts[typeIdx(n.city.cityType)]++);
    return counts;
  }, [nodes]);

  const totalPlayers = toNum(eng?.totalPlayers) || players?.length || 0;
  const kingdomName = eng?.kingdomName || "The Kingdom";
  const theme = THEMES[eng?.kingdomTheme ?? 0] ?? "Unknown";

  if (citiesLoading) {
    return (
      <div className={styles.root}>
        <div className={styles.center}>the cartographer is at work…</div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.cartouche}>
        <h1 className={styles.kingdom}>{kingdomName}</h1>
        <div className={styles.tagline}>
          <span className={styles.rule} />a chart of {nodes.length} cities, drawn in the{" "}
          {theme.toLowerCase()} hand
          <span className={styles.rule} />
        </div>
      </header>

      <div className={styles.readouts}>
        <span className={styles.readout}>
          Citizens <span className={styles.readoutVal}>{totalPlayers.toLocaleString()}</span>
        </span>
        <span className={styles.readout}>
          Houses <span className={styles.readoutVal}>{(teams?.length ?? 0).toLocaleString()}</span>
        </span>
        <span className={styles.readout}>
          Cities <span className={styles.readoutVal}>{nodes.length.toLocaleString()}</span>
        </span>
      </div>

      <div className={styles.shell}>
        <div
          ref={zoom.containerRef}
          className={styles.sheet}
          onClick={() => setSelectedId(null)}
          style={{ touchAction: "none" }}
        >
          <div className={styles.grain} aria-hidden />
          <div className={styles.foxing} aria-hidden />

          <CornerOrnaments />

          <svg
            className={styles.svg}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label={`Map of ${kingdomName}`}
          >
            <g transform={zoom.transform}>
              {kingdomPath && <path className={styles.kingdomShape} d={kingdomPath} />}

              <g>
                {roads.map((l, i) => (
                  <line
                    key={l.key}
                    className={styles.road}
                    x1={l.x1}
                    y1={l.y1}
                    x2={l.x2}
                    y2={l.y2}
                    style={{ animationDelay: `${0.25 + i * 0.035}s` }}
                  />
                ))}
              </g>

              <g>
                {renderOrder.map((n, i) => {
                  const meta = TYPE_META[typeIdx(n.city.cityType)];
                  const isSel = n.city.cityId === selectedId;
                  const isHome = n.city.cityId === homeCity;
                  const isCapital = typeIdx(n.city.cityType) === 0;
                  const always = isCapital || isHome || isSel;
                  const hitR = Math.max(n.size + 3, 10);
                  const groupClass = [
                    styles.cityGroup,
                    always ? styles.alwaysLabel : "",
                    isSel ? styles.selected : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <g
                      key={n.key}
                      className={groupClass}
                      style={{ animationDelay: `${0.1 + i * 0.04}s` }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(isSel ? null : n.city.cityId);
                      }}
                      role="button"
                      aria-label={`${n.city.name}, ${meta.label} city`}
                    >
                      {isSel && (
                        <>
                          <circle
                            className={styles.selectedOuter}
                            cx={n.x}
                            cy={n.y}
                            r={n.size + 9}
                          />
                          <circle
                            className={styles.selectedInner}
                            cx={n.x}
                            cy={n.y}
                            r={n.size + 4}
                          />
                        </>
                      )}

                      <circle className={styles.cityRing} cx={n.x} cy={n.y} r={n.size + 2.5} />

                      {/* Transparent hit target — pointer-events catches the
                        +3 unit margin around the visible dot. */}
                      <circle cx={n.x} cy={n.y} r={hitR} fill="transparent" />

                      <circle className={styles.cityDot} cx={n.x} cy={n.y} r={n.size} />

                      <text
                        className={styles.cityGlyph}
                        x={n.x + n.size + 8}
                        y={n.y + 4}
                        fontSize={n.size * 1.2}
                      >
                        {meta.glyph}
                      </text>

                      {isHome && (
                        <polygon
                          className={styles.homeFlag}
                          points={`${n.x - 1},${n.y - n.size - 4} ${n.x - 1},${n.y - n.size - 16} ${n.x + 7},${n.y - n.size - 12} ${n.x - 1},${n.y - n.size - 8}`}
                        />
                      )}

                      {(() => {
                        const side = labelSide.get(n.key) ?? "above";
                        const nameAbove = side === "above";
                        const nameY = nameAbove
                          ? n.y - n.size - (isHome ? 22 : 9)
                          : n.y + n.size + 14;
                        const countY = nameAbove ? n.y + n.size + 12 : n.y - n.size - 7;
                        return (
                          <>
                            <text className={styles.cityName} x={n.x} y={nameY} fontSize={9.5}>
                              {n.city.name}
                            </text>
                            <text className={styles.cityCount} x={n.x} y={countY} fontSize={8}>
                              {n.city.playersPresent.toLocaleString()}
                            </text>
                          </>
                        );
                      })()}
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>

          <div className={styles.compass} aria-hidden>
            <CompassRose />
          </div>

          <div className={styles.scale}>
            <span className={styles.scaleBar} /> 100 leagues
          </div>

          {zoom.scale > 1.001 && (
            <button
              type="button"
              className={styles.resetBtn}
              onClick={(e) => {
                e.stopPropagation();
                zoom.reset();
              }}
              aria-label="Reset zoom"
              title="Reset zoom (or double-tap)"
            >
              ↻
            </button>
          )}
        </div>

        <aside className={styles.scroll}>
          <div className={styles.scrollHead}>
            {scrollHead ?? (selected ? "the city" : "the chart")}
          </div>
          {selected ? (
            renderSelected ? (
              renderSelected({
                node: selected,
                isHome: selected.city.cityId === homeCity,
              })
            ) : (
              <DefaultSelectedPanel node={selected} isHome={selected.city.cityId === homeCity} />
            )
          ) : renderDefault ? (
            renderDefault({
              typeCounts,
              kingdom: kingdomName,
              theme,
              start: toNum(eng?.kingdomStartTime),
            })
          ) : (
            <DefaultRealmPanel
              typeCounts={typeCounts}
              kingdom={kingdomName}
              theme={theme}
              start={toNum(eng?.kingdomStartTime)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

export function DefaultSelectedPanel({ node, isHome }: RealmMapSelectedContext) {
  const c = node.city;
  const meta = TYPE_META[typeIdx(c.cityType)];
  const lore = getCityLore(c.cityId);
  return (
    <>
      <div className={styles.detailName}>{c.name}</div>
      <span className={`${styles.detailType} ${isHome ? styles.home : ""}`}>
        <GameIcon id={meta.icon} title={meta.label} size={15} />
        {meta.label}
        {isHome ? " — your seat" : ""}
      </span>

      {lore && <p className={styles.hint}>{lore.lore}</p>}

      <dl className={styles.lineMeta}>
        {lore && (
          <>
            <dt>Region</dt>
            <dd>{lore.region}</dd>
          </>
        )}
        <dt>People present</dt>
        <dd className={styles.numeral}>{c.playersPresent.toLocaleString()}</dd>
        <dt>Wilds about it</dt>
        <dd className={styles.numeral}>
          lv {c.minEncounterLevel}–{c.maxEncounterLevel}
        </dd>
      </dl>

      <Link href={`/world/cities/${c.cityId}`} className={styles.seal}>
        <span>Walk its gates</span>
        <span>›</span>
      </Link>
    </>
  );
}

export function DefaultRealmPanel({ typeCounts, kingdom, theme, start }: RealmMapDefaultContext) {
  const started =
    start > 0
      ? new Date(start * 1000).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "—";
  return (
    <>
      {TYPE_META.map((m, i) => (
        <div className={styles.legendRow} key={m.label}>
          <GameIcon id={m.icon} title={m.label} size={16} />
          <span>{m.label}</span>
          <span className={styles.legendCount}>{typeCounts[i]}</span>
        </div>
      ))}

      <dl className={styles.metaTable}>
        <dt>Realm</dt>
        <dd>{kingdom}</dd>
        <dt>Hand</dt>
        <dd>{theme}</dd>
        <dt>First marked</dt>
        <dd>{started}</dd>
      </dl>

      <p className={styles.hint}>
        Touch a city to learn its name and its wilds. The roads run from the King&apos;s seat
        outward; the larger the ink, the more souls walk within.
      </p>
    </>
  );
}

function CompassRose() {
  return (
    <svg viewBox="0 0 100 100">
      <circle
        cx="50"
        cy="50"
        r="38"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        opacity="0.55"
      />
      <circle
        cx="50"
        cy="50"
        r="32"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.35"
        opacity="0.35"
      />

      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i * Math.PI) / 4;
        const x1 = 50 + Math.cos(a) * 32;
        const y1 = 50 + Math.sin(a) * 32;
        const x2 = 50 + Math.cos(a) * 38;
        const y2 = 50 + Math.sin(a) * 38;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeWidth="0.6"
            opacity="0.55"
          />
        );
      })}

      <path d="M50 14 L54 50 L50 86 L46 50 Z" fill="currentColor" opacity="0.85" />
      <path d="M14 50 L50 46 L86 50 L50 54 Z" fill="currentColor" opacity="0.55" />
      <circle cx="50" cy="50" r="2.2" fill="currentColor" opacity="0.9" />

      <text
        x="50"
        y="11"
        textAnchor="middle"
        fontSize="10"
        fontFamily="var(--font-cinzel), serif"
        fontWeight="700"
        fill="currentColor"
        opacity="0.85"
      >
        N
      </text>
    </svg>
  );
}

/** Four small ink flourishes for the sheet corners. */
function CornerOrnaments() {
  const ornament = (
    <svg viewBox="0 0 32 32">
      <path
        d="M2 2 L14 2 L14 4 L4 4 L4 14 L2 14 Z M6 6 L10 6 L10 7 L7 7 L7 10 L6 10 Z M14 12 C 18 12 18 18 22 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="3.2" cy="3.2" r="1.1" fill="currentColor" opacity="0.7" />
    </svg>
  );
  return (
    <>
      <div className={`${styles.ornament} ${styles.tl}`}>{ornament}</div>
      <div className={`${styles.ornament} ${styles.tr}`}>{ornament}</div>
      <div className={`${styles.ornament} ${styles.bl}`}>{ornament}</div>
      <div className={`${styles.ornament} ${styles.br}`}>{ornament}</div>
    </>
  );
}
