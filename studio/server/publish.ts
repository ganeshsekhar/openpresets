// M4 — Publish. Approved drafts become site presets in three owner-driven steps:
//   1. List: choose which approved presets belong on the site (+ their 4 photos).
//   2. Stage: write public/presets.csv, WebP before/after previews and CREDITS.md
//      into the repo working tree. Nothing leaves this Mac; preview the site locally.
//   3. Publish live: commit only those files and push to main (deploys the site).
// The CSV is regenerated from Studio's listed presets every time, so the old
// placeholder presets disappear on the first publish (owner's decision).
// Only our own test photos (Unsplash/CC0, credited) are rendered; reference
// stills are never written to the repo (docs/legal-protocol.md).
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { logEvent, type DB } from "./db.ts";
import { applySettings, toLightroom, type Settings } from "./renderer.ts";
import { DEFAULT_SET, listTestPhotos, testDir, type TestPhoto } from "./testphotos.ts";

const run = promisify(execFile);

export const GALLERY_MAX = 4;
export const PREVIEW_WIDTH = 1200;
/** Repo paths Publish owns. Publish never stages or commits anything else. */
export const OWNED_PATHS = ["public/presets.csv", "public/previews", "CREDITS.md"];

export type SiteState = "new" | "live" | "updated" | "removing" | "off";

