// Node-side helpers around the shared renderer core.
import sharp from "sharp";
import { applySettings, type Settings } from "./renderer-core.ts";

export * from "./renderer-core.ts";

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

