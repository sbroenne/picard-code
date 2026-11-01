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
      contributors), and removes the used notes. A workflow opened the pull
      request, so GitHub holds its checks until you select **Approve
      workflows to run** on it, again after each update. When the checks
      pass, read the notes, approve the pull request (for the same reason it
      needs one approval), and merge it when you want to release.
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

The video is never committed: it contains the TrekCore startup call. Its
source is `video/index.html`, a [HyperFrames](https://github.com/heygen-com/hyperframes)
composition; `video/assets/` and `video/out/` are ignored by git. To make it
again (needs ffmpeg and `npm run setup:speech`):

1. Capture the screens and spoken text from the labeled test stand-in:
   `npm run build`, then
   `PICARD_SITE_CAPTURE=1 npx playwright test browser-tests/voice.spec.ts --grep "website example|stewart facts have LCARS" --project desktop`.
2. Make the voice lines with the local Kokoro voices (stock voices only, never
   an imitation of a real actor):
   `~/.picard-code/voice/bin/python3 video/speak.py`.
3. From inside `video/`, run `npx hyperframes@0.8.226 lint`, then
   `npx hyperframes@0.8.226 render --output out/picard-code.mp4`.

YouTube needs a 1280×720 thumbnail (also kept as `site/assets/video.png`, the
clickable video picture in the README and on the website), an 800×800 channel picture (the logo
from `site/assets/mark.svg`) and a 2560×1440 channel banner. Keep the banner's
words inside the centre 1546×423, which is all that phones show. The video description lists what the app uses,
says the voices are stock Kokoro voices and the startup sound comes from
TrekCore with permission, and ends with the same unofficial-tribute and
trademark lines as the website. An end screen needs a second video or a
playlist, so add one when there is more than one video.

## Older checkouts

Older checkouts kept speech in `.picard-voice` and sounds in `.picard-sounds`
inside the repository. Picard Code no longer reads those: run
`npm run setup:speech` again, then delete the old folders. Sounds download by
themselves at the next start.
