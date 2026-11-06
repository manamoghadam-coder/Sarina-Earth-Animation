# -*- coding: utf-8 -*-
"""صحنه‌های ۱ و ۲ و ۶: زمین در فضا، باز شدن برش گوه‌ای، چهار لایه و جمع‌بندی."""
import math
import numpy as np
from .util import *
from .util import _cache
from .common import *
from .earth import render_earth, atmosphere_sprite, rot_matrix
from .sprites import shaded
from PIL import Image, ImageDraw

CX_F, CY_F, R_F = 990, 520, 335
YAW_F, TILT_F = -0.20, 0.18
NAME_T = [10.90, 11.42, 11.98, 13.05]   # آغاز واژه‌ها در گفتار (از روی انرژی صدا)
LAYERS = [("پوسته", (170, 104, 58)), ("گوشته", (228, 72, 40)), ("هسته خارجی", (238, 142, 18)), ("هسته داخلی", (232, 176, 16))]
CHIP_POS = [(1600, 262), (1610, 422), (1620, 582), (1620, 742)]
ANCH = {0: (0.945, 52), 1: (0.74, 24), 2: (0.45, -4), 3: (0.15, -22)}   # شعاع نرمال، زاویه‌ی روی وجه (درجه)

def face_anchor(k, cx, cy, R, yaw, tilt):
    M, Rc = rot_matrix(yaw, tilt)
    r, a = ANCH[k]; a = math.radians(a)
    E = np.array([r * math.cos(a), r * math.sin(a), 0.0], np.float32)     # d1=(1,0,0) , y بالا
    c = Rc @ E
    return cx + R * float(c[0]), cy - R * float(c[1])

def spin(t):
    return 0.6 + 0.36 * t

def pose(t):
    """(cx, cy, R, yaw, tilt, theta) برای t در صحنه‌های ۱، ۲ و ۶"""
    if t >= 53.0:   # صحنه‌ی ۶
        k = smoother(prog(t, 53.6, 55.4))
        R = R_F * (1.0 + 0.10 * (1 - k))
        return CX_F, CY_F, R, YAW_F + 0.05 * math.sin(t * 0.8), TILT_F, math.pi / 2
    e1 = smoother(prog(t, 8.0, 9.4))
    cx = lerp(1130, CX_F, e1); cy = lerp(600, CY_F, e1)
    R = lerp(270 + 3.0 * t, R_F, e1)
    w = smoother(prog(t, 9.3, 11.9))
    yaw_t = YAW_F + 2 * math.pi
    yaw = lerp(spin(t), yaw_t, w) if t < 11.9 else yaw_t + 0.05 * math.sin((t - 11.9) * 0.8)
    tilt = lerp(0.40, TILT_F, w)
    theta = (math.pi / 2) * smoother(prog(t, 9.5, 11.5))
    # لرزش دوربین هنگام باز شدن
    sh = math.sin((t - 9.5) * 60) * 5 * pulse(t, 9.5, 1.4) if 9.5 < t < 10.9 else 0
    return cx + sh, cy + sh * .6, R, yaw, tilt, theta

def sparkle_burst(dst, t, t0, cx, cy, n=36, speed=420, dur=1.4, colors=((255, 240, 150), (255, 190, 90), (255, 255, 255))):
    q = t - t0
    if not (0 <= q <= dur): return
    rng = np.random.default_rng(7)
    for i in range(n):
        a = rng.uniform(0, 2 * math.pi); sp = rng.uniform(.4, 1.0) * speed; c = colors[i % len(colors)]
        r = sp * (1 - math.exp(-q * 3)) / 3
        x = cx + math.cos(a) * r; y = cy + math.sin(a) * r + 90 * q * q
        s = int(10 + 10 * rng.random()) * (1 - q / dur)
        glow(dst, x, y, max(4, s), c, (1 - q / dur) ** 1.2)

