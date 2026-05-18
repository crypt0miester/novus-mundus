/**
 * Novus Mundus Error Codes
 *
 * All 466 error codes with human-readable messages.
 */

// Error Code Enum

export enum GameError {
  // General Errors (6000-6012)
  GamePaused = 6000,
  Unauthorized = 6001,
  InvalidTimestamp = 6002,
  MathOverflow = 6003,
  InvalidAccount = 6004,
  DaoRequired = 6005,
  InsufficientBalance = 6006,
  InvalidParameter = 6007,
  ExceedsMaxCap = 6008,
  AccountFrozen = 6009,
  InvalidPDA = 6010,
  MissingRequiredAccount = 6011,
  FeatureLocked = 6012,

  // Player Errors (6100-6126)
  PlayerAlreadyExists = 6100,
  PlayerNotFound = 6101,
  InsufficientLockedNovi = 6102,
  InsufficientCash = 6103,
  InsufficientWeapons = 6104,
  InsufficientProduce = 6105,
  InsufficientVehicles = 6106,
  InsufficientUnits = 6107,
  InsufficientPower = 6108,
  PlayerTraveling = 6109,
  PlayerNotAtLocation = 6110,
  TooManyActiveRallies = 6111,
  RallyCreationLimitReached = 6112,
  PlayerInactive = 6113,
  InsufficientSubscriptionTier = 6114,
  InsufficientLevel = 6115,
  CannotAttackSelf = 6116,
  TargetHasImmunity = 6117,
  TargetIsProtected = 6118,
  NetworthOutOfRange = 6119,
  ClaimCooldownActive = 6120,
  NothingToClaim = 6121,
  AccountTooNew = 6122,
  HappinessTooLow = 6123,
  MaxUnitsReached = 6124,
  InsufficientFragments = 6125,
  MaxPlayersReached = 6126,
  UserAccountNotCreated = 6127,

  // Team Errors (6200-6233)
  TeamNameTaken = 6200,
  TeamNotFound = 6201,
  TeamFull = 6202,
  NotTeamMember = 6203,
  NotTeamLeader = 6204,
  InsufficientTeamPermissions = 6205,
  AlreadyInTeam = 6206,
  NotInTeam = 6207,
  CannotLeaveAsLeader = 6208,
  InviteNotFound = 6209,
  InviteExpired = 6210,
  AlreadyInvited = 6211,
  InviteOnlyTeam = 6212,
  DoesNotMeetTeamRequirements = 6213,
  TeamNameTooLong = 6214,
  InsufficientTeamTreasury = 6215,
  CannotKickLeader = 6216,
  TooManyPendingInvites = 6217,
  NewLeaderNotMember = 6218,
  TeamDisbanded = 6219,
  TeamNotPublic = 6220,
  LevelTooLow = 6221,
  SlotOccupied = 6222,
  NotSlotOwner = 6223,
  TreasuryWithdrawExceedsLimit = 6224,
  TreasuryRequestPending = 6225,
  TreasuryRequestNotFound = 6226,
  TreasuryRequestNotExecutable = 6227,
  TreasuryRequestExpired = 6228,
  CannotPromoteToHigherRank = 6229,
  CannotDemoteHigherRank = 6230,
  AlreadyAtRank = 6231,
  InvalidCooldownHours = 6232,
  TeamHasDomain = 6233,

  // Rally Errors (6300-6321)
  RallyNotFound = 6300,
  RallyNotRecruiting = 6301,
  RecruitingPeriodEnded = 6302,
  RallyFull = 6303,
  AlreadyInRally = 6304,
  NotInRally = 6305,
  ContributionTooLow = 6306,
  RallyNotReadyToExecute = 6307,
  RallyAlreadyExecuted = 6308,
  NotRallyCreator = 6309,
  CannotCancelRally = 6310,
  RallyLootAlreadyClaimed = 6311,
  RallyNotCompleted = 6312,
  RallyFailed = 6313,
  CreatorCannotLeaveRally = 6314,
  ExceedsAvailableResources = 6315,
  ExceedsMaxContribution = 6316,
  NotEnoughParticipants = 6317,
  InvalidRallyTarget = 6318,
  MissingRallyParticipantAccount = 6319,
  InvalidRallyParticipantAccount = 6320,
  InActiveRally = 6321,

  // Location Errors (6400-6415)
  InvalidLatitude = 6400,
  InvalidLongitude = 6401,
  LocationAlreadyClaimed = 6402,
  LocationNotClaimed = 6403,
  NotLocationClaimer = 6404,
  LocationClaimExpired = 6405,
  CustomNameTooLong = 6406,
  TooManyActiveEncounters = 6407,
  TooManyPlayersPresent = 6408,
  TeleportDistanceTooGreat = 6409,
  InsufficientTeleportFunds = 6410,
  OutOfRange = 6411,
  CityEncounterLimitReached = 6412,
  CellOccupied = 6413,
  CellNotOccupied = 6414,
  NotCellOccupant = 6415,

  // City & Travel Errors (6420-6429)
  CityNotFound = 6420,
  PlayersNotInSameCity = 6421,
  InvalidLocationForCity = 6422,
  PlayerNotInCity = 6423,
  TravelNotComplete = 6424,
  NotTraveling = 6425,
  AlreadyTraveling = 6426,
  DestinationOutsideCity = 6427,
  InvalidCityId = 6428,
  WrongCity = 6429,

  // Encounter Errors (6500-6515)
  EncounterNotFound = 6500,
  EncounterDead = 6501,
  EncounterDespawned = 6502,
  EncounterFull = 6503,
  NotEligibleForEncounter = 6504,
  EncounterRequiresSubscription = 6505,
  EncounterInviteOnly = 6506,
  TeamNotInvited = 6507,
  AlreadyAttackedEncounter = 6508,
  EncounterRewardsAlreadyClaimed = 6509,
  NotEncounterAttacker = 6510,
  EncounterLootDepleted = 6511,
  NotSelectedForRandomEncounter = 6512,
  InsufficientStamina = 6513,
  WrongTimeForEncounter = 6514,
  EncounterStillActive = 6515,

