// M3: queue up to 10 items (single stills or look groups), run a batch that
// drafts one preset per item, then stop and wait for review.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metrics } from "./analysis.ts";
import { distance, lookVector } from "./analysis.ts";
import { type DB, logEvent } from "./db.ts";
import { fitPreset } from "./fitter.ts";
import { blockedTerms, lintName, suggestName } from "./names.ts";
import { loadRaw, type Settings } from "./renderer.ts";
import { listTestPhotos, photoBase } from "./testphotos.ts";

export const BATCH_SIZE = 10;
export const MIN_TEST_PHOTOS = 3;

export interface QueueItem { id: number; kind: "still" | "look"; refIds: number[] }

const parseIds = (s: string) => JSON.parse(s) as number[];

export function queueList(db: DB): QueueItem[] {
  return (db.prepare("SELECT id, kind, ref_ids_json FROM queue ORDER BY id").all() as { id: number; kind: "still" | "look"; ref_ids_json: string }[])
    .map((q) => ({ id: q.id, kind: q.kind, refIds: parseIds(q.ref_ids_json) }));
}

/** Stills already used by a draft that wasn't rejected. */
export function usedRefIds(db: DB): Set<number> {
  const rows = db.prepare("SELECT ref_ids_json FROM drafts WHERE status NOT IN ('rejected', 'cancelled')").all() as { ref_ids_json: string }[];
  return new Set(rows.flatMap((r) => parseIds(r.ref_ids_json)));
}

/** Which draft uses each still (drafts that weren't rejected or cancelled). */
export function usedBy(db: DB): Map<number, { draftId: number; name: string; status: string }> {
  const rows = db.prepare("SELECT id, name, status, ref_ids_json FROM drafts WHERE status NOT IN ('rejected', 'cancelled') ORDER BY id").all() as
    { id: number; name: string; status: string; ref_ids_json: string }[];
  const m = new Map<number, { draftId: number; name: string; status: string }>();
  for (const d of rows) for (const id of parseIds(d.ref_ids_json)) m.set(id, { draftId: d.id, name: d.name, status: d.status });
  return m;
}

export function queueAdd(db: DB, kind: "still" | "look", refIds: number[]): { ok: boolean; error?: string } {
  const ids = [...new Set(refIds)].sort((a, b) => a - b);
  if (!ids.length) return { ok: false, error: "Nothing to add" };
  const queue = queueList(db);
  if (queue.length >= BATCH_SIZE) return { ok: false, error: `The next batch is full (${BATCH_SIZE})` };
  const queued = new Set(queue.flatMap((q) => q.refIds));
  if (ids.some((id) => queued.has(id))) return { ok: false, error: "Already in the next batch" };
  const used = usedRefIds(db);
  if (ids.some((id) => used.has(id))) return { ok: false, error: "Already used by a preset draft" };
  db.prepare("INSERT INTO queue (kind, ref_ids_json) VALUES (?, ?)").run(kind, JSON.stringify(ids));
  return { ok: true };
}

/** Fill the queue with varied, unused items: look groups count as one item. */
export function suggest(db: DB): number {
  const free = BATCH_SIZE - queueList(db).length;
  if (free <= 0) return 0;
  const blocked = new Set([...usedRefIds(db), ...queueList(db).flatMap((q) => q.refIds)]);
  const rows = db
    .prepare(
      `SELECT r.id, r.look_group AS look, a.metrics_json, a.unclear FROM refs r JOIN analyses a ON a.ref_id = r.id
        WHERE r.missing = 0 AND r.excluded = 0 AND r.dup_of IS NULL`,
    )
    .all() as { id: number; look: number | null; metrics_json: string; unclear: number }[];
  const items = new Map<string, { kind: "still" | "look"; ids: number[]; v: number[]; unclear: number }>();
  for (const r of rows) {
    if (blocked.has(r.id)) continue;
    const key = r.look ? `look:${r.look}` : `still:${r.id}`;
    const m = JSON.parse(r.metrics_json) as Metrics;
    const cur = items.get(key);
    if (cur) cur.ids.push(r.id);
    else items.set(key, { kind: r.look ? "look" : "still", ids: [r.id], v: lookVector(m), unclear: r.unclear });
  }
  // Drop look groups that are only partly free.
  const pool = [...items.values()].filter((it) => it.kind === "still" || it.ids.length > 1);
  if (!pool.length) return 0;
  // Farthest-point sampling for variety; clear stills first.
  pool.sort((a, b) => a.unclear - b.unclear || b.ids.length - a.ids.length);
  const chosen = [pool[0]];
  while (chosen.length < Math.min(free, pool.length)) {
    let best = pool[0], bestD = -1;
    for (const it of pool) {
      if (chosen.includes(it)) continue;
      const d = Math.min(...chosen.map((c) => distance(c.v, it.v))) - it.unclear * 0.15;
      if (d > bestD) { bestD = d; best = it; }
    }
    chosen.push(best);
  }
  let added = 0;
  for (const c of chosen) if (queueAdd(db, c.kind === "look" && c.ids.length > 1 ? "look" : "still", c.ids).ok) added++;
  return added;
}

