#!/usr/bin/env node

import { Command } from 'commander';
import { refresh } from './commands/refresh.js';
import { sessions } from './commands/sessions.js';
import { session } from './commands/session.js';
import { status } from './commands/status.js';
import { validateEventId } from './commands/common.js';

const program = new Command();

program
  .name('msevents')
  .description('Search Microsoft flagship event sessions (Build, Ignite)')
  .version('0.1.0');

program
  .command('refresh')
  .description('Check for session catalog updates')
  .option('--event <id>', 'Check a specific event (e.g., build-2025)')
  .option('--force', 'Bypass conditional revalidation and re-fetch', false)
  .action(async (opts: { event?: string; force: boolean }) => {
    if (opts.event && !validateEventId(opts.event)) return;
    await refresh(opts.event, opts.force);
  });

program
  .command('sessions')
  .description('Search sessions')
  .option('--query <text>', 'Keyword search across all fields')
  .option('--tech <name>', 'Search by technology (product, tags, topic, languages)')
  .option('--speaker <name>', 'Search by speaker name')
  .option('--type <type>', 'Filter by session type (breakout, lab, demo, etc.)')
  .option('--event <id>', 'Filter by event (e.g., build-2025)')
  .option('--limit <n>', 'Max results (default: 10)', '10')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: {
    query?: string;
    tech?: string;
    speaker?: string;
    type?: string;
    event?: string;
    limit: string;
    json: boolean;
  }) => {
    if (!opts.query && !opts.tech && !opts.speaker) {
      console.error('Provide at least one of: --query, --tech, or --speaker');
      process.exitCode = 1;
      return;
    }
    if (opts.event && !validateEventId(opts.event)) return;
    await sessions({ ...opts, limit: parseInt(opts.limit, 10) });
  });

program
  .command('session <code>')
  .description('Get full details for a specific session')
  .option('--event <id>', 'Scope to a specific event')
  .option('--json', 'Output as JSON', false)
  .action(async (code: string, opts: { event?: string; json: boolean }) => {
    if (opts.event && !validateEventId(opts.event)) return;
    await session(code, opts);
  });

program
  .command('status')
  .description('Show cached events and freshness')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { json: boolean }) => {
    await status(opts);
  });

program.parse();