  // Event Errors (6600-6612)
  EventNotFound = 6600,
  EventNotStarted = 6601,
  EventEnded = 6602,
  EventCancelled = 6603,
  NotEligibleForEvent = 6604,
  EventPrizeAlreadyClaimed = 6605,
  NotEventWinner = 6606,
  EventNotCompleted = 6607,
  EventNameTooLong = 6608,
  EventDescriptionTooLong = 6609,
  EventRequiresVerification = 6610,
  TransferRatioTooHigh = 6611,
  NotInEvent = 6612,

  // Subscription Errors (6700-6706)
  InvalidSubscriptionTier = 6700,
  InsufficientSubscriptionPayment = 6701,
  CannotDowngradeSubscription = 6702,
  AlreadyAtSubscriptionTier = 6703,
  SubscriptionExpired = 6704,
  VestingPeriodNotComplete = 6705,
  NoReservedNoviToWithdraw = 6706,

  // Minting Errors (6800-6812)
  InvalidMint = 6800,
  MintingDisabled = 6801,
  BurnAmountTooLow = 6802,
  ExceedsMaxMintPerBurn = 6803,
  MintAuthorityMismatch = 6804,
  BurnFailed = 6805,
  MintFailed = 6806,
  InvalidTokenAccount = 6807,
  OracleOverflow = 6808,
  OracleUnavailable = 6809,
  OraclePriceStale = 6810,
  OracleConfidenceTooWide = 6811,
  TokenNotAllowed = 6812,

  // Governance/DAO Errors (6900-6904)
  ProposalNotFound = 6900,
  ProposalNotPassed = 6901,
  ProposalExpired = 6902,
  NotAuthorizedByDao = 6903,
  InvalidGovernanceAccount = 6904,

  // Fibonacci Errors (7000-7001)
  NotFibonacciNumber = 7000,
  FibonacciBonusFailed = 7001,

  // Combat Errors (7100-7104)
  InsufficientAttackPower = 7100,
  InsufficientTargetResources = 7101,
  AttackFailed = 7102,
  DefenseCalculationFailed = 7103,
  DamageCalculationFailed = 7104,

  // Strategic Combat Errors (7110-7117)
  NoDefensiveUnits = 7110,
  FallbackModeActivated = 7111,
  AlreadyDeployingToTarget = 7112,
  NoFreeDeploymentSlot = 7113,
  ExceedsMaxDeployment = 7114,
  DeploymentNotArrived = 7115,
  DeploymentAlreadyCompleted = 7116,
  NotReturningYet = 7117,

  // Reinforcement Errors (7150-7157)
  NotOnSameTeam = 7150,
  MilitaryLogisticsRequired = 7151,
  NoFreeReinforcementSlot = 7152,
  ExceedsMaxSendAmount = 7153,
  ReinforcementNotActive = 7154,
  HeroAlreadyInRally = 7155,
  ReinforcementAlreadyExists = 7156,
  ReceiverCapacityFull = 7157,

  // Rally Strategic Errors (7170-7181)
  RallyNotGathering = 7170,
  RallyNotMarching = 7171,
  RallyNotReturning = 7172,
  ParticipantNotArrived = 7173,
  ParticipantAlreadyArrived = 7174,
  ParticipantNotIncluded = 7175,
  ParticipantAlreadyReturned = 7176,
  LateJoinerCannotJoin = 7177,
  RallyCannotBeClosed = 7178,
  NotRallyParticipant = 7179,
  CannotSpeedupOtherReturn = 7180,
  ReturnNotComplete = 7181,

  // Transfer Errors (7200-7209)
  TransferExceedsMaximum = 7200,
  CannotTransferToSelf = 7201,
  TransferRatioExceedsLimit = 7202,
  TransfersDisabledForTier = 7203,
  DailyTransferLimitExceeded = 7204,
  DailyTransferCountExceeded = 7205,
  NotOnTeam = 7206,
  NotSameTeam = 7207,
  InvalidTeam = 7208,
  InvalidAmount = 7209,

  // Inactive Account Cleanup Errors (7300-7301)
  AccountNotInactive = 7300,
  CannotCleanupActiveAccount = 7301,

  // Encounter Level/Loot Errors (7400-7404)
  EncounterLevelMismatch = 7400,
  EncounterDefenseTooHigh = 7401,
  AlreadyClaimed = 7402,
  LootExpired = 7403,
  NotExpired = 7404,

  // Research Errors (7500-7507)
  ResearchNotFound = 7500,
  ResearchAlreadyActive = 7501,
  ResearchNotActive = 7502,
  ResearchNotComplete = 7503,
  ResearchPrerequisiteNotMet = 7504,
  ResearchMaxLevelReached = 7505,
  ResearchTemplateInactive = 7506,
  InsufficientGems = 7507,

  // Extension Prerequisite Errors (7550-7556)
  ResearchNotUnlocked = 7550,
  HeroesNotUnlocked = 7551,
  InventoryNotUnlocked = 7552,
  RallyNotUnlocked = 7553,
  TeamNotUnlocked = 7554,
  CosmeticsNotUnlocked = 7555,
  ExtensionPrerequisiteNotMet = 7556,

  // Shop Errors (7600-7616)
  InvalidTreasury = 7600,
  ItemNotAvailable = 7601,
  InsufficientStock = 7602,
  PaymentTypeNotSupported = 7603,
  NotOwner = 7604,
  PurchaseLimitReached = 7605,
  DailyLimitReached = 7606,
  InsufficientFunds = 7607,
  BundleNotActive = 7608,
  SaleNotActive = 7609,
  SaleEnded = 7610,
  SaleSoldOut = 7611,
  InventoryFull = 7612,
  MaxSlotsReached = 7613,
  InventoryNeedsExpansion = 7614,
  AccountNotInitialized = 7615,
  AccountAlreadyExists = 7616,

