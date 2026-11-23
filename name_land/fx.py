"""جلوه‌ها: ذرات، حباب فکر، گردش حروف."""
import math, random, numpy as np, cv2
from lib import *
from chars import *


def fireflies(r, T, n, seed, area=(0, 120, 1280, 560), col=(255, 240, 150), a=0.7, size=26):
    rng = random.Random(seed)
    for i in range(n):
        x0, y0 = rng.uniform(area[0], area[2]), rng.uniform(area[1], area[3])
        ph = rng.uniform(0, 6)
        x = x0 + math.sin(T * 0.5 + ph) * 40
        y = y0 + math.cos(T * 0.7 + ph * 1.3) * 30
        tw = 0.4 + 0.6 * (0.5 + 0.5 * math.sin(T * 2.2 + ph * 3))
        r.glow(x, y, size, col, a * tw)


def falling(r, T, n, seed, cols, area=(0, 1280), top=-30, bot=640, speed=40, size=9, sway=40):
    rng = random.Random(seed)
    for i in range(n):
        x0 = rng.uniform(*area)
        ph = rng.uniform(0, 100)
        sp = speed * rng.uniform(0.7, 1.3)
        y = top + ((ph + T * sp) % (bot - top))
        x = x0 + math.sin(T * 1.1 + ph) * sway
        ang = math.degrees(math.sin(T * 1.7 + ph)) * 0.8
        r.ell(x, y, size * 1.2, size * 0.7, rng.choice(cols), ang=ang, sh=0.4, hl=0)


def note(r, x, y, col, ang=0, s=1.0):
    r.ell(x, y, 9 * s, 6.5 * s, col, ang=-20, sh=0.4, hl=0)
    r.cap(x + 7 * s, y - 2 * s, x + 7 * s, y - 30 * s, 3 * s, col, hl=False)
    r.cap(x + 7 * s, y - 30 * s, x + 17 * s, y - 22 * s, 3 * s, col, hl=False)


def notes(r, T, x, y, n=5, cols=((255, 120, 150), (120, 200, 255), (255, 210, 80), (150, 230, 150))):
    for i in range(n):
        u = ((T * 0.45 + i / n) % 1)
        note(r, x + math.sin(u * 6 + i) * 40 + i * 12, y - u * 160, cols[i % 4], s=0.8 + 0.3 * u)
        # محو شدن با کوچک شدن


def thought(r, x, y, s=1.0, t=0, qmark=True):
    """حباب فکر با «؟»."""
    for i, (dx, dy, rr) in enumerate(((-70, 80, 6), (-45, 55, 10), (-20, 28, 14))):
        r.ell(x + dx * s, y + dy * s, rr * s, rr * s, (255, 255, 255), sh=0.3, alpha=0.95, hl=0)
    r.ell(x + 20 * s, y - 20 * s, 74 * s, 56 * s, (255, 255, 255), sh=0.25, alpha=0.96, hl=0)
    r.ell(x + 20 * s, y - 20 * s, 74 * s, 56 * s, (255, 235, 250), sh=0, alpha=0.2, hl=0)


def wave_lines(r, x, y, L, T, col=(255, 255, 255), n=3, dirn=1):
    for i in range(n):
        u = (T * 1.6 + i / n) % 1
        a = 1 - u
        pts = [(x + dirn * (u * L + k * 12), y + math.sin(k * 0.9 + T * 8 + i) * 6 + (i - 1) * 14) for k in range(5)]
        r.curve(pts, 3, col)


def fire_puff(r, x, y, T, dirn=1, power=1.0, n=18):
    for i in range(n):
        u = ((T * 2.2 + i / n) % 1)
        px = x + dirn * u * 120 * power + math.sin(i * 3) * 6
        py = y + math.sin(i * 1.7 + T * 10) * 8 * u - u * 10
        sz = (14 + 26 * u) * power
        col = mix((255, 240, 120), (240, 80, 30), u)
        r.glow(px, py, sz * 1.6, col, 0.55 * (1 - u * 0.6))
        r.ell(px, py, sz * 0.5, sz * 0.5, col, sh=0, alpha=0.7 * (1 - u))


def banana_item(r, x, y, ang=0, s=1.0):
    r.curve([(x - 16 * s, y + 6 * s), (x, y + 12 * s), (x + 16 * s, y)], 9 * s, (252, 220, 70))
    r.curve([(x + 16 * s, y), (x + 20 * s, y - 4 * s)], 4 * s, (110, 80, 40))


def gift_m(r, x, y, s=1.0):
    r.ell(x, y, 22 * s, 20 * s, (252, 214, 70), sh=0.6, rim=(255, 240, 160))
    for dx, dy in ((-9, -6), (8, -8), (0, 8), (-11, 7), (11, 6)):
        r.ell(x + dx * s, y + dy * s, 4 * s, 4 * s, (230, 130, 60), sh=0.2, hl=0)


def mini_bubble(r, x, y, rad, fn, T):
    r.ell(x, y, rad, rad, (255, 255, 255), sh=0.25, alpha=0.92, hl=0)
    r.ell(x, y, rad - 5, rad - 5, (170, 210, 250), sh=0.2, alpha=0.95, hl=0)
    fn(r, x, y + rad * 0.55, rad / 130.0, T)


PERSIAN_FLOAT = "ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی"


def float_letters(frame, T, n, seed, area, scale=(0.35, 0.7), alpha=0.85):
    rng = random.Random(seed)
    for i in range(n):
        ch = PERSIAN_FLOAT[rng.randrange(len(PERSIAN_FLOAT))]
        col = LETTER_COLS[rng.randrange(5)]
        x = rng.uniform(area[0], area[2]) + math.sin(T * 0.6 + i) * 14
        y = rng.uniform(area[1], area[3]) + math.sin(T * 0.8 + i * 1.7) * 12
        sc = rng.uniform(*scale)
        blit_sprite(frame, letter_sprite(ch, col), x, y, sc, ang=math.sin(T * 0.7 + i) * 12, alpha=alpha)


GIFTS = [(160.0, "س"), (240.0, "ا"), (326.0, "م"), (403.5, "ا"), (452.0, "ن")]
