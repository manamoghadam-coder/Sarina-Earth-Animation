# -*- coding: utf-8 -*-
"""اسپرایت‌های سه‌بعدی-کارتونی (سایه‌ی Toon، نور لبه، براقیت) و شخصیت فضانورد راهنما."""
import math
from functools import lru_cache
import cv2
import numpy as np
from PIL import Image, ImageDraw
from .util import *

LIGHT = np.array([-0.52, -0.58, 0.63], np.float32); LIGHT /= np.linalg.norm(LIGHT)   # x راست، y پایین، z به سمت بیننده
RIM = np.array([0.8, 0.25, 0.25], np.float32)

def _sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def toon_shade(base, N, spec=0.7, rim_col=(255, 245, 225), rim_k=0.35, light=LIGHT, soft=1.0):
    """سایه‌ی کارتونی سه‌پله‌ای با نرمی کم + نور لبه + براقیت. N: (...,3) نرمال واحد (x راست، y پایین، z بیننده)."""
    base = np.array(base, np.float32)
    d = (N * light).sum(-1)
    shadow = base * np.array([0.52, 0.55, 0.78], np.float32)
    light_c = np.minimum(base * 1.10 + 22, 255)
    s1 = _sstep(-0.08, 0.10 * soft + 0.02, d)[..., None]
    s2 = _sstep(0.50, 0.50 + 0.12 * soft, d)[..., None]
    c = shadow * (1 - s1) + base * s1
    c = c * (1 - s2) + light_c * s2
    c = c * (0.94 + 0.10 * np.clip(d, -1, 1)[..., None])
    nz = np.clip(N[..., 2], 0, 1)
    rim = (1 - nz) ** 2.6 * np.clip((N * RIM).sum(-1) * 1.6 + 0.25, 0, 1)
    rim = _sstep(0.12, 0.38, rim)[..., None] * rim_k
    c = c * (1 - rim) + np.array(rim_col, np.float32) * rim
    if spec > 0:
        R = 2 * d[..., None] * N - light
        sp = np.clip(R[..., 2], 0, 1) ** 38
        sp = _sstep(0.45, 0.62, sp)[..., None] * spec * (d[..., None] > 0)
        c = c * (1 - sp) + 255 * sp
    return np.clip(c, 0, 255)

@lru_cache(maxsize=512)
def shaded(w, h, color, n=2.0, spec=0.7, outline=0.5, ss=3, rim_k=0.35, soft=1.0):
    """ابرکره/ابربیضوی سایه‌دار به‌عنوان اسپرایت RGBA (PIL)"""
    W2, H2 = w * ss, h * ss
    y, x = np.mgrid[0:H2, 0:W2].astype(np.float32)
    x = (x + .5) / W2 * 2 - 1; y = (y + .5) / H2 * 2 - 1
    f = np.abs(x) ** n + np.abs(y) ** n
    inside = f <= 1
    z = np.clip(1 - f, 0, 1) ** (1 / n)
    nx = np.sign(x) * np.abs(x) ** (n - 1); ny = np.sign(y) * np.abs(y) ** (n - 1); nz = np.abs(z) ** (n - 1)
    # برای ابربیضوی مسطح‌شونده، نرمال را کمی به سمت بیننده بکشیم تا نرم‌تر شود
    N = np.stack([nx, ny, nz + 0.0], -1)
    N /= np.maximum(np.linalg.norm(N, axis=-1, keepdims=True), 1e-6)
    col = toon_shade(color, N, spec=spec, rim_k=rim_k, soft=soft)
    mask = inside.astype(np.uint8) * 255
    if outline > 0:
        k = max(2, int(2.4 * ss))
        er = cv2.erode(mask, np.ones((k, k), np.uint8))
        edge = ((mask > 0) & (er == 0))[..., None]
        col = np.where(edge, col * (1 - outline), col)
    rgba = np.dstack([col, mask]).astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA")
    return im.resize((w, h), Image.LANCZOS)

def shaded_sphere_arr(radius, color, **kw):
    return shaded(int(radius * 2), int(radius * 2), tuple(color), **kw)

