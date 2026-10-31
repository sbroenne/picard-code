# Working on Picard Code

Rules for people and coding agents who change this repository. Read
[README.md](README.md) for what the app does and how to run it, and
[docs/CONTINUING.md](docs/CONTINUING.md) to set up another computer.

## What this is

A small local browser app. Spoken conversation is the main experience; typing
is a fallback. OpenCode does the coding through the user's own GitHub Copilot
sign-in. Azure MAI is the preferred listening and speaking service; local
Whisper listening and Kokoro speaking can be chosen instead, each side on its
own. It is an unofficial tribute to Patrick Stewart's Jean-Luc Picard with an
original TNG-inspired look.

- `src/server/`: local server, OpenCode connection, speech services, launcher.
- `src/shared/`: code used by both server and browser (spoken wording, question matching, messages).
- `web/`: the browser interface. `web/voice.ts` owns microphone, playback and computer sounds.
- `scripts/`: local speech worker and setup scripts, plus the optional sound download.
- `src/tests/` and `browser-tests/`: checks (see below).
- `docs/research/`: conversation and voice research, with its evidence limits.

## Rules that must hold

- **Plain English** in everything users or the owner read: interface text,
  errors, docs, issues and pull requests. Avoid jargon.
- **Never weaken approvals.** OpenCode's own permission rules decide what asks
  first. Do not add automatic approval, "always allow", voice approval, or
  remove deny rules. Approvals need a button.
- **Truthful results.** Never claim work succeeded, ran, or was heard before the
  real result arrives. Never replace a real error with a vague or themed message.
  No silent fallback from one speech service to another.
- **No secrets in the repository, logs, messages or the browser.** Azure keys
  are read into server memory at startup (`az login` or
  `PICARD_AZURE_SPEECH_KEY`). `.picard-speech.json` holds settings only.
- **Local only.** Services bind to `127.0.0.1`. Keep the host, origin, launch
  key and `x-picard-request` protections in `src/server/app.ts`.
- **Do not write into the user's project.** Picard Code supplies its own
  conversation instructions on every request (`src/server/instructions.ts`).
  It does not add files, skills or AGENTS.md to the folder being worked on.
  This file is only for developing Picard Code itself.
- **Keep the user's words.** Do not rewrite spoken requests into
  "captain style" before sending. Negations, exact names, limits and approval
  boundaries must survive unchanged.
- **No copied franchise material in the repository.** No show artwork,
  dialogue, voice cloning or recordings are committed. The four optional
  TrekCore sounds are downloaded by `npm run setup:sounds` into the ignored
  `.picard-sounds` folder, with the owner's confirmed permission; keep them out
  of git and keep their attribution in `THIRD_PARTY_NOTICES.md`.
- **Downloaded models, Python environments and samples stay out of git**
  (`.picard-voice`). Keep license notices for anything downloaded.

## How the computer talks

Conversation rules live in `src/server/instructions.ts` (sent to the model)
and `src/shared/speech.ts` (what is spoken aloud). Keep replies brief, precise
and neutral; acknowledge only when true; say clearly when information is not
available. Spoken answers are complete short sentences, with detail on screen.
Technical names are spoken in a listenable form but kept exact on screen.
Avoid repeated catchphrases such as "Working". The research in
`docs/research/` explains why, including which evidence is weak; do not cite
it as stronger than it is.

Computer sounds play once per real event, quietly, never while listening, and
never instead of the written or spoken explanation:

| Sound | When |
| --- | --- |
| `request-accepted` | A spoken request was accepted by OpenCode. |
| `processing` | Work is still running about 2.5 s later, with no answer, question or approval yet. |
| `input-failed` | Speech was not understood or could not be sent. |
| `request-failed` | An accepted request finally failed or was denied, just before the spoken result. |

## Checks

Run these before every commit (Windows: use `npm.cmd` when passing `--` options):

```sh
npm run check
npm run build
npm test
npx playwright test
```

The browser checks use a labeled test stand-in for OpenCode, a fake
microphone and silent stand-in sounds. They do not prove real services work.
When you change OpenCode, speech or conversation behavior, also run the
matching real check from the README (`test:live`, `test:speech:live`,
`test:speech:local`, `test:conversation:live`, `test:behavior:live`). Most of
these make real Copilot requests and some make small Azure charges. Report
plainly which real checks ran and which could not.

Still not checked anywhere: a physical microphone and speakers (room noise,
echo), macOS and Linux, and the owner's subjective review of voice and timing.

## Git

Commit to the working branch with a clear plain-English message. Do not force
push. Do not publish the npm package.
