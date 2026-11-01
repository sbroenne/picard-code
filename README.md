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

The computer handles general questions, writing, research and planning as well
as code. A project folder is context for project work, not a limit on what you
can ask.

### How it works

A small local browser app. OpenCode does the coding, with any model provider it
supports, and keeps every log entry. Like the ship's computer, it
listens all the time and acts only on requests that start with "Computer".
Listening and speaking use your own Azure MAI resource, or Whisper and Kokoro
on this computer; each side can be chosen on its own.

## Run from source

You need Node.js **22.12 or newer**, a model provider OpenCode can use, and either the Azure
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

You can also change the folder with the **Project** tile in the side panel.
Stop running work first.
The folder is passed to OpenCode for every log entry and request.

**`npx picard-code` is not available yet.** This repository is private and the
package has not been published. The commands above are the supported launch
path for this version.

## Bridge crew

You remain Captain Picard. Six OpenCode officers bring different expertise:
Riker weighs options and recommends, Data investigates, Geordi builds and
repairs, Worf reviews risks, Troi reviews clarity and usability, and Crusher
checks software health and recovery. The computer remains a separate interface.

Each officer speaks in their own TNG voice, as a Starfleet officer reporting to
the Captain: Riker is confident and gives firm recommendations, Data is exact
and never uses contractions, Geordi is friendly and practical, Worf uses few,
grave words, Troi is calm and asks gentle questions, and Crusher is direct and
may call you "Jean-Luc" when she disagrees. They say "Captain" or "sir", and
"Aye, sir." only when actually carrying out an order. There is no copied
dialogue, no famous scenes or running jokes, and no actor voice imitation. They
can contribute to non-code work too; the computer keeps its restrained, neutral
manner. [docs/research/bridge-crew-voices.md](docs/research/bridge-crew-voices.md)
explains the choices and their evidence limits.

Start with **Computer**, as before. Officers answer to their bridge names:
"Number One" or "Will", "Mr. Data", "Mr. La Forge" or "Geordi", "Mr. Worf",
"Counselor" or "Deanna", "Doctor" or "Beverly". For example:

- "Computer, Data, explain this project."
- "Computer, ask Geordi to investigate this failure. Do not change any files."
- "Computer, Number One, should we split this change in two?"
- "Computer, Worf and Data, review this change."
- "Computer, Counselor, review this invitation for clarity."
- "Computer, help me plan a visit to a museum."

The computer and the officers also understand the Captain's orders:

- **"Make it so"** (or "proceed") carries out exactly what was just proposed in
  that log entry, and nothing more. After an officer's proposal, it goes back to
  that officer. If nothing was proposed, or it is unclear which proposal you
  mean, you are asked one short question.
- **"Engage"** starts the agreed work now.
- **"Report"** gives what is done, under way and failed; **"Options"** gives two
  or three choices with a recommendation first; **"On screen"** shows it on screen.

When a question from OpenCode is waiting with exactly one plain yes answer
(such as "Yes" or "Proceed"), saying "Make it so" or "Engage" chooses it.
Approvals are never answered by voice, including by these orders.

You do not have to name an officer. When you don't, Picard Code first asks the
selected model, in a quick separate check, who should handle the request, and
then hands it over itself. This check adds nothing to the log entry, usually
takes a second or two, and makes one small extra model request. If it fails,
the request is not sent and the real error is shown. Each officer has an area,
and everyday work outside code belongs to it too:

- Riker: plans, decisions, options and recommendations.
- Data: research, news, history, science and explanations.
- Geordi: building, fixing, setting things up and investigating failures.
- Worf: security, safety, privacy and risks.
- Troi: writing, clarity and usability, and questions about people and feelings.
- Crusher: health, wellbeing, reliability and recovery.

The computer keeps only quick facts it can give in a sentence, small talk,
questions about Picard Code itself, and questions about the Captain or Sir
Patrick Stewart. A request in one officer's area goes to that officer, who
answers you directly in the log entry, just as if you had named them. A request
that needs several officers becomes a briefing, run by the computer. The check
also recognises common mishearings, such as "Rika" for Riker or "Walt" for
Worf, and sends a follow-up such as "Make it so" back to the officer who just
answered.

An explicit officer address at the start always selects that officer directly,
without the check; mentioning Data or saying "do not ask Data" does not.

A briefing works as it does on the bridge. The computer calls each officer the
work needs, usually two or three, never the whole crew by default. Each officer
reports to you directly, and at most one of them may change files. If you want
a recommendation, Riker weighs their findings and recommends one course. The
computer then gives each officer's main finding in a sentence, followed by
Riker's recommendation, and you decide; "Make it so" carries out that
recommendation. Each officer's full report stays on screen; if the computer
only copies a report word for word, the copy is not shown and the report itself
is spoken. Officers do not hand work to each other. When one needs a
colleague, they name the officer and you can call them. Each officer called
makes an extra model request and can increase cost.

