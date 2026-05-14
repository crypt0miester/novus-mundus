# Error Codes

> Complete reference of GameError variants and their meanings.

## Error Code Ranges

| Range | Category | Description |
|-------|----------|-------------|
| 7000-7099 | General | Common errors |
| 7100-7199 | Authorization | Permission errors |
| 7200-7299 | Validation | Input validation |
| 7300-7399 | State | Account state errors |
| 7400-7499 | Economy | Resource errors |
| 7500-7599 | Combat | Battle errors |
| 7600-7699 | Travel | Movement errors |
| 7700-7799 | Building | Estate errors |
| 7800-7899 | Research | Tech tree errors |
| 7900-7999 | Hero | NFT hero errors |

[Source: error.rs](../../../programs/novus_mundus/src/error.rs)

---

## General Errors (7000-7099)

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7000 | `InvalidParameter` | Generic invalid input | Check instruction data format |
| 7001 | `MathOverflow` | Arithmetic overflow | Reduce amounts |
| 7002 | `InvalidPDA` | PDA derivation mismatch | Verify seeds |
| 7003 | `InvalidOwner` | Account owner incorrect | Check account ownership |
| 7004 | `InvalidProgram` | Wrong program ID | Use correct program |
| 7005 | `AccountNotInitialized` | Account doesn't exist | Initialize first |
| 7006 | `AccountAlreadyInitialized` | Account exists | Skip initialization |
| 7007 | `InvalidAccountData` | Malformed data | Check account structure |
| 7008 | `InvalidInstruction` | Unknown instruction | Check discriminant |
| 7009 | `DataTooLarge` | Input exceeds limit | Reduce data size |

---

## Authorization Errors (7100-7199)

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7100 | `Unauthorized` | Not authorized for action | Check signer |
| 7101 | `NotOwner` | Not account owner | Use owner wallet |
| 7102 | `NotAdmin` | Admin required | Contact admin |
| 7103 | `NotTeamLeader` | Team leader required | Transfer leadership |
| 7104 | `NotTeamMember` | Must be team member | Join team first |
| 7105 | `SignerMismatch` | Wrong signer | Check transaction signer |
| 7106 | `ExtensionNotUnlocked` | Feature locked | Complete prerequisites |

---

## Validation Errors (7200-7299)

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7200 | `InvalidAmount` | Amount out of range | Use valid amount |
| 7201 | `InvalidTier` | Tier doesn't exist | Use valid tier (0-4) |
| 7202 | `InvalidSlot` | Slot out of range | Use valid slot index |
| 7203 | `InvalidCity` | City doesn't exist | Use valid city ID |
| 7204 | `InvalidLocation` | Coordinates invalid | Check lat/long |
| 7205 | `InvalidDuration` | Time out of range | Use valid duration |
| 7206 | `InvalidName` | Name validation failed | Check name rules |
| 7207 | `InvalidUnit` | Unit type invalid | Use valid unit type |
| 7208 | `InvalidResource` | Resource type invalid | Use valid resource |
| 7209 | `InvalidEquipment` | Equipment type invalid | Use valid equipment |

---

## State Errors (7300-7399)

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7300 | `AlreadyInProgress` | Action already running | Wait or cancel |
| 7301 | `NotInProgress` | No active action | Start action first |
| 7302 | `AlreadyComplete` | Already finished | Claim results |
| 7303 | `NotComplete` | Not finished yet | Wait for completion |
| 7304 | `Expired` | Time limit exceeded | Start new action |
| 7305 | `OnCooldown` | Must wait before retry | Wait for cooldown |
| 7306 | `SlotOccupied` | Slot already used | Use different slot |
| 7307 | `SlotEmpty` | No item in slot | Select occupied slot |
| 7308 | `MaxCapacity` | Capacity limit reached | Upgrade or clear |
| 7309 | `AlreadyClaimed` | Already claimed today | Wait until tomorrow |

---

## Economy Errors (7400-7499)

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7400 | `InsufficientBalance` | Not enough generic balance | Earn or deposit |
| 7401 | `InsufficientLockedNovi` | Not enough locked NOVI | Deposit NOVI |
| 7402 | `InsufficientReservedNovi` | Not enough reserved NOVI | Convert from locked |
| 7403 | `InsufficientCash` | Not enough cash | Collect resources |
| 7404 | `InsufficientFragments` | Not enough fragments | Do expeditions |
| 7405 | `InsufficientProduce` | Not enough produce | Go fishing |
| 7406 | `InsufficientUnits` | Not enough units | Hire units |
| 7407 | `InsufficientOperatives` | Not enough operatives | Hire operatives |
| 7408 | `InsufficientWeapons` | Not enough weapons | Purchase equipment |
| 7409 | `TransferFailed` | Token transfer failed | Check token accounts |
| 7500 | `InsufficientGems` | Not enough gems | Earn or purchase gems |

---

## Combat Errors (7500-7599)

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7501 | `TargetNotFound` | Combat target missing | Select valid target |
| 7502 | `TargetOutOfRange` | Target too far | Move closer |
| 7503 | `AlreadyDefeated` | Encounter dead | Find new encounter |
| 7504 | `CombatCooldown` | Attack on cooldown | Wait 1 hour |
| 7505 | `NoUnitsAvailable` | No combat units | Hire units |
| 7506 | `SelfAttack` | Cannot attack self | Select different target |
| 7507 | `TeamAttack` | Cannot attack teammate | Select enemy target |

