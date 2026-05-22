/** Hero roster source of truth. HERO_TEMPLATES is seeded on-chain; move
 *  entries from RESERVE_HEROES into it to activate them. Update both consts
 *  whenever buff/economy math changes so the reserves stay seed-ready.
 *  meditationCityId references CITIES in cli/data/cities.ts. */
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export interface HeroTemplateData {
  templateId: number;
  name: string;
  heroType: number;            // 0=Offensive, 1=Defensive, 2=Economic, 3=Hybrid
  category: number;            // 0=Historical, 1=Mythological, 2=CryptoIcons, 3=Gaming, 4=Original
  mintCostLamports: number;    // in lamports (1 SOL = 1_000_000_000)
  supplyCap: number;           // 0=unlimited
  enabled: boolean;
  eventExclusive: boolean;
  requiredPlayerLevel: number;
  meditationCityId: number;
  buffs: { stat: number; baseBps: number }[];
  // Active ability (all optional, default 0 = no ability)
  // AbilityKind: 1=BuffNext, 2=CritNext, 3=ShieldNext, 4=EncounterSkip,
  // 5=InstantResource, 6=FragmentRefund
  abilityKind?: number;
  abilityStat?: number;         // BuffStat for BuffNext, else 0
  abilityParam1?: number;       // bps for BuffNext, amount for InstantResource/FragmentRefund
  abilityParam2?: number;       // duration secs for BuffNext, else 0
  abilityCooldownSecs?: number; // cooldown (must be > 0 if abilityKind != 0)
}

// ACTIVE ROSTER — seeded on-chain

// Common Starter Heroes (0.1 SOL, 4k supply, level 1)

const COMMON_HEROES: HeroTemplateData[] = [
  {
    templateId: 1,
    name: 'Roman Centurion',
    heroType: 1, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.1),
    supplyCap: 4_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 1, meditationCityId: 2, // Solterrae
    buffs: [{ stat: 2, baseBps: 500 }, { stat: 13, baseBps: 300 }],
  },
  {
    templateId: 2,
    name: 'Viking Raider',
    heroType: 0, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.1),
    supplyCap: 4_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 1, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 1, baseBps: 500 }, { stat: 15, baseBps: 300 }],
  },
  {
    templateId: 3,
    name: 'Silk Road Merchant',
    heroType: 2, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.1),
    supplyCap: 4_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 1, meditationCityId: 12, // Drenmire
    buffs: [{ stat: 3, baseBps: 500 }, { stat: 9, baseBps: 300 }],
  },
  {
    templateId: 4,
    name: 'Wandering Ronin',
    heroType: 3, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.1),
    supplyCap: 4_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 1, meditationCityId: 11, // Shirevane
    buffs: [{ stat: 1, baseBps: 400 }, { stat: 2, baseBps: 300 }],
  },
  {
    templateId: 5,
    name: 'Ashenmere Ranger',
    heroType: 1, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.1),
    supplyCap: 4_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 1, meditationCityId: 0, // Valdenmoor
    buffs: [{ stat: 2, baseBps: 400 }, { stat: 8, baseBps: 300 }],
  },
  {
    templateId: 6,
    name: 'Korthain Tomb-Hunter',
    heroType: 0, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.1),
    supplyCap: 4_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 1, meditationCityId: 9, // Korthain
    buffs: [{ stat: 1, baseBps: 400 }, { stat: 15, baseBps: 300 }],
  },
  {
    templateId: 7,
    name: 'Sunward Caravaneer',
    heroType: 2, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.1),
    supplyCap: 4_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 1, meditationCityId: 8, // Solvaran
    buffs: [{ stat: 3, baseBps: 400 }, { stat: 9, baseBps: 300 }],
  },
  {
    templateId: 155,
    name: 'Paper Hands',
    heroType: 2, category: 2,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.1),
    supplyCap: 4_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 1, meditationCityId: 0, // anywhere
    buffs: [{ stat: 3, baseBps: 600 }, { stat: 5, baseBps: 400 }, { stat: 17, baseBps: 300 }],
  },
];

// Rare Heroes (0.25 SOL, 2k supply, level 5)

