"""Measures which ready-made voices sound closest to each cast member's clips.

Nothing here clones or trains a voice: it only compares existing Kokoro and Azure MAI voices
with the owner's own clips, using speaker-recognition models, and writes a report without any
file names, transcripts or audio. Run through `npm run voices:match`.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import warnings
from pathlib import Path

import librosa
import numpy as np
import soundfile
import torch
from scipy.optimize import linear_sum_assignment

warnings.filterwarnings("ignore")
torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))
RATE = 16_000
HOME = Path(os.environ.get("PICARD_VOICE_MATCH", Path.home() / ".picard-code" / "voice-match"))
TOOL = Path(__file__).resolve().parent
AUDIO = re.compile(r"\.(mp3|wav|flac|ogg|m4a)$", re.I)

GRADES = {"A": 12, "A-": 11, "B+": 10, "B": 9, "B-": 8, "C+": 7, "C": 6, "C-": 5, "D+": 4, "D": 3, "D-": 2, "F+": 1, "F": 0}


def log(message: str) -> None:
    print(message, flush=True)


# ---------- audio preparation ----------

def load(path: Path) -> np.ndarray:
    audio, _ = librosa.load(str(path), sr=RATE, mono=True)
    return audio.astype(np.float32)


def trim(audio: np.ndarray) -> np.ndarray:
    pieces = librosa.effects.split(audio, top_db=35, frame_length=1024, hop_length=256)
    if not len(pieces):
        return audio[:0]
    return np.concatenate([audio[a:b] for a, b in pieces])


def level(audio: np.ndarray) -> np.ndarray:
    rms = float(np.sqrt(np.mean(audio**2)) or 1.0)
    return np.clip(audio * (0.08 / rms), -1, 1).astype(np.float32)


def band_limit(audio: np.ndarray, top: float) -> np.ndarray:
    """Cuts high frequencies so clean modern samples are compared on the same footing as old TV audio."""
    from scipy.signal import butter, sosfiltfilt

    sos = butter(8, [80, top], btype="band", fs=RATE, output="sos")
    return sosfiltfilt(sos, audio).astype(np.float32)


def segments(audio: np.ndarray, length: float = 8.0) -> list[np.ndarray]:
    size = int(length * RATE)
    if len(audio) < size:
        return [audio] if len(audio) > RATE * 2 else []
    count = len(audio) // size
    return [audio[i * size:(i + 1) * size] for i in range(count)]


def joined_segments(clips: list[np.ndarray], length: float = 8.0) -> list[np.ndarray]:
    """Joins short clips into steady 8-second pieces, the length the models measure best."""
    out, current = [], []
    for clip in clips:
        current.append(clip)
        if sum(len(c) for c in current) >= length * RATE:
            joined = np.concatenate(current)
            out.extend(segments(joined, length))
            current = []
    rest = np.concatenate(current) if current else np.zeros(0, np.float32)
    if len(rest) >= 4 * RATE:
        out.append(rest)
    return out


def bandwidth(clips: list[np.ndarray]) -> float:
    """The frequency below which 99% of the clips' energy lies."""
    roll = [np.median(librosa.feature.spectral_rolloff(y=c, sr=RATE, roll_percent=0.99)) for c in clips if len(c) > RATE]
    return float(np.clip(np.median(roll), 3000, 7900))


def tone(audio: np.ndarray) -> np.ndarray:
    spectrum = np.abs(librosa.stft(audio, n_fft=1024, hop_length=256)) + 1e-8
    return np.log(spectrum).mean(axis=1)


def apply_tone(audio: np.ndarray, correction: np.ndarray) -> np.ndarray:
    stft = librosa.stft(audio, n_fft=1024, hop_length=256)
    gain = np.exp(np.clip(correction, -1.5, 1.5))[:, None]
    return librosa.istft(stft * gain, hop_length=256, length=len(audio)).astype(np.float32)


# ---------- measurements other than identity ----------

