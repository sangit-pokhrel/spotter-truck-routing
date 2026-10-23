import { useEffect, useState } from "react";

/** Phones and portrait tablets get the stacked, map-first layout. Keep in sync with styles.css. */
export const COMPACT_QUERY = "(max-width: 900px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
