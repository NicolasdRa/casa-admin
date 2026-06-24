import { spawn } from "node:child_process";
import { connect } from "node:net";

// ponytail: REMOVE when SolidStart 2.x (native `vite dev`) lands as stable —
// Vite then auto-increments the port AND prints the real URL itself, so this
// launcher and the "dev" script indirection become dead weight. Until then,
// vinxi v1 only exposes --port and its banner is hardcoded to 3000, lying when
// the port moves. So: find the next free port, pin vinxi to it, print the URL.

// Detect a listener by *connecting*, not by binding: on macOS a wildcard bind
// succeeds even when the port is held on a specific address (127.0.0.1), so a
// bind-check falsely reports "free". A successful connect means someone's there.
const probe = (port, host) =>
  new Promise((res) => {
    const sock = connect({ port, host });
    sock.setTimeout(400);
    sock.once("connect", () => (sock.destroy(), res(true)));
    const no = () => (sock.destroy(), res(false));
    sock.once("error", no).once("timeout", no);
  });
const inUse = async (port) => (await probe(port, "127.0.0.1")) || (await probe(port, "::1"));

let port = Number(process.env.PORT) || 3000;
while (await inUse(port)) port++;

console.log(`\n  ➜  http://localhost:${port}/\n`);
spawn("vinxi", ["dev", "--port", String(port)], { stdio: "inherit" });
