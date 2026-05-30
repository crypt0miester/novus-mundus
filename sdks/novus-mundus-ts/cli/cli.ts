#!/usr/bin/env node
/**
 * novus — Novus Mundus Kingdom Initialization CLI
 *
 * Usage:
 *   bun run scripts/cli.ts <command> [target] [options]
 *   npx tsx scripts/cli.ts <command> [target] [options]
 *
 * Commands:
 *   init <target|all>     Create and/or update accounts
 *   status [target]       Show initialization status
 *   update <target>       Update existing accounts only
 *   crank <target|all>    Run permissionless crank operations
 *   flash-sale <sub>      Manage flash sales (create|close|activate|list)
 *   oracle <sub>          Oracle & token-payment config (config|init-quote|allow-token|buy|status)
 *
 * Options:
 *   --env <localnet|devnet|mainnet>   Target environment (default: localnet)
 *   --kingdom-id <number>             Kingdom ID (default: 0)
 *   --authority <keypair-path>         DAO authority keypair
 *   --dry-run                          Show what would happen
 *   --verbose                          Show tx sigs and addresses
 *   --from <phase>                     Resume init from phase N
 */

import { parseArgs, buildContext } from './lib/context';
import { log } from './lib/helpers';
import { handleInit } from './lib/commands/init';
import { handleStatus } from './lib/commands/status';
import { handleUpdate } from './lib/commands/update';
import { handleCrank } from './lib/commands/crank';
import { handleFlashSale } from './lib/commands/flash-sale';
import { handleOracle } from './lib/commands/oracle';
import { handleShow } from './lib/commands/show';
import { handleCreatePlayer } from './lib/commands/create-player';
import { handleEncounters } from './lib/commands/encounters';
import { handleValidator } from './lib/commands/validator';
import { handleReset } from './lib/commands/reset';
import { handleLogs } from './lib/commands/logs';
import { handleAirdrop } from './lib/commands/airdrop';
import { handleDeploy } from './lib/commands/deploy';
import { handlePlayer } from './lib/commands/player';
import { handleSnapshot } from './lib/commands/snapshot';
import { handleNuke } from './lib/commands/nuke';
import { handleTeam } from './lib/commands/team';
import { handleWartable } from './lib/commands/wartable';
import { handleRally } from './lib/commands/rally';
import { handleReinforcement } from './lib/commands/reinforcement';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === 'help' || args.command === '--help') {
    printUsage();
    return;
  }

  // Commands that don't need full context (no RPC connection required)
  if (args.command === 'validator') {
    log.header(`Validator`);
    await handleValidator(null, args);
    return;
  }

  const ctx = await buildContext(args);

  log.header(`Kingdom ${ctx.kingdomId} (${ctx.env})`);

  if (ctx.dryRun) {
    log.info('[dry-run mode — no transactions will be sent]\n');
  }

  switch (args.command) {
    case 'init':
      await handleInit(ctx, args);
      break;
    case 'status':
      await handleStatus(ctx, args);
      break;
    case 'update':
      await handleUpdate(ctx, args);
      break;
    case 'crank':
      await handleCrank(ctx, args);
      break;
    case 'flash-sale':
      await handleFlashSale(ctx, args);
      break;
    case 'oracle':
      await handleOracle(ctx, args);
      break;
    case 'show':
      await handleShow(ctx, args);
      break;
    case 'create-player':
      await handleCreatePlayer(ctx, args);
      break;
    case 'encounters':
      await handleEncounters(ctx, args);
      break;
    case 'reset':
      await handleReset(ctx, args);
      break;
    case 'logs':
      await handleLogs(ctx, args);
      break;
    case 'airdrop':
      await handleAirdrop(ctx, args);
      break;
    case 'deploy':
      await handleDeploy(ctx, args);
      break;
    case 'player':
      await handlePlayer(ctx, args);
      break;
    case 'snapshot':
      await handleSnapshot(ctx, args);
      break;
    case 'nuke':
      await handleNuke(ctx, args);
      break;
    case 'team':
      await handleTeam(ctx, args);
      break;
    case 'wartable':
      await handleWartable(ctx, args);
      break;
    case 'rally':
      await handleRally(ctx, args);
      break;
    case 'reinforcement':
    case 'reinf':
      await handleReinforcement(ctx, args);
      break;
    default:
      log.error(`Unknown command: ${args.command}`);
      printUsage();
  }
}

