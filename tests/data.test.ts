import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_GALLERY, parseGallery, parsePresetsCsv, resolveUrl, rowToPreset, splitList } from "../src/data";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("resolveUrl", () => {
  it("prefixes relative paths with the base", () => {
    expect(resolveUrl("previews/a.webp", "./")).toBe("./previews/a.webp");
    expect(resolveUrl("previews/a.webp", "/openpresets/")).toBe("/openpresets/previews/a.webp");
    expect(resolveUrl("previews/a.webp", "/openpresets")).toBe("/openpresets/previews/a.webp");
  });
  it("does not double up leading ./ or /", () => {
    expect(resolveUrl("/previews/a.webp", "/openpresets/")).toBe("/openpresets/previews/a.webp");
    expect(resolveUrl("./previews/a.webp", "./")).toBe("./previews/a.webp");
  });
  it("leaves absolute URLs alone", () => {
    for (const u of ["https://x.test/a.jpg", "http://x.test/a.jpg", "//cdn.test/a.jpg", "data:image/png;base64,AA", "blob:abc"])
      expect(resolveUrl(u, "/openpresets/")).toBe(u);
  });
  it("blank stays blank", () => {
    expect(resolveUrl("  ", "/x/")).toBe("");
  });
  it("defaults to import.meta.env.BASE_URL", () => {
    expect(resolveUrl("previews/a.webp")).toBe(`${import.meta.env.BASE_URL.replace(/\/?$/, "/")}previews/a.webp`);
  });
});

describe("splitList", () => {
  it("trims, drops blanks and repeats, keeps case", () => {
    expect(splitList(" Cafés & restaurants, Travel ,, travel, Portraits & people")).toEqual(["Cafés & restaurants", "Travel", "Portraits & people"]);
    expect(splitList("")).toEqual([]);
  });
});

describe("parseGallery", () => {
  it("parses subject::before::after entries and resolves paths", () => {
    expect(parseGallery("Portrait::previews/photos/p.webp::previews/OP-1/p.webp|Café::https://x.test/b.jpg::", "/op/")).toEqual([
      { subject: "Portrait", before: "/op/previews/photos/p.webp", after: "/op/previews/OP-1/p.webp" },
      { subject: "Café", before: "https://x.test/b.jpg", after: "" },
    ]);
  });
  it("accepts before::after without a subject and skips broken entries", () => {
    expect(parseGallery("a.webp::b.webp| junk |::x.webp::y.webp|Nope::::a.webp|", "/")).toEqual([
      { subject: "", before: "/a.webp", after: "/b.webp" },
      { subject: "", before: "/x.webp", after: "/y.webp" },
    ]);
  });
  it(`caps at ${MAX_GALLERY} entries`, () => {
    const val = Array.from({ length: 6 }, (_, i) => `S${i}::b${i}.webp::a${i}.webp`).join("|");
    expect(parseGallery(val, "/")).toHaveLength(MAX_GALLERY);
  });
});

describe("rowToPreset with the new columns", () => {
  const row = {
    ID: "OP-101",
    Name: "Cafe Warmth",
    Category: "",
    Status: "Live",
    "Before Image URL": "previews/photos/p.webp",
    "After Image URL": "previews/OP-101/p.webp",
    "Good For": "Cafés & restaurants, Travel",
    Mood: "Warm & cozy, Nostalgic",
    Gallery: "Portrait::previews/photos/p.webp::previews/OP-101/p.webp|Café::previews/photos/c.webp::previews/OP-101/c.webp",
    Exposure2012: "0.2",
  };

  it("parses Good For, Mood and Gallery and keeps them out of settings", () => {
    const p = rowToPreset(row, "/op/");
    expect(p.goodFor).toEqual(["Cafés & restaurants", "Travel"]);
    expect(p.mood).toEqual(["Warm & cozy", "Nostalgic"]);
    expect(p.gallery.map((g) => g.subject)).toEqual(["Portrait", "Café"]);
    expect(p.gallery[1]).toEqual({ subject: "Café", before: "/op/previews/photos/c.webp", after: "/op/previews/OP-101/c.webp" });
    expect(p.settings).toEqual({ Exposure2012: "0.2" });
  });
  it("resolves relative Before/After Image URLs with the base", () => {
    const p = rowToPreset(row, "/op/");
    expect(p.beforeUrl).toBe("/op/previews/photos/p.webp");
    expect(p.afterUrl).toBe("/op/previews/OP-101/p.webp");
  });
  it("fills a blank Category from the first Good For value", () => {
    expect(rowToPreset(row, "/").category).toBe("Cafés & restaurants");
    expect(rowToPreset({ ...row, Category: "Travel" }, "/").category).toBe("Travel");
  });
  it("fills blank Before/After from the gallery cover", () => {
    const p = rowToPreset({ ...row, "Before Image URL": "", "After Image URL": "" }, "/");
    expect(p.beforeUrl).toBe("/previews/photos/p.webp");
    expect(p.afterUrl).toBe("/previews/OP-101/p.webp");
  });
});

describe("rowToPreset with the old columns", () => {
  it("gives empty lists and a one-pair gallery from Before/After", () => {
    const p = rowToPreset({ ID: "T", Name: "Old", Category: "Film", Status: "Live", "Before Image URL": "https://x.test/a.jpg", "After Image URL": "" });
    expect(p.goodFor).toEqual([]);
    expect(p.mood).toEqual([]);
    expect(p.category).toBe("Film");
    expect(p.gallery).toEqual([{ subject: "", before: "https://x.test/a.jpg", after: "" }]);
  });
  it("has an empty gallery without images", () => {
    expect(rowToPreset({ ID: "T", Name: "Old", Status: "Live" }).gallery).toEqual([]);
  });
});

describe("parsePresetsCsv fixtures", () => {
  it("reads the new format", () => {
    const list = parsePresetsCsv(fixture("presets-new.csv"), "/openpresets/");
    expect(list).toHaveLength(3);
    const [a, b, c] = list;
    expect(a.goodFor).toEqual(["Cafés & restaurants", "Travel", "Portraits & people"]);
    expect(a.mood).toEqual(["Warm & cozy", "Nostalgic"]);
    expect(a.gallery).toHaveLength(4); // fixture has 5 entries
    expect(a.gallery[0].before).toBe("/openpresets/previews/photos/portrait-close.svg");
    expect(a.beforeUrl).toBe(a.gallery[0].before);
    expect(b.gallery.map((g) => g.subject)).toEqual(["Coast", "Portrait"]);
    expect(c.gallery).toEqual([{ subject: "", before: "https://picsum.photos/id/64/1200/900", after: "" }]);
    for (const p of list) for (const k of ["Good For", "Mood", "Gallery"]) expect(p.settings).not.toHaveProperty(k);
  });
  it("still reads the old format", () => {
    const list = parsePresetsCsv(fixture("presets-old.csv"), "/openpresets/");
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      expect(p.goodFor).toEqual([]);
      expect(p.mood).toEqual([]);
      expect(p.category).not.toBe("");
      expect(p.gallery).toHaveLength(1);
      expect(p.gallery[0].before).toMatch(/^https:\/\//);
    }
  });
});