  // Estate System Errors (7700-7734)
  EstateNotFound = 7700,
  EstateAlreadyExists = 7701,
  BuildingRequired = 7702,
  BuildingLevelInsufficient = 7703,
  BuildingNotActive = 7704,
  BuildingSlotFull = 7705,
  BuildingAlreadyExists = 7706,
  BuildingUnderConstruction = 7707,
  ConstructionNotComplete = 7708,
  InsufficientEstatePlots = 7709,
  EstateLevelInsufficient = 7710,
  MansionRequired = 7711,
  BarracksRequired = 7712,
  WorkshopRequired = 7713,
  VaultRequired = 7714,
  DockRequired = 7715,
  ForgeRequired = 7716,
  MarketRequired = 7717,
  AcademyRequired = 7718,
  ArenaRequired = 7719,
  MeditationChamberRequired = 7720,
  ObservatoryRequired = 7721,
  TreasuryRequired = 7722,
  CitadelRequired = 7723,
  MaxHeroesLocked = 7724,
  HeroLevelCapReached = 7725,
  CraftingInProgress = 7726,
  NoCraftingInProgress = 7727,
  CraftNotComplete = 7728,
  MasteryLevelInsufficient = 7729,
  InsufficientMaterials = 7730,
  AlreadyClaimedToday = 7731,
  DailyActivityNotAvailable = 7732,
  DailyWindowExpired = 7733,
  WrongTimeWindow = 7734,
  CampRequired = 7735,
  MineRequired = 7736,
  FarmRequired = 7737,
  TransportBayRequired = 7738,
  InfirmaryRequired = 7739,

  // Staged Tempering Errors (7740-7743)
  StrikeTooEarly = 7740,
  CraftWindowMissed = 7741,
  InvalidQualityTier = 7742,
  InsufficientCraftedItems = 7743,

  // Hero & Meditation Errors (7760-7767)
  HeroAlreadyMeditating = 7760,
  HeroNotMeditating = 7761,
  HeroNotInSlot = 7762,
  HeroMismatch = 7763,
  HeroLocked = 7764,
  HeroAtMeditationCap = 7765,
  WrongCityForMeditation = 7766,
  HeroCollectionExists = 7767,

  // Expedition System Errors (7800-7812)
  ExpeditionInProgress = 7800,
  NoExpeditionInProgress = 7801,
  ExpeditionNotComplete = 7802,
  InvalidExpeditionType = 7803,
  InvalidExpeditionTier = 7804,
  InsufficientOperatives = 7805,
  WorkshopLevelTooLow = 7806,
  PlayerLevelTooLow = 7807,
  ExpeditionStrikeLimitReached = 7808,
  ExpeditionStrikeNotReady = 7809,
  MiningNotUnlocked = 7810,
  FishingNotUnlocked = 7811,
  ExpeditionAlreadyComplete = 7812,

  // Arena PvP System Errors (7900-7930)
  ArenaSeasonNotActive = 7900,
  ArenaSeasonExpired = 7901,
  ArenaSeasonNotFinalized = 7902,
  ArenaCannotChallengeYourself = 7903,
  ArenaNotInSeason = 7904,
  ArenaOpponentNotInSeason = 7905,
  ArenaDailyBattleLimitReached = 7907,
  ArenaOpponentCooldownActive = 7908,
  ArenaHeroAccountRequired = 7909,
  ArenaHeroMismatch = 7910,
  ArenaHeroLocked = 7911,
  ArenaMatchExpired = 7912,
  ArenaMatchTimestampInvalid = 7913,
  ArenaMatchAlreadyUsed = 7914,
  ArenaDailyRewardAlreadyClaimed = 7915,
  ArenaMinBattlesNotMet = 7916,
  ArenaDailyPoolExhausted = 7917,
  ArenaMasterRewardAlreadyClaimed = 7918,
  ArenaNotOnLeaderboard = 7919,
  ArenaClaimDeadlinePassed = 7920,
  ArenaSeasonAlreadyExists = 7921,
  ArenaSeasonNotPending = 7922,
  ArenaLoadoutAlreadyExists = 7923,
  ArenaUnclaimedRedistributionTooEarly = 7927,
  ArenaNoUnclaimedPrizes = 7928,
  ArenaSeasonAlreadyActive = 7929,
  ArenaParticipantAlreadyExists = 7930,

  // Dungeon System Errors (8000-8017)
  DungeonNotActive = 8000,
  DungeonStillActive = 8001,
  DungeonNotFailed = 8002,
  DungeonAlreadyEnded = 8003,
  InvalidRoomType = 8004,
  NotCombatRoom = 8005,
  NotAwaitingRelic = 8006,
  InvalidRelicId = 8007,
  RelicAlreadyOwned = 8008,
  EnemyAlreadyDead = 8009,
  NoCheckpoint = 8010,
  DungeonRunExists = 8011,
  DungeonEntryRequired = 8012,
  InvalidRelicChoice = 8013,
  NotOnLeaderboard = 8014,
  LeaderboardPrizeAlreadyClaimed = 8015,
  LeaderboardWeekNotEnded = 8016,
  DungeonTimeLimitExceeded = 8017,

  // Castle System Errors (8100-8136)
  CastleNotFound = 8100,
  CastleNotVacant = 8101,
  CastleInContest = 8102,
  CastleProtected = 8103,
  CastleTransitioning = 8104,
  CastleNotAttackable = 8105,
  NotKing = 8106,
  NotOnKingsTeam = 8107,
  MaxCastlesReached = 8108,
  KingRegistryNotFound = 8109,
  CastleUpgradeInProgress = 8110,
  CastleNoUpgradeInProgress = 8111,
  CastleUpgradeLevelMax = 8112,
  InvalidUpgradeType = 8113,
  CastleNeedsChambersUpgrade = 8114,
  CourtPositionTaken = 8115,
  CourtPositionVacant = 8116,
  NotCourtMember = 8117,
  AlreadyInCourt = 8118,
  KingCannotHoldCourt = 8119,
  GarrisonFull = 8120,
  AlreadyInGarrison = 8121,
  NotInGarrison = 8122,
  GarrisonNoLoot = 8123,
  GarrisonLootAlreadyClaimed = 8124,
  CastleIneligible = 8125,
  NoRewardsToClaim = 8126,
  CourtAppointmentCooldown = 8127,
  TransitionNotComplete = 8128,
  InvalidCastleTier = 8129,
  CastleTierNoGarrison = 8130,
  CastleTierNoCourt = 8131,
  HeroAlreadyInGarrison = 8132,
  CastleAlreadyExists = 8133,
  InvalidCastleStatus = 8134,
  ContestNotEnded = 8135,
  CastleUpgradeNotReady = 8136,
}

