# -*- coding: utf-8 -*-
"""ابزارهای پایه: ثابت‌ها، منحنی‌های حرکت، نویز، متن فارسی، ترکیب لایه‌ها."""
import math
from functools import lru_cache
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1920, 1080, 30
ROOT = Path(__file__).resolve().parents[2]
FONT_DIR = ROOT / "assets" / "fonts"

# ---------------------------------------------------------------- easing
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x

def lerp(a, b, t):
    return a + (b - a) * t

def prog(t, t0, t1):
    """پیشرفت خطی ۰..۱ بین t0 و t1"""
    return clamp((t - t0) / (t1 - t0)) if t1 > t0 else (1.0 if t >= t1 else 0.0)

def smooth(x):
    x = clamp(x); return x * x * (3 - 2 * x)

def smoother(x):
    x = clamp(x); return x * x * x * (x * (6 * x - 15) + 10)

def ease_out(x):
    x = clamp(x); return 1 - (1 - x) ** 3

def ease_in(x):
    x = clamp(x); return x ** 3

def ease_out_back(x, s=1.70158):
    x = clamp(x); x -= 1
    return 1 + (s + 1) * x ** 3 + s * x ** 2

def ease_out_elastic(x):
    x = clamp(x)
    if x in (0.0, 1.0): return x
    return 2 ** (-9 * x) * math.sin((x * 10 - 0.75) * (2 * math.pi) / 3) + 1

def pulse(t, t0, dur):
    """زنگ نرم ۰→۱→۰ روی بازه‌ی [t0, t0+dur]"""
    return math.sin(math.pi * clamp((t - t0) / dur)) ** 2

def mix(c1, c2, t):
    return tuple(lerp(a, b, t) for a, b in zip(c1, c2))

def hexc(s):
    s = s.lstrip("#"); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))

# ---------------------------------------------------------------- noise
@lru_cache(maxsize=None)
def fbm_tile(size_w, size_h, beta=2.0, seed=0, cutoff=0):
    """نویز فراکتالی کاشی‌شونده (بدون درز) با فیلتر فرکانسی؛ خروجی float32 در ۰..۱"""
    rng = np.random.default_rng(seed)
    a = rng.standard_normal((size_h, size_w)).astype(np.float32)
    F = np.fft.rfft2(a)
    fy = np.fft.fftfreq(size_h)[:, None]; fx = np.fft.rfftfreq(size_w)[None, :]
    f = np.sqrt(fx * fx * (size_h / size_w) ** 0 + fy * fy); f[0, 0] = 1
    F = F / (f ** (beta / 2 * 1.0 + 0.5))
    F[0, 0] = 0
    if cutoff:
        F[f * min(size_w, size_h) > cutoff] = 0
    out = np.fft.irfft2(F, s=(size_h, size_w)).astype(np.float32)
    out -= out.min(); out /= max(out.max(), 1e-6)
    return out

def tile_sample(tex, u, v, interp=cv2.INTER_LINEAR):
    """نمونه‌برداری از بافت کاشی‌شونده با مختصات پیوسته (u,v در واحد پیکسل‌های بافت)"""
    h, w = tex.shape[:2]
    u, v = np.broadcast_arrays(u, v)
    return cv2.remap(tex, np.ascontiguousarray(u % w, dtype=np.float32), np.ascontiguousarray(v % h, dtype=np.float32),
                     interp, borderMode=cv2.BORDER_WRAP)

# ---------------------------------------------------------------- متن
@lru_cache(maxsize=None)
def _font(weight, size):
    f = {"bold": "Vazirmatn-Bold.ttf", "medium": "Vazirmatn-Medium.ttf", "xbold": "Vazirmatn-ExtraBold.ttf"}[weight]
    return ImageFont.truetype(str(FONT_DIR / f), size, layout_engine=ImageFont.Layout.RAQM)

