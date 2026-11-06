# -*- coding: utf-8 -*-
"""صحنه‌های ۴ و ۵: هسته‌ی خارجی (فلز مایع در گردش) و هسته‌ی داخلی (کره‌ی جامد و درخشان)."""
import math
import cv2
import numpy as np
from PIL import Image, ImageDraw
from .util import *
from .util import _cache
from .common import *
from .sprites import shaded, toon_shade

LW, LH = 480, 270   # رزولوشن محاسبه‌ی مایع (سپس بزرگ می‌شود)
RAMP = [(0.0, (176, 38, 22)), (0.25, (232, 84, 18)), (0.5, (255, 138, 20)), (0.75, (255, 190, 40)), (1.0, (255, 240, 150))]

def _sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def liquid(t, cx, cy, swirl=1.6, speed=1.0, dark=0.0, levels=6):
    """فلز مایع در گردش: نویز با اعوجاج دامنه + چرخش گردابی + پله‌پله‌سازی کارتونی"""
    ys, xs = np.mgrid[0:LH, 0:LW].astype(np.float32)
    ux = (xs - cx * LW / W); uy = (ys - cy * LH / H)
    r = np.sqrt(ux * ux + uy * uy) + 1e-3
    ang = np.arctan2(uy, ux) + swirl * np.exp(-r / 150.0) * 1.0 + t * 0.35 * speed * np.exp(-r / 220.0)
    sx = cx * LW / W + r * np.cos(ang); sy = cy * LH / H + r * np.sin(ang)
    n1 = fbm_tile(256, 256, beta=2.6, seed=61, cutoff=12)
    n2 = fbm_tile(256, 256, beta=2.4, seed=62, cutoff=18)
    wx = tile_sample(n2, sx * 0.55 + t * 9 * speed, sy * 0.55 - t * 6 * speed)
    wy = tile_sample(n2, sx * 0.55 - t * 7 * speed + 80, sy * 0.55 + t * 8 * speed)
    v = tile_sample(n1, sx * 0.50 + (wx - .5) * 70, sy * 0.50 + (wy - .5) * 70)
    v = cv2.GaussianBlur(v, (0, 0), 1.3)
    v = np.clip((v - 0.30) * 2.2, 0, 1)
    q = np.floor(v * levels) / levels
    pos = [p for p, _ in RAMP]
    col = np.stack([np.interp(q * 0.92 + 0.04, pos, [c[i] for _, c in RAMP]) for i in range(3)], -1).astype(np.float32)
    # خطوط کانتور
    f = v * levels; edge = np.abs(f - np.round(f)) < 0.05
    col = np.where(edge[..., None], col * 0.82, col)
    col = col * (1 - dark)
    big = cv2.GaussianBlur(cv2.resize(col, (W, H), interpolation=cv2.INTER_CUBIC), (0, 0), 1.2)
    return big

def droplet(r, col):
    return shaded(int(r * 2), int(r * 2), col, spec=0.95, outline=0.55)

def sweat_flame_pose(t, base):
    return base

# ----------------------------------------------------------------------- صحنه‌ی ۴
IRON = (150, 170, 205); NICKEL = (112, 200, 170)

def scene_outer(t, astro=False):
    img = liquid(t, 1500, 1050, swirl=1.7)
    # گردابی تیره در پایین برای عمق + وینیت
    glow(img, 1500, 1100, 700, (255, 120, 30), 0.25)
    # قطره‌های فلزی (پس‌زمینه‌ی کوچک)
    rng = np.random.default_rng(15)
    for i in range(18):
        cx, cy = 1500, 1050
        r0 = rng.uniform(230, 1100); a0 = rng.uniform(0, 6.28); rad = rng.uniform(10, 34)
        ang = a0 + t * (0.55 * math.exp(-r0 / 800.0) + 0.06)
        x = cx + r0 * math.cos(ang) * 1.25; y = cy + r0 * math.sin(ang) * 0.62 - 30
        if not (-50 < x < W + 50 and -50 < y < H + 50): continue
        col = (IRON, NICKEL, (205, 215, 230))[i % 3]
        blit_center(img, droplet(rad, col), x, y, alpha=0.95)
    # ---- آهن و نیکل: دو قطره‌ی بزرگ نمایشی
    show = t >= 37.5
    for (name, col, x0, y0, t0, ph) in (("آهن", IRON, 1160, 430, 37.35, 0.0), ("نیکل", NICKEL, 1430, 520, 37.85, 1.7)):
        if t < t0 - 0.6: continue
        k = ease_out_back(clamp((t - (t0 - 0.5)) / 0.6))
        x = x0 + 14 * math.sin(t * 1.3 + ph); y = y0 + 16 * math.sin(t * 1.7 + ph)
        glow(img, x, y, 150, col, 0.35 * k)
        blit_center(img, droplet(78, col), x, y, scale=k, alpha=1 - smooth(prog(t, 42.8, 43.6)))
        draw_chip(img, name, tuple(int(c * .85) for c in col), x, y + 130, t, t0, 54, alpha=1 - smooth(prog(t, 42.8, 43.6)))
    # ---- برچسب هسته خارجی
    draw_chip(img, "هسته خارجی", (238, 142, 18), 1480, 235, t, 34.35, 58, alpha=1 - smooth(prog(t, 43.0, 43.8)))
    if astro: draw_state(img, t, astro_state_outer(t))
    # لبه‌ی دید داغ
    vignette(img, 0.55)
    # کره‌ی هسته‌ی داخلی در انتها (پیش‌نمایش)
    rise = smooth(prog(t, 41.5, 45.0))
    if rise > 0:
        R = 560
        cy = lerp(1500, 1180, rise)
        glow(img, 1450, cy, R * 1.6, (255, 220, 100), 0.55 * rise)
        spr = inner_sphere(R, t, facets=False)
        blit_center(img, spr, 1450, cy)
    return img

