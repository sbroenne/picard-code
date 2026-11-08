# Picard Code release notes

## 1701.4.11

### Patch Changes

- [#108](https://github.com/sbroenne/picard-code/pull/108) [`5882b49`](https://github.com/sbroenne/picard-code/commit/5882b492706a1b9f185ab3c7d8b24f3b34296ecb) - Sign in to GitHub's hosted MCP server with a one-time code, without registering your own app or creating a client secret. OpenCode keeps and renews the sign-in, and refused, expired or failed connections are explained clearly.

- [#104](https://github.com/sbroenne/picard-code/pull/104) [`c49d823`](https://github.com/sbroenne/picard-code/commit/c49d823366054d986ad606308b0cc9e60d73d826) - Reopening Picard Code during speech preparation keeps following the same job without briefly starting the microphone or loading computer sounds.

- [#107](https://github.com/sbroenne/picard-code/pull/107) [`fd771f0`](https://github.com/sbroenne/picard-code/commit/fd771f06cb5547ffae6ef18e660fc36489f0745e) - See your MCP connection state on the Ship's systems tile, sign in beside a server, and retry failed connections from a compact list. A single Setup help link keeps instructions out of the panel, while your existing OpenCode settings, current log entry and saved AI model are kept.

- [#107](https://github.com/sbroenne/picard-code/pull/107) [`fd771f0`](https://github.com/sbroenne/picard-code/commit/fd771f06cb5547ffae6ef18e660fc36489f0745e) - Picard Code now always starts and stops OpenCode for you. The advanced --connect option and its setup instructions have been removed.

## 1701.4.10

### Patch Changes

- [#97](https://github.com/sbroenne/picard-code/pull/97) [`2a75dc5`](https://github.com/sbroenne/picard-code/commit/2a75dc53d2f928257a994464499fe47519cc596b) - Render graphs, maths and coloured code in replies, and keep OpenCode work results available on screen. Add read-only previews for documents, spreadsheets, slides and other reply files.

- [#97](https://github.com/sbroenne/picard-code/pull/97) [`2a75dc5`](https://github.com/sbroenne/picard-code/commit/2a75dc53d2f928257a994464499fe47519cc596b) - Align log entries, work status and approval controls with the left edge of the main screen instead of leaving a large gap beside the tiles. Let rich results use the available screen width while keeping paragraphs easy to read.

- [#97](https://github.com/sbroenne/picard-code/pull/97) [`2a75dc5`](https://github.com/sbroenne/picard-code/commit/2a75dc53d2f928257a994464499fe47519cc596b) - Keep graphs, file previews and separate work results readable after later replies arrive. Restore page and slide navigation after preview errors, preserve mathematical notation, and resume listening when media playback fails.

- [#97](https://github.com/sbroenne/picard-code/pull/97) [`2a75dc5`](https://github.com/sbroenne/picard-code/commit/2a75dc53d2f928257a994464499fe47519cc596b) - Open website documents in a separate browser tab instead of offering an unavailable preview.

## 1701.4.9

### Patch Changes

- [#94](https://github.com/sbroenne/picard-code/pull/94) [`0575f22`](https://github.com/sbroenne/picard-code/commit/0575f22b0331f10daaf0b7ba35e8066c105645c3) - Answer several text questions by voice, one at a time, without typing. Answered questions are no longer read again while the computer resumes work.

- [#87](https://github.com/sbroenne/picard-code/pull/87) [`b70e2f0`](https://github.com/sbroenne/picard-code/commit/b70e2f0f22b67cca6b9b79bb65a5e9c33b6d7aed) - Refresh the website screenshots to show the current computer, bridge crew and Captain’s log.

- [#95](https://github.com/sbroenne/picard-code/pull/95) [`add8f12`](https://github.com/sbroenne/picard-code/commit/add8f12d15dffd6d94e88840a2359757f58bb5e9) - Play the arrival call once when the first channel opens after starting Picard Code. Wait until it finishes before listening, without replaying it for microphone changes, page reloads or another open page.

- [#93](https://github.com/sbroenne/picard-code/pull/93) [`a74fa9e`](https://github.com/sbroenne/picard-code/commit/a74fa9e19c85461392dd570a08d92ae1f7dbd5d9) - The Captain’s arrival call now plays when the app opens, without waiting for OpenCode or speech setup. If the browser needs a click before playing sound, the call is loaded ahead of that click.

- [#91](https://github.com/sbroenne/picard-code/pull/91) [`db32d42`](https://github.com/sbroenne/picard-code/commit/db32d42ab08bea45ec9bd130eb71a82d5e517891) - Running from source now needs only npm start: it installs the needed packages and builds the app before opening it. The setup instructions on GitHub and the website now use the same command.

- [#95](https://github.com/sbroenne/picard-code/pull/95) [`add8f12`](https://github.com/sbroenne/picard-code/commit/add8f12d15dffd6d94e88840a2359757f58bb5e9) - Microphone checks now explain missing devices, denied permission and other access problems on macOS, Windows and Linux while keeping the original error visible. After access is allowed, Picard Code retries browser audio so listening can start without an unnecessary extra click; microphone problems can be retried without restarting the app.

## 1701.4.8

### Patch Changes

- [#84](https://github.com/sbroenne/picard-code/pull/84) [`34eb40a`](https://github.com/sbroenne/picard-code/commit/34eb40acdac48ec8f09c60cedd0360482878cfef) - Captain's log entries named after a long request now end at a whole word, with "…" to show the name was shortened. In a briefing, each officer's reply now appears on screen when that officer starts speaking, not while an earlier officer is still talking.

## 1701.4.7

### Patch Changes

- [#81](https://github.com/sbroenne/picard-code/pull/81) [`1156569`](https://github.com/sbroenne/picard-code/commit/1156569e975cd58d856d6e79f3760184c9947d64) - Keep earlier error messages visible when another error arrives, so a missing computer sound cannot hide why start-up failed. Repeated copies of the same error appear only once.

- [#79](https://github.com/sbroenne/picard-code/pull/79) [`dc2c369`](https://github.com/sbroenne/picard-code/commit/dc2c369f2e7324d4447ae7b31a96c8b5bbb25cd2) - Long spoken answers are now spoken completely at every speaking speed. Before, a reply of several paragraphs could stop partway with "Kokoro returned incomplete or oversized audio" and switch the microphone off.

## 1701.4.6

### Patch Changes

- [#75](https://github.com/sbroenne/picard-code/pull/75) [`b280321`](https://github.com/sbroenne/picard-code/commit/b280321219d0601c2d5257c9eedb0d4574cea916) - Bring the guides up to date with the computer's fixed voices, start-up flow and spoken interruption. Use clearer TNG terms, fix Markdown emphasis and remove outdated research and voice trials.

- [#76](https://github.com/sbroenne/picard-code/pull/76) [`29b2a20`](https://github.com/sbroenne/picard-code/commit/29b2a203ef98181cdc6e8c037ab428436140c458) - The console now says Not listening, with the reason, whenever the computer cannot hear you, and Standing by when it can. The microphone button is the only control: it grows with an orange ring when a click lets the computer hear, and resuming paused sound no longer switches an already connected microphone off.

- [#74](https://github.com/sbroenne/picard-code/pull/74) [`97e5382`](https://github.com/sbroenne/picard-code/commit/97e53826f67c0193b0003a0742ac185912d1fa76) - Shorten the npm and GitHub introduction, with detailed setup and usage instructions in a linked user guide.

- [#72](https://github.com/sbroenne/picard-code/pull/72) [`4af3433`](https://github.com/sbroenne/picard-code/commit/4af34339f696310bebb2ccfd488fa96a5b91939f) - Keep the microphone's channel status separate from what the computer is doing, without flashing extra headings as speech starts or a reply prepares. Explain when the computer is speaking, and keep questions and approval requests visible.

## 1701.4.5

### Patch Changes

- [#48](https://github.com/sbroenne/picard-code/pull/48) [`d1403c2`](https://github.com/sbroenne/picard-code/commit/d1403c2a65ad4a4cd3cd1c4e19730a072965321f) - First setup guides you through AI provider connection, an explicit AI model choice and speech preparation in a central LCARS-style flow, keeping open pages in sync with real progress and errors on screen. Your model choice is remembered and never silently replaced; settings drawers remain available for later changes.

- [#47](https://github.com/sbroenne/picard-code/pull/47) [`26dcfc3`](https://github.com/sbroenne/picard-code/commit/26dcfc35fcdc6bcd91a455f9f535b959c3924f8d) - Prepare the computer uses a dedicated LCARS screen with visible steps and retry controls, keeps Belay that available during work, and remembers a failed speech choice across reloads; interrupted downloads are cleaned up on retry. Azure speech choices are under Advanced setup and need your own subscription and deployed speech models.

- [#59](https://github.com/sbroenne/picard-code/pull/59) [`8f8b917`](https://github.com/sbroenne/picard-code/commit/8f8b91755085fdfd8c2c1674022f097f4629ba82) - Fix local listening startup on smaller Macs by respecting the computer's available processors.

- [#55](https://github.com/sbroenne/picard-code/pull/55) [`92eae11`](https://github.com/sbroenne/picard-code/commit/92eae11c50d720bfebd483bb76191fb07063320f) - Listening now checks whether a spoken thought sounds finished, giving unfinished thoughts more time without adding a long wait to every request. Pause detection prepares automatically for local and Azure speech, keeps saved speech choices, and stops with a clear error rather than sending an unfinished request when a check fails.

- [#52](https://github.com/sbroenne/picard-code/pull/52) [`0ee4e34`](https://github.com/sbroenne/picard-code/commit/0ee4e347418a5cd5fcb73845ccc2fa7ffb0e399e) - Automatic tribute facts now appear silently on screen, without the tricorder sound. Other computer sounds and spoken story offers are unchanged.

- [#47](https://github.com/sbroenne/picard-code/pull/47) [`26dcfc3`](https://github.com/sbroenne/picard-code/commit/26dcfc35fcdc6bcd91a455f9f535b959c3924f8d) - Hear quieter requests spoken over the computer's answer by adjusting listening
  to the room's quiet level. Keep the original request, echo protection, and
  approval boundaries unchanged.

- [#54](https://github.com/sbroenne/picard-code/pull/54) [`e389707`](https://github.com/sbroenne/picard-code/commit/e3897072e52019f4ddac0e5440fa168419aaddd6) - Bridge officers no longer answer questions about events after their own deaths. The computer's answers are unchanged.

- [#51](https://github.com/sbroenne/picard-code/pull/51) [`7c19e68`](https://github.com/sbroenne/picard-code/commit/7c19e68e837202bccf0219a048c83827567fa6e7) - Steady background noise, such as a fan, no longer keeps the microphone open
  after a quiet spell; a voice detector in the browser now tells speech from noise.
  Speech setup also checks the NVIDIA license files and upgrades older settings that never chose a listener.
  While Azure is in use, Speech settings now present local speech as a switch rather than the current setup.
  "Computer, belay that" now stops the work even when speech recognition hears it as "delay that".
  Say "Computer, speak faster", "speak slower", "speak fastest", "speak slowest" or "normal speed" to change how fast the computer and officers speak.

- [#56](https://github.com/sbroenne/picard-code/pull/56) [`bddb4bf`](https://github.com/sbroenne/picard-code/commit/bddb4bfd66c6601dc19e6bdf238b5ec543c863cb) - Use the computer's configured npm registry when installing from source, and keep the build tools on compatible versions available through the approved feed.

- [#65](https://github.com/sbroenne/picard-code/pull/65) [`6e571ca`](https://github.com/sbroenne/picard-code/commit/6e571ca2563fef035f67367e7f5a3330d5ea12d1) - First start-up now brings the ship's systems online one at a time: the computer core (your AI account through OpenCode), computer intelligence (your AI model) and communications (the microphone). Steps you have already finished in OpenCode are skipped, voice systems prepare on their own with progress shown at the bottom of the screen, and the senior officers report after your first answer. Picard Code no longer picks an AI model for you when OpenCode has no default set; you choose and confirm one.

- [#47](https://github.com/sbroenne/picard-code/pull/47) [`26dcfc3`](https://github.com/sbroenne/picard-code/commit/26dcfc35fcdc6bcd91a455f9f535b959c3924f8d) - When a spoken request cannot be sent, the computer now says the actual error
  after the input-failed sound. The full error also stays on screen.

- [#53](https://github.com/sbroenne/picard-code/pull/53) [`db7b3a6`](https://github.com/sbroenne/picard-code/commit/db7b3a632353313f8b4be771962ff7fe71390595) - Bridge officers have richer character profiles, answer the Captain directly and follow Captain-led briefings, with Number One coordinating only when asked. The Computer and officers now speak complete stories and explanations across paragraphs, while code, tables and technical appendices stay on screen.

- [#69](https://github.com/sbroenne/picard-code/pull/69) [`4608022`](https://github.com/sbroenne/picard-code/commit/4608022559282753d295301d841ac9c1dc940ed5) - The bridge looks more like TNG: the console says Channel open, Transmitting and Accessing, real failures show in a red alert frame and decisions in a yellow one, and each log entry opens with "Captain's log, stardate". Officers show their rank pips and uniform colour, Settings is now Ship's systems, and an LCARS scanning bar moves while work runs.

- [#47](https://github.com/sbroenne/picard-code/pull/47) [`26dcfc3`](https://github.com/sbroenne/picard-code/commit/26dcfc35fcdc6bcd91a455f9f535b959c3924f8d) - Nemotron now listens on this computer and shows words while you speak. Saved Whisper installations prepare Nemotron automatically, keeping their speaking service and saving only after the replacement starts successfully.

## 1701.4.4

### Patch Changes

- [#45](https://github.com/sbroenne/picard-code/pull/45) [`1e5f734`](https://github.com/sbroenne/picard-code/commit/1e5f734f95dc1192fed57c5dd7547d49f7083463) - Show images and videos in replies, including Project files and YouTube or Vimeo players. Listening pauses during video playback or while a website player is open.

- [#44](https://github.com/sbroenne/picard-code/pull/44) [`0553fcc`](https://github.com/sbroenne/picard-code/commit/0553fcc2f0bdbe3fe1d0ae01377da1d9176d8b89) - Keep requests in the log entry on screen after microphone changes, standing by, refreshing the page or reopening an entry. Start a new entry only with the New log entry tile or an explicit spoken request, including "new starlog entry".

## 1701.4.3

### Patch Changes

- [#39](https://github.com/sbroenne/picard-code/pull/39) [`18fdb3c`](https://github.com/sbroenne/picard-code/commit/18fdb3c58fbaafe65a3b5155e835fa93bc103b81) - The computer now answers most requests itself, as on the Enterprise; officers step in when named or for real expert judgment, and briefings happen only when you ask for one. In a briefing Riker speaks last with a short question, the computer no longer repeats him, and replies now appear on screen when the voice starts speaking them.

- [#42](https://github.com/sbroenne/picard-code/pull/42) [`9c015d1`](https://github.com/sbroenne/picard-code/commit/9c015d19f05973c2d9ebec636e24d768afe6eef5) - Switching the microphone off and back on keeps the current log entry and its follow-ups.

- [#42](https://github.com/sbroenne/picard-code/pull/42) [`9c015d1`](https://github.com/sbroenne/picard-code/commit/9c015d19f05973c2d9ebec636e24d768afe6eef5) - Officer replies now show just the officer’s name, without the repeated Crew report label.

- [#42](https://github.com/sbroenne/picard-code/pull/42) [`9c015d1`](https://github.com/sbroenne/picard-code/commit/9c015d19f05973c2d9ebec636e24d768afe6eef5) - New log entries show their Stardate on the opening screen without speaking it aloud.

## 1701.4.2

### Patch Changes

- [#34](https://github.com/sbroenne/picard-code/pull/34) [`def37fc`](https://github.com/sbroenne/picard-code/commit/def37fc8ca5eb4c730d70680cd0e5c4d65113cbd) - The computer and each bridge officer now have fixed ready-made voices in both Kokoro and Azure MAI, chosen by comparison with the actors; nothing is cloned, and French and Indian accents are excluded. The computer uses Alloy locally and Iris on Azure; after a briefing, each officer says their main finding before the computer closes.

## 1701.4.1

### Patch Changes

- [#30](https://github.com/sbroenne/picard-code/pull/30) [`dd5d3fc`](https://github.com/sbroenne/picard-code/commit/dd5d3fc9a1e2a2814a8cbda26e22d2386ef913ca) - Start Picard Code with npx picard-code, then choose speech in the app. The setup guide now explains that terminal speech setup is optional and local downloads are not needed when both speech services use Azure.

- [#27](https://github.com/sbroenne/picard-code/pull/27) [`70d0f5f`](https://github.com/sbroenne/picard-code/commit/70d0f5fb376284a2bef40093ef95eb40472101fe) - The side panel tiles stay readable on shorter laptop screens. Project, Model and Listen · Speak were squashed and their text was cut off.

- [#27](https://github.com/sbroenne/picard-code/pull/27) [`70d0f5f`](https://github.com/sbroenne/picard-code/commit/70d0f5fb376284a2bef40093ef95eb40472101fe) - The top tile shows the Picard Code version, such as 1701.4.1, in place of a fixed number.

## 1701.4.0

First public release, numbered after the Enterprise-D (NCC-1701-D).
