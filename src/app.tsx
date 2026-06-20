import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { I18nProvider } from "~/lib/i18n";

export default function App() {
  return (
    <Router
      root={(props) => (
        <I18nProvider>
          <Suspense>{props.children}</Suspense>
        </I18nProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
