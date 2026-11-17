// Approximate Lightroom renderer for previews and fitting. It implements the
// main Develop controls closely enough to judge a look; Lightroom remains the
// final word. Settings use Lightroom's crs: names (same as the site's CSV).
import sharp from "sharp";

export type Settings = Record<string, number | string | boolean>;

/** The sliders the fitter, the Review screen and Claude work with. */
export const SLIDERS: { key: string; label: string; min: number; max: number; step: number; group: string }[] = [
  { key: "IncrementalTemperature", label: "Temperature", min: -100, max: 100, step: 1, group: "White balance" },
  { key: "IncrementalTint", label: "Tint", min: -100, max: 100, step: 1, group: "White balance" },
  { key: "Exposure2012", label: "Exposure", min: -2, max: 2, step: 0.05, group: "Tone" },
  { key: "Contrast2012", label: "Contrast", min: -100, max: 100, step: 1, group: "Tone" },
  { key: "Highlights2012", label: "Highlights", min: -100, max: 100, step: 1, group: "Tone" },
  { key: "Shadows2012", label: "Shadows", min: -100, max: 100, step: 1, group: "Tone" },
  { key: "Whites2012", label: "Whites", min: -100, max: 100, step: 1, group: "Tone" },
  { key: "Blacks2012", label: "Blacks", min: -100, max: 100, step: 1, group: "Tone" },
  { key: "Fade", label: "Fade (lift blacks)", min: 0, max: 60, step: 1, group: "Tone" },
  { key: "Vibrance", label: "Vibrance", min: -100, max: 100, step: 1, group: "Presence" },
  { key: "Saturation", label: "Saturation", min: -100, max: 100, step: 1, group: "Presence" },
  { key: "ColorGradeShadowHue", label: "Shadows hue", min: 0, max: 359, step: 1, group: "Colour grading" },
  { key: "ColorGradeShadowSat", label: "Shadows sat", min: 0, max: 100, step: 1, group: "Colour grading" },
  { key: "ColorGradeMidtoneHue", label: "Midtones hue", min: 0, max: 359, step: 1, group: "Colour grading" },
  { key: "ColorGradeMidtoneSat", label: "Midtones sat", min: 0, max: 100, step: 1, group: "Colour grading" },
  { key: "ColorGradeHighlightHue", label: "Highlights hue", min: 0, max: 359, step: 1, group: "Colour grading" },
  { key: "ColorGradeHighlightSat", label: "Highlights sat", min: 0, max: 100, step: 1, group: "Colour grading" },
  { key: "ColorGradeBlending", label: "Blending", min: 0, max: 100, step: 1, group: "Colour grading" },
  ...["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"].flatMap((c) => [
    { key: `HueAdjustment${c}`, label: `${c} hue`, min: -100, max: 100, step: 1, group: "Colour mixer" },
    { key: `SaturationAdjustment${c}`, label: `${c} sat`, min: -100, max: 100, step: 1, group: "Colour mixer" },
    { key: `LuminanceAdjustment${c}`, label: `${c} lum`, min: -100, max: 100, step: 1, group: "Colour mixer" },
  ]),
  { key: "GrainAmount", label: "Grain", min: 0, max: 100, step: 1, group: "Effects" },
  { key: "PostCropVignetteAmount", label: "Vignette", min: -100, max: 100, step: 1, group: "Effects" },
];
export const SLIDER = Object.fromEntries(SLIDERS.map((s) => [s.key, s]));

const num = (s: Settings, k: string) => Number(s[k] ?? 0) || 0;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// sRGB <-> linear lookup tables
const TO_LIN = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

function hueToRgb(h: number): [number, number, number] {
  const x = (h % 360) / 60;
  const c = 1, k = c * (1 - Math.abs((x % 2) - 1));
  const [r, g, b] = x < 1 ? [c, k, 0] : x < 2 ? [k, c, 0] : x < 3 ? [0, c, k] : x < 4 ? [0, k, c] : x < 5 ? [k, 0, c] : [c, 0, k];
  // centre on mid-grey so it tints without brightening
  const m = (r + g + b) / 3;
  return [r - m, g - m, b - m];
}

