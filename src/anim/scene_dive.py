# -*- coding: utf-8 -*-
"""صحنه‌ی ۳: فرود از سطح به پوسته و گوشته (برش جانبی با پارالکس، حباب‌های ماگمای کارتونی، جریان همرفتی)."""
import math
import cv2
import numpy as np
from PIL import Image, ImageDraw
from .util import *
from .util import _cache
from .common import *
from .sprites import shaded, toon_shade

CREST_Y = 330           # ضخامت شماتیک پوسته (متر مجازی)
AX, AY = 430, 560       # جای فضانورد روی صفحه

def cam_y(t):
    """مختصات عمودی دوربین در جهان (۰ = سطح زمین)"""
    a = lerp(-170, -130, smooth(prog(t, 18, 21.9)))
    b = lerp(a, 330, smoother(prog(t, 21.9, 24.6)))
    c = lerp(b, 720, smooth(prog(t, 24.6, 28.0)))
    return lerp(c, 880, smooth(prog(t, 28.0, 33.2)))

def ground_y(x):
    return 26 * np.sin(x * 0.0055 + 1.0) + 13 * np.sin(x * 0.0171 + 2.0)

def moho_y(x):
    return CREST_Y + 22 * np.sin(x * 0.006 + 0.5) + 10 * np.sin(x * 0.019)

STRATA = [(96, 160, 64), (150, 100, 56), (176, 120, 68), (128, 86, 52), (190, 138, 84), (112, 76, 48), (160, 108, 62)]

def world_layers(cam, t):
    """تصویر زمینه (آسمان/پوسته/گوشته) به‌صورت آرایه‌ی float32"""
    ys = (np.arange(H, dtype=np.float32) - 450 + cam)[:, None]     # مختصات جهان برای هر ردیف
    xs = np.arange(W, dtype=np.float32)[None, :]
    g = ground_y(xs); m = moho_y(xs)
    out = np.zeros((H, W, 3), np.float32)
    # --- آسمان
    sky = vgrad(H, [(0, (70, 160, 255)), (0.55, (150, 215, 255)), (1, (215, 242, 255))])
    # پارالکس: آسمان بسیار کند حرکت می‌کند
    sky_shift = int(np.clip((cam + 170) * 0.15, -200, 200))
    out[:] = np.roll(np.repeat(sky, W, 1), sky_shift, axis=0)
    # --- پوسته (طبقات)
    depth = ys - g
    in_crust = (depth >= 0) & (ys < m)
    band_h = 62.0
    wob = 10 * np.sin(xs * 0.012 + depth * 0.02) + 6 * np.sin(xs * 0.031)
    bi = np.floor((depth + wob) / band_h).astype(np.int32) % len(STRATA)
    pal = np.array(STRATA, np.float32)
    crust = pal[bi]
    # بافت دانه‌دار
    nz = tile_sample(fbm_tile(512, 512, beta=2.0, seed=41, cutoff=120), xs + 0 * ys, ys * 1.0 + 0 * xs + cam * 0)
    nz = tile_sample(fbm_tile(512, 512, beta=2.0, seed=41, cutoff=120), (xs + 0 * ys).astype(np.float32), (ys + 0 * xs).astype(np.float32))
    crust = crust * (0.86 + 0.28 * nz[..., None])
    # خط تیره‌ی بین طبقه‌ها
    fr = ((depth + wob) % band_h) / band_h
    crust = crust * (1 - 0.18 * _sstep(0.94, 1.0, fr)[..., None]) 
    out = np.where(in_crust[..., None], crust, out)
    # --- گوشته
    mm = ys >= m
    dd = np.clip((ys - m) / 900.0, 0, 1)[..., None]
    base = np.array((226, 62, 40), np.float32) * (1 - dd) + np.array((255, 120, 32), np.float32) * dd
    sw = tile_sample(fbm_tile(512, 512, beta=2.1, seed=51, cutoff=30), xs * 0.55 + t * 18 + 0 * ys + 30 * np.sin(ys * 0.004 + t * 0.7), ys * 0.55 - t * 12)
    sw2 = tile_sample(fbm_tile(512, 512, beta=2.0, seed=52, cutoff=60), xs * 0.9 - t * 30, ys * 0.9 + t * 10)
    q = np.floor(sw * 5.0) / 5.0
    mant = base * (0.78 + 0.5 * q[..., None]) + np.array((30, 38, 6), np.float32) * (sw2 > 0.62)[..., None]
    # خطوط بیرونی کانتور برای حس کارتونی
    edge = np.abs(sw * 5.0 - np.round(sw * 5.0)) < 0.045
    mant = np.where(edge[..., None], mant * 0.86, mant)
    # گرادیان حرارتی نزدیک مرز پوسته
    mant = mant + np.array((50, 25, 0), np.float32) * np.exp(-np.maximum(ys - m, 0) / 90.0)[..., None]
    out = np.where(mm[..., None], mant, out)
    return out

