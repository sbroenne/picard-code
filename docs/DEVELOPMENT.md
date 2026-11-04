# Developing Picard Code

Read [AGENTS.md](../AGENTS.md) for the project rules and
[CONTRIBUTING.md](../CONTRIBUTING.md) for contribution and review guidance.
Follow [Run from source](../README.md#run-from-source) to clone, install and
build the app. Use your own OpenCode sign-in and speech resources.

## Live updates while developing

Use `npm run dev` instead of `npm start`. For Azure MAI on both sides, run
`npm run dev -- --listening mai --speaking mai`. Vite updates browser code
and styles automatically; changes to the page itself reload it. Restart the
command after changing server code. This development mode stays on
`127.0.0.1`, uses the real app and its normal sign-in checks, and does not
change the normal launch or your saved speech choices.
If the browser cannot open, the servers keep running so you can open the
printed live-updates address yourself. Windows shutdown stops the app's
child processes too.
After building, `node --test tools/dev.test.mjs tools/dev-server.test.mjs`
checks launcher failures and shutdown, live style updates and the development
server's local connection checks.

In PowerShell, use `npm.cmd` for commands with `--` options; some npm
PowerShell wrappers otherwise drop the `--`.

## Speech services

The shared interfaces are in `src/server/speech-types.ts`. A listener accepts
one channel of signed little-endian 16-bit audio at 16,000 samples per second,
reports understood words, and commits a turn on request. A speaker streams
the same audio format at 24,000 samples per second. Both receive a cancellation
signal; `close()` releases owned workers. Selection happens in
`src/server/speech.ts`, without changes to the browser's conversation controls.
See [third-party notices](../THIRD_PARTY_NOTICES.md) before redistributing local
dependencies or downloaded models.

Conversation instructions live in `src/server/instructions.ts` and are sent
with every request. Speech wording lives in `src/shared/speech.ts`.

## Checks

For changes only to documentation or the project website, use
`npx playwright test browser-tests/site.spec.ts`. It checks website layouts
and documentation links without building the app. App, dependency, setup and
check configuration changes still need full checks. The complete rules,
including development-only tools, are in [AGENTS.md](../AGENTS.md#checks)
and [CONTRIBUTING.md](../CONTRIBUTING.md#make-and-check-a-change).

```sh
npm run check
npm run build
npm test
npx playwright test
```

`check` finds likely mistakes and unused code with oxlint, then checks the
types of the server and browser code. Build before running server tests:
they run the compiled files in `dist/`.

### Which GitHub checks run real speech

Real speech checks are separate from the normal app checks. They use
GitHub-hosted Apple silicon macOS, Ubuntu x64 and Windows x64 computers;
there are no self-hosted runners and no paid AI-provider or Azure requests.

| What the pull request changes | Extra checks |
| --- | --- |
| Local speech services, workers, setup, fixed voices or real-check inputs | Real Nemotron listening, Kokoro speaking and Smart Turn pause predictions on all three systems |
| Browser speech capture, Silero detection, utterance timing or their focused tests | Real Chromium/Silero checks on Mac and Windows, alongside Ubuntu's existing browser suite; no large speech downloads |
| Relevant resolved npm dependencies or their dependencies, Node requirements, or the corresponding check's runtime/build settings | Only the affected checks |
| Documentation, website, styling, ordinary reply wording, unrelated app work, unrelated dependency updates or release-version-only edits | No extra real speech checks |

The exact file lists and dependency comparisons are in
[speech-scope.mjs](../.github/scripts/speech-scope.mjs). Utterance timing is kept
separate from reply formatting so wording edits do not select model checks.
General workflow edits run the fast workflow tests; editing a speech
workflow itself selects its real checks.

Selection uses the complete pull request, not just its latest commit.
If a pull request contains speech changes, a later README-only commit still
reruns the selected speech checks. Passing test results are never cached.
The existing required checks reject failed, cancelled or unexpectedly skipped
speech checks. Pushes to main do not automatically repeat these extra checks.

Only the downloaded model files and their notices are cached. Every selected
run prepares the software afresh, verifies the files' checksums and executes
the models. Cache misses or eviction require another download.
GitHub keeps pull-request caches separate, so new pull requests can reuse a
cache from main but cannot use another pull request's cache.
To seed those shared caches, or to check speech manually, run **Project checks**
from GitHub Actions on main with **speech-checks: all**. Choose **local** for
Nemotron/Kokoro/Smart Turn, **browser** for focused browser detection, or
**none** (the default) for the existing checks only.
This input does not change saved speech choices or request a release.

Silero's model runs in browser WebAssembly; Smart Turn's model runs in the
local Python worker. Their model files are portable, but running them on
each system checks the actual browser and local software there.
These checks use original generated audio, not a physical microphone.
They do not establish Safari/Firefox behaviour, room-echo handling or a full
real AI-provider conversation.

### What the checks cover

The server and browser tests use a clearly labeled local test server that follows
OpenCode 2's connection format, through Picard Code's own OpenCode client. They cover live replies, saved
log entries, approvals, questions, folder boundaries, browser request
protection, safe text rendering, and the desktop layout. They do not claim
to have called a real model or executed a shell command. Speech tests use an
artificial browser microphone and simulated speakers, with an explicitly separate speech test service
to check automatic turns, follow-up context, listening during playback,
deliberate approvals, and separate stopping controls. They also use silent
stand-in sound files to check that each computer sound plays once at the right
moment, never while listening, and not for answers to questions or cancelled work.

If Playwright reports a missing browser, run `npx playwright install chromium`
and repeat the browser checks.

## Real service checks

Build first. Confirm a current-generation model with
`npm run opencode -- models` before choosing a model for a check.
Never change the owner's saved model or speech choices to run a check.
Some checks need model downloads, a signed-in provider or paid Azure services.
Report exactly what ran and what could not run.

```sh
npm run test:live
npm run test:speech:live
npm run test:speech:local
npm run test:conversation:live
npm.cmd run test:conversation:live -- --local --model provider/model
npm.cmd run test:conversation:live -- --local --interrupt --model provider/model
npm.cmd run test:conversation:live -- --local --quiet-interrupt --model provider/model
npm.cmd run test:crew:live -- --model provider/model
npm.cmd run test:behavior:live -- --model provider/model
```

The `npm.cmd` examples are for Windows. On macOS or Linux, use `npm`.
Replace `provider/model` with an available current-generation model.

### OpenCode connection

`test:live` starts **real OpenCode**, checks its health, project folder, saved
log entry, live updates, and approval/question requests, then removes its
own check log entry and shuts its server down. It does not make a paid model
request. A real model reply needs a signed-in provider.

### Listening and speaking

`test:speech:live` makes small, chargeable requests to the configured **real
Azure** services. It synthesizes an original short test phrase and sends the
generated audio through MAI's live listening connection, checking both final
words and live word updates. It does not capture your microphone or call
an AI model.

`test:speech:local` performs real CPU Kokoro synthesis and Nemotron recognition. It feeds audio
at microphone pace, checks live Nemotron words before commit, names and
negations, and listening/speaking cancellation followed by fresh listening.
It also asks the real Smart Turn worker to distinguish a complete request
from an unfinished one, cancels a prediction and checks a fresh prediction.
It saves an original sample under `.picard-voice/samples` and neither reads
nor changes saved speech choices. These short examples do not establish
general recognition or pause-detection accuracy. Generated speech does not
test a physical microphone.

### Complete spoken requests and replies

`test:conversation:live` checks the complete real MAI browser path using
generated microphone audio, OpenCode, a real model from your signed-in provider, saved
messages, live text updates, and real spoken playback. `--local` checks the
same path with Nemotron and Kokoro. Both explicitly confirm
their test model using a throwaway settings file.
Add `--model provider/model` to choose a particular available model for the
check. This does not change your saved Picard Code model or speech choices.
Both paths exercise the real local completion model through the browser's
captured audio and confirm that a pause was checked before submission.
Prepare speech first as described in [Natural pauses](../README.md#natural-pauses).
Add `--interrupt` to play a generated request into the browser's capture path
while a real spoken answer is playing. It checks that playback stops, the
new request keeps its name and negation, and no stop-work request is sent.
This tests overlapping speech, not a physical microphone or speaker echo.
Use `--quiet-interrupt` instead to check a softer request spoken while an
answer is playing. The voice detector decides by how speech sounds, not by
volume alone, so softer speech can still start listening.
These checks make real model requests;
the MAI variant also makes chargeable Azure requests. Earlier versions of both
passed on the Windows development machine before the OpenCode 2 migration;
those results do not verify the current version. They remove their own check log entries and
save screenshots and generated audio in the ignored samples folder.

### Bridge crew

`test:crew:live` checks real officer replies and a few measurable voice
habits (no exclamation marks, Data without contractions, Worf brief), "Make it
so" carrying out an officer's own proposal, an unclear "Make it so" answered
with a request for clarification, a quick fact, an explanation and a piece of
writing kept by the computer, requests needing an officer's judgment handed to
the right officer without naming them (including misheard names), and real
briefings with real officer calls and Number One calling officers when
explicitly asked to organise their work. It also checks that a ban on tools
or officer calls is respected and Worf does not know a hypothetical
post-death event, even when asked to use later archives. It cannot judge whether an
officer sounds right; that needs you. Add `-- --show-replies` to print the six
generated officer replies for review. The check makes model requests, may incur
provider charges, and never answers an approval itself.
The check requires an explicit model choice and does not change your saved choice.

### Follow-ups and approvals

`test:behavior:live` holds a six-turn log entry with a real model from your signed-in
provider through Picard Code's own local interface, in a temporary project
outside this repository. It checks a short investigation, a follow-up, a
correction, "show me", OpenCode's real question with a spoken-style answer,
and a refused command approval that must not run. It writes the full exchange
to `.picard-voice/samples/behavior-transcript.md`. Model wording varies; the
check verifies behavior, not exact words.
The check requires an explicit model choice and does not change your saved choice.
