import { useEffect, useState } from "react";
import type { PlanChange } from "../lib/live";

interface Props {
  live: boolean;
  onToggle: (on: boolean) => void;
  onRecheck: () => void;
  busy: boolean;
  updatedAt: Date | null;
  intervalMin: number;
  change: PlanChange | null;
  note: string | null;
}

function ago(date: Date, now: number): string {
  const min = Math.floor((now - date.getTime()) / 60_000);
  return min < 1 ? "just now" : `${min} min ago`;
}

/** Driving mode: re-plan from the truck's GPS position on a timer so the risk ahead stays current. */
export function LiveBar({ live, onToggle, onRecheck, busy, updatedAt, intervalMin, change, note }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="live">
      <div className="live-row">
        <label className="switch">
          <input type="checkbox" role="switch" checked={live} onChange={(e) => onToggle(e.target.checked)} />
          <span className="switch-track" aria-hidden />
          <span className="switch-label">
            Live updates
            <small>
              {live ? `Re-checks from your GPS every ${intervalMin} min` : "Turn on while driving"}
              {updatedAt && ` · updated ${ago(updatedAt, now)}`}
            </small>
          </span>
        </label>
        <button type="button" className="btn-secondary" onClick={onRecheck} disabled={busy}>
          {busy ? "Checking…" : "Re-check now"}
        </button>
      </div>
      {change && (
        <p className={`live-change live-${change.tone}`} role="status">
          {change.text}
        </p>
      )}
      {note && <p className="live-note">{note}</p>}
    </div>
  );
}
