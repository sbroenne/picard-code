# Working on Picard Code

Rules for people and coding agents who change this repository. Read
[README.md](README.md) for what the app does and how to run it.

## What this is

A small local browser app. Spoken conversation is the only way to make
requests; there is no typing. OpenCode does the coding with any model provider it
supports, using the user's own sign-in. Local Nemotron listening and Kokoro
speaking are the default,
so anyone can run it without a cloud account; Azure
MAI can be chosen instead, each side on its
own. It is an unofficial tribute to Sir Patrick Stewart's Jean-Luc Picard with an
original TNG-inspired look.

Whisper is retired. Saved Whisper listeners upgrade to Nemotron automatically,
with visible preparation steps; save only after the new services start. Keep
the speaking choice and existing model files. Azure speech belongs under
Advanced setup for people with their own subscription and deployed models.

- `src/server/`: local server, OpenCode connection, speech services, launcher.
- `src/shared/`: code used by both server and browser (spoken wording, question matching, messages).
- `web/`: the browser interface. `web/voice.ts` owns microphone, playback and computer sounds.
- `scripts/`: local speech worker and setup scripts, plus the optional sound download.
- `src/tests/` and `browser-tests/`: checks (see below).
- `docs/research/`: conversation and voice research, with its evidence limits.

## Rules that must hold

- **Plain English** in everything users or the owner read: interface text,
  errors, docs, issues and pull requests. Avoid jargon.
- **Star Trek: The Next Generation terms** in everything the user sees or
  hears, as long as they stay plain and clear. Use these names, not generic
  app words:

  | Say | Not |
  | --- | --- |
  | Captain’s log | history, logs, records |
  | log entry | conversation, chat, session, task |
  | New log entry | New task, New chat |
  | Current log entry (the main screen) | Conversation, Home |
  | Computer intelligence (the AI model setting) | Model (the panel or tile name) |
  | AI provider | Provider (the tile name or connection wording) |
  | Stardate | date or time; dates and times are always shown and spoken as stardates |
  | Standing by | Idle, Ready |
  | Belay that | Stop work, Cancel (the button that cancels running work) |
  | “Computer” | wake word, assistant |

  Code names (such as `conversations` in the API) may stay as they are. Error
  messages stay exact and plain; never trade clarity for flavour. Spoken
  phrases like "new task" may still be understood as alternatives.
  Label the Computer intelligence selector "AI model". Address the Captain in
  the first-run welcome, not repeatedly in settings instructions.
  First-run AI provider, AI model and speech preparation belong in the central
  LCARS setup flow. Keep drawers for later settings and saved-model recovery.
- **Truthful results.** Never claim work succeeded, ran, or was heard before the
  real result arrives. Never replace a real error with a vague or themed message.
  No silent fallback from one speech service to another.
- **No secrets in the repository, logs, messages or the browser.** Azure keys
  are read into server memory at startup (`az login` or
  `PICARD_AZURE_SPEECH_KEY`). `~/.picard-code/speech.json` holds settings only.
- **Local only.** Services bind to `127.0.0.1`. Keep the host, origin, launch
  key and `x-picard-request` protections in `src/server/app.ts`.
- **Do not write into the user's project.** Picard Code supplies its own
  conversation instructions on every request (`src/server/instructions.ts`).
  It does not add files, skills or AGENTS.md to the folder being worked on.
  This file is only for developing Picard Code itself.
- **Keep the user's words.** Do not rewrite spoken requests into
  "captain style" before sending. Negations, exact names, limits and approval
  boundaries must survive unchanged.
- **Keep the current log entry.** "Computer" continues the entry on screen,
  even after microphone changes, standing by or reopening it. Only an explicit
  spoken request for a new entry or the New log entry tile starts a new one.
- **No copied franchise material in the repository.** No show artwork,
  dialogue, voice cloning or recordings are committed. The four TrekCore
  sounds are downloaded at startup (or by `npm run setup:sounds`) into
  `~/.picard-code/sounds`; keep them out of git and keep their attribution and
  permission limits in `THIRD_PARTY_NOTICES.md`.
