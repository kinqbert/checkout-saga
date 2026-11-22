import { useEffect, useState } from "react";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export const PHONE = "(max-width: 720px)";
export const LAPTOP = "(max-width: 1320px)";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