export function openBatch(db: DB): { id: number; status: string } | null {
  return (db.prepare("SELECT id, status FROM batches WHERE status IN ('running', 'review') ORDER BY id DESC LIMIT 1").get() as { id: number; status: string } | undefined) ?? null;
}

export function runBlockers(db: DB, dataDir: string): string[] {
  const out: string[] = [];
  if (openBatch(db)) out.push("Finish reviewing the open batch first (approve or reject every draft).");
  if (!queueList(db).length) out.push("Add stills or look groups to the next batch, or click Suggest.");
  if (listTestPhotos(dataDir).length < MIN_TEST_PHOTOS) out.push(`Add at least ${MIN_TEST_PHOTOS} test photos (Download default set).`);
  return out;
}

function siteNames(repoRoot: string): string[] {
  const csv = join(repoRoot, "public", "presets.csv");
  if (!existsSync(csv)) return [];
  return readFileSync(csv, "utf8").split("\n").slice(1).map((l) => l.split(",")[1]?.replace(/"/g, "").trim()).filter(Boolean) as string[];
}

function describe(tags: { grp: string; value: string }[]): string {
  const moods = tags.filter((t) => t.grp === "mood").map((t) => t.value.toLowerCase());
  const colours = tags.filter((t) => t.grp === "color").map((t) => t.value.toLowerCase()).slice(0, 2);
  const good = tags.filter((t) => t.grp === "goodFor").map((t) => t.value.toLowerCase()).slice(0, 2);
  const parts = [`A ${moods.slice(0, 2).join(", ") || "cinematic"} look`];
  if (colours.length) parts[0] += ` with ${colours.join(" and ")} tones`;
  let s = parts[0] + ".";
  if (good.length) s += ` Works well for ${good.join(" and ")}.`;
  return s;
}

export interface RunResult { batchId: number; drafts: number; errors: string[]; cancelled?: boolean }

export async function runBatch(
  db: DB, dataDir: string, refsDir: string, repoRoot: string,
  onProgress?: (msg: string) => void, shouldStop?: () => boolean,
): Promise<RunResult> {
  const blockers = runBlockers(db, dataDir);
  if (blockers.length) throw new Error(blockers[0]);
  const queue = queueList(db);
  const photos = await Promise.all(listTestPhotos(dataDir).map((p) => photoBase(dataDir, p)));
  const batchId = Number(db.prepare("INSERT INTO batches (status) VALUES ('running')").run().lastInsertRowid);
  const existing = new Set([
    ...siteNames(repoRoot).map((n) => n.toLowerCase()),
    ...(db.prepare("SELECT name FROM drafts WHERE status NOT IN ('rejected', 'cancelled')").all() as { name: string }[]).map((r) => r.name.toLowerCase()),
  ]);
  const blocked = blockedTerms(db);
  const insertDraft = db.prepare(
    "INSERT INTO drafts (batch_id, kind, ref_ids_json, name, description, tags_json, settings_json, fit_loss) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertVersion = db.prepare("INSERT INTO draft_versions (draft_id, version, settings_json, source) VALUES (?, 1, ?, 'fit')");
  const result: RunResult = { batchId, drafts: 0, errors: [] };

  for (const [i, item] of queue.entries()) {
    if (shouldStop?.()) {
      // Stopped by the owner: keep the picks in the queue, park what was drafted.
      db.prepare("UPDATE drafts SET status = 'cancelled' WHERE batch_id = ?").run(batchId);
      db.prepare("UPDATE batches SET status = 'cancelled', closed_at = datetime('now') WHERE id = ?").run(batchId);
      logEvent(db, "batch-stopped", { batchId, drafted: result.drafts });
      return { ...result, cancelled: true };
    }
    onProgress?.(`Drafting ${i + 1} of ${queue.length}…`);
    try {
      const refs = item.refIds.map((id) => db.prepare("SELECT r.path, a.metrics_json FROM refs r JOIN analyses a ON a.ref_id = r.id WHERE r.id = ?").get(id) as { path: string; metrics_json: string } | undefined).filter(Boolean) as { path: string; metrics_json: string }[];
      if (!refs.length) throw new Error("Stills not analysed — run Analyse & tag first");
      const metrics = refs.map((r) => JSON.parse(r.metrics_json) as Metrics);
      const raws = await Promise.all(refs.map((r) => loadRaw(join(refsDir, r.path), 160)));
      const fit = await fitPreset(metrics, raws, photos);

      // Tags: strongest across the item's stills, owner and Claude decisions first.
      const tagRows = db
        .prepare(
          `SELECT grp, value, MAX(confidence + CASE source WHEN 'owner' THEN 1 WHEN 'claude' THEN 0.5 ELSE 0 END) AS score
             FROM tags WHERE ref_id IN (${item.refIds.map(() => "?").join(",")}) AND source != 'owner-removed'
            GROUP BY grp, value ORDER BY score DESC`,
        )
        .all(...item.refIds) as { grp: string; value: string }[];
      const limit: Record<string, number> = { goodFor: 3, mood: 2, light: 1, color: 3 };
      const tags = tagRows.filter((t) => (limit[t.grp] = (limit[t.grp] ?? 0) - 1) >= 0).map(({ grp, value }) => ({ grp, value }));

      let name = suggestName(tags, existing, item.refIds[0] + batchId);
      if (lintName(name, blocked).length) name = suggestName(tags, existing, item.refIds[0] + batchId + 11);
      existing.add(name.toLowerCase());
      const info = insertDraft.run(batchId, item.kind, JSON.stringify(item.refIds), name, describe(tags), JSON.stringify(tags), JSON.stringify(fit.settings), fit.loss);
      insertVersion.run(Number(info.lastInsertRowid), JSON.stringify(fit.settings));
      result.drafts++;
    } catch (e) {
      result.errors.push((e as Error).message);
    }
  }
  db.prepare("DELETE FROM queue").run();
  db.prepare("UPDATE batches SET status = ? WHERE id = ?").run(result.drafts ? "review" : "closed", batchId);
  logEvent(db, "batch-run", result);
  return result;
}

/**
 * Cancel a batch in review. Nothing is deleted: undecided drafts become
 * 'cancelled' (kept for the log) and their stills go back into the queue so
 * the owner can change the picks and run again. Decided drafts keep their status.
 */
export function cancelBatch(db: DB, batchId: number): { returned: number } {
  const b = db.prepare("SELECT status FROM batches WHERE id = ?").get(batchId) as { status: string } | undefined;
  if (!b || b.status !== "review") throw new Error("Only a batch in review can be cancelled");
  const undecided = db.prepare("SELECT kind, ref_ids_json FROM drafts WHERE batch_id = ? AND status = 'draft' ORDER BY id").all(batchId) as { kind: string; ref_ids_json: string }[];
  const add = db.prepare("INSERT OR IGNORE INTO queue (kind, ref_ids_json) VALUES (?, ?)");
  db.exec("BEGIN");
  try {
    for (const d of undecided) add.run(d.kind, d.ref_ids_json);
    db.prepare("UPDATE drafts SET status = 'cancelled' WHERE batch_id = ? AND status = 'draft'").run(batchId);
    db.prepare("UPDATE batches SET status = 'cancelled', closed_at = datetime('now') WHERE id = ?").run(batchId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  logEvent(db, "batch-cancelled", { batchId, returned: undecided.length });
  return { returned: undecided.length };
}

/** Close the batch once every draft is approved or rejected. */
export function maybeCloseBatch(db: DB, batchId: number): boolean {
  const left = (db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE batch_id = ? AND status = 'draft'").get(batchId) as { n: number }).n;
  if (left) return false;
  db.prepare("UPDATE batches SET status = 'closed', closed_at = datetime('now') WHERE id = ? AND status != 'closed'").run(batchId);
  logEvent(db, "batch-closed", { batchId });
  return true;
}

export function saveSettings(db: DB, draftId: number, settings: Settings, source: "owner" | "claude", note?: string) {
  const d = db.prepare("SELECT version FROM drafts WHERE id = ?").get(draftId) as { version: number } | undefined;
  if (!d) throw new Error("Draft not found");
  const last = db.prepare("SELECT id, source, created_at FROM draft_versions WHERE draft_id = ? ORDER BY version DESC LIMIT 1").get(draftId) as
    | { id: number; source: string; created_at: string }
    | undefined;
  const json = JSON.stringify(settings);
  // Consecutive slider tweaks by the owner within 5 minutes update one version instead of piling up.
  const recentOwner = last && source === "owner" && last.source === "owner" && Date.now() - Date.parse(last.created_at + "Z") < 5 * 60_000;
  if (recentOwner) {
    db.prepare("UPDATE draft_versions SET settings_json = ?, note = COALESCE(?, note) WHERE id = ?").run(json, note ?? null, last!.id);
    db.prepare("UPDATE drafts SET settings_json = ?, updated_at = datetime('now') WHERE id = ?").run(json, draftId);
    return d.version;
  }
  const v = d.version + 1;
  db.prepare("INSERT INTO draft_versions (draft_id, version, settings_json, source, note) VALUES (?, ?, ?, ?, ?)").run(draftId, v, json, source, note ?? null);
  db.prepare("UPDATE drafts SET settings_json = ?, version = ?, updated_at = datetime('now') WHERE id = ?").run(json, v, draftId);
  return v;
}
