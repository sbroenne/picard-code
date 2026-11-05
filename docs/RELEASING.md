# Publishing Picard Code

Steps only the owner can take. Coding agents never publish.

## Repository settings

The repository is public. These settings are in place; keep them when
changing others:

- **Pages** builds from GitHub Actions and publishes `site/` to
  <https://sbroenne.github.io/picard-code/>, also set as the website address.
- **Code security:** private vulnerability reporting, Dependabot alerts and
  security updates, secret scanning with push protection, and CodeQL default
  setup.
- **Protect main** (Settings → Rules): changes need a pull request, squash
  merges only, no force pushes or deletion. These **Project checks** must
  pass: **Types and browser checks** and the three **Server and package**
  checks (ubuntu-latest, windows-latest, macos-latest). Copilot reviews each
  pull request once it is ready, using the Ponytail skill.
- **Actions** may only use GitHub's own actions, pinned to exact versions.
  **Allow GitHub Actions to create and approve pull requests** (Settings →
  Actions → General) is on, so the release pull request can be opened.

## Publishing to npm

The README tells people to run `npx picard-code`. Only the owner publishes;
coding agents never do.

1. **First version, by hand.** npm only lets GitHub publish a package that
   already exists. On an up-to-date `main`, run `npm login`, then
   `npm publish`. Publishing builds the package first and includes only what
   `files` in `package.json` lists. Then check from an empty folder that
   `npx picard-code --help` works.
2. **Let GitHub publish later versions.** On npmjs.com, open the package's
   **Settings → Trusted publishing**, choose **GitHub Actions**, and enter
   owner `sbroenne`, repository `picard-code`, workflow `release.yml` and
   environment `npm`. Under **Allowed actions**, leave only
   `npm stage publish`; npm advises against letting it publish directly or
   change dist-tags. In GitHub **Settings → Environments**, create the `npm`
   environment and, under **Deployment branches and tags**, allow only the
   tag rule `v*`. No npm token is stored anywhere.