Reports are labelled by officer inside the same Current log entry; there is no
separate crew display. Related approvals and questions appear there too, naming
the officer. Approvals still require
**Allow once** or **Deny** on screen. **Belay that** asks OpenCode to stop both
the main entry and its related crew work. Running crew work also prevents
deleting that entry or changing projects.

The **Bridge crew** switch in the left navigation brings the officers on or off
duty, and is remembered in this browser. When it is off, the computer answers
every request itself, including requests that name an officer and follow-ups
in an officer's log entry. Work already running continues until it finishes or
you say **Belay that**. If the crew cannot be loaded (see below), the computer
also answers everything itself, and naming an officer reports why.

Everyone uses the selected model and the existing speech service and voice.
Only the answering officer's final answer or the computer's brief briefing
summary is spoken; background reports stay on screen. There are no actor imitations,
lasting shared crew memory or automatic issue watching.

When Picard Code starts its own OpenCode server, it loads the crew from a
temporary settings folder outside your project and removes that folder on
normal shutdown. Each officer receives the current coding agent's effective
permission rules unchanged, including project-specific rules. Changing projects
or refreshing the connection refreshes those rules. No crew settings, agent
files or team memory are added to your project or global settings.
These temporary crew definitions are separate from your saved speech settings
in `~/.picard-code/speech.json`.

If both `OPENCODE_CONFIG` and `OPENCODE_CONFIG_DIR` are already set, keep one
unset so Picard Code can use a separate settings location without replacing
yours. Settings that override the reserved `picard-` agents are reported rather
than bypassed. In both cases Picard Code still starts: the terminal explains
why the crew is unavailable, and the computer answers every request itself. With `--connect`, ordinary computer requests remain available;
crew requests require the server to have the matching crew definitions and
permission rules. Naming an officer then reports that the crew is unavailable.

`npm run test:crew:live` checks real officer replies and a few measurable voice
habits (no exclamation marks, Data without contractions, Worf brief), "Make it
so" carrying out an officer's own proposal, an unclear "Make it so" answered
with a question, a quick fact kept by the computer, requests handed to the
right officer without naming them (including misheard names, an explanation to
Data and writing to Troi) and real briefings in which the computer calls each
officer itself. It cannot judge whether an officer sounds right; that needs
you. It makes model requests, may incur provider charges, and never
answers an approval itself. It does not check a physical microphone or speakers.

## Connect a model provider

