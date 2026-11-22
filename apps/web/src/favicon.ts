import { useEffect } from "react";

/**
 * The favicon is one dot, the same one that marks your messages on the map,
 * and it follows your latest order: blue before you order, pulsing while the
 * saga runs (amber while it gives stock back), then green or red. So a
 * background tab still shows how the order ended.
 */
const COLOR: Record<string, string> = {
  idle: "#3b82f6",
  AWAITING_STOCK: "#3b82f6",
  AWAITING_PAYMENT: "#3b82f6",
  RELEASING_STOCK: "#f59e0b",
  CONFIRMED: "#22c55e",
  CANCELLED: "#ef4444",
};
const RUNNING = new Set(["AWAITING_STOCK", "AWAITING_PAYMENT", "RELEASING_STOCK"]);

const dot = (color: string, r: number, opacity = 1) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="${r}" fill="${color}" fill-opacity="${opacity}"/></svg>`,
  )}`;

function link(): HTMLLinkElement {
  let el = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!el) {
    el = document.createElement("link");
    el.rel = "icon";
    document.head.appendChild(el);
  }
  return el;
}

/** Keeps the favicon in step with `state` (your latest order's saga state). */
export function useFavicon(state: string | undefined): void {
  useEffect(() => {
    const color = COLOR[state ?? "idle"] ?? COLOR.idle!;
    const el = link();
    const still = dot(color, 11);
    el.href = still;
    // Browsers don't animate favicons, so a running saga swaps two frames.
    if (!state || !RUNNING.has(state)) return;
    const soft = dot(color, 8, 0.55);
    let on = false;
    const t = setInterval(() => {
      on = !on;
      el.href = on ? soft : still;
    }, 600);
    return () => {
      clearInterval(t);
      el.href = still;
    };
  }, [state]);
}
