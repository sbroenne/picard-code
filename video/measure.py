# Measures how long the app's local Kokoro voice took to say each sentence of a recorded reply, by saying it
# again exactly as scripts/local-speech-worker.py does: one sentence at a time, then 0.1 seconds of silence.
# Kokoro gives the same length for the same words, voice and speed, so the edit can cut on real sentence ends.
# Run through build.mjs, which writes the pieces file:
#   ~/.picard-code/voice/bin/python3 video/measure.py <pieces.json>
# pieces.json: [{"voice": "am_michael", "speed": 1.0, "text": "..."}] → [[{"text": sentence, "seconds": length}], ...]
import asyncio, contextlib, json, pathlib, re, sys
from kokoro_onnx import Kokoro
from phonemizer.backend import EspeakBackend

models = pathlib.Path.home() / ".picard-code" / "voice" / "models"
phonemizers = {}


def phonemizer_for(voice):
    accent = "en-gb" if voice.startswith("b") else "en-us"
    if accent not in phonemizers:
        phonemizers[accent] = EspeakBackend(accent, preserve_punctuation=True, with_stress=True)
    return phonemizers[accent]


async def measure(kokoro, piece):
    lengths = []
    for sentence in re.split(r"(?<=[.!?])\s+", piece["text"]):
        phonemes = phonemizer_for(piece["voice"]).phonemize([sentence], strip=True)[0]
        samples = 0
        async for audio, rate in kokoro.create_stream(phonemes, voice=piece["voice"], speed=piece.get("speed", 1.0), is_phonemes=True):
            samples += len(audio)
        lengths.append({"text": sentence, "seconds": round(samples / 24000 + 0.1, 3)})
    return lengths


with contextlib.redirect_stdout(sys.stderr):
    kokoro = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
    result = [asyncio.run(measure(kokoro, piece)) for piece in json.loads(pathlib.Path(sys.argv[1]).read_text())]
print(json.dumps(result))
