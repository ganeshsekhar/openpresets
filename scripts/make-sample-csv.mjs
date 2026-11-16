// Writes public/presets.csv with placeholder presets in the exact column layout
// of the Google Sheet "Presets" tab. Run: node scripts/make-sample-csv.mjs
import { writeFileSync } from "node:fs";
import Papa from "papaparse";

const META = [
  "ID", "Name", "Slug", "Category", "Tags", "Author",
  "Before Image URL", "After Image URL", "Description",
  "Status", "Date Added", "Downloads",
];
const HSL = [];
for (const kind of ["Hue", "Saturation", "Luminance"]) {
  for (const c of ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"]) {
    HSL.push(`${kind}Adjustment${c}`);
  }
}
const SETTINGS = [
  "Exposure2012", "Contrast2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012",
  "Texture", "Clarity2012", "Dehaze", "Vibrance", "Saturation",
  "IncrementalTemperature", "IncrementalTint",
  ...HSL,
  "ColorGradeShadowHue", "ColorGradeShadowSat", "ColorGradeShadowLum",
  "ColorGradeMidtoneHue", "ColorGradeMidtoneSat", "ColorGradeMidtoneLum",
  "ColorGradeHighlightHue", "ColorGradeHighlightSat", "ColorGradeHighlightLum",
  "ColorGradeBlending", "SplitToningBalance",
  "ToneCurvePV2012", "GrainAmount", "PostCropVignetteAmount", "ConvertToGrayscale",
];

const img = (id) => `https://picsum.photos/id/${id}/1200/800`;
const base = { Author: "OpenPresets", Status: "Live", Downloads: 0, "After Image URL": "" };

