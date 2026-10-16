// Builds a Claude-format plugin folder for Microsoft 365 Copilot Cowork with an offline session
// snapshot: skills/microsoft-build/{SKILL.md, scripts/msevents.mjs, data/<event>-*.json}.
// scripts/msevents.mjs is the whole msevents CLI bundled into one file. Its banner turns on
// offline mode (MSEVENTS_OFFLINE) and points the cache at ../data, so data/ is a frozen cache.
// Run through `npm run build:snapshot` so dist/ is up to date.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { build } from 'esbuild';
import { KNOWN_EVENTS } from '../dist/config.js';

const execFileAsync = promisify(execFile);
const cliRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(cliRoot, '..');
const SKILL_NAME = 'microsoft-build';
const SCRIPT_FILE = 'msevents.mjs';
const MB = 1024 * 1024;
// Cowork limits for files that ship next to SKILL.md.
const COMPANION_LIMITS = { files: 20, fileBytes: 5 * MB, totalBytes: 10 * MB };
// Cowork accepts up to 1 MB but recommends a SKILL.md body under ~5,000 tokens (about 20,000 characters).
const SKILL_MAX_CHARS = 20_000;
const SKILL_DESCRIPTION_MAX_CHARS = 1024;
const PRIVACY_URL = 'https://privacy.microsoft.com/privacystatement';
const TERMS_URL = 'https://www.microsoft.com/servicesagreement';
const ATK_PACKAGE = '@microsoft/m365agentstoolkit-cli';

const USAGE = `Usage: npm run build:snapshot -- [options]

Builds a Copilot Cowork plugin with an offline session snapshot.

Options:
  --out <dir>             Output folder (default: <repo>/out/cowork-plugin)
  --event <id>            Event to include; repeat for more (default: all known events)
  --sessions-dir <dir>    Use existing msevents cache files (<event>-sessions.json and
                          <event>-meta.json) instead of downloading
  --plugin-version <ver>  Override the plugin version (must not start with 0; bump for every reinstall)
  --package               Also build the installable app package zip with the Microsoft 365
                          Agents Toolkit CLI (atk) into <out>-app
  -h, --help              Show this help`;

class BuildError extends Error {}

function fail(message) {
  throw new BuildError(message);
}

const lf = (text) => text.replace(/\r\n?/g, '\n');

async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, lf(text));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveEvents(ids) {
  const wanted = ids?.length ? [...new Set(ids)] : KNOWN_EVENTS.map((e) => e.id);
  return wanted.map((id) => KNOWN_EVENTS.find((e) => e.id === id)
    ?? fail(`Unknown event "${id}". Known events: ${KNOWN_EVENTS.map((e) => e.id).join(', ')}`));
}

async function readPluginManifest(versionOverride) {
  const manifest = await readJson(join(repoRoot, '.claude-plugin', 'plugin.json'));
  if (versionOverride) manifest.version = versionOverride;
  if (typeof manifest.version !== 'string' || !/^[1-9]\d*\.\d+(\.\d+)?$/.test(manifest.version)) {
    fail(`Plugin version "${manifest.version}" isn't valid for Cowork. Use a version that doesn't start with 0, such as 1.0.7, and increase it for every reinstall.`);
  }
  if (!manifest.homepage) fail('.claude-plugin/plugin.json needs a "homepage"; Cowork requires it.');
  if (manifest.skills !== './skills/') fail(`Expected "skills": "./skills/" in .claude-plugin/plugin.json, got ${JSON.stringify(manifest.skills)}`);
  return manifest;
}

// Empties a generated output folder, but only when it looks like one of our previous outputs.
async function clearOutputDir(dir, markers, description) {
  if (isInside(dir, repoRoot) || isInside(dir, cliRoot)) {
    fail(`Refusing to use ${dir} as output: it contains the repository.`);
  }
  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    if (!markers.every((marker) => existsSync(join(dir, ...marker)))) {
      fail(`Refusing to overwrite ${dir}: it isn't empty and doesn't look like a previous ${description}.`);
    }
    await rm(dir, { recursive: true, force: true });
  }
}

