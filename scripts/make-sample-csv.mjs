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

const img = (id) => `https://picsum.photos/id/${id}/1200/900`;
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
  // --- added for density testing (2026-11-16) ---
  { ID: "OP-009", Name: "Soft Matte", Category: "Film", Tags: "matte, soft, faded", "Before Image URL": img(1040), "Date Added": "2026-11-16",
    Description: "Gentle contrast and lifted blacks for a calm, printed look.",
    Contrast2012: -20, Highlights2012: -15, Shadows2012: 20, Blacks2012: 15, Saturation: -8, ToneCurvePV2012: "0,28;128,130;255,245" },
  { ID: "OP-010", Name: "Night Neon", Category: "Moody", Tags: "night, city, neon, purple", "Before Image URL": img(1047), "Date Added": "2026-11-16",
    Description: "Punchy contrast with violet shadows and magenta highlights.",
    Exposure2012: -0.2, Contrast2012: 25, Vibrance: 30, Saturation: 10, IncrementalTemperature: -15, IncrementalTint: 15,
    ColorGradeShadowHue: 260, ColorGradeShadowSat: 20, ColorGradeHighlightHue: 320, ColorGradeHighlightSat: 15, ColorGradeBlending: 50 },
  { ID: "OP-011", Name: "Silver Gelatin", Category: "Black & White", Tags: "mono, soft, print, grain", "Before Image URL": img(1005), "Date Added": "2026-11-16",
    Description: "Soft, silvery black and white with gentle grain.",
    ConvertToGrayscale: "True", Contrast2012: 10, Highlights2012: -20, Shadows2012: 15, ToneCurvePV2012: "0,12;128,132;255,248", GrainAmount: 15 },
  { ID: "OP-012", Name: "Warm Skin", Category: "Portrait", Tags: "warm, skin, natural", "Before Image URL": img(1012), "Date Added": "2026-11-16",
    Description: "A subtle warm lift that flatters skin without going orange.",
    Exposure2012: 0.1, IncrementalTemperature: 10, IncrementalTint: 3, Texture: -15, SaturationAdjustmentOrange: -5, LuminanceAdjustmentOrange: 10 },
  { ID: "OP-013", Name: "Desert Dust", Category: "Travel", Tags: "warm, desert, dusty, golden", "Before Image URL": img(1016), "Date Added": "2026-11-16",
    Description: "Dry, warm and slightly faded, like a hot afternoon.",
    Contrast2012: 8, Dehaze: 10, Saturation: -10, IncrementalTemperature: 20, ColorGradeHighlightHue: 40, ColorGradeHighlightSat: 18, ColorGradeBlending: 50 },
  { ID: "OP-014", Name: "Cold Morning", Category: "Moody", Tags: "cool, blue, quiet, morning", "Before Image URL": img(1019), "Date Added": "2026-11-16",
    Description: "Cool, quiet tones with soft blue shadows.",
    Exposure2012: 0.05, Highlights2012: -20, Saturation: -12, IncrementalTemperature: -18, ColorGradeShadowHue: 210, ColorGradeShadowSat: 12, ColorGradeBlending: 50 },
  { ID: "OP-015", Name: "Expired 400", Category: "Film", Tags: "film, grain, warm, vintage", "Before Image URL": img(1022), "Date Added": "2026-11-16",
    Description: "Shifted greens, warm highlights and heavy grain, like old film.",
    Contrast2012: -8, Saturation: 10, IncrementalTemperature: 8, IncrementalTint: 6, HueAdjustmentGreen: 20,
    ColorGradeHighlightHue: 50, ColorGradeHighlightSat: 12, ColorGradeBlending: 50, ToneCurvePV2012: "0,22;64,70;192,190;255,236", GrainAmount: 30 },
  { ID: "OP-016", Name: "High Key", Category: "Portrait", Tags: "bright, airy, clean", "Before Image URL": img(1025), "Date Added": "2026-11-16",
    Description: "Bright and airy with open shadows.",
    Exposure2012: 0.45, Contrast2012: -20, Highlights2012: -10, Shadows2012: 30, Whites2012: 20, Saturation: -8 },
  { ID: "OP-017", Name: "Ink Noir", Category: "Black & White", Tags: "mono, dark, contrast, noir", "Before Image URL": img(1033), "Date Added": "2026-11-16",
    Description: "Deep blacks and hard contrast for dramatic black and white.",
    ConvertToGrayscale: "True", Exposure2012: -0.15, Contrast2012: 45, Whites2012: 15, Blacks2012: -30, Clarity2012: 25, PostCropVignetteAmount: -25 },
  { ID: "OP-018", Name: "Alpine Air", Category: "Travel", Tags: "mountain, crisp, blue, clear", "Before Image URL": img(1039), "Date Added": "2026-11-16",
    Description: "Crisp, clear and cool, made for mountains and big skies.",
    Clarity2012: 10, Dehaze: 12, Vibrance: 20, IncrementalTemperature: -5, SaturationAdjustmentBlue: 15, LuminanceAdjustmentBlue: -12 },
  { ID: "OP-019", Name: "Rust & Teal", Category: "Moody", Tags: "cinematic, teal, rust, urban", "Before Image URL": img(1041), "Date Added": "2026-11-16",
    Description: "Rusty highlights over teal shadows with muted greens.",
    Contrast2012: 12, SaturationAdjustmentOrange: 20, SaturationAdjustmentGreen: -35,
    ColorGradeShadowHue: 190, ColorGradeShadowSat: 22, ColorGradeHighlightHue: 28, ColorGradeHighlightSat: 25, ColorGradeBlending: 55 },
  { ID: "OP-020", Name: "Pastel Day", Category: "Portrait", Tags: "pastel, soft, light", "Before Image URL": img(1044), "Date Added": "2026-11-16",
    Description: "Soft pastel colour and low contrast.",
    Exposure2012: 0.25, Contrast2012: -25, Highlights2012: -20, Vibrance: 5, Saturation: -15, ToneCurvePV2012: "0,30;255,245" },
  { ID: "OP-021", Name: "Cool Slide", Category: "Film", Tags: "film, slide, cool, crisp", "Before Image URL": img(1048), "Date Added": "2026-11-16",
    Description: "Crisp, slightly cool colour inspired by slide film.",
    Contrast2012: 12, Saturation: -15, IncrementalTemperature: -4, SaturationAdjustmentBlue: 10, ColorGradeShadowHue: 200, ColorGradeShadowSat: 8, ColorGradeBlending: 50 },
  { ID: "OP-022", Name: "Overcast", Category: "Moody", Tags: "muted, grey, calm", "Before Image URL": img(1054), "Date Added": "2026-11-16",
    Description: "Muted colour for grey days and quiet scenes.",
    Exposure2012: -0.05, Contrast2012: 8, Shadows2012: 10, Saturation: -30 },
  { ID: "OP-023", Name: "Harbour", Category: "Travel", Tags: "sea, boats, blue, vivid", "Before Image URL": img(1057), "Date Added": "2026-11-16",
    Description: "Vivid blues and clean contrast for waterfront scenes.",
    Contrast2012: 12, Dehaze: 6, Vibrance: 10, Saturation: 15, IncrementalTemperature: -8 },
  { ID: "OP-024", Name: "Low Contrast Mono", Category: "Black & White", Tags: "mono, soft, fog", "Before Image URL": img(1062), "Date Added": "2026-11-16",
    Description: "Soft, foggy black and white with lifted blacks.",
    ConvertToGrayscale: "True", Exposure2012: 0.1, Contrast2012: -25, ToneCurvePV2012: "0,25;255,235" },
  { ID: "OP-025", Name: "Amber Shadows", Category: "Film", Tags: "warm, amber, film, grain", "Before Image URL": img(1069), "Date Added": "2026-11-16",
    Description: "Warm amber shadows with a touch of grain.",
    Contrast2012: 6, IncrementalTemperature: 6, ColorGradeShadowHue: 35, ColorGradeShadowSat: 25, ColorGradeBlending: 50, GrainAmount: 15 },
];

const columns = [...META, ...SETTINGS];
const rows = presets.map((p) => {
  const r = { ...base, ...p };
  return columns.map((c) => (r[c] ?? "").toString());
});
writeFileSync(new URL("../public/presets.csv", import.meta.url), Papa.unparse({ fields: columns, data: rows }) + "\n");
console.log(`Wrote ${rows.length} presets x ${columns.length} columns`);