# ----------------------------------------------------------------------- هسته‌ی داخلی
@lru_cache(maxsize=1)
def _ico_dirs():
    phi = (1 + 5 ** .5) / 2
    v = []
    for a in (-1, 1):
        for b in (-phi, phi):
            v += [(0, a, b), (a, b, 0), (b, 0, a)]
    v = np.array(v, np.float32); v /= np.linalg.norm(v, axis=1, keepdims=True)
    # مرکز وجه‌های بیست‌وجهی (دوگان): دوازده‌وجهی منتظم
    return v

def inner_sphere(R, t, facets=True):
    """کره‌ی طلایی جامد: سایه‌ی کارتونی + وجه‌های بلورین چرخان"""
    key = ("inner", int(R), int(t * 12) % 120, facets)
    n = int(R * 2)
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    u = (xs + .5 - R) / R; v = (ys + .5 - R) / R
    r2 = u * u + v * v; inside = r2 <= 1
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    N = np.stack([u, v, z], -1)
    base = np.array((255, 196, 42), np.float32)
    if facets:
        a = t * 0.5; c, s = math.cos(a), math.sin(a)
        Rm = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], np.float32)
        Nr = N @ Rm.T
        D = _ico_dirs()
        dots = Nr @ D.T                       # (n,n,12)
        top2 = np.sort(dots, axis=-1)[..., -2:]
        fid = np.argmax(dots, axis=-1)
        # لبه‌ی وجه‌ها
        edge = (top2[..., 1] - top2[..., 0]) < 0.045
        # نرمال تخت هر وجه (در فضای دوربین)
        Nf = (D[fid] @ Rm)
        Nm = Nf * 0.55 + N * 0.45
        Nm /= np.maximum(np.linalg.norm(Nm, axis=-1, keepdims=True), 1e-6)
        tint = 0.86 + 0.28 * ((fid * 37) % 7) / 7.0
        col = toon_shade(base, Nm * np.array([1, 1, 1], np.float32), spec=0.0, rim_k=0.3)
        col = col * tint[..., None]
        col = np.where(edge[..., None], col * 0.72 + np.array((90, 40, 0), np.float32) * 0.1, col)
    else:
        col = toon_shade(base, N, spec=0.8, rim_k=0.3)
    # لبه‌ی تیره
    rr = np.sqrt(r2)
    col = col * (1 - 0.5 * _sstep(0.965, 0.995, rr))[..., None]
    alpha = (np.clip((1 - rr) * R, 0, 1) * 255)
    return np.dstack([np.clip(col, 0, 255), alpha]).astype(np.float32)

def sparkles(img, t, cx, cy, R, n=14, t0=0):
    rng = np.random.default_rng(33)
    for i in range(n):
        a = rng.uniform(0, 6.28); rr = R * rng.uniform(0.2, 1.25); ph = rng.uniform(0, 6.28); sp = rng.uniform(1.5, 3.5)
        x = cx + rr * math.cos(a) * 1.0; y = cy + rr * math.sin(a)
        tw = max(0, math.sin(t * sp + ph)) ** 3
        if tw < 0.05: continue
        s = 9 + 16 * tw
        _star4(img, x, y, s, tw)

