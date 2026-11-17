import { createReadStream, existsSync, readFileSync, watch } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, DB_PATH, HOST, PORT, REFS_DIR, THUMBS_DIR } from "./config.ts";
import { logEvent, openDb } from "./db.ts";
import { importRefs, isInside } from "./importer.ts";
import { categorize, getSetting, LOOK_DEFAULTS, setSetting } from "./categorize.ts";
import { claudePass, PER_SHEET, unclearRefs, type ClaudeResult } from "./claude.ts";
import { GROUP_LABEL, GROUPS, TAXONOMY, type Group } from "./rules.ts";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { BATCH_SIZE, usedBy, cancelBatch, maybeCloseBatch, openBatch, queueAdd, queueList, runBatch, runBlockers, saveSettings, suggest } from "./batches.ts";
import { blockedTerms, lintName } from "./names.ts";
import { renderFile, SLIDERS, toLightroom, type Settings } from "./renderer.ts";
import { downloadDefaultSet, DEFAULT_SET, listTestPhotos, retiredPresent, testDir } from "./testphotos.ts";
import { presetToXmp } from "../../src/xmp.ts";
import { refineDraft } from "./refine.ts";
import { discardStaged, library, publishLive, repoChanges, setGallery, setListed, stage, startSitePreview, stopSitePreview } from "./publish.ts";

// OP_REPO lets tests point publishing at a throwaway clone instead of this repo.
const REPO_ROOT = process.env.OP_REPO ?? fileURLToPath(new URL("../../", import.meta.url));
const RENDERS_DIR = join(DATA_DIR, "renders");
let lastBatch: { at: string; batchId?: number; drafts: number; errors: string[] } | null = null;
let lastRefine: { at: string; draftId: number; ok: boolean; message: string } | null = null;
let lastPublish: { at: string; kind: "stage" | "live"; ok: boolean; message: string; detail?: unknown } | null = null;

// Live reload: the browser tab reloads when the server restarts (new boot id)
// or when files in ui/ change. Server code changes restart Node via --watch.
const BOOT_ID = String(Date.now());
const liveClients = new Set<ServerResponse>();
let uiTimer: ReturnType<typeof setTimeout> | undefined;
try {
  watch(fileURLToPath(new URL("../ui/", import.meta.url)), () => {
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => { for (const c of liveClients) c.write("event: reload\ndata: ui\n\n"); }, 150);
  });
} catch (e) {
  console.warn("Live reload for ui/ is off:", (e as Error).message);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function refInfo(ids: number[]) {
  return ids.map((id) => db.prepare(
    "SELECT r.id, r.sha256, r.still_no AS stillNo, f.title FROM refs r JOIN films f ON f.id = r.film_id WHERE r.id = ?",
  ).get(id)).filter(Boolean);
}

function draftRow(id: number) {
  const d = db.prepare("SELECT * FROM drafts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!d) return null;
  const settings = JSON.parse(d.settings_json as string) as Settings;
  return {
    id: d.id, batchId: d.batch_id, kind: d.kind, refs: refInfo(JSON.parse(d.ref_ids_json as string)),
    name: d.name, description: d.description, tags: JSON.parse(d.tags_json as string), settings,
    hash: createHash("sha1").update(d.settings_json as string).digest("hex").slice(0, 12),
    version: d.version, status: d.status, rejectReason: d.reject_reason, lrVerified: !!d.lr_verified, fitLoss: d.fit_loss,
    nameIssues: lintName(String(d.name), blockedTerms(db)),
  };
}

const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));
const db = openDb(DB_PATH);
let importing = false;
let job: { label: string; progress: string } | null = null;
let stopBatch = false;
let lastClaude: (ClaudeResult & { at: string }) | null = null;

