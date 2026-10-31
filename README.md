# Picard Code

**A tribute to Sir Patrick Stewart and Captain Jean-Luc Picard.**

*With deepest respect and gratitude: Sir Patrick Stewart, 1940 – 2026.*

Picard Code lets you work the way the captain did: you speak, and the ship's
computer answers. Say "Computer", give the order, and it replies briefly and
calmly while the details appear on screen. You are always addressed as Captain
Picard; your lines are labeled "Picard", and the computer may sometimes call
you "Captain". There is no typing: like the captain, you speak to the computer.

It is unofficial and made with admiration: original artwork in the spirit of
the ship's displays, no franchise material, and no endorsement.

### How it works

A small local browser app. OpenCode does the coding through your own GitHub
Copilot sign-in and stores the conversations. Like the ship's computer, it
listens all the time and acts only on requests that start with "Computer".
Listening and speaking use your own Azure MAI resource, or Whisper and Kokoro
on this computer; each side can be chosen on its own.

## Run from source

You need Node.js **22.12 or newer**, GitHub Copilot access, and either the Azure
or local speech setup below for spoken conversation. The development
setup includes an official OpenCode 2 copy (the `@opencode/cli` package), so a
separate global OpenCode installation is optional when running from source.
OpenCode 1 is not supported.

```sh
npm install
npm run build
npm start
```

Your browser opens automatically. Keep the terminal open; press **Ctrl+C** to
stop Picard Code and the OpenCode server it started. Use `--no-open` to print
the address without opening a browser.

To choose a different project folder:

```sh
npm start -- --project "full path to your project"
```

Windows example:

```powershell
npm.cmd start -- --project "C:\Users\you\source\my-project"
```

macOS or Linux example:

```sh
npm start -- --project "$HOME/projects/my-project"
```

You can also change the folder in the **Settings** slide-out (side panel).
Stop running work first.
The folder is passed to OpenCode for every conversation and request.

**`npx picard-code` is not available yet.** This repository is private and the
package has not been published. The commands above are the supported launch
path for this version.

## Connect GitHub Copilot

Picard Code reuses a Copilot connection already authorized in OpenCode. It does
not copy credentials from `gh`, your browser, the Copilot app, or another tool.

If OpenCode is not connected:

1. In another terminal in this repository, run `npm run opencode -- auth login`
   (Windows: `npm.cmd run opencode -- auth login`; or `opencode auth login` if
   installed globally).
2. Choose **GitHub Copilot** from the list.
3. Open the official device sign-in address OpenCode shows. Check that GitHub
   is signed in to the account you want, then enter OpenCode's displayed code
   and approve the connection yourself.
4. Return to Picard Code, open **Settings** and choose **Refresh connection**.
   Pick one of the Copilot models OpenCode reports as available.

`npm run opencode -- auth list` shows whether GitHub Copilot is connected.

## The main screen and Settings

The main screen is only for the spoken conversation: the messages, any
question or approval waiting for you, and the computer console with one large
status (for example Standing by, Listening, Understanding, Working, Speaking
or Decision needed) and a line saying what to do next. The console also holds
**Stop speaking** and **Stop work** when they apply. There is no microphone
button: the row of lights beside the status shows listening, and clicking the
console switches listening back on after you stopped it. The latest request and reply are shown
large; earlier messages are smaller. The header shows only the name and the
tribute badge. Like the ship's computer, there are no conversation names or
modes on the main screen.

Everything else is hidden in slide-outs, opened from the side panel.
**Close** or the Escape key closes them. Picard Code is made for a computer
screen; there is no phone layout.

- **Logs** (`#records`): earlier conversations in the project folder (latest
  100). Choose one to reopen it.
- **Settings** (`#settings`): one page with tabs. **Copilot** has the
  connection steps and the model, **Project** the folder, **Voice** the
  listening and speaking services, and **About** the tribute. The tiles in the
  side panel open the matching tab: Copilot and Model open Copilot, Project
  opens Project, and Listen · Speak opens Voice. If Copilot is not connected
  when the app opens, Settings is shown first. Listening pauses while
  Settings is open. Speech changes apply without restarting.

