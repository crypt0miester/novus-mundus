/**
 * Starter Event Data
 */

export interface EventData {
  eventId: number;
  name: string;
  eventType: number;
  durationDays: number;
  minLevel: number;
  minReputation: number;
  requiredSubscriptionTier: number;
  prizeType: number;   // 0=LockedNovi, 1=Gems, 2=Cash, 3=SPLToken
  prizeAmount: number;
  autoActivate: boolean;
}

export const EVENTS: EventData[] = [
  {
    eventId: 1,
    name: 'Launch Tournament',
    eventType: 0,
    durationDays: 7,
    minLevel: 1,
    minReputation: 0,
    requiredSubscriptionTier: 0,
    prizeType: 0,
    prizeAmount: 1_000_000,
    autoActivate: true,
  },
  {
    eventId: 2,
    name: 'Weekly PvP',
    eventType: 1,
    durationDays: 7,
    minLevel: 10,
    minReputation: 0,
    requiredSubscriptionTier: 0,
    prizeType: 1,
    prizeAmount: 10_000,
    autoActivate: true,
  },
  {
    eventId: 3,
    name: 'Newcomer Challenge',
    eventType: 2,
    durationDays: 14,
    minLevel: 1,
    minReputation: 0,
    requiredSubscriptionTier: 0,
    prizeType: 2,
    prizeAmount: 50_000,
    autoActivate: true,
  },
];
