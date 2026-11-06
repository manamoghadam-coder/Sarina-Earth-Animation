# -*- coding: utf-8 -*-
"""ترکیب نهایی فریم‌ها: انتخاب صحنه، انتقال‌ها، نام دانش‌آموز (آخرین لایه، ثابت در همه‌ی فریم‌ها)."""
import numpy as np
from .util import *
from .common import draw_name, glow, draw_state
from . import scene_earth as SE, scene_dive as SD, scene_core as SC

def _flash(img, amt, color=(255, 230, 170)):
    if amt > 0.002:
        img += np.array(color, np.float32) * amt

DEFAULT_POSE = dict(arm_l=8.0, arm_r=8.0)

def _mix_state(a, b, p):
    x = lerp(a[0], b[0], p); y = lerp(a[1], b[1], p); sc = lerp(a[2], b[2], p); rot = lerp(a[4], b[4], p)
    pa, pb = a[3], b[3]
    pose_ = {k: lerp(pa.get(k, DEFAULT_POSE.get(k, 0.0)), pb.get(k, DEFAULT_POSE.get(k, 0.0)), p) for k in set(pa) | set(pb)}
    gl = a[5] or b[5]
    return x, y, sc, pose_, rot, gl

def astro_state(t):
    """مسیر یکپارچه‌ی فضانورد در کل ویدئو؛ در بازه‌های انتقال، حالت‌ها نرم ترکیب می‌شوند"""
    ES, DS, OS, IS = SE.astro_state, SD.astro_state, SC.astro_state_outer, SC.astro_state_inner
    if t < 17.3: return ES(t)
    if t < 18.5: return _mix_state(ES(17.3), DS(max(t, 18.0)), smooth(prog(t, 17.3, 18.5)))
    if t < 32.4: return DS(t)
    if t < 33.6: return _mix_state(DS(32.4), OS(max(t, 33.0)), smooth(prog(t, 32.4, 33.6)))
    if t < 44.4: return OS(t)
    if t < 45.6: return _mix_state(OS(44.4), IS(max(t, 45.0)), smooth(prog(t, 44.4, 45.6)))
    if t < 53.2: return IS(t)
    return ES(t)

def frame_at(t):
    """t به ثانیه → آرایه‌ی float32 (H,W,3) ۰..۲۵۵ (بدون زیرنویس؛ زیرنویس در FFmpeg از SRT اعمال می‌شود)"""
    # --- ۱ و ۲ : زمین
    if t < 17.3:
        img = SE.scene_earth(t)
    elif t < 18.5:                                    # زمین → فرود
        p = smooth(prog(t, 17.3, 18.5))
        a = SE.scene_earth(min(t, 17.3 + 1.2))
        fx, fy = SE.CX_F + SE.R_F * 0.45, SE.CY_F - SE.R_F * 0.80
        a = zoom_frame(a, fx, fy, 1 + 3.2 * ease_in(p))
        b = SD.scene_dive(max(t, 18.0))
        b = zoom_frame(b, W / 2, H / 2, 1 + 0.30 * (1 - p))
        img = a * (1 - p) + b * p
        _flash(img, 0.25 * pulse(t, 17.6, 0.8))
    elif t < 32.4:
        img = SD.scene_dive(t)
    elif t < 33.6:                                    # گوشته → هسته خارجی (فلاش داغ)
        p = smooth(prog(t, 32.4, 33.6))
        a = zoom_frame(SD.scene_dive(min(t, 33.2)), W * .5, H * .5, 1 + 0.6 * ease_in(p))
        b = SC.scene_outer(t)
        img = a * (1 - p) + b * p
        _flash(img, 0.45 * pulse(t, 32.5, 1.0), (255, 150, 60))
    elif t < 44.4:
        img = SC.scene_outer(t)
    elif t < 45.6:                                    # هسته خارجی → داخلی
        p = smooth(prog(t, 44.4, 45.6))
        a = SC.scene_outer(t); b = SC.scene_inner(max(t, 45.0))
        img = a * (1 - p) + b * p
        _flash(img, 0.35 * pulse(t, 44.5, 1.0), (255, 240, 190))
    elif t < 53.2:
        img = SC.scene_inner(t)
    elif t < 54.4:                                    # هسته داخلی → خلاصه (زمین)
        p = smooth(prog(t, 53.2, 54.4))
        a = zoom_frame(SC.scene_inner(min(t, 53.4)), 1140, 540, 1 + 0.9 * ease_in(p))
        b = SE.scene_earth(t)
        img = a * (1 - p) + b * p
        _flash(img, 0.5 * pulse(t, 53.3, 1.0), (255, 245, 215))
    else:
        img = SE.scene_earth(t)
    draw_state(img, t, astro_state(t))
    # ورود از سیاهی در ابتدا
    if t < 0.5:
        img *= smooth(prog(t, 0.0, 0.5))
    img = np.clip(img, 0, 255)
    draw_name(img)         # همیشه آخرین لایه؛ موقعیت و ظاهر ثابت
    return img
