# Picard Code display

## Purpose

An operating interface: the user chooses a folder, speaks to OpenCode 2 through
any model provider it supports, and answers real requests. The computer-display styling frames
the work rather than replacing familiar controls.

## Original visual language

Near-black `#080808` surrounds peach `#efba91`, orange `#e99a53`, and lilac
`#b6a0d5` rails. Peach identifies the project and assistant; lilac identifies
Captain's log and the user's side; orange marks active listening. These are
original flat shapes, not franchise artwork.

The top-left curve, rounded side panels, disconnected top bands, and narrow
bottom rail belong to one continuous composition. Conversation text sits on
black, with restrained dividing lines and no ornamental dashboard statistics.

## Typography and reading

System UI text keeps the conversation readable. The display title uses
Bahnschrift Condensed when available, with platform fallbacks. Code alone uses
Consolas or the system monospace face. Message text is capped at 75 characters
per line and uses generous line spacing.

## Layout

The app is designed for a computer screen, with a side panel, current log
entry, and computer console. The latest request and reply are prominent;
earlier messages are smaller. The console shows the current activity and next
step, listening lights, a microphone button with its own listening label, and
stopping controls when needed.
There is no typing box or phone layout.

First start-up uses one central LCARS flow. Begin start-up brings three ship's
systems online: Computer core (the AI provider), Computer intelligence (the AI
model) and Communications (the microphone). Reuse an existing OpenCode sign-in;
Begin start-up confirms the Captain's own OpenCode default model when available.
Otherwise the Captain chooses and confirms an AI model. Open a channel enables
the microphone once speech is ready. The voice systems prepare in the background,
with actual steps, errors and retry shown in a bar below the central panel.
Reuse the same provider and model controls in the central panel and later
Ship's systems drawers; do not keep separate copies or save a choice merely
because the list changed.
Speech service names, download information and Prepare the computer stay
together. Downloads and failures show actual steps and retry beside the error.
Keep AI provider and AI model errors inside the same first-run frame.
Hide the listening console until model selection and speech preparation are
complete; do not show Standing by before the computer can listen.
Keep setup controls out of the bottom console. Unavailable saved models stay
in the settings drawer for recovery, not first-run onboarding.
Keep Belay that available when work is running, even while the listening
console is hidden. Keep the current log entry without letting its scrolling
hide preparation or retry. After a reload, Try again repeats the failed speech
choice, not the previously saved choice.
Keep open pages in sync when preparation starts, finishes or fails, including
when installed speech starts without a download.

Captain's log and the Project, Computer intelligence, and Listen · Speak tiles
open in a slide-out, as do AI provider in the top bar and About from the header dedication.
Choosing it again, Current log entry, Escape, or the log entry beside it closes
the slide-out. The Tribute tile is an On/Off switch, not a slide-out. Stardate
shows the fan-formula stardate, including its hover text.

## States and access