/** Monotone cubic curve from the tone curve text "x,y;x,y" (0–255) to a 256-entry table. */
function curveTable(text: unknown, fade: number): Float32Array | null {
  let pts: [number, number][] = [];
  if (typeof text === "string" && text.trim()) {
    pts = text
      .split(";")
      .map((p) => p.split(",").map(Number) as [number, number])
      .filter((p) => p.length === 2 && p.every(Number.isFinite))
      .sort((a, b) => a[0] - b[0]);
  }
  if (fade > 0) {
    if (!pts.length) pts = [[0, 0], [255, 255]];
    pts[0] = [0, Math.max(pts[0][1], fade)];
  }
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0] / 255), ys = pts.map((p) => p[1] / 255);
  const n = xs.length, d = new Array(n - 1), m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    if (x <= xs[0]) { table[i] = ys[0]; continue; }
    if (x >= xs[n - 1]) { table[i] = ys[n - 1]; continue; }
    const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h;
    const t2 = t * t, t3 = t2 * t;
    table[i] = clamp01((2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1]);
  }
  return table;
}

const HSL_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300];
const HSL_NAMES = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"];

/** Apply settings to interleaved 8-bit RGB pixels, in place. */
export function applySettings(px: Uint8Array | Buffer, width: number, height: number, channels: number, s: Settings, seed = 1) {
  const temp = num(s, "IncrementalTemperature") / 100, tint = num(s, "IncrementalTint") / 100;
  const wbR = 1 + temp * 0.35 + tint * 0.1, wbG = 1 - tint * 0.3, wbB = 1 - temp * 0.35 + tint * 0.1;
  const expo = Math.pow(2, num(s, "Exposure2012"));
  const contrast = num(s, "Contrast2012") / 100;
  const hi = num(s, "Highlights2012") / 100, sh = num(s, "Shadows2012") / 100;
  const wh = num(s, "Whites2012") / 100, bl = num(s, "Blacks2012") / 100;
  const sat = num(s, "Saturation") / 100, vib = num(s, "Vibrance") / 100;
  const mono = String(s.ConvertToGrayscale ?? "").toLowerCase() === "true" || s.ConvertToGrayscale === true || num(s, "Saturation") <= -100;
  const curve = curveTable(s.ToneCurvePV2012, num(s, "Fade"));
  const grade = (h: string, sKey: string) => {
    const amt = num(s, sKey) / 100;
    const [r, g, b] = hueToRgb(num(s, h));
    return amt ? [r * amt * 0.35, g * amt * 0.35, b * amt * 0.35] : null;
  };
  const gS = grade("ColorGradeShadowHue", "ColorGradeShadowSat");
  const gM = grade("ColorGradeMidtoneHue", "ColorGradeMidtoneSat");
  const gH = grade("ColorGradeHighlightHue", "ColorGradeHighlightSat");
  const blend = 0.5 + num(s, "ColorGradeBlending") / 200; // wider masks with more blending
  const hsl = HSL_NAMES.map((c) => ({ h: num(s, `HueAdjustment${c}`) * 0.3, s: num(s, `SaturationAdjustment${c}`) / 100, l: num(s, `LuminanceAdjustment${c}`) / 100 }));
  const anyHsl = hsl.some((x) => x.h || x.s || x.l);
  const vignette = num(s, "PostCropVignetteAmount") / 100;
  const grain = num(s, "GrainAmount") / 100;
  let rng = seed >>> 0 || 1;
  const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cx = width / 2, cy = height / 2, rmax = Math.hypot(cx, cy);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      // 1) white balance + exposure in linear light
      let r = toGamma(Math.min(1, TO_LIN[px[i]] * wbR * expo));
      let g = toGamma(Math.min(1, TO_LIN[px[i + 1]] * wbG * expo));
      let b = toGamma(Math.min(1, TO_LIN[px[i + 2]] * wbB * expo));

      // 2) tone on luminance, applied as a ratio to keep colour
      let L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let L2 = L;
      if (contrast) L2 = clamp01(0.5 + (L2 - 0.5) * (1 + contrast * 0.65));
      if (hi) L2 += hi * 0.22 * smooth(0.45, 1, L2) * (hi < 0 ? L2 : 1 - L2) * 2;
      if (sh) L2 += sh * 0.22 * (1 - smooth(0, 0.55, L2)) * (sh > 0 ? 1 - L2 : L2) * 2;
      if (wh) L2 += wh * 0.12 * smooth(0.6, 1, L2);
      if (bl) L2 += bl * 0.12 * (1 - smooth(0, 0.35, L2));
      L2 = clamp01(L2);
      const k = L > 1e-4 ? L2 / L : 1;
      r = clamp01(L < 1e-4 ? L2 : r * k); g = clamp01(L < 1e-4 ? L2 : g * k); b = clamp01(L < 1e-4 ? L2 : b * k);

      // 3) tone curve (all channels)
      if (curve) {
        r = curve[Math.round(r * 255)]; g = curve[Math.round(g * 255)]; b = curve[Math.round(b * 255)];
      }

      // 4) colour mixer (HSL per colour band)
      if (anyHsl) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
        if (c > 0.02) {
          let h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
          h = (h * 60 + 360) % 360;
          let dh = 0, ds = 0, dl = 0;
          for (let j = 0; j < 8; j++) {
            let dist = Math.abs(h - HSL_CENTERS[j]);
            if (dist > 180) dist = 360 - dist;
            const w = Math.max(0, 1 - dist / (j === 3 || j === 4 || j === 5 ? 50 : 32));
            if (w) { dh += hsl[j].h * w; ds += hsl[j].s * w; dl += hsl[j].l * w; }
          }
          if (dh) {
            const [hr, hg, hb] = hueToRgb((h + dh + 360) % 360);
            const mid = (r + g + b) / 3;
            const ch = c * 0.6;
            r = clamp01(mid + hr * ch * 1.5); g = clamp01(mid + hg * ch * 1.5); b = clamp01(mid + hb * ch * 1.5);
          }
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const f = 1 + ds;
          r = clamp01(l + (r - l) * f + dl * 0.2 * c * 3); g = clamp01(l + (g - l) * f + dl * 0.2 * c * 3); b = clamp01(l + (b - l) * f + dl * 0.2 * c * 3);
        }
      }

      // 5) saturation + vibrance
      L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (sat || vib) {
        const cur = Math.max(r, g, b) - Math.min(r, g, b);
        const f = 1 + sat + vib * (1 - Math.min(1, cur * 1.6));
        r = clamp01(L + (r - L) * f); g = clamp01(L + (g - L) * f); b = clamp01(L + (b - L) * f);
      }

      // 6) colour grading wheels by luminance zone
      if (gS || gM || gH) {
        const ws = Math.pow(1 - L, 2 / blend) * (1 - smooth(0.55, 0.9, L));
        const wh2 = Math.pow(L, 2 / blend) * smooth(0.1, 0.45, L);
        const wm = Math.max(0, 1 - Math.abs(L - 0.5) * 2 / blend);
        if (gS) { r += gS[0] * ws; g += gS[1] * ws; b += gS[2] * ws; }
        if (gM) { r += gM[0] * wm; g += gM[1] * wm; b += gM[2] * wm; }
        if (gH) { r += gH[0] * wh2; g += gH[1] * wh2; b += gH[2] * wh2; }
        r = clamp01(r); g = clamp01(g); b = clamp01(b);
      }

      // 7) black & white
      if (mono) { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; r = g = b = l; }

      // 8) vignette + grain
      if (vignette) {
        const d = Math.hypot(x - cx, y - cy) / rmax;
        const f = 1 + vignette * 0.85 * smooth(0.35, 1.05, d);
        r = clamp01(r * f); g = clamp01(g * f); b = clamp01(b * f);
      }
      if (grain) {
        const n = (rand() + rand() + rand() - 1.5) * grain * 0.09;
        r = clamp01(r + n); g = clamp01(g + n); b = clamp01(b + n);
      }

      px[i] = Math.round(r * 255); px[i + 1] = Math.round(g * 255); px[i + 2] = Math.round(b * 255);
    }
  }
}

/** Render a file with settings to a JPEG buffer at the given width. */
export async function renderFile(path: string, settings: Settings, width: number): Promise<Buffer> {
  const { data, info } = await sharp(path).rotate().resize({ width, withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  applySettings(data, info.width, info.height, info.channels, settings);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality: 86 }).toBuffer();
}

/** Raw pixels for fitting (small, cached by caller). */
export async function loadRaw(path: string, width: number) {
  const { data, info } = await sharp(path).rotate().resize({ width, withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Convert renderer-only sliders (Fade) into real Lightroom settings for the .xmp. */
export function toLightroom(s: Settings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "Fade" || v === "" || v === null || v === undefined) continue;
    if (typeof v === "number" && v === 0 && k !== "Exposure2012") continue;
    out[k] = String(v);
  }
  const fade = num(s, "Fade");
  if (fade > 0 && !out.ToneCurvePV2012) out.ToneCurvePV2012 = `0,${Math.round(fade)};64,${Math.round(64 + fade * 0.4)};192,${Math.round(192 - fade * 0.05)};255,255`;
  return out;
}
