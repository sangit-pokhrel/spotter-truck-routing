import { useEffect, useId, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { Place } from "../api/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

export interface PlaceValue {
  text: string;
  /** Set once the user picks a suggestion; otherwise the backend geocodes `text`. */
  place: Place | null;
}

interface Props {
  label: string;
  placeholder: string;
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  /** Optional button shown inside the field (e.g. "use my location"). */
  action?: ReactNode;
}

export function PlaceInput({ label, placeholder, value, onChange, action }: Props) {
  const id = useId();
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = useDebouncedValue(value.place ? "" : value.text.trim(), 300);

  useEffect(() => {
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    api
      .geocode(query, ctrl.signal)
      .then((results) => {
        setSuggestions(results);
        setActive(-1);
      })
      .catch(() => setSuggestions([]));
    return () => ctrl.abort();
  }, [query]);

  const choose = (place: Place) => {
    onChange({ text: place.label, place });
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && suggestions.length > 0 && !value.place;

  return (
    <div className={`field place-input${action ? " has-action" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="next"
        placeholder={placeholder}
        value={value.text}
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
        onChange={(e) => {
          onChange({ text: e.target.value, place: null });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        required
      />
      {value.place && !action && <span className="place-check" aria-label="Location confirmed">✓</span>}
      {action && <div className="field-action">{action}</div>}
      {showList && (
        <ul className="suggestions" id={`${id}-list`} role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={`${s.lat},${s.lon},${i}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
