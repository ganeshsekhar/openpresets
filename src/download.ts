import { config } from "./config";
import type { Preset } from "./data";
import { saveBlob, toast } from "./util";
import { presetToXmp } from "./xmp";

const xmpBlob = (p: Preset) =>
  new Blob([presetToXmp(p, { group: config.presetGroup })], { type: "application/rdf+xml" });

export function downloadPreset(p: Preset) {
  saveBlob(xmpBlob(p), `${p.slug}.xmp`);
  toast(`Downloaded ${p.name}`);
}

export async function downloadZip(presets: Preset[], label = "all") {
  if (!presets.length) return;
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const folder = zip.folder(config.presetGroup)!;
  for (const p of presets) folder.file(`${p.slug}.xmp`, presetToXmp(p, { group: config.presetGroup }));
  folder.file(
    "README.txt",
    `${config.siteName} (${config.domain})\nFree presets for Lightroom, released under CC0.\n\n` +
      `Install: Lightroom Classic > Develop > Presets panel > + > Import Presets.\n` +
      `Lightroom (desktop): File > Import Profiles & Presets.\n\n` +
      `Algorithmically generated color transformations, released under CC0. Independent project, ` +
      `not affiliated with, endorsed by, or sponsored by Adobe Inc. or any preset vendor or film manufacturer.\n`,
  );
  const blob = await zip.generateAsync({ type: "blob" });
  saveBlob(blob, `openpresets-${label}.zip`);
  toast(`Downloaded ${presets.length} presets`);
}
