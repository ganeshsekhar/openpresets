import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, DB_PATH, HOST, PORT, REFS_DIR, THUMBS_DIR } from "./config.ts";
import { openDb } from "./db.ts";
import { importRefs, isInside } from "./importer.ts";

const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));
const db = openDb(DB_PATH);
let importing = false;

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
    const rows = db
      .prepare(
        `SELECT r.id, r.film_id AS filmId, r.sha256, r.path, r.still_no AS stillNo, r.source_url AS sourceUrl,
                r.width, r.height, r.excluded
           FROM refs r JOIN films f ON f.id = r.film_id
          WHERE r.missing = 0 AND (? IS NULL OR r.film_id = ?) AND (? = 1 OR r.excluded = 0)
          ORDER BY f.title COLLATE NOCASE, r.still_no, r.path`,
      )
      .all(film, film, showExcluded ? 1 : 0);
    send(res, 200, rows);
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
