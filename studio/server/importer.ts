// Imports reference stills from refs/ into the database.
//
// Layout is free-form: each folder of images is one group (usually a film),
// loose images in refs/ go to "Unsorted". A .json file next to the images is
// optional extra info (title, year, credits, source URLs) — e.g. from the old
// film-grab console script.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import sharp from "sharp";
import { IMAGE_EXT, THUMB_WIDTH } from "./config.ts";
import { type DB, logEvent } from "./db.ts";

export interface ScannedImage {
  rel: string; // path relative to refs/, always with "/" separators
  stillNo: number | null;
  sourceUrl: string | null;
}
export interface ScannedGroup {
  folder: string; // "" for loose files in refs/
  title: string;
  meta: Record<string, unknown>;
  images: ScannedImage[];
}

const toPosix = (p: string) => p.split(sep).join("/");

export function humanize(folder: string): string {
  if (!folder) return "Unsorted";
  const name = folder.split("/").pop()!.replace(/[-_]+/g, " ").trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Unsorted";
}

function trailingNumber(file: string): number | null {
  const m = basename(file, extname(file)).match(/(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** "A_Different_Man_06.jpg", "A-Different-Man-11.jpg" → "a-different-man"; "45 (454).jpg" → "". */
export function filmKeyFromFilename(file: string): string {
  const name = basename(file, extname(file))
    .replace(/[\s_-]*\(?\d+\)?[\s_-]*$/, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
  if (!name || /^\d+$/.test(name.replace(/\s/g, ""))) return "";
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function titleFromKey(key: string): string {
  const words = key.split("-");
  const small = new Set(["a", "an", "the", "of", "and", "in", "on", "at", "to", "for"]);
  return words
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

type JsonFile ={ file?: string; source?: string; still?: number };
type FilmJson = { title?: string; slug?: string; meta?: Record<string, unknown>; page?: string; site?: string; files?: JsonFile[] };

function readJson(path: string): FilmJson | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" ? (data as FilmJson) : null;
  } catch {
    return null;
  }
}

/** Walk refs/ and group images by folder. Pure apart from reading the disk. */
export function scanRefs(refsDir: string): ScannedGroup[] {
  const byDir = new Map<string, { images: string[]; jsons: string[] }>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        const key = toPosix(relative(refsDir, dirname(abs)));
        const bucket = byDir.get(key) ?? { images: [], jsons: [] };
        if (IMAGE_EXT.test(entry.name)) bucket.images.push(entry.name);
        else if (entry.name.toLowerCase().endsWith(".json")) bucket.jsons.push(entry.name);
        byDir.set(key, bucket);
      }
    }
  };
  if (existsSync(refsDir)) walk(refsDir);

  const groups: ScannedGroup[] = [];
  for (const [dir, { images, jsons }] of [...byDir].sort(([a], [b]) => a.localeCompare(b))) {
    if (!images.length) continue;
    const records = jsons.map((j) => ({ name: j, data: readJson(join(refsDir, dir, j)) })).filter((r) => r.data);
    const claimed = new Set<string>();

    // A .json that lists files claims those images as its own film (flat download layout).
    const multi = records.filter((r) => r.data!.files?.length);
    if (multi.length > 1 || (multi.length === 1 && records.length > 1)) {
      for (const r of multi) {
        const data = r.data!;
        const slug = data.slug ?? basename(r.name, ".json");
        const listed = new Map((data.files ?? []).map((f) => [f.file ?? "", f]));
        const mine = images.filter((img) => listed.has(img));
        if (!mine.length) continue;
        mine.forEach((m) => claimed.add(m));
        groups.push({
          folder: dir ? `${dir}/${slug}` : slug,
          title: data.title || humanize(slug),
          meta: { ...data.meta, page: data.page, site: data.site },
          images: mine.sort().map((img) => {
            const f = listed.get(img)!;
            return { rel: dir ? `${dir}/${img}` : img, stillNo: f.still ?? trailingNumber(img), sourceUrl: f.source ?? null };
          }),
        });
      }
    }

    const rest = images.filter((img) => !claimed.has(img));
    if (!rest.length) continue;

    // A folder with no info file and several film names in its file names
    // (e.g. "A_Different_Man_06.jpg", "Cure-01.jpg") is split by film name.
    if (!records.length) {
      const byFilm = new Map<string, string[]>();
      for (const img of rest) {
        const key = filmKeyFromFilename(img);
        byFilm.set(key, [...(byFilm.get(key) ?? []), img]);
      }
      const named = [...byFilm.keys()].filter(Boolean);
      if (named.length >= 2) {
        for (const [key, imgs] of [...byFilm].sort(([a], [b]) => a.localeCompare(b))) {
          groups.push({
            folder: key ? (dir ? `${dir}/${key}` : key) : dir ? `${dir}/~unsorted` : "",
            title: key ? titleFromKey(key) : "Unsorted",
            meta: {},
            images: imgs.sort().map((img) => ({ rel: dir ? `${dir}/${img}` : img, stillNo: trailingNumber(img), sourceUrl: null })),
          });
        }
        continue;
      }
    }

    const data = records.length === 1 ? records[0].data! : records.find((r) => r.name === "film.json")?.data ?? null;
    const listed = new Map((data?.files ?? []).map((f) => [f.file ?? "", f]));
    groups.push({
      folder: dir,
      title: data?.title || humanize(dir),
      meta: data ? { ...data.meta, page: data.page, site: data.site } : {},
      images: rest.sort().map((img) => {
        const f = listed.get(img);
        return { rel: dir ? `${dir}/${img}` : img, stillNo: f?.still ?? trailingNumber(img), sourceUrl: f?.source ?? null };
      }),
    });
  }
  return groups;
}

export interface ImportResult {
  films: number;
  added: number;
  duplicates: number;
  moved: number;
  missing: number;
  errors: { file: string; error: string }[];
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Scan refs/, add new images, make thumbnails, and note files that disappeared. */
export async function importRefs(db: DB, refsDir: string, thumbsDir: string): Promise<ImportResult> {
  mkdirSync(refsDir, { recursive: true });
  mkdirSync(thumbsDir, { recursive: true });
  const groups = scanRefs(refsDir);
  const result: ImportResult = { films: 0, added: 0, duplicates: 0, moved: 0, missing: 0, errors: [] };
  const seenPaths = new Set<string>();

  const upsertFilm = db.prepare(
    `INSERT INTO films (folder, title, meta_json) VALUES (?, ?, ?)
     ON CONFLICT(folder) DO UPDATE SET title = excluded.title, meta_json = excluded.meta_json
     RETURNING id`,
  );
  const findBySha = db.prepare("SELECT id, path FROM refs WHERE sha256 = ?");
  const insertRef = db.prepare(
    "INSERT INTO refs (film_id, sha256, path, still_no, source_url, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const updatePath = db.prepare("UPDATE refs SET path = ?, film_id = ?, missing = 0 WHERE id = ?");
  // Same file, same place: keep the row, but follow any change in grouping.
  const regroup = db.prepare("UPDATE refs SET film_id = ?, still_no = COALESCE(?, still_no), missing = 0 WHERE id = ?");

  for (const g of groups) {
    const { id: filmId } = upsertFilm.get(g.folder, g.title, JSON.stringify(g.meta)) as { id: number };
    result.films += 1;
    for (const img of g.images) {
      const abs = join(refsDir, img.rel);
      seenPaths.add(img.rel);
      try {
        const hash = sha256(abs);
        const existing = findBySha.get(hash) as { id: number; path: string } | undefined;
        if (existing) {
          if (existing.path !== img.rel) {
            if (existsSync(join(refsDir, existing.path))) result.duplicates += 1;
            else {
              updatePath.run(img.rel, filmId, existing.id);
              result.moved += 1;
            }
          } else regroup.run(filmId, img.stillNo, existing.id);
          continue;
        }
        const image = sharp(abs, { failOn: "error" });
        const meta = await image.metadata();
        await image
          .rotate()
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(join(thumbsDir, `${hash}.webp`));
        insertRef.run(filmId, hash, img.rel, img.stillNo, img.sourceUrl, meta.width ?? null, meta.height ?? null);
        result.added += 1;
      } catch (e) {
        result.errors.push({ file: img.rel, error: (e as Error).message });
      }
    }
  }

  // Files gone from disk since the last import stay in the database, flagged.
  const all = db.prepare("SELECT id, path FROM refs WHERE missing = 0").all() as { id: number; path: string }[];
  const flag = db.prepare("UPDATE refs SET missing = 1 WHERE id = ?");
  for (const r of all) {
    if (!seenPaths.has(r.path) && !existsSync(join(refsDir, r.path))) {
      flag.run(r.id);
      result.missing += 1;
    }
  }
  logEvent(db, "import", result);
  return result;
}

export const isInside = (root: string, path: string) => {
  const rel = relative(root, path);
  return !!rel && !rel.startsWith("..") && !rel.startsWith(sep) && statSync(path, { throwIfNoEntry: false })?.isFile();
};