def _sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def sprite_tree(h=1.0):
    key = ("tree", round(h, 2))
    if key not in _cache:
        W_, H_ = int(120 * h), int(170 * h)
        im = Image.new("RGBA", (W_, H_), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        d.rounded_rectangle((W_ // 2 - 10 * h, H_ * .5, W_ // 2 + 10 * h, H_ - 2), 6, fill=(120, 76, 42, 255))
        can = shaded(int(112 * h), int(112 * h), (70, 180, 84), spec=0.5)
        im.alpha_composite(can, (int((W_ - can.width) / 2), 0))
        _cache[key] = im
    return _cache[key]

def sprite_house():
    key = "house"
    if key not in _cache:
        im = Image.new("RGBA", (210, 190), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        wall = shaded(150, 100, (250, 226, 170), n=5, spec=0.2, outline=0.35)
        im.alpha_composite(wall, (30, 80))
        roof = Image.new("RGBA", (210, 190), (0, 0, 0, 0)); rd = ImageDraw.Draw(roof)
        rd.polygon([(15, 88), (105, 12), (195, 88)], fill=(222, 70, 66, 255), outline=(120, 30, 40, 255))
        rd.polygon([(105, 12), (195, 88), (160, 88), (105, 36)], fill=(190, 52, 56, 255))
        im.alpha_composite(roof)
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((92, 124, 122, 180), 6, fill=(120, 76, 50, 255))
        d.rounded_rectangle((46, 108, 78, 140), 5, fill=(150, 220, 255, 255), outline=(90, 60, 40, 255), width=3)
        d.rounded_rectangle((136, 108, 168, 140), 5, fill=(150, 220, 255, 255), outline=(90, 60, 40, 255), width=3)
        _cache[key] = im
    return _cache[key]

def sprite_cloud(k=0):
    key = ("cloud", k)
    if key not in _cache:
        im = Image.new("RGBA", (300, 150), (0, 0, 0, 0))
        for (x, y, r) in ((70, 80, 48), (120, 60, 56), (180, 78, 50), (225, 88, 38), (150, 95, 52)):
            s = shaded(r * 2, r * 2, (252, 253, 255), spec=0.0, outline=0.0, rim_k=0.0)
            im.alpha_composite(s, (x - r, y - r))
        _cache[key] = im
    return _cache[key]

def draw_sky_decor(img, cam, t):
    # خورشید
    sx, sy = 1290, 190 - (cam + 170) * 0.12
    glow(img, sx, sy, 230, (255, 240, 170), 0.55)
    s = shaded(110, 110, (255, 222, 90), spec=0.0, outline=0.15, rim_k=0.0)
    blit_center(img, s, sx, sy)
    # ابرها
    for i, (bx, by, sc, sp) in enumerate(((200, 150, 0.9, 14), (760, 90, 1.1, 10), (1220, 210, 0.8, 18), (1700, 60, 0.7, 12))):
        x = (bx + sp * t) % (W + 400) - 200
        y = by - (cam + 170) * 0.3
        # ابرها در ناحیه‌ی نام دانش‌آموز (بالا-راست) کم‌رنگ می‌شوند تا نام کاملاً خوانا بماند
        zone = smooth(prog(x, 1330, 1450)) * (1 - smooth(prog(y, 150, 260)))
        blit_center(img, sprite_cloud(i), x, y, scale=sc, alpha=0.95 * (1 - 0.92 * zone))

def draw_surface_decor(img, cam):
    # درخت و خانه روی تپه‌ها (با سطح هم‌حرکت‌اند)
    items = [("tree", 90, .9), ("house", 280, 1), ("tree", 520, 1.1), ("tree", 640, .8), ("house", 1010, 1), ("tree", 1180, 1.0),
             ("tree", 1300, .85), ("tree", 1700, 1.1), ("tree", 1840, .8)]
    for kind, x, sc in items:
        gy = float(ground_y(np.array([x], np.float32))[0])
        sy = gy - cam + 450
        if sy < -250 or sy > H + 100: continue
        if kind == "tree":
            spr = sprite_tree(sc)
            blit(img, spr, x - spr.width / 2, sy - spr.height + 12)
        else:
            blit(img, sprite_house(), x - 105, sy - 175)

def draw_pebbles(img, cam):
    rng = np.random.default_rng(3)
    for i in range(46):
        x = rng.uniform(0, W); wy = rng.uniform(25, CREST_Y - 20)
        gy = float(ground_y(np.array([x], np.float32))[0])
        sy = gy + wy - cam + 450
        if sy < -50 or sy > H + 50: continue
        r = rng.uniform(10, 26)
        col = [(120, 120, 140), (205, 200, 190), (92, 70, 62), (232, 188, 104)][i % 4]
        if i % 9 == 0: col = [(90, 220, 235), (255, 130, 190), (140, 240, 150)][(i // 9) % 3]
        spr = shaded(int(r * 2.0), int(r * 1.5), col, n=2.4, spec=0.6)
        blit_center(img, spr, x, sy)
        if i % 9 == 0:
            glow(img, x, sy, 40, col, 0.35 + 0.2 * math.sin(i + 0))

# ---------- حباب‌های ماگما و جریان همرفتی
def blobs(img, cam, t):
    rng = np.random.default_rng(21)
    for i in range(16):
        cx0 = rng.uniform(200, 1800); cy0 = rng.uniform(CREST_Y + 220, CREST_Y + 1500)
        r = rng.uniform(34, 84); depth = rng.uniform(0.6, 1.2)
        ph = rng.uniform(0, 6.28); sp = rng.uniform(0.25, 0.55)
        # مسیر بیضوی آرام (همرفت)
        x = cx0 + 90 * math.cos(t * sp + ph); y = cy0 + 70 * math.sin(t * sp + ph)
        sy = (y - cam) * depth + 450 + (cam - 330) * (1 - depth) * 0 
        sy = y - cam + 450
        if sy < -100 or sy > H + 100: continue
        col = [(255, 140, 50), (255, 96, 40), (255, 180, 70)][i % 3]
        spr = shaded(int(r * 2 * depth), int(r * 2 * depth), col, spec=0.7)
        glow(img, x, sy, r * 1.9 * depth, (255, 160, 50), 0.35)
        blit_center(img, spr, x, sy, alpha=0.94)

def convection_arrows(img, cam, t, vis):
    """پیکان‌های رونده روی دو حلقه‌ی همرفتی (جهت‌ها مخالف)"""
    if vis <= 0.01: return
    loops = [((1010, 960), (300, 190), 1), ((1560, 960), (260, 190), -1)]
    ss = 2
    for (cx, cy), (rx, ry), dirn in loops:
        for k in range(10):
            ph = (t * 0.10 * dirn + k / 10.0) % 1.0
            a = ph * 2 * math.pi
            x = cx + rx * math.cos(a); y = cy + ry * math.sin(a)
            # مماس
            tx, ty = -rx * math.sin(a) * dirn, ry * math.cos(a) * dirn
            L = math.hypot(tx, ty); tx, ty = tx / L, ty / L
            sy = y - cam + 450
            if not (-60 < sy < H + 60): continue
            ang = math.degrees(math.atan2(ty, tx))
            arr = _arrow_sprite()
            blit_center(img, arr, x, sy, scale=1.0, alpha=0.9 * vis, rot=-ang)

def _arrow_sprite():
    key = "arrow"
    if key not in _cache:
        s = 4; im = Image.new("RGBA", (90 * s, 70 * s), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        pts = [(8, 20), (46, 20), (46, 6), (84, 35), (46, 64), (46, 50), (8, 50)]
        d.polygon([(x * s, y * s) for x, y in pts], fill=(255, 255, 255, 235), outline=(120, 30, 20, 255))
        d.line([(x * s, y * s) for x, y in pts + [pts[0]]], fill=(120, 30, 20, 255), width=3 * s)
        _cache[key] = im.resize((90, 70), Image.LANCZOS)
    return _cache[key]

def dust(img, t, cam, fast):
    """ذرات بوکه‌ی جلوی صحنه برای حس عمق"""
    rng = np.random.default_rng(9)
    for i in range(34):
        x = rng.uniform(0, W); y0 = rng.uniform(0, H); sp = rng.uniform(.6, 1.8); r = rng.uniform(3, 11)
        y = (y0 - cam * sp * 0.9 + t * 8 * sp) % (H + 60) - 30
        col = (255, 230, 180) if cam > 300 else (255, 255, 255)
        glow(img, x + 10 * math.sin(t + i), y, r * 2.2, col, 0.25 + 0.2 * rng.random())

def scene_dive(t, astro=False):
    cam = cam_y(t)
    img = world_layers(cam, t)
    if cam < 250:
        draw_sky_decor(img, cam, t)
    draw_surface_decor(img, cam)
    draw_pebbles(img, cam)
    # لایه‌ی نور در گوشته
    mix_m = smooth(prog(cam, 250, 700))
    blobs(img, cam, t)
    convection_arrows(img, cam, t, smooth(prog(t, 26.6, 27.6)))
    dust(img, t, cam, 0)
    # مرز پوسته/گوشته: خط درخشان
    if astro: draw_state(img, t, astro_state(t))
    # --- برچسب‌ها
    # پوسته
    if 18.5 <= t < 22.6:
        y_mid = (ground_y(np.array([1600], np.float32))[0] + CREST_Y / 2) - cam + 450
        y_top = ground_y(np.array([1600], np.float32))[0] - cam + 450
        y_bot = moho_y(np.array([1600], np.float32))[0] - cam + 450
        al = (1 - smooth(prog(t, 21.9, 22.5)))
        # آکولاد عمودی
        pk = ease_out(clamp((t - 18.5) / 0.6))
        draw_line_aa(img, (1830, y_top), (1830, lerp(y_top, y_bot, pk)), (255, 255, 255), 6, alpha=al, dot=False)
        draw_chip(img, "پوسته", (170, 104, 58), 1560, y_mid, t, 18.5, 60, alpha=al)
    if t >= 22.5:
        draw_chip(img, "گوشته", (228, 72, 40), 470, 190, t, 22.5, 60)
    return img


def astro_state(t):
    diving = smooth(prog(t, 22.0, 23.0)) * (1 - 0.6 * smooth(prog(t, 27.5, 29)))
    pose_ = dict(flame=0.45 + 0.55 * diving, arm_l=lerp(14, 30, diving),
                 arm_r=lerp(110 + 20 * math.sin(t * 7) if t < 21.4 else 14, 40, diving),
                 look_y=0.5 * diving, leg=6 * math.sin(t * 9) * diving, wow=0.5 * pulse(t, 23.0, 2.0), happy=1)
    if 18.9 < t < 21.8:
        pose_["arm_r"] = 120 + 22 * math.sin(t * 7)
    ay = AY - 40 * (1 - smooth(prog(t, 18, 19.2)))
    return AX, ay, 0.85, pose_, -6 * diving, None