// Human-Readable Error Messages

export const ERROR_MESSAGES: Record<number, string> = {
  // General Errors
  [GameError.GamePaused]: 'Game is currently paused for maintenance',
  [GameError.Unauthorized]: 'You are not authorized to perform this action',
  [GameError.InvalidTimestamp]: 'Invalid timestamp provided',
  [GameError.MathOverflow]: 'Math overflow occurred',
  [GameError.InvalidAccount]: 'Invalid account provided',
  [GameError.DaoRequired]: 'DAO authorization required',
  [GameError.InsufficientBalance]: 'Insufficient balance',
  [GameError.InvalidParameter]: 'Invalid parameter provided',
  [GameError.ExceedsMaxCap]: 'Exceeds maximum capacity',
  [GameError.AccountFrozen]: 'Account is frozen',
  [GameError.InvalidPDA]: 'Invalid PDA address',
  [GameError.MissingRequiredAccount]: 'Missing required account',
  [GameError.FeatureLocked]: 'Feature is locked',

  // Player Errors
  [GameError.PlayerAlreadyExists]: 'Player account already exists',
  [GameError.PlayerNotFound]: 'Player not found',
  [GameError.InsufficientLockedNovi]: 'Insufficient locked NOVI',
  [GameError.InsufficientCash]: 'Insufficient cash',
  [GameError.InsufficientWeapons]: 'Insufficient weapons',
  [GameError.InsufficientProduce]: 'Insufficient produce',
  [GameError.InsufficientVehicles]: 'Insufficient vehicles',
  [GameError.InsufficientUnits]: 'Insufficient units',
  [GameError.InsufficientPower]: 'Insufficient power',
  [GameError.PlayerTraveling]: 'Cannot perform action while traveling',
  [GameError.PlayerNotAtLocation]: 'Player is not at this location',
  [GameError.TooManyActiveRallies]: 'Too many active rallies',
  [GameError.RallyCreationLimitReached]: 'Rally creation limit reached',
  [GameError.PlayerInactive]: 'Player is inactive',
  [GameError.InsufficientSubscriptionTier]: 'Higher subscription tier required',
  [GameError.InsufficientLevel]: 'Insufficient player level',
  [GameError.CannotAttackSelf]: 'Cannot attack yourself',
  [GameError.TargetHasImmunity]: 'Target has attack immunity',
  [GameError.TargetIsProtected]: 'Target has new player protection',
  [GameError.NetworthOutOfRange]: 'Target networth is out of range',
  [GameError.ClaimCooldownActive]: 'Claim cooldown is active',
  [GameError.NothingToClaim]: 'Nothing to claim',
  [GameError.AccountTooNew]: 'Account is too new',
  [GameError.HappinessTooLow]: 'Happiness is too low',
  [GameError.MaxUnitsReached]: 'Maximum units reached',
  [GameError.InsufficientFragments]: 'Insufficient fragments',
  [GameError.MaxPlayersReached]: 'Maximum players reached',
  [GameError.UserAccountNotCreated]: 'Must create user account before player',

  // Team Errors
  [GameError.TeamNameTaken]: 'Team name is already taken',
  [GameError.TeamNotFound]: 'Team not found',
  [GameError.TeamFull]: 'Team is full',
  [GameError.NotTeamMember]: 'You are not a team member',
  [GameError.NotTeamLeader]: 'You are not the team leader',
  [GameError.InsufficientTeamPermissions]: 'Insufficient team permissions',
  [GameError.AlreadyInTeam]: 'You are already in a team',
  [GameError.NotInTeam]: 'You are not in a team',
  [GameError.CannotLeaveAsLeader]: 'Leader cannot leave team',
  [GameError.InviteNotFound]: 'Invite not found',
  [GameError.InviteExpired]: 'Invite has expired',
  [GameError.AlreadyInvited]: 'Already invited',
  [GameError.InviteOnlyTeam]: 'Team is invite-only',
  [GameError.DoesNotMeetTeamRequirements]: 'Does not meet team requirements',
  [GameError.TeamNameTooLong]: 'Team name is too long',
  [GameError.InsufficientTeamTreasury]: 'Insufficient team treasury',
  [GameError.CannotKickLeader]: 'Cannot kick the leader',
  [GameError.TooManyPendingInvites]: 'Too many pending invites',
  [GameError.NewLeaderNotMember]: 'New leader is not a member',
  [GameError.TeamDisbanded]: 'Team has been disbanded',
  [GameError.TeamNotPublic]: 'Team is not public',
  [GameError.LevelTooLow]: 'Level is too low',
  [GameError.SlotOccupied]: 'Slot is occupied',
  [GameError.NotSlotOwner]: 'Not the slot owner',
  [GameError.TreasuryWithdrawExceedsLimit]: 'Treasury withdraw exceeds limit',
  [GameError.TreasuryRequestPending]: 'Treasury request is pending',
  [GameError.TreasuryRequestNotFound]: 'Treasury request not found',
  [GameError.TreasuryRequestNotExecutable]: 'Treasury request not executable',
  [GameError.TreasuryRequestExpired]: 'Treasury request expired',
  [GameError.CannotPromoteToHigherRank]: 'Cannot promote to higher rank',
  [GameError.CannotDemoteHigherRank]: 'Cannot demote higher rank',
  [GameError.AlreadyAtRank]: 'Already at this rank',
  [GameError.InvalidCooldownHours]: 'Invalid cooldown hours',
  [GameError.TeamHasDomain]: 'Team has a domain attached',

  // Rally Errors
  [GameError.RallyNotFound]: 'Rally not found',
  [GameError.RallyNotRecruiting]: 'Rally is not recruiting',
  [GameError.RecruitingPeriodEnded]: 'Recruiting period has ended',
  [GameError.RallyFull]: 'Rally is full',
  [GameError.AlreadyInRally]: 'Already in this rally',
  [GameError.NotInRally]: 'Not in this rally',
  [GameError.ContributionTooLow]: 'Contribution is too low',
  [GameError.RallyNotReadyToExecute]: 'Rally is not ready to execute',
  [GameError.RallyAlreadyExecuted]: 'Rally has already been executed',
  [GameError.NotRallyCreator]: 'Not the rally creator',
  [GameError.CannotCancelRally]: 'Cannot cancel this rally',
  [GameError.RallyLootAlreadyClaimed]: 'Rally loot already claimed',
  [GameError.RallyNotCompleted]: 'Rally is not completed',
  [GameError.RallyFailed]: 'Rally failed',
  [GameError.CreatorCannotLeaveRally]: 'Creator cannot leave rally',
  [GameError.ExceedsAvailableResources]: 'Exceeds available resources',
  [GameError.ExceedsMaxContribution]: 'Exceeds maximum contribution',
  [GameError.NotEnoughParticipants]: 'Not enough participants',
  [GameError.InvalidRallyTarget]: 'Invalid rally target',
  [GameError.MissingRallyParticipantAccount]: 'Missing rally participant account',
  [GameError.InvalidRallyParticipantAccount]: 'Invalid rally participant account',
  [GameError.InActiveRally]: 'In an active rally',

  // Location Errors
  [GameError.InvalidLatitude]: 'Invalid latitude',
  [GameError.InvalidLongitude]: 'Invalid longitude',
  [GameError.LocationAlreadyClaimed]: 'Location already claimed',
  [GameError.LocationNotClaimed]: 'Location not claimed',
  [GameError.NotLocationClaimer]: 'Not the location claimer',
  [GameError.LocationClaimExpired]: 'Location claim expired',
  [GameError.CustomNameTooLong]: 'Custom name is too long',
  [GameError.TooManyActiveEncounters]: 'Too many active encounters',
  [GameError.TooManyPlayersPresent]: 'Too many players present',
  [GameError.TeleportDistanceTooGreat]: 'Teleport distance is too great',
  [GameError.InsufficientTeleportFunds]: 'Insufficient teleport funds',
  [GameError.OutOfRange]: 'Out of range',
  [GameError.CityEncounterLimitReached]: 'City encounter limit reached',
  [GameError.CellOccupied]: 'Cell is occupied',
  [GameError.CellNotOccupied]: 'Cell is not occupied',
  [GameError.NotCellOccupant]: 'Not the cell occupant',

  // City & Travel Errors
  [GameError.CityNotFound]: 'City not found',
  [GameError.PlayersNotInSameCity]: 'Players are not in the same city',
  [GameError.InvalidLocationForCity]: 'Invalid location for city',
  [GameError.PlayerNotInCity]: 'Player is not in a city',
  [GameError.TravelNotComplete]: 'Travel is not complete',
  [GameError.NotTraveling]: 'Not traveling',
  [GameError.AlreadyTraveling]: 'Already traveling',
  [GameError.DestinationOutsideCity]: 'Destination is outside city',
  [GameError.InvalidCityId]: 'Invalid city ID',
  [GameError.WrongCity]: 'Wrong city',

  // Encounter Errors
  [GameError.EncounterNotFound]: 'Encounter not found',
  [GameError.EncounterDead]: 'Encounter is dead',
  [GameError.EncounterDespawned]: 'Encounter has despawned',
  [GameError.EncounterFull]: 'Encounter is full',
  [GameError.NotEligibleForEncounter]: 'Not eligible for encounter',
  [GameError.EncounterRequiresSubscription]: 'Encounter requires subscription',
  [GameError.EncounterInviteOnly]: 'Encounter is invite-only',
  [GameError.TeamNotInvited]: 'Team not invited',
  [GameError.AlreadyAttackedEncounter]: 'Already attacked this encounter',
  [GameError.EncounterRewardsAlreadyClaimed]: 'Encounter rewards already claimed',
  [GameError.NotEncounterAttacker]: 'Not an encounter attacker',
  [GameError.EncounterLootDepleted]: 'Encounter loot depleted',
  [GameError.NotSelectedForRandomEncounter]: 'Not selected for random encounter',
  [GameError.InsufficientStamina]: 'Insufficient stamina',
  [GameError.WrongTimeForEncounter]: 'Wrong time for this encounter',
  [GameError.EncounterStillActive]: 'Encounter cannot be cleaned up yet (still within the despawn grace window)',

  // Event Errors
  [GameError.EventNotFound]: 'Event not found',
  [GameError.EventNotStarted]: 'Event has not started',
  [GameError.EventEnded]: 'Event has ended',
  [GameError.EventCancelled]: 'Event was cancelled',
  [GameError.NotEligibleForEvent]: 'Not eligible for event',
  [GameError.EventPrizeAlreadyClaimed]: 'Event prize already claimed',
  [GameError.NotEventWinner]: 'Not an event winner',
  [GameError.EventNotCompleted]: 'Event not completed',
  [GameError.EventNameTooLong]: 'Event name is too long',
  [GameError.EventDescriptionTooLong]: 'Event description is too long',
  [GameError.EventRequiresVerification]: 'Event requires verification',
  [GameError.TransferRatioTooHigh]: 'Transfer ratio is too high',
  [GameError.NotInEvent]: 'Not in event',

  // Subscription Errors
  [GameError.InvalidSubscriptionTier]: 'Invalid subscription tier',
  [GameError.InsufficientSubscriptionPayment]: 'Insufficient subscription payment',
  [GameError.CannotDowngradeSubscription]: 'Cannot downgrade subscription',
  [GameError.AlreadyAtSubscriptionTier]: 'Already at this subscription tier',
  [GameError.SubscriptionExpired]: 'Subscription has expired',
  [GameError.VestingPeriodNotComplete]: 'Vesting period not complete',
  [GameError.NoReservedNoviToWithdraw]: 'No reserved NOVI to withdraw',

  // Minting Errors
  [GameError.InvalidMint]: 'Invalid mint',
  [GameError.MintingDisabled]: 'Minting is disabled',
  [GameError.BurnAmountTooLow]: 'Burn amount is too low',
  [GameError.ExceedsMaxMintPerBurn]: 'Exceeds max mint per burn',
  [GameError.MintAuthorityMismatch]: 'Mint authority mismatch',
  [GameError.BurnFailed]: 'Burn failed',
  [GameError.MintFailed]: 'Mint failed',
  [GameError.InvalidTokenAccount]: 'Invalid token account',
  [GameError.OracleOverflow]: 'Oracle calculation overflow',
  [GameError.OracleUnavailable]: 'Oracle unavailable',
  [GameError.OraclePriceStale]: 'Oracle price is stale',
  [GameError.OracleConfidenceTooWide]: 'Oracle confidence is too wide',
  [GameError.TokenNotAllowed]: 'Token not allowed',

  // Research Errors
  [GameError.ResearchNotFound]: 'Research not found',
  [GameError.ResearchAlreadyActive]: 'Research is already active',
  [GameError.ResearchNotActive]: 'Research is not active',
  [GameError.ResearchNotComplete]: 'Research is not complete',
  [GameError.ResearchPrerequisiteNotMet]: 'Research prerequisite not met',
  [GameError.ResearchMaxLevelReached]: 'Research max level reached',
  [GameError.ResearchTemplateInactive]: 'Research template is inactive',
  [GameError.InsufficientGems]: 'Insufficient gems',

  // Expedition Errors
  [GameError.ExpeditionInProgress]: 'Expedition already in progress',
  [GameError.NoExpeditionInProgress]: 'No expedition in progress',
  [GameError.ExpeditionNotComplete]: 'Expedition is not complete',
  [GameError.InvalidExpeditionType]: 'Invalid expedition type',
  [GameError.InvalidExpeditionTier]: 'Invalid expedition tier',
  [GameError.InsufficientOperatives]: 'Insufficient operatives',
  [GameError.WorkshopLevelTooLow]: 'Workshop level is too low',
  [GameError.PlayerLevelTooLow]: 'Player level is too low',
  [GameError.ExpeditionStrikeLimitReached]: 'Expedition strike limit reached',
  [GameError.ExpeditionStrikeNotReady]: 'Expedition strike not ready',
  [GameError.MiningNotUnlocked]: 'Mining not unlocked (build Workshop)',
  [GameError.FishingNotUnlocked]: 'Fishing not unlocked (build Dock)',
  [GameError.ExpeditionAlreadyComplete]: 'Expedition already complete',

  // Encounter Level/Loot Errors
  [GameError.EncounterLevelMismatch]: 'Encounter level mismatch',
  [GameError.EncounterDefenseTooHigh]: 'Encounter defense is too high',
  [GameError.AlreadyClaimed]: 'Already claimed',
  [GameError.LootExpired]: 'Loot has expired',
  [GameError.NotExpired]: 'Not expired yet',

  // Arena Errors
  [GameError.ArenaSeasonNotActive]: 'Arena season is not active',
  [GameError.ArenaSeasonExpired]: 'Arena season has expired',
  [GameError.ArenaSeasonNotFinalized]: 'Arena season not finalized',
  [GameError.ArenaCannotChallengeYourself]: 'Cannot challenge yourself',
  [GameError.ArenaNotInSeason]: 'Not in arena season',
  [GameError.ArenaOpponentNotInSeason]: 'Opponent not in arena season',
  [GameError.ArenaDailyBattleLimitReached]: 'Daily arena battle limit reached',
  [GameError.ArenaOpponentCooldownActive]: 'Opponent cooldown is active',
  [GameError.ArenaHeroAccountRequired]: 'Arena hero account required',
  [GameError.ArenaHeroMismatch]: 'Arena hero mismatch',
  [GameError.ArenaHeroLocked]: 'Arena hero is locked',
  [GameError.ArenaMatchExpired]: 'Arena match has expired',
  [GameError.ArenaMatchTimestampInvalid]: 'Arena match timestamp invalid',
  [GameError.ArenaMatchAlreadyUsed]: 'Arena match already used',
  [GameError.ArenaDailyRewardAlreadyClaimed]: 'Arena daily reward already claimed',
  [GameError.ArenaMinBattlesNotMet]: 'Arena minimum battles not met',
  [GameError.ArenaDailyPoolExhausted]: 'Arena daily pool exhausted',
  [GameError.ArenaMasterRewardAlreadyClaimed]: 'Arena master reward already claimed',
  [GameError.ArenaNotOnLeaderboard]: 'Not on arena leaderboard',
  [GameError.ArenaClaimDeadlinePassed]: 'Arena claim deadline passed',
  [GameError.ArenaSeasonAlreadyExists]: 'Arena season already exists',
  [GameError.ArenaSeasonNotPending]: 'Arena season is not pending',
  [GameError.ArenaLoadoutAlreadyExists]: 'Arena loadout already exists',
  [GameError.ArenaUnclaimedRedistributionTooEarly]: 'Arena unclaimed redistribution too early',
  [GameError.ArenaNoUnclaimedPrizes]: 'Arena has no unclaimed prizes',
  [GameError.ArenaSeasonAlreadyActive]: 'Arena season is already active',
  [GameError.ArenaParticipantAlreadyExists]: 'Arena participant already exists',

  // Castle Errors
  [GameError.CastleNotFound]: 'Castle not found',
  [GameError.CastleNotVacant]: 'Castle is not vacant',
  [GameError.CastleInContest]: 'Castle is in contest',
  [GameError.CastleProtected]: 'Castle is protected',
  [GameError.CastleTransitioning]: 'Castle is transitioning',
  [GameError.CastleNotAttackable]: 'Castle is not attackable',
  [GameError.NotKing]: 'You are not the king',
  [GameError.NotOnKingsTeam]: 'Not on the king\'s team',
  [GameError.MaxCastlesReached]: 'Maximum castles reached',
  [GameError.KingRegistryNotFound]: 'King registry not found',
  [GameError.CastleUpgradeInProgress]: 'Castle upgrade in progress',
  [GameError.CastleNoUpgradeInProgress]: 'No castle upgrade in progress',
  [GameError.CastleUpgradeLevelMax]: 'Castle upgrade at max level',
  [GameError.InvalidUpgradeType]: 'Invalid upgrade type',
  [GameError.CastleNeedsChambersUpgrade]: 'Castle needs chambers upgrade',
  [GameError.CourtPositionTaken]: 'Court position is taken',
  [GameError.CourtPositionVacant]: 'Court position is vacant',
  [GameError.NotCourtMember]: 'Not a court member',
  [GameError.AlreadyInCourt]: 'Already in court',
  [GameError.KingCannotHoldCourt]: 'King cannot hold court position',
  [GameError.GarrisonFull]: 'Garrison is full',
  [GameError.AlreadyInGarrison]: 'Already in garrison',
  [GameError.NotInGarrison]: 'Not in garrison',
  [GameError.GarrisonNoLoot]: 'Garrison has no loot',
  [GameError.GarrisonLootAlreadyClaimed]: 'Garrison loot already claimed',
  [GameError.CastleIneligible]: 'Castle is ineligible',
  [GameError.NoRewardsToClaim]: 'No rewards to claim',
  [GameError.CourtAppointmentCooldown]: 'Court appointment cooldown active',
  [GameError.TransitionNotComplete]: 'Transition not complete',
  [GameError.InvalidCastleTier]: 'Invalid castle tier',
  [GameError.CastleTierNoGarrison]: 'Castle tier does not support garrison',
  [GameError.CastleTierNoCourt]: 'Castle tier does not support court',
  [GameError.HeroAlreadyInGarrison]: 'Hero already in garrison',
  [GameError.CastleAlreadyExists]: 'Castle already exists',
  [GameError.InvalidCastleStatus]: 'Invalid castle status',
  [GameError.ContestNotEnded]: 'Contest has not ended',
  [GameError.CastleUpgradeNotReady]: 'Castle upgrade is not ready',

  // Dungeon Errors
  [GameError.DungeonNotActive]: 'Dungeon run is not active',
  [GameError.DungeonStillActive]: 'Dungeon run is still active',
  [GameError.DungeonNotFailed]: 'Dungeon run did not fail',
  [GameError.DungeonAlreadyEnded]: 'Dungeon run already ended',
  [GameError.InvalidRoomType]: 'Invalid room type',
  [GameError.NotCombatRoom]: 'Not a combat room',
  [GameError.NotAwaitingRelic]: 'Not awaiting relic choice',
  [GameError.InvalidRelicId]: 'Invalid relic ID',
  [GameError.RelicAlreadyOwned]: 'Relic already owned',
  [GameError.EnemyAlreadyDead]: 'Enemy is already dead',
  [GameError.NoCheckpoint]: 'No checkpoint available',
  [GameError.DungeonRunExists]: 'Dungeon run already exists',
  [GameError.DungeonEntryRequired]: 'DungeonEntry building required',
  [GameError.InvalidRelicChoice]: 'Invalid relic choice',
  [GameError.NotOnLeaderboard]: 'Not on leaderboard',
  [GameError.LeaderboardPrizeAlreadyClaimed]: 'Leaderboard prize already claimed',
  [GameError.LeaderboardWeekNotEnded]: 'Leaderboard week has not ended',
  [GameError.DungeonTimeLimitExceeded]: 'Dungeon time limit exceeded',

  // Extension Prerequisite Errors
  [GameError.ResearchNotUnlocked]: 'Research not unlocked',
  [GameError.HeroesNotUnlocked]: 'Heroes not unlocked',
  [GameError.InventoryNotUnlocked]: 'Inventory not unlocked',
  [GameError.RallyNotUnlocked]: 'Rally not unlocked',
  [GameError.TeamNotUnlocked]: 'Team not unlocked',
  [GameError.CosmeticsNotUnlocked]: 'Cosmetics not unlocked',
  [GameError.ExtensionPrerequisiteNotMet]: 'Extension prerequisite not met',

  // Shop Errors
  [GameError.InvalidTreasury]: 'Invalid treasury',
  [GameError.ItemNotAvailable]: 'Item not available',
  [GameError.InsufficientStock]: 'Insufficient stock',
  [GameError.PaymentTypeNotSupported]: 'Payment type not supported',
  [GameError.NotOwner]: 'Not the owner',
  [GameError.PurchaseLimitReached]: 'Purchase limit reached',
  [GameError.DailyLimitReached]: 'Daily limit reached',
  [GameError.InsufficientFunds]: 'Insufficient funds',
  [GameError.BundleNotActive]: 'Bundle is not active',
  [GameError.SaleNotActive]: 'Sale is not active',
  [GameError.SaleEnded]: 'Sale has ended',
  [GameError.SaleSoldOut]: 'Sale is sold out',
  [GameError.InventoryFull]: 'Inventory is full',
  [GameError.MaxSlotsReached]: 'Maximum slots reached',
  [GameError.InventoryNeedsExpansion]: 'Inventory needs expansion',
  [GameError.AccountNotInitialized]: 'Account not initialized',
  [GameError.AccountAlreadyExists]: 'Account already exists',

  // Estate Errors
  [GameError.EstateNotFound]: 'Estate not found',
  [GameError.EstateAlreadyExists]: 'Estate already exists',
  [GameError.BuildingRequired]: 'Building required',
  [GameError.BuildingLevelInsufficient]: 'Building level is too low',
  [GameError.BuildingNotActive]: 'Building is not active',
  [GameError.BuildingSlotFull]: 'No empty building slots',
  [GameError.BuildingAlreadyExists]: 'Building already exists',
  [GameError.BuildingUnderConstruction]: 'Building is under construction',
  [GameError.ConstructionNotComplete]: 'Construction is not complete',
  [GameError.InsufficientEstatePlots]: 'Insufficient estate plots',
  [GameError.EstateLevelInsufficient]: 'Estate level is too low',
  [GameError.MansionRequired]: 'Mansion building required',
  [GameError.BarracksRequired]: 'Barracks building required',
  [GameError.WorkshopRequired]: 'Workshop building required',
  [GameError.VaultRequired]: 'Vault building required',
  [GameError.DockRequired]: 'Dock building required',
  [GameError.ForgeRequired]: 'Forge building required',
  [GameError.MarketRequired]: 'Market building required',
  [GameError.AcademyRequired]: 'Academy building required',
  [GameError.ArenaRequired]: 'Arena building required',
  [GameError.MeditationChamberRequired]: 'MeditationChamber building required',
  [GameError.ObservatoryRequired]: 'Observatory building required',
  [GameError.TreasuryRequired]: 'Treasury building required',
  [GameError.CitadelRequired]: 'Citadel building required',
  [GameError.MaxHeroesLocked]: 'Maximum heroes locked',
  [GameError.HeroLevelCapReached]: 'Hero level cap reached',
  [GameError.CraftingInProgress]: 'Crafting is in progress',
  [GameError.NoCraftingInProgress]: 'No crafting in progress',
  [GameError.CraftNotComplete]: 'Craft is not complete',
  [GameError.MasteryLevelInsufficient]: 'Mastery level is too low',
  [GameError.InsufficientMaterials]: 'Insufficient materials',
  [GameError.AlreadyClaimedToday]: 'Already claimed today',
  [GameError.DailyActivityNotAvailable]: 'Daily activity not available',
  [GameError.DailyWindowExpired]: 'Daily window has expired',
  [GameError.WrongTimeWindow]: 'Wrong time window',
  [GameError.CampRequired]: 'Camp building required',
  [GameError.MineRequired]: 'Mine building required',
  [GameError.FarmRequired]: 'Farm building required',
  [GameError.TransportBayRequired]: 'TransportBay building required',
  [GameError.InfirmaryRequired]: 'Infirmary building required',

  // Staged Tempering Errors
  [GameError.StrikeTooEarly]: 'Strike is too early',
  [GameError.CraftWindowMissed]: 'Craft window missed',
  [GameError.InvalidQualityTier]: 'Invalid quality tier',
  [GameError.InsufficientCraftedItems]: 'Insufficient crafted items',

  // Hero & Meditation Errors
  [GameError.HeroAlreadyMeditating]: 'Hero is already meditating',
  [GameError.HeroNotMeditating]: 'Hero is not meditating',
  [GameError.HeroNotInSlot]: 'Hero is not in slot',
  [GameError.HeroMismatch]: 'Hero mismatch',
  [GameError.HeroLocked]: 'Hero is locked',
  [GameError.HeroAtMeditationCap]: 'Hero is at meditation cap',
  [GameError.WrongCityForMeditation]: 'Wrong city for meditation',
  [GameError.HeroCollectionExists]: 'Hero collection already exists',
};

