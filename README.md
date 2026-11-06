<img src="https://raw.githubusercontent.com/sbroenne/picard-code/main/site/assets/mark.svg" alt="Picard Code logo: code brackets around voice levels" width="96" height="96">

# Picard Code

**A voice-only tribute to Sir Patrick Stewart and Captain Jean-Luc Picard.**

Say "Computer", give your order, and hear a calm spoken answer while the
details appear on screen. You are Captain Picard. Ask questions, write,
research, plan, or work on code with OpenCode 2 and any AI provider it supports.
There is no typing; the app is made for a desktop browser.

Listening (Nemotron) and speaking (Kokoro) run on your computer by default.
Call on Riker, Data, Geordi, Worf, Troi or Crusher for their expertise, with
ready-made voices, not performer clones.

[![Watch the Picard Code video on YouTube: Thank you, Sir Patrick. Code by voice.](https://raw.githubusercontent.com/sbroenne/picard-code/main/site/assets/video.png)](https://youtu.be/pFGjNWeaHJI)

[Watch the short video](https://youtu.be/pFGjNWeaHJI) ·
[Project website](https://sbroenne.github.io/picard-code/) ·
[User guide](https://github.com/sbroenne/picard-code/blob/main/docs/USER_GUIDE.md)

## Get started

You need **Node.js 24 or newer** (an LTS release), a microphone, speakers or
headphones, and an AI provider supported by OpenCode. A few free models are
available through OpenCode without signing in.

Default local speech needs **2 GB of free disk space** and an Apple silicon
Mac, Windows PC (x64 or ARM), or Linux computer (x64 or arm64).
Intel Macs are not supported.
Check the [OS requirements and compatibility notes](https://github.com/sbroenne/picard-code/blob/main/docs/USER_GUIDE.md#get-started)
before installing.

### Run with npx

Open a terminal in your project folder and run:

```sh
npx picard-code
```

Your browser opens. Choose **Begin start-up** to bring the computer online.
[First-run details](https://github.com/sbroenne/picard-code/blob/main/docs/USER_GUIDE.md#get-started).

### Run from source

Alternatively, clone the repository. With Git and Node.js installed:

```sh
git clone https://github.com/sbroenne/picard-code.git
cd picard-code
npm start
```

`npm start` installs the needed packages, builds the app, then opens the
same browser app and first-run setup. For later starts, run `npm start`
from the clone; it checks the packages and builds again each time.
[More about running from source](https://github.com/sbroenne/picard-code/blob/main/docs/USER_GUIDE.md#run-from-source).

## Give an order

- "Computer, what can you do?"
- "Computer, Data, explain this project. Do not change any files."
- "Computer, ask Geordi to investigate this failure."
- "Computer, Number One, what are our options?"
- "Computer, new log entry."

Follow-ups stay in the Current log entry and need no "Computer" prefix.
Say **"Stop listening"** to return to Standing by; the next "Computer"
continues that entry. **"Belay that"** stops running work. Switch the
microphone off to stop hearing the room.

## Your data and approvals

The interface runs locally, but an online AI provider receives requests and
relevant project content. Local speech processes audio on your computer;
optional Azure speech sends audio or reply text to your Azure resource.
Downloads and settings stay in `~/.picard-code`, not your project.

**OpenCode's permission rules apply.** By default, OpenCode 2 can change files
and run commands without asking. Configure its permissions if you want
approval first. When an approval is requested, choose **Allow once** or
**Deny** on screen; voice cannot grant it.
[Read about permissions and privacy](https://github.com/sbroenne/picard-code/blob/main/docs/USER_GUIDE.md#spoken-requests).

## Advanced

### Choose another project

Picard Code uses the terminal's current folder by default. To launch from
somewhere else and select a different project:

```sh
npx picard-code --project "full path to your project"
```

When running from source, the clone is selected as the project.
You can change the folder with the **Project** tile in the app if needed.

## Guides and help

[The user guide](https://github.com/sbroenne/picard-code/blob/main/docs/USER_GUIDE.md)
covers provider sign-in, bridge crew, spoken controls, local and Azure speech,
saved settings and troubleshooting.

- [Setup and support](https://github.com/sbroenne/picard-code/blob/main/SUPPORT.md)
- [Help shape the computer](https://github.com/sbroenne/picard-code/blob/main/CONTRIBUTING.md)
- [Developer guide](https://github.com/sbroenne/picard-code/blob/main/docs/DEVELOPMENT.md)
- [Discussions](https://github.com/sbroenne/picard-code/discussions)

This is an unofficial tribute, with original artwork and wording, no copied
show dialogue or cloned voices, and no endorsement.
[MIT license](https://github.com/sbroenne/picard-code/blob/main/LICENSE) ·
[Third-party notices](https://github.com/sbroenne/picard-code/blob/main/THIRD_PARTY_NOTICES.md)