async function prepareOutDir(outDir) {
  await clearOutputDir(
    outDir,
    [['.claude-plugin', 'plugin.json'], ['skills', SKILL_NAME, 'scripts', SCRIPT_FILE]],
    'snapshot build',
  );
  await mkdir(outDir, { recursive: true });
}

const ATK_MISSING = `--package needs the Microsoft 365 Agents Toolkit CLI. Install it with: npm install -g ${ATK_PACKAGE}`;

// atk is started without a shell so paths reach it unchanged. On Windows, npm installs atk as a
// .cmd shim that Node can only start through cmd.exe, so run the package's JS entry with node instead.
async function resolveAtk() {
  if (process.platform !== 'win32') return { file: 'atk', args: [] };
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    if (existsSync(join(dir, 'atk.exe'))) return { file: join(dir, 'atk.exe'), args: [] };
    const pkgDir = join(dir, 'node_modules', ...ATK_PACKAGE.split('/'));
    if (!existsSync(join(pkgDir, 'package.json'))) continue;
    const { bin } = await readJson(join(pkgDir, 'package.json'));
    const entry = typeof bin === 'string' ? bin : bin?.atk;
    if (entry) return { file: process.execPath, args: [join(pkgDir, entry)] };
  }
  fail(ATK_MISSING);
}

async function runAtk(args, cwd) {
  const atk = await resolveAtk();
  try {
    return await execFileAsync(atk.file, [...atk.args, ...args], { cwd, timeout: 300_000, maxBuffer: 16 * MB });
  } catch (err) {
    if (err.code === 'ENOENT') fail(ATK_MISSING);
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    fail(`atk ${args[0]} ${args[1] ?? ''} failed:\n${output || err.message}`);
  }
}

// Turns the plugin folder into an installable app package with the Microsoft 365 Agents Toolkit CLI.
async function packageApp(outDir, version) {
  const appDir = `${outDir}-app`;
  await clearOutputDir(appDir, [['m365agents.yml'], ['appPackage', 'manifest.json']], 'atk app project');
  console.log('Packaging with the Microsoft 365 Agents Toolkit CLI...');
  await runAtk([
    'import', 'openplugin',
    '--path', outDir,
    '--output', appDir,
    '--privacy-url', PRIVACY_URL,
    '--terms-url', TERMS_URL,
  ], dirname(outDir));

  const manifestFile = join(appDir, 'appPackage', 'manifest.json');
  if (!existsSync(manifestFile)) fail(`atk import openplugin didn't create ${manifestFile}`);
  const manifest = await readJson(manifestFile);
  if (manifest.version !== version) fail(`atk wrote app version ${manifest.version}; expected ${version}`);
  if (!manifest.agentSkills?.some((s) => s.folder === `./skills/${SKILL_NAME}`)) {
    fail(`atk didn't register skills/${SKILL_NAME} in ${manifestFile}`);
  }

  const zip = join(appDir, 'appPackage', 'build', 'appPackage.zip');
  await runAtk([
    'package',
    '--manifest-file', './appPackage/manifest.json',
    '--output-package-file', './appPackage/build/appPackage.zip',
    '--output-folder', './appPackage/build',
  ], appDir);
  if (!existsSync(zip)) fail(`atk package didn't create ${zip}`);
  return { zip, size: (await stat(zip)).size };
}