const RARE_HEROES: HeroTemplateData[] = [
  {
    templateId: 10,
    name: 'Alexander the Great',
    heroType: 0, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 3, // Kael Mora
    buffs: [{ stat: 1, baseBps: 1000 }, { stat: 6, baseBps: 500 }, { stat: 4, baseBps: 300 }],
    // "Forced March": next attack +30% (3000 bps AttackPower), cd 12h
    abilityKind: 1, abilityStat: 1, abilityParam1: 3000, abilityParam2: 0, abilityCooldownSecs: 43_200,
  },
  {
    templateId: 11,
    name: 'Julius Caesar',
    heroType: 3, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 2, // Solterrae
    buffs: [{ stat: 1, baseBps: 800 }, { stat: 2, baseBps: 600 }, { stat: 3, baseBps: 400 }],
    // "Veni Vidi Vici": next attack auto-crits, cd 12h
    abilityKind: 2, abilityStat: 0, abilityParam1: 0, abilityParam2: 0, abilityCooldownSecs: 43_200,
  },
  {
    templateId: 12,
    name: 'Leonidas',
    heroType: 1, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 3, // Kael Mora
    buffs: [{ stat: 2, baseBps: 1200 }, { stat: 16, baseBps: 600 }, { stat: 8, baseBps: 400 }],
    // "Hold the Line": next incoming defense doubled, cd 8h
    abilityKind: 3, abilityStat: 0, abilityParam1: 0, abilityParam2: 0, abilityCooldownSecs: 28_800,
  },
  {
    templateId: 13,
    name: 'Cleopatra',
    heroType: 2, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 7, // Auren Khet
    buffs: [{ stat: 3, baseBps: 1200 }, { stat: 12, baseBps: 600 }, { stat: 9, baseBps: 400 }],
    // "Tribute": grants 100,000,000 cash immediately, cd 24h
    abilityKind: 5, abilityStat: 0, abilityParam1: 100_000_000, abilityParam2: 0, abilityCooldownSecs: 86_400,
  },
  {
    templateId: 15,
    name: 'Sun Tzu',
    heroType: 3, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 12, // Drenmire
    buffs: [{ stat: 7, baseBps: 800 }, { stat: 2, baseBps: 600 }, { stat: 4, baseBps: 500 }],
    // "Art of War": next attack auto-crits, cd 24h
    abilityKind: 2, abilityStat: 0, abilityParam1: 0, abilityParam2: 0, abilityCooldownSecs: 86_400,
  },
  {
    templateId: 16,
    name: 'Joan of Arc',
    heroType: 1, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 1, // Coranthas
    buffs: [{ stat: 2, baseBps: 1000 }, { stat: 8, baseBps: 700 }, { stat: 11, baseBps: 400 }],
    // "Holy Shield": next incoming defense doubled, cd 12h
    abilityKind: 3, abilityStat: 0, abilityParam1: 0, abilityParam2: 0, abilityCooldownSecs: 43_200,
  },
  {
    templateId: 72,
    name: 'Robin Hood',
    heroType: 2, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 0, // Valdenmoor
    buffs: [{ stat: 15, baseBps: 1000 }, { stat: 3, baseBps: 800 }, { stat: 7, baseBps: 500 }],
  },
  {
    templateId: 79,
    name: 'Sinbad',
    heroType: 2, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 9, // Korthain
    buffs: [{ stat: 3, baseBps: 1000 }, { stat: 15, baseBps: 700 }, { stat: 9, baseBps: 400 }, { stat: 18, baseBps: 500 }],
  },
  {
    templateId: 86,
    name: 'Hua Mulan',
    heroType: 3, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 12, // Drenmire
    buffs: [{ stat: 1, baseBps: 800 }, { stat: 2, baseBps: 700 }, { stat: 8, baseBps: 500 }],
  },
  {
    templateId: 89,
    name: 'Aladdin',
    heroType: 2, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 8, // Solvaran
    buffs: [{ stat: 15, baseBps: 1000 }, { stat: 3, baseBps: 700 }, { stat: 4, baseBps: 400 }],
  },
  {
    templateId: 151,
    name: 'Diamond Hands',
    heroType: 1, category: 2,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 0, // anywhere
    buffs: [{ stat: 2, baseBps: 1200 }, { stat: 9, baseBps: 800 }, { stat: 11, baseBps: 400 }, { stat: 17, baseBps: 1000 }],
  },
  {
    templateId: 200,
    name: 'Theophilos the Builder',
    heroType: 2, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 6, // Kaelindra
    buffs: [{ stat: 12, baseBps: 1000 }, { stat: 3, baseBps: 800 }, { stat: 9, baseBps: 600 }],
  },
];

