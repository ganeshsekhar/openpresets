import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeImage, analyzeRaw } from "../server/analysis.ts";
import { cancelBatch, maybeCloseBatch, openBatch, queueAdd, queueList, runBatch, saveSettings, suggest } from "../server/batches.ts";
import { categorize } from "../server/categorize.ts";
import { openDb } from "../server/db.ts";
import { fitPreset } from "../server/fitter.ts";
import { importRefs } from "../server/importer.ts";
import { lintName, suggestName } from "../server/names.ts";
import { applySettings, loadRaw, toLightroom } from "../server/renderer.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "op-m3-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function photo(path: string, top: number[], bottom: number[], w = 480, h = 320, cx = 1 / 3) {
  mkdirSync(join(path, ".."), { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${top})"/><stop offset="1" stop-color="rgb(${bottom})"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * cx}" cy="${h * (1 - cx) * 0.9}" r="${h / 4}" fill="rgb(200,150,120)"/></svg>`;
  await sharp(Buffer.from(svg)).jpeg().toFile(path);
}

const neutral = () => ({ data: Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => 40 + ((i * 7) % 180))), w: 64, h: 64 });

describe("renderer", () => {
  it("leaves the image unchanged with empty settings", () => {
    const { data, w, h } = neutral();
    const copy = Buffer.from(data);
    applySettings(copy, w, h, 3, {});
    let maxDiff = 0;
    for (let i = 0; i < data.length; i++) maxDiff = Math.max(maxDiff, Math.abs(data[i] - copy[i]));
    expect(maxDiff).toBeLessThanOrEqual(1);
  });

  it("warms with temperature, desaturates in black and white, lifts blacks with fade", () => {
    const { data, w, h } = neutral();
    const base = analyzeRaw(data, w, h, 3);
    const warm = Buffer.from(data); applySettings(warm, w, h, 3, { IncrementalTemperature: 40 });
    expect(analyzeRaw(warm, w, h, 3).warmth).toBeGreaterThan(base.warmth + 5);
    const mono = Buffer.from(data); applySettings(mono, w, h, 3, { ConvertToGrayscale: "True" });
    expect(analyzeRaw(mono, w, h, 3).mono).toBe(true);
    const faded = Buffer.from(data); applySettings(faded, w, h, 3, { Fade: 40 });
    expect(analyzeRaw(faded, w, h, 3).p01).toBeGreaterThan(base.p01 + 5);
  });

  it("turns renderer-only Fade into a real tone curve for Lightroom", () => {
    const lr = toLightroom({ Fade: 30, Contrast2012: 10, Saturation: 0 });
    expect(lr.ToneCurvePV2012).toMatch(/^0,30;/);
    expect(lr.Fade).toBeUndefined();
    expect(lr.Saturation).toBeUndefined();
  });
});

describe("fitter", () => {
  it("gives a warm reference a warm preset and a cool one a cool preset", async () => {
    const tp = join(root, "tp");
    for (const [i, c] of [[90, 120, 160], [150, 140, 120], [100, 150, 100]].entries()) await photo(join(tp, `t${i}.jpg`), c, c.map((v) => v / 3));
    const tests = [0, 1, 2].map((i) => join(tp, `t${i}.jpg`));
    await photo(join(root, "warm.jpg"), [240, 170, 90], [90, 50, 20]);
    await photo(join(root, "cool.jpg"), [90, 150, 220], [20, 40, 80]);
    const warm = await analyzeImage(join(root, "warm.jpg"));
    const cool = await analyzeImage(join(root, "cool.jpg"));
    const fw = await fitPreset([warm.metrics], [await loadRaw(join(root, "warm.jpg"), 120)], tests);
    const fc = await fitPreset([cool.metrics], [await loadRaw(join(root, "cool.jpg"), 120)], tests);
    expect(Number(fw.settings.IncrementalTemperature ?? 0)).toBeGreaterThan(Number(fc.settings.IncrementalTemperature ?? 0) + 10);
  });
});

describe("test photos", () => {
  it("retires a dropped default photo by moving it aside, only if it is ours", async () => {
    const { retiredPresent, listTestPhotos } = await import("../server/testphotos.ts");
    const dir = join(root, "test-photos");
    mkdirSync(dir, { recursive: true });
    await photo(join(dir, "portrait.jpg"), [200, 150, 120], [60, 40, 30]);
    writeFileSync(join(dir, "credits.json"), JSON.stringify({ "portrait.jpg": { author: "Alexander Shustov", url: "u", license: "Unsplash License" } }));
    expect(retiredPresent(root)).toEqual(["portrait.jpg"]);
    // Owner's own file with the same name is never touched.
    writeFileSync(join(dir, "credits.json"), JSON.stringify({ "portrait.jpg": { author: "Me", url: "", license: "own" } }));
    expect(retiredPresent(root)).toEqual([]);
    expect(listTestPhotos(root).map((p) => p.file)).toEqual(["portrait.jpg"]);
  });
});

describe("names", () => {
  it("blocks film titles and brands, allows descriptive names", () => {
    const blocked = ["copshop", "kodak", "portra", "summer of 85"];
    expect(lintName("Copshop Glow", blocked)).toEqual(["copshop"]);
    expect(lintName("Portra Warm", blocked)).toContain("portra");
    expect(lintName("Summer of 85 Haze", blocked)).toContain("summer of 85");
    expect(lintName("Amber Hearth", blocked)).toEqual([]);
  });
  it("suggests unique descriptive names", () => {
    const tags = [{ grp: "color", value: "Warm" }, { grp: "mood", value: "Warm & cozy" }];
    const a = suggestName(tags, new Set(), 3);
    const b = suggestName(tags, new Set([a.toLowerCase()]), 3);
    expect(a).not.toBe(b);
    expect(a.split(" ").length).toBeGreaterThanOrEqual(2);
  });
});

describe("name check uses file names", () => {
  it("blocks film names found only in still file names", async () => {
    const { blockedTerms } = await import("../server/names.ts");
    const db = openDb(":memory:");
    db.prepare("INSERT INTO films (folder, title) VALUES ('film-grab', 'Film grab')").run();
    db.prepare("INSERT INTO refs (film_id, sha256, path) VALUES (1, 'x', 'film-grab/Copshop_001.jpg')").run();
    expect(lintName("Copshop Glow", blockedTerms(db))).toContain("copshop");
  });
});

describe("batch flow", () => {
  it("queues, runs a batch of drafts, blocks a second run, and closes when all are decided", async () => {
    const data = join(root, "data"), refs = join(data, "refs");
    await photo(join(refs, "film-a", "01.jpg"), [230, 160, 90], [80, 40, 20], 480, 320, 0.2);
    await photo(join(refs, "film-b", "02.jpg"), [20, 40, 80], [80, 140, 210], 480, 320, 0.5);
    await photo(join(refs, "film-c", "03.jpg"), [120, 120, 120], [20, 20, 20], 480, 320, 0.8);
    const tpDir = join(data, "test-photos");
    for (const [i, c] of [[90, 120, 160], [150, 140, 120], [100, 150, 100]].entries()) await photo(join(tpDir, `t${i}.jpg`), c, c.map((v) => v / 3));
    writeFileSync(join(tpDir, "credits.json"), JSON.stringify({ "t0.jpg": { author: "A", url: "u", license: "CC0", subject: "Portrait" } }));

    const db = openDb(":memory:");
    await importRefs(db, refs, join(data, "thumbs"));
    await categorize(db, refs);
    const ids = (db.prepare("SELECT id FROM refs ORDER BY id").all() as { id: number }[]).map((r) => r.id);

    expect(queueAdd(db, "still", [ids[0]]).ok).toBe(true);
    expect(queueAdd(db, "still", [ids[0]]).ok).toBe(false); // already queued
    expect(suggest(db)).toBeGreaterThanOrEqual(1);
    const queued = queueList(db).length;

    const r = await runBatch(db, data, refs, root);
    expect(r.errors).toEqual([]);
    expect(r.drafts).toBe(queued);
    expect(queueList(db)).toEqual([]);
    await expect(runBatch(db, data, refs, root)).rejects.toThrow(/open batch|Add stills/);
    expect(queueAdd(db, "still", [ids[0]]).ok).toBe(false); // used by a draft

    const drafts = db.prepare("SELECT id FROM drafts").all() as { id: number }[];
    saveSettings(db, drafts[0].id, { Contrast2012: 20 }, "owner");
    expect((db.prepare("SELECT version FROM drafts WHERE id = ?").get(drafts[0].id) as { version: number }).version).toBe(2);
    for (const d of drafts) db.prepare("UPDATE drafts SET status = 'approved' WHERE id = ?").run(d.id);
    expect(maybeCloseBatch(db, r.batchId)).toBe(true);
  }, 60_000);

  it("stops a running batch keeping the picks, and cancels one in review returning undecided stills", async () => {
    const data = join(root, "data"), refs = join(data, "refs");
    await photo(join(refs, "film-a", "01.jpg"), [230, 160, 90], [80, 40, 20], 480, 320, 0.2);
    await photo(join(refs, "film-b", "02.jpg"), [20, 40, 80], [80, 140, 210], 480, 320, 0.5);
    const tpDir = join(data, "test-photos");
    for (const [i, c] of [[90, 120, 160], [150, 140, 120], [100, 150, 100]].entries()) await photo(join(tpDir, `t${i}.jpg`), c, c.map((v) => v / 3));
    const db = openDb(":memory:");
    await importRefs(db, refs, join(data, "thumbs"));
    await categorize(db, refs);
    const ids = (db.prepare("SELECT id FROM refs ORDER BY id").all() as { id: number }[]).map((r) => r.id);
    queueAdd(db, "still", [ids[0]]);
    queueAdd(db, "still", [ids[1]]);

    // Stop after the first draft: picks stay, batch is parked, nothing open.
    let n = 0;
    const stopped = await runBatch(db, data, refs, root, () => n++, () => n >= 1);
    expect(stopped.cancelled).toBe(true);
    expect(queueList(db).length).toBe(2);
    expect(openBatch(db)).toBeNull();
    expect(queueAdd(db, "still", [ids[0]]).ok).toBe(false); // still queued, not "used"

    // Run fully, decide one, cancel: the undecided still returns, nothing deleted.
    const r = await runBatch(db, data, refs, root);
    const [d1] = db.prepare("SELECT id FROM drafts WHERE batch_id = ? ORDER BY id").all(r.batchId) as { id: number }[];
    db.prepare("UPDATE drafts SET status = 'approved' WHERE id = ?").run(d1.id);
    expect(cancelBatch(db, r.batchId).returned).toBe(1);
    expect(queueList(db).map((q) => q.refIds)).toEqual([[ids[1]]]);
    expect(openBatch(db)).toBeNull();
    const statuses = (db.prepare("SELECT status FROM drafts WHERE batch_id = ? ORDER BY id").all(r.batchId) as { status: string }[]).map((x) => x.status);
    expect(statuses).toEqual(["approved", "cancelled"]);
    expect(() => cancelBatch(db, r.batchId)).toThrow();
  }, 60_000);
});