// Reads one event from an msevents cache folder and returns the files for the frozen cache.
async function readCachedEvent(dir, event) {
  const file = join(dir, `${event.id}-sessions.json`);
  if (!existsSync(file)) fail(`Missing ${file}`);

  const sessions = await readJson(file);
  if (!Array.isArray(sessions) || sessions.length === 0) fail(`${file} has no sessions`);
  const seen = new Set();
  for (const session of sessions) {
    if (typeof session?.sessionCode !== 'string' || !session.sessionCode || session.event !== event.id) {
      fail(`${file} contains a record that isn't a normalized ${event.id} session`);
    }
    if (seen.has(session.sessionCode)) {
      fail(`${file} repeats session code ${session.sessionCode}; the search index needs unique codes per event`);
    }
    seen.add(session.sessionCode);
  }

  const metaFile = join(dir, `${event.id}-meta.json`);
  const cacheMeta = existsSync(metaFile) ? await readJson(metaFile) : {};
  const fetchedAt = typeof cacheMeta.fetchedAt === 'string'
    ? cacheMeta.fetchedAt
    : (await stat(file)).mtime.toISOString();

  // Keep only what offline mode and `status` use; drop revalidation and failure state.
  const meta = {
    eventId: event.id,
    fetchedAt,
    sessionCount: sessions.length,
    ...(typeof cacheMeta.lastModified === 'string' ? { lastModified: cacheMeta.lastModified } : {}),
  };
  return { event, sessions, meta };
}

async function downloadSessions(events) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'msevents-snapshot-'));
  try {
    const results = [];
    for (const event of events) {
      console.log(`Downloading ${event.id}...`);
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['dist/index.js', 'refresh', '--event', event.id, '--force'],
        {
          cwd: cliRoot,
          env: { ...process.env, MSEVENTS_CACHE_DIR: cacheDir, MSEVENTS_OFFLINE: '' },
          timeout: 120_000,
        },
      );
      if (!existsSync(join(cacheDir, `${event.id}-sessions.json`))) {
        fail(`Couldn't download ${event.id}:\n${stdout}${stderr}`.trimEnd());
      }
      results.push(await readCachedEvent(cacheDir, event));
    }
    return results;
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

function readSkillFrontmatter(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!match?.[1]) fail('SKILL.md is missing YAML frontmatter');

  const lines = match[1].split('\n');
  const read = (key) => {
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (index === -1) fail(`SKILL.md frontmatter is missing "${key}"`);
    const inline = lines[index].slice(key.length + 1).trim();
    if (!/^[>|][+-]?$/.test(inline)) return inline.replace(/^(["'])(.*)\1$/, '$2');
    const block = [];
    for (const line of lines.slice(index + 1)) {
      if (line.trim() !== '' && !/^\s/.test(line)) break;
      block.push(line.trim());
    }
    return block.join(' ').trim();
  };

  return { name: read('name'), description: read('description') };
}

// Fills the hand-written Cowork SKILL.md template (cli/snapshot-skill/SKILL.md).
function renderSkill(template, values) {
  const rendered = lf(template).replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    if (value === undefined) fail(`Unknown placeholder ${match} in the snapshot SKILL.md template`);
    return value;
  });

  if (rendered.length >= SKILL_MAX_CHARS) {
    fail(`Rendered SKILL.md is ${rendered.length} characters; keep it to fewer than ${SKILL_MAX_CHARS} (about 5,000 tokens, Cowork's recommended maximum)`);
  }
  const { name, description } = readSkillFrontmatter(rendered);
  if (name !== SKILL_NAME) fail(`Template skill name is "${name}"; expected "${SKILL_NAME}"`);
  if (!description || description.length > SKILL_DESCRIPTION_MAX_CHARS) {
    fail(`SKILL.md description must be 1-${SKILL_DESCRIPTION_MAX_CHARS} characters (got ${description.length})`);
  }
  return rendered;
}

async function licenseNotice(pkg) {
  const pkgDir = join(cliRoot, 'node_modules', pkg);
  const { version, license } = await readJson(join(pkgDir, 'package.json'));
  const licenseFile = (await readdir(pkgDir)).find((name) => /^licen[cs]e(\.(md|txt))?$/i.test(name));
  if (!licenseFile) fail(`Bundled package ${pkg} has no license file to include`);
  const text = lf(await readFile(join(pkgDir, licenseFile), 'utf8')).trim().replaceAll('*/', '* /');
  return `${pkg}@${version} (${license})\n\n${text}`;
}