@lru_cache(maxsize=256)
def text_sprite(text, size, weight="bold", fill=(255, 255, 255), stroke=0, stroke_fill=(0, 0, 0),
                shadow=(0, 0, 0, 0), shadow_off=(0, 4), shadow_blur=6, grad=None, pad=24):
    """متن فارسی راست‌به‌چپ با شکل‌دهی Raqm؛ RGBA برمی‌گرداند. grad=(رنگ بالا، رنگ پایین) گرادیان عمودی."""
    f = _font(weight, size)
    tmp = ImageDraw.Draw(Image.new("L", (4, 4)))
    l, t, r, b = tmp.textbbox((0, 0), text, font=f, direction="rtl", language="fa", stroke_width=stroke)
    w, h = int(r - l + 2 * pad), int(b - t + 2 * pad)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pos = (pad - l, pad - t)
    if shadow[3] > 0:
        sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(sh).text((pos[0] + shadow_off[0], pos[1] + shadow_off[1]), text, font=f, fill=shadow,
                                direction="rtl", language="fa", stroke_width=stroke, stroke_fill=shadow)
        layer = Image.alpha_composite(layer, sh.filter(ImageFilter.GaussianBlur(shadow_blur)))
    if stroke:
        st = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(st).text(pos, text, font=f, fill=stroke_fill + (255,), direction="rtl", language="fa",
                                stroke_width=stroke, stroke_fill=stroke_fill + (255,))
        layer = Image.alpha_composite(layer, st)
    fg = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(fg).text(pos, text, font=f, fill=fill + (255,), direction="rtl", language="fa")
    if grad:
        gy = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
        gc = np.array(grad[0], np.float32) * (1 - gy) + np.array(grad[1], np.float32) * gy
        a = np.asarray(fg)[..., 3:4]
        fg = Image.fromarray(np.concatenate([np.broadcast_to(gc, (h, w, 3)), a.astype(np.float32)], -1).astype(np.uint8), "RGBA")
    return Image.alpha_composite(layer, fg)

# ---------------------------------------------------------------- ترکیب لایه‌ها
def to_f32(img):
    return np.asarray(img, dtype=np.float32)

def blit(dst, spr, x, y, alpha=1.0, add=False):
    """spr: PIL RGBA یا آرایه‌ی (h,w,4) از ۰..۲۵۵ ؛ x,y گوشه‌ی بالا-چپ. dst: float32 (H,W,3)"""
    a = to_f32(spr) if not isinstance(spr, np.ndarray) else spr
    h, w = a.shape[:2]
    x, y = int(round(x)), int(round(y))
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, dst.shape[1]), min(y + h, dst.shape[0])
    if x0 >= x1 or y0 >= y1: return
    s = a[y0 - y:y1 - y, x0 - x:x1 - x]
    al = (s[..., 3:4] / 255.0) * alpha
    d = dst[y0:y1, x0:x1]
    if add:
        d += s[..., :3] * al
    else:
        d *= (1 - al); d += s[..., :3] * al

def blit_center(dst, spr, cx, cy, scale=1.0, alpha=1.0, rot=0.0, add=False):
    img = spr if isinstance(spr, Image.Image) else Image.fromarray(spr.astype(np.uint8), "RGBA")
    if scale != 1.0:
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.BICUBIC)
    if rot:
        img = img.rotate(rot, Image.BICUBIC, expand=True)
    blit(dst, img, cx - img.width / 2, cy - img.height / 2, alpha, add)

@lru_cache(maxsize=64)
def radial_sprite(radius, color, power=2.0, peak=255):
    """هاله‌ی شعاعی نرم (RGBA) برای glow/نور"""
    n = int(radius * 2)
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    d = np.sqrt((x - radius + .5) ** 2 + (y - radius + .5) ** 2) / radius
    a = np.clip(1 - d, 0, 1) ** power * peak
    out = np.zeros((n, n, 4), np.float32); out[..., :3] = color; out[..., 3] = a
    return out

def glow(dst, cx, cy, radius, color, strength=1.0, power=2.0):
    spr = radial_sprite(int(radius), tuple(color), power)
    blit(dst, spr, cx - radius, cy - radius, strength, add=True)

def rounded_rect(w, h, r, fill, outline=None, ow=0, ss=3):
    im = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), r * ss, fill=fill + (255,) if len(fill) == 3 else fill,
                                         outline=outline, width=ow * ss)
    return im.resize((w, h), Image.LANCZOS)

def vgrad(h, stops):
    """گرادیان عمودی: stops=[(pos0..1,(r,g,b)),...] → (h,1,3)"""
    ys = np.linspace(0, 1, h, dtype=np.float32)
    pos = [s[0] for s in stops]
    out = np.stack([np.interp(ys, pos, [s[1][i] for s in stops]) for i in range(3)], -1)
    return out[:, None, :].astype(np.float32)

def zoom_frame(img, cx, cy, z):
    """بزرگ‌نمایی کل فریم حول (cx,cy)"""
    if abs(z - 1) < 1e-4: return img
    M = np.array([[z, 0, cx - z * cx], [0, z, cy - z * cy]], np.float32)
    return cv2.warpAffine(img, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

def vignette(img, strength=0.35):
    key = ("vig", img.shape[:2])
    if key not in _cache:
        y, x = np.mgrid[0:img.shape[0], 0:img.shape[1]].astype(np.float32)
        d = np.sqrt(((x / img.shape[1]) - .5) ** 2 * 1.2 + ((y / img.shape[0]) - .5) ** 2) * 1.5
        _cache[key] = (1 - strength * np.clip(d - .35, 0, 1) ** 1.5)[..., None]
    img *= _cache[key]

_cache = {}
