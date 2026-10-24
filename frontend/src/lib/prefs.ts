/** Per-device preferences such as the usual load. */
const PREFIX = "trip.";

export function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? fallback;
  } catch {
    return fallback; // storage blocked (private mode etc.)
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // ignore
  }
}
