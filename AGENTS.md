# AGENTS.md

This repo packages the **Microsoft Events** assistant plugin and the `@microsoft/events-cli` CLI. The plugin helps agents use live Microsoft Build and Ignite session catalogs; the CLI fetches, caches, normalizes, and searches those catalogs.

## Plugin ecosystems

The repo publishes plugin metadata for GitHub Copilot and Claude Code. Keep shared product identity fields aligned across the manifests when changing the plugin name, description, version, author, repository, keywords, license, skills path, or MCP wiring.

**Shared assets** used by the plugin ecosystems:
- `skills\microsoft-build\SKILL.md` — the active skill prompt
- `.mcp.json` — Microsoft Learn MCP endpoint config
- `cli\` — source for the `@microsoft/events-cli` package used by the skill

**GitHub Copilot** — `.github\plugin\plugin.json` is the Copilot marketplace manifest and points at the repo root.

**Claude Code** — `.claude-plugin\plugin.json` defines the Claude Code plugin package; `.claude-plugin\marketplace.json` defines Claude Code marketplace publishing metadata.

## Sync rules

- Event support is duplicated by design between the CLI and skill docs. When adding, removing, or renaming events, update `cli\src\config.ts`, the supported/default event guidance in `skills\microsoft-build\SKILL.md`, and affected tests/docs together.
- Treat `skills\microsoft-build\SKILL.md` as the product contract for event-session behavior. For Build, Ignite, or event-session work: default "Build" to `build-2026`, get session metadata from the live catalog through `msevents` or the endpoint, get SDK/API facts from Microsoft Learn MCP, and never invent session IDs, speakers, schedules, or links.
- Keep README install/client guidance aligned with plugin manifest, skill, MCP, or CLI behavior changes.

## CLI

Source is in `cli\src\`, built output is `cli\dist\`, and the published binary is `msevents`. Targets Node.js 22+. TypeScript source is ESM/NodeNext: local imports between TS modules use `.js` extensions.

Run from `cli\`:

```powershell
npm ci
npm run build
npm test
npx vitest run test\search.test.ts
npx vitest run test\search.test.ts -t "finds sessions by title keyword"
npm run smoke:fixture
```

`npm run smoke:live` hits the live catalog; CI only runs it outside pull requests.

## CLI behavior contracts

- Catalog data has inconsistent shapes: fields may be strings, `{ displayValue }` objects, arrays, or empty values. Normalize through the helpers in `cli\src\data\normalize.ts`; records without `sessionCode` are intentionally skipped.
- Cache behavior is part of the CLI contract. `ensureCache` loads cached sessions, revalidates when due, fetches missing event caches, and only falls back to stale cache when the stale data is scoped to the request. Tests use `MSEVENTS_CACHE_DIR` to isolate cache state.
- Search behavior is intentionally specialized: the `msevents sessions` command requires `--query`, `--tech`, or `--speaker`; code-like queries exact-match session codes and variants; technology search spans product/tags/topic/solution area/languages/title/description; speaker search post-filters on the queried last name.

## General principles

- Make the smallest synchronized set of edits that keeps plugin manifests, skills, CLI behavior, and user-facing docs coherent.
- Prefer fixing drift between ecosystems immediately over documenting known inconsistency.
