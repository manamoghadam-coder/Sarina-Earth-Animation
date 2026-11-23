"""پس‌زمینه‌های لایه‌ای (ساخته‌شده یک‌بار برای هر صحنه)."""
import math, random, numpy as np, cv2
from lib import *

GY = 575  # خط زمین


def full_layer(c0, c1, f):
    h, w = int(LH * K), int(LW * K)
    return Layer(vgrad(h, w, c0, c1), np.full((h, w), 255, np.uint8), f)


def L(fn, f, blur=0):
    rgb, al = layer_from(fn, blur)
    return Layer(rgb, al, f)


def hills(y, amp, c0, c1, seed, f, blur=0, freq=1.0, x0=-PAD_X, x1=W + PAD_X):
    def d(r):
        rng = random.Random(seed)
        ph = [rng.random() * 6 for _ in range(3)]
        pts = []
        for i in range(0, int((x1 - x0) / 16) + 2):
            x = x0 + i * 16
            yy = y + amp * (0.6 * math.sin(x * 0.006 * freq + ph[0]) + 0.3 * math.sin(x * 0.015 * freq + ph[1])
                            + 0.15 * math.sin(x * 0.033 * freq + ph[2]))
            pts.append((x, yy))
        pts += [(x1, H + PAD_Y), (x0, H + PAD_Y)]
        r.poly(pts, c0, col2=c1)
    return L(d, f, blur)


def tree_round(r, x, base, h, trunk, leaf, rng, pink=False):
    r.cap(x, base, x + rng.uniform(-4, 4), base - h * 0.6, h * 0.09, trunk)
    cy = base - h * 0.72
    for dx, dy, k in ((-0.22, 0.06, 0.26), (0.22, 0.05, 0.27), (0, -0.12, 0.3), (-0.1, 0.0, 0.3), (0.12, -0.02, 0.28)):
        r.ell(x + dx * h, cy + dy * h, h * k, h * k * 0.9, shade(leaf, rng.uniform(0.9, 1.12)), sh=0.6,
              rim=(255, 240, 170) if not pink else (255, 235, 245))


def tree_pine(r, x, base, h, trunk, leaf, rng):
    r.cap(x, base, x, base - h * 0.2, h * 0.07, trunk)
    for i in range(4):
        w = h * (0.34 - i * 0.06)
        yb = base - h * (0.12 + i * 0.2)
        r.poly([(x - w, yb), (x + w, yb), (x, yb - h * 0.34)], shade(leaf, 1 + i * 0.07), col2=shade(leaf, 0.8))


def tree_banana(r, x, base, h, trunk, leaf, rng):
    r.cap(x, base, x + 6, base - h * 0.8, h * 0.07, trunk)
    top = (x + 6, base - h * 0.8)
    for i in range(8):
        a = -math.pi / 2 + (i - 3.5) * 0.52
        L_ = h * 0.5
        ex, ey = top[0] + math.cos(a) * L_, top[1] + math.sin(a) * L_ * 0.8 + (abs(math.cos(a)) * h * 0.25)
        r.ell((top[0] + ex) / 2, (top[1] + ey) / 2, L_ * 0.5, h * 0.09, shade(leaf, 0.9 + (i % 3) * 0.1),
              ang=math.degrees(math.atan2(ey - top[1], ex - top[0])), sh=0.5)


def tree_maple(r, x, base, h, trunk, leaf, rng):
    r.cap(x, base, x, base - h * 0.55, h * 0.08, trunk)
    cs = [leaf, shade(leaf, 1.2), (244, 160, 56), shade(leaf, 0.85)]
    for i in range(7):
        a = i / 7 * math.tau
        r.ell(x + math.cos(a) * h * 0.2, base - h * 0.72 + math.sin(a) * h * 0.14, h * 0.22, h * 0.19,
              cs[i % 4], sh=0.6, rim=(255, 220, 140))
    r.ell(x, base - h * 0.74, h * 0.22, h * 0.2, cs[1], sh=0.6, rim=(255, 220, 140))


def tree_palm(r, x, base, h, trunk, leaf, rng):
    r.curve([(x, base), (x + 10, base - h * 0.5), (x + 4, base - h * 0.9)], h * 0.07, trunk)
    top = (x + 4, base - h * 0.9)
    for i in range(7):
        a = -math.pi + i * math.pi / 6
        ex, ey = top[0] + math.cos(a) * h * 0.42, top[1] + abs(math.sin(a)) * -h * 0.1 + h * 0.18 * (1 - abs(math.sin(a)))
        r.ell((top[0] + ex) / 2, (top[1] + ey) / 2, h * 0.22, h * 0.05, leaf,
              ang=math.degrees(math.atan2(ey - top[1], ex - top[0])), sh=0.5)


TREES = dict(round=tree_round, pine=tree_pine, banana=tree_banana, maple=tree_maple, palm=tree_palm)