// Epic Heroes (1.0 SOL, 1k supply, level 15)

const EPIC_HEROES: HeroTemplateData[] = [
  {
    templateId: 14,
    name: 'Genghis Khan',
    heroType: 0, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 12, // Drenmire
    buffs: [{ stat: 1, baseBps: 1800 }, { stat: 14, baseBps: 1200 }, { stat: 6, baseBps: 800 }, { stat: 15, baseBps: 500 }],
  },
  {
    templateId: 17,
    name: 'Napoleon Bonaparte',
    heroType: 0, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 1, // Coranthas
    buffs: [{ stat: 1, baseBps: 1500 }, { stat: 7, baseBps: 1000 }, { stat: 6, baseBps: 700 }, { stat: 4, baseBps: 400 }],
  },
  {
    templateId: 18,
    name: 'Hannibal Barca',
    heroType: 0, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 7, // Auren Khet (North Africa proxy for Carthage)
    buffs: [{ stat: 1, baseBps: 1400 }, { stat: 14, baseBps: 1000 }, { stat: 7, baseBps: 800 }],
  },
  {
    templateId: 50,
    name: 'Zeus',
    heroType: 3, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 3, // Kael Mora
    buffs: [{ stat: 1, baseBps: 1500 }, { stat: 2, baseBps: 1500 }, { stat: 7, baseBps: 1000 }, { stat: 15, baseBps: 500 }],
  },
  {
    templateId: 51,
    name: 'Athena',
    heroType: 1, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 3, // Kael Mora
    buffs: [{ stat: 2, baseBps: 1800 }, { stat: 7, baseBps: 800 }, { stat: 4, baseBps: 600 }],
  },
  {
    templateId: 52,
    name: 'Ares',
    heroType: 0, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 3, // Kael Mora
    buffs: [{ stat: 1, baseBps: 2000 }, { stat: 14, baseBps: 1200 }, { stat: 10, baseBps: 800 }],
  },
  {
    templateId: 54,
    name: 'Thor',
    heroType: 0, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 1, baseBps: 1800 }, { stat: 7, baseBps: 1200 }, { stat: 11, baseBps: 600 }],
  },
  {
    templateId: 55,
    name: 'Ra',
    heroType: 2, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 7, // Auren Khet
    buffs: [{ stat: 3, baseBps: 1500 }, { stat: 12, baseBps: 1000 }, { stat: 4, baseBps: 700 }],
  },
  {
    templateId: 71,
    name: 'Miyamoto Musashi',
    heroType: 0, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 11, // Shirevane
    buffs: [{ stat: 1, baseBps: 1600 }, { stat: 7, baseBps: 1200 }, { stat: 10, baseBps: 800 }],
  },
  {
    templateId: 77,
    name: 'Beowulf',
    heroType: 0, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 1, baseBps: 1700 }, { stat: 14, baseBps: 1200 }, { stat: 2, baseBps: 600 }],
  },
  {
    templateId: 80,
    name: 'Scheherazade',
    heroType: 2, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 9, // Korthain
    buffs: [{ stat: 4, baseBps: 1500 }, { stat: 3, baseBps: 1000 }, { stat: 8, baseBps: 600 }],
  },
  {
    templateId: 153,
    name: 'Bored Ape',
    heroType: 2, category: 2,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 0, // anywhere
    buffs: [{ stat: 3, baseBps: 1500 }, { stat: 15, baseBps: 1000 }, { stat: 8, baseBps: 700 }, { stat: 17, baseBps: 1200 }],
  },
  {
    templateId: 201,
    name: 'Kassandra the Oracle',
    heroType: 3, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 3, // Kael Mora
    buffs: [{ stat: 7, baseBps: 1400 }, { stat: 2, baseBps: 1000 }, { stat: 4, baseBps: 800 }, { stat: 15, baseBps: 600 }],
  },
  {
    templateId: 202,
    name: 'Nikephoros Ironside',
    heroType: 1, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 6, // Kaelindra
    buffs: [{ stat: 2, baseBps: 2000 }, { stat: 16, baseBps: 1200 }, { stat: 8, baseBps: 600 }],
  },
];

