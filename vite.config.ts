import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  root: "web",
  build: { outDir: "../web-dist", emptyOutDir: true },
  // The top tile shows the release version, which follows the Enterprise-D's registry (1701.4.x).
  plugins: [{ name: "picard-version", transformIndexHtml: { order: "pre", handler: (html) => html.replace("%PICARD_VERSION%", version) } }, {
    name: "renderer-notices",
    generateBundle() {
      const files = [
        "pele/LICENSE", "katex/LICENSE", "@pierre/highlights/LICENSE.md", "@pierre/highlights/NOTICE.md",
        "pdfjs-dist/LICENSE", "docx-preview/LICENSE", "@betteroffice/xlsx/LICENSE", "@betteroffice/pptx/LICENSE",
        "@betteroffice/fonts/LICENSE", "@betteroffice/fonts/LICENSES/OFL-Liberation.txt",
        "jszip/LICENSE.markdown", "pako/LICENSE", "lie/license.md", "immediate/LICENSE.txt", "setimmediate/LICENSE.txt",
        "readable-stream/LICENSE", "core-util-is/LICENSE", "inherits/LICENSE", "isarray/README.md",
        "string_decoder/LICENSE", "safe-buffer/LICENSE", "util-deprecate/LICENSE",
      ];
      this.emitFile({ type: "asset", fileName: "renderer-notices.txt",
        source: files.map((file) => `${file}\n\n${readFileSync(new URL(`node_modules/${file}`, import.meta.url), "utf8")}`).join("\n\n---\n\n") });
    },
  }],
});
