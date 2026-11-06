# -*- coding: utf-8 -*-
"""زمین سه‌بعدی کارتونی با برش گوه‌ای (Ray-casting تحلیلی روی کره‌ی لایه‌دار).
دوربین متعامد؛ شیء با yaw/tilt می‌چرخد؛ زاویه‌ی گوه‌ی بریده‌شده θ (۰ تا ۹۰ درجه) قابل انیمیشن است."""
import math
from functools import lru_cache
import cv2
import numpy as np
from .util import *
from .sprites import toon_shade, _sstep

# مرز لایه‌ها (شماتیک؛ مقیاس واقعی نیست)
R_CRUST, R_MANTLE, R_OUTER, R_INNER = 0.89, 0.57, 0.30, 0.0
LAYER_COLORS = {   # رنگ پایه‌ی هر لایه (پوسته، گوشته، هسته خارجی، هسته داخلی)
    0: (176, 112, 62), 1: (232, 74, 40), 2: (255, 168, 28), 3: (255, 232, 110)}
LIGHT_CAM = np.array([-0.45, 0.55, 0.70], np.float32); LIGHT_CAM /= np.linalg.norm(LIGHT_CAM)   # x راست، y بالا، z بیننده

@lru_cache(maxsize=1)
def earth_textures():
    """بافت سطح (رنگ + ابر) به‌صورت نقشه‌ی هم‌مستطیلی ۲۰۴۸×۱۰۲۴ — قاره‌های تخت کارتونی"""
    Wt, Ht = 2048, 1024
    n1 = fbm_tile(Wt, Ht, beta=2.3, seed=11, cutoff=75)
    n2 = fbm_tile(Wt, Ht, beta=2.0, seed=5, cutoff=160)
    h = n1 * 0.85 + n2 * 0.15
    yy = np.linspace(-1, 1, Ht, dtype=np.float32)[:, None]
    h = h - 0.06 * np.abs(yy) ** 3        # قطب‌ها کمی کم‌خشکی
    thr = np.quantile(h, 0.66)
    land = h - thr
    col = np.zeros((Ht, Wt, 3), np.float32)
    deep, mid, shallow = np.array((24, 98, 196), np.float32), np.array((38, 134, 224), np.float32), np.array((92, 190, 238), np.float32)
    col[:] = deep
    col = np.where((land > -0.10)[..., None], mid, col)
    col = np.where((land > -0.035)[..., None], shallow, col)
    sand, g1, g2, g3 = (np.array(c, np.float32) for c in ((238, 214, 130), (104, 196, 84), (62, 160, 72), (150, 130, 80)))
    col = np.where((land > 0.0)[..., None], sand, col)
    col = np.where((land > 0.018)[..., None], g1, col)
    col = np.where((land > 0.11)[..., None], g2, col)
    col = np.where((land > 0.34)[..., None], g3, col)
    ice = (np.abs(yy) > 0.88 + 0.05 * (n2 - 0.5)) & np.ones((1, Wt), bool)
    col = np.where(ice[..., None], np.array((240, 248, 255), np.float32), col)
    # ابرها
    c1 = fbm_tile(Wt, Ht, beta=2.4, seed=23, cutoff=70)
    cloud = _sstep(0.60, 0.66, c1 * 0.8 + 0.2 * fbm_tile(Wt, Ht, beta=1.6, seed=29, cutoff=200))
    return col.astype(np.float32), cloud.astype(np.float32)

@lru_cache(maxsize=1)
def layer_noise():
    return (fbm_tile(512, 512, beta=2.2, seed=31, cutoff=40), fbm_tile(512, 512, beta=2.0, seed=37, cutoff=90))

def rot_matrix(yaw, tilt):
    """ماتریس M: p_object = M @ c_camera  (c = Rx(tilt) Ry(yaw) p)"""
    cy, sy, ct, st = math.cos(yaw), math.sin(yaw), math.cos(tilt), math.sin(tilt)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], np.float32)
    Rx = np.array([[1, 0, 0], [0, ct, -st], [0, st, ct]], np.float32)
    Rc = Rx @ Ry                     # object → camera
    return Rc.T, Rc

def _sample_equirect(tex, lon, lat):
    h, w = tex.shape[:2]
    u = ((lon / (2 * math.pi) + 0.5) % 1.0) * w
    v = np.clip((0.5 - lat / math.pi) * h, 0, h - 1.001)
    return cv2.remap(tex, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)

def layer_of(r):
    return np.where(r >= R_CRUST, 0, np.where(r >= R_MANTLE, 1, np.where(r >= R_OUTER, 2, 3)))

