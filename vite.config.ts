import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  root: "web",
  build: { outDir: "../web-dist", emptyOutDir: true },
  // The top tile shows the release version, which follows the Enterprise-D's registry (1701.4.x).
  plugins: [{ name: "picard-version", transformIndexHtml: { order: "pre", handler: (html) => html.replace("%PICARD_VERSION%", version) } }],
});
