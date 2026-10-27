# Microsoft Events CLI `preview`

`msevents` is a terminal CLI for searching Microsoft flagship event session catalogs (Build, Ignite, AI Tour).

It fetches public session catalogs, builds a local search index, and returns filtered results — useful for agents, scripts, or quick lookups from the terminal.

## Requirements

This project requires Node.js 22 or later.

```bash
node --version
```

## Installation

### Option A: Run instantly with `npx` (no install)

```bash
npx -y @microsoft/events-cli sessions --query "Microsoft Foundry"
```

### Option B: Install globally

```bash
npm install -g @microsoft/events-cli
msevents sessions --query "Microsoft Foundry"
```

## Commands

```bash
msevents sessions --query "agent orchestration"
msevents sessions --tech "Microsoft Foundry"
msevents sessions --tech "Azure Cosmos DB" --type lab
msevents sessions --speaker "Scott Hanselman"
msevents sessions --tech "Microsoft Foundry" --speaker "Yina Arenas"
msevents sessions --event build-2025 --query "Foundry"
msevents session BRK155
msevents refresh
msevents refresh --event build-2026
msevents status
```

Available commands:

- `sessions` searches sessions across all cached events.
  - `--query <text>` keyword search across all fields (boosts title)
  - `--tech <name>` search by technology (matches product, tags, topic, languages)
  - `--speaker <name>` search by speaker name
  - `--type <type>` filter by session type (breakout, lab, demo, keynote)
  - `--event <id>` filter to a specific event (e.g., `build-2026`, `ignite-2025`)
  - `--limit <n>` max results (default: 10)
- `session <code>` looks up a specific session by code. Searches all cached events; disambiguates if the code appears in multiple events.
  - `--event <id>` scope to a specific event
- `refresh` checks for session catalog updates and updates the local cache.
  - `--event <id>` check a specific event only
  - `--force` bypass conditional revalidation and re-fetch unconditionally
- `status` shows what's cached and how fresh it is.

The `sessions` and `session` commands output human-readable text by default. Pass `--json` to get structured JSON, which is useful for piping to agents or other tools:

```bash
msevents sessions --query "Foundry" --json | jq '.[].title'
msevents session BRK155 --json
```

## Supported events

| Event | Event ID | Status |
|-------|----------|--------|
| Ignite 2026 | `ignite-2026` | Live |
| Build 2026 | `build-2026` | Live |
| Ignite 2025 | `ignite-2025` | Live |
| Build 2025 | `build-2025` | Live |

Use `--event <id>` to filter to a single event. Without it, commands search across everything cached.

## Behavior

- **Auto-refresh**: search and lookup commands are cache-first. Missing caches are fetched automatically, and existing caches are revalidated only when their next check is due.
- **Revalidation**: due caches use conditional GET (ETag/Last-Modified). A 304 response avoids downloading the catalog body; network failures fall back to stale cache.
- **Network-friendly checks**: recent checks are skipped, stable catalogs are checked less often, and failed checks use backoff with jitter to avoid request spikes.
- **Disambiguation**: if a session code exists in multiple events, the CLI shows options.
- **Results**: 10 by default, `--limit` to override.
- **Offline mode**: with `MSEVENTS_OFFLINE=1`, commands read only what's already in the cache. They never check for updates or write to the cache folder, so it can be read-only. Events without a cache are skipped with a note, `refresh` exits with an error, and `status` says it's offline (`"offline": true` on each `--json` entry).

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MSEVENTS_CACHE_DIR` | per-OS cache path | Override the local cache directory. |
| `MSEVENTS_OFFLINE` | unset | Set to `1` or `true` to use only cached data, with no network access or cache writes. |
| `MSEVENTS_FETCH_TIMEOUT_MS` | `30000` | Abort catalog requests after this many milliseconds. |
| `MSEVENTS_MAX_RESPONSE_BYTES` | `52428800` (50 MiB) | Reject catalog responses larger than this. |

## Development

To build and test from source:

```bash
cd cli
npm install
npm run build
npm test
node dist/index.js --help
```

## Microsoft 365 Copilot plugin (offline)

Microsoft 365 Copilot Cowork runs skill scripts in a sandbox with Node.js but no network access, so `npx -y @microsoft/events-cli` can't run there. `npm run build:m365` produces a Cowork-ready plugin that ships the whole `msevents` CLI as one bundled file, `scripts/msevents.mjs`, together with a frozen snapshot of its cache in `data/`. The bundle always runs in offline mode (`MSEVENTS_OFFLINE`) with its cache folder set to `../data/`, so search results match `msevents` for the same catalog data.

Each [M365 plugin release](https://github.com/microsoft/Build-CLI/releases) (tagged `m365-v<version>`) includes a prebuilt `microsoft-build-m365.zip` (see [Publishing the M365 plugin](#publishing-the-m365-plugin)). To build your own:

```bash
cd cli
npm ci
npm run build:m365 -- --plugin-version 1.0.7 --package
```

| Option | Default | Purpose |
|--------|---------|---------|
| `--plugin-version <x.y[.z]>` | repo plugin version | Plugin version. Cowork rejects versions starting with `0` and requires a higher version for every reinstall. |
| `--package` | off | Also build the installable app package zip with the [Microsoft 365 Agents Toolkit CLI](https://www.npmjs.com/package/@microsoft/m365agentstoolkit-cli) (`npm install -g @microsoft/m365agentstoolkit-cli`). |
| `--event <id>` | all supported events | Event to include; repeat for more than one. |
| `--out <dir>` | `<repo>/out/m365-plugin` | Plugin output folder (git-ignored). `--package` writes the app project to `<out>-app`. Only previous outputs are overwritten. |
| `--sessions-dir <dir>` | download live | Use an existing `msevents` cache folder (`<event>-sessions.json` and `<event>-meta.json`) instead of downloading. |

Output layout:

```text
out/
├── m365-plugin/                    # plugin folder
│   ├── .claude-plugin/plugin.json
│   ├── .mcp.json
│   └── skills/microsoft-build/
│       ├── SKILL.md                # skills/microsoft-build/SKILL.md, rewritten for offline use
│       ├── scripts/msevents.mjs    # the msevents CLI, bundled and locked to offline mode
│       └── data/                   # frozen cache: <event>-sessions.json and <event>-meta.json
└── m365-plugin-app/                # with --package: atk project
    └── appPackage/build/appPackage.zip
