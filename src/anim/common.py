# -*- coding: utf-8 -*-
"""عناصر مشترک صحنه‌ها: پس‌زمینه‌ی فضا، برچسب‌ها (chips)، خط راهنما، ذرات، لب‌خوانی فضانورد از روی صدا."""
import math, wave
from functools import lru_cache
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from .util import *
from .util import _cache
from .sprites import shaded, astronaut, toon_shade

# ------------------------------------------------------------------ صدا → لب‌خوانی
_env = None
def _load_env():
    global _env
    if _env is None:
        w = wave.open(str(ROOT / "build" / "narration.wav")); sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
        hop = sr // 100
        e = np.sqrt(np.convolve(x * x, np.ones(hop * 2) / (hop * 2), "same"))[::hop]
        _env = e / (np.percentile(e[e > 0.01], 92) if (e > 0.01).any() else 1.0)
    return _env

def mouth_at(t):
    e = _load_env(); i = int(t * 100)
    if i < 0 or i >= len(e) - 2: return 0.0
    v = float(np.mean(e[max(0, i - 3):i + 4]))
    return clamp((v - 0.12) * 1.5)

def speaking(t):
    e = _load_env(); i = int(t * 100)
    return 0 <= i < len(e) and float(np.mean(e[max(0, i - 15):i + 15])) > 0.08

def blink_at(t):
    ph = (t + 0.7) % 3.3
    return math.sin(math.pi * ph / 0.17) if ph < 0.17 else 0.0

# ------------------------------------------------------------------ فضا
@lru_cache(maxsize=2)
def space_base(tint=0):
    g = vgrad(H, [(0, (8, 10, 36)), (0.55, (22, 16, 70)), (1, (40, 20, 92))]) if tint == 0 else \
        vgrad(H, [(0, (10, 12, 40)), (1, (30, 18, 70))])
    img = np.repeat(g, W, axis=1).astype(np.float32)
    n = fbm_tile(256, 144, beta=2.2, seed=71, cutoff=14)
    n2 = fbm_tile(256, 144, beta=2.0, seed=72, cutoff=10)
    big = cv2.resize(n, (W, H), interpolation=cv2.INTER_CUBIC)[..., None]
    big2 = cv2.resize(n2, (W, H), interpolation=cv2.INTER_CUBIC)[..., None]
    img += np.clip(big - 0.55, 0, 1) * np.array([160, 70, 190], np.float32) * 0.9
    img += np.clip(big2 - 0.58, 0, 1) * np.array([50, 120, 230], np.float32) * 0.9
    return np.clip(img, 0, 255)

@lru_cache(maxsize=1)
def _stars():
    rng = np.random.default_rng(5)
    n = 320
    return dict(x=rng.uniform(0, W, n), y=rng.uniform(0, H, n), s=rng.choice([0, 1, 2], n, p=[.62, .28, .10]),
                ph=rng.uniform(0, 6.28, n), sp=rng.uniform(.6, 2.2, n), d=rng.uniform(.2, 1, n))

@lru_cache(maxsize=4)
def _star_k(s):
    r = (2, 3, 5)[s]
    y, x = np.mgrid[-r:r + 1, -r:r + 1].astype(np.float32)
    d = np.sqrt(x * x + y * y) / (r + .3)
    k = np.clip(1 - d, 0, 1) ** 1.5
    if s == 2:   # ستاره‌ی چهارپر
        k = np.maximum(k, np.clip(1 - np.abs(x) / (r + .5), 0, 1) ** 4 * np.clip(1 - np.abs(y) / 1.2, 0, 1) +
                       np.clip(1 - np.abs(y) / (r + .5), 0, 1) ** 4 * np.clip(1 - np.abs(x) / 1.2, 0, 1))
    return k, r

def space_bg(t, drift=18.0):
    img = space_base().copy()
    st = _stars()
    for i in range(len(st["x"])):
        k, r = _star_k(int(st["s"][i]))
        x = int((st["x"][i] - drift * t * st["d"][i]) % W); y = int(st["y"][i])
        tw = 0.55 + 0.45 * math.sin(t * st["sp"][i] * 2 + st["ph"][i])
        x0, x1, y0, y1 = max(x - r, 0), min(x + r + 1, W), max(y - r, 0), min(y + r + 1, H)
        if x1 <= x0 or y1 <= y0: continue
        kk = k[y0 - (y - r):y1 - (y - r), x0 - (x - r):x1 - (x - r)]
        img[y0:y1, x0:x1] += kk[..., None] * 255 * tw * (0.45 + 0.55 * st["d"][i])
    return np.clip(img, 0, 255)

