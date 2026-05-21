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

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MSEVENTS_CACHE_DIR` | per-OS cache path | Override the local cache directory. |
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
