// Builds the web app into media/, where the extension serves it to the webview.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(root, "..", "web");
const out = join(root, "media");
const run = (cmd) => execSync(cmd, { cwd: web, stdio: "inherit" });

if (!existsSync(join(web, "node_modules"))) run("npm ci");
run(`npx vite build --outDir "${out}" --emptyOutDir`);