```

The Cowork SKILL.md is built from the repo skill, `skills/microsoft-build/SKILL.md`, so both stay in sync. The repo skill tells the agent to use `npx`, the catalog endpoints and `refresh`, none of which work in Cowork's offline sandbox, so the build:

- replaces the `## Session catalog access` section and the `compatibility`, `metadata` and `allowed-tools` frontmatter with [`cli/m365-skill/offline-overlay.md`](m365-skill/offline-overlay.md), filling in the snapshot date and bundled events;
- rewrites the remaining online steps (`npx -y @microsoft/events-cli` becomes `node scripts/msevents.mjs`, "Without CLI" fallbacks and catalog URLs are removed) with `SKILL_REWRITES` in `scripts/build-m365-plugin.mjs`;
- fails if a rewrite no longer matches the repo skill, if online wording is left, or if the result breaks Cowork's skill validation rules.

When you edit the repo skill, run `npm run smoke:m365`; CI runs it too. The result is about 28,000 characters (roughly 7,000 tokens), above the ~5,000 tokens Cowork recommends for a skill body but within what it accepts.

To install, upload the zip (`appPackage.zip` from a local build, or `microsoft-build-m365.zip` from a release) in Cowork (**Customize** → **Plugins** → **Add plugin** → **Only you**), or sideload it with `atk install --file-path <zip> --scope Personal`. Plugin skills appear only in new conversations.

The snapshot doesn't update itself. Install a newer release, or rebuild with a higher `--plugin-version` and reinstall, to pick up catalog changes. `npm run smoke:m365` builds from a fixture offline, makes the data read-only, and checks that the bundle's output matches `msevents`. With `-- --package` (needs `atk`), it also builds the app package zip, unzips it, checks that its skill files match the plugin folder, and runs the same checks against the unzipped skill; CI runs it this way.

### Publishing the M365 plugin

The [M365 plugin workflow](../.github/workflows/m365-plugin.yml) builds and publishes the plugin. Run **M365 plugin** from the **Actions** tab on `main` and enter a version. It runs `npm run build:m365 -- --package` with live catalog data, then creates a release tagged `m365-v<version>` with `microsoft-build-m365.zip` attached and marks it **Latest**, so [`releases/latest/download/microsoft-build-m365.zip`](https://github.com/microsoft/Build-CLI/releases/latest/download/microsoft-build-m365.zip) serves it.

- **Version:** the M365 plugin is versioned separately from the plugin manifests, because a catalog refresh needs a new release even without code changes. Enter `x.y.z`, higher than the last `m365-v*` release; Cowork only updates an installed plugin to a higher version.
- **Events:** leave the events field empty to bundle every supported event, or enter event IDs separated by spaces, such as `build-2026 ignite-2026`, to bundle only those. Use it when an event's catalog can't be downloaded, because the build fails if any requested event fails.
- **Testing:** the release is public as soon as the workflow finishes. To try changes first, build locally with `npm run build:m365 -- --plugin-version <version> --package` and install the zip.
