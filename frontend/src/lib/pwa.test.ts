import { beforeEach, describe, expect, it } from "vitest";
import type { RouteOption, TripPlan } from "../api/types";
import { project } from "./floating";
import { milesDriven, nextHazard } from "./live";
import { MAX_SAVED_AGE_MS, loadSavedTrip, saveTrip } from "./savedTrip";

const route = {
  id: "A",
  distance_mi: 100,
  checkpoints: [
    { mile: 0, hours_from_departure: 0, level: "low" },
    { mile: 50, hours_from_departure: 1, level: "low" },
    { mile: 75, hours_from_departure: 1.5, level: "high" },
    { mile: 100, hours_from_departure: 2, level: "moderate" },
  ],
} as unknown as RouteOption;

const DEPARTURE = "2026-10-24T10:00:00Z";
const plan = { departure: DEPARTURE, routes: [route] } as unknown as TripPlan;
const at = (hours: number) => Date.parse(DEPARTURE) + hours * 3600_000;

describe("milesDriven", () => {
  it("is 0 before departure and follows checkpoint ETAs after", () => {
    expect(milesDriven(plan, route, at(-1))).toBe(0);
    expect(milesDriven(plan, route, at(0.5))).toBeCloseTo(25);
    expect(milesDriven(plan, route, at(1.25))).toBeCloseTo(62.5);
  });

  it("is the full distance after arrival", () => {
    expect(milesDriven(plan, route, at(5))).toBe(100);
  });
});

describe("nextHazard", () => {
  it("finds the first Moderate-or-worse checkpoint ahead", () => {
    expect(nextHazard(route, 10)).toMatchObject({ milesAway: 65, checkpoint: { level: "high" } });
  });

  it("skips hazards already passed", () => {
    expect(nextHazard(route, 80)?.checkpoint.level).toBe("moderate");
  });

  it("is null when the rest is Low", () => {
    const calm = { ...route, checkpoints: route.checkpoints.slice(0, 2) } as RouteOption;
    expect(nextHazard(calm, 0)).toBeNull();
  });
});

describe("saved trip", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
  });

  it("round-trips and expires old trips", () => {
    saveTrip({ plan, request: null, heatmap: null, savedAt: 1_000 });
    expect(loadSavedTrip(2_000)?.plan.departure).toBe(DEPARTURE);
    expect(loadSavedTrip(1_000 + MAX_SAVED_AGE_MS + 1)).toBeNull();
  });
});

it("projects lat/lon to Web-Mercator pixels", () => {
  const [x, y] = project([0, 0], 1);
  expect([x, y]).toEqual([256, 256]);
});
