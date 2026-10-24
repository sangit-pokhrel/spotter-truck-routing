import { useEffect, useState } from "react";
import type { PlanChange } from "../lib/live";

interface Props {
  live: boolean;
  onToggle: (on: boolean) => void;
  onRecheck: () => void;
  busy: boolean;
  offline: boolean;
  updatedAt: Date | null;
  intervalMin: number;
  change: PlanChange | null;
  note: string | null;
  /** null when the device can't show notifications */
  alerts: boolean | null;
  onAlerts: (on: boolean) => void;
}

function ago(date: Date, now: number): string {
  const min = Math.floor((now - date.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 90) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden />
      <span className="switch-label">
        {label}
        <small>{hint}</small>
      </span>
    </label>
  );
}

/** Live mode: re-plans from the phone's GPS on a timer. */
export function LiveBar(props: Props) {
  const { live, onToggle, onRecheck, busy, offline, updatedAt, intervalMin, change, note, alerts, onAlerts } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const liveHint = offline
    ? "Paused: no connection"
    : live
      ? `Re-checks from your GPS every ${intervalMin} min`
      : "Turn on while driving";

  return (
    <div className="live">
      <div className="live-row">
        <Switch
          checked={live}
          onChange={onToggle}
          label="Live updates"
          hint={`${liveHint}${updatedAt ? ` · updated ${ago(updatedAt, now)}` : ""}`}
        />
        <button type="button" className="btn-secondary" onClick={onRecheck} disabled={busy || offline}>
          {busy ? "Checking…" : "Re-check now"}
        </button>
      </div>
      {alerts !== null && (
        <div className="live-row live-row-sub">
          <Switch
            checked={alerts}
            onChange={onAlerts}
            label="Alert me"
            hint="Phone notification when weather ahead gets worse"
          />
        </div>
      )}
      {change && (
        <p className={`live-change live-${change.tone}`} role="status">
          {change.text}
        </p>
      )}
      {note && <p className="live-note">{note}</p>}
    </div>
  );
}
