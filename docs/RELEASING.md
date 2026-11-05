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

The new intro is a short TNG episode, first of all a tribute to Sir Patrick
Stewart and Captain Jean-Luc Picard. After the dedication, it says why Picard Code exists:
Captain Picard never typed. Around that is a real recording of the app: the
Captain hears one sentence each from Riker and Data, says "Make it so", and
the crew builds a small tribute site; Data runs the tests and reports, and
the finished entry appears in the Captain's log. Approvals are given before
recording, so none appear on screen. Replies, edits and check results come
from real OpenCode and speech services; only waiting is cut, and the whole
episode stays under 100 seconds. Follow
[Record the actual app](../tools/README.md#record-the-actual-app) to record,
build and render it with [HyperFrames](https://github.com/heygen-com/hyperframes)
0.9.15 in `video/`. The owner's TNG sound collection, the downloaded
computer sounds, footage and renders stay in ignored folders; credit the
sounds and music in the video description.

YouTube needs a 1280×720 thumbnail (also kept as `site/assets/video.png`, the
clickable video picture on the website), an 800×800 channel picture (the logo
from `site/assets/mark.svg`) and a 2560×1440 channel banner. Keep the banner's
words inside the centre 1546×423, which is all that phones show. The video description lists what the app uses,
explains the prepared project, generated requests, real replies and edits,
and says the voices are stock Kokoro voices,
and ends with the same unofficial-tribute and
trademark lines as the website. An end screen needs a second video or a
playlist; the episode's Shorts serve as the Watch next video.

[Make the YouTube pack](../tools/README.md#make-the-youtube-pack) prepares
the upload file, thumbnails, Shorts, captions, chapters, translated
descriptions and the upload settings for the owner to review. The episode is
published straight away, not as a Premiere.

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
