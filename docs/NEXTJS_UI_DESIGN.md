# Novus Mundus — Next.js UI Architecture Design

Text-based MVP. Black & gold elite design. anime.js motion system. 3D-ready architecture. Solito mobile later.

---

## 1. Tech Stack

```
Framework:     Next.js 15 (App Router, RSC where appropriate)
Styling:       Tailwind CSS 4 + shadcn/ui (black & gold custom theme)
Motion:        anime.js v4 (loading, countdowns, number rolls, transitions)
State:         Zustand (client game state) + TanStack Query (RPC cache)
Wallet:        @solana/wallet-adapter-react
SDK:           novus-mundus-ts (local workspace link)
3D (later):    @react-three/fiber + @react-three/drei (town renderer)
Mobile (later): Solito + React Native (shared screens via packages/)
Monorepo:      Turborepo — apps/web, apps/mobile, packages/ui, packages/game-logic
```

---

## 2. Monorepo Structure

```
apps/
  web/                          # Next.js 15 app
    app/
      (auth)/                   # Pre-wallet routes
        page.tsx                # Landing / connect wallet
      (game)/                   # Requires connected wallet
        layout.tsx              # Game shell: sidebar + topbar + main
        dashboard/page.tsx      # Player overview
        city/[id]/page.tsx      # City view (encounters, players, shops)
        estate/page.tsx         # Estate management
        combat/page.tsx         # PvP attack target selection
        encounter/[id]/page.tsx # PvE encounter detail
        dungeon/page.tsx        # Dungeon run interface
        dungeon/[id]/page.tsx   # Active dungeon run
        arena/page.tsx          # Arena seasons + matchmaking
        expedition/page.tsx     # Mining / fishing
        forge/page.tsx          # Equipment crafting
        research/page.tsx       # Research tree
        castle/page.tsx         # Castle overview
        castle/[id]/page.tsx    # Castle detail (garrison, court, upgrades)
        team/page.tsx           # Team management
        rally/page.tsx          # Rally creation + active rallies
        sanctuary/page.tsx      # Hero meditation
        shop/page.tsx           # In-game shop
        hero/page.tsx           # Hero management (equip, level, burn)
        travel/page.tsx         # Travel / teleport interface
        inventory/page.tsx      # Equipment, consumables, materials
        leaderboard/page.tsx    # Global + arena + dungeon boards
        settings/page.tsx       # Subscription, name, account
        map/page.tsx            # World map (city overview, text-based)
    lib/
      solana/
        provider.tsx            # WalletProvider + ConnectionProvider
        connection.ts           # RPC connection singleton
        client.ts               # NovusMundusClient singleton
      hooks/
        usePlayer.ts            # Player account fetcher + WS sub
        useGameEngine.ts        # GameEngine account fetcher
        useCity.ts              # City account fetcher
        useEncounters.ts        # Encounters in city
        useTeam.ts              # Team account + members
        useRally.ts             # Active rallies
        useExpedition.ts        # Expedition state
        useDungeon.ts           # Dungeon run state
        useArena.ts             # Arena season + participant
        useCastle.ts            # Castle data
        useLoot.ts              # Unclaimed loot
        useTransact.ts          # TX builder + send + confirm + toast
        useCountdown.ts         # Travel/expedition/dungeon timers
        useStamina.ts           # Realtime stamina calculation
        useNetworth.ts          # Realtime networth calculation
      store/
        game.ts                 # Zustand: selected city, UI prefs
        notifications.ts        # Toast / event notification queue
      calculators.ts            # Re-export SDK calculators
      formatters.ts             # BN → display, time → relative, etc.
    components/
      layout/
        Sidebar.tsx             # Navigation
        TopBar.tsx              # Player name, level, NOVI, stamina bar
        BottomNav.tsx           # Mobile nav (tabs)
      shared/
        StatBar.tsx             # HP / stamina / XP progress bar (text)
        ResourceRow.tsx         # Icon-less resource display
        CountdownTimer.tsx      # Live countdown
        UnitGrid.tsx            # 6-unit display (def1-3, op1-3)
        WeaponGrid.tsx          # Melee, ranged, siege, armor
        TxButton.tsx            # Send TX → loading → confirm/fail
        ConfirmModal.tsx        # "Are you sure?" for destructive actions
        Badge.tsx               # Tier / rarity / status badges
      player/
        PlayerCard.tsx          # Compact player overview
        PlayerStats.tsx         # Full stat breakdown
        EquipmentPanel.tsx      # Equipped items + bonuses
        ConsumablesPanel.tsx    # Potions, scrolls, boosters
        MaterialsPanel.tsx      # Crafting materials by rarity
      city/
        CityList.tsx            # All cities with player counts
        CityDetail.tsx          # City info + encounter list
        EncounterList.tsx       # Encounter cards in a city
        PlayerList.tsx          # Players present in a city
      combat/
        AttackPanel.tsx         # Select target, show power calc
        CombatResult.tsx        # Post-combat loot + casualties
        EncounterAttack.tsx     # PvE encounter attack
      economy/
        HirePanel.tsx           # Hire units (6 types + quantities)
        PurchasePanel.tsx       # Buy equipment + produce + vehicles
        TransferPanel.tsx       # Transfer cash to another player
        StaminaShop.tsx         # Purchase stamina
        NoviPurchase.tsx        # Buy NOVI (tier pricing + bonuses)
        VaultPanel.tsx          # Cash on hand vs vault management
      estate/
        BuildingGrid.tsx        # 19 building types, levels, actions
        BuildPanel.tsx          # Build new building
        UpgradePanel.tsx        # Upgrade existing building
        PlotBuyPanel.tsx        # Buy estate plot
        DailyActivity.tsx       # Daily estate activity
      dungeon/
        DungeonSelector.tsx     # Pick dungeon template
        DungeonRun.tsx          # Active run display
        FloorProgress.tsx       # Floor/room tracker
        RelicDisplay.tsx        # Collected relics + synergies
        EnemyCard.tsx           # Current enemy HP/power
        DungeonResult.tsx       # End-of-run summary
      arena/
        SeasonInfo.tsx          # Season status, time remaining
        Matchmaking.tsx         # Challenge player
        LoadoutEditor.tsx       # Edit arena loadout
        EloDisplay.tsx          # ELO + rank + points
        ArenaLeaderboard.tsx    # Season leaderboard
      expedition/
        ExpeditionStart.tsx     # Pick type, tier, operatives
        ActiveExpedition.tsx    # Timer, strikes, score
        StrikeMinigame.tsx      # Tap-to-strike interface
      castle/
        CastleCard.tsx          # Castle summary (tier, king, status)
        GarrisonPanel.tsx       # Join/leave garrison
        CourtPanel.tsx          # Court positions
        UpgradeQueue.tsx        # Castle upgrades in progress
        CastleRewards.tsx       # Claim rewards
      team/
        TeamOverview.tsx        # Team name, members, rank
        MemberList.tsx          # Members + ranks
        InvitePanel.tsx         # Send/accept/decline invites
      rally/
        CreateRally.tsx         # New rally form
        RallyList.tsx           # Active rallies
        RallyDetail.tsx         # Participants + status
      research/
        ResearchTree.tsx        # Tree/list of research nodes
        ResearchProgress.tsx    # Active research
        BuffSummary.tsx         # Current research buffs
      hero/
        HeroList.tsx            # Owned heroes (NFTs)
        HeroDetail.tsx          # Hero stats, level, buffs
        HeroEquip.tsx           # Slot hero into active slots
        HeroMeditation.tsx      # Start/claim meditation
      shop/
        ShopGrid.tsx            # Items by category
        BundleCard.tsx          # Bundle deals
        FlashSale.tsx           # Timed flash sales
        PurchaseHistory.tsx     # Spending + milestones
      travel/
        TravelMap.tsx           # City-to-city (text list + distances)
        IntracityTravel.tsx     # Move within city
        TeleportPanel.tsx       # Instant teleport (gem cost)
      subscription/
        TierComparison.tsx      # 4 tiers side-by-side
        SubscriptionStatus.tsx  # Current tier + expiry
      loot/
        LootList.tsx            # Unclaimed loot items
        LootClaim.tsx           # Claim individual loot

  mobile/ (later)               # React Native via Solito
    ...

packages/
  ui/                           # Shared components (Solito-compatible)
    src/
      primitives/               # Text, View, Pressable wrappers
      components/               # Cross-platform components
      theme/                    # Gold theme tokens, CSS variables
  game-logic/                   # Shared game calculations
    src/
      index.ts                  # Re-export novus-mundus-ts calculators
  town-renderer/ (LATER)        # 3D town view — @react-three/fiber wrapper
    src/                         # Migrated from terrain-builder/src/town/
      TownCanvas.tsx             # React component wrapping TownRenderer
      hooks/                     # useBuildings, useTerrain, useAtmosphere
      adapters/                  # Bridge SDK state → TownStateManager
```

---

## 3. Data Flow Architecture

```
┌──────────────────────────────────────────────────────────┐
│                        Next.js App                        │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ WalletProvider + ConnectionProvider (Solana)         │ │
│  │  └─ NovusMundusClient (singleton via React Context) │ │
│  └─────────────────────────────────────────────────────┘ │
│                          │                                │
│  ┌──────────┐  ┌────────────────┐  ┌──────────────────┐ │
│  │ Zustand   │  │ TanStack Query │  │ WebSocket Subs   │ │
│  │ (UI state)│  │ (RPC cache)    │  │ (account changes)│ │
│  │           │  │                │  │                  │ │
│  │ selectedCity  fetchPlayer()  │  │ subscribeToPlayer │ │
│  │ uiPrefs   │  fetchCity()     │  │ subscribeToLoot   │ │
│  │ modals    │  fetchTeam()     │  │ subscribeToRally  │ │
│  └──────────┘  └────────────────┘  └──────────────────┘ │
│                          │                                │
│              ┌───────────────────────┐                    │
│              │ SDK (novus-mundus-ts) │                    │
│              │ • Instructions        │                    │
│              │ • State deserializers  │                    │
│              │ • Calculators          │                    │
│              │ • Validators           │                    │
│              │ • PDA derivation       │                    │
│              │ • Event parser         │                    │
│              └───────────────────────┘                    │
│                          │                                │
│              ┌───────────────────────┐                    │
│              │ Solana RPC (JSON-RPC) │                    │
│              │ + WebSocket (wss://)  │                    │
│              └───────────────────────┘                    │
└──────────────────────────────────────────────────────────┘
```

### 3.1 Query Layer (TanStack Query)

Every on-chain account gets a dedicated hook backed by TanStack Query:

```typescript
// hooks/usePlayer.ts
function usePlayer(owner: PublicKey) {
  const client = useNovusMundusClient();
  return useQuery({
    queryKey: ['player', owner.toBase58()],
    queryFn: () => client.fetchPlayer(owner),
    staleTime: 10_000,  // 10s — WS updates will invalidate sooner
    refetchOnWindowFocus: true,
  });
}
```

WebSocket subscriptions (via `GameSubscriptionManager`) automatically invalidate
TanStack Query cache when on-chain accounts change, giving real-time updates
without polling:

```typescript
// hooks/usePlayerSubscription.ts
function usePlayerSubscription(owner: PublicKey) {
  const queryClient = useQueryClient();
  const connection = useConnection();
  const gameEngine = useGameEngine();

  useEffect(() => {
    const sub = subscribeToPlayer(connection, gameEngine, owner, (player) => {
      queryClient.setQueryData(['player', owner.toBase58()], {
        pubkey: derivePlayerPda(gameEngine, owner)[0],
        account: player,
        exists: true,
      });
    });
    return () => { sub.unsubscribe(); };
  }, [owner]);
}
```

### 3.2 Transaction Layer

Every game action follows the same pattern:

```typescript
// hooks/useTransact.ts
function useTransact() {
  const client = useNovusMundusClient();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (instructions: TransactionInstruction[]) => {
      const tx = client.buildTransaction(instructions, {
        feePayer: wallet.publicKey,
        computeUnits: 400_000,
      });
      tx.recentBlockhash = (await client.connection.getLatestBlockhash()).blockhash;
      const signed = await wallet.signTransaction(tx);
      return client.sendTransaction(signed, []);
    },
    onSuccess: (result) => {
      // Parse events from TX logs to show toasts
      for (const event of result.events) {
        showEventNotification(event);
      }
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['player'] });
    },
  });
}
```

---

## 4. Screen Designs (Black & Gold Theme)

All screens: bg-zinc-950, gold accents, noise overlay, vignette.
Cards: bg-zinc-900 with gold-border on active, gold-glow-box on hover.
Layout: sidebar left (desktop), bottom tabs (mobile), topbar with wallet + resources.

### 4.1 Dashboard (Home Screen)

