// Human-readable grouping of crs: settings for the "Settings in this preset" panel.

const BASIC: Record<string, string> = {
  Exposure2012: "Exposure",
  Contrast2012: "Contrast",
  Highlights2012: "Highlights",
  Shadows2012: "Shadows",
  Whites2012: "Whites",
  Blacks2012: "Blacks",
  Texture: "Texture",
  Clarity2012: "Clarity",
  Dehaze: "Dehaze",
  Vibrance: "Vibrance",
  Saturation: "Saturation",
  IncrementalTemperature: "Temperature",
  IncrementalTint: "Tint",
  ConvertToGrayscale: "Black & white",
};
const EFFECTS: Record<string, string> = {
  GrainAmount: "Grain",
  GrainSize: "Grain size",
  GrainFrequency: "Grain roughness",
  PostCropVignetteAmount: "Vignette",
  ToneCurvePV2012: "Tone curve",
  Sharpness: "Sharpening",
};

function fmt(v: string): string {
  const n = Number(v);
  if (v.trim() !== "" && Number.isFinite(n)) return n > 0 ? `+${v.replace(/^\+/, "")}` : v;
  return v;
}

export function settingGroups(s: Record<string, string>) {
  const basic: { label: string; value: string }[] = [];
  const hsl: { label: string; value: string }[] = [];
  const grade: { label: string; value: string }[] = [];
  const effects: { label: string; value: string }[] = [];
  const other: { label: string; value: string }[] = [];

  for (const [k, v] of Object.entries(s)) {
    if (BASIC[k]) basic.push({ label: BASIC[k], value: k === "ConvertToGrayscale" ? "On" : fmt(v) });
    else if (EFFECTS[k]) effects.push({ label: EFFECTS[k], value: k === "ToneCurvePV2012" ? "Custom" : fmt(v) });
    else {
      const hm = k.match(/^(Hue|Saturation|Luminance)Adjustment(\w+)$/);
      const cg = k.match(/^ColorGrade(Shadow|Midtone|Highlight|Global)(Hue|Sat|Lum)$/);
      if (hm) hsl.push({ label: `${hm[2]} ${hm[1].toLowerCase()}`, value: fmt(v) });
      else if (cg) grade.push({ label: `${cg[1]}s ${{ Hue: "hue", Sat: "saturation", Lum: "luminance" }[cg[2]]}`, value: cg[2] === "Hue" ? `${v}°` : fmt(v) });
      else if (k === "ColorGradeBlending") grade.push({ label: "Blending", value: v });
      else other.push({ label: k.replace(/([a-z])([A-Z])/g, "$1 $2"), value: v });
    }
  }
  return [
    { title: "Light & colour", items: basic },
    { title: "Colour mixer", items: hsl },
    { title: "Colour grading", items: grade },
    { title: "Effects", items: effects },
    { title: "Other", items: other },
  ].filter((g) => g.items.length);
}
