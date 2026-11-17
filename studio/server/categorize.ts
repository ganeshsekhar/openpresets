// M2: analyse every still, tag it with the free rules, find near-duplicates,
// and group stills whose colour grading is close. No AI here.
import { join } from "node:path";
import { ANALYSIS_VERSION, analyzeImage, distance, hamming, lookVector, type Metrics } from "./analysis.ts";
import { type DB, logEvent } from "./db.ts";
import { tagsFor } from "./rules.ts";

export const LOOK_DEFAULTS = { threshold: 0.45, maxSize: 6 };
export const DUP_HAMMING = 6;

export function getSetting(db: DB, key: string, fallback: number): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? Number(row.value) : fallback;
}
export function setSetting(db: DB, key: string, value: number) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

/** Hard limits: two stills can only share a look if these are all close. */
function compatible(a: Metrics, b: Metrics) {
  return (
    a.mono === b.mono &&
    Math.abs(a.warmth - b.warmth) <= 8 &&
    Math.abs(a.tint - b.tint) <= 8 &&
    Math.abs(a.lMean - b.lMean) <= 14 &&
    Math.abs(a.contrast - b.contrast) <= 18
  );
}

/**
 * Complete-linkage clustering: every member of a group must be within
 * `threshold` of every other member (no chaining), plus the hard limits above,
 * and groups never exceed `maxSize`.
 */
export function lookGroups(items: { id: number; m: Metrics }[], threshold: number, maxSize: number): number[][] {
  const v = items.map((x) => lookVector(x.m));
  const n = items.length;
  const D: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => distance(v[i], v[j])));
  let groups = items.map((_, i) => [i]);
  for (;;) {
    let best: { a: number; b: number; d: number } | null = null;
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        if (groups[a].length + groups[b].length > maxSize) continue;
        let max = 0;
        let ok = true;
        outer: for (const i of groups[a]) {
          for (const j of groups[b]) {
            if (D[i][j] > threshold || !compatible(items[i].m, items[j].m)) { ok = false; break outer; }
            if (D[i][j] > max) max = D[i][j];
          }
        }
        if (ok && (!best || max < best.d)) best = { a, b, d: max };
      }
    }
    if (!best) break;
    groups[best.a] = groups[best.a].concat(groups[best.b]);
    groups.splice(best.b, 1);
  }
  return groups.filter((g) => g.length > 1).map((g) => g.map((i) => items[i].id).sort((x, y) => x - y));
}

export interface CategorizeResult {
  analyzed: number;
  tagged: number;
  unclear: number;
  dupSets: number;
  lookGroups: number;
  grouped: number;
  errors: { id: number; error: string }[];
}

export async function categorize(db: DB, refsDir: string, opts: { force?: boolean } = {}): Promise<CategorizeResult> {
  const result: CategorizeResult = { analyzed: 0, tagged: 0, unclear: 0, dupSets: 0, lookGroups: 0, grouped: 0, errors: [] };
  const refs = db
    .prepare(
      `SELECT r.id, r.path, a.version FROM refs r LEFT JOIN analyses a ON a.ref_id = r.id WHERE r.missing = 0 ORDER BY r.id`,
    )
    .all() as { id: number; path: string; version: number | null }[];

  const saveAnalysis = db.prepare(
    `INSERT INTO analyses (ref_id, version, metrics_json, dhash, unclear) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ref_id) DO UPDATE SET version = excluded.version, metrics_json = excluded.metrics_json,
       dhash = excluded.dhash, unclear = excluded.unclear, analyzed_at = datetime('now')`,
  );
  const clearRuleTags = db.prepare("DELETE FROM tags WHERE ref_id = ? AND source = 'rules'");
  const ownerDecided = db.prepare("SELECT 1 FROM tags WHERE ref_id = ? AND grp = ? AND value = ? AND source != 'rules'");
  const addTag = db.prepare("INSERT OR IGNORE INTO tags (ref_id, grp, value, confidence, source) VALUES (?, ?, ?, ?, 'rules')");
  const setUnclear = db.prepare("UPDATE analyses SET unclear = ? WHERE ref_id = ?");

  for (const r of refs) {
    const needs = opts.force || r.version !== ANALYSIS_VERSION;
    try {
      let metrics: Metrics;
      if (needs) {
        const a = await analyzeImage(join(refsDir, r.path));
        metrics = a.metrics;
        saveAnalysis.run(r.id, ANALYSIS_VERSION, JSON.stringify(metrics), a.dhash, 0);
        result.analyzed += 1;
      } else {
        metrics = JSON.parse((db.prepare("SELECT metrics_json FROM analyses WHERE ref_id = ?").get(r.id) as { metrics_json: string }).metrics_json);
      }
      // Re-tag every time (rules may have changed); never override owner or Claude decisions.
      const { tags, unclear } = tagsFor(metrics);
      clearRuleTags.run(r.id);
      for (const t of tags) if (!ownerDecided.get(r.id, t.grp, t.value)) addTag.run(r.id, t.grp, t.value, t.confidence);
      const hasClaude = db.prepare("SELECT 1 FROM tags WHERE ref_id = ? AND source IN ('claude','owner')").get(r.id);
      setUnclear.run(unclear && !hasClaude ? 1 : 0, r.id);
      if (unclear && !hasClaude) result.unclear += 1;
      result.tagged += 1;
    } catch (e) {
      result.errors.push({ id: r.id, error: (e as Error).message });
    }
  }

  // Near-duplicates (same frame re-saved / cropped): keep the largest as representative.
  const rows = db
    .prepare(
      `SELECT r.id, r.width, r.excluded, r.look_locked, a.dhash, a.metrics_json FROM refs r JOIN analyses a ON a.ref_id = r.id WHERE r.missing = 0`,
    )
    .all() as { id: number; width: number; excluded: number; look_locked: number; dhash: string; metrics_json: string }[];
  db.prepare("UPDATE refs SET dup_of = NULL").run();
  const setDup = db.prepare("UPDATE refs SET dup_of = ? WHERE id = ?");
  const seen = new Set<number>();
  for (const a of rows) {
    if (seen.has(a.id)) continue;
    const set = rows.filter((b) => !seen.has(b.id) && hamming(a.dhash, b.dhash) <= DUP_HAMMING);
    if (set.length < 2) continue;
    set.forEach((b) => seen.add(b.id));
    const rep = set.reduce((x, y) => ((y.width ?? 0) > (x.width ?? 0) ? y : x));
    for (const b of set) if (b.id !== rep.id) setDup.run(rep.id, b.id);
    result.dupSets += 1;
  }

  // Look groups among usable stills (not excluded, not a duplicate copy, not unlocked by owner).
  const usable = rows.filter((r) => !r.excluded && !r.look_locked && !(db.prepare("SELECT dup_of FROM refs WHERE id = ?").get(r.id) as { dup_of: number | null }).dup_of);
  const threshold = getSetting(db, "look_threshold", LOOK_DEFAULTS.threshold);
  const maxSize = getSetting(db, "look_max_size", LOOK_DEFAULTS.maxSize);
  const groups = lookGroups(usable.map((r) => ({ id: r.id, m: JSON.parse(r.metrics_json) })), threshold, maxSize);
  db.prepare("UPDATE refs SET look_group = NULL").run();
  const setLook = db.prepare("UPDATE refs SET look_group = ? WHERE id = ?");
  for (const g of groups) for (const id of g) setLook.run(g[0], id);
  result.lookGroups = groups.length;
  result.grouped = groups.reduce((s, g) => s + g.length, 0);

  logEvent(db, "categorize", { ...result, threshold, maxSize });
  return result;
}
