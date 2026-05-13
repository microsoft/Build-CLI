import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { normalizeCatalog } from '../dist/data/normalize.js';

const execFileAsync = promisify(execFile);
const cliRoot = fileURLToPath(new URL('..', import.meta.url));
const commandTimeoutMs = 60_000;
const eventId = 'build-2025';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCli(args, cacheDir) {
  return execFileAsync(process.execPath, ['dist/index.js', ...args], {
    cwd: cliRoot,
    env: { ...process.env, MSEVENTS_CACHE_DIR: cacheDir },
    timeout: commandTimeoutMs,
  });
}

const cacheDir = await mkdtemp(join(tmpdir(), 'msevents-fixture-smoke-'));

try {
  const raw = JSON.parse(await readFile('test/fixtures/build-2025-sample.json', 'utf8'));
  const sessions = normalizeCatalog(raw, eventId);
  assert(sessions.length > 0, 'Expected fixture to contain sessions');

  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, `${eventId}-sessions.json`), JSON.stringify(sessions));
  await writeFile(join(cacheDir, `${eventId}-meta.json`), JSON.stringify({
    eventId,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    checkedAt: '2026-01-01T00:00:00.000Z',
    nextCheckAt: '2099-01-01T00:00:00.000Z',
    sessionCount: sessions.length,
    lastCheckStatus: 'updated',
    consecutiveFailures: 0,
  }, null, 2));

  await runCli(['--help'], cacheDir);

  const { stdout: searchStdout } = await runCli([
    'sessions',
    '--query',
    'Foundry',
    '--event',
    eventId,
    '--limit',
    '1',
    '--json',
  ], cacheDir);
  const results = JSON.parse(searchStdout);
  assert(Array.isArray(results), 'Expected search output to be an array');
  assert(results.length === 1, `Expected one search result, got ${results.length}`);
  assert(results[0].event === eventId, `Expected ${eventId} search result, got ${results[0].event}`);

  const sessionCode = sessions.find((session) => session.sessionCode)?.sessionCode;
  assert(sessionCode, 'No cached session code found');

  const { stdout: sessionStdout } = await runCli([
    'session',
    sessionCode,
    '--event',
    eventId,
    '--json',
  ], cacheDir);
  const session = JSON.parse(sessionStdout);
  assert(!Array.isArray(session), `Expected one session for ${sessionCode}`);
  assert(session.sessionCode === sessionCode, `Expected session ${sessionCode}, got ${session.sessionCode}`);
  assert(session.event === eventId, `Expected ${eventId} session, got ${session.event}`);
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}
