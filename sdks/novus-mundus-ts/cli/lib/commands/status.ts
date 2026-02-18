/**
 * `novus status [target]` — read-only inspection
 */

import { type CLIContext, type ParsedArgs } from '../context';
import { log } from '../helpers';
import { bold, dim, green, red, section } from '../format';
import { statusEngine, detailEngine } from '../phases/engine';
import { statusCities, detailCities } from '../phases/cities';
import { statusHeroes, detailHeroes } from '../phases/heroes';
import { statusResearch, detailResearch } from '../phases/research';
import { statusSubscriptions, detailSubscriptions } from '../phases/subscriptions';
import { statusShop, detailShop } from '../phases/shop';
import { statusDungeons, detailDungeons } from '../phases/dungeons';
import { statusCastles, detailCastles } from '../phases/castles';
import { statusArena, detailArena } from '../phases/arena';
import { statusEvents, detailEvents } from '../phases/events';

interface StatusEntry {
  name: string;
  key: string;
  summary: (ctx: CLIContext) => Promise<string>;
  detail: (ctx: CLIContext) => Promise<string>;
}

const STATUS_ENTRIES: StatusEntry[] = [
  { name: 'GameEngine',     key: 'engine',        summary: statusEngine,        detail: detailEngine },
  { name: 'Cities',         key: 'cities',        summary: statusCities,        detail: detailCities },
  { name: 'Heroes',         key: 'heroes',        summary: statusHeroes,        detail: detailHeroes },
  { name: 'Research',       key: 'research',      summary: statusResearch,      detail: detailResearch },
  { name: 'Subscriptions',  key: 'subscriptions', summary: statusSubscriptions, detail: detailSubscriptions },
  { name: 'Shop',           key: 'shop',          summary: statusShop,          detail: detailShop },
  { name: 'Dungeons',       key: 'dungeons',      summary: statusDungeons,      detail: detailDungeons },
  { name: 'Castles',        key: 'castles',       summary: statusCastles,       detail: detailCastles },
  { name: 'Arena',          key: 'arena',         summary: statusArena,         detail: detailArena },
  { name: 'Events',         key: 'events',        summary: statusEvents,        detail: detailEvents },
];

export async function handleStatus(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const target = args.target;

  if (target && target !== '') {
    // Detailed view for specific target
    const entry = STATUS_ENTRIES.find(e => e.key === target);
    if (!entry) {
      log.error(`Unknown target: ${target}`);
      console.log(`\nAvailable targets: ${STATUS_ENTRIES.map(e => e.key).join(', ')}\n`);
      return;
    }
    const output = await entry.detail(ctx);
    console.log(output);
    return;
  }

  // Full overview
  console.log(section(`Kingdom ${ctx.kingdomId} Status (${ctx.env})`));
  console.log(
    `${bold('System'.padEnd(20))}${bold('Status'.padEnd(10))}${bold('Details')}`
  );
  console.log(dim('─'.repeat(60)));

  for (const entry of STATUS_ENTRIES) {
    try {
      const detail = await entry.summary(ctx);
      const isMissing = detail === 'missing';
      const status = isMissing ? red('MISSING') : green('OK');
      const statusPlain = isMissing ? 'MISSING' : 'OK';
      const namePad = entry.name.padEnd(20);
      // Pad accounting for ANSI escape codes in status
      const statusPadLen = 10 - statusPlain.length;
      console.log(`${namePad}${status}${' '.repeat(statusPadLen)}${isMissing ? dim(detail) : detail}`);
    } catch (error: any) {
      const namePad = entry.name.padEnd(20);
      console.log(`${namePad}${red('ERROR')}     ${dim(error.message)}`);
    }
  }

  console.log(dim('\nUse "novus status <target>" for detailed view'));
  console.log('');
}
