/**
 * show command — Read and display on-chain state
 */

import { NovusMundusClient } from '../../../src/client';
import type { CLIContext, ParsedArgs } from '../context';
import { log } from '../helpers';
import { showAllPlayers, showPlayer } from '../show/player';
import { showAllTeams, showTeam } from '../show/team';
import { showAllRallies, showRally } from '../show/rally';
import { showExpeditions } from '../show/expedition';
import { showReinforcements } from '../show/reinforcement';
import { showLoot } from '../show/loot';

export async function handleShow(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const client = new NovusMundusClient({
    connection: ctx.connection,
    kingdomId: ctx.kingdomId,
    gameEngine: ctx.gameEngine,
  });

  switch (args.target) {
    case 'player':
      if (args.extra) {
        await showPlayer(client, ctx, args.extra);
      } else {
        await showAllPlayers(client, ctx);
      }
      break;
    case 'team':
      if (args.extra) {
        await showTeam(client, ctx, args.extra);
      } else {
        await showAllTeams(client, ctx);
      }
      break;
    case 'rally':
      if (args.extra) {
        await showRally(client, ctx, args.extra, args.flags);
      } else {
        await showAllRallies(client, ctx);
      }
      break;
    case 'expedition':
      await showExpeditions(client, ctx);
      break;
    case 'reinforcement':
      if (!args.extra) {
        log.error('Usage: novus show reinforcement <player-pubkey>');
        return;
      }
      await showReinforcements(client, ctx, args.extra);
      break;
    case 'loot':
      if (!args.extra) {
        log.error('Usage: novus show loot <wallet-pubkey>');
        return;
      }
      await showLoot(client, ctx, args.extra);
      break;
    default:
      log.error(
        args.target
          ? `Unknown show target: ${args.target}`
          : 'Usage: novus show <player|team|rally|expedition|reinforcement|loot>'
      );
  }
}
