// backend/src/db.js
//
// CareBand Stage 3 — minimal SQLite foundation.
//
// Responsibilities (and nothing more):
//   * openDatabase(filename) — open (or reopen) a better-sqlite3 handle, ensure
//     the parent directory exists, enable foreign keys, switch file databases
//     to WAL, then apply the schema + register the initial migration + run an
//     idempotent seed — all inside a single transaction.
//   * getDb()  — return the open handle, opening the default file if needed.
//   * closeDb() — close the current handle.
//
// No v0.2 ALTER / normalization is performed here. No business read/write APIs
// are exposed in this stage.

import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "schema.sql");
const DEFAULT_DB_PATH = join(__dirname, "..", "data", "careband.sqlite");

/** Initial migration identifier — registered exactly once. */
export const INITIAL_MIGRATION_ID = "0001-core-schema";

/**
 * Idempotent seed subjects: four fictional elders and one team test subject.
 * No snapshots / events / tasks / agent_outputs / health or risk records are
 * seeded in this stage.
 */
const SEED_SUBJECTS = [
  { elder_id: "E001", name: "Fictional Elder A", age: 78, room: "101", risk_tags: [], subject_kind: "elder" },
  { elder_id: "E002", name: "Fictional Elder B", age: 82, room: "102", risk_tags: [], subject_kind: "elder" },
  { elder_id: "E003", name: "Fictional Elder C", age: 75, room: "103", risk_tags: [], subject_kind: "elder" },
  { elder_id: "E004", name: "Fictional Elder D", age: 80, room: "104", risk_tags: [], subject_kind: "elder" },
  {
    elder_id: "TEST001",
    name: "Team Test Subject (not a real elder)",
    age: null,
    room: null,
    risk_tags: [],
    subject_kind: "team_test",
  },
];

let db = null;

/**
 * Apply the schema, register the initial migration and run the idempotent seed
 * inside a single transaction.
 */
function initialize(handle) {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const now = new Date().toISOString();

  const run = handle.transaction(() => {
    // Create the tables first; statements referencing them are prepared only
    // afterwards so their schema references resolve.
    handle.exec(schema);

    const insertMigration = handle.prepare(
      "INSERT OR IGNORE INTO schema_migrations (migration_id, applied_at) VALUES (?, ?)",
    );
    insertMigration.run(INITIAL_MIGRATION_ID, now);

    const insertSubject = handle.prepare(
      `INSERT OR IGNORE INTO elders
         (elder_id, name, age, room, risk_tags, subject_kind, created_at)
       VALUES (@elder_id, @name, @age, @room, @risk_tags, @subject_kind, @created_at)`,
    );
    for (const subject of SEED_SUBJECTS) {
      insertSubject.run({
        ...subject,
        risk_tags: JSON.stringify(subject.risk_tags),
        created_at: now,
      });
    }
  });

  run();
}

/**
 * Open (or reopen) a SQLite database at `filename`.
 *
 * Any previously-opened handle is closed first, so callers can reopen / switch
 * files and file handles are released (important for cleanup on Windows).
 *
 * @param {string} [filename] Defaults to backend/data/careband.sqlite.
 * @returns {import("better-sqlite3").Database}
 */
export function openDatabase(filename = DEFAULT_DB_PATH) {
  if (db !== null) {
    try {
      db.close();
    } catch {
      // Already closed — nothing to do.
    }
    db = null;
  }

  const isFile = filename !== ":memory:";
  if (isFile) {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const handle = new Database(filename);
  // foreign_keys must be set outside a transaction.
  handle.pragma("foreign_keys = ON");
  // journal_mode = WAL only for file databases.
  if (isFile) {
    handle.pragma("journal_mode = WAL");
  }

  try {
    initialize(handle);
  } catch (err) {
    // Never leak an open handle if initialization fails.
    handle.close();
    throw err;
  }
  db = handle;
  return handle;
}

/**
 * Return the current database handle, opening the default file if none is open.
 *
 * @returns {import("better-sqlite3").Database}
 */
export function getDb() {
  if (db === null) {
    return openDatabase(DEFAULT_DB_PATH);
  }
  return db;
}

/**
 * Close the current database handle, if any.
 */
export function closeDb() {
  if (db !== null) {
    db.close();
    db = null;
  }
}

export { DEFAULT_DB_PATH };
export default { openDatabase, getDb, closeDb, INITIAL_MIGRATION_ID };
