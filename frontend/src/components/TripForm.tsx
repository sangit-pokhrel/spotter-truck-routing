import { useState } from "react";
import type { PlanRequest } from "../api/types";
import { nextHour, toLocalInputValue } from "../lib/format";
import { getCurrentPlace } from "../lib/location";
import { loadPref, savePref } from "../lib/prefs";
import { PlaceInput, type PlaceValue } from "./PlaceInput";

const INTERVALS = [10, 25, 50] as const;
type Interval = (typeof INTERVALS)[number];
const MAX_DAYS_AHEAD = 7;

/** One-tap departure choices so drivers rarely need the date picker. */
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
    <button
      type="button"
      className="locate-btn"
      onClick={useMyLocation}
      disabled={locating}
      aria-label="Use my current location"
      title="Use my location"
    >
      <svg viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" />
      </svg>
      <span>{locating ? "Locating…" : "My location"}</span>
    </button>
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
        <button type="button" className="icon-btn od-swap" onClick={swap} aria-label="Swap origin and destination" title="Swap">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M5 2v10M5 2 2.5 4.5M5 2l2.5 2.5M11 14V4m0 10-2.5-2.5M11 14l2.5-2.5" />
          </svg>
        </button>
      </div>
      {locateError && <p className="field-error">{locateError}</p>}

      <div className="field">
        <label htmlFor="departure">Departure</label>
        <div className="chips" role="group" aria-label="Quick departure times">
          {QUICK_DEPARTURES.map((q) => (
            <button key={q.label} type="button" className="chip" onClick={() => setDeparture(toLocalInputValue(q.at()))}>
              {q.label}
            </button>
          ))}
        </div>
        <input
          id="departure"
          type="datetime-local"
          value={departure}
          max={toLocalInputValue(maxDeparture)}
          onChange={(e) => setDeparture(e.target.value)}
          required
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="weight">Load</label>
          <div className="input-unit">
            <input
              id="weight"
              type="number"
              inputMode="numeric"
              min={100}
              max={150000}
              step={100}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              required
            />
            <span>lb</span>
          </div>
        </div>
        <fieldset className="field">
          <legend>Check weather every (mi)</legend>
          <div className="seg">
            {INTERVALS.map((mi) => (
              <label key={mi} className={interval === mi ? "on" : undefined}>
                <input type="radio" name="interval" value={mi} checked={interval === mi} onChange={() => setIntervalMiles(mi)} />
                {mi}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Planning…" : "Find safest route"}
      </button>
    </form>
  );
}