def forest(kind, xs, base, hr, trunk, leaf, seed, f, blur=0, pink=False):
    def d(r):
        rng = random.Random(seed)
        for x in xs:
            h = rng.uniform(*hr)
            if kind == "round":
                tree_round(r, x, base + rng.uniform(-8, 8), h, trunk, leaf, rng, pink)
            else:
                TREES[kind](r, x, base + rng.uniform(-8, 8), h, trunk, leaf, rng)
    return L(d, f, blur)


def ground(y, c0, c1, f, seed=3, flowers=None, tufts=(60, 160, 70)):
    def d(r):
        rng = random.Random(seed)
        pts = [(x, y + 6 * math.sin(x * 0.01) + 3 * math.sin(x * 0.037)) for x in range(-PAD_X, W + PAD_X + 20, 20)]
        pts += [(W + PAD_X + 20, H + PAD_Y), (-PAD_X, H + PAD_Y)]
        r.poly(pts, c0, col2=c1)
        for _ in range(140):
            x, yy = rng.uniform(-PAD_X, W + PAD_X), rng.uniform(y + 8, H + 30)
            t = rng.uniform(0.5, 1.1)
            r.ell(x, yy, 14 * t, 5 * t, shade(tufts, rng.uniform(0.85, 1.15)), sh=0.3, alpha=0.8, hl=0)
        if flowers:
            for _ in range(60):
                x, yy = rng.uniform(-PAD_X, W + PAD_X), rng.uniform(y + 14, H + 30)
                r.ell(x, yy, 5, 5, rng.choice(flowers), sh=0.4, hl=0)
                r.ell(x, yy, 2, 2, (255, 230, 120), sh=0, hl=0)
    return L(d, f)


def fg_leaves(cols, f=1.35, seed=5, blur=7, bottom=True, top=True):
    def d(r):
        rng = random.Random(seed)
        for _ in range(9 if bottom else 0):
            x = rng.choice([rng.uniform(-PAD_X, 120), rng.uniform(1100, W + PAD_X)])
            r.ell(x, H + rng.uniform(0, 50), rng.uniform(40, 90), rng.uniform(25, 60), rng.choice(cols), sh=0.4,
                  ang=rng.uniform(-40, 40), alpha=0.95)
        for _ in range(7 if top else 0):
            x = rng.choice([rng.uniform(-PAD_X, 260), rng.uniform(1000, W + PAD_X)])
            r.ell(x, rng.uniform(-60, 0), rng.uniform(50, 100), rng.uniform(30, 50), rng.choice(cols), sh=0.4,
                  ang=rng.uniform(-30, 30), alpha=0.9)
    return L(d, f, blur)


def clouds(ys, seed, f, col=(255, 255, 255), blur=1.5, x0=-PAD_X, x1=W + PAD_X, scale=1.0):
    def d(r):
        rng = random.Random(seed)
        for y in ys:
            x = rng.uniform(x0, x1)
            for _ in range(5):
                r.ell(x + rng.uniform(-70, 70) * scale, y + rng.uniform(-10, 12), rng.uniform(40, 80) * scale,
                      rng.uniform(22, 40) * scale, col, sh=0.25, hl=0, alpha=0.95)
    return L(d, f, blur)


def stars(n, seed, f, ymax=420):
    def d(r):
        rng = random.Random(seed)
        for _ in range(n):
            x, y = rng.uniform(-PAD_X, W + PAD_X), rng.uniform(-PAD_Y, ymax)
            s = rng.uniform(1.2, 3.2)
            r.ell(x, y, s, s, (255, 250, 225), sh=0, alpha=rng.uniform(0.6, 1))
    return L(d, f)


