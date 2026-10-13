import { spawn } from "node:child_process";

const mode = process.argv[2];
if (mode === "descendant" || mode === "ignore") {
  if (mode === "ignore") process.on("SIGTERM", () => {});
  process.stdout.write("ready\n");
  setInterval(() => {}, 1000);
} else if (mode === "signal-parent" || mode === "numeric-parent") {
  const child = spawn(process.execPath, [import.meta.filename, "descendant"], { stdio: ["ignore", "pipe", "inherit"] });
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`descendant=${child.pid}\n${chunk}`);
    if (mode === "signal-parent") process.kill(process.pid, "SIGTERM");
    else process.exit(7);
  });
} else if (mode === "exit-zero") {
  process.stdout.write("complete\n");
} else if (mode === "closed-ignore-parent") {
  const child = spawn(process.execPath, [import.meta.filename, "ignore"], { stdio: ["ignore", "pipe", "ignore"] });
  child.stdout.once("data", (chunk) => {
    process.stdout.write(`descendant=${child.pid}\n${chunk}`, () => process.exit(7));
  });
} else {
  throw new Error(`Unknown OS fixture mode: ${mode}`);
}