Picard Code works with any model provider OpenCode supports: GitHub Copilot,
Anthropic, OpenAI, Azure OpenAI, models on your own computer, and many more
(see [OpenCode's providers](https://opencode.ai/v2/docs/providers/)). It uses
the sign-ins OpenCode already has and does not copy credentials from `gh`,
your browser or another tool. OpenCode also offers a few free models of its own
without any sign-in; they appear in the list under **OpenCode**.

To sign in to a provider:

1. In another terminal in this repository, run `npm run opencode -- auth login`
   (Windows: `npm.cmd run opencode -- auth login`; or `opencode auth login` if
   installed globally).
2. Choose your provider from the list and follow its sign-in. For GitHub
   Copilot, that is GitHub's device sign-in: check you are signed in to the
   right account, enter the code OpenCode shows, and approve it yourself.
3. Return to Picard Code, choose the **Provider** tile and then
   **Refresh connection**. Pick a model with the **Model** tile; models are
   grouped by provider.

`npm run opencode -- auth list` shows which providers are signed in.

## The main screen and Settings

The main screen shows only the current log entry: the messages, any
question or approval waiting for you, and the computer console with one large
status (for example Standing by, Listening, Understanding, Working, Speaking
or Decision needed) and a line saying what to do next. The console also holds
**Stop speaking** and **Belay that** when they apply, and the microphone
button; the row of lights beside it shows listening, and turns blue and moves
while work runs. While the request runs, a line at the end of the conversation
also says so and who is on it, such as "Data is working on it.", with what is
happening now when OpenCode reports it, such as "Searching the web.". It shows
only while OpenCode reports the work as running. If a step fails along the way
but the request carries on, such as a web page that refuses access, it is
folded into a small "1 step did not work" note; open it to read the exact
error. A reply that ends without an answer still shows its errors in full.
The latest request and reply are shown large; earlier messages are smaller. The header shows only the name and the
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
entry. It appears as a standalone LCARS-style record below the Computer reply,
outside its orange frame, with a source link: **Personnel file**
above **Jean-Luc Picard** in lilac, or **All the world’s a stage** above
**Sir Patrick Stewart** in peach. A small **Stardate** shows when the fact
appeared, not a date in the subject's life. It has no Computer label or Copy
button and stays readable when earlier replies dim. Questions, approvals,
errors, refusals and stopped work receive no
facts. Reopening the Captain's log does not generate new ones. Facts avoid
repetition until the reviewed collection has been used, and may contain
spoilers from Picard's appearances.

Automatic facts are on screen only. A quiet tricorder-opening sound announces
each new fact after the main answer finishes playing, before listening resumes.
It does not repeat when the screen redraws or a log entry is reopened. There is
no automatic-fact speech setting; an old saved speech choice has no effect.
The Tribute choice is remembered in this browser. Turning it off stops pending
tribute sounds and story offers without cutting off the main answer.

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
errors and disconnection discard pending extras. Saying "Computer" during an
answer stops spoken playback and pending extras; approvals still need an
on-screen button.

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
- **"Belay that"** (or "stop", "cancel that", "never mind"; with "Computer"
  before a task) cancels the current work, the same as the **Belay that** button.
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
- **Say "Computer" to interrupt an answer**, then give your request, or say
  "Computer" and the request together. Other room speech during an answer is
  ignored, even within a log entry. This stops spoken playback and pending
  tribute extras, not running work. Your words are kept unchanged.
  **Stop speaking**, or clicking the computer panel, also interrupts playback
  without switching the microphone on or off.
  Listening uses the browser's echo cancellation and ignores recognized words
  repeated from the current spoken answer. If that also blocks your interruption,
  click the panel or **Stop speaking**. Physical microphone and speaker echo
  still needs checking on your computer. Whisper recognizes the interruption
  after you pause; services with live words can stop playback sooner.
  Listening still pauses for computer sounds.
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
- **Computer sounds:** Picard Code downloads five short TrekCore sounds
  automatically on first startup (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
  Later starts use the checked local copies; missing or changed files are downloaded
  again. If a download fails, startup reports the error rather than silently
  leaving sounds out. `npm run setup:sounds` also checks and downloads them.
  The TNG-era ship-wide call welcomes the Captain once when the app opens,
  after a click if the browser requires one, even before speech is set up. It does not play
  for new log entries or when the microphone is switched back on.
  During spoken conversation the other sounds play quietly, once
  each: a beep when a spoken request is accepted, when you say "Computer"
  on its own, or when you say "stop listening"; an input-failed sound when speech was not understood,
  could not be sent, or was "Not sent"; and a deny beep just before the spoken result when an
  accepted request finally fails or is denied. Answers to questions, **Belay that**, "Computer, belay that" and switching the microphone off play no sound.
  Listening is paused while a sound plays, and listening, speech,
  **Stop speaking** or stopping listening stop it. Request sounds only accompany the visible and
  spoken explanation; it never replaces it. A missing or unreadable sound is
  reported on screen.
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
sent. Only requests that start with "Computer" go to the model. MAI speaking
sends reply text to Azure. Whisper and Kokoro process their audio locally.
With both local speech services and a model on your own computer, nothing
leaves the computer; with any online provider, coding requests do. Say "stop listening" before conversations you do not want sent to the model, or switch the microphone off with its button so nothing is heard at all;
background speech can be misunderstood.

## Azure speech setup

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
`.picard-speech.json` in the Picard Code folder are copied there once. A
`.picard-speech.json` in your project is never read, because a project you do
not trust could use it to name a program to run. You can also write the file yourself, using your own resource's settings:

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
changing log entry, closing the page, or shutting down
Picard Code stops the relevant listening connection. A speech failure leaves
the written log entry intact and reports what failed.

## Local Whisper and Kokoro setup

Local listening uses **faster-whisper** with the English `tiny.en` model.
Local speaking uses **kokoro-onnx**, the standard Kokoro model, and its original
prebuilt British `bf_emma` voice by default (`af_heart` and the other Kokoro
voices can be chosen with `kokoroVoice`). Both run on the CPU. No Azure resource, key, or login
is needed when both sides are local. A model provider is still needed for coding.

Install [uv](https://docs.astral.sh/uv/getting-started/installation/). Then
choose Whisper or Kokoro in **Speech** settings and **Save and apply**. The
first time, Picard Code downloads everything in the background, shows each
step, and switches over when it is ready. No restart is needed. If the download
fails, the real reason is shown and the working speech stays in place.

The same download from a terminal (safe to run again; uv fetches Python 3.11 if
needed):

```sh
npm run setup:speech
```

The same steps by hand, on Windows:

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

For a local default, `speech.json` can contain just:

```json
{
  "listening": "whisper",
  "speaking": "kokoro"
}
```

For a mixed setup, keep the Azure resource settings and add `listening` and
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
the MAI variant also makes chargeable Azure requests. Both passed on the
Windows development machine. They remove their own check conversations and
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
- **No model available:** sign in to a provider as described above, then
  refresh the connection while no work is running.
- **Live updates stop:** keep the terminal open. The browser reconnects and
  reloads saved messages and pending approvals. Use **Try again** if needed.
- **OpenCode cannot start:** run `npm run opencode` directly to see its setup
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
- **Local speech will not start:** complete the Python setup and model download,
  check the configured paths, and choose **Save and apply** in the **Listen · Speak**
  setting again (no restart needed). The reported error is not replaced
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
does not include file attachments, a full file editor, or package publication.

## Developing Picard Code

- [AGENTS.md](AGENTS.md): rules for people and coding agents changing this repository.
- [Conversation research](docs/research/conversation-research.md) and
  [voice and conversation direction](docs/research/voice-and-conversation-direction.md).