For the requested personal setup, use your **sbroenne** GitHub account in the
official device sign-in. Picard Code does not independently verify the account
name; OpenCode owns the authorization.

Your account needs Copilot access, and organization policies may restrict the
available models or third-party apps. A successful `gh auth login` alone does
**not** authorize Copilot. No provider token or password is entered into this
interface. If a model rejects a request, Picard Code shows the error rather
than substituting another provider.

## Use it

- Listening starts by itself whenever the app opens; the browser asks for
  microphone access the first time. It stays off if you said "Computer, stop
  listening" (remembered) and while Settings is open. If the browser blocks
  sound until you interact, the screen says "Click anywhere to start listening."
- Say **"Computer, stop listening"** to switch the microphone off. Click the
  computer panel (the status and its lights) to listen again.
- The microphone stays on. While the room is quiet, the console shows
  **Standing by** and nothing leaves your computer. When someone starts
  talking, that speech (including the half second before it, so the first word
  is kept) goes to the selected listening service. A pause of about a second
  ends the turn.
- **Start every request with "Computer"**, for example "Computer, explain this
  project". Only those requests are sent to Copilot, with your words
  unchanged. Anything else is shown as "Not sent" and dropped. Saying
  "Computer" on its own plays the accepted sound and gives you about eight
  seconds to say the request.
- **"Computer, stop"** (or "cancel that", "belay that", "never mind") cancels
  the current work, the same as **Stop work**.
- There is one ongoing conversation. **"Computer, new task"** (or "start
  over", "new conversation") clears the screen, the same as the **New task**
  button; your next request starts a new log. Earlier conversations stay
  under **Logs**. Other requests made while work
  is running, a question is waiting, or a decision is needed get a short
  spoken reminder instead of being sent.
- The computer speaks a complete short answer, usually one to three
  sentences. Detailed code and results stay on screen. File names, settings
  and dates are spoken in a listenable form ("src slash app dot ts, line 3")
  while the screen keeps the exact text. Follow-ups, corrections and
  "show me" use the same conversation.
- Listening pauses while the computer speaks or plays a sound, so it cannot
  take its own voice as a new request. **Stop speaking** interrupts playback.
  Speaking over the computer does not interrupt it.
- When OpenCode asks a single question, the computer reads it aloud with its
  choices and listens for your answer; no "Computer" is needed for the answer.
  Say the option's name or, for example,
  "the second one". A reply containing "not" or "don't" is never taken as a
  choice, and when only the offered answers are allowed, anything else is
  asked again. **Skip question** on screen declines the question; OpenCode then
  stops the work, and the computer says so. Several questions at once are
  answered on screen.
- "Computer, stop listening" stops microphone capture without cancelling OpenCode's work.
  **Stop work** cancels the current OpenCode request. These are separate
  controls.
- **Optional computer sounds:** run `npm run setup:sounds` once to download four
  short TrekCore sounds (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)),
  then restart Picard Code. During spoken conversation they play quietly, once
  each: a beep when a spoken request is accepted, or when you say "Computer"
  on its own; a processing sound if the
  work is still running after about 2.5 seconds with no answer, question or
  approval request yet; an input-failed sound when speech was not understood
  or could not be sent; and a deny beep just before the spoken result when an
  accepted request finally fails or is denied. Answers to questions, **Stop work**, "Computer, stop" and "Computer, stop listening" play no sound.
  Listening is paused while a sound plays, and listening, speech,
  **Stop speaking** or stopping listening stop it. Each sound only accompanies the visible and
  spoken explanation; it never replaces it. Without the files, there are no
  sounds and nothing else changes.
- Replies update live. Tool activity and thinking can be expanded, and code
  blocks remain readable. **Copy** copies the reply text.
- **Allow once** or **Deny** answers an actual OpenCode approval request. There
  is no automatic approval or “always allow” shortcut, and approvals cannot be
  given by voice. **Deny** stops the work, and the computer says the action was
  not carried out.
