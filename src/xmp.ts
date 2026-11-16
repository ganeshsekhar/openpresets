import type { Preset } from "./data";

/** Valid slider ranges. Values outside are clamped so a typo can't break a preset. */
const RANGES: Record<string, [number, number]> = {
  Exposure2012: [-5, 5],
  Contrast2012: [-100, 100],
  Highlights2012: [-100, 100],
  Shadows2012: [-100, 100],
  Whites2012: [-100, 100],
  Blacks2012: [-100, 100],
  Texture: [-100, 100],
  Clarity2012: [-100, 100],
  Dehaze: [-100, 100],
  Vibrance: [-100, 100],
  Saturation: [-100, 100],
  IncrementalTemperature: [-100, 100],
  IncrementalTint: [-100, 100],
  ColorGradeBlending: [0, 100],
  SplitToningBalance: [-100, 100],
  GrainAmount: [0, 100],
  GrainSize: [0, 100],
  GrainFrequency: [0, 100],
  PostCropVignetteAmount: [-100, 100],
  PostCropVignetteMidpoint: [0, 100],
  PostCropVignetteFeather: [0, 100],
  Sharpness: [0, 150],
  LuminanceSmoothing: [0, 100],
  ColorNoiseReduction: [0, 100],
};

const HSL_COLORS = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"];
for (const kind of ["Hue", "Saturation", "Luminance"]) {
  for (const c of HSL_COLORS) RANGES[`${kind}Adjustment${c}`] = [-100, 100];
}
for (const zone of ["Shadow", "Midtone", "Highlight", "Global"]) {
  RANGES[`ColorGrade${zone}Hue`] = [0, 359];
  RANGES[`ColorGrade${zone}Sat`] = [0, 100];
  RANGES[`ColorGrade${zone}Lum`] = [-100, 100];
}

const BOOLEAN_KEYS = new Set(["ConvertToGrayscale", "AutoLateralCA", "LensProfileEnable"]);
/** Keys written as child elements rather than attributes. */
const CURVE_KEYS = new Set([
  "ToneCurvePV2012",
  "ToneCurvePV2012Red",
  "ToneCurvePV2012Green",
  "ToneCurvePV2012Blue",
]);

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function newUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function formatNumber(key: string, n: number): string {
  if (key === "Exposure2012") {
    const s = n.toFixed(2);
    return n > 0 ? `+${s}` : s;
  }
  const r = Math.round(n);
  return r > 0 ? `+${r}` : String(r);
}

/** Normalises one setting value. Returns null when the value should be skipped. */
export function normaliseSetting(key: string, raw: string): string | null {
  const v = raw.trim();
  if (v === "") return null;
  if (BOOLEAN_KEYS.has(key)) {
    return /^(true|yes|1)$/i.test(v) ? "True" : "False";
  }
  const range = RANGES[key];
  if (range) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const clamped = Math.min(range[1], Math.max(range[0], n));
    // Hue values are plain integers (no + sign).
    if (/Hue$/.test(key) && key.startsWith("ColorGrade")) return String(Math.round(clamped));
    if (/^(ColorGrade.*Sat|ColorGradeBlending|Grain|PostCropVignette(Midpoint|Feather)|Sharpness|LuminanceSmoothing|ColorNoiseReduction)/.test(key)) {
      return String(Math.round(clamped));
    }
    return formatNumber(key, clamped);
  }
  return v;
}

/** "0,0;64,60;255,255" -> [[0,0],[64,60],[255,255]] (validated, sorted, clamped 0-255). */
export function parseCurve(text: string): [number, number][] {
  const pts = text
    .split(";")
    .map((pair) => pair.split(",").map((x) => Number(x.trim())))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
    .map(([x, y]) => [
      Math.min(255, Math.max(0, Math.round(x))),
      Math.min(255, Math.max(0, Math.round(y))),
    ] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  return pts.length >= 2 ? pts : [];
}

const VALID_ATTR = /^[A-Za-z][A-Za-z0-9]*$/;

export function presetToXmp(preset: Preset, opts: { group?: string; uuid?: string } = {}): string {
  const attrs: string[] = [];
  const children: string[] = [];
  let hasCurve = false;

  for (const [key, raw] of Object.entries(preset.settings)) {
    if (!VALID_ATTR.test(key)) continue;
    if (CURVE_KEYS.has(key)) {
      const pts = parseCurve(raw);
      if (!pts.length) continue;
      hasCurve = true;
      const lis = pts.map(([x, y]) => `      <rdf:li>${x}, ${y}</rdf:li>`).join("\n");
      children.push(`   <crs:${key}>\n    <rdf:Seq>\n${lis}\n    </rdf:Seq>\n   </crs:${key}>`);
      continue;
    }
    const val = normaliseSetting(key, raw);
    if (val === null) continue;
    attrs.push(`   crs:${key}="${xmlEscape(val)}"`);
  }
  if (hasCurve && !("ToneCurveName2012" in preset.settings)) {
    attrs.push(`   crs:ToneCurveName2012="Custom"`);
  }

  const name = xmlEscape(preset.name);
  const group = xmlEscape(opts.group ?? "OpenPresets");
  const alt = (v: string) =>
    `<rdf:Alt>\n     <rdf:li xml:lang="x-default">${v}</rdf:li>\n    </rdf:Alt>`;

  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Normal"
   crs:Cluster=""
   crs:UUID="${opts.uuid ?? newUuid()}"
   crs:SupportsAmount="False"
   crs:SupportsColor="True"
   crs:SupportsMonochrome="True"
   crs:SupportsHighDynamicRange="True"
   crs:SupportsNormalDynamicRange="True"
   crs:SupportsSceneReferred="True"
   crs:SupportsOutputReferred="True"
   crs:CameraModelRestriction=""
   crs:Copyright="${xmlEscape(preset.author)}"
   crs:ContactInfo=""
   crs:Version="15.0"
   crs:ProcessVersion="11.0"
${attrs.join("\n")}
   crs:HasSettings="True">
   <crs:Name>
    ${alt(name)}
   </crs:Name>
   <crs:ShortName>
    ${alt("")}
   </crs:ShortName>
   <crs:SortName>
    ${alt("")}
   </crs:SortName>
   <crs:Group>
    ${alt(group)}
   </crs:Group>
   <crs:Description>
    ${alt(xmlEscape(preset.description))}
   </crs:Description>
${children.join("\n")}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;
}
