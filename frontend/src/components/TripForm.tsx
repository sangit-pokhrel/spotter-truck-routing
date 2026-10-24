import { useState } from "react";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormLabel from "@mui/material/FormLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import type { PlanRequest } from "../api/types";
import { nextHour, toLocalInputValue } from "../lib/format";
import { getCurrentPlace } from "../lib/location";
import { loadPref, savePref } from "../lib/prefs";
import { MyLocationIcon, SwapVertIcon } from "./icons";
import { PlaceInput, type PlaceValue } from "./PlaceInput";

const INTERVALS = [10, 25, 50] as const;
type Interval = (typeof INTERVALS)[number];
const MAX_DAYS_AHEAD = 7;

const QUICK_DEPARTURES: { label: string; at: () => Date }[] = [
  { label: "Now", at: () => new Date() },
  { label: "+1 h", at: () => new Date(Date.now() + 3600_000) },
  { label: "+3 h", at: () => new Date(Date.now() + 3 * 3600_000) },
  {
    label: "Tomorrow 6 AM",
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(6, 0, 0, 0);
      return d;
    },
  },
];

interface Props {
  loading: boolean;
  onSubmit: (request: PlanRequest) => void;
}

export function TripForm({ loading, onSubmit }: Props) {
  const [origin, setOrigin] = useState<PlaceValue>({ text: "Denver, CO", place: null });
  const [destination, setDestination] = useState<PlaceValue>({ text: "Chicago, IL", place: null });
  const [departure, setDeparture] = useState(() => toLocalInputValue(nextHour()));
  const [weight, setWeight] = useState(() => loadPref("load", "42000"));
  const [interval, setIntervalMiles] = useState<Interval>(() => {
    const saved = Number(loadPref("interval", "25"));
    return (INTERVALS as readonly number[]).includes(saved) ? (saved as Interval) : 25;
  });
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const now = new Date();
  const maxDeparture = new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 3600 * 1000);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    savePref("load", weight);
    savePref("interval", String(interval));
    onSubmit({
      origin: origin.place ?? origin.text,
      destination: destination.place ?? destination.text,
      // datetime-local is the browser's local time; send an absolute instant.
      departure_time: new Date(departure).toISOString(),
      load_weight_lb: Number(weight),
      interval_miles: interval,
    });
  };

  const swap = () => {
    setOrigin(destination);
    setDestination(origin);
  };

  const useMyLocation = () => {
    setLocating(true);
    setLocateError(null);
    getCurrentPlace()
      .then((place) => setOrigin({ text: place.label, place }))
      .catch(() => setLocateError("Couldn't get your location. Type a city instead."))
      .finally(() => setLocating(false));
  };

  const locateButton = (
    <Button
      size="small"
      className="locate-btn"
      onClick={useMyLocation}
      loading={locating}
      loadingPosition="start"
      startIcon={<MyLocationIcon />}
      aria-label="Use my current location"
    >
      My location
    </Button>
  );

  return (
    <form className="trip-form" onSubmit={submit}>
      <div className="od">
        <div className="od-rail" aria-hidden>
          <i className="od-dot od-o" />
          <i className="od-line" />
          <i className="od-dot od-d" />
        </div>
        <div className="od-fields">
          <PlaceInput
            label="From"
            placeholder="City, address or lat,lon"
            value={origin}
            onChange={setOrigin}
            action={locateButton}
          />
          <PlaceInput label="To" placeholder="City, address or lat,lon" value={destination} onChange={setDestination} />
        </div>
        <Tooltip title="Swap">
          <IconButton className="od-swap" onClick={swap} aria-label="Swap origin and destination">
            <SwapVertIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </div>
      {locateError && <p className="field-error">{locateError}</p>}

      <Stack spacing={1}>
        <Stack
          direction="row"
          useFlexGap
          sx={{ flexWrap: "wrap", gap: 0.75 }}
          role="group"
          aria-label="Quick departure times"
        >
          {QUICK_DEPARTURES.map((q) => (
            <Chip
              key={q.label}
              label={q.label}
              variant="outlined"
              size="small"
              onClick={() => setDeparture(toLocalInputValue(q.at()))}
            />
          ))}
        </Stack>
        <TextField
          label="Departure"
          type="datetime-local"
          value={departure}
          onChange={(e) => setDeparture(e.target.value)}
          required
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: toLocalInputValue(maxDeparture) } }}
        />
      </Stack>

      <div className="field-row">
        <TextField
          label="Load"
          type="number"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          required
          slotProps={{
            input: { endAdornment: <InputAdornment position="end">lb</InputAdornment> },
            htmlInput: { min: 100, max: 150000, step: 100, inputMode: "numeric", className: "mono" },
          }}
        />
        <div>
          <FormLabel id="interval-label" className="field-label">
            Check weather every (mi)
          </FormLabel>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            color="primary"
            value={interval}
            onChange={(_, mi: Interval | null) => mi && setIntervalMiles(mi)}
            aria-labelledby="interval-label"
          >
            {INTERVALS.map((mi) => (
              <ToggleButton key={mi} value={mi}>
                {mi}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>
      </div>

      <Button type="submit" variant="contained" size="large" fullWidth loading={loading} loadingPosition="start">
        {loading ? "Planning…" : "Find safest route"}
      </Button>
    </form>
  );
}