# ------------------------------------------------------------------ فضانورد
WHITE = (244, 246, 252); BOOT = (255, 138, 40); GLOVE = (255, 120, 60); PACK = (88, 112, 168)

def _drop_shadow_layer(size):
    return Image.new("RGBA", size, (0, 0, 0, 0))

@lru_cache(maxsize=1)
def _astro_parts():
    P = {}
    P["torso"] = shaded(176, 196, WHITE, n=2.6, spec=0.5)
    P["pack"] = shaded(214, 206, PACK, n=3.2, spec=0.4)
    P["leg"] = shaded(74, 132, WHITE, n=2.6, spec=0.4)
    P["boot"] = shaded(92, 54, BOOT, n=2.4, spec=0.6)
    P["arm"] = shaded(64, 132, WHITE, n=2.8, spec=0.4)
    P["glove"] = shaded(72, 72, GLOVE, n=2.0, spec=0.8)
    P["helmet"] = shaded(232, 224, WHITE, n=2.1, spec=0.9, soft=1.2)
    P["ring"] = shaded(150, 36, (255, 196, 60), n=2.6, spec=0.9)
    P["bulb"] = shaded(26, 26, (255, 70, 90), n=2.0, spec=0.9)
    P["btn_r"] = shaded(18, 18, (255, 80, 90), spec=0.9, outline=0.3)
    P["btn_y"] = shaded(18, 18, (255, 214, 70), spec=0.9, outline=0.3)
    P["btn_g"] = shaded(18, 18, (80, 220, 140), spec=0.9, outline=0.3)
    P["flame"] = None
    return P

def _arm_sprite(P, angle_deg, side):
    """بازو + دستکش، چرخیده حول شانه. angle=0 یعنی آویزان، مثبت = بالا آمدن به سمت بیرون"""
    arm = Image.new("RGBA", (96, 240), (0, 0, 0, 0))
    arm.alpha_composite(P["arm"], (16, 14))
    arm.alpha_composite(P["glove"], (12, 118))
    # شانه در (48, 38) ؛ چرخش حول شانه
    a = angle_deg * (1 if side > 0 else -1)
    big = Image.new("RGBA", (400, 400), (0, 0, 0, 0)); big.alpha_composite(arm, (200 - 48, 200 - 38))
    big = big.rotate(a, Image.BICUBIC, center=(200, 200))
    return big, (200, 200)   # (تصویر، محل شانه در آن)

