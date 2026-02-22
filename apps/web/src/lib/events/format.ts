/**
 * Event Message Formatter
 *
 * Converts NovusMundusEvents into human-readable toast messages.
 * Returns null for obscure events that don't warrant a toast.
 */

import type { NovusMundusEvent } from "novus-mundus-sdk";

function bn(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (v && typeof (v as any).toNumber === "function") return (v as any).toNumber();
  return Number(v) || 0;
}

function fmt(v: unknown): string {
  return bn(v).toLocaleString();
}

interface EventMessage {
  title: string;
  message: string;
}

export function formatEventMessage(event: NovusMundusEvent): EventMessage | null {
  switch (event.name) {
    // ── Combat ─────────────────────────────────────────────
    case "PlayerAttacked": {
      const d = event.data;
      const target = d.defenderName || d.defender.toBase58().slice(0, 6);
      if (d.attackerWon) {
        return { title: "Attack Successful", message: `Defeated ${target} — stole $${fmt(d.cashStolen)} cash` };
      }
      return { title: "Attack Failed", message: `${target} defended successfully` };
    }
    case "EncounterAttacked": {
      const d = event.data;
      return { title: "Encounter Hit", message: `Dealt ${fmt(d.damageDealt)} damage, ${fmt(d.healthRemaining)} HP remaining` };
    }
    case "EncounterDefeated": {
      const d = event.data;
      const parts = [];
      if (bn(d.lootCash) > 0) parts.push(`$${fmt(d.lootCash)} cash`);
      if (bn(d.lootNovi) > 0) parts.push(`${fmt(d.lootNovi)} NOVI`);
      return { title: "Encounter Defeated!", message: parts.length > 0 ? `Loot: ${parts.join(", ")}` : "No loot dropped" };
    }

    // ── Economy ────────────────────────────────────────────
    case "ResourcesCollected": {
      const d = event.data;
      const parts = [`$${fmt(d.finalOutput)} output`];
      if (bn(d.gemsEarned) > 0) parts.push(`${fmt(d.gemsEarned)} gems`);
      if (bn(d.xpGained) > 0) parts.push(`${fmt(d.xpGained)} XP`);
      return { title: "Resources Collected", message: parts.join(", ") };
    }
    case "UnitsHired": {
      const d = event.data;
      const types = ["Infantry", "Cavalry", "Siege", "Laborer", "Artisan", "Engineer"];
      const typeName = types[d.unitType] ?? `Type ${d.unitType}`;
      return { title: "Units Hired", message: `${fmt(d.finalQuantity)} ${typeName} recruited` };
    }
    case "CashTransferred": {
      const d = event.data;
      const to = d.toName || d.to.toBase58().slice(0, 6);
      return { title: "Cash Sent", message: `$${fmt(d.amount)} transferred to ${to}` };
    }
    case "EquipmentPurchased":
      return { title: "Equipment Purchased", message: "New equipment acquired" };
    case "StaminaPurchased":
      return { title: "Stamina Purchased", message: "Stamina replenished" };

    // ── Progression ────────────────────────────────────────
    case "XpGained": {
      const d = event.data;
      return { title: "XP Gained", message: `+${fmt(d.amount)} XP` };
    }
    case "PlayerLeveledUp": {
      const d = event.data;
      return { title: "Level Up!", message: `Reached Level ${d.newLevel}` };
    }
    case "DailyRewardClaimed":
      return { title: "Daily Reward Claimed", message: "Rewards collected" };
    case "SubscriptionPurchased":
      return { title: "Subscription Activated", message: "Premium tier unlocked" };

    // ── Travel ─────────────────────────────────────────────
    case "IntercityTravelStarted": {
      const d = event.data;
      return { title: "Traveling", message: `En route to destination` };
    }
    case "IntercityTravelCompleted": {
      return { title: "Arrived", message: "Reached destination city" };
    }
    case "PlayerTeleported": {
      return { title: "Teleported", message: "Arrived at destination" };
    }
    case "TravelCancelled":
      return { title: "Travel Cancelled", message: "Returned to origin" };

    // ── Estate ─────────────────────────────────────────────
    case "EstateCreated":
      return { title: "Estate Founded", message: "Your estate has been established" };
    case "BuildingStarted": {
      const d = event.data;
      return { title: "Construction Started", message: `Building plot ${d.plot} under construction` };
    }
    case "BuildingCompleted":
      return { title: "Building Complete", message: "Construction finished" };
    case "PlotPurchased":
      return { title: "Plot Purchased", message: "New land acquired" };
    case "EstateDailyClaimed":
      return { title: "Estate Daily Claimed", message: "Daily estate rewards collected" };

    // ── Forge ──────────────────────────────────────────────
    case "CraftStarted":
      return { title: "Crafting Started", message: "Forge is working..." };
    case "CraftCompleted":
      return { title: "Craft Complete!", message: "New item forged" };
    case "ItemEquipped":
      return { title: "Item Equipped", message: "Equipment updated" };

    // ── Expedition ─────────────────────────────────────────
    case "ExpeditionStarted":
      return { title: "Expedition Launched", message: "Units deployed on expedition" };
    case "ExpeditionClaimed":
      return { title: "Expedition Complete", message: "Expedition rewards claimed" };
    case "ExpeditionAborted":
      return { title: "Expedition Aborted", message: "Units recalled early" };

    // ── Research ───────────────────────────────────────────
    case "ResearchStarted":
      return { title: "Research Started", message: "Research in progress..." };
    case "ResearchCompleted":
      return { title: "Research Complete", message: "New technology unlocked" };

    // ── Hero ───────────────────────────────────────────────
    case "HeroMinted":
      return { title: "Hero Minted!", message: "A new hero has joined your roster" };
    case "HeroLeveledUp": {
      const d = event.data;
      return { title: "Hero Level Up!", message: `Hero reached Level ${d.newLevel}` };
    }
    case "HeroLocked":
      return { title: "Hero Deployed", message: "Hero is now active" };
    case "HeroUnlocked":
      return { title: "Hero Recalled", message: "Hero has been undeployed" };

    // ── Sanctuary ──────────────────────────────────────────
    case "MeditationStarted":
      return { title: "Meditation Started", message: "Hero is meditating..." };
    case "MeditationClaimed":
      return { title: "Meditation Complete", message: "Hero refreshed" };

    // ── Team ───────────────────────────────────────────────
    case "TeamCreated":
      return { title: "Team Created", message: "Your team is ready" };
    case "TeamJoined":
      return { title: "Team Joined", message: "Welcome to the team" };
    case "TeamLeft":
      return { title: "Left Team", message: "You have left the team" };

    // ── Loot ───────────────────────────────────────────────
    case "LootClaimed":
      return { title: "Loot Claimed", message: "Rewards collected" };
    case "EncounterSpawned":
      return { title: "Encounter Spawned", message: "A new encounter has appeared" };

    // ── Dungeon ────────────────────────────────────────────
    case "DungeonEntered":
      return { title: "Dungeon Entered", message: "Descending into the depths..." };
    case "DungeonRoomCleared":
      return { title: "Room Cleared", message: "Moving to next room" };
    case "DungeonCompleted":
      return { title: "Dungeon Complete!", message: "Victorious!" };
    case "DungeonFailed":
      return { title: "Dungeon Failed", message: "Better luck next time" };

    // ── Castle ─────────────────────────────────────────────
    case "CastleClaimed":
      return { title: "Castle Claimed", message: "You are now the king" };
    case "CastleConquered":
      return { title: "Castle Conquered!", message: "The castle has fallen" };
    case "GarrisonJoined":
      return { title: "Garrison Joined", message: "Defending the castle" };

    // ── Shop ───────────────────────────────────────────────
    case "ItemPurchased":
      return { title: "Item Purchased", message: "New item acquired" };
    case "BundlePurchased":
      return { title: "Bundle Purchased", message: "Bundle rewards received" };
    case "NoviPurchased":
      return { title: "NOVI Purchased", message: "NOVI tokens added to your account" };

    default:
      return null;
  }
}