The command center. Everything at a glance. Gold shimmer title. Staggered card entrance.

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ✦ NOVUS MUNDUS ✦  (shimmer-gold text)     ⚡78/500  ◆12,450  7xK..3f ▾  ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  ┌─ PLAYER ──────── gold-border ─────────────────────────────────────────┐ ║
║  │                                                                       │ ║
║  │  ShadowKnight                              LEVEL 42                   │ ║
║  │  (text-zinc-100 font-semibold)             (amber-400 text-3xl glow)  │ ║
║  │                                                                       │ ║
║  │  XP ██████████████████░░░░░░░░ 67%         City: New York             │ ║
║  │     (bar-gold animated gradient)           Tier: Expert ♛             │ ║
║  │                                            Expires: 14d 6h            │ ║
║  └───────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║  ┌─ TREASURY ────────────────────┐  ┌─ POWER ────────────────────────────┐║
║  │                               │  │                                    │║
║  │  ◆ NOVI      12,450  (glow)   │  │   ⚔ TOTAL POWER                   │║
║  │  $ CASH   1,245,000           │  │     53,200  (text-3xl amber glow)  │║
║  │  $ VAULT    500,000           │  │                                    │║
║  │  ✦ GEMS      2,340           │  │  DEF  38,400 │ OPS  14,800        │║
║  │  ⚡ STA       78/500          │  │  T1:  5,000  │ T1:   3,200        │║
║  │  ◇ FRAG        890           │  │  T2:  1,200  │ T2:     450        │║
║  │                               │  │  T3:    180  │ T3:      60        │║
║  │  (all numbers: font-mono      │  │                                    │║
║  │   tabular-nums amber-400)     │  │  WEAPONS: 800 ⚔ 320 🏹 45 ⚙ 500🛡│║
║  └───────────────────────────────┘  └────────────────────────────────────┘║
║                                                                            ║
║  ┌─ OPERATIONS ── gold-border animated ──────────────────────────────────┐║
║  │  ● Traveling → Los Angeles          2h 14m  ██████░░░░░ 58%          │║
║  │  ● Mining Expedition (T3)           4h 22m  ████░░░░░░░ 35%          │║
║  │  ● Rally "Raid Alpha"               3/5 members joined               │║
║  │  ● Castle Upgrade: Treasury Lv3     1d 8h   █░░░░░░░░░ 12%           │║
║  │  ▲ 3 unclaimed loot drops           (amber-400 pulse animation)      │║
║  └──────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║  ┌─ HEROES ──────────────────────────────────────────────────────────────┐║
║  │  [1] Blade of Valor  Lv 8    +15% ATK  +8% CRIT     (gold-border)   │║
║  │  [2] Shadow Warden   Lv 5    +12% DEF  +10% ECON    (gold-border)   │║
║  │  [3] ── empty ──                                     (zinc-800)      │║
║  │  ◷  Meditating: Celestial Monk — 18h remaining                       │║
║  └──────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║  [◆ HIRE UNITS]  [◆ COLLECT]  [◆ CLAIM LOOT ▲3]  [◆ SHOP]               ║
║   (primary gold    (secondary    (gold + pulse      (secondary)           ║
║    button)          button)       badge)                                   ║
║                                                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### 4.2 City View

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ── NEW YORK ──  (shimmer-gold)                                            ║
║  Capital City  ·  40.71°N 74.01°W  ·  15km radius                         ║
║  342 players  ·  12/50 encounters  ·  Season #4                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  ENCOUNTERS                                    FILTER: [All] [Rare+] [Epic+]║
║  ┌────────┬───────┬──────────────────────────┬────────────────────────────┐ ║
║  │ #4201  │COMMON │ Lv 15  ████████████░░░░░ │ 62%   HP 11,160/18,000    │ ║
║  │        │(gray) │ (emerald bar)            │ [⚔ ATTACK]                │ ║
║  ├────────┼───────┼──────────────────────────┼────────────────────────────┤ ║
║  │ #4202  │ RARE  │ Lv 28  █████████████████ │ 84%                       │ ║
║  │        │(blue) │ (emerald bar)            │ [⚔ ATTACK]                │ ║
║  ├────────┼───────┼──────────────────────────┼────────────────────────────┤ ║
║  │ #4203  │ EPIC  │ Lv 45  ██████░░░░░░░░░░░│ 31%   (amber bar)         │ ║
║  │        │(purp) │ gold-glow-box            │ [⚔ ATTACK]  ← gold btn   │ ║
║  └────────┴───────┴──────────────────────────┴────────────────────────────┘ ║
║                                                                            ║
║  PLAYERS IN CITY                                                           ║
║  ┌──────────────────────────────────────────────────────────────────────┐  ║
║  │  DarkLord99     Lv 67   ⚔ 142,000   [Attack]  [Scout]              │  ║
║  │  NoobSlayer     Lv 23   ⚔   8,400   [Attack]  [Scout]              │  ║
║  │  CryptoKing     Lv 89   ⚔ 380,000   [Attack]  [Scout]  ♛ King     │  ║
║  │  (hover: gold-border, slide-in power comparison)                    │  ║
║  │  ... 339 more                                       [View All →]    │  ║
║  └──────────────────────────────────────────────────────────────────────┘  ║
║                                                                            ║
║  [✦ Travel to Another City]  [Move Within City]  [⚡ Teleport · 2,340 ✦]  ║
║                                                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### 4.3 Dungeon Run

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ── THE CRYPTS OF DREAD ──  (shimmer-gold)                                 ║
║  Floor 4/10  ·  Room 2/3  ·  ◷ 42:15 remaining                            ║
║  ○ ○ ○ ● ○ ○ ○ ○ ○ ○  (gold dots for cleared, amber current, zinc ahead)  ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  ┌─ ENEMY ── red-glow-border ────────────────────────────────────────────┐ ║
║  │                                                                       │ ║
║  │  CRYPT GUARDIAN                 Power: 4,200    Defense: 180          │ ║
║  │  HP █████████████████░░░░░░░░   72%  (12,960 / 18,000)               │ ║
║  │     (gradient: red-600→amber-500 because mid-range)                   │ ║
║  │  Darkness: ██░░░░░░░░ 12%       Boss: ─                              │ ║
║  │                                                                       │ ║
║  └───────────────────────────────────────────────────────────────────────┘ ║
║                                                                            ║
║  ┌─ YOUR FORCES ─────────────────┐  ┌─ RELICS (3) ──────────────────────┐ ║
║  │  Units Remaining:             │  │                                    │ ║
║  │  T1: 2,800/3,000             │  │  ⚔ Shadow Blade     +15% ATK      │ ║
║  │  T2:   450/500               │  │  ◎ Precision Ring    +20% CRIT     │ ║
║  │  T3:    85/100               │  │  ◆ Lucky Charm       +25% LOOT     │ ║
║  │                               │  │                                    │ ║
║  │  Weapons: 200⚔ 80🏹 12⚙      │  │  Synergy: none yet                │ ║
║  │  Hero: Blade of Valor +15%   │  │  (2 more of same type = bonus)     │ ║
║  └───────────────────────────────┘  └────────────────────────────────────┘ ║
║                                                                            ║
║  ┌─ PENDING REWARDS ── gold-border ─────────────────────────────────────┐  ║
║  │  XP: 4,200   ◆ NOVI: 1,800   ✦ Gems: 120   Materials: 5            │  ║
║  │  (font-mono amber-400, each with subtle glow)                        │  ║
║  └──────────────────────────────────────────────────────────────────────┘  ║
║                                                                            ║
║         [⚔ ATTACK ×1]    [⚔ ×3]    [⚔ ×5]    [✕ FLEE]                    ║
║          (gold primary)  (gold)     (gold)     (danger ghost)              ║
║                                                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### 4.4 Estate Management

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ── YOUR ESTATE ──  (shimmer-gold)                                         ║
║  New York  ·  8 plots  ·  Estate Level 38  ·  Last activity: 2h ago       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  BUILDINGS (hover any card for gold-border + bonus tooltip)                ║
║  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐           ║
║  │ ♛ MANSION        │ │ ⚔ BARRACKS       │ │ ⚙ WORKSHOP       │           ║
║  │ Level 5          │ │ Level 4          │ │ Level 6          │           ║
║  │ ████████░░ (bar) │ │ ██████░░░░       │ │ ██████████░░     │           ║
║  │ +20% happiness   │ │ +20% unit cap    │ │ Mine T6 unlocked │           ║
║  │ [Upgrade ◆1,200] │ │ [Upgrade ◆800]   │ │ ⚙ UPGRADING 4h   │           ║
║  └──────────────────┘ └──────────────────┘ └──gold-glow-box───┘           ║
║  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐           ║
║  │ $ VAULT          │ │ ⚓ DOCK           │ │ 🔥 FORGE          │           ║
║  │ Level 3          │ │ Level 3          │ │ Level 2          │           ║
║  │ ████░░░░░░       │ │ ████░░░░░░       │ │ ██░░░░░░░░       │           ║
║  │ +vault capacity  │ │ Fish T3 unlocked │ │ Craft Rare wpns  │           ║
║  │ [Upgrade ◆600]   │ │ [Upgrade ◆600]   │ │ [Upgrade ◆400]   │           ║
║  └──────────────────┘ └──────────────────┘ └──────────────────┘           ║
║  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐           ║
║  │ 📖 ACADEMY        │ │ ⚔ ARENA          │ │ ✦ SANCTUARY       │           ║
║  │ Level 1          │ │ Level 2          │ │ Level 3          │           ║
║  │ █░░░░░░░░░       │ │ ██░░░░░░░░       │ │ ████░░░░░░       │           ║
║  │ +5% XP gain      │ │ Arena access     │ │ +15% meditate    │           ║
║  │ [Upgrade ◆200]   │ │ [Upgrade ◆400]   │ │ [Upgrade ◆600]   │           ║
║  └──────────────────┘ └──────────────────┘ └──────────────────┘           ║
║                                                                            ║
║  EMPTY PLOTS                                                               ║
║  ┌──────────────────┐ ┌──────────────────┐                                ║
║  │ ┄┄ Plot 7 ┄┄     │ │ ┄┄ Plot 8 ┄┄     │                                ║
║  │ (zinc-800 dashed) │ │ (zinc-800 dashed) │                                ║
║  │ [+ Build]         │ │ [+ Build]         │                                ║
║  └──────────────────┘ └──────────────────┘                                ║
║                                                                            ║
║  [◆ Buy Plot · 15,000 NOVI]  [⚔ Recover Troops]  [● Daily Activity]       ║
║                                                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### 4.5 Castle View

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ── IRON FORTRESS ──  (shimmer-gold)                                       ║
║  ♛ Stronghold  ·  Chicago  ·  PROTECTED ●                                  ║
║  King: WarLordPrime (Vanguard)  ·  Protection: 8d 14h                     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  GARRISON  12/15                              COURT  2/3                   ║
║  ┌──────────────────────────────────────┐    ┌────────────────────────────┐║
║  │ Player         Units    Joined       │    │ Advisor  · CryptoSage     │║
║  │─────────────────────────────────────│    │ +15% ATK for garrison     │║
║  │ ♛ WarLordPrime  8,200   12d ago     │    │                            │║
║  │   IronShield    4,500    8d ago     │    │ Scholar  · BookWorm42     │║
║  │   StormBlade    3,200    5d ago     │    │ +20% research speed       │║
║  │   ... 9 more                        │    │                            │║
║  │                                      │    │ Guardian · ── vacant ──   │║
║  │ Total Power: 156,800  (gold-glow)   │    │ [Appoint →]               │║
║  └──────────────────────────────────────┘    └────────────────────────────┘║
║                                                                            ║
║  UPGRADES                                                                  ║
║  ┌──────────────┬──────────────┬──────────────┬──────────────┬───────────┐ ║
║  │Fortification │ Treasury     │ Chambers     │ Watchtower   │ Armory    │ ║
║  │ Lv 8         │ Lv 5         │ Lv 2         │ Lv 4         │ Lv 6      │ ║
║  │ +4,000 DEF   │ +5K reward   │ +1 court     │ +4km scout   │ +1.8K wpn│ ║
║  │ [Upgrade]    │ [Upgrade]    │ [Upgrade]    │ [Upgrade]    │ [Upgrade] │ ║
║  └──────────────┴──────────────┴──────────────┴──────────────┴───────────┘ ║
║                                                                            ║
║  DAILY REWARDS  (gold-border card)                                         ║
║  ┌──────────────────────────────────────────────────────────────────────┐  ║
║  │  ♛ King:    ◆ 500K + $ 1M / day                                     │  ║
║  │  ★ Court:   ◆  50K + $ 100K / day                                   │  ║
║  │  ● Member:  ◆   5K + $ 25K / day                                    │  ║
║  │                                                [◆ CLAIM REWARDS]     │  ║
║  └──────────────────────────────────────────────────────────────────────┘  ║
║                                                                            ║
║  [⚔ Join Garrison]  [⚙ Initiate Upgrade]  [✕ Leave]                       ║
║                                                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## 5. State Management Detail

### 5.1 Zustand Store

```typescript
// store/game.ts
interface GameStore {
  // UI state
  selectedCityId: number | null;
  sidebarOpen: boolean;
  activeModal: string | null;

  // Wallet-derived
  walletConnected: boolean;
  playerPda: PublicKey | null;

  // Cached for fast access (updated via WS)
  playerSnapshot: PlayerAccount | null;
  gameEngineSnapshot: GameEngine | null;

  // Actions
  setSelectedCity: (id: number) => void;
  setPlayerSnapshot: (p: PlayerAccount) => void;
  setGameEngineSnapshot: (ge: GameEngine) => void;
}
```

### 5.2 Query Key Convention

```
['gameEngine']                           # Global config
['player', walletBase58]                 # Player account
['user', walletBase58]                   # User account
['city', cityId]                         # City
['cities']                               # All cities list
['encounters', cityId]                   # Encounters in city
['encounter', cityId, encounterId]       # Single encounter
['team', teamId]                         # Team
['teamMembers', teamPubkey]              # Team members
['rally', creatorBase58, rallyIndex]     # Rally
['activeRallies']                        # All active rallies
['reinforcement', sender, recipient]     # Reinforcement
['expedition', playerBase58]             # Expedition
['loot', playerPdaBase58]               # Player's loot
['arenaSeason', seasonId]                # Arena season
['arenaParticipant', seasonId, player]   # Arena participant
['castle', castleId]                     # Castle
['shopConfig']                           # Shop config
['dungeonRun', playerBase58]             # Active dungeon
```

---

## 6. Key Hooks Reference

### Core Hooks

| Hook | Fetches | Subscribes | Invalidates |
|------|---------|------------|-------------|
| `usePlayer(owner)` | PlayerAccount | WS player changes | on TX success |
| `useGameEngine()` | GameEngine | WS gameEngine | rarely |
| `useCity(id)` | CityAccount | WS city | on travel |
| `useEncounters(cityId)` | EncounterAccount[] | WS encounters | on attack |
| `useTeam(teamId)` | TeamAccount | WS team | on team action |
| `useLoot(playerPda)` | LootAccount[] | WS loot | on claim |
| `useExpedition(player)` | ExpeditionAccount | WS expedition | on claim |
| `useDungeon(player)` | DungeonRunAccount | WS dungeon | on action |
| `useArena(seasonId)` | ArenaSeasonAccount | WS arena | on battle |
| `useCastle(castleId)` | CastleAccount | WS castle | on action |

### Derived Hooks