def pitch_and_pace(audio: np.ndarray) -> dict[str, float]:
    f0, voiced, _ = librosa.pyin(audio, fmin=60, fmax=400, sr=RATE, frame_length=1024)
    f0 = f0[voiced & ~np.isnan(f0)]
    onsets = librosa.onset.onset_detect(y=audio, sr=RATE, units="time")
    seconds = max(len(audio) / RATE, 1)
    return {
        "pitch": float(np.median(f0)) if len(f0) else float("nan"),
        "pitchRange": float(np.subtract(*np.percentile(np.log2(f0), [90, 10]))) if len(f0) > 10 else float("nan"),
        "pace": len(onsets) / seconds,
    }


# ---------- speaker-recognition models ----------

class Model:
    name = ""
    licence = ""

    def embed(self, audio: np.ndarray) -> np.ndarray:
        raise NotImplementedError


def tensor(audio: np.ndarray) -> torch.Tensor:
    return torch.from_numpy(audio).unsqueeze(0)


class ReDimNet2(Model):
    name, licence = "ReDimNet2 b6", "MIT"

    def __init__(self):
        self.model = torch.hub.load("PalabraAI/redimnet2", "redimnet2", model_name="b6", train_type="lm", dataset="vb2+vox2_v0", trust_repo=True).eval()

    def embed(self, audio):
        with torch.inference_mode():
            return self.model(tensor(audio))[0].numpy()


class ReDimNet(Model):
    name, licence = "ReDimNet b6", "MIT"

    def __init__(self):
        self.model = torch.hub.load("IDRnD/ReDimNet", "ReDimNet", model_name="b6", train_type="ft_lm", dataset="vox2", trust_repo=True).eval()

    def embed(self, audio):
        with torch.inference_mode():
            return self.model(tensor(audio))[0].numpy()


class WeSpeaker(Model):
    name, licence = "WeSpeaker ResNet293-LM", "CC-BY-4.0"

    def __init__(self):
        import onnxruntime
        from huggingface_hub import hf_hub_download

        path = hf_hub_download("Wespeaker/wespeaker-voxceleb-resnet293-LM", "voxceleb_resnet293_LM.onnx")
        self.session = onnxruntime.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name

    def embed(self, audio):
        import torchaudio

        feats = torchaudio.compliance.kaldi.fbank(tensor(audio) * (1 << 15), num_mel_bins=80, frame_length=25, frame_shift=10, dither=0.0, sample_frequency=RATE, window_type="hamming")
        feats = feats - feats.mean(dim=0)
        return self.session.run(None, {self.input: feats.unsqueeze(0).numpy()})[0][0]


class Ecapa(Model):
    name, licence = "SpeechBrain ECAPA-TDNN", "Apache-2.0"

    def __init__(self):
        from speechbrain.inference.speaker import EncoderClassifier

        self.model = EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb", savedir=str(HOME / "models" / "ecapa"), run_opts={"device": "cpu"})

    def embed(self, audio):
        with torch.inference_mode():
            return self.model.encode_batch(tensor(audio)).squeeze().numpy()


class Ecapa2(Model):
    name, licence = "ECAPA2", "CC-BY-NC-4.0 (non-commercial; used only to measure, never shipped)"

    def __init__(self):
        from huggingface_hub import hf_hub_download

        self.model = torch.jit.load(hf_hub_download("Jenthe/ECAPA2", "ecapa2.pt"), map_location="cpu").eval()

    def embed(self, audio):
        with torch.inference_mode(), torch.jit.optimized_execution(False):
            return self.model(tensor(audio)).squeeze().numpy()


class WavLMBaseSV(Model):
    name, licence = "WavLM Base Plus SV (stand-in for WavLM-Large SV)", "MIT"

    def __init__(self):
        from transformers import Wav2Vec2FeatureExtractor, WavLMForXVector

        self.features = Wav2Vec2FeatureExtractor.from_pretrained("microsoft/wavlm-base-plus-sv")
        self.model = WavLMForXVector.from_pretrained("microsoft/wavlm-base-plus-sv").eval()

    def embed(self, audio):
        inputs = self.features(audio, sampling_rate=RATE, return_tensors="pt")
        with torch.inference_mode():
            return self.model(**inputs).embeddings[0].numpy()


