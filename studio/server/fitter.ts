// Free first draft of a preset: find slider values that make the test photos
// take on the reference's grade. We can't see the reference's ungraded
// original, so tone is matched relative to typical film stills, while colour
// identity (warmth, tint, shadow and highlight colour) is matched closely.
import { analyzeRaw, type Metrics } from "./analysis.ts";
import { applySettings, loadRaw, SLIDER, type Settings } from "./renderer.ts";

type Raw = Awaited<ReturnType<typeof loadRaw>>;

// Typical values across film stills (measured on the owner's library).
const FILM = { lMean: 32, contrast: 58, p99: 78, chroma: 12 };

/** Average several references into one target (for look groups). */
export function averageMetrics(list: Metrics[]): Metrics {
  if (list.length === 1) return list[0];
  const avg = (f: (m: Metrics) => number) => list.reduce((s, m) => s + f(m), 0) / list.length;
  const tone = (k: "shadow" | "highlight") => {
    const a = avg((m) => m[k].a), b = avg((m) => m[k].b);
    return { a, b, hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(a, b) };
  };
  return {
    ...list[0],
    lMean: avg((m) => m.lMean), lStd: avg((m) => m.lStd), p01: avg((m) => m.p01), p05: avg((m) => m.p05), p50: avg((m) => m.p50),
    p95: avg((m) => m.p95), p99: avg((m) => m.p99), contrast: avg((m) => m.contrast), crushed: avg((m) => m.crushed), clipped: avg((m) => m.clipped),
    chroma: avg((m) => m.chroma), chromaP90: avg((m) => m.chromaP90), warmth: avg((m) => m.warmth), tint: avg((m) => m.tint),
    shadow: tone("shadow"), highlight: tone("highlight"), hues: list[0].hues.map((_, i) => avg((m) => m.hues[i])), skin: avg((m) => m.skin),
    mono: list.every((m) => m.mono),
  };
}

function targetFor(base: Metrics, ref: Metrics) {
  const toward = (b: number, r: number, k: number) => b + k * (r - b);
  return {
    lMean: base.lMean + 0.5 * (ref.lMean - FILM.lMean),
    contrast: base.contrast + 0.7 * (ref.contrast - FILM.contrast),
    p01: ref.p01 > 4 ? Math.max(base.p01, ref.p01 * 0.9) : ref.crushed > 0.08 ? Math.min(base.p01, 1) : base.p01,
    p99: base.p99 + 0.6 * (ref.p99 - FILM.p99),
    chroma: base.chroma * Math.min(1.8, Math.max(0.25, ref.chroma / FILM.chroma)),
    // ~65%: carry the grade's colour without copying coloured lighting (e.g. a red lamp) wholesale.
    warmth: toward(base.warmth, ref.warmth, 0.65),
    tint: toward(base.tint, ref.tint, 0.6),
    sa: toward(base.shadow.a, ref.shadow.a, 0.7),
    sb: toward(base.shadow.b, ref.shadow.b, 0.7),
    ha: toward(base.highlight.a, ref.highlight.a, 0.65),
    hb: toward(base.highlight.b, ref.highlight.b, 0.65),
  };
}
type Target = ReturnType<typeof targetFor>;

function loss(m: Metrics, t: Target, mono: boolean) {
  const sq = (d: number, scale: number) => (d / scale) ** 2;
  let l = sq(m.lMean - t.lMean, 6) + sq(m.contrast - t.contrast, 8) + sq(m.p01 - t.p01, 3) + sq(m.p99 - t.p99, 8);
  if (!mono) {
    l += sq(m.chroma - t.chroma, 3) + sq(m.warmth - t.warmth, 5) + sq(m.tint - t.tint, 5);
    l += sq(m.shadow.a - t.sa, 6) + sq(m.shadow.b - t.sb, 6) + sq(m.highlight.a - t.ha, 6) + sq(m.highlight.b - t.hb, 6);
  }
  return l;
}

const FIT_WIDTH = 120;

/** Corner-vs-centre brightness of the reference → vignette amount. */
function vignetteOf(raw: Raw): number {
  const { data, width: w, height: h, channels: ch } = raw;
  let c = 0, cn = 0, e = 0, en = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * ch;
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const d = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2));
    if (d < 0.45) { c += l; cn++; } else if (d > 1.15) { e += l; en++; }
  }
  if (!cn || !en || c / cn < 20) return 0;
  const ratio = e / en / (c / cn);
  return ratio < 0.8 ? Math.round(Math.max(-60, (ratio - 0.95) * 120)) : 0;
}

