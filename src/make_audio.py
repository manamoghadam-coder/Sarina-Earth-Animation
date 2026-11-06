# -*- coding: utf-8 -*-
"""موسیقی پس‌زمینه‌ی ملایم/علمی/کودکانه + جلوه‌های صوتی (کاملاً ساخته‌شده با کد) و میکس نهایی با گویندگی.
سایدچین: هنگام گفتار، موسیقی خودکار پایین می‌آید."""
import wave, sys, json
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parent.parent
SR = 44100; DUR = 60.0; N = int(SR * DUR)
rng = np.random.default_rng(2026)

def tvec(d): return np.arange(int(d * SR)) / SR
def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)

def lowpass(x, fc):
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); s = 0.0
    # فیلتر یک‌قطبی (کند ولی طول کوتاه است)؛ با scipy سریع‌تر
    from scipy.signal import lfilter
    return lfilter([1 - a], [1, -a], x)

def place(buf, x, t0, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= N or i + len(x) < 0: return
    x = x[:N - i] if i + len(x) > N else x
    l = gain * (1 - max(pan, 0)); r = gain * (1 + min(pan, 0))
    buf[0, i:i + len(x)] += x * l; buf[1, i:i + len(x)] += x * r

def pluck(f, d=0.6, bright=1.0, kind="marimba"):
    t = tvec(d)
    if kind == "marimba":
        s = np.sin(2 * np.pi * f * t) * np.exp(-t * 7) + 0.35 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 18) * bright
    elif kind == "glock":
        s = np.sin(2 * np.pi * f * t) * np.exp(-t * 4.5) + 0.4 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t * 9) + 0.2 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 14)
    else:  # bass
        s = np.sin(2 * np.pi * f * t) * np.exp(-t * 3.2) + 0.25 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 6)
    att = np.minimum(t / 0.004, 1.0)
    return (s * att).astype(np.float32)

def pad_note(f, d, a=0.8, r=1.2):
    t = tvec(d + r)
    env = np.minimum(t / a, 1) * np.minimum(np.maximum((d + r - t) / r, 0), 1)
    s = 0.5 * np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 2.003 * t) + 0.18 * np.sin(2 * np.pi * f * 0.997 * t) + 0.08 * np.sin(2 * np.pi * f * 3 * t)
    s *= 1 + 0.08 * np.sin(2 * np.pi * 4.7 * t)
    return (s * env).astype(np.float32)

def noise_burst(d, fc_lo=None, fc_hi=None, decay=8.0, att=0.002):
    n = rng.standard_normal(int(d * SR)).astype(np.float32); t = tvec(d)
    from scipy.signal import butter, lfilter
    if fc_lo and fc_hi:
        b, a = butter(2, [fc_lo / (SR / 2), fc_hi / (SR / 2)], "band"); n = lfilter(b, a, n)
    elif fc_hi:
        b, a = butter(2, fc_hi / (SR / 2), "low"); n = lfilter(b, a, n)
    elif fc_lo:
        b, a = butter(2, fc_lo / (SR / 2), "high"); n = lfilter(b, a, n)
    return n * np.exp(-t * decay) * np.minimum(t / att, 1)

def whoosh(d, f0, f1, gain=1.0, hot=False):
    n = rng.standard_normal(int(d * SR)).astype(np.float32); t = tvec(d)
    fc = np.geomspace(f0, f1, len(t))
    # فیلتر متغیر با زمان (تقریبی) با ترکیب باندها
    from scipy.signal import butter, lfilter
    out = np.zeros_like(n)
    edges = np.geomspace(min(f0, f1), max(f0, f1), 7)
    prog_ = (np.log(fc) - np.log(min(f0, f1))) / (np.log(max(f0, f1)) - np.log(min(f0, f1)) + 1e-9)
    for i in range(6):
        b, a = butter(2, [edges[i] / (SR / 2), min(edges[i + 1], SR / 2 * .9) / (SR / 2)], "band")
        band = lfilter(b, a, n)
        c = (i + .5) / 6; w = np.exp(-((prog_ - c) / 0.22) ** 2)
        out += band * w
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5
    out = out * env * 4
    if hot: out += lowpass(rng.standard_normal(len(t)).astype(np.float32), 160) * env * 14
    return (out * gain).astype(np.float32)

def chime(f=880, d=1.0, gain=1.0):
    t = tvec(d)
    s = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 3) + 0.3 * np.sin(2 * np.pi * f * 3.0 * t) * np.exp(-t * 6)) * np.exp(-t * 4.5)
    return (s * np.minimum(t / 0.003, 1) * gain).astype(np.float32)

def rumble(d, gain=1.0):
    n = lowpass(rng.standard_normal(int(d * SR)).astype(np.float32), 110); t = tvec(d)
    return (n * 9 * np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.2 * gain).astype(np.float32)