def draw_moon(dst, t):
    a = 1 - smooth(prog(t, 7.6, 9.0))
    if a <= 0.01: return
    key = "moon"
    if key not in _cache:
        m = shaded(130, 130, (210, 214, 232), spec=0.2).copy()
        d = ImageDraw.Draw(m)
        for (x, y, r) in ((44, 40, 14), (84, 62, 10), (58, 86, 8), (92, 30, 6)):
            d.ellipse((x - r, y - r, x + r, y + r), fill=(160, 166, 196, 255))
            d.ellipse((x - r + 2, y - r + 3, x + r - 2, y + r - 1), fill=(178, 184, 210, 255))
        _cache[key] = m
    x = 250 - 40 * smooth(prog(t, 7.6, 9)); y = 255 + 6 * math.sin(t * .8)
    glow(dst, x, y, 120, (200, 210, 255), 0.35 * a)
    blit_center(dst, _cache[key], x, y, alpha=a)

def draw_title(dst, t):
    from script_data import TITLE
    p = t - 0.3
    if p < 0 or t > 7.9: return
    k = ease_out_back(clamp(p / 0.8)); a = clamp(p / 0.4) * (1 - smooth(prog(t, 6.9, 7.8)))
    spr = text_sprite(TITLE, 96, "xbold", fill=(255, 255, 255), stroke=9, stroke_fill=(32, 22, 96),
                      shadow=(0, 0, 0, 150), shadow_off=(0, 8), shadow_blur=8, grad=((255, 244, 160), (255, 176, 40)), pad=30)
    yy = 190 + 6 * math.sin(t * 1.8)
    glow(dst, 960, yy, 520, (120, 90, 255), 0.22 * a)
    blit_center(dst, spr, 960, yy, scale=k, alpha=a, rot=-1.5 * (1 - k))

END_T = 57.9

def draw_end_text(dst, t):
    from script_data import END_TEXT
    p = t - END_T
    if p < 0: return
    k = ease_out_back(clamp(p / 0.7)); a = clamp(p / 0.3)
    spr = text_sprite(END_TEXT, 78, "xbold", fill=(255, 255, 255), stroke=8, stroke_fill=(32, 22, 96),
                      shadow=(0, 0, 0, 150), shadow_off=(0, 7), shadow_blur=8, grad=((255, 244, 160), (255, 176, 40)), pad=28)
    glow(dst, 960, 150, 560, (255, 180, 80), 0.18 * a)
    blit_center(dst, spr, 960, 150 + 5 * math.sin(t * 2), scale=k, alpha=a)

def scene_earth(t, astro=False):
    img = space_bg(t)
    cx, cy, R, yaw, tilt, theta = pose(t)
    # نور خورشید/هاله
    glow(img, cx - R * 0.6, cy - R * 0.7, R * 2.1, (255, 190, 120), 0.10)
    if t < 8.2 or t > 53.0: shooting_star(img, t, 3.1) if t < 8 else None
    draw_moon(img, t)
    # هاله‌ی جو
    atm = atmosphere_sprite(R, 1.0)
    blit(img, atm, cx - atm.shape[1] / 2, cy - atm.shape[0] / 2, 1.0, add=True)
    # برچسب‌ها و برجسته‌سازی لایه‌ها
    hl, amt = None, 0.0
    if 10.8 < t < 15.2:
        for k, tk in enumerate(NAME_T):
            a = pulse(t, tk - 0.05, 0.85)
            if a > amt: hl, amt = k, a
    earth = render_earth(R, yaw, tilt, theta, t, highlight=hl, hl_amt=amt)
    blit(img, earth, cx - R, cy - R)
    # جرقه‌ها هنگام باز شدن
    sparkle_burst(img, t, 9.55, cx + R * .25, cy, n=40)
    # فضانورد
    if astro: draw_state(img, t, astro_state(t))
    # برچسب‌ها
    show_chips = (t >= 10.85 and t < 20) or t >= 54.3
    if show_chips:
        for k, (nm, col) in enumerate(LAYERS):
            t0 = NAME_T[k] if t < 30 else 54.4 + 0.3 * k
            if t < t0: continue
            X, Y = CHIP_POS[k]
            ax, ay = face_anchor(k, cx, cy, R, yaw, tilt)
            sp = chip_sprite(nm, col, 54)
            hw = sp.width / 2 * 0.85
            pk = clamp((t - t0) / 0.5)
            draw_line_aa(img, (X - hw - 8, Y), (lerp(X - hw - 8, ax, ease_out(pk)), lerp(Y, ay, ease_out(pk))), (255, 255, 255), 4, alpha=pk)
            draw_chip(img, nm, col, X, Y, t, t0, 54)
    if t < 8: draw_title(img, t)
    if t >= 56.2 or t > 53: sparkle_idle(img, t)
    draw_end_text(img, t) if t > 53 else None
    return img

