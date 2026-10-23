import type { RouteOption, TripPlan } from "../api/types";
import { BASEMAPS, type BasemapId } from "./basemaps";
import { formatClock, formatMiles } from "./format";
import { pointAtMile, routePath, type LatLng, type RoutePath } from "./geo";
import { milesDriven, nextHazard } from "./live";
import { RISK_COLOR, RISK_LABEL } from "./risk";

/**
 * A mini map that floats over other apps (like a navigation bubble).
 *
 * The web can't draw over other apps directly, but a <video> can go Picture-in-Picture.
 * We paint the map (real basemap tiles + risk-coloured route + truck + next hazard) on a
 * canvas, stream the canvas into a video and float that video. Supported in Chrome
 * (Android + desktop), Edge and Safari on macOS.
 */

const W = 480;
const H = 270;
const ZOOM = 9; // ~1.5 mi per 10 px: a local "what's ahead" view
const TILE = 256;
const REDRAW_MS = 1000;

export interface FloatState {
  plan: TripPlan;
  route: RouteOption;
  basemap: BasemapId;
}

export function floatingSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    document.pictureInPictureEnabled === true &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

/** Web-Mercator world pixel coordinates at zoom `z`. */
export function project([lat, lon]: LatLng, z: number): [number, number] {
  const size = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}

export class FloatingView {
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private video = document.createElement("video");
  private tiles = new Map<string, HTMLImageElement>();
  private paths = new WeakMap<RouteOption, RoutePath>();
  private timer: number | undefined;
  private state: FloatState | null = null;
  onClose: (() => void) | null = null;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.video.muted = true;
    this.video.playsInline = true;
    // Kept in the DOM (invisible): some browsers refuse PiP for detached videos.
    this.video.className = "pip-source";
    document.body.appendChild(this.video);
    this.video.addEventListener("leavepictureinpicture", () => this.stop());
  }

  /** Must be called from a user gesture. */
  async open(state: FloatState): Promise<void> {
    this.state = state;
    this.draw();
    this.video.srcObject = this.canvas.captureStream(4);
    await this.video.play();
    await this.video.requestPictureInPicture();
    this.timer = window.setInterval(() => this.draw(), REDRAW_MS);
  }

  update(state: FloatState): void {
    this.state = state;
    this.draw();
  }

  async close(): Promise<void> {
    if (document.pictureInPictureElement === this.video) await document.exitPictureInPicture().catch(() => {});
    this.stop();
  }

  private stop(): void {
    window.clearInterval(this.timer);
    this.video.srcObject = null;
    this.video.remove();
    this.onClose?.();
    this.onClose = null;
  }

  private tile(template: string, z: number, x: number, y: number): HTMLImageElement | null {
    const n = 2 ** z;
    const url = template
      .replace("{z}", String(z))
      .replace("{y}", String(y))
      .replace("{x}", String(((x % n) + n) % n));
    let img = this.tiles.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous"; // CORS tiles keep the canvas exportable to the video stream
      img.onload = () => this.draw();
      img.src = url;
      this.tiles.set(url, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  draw(): void {
    const s = this.state;
    if (!s) return;
    const { ctx } = this;
    const { route, plan } = s;
    const path = this.paths.get(route) ?? routePath(route);
    this.paths.set(route, path);

    const mile = milesDriven(plan, route);
    const here = pointAtMile(route, path, mile);
    const [cx, cy] = project(here, ZOOM);
    const ox = cx - W / 2;
    const oy = cy - H / 2;
    const toPx = (p: LatLng): [number, number] => {
      const [x, y] = project(p, ZOOM);
      return [x - ox, y - oy];
    };

    // Basemap + labels
    ctx.fillStyle = s.basemap === "light" ? "#e9ebee" : "#22262c";
    ctx.fillRect(0, 0, W, H);
    const tiles = BASEMAPS[s.basemap];
    for (const template of [tiles.base, tiles.labels]) {
      for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + W) / TILE); tx++) {
        for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + H) / TILE); ty++) {
          const img = this.tile(template, ZOOM, tx, ty);
          if (img) ctx.drawImage(img, tx * TILE - ox, ty * TILE - oy, TILE, TILE);
        }
      }
    }

    // Route: casing, then risk colours
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const stroke = (coords: [number, number][], color: string, width: number) => {
      ctx.beginPath();
      coords.forEach((c, i) => {
        const [x, y] = toPx(c);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    route.segments.forEach((seg) => stroke(seg.coords, s.basemap === "light" ? "#14181f" : "#ffffff", 11));
    route.segments.forEach((seg) => stroke(seg.coords, RISK_COLOR[seg.level], 6));

    // Truck
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#14181f";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    this.drawHeader(route, mile);
    this.drawStrip(route, mile);
  }

  private drawHeader(route: RouteOption, mile: number): void {
    const { ctx } = this;
    const hazard = nextHazard(route, mile);
    const done = mile >= route.distance_mi - 0.5;
    ctx.fillStyle = "rgba(12, 20, 26, 0.86)";
    ctx.fillRect(0, 0, W, 56);

    const color = done ? "#9aa1aa" : hazard ? RISK_COLOR[hazard.checkpoint.level] : RISK_COLOR.low;
    ctx.beginPath();
    ctx.arc(22, 21, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "600 19px 'IBM Plex Sans', system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const title = done
      ? "Arrived"
      : hazard
        ? hazard.milesAway < 1
          ? `${RISK_LABEL[hazard.checkpoint.level]} risk here`
          : `${RISK_LABEL[hazard.checkpoint.level]} in ${formatMiles(hazard.milesAway)}`
        : "Clear to destination";
    ctx.fillText(title, 38, 21);

    ctx.font = "13px 'IBM Plex Sans', system-ui, sans-serif";
    ctx.fillStyle = "#c5ccd4";
    const remaining = formatMiles(Math.max(0, route.distance_mi - mile));
    const detail = hazard && !done
      ? `at ${formatClock(hazard.checkpoint.eta)} · ${hazard.checkpoint.factors[0] ?? ""}`
      : `Route ${route.id} · ${remaining} to go`;
    ctx.fillText(detail.slice(0, 64), 14, 44);
  }

  private drawStrip(route: RouteOption, mile: number): void {
    const { ctx } = this;
    const x0 = 12;
    const width = W - 24;
    const y = H - 16;
    const total = route.distance_mi || 1;
    ctx.fillStyle = "rgba(12, 20, 26, 0.7)";
    ctx.fillRect(0, y - 8, W, 24);
    let from = 0;
    for (const cp of route.checkpoints) {
      ctx.fillStyle = RISK_COLOR[cp.level];
      ctx.fillRect(x0 + (from / total) * width, y, (cp.coverage_mi / total) * width + 0.5, 8);
      from += cp.coverage_mi;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x0 + (Math.min(mile, total) / total) * width - 1.5, y - 4, 3, 16);
  }
}
