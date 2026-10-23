import { useState } from "react";
import type { PlanRequest } from "../api/types";
import { nextHour, toLocalInputValue } from "../lib/format";
import { PlaceInput, type PlaceValue } from "./PlaceInput";

const INTERVALS = [10, 25, 50] as const;
const MAX_DAYS_AHEAD = 7;

interface Props {
  loading: boolean;
  onSubmit: (request: PlanRequest) => void;
}

export function TripForm({ loading, onSubmit }: Props) {
  const [origin, setOrigin] = useState<PlaceValue>({ text: "Denver, CO", place: null });
  const [destination, setDestination] = useState<PlaceValue>({ text: "Chicago, IL", place: null });
  const [departure, setDeparture] = useState(() => toLocalInputValue(nextHour()));
  const [weight, setWeight] = useState("42000");
  const [interval, setIntervalMiles] = useState<(typeof INTERVALS)[number]>(25);

  const now = new Date();
  const maxDeparture = new Date(now.getTime() + MAX_DAYS_AHEAD * 24 * 3600 * 1000);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      origin: origin.place ?? origin.text,
      destination: destination.place ?? destination.text,
      // datetime-local is the browser's local time; send an absolute instant.
      departure_time: new Date(departure).toISOString(),
      load_weight_lb: Number(weight),
      interval_miles: interval,
    });
  };

  return (
    <form className="trip-form" onSubmit={submit}>
      <PlaceInput label="Origin" placeholder="City, address or lat,lon" value={origin} onChange={setOrigin} />
      <PlaceInput
        label="Destination"
        placeholder="City, address or lat,lon"
        value={destination}
        onChange={setDestination}
      />
      <div className="field-row">
        <div className="field">
          <label htmlFor="departure">Departure</label>
          <input
            id="departure"
            type="datetime-local"
            value={departure}
            min={toLocalInputValue(now)}
            max={toLocalInputValue(maxDeparture)}
            onChange={(e) => setDeparture(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="weight">Load weight (lb)</label>
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
        </div>
      </div>
      <fieldset className="field">
        <legend>Weather checkpoint every</legend>
        <div className="segmented">
          {INTERVALS.map((mi) => (
            <label key={mi} className={interval === mi ? "selected" : undefined}>
              <input
                type="radio"
                name="interval"
                value={mi}
                checked={interval === mi}
                onChange={() => setIntervalMiles(mi)}
              />
              {mi} mi
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" className="primary" disabled={loading}>
        {loading ? "Planning routes…" : "Find safest route"}
      </button>
    </form>
  );
}