async function bundleCli(cliVersion) {
  const result = await build({
    absWorkingDir: cliRoot,
    entryPoints: ['dist/index.js'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
    metafile: true,
    legalComments: 'none',
    logLevel: 'silent',
    // The bundle can't read ../package.json at runtime, so bake the version in.
    define: { __MSEVENTS_VERSION__: JSON.stringify(cliVersion) },
  });

  const inputs = Object.keys(result.metafile.inputs).map((p) => p.replaceAll('\\', '/'));
  const packages = [...new Set(inputs
    .map((p) => /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(p)?.[1])
    .filter(Boolean))].sort();
  const notices = await Promise.all(packages.map(licenseNotice));

  // The banner runs before the bundled CLI code, so these settings win over the environment.
  const header = [
    '#!/usr/bin/env node',
    `// msevents ${cliVersion} (@microsoft/events-cli), bundled by \`npm run build:snapshot\` for offline use.`,
    '// Source: https://github.com/microsoft/Build-CLI/tree/main/cli. Do not edit; rebuild instead.',
    '// Runs in offline mode (MSEVENTS_OFFLINE) and reads the frozen session cache in ../data/.',
    "import { createRequire as __mseventsCreateRequire } from 'node:module';",
    "import { fileURLToPath as __mseventsFileURLToPath } from 'node:url';",
    'const require = __mseventsCreateRequire(import.meta.url);',
    "process.env.MSEVENTS_OFFLINE = '1';",
    "process.env.MSEVENTS_CACHE_DIR = __mseventsFileURLToPath(new URL('../data/', import.meta.url));",
    `/*\nBundled third-party packages:\n\n${notices.join('\n\n---\n\n')}\n*/`,
  ].join('\n');
  const code = result.outputFiles[0].text.replace(/^#!.*\n/, '');
  return { code: `${header}\n${code}`, packages };
}

async function listFiles(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path, base));
    else files.push({ rel: relative(base, path).replaceAll('\\', '/'), size: (await stat(path)).size });
  }
  return files;
}

async function checkSkillFolder(skillDir) {
  const companions = (await listFiles(skillDir)).filter((f) => f.rel !== 'SKILL.md');
  const total = companions.reduce((sum, f) => sum + f.size, 0);
  if (companions.length > COMPANION_LIMITS.files) fail(`Skill has ${companions.length} companion files; Cowork allows ${COMPANION_LIMITS.files}`);
  for (const f of companions) {
    if (f.size > COMPANION_LIMITS.fileBytes) fail(`${f.rel} is ${(f.size / MB).toFixed(1)} MB; Cowork allows 5 MB per file`);
    if (f.rel.split('/').some((part) => part.startsWith('.'))) fail(`${f.rel} is hidden; Cowork rejects hidden files`);
  }
  if (total > COMPANION_LIMITS.totalBytes) fail(`Skill companion files total ${(total / MB).toFixed(1)} MB; Cowork allows 10 MB`);
  return { count: companions.length, total };
}

