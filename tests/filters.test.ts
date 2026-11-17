import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePresetsCsv } from "../src/data";
import {
  activeCount,
  applyFilters,
  categoryCounts,
  filtersHash,
  goodForCounts,
  hasMoodFacets,
  moodCounts,
  readFilters,
  type Filters,
} from "../src/filters";

const load = (name: string) => parsePresetsCsv(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"), "/");
const none: Filters = { q: "", cat: "", good: "", mood: "", tags: [], sort: "featured" };
const ids = (list: { id: string }[]) => list.map((p) => p.id);

describe("Good for / Mood facets", () => {
  const list = load("presets-new.csv");

  it("detects the new format", () => {
    expect(hasMoodFacets(list)).toBe(true);
    expect(hasMoodFacets(load("presets-old.csv"))).toBe(false);
  });
  it("counts values present in the data", () => {
    expect(goodForCounts(list)).toEqual([
      ["Travel", 2],
      ["Cafés & restaurants", 1],
      ["Landscapes", 1],
      ["Portraits & people", 1],
      ["Street", 1],
    ]);
    expect(moodCounts(list).map(([v]) => v)).toEqual(["Calm", "Fresh", "Moody", "Nostalgic", "Warm & cozy"]);
  });
  it("filters by good for and mood", () => {
    expect(ids(applyFilters(list, { ...none, good: "Travel" }))).toEqual(["OP-101", "OP-102"]);
    expect(ids(applyFilters(list, { ...none, good: "Travel", mood: "Calm" }))).toEqual(["OP-102"]);
    expect(ids(applyFilters(list, { ...none, mood: "Moody" }))).toEqual(["OP-103"]);
  });
  it("search matches good for and mood values", () => {
    expect(ids(applyFilters(list, { ...none, q: "cozy" }))).toEqual(["OP-101"]);
    expect(ids(applyFilters(list, { ...none, q: "landscapes" }))).toEqual(["OP-102"]);
  });
  it("round-trips through the URL and counts as active", () => {
    const f = readFilters(new URLSearchParams(filtersHash({ good: "Cafés & restaurants", mood: "Warm & cozy" }).split("?")[1]));
    expect(f.good).toBe("Cafés & restaurants");
    expect(f.mood).toBe("Warm & cozy");
    expect(activeCount(f)).toBe(2);
  });
});

describe("old format keeps the Category facet", () => {
  const list = load("presets-old.csv");
  it("filters by category", () => {
    const [[cat]] = categoryCounts(list);
    expect(applyFilters(list, { ...none, cat }).every((p) => p.category === cat)).toBe(true);
    expect(readFilters(new URLSearchParams("")).good).toBe("");
  });
});