// Legendary Heroes (5.0 SOL, 100 supply, level 30)

const LEGENDARY_HEROES: HeroTemplateData[] = [
  {
    templateId: 53,
    name: 'Odin',
    heroType: 3, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 5.0),
    supplyCap: 100, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 30, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 1, baseBps: 2000 }, { stat: 2, baseBps: 1500 }, { stat: 4, baseBps: 1200 }, { stat: 7, baseBps: 800 }],
  },
  {
    templateId: 70,
    name: 'Sun Wukong',
    heroType: 0, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 5.0),
    supplyCap: 100, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 30, meditationCityId: 12, // Drenmire
    buffs: [{ stat: 1, baseBps: 2200 }, { stat: 7, baseBps: 1500 }, { stat: 11, baseBps: 1000 }, { stat: 14, baseBps: 800 }],
  },
  {
    templateId: 73,
    name: 'Merlin',
    heroType: 3, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 5.0),
    supplyCap: 100, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 30, meditationCityId: 0, // Valdenmoor
    buffs: [{ stat: 4, baseBps: 1500 }, { stat: 7, baseBps: 1200 }, { stat: 2, baseBps: 1000 }, { stat: 3, baseBps: 800 }],
  },
  {
    templateId: 230,
    name: 'Marcus Aurelius Maximus',
    heroType: 3, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 5.0),
    supplyCap: 100, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 30, meditationCityId: 2, // Solterrae
    buffs: [{ stat: 1, baseBps: 1800 }, { stat: 2, baseBps: 1500 }, { stat: 4, baseBps: 1200 }, { stat: 5, baseBps: 800 }],
  },
  {
    templateId: 250,
    name: 'Khalid the Warrior',
    heroType: 0, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 5.0),
    supplyCap: 100, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 30, meditationCityId: 8, // Solvaran
    buffs: [{ stat: 1, baseBps: 2200 }, { stat: 6, baseBps: 1500 }, { stat: 14, baseBps: 1000 }, { stat: 11, baseBps: 600 }],
  },
  {
    templateId: 271,
    name: 'Boris the Mountain',
    heroType: 1, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 5.0),
    supplyCap: 100, enabled: true, eventExclusive: false,
    requiredPlayerLevel: 30, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 2, baseBps: 2500 }, { stat: 16, baseBps: 1500 }, { stat: 13, baseBps: 1000 }, { stat: 11, baseBps: 600 }],
  },
];

// Mythic Heroes (10.0+ SOL, 50 supply, level 50, event-exclusive)

const MYTHIC_HEROES: HeroTemplateData[] = [
  {
    templateId: 150,
    name: 'Satoshi Nakamoto',
    heroType: 2, category: 2,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 2.1),
    supplyCap: 21, enabled: true, eventExclusive: true,
    requiredPlayerLevel: 50, meditationCityId: 0, // anywhere
    buffs: [{ stat: 3, baseBps: 3000 }, { stat: 15, baseBps: 2100 }, { stat: 9, baseBps: 1500 }, { stat: 17, baseBps: 2100 }],
  },
  {
    templateId: 160,
    name: 'Gilgamesh',
    heroType: 3, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 10.0),
    supplyCap: 50, enabled: true, eventExclusive: true,
    requiredPlayerLevel: 50, meditationCityId: 9, // Korthain
    buffs: [{ stat: 1, baseBps: 2500 }, { stat: 2, baseBps: 2000 }, { stat: 14, baseBps: 1500 }, { stat: 11, baseBps: 1000 }],
  },
  {
    templateId: 161,
    name: 'Amaterasu',
    heroType: 3, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 10.0),
    supplyCap: 50, enabled: true, eventExclusive: true,
    requiredPlayerLevel: 50, meditationCityId: 11, // Shirevane
    buffs: [{ stat: 3, baseBps: 2500 }, { stat: 2, baseBps: 2000 }, { stat: 4, baseBps: 1500 }, { stat: 12, baseBps: 1000 }],
  },
  {
    templateId: 162,
    name: 'Quetzalcoatl',
    heroType: 0, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 10.0),
    supplyCap: 50, enabled: true, eventExclusive: true,
    requiredPlayerLevel: 50, meditationCityId: 19, // Tonalca
    buffs: [{ stat: 1, baseBps: 2800 }, { stat: 7, baseBps: 1800 }, { stat: 6, baseBps: 1200 }, { stat: 15, baseBps: 800 }],
  },
  {
    templateId: 163,
    name: 'Prometheus',
    heroType: 2, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 10.0),
    supplyCap: 50, enabled: true, eventExclusive: true,
    requiredPlayerLevel: 50, meditationCityId: 3, // Kael Mora
    buffs: [{ stat: 4, baseBps: 3000 }, { stat: 5, baseBps: 2000 }, { stat: 3, baseBps: 1500 }, { stat: 2, baseBps: 1000 }],
  },
  {
    templateId: 252,
    name: 'Omar the Orator',
    heroType: 3, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 10.0),
    supplyCap: 50, enabled: true, eventExclusive: true,
    requiredPlayerLevel: 50, meditationCityId: 9, // Korthain
    buffs: [{ stat: 8, baseBps: 2500 }, { stat: 6, baseBps: 1800 }, { stat: 4, baseBps: 1500 }, { stat: 3, baseBps: 1000 }],
  },
];

