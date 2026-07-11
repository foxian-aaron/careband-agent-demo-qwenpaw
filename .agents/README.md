# CareBand repository contracts

This directory carries the v0.2 contracts that must travel with the standalone
`careband-agent-demo-v0.2` repository. Runtime validation reads the Agent output
Schema here first and keeps the backend copy only as a packaged fallback.

The checked-in references lock:

- the six rule-owned risk levels and rule order;
- canonical event types and sources;
- normalized `DailySnapshot` fields and source labels;
- the fixed multi-role Agent output Schema;
- the minimal local API boundary.

Keep these references synchronized with code and tests. Never place credentials,
raw health exports, precise location data, or recordings under `.agents`.
