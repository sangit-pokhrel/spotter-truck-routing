export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function formatEta(iso: string): string {
  return dateTime.format(new Date(iso));
}

const clock = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Compact 24-hour time for dense tables, e.g. "Sat 17:48". */
export function formatClock(iso: string): string {
  return clock.format(new Date(iso)).replace(",", "");
}

export function formatMiles(miles: number): string {
  return `${Math.round(miles).toLocaleString()} mi`;
}

/** Value for <input type="datetime-local"> in the browser's timezone. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Next full hour from now, the default departure. */
export function nextHour(now = new Date()): Date {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
