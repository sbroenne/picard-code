# Third-party notices

Picard Code uses original artwork, writing guidance, and generated test phrases.
It includes no Star Trek artwork, episode dialogue, recordings, or cloned
performer voices. The prebuilt speech voices are not affiliated with the show.

The JavaScript dependencies are installed through npm. Local speech
dependencies and weights are downloaded separately, not bundled or committed.
Their installed license files and notices must be preserved.

## Local speech

| Component | License and attribution | Source |
| --- | --- | --- |
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

## Hosted services

OpenCode performs coding through its supported GitHub Copilot provider.
Microsoft's MAI listening and speaking are hosted Azure services, subject to
their service terms, preview availability, and usage charges. No service
credentials or hosted model weights are included in this repository.