interface DraftRow {
  id: number; name: string; description: string; tags_json: string; settings_json: string; status: string;
  preset_id: string | null; gallery_json: string | null; listed: number; published_at: string | null;
  published_hash: string | null; first_published_at: string | null; lr_verified: number;
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Everything that ends up on the site for a preset; a change means "updated". */
function contentHash(d: DraftRow, gallery: string[]): string {
  return createHash("sha1").update(JSON.stringify([d.name, d.description, d.tags_json, d.settings_json, gallery])).digest("hex").slice(0, 12);
}

export function defaultGallery(photos: TestPhoto[]): string[] {
  const files = photos.map((p) => p.file);
  const order = DEFAULT_SET.map((d) => d.file).filter((f) => files.includes(f));
  return [...order, ...files.filter((f) => !order.includes(f))].slice(0, GALLERY_MAX);
}

function galleryFor(d: DraftRow, photos: TestPhoto[]): string[] {
  const files = new Set(photos.map((p) => p.file));
  const saved = d.gallery_json ? (JSON.parse(d.gallery_json) as string[]).filter((f) => files.has(f)) : [];
  return saved.length ? saved.slice(0, GALLERY_MAX) : defaultGallery(photos);
}

export function siteState(d: DraftRow, gallery: string[]): SiteState {
  if (d.listed && d.status === "approved") {
    if (!d.published_at) return "new";
    return d.published_hash === contentHash(d, gallery) ? "live" : "updated";
  }
  return d.published_at ? "removing" : "off";
}

const ALL = `SELECT id, name, description, tags_json, settings_json, status, preset_id, gallery_json, listed,
                    published_at, published_hash, first_published_at, lr_verified
               FROM drafts WHERE status = 'approved' OR published_at IS NOT NULL ORDER BY COALESCE(preset_id, 'zz'), id`;

/** Library listing for the Studio UI. */
export function library(db: DB, dataDir: string) {
  const photos = listTestPhotos(dataDir);
  const rows = db.prepare(ALL).all() as unknown as DraftRow[];
  const items = rows.map((d) => {
    const gallery = galleryFor(d, photos);
    const tags = JSON.parse(d.tags_json) as { grp: string; value: string }[];
    return {
      id: d.id, presetId: d.preset_id, name: d.name, description: d.description, status: d.status,
      listed: !!d.listed, state: siteState(d, gallery), gallery, lrVerified: !!d.lr_verified,
      goodFor: tags.filter((t) => t.grp === "goodFor").map((t) => t.value),
      mood: tags.filter((t) => t.grp === "mood").map((t) => t.value),
      publishedAt: d.published_at, hash: createHash("sha1").update(d.settings_json).digest("hex").slice(0, 12),
    };
  });
  const pending = items.filter((i) => i.state === "new" || i.state === "updated" || i.state === "removing").length;
  return { items, pending, galleryMax: GALLERY_MAX };
}

export function setListed(db: DB, ids: number[], listed: boolean) {
  const st = db.prepare("UPDATE drafts SET listed = ? WHERE id = ? AND (status = 'approved' OR ? = 0)");
  for (const id of ids) st.run(listed ? 1 : 0, id, listed ? 1 : 0);
}

export function setGallery(db: DB, dataDir: string, id: number, files: string[]) {
  const valid = new Set(listTestPhotos(dataDir).map((p) => p.file));
  const clean = [...new Set(files)].filter((f) => valid.has(f)).slice(0, GALLERY_MAX);
  if (!clean.length) throw new Error("Pick at least one photo");
  db.prepare("UPDATE drafts SET gallery_json = ? WHERE id = ?").run(JSON.stringify(clean), id);
}

// ---------------------------------------------------------------- CSV

const META_HEAD = ["ID", "Name", "Slug", "Category", "Tags", "Author", "Before Image URL", "After Image URL", "Description", "Status", "Date Added", "Downloads"];
const EXTRA_HEAD = ["Good For", "Mood", "Gallery"];

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Settings columns: keep the site's existing column order, add any new keys at the end. */
function settingsHead(repoRoot: string, keys: Set<string>): string[] {
  let existing: string[] = [];
  try {
    const first = readFileSync(join(repoRoot, "public/presets.csv"), "utf8").split(/\r?\n/, 1)[0];
    existing = first.split(",").filter((h) => !META_HEAD.includes(h) && !EXTRA_HEAD.includes(h));
  } catch {}
  return [...existing, ...[...keys].filter((k) => !existing.includes(k)).sort()];
}

const beforePath = (file: string) => `previews/photos/${file.replace(/\.[^.]+$/, "")}.webp`;
const afterPath = (presetId: string, file: string) => `previews/${presetId}/${file.replace(/\.[^.]+$/, "")}.webp`;

// ---------------------------------------------------------------- Stage

export interface StageResult { presets: number; added: string[]; updated: string[]; removed: string[]; images: number }

async function renderWebp(src: string, settings: Settings | null, out: string) {
  const { data, info } = await sharp(src).rotate().resize({ width: PREVIEW_WIDTH, withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (settings) applySettings(data, info.width, info.height, info.channels, settings);
  await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).webp({ quality: 78 }).toFile(out);
}

/** Write the site files for every listed preset into the repo working tree. */
export async function stage(db: DB, dataDir: string, repoRoot: string, onProgress?: (m: string) => void): Promise<StageResult> {
  const photos = listTestPhotos(dataDir);
  if (!photos.length) throw new Error("No test photos");
  const byFile = new Map(photos.map((p) => [p.file, p]));
  const rows = (db.prepare(ALL).all() as unknown as DraftRow[]);
  const listed = rows.filter((d) => d.listed && d.status === "approved");
  if (!listed.length && !rows.some((d) => d.published_at)) throw new Error("Nothing to publish yet: add approved presets to the site first");

  // Stable public IDs: OP-101, OP-102… (placeholders used OP-001…OP-024).
  let next = Math.max(100, ...rows.map((d) => Number(d.preset_id?.replace("OP-", "")) || 0)) + 1;
  for (const d of listed) {
    if (!d.preset_id) {
      d.preset_id = `OP-${next++}`;
      db.prepare("UPDATE drafts SET preset_id = ? WHERE id = ?").run(d.preset_id, d.id);
    }
  }

  const prev = join(repoRoot, "public/previews");
  mkdirSync(join(prev, "photos"), { recursive: true });
  // Drop preview folders of presets that are no longer listed.
  const keep = new Set(listed.map((d) => d.preset_id!));
  for (const dir of readdirSync(prev)) if (dir !== "photos" && !keep.has(dir)) rmSync(join(prev, dir), { recursive: true, force: true });

  const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
  const lines: string[][] = [];
  const settingKeys = new Set<string>();
  const usedPhotos = new Map<string, string[]>(); // file -> preset names
  let images = 0;
  const prepared = listed.map((d) => {
    const gallery = galleryFor(d, photos);
    const settings = JSON.parse(d.settings_json) as Settings;
    const lr = toLightroom(settings);
    Object.keys(lr).forEach((k) => settingKeys.add(k));
    return { d, gallery, settings, lr };
  });

  for (const [i, { d, gallery, settings }] of prepared.entries()) {
    onProgress?.(`Rendering ${i + 1} of ${prepared.length}: ${d.name}`);
    rmSync(join(prev, d.preset_id!), { recursive: true, force: true }); // drop photos no longer in the gallery
    mkdirSync(join(prev, d.preset_id!), { recursive: true });
    for (const file of gallery) {
      const src = join(testDir(dataDir), file);
      const b = join(repoRoot, "public", beforePath(file));
      if (!existsSync(b)) { await renderWebp(src, null, b); images++; }
      await renderWebp(src, settings, join(repoRoot, "public", afterPath(d.preset_id!, file)));
      images++;
      usedPhotos.set(file, [...(usedPhotos.get(file) ?? []), d.name]);
    }
  }
  // Remove "before" photos no preset uses any more.
  for (const f of readdirSync(join(prev, "photos"))) {
    if (![...usedPhotos.keys()].some((u) => beforePath(u).endsWith("/" + f))) rmSync(join(prev, "photos", f), { force: true });
  }

  const sHead = settingsHead(repoRoot, settingKeys);
  for (const { d, gallery, lr } of prepared) {
    const tags = JSON.parse(d.tags_json) as { grp: string; value: string }[];
    const goodFor = tags.filter((t) => t.grp === "goodFor").map((t) => t.value);
    const mood = tags.filter((t) => t.grp === "mood").map((t) => t.value);
    const cover = gallery[0];
    lines.push([
      // Tags = colour/light only; Good For and Mood have their own columns (no duplicate chips on the site).
      d.preset_id!, d.name, slugify(d.name), goodFor[0] ?? "", tags.filter((t) => t.grp !== "goodFor" && t.grp !== "mood").map((t) => t.value).join(", "), "OpenPresets",
      beforePath(cover), afterPath(d.preset_id!, cover), d.description, "Live", (d.first_published_at ?? today).slice(0, 10), "0",
      ...sHead.map((k) => lr[k] ?? ""),
      goodFor.join(", "), mood.join(", "),
      gallery.map((f) => `${byFile.get(f)?.subject ?? ""}::${beforePath(f)}::${afterPath(d.preset_id!, f)}`).join("|"),
    ]);
  }
  const csv = [[...META_HEAD, ...sHead, ...EXTRA_HEAD], ...lines].map((r) => r.map((c) => csvCell(String(c))).join(",")).join("\n") + "\n";
  writeFileSync(join(repoRoot, "public/presets.csv"), csv);
  writeFileSync(join(repoRoot, "CREDITS.md"), creditsMd(usedPhotos, byFile, today));

  const added = prepared.filter(({ d }) => !d.published_at).map(({ d }) => d.name);
  const updated = prepared.filter(({ d, gallery }) => d.published_at && d.published_hash !== contentHash(d, gallery)).map(({ d }) => d.name);
  const removed = rows.filter((d) => !(d.listed && d.status === "approved") && d.published_at).map((d) => d.name);
  logEvent(db, "publish-staged", { presets: listed.length, added, updated, removed });
  return { presets: listed.length, added, updated, removed, images };
}

function creditsMd(used: Map<string, string[]>, byFile: Map<string, TestPhoto>, today: string): string {
  const rows = [...used.entries()].map(([file, presets]) => {
    const c = byFile.get(file)?.credit;
    return `| ${byFile.get(file)?.subject ?? file} | ${c?.author ?? "UNKNOWN — add credit"} | ${c?.url ?? ""} | ${c?.license ?? ""} | ${presets.length} preset${presets.length === 1 ? "" : "s"} |`;
  });
  return `# Preview photo credits

Every photo used for a before/after preview on OpenPresets is logged here
(see [docs/legal-protocol.md](docs/legal-protocol.md), Phase 4).
Allowed sources: our own photos, Unsplash, Pexels, Wikimedia Commons CC0/public domain.
Previews are fresh renders of these photos with our own generated presets.
Generated by OpenPresets Studio on ${today}.

| Photo | Photographer | Source | Licence | Used by |
|---|---|---|---|---|
${rows.join("\n")}
`;
}

// ---------------------------------------------------------------- Repo state

export async function repoChanges(repoRoot: string): Promise<string[]> {
  const { stdout } = await run("git", ["status", "--porcelain", "--untracked-files=all", "--", ...OWNED_PATHS], { cwd: repoRoot });
  return stdout.split("\n").filter(Boolean);
}

/** Undo staged site files (only the paths Publish owns). */
export async function discardStaged(repoRoot: string) {
  for (const p of OWNED_PATHS) await run("git", ["checkout", "--", p], { cwd: repoRoot }).catch(() => {});
  await run("git", ["clean", "-fd", "--", "public/previews"], { cwd: repoRoot });
}

/** Commit only the owned paths and push main. The owner's click is the approval. */
export async function publishLive(db: DB, dataDir: string, repoRoot: string, onProgress?: (m: string) => void) {
  const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot })).stdout.trim();
  if (branch !== "main") throw new Error(`The repo is on “${branch}”; switch to main to publish`);
  const changes = await repoChanges(repoRoot);
  if (!changes.length) throw new Error("Nothing staged: press Stage first");
  onProgress?.("Checking the site builds…");
  await run("npm", ["run", "build"], { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 }).catch((e) => {
    throw new Error(`Site build failed, nothing was pushed: ${String(e.stderr || e.message).split("\n").slice(-6).join(" ")}`);
  });
  const lib = library(db, dataDir);
  const add = lib.items.filter((i) => i.state === "new").map((i) => i.name);
  const upd = lib.items.filter((i) => i.state === "updated").map((i) => i.name);
  const rem = lib.items.filter((i) => i.state === "removing").map((i) => i.name);
  const parts = [add.length && `add ${add.length}`, upd.length && `update ${upd.length}`, rem.length && `remove ${rem.length}`].filter(Boolean).join(", ");
  const msg = `Publish presets: ${parts || "refresh"}\n\n${[...add.map((n) => `+ ${n}`), ...upd.map((n) => `~ ${n}`), ...rem.map((n) => `- ${n}`)].join("\n")}\n\nPublished from OpenPresets Studio.`;
  onProgress?.("Committing…");
  await run("git", ["add", "-A", "--", ...OWNED_PATHS], { cwd: repoRoot });
  await run("git", ["commit", "-m", msg, "--", ...OWNED_PATHS], { cwd: repoRoot });
  const sha = (await run("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot })).stdout.trim();

  // Record what is live now (before pushing, so a failed push can simply be retried).
  const photos = listTestPhotos(dataDir);
  const rows = db.prepare(ALL).all() as unknown as DraftRow[];
  for (const d of rows) {
    if (d.listed && d.status === "approved") {
      db.prepare("UPDATE drafts SET published_at = datetime('now'), first_published_at = COALESCE(first_published_at, date('now', 'localtime')), published_hash = ? WHERE id = ?")
        .run(contentHash(d, galleryFor(d, photos)), d.id);
    } else if (d.published_at) {
      db.prepare("UPDATE drafts SET published_at = NULL, published_hash = NULL WHERE id = ?").run(d.id);
    }
  }
  onProgress?.("Pushing to GitHub…");
  try {
    await run("git", ["push", "origin", "main"], { cwd: repoRoot });
  } catch (e) {
    logEvent(db, "publish-push-failed", { sha, error: String((e as Error).message) });
    throw new Error(`Committed ${sha} but the push failed. Push main from a terminal, or press Publish again. (${String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().split("\n").pop()})`);
  }
  logEvent(db, "publish-live", { sha, added: add, updated: upd, removed: rem });
  return { sha, added: add, updated: upd, removed: rem };
}

// ---------------------------------------------------------------- Local site preview

let site: ChildProcess | null = null;
export const SITE_PREVIEW_PORT = 5199;

/** Start the site's Vite dev server (on the owner's click) so staged files can be checked locally. */
export async function startSitePreview(repoRoot: string): Promise<string> {
  const url = `http://localhost:${SITE_PREVIEW_PORT}/`;
  if (site && site.exitCode === null) return url;
  site = spawn("npx", ["vite", "--port", String(SITE_PREVIEW_PORT), "--strictPort"], { cwd: repoRoot, stdio: "ignore" });
  site.on("exit", () => (site = null));
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { if ((await fetch(url)).ok) return url; } catch {}
  }
  return url;
}
export function stopSitePreview() { site?.kill(); site = null; }