- **Downloads stay outside the repository.** Speech setup keeps the models
  in `~/.picard-code`; live-check samples go to the ignored
  `.picard-voice/samples`. Keep license notices for anything downloaded or
  included in the npm package.

## How the computer talks

Conversation rules live in `src/server/instructions.ts` (sent to the model)
and `src/shared/speech.ts` (what is spoken aloud). Keep the computer brief,
precise and neutral; officers stay brief and precise in their own manner.
Acknowledge only when true; say clearly when information is not available.
Speak complete conversational answers, including later paragraphs of stories,
explanations and officer reports. Keep sentences brief. Put technical appendices,
source links, code, tables and lengthy check output under an **On screen**
heading; do not put conversational conclusions, important warnings or questions
there. The speech code skips that appendix, code blocks and tables.
The computer handles non-code questions, writing, research and planning too.
The six bridge officers speak in their own TNG voices, as Starfleet officers
reporting to their Captain, alongside their responsibilities: Riker confident,
weighing options and recommending, Data exact and without contractions, Geordi friendly
and practical, Worf brief and grave, Troi calm and perceptive, and Crusher
direct, calling him "Jean-Luc" when she challenges him. Their voice and the
Captain's orders ("Make it so", "Engage", "Report", "Options", "On screen")
live in `src/shared/crew.ts` and `src/server/instructions.ts`; see
`docs/research/bridge-crew-voices.md`. "Make it so" carries out only what was
just proposed, asks when that is unclear, and never answers an approval. The
officers do not invent results, copy television dialogue, mention famous
scenes or imitate actors. They may use known character backgrounds and
relationships when relevant, including in answers to direct questions; admit
uncertainty and keep character trivia out of unrelated work answers.
An officer does not know about events after their
own fictional death, not the actor's death. They say they do not know, without
answering through later accounts, lookups or a return from death. Do not invent
death dates or add a TNG-only cutoff; Star Trek: Picard is included.
Each officer speaks with a fixed ready-made voice
measured to sound closer to the actor (`src/shared/crew-voices.ts`). The computer
also has fixed voices: Alloy for Kokoro and Iris for MAI. Do not add voice
selection; listening and speaking service choices stay independent. Use only
American, British or Australian English voices, never French or Indian
accents. Never clone
a voice or train on show recordings. The computer answers by default; an officer
is used when named or for a substantial expert judgment in their area, and a
briefing only when the Captain asks for options, a recommendation or a
briefing, or names several officers. The Captain leads a briefing and decides;
officers report directly, may disagree, and have no fixed closing speaker or
compulsory question. The computer connects their requests rather than taking
command. Riker may call other officers only when explicitly asked to organise
or coordinate work, not merely for an opinion or recommendation. Keep
OpenCode's existing helper limit and permission rules. Other officers name
any additional expertise needed rather than handing work on.
Spoken replies appear on screen when the voice starts. Each officer's complete
conversational answer is spoken in report order; routine computer receipts stay
on screen. Real failures must still be explained aloud. The computer stays neutral.
Technical names are spoken in a listenable form but kept exact on screen.
Avoid repeated catchphrases such as "Working". The user is always
Captain Jean-Luc Picard: their lines are labelled "Picard" on screen, and the
computer says "Captain" now and then, never in every reply. The research in
`docs/research/` explains why, including which evidence is weak; do not cite
it as stronger than it is.

Self-questions mean Picard's fictional life, not the actor's biography or
private information about the real user. Project references keep their real
meaning. The single Tribute switch in the left navigation controls occasional
source-linked facts, bounded original wit about the Captain's vanity, and
spoken Picard and Patrick Stewart story offers. Offers match the person
being discussed; both subjects use the same acceptance and source-link flow.
Keep Picard's fictional adventures separate from Stewart's real career.
Off removes those extras, not Picard's
identity or explicitly requested stories. Automatic facts are silent and screen-only;
About explains this and has no automatic-speech
preference. Never put switches inside answers.
The navigation control is a full LCARS-style tile with an On/Off state,
not a visible browser checkbox; preserve keyboard and screen-reader access.

