#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { refresh } from './commands/refresh.js';
import { sessions } from './commands/sessions.js';
import { session } from './commands/session.js';
import { status } from './commands/status.js';
import { validateEventId, validateLimit } from './commands/common.js';
import { KNOWN_EVENTS } from './config.js';

const knownIds = KNOWN_EVENTS.map((e) => e.id).join(', ');

function readPackageVersion(): string {
  const packageJson: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
  );

  if (
    typeof packageJson !== 'object'
    || packageJson === null
    || !('version' in packageJson)
    || typeof packageJson.version !== 'string'
    || packageJson.version.length === 0
  ) {
    throw new Error('Expected package.json to define a string version');
  }

  return packageJson.version;
}

const program = new Command();

program
  .name('msevents')
  .description('Search Microsoft flagship event sessions (Build, Ignite)')
  .version(readPackageVersion())
  .addHelpText('after', `
Run "msevents status" to see available events and cache freshness.
Use --json on any command for structured output (recommended for scripts and agents).`);

program
  .command('refresh')
  .description('Check for session catalog updates')
  .option('--event <id>', `Check a specific event (known: ${knownIds})`)
  .option('--force', 'Bypass conditional revalidation and re-fetch', false)
  .addHelpText('after', `
Examples:
  $ msevents refresh
  $ msevents refresh --event build-2026
  $ msevents refresh --force`)
  .action(async (opts: { event?: string; force: boolean }) => {
    if (opts.event && !validateEventId(opts.event)) return;
    await refresh(opts.event, opts.force);
  });

const sessionsCmd = program
  .command('sessions')
  .description('Search sessions (requires at least one of: --query, --tech, or --speaker)')
  .option('--query <text>', 'Keyword search across title, description, and all fields')
  .option('--tech <name>', 'Search by technology (product, tags, topic, languages)')
  .option('--speaker <name>', 'Search by speaker name')
  .option('--type <type>', 'Filter by session type (e.g., breakout, lab, demo, keynote)')
  .option('--event <id>', `Filter to a specific event (known: ${knownIds})`)
  .option('--limit <n>', 'Max results (default: 10)', '10')
  .option('--json', 'Output as structured JSON (recommended for scripts and agents)', false)
  .addHelpText('after', `
Examples:
  $ msevents sessions --query "AI agents" --json
  $ msevents sessions --tech "Azure Cosmos DB" --limit 5
  $ msevents sessions --speaker "Scott Hanselman"
  $ msevents sessions --query "serverless" --event build-2026
  $ msevents status    # discover available event IDs`)
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
    const limit = validateLimit(opts.limit);
    if (limit === null) return;
    await sessions({ ...opts, limit });
  });

program
  .command('session <code>')
  .description('Get full details for a specific session by its code (e.g., BRK155, KEY01)')
  .option('--event <id>', `Scope to a specific event (known: ${knownIds})`)
  .option('--json', 'Output as structured JSON (recommended for scripts and agents)', false)
  .addHelpText('after', `
Examples:
  $ msevents session BRK155 --json
  $ msevents session KEY01 --event build-2026`)
  .action(async (code: string, opts: { event?: string; json: boolean }) => {
    if (opts.event && !validateEventId(opts.event)) return;
    await session(code, opts);
  });

program
  .command('status')
  .description('Show available events, cached session counts, and cache freshness')
  .option('--json', 'Output as structured JSON (recommended for scripts and agents)', false)
  .addHelpText('after', `
Examples:
  $ msevents status
  $ msevents status --json`)
  .action(async (opts: { json: boolean }) => {
    await status(opts);
  });

program.parse();