| Hook | Computes | From |
|------|----------|------|
| `useStamina()` | Current stamina (time-interpolated) | `player.encounterStamina + lastStaminaUpdate` |
| `useNetworth()` | Current networth | SDK `calculateNetworth()` from player state |
| `useTravelProgress()` | % complete, ETA | `player.departureTime + arrivalTime` |
| `useCombatPower()` | Offensive/defensive power | SDK `calculateCombatPower()` |
| `useResearchBuffs()` | Active buff summary | player research BPS fields |
| `useHeroBuffs()` | Active hero buff summary | player hero BPS fields |
| `useSubscriptionStatus()` | Tier, active, expires | `player.subscriptionTier + subscriptionEnd` |
| `useDailyRewards()` | Available, cooldown | `player.lastDailyClaim + hasDailyRewards` |

---

## 7. Transaction Patterns

### 7.1 Standard Action (e.g., Hire Units)

```typescript
function HirePanel() {
  const { mutate: transact, isPending } = useTransact();
  const player = usePlayer(wallet.publicKey);
  const gameEngine = useGameEngine();

  function handleHire(unitType: number, quantity: number) {
    // 1. Client-side validation (SDK validators)
    const error = validateHireUnits(player, gameEngine, unitType, quantity);
    if (error) { toast.error(error); return; }

    // 2. Build instruction
    const ix = createHireUnitsInstruction({
      gameEngine: gameEnginePda,
      player: playerPda,
      owner: wallet.publicKey,
      unitType,
      quantity,
    });

    // 3. Send TX
    transact([ix]);
  }

  return (
    <div>
      {/* Unit type selector, quantity input, cost display */}
      <TxButton onClick={() => handleHire(selectedUnit, qty)} loading={isPending}>
        Hire {qty} units ({formatNovi(cost)} NOVI)
      </TxButton>
    </div>
  );
}
```

### 7.2 Multi-Instruction (e.g., Collect + Claim)

Some user flows batch multiple instructions into one TX:

```typescript
const ixs = [
  createCollectResourcesInstruction({ ... }),
  createClaimLootInstruction({ ..., lootId: 1 }),
  createClaimLootInstruction({ ..., lootId: 2 }),
];
transact(ixs);
```

### 7.3 Event Notifications

After every TX, parse events from logs and display:

```typescript
// Events from SDK: CombatResult, LootDropped, LevelUp, etc.
// Map to user-friendly toasts:
switch (event.type) {
  case 'CombatResult':
    toast(`Battle ${event.won ? 'WON' : 'LOST'} — ${event.loot} NOVI looted`);
    break;
  case 'LevelUp':
    toast(`Level Up! You are now level ${event.newLevel}`);
    break;
  case 'LootDropped':
    toast(`New loot available! Check your drops.`);
    break;
}
```

---

## 8. Navigation Structure

### Sidebar (Desktop)

```
Dashboard           ← /dashboard
Map & Travel        ← /map, /travel
City                ← /city/[id]
──────────
Combat              ← /combat
  Encounters        ← /city/[id] (encounters tab)
  Arena             ← /arena
  Dungeon           ← /dungeon
──────────
Economy             ← /inventory
  Hire Units
  Purchase Equipment
  Forge             ← /forge
  Shop              ← /shop
──────────
Team                ← /team
  Rally             ← /rally
  Reinforcement     (inline on team page)
──────────
Kingdom
  Estate            ← /estate
  Research          ← /research
  Castle            ← /castle
  Expedition        ← /expedition
──────────
Heroes              ← /hero
  Sanctuary         ← /sanctuary
──────────
Leaderboard         ← /leaderboard
Settings            ← /settings
```

### Bottom Nav (Mobile — 5 tabs)

```
[Home]  [City]  [Combat]  [Kingdom]  [Profile]
```

---

## 9. Real-Time Features

### 9.1 WebSocket Subscriptions

On wallet connect, automatically subscribe to:

1. **Player account** — all resource/unit/location changes
2. **Active expedition** (if any) — strike readiness
3. **Active dungeon run** (if any) — room changes
4. **Current city encounters** — HP changes from other attackers
5. **Team account** (if in team) — member changes
6. **Loot accounts** — new drops

On navigation to specific pages, add subscriptions:
- Castle page → castle account
- Arena page → season account
- Rally page → rally accounts

### 9.2 Client-Side Timers

These don't need RPC calls — computed from last-known state:

| Timer | Source |
|-------|--------|
| Stamina regen | `lastStaminaUpdate + STAMINA_REGEN_INTERVAL` |
| Travel ETA | `departureTime → arrivalTime` |
| Expedition timer | `startTime + duration` |
| Expedition strike ready | `startTime + strikes * 3600` |
| Castle protection | `claimedAt + protectionDuration` |
| Castle upgrade | `upgradeEndAt` |
| Rally gathering | `rally.startTime + recruiting_duration` |
| Dungeon time limit | `startedAt + timeLimitSeconds` |
| Subscription expiry | `subscriptionEnd` |
| New player protection | `newPlayerProtectionUntil` |
| Daily claim cooldown | `lastDailyClaim + dailyRewardCooldown` |
| Meditation timer | `meditationStartedAt + duration` |

---

## 10. Solito Migration Path (Mobile)

### Phase 1: Web Only (Now)
- Build everything in `apps/web` with Next.js
- Use shadcn/ui components (Tailwind)
- Standard `@solana/wallet-adapter-react`

### Phase 2: Extract Shared Logic
- Move game logic hooks to `packages/game-logic`
- Move pure UI components to `packages/ui`
- Keep platform-specific components in `apps/web`

### Phase 3: Add React Native
- `apps/mobile` with Expo + Solito
- Replace `next/link` → Solito `Link`
- Replace `next/router` → Solito `useRouter`
- Replace shadcn → React Native Paper / Tamagui (black & gold theme carries over)
- Wallet: `@solana/mobile-wallet-adapter-walletlib`
- Share hooks, calculators, state management
- 3D estate view: `expo-three` + `expo-gl` wrapping the same TownRenderer

### What Shares Across Platforms
- All Zustand stores
- All TanStack Query hooks
- All SDK interactions (novus-mundus-ts)
- All calculator logic
- Business logic (validation, formatting)

### What Stays Platform-Specific
- Navigation (Next.js routes vs React Navigation)
- Wallet adapter (browser vs mobile)
- Platform-specific UI components
- Push notifications (mobile only)

---

## 11. Performance Considerations

### RPC Optimization
- **Batch fetches**: Use `fetchMultiple()` for dashboard (player + city + team in 1 call)
- **Stale-while-revalidate**: TanStack Query `staleTime: 10_000` + WS invalidation
- **Lazy load**: Only subscribe to castle/arena when user navigates there
- **No polling**: WebSocket subscriptions replace all polling

### Bundle Size
- Tree-shake SDK imports — only import needed instructions/calculators
- Dynamic imports for heavy pages (dungeon, arena, castle)
- SDK calculators are pure functions — no Solana dependencies

### Rendering
- Dashboard stats → client component with `usePlayer()` hook
- City list → server component (fetch cities once, client hydrate)
- Leaderboard → server component + ISR (revalidate every 60s)
- Dungeon combat → client component (realtime updates critical)

---

## 12. Design System — Black & Gold

### 12.1 Philosophy

Dark, opulent, military. The UI should feel like a war room made of obsidian and gold leaf.
No cartoon colors. No friendly rounded corners. Precision. Power. Elegance.

### 12.2 Color Palette

```css
/* === tailwind.config.ts extend === */

/* Foundations — pure black depth */
--bg-void:        #09090b;       /* zinc-950 — page background */
--bg-surface:     #18181b;       /* zinc-900 — card surface */
--bg-raised:      #27272a;       /* zinc-800 — elevated panels, hover states */
--bg-muted:       #3f3f46;       /* zinc-700 — disabled, dividers */

/* Gold Spectrum — the signature */
--gold-dim:       #92400e;       /* amber-800 — subtle borders, inactive */
--gold:           #d97706;       /* amber-600 — standard accent */
--gold-bright:    #f59e0b;       /* amber-500 — active states, CTAs */
--gold-shine:     #fbbf24;       /* amber-400 — highlights, selected */
--gold-glow:      #fde68a;       /* amber-200 — shimmer text, radiant */
--gold-white:     #fef3c7;       /* amber-50  — brightest flash */

/* Text */
--text-primary:   #fafafa;       /* zinc-50 — headings, important */
--text-secondary: #a1a1aa;       /* zinc-400 — body, descriptions */
--text-muted:     #71717a;       /* zinc-500 — labels, hints */
--text-gold:      #fbbf24;       /* amber-400 — emphasized values */

/* Semantic */
--success:        #22c55e;       /* green-500 — positive, gains */
--danger:         #ef4444;       /* red-500 — losses, warnings */
--info:           #3b82f6;       /* blue-500 — links, info */

/* Rarity Scale (gold-influenced) */
--rarity-common:     #a1a1aa;    /* zinc-400 */
--rarity-uncommon:   #22c55e;    /* green-500 */
--rarity-rare:       #3b82f6;    /* blue-500 */
--rarity-epic:       #a855f7;    /* purple-500 */
--rarity-legendary:  #fbbf24;    /* amber-400 — matches the gold theme */
--rarity-mythic:     #f43f5e;    /* rose-500 — reserved, ultra-rare */
```

### 12.3 Typography

```
Font Stack:     Inter (body) + JetBrains Mono (numbers, stats, mono)
Headings:       font-semibold tracking-tight text-zinc-50
Page titles:    text-2xl with gold shimmer effect
Section heads:  text-sm uppercase tracking-[0.2em] text-amber-500/80 font-medium
Body:           text-sm text-zinc-400
Stats/numbers:  font-mono tabular-nums text-amber-400
Large numbers:  text-3xl font-mono font-bold text-amber-400 (NOVI balance, power)
Labels:         text-xs uppercase tracking-wider text-zinc-500
```

### 12.4 Effects Catalog

Every effect is CSS/anime.js only. No images, no canvas (until 3D phase).

#### Gold Shimmer Text (headings, titles)
```css
.shimmer-gold {
  background: linear-gradient(
    110deg,
    #d97706 0%,      /* amber-600 */
    #fde68a 45%,     /* amber-200 — bright sweep */
    #d97706 55%,     /* back to amber-600 */
    #fbbf24 100%     /* amber-400 */
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: shimmer 3s ease-in-out infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```
Usage: Page titles ("NOVUS MUNDUS"), section headers, level-up text.

#### Gold Gradient Border (cards, panels)
```css
.gold-border {
  position: relative;
  border: 1px solid transparent;
  background:
    linear-gradient(var(--bg-surface), var(--bg-surface)) padding-box,
    linear-gradient(135deg, #92400e, #fbbf24, #92400e) border-box;
}
```
Usage: Primary cards, active states, selected items.

#### Glow Pulse (important values, CTAs)
```css
.gold-glow {
  text-shadow: 0 0 8px rgba(251, 191, 36, 0.4),
               0 0 20px rgba(251, 191, 36, 0.15);
}
.gold-glow-box {
  box-shadow: 0 0 12px rgba(251, 191, 36, 0.15),
              0 0 40px rgba(251, 191, 36, 0.05);
}
```
Usage: NOVI balance, power number, unclaimed loot count.

#### Noise Texture Overlay (surface depth)
```css
.surface-noise {
  background-image: url("data:image/svg+xml,..."); /* tiny inline SVG noise */
  background-size: 200px;
  opacity: 0.03;
  pointer-events: none;
  mix-blend-mode: overlay;
}
```
Usage: Card backgrounds, sidebar — adds subtle texture without images.

#### Animated Progress Bar (HP, XP, building)
```css
.bar-gold {
  background: linear-gradient(90deg, #92400e, #f59e0b, #fbbf24);
  background-size: 200% 100%;
  animation: bar-flow 2s linear infinite;
  border-radius: 2px;
}
@keyframes bar-flow {
  0% { background-position: 0% 0; }
  100% { background-position: 200% 0; }
}
```
Usage: XP bar, building progress, health bars. Danger bars use red gradient.

#### Radial Vignette (page depth)
```css
.vignette {
  background: radial-gradient(
    ellipse at center,
    transparent 50%,
    rgba(0, 0, 0, 0.4) 100%
  );
  pointer-events: none;
}
```
Usage: Full-page overlay behind main content — cinematic feel.

#### anime.js Patterns
```typescript
// Card entrance — stagger children
anime({
  targets: '.card',
  translateY: [12, 0],
  opacity: [0, 1],
  delay: anime.stagger(50),
  duration: 400,
  easing: 'easeOutQuad',
});

// Number count-up (NOVI, power, etc.) — see §17.2 <GoldNumber />
// Uses anime.js .update() callback for frame-perfect interpolation

// Page transitions — see §17.9 <PageTransition />
anime({
  targets: '.page-content > *',
  translateY: [12, 0],
  opacity: [0, 1],
  delay: anime.stagger(60, { start: 100 }),
  duration: 500,
  easing: 'easeOutQuad',
});

// Gold pulse on value change
anime({
  targets: el,
  textShadow: ['0 0 0px #fbbf24', '0 0 20px #fbbf24', '0 0 4px rgba(251,191,36,0.2)'],
  duration: 600,
  easing: 'easeOutQuad',
});

// Hover lift on cards (CSS + anime.js for complex cases)
anime({
  targets: '.card:hover',
  translateY: -2,
  boxShadow: '0 0 20px rgba(251,191,36,0.1)',
  duration: 200,
  easing: 'easeOutQuad',
});
```

### 12.5 Component Styling Guide

#### Cards
```
Default card:   bg-zinc-900 border border-zinc-800 rounded-lg
Active card:    bg-zinc-900 gold-border rounded-lg gold-glow-box
Hover:          bg-zinc-800/50 border-amber-800/50
Selected:       bg-zinc-900 border-amber-500 gold-glow-box
Disabled:       bg-zinc-900/50 border-zinc-800/50 opacity-60
```

#### Buttons
```
Primary:        bg-amber-600 hover:bg-amber-500 text-zinc-950 font-semibold
                shadow-[0_0_12px_rgba(245,158,11,0.3)]
                active:shadow-[0_0_20px_rgba(245,158,11,0.5)]
Secondary:      bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200
Danger:         bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-400
Ghost:          bg-transparent hover:bg-zinc-800 text-zinc-400
Loading:        animate-pulse bg-amber-600/50 cursor-wait
```

