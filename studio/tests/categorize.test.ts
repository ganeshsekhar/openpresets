import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeImage, type Metrics } from "../server/analysis.ts";
import { categorize, lookGroups } from "../server/categorize.ts";
import { openDb } from "../server/db.ts";
import { importRefs } from "../server/importer.ts";
import { tagsFor } from "../server/rules.ts";

const base: Metrics = {
  version: 1, crop: { top: 0, bottom: 0, left: 0, right: 0 },
  lMean: 35, lStd: 20, p01: 2, p05: 5, p50: 33, p95: 65, p99: 80, contrast: 60, crushed: 0.02, clipped: 0,
  chroma: 12, chromaP90: 20, warmth: 6, tint: 0,
  shadow: { a: 0, b: 4, hue: 90, chroma: 4 }, highlight: { a: 0, b: 8, hue: 90, chroma: 8 },
  hues: [0, 0.2, 0.4, 0.2, 0.1, 0, 0, 0.1, 0, 0, 0, 0], skin: 0.05, mono: false,
};
const m = (over: Partial<Metrics>): Metrics => ({ ...base, ...over });
const values = (x: Metrics) => tagsFor(x).tags.map((t) => t.value);

describe("rules", () => {
  it("tags black and white stills and never gives them colour moods", () => {
    const v = values(m({ mono: true, chroma: 0, chromaP90: 0, warmth: 0, lMean: 22, contrast: 55 }));
    expect(v).toContain("Black & white");
    expect(v).toContain("Photographers");
    expect(v).not.toContain("Warm & cozy");
    expect(v).not.toContain("Vibrant");
  });

  it("tags a warm, soft, mid-bright still as cosy and café-friendly", () => {
    const v = values(m({ warmth: 18, tint: 3, lMean: 40, contrast: 50, chroma: 16, skin: 0.3 }));
    expect(v).toEqual(expect.arrayContaining(["Warm", "Warm & cozy", "Cafés & restaurants", "Portraits & people"]));
  });

  it("tags a dark, saturated, cool still for night and city", () => {
    const v = values(m({ lMean: 15, warmth: -15, chroma: 24, chromaP90: 45, hues: [0, 0, 0, 0, 0, 0, 0.6, 0.2, 0, 0.2, 0, 0] }));
    expect(v).toEqual(expect.arrayContaining(["Dark", "Night & city"]));
  });

  it("marks a still unclear when nothing is confident", () => {
    expect(tagsFor(m({ lMean: 40, contrast: 60, chroma: 4, chromaP90: 7, warmth: -1, tint: -3, skin: 0 })).unclear).toBe(true);
  });
});

describe("look groups", () => {
  it("groups only stills that all match each other (no chaining) and respects the size cap", () => {
    // a ≈ b ≈ c in a chain, but a and c are too far apart: complete linkage must not join all three.
    const a = m({ lMean: 30 }), b = m({ lMean: 36 }), c = m({ lMean: 42 });
    const groups = lookGroups([{ id: 1, m: a }, { id: 2, m: b }, { id: 3, m: c }], 0.08, 6);
    expect(groups.length).toBe(1);
    expect(groups[0].length).toBe(2);

    const many = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, m: m({ lMean: 35 + i * 0.1 }) }));
    const capped = lookGroups(many, 0.45, 6);
    expect(Math.max(...capped.map((g) => g.length))).toBeLessThanOrEqual(6);
  });

  it("never mixes black and white with colour", () => {
    const g = lookGroups([{ id: 1, m: m({}) }, { id: 2, m: m({ mono: true, chroma: 0, chromaP90: 0 }) }], 5, 6);
    expect(g).toEqual([]);
  });
});

describe("analysis + categorize", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "op-cat-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("ignores letterbox bars when measuring blacks", async () => {
    const path = join(root, "letterbox.jpg");
    const img = await sharp({ create: { width: 400, height: 240, channels: 3, background: { r: 130, g: 120, b: 110 } } }).png().toBuffer();
    await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([{ input: img, top: 30, left: 0 }]).jpeg().toFile(path);
    const { metrics } = await analyzeImage(path);
    expect(metrics.crop.top).toBeGreaterThan(0.05);
    expect(metrics.p01).toBeGreaterThan(30); // bars cropped: no fake deep blacks
  });

  it("analyses, tags and groups near-identical stills end to end", async () => {
    const refs = join(root, "refs");
    mkdirSync(join(refs, "film"), { recursive: true });
    for (const [name, rgb] of [["a.jpg", [200, 140, 90]], ["b.jpg", [202, 141, 92]], ["c.jpg", [40, 60, 120]]] as const) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g"><stop offset="0" stop-color="rgb(${rgb})"/><stop offset="1" stop-color="rgb(${rgb.map((v) => Math.round(v / 3))})"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
      await sharp(Buffer.from(svg)).jpeg().toFile(join(refs, "film", name));
    }
    const db = openDb(":memory:");
    await importRefs(db, refs, join(root, "thumbs"));
    const r = await categorize(db, refs);
    expect(r).toMatchObject({ analyzed: 3, tagged: 3 });
    expect(r.dupSets + r.lookGroups).toBeGreaterThanOrEqual(1); // a and b belong together
    const tagCount = (db.prepare("SELECT COUNT(*) AS n FROM tags").get() as { n: number }).n;
    expect(tagCount).toBeGreaterThan(0);
    // Re-running is cheap: nothing re-analysed.
    expect((await categorize(db, refs)).analyzed).toBe(0);
  });
});
