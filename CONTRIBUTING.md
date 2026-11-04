# Help shape the computer

Picard Code is an unofficial tribute to Sir Patrick Stewart and Captain
Jean-Luc Picard. You speak to an original ship-computer-style interface, and
OpenCode does the coding. Contributions are welcome, including ideas, tests,
research, and documentation, not just code.

## Where help matters most

**The computer's character.** Help it give calm, concise, useful spoken answers,
understand follow-ups and corrections, pronounce technical names, and choose
comfortable timing. The user is Captain Picard; the computer says "Captain"
occasionally, not in every reply. Use original examples, not show dialogue.
Character should come from precision and delivery, not repeated catchphrases
or invented ship status.

**More listening and speaking models.** Add independently selectable services,
especially local options. Explain installation, model licenses, hardware needs,
data destinations, and charges. Cancellation and service errors must work;
never switch silently to another service. See `src/server/speech-types.ts`,
`src/server/speech.ts`, and the existing Azure, Nemotron and Kokoro
implementations. Nemotron is the local listener. Saved Whisper installations
upgrade automatically, saving only after the replacement starts successfully;
keep their speaking choice and old downloaded files. Other service changes
need an explicit choice. Azure speech stays under Advanced setup.

Other useful contributions:

- Accessible desktop controls: keyboard use, screen readers, readable text,
  reduced motion, and clear listening states.
- Real microphone testing beyond the owner's own Windows and macOS setups:
  other accents, quiet speech, echo, headphones, room noise, pauses,
  "Computer", follow-ups, and returning to standing by.
- Linux installation and troubleshooting; Windows and macOS are in regular use.
- Reliable startup, shutdown, reconnection, and listening/playback transitions.
- Measured improvements in response time and local resource use.

## Keep the spirit

Read [AGENTS.md](AGENTS.md), the single source of development rules, before
changing code. [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) describe the
experience. The app is voice-only and designed for a computer screen:
typed requests, a phone app, and unrelated general-assistant features are
outside the current direction.

Use plain English and the TNG terms listed in AGENTS.md: Captain's log,
log entry, Stardate, and Standing by. Keep exact errors and the user's words.
The computer must not claim something happened before the result arrives.
Do not add copied franchise artwork, recordings, show dialogue, or performer
voice cloning.

Keep secrets, personal conversations, downloaded models, and local settings
out of changes, screenshots, and reports. Use original generated test phrases
or samples you have permission to share. Do not submit recordings of other
people without their informed permission.

## Start with an idea or a small task

