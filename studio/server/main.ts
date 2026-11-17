import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, DB_PATH, HOST, PORT, REFS_DIR, THUMBS_DIR } from "./config.ts";
import { openDb } from "./db.ts";
import { importRefs, isInside } from "./importer.ts";
import { categorize, getSetting, LOOK_DEFAULTS, setSetting } from "./categorize.ts";
import { claudePass, PER_SHEET, unclearRefs, type ClaudeResult } from "./claude.ts";
import { GROUP_LABEL, GROUPS, TAXONOMY, type Group } from "./rules.ts";

const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));
const db = openDb(DB_PATH);
let importing = false;
let job: { label: string; progress: string } | null = null;
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
    send(res, 200, rows.map(({ tags_json, ...r }) => ({ ...r, tags: JSON.parse(tags_json) })));
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
    send(res, 200, {
      threshold: getSetting(db, "look_threshold", LOOK_DEFAULTS.threshold),
      maxSize: getSetting(db, "look_max_size", LOOK_DEFAULTS.maxSize),
      groups: [...looks].map(([id, members]) => ({ id, members })),
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

server.listen(PORT, HOST, () => {
  console.log(`OpenPresets Studio → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Data folder: ${DATA_DIR}`);
});
