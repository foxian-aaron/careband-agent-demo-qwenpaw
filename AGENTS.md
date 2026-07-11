# CareBand v0.2 Agent Instructions

This directory is the canonical CareBand v0.2 implementation. These instructions apply to every future chat or agent working in this repository.

## Required Context

Before making changes, read:

1. `docs/careband/PROJECT_MEMORY.md` for the latest shared status, evidence, blockers, and resume steps.
2. The relevant project skill under `.agents/skills/`.
3. The implementation and tests that support any status claim you plan to change.

After a material implementation, validation run, blocker, or external-state change, update `docs/careband/PROJECT_MEMORY.md`. Record evidence and dates; do not overwrite facts with assumptions.

## Scope and Safety

- Keep v0.2 focused on wearable ingestion, one hardware event, a real Agent summary path, a minimal backend, pilot-interview materials, and a repeatable competition demo.
- Do not make medical diagnoses or medication recommendations.
- The deterministic rule engine owns `risk_level`. An LLM may only summarize, explain evidence, and suggest non-medical follow-up actions.
- Normalize hardware, voice, medication, SOS, fall, location, and manual inputs into canonical `event` records.
- Normalize wearable and CSV imports into `DailySnapshot` records.
- Validate every Agent result against `.agents/skills/agent-json-summary-validator/references/agent_output.schema.json`.
- Never place API keys, access tokens, Wi-Fi credentials, passwords, precise elder locations, raw Apple Health XML, or identifiable interview data in Git or shared memory.
- Do not claim a real QwenPaw run, physical hardware test, real interview, consent, or human-recorded video unless corresponding evidence exists.

## Git and External Actions

- Work on the local `codex/careband-real-demo` branch unless the user explicitly changes this instruction.
- Do not push, create a pull request, deploy publicly, purchase hardware, contact interview participants, or send external messages without fresh explicit user authorization.
- Preserve unrelated user changes and TEST001 aggregated Apple Watch evidence.

## Verification Standard

- Run tests and builds proportionate to the change.
- For the primary demo, verify CSV ingestion, server-owned risk, Agent validation/provenance, task/event resolution, three-role UI consistency, reset preservation of TEST001, and visible fallback behavior.
- A compiled firmware project or UI simulator is not evidence of a physical ESP32 loop.
- Templates are not evidence of completed interviews or signed consent.
