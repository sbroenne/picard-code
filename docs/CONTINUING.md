# Continuing on another computer

How to pick up Picard Code on a new Windows, macOS or Linux computer, check
that it works, and what is still open. The [README](../README.md) has the full
details for each step; [AGENTS.md](../AGENTS.md) has the rules for changes.

## 1. Get the code and build it

You need Node.js **22.12 or newer**, Git,
[uv](https://docs.astral.sh/uv/getting-started/installation/) for local
speech, and about 650 MB of free disk space for the speech models.

```sh
git clone https://github.com/sbroenne/picard-code.git
cd picard-code
npm install
npm run setup:speech
npm run build
npm test
```

`npm run setup:speech` downloads the Whisper and Kokoro models (about 432 MB)
into the ignored `.picard-voice` folder. Each computer needs its own download;
do not copy the folder between computers.

Picard Code uses OpenCode 2 (the `@opencode/cli` package); `npm install`
brings the tested copy. If npm asks to approve OpenCode's setup script, review
it, then run `npm install-scripts approve @opencode/cli` and
`npm rebuild @opencode/cli`.

Dependabot does not upgrade OpenCode. To upgrade it, change its version in
`package.json`, run `npm install`, review and approve the new setup script with
the two commands above, then run the real checks in step 5.

## 2. Sign in to a model provider through OpenCode

Picard Code works with any provider OpenCode supports. Each computer needs its
own sign-in. Run `npm run opencode -- auth login` and choose your provider. For
GitHub Copilot, approve the official GitHub device sign-in yourself with your
own account. Do not copy tokens from another computer.
`npm run opencode -- auth list` shows which providers are signed in. A sign-in made
with OpenCode 1 does not carry over; sign in again.

## 3. Choose speech

**Whisper and Kokoro on this computer (the default).** Nothing more to do
after `npm run setup:speech` in step 1: `npm start` listens and speaks
locally. Kokoro uses the British `bf_emma` voice by default. If you skipped
the download, choose the **Listen · Speak** tile and **Save and apply**; it
downloads in the background.

**Azure MAI (optional).** Install Azure CLI and run `az login`. Start
Picard Code, choose the **Listen · Speak** tile, choose **Azure, your own
resource**, and fill in the speech fields with your
subscription, resource group, resource name, region and live-listening
deployment, then choose **Save and apply**; no restart is needed. This saves
`speech.json` in the `.picard-code` folder in your home folder (on Windows,
`C:\Users\<you>\.picard-code`), as described in the README. The default voice is British Emily (`neutral` style). The file
holds no key; the key is read into memory at startup.

Either side can be chosen separately, for example
`npm start -- --listening whisper --speaking mai`.

## 4. Optional computer sounds

```sh
npm run setup:sounds
```

This downloads three short TrekCore sounds, checks them, and saves them in the
ignored `.picard-sounds` folder. They are never committed. See
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The app works without them.

## 5. Start and check

```sh
npm start
```

Then run the checks. The first four use test stand-ins; the rest use real
services, and most make real model requests (MAI checks also make small
Azure charges):

```sh
npm run check
npm run build
npm test
npx playwright install chromium   # first time only
npx playwright test
npm run test:live
npm run test:speech:live          # MAI only
npm run test:speech:local         # Whisper/Kokoro only
npm run test:conversation:live    # add -- --local for Whisper/Kokoro
npm run test:behavior:live
```

## What is verified, and what is still open

Earlier checks on the Windows development machine, before the OpenCode 2
migration, verified real OpenCode startup and
shutdown, Copilot conversations, live replies, approvals and questions; real
MAI listening and Emily speaking; real Whisper and Kokoro; full spoken
conversations on both speech paths using generated audio; a six-turn real
conversation check (follow-up, correction, "show me", a real question, a
refused command); and the sounds loading and playing at the right
moments in browser checks.

The OpenCode 2 migration passed types, build, server tests, and desktop browser
checks using stand-ins. Real model and Azure checks did not run in that change.
Do not treat the earlier results as verification of the current version.
Picard Code is now voice-only and desktop-focused. It starts listening when
speech is ready, needs "Computer" to begin a task, and accepts follow-ups
without that prefix. Standing by is not microphone off; with Azure listening,
detected speech can leave the computer before "Computer" is recognized.

Still open:

- A real conversation with a **physical microphone and speakers**: room noise,
  echo, pause length and sound volume.
- **macOS and Linux**: startup, shutdown and local speech are implemented but unchecked.
- The owner's **subjective review** of voice, timing and wording. British
  voices were chosen; final tuning has not been judged.
- Fresh real OpenCode 2, model, Azure, and local speech checks.
- Not planned yet: rewriting spoken requests into "captain style", interrupting
  the computer by speaking over it, and publishing `npx picard-code`.

## Making the repository public

Some GitHub features only work on a public repository. After making it public:

1. In **Settings → Pages**, choose **GitHub Actions** as the source, then run
   **Publish project website** once from the **Actions** tab. Set the
   repository's website address to `https://sbroenne.github.io/picard-code/`.
2. In **Settings → Code security**, turn on private vulnerability reporting,
   Dependabot alerts and security updates. The CodeQL and dependency review
   checks start running by themselves.
3. Protect `main` with a rule that requires the **Project checks** to pass.
4. Turn on automatic Copilot code review, so the Ponytail skill reviews each
   pull request.

Research and its evidence limits are in [docs/research](research/).