MODELS = {"redimnet2": ReDimNet2, "redimnet": ReDimNet, "wespeaker": WeSpeaker, "ecapa": Ecapa, "ecapa2": Ecapa2, "wavlm": WavLMBaseSV}


def unit(vector: np.ndarray) -> np.ndarray:
    return vector / (np.linalg.norm(vector) or 1.0)


# ---------- main steps ----------

def read_roles(path: Path) -> dict:
    return json.loads(path.read_text())


def references(clips_folder: Path, roles: dict) -> dict[str, list[np.ndarray]]:
    found: dict[str, list[np.ndarray]] = {}
    files = sorted(p for p in clips_folder.iterdir() if p.is_file() and AUDIO.search(p.name))
    for role, info in roles.items():
        chosen = [p for p in files if p.name.startswith(info["prefix"])]
        clips = [level(trim(load(p))) for p in chosen]
        found[role] = [c for c in clips if len(c) > RATE * 0.6]
        log(f"{role}: {len(found[role])} clips, {sum(len(c) for c in found[role]) / RATE:.0f} seconds of speech")
    return found


def candidates(samples_folder: Path) -> dict[str, dict[str, np.ndarray]]:
    out: dict[str, dict[str, np.ndarray]] = {}
    for service in ("kokoro", "mai"):
        folder = samples_folder / service
        if not folder.is_dir():
            continue
        out[service] = {p.stem: level(trim(load(p))) for p in sorted(folder.glob("*.wav"))}
        log(f"{service}: {len(out[service])} candidate samples")
    return out


