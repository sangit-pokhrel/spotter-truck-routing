import { useEffect, useState, type ReactNode } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { api } from "../api/client";
import type { Place } from "../api/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { CheckIcon } from "./icons";

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
  /** e.g. a "use my location" button */
  action?: ReactNode;
}

const samePlace = (option: Place, value: Place | string) =>
  typeof value !== "string" && option.lat === value.lat && option.lon === value.lon;

export function PlaceInput({ label, placeholder, value, onChange, action }: Props) {
  // results are tagged with their query so a stale list never shows under newer text
  const [results, setResults] = useState<{ query: string; places: Place[] }>({ query: "", places: [] });
  const typed = value.place ? "" : value.text.trim();
  const query = useDebouncedValue(typed, 300);

  useEffect(() => {
    if (query.length < 3) return;
    const ctrl = new AbortController();
    api
      .geocode(query, ctrl.signal)
      .then((places) => setResults({ query, places }))
      .catch(() => !ctrl.signal.aborted && setResults({ query, places: [] }));
    return () => ctrl.abort();
  }, [query]);

  const suggestions = results.query === typed ? results.places : [];
  const loading = typed.length >= 3 && results.query !== typed;

  return (
    <Autocomplete<Place, false, true, true>
      // free text is allowed: anything typed is geocoded by the backend on submit
      freeSolo
      // no clear button: it would sit on top of the "My location" button
      disableClearable
      options={suggestions}
      // Photon already ranked the matches; only drop repeats (separate map objects, same label)
      filterOptions={(options) => options.filter((o, i) => options.findIndex((p) => p.label === o.label) === i)}
      getOptionLabel={(option) => (typeof option === "string" ? option : option.label)}
      getOptionKey={(option) => (typeof option === "string" ? option : `${option.lat},${option.lon}`)}
      isOptionEqualToValue={samePlace}
      loading={loading}
      loadingText="Searching…"
      value={value.place ?? value.text}
      inputValue={value.text}
      onInputChange={(_, text, reason) => {
        if (reason === "input") onChange({ text, place: null });
      }}
      onChange={(_, option) => {
        if (typeof option === "string") onChange({ text: option, place: null });
        else onChange({ text: option.label, place: option });
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, autoCapitalize: "words", enterKeyHint: "next" },
            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {value.place && !action && (
                    <InputAdornment position="end" aria-label="Location confirmed">
                      <CheckIcon color="success" fontSize="small" />
                    </InputAdornment>
                  )}
                  {action && <InputAdornment position="end">{action}</InputAdornment>}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