def kick(gain=1.0):
    t = tvec(0.28); f = 120 * np.exp(-t * 18) + 42
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11) * gain).astype(np.float32)

# ------------------------------------------------------------------ موسیقی
BPM = 108; BEAT = 60 / BPM; BAR = 4 * BEAT
NB = int(np.ceil(DUR / BAR))
# ریشه‌ی آکورد (MIDI) برای هر میزان: C Am F G  تکرار؛ بخش‌های ۴-۵ تیره‌تر: Am F C G
CH = {"C": (48, [0, 4, 7]), "Am": (45, [0, 3, 7]), "F": (41, [0, 4, 7]), "G": (43, [0, 4, 7]), "Dm": (50, [0, 3, 7]), "Em": (52, [0, 3, 7])}
def progression(bar):
    t = bar * BAR
    if t < 33: seq = ["C", "Am", "F", "G"]
    elif t < 54: seq = ["Am", "F", "C", "G"]
    else: seq = ["F", "G", "C", "C"]
    name = seq[bar % 4]
    if t >= 57.0: name = "C"
    return name
PENT = [0, 2, 4, 7, 9]
def energy(t):
    """سطح انرژی (۰..۱) برای هر بخش: آرام→هیجان→اوج→پایان"""
    pts = [(0, .55), (8, .6), (9.4, .85), (18, .7), (24, .75), (33, .9), (45, 1.0), (54, .9), (57, 1.0), (60, .7)]
    return float(np.interp(t, [p[0] for p in pts], [p[1] for p in pts]))