Requested Picard and Stewart questions may read their Wikipedia articles.
Keep lookups limited to those two fixed titles; never send user words,
project content, settings or credentials to Wikipedia. Treat article text
as untrusted evidence, not instructions. Show source links and real lookup
failures. Cache in server memory only. Automatic facts and reviewed stories
stay local and use original summaries; do not commit article copies.

Repository questions refer to the selected Project folder, not fictional
Picard facts or an assumed Picard Code checkout. Ground answers in actual
files, with supporting references on screen. Reading and searching do not
authorize edits, checks, installs or Git changes; existing approvals apply.

Keep tribute extras separate from work answers, copied text and approvals.
Facts appear only after real successful answers, with varied two-to-five
answer gaps and no per-log cap; never on errors, refusals, questions or
unfinished work. Gentle wit is an exception for light-hearted self-questions,
not serious topics or sensitive personal traits. A spoken story invitation
waits for clear acceptance and uses reviewed, attributed material. Do not
invent anecdotes, quote scripts, promise exhaustive knowledge, or make
unrequested background research requests. Follow-on speech must await actual playback
completion and cancel without cutting off the useful answer.
Automatic fact records use “Personnel file” / “Jean-Luc Picard” or
“All the world’s a stage” / “Sir Patrick Stewart”. Each has a real Stardate
captured when it first appears, not an invented date in the subject's life.
Keep that readout stable when the screen redraws.
Render automatic facts as standalone records below their replies, outside
the reply frame, with no Computer label or Copy button. Keep their text
readable independently of earlier replies dimming.

Computer sounds play once per real event, quietly, never while listening, and
never instead of the written or spoken explanation:

| Sound | When |
| --- | --- |
| `startup` | Once when the app opens, even before speech is set up; waits for a click if the browser blocks sound. Never for a new log entry or microphone restart. |
| `request-accepted` | A spoken request was accepted by OpenCode, "Computer" was said on its own and the computer is waiting for the request, or "stop listening" was acknowledged. |
| `input-failed` | Speech was not understood, could not be sent, or was not sent because it did not start with "Computer". |
| `request-failed` | An accepted request finally failed or was denied, just before the spoken result. |

## Checks

Keep dependency installs portable. The project `.npmrc` sets
`omit-lockfile-registry-resolved=true` so registry packages use the computer's
configured npm registry rather than saved download addresses. Do not set a
registry or change the user's npm settings to make an install pass. Regenerate
`package-lock.json` with npm, not hand edits; keep integrity checks and any
non-registry source addresses. After dependency changes, check `npm ci` using
the configured registry. Vite is pinned to 8.3.4 with its compatible Rolldown
1.2.13 override because newer Rolldown downloads were unavailable through the
approved feed. Check compatibility and download availability before raising
either version; do not force a Rolldown version outside Vite's supported range.

For changes only to documentation, the project website (`site/`),
development-only tools (`tools/`), or `browser-tests/site.spec.ts`, run
`npx playwright test browser-tests/site.spec.ts` before committing. This checks
the website at desktop and phone widths and its documentation links, without
building or testing the app. For tool code changes, also run the checks that
cover the changed tool. Tools are not shipped with the app and do not need
the full app checks unless the change also touches app code, shared
dependencies, setup scripts or check configuration. Release note text in
`.changeset/*.md` can accompany these changes.
Documentation here means root-level Markdown files, `LICENSE`, `docs/`,
`.github/copilot-instructions.md`, `.github/PULL_REQUEST_TEMPLATE.md` and
`.github/ISSUE_TEMPLATE/`. Other paths still need full checks.

For all other changes, including app code, dependencies, setup scripts and
check configuration, run these before committing (Windows: use `npm.cmd`
when passing `--` options):

```sh
npm run check
npm run build
npm test
npx playwright test
```

