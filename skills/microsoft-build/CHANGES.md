# SKILL.md changes — CLI search behavior section

Added a "CLI search behavior" section after the CLI reference table.

## Why

We tested the `msevents` CLI with four developer personas (`.NET`, `AI/ML`, `DevOps`, `frontend/JS`) each running 5-8 searches to build a Build 2025 schedule. The CLI does keyword matching, and agents need to know its quirks to get good results:

- Multi-word queries like "infrastructure as code" match words independently, causing false positives
- No synonym expansion — "frontend" returns 0 results despite relevant sessions existing
- Acronyms like "OTel" and "IaC" silently miss sessions
- Ranking drops off sharply after top 3; default `--limit 10` is too low when lab duplicates consume slots
- `--tech` gives much cleaner results than `--query` for known product names

Without this guidance, agents return poor recommendations for non-Microsoft-vocabulary queries.

## Verification (CLI v0.2.0)

Each claim was independently tested against live session data. All confirmed.

| Claim | Test | Result |
|-------|------|--------|
| Multi-word = OR matching | `--query "infrastructure as code"` (limit 10) | ✅ Top 4 are IaC-relevant, but results 7+ match just "code" (VS Code, Code Assurance, Low-Code) |
| No synonym expansion | `--query "frontend"` | ✅ **0 results** — while `--query "web"` returns 5 relevant sessions |
| Acronyms miss sessions | `--query "OTel"` → 1 result; `--query "OpenTelemetry"` → 6 results | ✅ OTel misses 5 of 6 OpenTelemetry sessions |
| Lab duplicates consume slots | `--query "Kubernetes" --limit 15` | ✅ 6 of 15 slots are R1/R2/ODLAB duplicates (LAB348, LAB342, LAB345) |
| `--tech` > `--query` precision | `--tech "Bicep"` vs `--query "Bicep"` | ✅ `--tech` returns focused IaC sessions; `--query` pulls in less relevant hits |