// Runs the bundled CLI from another folder, with the environment pointing elsewhere, to check
// that it always reads the bundled data offline.
async function verifyScript(skillDir, collected, cliVersion) {
  const script = join(skillDir, 'scripts', SCRIPT_FILE);
  const env = { ...process.env, MSEVENTS_OFFLINE: '0', MSEVENTS_CACHE_DIR: join(tmpdir(), 'msevents-snapshot-unused') };
  const run = (...args) => execFileAsync(process.execPath, [script, ...args], { cwd: tmpdir(), env, timeout: 60_000 });

  const { stdout: version } = await run('--version');
  if (version.trim() !== cliVersion) fail(`Bundled CLI reported version "${version.trim()}"; expected ${cliVersion}`);

  const { stdout } = await run('status', '--json');
  const statuses = JSON.parse(stdout);
  const counts = new Map(collected.map(({ meta }) => [meta.eventId, meta.sessionCount]));
  const ok = Array.isArray(statuses) && statuses.length === KNOWN_EVENTS.length && statuses.every((s) => (
    s.offline === true && (s.meta?.sessionCount ?? null) === (counts.get(s.eventId) ?? null)
  ));
  if (!ok) fail(`Bundled CLI reported an unexpected status:\n${stdout}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      event: { type: 'string', multiple: true },
      'sessions-dir': { type: 'string' },
      'plugin-version': { type: 'string' },
      package: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const events = resolveEvents(values.event);
  const manifest = await readPluginManifest(values['plugin-version']);
  const { version: cliVersion } = await readJson(join(cliRoot, 'package.json'));
  const outDir = resolve(values.out ?? join(repoRoot, 'out', 'cowork-plugin'));
  const skillDir = join(outDir, 'skills', SKILL_NAME);

  const collected = values['sessions-dir']
    ? await Promise.all(events.map((e) => readCachedEvent(resolve(values['sessions-dir']), e)))
    : await downloadSessions(events);
  const snapshotDate = collected.map(({ meta }) => meta.fetchedAt).sort()[0].slice(0, 10);

  const template = await readFile(join(cliRoot, 'snapshot-skill', 'SKILL.md'), 'utf8');
  const skill = renderSkill(template, {
    SNAPSHOT_DATE: snapshotDate,
    CLI_VERSION: cliVersion,
    SNAPSHOT_EVENTS: collected
      .map(({ event, meta }) => `| ${event.name} | \`${event.id}\` | ${meta.sessionCount} | ${meta.fetchedAt.slice(0, 10)} |`)
      .join('\n'),
  });
  const bundle = await bundleCli(cliVersion);

  await prepareOutDir(outDir);
  await writeText(join(outDir, '.claude-plugin', 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (manifest.mcpServers) {
    await writeText(join(outDir, manifest.mcpServers), await readFile(join(repoRoot, manifest.mcpServers), 'utf8'));
  }
  await writeText(join(skillDir, 'SKILL.md'), skill);
  await writeText(join(skillDir, 'scripts', SCRIPT_FILE), bundle.code);
  for (const { event, sessions, meta } of collected) {
    await writeText(join(skillDir, 'data', `${event.id}-sessions.json`), JSON.stringify(sessions));
    await writeText(join(skillDir, 'data', `${event.id}-meta.json`), `${JSON.stringify(meta, null, 2)}\n`);
  }

  await verifyScript(skillDir, collected, cliVersion);
  const { count, total } = await checkSkillFolder(skillDir);
  const app = values.package ? await packageApp(outDir, manifest.version) : undefined;

  console.log(`
Cowork plugin written to ${outDir}
  Plugin:   ${manifest.name} ${manifest.version}
  Snapshot: ${snapshotDate} (${collected.map(({ meta }) => `${meta.eventId}: ${meta.sessionCount}`).join(', ')})
  SKILL.md: ${skill.length.toLocaleString('en-US')} of ${SKILL_MAX_CHARS.toLocaleString('en-US')} characters
  Skill files: ${count} plus SKILL.md, ${(total / MB).toFixed(2)} MB; msevents ${cliVersion} bundled with ${bundle.packages.join(', ')}
`);

  if (app) {
    console.log(`App package: ${app.zip} (${(app.size / MB).toFixed(2)} MB)

Next steps:
  Upload the zip in Cowork (Customize > Plugins > Add plugin > Only you), or run:
    atk install --file-path "${app.zip}" --scope Personal
  Then start a new Cowork conversation. Reinstalling an updated snapshot needs a higher --plugin-version.`);
  } else {
    console.log(`Next steps:
  Rerun with --package to build the installable zip (needs: npm install -g ${ATK_PACKAGE}).
  Reinstalling an updated snapshot needs a higher --plugin-version.`);
  }
}

try {
  await main();
} catch (err) {
  console.error(`build:snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
  if (!(err instanceof BuildError) && err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
}
