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
import { handleShow } from './lib/commands/show';
import { handleTerrain } from './lib/commands/terrain';
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
    case 'show':
      await handleShow(ctx, args);
      break;
    case 'terrain':
      await handleTerrain(ctx, args);
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
                            arena, dungeons, castles, rallies
  flash-sale create         Create flash sale (--item, --discount, --duration, etc.)
  flash-sale close          Close flash sale (--sale-id)
  flash-sale activate       Activate flash sale (--sale-id)
  flash-sale list           List all flash sales
  show player               List all players
  show player <pubkey>      Show player details
  show team                 List all teams
  show team <id>            Show team details
  show rally                List active rallies
  show rally <creator> <id> Show rally details
  show expedition           List active expeditions
  show reinforcement <pk>   Show reinforcements for player
  show loot <pubkey>        Show unclaimed loot for player
  terrain preview <city-id> Render terrain to terminal
  terrain export <city-id>  Export anchor config to JSON
  terrain set <city-id>     Submit set_terrain instruction
  terrain add <city-id>     Append anchors (--anchors '[...]')
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
  snapshot save <name>      Save validator ledger state
  snapshot load <name>      Restore from snapshot
  snapshot list             List saved snapshots
  snapshot delete <name>    Delete a snapshot
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