- Questions from OpenCode can also be answered on screen. **Stop work** asks OpenCode to stop the current conversation.

**OpenCode's own rules decide what asks first.** Picard Code adds no rules of
its own and never answers an approval for you. Out of the box, OpenCode 2
changes files and runs commands **without asking**; only reading `.env` files
asks. To be asked before changes and commands, add rules to `opencode.json`
in your project or in OpenCode's global settings folder, for example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "shell", "resource": "*", "effect": "ask" },
    { "action": "edit", "resource": "*", "effect": "ask" }
  ]
}
```

Each effect is `allow`, `deny` or `ask`. See OpenCode's
[permission rules](https://opencode.ai/v2/docs/permissions/) for the other
actions, such as `subagent` for helpers and `webfetch` for web pages. Whatever
asks shows **Allow once** or **Deny** on screen; there is no automatic
approval, and Picard Code never starts OpenCode with its `--auto` option.
Installed extensions and agent configuration also matter.

The interface runs locally, but OpenCode sends messages and relevant project
content to GitHub Copilot. Because the microphone stays on, **MAI listening
sends any speech it hears to Azure** to find out whether it starts with
"Computer", even speech not meant for the computer; quiet room sound is not
sent. Only requests that start with "Computer" go to Copilot. MAI speaking
sends reply text to Azure. Whisper and Kokoro process their audio locally.
Even with both local speech services, coding still uses Copilot: this is not
an offline AI app. Say "Computer, stop listening" before conversations you do not want sent;
background speech can be misunderstood.

## Azure speech setup

This version uses **MAI-Transcribe-2-Streaming** for live listening and the
prebuilt British **Emily / MAI-Voice-2.1-Flash** voice with its **neutral**
style for speaking. The user chose British voices after a listening
comparison; this is a preference, not a recreation of the show's voice. Both
are preview services. It does not create a second AI assistant in Azure: coding stays
with OpenCode and GitHub Copilot.

Use an Azure AI resource in a supported region, such as Sweden Central.
Deploy MAI-Transcribe-2-Streaming through Azure's model catalog using
**GlobalStandard**, which charges for use rather than reserved capacity.
Check current model availability and your subscription's eligibility first.
The speaking voice uses the same resource and needs no voice cloning or
separate model deployment.

Azure speech always uses **your own** Azure subscription and resource. With
a GlobalStandard deployment, Azure may process the listening audio outside
your resource's region, for example outside Europe for a resource in Sweden.
Azure charges and any Visual Studio credit coverage depend on your
subscription; this app does not change spending limits or promise credits
cover the service.

The easiest way is the **Voice** tab in Settings. Choose the listening and
speaking services, fill in your resource (only the fields the chosen services
need are shown), and choose **Save and
apply**. The new speech setup starts right away, with no restart. If it cannot
start (for example a wrong region), the error is shown, the file is not
changed, and the speech setup that was working stays in use.

The page saves to `.picard-speech.json`. If that file exists in the folder you
launch from, that one is used; otherwise it lives in the Picard Code folder.
You can also write the file yourself, using your own resource's settings:

```json
{
  "subscription": "your-subscription-id",
  "resourceGroup": "your-resource-group",
  "resourceName": "your-ai-resource",
  "region": "swedencentral",
  "deployment": "your-live-listening-deployment",
  "voice": "en-GB-Emily:MAI-Voice-2.1-Flash",
  "voiceStyle": "neutral"
}
```

`voice` and `voiceStyle` are optional; the values above are the defaults.
Other prebuilt voices work too, for example
`en-US-Harper:MAI-Voice-2.1-Flash` or `en-GB-Harry:MAI-Voice-2.1-Flash`. A
saved `voice` is always used as written. Styles that worked in testing are
`neutral`, `agent`, `narrator` and `softvoice`; use `none` to send no style.
An unsupported voice or style is reported as an Azure error, not replaced.

This file is ignored by Git and contains **no key**. Install Azure CLI and
sign in using `az login` in your own terminal. Your Azure account must
already be allowed to read this resource's keys. Picard Code reads a key
into the local server's memory on startup, and again when you save speech
settings, using the specified subscription.
It does not change the CLI's default subscription or create access grants.
Alternatively, set `PICARD_AZURE_SPEECH_KEY` in the launch process's
environment using your own secure local setup. Never paste keys into chat,
browser addresses, or committed files.

The browser receives no Azure key or account credentials. Only microphone
audio and spoken playback cross its private local connection. Stopping listening,
changing conversation, closing the page, or shutting down
Picard Code stops the relevant listening connection. A speech failure leaves
the written conversation intact and reports what failed.

## Local Whisper and Kokoro setup

Local listening uses **faster-whisper** with the English `tiny.en` model.
Local speaking uses **kokoro-onnx**, the standard Kokoro model, and its original
prebuilt British `bf_emma` voice by default (`af_heart` and the other Kokoro
voices can be chosen with `kokoroVoice`). Both run on the CPU. No Azure resource, key, or login
is needed when both sides are local. Copilot authorization is still required.

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and make
Python **3.11** available. From the repository folder on Windows:

```powershell
uv venv --python 3.11 .picard-voice
uv pip install --python .picard-voice\Scripts\python.exe -r scripts\requirements-speech.txt
.\.picard-voice\Scripts\python.exe scripts\setup-local-speech.py
npm.cmd start -- --listening whisper --speaking kokoro
```

On macOS or Linux:

```sh
uv venv --python 3.11 .picard-voice
uv pip install --python .picard-voice/bin/python -r scripts/requirements-speech.txt
.picard-voice/bin/python scripts/setup-local-speech.py
npm start -- --listening whisper --speaking kokoro
```

Setup downloads roughly **432 MB** of model files, plus Python dependencies.
The Kokoro files are checked against published checksums; the public Whisper
download is fixed to a specific revision and uses no account token. Model
files, the Python environment, and generated samples remain in the ignored
`.picard-voice` folder. Inference uses local files only, with up to four CPU
threads per service. Do not use Python 3.14 for this setup.

Both paths use the same automatic listen/respond loop. Whisper starts
recognizing after the pause; unlike MAI, it does not display live words while
you are speaking. Stopping speech discards late audio and does not block the
separate listening worker. No service is silently replaced if setup fails.

On the checked Windows machine, real Kokoro speaking with `bf_emma` produced
**4.2 seconds of audio in 2.4 seconds**, and Whisper understood that audio in
**0.5 seconds**. Worker startup took **4.4 seconds**. These are short-phrase measurements, not
speed or accuracy promises for other machines. Longer turns and older CPUs
can take longer. This small English model can misunderstand accents and
technical terms; the understood request remains visible.

### Select either side independently

MAI remains the default when Azure settings are provided. Launch options
override the settings file:

```powershell
npm.cmd start -- --listening mai --speaking kokoro
npm.cmd start -- --listening whisper --speaking mai
```

For a local default, `.picard-speech.json` can contain just:

```json
{
  "listening": "whisper",
  "speaking": "kokoro"
}
```

For a mixed setup, keep the Azure resource settings and add `listening` and
`speaking`. Only MAI listening requires `deployment`. Optional local settings
are `localPython`, `whisperModel`, `kokoroModel`, `kokoroVoices`, and
`kokoroVoice`. The path settings are kept when you save from the Settings page,
but can only be changed in the file. File paths are resolved from the launch
folder; if launching outside this repository, use absolute local paths. Launch
options apply only until speech settings are saved from the page.

The shared interfaces are in `src/server/speech-types.ts`. A listener accepts
one channel of signed little-endian 16-bit audio at 16,000 samples per second,
reports understood words, and commits a turn on request. A speaker streams
the same audio format at 24,000 samples per second. Both receive a cancellation
signal; `close()` releases owned workers. Selection happens in
`src/server/speech.ts`, without changes to the browser's conversation controls.
See [third-party notices](THIRD_PARTY_NOTICES.md) before redistributing local
dependencies or downloaded models.

### The computer's manner

Picard Code sends its own conversation instructions with every request, as
OpenCode's per-request system instructions (`src/server/instructions.ts`).
It does not use an optional skill, and it never writes an `AGENTS.md` or
other rules file into your project, so your project's own development rules
stay as they are.

The instructions ask for a restrained ship-computer manner: a complete short
spoken answer first, details after it for the screen, short follow-ups
understood from context, one focused question when something is missing,
specific reasons when information is unavailable, and completion reports only
for work that actually happened. Stock phrases such as "Working" are not
repeated as catchphrases. Exact names, negations, limits and approvals in your
request are kept as you said them; your request is never rewritten.

This changes phrasing, not OpenCode's tools or approval rules. The voice is a
prebuilt voice, not a performer's clone or a show recording. The research
behind these choices, with its evidence limits, is in
[docs/research](docs/research/conversation-research.md).

## Reuse an existing OpenCode server

Reuse is explicit; Picard Code never assumes an unrelated server on port 4096
belongs to it. The server must be OpenCode 2. Start OpenCode bound to this
computer with a password. Set the
same password in the Picard Code terminal, then:

```sh
npm start -- --connect http://127.0.0.1:4096 --project "full project path"
```

In PowerShell, use `npm.cmd` for commands with `--` arguments. Some npm
PowerShell wrappers otherwise discard the argument separator. You can also
launch directly with `node dist/server/cli.js --project "full project path"`.

For example, in PowerShell, set `$env:OPENCODE_SERVER_PASSWORD` before running
`opencode serve --hostname 127.0.0.1 --port 4096` and before starting Picard Code
in its separate terminal. On macOS/Linux, use `export OPENCODE_SERVER_PASSWORD`.
Use a strong password; do not put it in the URL, shell history, or source files.
`OPENCODE_SERVER_USERNAME` defaults to `opencode` and can be set in both terminals.

Picard Code checks the server's health, password protection, and selected
folder. Only addresses on this computer are accepted. It leaves a reused
server running when Picard Code stops.

## Local protections

Both services started by Picard Code listen on `127.0.0.1`. OpenCode receives a random password
known only to the local launcher. The browser receives a separate launch
address; its temporary key establishes a private browser connection and is
then removed from the address bar.

Project data and work controls require that private browser connection. Requests
from other websites are rejected. Other websites
cannot use the interface to start work or read conversations. Provider
configuration and credentials are not sent to the browser. Model output is
displayed as text, never executed as HTML. These protections are not a barrier
against another program already running on your computer.

## Checks

```sh
npm run check
npm run build
npm test
npm run test:browser
npm run test:live
npm run test:speech:live
npm run test:speech:local
npm run test:conversation:live
npm.cmd run test:conversation:live -- --local
npm run test:behavior:live
```

The server and browser tests use a clearly labeled local test server that follows
OpenCode 2's connection format, through Picard Code's own OpenCode client. They cover live replies, saved
conversations, approvals, questions, folder boundaries, browser request
protection, safe text rendering, and the desktop layout. They do not claim
to have called Copilot or executed a shell command. Speech tests use an
artificial browser microphone and simulated speakers, with an explicitly separate speech test service
to check automatic turns, follow-up context, paused listening during playback,
deliberate approvals, and separate stopping controls. They also use silent
stand-in sound files to check that each computer sound plays once at the right
moment, never while listening, and not for answers to questions or cancelled work.

`test:live` starts **real OpenCode**, checks its health, project folder, saved
conversation, live updates, and approval/question requests, then removes its
own check conversation and shuts its server down. It does not make a paid model
request. A real reply from Copilot needs your own authorized account.

`test:speech:live` makes small, chargeable requests to the configured **real
Azure** services. It synthesizes an original short test phrase and sends the
generated audio through MAI's live listening connection, checking both final
words and live word updates. It does not capture your microphone or call
Copilot.

`test:speech:local` performs real CPU Kokoro synthesis and Whisper recognition,
checks speaking cancellation followed by fresh listening, and saves an
original sample under `.picard-voice/samples`.

`test:conversation:live` checks the complete real MAI browser path using
generated microphone audio, OpenCode, your authorized Copilot model, saved
messages, live text updates, and real spoken playback. `--local` checks the
same path with Whisper and Kokoro. These checks make real Copilot requests;
the MAI variant also makes chargeable Azure requests. Both passed on the
Windows development machine. They remove their own check conversations and
save screenshots and generated audio in the ignored samples folder.

`test:behavior:live` holds a six-turn conversation with your authorized Copilot
model through Picard Code's own local interface, in a temporary project
outside this repository. It checks a short investigation, a follow-up, a
correction, "show me", OpenCode's real question with a spoken-style answer,
and a refused command approval that must not run. It writes the full exchange
to `.picard-voice/samples/behavior-transcript.md`. Model wording varies; the
check verifies behavior, not exact words.

A check with your physical microphone and speakers is still needed
to judge room noise, listening sensitivity, comfortable pauses, and playback.
Quiet, very short words or a long pause inside a sentence may need a repeat.
Interrupting playback uses **Stop speaking**, not voice-over-voice detection.

If Playwright reports a missing browser, run `npx playwright install chromium`
and repeat the browser checks.

## If something goes wrong

- **Missing OpenCode:** install OpenCode 2 from
  [opencode.ai](https://opencode.ai/v2/docs/) or run `npm install` for the
  included development copy. Restart the terminal after a global installation.
- **npm blocks OpenCode's setup script:** the setup script picks the right
  OpenCode program for your computer. This repository already allows it in
  `package.json`. If npm still asks, review the official package, then use
  `npm install-scripts approve @opencode/cli` followed by
  `npm rebuild @opencode/cli`.
- **Browser cannot connect:** open the full launch address printed in the
  terminal, including its temporary key. It must use `127.0.0.1`, not a different
  hostname. Do not share that address.
- **Copilot is missing:** follow the official sign-in steps above, then refresh
  the connection while no work is running.
- **Live updates stop:** keep the terminal open. The browser reconnects and
  reloads saved messages and pending approvals. Use **Try again** if needed.
- **OpenCode cannot start:** run `npm run opencode` directly to see its setup
  problem. Picard Code does not replace a failed connection with a fake reply.
- **Unusual installation:** `PICARD_OPENCODE_PATH` can point to the real
  OpenCode program or its JavaScript starting file, but not a Windows `.cmd` shortcut.
- **Microphone will not start:** use a current browser at the printed local
  address, click the computer panel, allow microphone access,
  and check the input
  device. The selected speech setup and a connected Copilot model are required.
- **Azure rejects speech:** check resource access, the deployed live listening
  model, supported region and voice, and service quota. A speech error does
  not mean OpenCode stopped; use **Stop work** separately when needed.
- **Local speech will not start:** complete the Python setup and model download,
  check the configured paths, and choose **Save and apply** on the Settings
  page again (no restart needed). The reported error is not replaced
  with Azure or browser speech. Picard Code needs working speech; there is
  no typing fallback.

## References

Implemented against OpenCode **2.2.5** (`@opencode/cli`), talking directly to
the local server that `opencode serve` provides:

- [OpenCode 2 documentation](https://opencode.ai/v2/docs/)
- [Moving from OpenCode 1](https://opencode.ai/v2/docs/migrate-v1/)
- [Providers, including GitHub Copilot](https://opencode.ai/v2/docs/providers/)
- [Permission rules](https://opencode.ai/v2/docs/permissions/)
- [MAI live listening](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe-2-streaming-realtime)
- [MAI speaking voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-voices)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx)

Windows is checked on the development machine. App startup and shutdown are
implemented for macOS and Linux but still need checks on those systems. This first version
does not include file attachments, a full file editor, or package publication.

## Developing Picard Code

- [AGENTS.md](AGENTS.md): rules for people and coding agents changing this repository.
- [Continuing on another computer](docs/CONTINUING.md): setup, checks and open work.
- [Conversation research](docs/research/conversation-research.md) and
  [voice and conversation direction](docs/research/voice-and-conversation-direction.md).