#### Badges (rarity/tier)
```
Common:         bg-zinc-800 text-zinc-400 border border-zinc-700
Uncommon:       bg-green-500/10 text-green-400 border border-green-500/30
Rare:           bg-blue-500/10 text-blue-400 border border-blue-500/30
Epic:           bg-purple-500/10 text-purple-400 border border-purple-500/30
Legendary:      bg-amber-500/10 text-amber-400 border border-amber-500/30 gold-glow
Mythic:         bg-rose-500/10 text-rose-400 border border-rose-500/30 animate-pulse
```

#### Stat Bars
```
Container:      bg-zinc-800 h-2 rounded-full overflow-hidden
Fill (HP high): bg-gradient-to-r from-emerald-600 to-emerald-400
Fill (HP mid):  bg-gradient-to-r from-amber-600 to-amber-400
Fill (HP low):  bg-gradient-to-r from-red-600 to-red-400 animate-pulse
Fill (XP):      bar-gold (animated gold gradient)
Fill (build):   bg-gradient-to-r from-amber-800 to-amber-500
Label:          text-xs font-mono absolute right-2 text-zinc-300
```

#### Data Tables / Lists
```
Header row:     bg-zinc-900 text-xs uppercase tracking-wider text-zinc-500
Row:            border-b border-zinc-800/50 hover:bg-zinc-800/30
Alternate:      even:bg-zinc-900/30
Gold row:       bg-amber-500/5 border-l-2 border-amber-500 (your rank, your entry)
```

#### Sidebar
```
Background:     bg-zinc-950 border-r border-zinc-800
Active item:    bg-amber-500/10 text-amber-400 border-l-2 border-amber-500
Inactive item:  text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900
Section header: text-[10px] uppercase tracking-[0.25em] text-zinc-600 mt-6 mb-2 px-4
```

#### TopBar
```
Background:     bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800
NOVI display:   font-mono text-lg text-amber-400 gold-glow
Stamina bar:    inline h-1.5 bar-gold (mini animated)
Player name:    text-zinc-100 font-semibold
Level badge:    bg-amber-500/20 text-amber-400 text-xs font-mono px-2 py-0.5 rounded
```

### 12.6 Icon System (Text Phase)

No icon library in the text phase. Use styled text symbols + emoji fallbacks:

```
Resource Icons (monospace):
  NOVI:     ◆  (or text "NOVI" in amber-400)
  Cash:     $  (or text "CASH" in zinc-300)
  Gems:     ✦  (amber-300)
  Stamina:  ⚡ (amber-400, mini bar next to it)
  Power:    ⚔  (zinc-200)

Status Symbols:
  Active:     ● (emerald-500)
  Inactive:   ○ (zinc-600)
  Warning:    ▲ (amber-400)
  Error:      ✕ (red-500)
  Timer:      ◷ (zinc-400)
  Loading:    ◌ (animate-spin)

Building Tiers:
  T1: single bar   ─
  T2: double bar   ═
  T3: ornate       ☰
  T4: crown        ♛
```

### 12.7 Notification Toasts

```
Success:   left gold border, bg-zinc-900, gold-glow-box, amber icon
            "Battle Won — +4,200 NOVI looted"
Error:     left red border, bg-zinc-900, red text
            "Insufficient stamina — 12/50 required"
Info:      left blue border, bg-zinc-900
            "Expedition complete — claim your rewards"
Level Up:  full-width gold shimmer banner, large text, particle burst (CSS)
            "⚔ LEVEL 43 — New abilities unlocked"
Loot:      slides in from right, gold-border card, rarity-colored
            "EPIC drop: Shadow Blade (+15% ATK)"
```

### 12.8 Special Screens

#### Loading State
```
Full-screen bg-zinc-950
Centered:
  "NOVUS MUNDUS" in shimmer-gold, text-4xl
  Thin gold bar animating left→right beneath
  "Connecting to the realm..." text-zinc-500 text-sm
```

#### Empty States
```
Centered in card, py-16
  Large symbol in text-zinc-700 (e.g., ⚔ for no combat history)
  "No active expeditions" text-zinc-500
  [Start Expedition] gold CTA button
```

#### Level Up Moment
```
Full-screen overlay with vignette
  Gold particle burst (CSS radial keyframes)
  Large level number with count-up animation
  "LEVEL 43" shimmer-gold text-5xl
  Stat gains listed with gold-glow numbers
  Auto-dismiss after 3s or click
```

#### Combat Result
```
Full-width panel slides up
  Left: "VICTORY" shimmer-gold or "DEFEAT" in red-500
  Center: Loot gained (animated count-up per item)
  Right: Unit casualties (red numbers)
  Gold divider line
  [Collect] button or auto-dismiss
```

### 12.9 Responsive Breakpoints

```
Mobile (<640):   Single column, bottom nav, stacked cards, compact stats
Tablet (640-1024): Two-column dashboard, collapsible sidebar
Desktop (>1024):  Three-column where needed, fixed sidebar, full stat display
Ultrawide (>1440): Max-width 1400px centered, vignette fills edges
```

### 12.10 Visual Text Patterns

| Element | Representation |
|---------|---------------|
| Health bars | Gradient-filled `<div>` with bar-gold or red pulse |
| Progress | Animated fill bar with % label |
| Rarity | Colored badge with border glow for legendary+ |
| Status | Dot indicator (●/○) + text |
| Timers | `2h 14m 33s` font-mono amber-400, tick animation |
| Resources | Right-aligned tabular-nums amber-400 |
| Unit tiers | `T1: 5,000  T2: 1,200  T3: 180` monospace grid |
| Power | Large amber-400 number with gold-glow |
| Buildings | Name + level badge + animated progress bar |
| Map | City cards with distance, player count badges |
| Combat log | `[14:23] You dealt 4,200 damage` — green/red per line |

---

## 13. Error Handling

### On-Chain Errors
Map SDK error codes to user-friendly messages:

```typescript
// From sdk errors.ts → UI error map
const ERROR_MESSAGES: Record<number, string> = {
  6000: "Not enough NOVI for this action",
  6001: "Not enough stamina — wait for regen or purchase",
  6002: "Player is currently traveling",
  6003: "Target out of range — move closer first",
  // ... etc
};
```

### Optimistic Updates
For fast-feedback actions (hire units, transfer cash):
1. Show spinner immediately
2. Optimistically update local cache
3. Wait for TX confirmation
4. If fail → revert + show error toast

### Wallet Errors
- Wallet not connected → redirect to connect page
- TX rejected by user → "Transaction cancelled"
- Insufficient SOL → "Need SOL for transaction fees"
- RPC error → retry with exponential backoff (3 attempts)

---

## 14. Landing Page — First Impression

The connect-wallet screen sets the tone. This is the first thing players see.

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║                        (radial gold gradient center,                       ║
║                         fading to black edges — vignette)                  ║
║                                                                            ║
║                                                                            ║
║                                                                            ║
║                         ✦  N O V U S   M U N D U S  ✦                     ║
║                         (shimmer-gold, text-5xl, letter-spacing 0.3em)     ║
║                                                                            ║
║                         A NEW WORLD AWAITS                                 ║
║                         (text-zinc-500, text-sm, tracking-[0.2em])         ║
║                                                                            ║
║                                                                            ║
║                        ┌──────────────────────────────┐                    ║
║                        │  ◆ CONNECT WALLET             │                    ║
║                        │  (gold primary button, large,  │                    ║
║                        │   gold-glow-box, hover lift)   │                    ║
║                        └──────────────────────────────┘                    ║
║                                                                            ║
║                                                                            ║
║                        Powered by Solana                                   ║
║                        (text-zinc-600, text-xs)                            ║
║                                                                            ║
║                                                                            ║
║  ── live stats ticker (bottom, scrolling left) ───────────────────────     ║
║  342 players online · 12 rallies active · 8 castles contested · ...        ║
║  (text-zinc-600 text-xs, gold highlight on numbers)                        ║
║                                                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

Ambient effects (all CSS, no canvas):
- Subtle gold particle drift using CSS `@keyframes` + pseudo-elements
- Background noise texture at 2% opacity
- Very slow radial gradient animation (breathe effect on the gold center)
- Stats ticker auto-scrolls with `marquee`-style CSS animation

---

## 15. 3D Readiness (Architecture Only — Build Later)

The terrain builder (`terrain-builder/src/town/`) is a complete Three.js 0.170.0 pipeline
with 38 modules, 52+ GLB models, and 14+ PBR texture packs. It will become the 3D estate
view when assets are complete. The text-based UI is designed to swap in 3D without
restructuring.

### 15.1 Integration Point

The estate page has a single slot for the 3D view:

```typescript
// apps/web/app/(game)/estate/page.tsx

// Phase 1: Text-based (NOW)
<EstateGrid buildings={player.buildings} />

// Phase 2: 3D view (LATER) — drop-in replacement
// import { TownCanvas } from '@novus/town-renderer';
// <TownCanvas estate={estate} player={player} gameEngine={gameEngine} />
```

### 15.2 What Exists (terrain-builder/)

```
Ready:
  ✓ TownRenderer.js         — Main orchestrator (15 subsystems)
  ✓ TownStateManager.js     — On-chain state → visual state mapper
  ✓ BuildingFactory.js       — Procedural + GLB building placement
  ✓ BuildingAnimator.js      — Construction, upgrade, idle animations
  ✓ TownTerrainBuilder.js   — 128×128 heightmap with biome shading
  ✓ WaterSystem.js           — Animated water with reflections
  ✓ DayNightCycle.js         — Full 24h cycle with lighting
  ✓ WeatherSystem.js         — Rain, snow, fog, storms
  ✓ NPCManager.js            — 12 NPC types, instanced (300 max)
  ✓ GrassSystem.js           — GPU instanced grass with wind
  ✓ GPUParticles.js          — Shader-based particle emitters
  ✓ IsometricCamera.js       — Orbit + zoom + building focus
  ✓ AudioManager.js          — 3-layer spatial soundscape
  ✓ AssetManifest.js         — 19 types × 4 tiers = 76 building configs
  ✓ 52+ GLB models           — 13/19 building types complete (all 4 tiers)

Missing (needs art/modeling work):
  ✗ 6 building types need GLB models (camp, mine, catacombs, farm, stables, infirmary)
  ✗ NPC character models (currently procedural boxes)
  ✗ Animal models (currently procedural)
  ✗ Theme reskins (cyberpunk, scifi, modern, post-apocalyptic — only medieval exists)
  ✗ LOD system for mobile (currently desktop-only quality)
```

### 15.3 Migration Plan (When Ready)

```
Step 1: Move terrain-builder/src/town/ → packages/town-renderer/src/
Step 2: Wrap TownRenderer in a React component using @react-three/fiber
Step 3: Create adapter hooks that bridge SDK state → TownStateManager
Step 4: Lazy-load <TownCanvas> on estate page (dynamic import, loading fallback)
Step 5: Add LOD controls for mobile (reduce terrain res, fewer NPCs, simpler shaders)
```

No code changes needed now. The text-based estate grid and the 3D canvas share the same
data contract: `estate.buildings[]`, `player`, `gameEngine`. Swap is a one-line import.

---

## 16. Immediate Next Steps

1. **Scaffold monorepo**: `npx create-turbo@latest` → `apps/web` + `packages/ui`
2. **Install deps**: Next.js 15, Tailwind 4, shadcn/ui, anime.js, @solana/wallet-adapter, zustand, tanstack-query
3. **Configure theme**: Black & gold CSS variables, shimmer/glow utility classes, noise texture
4. **Link SDK**: workspace reference to `novus-mundus-ts`
5. **Build landing page**: Connect wallet with gold ambience
6. **Build game shell**: Sidebar + topbar + layout with gold theme
7. **Build dashboard**: Player overview with all effects
8. **Build city view**: Encounter list + attack action
9. **Build economy**: Hire units, purchase equipment
10. **Iterate**: One system at a time

