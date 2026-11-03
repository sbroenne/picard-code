import argparse
import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
import contextlib
import json
import os
import re
import sys
import threading


OUTPUT = sys.stdout
OUTPUT_LOCK = threading.Lock()
JOBS_LOCK = threading.Lock()
JOBS = {}


def emit(event):
    with OUTPUT_LOCK:
        print(json.dumps(event), file=OUTPUT, flush=True)


parser = argparse.ArgumentParser()
parser.add_argument("--kokoro-model", required=True)
parser.add_argument("--kokoro-voices", required=True)
parser.add_argument("--kokoro-voice", default="af_alloy")
args = parser.parse_args()
def phonemizer_for(voice):
    # Kokoro's voice names start with "b" for British English voices.
    # Reuse each native backend; repeated Windows initialization is costly.
    accent = "en-gb" if voice.startswith("b") else "en-us"
    if accent not in phonemizers:
        phonemizers[accent] = EspeakBackend(accent, preserve_punctuation=True, with_stress=True)
    return phonemizers[accent]


try:
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np

        kokoro = None
        phonemizers = {}
        threads = min(4, os.cpu_count() or 1)
        if args.kokoro_model:
            from kokoro_onnx import Kokoro
            import onnxruntime as ort
            options = ort.SessionOptions()
            options.intra_op_num_threads = threads
            options.inter_op_num_threads = 1
            session = ort.InferenceSession(args.kokoro_model, options, providers=["CPUExecutionProvider"])
            kokoro = Kokoro.from_session(session, args.kokoro_voices)
            if args.kokoro_voice not in kokoro.get_voices():
                raise ValueError(f"Kokoro does not have the voice {args.kokoro_voice}.")
            from phonemizer.backend import EspeakBackend
            warmup = phonemizer_for(args.kokoro_voice).phonemize(["Ready."], strip=True)[0]
            kokoro.create(warmup, voice=args.kokoro_voice, is_phonemes=True)
except Exception as error:
    emit({"type": "error", "message": f"Local speech could not load: {error}"})
    sys.exit(1)

emit({"type": "ready"})


def run_job(request, cancelled):
    identifier = request["id"]
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if cancelled.is_set():
                return
            if request["method"] == "synthesize":
                if kokoro is None:
                    raise ValueError("Kokoro speaking is not enabled.")
                voice = request.get("voice", args.kokoro_voice)
                if not isinstance(voice, str) or voice not in kokoro.get_voices():
                    raise ValueError(f"Kokoro does not have the voice {voice}.")
                speed = request.get("speed", 1.0)
                if not isinstance(speed, (int, float)) or not 0.8 <= speed <= 1.2:
                    raise ValueError("The Kokoro speaking speed must be between 0.8 and 1.2.")
                phonemizer = phonemizer_for(voice)

                async def generate():
                    for sentence in re.split(r"(?<=[.!?])\s+", request["text"]):
                        if cancelled.is_set():
                            return
                        phonemes = phonemizer.phonemize([sentence], strip=True)[0]
                        async for samples, rate in kokoro.create_stream(
                            phonemes, voice=voice, speed=speed, is_phonemes=True,
                        ):
                            if cancelled.is_set():
                                return
                            if rate != 24000:
                                raise ValueError("Kokoro returned an unsupported audio rate.")
                            pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
                            for offset in range(0, len(pcm), 4800):
                                if cancelled.is_set():
                                    return
                                emit({"id": identifier, "type": "audio",
                                      "audio": base64.b64encode(pcm[offset:offset + 4800]).decode("ascii")})
                        emit({"id": identifier, "type": "audio", "audio": base64.b64encode(bytes(4800)).decode("ascii")})
                asyncio.run(generate())
                if not cancelled.is_set():
                    emit({"id": identifier, "type": "done"})
            else:
                raise ValueError("That local speech operation is not supported.")
    except Exception as error:
        if not cancelled.is_set():
            emit({"id": identifier, "type": "error", "message": f"Local speech failed: {error}"})
    finally:
        with JOBS_LOCK:
            JOBS.pop(identifier, None)


with ThreadPoolExecutor(max_workers=1) as pool:
    for line in sys.stdin:
        try:
            request = json.loads(line)
            identifier = request["id"]
            with JOBS_LOCK:
                if request.get("method") == "cancel":
                    if identifier in JOBS:
                        JOBS[identifier].set()
                    continue
                if len(JOBS) >= 2:
                    emit({"id": identifier, "type": "error", "message": "Local speech is still finishing an earlier request. Please wait a moment."})
                    continue
                cancelled = threading.Event()
                JOBS[identifier] = cancelled
            pool.submit(run_job, request, cancelled)
        except Exception as error:
            emit({"type": "error", "message": f"The local speech request was invalid: {error}"})
