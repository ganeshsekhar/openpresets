import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePresetsCsv, rowToPreset } from "../src/data";
import { normaliseSetting, parseCurve, presetToXmp } from "../src/xmp";

const base = {
  ID: "T-1",
  Name: "Test & <Preset>",
  Category: "Film",
  Tags: "a, B ,c",
  Status: "Live",
  Author: "Tester",
};

describe("rowToPreset", () => {
  it("splits meta columns from settings and skips blank cells", () => {
    const p = rowToPreset({ ...base, Exposure2012: "0.5", Contrast2012: "", Dehaze: "  " });
    expect(p.slug).toBe("test-preset");
    expect(p.tags).toEqual(["a", "b", "c"]);
    expect(p.settings).toEqual({ Exposure2012: "0.5" });
  });
});

describe("normaliseSetting", () => {
  it("clamps out-of-range values", () => {
    expect(normaliseSetting("Contrast2012", "250")).toBe("+100");
    expect(normaliseSetting("Exposure2012", "-9")).toBe("-5.00");
    expect(normaliseSetting("ColorGradeShadowHue", "400")).toBe("359");
  });
  it("formats signs and booleans", () => {
    expect(normaliseSetting("Exposure2012", "0.3")).toBe("+0.30");
    expect(normaliseSetting("Shadows2012", "0")).toBe("0");
    expect(normaliseSetting("ConvertToGrayscale", "yes")).toBe("True");
    expect(normaliseSetting("GrainAmount", "25")).toBe("25");
  });
  it("drops non-numeric values for numeric sliders", () => {
    expect(normaliseSetting("Contrast2012", "abc")).toBeNull();
  });
});

describe("parseCurve", () => {
  it("parses, sorts and clamps points", () => {
    expect(parseCurve("255,300; 0,0 ;64,60")).toEqual([
      [0, 0],
      [64, 60],
      [255, 255],
    ]);
  });
  it("rejects curves with fewer than 2 points", () => {
    expect(parseCurve("0,0")).toEqual([]);
  });
});

describe("presetToXmp", () => {
  const p = rowToPreset({
    ...base,
    Exposure2012: "0.25",
    Saturation: "",
    ToneCurvePV2012: "0,20;128,128;255,240",
  });
  const xml = presetToXmp(p, { uuid: "ABC123" });

  it("includes set values and omits blank ones", () => {
    expect(xml).toContain('crs:Exposure2012="+0.25"');
    expect(xml).not.toContain("crs:Saturation=");
  });
  it("escapes the name and writes the curve as a sequence", () => {
    expect(xml).toContain("Test &amp; &lt;Preset&gt;");
    expect(xml).toContain("<rdf:li>0, 20</rdf:li>");
    expect(xml).toContain('crs:ToneCurveName2012="Custom"');
    expect(xml).toContain('crs:UUID="ABC123"');
  });
  it("is well-formed XML", () => {
    // Minimal check: balanced tags for the elements we open.
    for (const tag of ["x:xmpmeta", "rdf:RDF", "rdf:Description", "crs:Name", "crs:ToneCurvePV2012"]) {
      expect(xml.split(`<${tag}`).length).toBe(xml.split(`</${tag}>`).length);
    }
  });
  it("generates a fresh 32-char UUID by default", () => {
    const a = presetToXmp(p).match(/crs:UUID="([0-9A-F]+)"/)![1];
    const b = presetToXmp(p).match(/crs:UUID="([0-9A-F]+)"/)![1];
    expect(a).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});

describe("sample CSV", () => {
  it("loads only Live rows", () => {
    const text = readFileSync(new URL("../public/presets.csv", import.meta.url), "utf8");
    const list = parsePresetsCsv(text);
    expect(list.length).toBe(24);
    expect(list.every((x) => x.status === "Live")).toBe(true);
  });
});
