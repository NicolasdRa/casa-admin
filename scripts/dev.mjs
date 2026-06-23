import { createServer } from "node:net";
import { spawn } from "node:child_process";

// ponytail: REMOVE when SolidStart 2.x (native `vite dev`) lands as stable —
// Vite then auto-increments the port AND prints the real URL itself, so this
// launcher and the "dev" script indirection become dead weight. Until then,
// vinxi v1 only exposes --port and its banner is hardcoded to 3000, lying when
// the port moves. So: find the next free port, pin vinxi to it, print the URL
// that actually works.
const isFree = (port) =>
  new Promise((res) => {
    const s = createServer()
      .once("error", () => res(false))
      .once("listening", () => s.close(() => res(true)))
      .listen(port, "::"); // same dual-stack bind vinxi uses
  });

let port = Number(process.env.PORT) || 3000;
// ponytail: tiny TOCTOU window between free-check and vinxi binding; fine for a
// dev box, swap to retry-on-EADDRINUSE if it ever actually races.
while (!(await isFree(port))) port++;

console.log(`\n  ➜  http://localhost:${port}/\n`);
spawn("vinxi", ["dev", "--port", String(port)], { stdio: "inherit" });
