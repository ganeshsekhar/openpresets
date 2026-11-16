// Rough CSS approximation of a preset, used only when a preset has no real
// "after" image yet. It is a placeholder, not an accurate render.

export interface PreviewStyle {
  filter: string;
  tint: string | null; // CSS colour for a soft-light overlay
  vignette: number; // 0..1 darkness at the edges
  fade: number; // 0..1 lifted blacks
}

const num = (s: Record<string, string>, k: string) => Number(s[k]) || 0;

export function previewStyle(s: Record<string, string>): PreviewStyle {
  const exposure = num(s, "Exposure2012");
  const contrast = num(s, "Contrast2012");
  const shadows = num(s, "Shadows2012");
  const highlights = num(s, "Highlights2012");
  const blacks = num(s, "Blacks2012");
  const whites = num(s, "Whites2012");
  const clarity = num(s, "Clarity2012");
  const dehaze = num(s, "Dehaze");
  const vib = num(s, "Vibrance");
  const sat = num(s, "Saturation");
  const temp = num(s, "IncrementalTemperature");
  const tint = num(s, "IncrementalTint");
  const mono = /^(true|yes|1)$/i.test(s.ConvertToGrayscale ?? "") || sat <= -100;

  const brightness = 1 + exposure * 0.22 + (shadows + whites + blacks * 0.5 - highlights * 0.3) / 900;
  const contrastF = 1 + (contrast + clarity * 0.4 + dehaze * 0.5) / 220;
  const saturate = mono ? 0 : Math.max(0, 1 + (sat + vib * 0.6) / 110);

  const parts = [
    `brightness(${brightness.toFixed(3)})`,
    `contrast(${contrastF.toFixed(3)})`,
    `saturate(${saturate.toFixed(3)})`,
  ];
  if (!mono && temp > 0) parts.push(`sepia(${Math.min(0.5, temp / 120).toFixed(3)})`);
  if (!mono && (temp < 0 || tint !== 0)) parts.push(`hue-rotate(${(temp < 0 ? temp * 0.6 : 0) + tint * 0.3}deg)`);
  if (mono) parts.push("grayscale(1)");

  // Colour grading: blend shadow / midtone / highlight hues into one overlay tint.
  let tintColor: string | null = null;
  if (!mono) {
    const zones = ["Shadow", "Midtone", "Highlight"]
      .map((z) => ({ h: num(s, `ColorGrade${z}Hue`), sat: num(s, `ColorGrade${z}Sat`) }))
      .filter((z) => z.sat > 0);
    if (zones.length) {
      const strongest = zones.reduce((a, b) => (b.sat > a.sat ? b : a));
      const alpha = Math.min(0.55, strongest.sat / 45);
      tintColor = `hsla(${strongest.h}, 80%, 50%, ${alpha.toFixed(3)})`;
    }
  }

  const vignette = Math.max(0, -num(s, "PostCropVignetteAmount")) / 100;
  // Lifted blacks from the first tone-curve point, e.g. "0,30;...".
  const firstY = Number((s.ToneCurvePV2012 ?? "").split(";")[0]?.split(",")[1]) || 0;
  const fade = Math.min(0.3, firstY / 255);

  return { filter: parts.join(" "), tint: tintColor, vignette, fade };
}