def sanity(model_embeddings: dict[str, list[np.ndarray]]) -> dict:
    """Leave-one-out check: does each held-out cast segment sit closest to its own speaker?"""
    roles = [r for r, items in model_embeddings.items() if len(items) >= 2]
    correct = total = 0
    own, other = [], []
    for role in roles:
        for i, item in enumerate(model_embeddings[role]):
            scores = {}
            for candidate in roles:
                pool = [e for j, e in enumerate(model_embeddings[candidate]) if not (candidate == role and j == i)]
                centre = unit(np.mean(pool, axis=0))
                scores[candidate] = float(item @ centre)
            correct += max(scores, key=scores.get) == role
            total += 1
            own.append(scores[role])
            other.extend(v for k, v in scores.items() if k != role)
    return {"accuracy": correct / max(total, 1), "segments": total, "ownMean": float(np.mean(own)), "otherMean": float(np.mean(other))}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clips", required=True, type=Path)
    parser.add_argument("--roles", type=Path, default=TOOL / "roles.example.json")
    parser.add_argument("--samples", type=Path, default=HOME / "samples")
    parser.add_argument("--models", default="redimnet2,redimnet,wespeaker,ecapa,ecapa2,wavlm")
    parser.add_argument("--report", type=Path, default=TOOL.parent.parent / "docs" / "research" / "audition-data" / "crew-voice-match.json")
    parser.add_argument("--page", type=Path, default=HOME / "listen.html")
    args = parser.parse_args()

    roles = read_roles(args.roles)
    cast = references(args.clips, roles)
    voices = candidates(args.samples)
    if not voices:
        log("No candidate samples were found. Run npm run voices:samples first.")
        return 1
    grades, genders = {}, {}
    candidates_file = json.loads(os.environ.get("PICARD_VOICE_CANDIDATES", "{}"))
    for item in candidates_file.get("kokoro", []):
        grades[item["name"]] = item["grade"]
        genders[("kokoro", item["name"])] = item["gender"]
    for item in candidates_file.get("mai", []):
        genders[("mai", item["name"])] = item["gender"]

    top = min(bandwidth(c) for c in cast.values() if c)
    log(f"Cast audio carries speech up to about {top:.0f} Hz; candidates are cut to match.")
    cast_tone = np.mean([tone(c) for clips in cast.values() for c in clips], axis=0)
    candidate_audio = {s: {n: band_limit(a, top) for n, a in items.items()} for s, items in voices.items()}
    candidate_tone = np.mean([tone(a) for items in candidate_audio.values() for a in items.values()], axis=0)
    correction = cast_tone - candidate_tone
    candidate_audio = {s: {n: level(apply_tone(a, correction)) for n, a in items.items()} for s, items in candidate_audio.items()}
    cast_segments = {role: joined_segments([band_limit(c, top) for c in clips]) for role, clips in cast.items()}
    candidate_segments = {s: {n: segments(a) or [a] for n, a in items.items()} for s, items in candidate_audio.items()}

    report: dict = {
        "method": "Speaker-recognition embeddings from several models, z-normalised per role and averaged. Rankings include all measured same-gender candidates of at least grade D. Officer assignments exclude French, Hindi, Italian and Indian English voices and reserve Alloy and Iris for the computer.",
        "bandwidthHz": round(top),
        "roles": {r: {"segments": len(s), "seconds": round(sum(len(c) for c in cast[r]) / RATE)} for r, s in cast_segments.items()},
        "models": {},
    }
    scores: dict[str, dict[tuple[str, str], dict[str, float]]] = {}
    for key in args.models.split(","):
        key = key.strip()
        if key not in MODELS:
            continue
        log(f"Loading {key}...")
        try:
            model = MODELS[key]()
        except Exception as error:  # report and carry on, as the plan says
            log(f"{key} could not be loaded: {error}")
            report["models"][key] = {"used": False, "reason": f"Could not be loaded: {type(error).__name__}: {str(error)[:200]}"}
            continue
        try:
            cast_embeddings = {r: [unit(model.embed(s)) for s in segs] for r, segs in cast_segments.items()}
            check = sanity(cast_embeddings)
            log(f"{model.name}: cast check {check['accuracy']:.0%} of {check['segments']} segments")
            entry = {"name": model.name, "licence": model.licence, "castCheck": check}
            if check["accuracy"] < 0.6:
                entry.update(used=False, reason="Could not tell the cast apart well enough.")
                report["models"][key] = entry
                continue
            centres = {r: unit(np.mean(e, axis=0)) for r, e in cast_embeddings.items() if e}
            model_scores: dict[tuple[str, str], dict[str, float]] = {}
            for service, items in candidate_segments.items():
                for name, segs in items.items():
                    vector = unit(np.mean([unit(model.embed(s)) for s in segs], axis=0))
                    model_scores[(service, name)] = {r: float(vector @ c) for r, c in centres.items()}
            entry["used"] = True
            report["models"][key] = entry
            scores[key] = model_scores
        except Exception as error:
            log(f"{key} failed while measuring: {error}")
            report["models"][key] = {"used": False, "reason": f"Failed while measuring: {type(error).__name__}: {str(error)[:200]}"}
    if not scores:
        log("No model could measure the voices.")
        return 1

    # z-normalise each model's scores per role over all candidates, then average across models
    combined: dict[tuple[str, str], dict[str, float]] = {}
    per_model_best: dict[str, dict[str, dict[str, str]]] = {}
    for key, model_scores in scores.items():
        names = list(model_scores)
        per_model_best[key] = {}
        for role in roles:
            values = np.array([model_scores[n][role] for n in names])
            z = (values - values.mean()) / (values.std() or 1.0)
            for n, value in zip(names, z):
                combined.setdefault(n, {}).setdefault(role, 0.0)
                combined[n][role] += float(value) / len(scores)
            for service in voices:
                within = [(model_scores[n][role], n[1]) for n in names if n[0] == service]
                per_model_best[key].setdefault(service, {})[role] = max(within)[1]

    features = {r: pitch_and_pace(np.concatenate(segs)) for r, segs in cast_segments.items() if segs}
    candidate_features = {(s, n): pitch_and_pace(a) for s, items in candidate_audio.items() for n, a in items.items()}

    officers = [r for r, info in roles.items() if info.get("officer")]
    picks: dict[str, dict] = {}
    for service in voices:
        names = [n for n in combined if n[0] == service]
        ranking = {}
        for role in roles:
            gender = roles[role]["gender"]
            allowed = [n for n in names if genders.get((service, base_name(n[1])), gender) == gender
                       and GRADES.get(grades.get(base_name(n[1]), "C"), 6) >= GRADES["D"]]
            ranked = sorted(allowed, key=lambda n: combined[n][role], reverse=True)
            ranking[role] = [{"voice": n[1], "score": round(combined[n][role], 3),
                              "agreement": sum(per_model_best[k][service][role] == n[1] for k in scores),
                              **{k: round(v, 3) for k, v in candidate_features[n].items()}} for n in ranked[:6]]
        assigned = assign_voices(service, ranking, officers)
        picks[service] = {"assigned": assigned, "ranking": ranking}

    report["castPitchAndPace"] = {r: {k: round(v, 3) for k, v in f.items()} for r, f in features.items()}
    report["picks"] = picks
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    log(f"Report written to {args.report}")
    write_page(args.page, args.samples, picks, roles)
    log(f"Listening page written to {args.page}")
    for service, result in picks.items():
        for role, voice in result["assigned"].items():
            best = result["ranking"][role][0]
            log(f"{service} {role}: {voice} (best alone: {best['voice']}, score {best['score']})")
    return 0