// Active export — seeded by cli/lib/phases/heroes.ts
export const HERO_TEMPLATES: HeroTemplateData[] = [
  ...COMMON_HEROES,
  ...RARE_HEROES,
  ...EPIC_HEROES,
  ...LEGENDARY_HEROES,
  ...MYTHIC_HEROES,
];

// RESERVE ROSTER — designed, not seeded
//
// Move entries from these arrays into the active arrays (and re-export)
// to activate a hero. templateIds are stable so PDA derivation does not
// shift when a reserve is activated. When buff math or city ids change,
// update these alongside the active roster.

const RESERVE_RARE: HeroTemplateData[] = [
  {
    templateId: 19,
    name: 'William Wallace',
    heroType: 1, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 0, // Valdenmoor
    buffs: [{ stat: 2, baseBps: 1100 }, { stat: 8, baseBps: 700 }, { stat: 11, baseBps: 400 }],
  },
  {
    templateId: 76,
    name: 'Gawain',
    heroType: 1, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 0, // Valdenmoor
    buffs: [{ stat: 2, baseBps: 1000 }, { stat: 11, baseBps: 600 }, { stat: 8, baseBps: 400 }],
  },
  {
    templateId: 78,
    name: 'El Cid',
    heroType: 3, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 2, // Solterrae (Iberian proxy)
    buffs: [{ stat: 1, baseBps: 800 }, { stat: 2, baseBps: 700 }, { stat: 6, baseBps: 500 }],
  },
  {
    templateId: 84,
    name: 'Vasilisa the Wise',
    heroType: 2, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 3, baseBps: 1000 }, { stat: 4, baseBps: 700 }, { stat: 5, baseBps: 400 }],
  },
  {
    templateId: 90,
    name: 'Ali Baba',
    heroType: 2, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 9, // Korthain
    buffs: [{ stat: 15, baseBps: 1200 }, { stat: 9, baseBps: 600 }, { stat: 3, baseBps: 400 }],
  },
  {
    templateId: 92,
    name: 'Shirin',
    heroType: 3, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 9, // Korthain
    buffs: [{ stat: 2, baseBps: 800 }, { stat: 12, baseBps: 600 }, { stat: 4, baseBps: 500 }],
  },
  {
    templateId: 152,
    name: 'Degen',
    heroType: 2, category: 2,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 0, // anywhere
    buffs: [{ stat: 15, baseBps: 1000 }, { stat: 3, baseBps: 700 }, { stat: 4, baseBps: 500 }, { stat: 17, baseBps: 800 }],
  },
  {
    templateId: 154,
    name: 'Wojak',
    heroType: 1, category: 2,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 0, // anywhere
    buffs: [{ stat: 2, baseBps: 1000 }, { stat: 11, baseBps: 700 }, { stat: 8, baseBps: 500 }, { stat: 17, baseBps: 600 }],
  },
  {
    templateId: 212,
    name: 'Ragnar Bloodaxe',
    heroType: 0, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 1, baseBps: 1000 }, { stat: 15, baseBps: 800 }, { stat: 14, baseBps: 500 }],
  },
  {
    templateId: 261,
    name: 'Layla Goldweaver',
    heroType: 2, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 0.25),
    supplyCap: 2_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 5, meditationCityId: 7, // Auren Khet
    buffs: [{ stat: 3, baseBps: 1100 }, { stat: 12, baseBps: 700 }, { stat: 9, baseBps: 400 }],
  },
];

