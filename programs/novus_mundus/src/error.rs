use pinocchio::error::ProgramError;

#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum GameError {
    // General Errors (0-99)
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
    InvalidKingdomId = 6013,
    KingdomMismatch = 6014,
    KingdomRegistrationClosed = 6015,
    KingdomNotStarted = 6016,
    CrossKingdomNotAllowed = 6017,

    // Player Errors (100-199)
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
    TargetIsProtected = 6118, // New player protection active
    NetworthOutOfRange = 6119,
    ClaimCooldownActive = 6120,
    NothingToClaim = 6121,
    AccountTooNew = 6122,
    HappinessTooLow = 6123,
    MaxUnitsReached = 6124,
    InsufficientFragments = 6125,
    MaxPlayersReached = 6126,
    UserAccountNotCreated = 6127, // Must create user account before player

    // Team Errors (200-299)
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
    TreasuryWithdrawExceedsLimit = 6224, // Amount exceeds instant limit or daily cap
    TreasuryRequestPending = 6225,       // Already has a pending treasury request
    TreasuryRequestNotFound = 6226,      // No pending treasury request
    TreasuryRequestNotExecutable = 6227, // Cooldown not yet passed
    TreasuryRequestExpired = 6228,       // Request expired (>7 days old)
    CannotPromoteToHigherRank = 6229,    // Cannot promote to equal or higher rank than self
    CannotDemoteHigherRank = 6230,       // Cannot demote someone of higher rank
    AlreadyAtRank = 6231,                // Member already at target rank
    InvalidCooldownHours = 6232,         // Cooldown hours out of valid range
    TeamHasDomain = 6233,                // Must remove domain before disbanding
    TeamHasMembers = 6234,               // Must kick all members before disbanding

    // Rally Errors (300-399)
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

    // Location Errors (400-499)
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

    // City & Travel Errors (420-449)
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
    TerrainImpassable = 6430, // Destination is water or mountain

    // Encounter Errors (500-599)
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
    WrongTimeForEncounter = 6514, // Legendary/Epic can only spawn at specific times
    EncounterStillActive = 6515,  // cleanup attempted before despawn_at + cleanup grace period

    // Event Errors (600-699)
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
    AlreadyInEvent = 6613, // Already entered an event (only one at a time)
    EventPrizeUnclaimed = 6614, // Winner must claim their prize before leaving

    // Subscription Errors (700-799)
    InvalidSubscriptionTier = 6700,
    InsufficientSubscriptionPayment = 6701,
    CannotDowngradeSubscription = 6702,
    AlreadyAtSubscriptionTier = 6703,
    SubscriptionExpired = 6704,
    VestingPeriodNotComplete = 6705,
    NoReservedNoviToWithdraw = 6706,

    // Minting Errors (800-899)
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

    // Deposit Errors (813-819)
    DepositAmountZero = 6813,           // deposit_novi: amount == 0
    DepositSourceNotWalletOwned = 6814, // source ATA owner != owner wallet
    DepositReservedAtaMismatch = 6815,  // reserved ATA owner != user PDA

    // Governance/DAO Errors (900-999)
    ProposalNotFound = 6900,
    ProposalNotPassed = 6901,
    ProposalExpired = 6902,
    NotAuthorizedByDao = 6903,
    InvalidGovernanceAccount = 6904,

    // Fibonacci Errors (1000-1099)
    NotFibonacciNumber = 7000,
    FibonacciBonusFailed = 7001,

    // Combat Errors (1100-1199)
    InsufficientAttackPower = 7100,
    InsufficientTargetResources = 7101,
    AttackFailed = 7102,
    DefenseCalculationFailed = 7103,
    DamageCalculationFailed = 7104,

    // Strategic Combat Errors (1110-1149)
    NoDefensiveUnits = 7110,      // Player has no defensive units for attack
    FallbackModeActivated = 7111, // Info: Operatives defending (not really an error)
    AlreadyDeployingToTarget = 7112, // Already have deployment to this target
    NoFreeDeploymentSlot = 7113,  // All deployment slots in use
    ExceedsMaxDeployment = 7114,  // Trying to deploy more than allowed
    DeploymentNotArrived = 7115,  // Deployment hasn't arrived yet
    DeploymentAlreadyCompleted = 7116, // Deployment already processed
    NotReturningYet = 7117,       // Trying to process return before departure

    // Reinforcement Errors (1150-1169)
    NotOnSameTeam = 7150,              // Can only reinforce teammates
    MilitaryLogisticsRequired = 7151,  // Need research to unlock reinforcements
    NoFreeReinforcementSlot = 7152,    // Receiver has no free reinforcement slots
    ExceedsMaxSendAmount = 7153,       // Trying to send more than allowed
    ReinforcementNotActive = 7154,     // Reinforcement isn't active
    HeroAlreadyInRally = 7155,         // Hero is committed to another rally
    ReinforcementAlreadyExists = 7156, // Already reinforcing this player
    ReceiverCapacityFull = 7157,       // Receiver can't accept more reinforcements

    // Rally Strategic Errors (1170-1199)
    RallyNotGathering = 7170,          // Rally is not in gathering phase
    RallyNotMarching = 7171,           // Rally is not in marching phase
    RallyNotReturning = 7172,          // Rally is not in returning phase
    ParticipantNotArrived = 7173,      // Participant hasn't arrived at rally point
    ParticipantAlreadyArrived = 7174,  // Participant already marked as arrived
    ParticipantNotIncluded = 7175,     // Participant wasn't included in march
    ParticipantAlreadyReturned = 7176, // Participant already returned home
    LateJoinerCannotJoin = 7177,       // Missed gather_at deadline
    RallyCannotBeClosed = 7178,        // Not all participants have returned
    NotRallyParticipant = 7179,        // Not a participant in this rally
    CannotSpeedupOtherReturn = 7180,   // Only participant can speedup their own return
    ReturnNotComplete = 7181,          // Return journey not complete yet

    // Transfer Errors (1200-1299)
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

    // Inactive Account Cleanup Errors (1300-1399)
    AccountNotInactive = 7300,
    CannotCleanupActiveAccount = 7301,

    // Encounter Level/Loot Errors (1400-1499)
    EncounterLevelMismatch = 7400,
    EncounterDefenseTooHigh = 7401,
    AlreadyClaimed = 7402,
    LootExpired = 7403,
    NotExpired = 7404,

    // Research Errors (1500-1599)
    ResearchNotFound = 7500,
    ResearchAlreadyActive = 7501,
    ResearchNotActive = 7502,
    ResearchNotComplete = 7503,
    ResearchPrerequisiteNotMet = 7504,
    ResearchMaxLevelReached = 7505,
    ResearchTemplateInactive = 7506,
    InsufficientGems = 7507,

    // Extension Prerequisite Errors (1550-1599)
    ResearchNotUnlocked = 7550,         // Must start research first
    HeroesNotUnlocked = 7551,           // Must lock a hero first
    InventoryNotUnlocked = 7552,        // Must use shop first
    RallyNotUnlocked = 7553,            // Must join/create rally first
    TeamNotUnlocked = 7554,             // Must join/create team first
    CosmeticsNotUnlocked = 7555,        // Must purchase cosmetic first
    ExtensionPrerequisiteNotMet = 7556, // Generic prerequisite failure
    CosmeticNotOwned = 7557,            // Tried to equip a cosmetic not in owned_<kind>

    // Shop Errors (1600-1699)
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
    DailyCapExceeded = 7617,
    SlippageExceeded = 7618,

    // Estate System Errors (1700-1799)
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
    DockRequired = 7715, // Dock building required for fishing
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
    DailyWindowExpired = 7733,   // All time windows have passed for today
    WrongTimeWindow = 7734,      // Building's mini-game not available in current window
    CampRequired = 7735,         // Camp building required for operative hiring
    MineRequired = 7736,         // Mine building required for mining
    FarmRequired = 7737,         // Farm building required for farming
    TransportBayRequired = 7738, // TransportBay building required for travel
    InfirmaryRequired = 7739,    // Infirmary building required

    // Staged Tempering Errors (1740-1759)
    StrikeTooEarly = 7740,     // Metal not ready - window hasn't opened yet
    CraftWindowMissed = 7741,  // Metal cooled - window has closed, craft failed
    InvalidQualityTier = 7742, // Cannot craft Common tier (tier 0)
    InsufficientCraftedItems = 7743, // Player doesn't have this crafted item to equip

    // Hero & Meditation Errors (1760-1779)
    HeroAlreadyMeditating = 7760,     // A hero is already meditating
    HeroNotMeditating = 7761,         // No hero is currently meditating
    HeroNotInSlot = 7762,             // No hero in the specified active_heroes slot
    HeroMismatch = 7763,              // Hero account doesn't match expected hero
    HeroLocked = 7764,                // Hero is locked (already in use elsewhere)
    HeroAtMeditationCap = 7765,       // Hero at meditation cap - must use fragments
    WrongCityForMeditation = 7766,    // Hero requires meditation in specific origin city
    HeroCollectionExists = 7767,      // Hero collection already created
    HeroAlreadyMintedByPlayer = 7768, // Player already minted this template (receipt PDA exists)
    HeroIsLocked = 7769,              // Cannot burn a hero in an active slot
    HeroNotOwnedByCaller = 7770,      // NFT owner does not match signer
    SupplyCapCannotDecrease = 7771,   // Supply cap can only be increased, not decreased
    HeroAbilityNotConfigured = 7772,  // Template has no active ability
    HeroAbilityOnCooldown = 7773,     // Cooldown has not elapsed since last use
    HeroAbilityInvalidKind = 7774,    // Unknown ability kind in template
    HeroAbilityBadParams = 7775,      // Ability params out of range (e.g., zero amount)

    // Expedition System Errors (1800-1819)
    ExpeditionInProgress = 7800,         // Already on an expedition
    NoExpeditionInProgress = 7801,       // No active expedition to claim/strike
    ExpeditionNotComplete = 7802,        // Expedition duration not elapsed
    InvalidExpeditionType = 7803,        // Must be Mining (1) or Fishing (2)
    InvalidExpeditionTier = 7804,        // Tier must be 0-4
    InsufficientOperatives = 7805,       // Not enough available operatives
    WorkshopLevelTooLow = 7806,          // Workshop level insufficient for mining tier
    PlayerLevelTooLow = 7807,            // Player level insufficient for fishing tier
    ExpeditionStrikeLimitReached = 7808, // Already performed max strikes for this expedition
    ExpeditionStrikeNotReady = 7809,     // Strike window not open yet (1 per hour)
    MiningNotUnlocked = 7810,            // Player hasn't unlocked mining (has_mining = false)
    FishingNotUnlocked = 7811,           // Player hasn't unlocked fishing (has_fishing = false)
    ExpeditionAlreadyComplete = 7812,    // Expedition is complete, cannot strike (claim instead)

    // Arena PvP System Errors (7900-7930)
    ArenaSeasonNotActive = 7900,         // Season is not in Active status
    ArenaSeasonExpired = 7901,           // Season has ended
    ArenaSeasonNotFinalized = 7902,      // Season must be finalized first
    ArenaCannotChallengeYourself = 7903, // Cannot challenge yourself
    ArenaNotInSeason = 7904,             // Player not registered for this season
    ArenaOpponentNotInSeason = 7905,     // Opponent not registered for this season
    // 7906 removed - loadout validation now inline in challenge_player
    ArenaDailyBattleLimitReached = 7907, // Max 10 battles per rolling 24h
    ArenaOpponentCooldownActive = 7908,  // Max 2 battles vs same opponent per 24h
    ArenaHeroAccountRequired = 7909,     // Hero account required when loadout has arena_hero set
    ArenaHeroMismatch = 7910,            // Hero account doesn't match loadout
    ArenaHeroLocked = 7911,              // Hero is locked (in use elsewhere)
    ArenaMatchExpired = 7912,            // Match assignment expired (>5 min)
    ArenaMatchTimestampInvalid = 7913,   // Match timestamp is in the future
    ArenaMatchAlreadyUsed = 7914,        // Match ID already used (replay attack)
    ArenaDailyRewardAlreadyClaimed = 7915, // Daily reward already claimed today
    ArenaMinBattlesNotMet = 7916,        // Need minimum battles to claim daily reward
    ArenaDailyPoolExhausted = 7917,      // Daily prize pool exhausted for today
    ArenaMasterRewardAlreadyClaimed = 7918, // Master reward already claimed
    ArenaNotOnLeaderboard = 7919,        // Player not on leaderboard
    ArenaClaimDeadlinePassed = 7920,     // Claim deadline has passed
    ArenaSeasonAlreadyExists = 7921,     // Season already exists
    ArenaSeasonNotPending = 7922,        // Season must be in Pending status
    ArenaLoadoutAlreadyExists = 7923,    // Loadout account already exists
    // 7924-7926 removed - no loadout validation (arena is non-lethal, loadout trusted)
    ArenaUnclaimedRedistributionTooEarly = 7927, // Cannot redistribute before claim deadline
    ArenaNoUnclaimedPrizes = 7928,               // No unclaimed prizes to redistribute
    ArenaSeasonAlreadyActive = 7929,             // Season is already active
    ArenaParticipantAlreadyExists = 7930,        // Already joined this season

    // Dungeon System Errors (8000-8049)
    DungeonNotActive = 8000,     // Dungeon run is not in active state
    DungeonStillActive = 8001,   // Cannot claim - dungeon run still active
    DungeonNotFailed = 8002,     // Cannot resume - dungeon run didn't fail
    DungeonAlreadyEnded = 8003,  // Run already completed/failed/fled
    InvalidRoomType = 8004,      // Room type doesn't match expected action
    NotCombatRoom = 8005,        // Attack requires combat room
    NotAwaitingRelic = 8006,     // Not in relic selection phase
    InvalidRelicId = 8007,       // Relic ID out of range (0-19)
    RelicAlreadyOwned = 8008,    // Player already has this relic
    EnemyAlreadyDead = 8009,     // Cannot attack dead enemy
    NoCheckpoint = 8010,         // No checkpoint to resume from
    DungeonRunExists = 8011,     // Player already has active dungeon run
    DungeonEntryRequired = 8012, // DungeonEntry building required
    InvalidRelicChoice = 8013,   // Chosen relic not in offered options
    NotOnLeaderboard = 8014,     // Player not on dungeon leaderboard
    LeaderboardPrizeAlreadyClaimed = 8015, // Leaderboard prize already claimed
    LeaderboardWeekNotEnded = 8016, // Cannot claim prize for current/future week
    DungeonTimeLimitExceeded = 8017, // Dungeon run exceeded time limit

    // Castle System Errors (8100-8199)
    CastleNotFound = 8100,             // Castle account doesn't exist
    CastleNotVacant = 8101,            // Castle already has a king
    CastleInContest = 8102,            // Castle is in contest period
    CastleProtected = 8103,            // Castle is in protection period
    CastleTransitioning = 8104,        // Castle is transitioning ownership
    CastleNotAttackable = 8105,        // Castle cannot be attacked in current state
    NotKing = 8106,                    // Player is not the castle king
    NotOnKingsTeam = 8107,             // Player is not on the king's team
    MaxCastlesReached = 8108,          // King already rules maximum castles
    KingRegistryNotFound = 8109,       // King registry account doesn't exist
    CastleUpgradeInProgress = 8110,    // Upgrade already in progress
    CastleNoUpgradeInProgress = 8111,  // No upgrade to cancel
    CastleUpgradeLevelMax = 8112,      // Already at max upgrade level
    InvalidUpgradeType = 8113,         // Invalid upgrade type specified
    CastleNeedsChambersUpgrade = 8114, // Need Chambers upgrade for more court
    CourtPositionTaken = 8115,         // Court position already filled
    CourtPositionVacant = 8116,        // Court position is vacant (can't dismiss)
    NotCourtMember = 8117,             // Player is not in court (can't resign)
    AlreadyInCourt = 8118,             // Player already holds a court position
    KingCannotHoldCourt = 8119,        // King cannot hold their own court
    GarrisonFull = 8120,               // Castle garrison at capacity
    AlreadyInGarrison = 8121,          // Player already in this garrison
    NotInGarrison = 8122,              // Player not in this garrison
    GarrisonNoLoot = 8123,             // No loot to claim from garrison
    GarrisonLootAlreadyClaimed = 8124, // Loot already claimed
    CastleIneligible = 8125,           // Player doesn't meet castle eligibility
    NoRewardsToClaim = 8126,           // No rewards available to claim
    CourtAppointmentCooldown = 8127,   // Court appointment cooldown active
    TransitionNotComplete = 8128,      // Castle transition not yet complete
    InvalidCastleTier = 8129,          // Invalid castle tier specified
    CastleTierNoGarrison = 8130,       // Castle tier doesn't support garrison
    CastleTierNoCourt = 8131,          // Castle tier doesn't support court
    HeroAlreadyInGarrison = 8132,      // Hero is already committed to a garrison
    CastleAlreadyExists = 8133,        // Castle with this ID already exists
    InvalidCastleStatus = 8134,        // Castle status doesn't support this transition
    ContestNotEnded = 8135,            // Contest period has not ended yet
    CastleUpgradeNotReady = 8136,      // Upgrade timer has not expired yet

    // Account Discriminator Errors (8200+)
    InvalidAccountKey = 8200, // Account discriminator byte mismatch

    // War Table Errors (8300+)
    WtBadScope = 8300,            // scope tag > 4
    WtThreadScopeMismatch = 8301, // thread account discriminator != claimed scope
    WtNotInScope = 8302,          // sender not a member/participant/combatant of scope
    WtBadMagic = 8303,            // envelope[0..3] != b"wt1"
    WtThreadPdaMismatch = 8304,   // envelope.thread_pda != thread.key
    WtSenderMismatch = 8305,      // envelope.sender_wallet != signer
    WtBodyLenMismatch = 8306,     // declared body_len != actual bytes
    WtKeyVersionMismatch = 8307,  // key_version != required value for scope
    WtEncryptedFlagRequired = 8308, // encrypted scope received flags bit0 == 0 (plaintext)
}

impl From<GameError> for ProgramError {
    fn from(e: GameError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

impl From<GameError> for u32 {
    fn from(e: GameError) -> Self {
        e as u32
    }
}
