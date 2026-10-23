import { describe, expect, it } from "vitest";
import type { Heatmap, RouteOption, TripPlan } from "../api/types";
import { formatDuration } from "./format";
import { routePath, truckPosition } from "./geo";
import { framePixels } from "./heatmapImage";
import { describeChange } from "./live";
import { RISK_COLOR, colorFor } from "./risk";

describe("colorFor", () => {
  it("uses exact risk colours for discrete levels", () => {
    const [r, g, b] = colorFor("risk", 3);
    expect(`#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`).toBe(RISK_COLOR.severe);
  });

  it("interpolates continuous metrics between thresholds", () => {
    const [, , , alphaAt30] = colorFor("wind", 30);
    expect(alphaAt30).toBeGreaterThan(0.55);
    expect(alphaAt30).toBeLessThan(0.65);
  });

  it("is transparent for zero precipitation", () => {
    expect(colorFor("rain", 0)[3]).toBe(0);
  });
});

describe("framePixels", () => {
  it("paints only corridor cells, at their grid index", () => {
    const heatmap: Heatmap = {
      start: "",
      hours: 0,
      grid: { west: 0, east: 2, north: 1, south: 0, cols: 2, rows: 1, spacing_mi: 10 },
      cells: [1],
      frames: { risk: [[4]], wind: [[0]], rain: [[0]], snow: [[0]] },
    };
    const px = framePixels(heatmap, "risk", 0);
    expect(px[3]).toBe(0); // cell 0 outside corridor
    expect(px[7]).toBeGreaterThan(150); // cell 1 = No Travel, mostly opaque
  });
});

describe("truckPosition", () => {
  const route = {
    distance_mi: 138,
    segments: [{ level: "low", coords: [[40, -100], [41, -100], [42, -100]] }],
    checkpoints: [
      { mile: 0, hours_from_departure: 0 },
      { mile: 69, hours_from_departure: 1 },
      { mile: 138, hours_from_departure: 3 },
    ],
  } as unknown as RouteOption;
  const path = routePath(route);

  it("interpolates mile from checkpoint ETAs", () => {
    expect(truckPosition(route, path, 0.5)![0]).toBeCloseTo(40.5, 1);
    expect(truckPosition(route, path, 2)![0]).toBeCloseTo(41.5, 1);
  });

  it("is null outside the trip", () => {
    expect(truckPosition(route, path, 3.5)).toBeNull();
  });
});

it("formats durations", () => {
  expect(formatDuration(17.8)).toBe("17h 48m");
  expect(formatDuration(0.25)).toBe("15m");
});

describe("describeChange", () => {
  const plan = (max: string, severe = 0, high = 0) =>
    ({
      recommended_route: "A",
      routes: [
        {
          id: "A",
          max_level: max,
          miles_by_level: { low: 0, moderate: 0, high, severe, no_travel: 0, unknown: 0 },
        },
      ],
    }) as unknown as TripPlan;

  it("flags a worse worst-level", () => {
    expect(describeChange(plan("low"), plan("high")).tone).toBe("worse");
  });

  it("flags more severe miles beyond noise", () => {
    expect(describeChange(plan("severe", 10), plan("severe", 40)).tone).toBe("worse");
    expect(describeChange(plan("severe", 10), plan("severe", 12)).tone).toBe("same");
  });

  it("reports improvement", () => {
    expect(describeChange(plan("severe", 30), plan("moderate")).tone).toBe("better");
  });
});
