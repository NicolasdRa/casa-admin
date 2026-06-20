import { redirect } from "@solidjs/router";
import { createMiddleware } from "@solidjs/start/middleware";
import { currentUser } from "~/lib/session";

// Gate page navigation: anyone not logged in is sent to /login. Server-function RPCs (/_server)
// and static assets (paths with a dot) pass through — actions/queries enforce their own access
// via requireUser()/can() where needed. The login page itself is always reachable.
export default createMiddleware({
  onRequest: async (event) => {
    const { pathname } = new URL(event.request.url);
    if (pathname === "/login" || pathname.startsWith("/_server") || pathname.includes(".")) return;
    if (!(await currentUser())) return redirect("/login");
  },
});