const presets = [
  {
    ID: "OP-001", Name: "Golden Hour Portrait", Category: "Portrait", Tags: "warm, skin, soft, sunset",
    "Before Image URL": img(64), "Date Added": "2026-11-10",
    Description: "Warm, soft light with gentle highlights. Keeps skin tones natural.",
    Exposure2012: 0.15, Contrast2012: -10, Highlights2012: -30, Shadows2012: 25, Whites2012: 10, Blacks2012: -5,
    Texture: -10, Clarity2012: 5, Vibrance: 15, Saturation: -5, IncrementalTemperature: 12, IncrementalTint: 4,
    HueAdjustmentOrange: -4, SaturationAdjustmentOrange: -8, LuminanceAdjustmentOrange: 8,
    ColorGradeHighlightHue: 45, ColorGradeHighlightSat: 15, ColorGradeShadowHue: 30, ColorGradeShadowSat: 6,
    ColorGradeBlending: 50, ToneCurvePV2012: "0,10;64,62;192,196;255,250", PostCropVignetteAmount: -10,
  },
  {
    ID: "OP-002", Name: "Faded Film", Category: "Film", Tags: "film, matte, vintage, fade",
    "Before Image URL": img(1015), "Date Added": "2026-11-11",
    Description: "Matte blacks, muted colour and light grain, like expired film stock.",
    Contrast2012: -15, Highlights2012: -20, Shadows2012: 15, Blacks2012: 10, Saturation: -12, Vibrance: -5,
    IncrementalTemperature: 5, HueAdjustmentGreen: 15, SaturationAdjustmentGreen: -25, SaturationAdjustmentBlue: -15,
    ColorGradeShadowHue: 200, ColorGradeShadowSat: 10, ColorGradeHighlightHue: 45, ColorGradeHighlightSat: 12,
    ColorGradeBlending: 60, ToneCurvePV2012: "0,35;70,72;190,192;255,238", GrainAmount: 25,
  },
  {
    ID: "OP-003", Name: "Moody Forest", Category: "Moody", Tags: "dark, green, forest, nature",
    "Before Image URL": img(1018), "Date Added": "2026-11-12",
    Description: "Deep greens, cool shadows and darker tones for a quiet, moody look.",
    Exposure2012: -0.3, Contrast2012: 20, Highlights2012: -50, Shadows2012: -10, Blacks2012: -15,
    Clarity2012: 15, Dehaze: 10, Vibrance: -10, Saturation: -15, IncrementalTemperature: -6,
    HueAdjustmentGreen: 20, SaturationAdjustmentGreen: -40, LuminanceAdjustmentGreen: -15, SaturationAdjustmentBlue: -30,
    ColorGradeShadowHue: 190, ColorGradeShadowSat: 15, ColorGradeBlending: 50, PostCropVignetteAmount: -20,
  },
  {
    ID: "OP-004", Name: "Coastal Blue", Category: "Travel", Tags: "sea, blue, bright, summer",
    "Before Image URL": img(1050), "Date Added": "2026-11-12",
    Description: "Bright, clean and airy, with rich blues for sea and sky.",
    Exposure2012: 0.2, Whites2012: 15, Shadows2012: 10, Dehaze: 8, Vibrance: 25, IncrementalTemperature: -8,
    SaturationAdjustmentBlue: 20, LuminanceAdjustmentBlue: -10, SaturationAdjustmentAqua: 15, SaturationAdjustmentOrange: 10,
    ColorGradeHighlightHue: 50, ColorGradeHighlightSat: 8, ColorGradeBlending: 50,
  },
  {
    ID: "OP-005", Name: "Classic Mono", Category: "Black & White", Tags: "mono, contrast, street, grain",
    "Before Image URL": img(1027), "Date Added": "2026-11-13",
    Description: "Punchy black and white with deep blacks and fine grain.",
    Contrast2012: 30, Highlights2012: -15, Shadows2012: 10, Whites2012: 10, Blacks2012: -20, Clarity2012: 20,
    ConvertToGrayscale: "True", ToneCurvePV2012: "0,0;64,52;192,205;255,255", GrainAmount: 20, PostCropVignetteAmount: -15,
  },
  {
    ID: "OP-006", Name: "Teal & Orange", Category: "Moody", Tags: "cinematic, teal, orange, city",
    "Before Image URL": img(1011), "Date Added": "2026-11-14",
    Description: "A cinematic split of teal shadows and warm highlights.",
    Contrast2012: 15, Highlights2012: -25, Shadows2012: 15, Blacks2012: -10, Clarity2012: 10, Vibrance: 10,
    SaturationAdjustmentOrange: 15, HueAdjustmentBlue: -15, SaturationAdjustmentBlue: -10, SaturationAdjustmentGreen: -30,
    ColorGradeShadowHue: 195, ColorGradeShadowSat: 25, ColorGradeHighlightHue: 38, ColorGradeHighlightSat: 20,
    ColorGradeBlending: 55, ToneCurvePV2012: "0,8;64,58;192,200;255,250",
  },
  {
    ID: "OP-007", Name: "Clean Travel", Category: "Travel", Tags: "natural, bright, clean",
    "Before Image URL": img(1036), "Date Added": "2026-11-15",
    Description: "A light, natural lift for everyday travel shots.",
    Exposure2012: 0.1, Highlights2012: -20, Shadows2012: 20, Whites2012: 8, Texture: 10, Vibrance: 12,
  },
  {
    ID: "OP-008", Name: "Draft Example", Category: "Film", Tags: "draft",
    "Before Image URL": img(1043), Status: "Draft", "Date Added": "2026-11-15",
    Description: "Draft rows are hidden from the site.", Exposure2012: 0.5,
  },
];

const columns = [...META, ...SETTINGS];
const rows = presets.map((p) => {
  const r = { ...base, ...p };
  return columns.map((c) => (r[c] ?? "").toString());
});
writeFileSync(new URL("../public/presets.csv", import.meta.url), Papa.unparse({ fields: columns, data: rows }) + "\n");
console.log(`Wrote ${rows.length} presets x ${columns.length} columns`);
