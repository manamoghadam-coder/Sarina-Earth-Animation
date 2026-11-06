# -*- coding: utf-8 -*-
"""تولید گویندگی فارسی (Piper fa_IR-amir از طریق sherpa-onnx) + فایل SRT هماهنگ.
هر تکه جداگانه ساخته و در زمان برنامه‌ریزی‌شده‌ی صحنه قرار می‌گیرد؛ پس زیرنویس و صدا دقیقاً هم‌زمان‌اند."""
import json, sys, wave
from pathlib import Path
import numpy as np
from piper import PiperVoice, SynthesisConfig
sys.path.insert(0, str(Path(__file__).parent))
from script_data import SCENES, LINES

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "assets/voice_models/vits-piper-fa_IR-amir-medium"
BUILD = ROOT / "build"; OUT = ROOT / "output"
SR_OUT = 44100
SPEED = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0   # >1 = کندتر نیست؛ speed بیشتر یعنی تندتر
GAP = 0.25    # مکث بین تکه‌ها
LEAD = 0.45   # شروع صدا نسبت به آغاز صحنه
SCENE_SPEED = {"s6": 1.22}   # صحنه‌ی پایانی کوتاه است؛ گفتار کمی سریع‌تر
SCENE_LEAD = {"s6": 0.15}

def main():
    voice = PiperVoice.load(str(MODEL / "fa_IR-amir-medium.onnx"),
                            config_path=str(MODEL / "fa_IR-amir-medium.onnx.json"))
    syn = SynthesisConfig(length_scale=1.0 / SPEED, noise_scale=0.5, noise_w_scale=0.0)
    clips = []
    for i, (sc, sub, spoken) in enumerate(LINES):
        cache = BUILD / "voice_cache" / f"clip_{i:02d}.npy"
        if cache.exists():                      # کلیپ‌های تأییدشده برای قطعی بودن خروجی نگه‌داری می‌شوند
            x = np.load(cache); clips.append((sc, sub, x)); print(f"{i:2d} {sc} {len(x)/SR_OUT:5.2f}s  (cache)  {sub}"); continue
        sp = SPEED * SCENE_SPEED.get(sc, 1.0)
        syn = SynthesisConfig(length_scale=1.0 / sp, noise_scale=0.5, noise_w_scale=0.0)
        parts = list(voice.synthesize(spoken, syn_config=syn))
        sr_in = parts[0].sample_rate
        x = np.concatenate([p.audio_float_array for p in parts]).astype(np.float32)
        # حذف سکوت ابتدا/انتها بر پایه‌ی پوشش انرژی گفتار (آستانه‌ی ۴٪ بیشینه)
        h = int(sr_in * 0.005)
        e = np.sqrt(np.convolve(x * x, np.ones(h * 2) / (h * 2), "same"))
        idx = np.where(e > 0.04 * e.max())[0]
        x = x[max(idx[0] - int(0.03 * sr_in), 0): idx[-1] + int(0.08 * sr_in)].copy()
        fi, fo = int(0.005 * sr_in), int(0.04 * sr_in)
        x[:fi] *= np.linspace(0, 1, fi); x[-fo:] *= np.linspace(1, 0, fo)
        # ری‌سمپل به 44.1k
        n = int(len(x) * SR_OUT / sr_in)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
        cache.parent.mkdir(exist_ok=True); np.save(cache, x)
        clips.append((sc, sub, x))
        print(f"{i:2d} {sc} {len(x)/SR_OUT:5.2f}s  {sub}")
    # چیدمان زمانی
    win = {s: (a, b) for s, a, b in SCENES}
    cues = []; cur_scene = None; t = 0
    track = np.zeros(int(60.0 * SR_OUT), dtype=np.float32)
    for sc, sub, x in clips:
        if sc != cur_scene:
            cur_scene = sc; t = win[sc][0] + SCENE_LEAD.get(sc, LEAD)
        s0, s1 = t, t + len(x) / SR_OUT
        assert s1 <= win[sc][1] - 0.15, f"صحنه {sc} از پنجره‌ی خود بیرون زد: {s1:.2f} > {win[sc][1]}"
        track[int(s0 * SR_OUT): int(s0 * SR_OUT) + len(x)] += x
        cues.append((s0, s1, sub, sc)); t = s1 + GAP
    track = track / max(1e-6, np.abs(track).max()) * 0.9
    BUILD.mkdir(exist_ok=True); OUT.mkdir(exist_ok=True)
    with wave.open(str(BUILD / "narration.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR_OUT)
        w.writeframes((track * 32767).astype(np.int16).tobytes())
    def ts(v):
        ms = int(round(v * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    with open(OUT / "subtitles_fa.srt", "w", encoding="utf-8") as f:
        for k, (a, b, sub, _) in enumerate(cues, 1):
            f.write(f"{k}\n{ts(a)} --> {ts(b)}\n\u200f{sub}\u200f\n\n")   # RLM: جهت درست علائم نگارشی در پلیرها
    json.dump([{"start": a, "end": b, "text": s, "scene": sc} for a, b, s, sc in cues],
              open(BUILD / "cues.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for sc, a, b in SCENES:
        c = [q for q in cues if q[3] == sc]
        print(sc, f"window {a}-{b}  speech {c[0][0]:.2f}-{c[-1][1]:.2f}  slack {b - c[-1][1]:.2f}s")

main()