def astronaut(pose=None, scale=1.0):
    """پوسته‌ی RGBA فضانورد + نقطه‌ی مرجع (مرکز تنه) ؛ pose: dict
    mouth(0..1) blink(0..1) arm_l arm_r (درجه) look(-1..1) look_y flame sweat(0..1) tilt bob wow(0..1) glow"""
    p = dict(mouth=0.0, blink=0.0, arm_l=8.0, arm_r=8.0, look=0.0, look_y=0.0, flame=0.0, sweat=0.0, wow=0.0,
             happy=1.0, t=0.0, leg=0.0)
    if pose: p.update(pose)
    P = _astro_parts()
    cw, ch = 760, 860; ox, oy = cw // 2, 470     # مرجع: مرکز تنه
    cv = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    def put(spr, cx, cy, layer=cv):
        layer.alpha_composite(spr, (int(cx - spr.width / 2), int(cy - spr.height / 2)))
    # شعله‌ی جت‌پک
    if p["flame"] > 0.01:
        fl = p["flame"]; t = p["t"]
        for sx in (-92, 92):
            fh = int((70 + 28 * math.sin(t * 40 + sx)) * fl)
            fim = Image.new("RGBA", (60, 160), (0, 0, 0, 0)); d = ImageDraw.Draw(fim)
            d.polygon([(8, 4), (52, 4), (30, 4 + fh)], fill=(255, 120, 40, 230))
            d.polygon([(18, 4), (42, 4), (30, 4 + fh * .62)], fill=(255, 220, 90, 255))
            fim = fim.filter(ImageFilter.GaussianBlur(1.6))
            cv.alpha_composite(fim, (ox + sx - 30, oy + 100))
    put(P["pack"], ox, oy - 8)
    for sx in (-92, 92):
        d = ImageDraw.Draw(cv); d.rounded_rectangle((ox + sx - 15, oy + 80, ox + sx + 15, oy + 104), 7, fill=(60, 72, 110, 255))
    # پاها
    lg = p["leg"]
    for sx, a in ((-40, lg), (40, -lg)):
        leg = P["leg"]; boot = P["boot"]
        grp = Image.new("RGBA", (120, 200), (0, 0, 0, 0)); grp.alpha_composite(leg, (23, 6)); grp.alpha_composite(boot, (14, 120))
        grp = grp.rotate(a, Image.BICUBIC, center=(60, 20))
        cv.alpha_composite(grp, (int(ox + sx - 60), int(oy + 88 - 20)))
    put(P["torso"], ox, oy)
    # پنل سینه
    d = ImageDraw.Draw(cv)
    d.rounded_rectangle((ox - 40, oy - 28, ox + 40, oy + 26), 12, fill=(52, 64, 112, 255), outline=(30, 40, 80, 255), width=3)
    for i, k in enumerate(("btn_r", "btn_y", "btn_g")):
        put(P[k], ox - 22 + i * 22, oy - 4)
    d.arc((ox - 26, oy + 8, ox + 26, oy + 36), 20, 160, fill=(150, 170, 230, 255), width=3)
    # بازوها (پشت کلاه)
    for side, ang in ((-1, p["arm_l"]), (1, p["arm_r"])):
        im, (sx0, sy0) = _arm_sprite(P, ang, side)
        sx_screen = ox + side * 88; sy_screen = oy - 52
        cv.alpha_composite(im, (int(sx_screen - sx0), int(sy_screen - sy0)))
    # حلقه‌ی گردن + کلاه
    put(P["ring"], ox, oy - 98)
    hx, hy = ox, oy - 196
    # آنتن
    d = ImageDraw.Draw(cv)
    d.line((hx + 54, hy - 96, hx + 78, hy - 160), fill=(120, 130, 170, 255), width=7)
    put(P["bulb"], hx + 80, hy - 168)
    glow_a = 0.5 + 0.5 * math.sin(p["t"] * 6)
    put(P["helmet"], hx, hy)
    # شیشه‌ی کلاه (visor)
    vw, vh = 168, 138
    ss = 3
    vis = Image.new("RGBA", (vw * ss, vh * ss), (0, 0, 0, 0)); vd = ImageDraw.Draw(vis)
    vd.ellipse((0, 0, vw * ss - 1, vh * ss - 1), fill=(30, 52, 120, 255))
    # گرادیان آبی داخل
    vd.ellipse((10 * ss, 8 * ss, (vw - 10) * ss, (vh - 6) * ss), fill=(52, 96, 190, 255))
    # صورت
    fx, fy = vw * ss / 2 + p["look"] * 10 * ss, vh * ss / 2 + 6 * ss + p["look_y"] * 6 * ss
    vd.ellipse((fx - 50 * ss, fy - 46 * ss, fx + 50 * ss, fy + 46 * ss), fill=(255, 214, 178, 255))
    vd.ellipse((fx - 34 * ss, fy + 6 * ss, fx - 12 * ss, fy + 22 * ss), fill=(255, 176, 160, 255))   # گونه
    vd.ellipse((fx + 12 * ss, fy + 6 * ss, fx + 34 * ss, fy + 22 * ss), fill=(255, 176, 160, 255))
    wow = p["wow"]
    for ex in (-22, 22):
        ecx = fx + ex * ss + p["look"] * 4 * ss; ecy = fy - 12 * ss
        er = (13 + 4 * wow) * ss
        eh = er * (1 - 0.92 * p["blink"])
        vd.ellipse((ecx - er, ecy - eh * 1.15, ecx + er, ecy + eh * 1.15), fill=(255, 255, 255, 255))
        pr = 8 * ss
        px = ecx + p["look"] * 4 * ss; py = ecy + p["look_y"] * 4 * ss
        if p["blink"] < 0.6:
            vd.ellipse((px - pr, py - pr * (1 - 0.5 * p["blink"]), px + pr, py + pr * (1 - 0.5 * p["blink"])), fill=(40, 30, 60, 255))
            vd.ellipse((px - pr * .1, py - pr * .8, px + pr * .5, py - pr * .15), fill=(255, 255, 255, 255))
        # ابرو
        by = ecy - er * 1.5 - 4 * ss * wow
        vd.arc((ecx - 14 * ss, by - 7 * ss, ecx + 14 * ss, by + 9 * ss), 200, 340, fill=(110, 70, 50, 255), width=int(3.2 * ss))
    # دهان
    mo = p["mouth"]; mcx, mcy = fx + p["look"] * 3 * ss, fy + 22 * ss
    if mo < 0.12:
        w = 15 * ss * (0.9 + 0.2 * p["happy"])
        vd.arc((mcx - w, mcy - 12 * ss, mcx + w, mcy + 12 * ss), 15, 165, fill=(150, 60, 70, 255), width=int(3.4 * ss))
    else:
        mw = (10 + 7 * mo) * ss; mh = (4 + 15 * mo) * ss
        vd.ellipse((mcx - mw, mcy - mh * .55, mcx + mw, mcy + mh), fill=(130, 40, 60, 255))
        vd.ellipse((mcx - mw * .62, mcy + mh * .25, mcx + mw * .62, mcy + mh * .95), fill=(255, 120, 130, 255))
        if mo > 0.3:
            vd.rectangle((mcx - mw * .7, mcy - mh * .5, mcx + mw * .7, mcy - mh * .2), fill=(255, 255, 255, 255))
    vis = vis.resize((vw, vh), Image.LANCZOS)
    # عرق/قطره
    if p["sweat"] > 0.02:
        s = p["sweat"]; dd = ImageDraw.Draw(vis)
        for k, (dx, off) in enumerate(((58, 0.0), (-62, 0.4))):
            pr = (s + off) % 1.0
            sy = 24 + pr * 48; sxp = vw / 2 + dx
            dd.polygon([(sxp, sy - 12), (sxp - 7, sy + 3), (sxp + 7, sy + 3)], fill=(120, 200, 255, int(255 * (1 - pr))))
            dd.ellipse((sxp - 7, sy - 4, sxp + 7, sy + 10), fill=(120, 200, 255, int(255 * (1 - pr))))
    # براق‌های شیشه
    hl = Image.new("RGBA", (vw, vh), (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
    hd.ellipse((14, 8, 74, 46), fill=(255, 255, 255, 120))
    hd.ellipse((26, 12, 46, 22), fill=(255, 255, 255, 210))
    hd.ellipse((vw - 38, vh - 36, vw - 20, vh - 22), fill=(255, 255, 255, 70))
    vis = Image.alpha_composite(vis, hl)
    # ماسک بیضی
    m = Image.new("L", (vw, vh), 0); ImageDraw.Draw(m).ellipse((0, 0, vw - 1, vh - 1), fill=255)
    vis.putalpha(Image.fromarray(np.minimum(np.asarray(vis)[..., 3], np.asarray(m))))
    # قاب شیشه
    fr = Image.new("RGBA", (vw + 12, vh + 12), (0, 0, 0, 0))
    ImageDraw.Draw(fr).ellipse((0, 0, vw + 11, vh + 11), fill=(70, 80, 130, 255))
    put(fr, hx, hy + 6); put(vis, hx, hy + 6)
    # آنتن لامپ درخشان
    if glow_a > 0.5:
        g = radial_sprite(26, (255, 80, 100), 2.0, int(160 * glow_a))
        gi = Image.fromarray(g.astype(np.uint8), "RGBA"); put(gi, hx + 80, hy - 168)
    img = cv
    if scale != 1.0:
        img = img.resize((int(cw * scale), int(ch * scale)), Image.LANCZOS)
    return img, (ox * scale, oy * scale)

from PIL import ImageFilter  # noqa (برای شعله)
