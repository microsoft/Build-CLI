---
# Offline changes for the M365 plugin's SKILL.md. `npm run build:m365` builds that SKILL.md from
# skills/microsoft-build/SKILL.md: each key here replaces the same frontmatter key (an empty value
# removes it), and the body below replaces the "## Session catalog access" section. The build
# script rewrites the rest of the skill for offline use; see SKILL_REWRITES in
# cli/scripts/build-m365-plugin.mjs.
compatibility: >-
  Built for sandboxes without internet access, such as Microsoft 365 Copilot
  Cowork. Requires Node.js 22 or later. Session data comes from an offline
  snapshot: scripts/msevents.mjs searches the catalogs bundled in data/. Docs
  come from the Microsoft Learn MCP Server or the agent's built-in web tools.
metadata:
  author: Microsoft Learn partnerships team
  domain: microsoft-build
  snapshot: "{{SNAPSHOT_DATE}}"
  msevents: "{{CLI_VERSION}}"
allowed-tools:
---

## Session catalog access

Session data comes from catalogs bundled with this skill, downloaded {{SNAPSHOT_DATE}}. This sandbox has no internet access, so it can't reach the event sites' session catalogs.

- The first time in a conversation that you recommend sessions or give session times or rooms, add one short note such as "Based on session data from {{SNAPSHOT_DATE}}; check the event site for the latest schedule," linking the event site from **Key resources**. Don't repeat it in later answers.
- If the user asks whether the data is live or up to date, answer truthfully: it was downloaded {{SNAPSHOT_DATE}}, and sessions, rooms, or times may have changed since. Never claim it's live.

### Bundled events

| Event | Event ID | Sessions | Downloaded |
|-------|----------|----------|------------|
{{SNAPSHOT_EVENTS}}

If an event isn't in this table, the script returns no sessions for it. Tell the user session data for that event isn't available here instead of guessing.

### msevents CLI (bundled)

Run the bundled script with Node from this skill's folder. If the working directory is different, use the full path to `scripts/msevents.mjs` inside this skill's folder.

```sh
# Search by keyword
node scripts/msevents.mjs sessions --query "Microsoft Foundry" --event build-2026 --json

# Search by technology (matches product, tags, topic, solution area, languages, title, description)
node scripts/msevents.mjs sessions --tech "Azure Cosmos DB" --event build-2026 --json

# Search by speaker
node scripts/msevents.mjs sessions --speaker "Scott Hanselman" --event build-2026 --json

# Combine filters
node scripts/msevents.mjs sessions --tech "Microsoft Foundry" --type lab --event build-2026 --json

# Look up a specific session by code
node scripts/msevents.mjs session BRK155 --event build-2026 --json

# Show session counts and when each catalog was downloaded
node scripts/msevents.mjs status
```

Rules for the sandbox:

- Use only `node scripts/msevents.mjs` for session data. It's the `msevents` CLI bundled into one file, running offline against the catalogs in `data/`. Don't run `npx`, `npm`, `curl`, or HTTP requests for the catalog; the sandbox has no internet access and they will fail or hang.
- Don't read or parse `data/*.json` directly. The script applies the CLI's search ranking, session-code matching, and speaker filtering.
- The bundled catalogs can't be updated from inside the sandbox.
- Use `--json` for structured output you can parse.

#### CLI reference

| Command | Options | Description |
|---------|---------|-------------|
| `sessions` | `--query <text>` | Keyword search across all fields (boosts title); session codes match exactly |
| | `--tech <name>` | Search by technology |
| | `--speaker <name>` | Search by speaker name |
| | `--type <type>` | Filter by session type (breakout, lab, demo, keynote, etc.) |
| | `--event <id>` | Filter by event ID |
| | `--limit <n>` | Max results, default 10, max 200 |
| | `--json` | Output as JSON |
| `session <code>` | `--event <id>` | Scope to one event (for disambiguation) |
| | `--json` | Output as JSON |
| `status` | `--json` | Session counts per event and when each catalog was downloaded |

`sessions` needs at least one of `--query`, `--tech`, or `--speaker`.

Session fields: `sessionCode`, `title`, `description`, `speakers`, `timeSlot`, `startDateTime`, `endDateTime`, `location`, `level`, `type`, `topic`, `solutionArea`, `product`, `languages`, `tags`, `deliveryTypes`, `viewingOptions`, `hasLiveStream`, `hasOnDemand`, `relatedSessionCodes`, `slideDeck`, `onDemand`, `event`.

### Learn MCP Server

Use the Microsoft Learn MCP tools when they're available:

| Tool | When to use |
|------|-------------|
| `microsoft_docs_search` | Find current docs for an SDK, service, or feature |
| `microsoft_docs_fetch` | Read a full documentation page |
| `microsoft_code_sample_search` | Find official code samples |

If Learn MCP tools aren't available, use your built-in web search or page fetch on `learn.microsoft.com` and the News & Announcements links. These tools run outside the sandbox. Never use them to download the session catalog; session data comes only from the bundled catalogs in `data/`, read through `scripts/msevents.mjs`.