export interface FitResult { settings: Settings; loss: number; evals: number }

export async function fitPreset(refMetrics: Metrics[], refRaws: Raw[], testPhotoPaths: string[]): Promise<FitResult> {
  const ref = averageMetrics(refMetrics);
  const mono = ref.mono;
  const photos = await Promise.all(testPhotoPaths.slice(0, 4).map((p) => loadRaw(p, FIT_WIDTH)));
  const bases = photos.map((p) => analyzeRaw(p.data, p.width, p.height, p.channels));
  const targets = bases.map((b) => targetFor(b, ref));

  const s: Settings = mono
    ? { ConvertToGrayscale: "True", Contrast2012: 0, Exposure2012: 0, Highlights2012: 0, Shadows2012: 0, Fade: ref.p01 > 5 ? Math.round(ref.p01 * 2) : 0 }
    : {
        IncrementalTemperature: Math.round(Math.max(-60, Math.min(60, ref.warmth * 1.5))),
        IncrementalTint: Math.round(Math.max(-50, Math.min(50, ref.tint * 1.2))),
        Exposure2012: 0, Contrast2012: 0, Highlights2012: 0, Shadows2012: 0,
        Fade: ref.p01 > 5 ? Math.round(Math.min(45, ref.p01 * 2.2)) : 0,
        Saturation: Math.round(Math.max(-60, Math.min(40, (ref.chroma / FILM.chroma - 1) * 50))),
        ColorGradeShadowHue: Math.round(ref.shadow.hue), ColorGradeShadowSat: Math.round(Math.min(60, ref.shadow.chroma * 2.2)),
        ColorGradeHighlightHue: Math.round(ref.highlight.hue), ColorGradeHighlightSat: Math.round(Math.min(60, ref.highlight.chroma * 2)),
        ColorGradeBlending: 50,
      };

  let evals = 0;
  const work = photos.map((p) => Buffer.alloc(p.data.length));
  const evaluate = (st: Settings) => {
    evals++;
    let total = 0;
    photos.forEach((p, i) => {
      p.data.copy(work[i]);
      applySettings(work[i], p.width, p.height, p.channels, st);
      total += loss(analyzeRaw(work[i], p.width, p.height, p.channels), targets[i], mono);
    });
    return total / photos.length;
  };

  const steps: Record<string, number> = mono
    ? { Exposure2012: 0.2, Contrast2012: 12, Highlights2012: 15, Shadows2012: 15, Fade: 6 }
    : {
        IncrementalTemperature: 10, IncrementalTint: 8, Exposure2012: 0.2, Contrast2012: 12, Highlights2012: 15, Shadows2012: 15,
        Fade: 6, Saturation: 12, ColorGradeShadowSat: 10, ColorGradeHighlightSat: 10, ColorGradeShadowHue: 20, ColorGradeHighlightHue: 20,
      };
  let best = evaluate(s);
  for (let pass = 0; pass < 4; pass++) {
    let improved = true;
    for (let round = 0; round < 4 && improved; round++) {
      improved = false;
      for (const [key, step] of Object.entries(steps)) {
        const def = SLIDER[key];
        for (const dir of [1, -1]) {
          const cur = Number(s[key] ?? 0);
          let next = cur + dir * step;
          if (key.endsWith("Hue")) next = ((next % 360) + 360) % 360;
          else next = Math.max(def.min, Math.min(def.max, next));
          if (next === cur) continue;
          const trial = { ...s, [key]: next };
          const l = evaluate(trial);
          if (l < best - 1e-4) { best = l; s[key] = next; improved = true; break; }
        }
      }
    }
    for (const k of Object.keys(steps)) steps[k] /= 2;
  }

  const vig = refRaws.length ? Math.round(refRaws.map(vignetteOf).reduce((a, b) => a + b, 0) / refRaws.length) : 0;
  if (vig) s.PostCropVignetteAmount = vig;

  // Round to slider steps and drop no-ops.
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== "number") continue;
    const step = SLIDER[k]?.step ?? 1;
    const r = Math.round(v / step) * step;
    s[k] = step < 1 ? Math.round(r * 100) / 100 : r;
    if (s[k] === 0 && k !== "ColorGradeBlending") delete s[k];
  }
  if (!s.ColorGradeShadowSat) delete s.ColorGradeShadowHue;
  if (!s.ColorGradeHighlightSat) delete s.ColorGradeHighlightHue;
  if (!s.ColorGradeShadowSat && !s.ColorGradeHighlightSat) delete s.ColorGradeBlending;
  return { settings: s, loss: Math.round(best * 100) / 100, evals };
}
