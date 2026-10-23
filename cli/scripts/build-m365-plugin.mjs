// Builds the Microsoft 365 Copilot plugin (a Claude-format plugin folder for Cowork) with an offline
// session snapshot: skills/microsoft-build/{SKILL.md, scripts/msevents.mjs, data/<event>-*.json}.
// scripts/msevents.mjs is the whole msevents CLI bundled into one file. Its banner turns on
// offline mode (MSEVENTS_OFFLINE) and points the cache at ../data, so data/ is a frozen cache.
// SKILL.md is the repo skill (skills/microsoft-build/SKILL.md) rewritten for offline use with
// cli/m365-skill/offline-overlay.md. Run through `npm run build:m365` so dist/ is up to date.
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
const SKILL_DESCRIPTION_MAX_CHARS = 1024;
const SKILL_SOURCE = join(repoRoot, 'skills', SKILL_NAME, 'SKILL.md');
const SKILL_OVERLAY = join(cliRoot, 'm365-skill', 'offline-overlay.md');
// The repo skill section that the overlay's body replaces.
const SKILL_SECTION = '## Session catalog access';

// Rewrites that turn the repo skill's online steps into offline ones. Each one must match, so a
// wording change in skills/microsoft-build/SKILL.md fails the build until this list is updated.
const SKILL_REWRITES = [
  {
    find: /Uses the msevents CLI for fast local search and\s+Learn MCP Server for docs\./,
    replace: 'Searches session catalogs bundled with this skill and uses Microsoft Learn for docs.',
  },
  { find: 'event ID and endpoint from', replace: 'event ID from' },
  { find: ' and its endpoint for direct fetch', replace: '' },
  { find: 'Two live data sources, no static files:', replace: 'Two data sources:' },
  {
    find: 'accessed via the msevents CLI for local search, caching, and multi-event support',
    replace: 'bundled with this skill and searched offline with `scripts/msevents.mjs`',
  },
  { find: 'the live catalog (via CLI or endpoint)', replace: 'the bundled catalogs (via `scripts/msevents.mjs`)' },
  { find: '(CLI fails and endpoint is down)', replace: '(`scripts/msevents.mjs` fails)' },
  { find: ' (or the mslearn CLI fallback)', replace: '' },
  { find: 'npx -y @microsoft/events-cli', replace: 'node scripts/msevents.mjs' },
  { find: /^[ \t]*- \*\*Without CLI\*\*:.*\n/gm, replace: '' },
  { find: '**With CLI**: ', replace: '' },
  { dropColumn: 'Catalog Endpoint' },
  { find: /^\|.*-session-info.*\n/gm, replace: '' },
  { find: /^\| CLI source \|.*\n/m, replace: '' },
];

// Online-only instructions that must not reach the offline skill. The overlay's section is exempt.
const OFFLINE_FORBIDDEN = [
  [/\bnpx\b|@microsoft\/[\w-]+-cli\b|\bmslearn\b/, 'npx or an npm CLI'],
  [/\brefresh\b/i, 'refreshing the catalog'],
  [/-session-info\b|\bendpoints?\b|\bdirect HTTP fetch\b|\bfetch the catalog\b/i, 'the online session catalog'],
  [/\blive catalog\b|\*\*With(out)? CLI\*\*/i, 'the live catalog'],
  [/\.\.\/\.\.\/cli\b/, 'a repo path'],
];
const PRIVACY_URL = 'https://privacy.microsoft.com/privacystatement';
const TERMS_URL = 'https://www.microsoft.com/servicesagreement';
const ATK_PACKAGE = '@microsoft/m365agentstoolkit-cli';

const USAGE = `Usage: npm run build:m365 -- [options]

Builds the Microsoft 365 Copilot plugin for Cowork with an offline session snapshot.

Options:
  --out <dir>             Output folder (default: <repo>/out/m365-plugin)
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
    'M365 plugin build',
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
  const cacheDir = await mkdtemp(join(tmpdir(), 'msevents-m365-'));
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

function splitFrontmatter(markdown, file) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!match) fail(`${file} is missing YAML frontmatter`);
  return { frontmatter: match[1], body: markdown.slice(match[0].length) };
}

function readSkillFrontmatter(markdown) {
  const lines = splitFrontmatter(markdown, 'SKILL.md').frontmatter.split('\n');
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

// Splits YAML frontmatter into top-level entries (a `key:` line plus its indented lines), dropping comments.
function frontmatterEntries(yaml) {
  const entries = [];
  for (const line of yaml.split('\n')) {
    if (line.startsWith('#')) continue;
    const key = /^([A-Za-z][\w-]*):/.exec(line)?.[1];
    if (key) entries.push({ key, lines: [line] });
    else if (entries.length) entries.at(-1).lines.push(line);
    else if (line.trim()) fail(`Unexpected frontmatter line: ${line}`);
  }
  return entries;
}

// Replaces the repo skill's frontmatter keys with the overlay's; an empty overlay value removes the key.
function mergeFrontmatter(base, overrides) {
  const entries = frontmatterEntries(base);
  for (const override of frontmatterEntries(overrides)) {
    const index = entries.findIndex((entry) => entry.key === override.key);
    const remove = override.lines.join('\n').slice(override.key.length + 1).trim() === '';
    if (remove && index === -1) fail(`The overlay removes frontmatter key "${override.key}", which the repo skill doesn't have`);
    if (remove) entries.splice(index, 1);
    else if (index === -1) entries.push(override);
    else entries[index] = override;
  }
  return entries.flatMap((entry) => entry.lines).join('\n');
}