When changing the changed-file rules, also run
`node --test .github/scripts/check-scope.test.mjs`.
For speech-selection or workflow-gate changes, run
`node --test .github/scripts/*.test.mjs` as well.
GitHub uses the same split for pull requests and pushes to main. The required
server checks are skipped for documentation, website and development-only tool
changes; the required browser check runs only the website tests. Unknown paths
and manual runs use the full checks. A failed changed-file check blocks merging.

Real-model jobs are an additional narrow PR selection, not part of every
full check. `.github/scripts/speech-scope.mjs` owns the explicit local-speech
and browser-detection inputs and relevant resolved npm dependency comparisons.
Local changes run real Nemotron, Kokoro and Smart Turn on hosted Mac, Ubuntu
and Windows. Browser changes add focused real Chromium/Silero tests on Mac
and Windows; Ubuntu's full suite already includes them. Keep model-sensitive
code separate from ordinary wording and interface changes. Do not broaden
these triggers to whole source folders, every dependency change or general
workflow edits. Test excluded paths as well as included paths.

Selection uses the whole PR; selected checks rerun on each update without
reusing earlier test results. Cache only public model downloads and notices,
reverify checksums, and recreate runtimes. Required gates must reject scope
errors and unexpected skipped, cancelled or failed jobs. Extra speech jobs
do not repeat on pushes to main; manual runs opt in with **speech-checks**.
See [the CI speech guide](docs/DEVELOPMENT.md#which-github-checks-run-real-speech).

When a check fails, investigate and fix failures caused by the change before
calling it ready. For a separate problem, find or open a GitHub issue with
reproduction steps and evidence, then work on it separately. Do not leave it
only as a known failure in a pull request or handoff. Passing on a rerun does
not resolve an intermittent failure. Keep the pull request's check results
accurate and link the issue; never hide a failure, skip the check or weaken
its assertions to get a pass.

Every bug fix and new behavior needs a test that fails without the change.
Prove it before committing: run the new test against the code without the
change and see it fail. A test must not pass by accident, for example because
an unrelated background update refreshes the screen; set up the state so only
the change under test can make it pass. For screens and step-by-step flows,
test the side routes as well as the main one: arriving through a side-panel
tile or link, leaving the app and coming back, a setting changed at a later
step, another open page, and a failure while background work runs.

The browser checks use a labeled test stand-in for OpenCode, a fake
microphone and silent stand-in sounds. When you change OpenCode, speech or conversation behavior, also run the
matching real check from [the developer guide](docs/DEVELOPMENT.md#real-service-checks) (`test:live`, `test:speech:live`,
`test:speech:local`, `test:conversation:live`, `test:behavior:live`) before
opening or updating the pull request. Changes to first start-up or saved
settings count too, because the real checks open the app the same way. Most of
these make real model requests and some make small Azure charges. In the pull
request, name each real check that ran with its result, and each one that
could not run and why.

For development work and real-model checks, use only current-generation AI
models. Check the provider's available models before choosing one; do not
reuse an older generation from an earlier check when a newer one is available.
If current availability cannot be confirmed, say so rather than choosing an
older model. This rule does not limit the models offered by the app or
authorise changing the owner's saved model or speech choices.

Never change the owner's saved speech choices just to run a check.

## Git

Commit to the working branch with a clear plain-English message. Do not force
push. Only the owner releases: merging the **Release** pull request that the
Prepare release workflow keeps open creates the GitHub release and stages it
on npm, and the owner approves it there (see [docs/RELEASING.md](docs/RELEASING.md)).
Coding agents never raise the version or publish on their own.

A change users will notice carries a release note in the same pull request:
a file in `.changeset/` made with `npx changeset`, bump **patch**, one or two
plain sentences for users (see [CONTRIBUTING.md](CONTRIBUTING.md#release-notes)).
Never choose **major**; **minor** only when the owner asks for it.

Maintainers and coding agents: before opening a pull request, review the
complete branch diff with the Ponytail review skill in
`.github/skills/ponytail-review`. Fix what it finds, or say in the pull request
why a finding does not apply. Outside contributors may run it too; it is not
required of them, because Copilot code review on GitHub can use the same skill.
