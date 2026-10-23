import type { HeatMetric, Heatmap } from "../api/types";
import { colorFor } from "./risk";

/** Upscale factor before handing the image to Leaflet: we do the bilinear smoothing
 *  ourselves so it looks identical in every browser. */
const UPSCALE = 8;

/** RGBA pixels (one per grid cell) for one forecast hour. Exported for tests. */
export function framePixels(heatmap: Heatmap, metric: HeatMetric, hour: number): Uint8ClampedArray {
  const { cols, rows } = heatmap.grid;
  const pixels = new Uint8ClampedArray(cols * rows * 4); // transparent outside the corridor
  const values = heatmap.frames[metric][hour];
  heatmap.cells.forEach((cellIndex, i) => {
    const value = values[i];
    if (value === null || value === undefined) return;
    const [r, g, b, a] = colorFor(metric, value);
    const o = cellIndex * 4;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = Math.round(a * 255);
  });
  return pixels;
}

/** One PNG data URL per forecast hour, rendered up-front so the slider never waits. */
export function renderFrames(heatmap: Heatmap, metric: HeatMetric): string[] {
  const { cols, rows } = heatmap.grid;
  const small = document.createElement("canvas");
  small.width = cols;
  small.height = rows;
  const smallCtx = small.getContext("2d")!;

  const big = document.createElement("canvas");
  big.width = cols * UPSCALE;
  big.height = rows * UPSCALE;
  const bigCtx = big.getContext("2d")!;
  bigCtx.imageSmoothingEnabled = true;
  bigCtx.imageSmoothingQuality = "high";

  const urls: string[] = [];
  for (let hour = 0; hour <= heatmap.hours; hour++) {
    const image = new ImageData(cols, rows);
    image.data.set(framePixels(heatmap, metric, hour));
    smallCtx.putImageData(image, 0, 0);
    bigCtx.clearRect(0, 0, big.width, big.height);
    bigCtx.drawImage(small, 0, 0, big.width, big.height);
    urls.push(big.toDataURL("image/png"));
  }
  return urls;
}