function categorizeStatus() {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const unclear = unclearRefs(db).length;
  const last = db.prepare("SELECT at, detail_json FROM events WHERE kind = 'categorize' ORDER BY id DESC LIMIT 1").get() as
    | { at: string; detail_json: string }
    | undefined;
  return {
    total: n("SELECT COUNT(*) AS n FROM refs WHERE missing = 0 AND excluded = 0"),
    analyzed: n("SELECT COUNT(*) AS n FROM analyses a JOIN refs r ON r.id = a.ref_id WHERE r.missing = 0 AND r.excluded = 0"),
    unclear,
    sheetsNeeded: Math.ceil(unclear / PER_SHEET),
    lookGroups: n("SELECT COUNT(DISTINCT look_group) AS n FROM refs WHERE look_group IS NOT NULL AND missing = 0"),
    dupCopies: n("SELECT COUNT(*) AS n FROM refs WHERE dup_of IS NOT NULL AND missing = 0"),
    job,
    lastRun: last ? { at: last.at, ...JSON.parse(last.detail_json) } : null,
    lastClaude,
  };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendFile(res: ServerResponse, path: string, cache = "no-cache") {
  res.writeHead(200, { "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream", "cache-control": cache });
  createReadStream(path).pipe(res);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function summary() {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const last = db.prepare("SELECT at, detail_json FROM events WHERE kind = 'import' ORDER BY id DESC LIMIT 1").get() as
    | { at: string; detail_json: string }
    | undefined;
  return {
    dataDir: DATA_DIR,
    refsDir: REFS_DIR,
    films: n("SELECT COUNT(*) AS n FROM films WHERE id IN (SELECT film_id FROM refs WHERE missing = 0)"),
    refs: n("SELECT COUNT(*) AS n FROM refs WHERE missing = 0"),
    excluded: n("SELECT COUNT(*) AS n FROM refs WHERE excluded = 1 AND missing = 0"),
    missing: n("SELECT COUNT(*) AS n FROM refs WHERE missing = 1"),
    lastImport: last ? { at: last.at, ...JSON.parse(last.detail_json) } : null,
  };
}

const routes: [string, RegExp, (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray, url: URL) => unknown][] = [
  ["GET", /^\/api\/summary$/, (_q, res) => send(res, 200, summary())],

  ["GET", /^\/api\/nav$/, (_q, res) => {
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    const open = openBatch(db);
    send(res, 200, {
      refs: n("SELECT COUNT(*) AS n FROM refs WHERE missing = 0 AND excluded = 0"),
      unclear: unclearRefs(db).length,
      queued: queueList(db).length,
      size: BATCH_SIZE,
      toReview: open ? n(`SELECT COUNT(*) AS n FROM drafts WHERE batch_id = ${open.id} AND status = 'draft'`) : 0,
      running: !!job,
      toPublish: library(db, DATA_DIR).pending,
    });
  }],

  ["GET", /^\/api\/live$/, (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`retry: 1000\ndata: ${BOOT_ID}\n\n`);
    liveClients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => { clearInterval(ping); liveClients.delete(res); });
  }],

  ["GET", /^\/api\/live$/, (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`retry: 1000\ndata: ${BOOT_ID}\n\n`);
    liveClients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => { clearInterval(ping); liveClients.delete(res); });
  }],

  ["POST", /^\/api\/import$/, async (_q, res) => {
    if (importing) return send(res, 409, { error: "An import is already running." });
    importing = true;
    try {
      const result = await importRefs(db, REFS_DIR, THUMBS_DIR);
      send(res, 200, { result, summary: summary() });
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    } finally {
      importing = false;
    }
  }],

  ["GET", /^\/api\/films$/, (_q, res) => {
    const rows = db
      .prepare(
        `SELECT f.id, f.folder, f.title, f.meta_json,
                SUM(r.missing = 0) AS count, SUM(r.excluded = 1 AND r.missing = 0) AS excluded
           FROM films f JOIN refs r ON r.film_id = f.id
          GROUP BY f.id HAVING count > 0
          ORDER BY f.title COLLATE NOCASE`,
      )
      .all() as { meta_json: string }[];
    send(res, 200, rows.map(({ meta_json, ...f }) => ({ ...f, meta: JSON.parse(meta_json) })));
  }],

  ["GET", /^\/api\/refs$/, (_q, res, _m, url) => {
    const film = Number(url.searchParams.get("film")) || null;
    const showExcluded = url.searchParams.get("excluded") === "1";
    const [tagGrp, ...tagRest] = (url.searchParams.get("tag") ?? "").split(":");
    const tagValue = tagRest.join(":") || null;
    const unclearOnly = url.searchParams.get("unclear") === "1" ? 1 : 0;
    const look = Number(url.searchParams.get("look")) || null;
    const rows = db
      .prepare(
        `SELECT r.id, r.film_id AS filmId, r.sha256, r.path, r.still_no AS stillNo, r.source_url AS sourceUrl,
                r.width, r.height, r.excluded, r.dup_of AS dupOf, r.look_group AS lookGroup,
                COALESCE(a.unclear, 0) AS unclear, a.ref_id IS NOT NULL AS analyzed,
                (SELECT json_group_array(json_object('grp', t.grp, 'value', t.value, 'confidence', t.confidence, 'source', t.source))
                   FROM tags t WHERE t.ref_id = r.id AND t.source != 'owner-removed') AS tags_json
           FROM refs r JOIN films f ON f.id = r.film_id LEFT JOIN analyses a ON a.ref_id = r.id
          WHERE r.missing = 0 AND (? IS NULL OR r.film_id = ?) AND (? = 1 OR r.excluded = 0)
            AND (? IS NULL OR EXISTS (SELECT 1 FROM tags t WHERE t.ref_id = r.id AND t.grp = ? AND t.value = ? AND t.source != 'owner-removed'))
            AND (? = 0 OR a.unclear = 1)
            AND (? IS NULL OR r.look_group = ?)
          ORDER BY f.title COLLATE NOCASE, r.still_no, r.path`,
      )
      .all(film, film, showExcluded ? 1 : 0, tagValue, tagGrp, tagValue, unclearOnly, look, look) as { tags_json: string }[];
    const used = usedBy(db);
    send(res, 200, rows.map(({ tags_json, ...r }) => ({ ...r, tags: JSON.parse(tags_json), used: used.get((r as { id: number }).id) ?? null })));
  }],

  // ---------- M2: categorize ----------
  ["POST", /^\/api\/categorize$/, async (req, res) => {
    if (job) return send(res, 409, { error: `Busy: ${job.label}` });
    const body = await readBody(req);
    job = { label: "Analysing and tagging", progress: "" };
    try {
      const result = await categorize(db, REFS_DIR, { force: !!body.force });
      send(res, 200, { result, status: categorizeStatus() });
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    } finally {
      job = null;
    }
  }],

  ["GET", /^\/api\/categorize\/status$/, (_q, res) => send(res, 200, categorizeStatus())],

  ["POST", /^\/api\/categorize\/claude$/, (_q, res) => {
    if (job) return send(res, 409, { error: `Busy: ${job.label}` });
    const n = unclearRefs(db).length;
    if (!n) return send(res, 400, { error: "No unclear stills to send." });
    job = { label: "Asking Claude", progress: "Starting…" };
    // Runs in the background; the UI polls /api/categorize/status.
    claudePass(db, REFS_DIR, DATA_DIR, (msg) => { if (job) job.progress = msg; })
      .then((result) => { lastClaude = { at: new Date().toISOString(), ...result }; })
      .catch((e) => { lastClaude = { at: new Date().toISOString(), sheets: 0, tagged: 0, failed: n, errors: [(e as Error).message] }; })
      .finally(() => { job = null; });
    send(res, 202, { started: true, stills: n, sheets: Math.ceil(n / PER_SHEET) });
  }],

  ["GET", /^\/api\/tags$/, (_q, res) => {
    const rows = db
      .prepare(
        `SELECT t.grp, t.value, COUNT(*) AS n FROM tags t JOIN refs r ON r.id = t.ref_id
          WHERE r.missing = 0 AND r.excluded = 0 AND t.source != 'owner-removed' GROUP BY t.grp, t.value`,
      )
      .all() as { grp: Group; value: string; n: number }[];
    const groups = GROUPS.map((grp) => ({
      grp,
      label: GROUP_LABEL[grp],
      values: (TAXONOMY[grp] as readonly string[]).map((value) => ({ value, n: rows.find((r) => r.grp === grp && r.value === value)?.n ?? 0 })),
    }));
    send(res, 200, groups);
  }],

  ["POST", /^\/api\/refs\/(\d+)\/tags$/, async (req, res, m) => {
    const id = Number(m[1]);
    const { grp, value, on } = await readBody(req) as { grp: Group; value: string; on: boolean };
    if (!GROUPS.includes(grp) || !(TAXONOMY[grp] as readonly string[]).includes(value)) return send(res, 400, { error: "Unknown tag" });
    db.prepare(
      `INSERT INTO tags (ref_id, grp, value, confidence, source) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(ref_id, grp, value) DO UPDATE SET confidence = excluded.confidence, source = excluded.source`,
    ).run(id, grp, value, on ? 1 : 0, on ? "owner" : "owner-removed");
    if (on) db.prepare("UPDATE analyses SET unclear = 0 WHERE ref_id = ?").run(id);
    send(res, 200, { ok: true });
  }],

  ["GET", /^\/api\/looks$/, (_q, res) => {
    const rows = db
      .prepare(
        `SELECT r.look_group AS look, r.id, r.sha256, r.still_no AS stillNo, f.title
           FROM refs r JOIN films f ON f.id = r.film_id
          WHERE r.look_group IS NOT NULL AND r.missing = 0 ORDER BY r.look_group, f.title, r.still_no`,
      )
      .all() as { look: number; id: number; sha256: string; stillNo: number; title: string }[];
    const looks = new Map<number, typeof rows>();
    for (const r of rows) looks.set(r.look, [...(looks.get(r.look) ?? []), r]);
    const usedForLooks = usedBy(db);
    send(res, 200, {
      threshold: getSetting(db, "look_threshold", LOOK_DEFAULTS.threshold),
      maxSize: getSetting(db, "look_max_size", LOOK_DEFAULTS.maxSize),
      groups: [...looks].map(([id, members]) => ({ id, members: members.map((m) => ({ ...m, used: usedForLooks.get(m.id) ?? null })) })),
    });
  }],

  ["POST", /^\/api\/looks\/settings$/, async (req, res) => {
    if (job) return send(res, 409, { error: `Busy: ${job.label}` });
    const { threshold } = await readBody(req) as { threshold?: number };
    if (typeof threshold === "number") setSetting(db, "look_threshold", Math.min(0.8, Math.max(0.2, threshold)));
    job = { label: "Regrouping", progress: "" };
    try {
      const result = await categorize(db, REFS_DIR);
      send(res, 200, { result });
    } finally {
      job = null;
    }
  }],

  ["POST", /^\/api\/looks\/remove\/(\d+)$/, (_q, res, m) => {
    const id = Number(m[1]);
    const row = db.prepare("SELECT look_group FROM refs WHERE id = ?").get(id) as { look_group: number | null } | undefined;
    if (!row) return send(res, 404, { error: "Not found" });
    db.prepare("UPDATE refs SET look_group = NULL, look_locked = 1 WHERE id = ?").run(id);
    if (row.look_group != null) {
      const left = db.prepare("SELECT id FROM refs WHERE look_group = ? ORDER BY id").all(row.look_group) as { id: number }[];
      if (left.length < 2) db.prepare("UPDATE refs SET look_group = NULL WHERE look_group = ?").run(row.look_group);
      else if (row.look_group === id) db.prepare("UPDATE refs SET look_group = ? WHERE look_group = ?").run(left[0].id, row.look_group);
    }
    send(res, 200, { ok: true });
  }],

  ["POST", /^\/api\/refs\/(\d+)$/, async (req, res, m) => {
    const body = await readBody(req);
    const excluded = body.excluded ? 1 : 0;
    const r = db.prepare("UPDATE refs SET excluded = ? WHERE id = ?").run(excluded, Number(m[1]));
    if (!r.changes) return send(res, 404, { error: "Not found" });
    send(res, 200, { id: Number(m[1]), excluded: !!excluded });
  }],

  // ---------- M3: test photos ----------
  ["GET", /^\/api\/testphotos$/, (_q, res) => {
    const photos = listTestPhotos(DATA_DIR);
    const have = new Set(photos.map((p) => p.file));
    send(res, 200, {
      photos, defaults: DEFAULT_SET.length, folder: testDir(DATA_DIR),
      missingDefaults: DEFAULT_SET.filter((d) => !have.has(d.file)).length,
      retired: retiredPresent(DATA_DIR),
    });
  }],

  ["POST", /^\/api\/testphotos\/default$/, async (_q, res) => {
    if (job) return send(res, 409, { error: `Busy: ${job.label}` });
    job = { label: "Downloading test photos", progress: "" };
    try {
      send(res, 200, await downloadDefaultSet(DATA_DIR));
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    } finally {
      job = null;
    }
  }],

  ["GET", /^\/testphoto\/([\w.-]+)$/, async (_q, res, m, url) => {
    const path = resolve(testDir(DATA_DIR), m[1]);
    if (!isInside(testDir(DATA_DIR), path)) return send(res, 404, { error: "Not found" });
    const w = Math.min(1600, Number(url.searchParams.get("w")) || 640);
    const out = join(RENDERS_DIR, `before-${m[1]}-${w}.jpg`);
    if (!existsSync(out)) {
      mkdirSync(RENDERS_DIR, { recursive: true });
      writeFileSync(out, await renderFile(path, {}, w));
    }
    sendFile(res, out, "public, max-age=3600");
  }],

  // ---------- M3: queue + batches ----------
  ["GET", /^\/api\/batch$/, (_q, res) => {
    const open = openBatch(db);
    const drafts = open
      ? (db.prepare("SELECT id FROM drafts WHERE batch_id = ? ORDER BY id").all(open.id) as { id: number }[]).map((d) => draftRow(d.id))
      : [];
    const closed = db.prepare(
      `SELECT b.id, b.status, b.closed_at AS closedAt, SUM(d.status = 'approved') AS approved, SUM(d.status = 'rejected') AS rejected
         FROM batches b LEFT JOIN drafts d ON d.batch_id = b.id WHERE b.status IN ('closed', 'cancelled') GROUP BY b.id ORDER BY b.id DESC LIMIT 10`,
    ).all();
    send(res, 200, {
      size: BATCH_SIZE,
      queue: queueList(db).map((q) => ({ ...q, refs: refInfo(q.refIds) })),
      open: open ? { ...open, drafts } : null,
      blockers: runBlockers(db, DATA_DIR),
      testPhotos: listTestPhotos(DATA_DIR).length,
      job,
      lastBatch,
      closed,
    });
  }],

  ["POST", /^\/api\/queue$/, async (req, res) => {
    const { kind, refIds } = await readBody(req) as { kind: "still" | "look"; refIds: number[] };
    const r = queueAdd(db, kind === "look" ? "look" : "still", (refIds ?? []).map(Number));
    send(res, r.ok ? 200 : 400, r.ok ? { ok: true, queued: queueList(db).length } : { error: r.error });
  }],

  ["POST", /^\/api\/queue\/suggest$/, (_q, res) => send(res, 200, { added: suggest(db), queued: queueList(db).length })],

  ["DELETE", /^\/api\/queue\/(\d+)$/, (_q, res, m) => {
    db.prepare("DELETE FROM queue WHERE id = ?").run(Number(m[1]));
    send(res, 200, { ok: true });
  }],

  ["POST", /^\/api\/batch\/run$/, (_q, res) => {
    if (job) return send(res, 409, { error: `Busy: ${job.label}` });
    const blockers = runBlockers(db, DATA_DIR);
    if (blockers.length) return send(res, 400, { error: blockers[0] });
    job = { label: "Running batch", progress: "Starting…" };
    stopBatch = false;
    runBatch(db, DATA_DIR, REFS_DIR, REPO_ROOT, (msg) => { if (job) job.progress = msg; }, () => stopBatch)
      .then((r) => { lastBatch = { at: new Date().toISOString(), ...r }; })
      .catch((e) => { lastBatch = { at: new Date().toISOString(), drafts: 0, errors: [(e as Error).message] }; })
      .finally(() => { job = null; });
    send(res, 202, { started: true });
  }],

  // Stop a running batch (after the current draft) or cancel one in review.
  ["POST", /^\/api\/batch\/cancel$/, (_q, res) => {
    if (job?.label === "Running batch") {
      stopBatch = true;
      job.progress = "Stopping after this draft…";
      return send(res, 202, { stopping: true });
    }
    const open = openBatch(db);
    if (!open) return send(res, 400, { error: "No batch to cancel" });
    try {
      send(res, 200, cancelBatch(db, open.id));
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
    }
  }],

  // ---------- M3: drafts ----------
  ["GET", /^\/api\/sliders$/, (_q, res) => send(res, 200, SLIDERS)],

  ["GET", /^\/api\/drafts\/(\d+)$/, (_q, res, m) => {
    const d = draftRow(Number(m[1]));
    if (!d) return send(res, 404, { error: "Not found" });
    const versions = db.prepare("SELECT version, source, note, created_at AS at FROM draft_versions WHERE draft_id = ? ORDER BY version DESC").all(Number(m[1]));
    send(res, 200, { ...d, versions });
  }],

  ["POST", /^\/api\/drafts\/(\d+)$/, async (req, res, m) => {
    const id = Number(m[1]);
    const d = draftRow(id);
    if (!d) return send(res, 404, { error: "Not found" });
    const body = await readBody(req) as {
      settings?: Settings; name?: string; description?: string; tags?: unknown[]; status?: string; rejectReason?: string;
      lrVerified?: boolean; restoreVersion?: number;
    };
    if (body.restoreVersion) {
      const v = db.prepare("SELECT settings_json FROM draft_versions WHERE draft_id = ? AND version = ?").get(id, body.restoreVersion) as { settings_json: string } | undefined;
      if (v) saveSettings(db, id, JSON.parse(v.settings_json), "owner", `Restored v${body.restoreVersion}`);
    }
    if (body.settings) saveSettings(db, id, body.settings, "owner");
    if (typeof body.name === "string" && body.name.trim()) db.prepare("UPDATE drafts SET name = ? WHERE id = ?").run(body.name.trim().slice(0, 60), id);
    if (typeof body.description === "string") db.prepare("UPDATE drafts SET description = ? WHERE id = ?").run(body.description.slice(0, 300), id);
    if (Array.isArray(body.tags)) db.prepare("UPDATE drafts SET tags_json = ? WHERE id = ?").run(JSON.stringify(body.tags), id);
    if (typeof body.lrVerified === "boolean") db.prepare("UPDATE drafts SET lr_verified = ? WHERE id = ?").run(body.lrVerified ? 1 : 0, id);
    if (body.status && ["draft", "approved", "rejected"].includes(body.status)) {
      if (body.status === "approved") {
        const issues = lintName(String(draftRow(id)!.name), blockedTerms(db));
        if (issues.length) return send(res, 400, { error: `Rename first: the name contains “${issues[0]}”.` });
      }
      db.prepare("UPDATE drafts SET status = ?, reject_reason = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.status, body.status === "rejected" ? (body.rejectReason ?? "").slice(0, 200) : null, id);
      maybeCloseBatch(db, Number(d.batchId));
    }
    send(res, 200, draftRow(id));
  }],

  ["POST", /^\/api\/drafts\/(\d+)\/refine$/, async (req, res, m) => {
    if (job) return send(res, 409, { error: `Busy: ${job.label}` });
    const id = Number(m[1]);
    const { note } = await readBody(req) as { note?: string };
    if (!draftRow(id)) return send(res, 404, { error: "Not found" });
    job = { label: "Claude is refining", progress: "Comparing reference and renders…" };
    refineDraft(db, REFS_DIR, DATA_DIR, id, (note ?? "").slice(0, 300))
      .then((r) => { lastRefine = { at: new Date().toISOString(), draftId: id, ok: true, message: `Updated ${r.changed} settings · “${r.name}”` }; })
      .catch((e) => { lastRefine = { at: new Date().toISOString(), draftId: id, ok: false, message: (e as Error).message }; })
      .finally(() => { job = null; });
    send(res, 202, { started: true });
  }],

  ["GET", /^\/api\/job$/, (_q, res) => send(res, 200, { job, lastRefine, lastBatch, lastPublish })],

  // ---------- M4: library + publish ----------
  ["GET", /^\/api\/library$/, async (_q, res) => {
    let staged: string[] = [];
    try { staged = await repoChanges(REPO_ROOT); } catch {}
    send(res, 200, { ...library(db, DATA_DIR), staged, job, lastPublish, photos: listTestPhotos(DATA_DIR) });
  }],
  ["POST", /^\/api\/library\/list$/, async (req, res) => {
    const { ids, listed } = await readBody(req) as { ids: number[]; listed: boolean };
    setListed(db, (ids ?? []).map(Number), !!listed);
    send(res, 200, { ok: true });
  }],
  ["POST", /^\/api\/library\/(\d+)\/gallery$/, async (req, res, m) => {
    const { files } = await readBody(req) as { files: string[] };
    try { setGallery(db, DATA_DIR, Number(m[1]), files ?? []); send(res, 200, { ok: true }); }
    catch (e) { send(res, 400, { error: (e as Error).message }); }
  }],
  ["POST", /^\/api\/library\/stage$/, (_q, res) => {
    if (job) return send(res, 409, { error: `Busy: ${job.label}` });
    job = { label: "Staging site files", progress: "Starting…" };
    stage(db, DATA_DIR, REPO_ROOT, (msg) => { if (job) job.progress = msg; })
      .then((r) => { lastPublish = { at: new Date().toISOString(), kind: "stage", ok: true, message: `Staged ${r.presets} presets (${r.images} images)`, detail: r }; })
      .catch((e) => { lastPublish = { at: new Date().toISOString(), kind: "stage", ok: false, message: (e as Error).message }; })
      .finally(() => { job = null; });
    send(res, 202, { started: true });
  }],
  ["POST", /^\/api\/library\/discard$/, async (_q, res) => {
    if (job) return send(res, 409, { error: `Busy: ${job.label}` });
    await discardStaged(REPO_ROOT);
    logEvent(db, "publish-discarded", {});
    send(res, 200, { ok: true });
  }],
  ["POST", /^\/api\/library\/preview$/, async (_q, res) => send(res, 200, { url: await startSitePreview(REPO_ROOT) })],
  ["POST", /^\/api\/library\/publish$/, (_q, res) => {
    if (job) return send(res, 409, { error: `Busy: ${job.label}` });
    job = { label: "Publishing", progress: "Starting…" };
    publishLive(db, DATA_DIR, REPO_ROOT, (msg) => { if (job) job.progress = msg; })
      .then((r) => { lastPublish = { at: new Date().toISOString(), kind: "live", ok: true, message: `Live: ${r.sha}`, detail: r }; })
      .catch((e) => { lastPublish = { at: new Date().toISOString(), kind: "live", ok: false, message: (e as Error).message }; })
      .finally(() => { job = null; });
    send(res, 202, { started: true });
  }],

  ["GET", /^\/api\/drafts\/(\d+)\/xmp$/, (_q, res, m) => {
    const d = draftRow(Number(m[1]));
    if (!d) return send(res, 404, { error: "Not found" });
    const name = String(d.name);
    const xmp = presetToXmp(
      {
        id: `draft-${d.id}`, name, slug: slug(name), category: "", tags: [], author: "OpenPresets", beforeUrl: "", afterUrl: "",
        description: String(d.description), status: "Draft", dateAdded: "", downloads: 0, settings: toLightroom(d.settings as Settings),
      },
      { group: "OpenPresets (drafts)" },
    );
    res.writeHead(200, { "content-type": "application/rdf+xml", "content-disposition": `attachment; filename="${slug(name)}.xmp"` });
    res.end(xmp);
  }],

  ["GET", /^\/render\/(\d+)\/([\w.-]+)$/, async (_q, res, m, url) => {
    const d = draftRow(Number(m[1]));
    const path = resolve(testDir(DATA_DIR), m[2]);
    if (!d || !isInside(testDir(DATA_DIR), path)) return send(res, 404, { error: "Not found" });
    const w = Math.min(1600, Number(url.searchParams.get("w")) || 640);
    const out = join(RENDERS_DIR, `${d.hash}-${m[2]}-${w}.jpg`);
    if (!existsSync(out)) {
      mkdirSync(RENDERS_DIR, { recursive: true });
      writeFileSync(out, await renderFile(path, d.settings as Settings, w));
    }
    sendFile(res, out, "public, max-age=31536000, immutable");
  }],

  // The renderer core, type-stripped, so the Review screen can preview live in the browser.
  ["GET", /^\/ui\/renderer-core\.js$/, (_q, res) => {
    const src = readFileSync(fileURLToPath(new URL("./renderer-core.ts", import.meta.url)), "utf8");
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
    res.end(stripTypeScriptTypes(src));
  }],

  ["GET", /^\/thumb\/([0-9a-f]{64})\.webp$/, (_q, res, m) => {
    const path = join(THUMBS_DIR, `${m[1]}.webp`);
    if (!existsSync(path)) return send(res, 404, { error: "Not found" });
    sendFile(res, path, "public, max-age=31536000, immutable");
  }],

  ["GET", /^\/full\/(\d+)$/, (_q, res, m) => {
    const row = db.prepare("SELECT path FROM refs WHERE id = ?").get(Number(m[1])) as { path: string } | undefined;
    const path = row && resolve(REFS_DIR, row.path);
    if (!path || !isInside(REFS_DIR, path)) return send(res, 404, { error: "Not found" });
    sendFile(res, path);
  }],

  ["GET", /^\/(?:ui\/)?([\w.-]*)$/, (_q, res, m) => {
    const file = m[1] || "index.html";
    const path = join(UI_DIR, file);
    if (!existsSync(path)) return send(res, 404, { error: "Not found" });
    sendFile(res, path);
  }],
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  for (const [method, re, handler] of routes) {
    const m = url.pathname.match(re);
    if (m && req.method === method) {
      try {
        await handler(req, res, m, url);
      } catch (e) {
        if (!res.headersSent) send(res, 500, { error: (e as Error).message });
      }
      return;
    }
  }
  send(res, 404, { error: "Not found" });
});

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopSitePreview(); process.exit(0); });
process.on("exit", () => stopSitePreview());

server.listen(PORT, HOST, () => {
  console.log(`OpenPresets Studio → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Data folder: ${DATA_DIR}`);
});