The AI provider setting, headed Connect your AI provider, uses a Captain-facing
LCARS connection frame with a copyable terminal command, a clear Refresh
connection action, and real
connection results. OpenCode owns sign-in. After Begin start-up, show the
Computer core sign-in order only when no providers are connected.
Reuse connected providers; a provider with no usable models opens Computer
intelligence for recovery rather than repeating sign-in. Detect
connections from OpenCode's provider and connection information, not the model list; a failed
lookup is an error, not an empty connection list. Keep credentials and account
details on the server. OpenCode's few free models remain an explicit optional
path through the Skip sign-in for now and use OpenCode's few free models link.
Show the link only when those models are available and no provider is connected.
A saved OpenCode choice does not prompt first-run sign-in again.
The first-run readout shows Computer core, Computer intelligence and
Communications, marking the current system and those already online.
Supporting connection and permission information stays under About the
connection. Computer intelligence also links to Connect so the Captain can add
providers later.
The Computer intelligence setting labels its selector AI model. A new choice
requires Confirm this model during first start-up or Use this model later,
even when OpenCode offers free models. Begin start-up can confirm a default
the Captain already set in OpenCode; never treat an automatic model choice
from OpenCode as the Captain's default.
Recommend the most capable model available without
inventing a ranking, and explain the possible cost and speed trade-off.
The confirmed choice is saved on this computer for every Project, separately
from OpenCode's default. An unavailable choice needs a confirmed replacement,
never an automatic switch. Keep unavailable saved choices in Computer
intelligence for recovery, not first-run onboarding.
Address the Captain in the first-run welcome only, not in every settings
instruction. Computer intelligence gives brief guidance for the actual state:
first selection, saved choice, an unconfirmed change, or recovery. It uses an
LCARS-style control frame and a colored status readout. A saved choice is
clearly marked, and Use this model stays off until the choice changes.
During first start-up, confirming the model advances to Communications while
voice preparation continues separately. Later, Use this model saves the choice
and closes the drawer when speech is ready. There is no separate confirmation screen.
Unavailable models have a direct Refresh connection action. Supporting details
stay under About this choice, not in the main setup steps.
Connection readiness means OpenCode is connected and the confirmed model is available.
Keep microphone availability separate from computer activity. The console's
large readout says Not listening whenever the computer cannot hear, and its
supporting line says why and what to do. The small label under the microphone
shows Starting until startup finishes, then Listening through silence and
detected speech. Microphone off means the microphone is off. Paused means
browser audio is paused or a video is playing. During microphone preparation,
show the browser-permission instruction, not a request for an unrelated click.
The microphone button is the only listening control. When a click on it lets
the computer hear (browser audio paused, or microphone off), it grows with an
orange ring and the supporting line says to click the microphone or press M.
Resuming paused audio does not switch the connected microphone off. While a
video plays, the button is not highlighted, because clicking it would switch
the microphone off. The microphone button has a distinct look for listening,
paused, starting and off; starting is neutral, not a red failure. The centre
of an empty log entry invites a request only while the computer can hear;
otherwise it is empty, and the console explains. The
console's supporting line uses normal capitals so instructions stay readable.
In the side rail, a Ship’s systems label separates the settings readouts from
the navigation tiles and switches.

The large heading normally follows Standing by, Accessing, Transmitting,
then Standing by. Detected speech does not change it. Final recognition uses
"Checking what you said." in the supporting line, and sending uses "Sending
your request." without claiming acceptance. Accessing covers accepted work and
preparing its spoken reply; explain the latter beneath the heading.
Transmitting begins with actual reply audio and says "The computer is speaking."
It is independent of the microphone switch.

Decision needed and Answer needed take priority over ordinary activity,
including spoken explanations; keep the required action visible. Approvals
still require a deliberate on-screen choice. Keep real connection and setup
problems explicit. Errors name the problem and the recovery step.
Heading colours follow the displayed activity, not internal speech phases.
Microphone lights can show speech without repeatedly changing the heading.
Only changed status text is written to the live readouts, avoiding repeated
screen-reader announcements on redraw.

The microphone switches on when speech is ready and an available model has
been confirmed, subject to browser permission
and sound restrictions. "Computer" addresses the computer; follow-ups need no
prefix. Standing by still listens; the microphone button or M key stops capture.
Only an explicit spoken request or the New log entry tile starts a new entry.
Microphone changes, standing by and page refreshes do not start a new entry.
Requests heard during work or a pending decision are not sent. Live understood
words and "Not sent" feedback remain visible without a routine Send step.
Microphone off, Stop speaking, and Belay that (stop work) are separate controls.
Listening stays available during spoken replies: "Computer", Stop speaking
or a click on the computer panel stops playback without stopping work.
Video playback, computer sounds and open Ship's systems panels pause listening.
Azure listening can receive speech before "Computer" is recognized.
Computer sounds are quiet, play once at a real event (startup, accepted,
not understood, failed or denied), never while listening,
and never stand in for the written or spoken explanation.

Use the TNG terms in AGENTS.md and label the user's lines "Picard".
Replies use Markdown with unsafe HTML removed; exact errors stay plain.

Native buttons, form labels, disclosure controls, visible keyboard focus, a
skip link, and reduced-motion support remain intact. Permission choices are
Allow once and Deny. New requests reveal their action buttons without dragging
the user away from older conversation text.

## Motion

One short clipping reveal assembles the welcome symbol. It is disabled when
the system requests reduced motion. No flashing indicators or decorative
glows.

## Public project website

The separate static site in `site/` is a tribute first: it opens with the
dedication to Sir Patrick Stewart and Captain Jean-Luc Picard, explains how
that tribute shapes the computer, and then shows the app and welcomes
contributions. It uses the app's palette, condensed capitals and frame shapes,
but works on phone-sized screens too. It does not host the app, access a
microphone, or connect to local services. Its interface screenshot is a staged
example from the labeled test stand-in, and its caption says so.
Setup and contribution details stay in the repository rather than being
maintained twice.
