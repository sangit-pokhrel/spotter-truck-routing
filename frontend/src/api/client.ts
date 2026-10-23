import type { Heatmap, Place, PlanRequest, TripPlan } from "./types";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {}

function describe(body: unknown): string {
  if (!body || typeof body !== "object") return "Something went wrong.";
  const record = body as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  // DRF field errors: { field: ["message"] }
  return Object.entries(record)
    .map(([field, msgs]) => `${field.replace(/_/g, " ")}: ${Array.isArray(msgs) ? msgs.join(" ") : String(msgs)}`)
    .join(" · ");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("Can't reach the server. Check your connection.");
  }
  const body = await resp.json().catch(() => null);
  if (!resp.ok) throw new ApiError(describe(body));
  return body as T;
}

export const api = {
  geocode: (q: string, signal?: AbortSignal) =>
    request<{ results: Place[] }>(`/api/geocode/?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.results),

  plan: (body: PlanRequest, signal?: AbortSignal) =>
    request<TripPlan>("/api/plan/", { method: "POST", body: JSON.stringify(body), signal }),

  heatmap: (plan: TripPlan, signal?: AbortSignal) =>
    request<Heatmap>("/api/heatmap/", {
      method: "POST",
      body: JSON.stringify({
        corridor: plan.corridor,
        departure_time: plan.departure,
        load_weight_lb: plan.load_weight_lb,
      }),
      signal,
    }),
};
