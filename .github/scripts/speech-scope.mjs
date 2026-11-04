import { isDeepStrictEqual } from "node:util";

const local = new Set([
  "src/server/speech.ts", "src/server/speech-types.ts", "src/server/speech-bridge.ts",
  "src/server/local-speech.ts", "src/server/nemotron-speech.ts", "src/server/turn-detector.ts",
  "src/shared/crew-voices.ts", "src/tests/speech-local-check.ts", "src/tests/officer-voices-check.ts",
  "scripts/setup-speech.mjs", "scripts/setup-nemotron.mjs", "scripts/setup-turn.mjs",
  "scripts/setup-local-speech.py", "scripts/local-speech-worker.py", "scripts/turn-detector-worker.py",
  "scripts/requirements-kokoro.in", "scripts/requirements-kokoro.txt",
  "scripts/requirements-turn.in", "scripts/requirements-turn.txt", "scripts/smart-turn-LICENSE.txt",
  ".github/workflows/local-speech.yml", "tsconfig.json",
]);
const browser = new Set([
  "web/voice.ts", "web/speech-detector.ts", "web/public/microphone-worklet.js",
  "src/shared/speech-detector.ts", "src/shared/utterance.ts",
  "src/tests/test-audio.ts", "browser-tests/speech-detector.spec.ts",
  ".github/workflows/browser-speech.yml", "vite.config.ts", "playwright.config.ts",
  "tsconfig.json", "tsconfig.web.json",
]);

function packageInputs({ manifest, lock }, roots) {
  if (!lock.packages || lock.lockfileVersion < 2) throw new Error("Speech checks need a package lock with resolved packages.");
  const packages = {};
  const visit = (name, parent = "", optional = false) => {
    let folder = parent;
    let path;
    while (true) {
      const candidate = `${folder ? `${folder}/` : ""}node_modules/${name}`;
      if (lock.packages[candidate]) { path = candidate; break; }
      if (!folder) {
        if (optional) return;
        throw new Error(`The package lock is missing the speech dependency ${name}.`);
      }
      folder = folder.slice(0, Math.max(0, folder.lastIndexOf("/node_modules/")));
    }
    if (packages[path]) return;
    const record = lock.packages[path];
    packages[path] = Object.fromEntries([
      "version", "resolved", "integrity", "dependencies", "optionalDependencies",
      "peerDependencies", "peerDependenciesMeta", "os", "cpu", "libc", "engines", "hasInstallScript", "link",
    ].filter((key) => key in record).map((key) => [key, record[key]]));
    for (const dependency of Object.keys({ ...record.dependencies, ...record.optionalDependencies })) visit(dependency, path);
    for (const dependency of Object.keys(record.peerDependencies ?? {})) visit(dependency, path, !!record.peerDependenciesMeta?.[dependency]?.optional);
  };
  const declared = Object.fromEntries(roots.map((name) => {
    const version = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? manifest.optionalDependencies?.[name];
    if (version) visit(name);
    return [name, version];
  }));
  return { declared, packages, engines: manifest.engines, type: manifest.type };
}

/** Separate from the normal full checks: unrelated files never select model jobs. */
export function speechScope(files, before, after) {
  let localSpeech = files.some((file) => local.has(file));
  let browserSpeech = files.some((file) => browser.has(file));
  if (files.some((file) => file === "package.json" || file === "package-lock.json")) {
    if (!before || !after) throw new Error("Speech dependency changes need both package manifests and locks.");
    localSpeech ||= !isDeepStrictEqual(packageInputs(before, ["ws", "typescript"]), packageInputs(after, ["ws", "typescript"]))
      || before.manifest.scripts?.["setup:speech"] !== after.manifest.scripts?.["setup:speech"]
      || before.manifest.scripts?.["test:speech:local"] !== after.manifest.scripts?.["test:speech:local"]
      || before.manifest.scripts?.build !== after.manifest.scripts?.build;
    browserSpeech ||= !isDeepStrictEqual(packageInputs(before, ["@ricky0123/vad-web", "onnxruntime-web", "vite", "typescript", "@playwright/test"]),
      packageInputs(after, ["@ricky0123/vad-web", "onnxruntime-web", "vite", "typescript", "@playwright/test"]))
      || before.manifest.scripts?.build !== after.manifest.scripts?.build;
  }
  return { localSpeech, browserSpeech };
}

export function speechPassed(required, result) {
  return required === "true" ? result === "success" : required === "false" && result === "skipped";
}
