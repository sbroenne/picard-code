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
earlier messages are smaller. The console shows the current state and next
step, listening lights, a microphone button, and stopping controls when needed.
There is no typing box or phone layout.

Captain's log and the Project, Model, and Listen · Speak tiles open in a
slide-out, as do Provider in the top bar and About from the header dedication.
Choosing it again, Current log entry, Escape, or the log entry beside it closes
the slide-out. The Tribute tile is an On/Off switch, not a slide-out. Stardate
shows the fan-formula date, with the ordinary date on hover.

## States and access

The Provider setting tells the truth when no model is available.
Connection readiness means OpenCode is connected and a model is available.
Standing by, listening, understanding, working, speaking, reconnecting, unanswered
questions, and approval requests have visible labels. Errors name the problem
and the recovery step.

The microphone switches on when speech is ready, subject to browser permission
and sound restrictions. "Computer" starts a task; follow-ups within it need no
prefix. Standing by still listens; the microphone button or M key stops capture.
Only an explicit spoken request or the New log entry tile starts a new entry.
Microphone changes, standing by and page refreshes do not start a new entry.
Requests heard during work or a pending decision are not sent. Live understood
words and "Not sent" feedback remain visible without a routine Send step.
Microphone off, Stop speaking, and Belay that (stop work) are separate controls.
Playback and settings pause listening; interruption uses Stop speaking.
Azure listening can receive speech before "Computer" is recognized.
Optional computer sounds are quiet, play once at a real event (accepted,
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
