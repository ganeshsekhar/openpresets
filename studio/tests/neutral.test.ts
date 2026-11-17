import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyNeutral, measureRaw } from "../server/neutralize.ts";
import { importOwnPhoto, listTestPhotos } from "../server/testphotos.ts";

/** A gradient "scene" with a warm cast and lifted (faded) blacks, like a graded stock photo. */
function gradedScene(w = 120, h = 80, cast: [number, number, number] = [1.15, 1, 0.8], lift = 45) {
  const px = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = (x / (w - 1)) * 255, o = (y * w + x) * 3;
    const tint = [((y % 20) - 10) * 2, ((y % 13) - 6) * 2, ((y % 17) - 8) * 2];
    for (let c = 0; c < 3; c++) px[o + c] = Math.min(255, Math.round(lift + (v + tint[c]) * cast[c] * (255 - lift) / 255));
  }
  return px;
}
const means = (px: Uint8Array) => {
  const m = [0, 0, 0];
  for (let i = 0; i < px.length; i += 3) for (let c = 0; c < 3; c++) m[c] += px[i + c];
  return m.map((v) => v / (px.length / 3));
};

describe("neutral base", () => {
  it("flags a graded photo and moves it towards neutral", () => {
    const px = gradedScene();
    const n = measureRaw(px, 120, 80, 3);
    expect(n.flags).toContain("Faded blacks");
    expect(n.gains[2]).toBeGreaterThan(n.gains[0]); // boost blue, cut red
    const before = means(px);
    const minBefore = Math.min(...px);
    applyNeutral(px, 120, 80, 3, n);
    const after = means(px);
    expect(Math.abs(after[0] - after[2])).toBeLessThan(Math.abs(before[0] - before[2])); // less warm cast
    expect(Math.min(...px)).toBeLessThan(minBefore); // blacks pulled down
  });

  it("flags black & white and leaves its colour alone", () => {
    const px = gradedScene(120, 80, [1, 1, 1], 0);
    for (let i = 0; i < px.length; i += 3) px[i + 1] = px[i + 2] = px[i];
    const n = measureRaw(px, 120, 80, 3);
    expect(n.mono).toBe(true);
    expect(n.gains).toEqual([1, 1, 1]);
  });
});

describe("own photos", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "op-own-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("strips metadata, marks the photo original and stores the consent", async () => {
    const input = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#884422" } })
      .jpeg().withMetadata({ exif: { IFD0: { Make: "PhoneCo", Model: "X1" } } }).toBuffer();
    expect((await sharp(input).metadata()).exif).toBeTruthy();
    const file = await importOwnPhoto(dir, "IMG_0001.JPG", input, "Café");
    expect(file).toBe("own-caf.jpg");
    const meta = await sharp(join(dir, "test-photos", file)).metadata();
    expect(meta.exif).toBeUndefined();
    const p = listTestPhotos(dir).find((x) => x.file === file)!;
    expect(p.original).toBe(true);
    const credits = JSON.parse(readFileSync(join(dir, "test-photos", "credits.json"), "utf8"));
    expect(credits[file].consent.statement).toMatch(/took this photo myself/);
  });
});
