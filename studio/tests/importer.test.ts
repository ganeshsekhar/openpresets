import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { humanize, importRefs, scanRefs } from "../server/importer.ts";

let root: string;
let refs: string;
let thumbs: string;

// Small solid-colour JPEGs; different colours give different hashes.
async function img(path: string, r: number, g = 40, b = 60) {
  mkdirSync(join(path, ".."), { recursive: true });
  await sharp({ create: { width: 64, height: 36, channels: 3, background: { r, g, b } } }).jpeg().toFile(path);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "op-studio-"));
  refs = join(root, "refs");
  thumbs = join(root, "thumbs");
  mkdirSync(refs, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("humanize", () => {
  it("turns folder names into titles", () => {
    expect(humanize("summer-of-85")).toBe("Summer of 85");
    expect(humanize("film-grab/in_the_mood")).toBe("In the mood");
    expect(humanize("")).toBe("Unsorted");
  });
});

describe("scanRefs", () => {
  it("groups by folder, loose files go to Unsorted, reads optional json", async () => {
    await img(join(refs, "summer-of-85", "a_07.jpg"), 10);
    await img(join(refs, "summer-of-85", "a_23.jpg"), 20);
    writeFileSync(join(refs, "summer-of-85", "film.json"), JSON.stringify({ title: "Summer of 85", meta: { Year: "2020" } }));
    await img(join(refs, "loose.jpg"), 30);
    writeFileSync(join(refs, "notes.txt"), "ignore me");

    const groups = scanRefs(refs);
    expect(groups.map((g) => [g.folder, g.title, g.images.length])).toEqual([
      ["", "Unsorted", 1],
      ["summer-of-85", "Summer of 85", 2],
    ]);
    const film = groups.find((g) => g.folder === "summer-of-85")!;
    expect(film.meta.Year).toBe("2020");
    expect(film.images.map((i) => i.stillNo)).toEqual([7, 23]);
  });

  it("splits a flat folder by the files each json lists (old script layout)", async () => {
    await img(join(refs, "film-grab", "fantasia_03.jpg"), 40);
    await img(join(refs, "film-grab", "happy-hour_11.jpg"), 50);
    writeFileSync(join(refs, "film-grab", "fantasia.json"), JSON.stringify({ title: "Fantasia", slug: "fantasia", files: [{ file: "fantasia_03.jpg", still: 3, source: "https://x/1.jpg" }] }));
    writeFileSync(join(refs, "film-grab", "happy-hour.json"), JSON.stringify({ title: "Happy Hour", slug: "happy-hour", files: [{ file: "happy-hour_11.jpg", still: 11 }] }));

    const groups = scanRefs(refs);
    expect(groups.map((g) => [g.folder, g.title])).toEqual([
      ["film-grab/fantasia", "Fantasia"],
      ["film-grab/happy-hour", "Happy Hour"],
    ]);
    expect(groups[0].images[0]).toMatchObject({ rel: "film-grab/fantasia_03.jpg", stillNo: 3, sourceUrl: "https://x/1.jpg" });
  });
});

describe("importRefs", () => {
  it("adds new stills with thumbnails, skips duplicates, tracks moves and missing files", async () => {
    const db = openDb(":memory:");
    await img(join(refs, "film-a", "01.jpg"), 60);
    await img(join(refs, "film-a", "02.jpg"), 70);

    const first = await importRefs(db, refs, thumbs);
    expect(first).toMatchObject({ films: 1, added: 2, duplicates: 0, missing: 0 });
    const sha = (db.prepare("SELECT sha256 FROM refs LIMIT 1").get() as { sha256: string }).sha256;
    expect(existsSync(join(thumbs, `${sha}.webp`))).toBe(true);

    // Re-import: nothing new.
    expect(await importRefs(db, refs, thumbs)).toMatchObject({ added: 0, duplicates: 0 });

    // Same image copied into another folder = duplicate, not a new still.
    copyFileSync(join(refs, "film-a", "01.jpg"), join(refs, "film-a", "copy.jpg"));
    expect(await importRefs(db, refs, thumbs)).toMatchObject({ added: 0, duplicates: 1 });
    rmSync(join(refs, "film-a", "copy.jpg"));

    // Moved to another folder keeps the same row.
    mkdirSync(join(refs, "film-b"));
    renameSync(join(refs, "film-a", "02.jpg"), join(refs, "film-b", "02.jpg"));
    expect(await importRefs(db, refs, thumbs)).toMatchObject({ added: 0, moved: 1 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM refs").get() as { n: number }).n).toBe(2);

    // Deleted from disk = flagged missing, row kept for provenance.
    rmSync(join(refs, "film-a", "01.jpg"));
    expect(await importRefs(db, refs, thumbs)).toMatchObject({ missing: 1 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM refs WHERE missing = 1").get() as { n: number }).n).toBe(1);
  });

  it("reports unreadable files instead of failing the import", async () => {
    const db = openDb(":memory:");
    mkdirSync(join(refs, "film-c"));
    writeFileSync(join(refs, "film-c", "broken.jpg"), "not an image");
    await img(join(refs, "film-c", "ok.jpg"), 80);
    const r = await importRefs(db, refs, thumbs);
    expect(r.added).toBe(1);
    expect(r.errors.map((e) => e.file)).toEqual(["film-c/broken.jpg"]);
  });
});