Look at [help wanted issues](https://github.com/sbroenne/picard-code/labels/help%20wanted)
and [good first issues](https://github.com/sbroenne/picard-code/labels/good%20first%20issue).
Use the character or speech proposal form for a new direction; use
[Discussions](https://github.com/sbroenne/picard-code/discussions) for open-ended
ideas and questions. Discuss a large change before investing in it. A feature
request is not a promise that it will be accepted.

For bugs, include reproduction steps, expected and actual behavior, operating
system, browser, and selected services. Do not post keys, temporary launch
addresses, or private project files. Use [SECURITY.md](SECURITY.md) for
sensitive security reports.

## Make and check a change

Fork the repository, create a branch, and follow
[Run from source](README.md#run-from-source). Use your own OpenCode sign-in and speech resources.
OpenCode 2 is required; `npm install` brings the tested copy.

Dependency installs use the npm registry already configured on your computer.
Keep the project's `.npmrc` setting `omit-lockfile-registry-resolved=true`:
it leaves registry download addresses out of `package-lock.json`, while
keeping exact versions and integrity checks. Update the lockfile with npm,
not by deleting fields by hand, and preserve source addresses for dependencies
that do not come from a registry. Do not change personal or global npm settings
to work around an installation failure. After dependency changes, run `npm ci`.
Vite and its compatible Rolldown override are pinned to versions available
through the approved feed; check both compatibility and download availability
before updating them.

Before each commit, choose the checks that match the change.
For changes only to documentation, the project website (`site/`),
development-only tools (`tools/`), or `browser-tests/site.spec.ts`, run:

```sh
npx playwright test browser-tests/site.spec.ts
```

This checks desktop and phone layouts and documentation links without building
or testing the app. For tool code changes, also run the checks that cover the
changed tool. Tools are not shipped with the app and do not need the full app
checks unless the change also touches app code, shared dependencies, setup
scripts or check configuration. Release note text can accompany these changes.

For app code, dependencies, setup scripts, check configuration, or any other
files, run the full checks:

```sh
npm run check
npm run build
npm test
npx playwright test
```

Changes to the changed-file rules also need
`node --test .github/scripts/check-scope.test.mjs`.
GitHub follows the same split; manual runs always use full checks.
See [AGENTS.md](AGENTS.md#checks) for the rules.

If Chromium is missing, run `npx playwright install chromium`. Windows users
should use `npm.cmd` for commands with `--` arguments.

These checks use a test stand-in for OpenCode and generated audio. When changing
models, speech, or conversation behavior, also run the matching real checks in
README. They can require your own sign-in,
model downloads, or paid Azure/model requests. Report exactly what ran and what
could not; never submit credentials to CI.

Keep changes focused and update related documentation. In a pull request,
explain the user-facing difference and the checks you ran.
Screenshots of stand-ins must be labeled. New speech services need license,
data-flow, setup, error, and cancellation documentation. To change an
officer's voice, or add voices from a new speech service, measure them with
`tools/voice-match` as described in
[docs/research/bridge-crew-voices.md](docs/research/bridge-crew-voices.md#speaking-voices).

### Release notes

If people using Picard Code will notice your change, add a release note: run
`npx changeset`, choose **patch**, and write one or two plain sentences about
what changed for them. Commit the new file in `.changeset/` with your change.
**Minor** is kept for a major redesign the maintainer chooses; never choose
**major**. Changes only to tests, checks or contributor docs need no note.
The release notes link your pull request and thank you by name.

## Review and AI assistance

Copilot and other coding tools are welcome. Read their changes yourself and
take responsibility for correctness, licenses, and honest evidence. Copilot
review helps find problems; it does not replace maintainer judgment.

The maintainer reviews pull requests with the [Ponytail](https://github.com/DietrichGebert/ponytail)
review skill in `.github/skills/ponytail-review`. It checks that a change is
correct, safe, tested, and no bigger than it needs to be. Copilot code review
on GitHub can use it. If your coding tool reads skills, ask it for a
`ponytail-review` of your branch before opening the pull request.
The maintainer decides what fits the project and merges manually.

Once a week, the Code Simplifier (`.github/workflows/code-simplifier.md`, from
the public [Agentics](https://github.com/githubnext/agentics) library) reads
the code merged in the past week. It may open one small draft pull request
titled `[code-simplifier]`. It must not change anything users see or hear,
and it leaves speech, conversation, crew, tribute and safety code alone.
Review it like any other pull request. Unmerged ones close after a week; the
generated `agentics-maintenance.yml` workflow checks for them every day. The
Code Simplifier needs two repository secrets: `COPILOT_GITHUB_TOKEN` for the
AI, and `GH_AW_CI_TRIGGER_TOKEN` so its pull requests start the required
checks. To change it, edit the `.md` file and run `gh aw compile` to
regenerate the matching `.lock.yml` and the maintenance workflow;
`gh aw update` brings in changes from the library.

## Project website

The static homepage is in `site/`, separate from the app in `web/`.
Maintain setup and contribution details here in the repository, linking to
them from the homepage. Do not add microphone access, model connections,
analytics scripts, or private project content to the website.

The normal browser suite checks the site at desktop and phone widths under
GitHub Pages' project path. The app itself remains desktop-only.
After a build, regenerate the interface screenshot on macOS/Linux with
`PICARD_SITE_CAPTURE=1 npx playwright test browser-tests/voice.spec.ts --grep "everyday answer"`.
On Windows, set `$env:PICARD_SITE_CAPTURE = "1"` in PowerShell and run
`npx.cmd playwright test browser-tests/voice.spec.ts --grep "everyday answer"`,
then remove the environment variable with
`Remove-Item Env:PICARD_SITE_CAPTURE`.
Review the image before committing it.

Pages deploys only `site/`, after each change to it reaches `main`.

GitHub checks run without personal model or Azure credentials. Copilot's cloud
setup installs development tools, not speech models. The optional Copilot app
configuration must be reviewed before trusting it; it does not automatically
assign issues or enable remote control.

Contributions are made under the project's [MIT license](LICENSE).
Third-party dependencies and models keep their own terms; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Please follow our [code of conduct](CODE_OF_CONDUCT.md).
