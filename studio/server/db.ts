import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [
  `CREATE TABLE films (
     id INTEGER PRIMARY KEY,
     folder TEXT NOT NULL UNIQUE,          -- path under refs/, e.g. "summer-of-85"
     title TEXT NOT NULL,
     meta_json TEXT NOT NULL DEFAULT '{}', -- optional info (year, credits, page) from a .json file
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE refs (
     id INTEGER PRIMARY KEY,
     film_id INTEGER NOT NULL REFERENCES films(id),
     sha256 TEXT NOT NULL UNIQUE,
     path TEXT NOT NULL,                   -- relative to refs/
     still_no INTEGER,
     source_url TEXT,
     width INTEGER,
     height INTEGER,
     excluded INTEGER NOT NULL DEFAULT 0,
     missing INTEGER NOT NULL DEFAULT 0,   -- file no longer on disk at last import
     imported_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX refs_film ON refs(film_id);
   CREATE TABLE events (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL DEFAULT (datetime('now')),
     kind TEXT NOT NULL,
     detail_json TEXT NOT NULL DEFAULT '{}'
   );`,
  // M2: analysis, tags, near-duplicates, look groups.
  `CREATE TABLE analyses (
     ref_id INTEGER PRIMARY KEY REFERENCES refs(id),
     version INTEGER NOT NULL,
     metrics_json TEXT NOT NULL,
     dhash TEXT NOT NULL,
     unclear INTEGER NOT NULL DEFAULT 0,
     analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE tags (
     ref_id INTEGER NOT NULL REFERENCES refs(id),
     grp TEXT NOT NULL,
     value TEXT NOT NULL,
     confidence REAL NOT NULL,
     source TEXT NOT NULL,                 -- rules | claude | owner | owner-removed
     PRIMARY KEY (ref_id, grp, value)
   );
   CREATE INDEX tags_value ON tags(grp, value);
   ALTER TABLE refs ADD COLUMN dup_of INTEGER;          -- representative of a near-duplicate set
   ALTER TABLE refs ADD COLUMN look_group INTEGER;      -- id of the look group's first member
   ALTER TABLE refs ADD COLUMN look_locked INTEGER NOT NULL DEFAULT 0; -- owner removed it from grouping
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec("COMMIT");
  }
  return db;
}

export function logEvent(db: DB, kind: string, detail: unknown) {
  db.prepare("INSERT INTO events (kind, detail_json) VALUES (?, ?)").run(kind, JSON.stringify(detail));
}
