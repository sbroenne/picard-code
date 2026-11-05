# Picard Code

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

A tribute to Sir Patrick Stewart and Captain Jean-Luc Picard, made with deep
respect and gratitude. You give spoken orders as Captain Picard: questions,
writing, research, planning and code. OpenCode carries out the work through a
local browser interface with an original computer-display design inspired by
Star Trek: The Next Generation.

## Operating Context

Runs locally on Windows, Apple silicon macOS, and Linux. Intel Macs are not
supported. Node.js 24 or newer is required; OpenCode 2 is included or reused
when already installed. The terminal's current folder is the default Project;
the Captain can choose another folder and connect an AI provider through
OpenCode. Any model provider OpenCode supports can be used.

## Capabilities and Constraints

The app keeps log entries in Captain's log, shows live replies, uses the
selected Project as context, and displays real OpenCode approval requests.
Credentials stay out of the browser. Services listen locally and must reject
requests from unrelated websites. People run it with `npx picard-code`, which
uses an installed OpenCode 2 or its own copy and prepares the selected speech
services.

Spoken requests are the only input; there is no typing fallback. The app is
designed for a computer screen, not a phone. The microphone switches on when
speech is ready and the Captain opens a channel on first start-up, subject to
browser permission and sound restrictions.
"Computer" addresses the computer; follow-ups need no prefix until the Captain
returns to Standing by. Requests continue the Current log entry unless the
Captain explicitly starts a new one. End-of-speech detection sends requests
without routine transcript review or a Send step. Brief spoken answers accompany
full written results. Follow-ups keep context; microphone off, Stop speaking,
and Belay that (stop work) have separate meanings. Decisions remain deliberate.
Listening remains available during spoken replies so "Computer" can interrupt
playback without stopping work. Stop speaking also stops playback; Belay that
stops work. Video playback, computer sounds and open Ship's systems panels
pause listening. New work requests heard while work or a decision is pending
are not sent; answers to a pending question still use its own choices.

Listening and speaking share small, separate interfaces. Real CPU Nemotron
listening and Kokoro speaking are the default, so anyone can run Picard Code
without a cloud account. Whisper is retired; saved installations automatically
prepare Nemotron, keeping their speaking choice and saving only after startup.
Preparation shows real steps, not an invented percentage, and failures offer retry.
Nemotron shows words during speech, but only a complete request is sent.
The supported MAI live listening and prebuilt MAI
speaking services can be chosen instead, each side on its own.
Azure listening receives detected speech before deciding whether "Computer"
was said, including speech not meant for the model. Processing can occur
outside Europe. Standing by still listens; microphone off stops capture.
Keys remain in local server memory;
connection settings contain no secrets. Reuse suitable resources on the
explicitly approved subscription without changing spending limits or access.

Both setups use the same spoken exchange and deliberate decisions, with
no silent fallback. Local audio processing needs no Azure credentials;
recognized coding requests still go to the chosen model.

Any model provider OpenCode supports can be used, such as GitHub Copilot,
Anthropic, OpenAI or a local model. Sign-ins go through OpenCode's own flow and
stay with OpenCode; credentials from other tools must not be extracted.
Before listening starts, an AI model must be confirmed. Begin start-up confirms
a default the Captain already set in OpenCode; otherwise the Captain chooses
and confirms a model. Picard Code never chooses a replacement on its own.
Recommend the most capable model available for the best experience, with
clear cost and speed considerations. Remember the choice on this computer
across Projects and restarts, separately from OpenCode's default. If it becomes
unavailable, ask for another choice rather than switching models automatically.

## Brand Commitments

Picard Code. Plain English. Black background, peach, orange, and lilac panels,
rounded side bars, and readable conversation text. No copied franchise assets
or implied endorsement.

The computer's writing should be brief, precise, and neutral. Use original
phrasing, truthful acknowledgments, explicit uncertainty, and useful errors.
No voice cloning, show dialogue, or recordings in the repository. Four short
computer sounds are downloaded separately from the npm package and checked
automatically at startup. Their attribution and permission limits are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); they accompany, never replace,
the visible and spoken explanation. No fictional ship status, repetitive
catchphrases, or claims that work succeeded before the real result arrives.

The computer uses fixed ready-made voices: Kokoro Alloy (`af_alloy`) and
Azure MAI Iris (`en-US-Iris`, neutral style). Each bridge officer has a separate
fixed voice. There is no voice-selection control; listening and speaking
services remain independently selectable. The choices are measured comparisons,
not performer clones or claims of authenticity.

The user is always Captain Jean-Luc Picard, labeled "Picard" on screen.
The computer says "Captain" occasionally. Use the plain TNG terms in AGENTS.md:
Captain's log, log entry, Stardate, and Standing by. Ship's systems open from the
side-panel tiles; earlier entries are kept in Captain's log.

## Evidence on Hand

Recorded real checks cover OpenCode startup, saved log entries and shutdown,
Nemotron/Kokoro speech and a generated-audio browser exchange on Apple silicon,
and earlier Azure MAI and retired Whisper/Kokoro paths. A six-turn spoken
exchange checked follow-ups, a correction, OpenCode's question and a refused
command. These records are not a fresh check of every current configuration.
The owner uses Picard Code with a real microphone on Windows and macOS and has
checked Nemotron on Windows ARM. Generated audio does not establish physical
microphone accuracy or room-echo handling; see the evidence limits in
[the research notes](docs/research/bridge-crew-voices.md#evidence-limits).