def render_earth(R, yaw, tilt, theta, t, highlight=None, hl_amt=0.0, cut=True, ss=1.0, detail=True):
    """خروجی: آرایه‌ی float32 (2R,2R,4) از ۰..۲۵۵ (RGB + آلفا). R=شعاع به پیکسل.
    highlight: شماره‌ی لایه‌ای که باید بدرخشد (۰..۳) ؛ hl_amt ۰..۱"""
    n = int(round(2 * R))
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    u = (xs + 0.5 - R) / R; v = -(ys + 0.5 - R) / R
    r2 = u * u + v * v
    rr = np.sqrt(r2)
    inside = rr <= 1.0
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    M, Rc = rot_matrix(yaw, tilt)
    c = np.stack([u, v, z], -1)                        # (n,n,3) فضای دوربین
    p = c @ M.T                                       # مختصات شیء (p = M c)
    px, py, pz = p[..., 0], p[..., 1], p[..., 2]
    # --- سطح بیرونی
    col_tex, cloud_tex = earth_textures()
    lon = np.arctan2(px, pz); lat = np.arcsin(np.clip(py, -1, 1))
    surf = _sample_equirect(col_tex, lon, lat)
    cl = _sample_equirect(cloud_tex, lon + 0.35 + t * 0.02, lat)
    surf = surf * (1 - cl[..., None] * 0.88) + 255 * cl[..., None] * 0.88
    Ncam = np.stack([c[..., 0], -c[..., 1], c[..., 2]], -1)       # y پایین برای toon_shade
    sh = _shade_by_tex(surf, Ncam)
    # --- گوه‌ی بریده‌شده
    out = sh
    alpha = inside.astype(np.float32)
    if cut and theta > 0.004:
        s_t, c_t = math.sin(theta), math.cos(theta)
        n1 = np.array([1, 0, 0], np.float32); n2 = np.array([-c_t, 0, s_t], np.float32)
        f1 = px; f2 = -c_t * px + s_t * pz
        inW = (f1 >= 0) & (f2 >= 0) & inside
        D = (M @ np.array([0, 0, -1], np.float32)).astype(np.float32)
        nd1 = float(n1 @ D); nd2 = float(n2 @ D)
        INF = 1e9
        s1 = np.where(nd1 < -1e-6, f1 / (-nd1 + 1e-12), INF) if nd1 < -1e-6 else np.full_like(f1, INF)
        s2 = np.where(nd2 < -1e-6, f2 / (-nd2 + 1e-12), INF) if nd2 < -1e-6 else np.full_like(f1, INF)
        sx = np.minimum(s1, s2)
        which = (s2 < s1)           # False → وجه F0 ، True → وجه F1
        E = p + sx[..., None] * D
        rE = np.linalg.norm(E, axis=-1)
        hit = inW & (sx < INF * .5) & (rE <= 1.0)
        # مختصات درون‌صفحه‌ای (افقی a، عمودی b)
        d1 = np.array([s_t, 0, c_t], np.float32)
        a_coord = np.where(which, E @ d1, E[..., 2])
        b_coord = E[..., 1]
        # فاصله تا وجه دیگر → تیرگی گوشه (AO)
        other = np.where(which, E[..., 0], -c_t * E[..., 0] + s_t * E[..., 2])
        face = _face_color(rE, a_coord, b_coord, t, other, highlight, hl_amt)
        # روشنایی وجه: نرمال وجه در فضای دوربین
        nc0 = Rc @ n1; nc1 = Rc @ n2
        nface = np.where(which[..., None], nc1[None, None, :], nc0[None, None, :])
        lam = np.clip((nface * LIGHT_CAM).sum(-1), -1, 1)
        face = face * (0.80 + 0.22 * lam[..., None])
        out = np.where(inW[..., None], face, out)
        alpha = np.where(inW, hit.astype(np.float32), alpha)
    # --- لبه‌ی کارتونی تیره
    edge = _sstep(0.975, 0.995, rr)
    out = out * (1 - 0.55 * edge[..., None])
    # لبه‌ی نرم (anti-alias) آلفا
    aa = np.clip((1.0 - rr) * R * 1.0, 0, 1)
    alpha = alpha * aa
    res = np.dstack([out, alpha * 255]).astype(np.float32)
    return res

def _shade_by_tex(base, N):
    """سایه‌ی سه‌پله‌ای روی رنگ متغیر (بافت). N: (y پایین)"""
    d = (N * np.array([-0.52, -0.58, 0.63], np.float32)).sum(-1)
    k = np.where(d > 0.52, 1.10, np.where(d > -0.05, 1.0, 0.58))
    k = k * 0 + (0.60 + 0.40 * _sstep(-0.10, 0.04, d)) * (1.0 + 0.10 * _sstep(0.50, 0.62, d)) * (0.92 + 0.10 * np.clip(d, -1, 1))
    out = base * k[..., None]
    out = out * np.array([0.96 + 0.04 * 1, 1, 1], np.float32)
    # سایه‌ی سرد
    cold = (1 - _sstep(-0.10, 0.10, d))[..., None] * np.array([-14, -6, 22], np.float32)
    out = out + cold
    nz = np.clip(N[..., 2], 0, 1)
    atm = _sstep(0.10, 0.45, (1 - nz) ** 2.2)[..., None] * 0.35
    out = out * (1 - atm) + np.array([150, 215, 255], np.float32) * atm      # نور جوی آبی لبه
    return np.clip(out, 0, 255)