def sparkle_idle(img, t):
    if t < END_T: return
    rng = np.random.default_rng(11)
    for i in range(26):
        x = rng.uniform(80, W - 80); y0 = rng.uniform(-100, 300); sp = rng.uniform(70, 160)
        ph = (t - END_T) * sp / 100 + rng.uniform(0, 3)
        y = (y0 + ph * 200) % (H + 100) - 50
        c = ((255, 230, 120), (255, 140, 120), (130, 220, 255), (190, 255, 160))[i % 4]
        ang = (t * 3 + i) * 0.8
        w, h = 12, 20
        pts = np.array([[x + math.cos(ang) * w, y + math.sin(ang) * h], [x - math.sin(ang) * w, y + math.cos(ang) * h],
                        [x - math.cos(ang) * w, y - math.sin(ang) * h], [x + math.sin(ang) * w, y - math.cos(ang) * h]], np.int32)
        cv2.fillConvexPoly(img, pts, tuple(float(v) for v in c), lineType=cv2.LINE_AA)

def astro_state(t):
    """وضعیت فضانورد در صحنه‌های ۱، ۲ و ۶ → (x, y, مقیاس، pose، چرخش، هاله)"""
    gl = ((255, 220, 160), 0.10)
    if t > 53:
        k = ease_out(prog(t, 53.2, 54.6))
        x = lerp(450, 330, k); y = lerp(620, 700, k)
        wave_ = 135 + 22 * math.sin(t * 7)
        jump = 0 if t < END_T else -34 * abs(math.sin((t - END_T) * 5.2))
        pose_ = dict(arm_r=wave_, arm_l=(150 + 20 * math.sin(t * 7.3)) if t > END_T else 12, happy=1, leg=4 * math.sin(t * 5), wow=0.0)
        return x, y + jump, 0.82, pose_, 0.0, gl
    if t < 8.2:
        x = lerp(-240, 330, ease_out(prog(t, 0.25, 1.9))); y = 700 + 14 * (1 - smooth(prog(t, 0.2, 1.9)))
        wave_ = 135 + 24 * math.sin(t * 7) if t < 6.8 else lerp(135, 90, smooth(prog(t, 6.8, 7.8)))
        return x, y, 0.82, dict(arm_r=wave_, arm_l=10, leg=3 * math.sin(t * 3)), 0.0, gl
    wow = pulse(t, 9.4, 2.6)
    if t < 11.6:
        pose_ = dict(arm_r=lerp(20, 135, wow), arm_l=lerp(20, 135, wow), wow=wow, leg=3 * math.sin(t * 3))
    else:
        ap = smooth(prog(t, 11.6, 12.3))
        nod = 8 * math.sin(t * 3.2) if 11.0 < t < 14.4 else 0
        pose_ = dict(arm_r=lerp(135, 92 + nod, ap), arm_l=lerp(135, 12, ap), look=0.5 * ap, leg=3 * math.sin(t * 3))
    return 330, 700, 0.82, pose_, 0.0, gl