3. **Each later version.** Version numbers follow the Enterprise-D's
   registry, NCC-1701-D: `1701.4.x`, where 4 stands for D. Normal releases
   raise only the last number (`1701.4.0`, `1701.4.1`, …). Keep `1701.5.0`,
   the Enterprise-E, for a major redesign; never raise the first number.
   Pull requests bring their release notes as small files in `.changeset/`
   (see [CONTRIBUTING.md](../CONTRIBUTING.md#release-notes)).
   1. While notes wait, the **Prepare release** workflow keeps a pull request
      **Release 1701.4.x** open. It raises `version` (a patch note gives
      `1701.4.1`, a minor note `1701.5.0`), writes the notes into
      `CHANGELOG.md` with a link to each pull request (and thanks for other
      contributors), and removes the used notes. The repository's GitHub App
      pushes the release branch and creates or updates the pull request.
      These App-authenticated changes start the normal **Project checks**
      and **Dependency review** pull-request workflows. No check results are
      copied to another commit, and no duplicate manual workflows are started.
      When those checks pass, read the notes, approve the pull request if GitHub requires
      it for automated changes, and merge it when you want to release.
      Release preparation reuses `GH_AW_APP_CLIENT_ID` and
      `GH_AW_APP_PRIVATE_KEY`, the repository App already used by the Code
      Simplifier (see [its setup](../CONTRIBUTING.md#review-and-ai-assistance)).
      Its short-lived token is limited to this repository, with Contents and
      Pull requests write access, and is revoked when the job finishes.
      Package installation and release-note preparation happen before that
      token is created. Missing App settings fail preparation; there is no
      fallback to GitHub's workflow token and no stored personal token.
      Other release workflows still use GitHub's own token.
   2. The merge starts the **Create release** workflow. It creates the GitHub
      release `v<version>` with the same notes, then starts **Publish to npm**
      on that tag. If the release exists but publishing did not start, run
      `gh workflow run release.yml --ref v<version>`.
   3. **Publish to npm** checks that the tag matches and that
      `CHANGELOG.md` has notes for it, runs the checks, and stages the version
      on npm with provenance (a public record that GitHub built it from this
      repository). Staged versions are not public yet. Approve it on
      npmjs.com, or run `npm stage list` and then `npm stage approve <id>`;
      npm asks for your second sign-in step. Then check from an empty folder
      that `npx picard-code@1701.4.1 --help` works.

## The launch video and YouTube channel

The short video is on the [Picard Code channel](https://www.youtube.com/@PicardCode)
at <https://youtu.be/_OKnpwS9dOI>, linked from the website and README.

The refreshed intro leaves first-run setup for a separate guide. It records
the actual app: Data investigates an original release-board example without
editing, then Geordi repairs it and runs the original checks. The browser
shows the real corrected result. Requests use a prepared stock Kokoro voice
through the real browser microphone path, not a physical microphone. Replies,
file changes, and check results come from real OpenCode and speech services.
Waiting is visibly shortened; the short edit excerpts Data's report.
It contains no downloaded show sounds.

Follow [Record the actual app](../tools/README.md#record-the-actual-app)
to record and render it with separate demo settings, without changing the
owner's saved choices. `tools/record-intro.mjs` captures the original project,
timestamps, actual browser playback, and check evidence.
`tools/render-intro.mjs` makes the edit, captions, and proposed YouTube wording.
Generated media stays in the ignored `video/out/real-intro-*` folder.
Review the entire video and caption alignment before uploading.

The earlier still-image composition remains in `video/index.html`, a
[HyperFrames](https://github.com/heygen-com/hyperframes) composition;
`video/assets/` and `video/out/` are ignored by git. Generated media is
not committed, including any older renders containing the TrekCore startup
call. To reproduce that earlier composition (needs ffmpeg and an existing local Kokoro setup;
do not change saved speech choices to render it):

1. Capture the screens and spoken text from the labeled test stand-in:
   `npm run build`, then
   `PICARD_SITE_CAPTURE=1 npx playwright test browser-tests/voice.spec.ts --grep "everyday answer|website example" --workers=1`.
2. Make the voice lines with the local Kokoro voices (stock voices only, never
   an imitation of a real actor):
   `~/.picard-code/voice/bin/python3 video/speak.py`.
3. Run `node --test video/captions.test.mjs`, then `node video/captions.mjs`.
   This checks the measured clip lengths against the composition and prepares
   SRT and top-positioned VTT captions in `video/out/`, plus a captioned
   composition in `video/assets/captioned.html`. If the words or
   voices change, update the composition's clip starts and durations from
   `video/assets/lengths.json` first. Timings within each clip are estimated:
   listen and adjust the caption cues before publishing.
4. From inside `video/`, run `npx hyperframes@0.8.226 lint`, then
   `npx hyperframes@0.8.226 render --output out/picard-code.mp4 --fps 24 --workers 2 --no-best-effort`.
   Review frames with
   `npx hyperframes@0.8.226 snapshot --at 5,20,29,41,57,65,74,85 --output out/review`.
   The plain video has no burned-in captions. For a version with captions
   above the interface, run
   `npx hyperframes@0.8.226 render --composition assets/captioned.html --output out/picard-code-captioned.mp4 --fps 24 --workers 2 --no-best-effort`.
5. Render the thumbnail from inside `video/` with
   `npx hyperframes@0.8.226 render --composition thumbnail.html --output out/thumbnail.mp4 --fps 1 --workers 1`.
   Extract its image with
   `ffmpeg -i out/thumbnail.mp4 -frames:v 1 -update 1 -y ../site/assets/video.png`
   and review it.

YouTube needs a 1280×720 thumbnail (also kept as `site/assets/video.png`, the
clickable video picture on the website), an 800×800 channel picture (the logo
from `site/assets/mark.svg`) and a 2560×1440 channel banner. Keep the banner's
words inside the centre 1546×423, which is all that phones show. The video description lists what the app uses,
explains the prepared project, generated requests, real replies and edits,
and says the voices are stock Kokoro voices,
and ends with the same unofficial-tribute and
trademark lines as the website. An end screen needs a second video or a
playlist, so add one when there is more than one video.

The new video needs a new YouTube upload. Publication needs the owner's
explicit approval. Keep the existing public URL until the new video is
published, then update the website, README, this guide and the website check
with its actual URL. GitHub Pages deploys the website after its changes merge
to `main`; generating or committing media locally does not update the live site.

## Older checkouts

Older checkouts kept speech in `.picard-voice` and sounds in `.picard-sounds`
inside the repository. Picard Code no longer reads those: run
`npm run setup:speech` again, then delete the old folders. Sounds download by
themselves at the next start.
