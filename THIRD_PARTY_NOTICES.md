# Third-party notices

Picard Code uses original artwork, writing guidance, and generated test phrases.
It includes no Star Trek artwork, episode dialogue, recordings, or cloned
performer voices. The prebuilt speech voices are not affiliated with the show.
The computer sounds below are downloaded separately and are not part
of this repository.

The JavaScript dependencies are installed through npm. Local speech
dependencies and weights are downloaded separately, not bundled or committed.
Their installed license files and notices must be preserved.

## Included in the npm package

| Component | License and attribution | Source |
| --- | --- | --- |
| OpenCode 2 (installed by npm as one `@opencode/cli-*` package for the computer) | MIT; OpenCode contributors | [Project](https://github.com/anomalyco/opencode) |
| ws | MIT; copyright 2011 Einar Otto Stangvik, copyright 2013 Arnout Kazemier and contributors | [Project](https://github.com/websockets/ws) |
| marked (built into the browser page) | MIT; copyright 2018+ MarkedJS, copyright 2011-2018 Christopher Jeffrey | [Project](https://github.com/markedjs/marked) |
| DOMPurify (built into the browser page) | Apache 2.0 or MPL 2.0, used under Apache 2.0; copyright Cure53 and other contributors | [Project](https://github.com/cure53/DOMPurify) |

## Local speech

`npx picard-code setup-speech` downloads these into the `.picard-code` folder
in the user's home folder.

| Component | License and attribution | Source |
| --- | --- | --- |
| uv 0.13.6 (sets up Python; downloaded from its GitHub release and checked against a fixed checksum, only when uv is not already installed) | MIT or Apache 2.0; Astral Software Inc. | [Project](https://github.com/astral-sh/uv) |
| Python 3.11 (a python-build-standalone build, downloaded by uv) | Python Software Foundation License; the build includes libraries with their own notices | [Project](https://github.com/astral-sh/python-build-standalone) |
| faster-whisper | MIT; copyright 2023 SYSTRAN | [Project](https://github.com/SYSTRAN/faster-whisper) |
| Converted Whisper `tiny.en` weights | MIT; converted by SYSTRAN from OpenAI Whisper | [Model card](https://huggingface.co/Systran/faster-whisper-tiny.en) |
| kokoro-onnx | MIT; copyright 2025 github.com/thewh1teagle | [Project](https://github.com/thewh1teagle/kokoro-onnx) |
| Kokoro model and prebuilt voice data | Apache 2.0; Kokoro contributors | [Original model](https://huggingface.co/hexgrad/Kokoro-82M), [ONNX release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1) |
| phonemizer | GNU GPL version 3; phonemizer contributors | [Project](https://github.com/bootphon/phonemizer) |
| eSpeak NG | GNU GPL version 3 or later; eSpeak NG contributors | [Project](https://github.com/espeak-ng/espeak-ng) |
| espeakng-loader wrapper | MIT; copyright 2025 thewh1teagle; the wrapped eSpeak library has its own license | [Project](https://github.com/thewh1teagle/espeakng-loader) |
| CTranslate2 | MIT; OpenNMT contributors | [Project](https://github.com/OpenNMT/CTranslate2) |
| ONNX Runtime | MIT; Microsoft Corporation | [Project](https://github.com/microsoft/onnxruntime) |
| PyAV | BSD-3-Clause; PyAV contributors; bundled FFmpeg libraries have separate notices | [Project](https://github.com/PyAV-Org/PyAV) |

The complete pinned Python dependency list is in
`scripts/requirements-speech.txt`. Other installed dependencies retain their
own license files and copyright notices; the table is not a replacement for
those files.

The setup script fixes the Whisper revision and checks the published SHA-256
hashes of the Kokoro model and voices. Downloads use public upstream sources,
not copied franchise material or recordings.

Before distributing a Python environment, native libraries, or model weights,
review and satisfy their licenses, including the GPL source and notice
requirements and the particular FFmpeg build's notices. Do not assume all
local speech dependencies are MIT licensed. This repository's download setup
does not grant permission to remove notices or bypass redistribution terms.

## Computer sounds

Picard Code automatically downloads five short sound files from
[TrekCore](https://www.trekcore.com/audio/) into the `.picard-code/sounds`
folder in the user's home folder on first startup. `npm run setup:sounds` can also check and download
them. The project owner chose the existing three computer sounds and confirmed
permission to use those files. The added startup call is listed by TrekCore
as “Hail All Ship” under Next Generation Era Computer Sounds; it is not
claimed to be the exact recording from Picard's arrival ceremony.
The owner also confirmed permission for the additional “TNG Tricorder Open”
recording used to announce new automatic tribute facts.
These recordings are not covered by this project's license, are not
redistributed in this repository, and no license or redistribution permission
is granted here.

| Used for | Source |
| --- | --- |
| The Captain's arrival at startup | https://www.trekcore.com/audio/computer/hail_allship_ep.mp3 |
| A spoken request was accepted | https://www.trekcore.com/audio/computer/computer_work_beep.mp3 |
| Speech was not understood or could not be sent | https://www.trekcore.com/audio/computer/input_failed_clean.mp3 |
| An accepted request finally failed or was denied | https://www.trekcore.com/audio/computer/denybeep1.mp3 |
| A new automatic tribute fact, after the spoken answer finishes | https://www.trekcore.com/audio/tricorder/tng_tricorder_open.mp3 |

## Development tools

`.github/skills/ponytail-review` is the review skill from
[Ponytail](https://github.com/DietrichGebert/ponytail) v5.3.3 (commit
`7801d061243d7b753bad0e0b3c057cd250b11755`), copied unchanged under the MIT
license; copyright 2026 DietrichGebert. Its license is kept beside it. It is
used only to review changes to this repository, not by the app.

`tools/voice-match` measured which ready-made voices sound closest to each
actor. It is not part of the npm package or the app. When run, it downloads
its Python packages and these speaker-recognition models into
`~/.picard-code/voice-match`; none are committed or shipped:

| Model | License | Source |
| --- | --- | --- |
| ReDimNet2 b6 | MIT; PalabraAI | [Project](https://github.com/PalabraAI/redimnet2) |
| ReDimNet b6 | MIT; ID R&D | [Project](https://github.com/IDRnD/ReDimNet) |
| WeSpeaker ResNet293-LM | CC BY 4.0; WeNet community | [Model card](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet293-LM) |
| SpeechBrain ECAPA-TDNN | Apache 2.0; SpeechBrain | [Model card](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb) |
| ECAPA2 | CC BY-NC 4.0 (non-commercial); Jenthe Thienpondt | [Model card](https://huggingface.co/Jenthe/ECAPA2) |
| WavLM Base Plus SV | MIT; Microsoft | [Model card](https://huggingface.co/microsoft/wavlm-base-plus-sv) |

The actor clips it compares against are the user's own and stay on their
computer. Only the measured scores are kept, in
`docs/research/audition-data/crew-voice-match.json`.

## Hosted services

OpenCode performs coding through the model provider the user chooses, under
that provider's own terms.
Microsoft's MAI listening and speaking are hosted Azure services, subject to
their service terms, preview availability, and usage charges. No service
credentials or hosted model weights are included in this repository.