const RESERVE_EPIC: HeroTemplateData[] = [
  {
    templateId: 20,
    name: 'Heraclius',
    heroType: 0, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 6, // Kaelindra
    buffs: [{ stat: 1, baseBps: 1600 }, { stat: 2, baseBps: 1000 }, { stat: 6, baseBps: 600 }],
  },
  {
    templateId: 21,
    name: 'Attila the Hun',
    heroType: 0, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 1, baseBps: 1800 }, { stat: 14, baseBps: 1000 }, { stat: 15, baseBps: 600 }],
  },
  {
    templateId: 56,
    name: 'Anubis',
    heroType: 1, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 7, // Auren Khet
    buffs: [{ stat: 2, baseBps: 1600 }, { stat: 15, baseBps: 800 }, { stat: 16, baseBps: 600 }],
  },
  {
    templateId: 57,
    name: 'Poseidon',
    heroType: 3, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 3, // Kael Mora
    buffs: [{ stat: 1, baseBps: 1400 }, { stat: 2, baseBps: 1200 }, { stat: 9, baseBps: 800 }, { stat: 18, baseBps: 600 }],
  },
  {
    templateId: 74,
    name: 'Nimue',
    heroType: 1, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 0, // Valdenmoor
    buffs: [{ stat: 2, baseBps: 1400 }, { stat: 9, baseBps: 1000 }, { stat: 4, baseBps: 600 }],
  },
  {
    templateId: 75,
    name: 'Mordred',
    heroType: 0, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 0, // Valdenmoor
    buffs: [{ stat: 1, baseBps: 1600 }, { stat: 7, baseBps: 1200 }, { stat: 14, baseBps: 600 }],
  },
  {
    templateId: 81,
    name: 'Baba Yaga',
    heroType: 1, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 2, baseBps: 1600 }, { stat: 7, baseBps: 1000 }, { stat: 14, baseBps: 600 }],
  },
  {
    templateId: 83,
    name: 'Ilya Muromets',
    heroType: 1, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 2, baseBps: 1800 }, { stat: 11, baseBps: 1000 }, { stat: 13, baseBps: 600 }],
  },
  {
    templateId: 85,
    name: 'Dobrynya Nikitich',
    heroType: 3, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 1, baseBps: 1400 }, { stat: 2, baseBps: 1000 }, { stat: 14, baseBps: 800 }],
  },
  {
    templateId: 87,
    name: 'Zhuge Liang',
    heroType: 2, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 12, // Drenmire
    buffs: [{ stat: 4, baseBps: 1500 }, { stat: 7, baseBps: 1000 }, { stat: 5, baseBps: 700 }],
  },
  {
    templateId: 88,
    name: 'Tomoe Gozen',
    heroType: 1, category: 0,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 11, // Shirevane
    buffs: [{ stat: 2, baseBps: 1400 }, { stat: 1, baseBps: 1000 }, { stat: 16, baseBps: 600 }],
  },
  {
    templateId: 91,
    name: 'Rostam',
    heroType: 0, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 9, // Korthain
    buffs: [{ stat: 1, baseBps: 1700 }, { stat: 14, baseBps: 1100 }, { stat: 11, baseBps: 600 }],
  },
  {
    templateId: 203,
    name: 'Alexios Shadowblade',
    heroType: 0, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 6, // Kaelindra
    buffs: [{ stat: 1, baseBps: 1600 }, { stat: 7, baseBps: 1400 }, { stat: 14, baseBps: 800 }],
  },
  {
    templateId: 210,
    name: 'Bjorn Ironforge',
    heroType: 1, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 2, baseBps: 1800 }, { stat: 16, baseBps: 1000 }, { stat: 8, baseBps: 600 }],
  },
  {
    templateId: 211,
    name: 'Astrid Stormcaller',
    heroType: 0, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 1, baseBps: 1600 }, { stat: 2, baseBps: 800 }, { stat: 11, baseBps: 600 }, { stat: 7, baseBps: 500 }],
  },
  {
    templateId: 220,
    name: 'Maeve of Ulster',
    heroType: 3, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 0, // Valdenmoor
    buffs: [{ stat: 1, baseBps: 1400 }, { stat: 6, baseBps: 1000 }, { stat: 2, baseBps: 700 }],
  },
  {
    templateId: 240,
    name: 'Akira Steelblossom',
    heroType: 0, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 11, // Shirevane
    buffs: [{ stat: 1, baseBps: 1600 }, { stat: 7, baseBps: 1200 }, { stat: 10, baseBps: 800 }],
  },
  {
    templateId: 251,
    name: 'Rashid the Defender',
    heroType: 1, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 9, // Korthain
    buffs: [{ stat: 2, baseBps: 1800 }, { stat: 16, baseBps: 1200 }, { stat: 8, baseBps: 600 }],
  },
  {
    templateId: 260,
    name: 'Zara Moonblade',
    heroType: 0, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 7, // Auren Khet
    buffs: [{ stat: 1, baseBps: 1500 }, { stat: 7, baseBps: 1200 }, { stat: 14, baseBps: 800 }],
  },
  {
    templateId: 270,
    name: 'Vladimir Ironheart',
    heroType: 1, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 2, baseBps: 1700 }, { stat: 11, baseBps: 1000 }, { stat: 16, baseBps: 700 }],
  },
  {
    templateId: 280,
    name: 'Durin Ironpick',
    heroType: 2, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 22, // Grimhollow (highland mining)
    buffs: [{ stat: 17, baseBps: 2000 }, { stat: 9, baseBps: 1200 }, { stat: 2, baseBps: 800 }, { stat: 11, baseBps: 500 }],
  },
  {
    templateId: 281,
    name: 'Kai Tidecaller',
    heroType: 2, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 13, // Pelagora (port city)
    buffs: [{ stat: 18, baseBps: 2000 }, { stat: 12, baseBps: 1000 }, { stat: 9, baseBps: 600 }, { stat: 11, baseBps: 400 }],
  },
  {
    templateId: 290,
    name: 'Hana Luckbringer',
    heroType: 2, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 1.0),
    supplyCap: 1_000, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 15, meditationCityId: 11, // Shirevane
    buffs: [{ stat: 10, baseBps: 2000 }, { stat: 14, baseBps: 800 }, { stat: 8, baseBps: 600 }],
  },
];