Priority order for screens (highest player engagement first):
1. Landing page + wallet connect (first impression — must feel elite)
2. Dashboard (command center — the most-seen screen)
3. City view + encounters (core gameplay loop)
4. Economy (hire/purchase — enables combat)
5. Combat (PvP + PvE — the game's main loop)
6. Travel (city-to-city, unlock content)
7. Estate (building management — 3D swap point later)
8. Expedition (idle income)
9. Team + Rally (social features)
10. Dungeon (deep PvE)
11. Arena (competitive PvP)
12. Castle (endgame guild content)
13. Research + Heroes (progression depth)
14. Forge + Shop + Sanctuary (supporting systems)
15. Leaderboards + Settings

---

## 17. anime.js Motion System

anime.js v4 replaces anime.js as the animation engine. It's 17KB gzipped, has no React
dependency (works with refs), supports SVG path morphing, staggered timelines, and spring
physics. Critical for the game: it has a native `.update()` callback for number interpolation
which we use everywhere for rolling counters, damage ticks, and countdown timers.

### 17.1 Core Wrapper — `useAnime`

```typescript
// lib/anime/useAnime.ts
import anime from 'animejs/lib/anime.es.js';
import { useRef, useEffect, useCallback } from 'react';

export function useAnime() {
  const animations = useRef<anime.AnimeInstance[]>([]);

  const animate = useCallback((params: anime.AnimeParams) => {
    const anim = anime(params);
    animations.current.push(anim);
    return anim;
  }, []);

  const timeline = useCallback((params?: anime.AnimeTimelineParams) => {
    const tl = anime.timeline(params);
    animations.current.push(tl);
    return tl;
  }, []);

  // Cleanup all running animations on unmount
  useEffect(() => {
    return () => {
      animations.current.forEach(a => a.pause());
      animations.current = [];
    };
  }, []);

  return { animate, timeline };
}
```

### 17.2 Number Rolling Component — `<GoldNumber />`

Every important number in the game (NOVI balance, cash, power, unit counts, XP) uses
anime.js `.update()` to interpolate between values. The number "rolls" like a slot machine.

```typescript
// components/shared/GoldNumber.tsx
'use client';
import { useRef, useEffect } from 'react';
import anime from 'animejs/lib/anime.es.js';
import { cn } from '@/lib/utils';

interface GoldNumberProps {
  value: number;
  duration?: number;       // ms, default 800
  format?: 'compact' | 'full' | 'novi' | 'percentage';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  glow?: boolean;          // gold text-shadow pulse on change
  prefix?: string;         // "$", "◆", etc.
  suffix?: string;         // "%", " NOVI", etc.
  delta?: boolean;         // show +/- change indicator
  className?: string;
}

export function GoldNumber({
  value, duration = 800, format = 'compact',
  size = 'md', glow = true, prefix, suffix, delta, className,
}: GoldNumberProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const currentRef = useRef({ val: 0 });
  const prevRef = useRef(0);
  const deltaRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const prev = prevRef.current;
    const diff = value - prev;
    prevRef.current = value;

    // Roll the number
    anime({
      targets: currentRef.current,
      val: value,
      round: 1,
      duration: duration,
      easing: 'easeOutExpo',
      update: () => {
        if (spanRef.current) {
          spanRef.current.textContent = formatNumber(currentRef.current.val, format);
        }
      },
    });

    // Gold glow pulse on change
    if (glow && spanRef.current && diff !== 0) {
      anime({
        targets: spanRef.current,
        textShadow: [
          '0 0 0px rgba(251,191,36,0)',
          `0 0 20px rgba(251,191,36,${diff > 0 ? '0.8' : '0'})`,
          '0 0 4px rgba(251,191,36,0.2)',
        ],
        duration: 600,
        easing: 'easeOutQuad',
      });
    }

    // Delta indicator (+1,200 / -500)
    if (delta && deltaRef.current && diff !== 0) {
      deltaRef.current.textContent = (diff > 0 ? '+' : '') + formatNumber(diff, 'compact');
      anime({
        targets: deltaRef.current,
        translateY: [0, -16],
        opacity: [1, 0],
        duration: 1200,
        easing: 'easeOutExpo',
      });
    }
  }, [value]);

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-2xl',
    xl: 'text-4xl font-bold',
  };

  return (
    <span className={cn('font-mono tabular-nums text-amber-400 relative', sizeClasses[size], className)}>
      {prefix}
      <span ref={spanRef}>0</span>
      {suffix}
      {delta && (
        <span ref={deltaRef}
          className="absolute -top-3 left-full ml-1 text-xs font-medium opacity-0"
          style={{ color: value > prevRef.current ? '#22c55e' : '#ef4444' }}
        />
      )}
    </span>
  );
}

function formatNumber(n: number, fmt: string): string {
  if (fmt === 'compact') {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  }
  if (fmt === 'novi') return n.toLocaleString() + ' NOVI';
  if (fmt === 'percentage') return n.toFixed(1) + '%';
  return n.toLocaleString();
}
```

**Usage throughout the app:**
```typescript
<GoldNumber value={player.lockedNovi} prefix="◆ " format="compact" size="lg" delta />
<GoldNumber value={player.cashOnHand} prefix="$ " format="full" />
<GoldNumber value={combatPower} size="xl" glow />
<GoldNumber value={stamina} suffix={`/${maxStamina}`} size="sm" />
```

### 17.3 Countdown Timer — `<GoldCountdown />`

Timers are everywhere: travel, expedition, building, forge, meditation, research, rally,
castle upgrades, subscription expiry, new player protection, dungeon time limits.

```typescript
// components/shared/GoldCountdown.tsx
'use client';
import { useRef, useEffect, useState } from 'react';
import anime from 'animejs/lib/anime.es.js';

interface GoldCountdownProps {
  endsAt: number;                 // Unix timestamp (seconds)
  onComplete?: () => void;        // Callback when timer hits 0
  format?: 'full' | 'compact' | 'colon';  // "2d 14h 33m" | "2d 14h" | "02:14:33"
  urgentThreshold?: number;       // Seconds — below this, pulse red
  showProgress?: boolean;         // Show progress bar
  startedAt?: number;             // For progress bar calculation
  label?: string;                 // "Traveling to Los Angeles"
  size?: 'sm' | 'md' | 'lg';
}

export function GoldCountdown({
  endsAt, onComplete, format = 'full', urgentThreshold = 300,
  showProgress, startedAt, label, size = 'md',
}: GoldCountdownProps) {
  const timerRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const update = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, endsAt - now);

      if (timerRef.current) {
        timerRef.current.textContent = formatTime(remaining, format);
      }

      // Progress bar
      if (barRef.current && startedAt) {
        const total = endsAt - startedAt;
        const elapsed = now - startedAt;
        const pct = Math.min(100, (elapsed / total) * 100);
        barRef.current.style.width = `${pct}%`;
      }

      // Urgent mode — pulse
      if (remaining > 0 && remaining <= urgentThreshold && timerRef.current) {
        timerRef.current.classList.add('text-red-400');
        timerRef.current.classList.remove('text-amber-400');
      }

      if (remaining === 0 && !completed) {
        setCompleted(true);
        onComplete?.();

        // Completion burst
        if (timerRef.current) {
          anime({
            targets: timerRef.current,
            scale: [1, 1.3, 1],
            color: ['#fbbf24', '#22c55e', '#fbbf24'],
            duration: 600,
            easing: 'easeOutElastic(1, .5)',
          });
          timerRef.current.textContent = 'READY';
        }
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endsAt, startedAt]);

  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>}
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">◷</span>
        <span ref={timerRef}
          className={`font-mono tabular-nums text-amber-400 ${
            size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-xs' : 'text-sm'
          }`}
        />
      </div>
      {showProgress && (
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div ref={barRef}
            className="h-full bg-gradient-to-r from-amber-800 to-amber-400 rounded-full transition-[width] duration-1000"
            style={{ width: '0%' }}
          />
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number, fmt: string): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (fmt === 'colon') return `${pad(h + d*24)}:${pad(m)}:${pad(s)}`;
  if (fmt === 'compact') {
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }
  // full
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}
const pad = (n: number) => String(n).padStart(2, '0');
```

**All game timers mapped:**

| Timer | Source | Label |
|-------|--------|-------|
| Travel (intercity) | `player.arrivalTime` | "Traveling to {city}" |
| Travel (intracity) | `player.arrivalTime` | "Moving to {coords}" |
| Expedition | `expedition.startTime + duration` | "Mining Expedition T3" |
| Building construction | `building.constructionEnds` | "Building {name}" |
| Building upgrade | `building.constructionEnds` | "Upgrading {name} Lv{n}" |
| Forge stage window | `craft.windowOpensAt` → `windowClosesAt` | "Strike window!" |
| Meditation | `player.meditationStartedAt + maxDuration` | "Meditating: {hero}" |
| Research | `research.completionTime` | "Researching {name}" |
| Rally gathering | `rally.gatherAt` | "Rally gathering" |
| Rally march | `rally.arriveAt` | "Rally marching" |
| Reinforcement travel | `reinforcement.arrivesAt` | "Reinforcement en route" |
| Castle upgrade | `castle.upgradeEndAt` | "Upgrading {type} Lv{n}" |
| Castle protection | `castle.contestEndAt` | "Protection period" |
| Subscription expiry | `user.subscriptionEnd` | "Subscription expires" |
| New player protection | `player.newPlayerProtectionUntil` | "Protection active" |
| Flash sale | `flashSale.endsAt` | "Sale ends in" |
| Arena season | `season.endTime` | "Season ends in" |
| Loot expiry | `loot.expiresAt` | "Loot expires in" |
| Event end | `event.endTime` | "Event ends in" |

### 17.4 Loading Choreography — `<LoadingSequence />`

Solana state fetching is heavy. We lean into it with choreographed loading sequences
that make the wait feel intentional and cinematic. Each game screen has a unique
loading personality.

```typescript
// components/loading/LoadingSequence.tsx
'use client';
import { useRef, useEffect } from 'react';
import anime from 'animejs/lib/anime.es.js';

interface LoadingStep {
  label: string;       // "Summoning player data..."
  key: string;         // Query key to watch
}

interface LoadingSequenceProps {
  steps: LoadingStep[];
  completedKeys: Set<string>;
  children: React.ReactNode;
}

export function LoadingSequence({ steps, completedKeys, children }: LoadingSequenceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<(HTMLDivElement | null)[]>([]);
  const allDone = steps.every(s => completedKeys.has(s.key));

  // Stagger step entrances
  useEffect(() => {
    anime({
      targets: stepsRef.current.filter(Boolean),
      translateX: [-20, 0],
      opacity: [0, 1],
      delay: anime.stagger(120),
      duration: 400,
      easing: 'easeOutQuad',
    });
  }, []);

  // Mark steps as complete with checkmark animation
  useEffect(() => {
    stepsRef.current.forEach((el, i) => {
      if (!el) return;
      const step = steps[i];
      if (completedKeys.has(step.key)) {
        const check = el.querySelector('.check');
        if (check) {
          anime({
            targets: check,
            scale: [0, 1],
            rotate: ['-45deg', '0deg'],
            duration: 300,
            easing: 'easeOutBack',
          });
        }
      }
    });
  }, [completedKeys]);

  // Reveal content when all done
  useEffect(() => {
    if (allDone && containerRef.current) {
      anime({
        targets: containerRef.current,
        opacity: [1, 0],
        translateY: [0, -20],
        duration: 400,
        easing: 'easeInQuad',
      });
    }
  }, [allDone]);

  if (allDone) return <>{children}</>;

  return (
    <div ref={containerRef} className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <h2 className="shimmer-gold text-2xl font-semibold tracking-wide">
        NOVUS MUNDUS
      </h2>
      <div className="flex flex-col gap-3 w-80">
        {steps.map((step, i) => {
          const done = completedKeys.has(step.key);
          return (
            <div key={step.key} ref={el => stepsRef.current[i] = el}
              className="flex items-center gap-3 opacity-0"
            >
              {done ? (
                <span className="check text-amber-400 scale-0">●</span>
              ) : (
                <span className="text-zinc-600 animate-pulse">◌</span>
              )}
              <span className={done ? 'text-zinc-400' : 'text-zinc-500'}>
                {step.label}
              </span>
              {done && <span className="text-zinc-600 text-xs ml-auto">✓</span>}
            </div>
          );
        })}
      </div>
      <div className="w-48 h-0.5 bg-zinc-800 rounded-full overflow-hidden mt-4">
        <div className="h-full bg-gradient-to-r from-amber-800 to-amber-400 rounded-full"
          style={{ width: `${(completedKeys.size / steps.length) * 100}%`, transition: 'width 0.5s ease' }}
        />
      </div>
    </div>
  );
}
```

### 17.5 Per-Screen Loading Sequences

Each screen fetches different Solana accounts. The loading sequence tells the player
what's happening:

**Dashboard:**
```typescript
const DASHBOARD_STEPS = [
  { label: 'Summoning your warrior...', key: 'player' },
  { label: 'Reading the realm ledger...', key: 'gameEngine' },
  { label: 'Scanning your domain...', key: 'user' },
  { label: 'Checking unclaimed loot...', key: 'loot' },
];
```

**City View:**
```typescript
const CITY_STEPS = [
  { label: 'Entering the city gates...', key: 'city' },
  { label: 'Scouting for encounters...', key: 'encounters' },
  { label: 'Counting heads at the tavern...', key: 'players' },
];
```

**Estate:**
```typescript
const ESTATE_STEPS = [
  { label: 'Surveying your lands...', key: 'estate' },
  { label: 'Inspecting the buildings...', key: 'player' },
  { label: 'Checking daily windows...', key: 'gameEngine' },
];
```

**Dungeon:**
```typescript
const DUNGEON_STEPS = [
  { label: 'Descending into darkness...', key: 'dungeonRun' },
  { label: 'Readying your hero...', key: 'player' },
  { label: 'Lighting the torches...', key: 'template' },
];
```

**Arena:**
```typescript
const ARENA_STEPS = [
  { label: 'Entering the colosseum...', key: 'season' },
  { label: 'Reviewing your loadout...', key: 'loadout' },
  { label: 'Checking the standings...', key: 'participant' },
];
```

**Castle:**
```typescript
const CASTLE_STEPS = [
  { label: 'Approaching the fortress...', key: 'castle' },
  { label: 'Inspecting the garrison...', key: 'garrison' },
  { label: 'Reading court decrees...', key: 'court' },
];
```

**Shop:**
```typescript
const SHOP_STEPS = [
  { label: 'Browsing the wares...', key: 'shopConfig' },
  { label: 'Checking your coin purse...', key: 'player' },
  { label: 'Hunting for flash sales...', key: 'flashSales' },
];
```

**Hero Management:**
```typescript
const HERO_STEPS = [
  { label: 'Assembling your champions...', key: 'heroes' },
  { label: 'Reading their legends...', key: 'player' },
  { label: 'Checking the sanctuary...', key: 'estate' },
];
```

### 17.6 Transaction Animations

Every on-chain transaction follows a 4-phase animation:

```typescript
// components/shared/TxButton.tsx
// Phase 1: PREPARING (user clicked, building TX)
// Phase 2: SIGNING   (wallet popup, waiting for signature)
// Phase 3: SENDING   (TX sent, awaiting confirmation)
// Phase 4: CONFIRMED (success) or FAILED (error)

function TxButton({ onClick, children, ...props }) {
  const [phase, setPhase] = useState<'idle'|'preparing'|'signing'|'sending'|'confirmed'|'failed'>('idle');
  const btnRef = useRef<HTMLButtonElement>(null);

  const phaseAnimations = {
    preparing: () => {
      anime({
        targets: btnRef.current,
        scale: [1, 0.97],
        duration: 200,
      });
      // Gold border pulse
      anime({
        targets: btnRef.current,
        boxShadow: [
          '0 0 0px rgba(251,191,36,0)',
          '0 0 20px rgba(251,191,36,0.3)',
        ],
        direction: 'alternate',
        loop: true,
        duration: 800,
        easing: 'easeInOutSine',
      });
    },

    signing: () => {
      // Wallet icon pulse
      anime({
        targets: '.wallet-icon',
        scale: [1, 1.1, 1],
        duration: 1000,
        loop: true,
        easing: 'easeInOutSine',
      });
    },

    sending: () => {
      // Progress bar races across button
      anime({
        targets: '.tx-progress',
        width: ['0%', '100%'],
        duration: 4000,
        easing: 'easeInOutQuad',
      });
    },

    confirmed: () => {
      anime.timeline()
        .add({
          targets: btnRef.current,
          backgroundColor: ['#d97706', '#22c55e'],
          scale: [0.97, 1.05, 1],
          duration: 500,
          easing: 'easeOutElastic(1, .6)',
        })
        .add({
          targets: btnRef.current,
          backgroundColor: '#d97706',
          duration: 1000,
          delay: 800,
        });
    },

    failed: () => {
      // Shake
      anime({
        targets: btnRef.current,
        translateX: [0, -6, 6, -4, 4, 0],
        duration: 400,
        easing: 'easeInOutQuad',
      });
      anime({
        targets: btnRef.current,
        backgroundColor: ['#d97706', '#ef4444', '#d97706'],
        duration: 800,
      });
    },
  };

  // ... phase management and render
}
```

### 17.7 Combat Result Animation

After PvP or PvE combat resolves, the result screen choreographs everything:

```typescript
// components/combat/CombatResultOverlay.tsx
function animateCombatResult(result: CombatResult) {
  const tl = anime.timeline({ easing: 'easeOutExpo' });

  // 1. Slide in result banner (0ms)
  tl.add({
    targets: '.result-banner',
    translateY: ['-100%', '0%'],
    opacity: [0, 1],
    duration: 500,
  });

  // 2. Flash VICTORY/DEFEAT text (400ms)
  tl.add({
    targets: '.result-text',
    scale: [0.5, 1.2, 1],
    opacity: [0, 1],
    duration: 600,
    easing: 'easeOutElastic(1, .5)',
  }, 400);

  // 3. Roll loot numbers one by one (800ms) — staggered
  tl.add({
    targets: '.loot-item',
    translateX: [-30, 0],
    opacity: [0, 1],
    delay: anime.stagger(150),
    duration: 400,
  }, 800);

  // Each loot value counts up from 0
  result.lootItems.forEach((item, i) => {
    tl.add({
      targets: { val: 0 },
      val: item.amount,
      round: 1,
      duration: 600,
      easing: 'easeOutQuad',
      update: (anim) => {
        document.querySelector(`.loot-value-${i}`).textContent =
          formatNumber(anim.animations[0].currentValue);
      },
    }, 800 + i * 150);
  });

  // 4. Show casualties in red (1400ms)
  tl.add({
    targets: '.casualties',
    translateY: [20, 0],
    opacity: [0, 1],
    duration: 400,
  }, 1400);

  // 5. XP gain with gold pulse (1800ms)
  tl.add({
    targets: '.xp-gain',
    scale: [0.8, 1],
    opacity: [0, 1],
    textShadow: [
      '0 0 0px rgba(251,191,36,0)',
      '0 0 30px rgba(251,191,36,0.6)',
      '0 0 8px rgba(251,191,36,0.3)',
    ],
    duration: 800,
  }, 1800);

  // 6. Level up burst if applicable (2200ms)
  if (result.leveledUp) {
    tl.add({
      targets: '.level-up-overlay',
      opacity: [0, 1],
      duration: 200,
    }, 2200);
    tl.add({
      targets: '.level-number',
      scale: [0, 2, 1],
      rotate: ['-15deg', '0deg'],
      duration: 800,
      easing: 'easeOutElastic(1, .4)',
    }, 2300);
    tl.add({
      targets: '.level-particles .particle',
      translateX: () => anime.random(-200, 200),
      translateY: () => anime.random(-200, 200),
      scale: [1, 0],
      opacity: [1, 0],
      delay: anime.stagger(30),
      duration: 1200,
    }, 2400);
  }
}
```

### 17.8 Resource Change Animation

When any resource changes (collection, hiring, purchasing), the value in the topbar
animates with directional color:

```typescript
// components/layout/TopBar.tsx — resource change hook
function useResourceAnimation(ref: RefObject<HTMLElement>, value: number) {
  const prevRef = useRef(value);

  useEffect(() => {
    const prev = prevRef.current;
    const diff = value - prev;
    prevRef.current = value;

    if (diff === 0 || !ref.current) return;

    // Flash green (gain) or red (loss)
    const color = diff > 0 ? '#22c55e' : '#ef4444';

    anime.timeline()
      // Flash the color
      .add({
        targets: ref.current,
        color: [color, '#fbbf24'],     // back to gold
        duration: 800,
        easing: 'easeOutQuad',
      })
      // Scale bump
      .add({
        targets: ref.current,
        scale: [1, 1.15, 1],
        duration: 400,
        easing: 'easeOutElastic(1, .5)',
      }, 0)
      // Float delta text upward
      .add({
        targets: ref.current.querySelector('.delta'),
        translateY: [0, -20],
        opacity: [1, 0],
        duration: 1000,
        easing: 'easeOutExpo',
      }, 0);
  }, [value]);
}
```

### 17.9 Page Transition System

```typescript
// components/layout/PageTransition.tsx
'use client';
import { useRef, useEffect } from 'react';
import anime from 'animejs/lib/anime.es.js';

export function PageTransition({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    // Stagger all direct children in
    anime({
      targets: ref.current.children,
      translateY: [12, 0],
      opacity: [0, 1],
      delay: anime.stagger(60, { start: 100 }),
      duration: 500,
      easing: 'easeOutQuad',
    });
  }, []);

  return <div ref={ref}>{children}</div>;
}
```

### 17.10 Specialized Animations Catalog

**Building Construction Progress:**
```typescript
// Hammer strike rhythm — pulses every 2s during construction
anime({
  targets: '.building-card.constructing .hammer',
  rotate: ['-20deg', '20deg'],
  duration: 200,
  direction: 'alternate',
  loop: true,
  delay: (_, i) => i * 2000,
  easing: 'easeInOutQuad',
});
```

**Forge Stage Window (the "strike" moment):**
```typescript
// Urgent pulsing border when forge window is open
anime({
  targets: '.forge-window-active',
  borderColor: ['#92400e', '#fbbf24', '#92400e'],
  boxShadow: [
    '0 0 0px rgba(251,191,36,0)',
    '0 0 30px rgba(251,191,36,0.4)',
    '0 0 0px rgba(251,191,36,0)',
  ],
  duration: 1500,
  loop: true,
  easing: 'easeInOutSine',
});
```

**Hero Meditation Glow:**
```typescript
// Slow breathing glow on meditating hero card
anime({
  targets: '.hero-meditating',
  boxShadow: [
    '0 0 8px rgba(168,85,247,0.1)',
    '0 0 24px rgba(168,85,247,0.3)',
    '0 0 8px rgba(168,85,247,0.1)',
  ],
  duration: 3000,
  loop: true,
  easing: 'easeInOutSine',
});
```

**Rally Gathering Countdown (soldiers assembling):**
```typescript
// Participant count ticks up with "marching" stagger
anime({
  targets: '.rally-participant',
  translateX: [40, 0],
  opacity: [0, 1],
  delay: anime.stagger(200),
  duration: 600,
  easing: 'easeOutQuad',
});
```

**Loot Claim Burst:**
```typescript
// Items explode outward from claim button then settle into inventory
anime.timeline()
  .add({
    targets: '.loot-burst-item',
    scale: [0, 1.5, 1],
    opacity: [0, 1],
    translateX: () => anime.random(-60, 60),
    translateY: () => anime.random(-60, 60),
    delay: anime.stagger(50),
    duration: 500,
    easing: 'easeOutBack',
  })
  .add({
    targets: '.loot-burst-item',
    translateX: 0,
    translateY: 0,
    scale: 1,
    duration: 600,
    easing: 'easeInOutQuad',
  }, '+=200');
```

**Dungeon Floor Transition:**
```typescript
// Screen wipe between dungeon floors
anime.timeline()
  .add({
    targets: '.dungeon-wipe',
    scaleX: [0, 1],
    duration: 300,
    easing: 'easeInQuad',
  })
  .add({
    targets: '.floor-number',
    textContent: nextFloor,
    scale: [2, 1],
    opacity: [0, 1],
    duration: 400,
    easing: 'easeOutBack',
  })
  .add({
    targets: '.dungeon-wipe',
    scaleX: [1, 0],
    duration: 300,
    easing: 'easeOutQuad',
  });
```

**Shop Flash Sale Urgency:**
```typescript
// Countdown numbers pulse faster as time runs out
function flashSaleUrgency(remainingSeconds: number) {
  const speed = remainingSeconds < 60 ? 400 : remainingSeconds < 300 ? 800 : 1500;
  anime({
    targets: '.flash-sale-timer',
    scale: [1, 1.05, 1],
    color: remainingSeconds < 60 ? ['#ef4444', '#fbbf24'] : ['#fbbf24', '#fbbf24'],
    duration: speed,
    loop: true,
    easing: 'easeInOutSine',
  });
}
```

**Subscription Tier Comparison (hover to expand):**
```typescript
anime({
  targets: '.tier-card.hovered',
  scale: [1, 1.03],
  boxShadow: ['0 0 0 rgba(251,191,36,0)', '0 0 40px rgba(251,191,36,0.2)'],
  duration: 300,
  easing: 'easeOutQuad',
});
```

---

## 18. User Journeys — Complete Flow Maps

Every player journey mapped with loading states, animations, and the exact
Solana accounts involved.

### 18.1 Journey: New Player Onboarding

**Prerequisite:** Brand new wallet, no game accounts exist.

```
STEP 1: CONNECT WALLET
┌──────────────────────────────────────────────────────────┐
│ Landing page with gold ambience                          │
│ Player clicks "Connect Wallet"                           │
│ → Wallet adapter popup                                   │
│ → On connect: check if User account exists               │
│   Fetch: UserPDA [b"user", wallet]                       │
│   Fetch: PlayerPDA [b"player", gameEngine, wallet]       │
│                                                          │
│ Loading: "Searching the realm for your identity..."      │
│                                                          │
│ RESULT A: Both exist → skip to Dashboard                 │
│ RESULT B: Neither exist → show Onboarding Flow           │
└──────────────────────────────────────────────────────────┘

STEP 2: CREATE USER (TX 1)
┌──────────────────────────────────────────────────────────┐
│ "Welcome, adventurer."                                   │
│ "First, register your wallet with the realm."            │
│                                                          │
│ Accounts: user PDA, owner (signer), user_token_account,  │
│           game_engine, novi_mint, system, token, ata      │
│                                                          │
│ [◆ Register Wallet]                                      │
│ → TxButton: preparing → signing → sending → confirmed    │
│ → anime: gold burst, "Wallet registered" text fade-in    │
│                                                          │
│ Result: User account created with Rookie subscription    │
│         Reserved NOVI: 0, Subscription tier: 0            │
└──────────────────────────────────────────────────────────┘

STEP 3: SELECT STARTING CITY
┌──────────────────────────────────────────────────────────┐
│ "Choose your starting city."                             │
│                                                          │
│ City cards (fetched from on-chain):                      │
│ ┌─────────────────┐ ┌─────────────────┐                 │
│ │ NEW YORK        │ │ TOKYO           │                 │
│ │ Capital · 342   │ │ Forest · 189    │                 │
│ │ players         │ │ players         │                 │
│ │ [Select]        │ │ [Select]        │                 │
│ └─────────────────┘ └─────────────────┘                 │
│                                                          │
│ Loading: "Mapping the known world..."                    │
│ Fetch: All CityPDAs [b"city", gameEngine, cityId]        │
└──────────────────────────────────────────────────────────┘

STEP 4: CREATE PLAYER (TX 2)
┌──────────────────────────────────────────────────────────┐
│ 11 accounts: player, owner, player_token, game_engine,   │
│   novi_mint, starting_city, spawn_location, user,         │
│   system, token, ata                                     │
│                                                          │
│ [◆ Enter the Realm]                                      │
│ → TxButton: preparing → signing → sending → confirmed    │
│                                                          │
│ On confirm: CINEMATIC ENTRANCE                           │
│ anime.timeline():                                        │
│   1. Screen fades to black (200ms)                       │
│   2. "PLAYER #{totalPlayers}" rolls in (shimmer-gold)    │
│   3. Starter resources cascade in:                       │
│      ◆ 1,000,000 NOVI     (number rolls from 0)          │
│      $ 130,000,000 Cash   (number rolls from 0)          │
│      ⚔ 28,000 Units       (number rolls from 0)          │
│      ⚡ 100 Stamina         (bar fills)                   │
│   4. "Your adventure begins." (fade in, 800ms hold)      │
│   5. Transition to Dashboard                             │
│                                                          │
│ Player starts with:                                      │
│   Level 1, "Player #X" name, protection period active    │
│   No extensions unlocked (research, heroes, etc.)         │
│   Spawned at city center                                 │
└──────────────────────────────────────────────────────────┘

STEP 5 (OPTIONAL): SET DOMAIN NAME (TX 3)
┌──────────────────────────────────────────────────────────┐
│ Dashboard shows: "Player #247" with [Set Name] button    │
│                                                          │
│ If player owns a .tld domain:                            │
│   "Use your domain as your warrior name"                 │
│   Domain list from wallet (fetched via TLD House)        │
│                                                          │
│ 12 accounts: player, name_account, reverse_name,         │
│   name_class, name_parent, tld_house, tld_state,         │
│   main_domain, owner, system, alt_name_service, tld_pgm  │
│                                                          │
│ On confirm: Name morphs from "Player #247" → "ShadowKnight" │
│ anime: letter-by-letter reveal with gold shimmer          │
│                                                          │
│ If no domain: stays "Player #247"                        │
│ [Buy Domain] → links to domain marketplace               │
└──────────────────────────────────────────────────────────┘
```

### 18.2 Journey: Core Combat Loop (PvE)

```
ENCOUNTER SPAWN → ATTACK → LOOT

1. SPAWN ENCOUNTER (economy: costs locked NOVI)
   ┌──────────────────────────────────────────────────────┐
   │ City view: [Spawn Encounter] button                   │
   │ Cost shown: Common 1K NOVI / Rare 5K / Epic 25K       │
   │ Time-of-day discount shown (golden hours = 38% off)   │
   │                                                       │
   │ TX: spawn instruction (3 accounts + game_engine)      │
   │ Consumes: locked NOVI (burned)                        │
   │ Creates: EncounterAccount PDA at location             │
   │                                                       │
   │ anime: Encounter card slides into city list           │
   │        Level number rolls in, HP bar fills            │
   │        Rarity badge pulses once                       │
   └──────────────────────────────────────────────────────┘

2. ATTACK ENCOUNTER (combat: costs stamina)
   ┌──────────────────────────────────────────────────────┐
   │ Encounter card: [⚔ ATTACK] button                    │
   │ Stamina cost shown: Common 10 / Rare 50 / Epic 100   │
   │ Power preview: "You deal ~4,200 damage"               │
   │                                                       │
   │ TX resolves INSTANTLY (no waiting for turns):         │
   │   - Stamina consumed (regenerate_stamina first)       │
   │   - Damage calculated (units × weapons × buffs × tod) │
   │   - Instant cash reward: damage × 7                   │
   │   - XP awarded (with time-of-day bonus)               │
   │   - If encounter HP → 0: LootAccount created          │
   │                                                       │
   │ anime sequence:                                       │
   │   1. Button press → screen shake (2px, 200ms)         │
   │   2. Damage number floats up from encounter: "-4,200" │
   │   3. HP bar shrinks with red flash                    │
   │   4. Cash gained: "+29,400 $" floats up (green)       │
   │   5. Stamina bar ticks down                           │
   │   6. If killed: encounter card collapses, loot pulse  │
   │   7. If level up: full overlay celebration             │
   └──────────────────────────────────────────────────────┘

3. CLAIM LOOT
   ┌──────────────────────────────────────────────────────┐
   │ Dashboard or Loot page shows: "3 unclaimed drops"     │
   │ LootAccount fetched by PDA [b"loot", player, loot_id] │
   │                                                       │
   │ Loot card shows rewards:                              │
   │   $ 45,000 Cash                                       │
   │   ⚔ 120 Melee Weapons (level 5+)                     │
   │   🏹 60 Ranged Weapons (level 5+)                    │
   │   ◆ 500 Reserved NOVI (rare+ encounters)              │
   │   ◇ 12 Fragments (with research unlock)               │
   │                                                       │
   │ [◆ CLAIM] → 6 accounts (loot, player, user, owner,   │
   │              game_engine, creator)                     │
   │                                                       │
   │ anime: Loot burst animation (17.10)                   │
   │        Each item flies to its topbar counter           │
   │        Counter numbers roll up with gold glow          │
   │        Loot card closes with collapse animation        │
   │        Account rent refunded to creator                │
   │                                                       │
   │ Expires in: 30 days (countdown shown)                 │
   └──────────────────────────────────────────────────────┘
```

### 18.3 Journey: PvP Attack

```
1. FIND TARGET
   Player must be in same city, within attack range.
   City → Players tab → shows other players with power level.

   Preview panel (client-side calculation, no TX):
   ┌──────────────────────────────────────────────────────┐
   │ TARGET: DarkLord99  Level 67                          │
   │                                                       │
   │ YOUR POWER        vs     THEIR POWER                  │
   │ ⚔ 53,200                 ⚔ 142,000                   │
   │ (gold glow)              (red glow if stronger)       │
   │                                                       │
   │ Estimated outcome: LIKELY LOSS                        │
   │ Loot if win: ~10% of their resources                  │
   │                                                       │
   │ ☐ Drive-by attack (25% damage penalty, need 10K+ units) │
   │                                                       │
   │ [⚔ ATTACK]   [Cancel]                                │
   └──────────────────────────────────────────────────────┘

2. COMBAT RESOLUTION (instant, one TX)
   8+ accounts: attacker_player, defender_player, attacker_owner,
   attacker_city, defender_city, game_engine, attacker_estate,
   defender_estate + optional event accounts

   Results include:
   - Unit casualties BOTH sides (damage + counterattack)
   - Weapon losses proportional to casualties
   - If attacker wins: cash stolen (hand + unprotected vault),
     equipment stolen (armor, produce, vehicles), weapons looted
   - Armory raid: 10-20% of defender's stored weapons
   - Infirmary: wounded units tracked if building exists
   - XP: only if attacker wins

   anime: Full CombatResultOverlay (§17.7)
```

### 18.4 Journey: Estate Building Lifecycle

```
EMPTY PLOT → BUILD → WAIT → ACTIVE → UPGRADE → DAILY ACTIVITY

1. BUILD (burn locked NOVI, start timer)
   Cost: T1=10K / T2=50K / T3=200K NOVI
   Time: T1=4h / T2=12h / T3=24h

   anime: Gold coins fly from NOVI counter to building card
          Card transitions from dashed-zinc to gold-border
          Construction hammer animation begins
          Timer countdown starts

2. CONSTRUCTION COUNTDOWN
   GoldCountdown component with progress bar
   "Building Barracks — 3h 22m remaining"
   Optional: Speedup with gems (50 gems/min)

   anime: Hammer pulses every 2s
          Progress bar fills in real-time

3. ACTIVE — DAILY MINI-GAME
   Three windows per day: Dawn (0-3h) / Midday (4-8h) / Dusk (9-16h)
   Each building assigned to specific windows.
   Score 0-100 from mini-game.

   Building rewards animate on completion:
   ┌──────────────────────────────────────────────────────┐
   │ BARRACKS — Dawn Activity Complete! Score: 87         │
   │                                                       │
   │ Reward: +12% unit effectiveness (6h)                  │
   │ Mastery: +8 XP (████████░░ 72/100)                    │
   │                                                       │
   │ anime: score number rolls 0→87                        │
   │        reward text fades in with gold glow             │
   │        mastery bar fills with satisfying snap          │
   └──────────────────────────────────────────────────────┘

   Window completion tracking (all buildings in a window done):
   Dawn ● Midday ○ Dusk ○  (gold dot = complete)

4. UPGRADE (φ² cost scaling)
   Level 1→2: ~26K NOVI, 4→5: ~185K NOVI, etc.
   Building stays usable during upgrade.

   anime: Upgrade button transforms into countdown timer
          Building card gets "UPGRADING" shimmer overlay
```

### 18.5 Journey: Team & Social

```
1. CREATE TEAM
   Burns NOVI cost. Creates TeamPDA.
   Max members by subscription tier.

   anime: Team banner unfurls (translateY reveal)
          "Team Created" with gold burst
          Leader crown icon appears

2. INVITE → ACCEPT
   Inviter sends invite (creates TeamInviteAccount, 7-day expiry)
   Invitee sees notification pulse in sidebar
   Accept → joins at RANK_3

   anime: Invite card slides in from right with gold border
          Accept → card transforms into member row
          Member count ticks up

3. TEAM MANAGEMENT
   ┌──────────────────────────────────────────────────────┐
   │ IRON WOLVES — 8/10 members                           │
   │ Leader: ShadowKnight ♛                                │
   │                                                       │
   │ Members (sorted by rank):                             │
   │ ♛ ShadowKnight  Lv 42  ⚔ 53,200  RANK_1 (Leader)    │
   │ ★ IronShield    Lv 38  ⚔ 42,100  RANK_2 (Officer)   │
   │ ● StormBlade    Lv 29  ⚔ 18,400  RANK_3             │
   │ ● ... 5 more                                         │
   │                                                       │
   │ [Invite Player]  [Team Settings]                      │
   │ [Create Rally]   [Send Reinforcement]                 │
   └──────────────────────────────────────────────────────┘
```

### 18.6 Journey: Rally (Group PvP)

```
CREATE → GATHER → MARCH → BATTLE → RETURN

1. CREATE RALLY (requires Citadel estate building)
   Leader commits: units, weapons, optional hero
   Sets gathering duration
   Max participants: tier-based + hero buff + citadel bonus

   anime: War horn sound effect (optional)
          Rally card appears with gathering countdown
          Participant slots shown as empty circles

2. GATHER (teammates join, timer counting down)
   ┌──────────────────────────────────────────────────────┐
   │ RALLY: "Raid Alpha"  Status: GATHERING               │
   │ Target: Chicago Castle  |  ◷ 2h 14m to march         │
   │                                                       │
   │ Participants: 3/5                                     │
   │ ● ShadowKnight  4,200 units  ⚔ Hero: Blade of Valor  │
   │ ● IronShield    2,800 units                           │
   │ ● StormBlade    1,600 units                           │
   │ ○ ── waiting ──                                       │
   │ ○ ── waiting ──                                       │
   │                                                       │
   │ Total Power: ⚔ 8,600  (number rolls up as members join) │
   │                                                       │
   │ [Cancel Rally]                                        │
   └──────────────────────────────────────────────────────┘

   anime: Each new participant slides in (stagger)
          Power number re-rolls each time someone joins
          Empty circles pulse gently

3. MARCH (automatic after gather_at, can't cancel)
   Rally status changes to MARCHING
   March countdown based on distance

   anime: "MARCH!" text slams in
          Rally card border turns from gold to red
          Timer switches from gathering to marching countdown

4. RETURN (after battle resolution — off-chain simulation)
   Surviving units = committed - casualties
   Weapons return proportional to survival
   Loot only if attacker won
   Wounded units → estate infirmary if exists
   Hero returns to first empty slot or wallet

   anime: Soldiers "march back" animation
          Casualty report with red numbers
          Loot items cascade in (if won)
          Hero returns to hero slot with gold glow
```

### 18.7 Journey: Hero NFT Lifecycle

```
MINT → LOCK → USE → MEDITATE → LEVEL UP → BURN

1. MINT HERO NFT
   Requires: player level ≥ template.required_player_level
   Costs: SOL to treasury
   Creates: MPL Core NFT with all stats as Attributes plugin

   anime: Card flip reveal (backface → front with hero stats)
          Rarity badge pulses (Common=gray, Rare=blue, Epic=purple,
          Legendary=gold, Mythic=rose with persistent pulse)
          Stats cascade in: ATK +15%, DEF +8%, CRIT +12%...

2. LOCK HERO (equip for combat buffs)
   Transfer: wallet → PlayerAccount PDA
   Requires: Sanctuary building Lv1+
   Max heroes: 1 (Sanc Lv1-4), 2 (Lv5-9), 3 (Lv10+)
   Calculates: location synergy bonus (2-10% if at home city)

   anime: Hero card "locks in" — border hardens to gold
          Buff numbers in topbar roll up (+15% ATK, etc.)
          If location synergy: bonus text glows briefly

3. USE IN SYSTEMS
   Locked heroes provide passive buffs to ALL actions:
   - Combat (PvE/PvP): attack, defense, crit, weapon efficiency
   - Economy: collection rate, produce generation, synchrony
   - Expedition: affinity bonus (mining/fishing), rate bonus
   - Rally: committed hero provides march buffs
   - Garrison: hero defense buffs for castle
   - Dungeon: hero escrowed into DungeonRun PDA

4. MEDITATE (Sanctuary building)
   ┌──────────────────────────────────────────────────────┐
   │ SANCTUARY — Hero Meditation                           │
   │                                                       │
   │ Blade of Valor is meditating...                       │
   │ ◷ 18h 42m remaining  ██████████░░░ 62%               │
   │                                                       │
   │ XP earned: 1,240 / 2,000 to next level               │
   │ (XP per hour: 200 at Sanctuary Lv10)                  │
   │                                                       │
   │ Level cap: 26 (Sanctuary Lv10, φ-based)               │
   │ Max duration: 48h                                     │
   │                                                       │
   │ [Claim Early]  [⚡ Speedup · 50 gems/min]             │
   └──────────────────────────────────────────────────────┘

   anime: Purple breathing glow on hero card
          XP counter slowly ticks up in real-time
          Progress bar fills at visible rate

5. LEVEL UP (costs fragments, deterministic)
   Cost: 10 × 1.5^level fragments
   Requires: Sanctuary Lv1+ (hard gate)
   Level cap: 10/25/50/100 by Sanctuary level

   anime: Fragment counter ticks down (red)
          Level number rolls up with gold burst
          Buff deltas show: ATK +15% → +19% (green)

6. BURN (destroy NFT for NOVI reward)
   Reward: tier_base × level²
   NFT destroyed via MPL Core

   anime: Card cracks, shatters into particles
          NOVI number rolls up from 0 to reward
          "Hero has fallen" text in zinc-500
```

### 18.8 Journey: Forge Crafting (Staged Tempering)

```
START CRAFT → HIT WINDOWS → COMPLETE

This is the most animation-rich system. Players must hit timed windows.

1. START CRAFT
   Choose: equipment type + target quality tier
   Quality: Common → Refined → Superior → ... → Divine (8 tiers)
   Costs: NOVI (φ² scaling) + materials (tiered transition)
   Stages: Fibonacci (1, 2, 3, 5, 8, 11, 13)

   ┌──────────────────────────────────────────────────────┐
   │ FORGE — Start Craft                                   │
   │                                                       │
   │ Equipment: [Melee Weapons ▾]                          │
   │ Quality:   [Masterwork ▾]  (Forge Lv12+ required)     │
   │                                                       │
   │ Cost: ◆ 17,944 NOVI + 100 Rare + 25 Epic materials   │
   │ Stages: 5 (reduced to 4 at Forge Lv15)               │
   │ Window: 5 min base (10 min at Forge Lv20)            │
   │                                                       │
   │ [◆ BEGIN TEMPERING]                                   │
   └──────────────────────────────────────────────────────┘

2. STAGE WINDOWS (the core loop)
   After starting, each stage has:
   - Wait period (stage interval: 60s-15s by tier)
   - Strike window opens (duration: 1h-1min by tier)
   - Player must submit score during window

   ┌──────────────────────────────────────────────────────┐
   │ FORGE — Masterwork Melee                              │
   │ Stage 3/5                                             │
   │ ○ ● ● ◉ ○  (gold=done, ring=current, gray=ahead)     │
   │                                                       │
   │ ██████████████████████░░░ Window: 3m 22s remaining    │
   │ (urgent gold pulse animation)                         │
   │                                                       │
   │ [⚔ STRIKE!]  ← large gold button, pulsing border     │
   │                                                       │
   │ Precision: ████████░░ 82%  (running average)          │
   └──────────────────────────────────────────────────────┘

   anime: Window opening → border flashes gold (§17.10)
          Strike button has breathing glow
          Timer digits roll down rapidly
          Precision meter adjusts with smooth bar fill
          Stage completion: checkmark scales in + gold burst

3. COMPLETE (all stages done)
   Equipment quality upgraded permanently.
   Precision score affects... quality of the result.

   anime: Final checkmark cascade (all 5 dots fill gold)
          Equipment card transforms: border upgrades to new tier color
          Quality badge morphs (e.g., "Rare" → "Masterwork")
          Stats cascade in with gold numbers
```

### 18.9 Journey: Shop Experience

```
BROWSE → DISCOUNT STACK → PURCHASE → RECEIVE

The shop must feel EXCITING. Every purchase is a mini-celebration.

1. BROWSE
   ┌──────────────────────────────────────────────────────┐
   │ ── THE MARKETPLACE ──  (shimmer-gold)                 │
   │                                                       │
   │ YOUR DISCOUNTS (stacked, multiplicative):             │
   │ ┌──────────────────────────────────────────────────┐  │
   │ │ 📅 Daily Deal:     -15%     (refreshes in 4h)    │  │
   │ │ 🔢 Fibonacci:      -3%      (3rd purchase today) │  │
   │ │ ♛ Subscription:    -10%     (Epic tier)          │  │
   │ │ 🏆 Milestone:       -2%      (Silver shopper)     │  │
   │ │ 🔥 Loyalty Streak:  -1%      (3 days)            │  │
   │ │ 🏪 Market Bldg:     -8%      (Lv8 Market)        │  │
   │ │ ─────────────────────────────────────────────     │  │
   │ │ TOTAL DISCOUNT:     -34%    (gold glow, stacked) │  │
   │ └──────────────────────────────────────────────────┘  │
   │                                                       │
   │ anime: Discount layers slide in staggered             │
   │        Total calculates with number roll               │
   │        Each source pulses once when hovered            │
   └──────────────────────────────────────────────────────┘

2. ITEM CARDS (by category)
   ┌──────────────────────────────────────────────────────┐
   │ EQUIPMENT                                             │
   │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │
   │ │ ⚔ Melee│ │🏹Ranged│ │ ⚙ Siege│ │ 🛡 Armor│         │
   │ │ x100   │ │ x50    │ │ x25    │ │ x50    │         │
   │ │ ̶0̶.̶5̶ SOL│ │ ̶0̶.̶3̶ SOL│ │ ̶0̶.̶8̶ SOL│ │ ̶0̶.̶4̶ SOL│         │
   │ │ 0.33 ◎ │ │ 0.20 ◎ │ │ 0.53 ◎ │ │ 0.26 ◎ │         │
   │ │ [BUY]  │ │ [BUY]  │ │ [BUY]  │ │ [BUY]  │         │
   │ └────────┘ └────────┘ └────────┘ └────────┘         │
   │                                                       │
   │ FLASH SALES ⚡ (limited time, limited stock)          │
   │ ┌────────────────────────────────────────────────┐   │
   │ │ 🔥 LEGENDARY BUNDLE — 50% OFF                   │   │
   │ │ 500 Melee + 200 Ranged + 50k Produce            │   │
   │ │ Stock: 3/10 remaining  ◷ 1h 22m                 │   │
   │ │ ̶2̶.̶0̶ ̶S̶O̶L̶  →  1.0 SOL                            │   │
   │ │ (urgent pulse animation, stock bar depleting)    │   │
   │ │ [⚡ BUY NOW]                                     │   │
   │ └────────────────────────────────────────────────┘   │
   └──────────────────────────────────────────────────────┘

3. PURCHASE CELEBRATION
   anime.timeline():
     1. Button → confirmed (gold burst)
     2. Items fly from shop card to inventory
     3. Each item count rolls up in inventory panel
     4. If Fibonacci bonus unlocked: "+1% bonus earned!" toast
     5. If milestone reached: badge animation (scale + glow)
     6. Streak counter ticks if consecutive day

4. NOVI PURCHASE (oracle-priced)
   ┌──────────────────────────────────────────────────────┐
   │ BUY NOVI — 5 packages                                 │
   │                                                       │
   │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐│
   │ │ 10K ◆  │ │ 50K ◆  │ │ 250K ◆ │ │ 1M ◆   │ │ 5M ◆ ││
   │ │ 0.5 SOL│ │ 2.3 SOL│ │10.5 SOL│ │38.0 SOL│ │175  ◎││
   │ │ +0%    │ │ +5%    │ │ +12%   │ │ +20%   │ │ +30% ││
   │ └────────┘ └────────┘ └────────┘ └────────┘ └──────┘│
   │                                                       │
   │ Streak bonus: Day 3 → +2% extra                       │
   │ Tier bonus: Epic → +10% extra                         │
   │ Oracle: SOL/USD $142.50 | NOVI/USD $0.0012            │
   │                                                       │
   │ 15% undercut from market price                        │
   │ Daily cap: 2,500,000 NOVI (Epic tier)                 │
   └──────────────────────────────────────────────────────┘

   anime: Price updates in real-time with number roll
          Package hover → scale + glow
          Bonus percentages stack visually
```

### 18.10 Journey: Expedition (Idle Income)

```
1. START EXPEDITION
   Type: Mining (gems) or Fishing (produce)
   Tier: 0-4 (determines duration, cost, yield)
   Requires: Mine/Dock building at sufficient level
   Commits: operatives (locked during expedition), optional hero

   anime: Operatives "march out" animation
          Counter ticks down as units are committed
          Timer starts with progress bar

2. ACTIVE EXPEDITION (idle — just a countdown)
   ┌──────────────────────────────────────────────────────┐
   │ EXPEDITION: Mining Tier 3                             │
   │ ◷ 4h 22m remaining  ████░░░░░░░ 35%                  │
   │                                                       │
   │ Operatives deployed: 5,000                            │
   │ Hero: Blade of Valor (+15% mining affinity)           │
   │                                                       │
   │ [Abort Expedition]   (returns ops, no rewards)        │
   └──────────────────────────────────────────────────────┘

   anime: Progress bar fills in real-time (CSS only, no JS)
          Timer countdown with GoldCountdown
          Hero card has subtle glow

3. CLAIM (after timer completes)
   Yield calculation (deterministic):
   - Base: operatives × hours × rate / 100
   - Time-of-day bonus (claim time)
   - Research collection bonus
   - Hero affinity bonus
   - City origin bonus
   - Rare find check: deterministic, not random

   anime: "EXPEDITION COMPLETE" banner slides in
          Operatives "march back" (stagger from right)
          Yield numbers roll up one by one:
            ✦ 2,340 Gems  (gold burst)
            ◇ 45 Fragments (if rare find)
          Hero returns to slot with gold glow
          Account closed (rent refund)
```

### 18.11 Journey: Dungeon Run

```
ENTER → ROOMS → BOSS → CLAIM/FLEE

1. ENTER DUNGEON
   Requires: stamina, Catacombs building, hero NFT, defensive units
   Hero transferred to DungeonRun PDA (escrowed, can't sell)
   Units/weapons snapshotted (frozen for run)

   anime: Screen darkens (vignette increases)
          "ENTERING THE CRYPTS OF DREAD" text slams in
          Floor indicator: ○ ○ ○ ○ ○ ○ ○ ○ ○ ○

2. ROOM PROGRESSION
   Room types: Combat / Treasure / Shop / Sanctum / Boss

   Combat room anime:
     Enemy appears (slide from right, red glow border)
     HP bar fills to 100%
     Attack button pulses
     Each attack: damage number flies up, HP bar shrinks
     Enemy death: collapse + reward cascade

   Treasure room anime:
     Chest opens (scale from 0.5 → 1 with gold burst)
     Items fly out of chest one by one (stagger)

   Floor transition (§17.10 dungeon wipe):
     Black bar sweeps across
     Floor number slams in
     New room appears

3. BOSS ROOM
   Same as combat but:
   - Larger enemy card with red pulsing border
   - Boss wrath meter (additional mechanic)
   - Boss shield visualization
   - Higher stakes: pending rewards displayed prominently

4. REWARDS
   ┌──────────────────────────────────────────────────────┐
   │ DUNGEON COMPLETE — Floor 8/10                         │
   │                                                       │
   │ If VICTORY:                                           │
   │   Full pending rewards + leaderboard entry            │
   │   XP: 4,200 (rolls up, gold glow)                    │
   │   NOVI: 1,800 (rolls up, gold glow)                   │
   │   Gems: 120 (rolls up)                                │
   │   Materials: 5 Common (slides in)                     │
   │   Building bonuses: +25% XP (Academy), +25% NOVI      │
   │                                                       │
   │ If FLED (penalty by floor):                           │
   │   Floor 1-3: keep 70% / Floor 4-6: 60% / etc.        │
   │   No materials on flee                                │
   │                                                       │
   │ If FAILED:                                            │
   │   Checkpoint rewards only                             │
   │   "Your spirit lives on..." (zinc text)               │
   │                                                       │
   │ Hero returned from escrow in all cases                │
   └──────────────────────────────────────────────────────┘

   anime: Victory → CombatResultOverlay with full celebration
          Flee → muted version, penalty % shown
          Failed → red tint, checkpoint rewards cascade smaller
```

### 18.12 Journey: Subscription & Economy

```
1. SUBSCRIPTION PURCHASE
   ┌──────────────────────────────────────────────────────┐
   │ SUBSCRIPTION TIERS                                    │
   │                                                       │
   │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                 │
   │ │ROOKIE│ │EXPERT│ │ EPIC │ │LEGEND│                  │
   │ │ Free │ │  $5  │ │ $20  │ │ $50  │                  │
   │ │      │ │ /mo  │ │ /mo  │ │ /mo  │                  │
   │ │50/5m │ │100/5m│ │500/5m│ │2.5K  │                  │
   │ │3K cap│ │6K cap│ │30K   │ │150K  │                  │
   │ │100⚡  │ │500⚡  │ │1K⚡   │ │10K⚡  │                  │
   │ └──────┘ └──────┘ └──────┘ └──────┘                  │
   │ (current) (hover)  (hover)  (gold-glow)              │
   │                                                       │
   │ Payment: SOL / Off-chain (Stripe) / Token             │
   │ Cannot downgrade (only renew same or upgrade)         │
   └──────────────────────────────────────────────────────┘

   anime: Current tier highlighted with gold border
          Higher tiers glow brighter on hover
          On purchase: tier card scales up, resources cascade in:
            ◆ 30,000,000 Reserved NOVI (Legendary)
            $ 10,000,000 Cash
            ⚔ 50,000 Units
            ...all numbers roll from 0

2. COLLECT RESOURCES (core economy loop)
   4 types: Cash, Mining, Fishing, Farming
   Burns locked NOVI → generates resources
   Time-of-day matters: Midday best for Cash (φ), Night best for Mining

   anime: Resources fly from locked NOVI counter to resource counter
          NOVI ticks down (red), resource ticks up (green)
          Time-of-day indicator shows current multiplier
          Building bonuses shown as percentage badges

3. HIRE UNITS
   Convert locked NOVI → military units
   6 types: DEF T1/T2/T3, OP T1/T2/T3
   Requires: Barracks (defensive) or Camp (operative)

   anime: NOVI counter ticks down
          Unit counters tick up, staggered by type
          Power number recalculates with gold glow
          "Troops reporting for duty" micro-toast

4. LOCKED NOVI GENERATION (automatic, every 5 min)
   Shown as passive ticker in topbar
   Rate depends on subscription tier
   Vault building bonus: +50% to +200% cap

   anime: Every 5 min, NOVI counter ticks up silently
          If player watches: subtle gold pulse
          If at cap: "NOVI cap reached" (amber text, no pulse)
```

---

## 19. State-Dependent UI Patterns

The UI must gracefully handle many player states simultaneously.

### 19.1 Extension System (Progressive Disclosure)

Players start with NO extensions unlocked. The UI hides entire features
until the extension flag is set:

```
EXT_RESEARCH (0x0001) → Show Research page, economy research buffs
EXT_HEROES   (0x0002) → Show Hero page, Sanctuary, meditation
EXT_INVENTORY(0x0004) → Show Inventory page, equipment details
EXT_RALLY    (0x0008) → Show Rally page, join rally buttons
EXT_TEAM     (0x0010) → Show Team page, team features
EXT_COSMETICS(0x0020) → Show cosmetic options
EXT_COURT    (0x0040) → Show castle court features

Sidebar dynamically shows/hides sections based on extensions.
Empty state cards in Dashboard tease locked features:
  "Research unlocks at Level 5" (grayed out, gold unlock icon)
```

### 19.2 New Player Protection State

While `newPlayerProtectionUntil > now`:
- Show gold shield icon in topbar
- "Protected — cannot be attacked"
- Countdown timer until protection ends
- Warning: "Attacking another player ends your protection early"

### 19.3 Traveling State

While `player.travelType != None`:
- Show travel progress bar in topbar
- Most actions DISABLED (can't attack, join rally, etc.)
- Estate/shop/inventory still accessible
- Arrival triggers: city change, hero buff recalculation, XP award

### 19.4 Active Operations Overlay

Dashboard "Operations" panel shows ALL active timers at once:
- Max one travel
- Max one expedition
- Max one dungeon run
- Max one active research
- Max one active craft
- Max one meditating hero
- Multiple building constructions/upgrades
- Multiple rally participations
- Multiple reinforcements sent/received
- Castle upgrade (if king)

Each operation: label + countdown + progress bar + action button when ready.

### 19.5 Time-of-Day Awareness

The game has 6 time periods affecting everything. Show current period in topbar:

```
Dawn (4-6am)      — "Golden hour" for stamina regen
Morning (6-10am)  — Balanced
Midday (10am-2pm) — Best for Cash collection (φ), worst for Mining
Afternoon (2-6pm) — Balanced
Dusk (6-8pm)      — "Golden hour" for fishing/farming (φ)
Night (8pm-4am)   — Best for Mining (φ), stealth attacks (φ)
```

anime: Time period indicator transitions with smooth color shift
       Period name fades between labels
       Bonus indicators pulse when activity is optimal for current period
