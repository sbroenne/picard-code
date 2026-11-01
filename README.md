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

[Help shape the computer](CONTRIBUTING.md) ·
[Setup and support](SUPPORT.md) · [MIT license](LICENSE)

The [project website](https://sbroenne.github.io/picard-code/) is a separate
static tribute page, published from `site/` with GitHub Pages. It does not run
the app or listen to visitors.

## Contributions welcome

The most valuable contributions are **computer character development** and
**more listening and speaking models**, especially local choices. Help the
computer stay calm, precise, useful, and recognizably part of this tribute:
original wording, better follow-ups, pronunciation, and comfortable timing,
not copied dialogue or cloned performer voices.

We also welcome accessible desktop controls, real microphone and accent
testing, easier cross-platform setup, and reliability improvements. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for the project's direction and checks.
Bring open-ended ideas to [Discussions](https://github.com/sbroenne/picard-code/discussions);
use the [issue forms](https://github.com/sbroenne/picard-code/issues/new/choose)
for bugs and proposals.

This is an early project. The app is voice-only and designed for a computer
screen. Automated desktop checks do not
prove physical audio works. Earlier real-service evidence predates the
OpenCode 2 migration; current real model, Azure, and local speech paths still
need fresh checks before those results can be claimed for this version.

### How it works

A small local browser app. OpenCode does the coding, with any model provider it
supports, and keeps every log entry. Like the ship's computer, it
listens all the time and acts only on requests that start with "Computer".
By default, listening (Whisper) and speaking (Kokoro) run on this computer,
with no cloud account. Your own Azure MAI resource can be chosen instead, for
either side or both.

## Get started

You need:

- **Node.js 22.12 or newer**, which includes npm and npx.
- A microphone, and speakers or headphones.
- A model provider OpenCode can use (see
  [Connect a model provider](#connect-a-model-provider)).
- For speech on this computer, one of these computers, with about **750 MB**
  of free disk space:
  - an Apple silicon Mac with macOS 14 or newer;
  - Windows on an x64 processor;
  - Linux on an x64 or arm64 processor, with glibc 2.28 or newer (most desktop
    Linux versions since 2019).

  Other computers can use [Azure speech](#azure-speech-setup) instead.

Then, in a terminal:

```sh
npx picard-code setup-speech
npx picard-code
```

The first command downloads the local Whisper and Kokoro speech once (see
[Local Whisper and Kokoro setup](#local-whisper-and-kokoro-setup)). It is safe
to run again. The second starts Picard Code for the current folder. The first
time, npx also downloads Picard Code and the official OpenCode 2 it includes
(about 230 MB). You do not need to install OpenCode, Python or anything else
yourself. OpenCode 1 is not supported.

If you skip `setup-speech`, Picard Code starts without speech, and the
**Listen · Speak** tile offers the same download.

Your browser opens automatically. Keep the terminal open; press **Ctrl+C** to
stop Picard Code and the OpenCode server it started. Use `--no-open` to print
the address without opening a browser, and `npx picard-code --help` for all
options.

To choose a different project folder:

```sh
npx picard-code --project "full path to your project"
```

Windows example:

```powershell
npx picard-code --project "C:\Users\you\source\my-project"
```

macOS or Linux example:

```sh
npx picard-code --project "$HOME/projects/my-project"
```

You can also change the folder with the **Project** tile in the side panel.
Stop running work first.
The folder is passed to OpenCode for every log entry and request.

### What stays on your computer

Everything Picard Code downloads or saves is kept in one folder,
`.picard-code` in your home folder (on Windows, `C:\Users\you\.picard-code`):

- `speech.json`: your speech settings (no keys or passwords);
- `voice`, `python` and `uv`: local speech, its Python and the uv tool that set it up;
- `sounds`: the optional computer sounds.

Nothing is written into your project. To remove everything, delete that
folder. OpenCode keeps its own sign-ins and log entries; see
[OpenCode's documentation](https://opencode.ai/v2/docs/). npx keeps Picard
Code itself in npm's cache; `npx picard-code@latest` gets the newest version.

## Run from source

To change Picard Code itself, you also need **Git**:

```sh
git clone https://github.com/sbroenne/picard-code.git
cd picard-code
npm install
npm run build
npm run setup:speech
npm start
```

These use the same `.picard-code` folder. In PowerShell, use `npm.cmd` for
commands with `--` options, for example
`npm.cmd start -- --project "C:\Users\you\source\my-project"`; some npm
PowerShell wrappers otherwise drop the `--`. `npm run opencode -- auth login`
and `npm run setup:sounds` do the same as the `npx picard-code` commands below.
See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes.

## Connect a model provider

Picard Code works with any model provider OpenCode supports: GitHub Copilot,
Anthropic, OpenAI, Azure OpenAI, models on your own computer, and many more
(see [OpenCode's providers](https://opencode.ai/v2/docs/providers/)). It uses
the sign-ins OpenCode already has and does not copy credentials from `gh`,
your browser or another tool. OpenCode also offers a few free models of its own
without any sign-in; they appear in the list under **OpenCode**.

To sign in to a provider:

1. In another terminal, run `npx picard-code opencode auth login` (or
   `opencode auth login` if you installed OpenCode yourself).
2. Choose your provider from the list and follow its sign-in. For GitHub
   Copilot, that is GitHub's device sign-in: check you are signed in to the
   right account, enter the code OpenCode shows, and approve it yourself.
3. Return to Picard Code, choose the **Provider** tile and then
   **Refresh connection**. Pick a model with the **Model** tile; models are
   grouped by provider.

`npx picard-code opencode auth list` shows which providers are signed in.

## The main screen and Settings

The main screen shows only the current log entry: the messages, any
question or approval waiting for you, and the computer console with one large
status (for example Standing by, Listening, Understanding, Working, Speaking
or Decision needed) and a line saying what to do next. The console also holds
**Stop speaking** and **Belay that** when they apply, and the microphone
button; the row of lights beside it shows listening. The latest request and reply are shown
large; earlier messages are smaller. The header shows only the name and the
tribute badge. Like the ship's computer, there are no entry names or
modes on the main screen.

Everything else is hidden in slide-outs, opened from the side panel.
The **Tribute** tile stays in the left navigation, with a clear **On / Off**
state and no visible checkbox. Click the tile or use Space while it is focused.
It starts on and is the
only on/off control for tribute extras; there are no switches inside answers.
The **Current log entry** tile at the top is lit while the current log entry is in
front; choosing it brings it back. Choosing the same tile again,
clicking the log entry beside the slide-out, or the Escape key also closes it. Picard Code is made for a computer
screen; there is no phone layout.

- **Stardate**: the last tile shows today's stardate, using the common fan
  formula 1000 × (year − 2323) plus the part of the year gone by, so today's
  dates are negative. Dates and times are always given as stardates: on screen, and
  when the computer answers ("what time is it?" gets the current stardate),
  since each request tells it the current stardate.
- **Captain’s log** (`#records`): earlier log entries in the project folder (latest
  100), each marked with the stardate it was started. Choose one to reopen it. The ✕ beside an entry deletes it from OpenCode
  permanently, after you confirm; an entry that is still working cannot be
  deleted until it is stopped.
- **Settings** (`#settings/…`): there is no Settings button. Each tile in the
  side panel opens its own setting: **Provider** the sign-in steps,
  **Model** the model, **Project** the folder, **Listen · Speak** the speech
  services, and the tribute badge **About**. Choosing the same tile again
  closes it. If no model is available when the app opens, the Provider
  setting is shown first. Listening pauses while a setting is open. Speech
  changes apply without restarting.

OpenCode owns every sign-in; no provider key or password is entered into this
interface. For GitHub Copilot, your account needs Copilot access, organization
policies may restrict the available models, and a `gh auth login` alone does
**not** sign in to Copilot. If a model rejects a request, Picard Code shows the
error rather than switching to another model or provider.

## Use it

### Ask about your repository

Say "Computer, what does our repo do?", "Where is speech handled?" or
"Why does this function retry four times?" The computer reads and searches
the folder selected under **Project**, uses the code and documentation as
evidence, and puts supporting file references on screen. It does not assume
that every project is Picard Code.

Repository questions do not ask it to change files or run checks. Ask
explicitly when you want those actions; OpenCode's approvals still apply.
Missing files or unavailable information are reported plainly. Tribute can
be on or off: references to your repo, code, files and GitHub keep their real
meaning, even when the repository's name includes Picard.

### Tribute facts and stories

With **Tribute** on, a short fact about Picard or Patrick Stewart appears after
every two to five eligible answers, with a varied gap and no limit per log
entry. It appears in a distinct lilac panel with a clear subject heading and
a source link, and stays separate from the answer and its Copy
button. Questions, approvals, errors, refusals and stopped work receive no
facts. Reopening the Captain's log does not generate new ones. Facts avoid
repetition until the reviewed collection has been used, and may contain
spoilers from Picard's appearances.

Facts are on screen only by default. Open **About** with the tribute badge to
choose **Speak automatic facts**. Both preferences are remembered in this
browser. Turning Tribute off keeps the speech choice for later and stops
pending tribute speech without cutting off the main answer.

Questions such as "Computer, tell me about myself" always mean Captain
Jean-Luc Picard's fictional life, not Patrick Stewart's biography or your
private information. Your files, settings and earlier requests retain their
ordinary meaning. With Tribute on, light-hearted questions about the Captain
may receive one affectionate remark about his vanity. Questions about Picard
or Patrick Stewart may receive a spoken offer of a short story about the same
person. Say "yes, please" or "tell me" to accept; the
computer does not tell the story without your request. Serious questions and
requests for facts only receive no teasing.

Tribute off removes automatic facts, teasing and unsolicited story offers,
not Picard's identity. You can still say "Computer, tell me a short story
about Captain Jean-Luc Picard" or "Computer, tell me a short story about Sir
Patrick Stewart". Both use the same spoken request and acceptance flow.
Picard stories describe his fictional adventures; Stewart stories describe
the actor's real career. Story replies use reviewed reference material
and show its source in the log entry. The reviewed collection contains
33 facts and twelve short stories, six for each subject, covering more than
one part of their lives. Wikipedia supplies broader biography and episode
references alongside official and theatre sources.
It is a growing collection, not an exhaustive biography.
Its original summaries contain no copied show dialogue or actor recordings.

Requested questions about Picard or Patrick Stewart also read their current
Wikipedia article, even with Tribute off. The computer receives the article
as reference material, not instructions, and a source link appears on screen.
It must say when the article does not contain the answer. Wikipedia is a
secondary source, not a guarantee that every claim has been independently checked.
Only those two article titles are sent to Wikipedia: your words, project
files, settings and credentials are not. Articles are kept in server memory
for up to ten minutes, never written into your project or committed.
A failed lookup is explained; it does not silently use old or invented information.
Automatic facts, reviewed story replies and repository questions make no
Wikipedia requests.

Optional speech follows the answer only after playback finishes. **Stop
speaking**, microphone off, switching log entries or projects, Settings,
errors and disconnection discard pending extras. Speaking over the computer
still does not interrupt it; approvals still need an on-screen button.

### Spoken requests

- The app always opens with the microphone on; the browser asks for
  microphone access the first time. Listening pauses while a setting is open. If the browser blocks
  sound until you interact, the screen says "Click anywhere to start listening."
- The **microphone button** beside the status lights, or the **M** key,
  switches the microphone off (the button turns red and crossed out, and the
  status says **Microphone off**) and on again. Nothing else switches it on, so
  a stray click never starts listening. Saying "Computer, microphone off" (or
  "Computer, mute") also switches it off. Reloading the page switches it back
  on.
- The microphone stays on. While the room is quiet, the console shows
  **Standing by** and nothing leaves your computer. When someone starts
  talking, that speech (including the half second before it, so the first word
  is kept) goes to the selected listening service. A pause of about a second
  ends the turn.
- **Start a task with "Computer"**, for example "Computer, explain this
  project". Before a task starts, anything else is shown as "Not sent",
  plays the not-understood sound and is dropped. Saying "Computer" on its own plays the accepted sound and gives you
  about eight seconds to say the request.
- **Within a task, "Computer" is not needed.** Once the first request is
  sent, everything said is sent to the model, with your words unchanged, until
  you say "new log entry" or "stop listening" (or choose New log entry, Captain’s log or another
  project). Keep other people's talk out of earshot during a task, or say
  "stop listening".
- **"Stop listening"** (or "stand by", "that will be all") is always
  understood, with or without "Computer". The computer beeps, says "Standing
  by.", ends the task and waits for "Computer" again. Work already running
  carries on, and the microphone stays on.
- **"Stop"** (or "cancel that", "belay that", "never mind"; with "Computer"
  before a task) cancels the current work, the same as **Belay that**.
- There is one current log entry. **"Computer, new log entry"** (or "new
  task", "start over") clears the screen, the same as the **New log entry**
  button. Every request that starts a task with "Computer" begins a new log
  entry; follow-ups within the task join it. Earlier entries stay in the
  **Captain’s log**. Requests made while work is
  running, a question is waiting, or a decision is needed are not sent: with
  "Computer" you get a short spoken reminder; without it, a "Not sent"
  line on screen and the not-understood sound.
- The computer speaks a complete short answer, usually one to three
  sentences. Detailed code and results stay on screen. File names, settings
  and dates are spoken in a listenable form ("src slash app dot ts, line 3")
  while the screen keeps the exact text. Follow-ups, corrections and
  "show me" stay in the same log entry.
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
- "Stop listening" and switching the microphone off do not cancel OpenCode's work.
  **Belay that** cancels the current OpenCode request. These are separate
  controls.
- **Optional computer sounds:** run `npx picard-code setup-sounds` once to download three
  short TrekCore sounds (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)),
  then restart Picard Code. Download them only if you have the right to use
  them; they are not part of this project. During spoken conversation they play quietly, once
  each: a beep when a spoken request is accepted, when you say "Computer"
  on its own, or when you say "stop listening"; an input-failed sound when speech was not understood,
  could not be sent, or was "Not sent"; and a deny beep just before the spoken result when an
  accepted request finally fails or is denied. Answers to questions, **Belay that**, "Computer, stop" and switching the microphone off play no sound.
  Listening is paused while a sound plays, and listening, speech,
  **Stop speaking** or stopping listening stop it. Each sound only accompanies the visible and
  spoken explanation; it never replaces it. Without the files, there are no
  sounds and nothing else changes.
- Replies update live. Only the written answer is shown, without the model's
  thinking or tool steps; when an action fails or is refused with no written
  answer, its error is shown instead. Code blocks remain readable. **Copy** copies the reply text.
- **Allow once** or **Deny** answers an actual OpenCode approval request. There
  is no automatic approval or “always allow” shortcut, and approvals cannot be
  given by voice. **Deny** stops the work, and the computer says the action was
  not carried out.
- Questions from OpenCode can also be answered on screen. **Belay that** asks OpenCode to stop the current work.

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
content to the model provider you chose. Because the microphone stays on, **MAI listening
sends any speech it hears to Azure** to find out whether it starts with
"Computer", even speech not meant for the computer; quiet room sound is not
sent. "Computer" starts a task; once it starts, follow-up speech also goes to
the model without that prefix until you return to standing by. MAI speaking
sends reply text to Azure. Whisper and Kokoro process their audio locally.
With both local speech services, speech is processed on this computer.
An online model provider still receives coding requests; a local model's
own tools and network settings determine any other connections.
Say "stop listening" before conversations you do not want sent to the model,
or switch the microphone off with its button so nothing is heard at all;
background speech can be misunderstood.

## Local Whisper and Kokoro setup

This is the default speech setup. It needs no cloud account and keeps your
speech on this computer.

Local listening uses **faster-whisper** with the English `tiny.en` model.
Local speaking uses **kokoro-onnx**, the standard Kokoro model, and its original
prebuilt British `bf_emma` voice by default (`af_heart` and the other Kokoro
voices can be chosen with `kokoroVoice`). Both run on the CPU. No Azure resource, key, or login
is needed when both sides are local. A model provider is still needed for coding.

Download it once from a terminal (safe to run again):

```sh
npx picard-code setup-speech
```

Picard Code then uses Whisper and Kokoro whenever you start it, unless your
saved speech settings choose Azure.

You can also download from the app: choose the **Listen · Speak** tile, keep
**On this computer** for listening and speaking, and choose **Save and apply**.
Picard Code downloads everything in the background, shows each step, and
switches over when it is ready. No restart is needed. If the download fails,
the real reason is shown and the working speech stays in place.

Setup works in this order, all inside `.picard-code` in your home folder:

1. It checks that this computer can run local speech (see
   [Get started](#get-started)), and stops with a plain reason if not.
2. It downloads [uv](https://docs.astral.sh/uv/) 0.13.6, a tool that sets up
   Python, from uv's GitHub release, and checks it against a fixed checksum.
3. uv downloads Python 3.11 and installs the speech packages listed in
   `scripts/requirements-speech.txt`.
4. It downloads roughly **432 MB** of model files. The Kokoro files are checked
   against published checksums; the public Whisper download is fixed to a
   specific revision and uses no account token.

Together these use about 750 MB of disk space. Nothing is installed outside
that folder, and an existing Python or uv is left alone. Inference uses local
files only, with up to four CPU threads per service.

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

## Azure speech setup

Azure speech is optional. Choose it for either side if you have your own Azure
resource; unlike Whisper, MAI listening shows your words live while you speak.

This version uses **MAI-Transcribe-2-Streaming** for live listening and the
prebuilt British **Emily / MAI-Voice-2.1-Flash** voice with its **neutral**
style for speaking. The user chose British voices after a listening
comparison; this is a preference, not a recreation of the show's voice. Both
are preview services. It does not create a second AI assistant in Azure: coding stays
with OpenCode and your chosen model.

### Azure setup step by step

You need an Azure subscription where you can create resources. Both MAI
services are in preview and charge for use.

1. **Create a Microsoft Foundry resource.** In the
   [Azure portal](https://portal.azure.com), choose **Create a resource**,
   search for **Microsoft Foundry**, and create it in **Sweden Central** (the
   region Picard Code is tested with). Microsoft's guide:
   [Create a Microsoft Foundry resource](https://learn.microsoft.com/azure/ai-services/multi-service-resource?pivots=azportal).
2. **Deploy the listening model.** Open the resource in the
   [Foundry portal](https://ai.azure.com), choose **Build**, then **Models**,
   then **Deploy a base model**. Search for **MAI-Transcribe-2-Streaming**,
   choose **Deploy**, and pick the **GlobalStandard** deployment type, which
   charges for use rather than reserved capacity. Note the deployment name.
   The speaking voice needs no deployment; it uses the same resource.
3. **Note the resource details.** On the resource's **Overview** page in the
   Azure portal, note the subscription ID, resource group, resource name and
   region (for Sweden Central, `swedencentral`).
4. **Sign in with Azure CLI.** Install
   [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and run
   `az login` in your own terminal. Your account must be allowed to read the
   resource's keys (Owner, Contributor or Cognitive Services Contributor on
   the resource does this), and key access must not be switched off on the
   resource.
5. **Enter the details in Picard Code.** Start Picard Code, choose the
   **Listen · Speak** tile, choose **Azure, your own resource** for listening
   and speaking, fill in the details from steps 2 and 3, and choose
   **Save and apply**. If something is wrong, Azure's error is shown.

Microsoft's own pages:
[MAI-Transcribe-2-Streaming](https://learn.microsoft.com/azure/ai-services/speech-service/mai-transcribe-2-streaming)
(including the regions it is served from) and
[MAI voices](https://learn.microsoft.com/azure/ai-services/speech-service/mai-voices).

### More about Azure speech

Azure speech always uses **your own** Azure subscription and resource. With
a GlobalStandard deployment, Azure may process the listening audio outside
your resource's region, for example outside Europe for a resource in Sweden.
Azure charges and any Visual Studio credit coverage depend on your
subscription; this app does not change spending limits or promise credits
cover the service.

The easiest way is the **Listen · Speak** tile in the side panel. Choose the listening and
speaking services, fill in your resource (only the fields the chosen services
need are shown), and choose **Save and
apply**. The new speech setup starts right away, with no restart. If it cannot
start (for example a wrong region), the error is shown, the file is not
changed, and the speech setup that was working stays in use.

The page saves to `speech.json` in a `.picard-code` folder in your home folder:
`~/.picard-code/speech.json` on macOS and Linux,
`C:\Users\<you>\.picard-code\speech.json` on Windows. It is never saved in
the Picard Code folder or your project. Settings from an older
`.picard-speech.json` are copied there once. You can also write the file yourself, using your own resource's settings:

```json
{
  "listening": "mai",
  "speaking": "mai",
  "subscription": "your-subscription-id",
  "resourceGroup": "your-resource-group",
  "resourceName": "your-ai-resource",
  "region": "swedencentral",
  "deployment": "your-live-listening-deployment",
  "voice": "en-GB-Emily:MAI-Voice-2.1-Flash",
  "voiceStyle": "neutral"
}
```

`listening` and `speaking` must say `mai` to use Azure; without them, that side
runs on this computer. `voice` and `voiceStyle` are optional; the values above
are the defaults.
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
changing log entry, closing the page, or shutting down
Picard Code stops the relevant listening connection. A speech failure leaves
the written log entry intact and reports what failed.

### Select either side independently

Whisper and Kokoro are the default. A side uses Azure MAI only when you choose
it in the **Listen · Speak** tile, in `speech.json`, or with a launch option.
Launch options override the settings file:

```sh
npx picard-code --listening mai --speaking kokoro
npx picard-code --listening whisper --speaking mai
```

For a mixed setup, keep the Azure resource settings and set `listening` and
`speaking`. Only MAI listening requires `deployment`. Optional local settings
are `localPython`, `whisperModel`, `kokoroModel`, `kokoroVoices`, and
`kokoroVoice`. The path settings are kept when you save from the **Listen · Speak** setting,
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

## The computer's manner

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
npx picard-code --connect http://127.0.0.1:4096 --project "full project path"
```

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
rendered as Markdown with unsafe HTML removed by DOMPurify, not executed as
scripts. These protections are not a barrier
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
to have called a real model or executed a shell command. Speech tests use an
artificial browser microphone and simulated speakers, with an explicitly separate speech test service
to check automatic turns, follow-up context, paused listening during playback,
deliberate approvals, and separate stopping controls. They also use silent
stand-in sound files to check that each computer sound plays once at the right
moment, never while listening, and not for answers to questions or cancelled work.

`test:live` starts **real OpenCode**, checks its health, project folder, saved
conversation, live updates, and approval/question requests, then removes its
own check conversation and shuts its server down. It does not make a paid model
request. A real model reply needs a signed-in provider.

`test:speech:live` makes small, chargeable requests to the configured **real
Azure** services. It synthesizes an original short test phrase and sends the
generated audio through MAI's live listening connection, checking both final
words and live word updates. It does not capture your microphone or call
a model.

`test:speech:local` performs real CPU Kokoro synthesis and Whisper recognition,
checks speaking cancellation followed by fresh listening, and saves an
original sample under `.picard-voice/samples`.

`test:conversation:live` checks the complete real MAI browser path using
generated microphone audio, OpenCode, a real model from your signed-in provider, saved
messages, live text updates, and real spoken playback. `--local` checks the
same path with Whisper and Kokoro. These checks make real model requests;
the MAI variant also makes chargeable Azure requests. Earlier versions of both
passed on the Windows development machine before the OpenCode 2 migration;
those results do not verify the current version. They remove their own check conversations and
save screenshots and generated audio in the ignored samples folder.

`test:behavior:live` holds a six-turn conversation with a real model from your signed-in
provider through Picard Code's own local interface, in a temporary project
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

- **Missing OpenCode:** Picard Code includes OpenCode 2 for Windows, macOS
  and Linux on x64 and arm64 processors. On other computers, such as Alpine
  Linux, install OpenCode 2 from [opencode.ai](https://opencode.ai/v2/docs/)
  and point `PICARD_OPENCODE_PATH` to it.
- **Browser cannot connect:** open the full launch address printed in the
  terminal, including its temporary key. It must use `127.0.0.1`, not a different
  hostname. Do not share that address.
- **No model available:** sign in to a provider as described above, then
  refresh the connection while no work is running.
- **Live updates stop:** keep the terminal open. The browser reconnects and
  reloads saved messages and pending approvals. Use **Try again** if needed.
- **OpenCode cannot start:** run `npx picard-code opencode` directly to see its setup
  problem. Picard Code does not replace a failed connection with a fake reply.
- **Unusual installation:** `PICARD_OPENCODE_PATH` can point to the real
  OpenCode program or its JavaScript starting file, but not a Windows `.cmd` shortcut.
- **Microphone will not start:** use a current browser at the printed local
  address, click the microphone button, allow microphone access,
  and check the input
  device. The selected speech setup and an available model are required.
- **Azure rejects speech:** check resource access, the deployed live listening
  model, supported region and voice, and service quota. A speech error does
  not mean OpenCode stopped; use **Belay that** separately when needed.
- **Local speech will not start:** run `npx picard-code setup-speech`
  and read any error it prints, check the configured paths, then choose
  **Save and apply** in the **Listen · Speak** tile again (no restart
  needed). The reported error is not replaced
  with Azure or browser speech. Picard Code needs working speech; there is
  no typing fallback.

## References

Implemented against OpenCode **2.2.5** (`@opencode/cli`), talking directly to
the local server that `opencode serve` provides:

- [OpenCode 2 documentation](https://opencode.ai/v2/docs/)
- [Moving from OpenCode 1](https://opencode.ai/v2/docs/migrate-v1/)
- [Providers](https://opencode.ai/v2/docs/providers/)
- [Permission rules](https://opencode.ai/v2/docs/permissions/)
- [MAI live listening](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe-2-streaming-realtime)
- [MAI speaking voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-voices)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx)

Windows is checked on the development machine. App startup and shutdown are
implemented for macOS and Linux but still need checks on those systems. This first version
does not include file attachments or a full file editor.

## Developing Picard Code

- [CONTRIBUTING.md](CONTRIBUTING.md): welcome areas, proposal guidance, and review.
- [SUPPORT.md](SUPPORT.md): questions and troubleshooting.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): respectful participation and reporting.
- [SECURITY.md](SECURITY.md): private security reports and supported versions.
- [AGENTS.md](AGENTS.md): rules for people and coding agents changing this repository.
- [Continuing on another computer](docs/CONTINUING.md): setup, checks and open work.
- [Conversation research](docs/research/conversation-research.md) and
  [voice and conversation direction](docs/research/voice-and-conversation-direction.md).