def _star4(img, x, y, s, a):
    pts = np.array([[x, y - s], [x + s * .22, y - s * .22], [x + s, y], [x + s * .22, y + s * .22],
                    [x, y + s], [x - s * .22, y + s * .22], [x - s, y], [x - s * .22, y - s * .22]], np.int32)
    ov = img[int(max(y - s - 2, 0)):int(min(y + s + 2, H)), int(max(x - s - 2, 0)):int(min(x + s + 2, W))]
    if ov.size == 0: return
    sub = np.ascontiguousarray(ov)
    pts2 = pts - np.array([int(max(x - s - 2, 0)), int(max(y - s - 2, 0))], np.int32)
    tmp = sub.copy(); cv2.fillConvexPoly(tmp, pts2, (255, 255, 240), lineType=cv2.LINE_AA)
    img[int(max(y - s - 2, 0)):int(min(y + s + 2, H)), int(max(x - s - 2, 0)):int(min(x + s + 2, W))] = sub * (1 - a) + tmp * a

def scene_inner(t, astro=False):
    k_in = smooth(prog(t, 45.0, 46.0))
    img = liquid(t, 1180, 560, swirl=0.9, speed=0.7, dark=0.30)
    # ریشه‌ی تدریجی: هاله‌ی مرکزی گرم
    cx, cy, R = 1140, 540, 270 + 6 * math.sin(t * 1.5)
    glow(img, cx, cy, R * 2.9, (255, 200, 80), 0.75)
    glow(img, cx, cy, R * 1.7, (255, 240, 170), 0.55)
    # حلقه‌های پالسی گرما
    for i in range(3):
        ph = (t * 0.45 + i / 3.0) % 1.0
        rr = R * (1.1 + 1.0 * ph)
        a = (1 - ph) * 0.55
        ring = np.zeros((int(rr * 2 + 30), int(rr * 2 + 30), 4), np.float32)
        cv2.circle(ring, (ring.shape[1] // 2, ring.shape[0] // 2), int(rr), (255, 230, 150, 255 * a), 6, cv2.LINE_AA)
        blit(img, ring, cx - ring.shape[1] / 2, cy - ring.shape[0] / 2)
    spr = inner_sphere(R, t, facets=True)
    # ورود کره: بزرگ‌نمایی از پایین
    sc = lerp(1.35, 1.0, smoother(prog(t, 45.0, 47.0)))
    blit_center(img, spr, cx, cy + lerp(130, 0, smoother(prog(t, 45.0, 47.0))), scale=sc)
    sparkles(img, t, cx, cy, R, n=18)
    # برچسب‌ها
    draw_chip(img, "هسته داخلی", (232, 176, 16), 1480, 190, t, 46.8, 58)
    draw_chip(img, "داغ", (232, 70, 40), 1660, 780 - 250, t, 49.2, 54, icon="flame")
    draw_chip(img, "جامد", (70, 140, 230), 1670, 780 - 130, t, 49.5, 54, icon="cube")
    for (name, col, x, y, t0) in (("آهن", IRON, 880, 800, 50.9), ("نیکل", NICKEL, 1180, 830, 51.45)):
        pass
    draw_chip(img, "آهن", tuple(int(c * .85) for c in IRON), 840, 850, t, 50.85, 50)
    draw_chip(img, "نیکل", tuple(int(c * .85) for c in NICKEL), 1090, 860, t, 51.3, 50)
    if astro: draw_state(img, t, astro_state_inner(t))
    vignette(img, 0.4)
    return img

from functools import lru_cache  # noqa


def astro_state_outer(t):
    sw = smooth(prog(t, 34.5, 35.5))
    pose_ = dict(flame=0.5 + 0.2 * math.sin(t * 3), arm_l=lerp(10, 150, pulse(t, 37.0, 3)), arm_r=lerp(14, 60, sw) + 12 * math.sin(t * 4),
                 sweat=(t * 0.8) % 1.0 * sw, wow=0.6 * sw, happy=0.3, leg=5 * math.sin(t * 6), look_y=0.3)
    return 480, 600, 0.85, pose_, -4, ((255, 180, 90), 0.12)

def astro_state_inner(t):
    ap = smooth(prog(t, 45.0, 46.4))
    pose_ = dict(arm_r=lerp(40, 95 + 6 * math.sin(t * 2), smooth(prog(t, 46, 47))), arm_l=lerp(30, 12, ap), wow=0.8 * pulse(t, 45.5, 3.0),
                 flame=0.35, sweat=0.0 if t > 49 else (t * .8) % 1 * (1 - ap), happy=1, look=0.5, leg=4 * math.sin(t * 5))
    return 450, 620, 0.85, pose_, 0.0, ((255, 220, 140), 0.12)