def shooting_star(dst, t, t0, dur=0.7, p0=(1500, 160), p1=(700, 420)):
    if not (t0 <= t <= t0 + dur): return
    q = (t - t0) / dur
    x = lerp(p0[0], p1[0], q); y = lerp(p0[1], p1[1], q)
    for i in range(14):
        qq = max(q - i * 0.02, 0)
        glow(dst, lerp(p0[0], p1[0], qq), lerp(p0[1], p1[1], qq), 16 - i, (200, 230, 255), (1 - i / 14) * math.sin(math.pi * q))

# ------------------------------------------------------------------ برچسب‌ها (chips)
@lru_cache(maxsize=64)
def chip_sprite(text, color, size=54, h=92, pad=46, icon=None):
    ts = text_sprite(text, size, "xbold", fill=(255, 255, 255), stroke=3, stroke_fill=tuple(int(c * .35) for c in color),
                     shadow=(0, 0, 0, 90), shadow_off=(0, 3), shadow_blur=3, pad=4)
    w = ts.width + pad * 2 + (60 if icon else 0)
    ss = 3
    base = Image.new("RGBA", (w * ss + 30, h * ss + 30), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)
    # سایه
    d.rounded_rectangle((15, 15 + 10 * ss, w * ss + 15, h * ss + 15 + 10 * ss), h * ss // 2, fill=(0, 0, 0, 90))
    base = base.filter(ImageFilter.GaussianBlur(10))
    d = ImageDraw.Draw(base)
    dark = tuple(int(c * .62) for c in color); lite = tuple(min(255, int(c * 1.18 + 20)) for c in color)
    d.rounded_rectangle((15, 15, w * ss + 15, h * ss + 15), h * ss // 2, fill=dark + (255,))
    d.rounded_rectangle((15, 15, w * ss + 15, h * ss + 15 - 8 * ss), h * ss // 2, fill=color + (255,))
    d.rounded_rectangle((15 + 14 * ss, 15 + 7 * ss, w * ss + 15 - 14 * ss, 15 + h * ss * 0.42), h * ss // 4, fill=lite + (120,))
    d.rounded_rectangle((15, 15, w * ss + 15, h * ss + 15), h * ss // 2, outline=(255, 255, 255, 230), width=4 * ss // 2)
    base = base.resize((w + 10, h + 10), Image.LANCZOS)
    cx = base.width // 2 - (30 if icon else 0)
    base.alpha_composite(ts, (int(cx - ts.width / 2), int(base.height / 2 - ts.height / 2 - 4)))
    if icon:
        ic = icon_sprite(icon, 54)
        base.alpha_composite(ic, (base.width - 40 - 54, int(base.height / 2 - 27 - 3)))
    return base

@lru_cache(maxsize=8)
def icon_sprite(kind, s):
    ss = 4; im = Image.new("RGBA", (s * ss, s * ss), (0, 0, 0, 0)); d = ImageDraw.Draw(im); u = s * ss
    if kind == "flame":
        d.polygon([(u * .5, u * .04), (u * .82, u * .52), (u * .72, u * .9), (u * .5, u * .98), (u * .28, u * .9), (u * .18, u * .52), (u * .36, u * .62)], fill=(255, 120, 30, 255))
        d.polygon([(u * .5, u * .42), (u * .68, u * .72), (u * .6, u * .92), (u * .4, u * .92), (u * .32, u * .72)], fill=(255, 214, 70, 255))
    elif kind == "cube":
        d.polygon([(u * .5, u * .06), (u * .92, u * .28), (u * .5, u * .5), (u * .08, u * .28)], fill=(255, 245, 190, 255))
        d.polygon([(u * .08, u * .28), (u * .5, u * .5), (u * .5, u * .94), (u * .08, u * .72)], fill=(240, 190, 70, 255))
        d.polygon([(u * .92, u * .28), (u * .5, u * .5), (u * .5, u * .94), (u * .92, u * .72)], fill=(205, 140, 40, 255))
    return im.resize((s, s), Image.LANCZOS)

def draw_chip(dst, text, color, cx, cy, t, t0, size=54, icon=None, hold_wobble=True, scale=1.0, alpha=1.0):
    p = (t - t0)
    if p < 0: return
    k = ease_out_back(clamp(p / 0.45))
    a = clamp(p / 0.2) * alpha
    sp = chip_sprite(text, tuple(color), size, icon=icon)
    rot = 3 * math.sin(t * 1.6 + cx * .01) * (1 if hold_wobble else 0) * clamp(p / 1.0) + (1 - k) * -8
    blit_center(dst, sp, cx, cy + 3 * math.sin(t * 2.0 + cy * .02), scale=max(0.01, k * scale), alpha=a, rot=rot)

def draw_line_aa(dst, p0, p1, color=(255, 255, 255), width=4, alpha=1.0, dot=True, outline=(40, 24, 40)):
    x0, y0 = p0; x1, y1 = p1
    pad = 16
    bx0, by0 = int(min(x0, x1)) - pad, int(min(y0, y1)) - pad
    bw, bh = int(abs(x1 - x0)) + 2 * pad, int(abs(y1 - y0)) + 2 * pad
    if bw < 2 or bh < 2: return
    ss = 3
    im = Image.new("RGBA", (bw * ss, bh * ss), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    a = ((x0 - bx0) * ss, (y0 - by0) * ss); b = ((x1 - bx0) * ss, (y1 - by0) * ss)
    d.line([a, b], fill=outline + (255,), width=(width + 4) * ss)
    d.line([a, b], fill=tuple(color) + (255,), width=width * ss)
    if dot:
        r = (width + 5) * ss
        d.ellipse((b[0] - r, b[1] - r, b[0] + r, b[1] + r), fill=outline + (255,))
        r2 = (width + 2) * ss
        d.ellipse((b[0] - r2, b[1] - r2, b[0] + r2, b[1] + r2), fill=tuple(color) + (255,))
    im = im.resize((bw, bh), Image.LANCZOS)
    blit(dst, im, bx0, by0, alpha)

# ------------------------------------------------------------------ فضانورد در صحنه
def draw_astro(dst, t, x, y, scale=0.75, pose=None, rot=0.0, bob=True, shadow_glow=None, flip=False):
    # توجه: bob=False یعنی بدون نوسان خودکار
    p = dict(mouth=mouth_at(t), blink=blink_at(t), t=t)
    if pose: p.update(pose)
    if bob:
        y = y + 10 * math.sin(t * 1.9)
        rot = rot + 3.0 * math.sin(t * 1.3)
    img, (ox, oy) = astronaut(p, 1.0)
    if rot:
        img = img.rotate(rot, Image.BICUBIC, center=(ox, oy))
    if flip:
        img = img.transpose(Image.FLIP_LEFT_RIGHT); ox = img.width - ox
    img = img.resize((int(img.width * scale), int(img.height * scale)), Image.BICUBIC)
    if shadow_glow:
        glow(dst, x, y - 60 * scale, 330 * scale, shadow_glow[0], shadow_glow[1])
    blit(dst, img, x - ox * scale, y - oy * scale)

# ------------------------------------------------------------------ نام دانش‌آموز (ثابت، همه‌ی فریم‌ها)
def name_label():
    from script_data import STUDENT_NAME
    return text_sprite(STUDENT_NAME, 40, "bold", fill=(255, 255, 255), shadow=(10, 8, 30, 235),
                       shadow_off=(0, 3), shadow_blur=3.5, pad=20)

NAME_POS_RIGHT = 62   # فاصله از لبه‌ی راست
NAME_POS_TOP = 34

def draw_name(dst):
    spr = name_label()
    # گرادیان بسیار ملایم تیره در گوشه برای خوانایی روی هر پس‌زمینه
    key = "name_shade"
    if key not in _cache:
        y, x = np.mgrid[0:200, 0:700].astype(np.float32)
        d = np.sqrt(((x - 700) / 520) ** 2 + ((y + 10) / 150) ** 2)
        _cache[key] = (1 - 0.46 * np.clip(1 - d, 0, 1) ** 1.0)[..., None]
    sh = _cache[key]
    dst[0:200, W - 700:W] *= sh
    blit(dst, spr, W - NAME_POS_RIGHT - spr.width + 20, NAME_POS_TOP - 20)

def draw_state(dst, t, st):
    x, y, sc, pose_, rot, gl = st
    draw_astro(dst, t, x, y, sc, pose_, rot=rot, shadow_glow=gl)