def base_name(sample: str) -> str:
    return sample.split("__")[0]


def eligible_officer_voice(service: str, sample: str) -> bool:
    name = base_name(sample)
    if service == "kokoro":
        return name.startswith(("af_", "am_", "bf_", "bm_")) and name != "af_alloy"
    return name.startswith(("en-US-", "en-GB-", "en-AU-")) and name != "en-US-Iris"


def assign_voices(service: str, ranking: dict, officers: list[str]) -> dict[str, str]:
    pool = sorted({item["voice"] for role in officers for item in ranking[role]
                   if eligible_officer_voice(service, item["voice"])})
    cost = np.full((len(officers), len(pool)), 1e6)
    for i, role in enumerate(officers):
        for item in ranking[role]:
            if item["voice"] in pool:
                cost[i, pool.index(item["voice"])] = -item["score"]
    rows, cols = linear_sum_assignment(cost)
    assigned = {officers[i]: pool[j] for i, j in zip(rows, cols) if cost[i, j] < 1e5}
    if len(assigned) != len(officers):
        raise ValueError(f"Not enough distinct {service} voices meet the accent and computer-voice limits.")
    return assigned


def write_page(page: Path, samples: Path, picks: dict, roles: dict) -> None:
    rows = []
    for service, result in picks.items():
        for role in roles:
            ranked = result["ranking"][role]
            if roles[role].get("officer"):
                ranked = [item for item in ranked if eligible_officer_voice(service, item["voice"])]
            chosen = result["assigned"].get(role, "")
            audition = sorted(ranked, key=lambda item: item["voice"] != chosen)[:3]
            cells = "".join(
                f"<td>{html.escape(item['voice'])} ({item['score']:+.2f})<br><audio controls preload=none src=\"samples/{service}/{html.escape(item['voice'])}.wav\"></audio></td>"
                for item in audition)
            rows.append(f"<tr><th>{service}</th><th>{html.escape(role)}<br><small>chosen: {html.escape(chosen)}</small></th>{cells}</tr>")
    page.parent.mkdir(parents=True, exist_ok=True)
    page.write_text("<!doctype html><meta charset=utf-8><title>Crew voice match</title><style>body{font:15px system-ui;background:#000;color:#fc9;padding:1em}td,th{border:1px solid #534;padding:.5em;vertical-align:top}</style>"
                    "<h1>Crew voice match</h1><p>The chosen officer voice comes first, then the closest allowed alternatives. French and Indian-accented officer voices are excluded. Control roles show raw rankings. Compare them with your own clips.</p><table>" + "".join(rows) + "</table>\n")


if __name__ == "__main__":
    sys.exit(main())