function printUsage(): void {
  console.log(`
novus — Novus Mundus Kingdom Initialization CLI

Usage:
  bun run scripts/cli.ts <command> [target] [options]

Commands:
  init all                  Initialize everything (phases 1-10)
  init all --from 5         Resume from phase 5
  init <target>             Initialize specific: engine, cities, heroes,
                            research, subscriptions, shop, dungeons,
                            castles, arena, events
  status                    Show status of all systems
  status <target>           Show specific system status
  update <target>           Re-apply configs: research, subscriptions,
                            shop, heroes (--supply-caps),
                            castle-config
  crank all                 Run all permissionless cranks
  crank <target>            Run specific: subscriptions, events,
                            arena, dungeons, castles, rallies, oracle
  flash-sale create         Create flash sale (--item, --discount, --duration, etc.)
  flash-sale close          Close flash sale (--sale-id)
  flash-sale activate       Activate flash sale (--sale-id)
  flash-sale list           List all flash sales
  oracle config             Set SOL/USD oracle (--pyth-feed, --switchboard-feed,
                            --switchboard-queue, --staleness, --confidence)
  oracle init-quote         Create the Switchboard oracle-quote PDA (--switchboard-queue)
  oracle init-alt           Create the shop Address Lookup Table (one-time; for
                            bundled crank+purchase txs — prints the env value)
  oracle allow-token        Whitelist a payment token (--mint, --pyth-feed,
                            --switchboard-feed, --staleness, --confidence, --discount)
                            For USDC/USDT/PYUSD: add --pegged to skip the oracle
                            (computes token amount directly from cost_usd_cents).
  oracle buy                Token-payment purchase (--buyer, --item, --mint,
                            --payment <pyth|switchboard>, --quantity,
                            --sol-feed, --token-feed for the Pyth path)
  oracle status             Show oracle config + whitelisted tokens
  show player               List all players
  show player <pubkey>      Show player details
  show team                 List all teams
  show team <id>            Show team details
  show rally                List active rallies
  show rally <creator> <id> Show rally details
  show expedition           List active expeditions
  show reinforcement <pk>   Show reinforcements for player
  show loot <pubkey>        Show unclaimed loot for player
  show dungeon <pubkey>     Show a player's active or last dungeon run
  create-player             Create test players at power tiers
                            --tier <beginner|advanced|epic|legendary>
                            --count <n>  (default: 1)
                            --city <id>  (default: auto-cycle)
                            --start-index <n>  (default: auto-detect)
  encounters spawn          Spawn PvE encounters (DAO auto-spawn)
                            --city <id> | --all
                            --count <n>  (default: 1)
                            --rarity <common|uncommon|rare|epic|legendary>
  encounters status         Show encounter counts per city
                            --city <id>  (default: all cities)
  validator start           Start local test validator with game programs
  validator start --reset   Kill existing + fresh start
  validator stop            Stop running validator
  validator status          Show validator status
  reset                     Wipe validator + reinit everything
  reset --skip-init         Restart without init
  logs                      Tail Novus Mundus program logs
  logs --all                Tail all program logs
  airdrop <pubkey>          Airdrop SOL (localnet only)
  airdrop dao               Airdrop to DAO authority
                            --amount <n>  (default: 2)
  deploy                    Build + deploy program
  deploy --skip-build       Deploy existing .so only
  player fund <pk> --novi N Mint NOVI to player (DAO operation)
  player travel <kp> --city N  Teleport player to city
  player deposit <kp> --amount N
                            Deposit wallet NOVI → reserved (5% fee burned)
  player sweep <kp> --kind <user|player>
                            Self-recover untracked NOVI surplus from your PDA-owned ATA
  player buy-gems <kp> --count N
                            Buy gem packs (shop item 1) to fund speedups
  snapshot save <name>      Save validator ledger state
  snapshot load <name>      Restore from snapshot
  snapshot list             List saved snapshots
  snapshot delete <name>    Delete a snapshot
  team join                 Have test players join a public team
                            --team-id <id> --count <n>
                            [--start-slot <s>]  (default: 0)
  rally list                List active rallies (creator, target, window)
  rally create <keypair>    Create a team rally
                            --target <pubkey> --target-type <encounter|player|castle>
                            --target-city <id> [--gather <seconds>]
                            [--units a,b,c] [--weapons m,r,s] [--rally-id <n>]
  rally join <keypair>      Join a rally (commits full stock by default)
                            [--rally <pubkey> | --creator <pk> --id <n>]
                            [--units a,b,c] [--weapons m,r,s]
  rally prep [--team <id>]  Read-only readiness check for the encounter-rally flow
                            (members, keys, gems, units, target, next commands)
  rally speedup <keypair>   Spend gems to collapse travel so members arrive in time
                            [--creator <pk> --id <n>] --phase <gather|march|return>
                            --tier <1|2> [--participant <wallet>] [--repeat <n>]
  rally march               Execute combat once the gather window closes
                            [--rally <pubkey> | --creator <pk> --id <n>]
  rally process-return      Collect loot + surviving units after combat
                            [--rally <pubkey> | --creator <pk> --id <n>]
                            [--owner <pubkey> | --all]
  reinforcement list <pk>   Show sent + received reinforcements for a player
  reinforcement send <kp>   Send defensive troops to a teammate
                            --to <receiverWallet> --units a,b,c [--weapons m,r,s]
  reinforcement arrive      Process arrival (crank) --sender <pk> --to <pk>
  reinforcement recall <kp> Send your troops home --to <receiverWallet>
  reinforcement relieve <kp> Receiver sends troops back --sender <senderWallet>
  reinforcement return      Process return (crank) --sender <pk> --to <pk>
  reinforcement speedup <kp> Collapse travel with gems --to <pk> [--tier 1|2] [--repeat n]
  wartable read <thread>     Decode + decrypt a war-table thread
                            --scope <team|rally|castle|encounter|dm>
                            --limit <n> --master-secret <hex>
  wartable dm-threads <pk>   List DM threads for a player (sender-side)
  wartable thread-key <t>    Derive and print a thread key (--version N --master-secret <hex>)
  nuke                      Full reset + init + populate
                            --tier <tier>  (default: advanced)
                            --count <n>    (default: 10)
                            --skip-players --skip-encounters

Options:
  --env <env>               localnet | devnet | mainnet (default: localnet)
  --kingdom-id <n>          Kingdom ID (default: 0)
  --authority <path>        DAO authority keypair path
  --treasury <path>         Treasury keypair path
  --dry-run                 Show what would happen, don't send txs
  --verbose                 Show transaction signatures
  --from <n>                Resume init from phase N
`);
}

main().catch((error) => {
  console.error('\nFatal error:', error.message);
  if (process.env.VERBOSE) console.error(error);
  process.exit(1);
});
