import styles from "./RealmMap.module.css";

// Public URL of a city's heraldic sigil PNG (transparent gold line-art). One
// source for the path convention so a folder/extension rename is a single-line
// change; the map marker (RealmMap) and every selected-city panel call it.
// Returns the 96px `sm/` variant — the map only ever shows a ~34-38px medallion,
// so loading the 1024px original (used by the server-side hero compositor in
// lib/hero-image/compose.ts) would decode ~900x the pixels it paints. Both are
// produced by images/scripts/export-sigils-to-app.sh.
export function citySigilSrc(cityId: number): string {
  return `/img/heroes/city-sigils/sm/${cityId}.png`;
}

// A city's heraldic crest on a dark medallion beside its name. Shared by the
// default selected-city panel and the map / arrival panel overrides, so the
// crest can't be forgotten when a panel renders its own body. The medallion is
// dark so the gold line-art reads against the parchment panel.
export function CityCrest({ cityId, name }: { cityId: number; name: string }) {
  return (
    <div className={styles.detailHead}>
      <span className={styles.detailSigil} aria-hidden>
        <img
          src={citySigilSrc(cityId)}
          alt=""
          width={38}
          height={38}
          loading="lazy"
          decoding="async"
        />
      </span>
      <div className={styles.detailName}>{name}</div>
    </div>
  );
}
