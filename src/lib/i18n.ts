import { flatten, resolveTemplate, translator } from "@solid-primitives/i18n";
import { createContext, createSignal, type ParentProps, useContext } from "solid-js";
import { en } from "~/locales/en";
import { es } from "~/locales/es";

export type Locale = "es" | "en";
const dictionaries = { es: flatten(es), en: flatten(en) };

// ponytail: locale in a module signal is fine for a 3-user tool; persist per-user in DB later (Settings.default_locale).
const [locale, setLocale] = createSignal<Locale>("es");

function makeContext() {
  const t = translator(() => dictionaries[locale()], resolveTemplate);
  return { t, locale, setLocale };
}
const I18nContext = createContext<ReturnType<typeof makeContext>>();

export function I18nProvider(props: ParentProps) {
  const value = makeContext();
  return I18nContext.Provider({
    value,
    get children() {
      return props.children;
    },
  });
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
