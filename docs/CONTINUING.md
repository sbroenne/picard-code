# Continuing on another computer

How to pick up Picard Code on a new Windows, macOS or Linux computer, check
that it works, and what is still open. The [README](../README.md) has the full
details for each step; [AGENTS.md](../AGENTS.md) has the rules for changes.

## 1. Get the code and build it

You need Node.js **22.12 or newer**, Git, and access to the private
`sbroenne/picard-code` repository.

```sh
git clone https://github.com/sbroenne/picard-code.git
cd picard-code
npm install
npm run build
npm test
```

Picard Code uses OpenCode 2 (the `@opencode/cli` package); `npm install`
brings the tested copy. If npm asks to approve OpenCode's setup script, review
it, then run `npm install-scripts approve @opencode/cli` and
`npm rebuild @opencode/cli`.

## 2. Sign in to a model provider through OpenCode

Picard Code works with any provider OpenCode supports. Each computer needs its
own sign-in. Run `npm run opencode -- auth login` and choose your provider. For
GitHub Copilot, approve the official GitHub device sign-in yourself with the
`sbroenne` account. Do not copy tokens from another computer.
`npm run opencode -- auth list` shows which providers are signed in. A sign-in made
with OpenCode 1 does not carry over; sign in again.

## 3. Choose speech

**Azure MAI (preferred).** Install Azure CLI and run `az login`. Start
Picard Code, open **Settings**, and fill in the Speech section with your
subscription, resource group, resource name, region and live-listening
deployment, then choose **Save and apply**; no restart is needed. This saves
`speech.json` in the `.picard-code` folder in your home folder (on Windows,
`C:\Users\<you>\.picard-code`), as described in the README. The default voice is British Emily (`neutral` style). The file
holds no key; the key is read into memory at startup.

**Local Whisper and Kokoro.** Install `uv`, then choose them in Speech
settings and **Save and apply** (or run `npm run setup:speech`). The first time
it downloads about 432 MB of models into the ignored
`.picard-voice` folder. Kokoro uses the British `bf_emma` voice by default.

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

Verified on the Windows development machine: real OpenCode startup and
shutdown, Copilot conversations, live replies, approvals and questions; real
MAI listening and Emily speaking; real Whisper and Kokoro; full spoken
conversations on both speech paths using generated audio; a six-turn real
conversation check (follow-up, correction, "show me", a real question, a
refused command); and the sounds loading and playing at the right
moments in browser checks.

Still open:

- A real conversation with a **physical microphone and speakers**: room noise,
  echo, pause length and sound volume.
- **macOS and Linux**: startup, shutdown and local speech are implemented but unchecked.
- The owner's **subjective review** of voice, timing and wording. British
  voices were chosen; final tuning has not been judged.
- Spoken interruption is implemented: say "Computer" during an answer, or click
  the computer panel. Echo cancellation and rejection of repeated answer words
  still need a physical microphone and speaker check. Interrupting playback
  does not cancel running work or answer approvals.
- Not planned yet: rewriting spoken requests into "captain style" and
  publishing `npx picard-code`.

Research and its evidence limits are in [docs/research](research/).