// Error Parsing Functions

/**
 * Parse error code to human-readable message
 */
export function parseErrorMessage(errorCode: number): string {
  return ERROR_MESSAGES[errorCode] ?? `Unknown error (code: ${errorCode})`;
}

/**
 * Parse error from transaction result
 */
export function parseTransactionError(error: unknown): {
  code: number | null;
  message: string;
  logs?: string[];
} {
  if (!error || typeof error !== 'object') {
    return { code: null, message: String(error) };
  }

  const err = error as Record<string, unknown>;

  // Handle SendTransactionError with logs
  if (Array.isArray(err.logs)) {
    for (const log of err.logs) {
      if (typeof log === 'string') {
        const match = log.match(/custom program error: 0x([0-9a-f]+)/i);
        if (match?.[1]) {
          const code = parseInt(match[1], 16);
          return {
            code,
            message: parseErrorMessage(code),
            logs: err.logs as string[],
          };
        }
      }
    }
  }

  // Handle error object with code
  if (typeof err.code === 'number') {
    return {
      code: err.code,
      message: parseErrorMessage(err.code),
    };
  }

  // Handle InstructionError format
  if (err.InstructionError && Array.isArray(err.InstructionError)) {
    const [, instructionError] = err.InstructionError;
    if (
      instructionError &&
      typeof instructionError === 'object' &&
      'Custom' in (instructionError as Record<string, unknown>)
    ) {
      const code = (instructionError as { Custom: number }).Custom;
      return {
        code,
        message: parseErrorMessage(code),
      };
    }
  }

  return {
    code: null,
    message: typeof err.message === 'string' ? err.message : 'Unknown error',
    logs: Array.isArray(err.logs) ? (err.logs as string[]) : undefined,
  };
}