---

## Travel Errors (7600-7699)

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7600 | `PlayerTraveling` | Already in transit | Complete travel first |
| 7601 | `PlayerNotTraveling` | Not currently traveling | Start travel |
| 7602 | `InvalidDestination` | Destination invalid | Choose valid city |
| 7603 | `AlreadyAtDestination` | Already there | No travel needed |
| 7604 | `TravelNotComplete` | Still in transit | Wait or speedup |
| 7605 | `LocationOccupied` | Grid cell occupied | Choose different spot |
| 7606 | `NotAtLocation` | Not at required location | Travel there first |

---

## Building Errors (7700-7799)

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7700 | `BuildingNotFound` | Building doesn't exist | Build it first |
| 7701 | `BuildingLevelTooLow` | Building level insufficient | Upgrade building |
| 7702 | `BuildingMaxLevel` | Already at max level | Cannot upgrade further |
| 7703 | `PlotNotAvailable` | No empty plot | Buy more plots |
| 7704 | `BuildingInProgress` | Construction ongoing | Wait or complete |
| 7705 | `BuildingNotReady` | Not ready to complete | Wait for timer |
| 7706 | `InvalidBuildingType` | Building type unknown | Use valid type |
| 7707 | `MansionRequired` | Must build Mansion first | Build Mansion |
| 7708 | `WorkshopLevelTooLow` | Workshop level insufficient | Upgrade Workshop |
| 7709 | `DockRequired` | Dock building needed | Build Dock |

---

## Research Errors (7800-7899)

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7800 | `ResearchInProgress` | Already researching | Complete current |
| 7801 | `ResearchNotStarted` | No active research | Start research |
| 7802 | `ResearchNotComplete` | Research still running | Wait or speedup |
| 7803 | `ResearchAlreadyDone` | Already researched | Choose different |
| 7804 | `ResearchLocked` | Prerequisites missing | Complete prereqs |
| 7805 | `InvalidResearchCategory` | Category invalid | Use valid category |
| 7806 | `AcademyRequired` | Academy building needed | Build Academy |
| 7807 | `MiningNotUnlocked` | Mining research needed | Complete research |
| 7808 | `FishingNotUnlocked` | Fishing research needed | Complete research |

---

## Hero Errors (7900-7999)

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7900 | `HeroNotFound` | Hero NFT missing | Check NFT ownership |
| 7901 | `HeroAlreadyLocked` | Hero already active | Unlock first |
| 7902 | `HeroNotLocked` | Hero not active | Lock hero first |
| 7903 | `MaxHeroesLocked` | Hero slots full | Unlock a hero |
| 7904 | `HeroSlotEmpty` | No hero in slot | Select occupied slot |
| 7905 | `InvalidHeroTemplate` | Template doesn't exist | Use valid template |
| 7906 | `HeroOnCooldown` | Hero action cooldown | Wait for cooldown |
| 7907 | `MeditationChamberRequired` | MeditationChamber building needed | Build MeditationChamber |
| 7908 | `HeroMeditating` | Hero in meditation | Claim meditation first |
| 7909 | `HeroOnExpedition` | Hero on expedition | Complete expedition first |

---

## Expedition Errors

| Code | Name | Description | Recovery |
|------|------|-------------|----------|
| 7810 | `ExpeditionInProgress` | Expedition already active | Complete or abort |
| 7811 | `NoExpeditionInProgress` | No active expedition | Start expedition |
| 7812 | `ExpeditionNotComplete` | Still in progress | Wait or speedup |
| 7813 | `ExpeditionAlreadyComplete` | Already completed | Claim rewards |
| 7814 | `InvalidExpeditionType` | Type must be 1 or 2 | Use Mining or Fishing |
| 7815 | `InvalidExpeditionTier` | Tier must be 0-4 | Use valid tier |
| 7816 | `StrikeNotReady` | Strike not available yet | Wait for window |
| 7817 | `MaxStrikesReached` | No more strikes allowed | Wait for claim |

---

## Client Error Handling

### Parsing Error Codes

```javascript
function parseGameError(error) {
  // Extract error code from transaction error
  const match = error.message.match(/custom program error: 0x([0-9a-f]+)/i);
  if (!match) return null;

  const code = parseInt(match[1], 16);
  return {
    code,
    name: ERROR_NAMES[code] || 'Unknown',
    message: ERROR_MESSAGES[code] || 'An unknown error occurred'
  };
}
```

### User-Friendly Messages

```javascript
const ERROR_MESSAGES = {
  7401: "You don't have enough locked NOVI. Deposit more NOVI first.",
  7406: "You don't have enough units. Visit the Barracks to hire more.",
  7503: "This enemy has already been defeated. Find a new target.",
  7701: "Your building level is too low. Upgrade to unlock this feature.",
  // ...
};
```

---

*Error codes are your debugging compass. Learn them, and you'll navigate any issue.*

---

Next: [Constants](./constants.md)
