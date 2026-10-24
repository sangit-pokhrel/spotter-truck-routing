import { useEffect, useState } from "react";
import Alert, { type AlertColor } from "@mui/material/Alert";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import type { ChangeTone, PlanChange } from "../lib/live";
import { RefreshIcon } from "./icons";

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

const TONE_SEVERITY: Record<ChangeTone, AlertColor> = { worse: "error", better: "success", same: "info" };

function ago(date: Date, now: number): string {
  const min = Math.floor((now - date.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 90) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

function Toggle({
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
    <FormControlLabel
      className="switch"
      control={<Switch color="success" checked={checked} onChange={(e) => onChange(e.target.checked)} />}
      label={
        <span className="switch-label">
          {label}
          <small>{hint}</small>
        </span>
      }
    />
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
        <Toggle
          checked={live}
          onChange={onToggle}
          label="Live updates"
          hint={`${liveHint}${updatedAt ? ` · updated ${ago(updatedAt, now)}` : ""}`}
        />
        <Button
          variant="outlined"
          color="inherit"
          onClick={onRecheck}
          disabled={offline}
          loading={busy}
          loadingPosition="start"
          startIcon={<RefreshIcon />}
          sx={{ flex: "none", borderColor: "divider" }}
        >
          {busy ? "Checking…" : "Re-check now"}
        </Button>
      </div>
      {alerts !== null && (
        <div className="live-row live-row-sub">
          <Toggle
            checked={alerts}
            onChange={onAlerts}
            label="Alert me"
            hint="Phone notification when weather ahead gets worse"
          />
        </div>
      )}
      {change && (
        <Alert severity={TONE_SEVERITY[change.tone]} role="status" sx={{ mt: 1.25 }}>
          {change.text}
        </Alert>
      )}
      {note && (
        <Alert severity="info" icon={false} sx={{ mt: 1.25 }}>
          {note}
        </Alert>
      )}
    </div>
  );
}
