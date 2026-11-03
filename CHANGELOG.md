# Picard Code release notes

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
