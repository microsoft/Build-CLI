import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cliRoot = fileURLToPath(new URL('..', import.meta.url));
const commandTimeoutMs = 60_000;
const liveRefreshAttempts = 3;
const liveRefreshRetryDelayMs = 5_000;
const eventId = 'build-2026';

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

function formatError(error) {
  if (error && typeof error === 'object') {
    const message = error.message ?? String(error);
    const stderr = error.stderr ? `\n${error.stderr}` : '';
    return `${message}${stderr}`;
  }
  return String(error);
}

async function delay(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function retryLiveRefresh(cacheDir) {
  let lastError;
  for (let attempt = 1; attempt <= liveRefreshAttempts; attempt += 1) {
    try {
      return await runCli(['refresh', '--event', eventId, '--force'], cacheDir);
    } catch (error) {
      lastError = error;
      if (attempt === liveRefreshAttempts) break;
      process.stderr.write(
        `Live catalog refresh failed on attempt ${attempt}/${liveRefreshAttempts}: ${formatError(error)}\n` +
        `Retrying in ${liveRefreshRetryDelayMs / 1000}s...\n`,
      );
      await delay(liveRefreshRetryDelayMs);
    }
  }

  throw lastError;
}

const cacheDir = await mkdtemp(join(tmpdir(), 'msevents-live-smoke-'));

try {
  const refresh = await retryLiveRefresh(cacheDir);
  process.stderr.write(refresh.stderr);

  const { stdout: statusStdout } = await runCli(['status', '--json'], cacheDir);
  const statuses = JSON.parse(statusStdout);
  const status = statuses.find((item) => item.eventId === eventId);
  assert(status?.meta?.sessionCount > 0, `Expected ${eventId} live catalog cache with sessions`);

  const sessions = JSON.parse(await readFile(join(cacheDir, `${eventId}-sessions.json`), 'utf8'));
  const sessionCode = sessions.find((session) => session.sessionCode)?.sessionCode;
  assert(sessionCode, 'No live session code found');

  const { stdout: searchStdout } = await runCli([
    'sessions',
    '--query',
    sessionCode,
    '--event',
    eventId,
    '--limit',
    '1',
    '--json',
  ], cacheDir);
  const results = JSON.parse(searchStdout);
  assert(
    Array.isArray(results)
      && results.some((session) => session.sessionCode === sessionCode && session.event === eventId),
    `Expected ${eventId} search result for ${sessionCode}`,
  );

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
