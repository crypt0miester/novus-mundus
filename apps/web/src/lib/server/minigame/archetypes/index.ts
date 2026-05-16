import type { Archetype, ArchetypeName } from "../types";
import { mcqArchetype } from "./mcq";
import { setSelectArchetype } from "./set-select";
import { assignmentArchetype } from "./assignment";
import { orderingArchetype } from "./ordering";
import { memoryArchetype } from "./memory";
import { reflexArchetype } from "./reflex";

/** The archetype registry — `name → { generate, applyMove?, grade }`. */
export const ARCHETYPES: Record<ArchetypeName, Archetype> = {
  mcq: mcqArchetype,
  "set-select": setSelectArchetype,
  assignment: assignmentArchetype,
  ordering: orderingArchetype,
  memory: memoryArchetype,
  reflex: reflexArchetype,
};
