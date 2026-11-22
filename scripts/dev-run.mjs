// like `node --watch`, but also restarts a service that exits on its own (as Docker would).
// usage (from a service folder): node ../../scripts/dev-run.mjs dist/main.js
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { dirname } from "node:path";

const entry = process.argv[2] ?? "dist/main.js";
let child;
let restarting = false;
let stopping = false;

function start() {
  child = spawn(process.execPath, ["--env-file-if-exists=.env", entry], { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    if (restarting) {
      restarting = false;
      return start();
    }
    console.log(`[dev-run] ${entry} exited (${signal ?? code}), restarting in 1s`);
    setTimeout(start, 1000);
  });
}

// tsc -w writes several files at once: debounce.
let timer;
watch(dirname(entry), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    restarting = true;
    child.kill("SIGTERM");
  }, 300);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopping = true;
    child.kill(sig);
    process.exit(0);
  });
}

start();