def _face_color(rE, a, b, t, other, highlight, hl_amt):
    nz1, nz2 = layer_noise()
    sh = rE.shape
    k = 512
    # --- بافت‌های هر لایه
    swirl_u = (a * 260 + t * 22 + 40 * np.sin(b * 6 + t * 0.9)); swirl_v = (b * 260 - t * 16)
    ns = tile_sample(nz1, swirl_u, swirl_v)
    ns2 = tile_sample(nz2, a * 520 - t * 30, b * 520 + t * 12)
    # پوسته: قهوه‌ای/خاکی با سنگ‌ریزه
    cr_base = np.array(LAYER_COLORS[0], np.float32)
    crust = cr_base * (0.80 + 0.45 * ns2[..., None]) * np.array([1, 0.96, 0.92], np.float32)
    crust = np.where((ns2 > 0.74)[..., None], crust * 0.62, crust)
    topgrass = _sstep(0.965, 0.985, rE)[..., None]
    crust = crust * (1 - topgrass) + np.array((90, 168, 70), np.float32) * topgrass
    # گوشته: گرادیان قرمز→نارنجی و جریان
    mt = np.clip((rE - R_MANTLE) / (R_CRUST - R_MANTLE), 0, 1)[..., None]
    mantle = np.array((255, 120, 36), np.float32) * (1 - mt) + np.array((226, 58, 38), np.float32) * mt
    mantle = mantle * (0.80 + 0.45 * ns[..., None])
    band = _sstep(0.52, 0.58, ns)[..., None]
    mantle = mantle + band * np.array([30, 40, 10], np.float32)
    # هسته خارجی: زرد-نارنجی با نوارهای مایع
    ot = np.clip((rE - R_INNER - 0.30) / (R_MANTLE - 0.30), 0, 1)[..., None]
    wav = 0.5 + 0.5 * np.sin(rE * 52 - t * 3.0 + ns * 5)
    outer = np.array((255, 200, 50), np.float32) * (1 - ot) + np.array((255, 150, 22), np.float32) * ot
    outer = outer * (0.88 + 0.22 * wav[..., None])
    # هسته داخلی: طلایی روشن + برق
    it = np.clip(rE / 0.30, 0, 1)[..., None]
    inner = np.array((255, 246, 170), np.float32) * (1 - it) + np.array((255, 214, 80), np.float32) * it
    inner = inner * (0.97 + 0.06 * ns2[..., None])
    lay = layer_of(rE)
    col = np.where((lay == 0)[..., None], crust, np.where((lay == 1)[..., None], mantle, np.where((lay == 2)[..., None], outer, inner)))
    # خطوط جداکننده (حاشیه‌ی لایه‌ها)
    line = np.zeros_like(rE)
    for rb in (R_CRUST, R_MANTLE, R_OUTER):
        line = np.maximum(line, 1 - _sstep(0.004, 0.012, np.abs(rE - rb)))
    col = col * (1 - 0.65 * line[..., None]) + np.array((60, 25, 20), np.float32) * 0.0
    # AO گوشه (نزدیک وجه مقابل)
    ao = 1 - 0.30 * np.exp(-np.abs(other) / 0.05)
    col = col * ao[..., None]
    # برجسته‌سازی لایه
    if highlight is not None and hl_amt > 0.01:
        m = (lay == highlight)[..., None]
        glowc = np.array((255, 255, 255), np.float32)
        col = np.where(m, col * (1 + 0.22 * hl_amt) + glowc * 0.22 * hl_amt, col * (1 - 0.30 * hl_amt))
    return np.clip(col, 0, 255)

def atmosphere_sprite(R, strength=1.0):
    return radial_sprite(int(R * 1.28), (110, 190, 255), 2.4, int(150 * strength))

def layer_anchor(k, theta_face=True):
    """نقطه‌ای روی وجه (در فضای دوربین نرمال‌شده u,v) برای وصل کردن خط راهنمای هر لایه؛ برای حالت نهایی (θ=90°, yaw≈0)"""
    r = {0: 0.95, 1: 0.74, 2: 0.44, 3: 0.14}[k]
    ang = {0: 28, 1: 8, 2: -14, 3: -35}[k]
    return r * math.cos(math.radians(ang)), r * math.sin(math.radians(ang))
