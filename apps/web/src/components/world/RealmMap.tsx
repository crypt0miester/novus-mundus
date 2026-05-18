"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useWorldCities,
  useWorldPlayers,
  useWorldTeams,
  useWorldGameEngine,
  useCitizenStatus,
} from "@/lib/hooks/world";
import styles from "./RealmMap.module.css";

/* City type → label + accent color. Index must match the on-chain
 * CityType enum: Capital=0, Resource=1, Combat=2, Trade=3. */
const TYPE_META = [
  { label: "Capital", color: "#f4c95d" },
  { label: "Resource", color: "#5fd98a" },
  { label: "Combat", color: "#ff6b6b" },
  { label: "Trade", color: "#3ad6c4" },
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

export function RealmMap() {
  const { data: cities, isLoading: citiesLoading } = useWorldCities();
  const { data: players } = useWorldPlayers();
  const { data: teams } = useWorldTeams();
  const { data: engineData } = useWorldGameEngine();
  const citizen = useCitizenStatus();

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // GameEngine may resolve as the account directly or wrapped in { account }.
  const engine = (engineData as { account?: unknown })?.account ?? engineData;
  const eng = engine as
    | { kingdomName?: string; kingdomTheme?: number; kingdomStartTime?: unknown; totalPlayers?: unknown }
    | undefined;

  const homeCity = citizen.isCitizen ? citizen.player?.currentCity : undefined;

  /* Project each city's lat/long into a padded 0-100 viewport. */
  const nodes = useMemo(() => {
    if (!cities || cities.length === 0) return [];
    const lats = cities.map((c) => c.account.latitude);
    const lons = cities.map((c) => c.account.longitude);
    const minLat = Math.min(...lats);
    const minLon = Math.min(...lons);
    const latRange = Math.max(...lats) - minLat || 1;
    const lonRange = Math.max(...lons) - minLon || 1;
    const maxPlayers = Math.max(1, ...cities.map((c) => c.account.playersPresent));
    const PAD = 13;

    return cities.map((c) => {
      const nx = (c.account.longitude - minLon) / lonRange;
      const ny = (c.account.latitude - minLat) / latRange;
      return {
        city: c.account,
        key: c.pubkey.toBase58(),
        x: PAD + nx * (100 - 2 * PAD),
        y: PAD + (1 - ny) * (100 - 2 * PAD), // invert: north is up
        size: 14 + 20 * Math.sqrt(c.account.playersPresent / maxPlayers),
      };
    });
  }, [cities]);

  /* Faint network lines fanning out from the (first) capital. */
  const links = useMemo(() => {
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

  if (citiesLoading) {
    return (
      <div className={styles.root}>
        <div className={styles.center}>
          <span>Surveying realm</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* ── Readout bar ───────────────────────────────────────── */}
      <div className={styles.topbar}>
        <div>
          <h1 className={styles.title}>
            <span className={styles.titleMark} />
            REALM MAP
          </h1>
          <div className={styles.subtitle}>
            {eng?.kingdomName || "Kingdom"} ·{" "}
            {THEMES[eng?.kingdomTheme ?? 0] ?? "Unknown"} Theme
          </div>
        </div>
        <div className={styles.readouts}>
          <div className={styles.readout}>
            <div className={styles.readoutLabel}>Citizens</div>
            <div className={styles.readoutValue}>{totalPlayers.toLocaleString()}</div>
          </div>
          <div className={styles.readout}>
            <div className={styles.readoutLabel}>Teams</div>
            <div className={styles.readoutValue}>{(teams?.length ?? 0).toLocaleString()}</div>
          </div>
          <div className={styles.readout}>
            <div className={styles.readoutLabel}>Cities</div>
            <div className={styles.readoutValue}>{nodes.length.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* ── Map + intel panel ─────────────────────────────────── */}
      <div className={styles.shell}>
        <div className={styles.mapWrap} onClick={() => setSelectedId(null)}>
          <div className={styles.mapGrid} />
          <div className={styles.radar} />
          <div className={styles.scanline} />
          <div className={styles.mapTag}>SECTOR // KINGDOM SURVEY GRID</div>

          {/* connection lines */}
          <svg
            className={styles.links}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {links.map((l, i) => (
              <line
                key={l.key}
                className={styles.link}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                style={{ animationDelay: `${0.3 + i * 0.04}s` }}
              />
            ))}
          </svg>

          {/* city nodes */}
          {nodes.map((n, i) => {
            const meta = TYPE_META[typeIdx(n.city.cityType)];
            const isSel = n.city.cityId === selectedId;
            const isHome = n.city.cityId === homeCity;
            return (
              <button
                key={n.key}
                className={`${styles.node} ${isSel ? styles.nodeSelected : ""}`}
                style={{
                  left: `${n.x}%`,
                  top: `${n.y}%`,
                  color: meta.color,
                  animationDelay: `${0.15 + i * 0.05}s`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(isSel ? null : n.city.cityId);
                }}
                aria-label={`${n.city.name}, ${meta.label} city`}
              >
                {isHome && <span className={styles.home} />}
                {isSel && <span className={styles.selRing} />}
                <span
                  className={styles.dot}
                  style={{
                    width: n.size,
                    height: n.size,
                    background: meta.color,
                    boxShadow: `0 0 ${n.size * 0.9}px ${meta.color}`,
                  }}
                >
                  <span className={styles.dotCore} />
                  <span className={styles.pulse} />
                </span>
                <span className={styles.chip}>
                  {n.city.playersPresent.toLocaleString()} present
                </span>
                <span className={styles.label}>{n.city.name}</span>
              </button>
            );
          })}

          <div className={styles.vignette} />
          <span className={styles.corner} />
          <span className={styles.corner} />
          <span className={styles.corner} />
          <span className={styles.corner} />
        </div>

        {/* ── Intel panel ─────────────────────────────────────── */}
        <aside className={styles.panel}>
          <div className={styles.panelHead}>
            {selected ? "City Intel" : "Realm Legend"}
          </div>
          <div className={styles.panelBody}>
            {selected ? (
              <SelectedCity node={selected} isHome={selected.city.cityId === homeCity} />
            ) : (
              <DefaultPanel
                typeCounts={typeCounts}
                kingdom={eng?.kingdomName}
                theme={THEMES[eng?.kingdomTheme ?? 0]}
                start={toNum(eng?.kingdomStartTime)}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ─── Selected city detail ──────────────────────────────────────── */

function SelectedCity({
  node,
  isHome,
}: {
  node: { city: any; size: number };
  isHome: boolean;
}) {
  const c = node.city;
  const meta = TYPE_META[typeIdx(c.cityType)];
  return (
    <>
      <div className={styles.cityName}>{c.name}</div>
      <span className={styles.typeBadge} style={{ color: meta.color }}>
        {meta.label}
        {isHome ? " · You are here" : ""}
      </span>

      <div className={styles.statGrid}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Players present</div>
          <div className={`${styles.statValue} ${styles.num}`}>
            {c.playersPresent.toLocaleString()}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>City ID</div>
          <div className={`${styles.statValue} ${styles.num}`}>#{c.cityId}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Encounter Lv</div>
          <div className={`${styles.statValue} ${styles.num}`}>
            {c.minEncounterLevel}–{c.maxEncounterLevel}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Coordinates</div>
          <div className={`${styles.statValue} ${styles.num}`}>
            {c.latitude.toFixed(1)}, {c.longitude.toFixed(1)}
          </div>
        </div>
      </div>

      <Link href={`/world/cities/${c.cityId}`} className={styles.enter}>
        <span>Enter City</span>
        <span>▸</span>
      </Link>
    </>
  );
}

/* ─── Default panel: legend + realm meta ────────────────────────── */

function DefaultPanel({
  typeCounts,
  kingdom,
  theme,
  start,
}: {
  typeCounts: number[];
  kingdom?: string;
  theme?: string;
  start: number;
}) {
  const started =
    start > 0
      ? new Date(start * 1000).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";
  return (
    <>
      {TYPE_META.map((m, i) => (
        <div className={styles.legendRow} key={m.label}>
          <span className={styles.swatch} style={{ background: m.color, color: m.color }} />
          {m.label}
          <span className={`${styles.legendCount} ${styles.num}`}>{typeCounts[i]}</span>
        </div>
      ))}

      <div className={styles.divider} />

      <div className={styles.metaRow}>
        <span>Kingdom</span>
        <span>{kingdom || "—"}</span>
      </div>
      <div className={styles.metaRow}>
        <span>Theme</span>
        <span>{theme || "—"}</span>
      </div>
      <div className={styles.metaRow}>
        <span>Founded</span>
        <span>{started}</span>
      </div>

      <p className={styles.hint}>
        Select a <b>node</b> to pull city intel. Node size scales with population;
        lines trace supply routes from the capital.
      </p>
    </>
  );
}
