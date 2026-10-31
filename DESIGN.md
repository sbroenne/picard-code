# Picard Code display

## Purpose

An operating interface: the user chooses a folder, talks to OpenCode through
GitHub Copilot, and answers real requests. The computer-display styling frames
the work rather than replacing familiar controls.

## Original visual language

Near-black `#080808` surrounds peach `#efba91`, orange `#e99a53`, and lilac
`#b6a0d5` rails. Peach identifies the project and assistant; lilac identifies
conversations and the user's side; orange marks active listening. These are
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

Desktop: a 230-pixel sidebar at left, a flexible conversation at right, and a
set of spoken controls below an independently scrollable reading area. A straight
peach rail introduces these controls; the typing fallback is folded away.
At intermediate
widths the sidebar narrows to 190 pixels.

At 700 pixels and below, the same interface becomes one column. The sidebar
opens with a labeled Menu button, conversation content uses normal page
scrolling, and message controls wrap without horizontal page overflow.

## States and access

The setup screen tells the truth when Copilot is missing. Ready means the real
OpenCode event stream is connected and a Copilot model is available. Working, loading, reconnecting, unanswered
questions, and approval requests have visible labels. Errors name the problem
and the recovery step.

The microphone starts off. Listening, understanding/working, speaking, and
waiting for a decision have explicit labels. Live understood words are visible,
without becoming a routine review step. The selected services and their audio disclosure sit beside
activation. Microphone off, Stop speaking, and Stop work are separate controls.
Playback pauses listening; interruption uses the Stop speaking control.

Native buttons, form labels, disclosure controls, visible keyboard focus, a
skip link, and reduced-motion support remain intact. Permission choices are
Allow once and Deny. New requests reveal their action buttons without dragging
the user away from older conversation text.

## Motion

One short clipping reveal assembles the welcome symbol. It is disabled when
the system requests reduced motion. No flashing indicators or decorative
glows.
