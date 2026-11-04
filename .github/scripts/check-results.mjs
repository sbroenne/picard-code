import { pathToFileURL } from "node:url";
import { speechPassed } from "./speech-scope.mjs";

export function serverChecksPassed({ scope, full, systems, localRequired, localSpeech, browserRequired, browserSpeech }) {
  return scope === "success" && speechPassed(full, systems)
    && speechPassed(localRequired, localSpeech) && speechPassed(browserRequired, browserSpeech);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!serverChecksPassed({
    scope: process.env.SCOPE_RESULT, full: process.env.FULL_CHECKS, systems: process.env.SYSTEMS_RESULT,
    localRequired: process.env.LOCAL_REQUIRED, localSpeech: process.env.LOCAL_RESULT,
    browserRequired: process.env.BROWSER_REQUIRED, browserSpeech: process.env.DETECTION_RESULT,
  })) throw new Error("Required checks failed, were cancelled, or did not run as selected. See the changed-file and speech job results.");
}
