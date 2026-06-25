import { createSignal } from "solid-js";
import { isServer } from "solid-js/web";

export type Theme = "light" | "dark";

// The inline <head> script (entry-server.tsx) has already resolved + applied the theme before
// hydration, so read it back from the <html> element rather than re-deciding it here.
// ponytail: module signal mirrors i18n.ts — per-device, localStorage, no DB. Persist to
// settings.* only if a theme must follow a user across devices.
function initial(): Theme {
  if (isServer) return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const [theme, setTheme] = createSignal<Theme>(initial());

export { theme };

export function toggleTheme() {
  const next: Theme = theme() === "dark" ? "light" : "dark";
  setTheme(next);
  document.documentElement.dataset.theme = next;
  try {
    localStorage.theme = next;
  } catch {
    // private mode / storage disabled — the toggle still works for this session.
  }
}
