import argparse
import base64
import contextlib
import json
import os
import sys

os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"


def emit(event):
    print(json.dumps(event), flush=True)


def features(audio):
    # Smart Turn expects normalized, left-padded eight-second Whisper-style features.
    audio = audio[-128000:]
    audio = np.pad(audio, (128000 - audio.size, 0))
    audio = (audio - audio.mean()) / np.sqrt(audio.var() + 1e-7)
    frames = np.lib.stride_tricks.sliding_window_view(
        np.pad(audio.astype(np.float64), (200, 200), mode="reflect"), 400
    )[::160]
    power = np.abs(np.fft.rfft(frames * WINDOW, axis=-1)) ** 2
    spectrum = np.log10(np.maximum(1e-10, FILTERS.T @ power.T))[:, :-1]
    return ((np.maximum(spectrum, spectrum.max() - 8) + 4) / 4).astype(np.float32)[None, ...]


parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
args = parser.parse_args()
try:
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import onnxruntime as ort

        mels = np.linspace(0, 15 + np.log(8) * 27 / np.log(6.4), 82)
        centers = np.where(mels < 15, mels * 200 / 3, 1000 * np.exp((mels - 15) * np.log(6.4) / 27))
        frequencies = np.linspace(0, 8000, 201)[:, None]
        FILTERS = np.maximum(0, np.minimum(
            (frequencies - centers[:-2]) / (centers[1:-1] - centers[:-2]),
            (centers[2:] - frequencies) / (centers[2:] - centers[1:-1]),
        )) * (2 / (centers[2:] - centers[:-2]))
        WINDOW = np.hanning(401)[:-1]
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        session = ort.InferenceSession(args.model, options, providers=["CPUExecutionProvider"])
except Exception as error:
    emit({"type": "error", "message": f"Pause detection could not start: {error}"})
    sys.exit(1)

emit({"type": "ready"})
while True:
    line = sys.stdin.readline(350000)
    if not line:
        break
    if not line.endswith("\n"):
        emit({"type": "error", "message": "The pause detection request is too large."})
        sys.exit(1)
    identifier = None
    try:
        request = json.loads(line)
        identifier = request["id"]
        if request.get("method") == "cancel":
            continue
        if request.get("method") != "check-turn":
            raise ValueError("That pause detection operation is not supported.")
        pcm = base64.b64decode(request["audio"], validate=True)
        if not pcm or len(pcm) % 2 or len(pcm) > 256000:
            raise ValueError("Pause detection needs up to eight seconds of complete audio samples.")
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        probability = float(session.run(None, {"input_features": features(audio)})[0][0].item())
        if not np.isfinite(probability) or not 0 <= probability <= 1:
            raise ValueError("Pause detection returned an invalid completion score.")
        emit({"id": identifier, "type": "turn", "probability": probability})
        emit({"id": identifier, "type": "done"})
    except Exception as error:
        emit({"id": identifier, "type": "error", "message": f"Pause detection failed: {error}"})
