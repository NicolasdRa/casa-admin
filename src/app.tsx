import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { ConfirmProvider } from "~/components/ConfirmProvider";
import { I18nProvider } from "~/lib/i18n";
import "./app.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <I18nProvider>
          <ConfirmProvider>
            <Suspense>{props.children}</Suspense>
          </ConfirmProvider>
        </I18nProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
