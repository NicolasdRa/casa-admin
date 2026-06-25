import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { ConfirmProvider } from "~/components/ConfirmProvider";
import { ToastProvider } from "~/components/ToastProvider";
import { I18nProvider } from "~/lib/i18n";
import "./app.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <I18nProvider>
          <ToastProvider>
            <ConfirmProvider>
              <Suspense>{props.children}</Suspense>
            </ConfirmProvider>
          </ToastProvider>
        </I18nProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
