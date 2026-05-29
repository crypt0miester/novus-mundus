import type { GameIconId } from "@/components/shared/GameIcon";
import { BuildingId, BuildingName } from "@/lib/buildings";
import { buildingFraming } from "@/lib/narrative";
import { ShowcaseBanner } from "./showcase-banner";

// The "view" buildings (images/banners/banners.json, group "view") whose estate
// tabs have chrome get a full-color banner backdrop. Maps the on-chain
// BuildingId to its banner slug; a building absent here has no view banner.
const VIEW_BANNER_SLUG: Partial<Record<number, string>> = {
  [BuildingId.Arena]: "arena",
  [BuildingId.Catacombs]: "catacombs",
  [BuildingId.Dock]: "dock",
  [BuildingId.Farm]: "farm",
  [BuildingId.Mansion]: "mansion",
  [BuildingId.Mine]: "mine",
  [BuildingId.Academy]: "academy",
  [BuildingId.Vault]: "vault",
  [BuildingId.Workshop]: "workshop",
};

interface BuildingShowcaseProps {
  buildingId: number;
  /** Function-evoking icon for the building (its produce, action, or nav glyph). */
  icon: GameIconId;
}

// Building-as-subject banner for an estate view tab: the building's full-color
// art behind its name, the Cairn role as the accent tag, and its framing line.
// Distinct from the inline ShowcaseBanner the action tabs (forge, market, ...)
// use to showcase a *selected entity*. Returns null when the building has no
// view banner so callers can drop it cleanly.
export function BuildingShowcase({ buildingId, icon }: BuildingShowcaseProps) {
  const slug = VIEW_BANNER_SLUG[buildingId];
  if (!slug) return null;
  const framing = buildingFraming(buildingId);
  return (
    <ShowcaseBanner
      image={`/img/banners/${slug}-banner.webp`}
      icon={icon}
      title={BuildingName[buildingId]}
      tag={framing.role}
    >
      <p className="text-xs italic text-zinc-300">{framing.line}</p>
    </ShowcaseBanner>
  );
}
