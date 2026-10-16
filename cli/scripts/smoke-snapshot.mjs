// Builds a snapshot plugin from the fixture catalog, then checks that the bundled CLI works
// offline from read-only data and matches the regular CLI's output for the same cached sessions.
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { normalizeCatalog } from '../dist/data/normalize.js';

const execFileAsync = promisify(execFile);
const cliRoot = fileURLToPath(new URL('..', import.meta.url));
const commandTimeoutMs = 60_000;
const eventId = 'build-2025';
const isWindows = process.platform === 'win32';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run(args, options) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, { timeout: commandTimeoutMs, ...options });
    return { code: 0, stdout, stderr };
  } catch (err) {
    if (typeof err.code !== 'number') throw err;
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

async function setReadOnly(dir, readOnly) {
  for (const name of await readdir(dir)) await chmod(join(dir, name), readOnly ? 0o444 : 0o644);
  if (!isWindows) await chmod(dir, readOnly ? 0o555 : 0o755);
}

const root = await mkdtemp(join(tmpdir(), 'msevents-snapshot-smoke-'));
const cacheDir = join(root, 'cache');
const emptyCacheDir = join(root, 'empty-cache');
const pluginDir = join(root, 'plugin');
const skillDir = join(pluginDir, 'skills', 'microsoft-build');
const dataDir = join(skillDir, 'data');
const workDir = join(root, 'work');
const noNetwork = join(root, 'no-network.mjs');
let dataLocked = false;

try {
  const raw = JSON.parse(await readFile('test/fixtures/build-2025-sample.json', 'utf8'));
  const sessions = normalizeCatalog(raw, eventId);
  assert(sessions.length > 0, 'Expected fixture to contain sessions');

  await mkdir(cacheDir, { recursive: true });
  await mkdir(emptyCacheDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(join(cacheDir, `${eventId}-sessions.json`), JSON.stringify(sessions));
  await writeFile(join(cacheDir, `${eventId}-meta.json`), JSON.stringify({
    eventId,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    checkedAt: '2026-01-01T00:00:00.000Z',
    nextCheckAt: '2099-01-01T00:00:00.000Z',
    sessionCount: sessions.length,
    etag: '"fixture"',
    lastCheckStatus: 'failed',
    consecutiveFailures: 2,
  }, null, 2));
  await writeFile(noNetwork, "globalThis.fetch = () => { throw new Error('network is disabled in smoke:snapshot'); };\n");

  const built = await run([
    'scripts/build-snapshot.mjs',
    '--sessions-dir', cacheDir,
    '--event', eventId,
    '--out', pluginDir,
    '--plugin-version', '1.0.0',
  ], { cwd: cliRoot });
  assert(built.code === 0, `build-snapshot failed:\n${built.stdout}${built.stderr}`);

  const dataFiles = (await readdir(dataDir)).sort();
  assert(
    dataFiles.join(',') === `${eventId}-meta.json,${eventId}-sessions.json`,
    `Unexpected data files: ${dataFiles.join(', ')}`,
  );
  for (const file of ['SKILL.md', 'scripts/msevents.mjs', ...dataFiles.map((f) => `data/${f}`)]) {
    const text = await readFile(join(skillDir, file), 'utf8');
    assert(!text.includes('\r'), `${file} must use LF line endings`);
    if (file === 'SKILL.md') {
      assert(!text.includes('{{'), 'SKILL.md has unfilled placeholders');
      assert(text.includes('2026-01-01'), 'Expected SKILL.md to show the snapshot date from the cache meta file');
    }
  }
  const meta = JSON.parse(await readFile(join(dataDir, `${eventId}-meta.json`), 'utf8'));
  assert(meta.fetchedAt === '2026-01-01T00:00:00.000Z', 'Expected fetchedAt from the cache meta file');
  assert(!('lastCheckStatus' in meta) && !('etag' in meta), 'Expected revalidation state to be dropped from the frozen meta');

  await setReadOnly(dataDir, true);
  dataLocked = true;

  // The banner forces offline mode and the bundled data folder, whatever the environment says.
  const snapshot = (...args) => run(
    ['--import', pathToFileURL(noNetwork).href, join(skillDir, 'scripts', 'msevents.mjs'), ...args],
    { cwd: workDir, env: { ...process.env, MSEVENTS_OFFLINE: '0', MSEVENTS_CACHE_DIR: emptyCacheDir } },
  );
  const live = (...args) => run(['dist/index.js', ...args], {
    cwd: cliRoot,
    env: { ...process.env, MSEVENTS_CACHE_DIR: cacheDir, MSEVENTS_OFFLINE: '' },
  });

  const sessionCode = sessions[0].sessionCode;
  const speaker = sessions.find((s) => s.speakers)?.speakers.split(',')[0].trim();
  assert(speaker, 'Expected a fixture session with speakers');

  const sameAsLive = [
    ['sessions', '--query', 'Foundry', '--event', eventId, '--json'],
    ['sessions', '--query', 'Foundry', '--event', eventId],
    ['sessions', '--tech', 'Azure', '--type', 'breakout', '--event', eventId, '--limit', '5', '--json'],
    ['sessions', '--speaker', speaker, '--event', eventId, '--json'],
    ['sessions', '--query', sessionCode.toLowerCase(), '--event', eventId, '--json'],
    ['session', sessionCode, '--event', eventId, '--json'],
    ['session', sessionCode, '--event', eventId],
    ['sessions', '--event', eventId],
    ['sessions', '--query', 'agents', '--event', eventId, '--limit', '500'],
    ['--version'],
  ];
  const outputs = [];
  for (const args of sameAsLive) {
    const [a, b] = await Promise.all([snapshot(...args), live(...args)]);
    const label = args.join(' ');
    assert(a.code === b.code, `Exit code differs for "${label}": snapshot ${a.code}, CLI ${b.code}\n${a.stderr}`);
    assert(a.stdout === b.stdout, `stdout differs for "${label}"`);
    assert(a.stderr === b.stderr, `stderr differs for "${label}":\n${a.stderr}\n---\n${b.stderr}`);
    outputs.push(a);
  }
  assert(JSON.parse(outputs[0].stdout).length > 0, 'Expected the Foundry search to return sessions');
  assert(JSON.parse(outputs[3].stdout).length > 0, `Expected sessions for speaker ${speaker}`);
  assert(JSON.parse(outputs[5].stdout).sessionCode === sessionCode, `Expected session ${sessionCode}`);
  assert(outputs[7].code !== 0, 'Expected sessions without a filter to fail validation');
  assert(outputs[8].code === 0 && outputs[8].stderr.includes('clamping'), 'Expected --limit 500 to be clamped');

  const refresh = await snapshot('refresh');
  assert(refresh.code === 1 && refresh.stderr.includes('MSEVENTS_OFFLINE'), `Expected refresh to fail offline:\n${refresh.stderr}`);

  const status = await snapshot('status', '--json');
  assert(status.code === 0, `status failed:\n${status.stderr}`);
  const statuses = JSON.parse(status.stdout);
  assert(statuses.every((s) => s.offline === true), 'Expected every status entry to report offline: true');
  const cached = statuses.filter((s) => s.meta);
  assert(
    cached.length === 1 && cached[0].eventId === eventId && cached[0].meta.sessionCount === sessions.length,
    'Expected status to list only the fixture event as cached',
  );

  const statusText = await snapshot('status');
  assert(statusText.stdout.startsWith('Offline (MSEVENTS_OFFLINE)'), `Expected an offline line in status:\n${statusText.stdout}`);
  assert(!statusText.stdout.includes('last check failed'), 'Expected the frozen meta to drop the failed-check state');

  const missing = await snapshot('sessions', '--query', 'agents', '--event', 'ignite-2025', '--json');
  assert(missing.code === 0 && JSON.parse(missing.stdout).length === 0, 'Expected no results for an event outside the snapshot');
  assert(missing.stderr.includes('no cached sessions for Microsoft Ignite 2025'), `Expected a missing-event notice:\n${missing.stderr}`);

  const all = await snapshot('sessions', '--query', 'Foundry', '--json');
  assert(all.code === 0 && JSON.parse(all.stdout).length > 0, 'Expected a search across all events to use the bundled event');

  assert((await readdir(dataDir)).sort().join(',') === dataFiles.join(','), 'The bundled CLI changed the data folder');
  assert((await readdir(emptyCacheDir)).length === 0, 'The bundled CLI wrote to MSEVENTS_CACHE_DIR from the environment');

  console.log(`Snapshot smoke passed (${sameAsLive.length} commands match the CLI).`);
} finally {
  if (dataLocked) await setReadOnly(dataDir, false);
  await rm(root, { recursive: true, force: true });
}