# ---------- اتاق خواب ----------
def bedroom(night=False):
    wall = ((236, 214, 186), (222, 196, 164)) if not night else ((70, 78, 130), (56, 60, 104))
    floor = ((196, 140, 92), (160, 106, 70)) if not night else ((94, 76, 92), (68, 56, 78))
    wx0, wx1, wy0, wy1 = 800, 1130, 110, 430  # پنجره (سوراخ)

    def d(r):
        # دیوار با سوراخ پنجره
        top, bot = wall
        r.poly([(-PAD_X, -PAD_Y), (W + PAD_X, -PAD_Y), (W + PAD_X, wy0), (-PAD_X, wy0)], top, col2=mix(top, bot, 0.3))
        r.poly([(-PAD_X, wy0), (wx0, wy0), (wx0, wy1), (-PAD_X, wy1)], mix(top, bot, 0.35), col2=mix(top, bot, 0.65))
        r.poly([(wx1, wy0), (W + PAD_X, wy0), (W + PAD_X, wy1), (wx1, wy1)], mix(top, bot, 0.35), col2=mix(top, bot, 0.65))
        r.poly([(-PAD_X, wy1), (W + PAD_X, wy1), (W + PAD_X, GY), (-PAD_X, GY)], mix(top, bot, 0.65), col2=bot)
        # کفپوش
        r.poly([(-PAD_X, GY), (W + PAD_X, GY), (W + PAD_X, H + PAD_Y), (-PAD_X, H + PAD_Y)], floor[0], col2=floor[1])
        for i in range(-3, 28):
            r.cap(-PAD_X + i * 70, GY + 4, -PAD_X + i * 70 - 60, H + PAD_Y, 2, shade(floor[1], 0.85), hl=False)
        r.cap(-PAD_X, GY, W + PAD_X, GY, 10, shade(wall[1], 0.8), hl=False)
        # قاب پنجره
        fr = (250, 244, 236) if not night else (180, 186, 220)
        for a, b, c_, d_ in ((wx0, wy0, wx1, wy0), (wx0, wy1, wx1, wy1), (wx0, wy0, wx0, wy1), (wx1, wy0, wx1, wy1),
                             ((wx0 + wx1) / 2, wy0, (wx0 + wx1) / 2, wy1)):
            r.cap(a, b, c_, d_, 12, fr)
        r.poly([(wx0 - 12, wy1 + 6), (wx1 + 12, wy1 + 6), (wx1 + 22, wy1 + 24), (wx0 - 22, wy1 + 24)], fr, col2=shade(fr, 0.85))
        # پرده
        cur = (230, 110, 100) if not night else (140, 90, 150)
        for side in (-1, 1):
            xx = wx0 - 20 if side < 0 else wx1 + 20
            r.ell(xx, (wy0 + wy1) / 2, 40, 240, cur, sh=0.5)
            r.ell(xx + side * 14, (wy0 + wy1) / 2 + 10, 20, 230, shade(cur, 0.85), sh=0.3, hl=0)
        r.cap(wx0 - 90, wy0 - 14, wx1 + 90, wy0 - 14, 8, (140, 96, 70))
        # تخت
        r.ell(340, GY + 10, 270, 18, (0, 0, 0), sh=0, alpha=0.18)
        r.poly([(120, 330), (150, 330), (150, GY + 4), (120, GY + 4)], (172, 112, 72), col2=(140, 88, 56))
        r.ell(135, 330, 22, 22, (186, 124, 80), sh=0.5)
        r.poly([(150, 478), (570, 478), (570, GY - 4), (150, GY - 4)], (178, 116, 74), col2=(140, 90, 58))
        r.poly([(556, 440), (582, 440), (582, GY + 4), (556, GY + 4)], (172, 112, 72), col2=(140, 88, 56))
        r.ell(352, 470, 212, 34, (252, 246, 236) if not night else (200, 206, 236), sh=0.5, rim=(255, 255, 255))
        r.ell(200, 438, 76, 30, (255, 252, 248) if not night else (214, 218, 244), sh=0.5, rim=(255, 255, 255))
        # قفسه کتاب
        sx = 600
        r.poly([(sx - 90, 250), (sx + 90, 250), (sx + 90, GY), (sx - 90, GY)], (176, 116, 74), col2=(140, 90, 60))
        rng = random.Random(4)
        for yy in (330, 410, 490):
            r.cap(sx - 90, yy, sx + 90, yy, 7, (120, 76, 50), hl=False)
        for row in range(3):
            xx = sx - 80
            while xx < sx + 76:
                w = rng.uniform(10, 20)
                hh = rng.uniform(46, 68)
                r.poly([(xx, 330 + row * 80 - hh), (xx + w, 330 + row * 80 - hh), (xx + w, 330 + row * 80 - 3),
                        (xx, 330 + row * 80 - 3)], rng.choice([(230, 90, 90), (90, 160, 220), (250, 200, 80), (120, 200, 120), (200, 120, 200)]),
                       col2=(100, 80, 80))
                xx += w + 2
    return d, (wx0, wy0, wx1, wy1)


def room_extras(r_layer_fn=None):
    """قالیچه و جعبه اسباب‌بازی در لایهٔ نزدیک."""
    def d(r):
        r.ell(560, 640, 290, 56, (230, 100, 100), sh=0.35, hl=0)
        r.ell(560, 640, 250, 44, (250, 190, 90), sh=0.25, hl=0, alpha=0.9)
        r.ell(560, 640, 190, 32, (120, 190, 220), sh=0.25, hl=0, alpha=0.9)
        r.poly([(880, 520), (980, 520), (980, GY + 22), (880, GY + 22)], (110, 170, 230), col2=(80, 130, 200))
        r.ell(930, 520, 50, 10, (140, 195, 245), sh=0.3, hl=0)
        r.ell(910, 500, 16, 16, (240, 90, 90), sh=0.5)
        r.ell(948, 504, 14, 14, (250, 210, 70), sh=0.5)
    return d