function replaceSection(markdown, heading, replacement) {
  const start = markdown.indexOf(`\n${heading}\n`);
  if (start === -1 || markdown.indexOf(`\n${heading}\n`, start + 1) !== -1) {
    fail(`Expected one "${heading}" section in skills/${SKILL_NAME}/SKILL.md for the offline overlay to replace`);
  }
  const end = markdown.indexOf('\n## ', start + 1);
  if (end === -1) fail(`Expected another "## " section after "${heading}" in skills/${SKILL_NAME}/SKILL.md`);
  return `${markdown.slice(0, start + 1)}${replacement}${markdown.slice(end + 1)}`;
}

// Removes a column, by header text, from every Markdown table that has it.
function dropTableColumn(markdown, header) {
  const lines = markdown.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|') || lines[i - 1]?.startsWith('|')) continue;
    const column = lines[i].split('|').findIndex((cell) => cell.trim() === header);
    if (column === -1) continue;
    count++;
    for (let row = i; row < lines.length && lines[row].startsWith('|'); row++) {
      const cells = lines[row].split('|');
      cells.splice(column, 1);
      lines[row] = cells.join('|');
    }
  }
  return { text: lines.join('\n'), count };
}

function applyRewrite(text, rewrite) {
  let result;
  if (rewrite.dropColumn) {
    result = dropTableColumn(text, rewrite.dropColumn);
  } else if (typeof rewrite.find === 'string') {
    result = { text: text.replaceAll(rewrite.find, rewrite.replace), count: text.split(rewrite.find).length - 1 };
  } else {
    const count = rewrite.find.global ? (text.match(rewrite.find)?.length ?? 0) : Number(rewrite.find.test(text));
    result = { text: text.replace(rewrite.find, rewrite.replace), count };
  }
  if (result.count === 0) {
    const what = rewrite.dropColumn ? `table column "${rewrite.dropColumn}"` : String(rewrite.find);
    fail(`skills/${SKILL_NAME}/SKILL.md no longer contains ${what}. Update SKILL_REWRITES in cli/scripts/build-m365-plugin.mjs to match it.`);
  }
  return result.text;
}

function fillPlaceholders(template, values) {
  return template.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    if (value === undefined) fail(`Unknown placeholder ${match} in cli/m365-skill/offline-overlay.md`);
    return value;
  });
}

// Builds the Cowork SKILL.md from the repo skill: the overlay replaces frontmatter keys and the
// catalog-access section, SKILL_REWRITES fix the rest, and OFFLINE_FORBIDDEN catches anything missed.
function buildSkill(source, overlay, values) {
  const repoSkill = splitFrontmatter(lf(source), `skills/${SKILL_NAME}/SKILL.md`);
  const offline = splitFrontmatter(fillPlaceholders(lf(overlay), values), 'cli/m365-skill/offline-overlay.md');
  const marker = '\u0000OFFLINE_SECTION\u0000';

  let text = `---\n${mergeFrontmatter(repoSkill.frontmatter, offline.frontmatter)}\n---\n${replaceSection(repoSkill.body, SKILL_SECTION, marker)}`;
  for (const rewrite of SKILL_REWRITES) text = applyRewrite(text, rewrite);
  const lines = text.split('\n');
  for (const [pattern, what] of OFFLINE_FORBIDDEN) {
    const line = lines.find((l) => pattern.test(l));
    if (line !== undefined) {
      fail(`The M365 SKILL.md would still mention ${what}, which doesn't work offline:\n  ${line.trim()}\nUpdate SKILL_REWRITES in cli/scripts/build-m365-plugin.mjs or cli/m365-skill/offline-overlay.md for this change in skills/${SKILL_NAME}/SKILL.md.`);
    }
  }
  const skill = text.replace(marker, `${offline.body.trim()}\n\n`);

  const { name, description } = readSkillFrontmatter(skill);
  if (name !== SKILL_NAME) fail(`Skill name is "${name}"; expected "${SKILL_NAME}"`);
  if (!description || description.length > SKILL_DESCRIPTION_MAX_CHARS) {
    fail(`SKILL.md description must be 1-${SKILL_DESCRIPTION_MAX_CHARS} characters (got ${description.length})`);
  }
  return skill;
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
    `// msevents ${cliVersion} (@microsoft/events-cli), bundled by \`npm run build:m365\` for offline use.`,
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
  const env = { ...process.env, MSEVENTS_OFFLINE: '0', MSEVENTS_CACHE_DIR: join(tmpdir(), 'msevents-m365-unused') };
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
  const outDir = resolve(values.out ?? join(repoRoot, 'out', 'm365-plugin'));
  const skillDir = join(outDir, 'skills', SKILL_NAME);

  const collected = values['sessions-dir']
    ? await Promise.all(events.map((e) => readCachedEvent(resolve(values['sessions-dir']), e)))
    : await downloadSessions(events);
  const snapshotDate = collected.map(({ meta }) => meta.fetchedAt).sort()[0].slice(0, 10);

  const skill = buildSkill(await readFile(SKILL_SOURCE, 'utf8'), await readFile(SKILL_OVERLAY, 'utf8'), {
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
M365 plugin written to ${outDir}
  Plugin:   ${manifest.name} ${manifest.version}
  Snapshot: ${snapshotDate} (${collected.map(({ meta }) => `${meta.eventId}: ${meta.sessionCount}`).join(', ')})
  SKILL.md: ${skill.length.toLocaleString('en-US')} characters, built from skills/${SKILL_NAME}/SKILL.md
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
  console.error(`build:m365 failed: ${err instanceof Error ? err.message : String(err)}`);
  if (!(err instanceof BuildError) && err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
}