const RESERVE_LEGENDARY: HeroTemplateData[] = [
  {
    templateId: 82,
    name: 'Koschei the Deathless',
    heroType: 0, category: 1,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 5.0),
    supplyCap: 100, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 30, meditationCityId: 5, // Vraenholdt
    buffs: [{ stat: 1, baseBps: 2000 }, { stat: 2, baseBps: 1500 }, { stat: 7, baseBps: 1000 }, { stat: 14, baseBps: 600 }],
  },
  {
    templateId: 204,
    name: 'Chrysanthos the Golden',
    heroType: 2, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 5.0),
    supplyCap: 100, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 30, meditationCityId: 6, // Kaelindra
    buffs: [{ stat: 3, baseBps: 2200 }, { stat: 12, baseBps: 1500 }, { stat: 9, baseBps: 1000 }, { stat: 15, baseBps: 600 }],
  },
  {
    templateId: 241,
    name: 'Li Wei the Prosperous',
    heroType: 2, category: 4,
    mintCostLamports: Math.floor(LAMPORTS_PER_SOL * 5.0),
    supplyCap: 100, enabled: false, eventExclusive: false,
    requiredPlayerLevel: 30, meditationCityId: 12, // Drenmire
    buffs: [{ stat: 3, baseBps: 2000 }, { stat: 12, baseBps: 1400 }, { stat: 9, baseBps: 1000 }, { stat: 15, baseBps: 600 }],
  },
];

// Reserve export — NOT seeded automatically. Activate by moving entries
// into HERO_TEMPLATES.
export const RESERVE_HEROES: HeroTemplateData[] = [
  ...RESERVE_RARE,
  ...RESERVE_EPIC,
  ...RESERVE_LEGENDARY,
];
