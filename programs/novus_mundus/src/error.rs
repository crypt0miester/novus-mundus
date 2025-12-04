use pinocchio::program_error::ProgramError;

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
    TargetIsProtected = 6118,          // New player protection active
    NetworthOutOfRange = 6119,
    ClaimCooldownActive = 6120,
    NothingToClaim = 6121,
    AccountTooNew = 6122,
    HappinessTooLow = 6123,
    MaxUnitsReached = 6124,
    InsufficientFragments = 6125,
    MaxPlayersReached = 6126,

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
    WrongTimeForEncounter = 6514,       // Legendary/Epic can only spawn at specific times

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
    NoDefensiveUnits = 7110,              // Player has no defensive units for attack
    FallbackModeActivated = 7111,         // Info: Operatives defending (not really an error)
    AlreadyDeployingToTarget = 7112,      // Already have deployment to this target
    NoFreeDeploymentSlot = 7113,          // All deployment slots in use
    ExceedsMaxDeployment = 7114,          // Trying to deploy more than allowed
    DeploymentNotArrived = 7115,          // Deployment hasn't arrived yet
    DeploymentAlreadyCompleted = 7116,    // Deployment already processed
    NotReturningYet = 7117,               // Trying to process return before departure

    // Reinforcement Errors (1150-1169)
    NotOnSameTeam = 7150,                 // Can only reinforce teammates
    MilitaryLogisticsRequired = 7151,     // Need research to unlock reinforcements
    NoFreeReinforcementSlot = 7152,       // Receiver has no free reinforcement slots
    ExceedsMaxSendAmount = 7153,          // Trying to send more than allowed
    ReinforcementNotActive = 7154,        // Reinforcement isn't active
    HeroAlreadyInRally = 7155,            // Hero is committed to another rally
    ReinforcementAlreadyExists = 7156,    // Already reinforcing this player
    ReceiverCapacityFull = 7157,          // Receiver can't accept more reinforcements

    // Rally Strategic Errors (1170-1199)
    RallyNotGathering = 7170,             // Rally is not in gathering phase
    RallyNotMarching = 7171,              // Rally is not in marching phase
    RallyNotReturning = 7172,             // Rally is not in returning phase
    ParticipantNotArrived = 7173,         // Participant hasn't arrived at rally point
    ParticipantAlreadyArrived = 7174,     // Participant already marked as arrived
    ParticipantNotIncluded = 7175,        // Participant wasn't included in march
    ParticipantAlreadyReturned = 7176,    // Participant already returned home
    LateJoinerCannotJoin = 7177,          // Missed gather_at deadline
    RallyCannotBeClosed = 7178,           // Not all participants have returned
    NotRallyParticipant = 7179,           // Not a participant in this rally
    CannotSpeedupOtherReturn = 7180,      // Only participant can speedup their own return
    ReturnNotComplete = 7181,             // Return journey not complete yet

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
    ResearchNotUnlocked = 7550,          // Must start research first
    HeroesNotUnlocked = 7551,            // Must lock a hero first
    InventoryNotUnlocked = 7552,         // Must use shop first
    RallyNotUnlocked = 7553,             // Must join/create rally first
    TeamNotUnlocked = 7554,              // Must join/create team first
    CosmeticsNotUnlocked = 7555,         // Must purchase cosmetic first
    ExtensionPrerequisiteNotMet = 7556,  // Generic prerequisite failure

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