/**
 * Check if an error code is a specific GameError
 */
export function isGameError(code: number, expected: GameError): boolean {
  return code === expected;
}

/**
 * Get error category from error code
 */
export function getErrorCategory(code: number): string {
  if (code >= 6000 && code < 6100) return 'General';
  if (code >= 6100 && code < 6200) return 'Player';
  if (code >= 6200 && code < 6300) return 'Team';
  if (code >= 6300 && code < 6400) return 'Rally';
  if (code >= 6400 && code < 6500) return 'Location';
  if (code >= 6500 && code < 6600) return 'Encounter';
  if (code >= 6600 && code < 6700) return 'Event';
  if (code >= 6700 && code < 6800) return 'Subscription';
  if (code >= 6800 && code < 6900) return 'Minting';
  if (code >= 6900 && code < 7000) return 'Governance';
  if (code >= 7000 && code < 7100) return 'Fibonacci';
  if (code >= 7100 && code < 7200) return 'Combat';
  if (code >= 7200 && code < 7300) return 'Transfer';
  if (code >= 7300 && code < 7400) return 'Cleanup';
  if (code >= 7400 && code < 7500) return 'Loot';
  if (code >= 7500 && code < 7600) return 'Research';
  if (code >= 7600 && code < 7700) return 'Shop';
  if (code >= 7700 && code < 7800) return 'Estate';
  if (code >= 7800 && code < 7900) return 'Expedition';
  if (code >= 7900 && code < 8000) return 'Arena';
  if (code >= 8000 && code < 8100) return 'Dungeon';
  if (code >= 8100 && code < 8200) return 'Castle';
  return 'Unknown';
}