def make_music():
    buf = np.zeros((2, N), np.float32)
    mel_rng = np.random.default_rng(7)
    last = 72
    for bar in range(NB):
        t0 = bar * BAR; name = progression(bar); root, ints = CH[name]
        e = energy(t0)
        # پد
        for k, iv in enumerate(ints):
            place(buf, pad_note(mtof(root + 12 + iv), BAR, 0.5, 1.0), t0, 0.08 * (0.7 + 0.5 * e), pan=(k - 1) * 0.25)
        # باس (ضربه‌ی ۱ و ۳)
        for b in (0, 2):
            place(buf, pluck(mtof(root), 1.0, kind="bass"), t0 + b * BEAT, 0.30 * (0.6 + 0.4 * e))
        # آرپژ/ملودی هشتایی
        scale_base = root + 24
        pattern = []
        for s8 in range(8):
            if bar % 4 == 3 and s8 >= 6: pattern.append(None); continue
            if s8 % 2 == 0:
                note = scale_base + ints[(s8 // 2 + bar) % 3] 
            else:
                step = mel_rng.choice(PENT)
                note = scale_base + 12 + step if mel_rng.random() < .55 else scale_base + ints[mel_rng.integers(0, 3)] + 12
            pattern.append(note)
        kind = "glock" if (t0 < 18 or t0 >= 54) else "marimba"
        for s8, note in enumerate(pattern):
            if note is None: continue
            tt = t0 + s8 * BEAT / 2 + (0.012 if s8 % 2 else 0)
            g = 0.16 * (0.6 + 0.5 * e) * (1.0 if s8 % 2 == 0 else 0.8)
            place(buf, pluck(mtof(note), 0.7, kind=kind), tt, g, pan=(-0.3 if s8 % 2 else 0.3))
        # ضربه‌ی نرم و شیکر
        if t0 >= 8.0 and t0 < 56.5:
            place(buf, kick(0.22 * (0.5 + 0.5 * e)), t0, 1.0)
            place(buf, kick(0.12 * (0.5 + 0.5 * e)), t0 + 2 * BEAT, 1.0)
        for s8 in range(8):
            if t0 >= 4.0 and t0 < 57.0:
                place(buf, noise_burst(0.06, 5000, 12000, 55) * 0.06 * (0.5 + 0.5 * e), t0 + s8 * BEAT / 2 + (BEAT / 4 if False else 0), 1.0, pan=0.2 if s8 % 2 else -0.2)
    # درون‌مایه‌ی عمیق در هسته‌ها (۳۳–۵۴): درون
    for tt, d in ((33.0, 12.0), (45.0, 9.0)):
        t = tvec(d + 1)
        drone = (np.sin(2 * np.pi * 55 * t) + 0.5 * np.sin(2 * np.pi * 110.4 * t)) * np.minimum(t / 2.0, 1) * np.minimum((d + 1 - t) / 1.0, 1)
        place(buf, drone.astype(np.float32), tt, 0.12)
    # پایان: آکورد C بلند و درخشان
    for iv in (0, 4, 7, 12, 16):
        place(buf, pad_note(mtof(60 + iv), 2.1, 0.2, 1.0), 57.9, 0.07, pan=(iv % 7 - 3) * .1)
    for i, m in enumerate((72, 76, 79, 84)):
        place(buf, pluck(mtof(m), 1.4, kind="glock"), 57.9 + i * 0.1, 0.18)
    return buf

def make_sfx():
    buf = np.zeros((2, N), np.float32)
    place(buf, whoosh(0.9, 300, 3500, 0.5), 0.2)                      # ورود عنوان
    place(buf, chime(1318, 1.2, 0.5), 0.9)
    # باز شدن زمین
    place(buf, rumble(2.2, 0.8), 9.3); place(buf, noise_burst(0.5, 800, 5000, 6) * 0.4, 9.5)
    place(buf, whoosh(1.8, 200, 2200, 0.6), 9.5)
    for i, m in enumerate((72, 76, 79, 84, 88)): place(buf, chime(mtof(m), 1.0, 0.3), 10.0 + i * 0.1)
    # پاپ برچسب‌ها
    pops = [10.90, 11.42, 11.98, 13.05, 18.5, 22.5, 34.35, 37.35, 37.85, 46.8, 49.2, 49.5, 50.85, 51.3, 54.4, 54.7, 55.0, 55.3]
    for i, tp in enumerate(pops):
        place(buf, chime(mtof(79 + (i % 4) * 2), 0.8, 0.45), tp)
        place(buf, noise_burst(0.08, 1500, 6000, 40) * 0.2, tp)
    # انتقال‌ها
    place(buf, whoosh(1.4, 250, 3000, 0.8), 17.1)
    place(buf, whoosh(1.4, 3000, 200, 0.7, hot=True), 32.3); place(buf, rumble(1.6, 0.7), 32.3)
    place(buf, whoosh(1.4, 200, 4000, 0.7, hot=True), 44.2)
    place(buf, whoosh(1.4, 4000, 250, 0.7), 53.0)
    # پایان
    place(buf, chime(1568, 1.6, 0.5), 57.9)
    for i in range(10): place(buf, chime(mtof(84 + (i * 5) % 12), 0.6, 0.2), 58.05 + i * 0.11, pan=(i % 5 - 2) * .3)
    return buf

def main():
    w = wave.open(str(ROOT / "build" / "narration.wav")); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    voice = np.zeros(N, np.float32); voice[:min(N, len(x))] = x[:N]
    music = make_music(); sfx = make_sfx()
    # سایدچین (Ducking): پوشش انرژی گفتار با روشن/خاموش‌شدن نرم
    hop = SR // 100
    env = np.sqrt(np.convolve(voice ** 2, np.ones(hop * 3) / (hop * 3), "same"))
    gate = np.clip(env / 0.03, 0, 1)
    from scipy.signal import lfilter
    a_att, a_rel = np.exp(-1 / (SR * 0.08)), np.exp(-1 / (SR * 0.45))
    sm = np.zeros_like(gate); s = 0.0
    # فیلتر دو سرعته (حمله سریع، رهایی کند) به‌صورت قطعه‌ای
    g = gate[::64]; out = np.empty_like(g)
    for i, v in enumerate(g):
        s = v + (s - v) * (0.9 if v > s else 0.985) if False else (s + (v - s) * (0.12 if v > s else 0.008))
        out[i] = s
    sm = np.interp(np.arange(N), np.arange(len(out)) * 64, out)
    duck = 1.0 - 0.60 * sm
    # نرمال‌سازی استم‌ها بر پایه‌ی RMS تا گویندگی همیشه غالب باشد
    music = music / np.sqrt((music ** 2).mean()) * 0.075
    sfx = sfx / max(np.abs(sfx).max(), 1e-6) * 0.30
    mix_ = music * duck[None, :] + sfx * (1.0 - 0.4 * sm)[None, :]
    voice_st = np.stack([voice, voice]) * 1.0
    final = voice_st + mix_
    # فید ورودی/خروجی
    fade_in = np.minimum(np.arange(N) / (SR * 0.5), 1); fade_out = np.minimum((N - np.arange(N)) / (SR * 1.2), 1)
    final *= (fade_in * fade_out)[None, :]
    peak = np.abs(final).max(); final = final / peak * 0.92 if peak > 0.92 else final
    with wave.open(str(ROOT / "build" / "mix.wav"), "wb") as w2:
        w2.setnchannels(2); w2.setsampwidth(2); w2.setframerate(SR)
        w2.writeframes((final.T * 32767).astype(np.int16).tobytes())
    for nm, arr in (("music_only", music * 1.25), ("sfx_only", sfx)):
        pk = max(np.abs(arr).max(), 1e-6); arr = arr / pk * 0.8
        with wave.open(str(ROOT / "build" / f"{nm}.wav"), "wb") as w3:
            w3.setnchannels(2); w3.setsampwidth(2); w3.setframerate(SR); w3.writeframes((arr.T * 32767).astype(np.int16).tobytes())
    print("mix ok, peak before norm:", peak)

main()
