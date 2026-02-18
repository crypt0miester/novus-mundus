// Re-export SDK calculators for use in the web app
export {
  calculateCombatPower,
  calculateDefensivePower,
  calculateOffensivePower,
} from "novus-mundus-sdk/calculators/combat";

export {
  calculateMaxStamina,
  calculateStaminaRegenRate,
  calculateCurrentStamina,
} from "novus-mundus-sdk/calculators/stamina";

export {
  calculateTravelTime,
} from "novus-mundus-sdk/calculators/travel";

export {
  calculateNoviGeneration,
} from "novus-mundus-sdk/calculators/novi";

export {
  calculateLevelXpRequirement,
} from "novus-mundus-sdk/calculators/progression";

export {
  calculateResourceProduction,
} from "novus-mundus-sdk/calculators/resources";
