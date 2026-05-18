/**
 * Castle Data — one per city (24 total)
 */

export interface CastleData {
  castleId: number;
  cityId: number;
  name: string;
  tier: number;         // 0=Outpost, 1=Keep, 2=Stronghold, 3=Fortress, 4=Citadel
  minLevel: number;
  minNetworthMillions: number;
  minTroopsThousands: number;
  latitude: number;
  longitude: number;
}

export const CASTLES: CastleData[] = [
  { castleId: 0,  cityId: 1,  name: 'Tower of London',     tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 515085, longitude: -757 },
  { castleId: 1,  cityId: 2,  name: 'Bastille Fortress',   tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 488566, longitude: 23522 },
  { castleId: 2,  cityId: 3,  name: 'Castel Sant Angelo',  tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 419028, longitude: 124964 },
  { castleId: 3,  cityId: 4,  name: 'Acropolis Citadel',   tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 379838, longitude: 232750 },
  { castleId: 4,  cityId: 5,  name: 'Brandenburg Gate',    tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: 525200, longitude: 134050 },
  { castleId: 5,  cityId: 6,  name: 'Kremlin Fortress',    tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 557558, longitude: 376173 },
  { castleId: 6,  cityId: 7,  name: 'Topkapi Palace',      tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 410082, longitude: 289784 },
  { castleId: 7,  cityId: 8,  name: 'Cairo Citadel',       tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 300444, longitude: 312357 },
  { castleId: 8,  cityId: 9,  name: 'Edo Castle',          tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 356762, longitude: 1396503 },
  { castleId: 9,  cityId: 10, name: 'Forbidden City',      tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 399042, longitude: 1164074 },
  { castleId: 10, cityId: 11, name: 'Shanghai Keep',       tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: 312304, longitude: 1214737 },
  { castleId: 11, cityId: 12, name: 'Gyeongbok Palace',    tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: 375665, longitude: 1269780 },
  { castleId: 12, cityId: 13, name: 'Mumbai Fort',         tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: 190760, longitude: 728777 },
  { castleId: 13, cityId: 14, name: 'Sydney Stronghold',   tier: 1, minLevel: 15, minNetworthMillions: 10, minTroopsThousands: 3,  latitude: -338688, longitude: 1512093 },
  { castleId: 14, cityId: 15, name: 'Dubai Citadel',       tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 252048, longitude: 552708 },
  { castleId: 15, cityId: 16, name: 'Baghdad Palace',      tier: 3, minLevel: 25, minNetworthMillions: 30, minTroopsThousands: 8,  latitude: 333152, longitude: 443661 },
  { castleId: 16, cityId: 17, name: 'Liberty Fortress',    tier: 4, minLevel: 30, minNetworthMillions: 50, minTroopsThousands: 10, latitude: 407128, longitude: -740060 },
  { castleId: 17, cityId: 18, name: 'Aztec Stronghold',    tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: 194326, longitude: -991332 },
  { castleId: 18, cityId: 19, name: 'Bandeirantes Fort',   tier: 2, minLevel: 20, minNetworthMillions: 20, minTroopsThousands: 5,  latitude: -235505, longitude: -466333 },
  { castleId: 19, cityId: 20, name: 'La Plata Keep',       tier: 1, minLevel: 15, minNetworthMillions: 10, minTroopsThousands: 3,  latitude: -346037, longitude: -583816 },
  { castleId: 20, cityId: 21, name: 'Inca Citadel',        tier: 1, minLevel: 15, minNetworthMillions: 10, minTroopsThousands: 3,  latitude: -120464, longitude: -770428 },
  { castleId: 21, cityId: 22, name: 'Lagos Outpost',       tier: 0, minLevel: 10, minNetworthMillions: 5,  minTroopsThousands: 2,  latitude: 65244, longitude: 33792 },
  { castleId: 22, cityId: 23, name: 'Nairobi Outpost',     tier: 0, minLevel: 10, minNetworthMillions: 5,  minTroopsThousands: 2,  latitude: -12921, longitude: 368219 },
];
