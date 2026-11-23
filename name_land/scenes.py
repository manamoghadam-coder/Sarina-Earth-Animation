"""ده صحنهٔ انیمیشن «سرزمین اسم‌ها»."""
import math, random, numpy as np, cv2
from lib import *
from chars import *
from bg import *
from fx import *

SPEAK = [
    (14.6, 24.8, "sun"), (40.6, 44.9, "boy"), (44.9, 55.9, "sun"), (62.0, 68.1, "sun"), (78.0, 96.6, "sun"),
    (119.6, 124.6, "boy"), (124.6, 137.6, "squirrel"), (137.6, 149.6, "boy"), (149.6, 159.6, "squirrel"),
    (174.6, 179.6, "maple"), (183.0, 186.6, "boy"), (188.6, 195.0, "maple"), (199.6, 204.6, "boy"),
    (205.0, 216.6, "maple"), (216.6, 221.6, "boy"), (221.6, 225.6, "maple"), (237.6, 244.6, "maple"),
    (262.6, 268.6, "monkey"), (268.6, 270.6, "boy"), (305.6, 312.6, "boy"), (324.6, 330.6, "monkey"),
    (347.6, 352.6, "boy"), (355.0, 359.6, "dragon"), (363.6, 367.6, "dragon"), (370.6, 378.0, "boy"),
    (389.0, 398.8, "dragon"), (416.0, 436.8, "boy"), (436.8, 449.1, "amu"), (455.7, 463.2, "amu"),
    (463.2, 467.2, "boy"), (467.2, 470.1, "amu"), (491.0, 498.4, "moon"), (499.0, 503.3, "boy"),
    (503.3, 509.5, "moon"), (518.7, 533.9, "moon"), (558.0, 564.3, "boy"),
]


class Ctx:
    def __init__(self, env):
        self.env = env

    def m(self, name, T):
        for a, b, n in SPEAK:
            if a <= T < b and n == name:
                i = min(len(self.env) - 1, int(T * 24))
                return float(self.env[i])
        return 0.0


def blink_at(T, seed=0):
    ph = (T + seed * 1.37) % 3.6
    return max(0.0, 1 - abs(ph - 0.1) / 0.1) if ph < 0.2 else 0.0


def pathx(keys, t):
    return smooth_path(keys, t)


def walker(keys, t):
    x = smooth_path(keys, t)
    x2 = smooth_path(keys, t + 0.08)
    moving = abs(x2 - x) > 0.25
    return x, (x / 24.0 if moving else 0.0)


class Scene:
    t0 = t1 = 0
    grade = ((1, 1, 1), (0, 0, 0))

    def __init__(self, ctx):
        self.ctx = ctx
        self.ready = False
        self.bh = (400, 420)       # سر پسر برای ردیف حروف
        self.gift_src = {}

    def cam(self, rel):
        return 640, 360, 1.0

    def build(self):
        pass

    def pre(self, r, T, rel):
        pass

    def actors(self, r, T, rel):
        pass

    def post(self, frame, r, T, rel):
        pass

    def render(self, T):
        if not self.ready:
            self.build()
            self.ready = True
        rel = T - self.t0
        cx, cy, z = self.cam(rel)
        frame = np.zeros((int(H * K), int(W * K), 3), np.uint8)
        cam = (cx, cy, z)
        for Ly in self.back1:
            comp_layer(frame, Ly, cam)
        r = R(frame, K * z, cx - W / (2 * z), cy - H / (2 * z))
        self.pre(r, T, rel)
        for Ly in self.back2:
            comp_layer(frame, Ly, cam)
        self.actors(r, T, rel)
        for Ly in self.front:
            comp_layer(frame, Ly, cam)
        self.post(frame, r, T, rel)
        self.draw_letters(frame, r, T)
        return frame

    # ردیف حروف جمع‌شده بالای سر پسر
    def draw_letters(self, frame, r, T):
        row = []
        for i, (Tg, ch) in enumerate(GIFTS):
            dt = T - Tg
            if dt < 0:
                continue
            spr = letter_sprite(ch, LETTER_COLS[i % 5])
            bx, by = self.bh
            slot = (bx - (i - 2) * 50, by - 40)
            if dt < 3.2 and i in self.gift_src:
                src = self.gift_src[i]
                sx, sy = src(dt) if callable(src) else src
                if dt < 1.8:
                    k = ease(dt / 0.6)
                    px, py = sx, sy - 20 * math.sin(dt * 3) * k
                    sc = 0.2 + 0.9 * k
                    sparkle_pos = (px, py)
                    blit_sprite(frame, spr, *self.to_screen(r, px, py), scale=sc * r.k / K, alpha=1.0, add=0.3)
                    for q in range(4):
                        a = q * 1.57 + T * 2
                        sparkle(r, px + math.cos(a) * 50, py + math.sin(a) * 40, 9, T + q)
                    continue
                u = ease((dt - 1.8) / 1.4)
                px, py = lerp(sx, slot[0], u), lerp(sy, slot[1], u)
                sc = lerp(1.1, 0.5, u)
                blit_sprite(frame, spr, *self.to_screen(r, px, py), scale=sc * r.k / K, alpha=1.0, add=0.3)
                continue
            if getattr(self, "hide_row", False):
                continue
            bob = math.sin(T * 2 + i) * 3
            blit_sprite(frame, spr, *self.to_screen(r, slot[0], slot[1] + bob), scale=0.5 * r.k / K, alpha=0.95,
                        add=0.15)

    def to_screen(self, r, x, y):
        sx, sy = r.P(x, y)
        return sx / K, sy / K  # blit_sprite ضرب در K می‌کند


def room_scene_layers(night):
    d, win = bedroom(night)
    near = L(lambda r: (d(r), room_extras()(r)), 1.0)
    return near, win


# ======================= ۱) بیدار شدن =======================
class S1(Scene):
    t0, t1 = 0.0, 26.0
    grade = ((1.04, 1.0, 0.95), (6, 4, 0))

    def build(self):
        s1 = full_layer((255, 235, 190), (150, 210, 250), 0.05)
        cl = clouds([110, 190, 250], 4, 0.1, scale=1.1)
        self.back1 = [s1, cl]
        near, self.win = room_scene_layers(False)
        self.back2 = [near]
        self.front = []

    def cam(self, rel):
        return 640 + 20 * ease(rel / 26), 360, 1.0 + 0.09 * ease(rel / 26)

    def pre(self, r, T, rel):
        mv = self.ctx.m("sun", T)
        sun(r, 965, 275, 82, T, mouth_=mv, mood=1.0, blink=blink_at(T, 2), glow=True)

    def actors(self, r, T, rel):
        mb = self.ctx.m("boy", T)
        # پرتو نور
        r.poly([(850, 200), (1080, 200), (360, 560), (110, 560)], (255, 236, 170), alpha=0.10)
        wake = ease((rel - 6.0) / 3.0)
        sit = ease((rel - 10.5) / 1.6)
        hop = ease((rel - 17.0) / 1.2)
        walkx = ease((rel - 18.0) / 7.0)
        if rel < 18.2:
            hy = lerp(405, 338, sit)
            hx = lerp(190, 200, sit)
            r.ell(hx + 10, hy + 110, 34, 46, (160, 196, 242), sh=0.5) if sit > 0.05 else None
            lying_boy_head(r, hx, hy, 0.82, T, mouth_=0.0 if rel < 14 else 0.5 * abs(math.sin(rel * 5)),
                           blink=blink_at(T), mood=0.7, closed=wake < 0.4, look=(1, 0))
            # بازو (دست تکان دادن) هنگام سلام
            if rel > 10.2 and rel < 17:
                a = math.sin(rel * 8) * 18
                r.cap(hx + 36, hy + 70, hx + 76 + a, hy + 10, 16, (160, 196, 242))
                r.ell(hx + 78 + a, hy + 16, 9, 9, SKIN)
            # پتو
            r.ell(330, 470, 195, 46, (104, 168, 236), sh=0.5, rim=(190, 225, 255))
            for k in range(6):
                r.ell(190 + k * 52, 462 + (k % 2) * 12, 9, 9, (255, 230, 120), sh=0.2, hl=0)
            self.bh = (hx + 20, hy - 120)
        else:
            x = lerp(330, 560, walkx)
            y = GY + 40 - 40 * (1 - hop) * 0 - 0
            jump = math.sin(min(1, (rel - 17) / 1.2) * math.pi) * 60 * (1 if rel < 18.4 else 0)
            boy(r, x, GY + 40 - jump, 1.05, t=T, mouth_=0.5 * abs(math.sin(rel * 5)) if rel < 24 else 0, walk=T * 7 if walkx < 0.99 else 0,
                arms=(22 + 20 * math.sin(T * 3), 22), outfit="pj", blink=blink_at(T), mood=0.9)
            self.bh = (x, GY + 40 - 300)

    def post(self, frame, r, T, rel):
        pass


# ======================= ۲) فراموشیِ اسم =======================
class S2(Scene):
    t0, t1 = 26.0, 55.0
    grade = ((1.0, 1.0, 1.0), (0, 0, 0))

    def build(self):
        s1 = full_layer((255, 235, 190), (150, 210, 250), 0.05)
        cl = clouds([110, 190, 250], 4, 0.1, scale=1.1)
        self.back1 = [s1, cl]
        near, _ = room_scene_layers(False)
        self.back2 = [near]
        self.front = []

    def cam(self, rel):
        return 640 + 20 - 30 * ease(rel / 29), 360, 1.09 - 0.02 * ease(rel / 29)

    def pre(self, r, T, rel):
        mv = self.ctx.m("sun", T)
        sun(r, 965, 275, 82, T, mouth_=mv, mood=1.0 if T > 44.9 else 0.5, blink=blink_at(T, 2))

    def actors(self, r, T, rel):
        mb = self.ctx.m("boy", T)
        keys = [(0, 560), (6, 540), (9, 330), (12, 330), (13.5, 560), (15, 700), (17, 700), (18.5, 520), (30, 520)]
        x, ph = walker(keys, rel)
        sad = ease((rel - 11.0) / 2.0)
        mood = lerp(0.3, -0.9, sad)
        arms = (8, 8)
        if rel < 7:
            arms = (8, 150)          # فکر کردن؛ دست روی چانه
        look = (0, 0)
        if 7 < rel < 17:
            look = (0, 1)
        boy(r, x, GY + 40, 1.05, t=T, mouth_=mb, walk=ph * 1.0, arms=arms, mood=mood, look=look, outfit="pj",
            blink=1.0 if T > 53.6 else blink_at(T))
        self.bh = (x, GY - 255)
        if rel < 7.5:
            thought(r, x + 70, GY - 260, 1.0, T)
            blit_q(r, x + 105, GY - 285, T, 0.9)
        if 9 < rel < 16:
            thought(r, x + 70, GY - 260, 0.8, T)
            blit_q(r, x + 98, GY - 276, T, 0.7)
        if 11.5 < rel < 18.5:
            # اشک
            u = (T * 1.2) % 1
            r.ell(x - 18, GY - 235 + u * 40, 3.5, 5.5, (150, 210, 255), sh=0.2, alpha=1 - u)
        if rel > 26.6 - 0:
            for q in range(10):
                a = q / 10 * math.tau + T * 3
                rad = 20 + (rel - 26.6) * 60
                sparkle(r, x + math.cos(a) * rad, GY - 200 + math.sin(a) * rad * 0.8, 8, T + q)

    def post(self, frame, r, T, rel):
        k = ease((rel - 27.2) / 1.8)
        if k > 0:
            frame[:] = np.clip(frame.astype(np.float32) * (1 - k) + 255 * k, 0, 255).astype(np.uint8)


def blit_q(r, x, y, T, s):
    """علامت سؤال «؟» (نشانهٔ فکر کردن) — با فونت فارسی."""
    _q = letter_sprite("؟", (250, 120, 140), 200)
    r._q = (x, y, s)


def draw_q(frame, r, T):
    if hasattr(r, "_q"):
        x, y, s = r._q
        sx, sy = r.P(x, y)
        blit_sprite(frame, letter_sprite("؟", (250, 120, 140), 200), sx / K, sy / K, 0.9 * s * r.k / K,
                    ang=math.sin(T * 3) * 8)
        del r._q


S2_post = S2.post


def _s2post(self, frame, r, T, rel):
    draw_q(frame, r, T)
    S2_post(self, frame, r, T, rel)


S2.post = _s2post


# ======================= ۳) پرواز به سرزمین اسم‌ها =======================
class S3(Scene):
    t0, t1 = 55.0, 104.6

    def build(self):
        sky = full_layer((255, 214, 170), (140, 205, 250), 0.03)
        rb = L(lambda r: [r.ell(640, 520, 520 - i * 14, 330 - i * 9, c, sh=0, alpha=0.55, hl=0)
                          for i, c in enumerate([(255, 120, 130), (255, 190, 100), (255, 240, 130), (140, 220, 150),
                                                (120, 190, 250)])], 0.08, blur=2)
        cl1 = clouds([90, 170, 260, 330], 11, 0.15, scale=1.3, blur=2)
        h1 = hills(470, 40, (150, 220, 190), (110, 190, 160), 2, 0.25, blur=1.5)
        h2 = hills(520, 36, (110, 200, 120), (70, 160, 100), 3, 0.5)
        gr = ground(560, (96, 190, 100), (56, 140, 80), 1.0, seed=8, flowers=[(255, 150, 190), (255, 230, 120), (180, 150, 250)])

        def path(r):
            pts_l, pts_r = [], []
            for i in range(0, 60):
                x = -PAD_X + i * 32
                yc = 640 - 30 * math.sin(x * 0.006) + (x + PAD_X) * -0.02
                pts_l.append((x, yc - 34)); pts_r.append((x, yc + 34))
            r.poly(pts_l + pts_r[::-1], (250, 226, 160), col2=(236, 196, 120))
            for i in range(0, 60, 2):
                r.glow(-PAD_X + i * 32, 640 - 30 * math.sin((-PAD_X + i * 32) * 0.006) + (i * 32) * -0.02, 30, (255, 240, 170), 0.35)
        pa = L(path, 1.0)
        self.back1 = [sky, rb, cl1, h1, h2]
        self.back2 = [gr, pa]
        self.front = [fg_leaves([(80, 170, 90), (120, 200, 110)], bottom=True, top=False, blur=6)]

    def cam(self, rel):
        if rel < 10:
            return 640 + 120 * (rel / 10), 360 - 40 * ease(rel / 10), 1.02
        if rel < 24:
            return 640 + 120, 360 - 40 * (1 - ease((rel - 10) / 6)), 1.0
        # دنبال کردن پسر هنگام راه رفتن
        k = ease((rel - 41) / 8)
        return 760 + 130 * k, 360, 1.0

    def pre(self, r, T, rel):
        pass

    def actors(self, r, T, rel):
        ms = self.ctx.m("sun", T)
        mb = self.ctx.m("boy", T)
        sx, sy = lerp(260, 200, ease(rel / 20)), 160 + math.sin(T) * 6
        if rel < 10:   # پرواز: ابرهای در حال عبور
            for i in range(9):
                x = (1500 - ((rel * 380 + i * 233) % 1800))
                y = 140 + (i * 83) % 420
                for k in range(4):
                    r.ell(x + k * 34, y + (k % 2) * 10, 46, 24, (255, 255, 255), sh=0.3, hl=0, alpha=0.85)
            by = 360 + math.sin(T * 1.5) * 8
            r.ell(640, by + 100, 120, 36, (255, 255, 255), sh=0.5, rim=(200, 220, 255))
            r.ell(590, by + 86, 70, 34, (255, 255, 255), sh=0.5)
            r.ell(700, by + 88, 76, 38, (255, 255, 255), sh=0.5)
            boy(r, 640, by + 90, 1.0, t=T, arms=(40, 40), blink=1.0 if rel < 8 else max(0, 1 - (rel - 8) / 1.5), mood=0.6,
                shadow=False, outfit="pj")
            self.bh = (640, by - 220)
            sun(r, 380, 250, 82, T, mouth_=ms, blink=blink_at(T, 1))
            for q in range(7):
                sparkle(r, 640 + math.sin(T * 2 + q) * 160, by - 40 + math.cos(T * 1.6 + q * 2) * 90, 9, T + q)
        else:
            sun(r, sx, sy, 78, T, mouth_=ms, blink=blink_at(T, 1))
            keys = [(0, 640), (14, 600), (24, 420), (28, 420), (41, 460), (49.6, 1380)]
            land = ease((rel - 10) / 3.5)
            x, ph = walker([(10, 640), (13.5, 600), (24, 560), (30, 540), (41, 540), (49.6, 1500)], rel)
            y = lerp(GY - 150, GY + 55, land) if rel < 14 else GY + 55
            self.bh = (x, y - 260)
            arms = (10, 100) if 17 < rel < 25 else (8, 8)
            boy(r, x, y, 1.0, t=T, mouth_=mb, walk=ph, arms=arms, mood=0.9, look=(0.6, -0.3) if rel < 22 else (1, 0),
                blink=blink_at(T), outfit="pj")

    def post(self, frame, r, T, rel):
        if rel >= 10:
            float_letters(frame, T, 16, 7, (150, 120, 1240, 430))
        else:
            fl = ease(rel / 2) * (1 - ease((rel - 9) / 1.5)) * 0.4
            frame[:] = np.clip(frame.astype(np.float32) + 255 * (1 - ease(rel / 1.2)) * 1.0, 0, 255).astype(np.uint8)
            float_letters(frame, T, 8, 9, (150, 120, 1240, 430), alpha=0.5 * ease((rel - 6) / 3))


# ======================= ۴) سنجاب =======================
class S4(Scene):
    t0, t1 = 104.6, 170.0
    grade = ((1.0, 1.02, 1.0), (0, 4, 0))

    def build(self):
        sky = full_layer((255, 240, 200), (170, 226, 250), 0.03)
        cl = clouds([100, 170], 21, 0.1, blur=2)
        h1 = hills(450, 50, (140, 200, 160), (110, 180, 140), 5, 0.2, blur=2.5)
        pines = forest("pine", range(-200, 1500, 90), 520, (150, 230), (90, 64, 50), (60, 140, 90), 6, 0.35, blur=1.5)
        rnds = forest("round", range(-220, 1500, 150), 560, (230, 330), (110, 76, 52), (90, 180, 90), 7, 0.6, blur=0.6)
        gr = ground(GY, (110, 196, 100), (70, 150, 80), 1.0, seed=2, flowers=[(255, 120, 150), (255, 230, 110), (250, 250, 250)])

        def bigtree(r):
            r.ell(980, GY + 8, 120, 16, (0, 0, 0), sh=0, alpha=0.2)
            r.ell(980, 360, 62, 230, (126, 84, 56), sh=0.6, rim=(230, 190, 140))
            r.ell(1000, 380, 40, 200, (110, 72, 48), sh=0.2, hl=0, alpha=0.4)
            for dx in (-70, 70):
                r.ell(980 + dx, GY - 6, 52, 12, (110, 72, 48), sh=0.3, hl=0)
            for i, (dx, dy, k) in enumerate(((-90, -40, 120), (80, -50, 128), (0, -110, 140), (-30, -10, 110), (130, 10, 100), (-140, 20, 90))):
                r.ell(980 + dx, 140 + dy, k, k * 0.82, shade((70, 160, 80), 0.9 + (i % 3) * 0.1), sh=0.6, rim=(230, 250, 170))
            r.ell(978, 400, 30, 40, (46, 30, 24), sh=0.5, hl=0)
            r.ell(978, 410, 22, 30, (30, 20, 16), sh=0, hl=0)
        bt = L(bigtree, 1.0)
        self.back1 = [sky, cl, h1, pines, rnds]
        self.back2 = [gr, bt]
        self.front = [fg_leaves([(70, 160, 80), (110, 190, 100)], blur=6)]
        self.gift_src = {0: (800, 350)}

    def cam(self, rel):
        return 660 + 40 * ease(rel / 65), 360, 1.0 + 0.07 * ease(rel / 65)

    def actors(self, r, T, rel):
        mb, msq = self.ctx.m("boy", T), self.ctx.m("squirrel", T)
        keys = [(0, -80), (9, 520), (45, 520), (62, 1100)]
        x, ph = walker(keys, rel)
        arms = (8, 8)
        if 33.0 < rel < 38.5:
            arms = (8, 105)
        if 36 < rel < 56:
            pass
        sqx = 800 if rel < 44 else lerp(800, 900, ease((rel - 44) / 3))
        nuts = rel < 47
        squirrel(r, sqx, GY + 25, 1.35, f=-1, t=T, mouth_=msq, blink=blink_at(T, 1), nuts=nuts, arms_up=0.5 * (rel > 43.5),
                 mood=0.7)
        boy(r, x, GY + 45, 1.1, t=T, mouth_=mb, walk=ph, arms=arms, mood=0.7 if rel < 12 else 1.0,
            look=(1, 0), blink=blink_at(T))
        self.bh = (x, GY - 255)
        if 49 < rel < 55.5:   # فندق را در سوراخ می‌گذارد
            u = ease((rel - 49) / 4)
            r.ell(lerp(sqx - 30, 978, u), lerp(GY - 80, 400, u), 9, 8, (150, 100, 56), sh=0.5)
        if 56 < rel < 66:   # فندق هدیه
            u = ease((rel - 56) / 2)
            r.ell(lerp(sqx - 20, x + 36, u), lerp(GY - 70, GY - 100, u), 11, 9, (150, 100, 56), sh=0.5, alpha=1 - ease((rel - 60) / 1.5))

    def post(self, frame, r, T, rel):
        fireflies(r, T, 5, 3, (100, 200, 1200, 460), col=(255, 250, 190), a=0.4, size=14)


# ======================= ۵) افرا =======================
class S5(Scene):
    t0, t1 = 170.0, 251.6
    grade = ((0.98, 1.0, 1.08), (6, 4, 0))

    def build(self):
        sky = full_layer((255, 226, 170), (255, 190, 140), 0.03)
        h1 = hills(440, 54, (230, 150, 100), (200, 120, 90), 12, 0.2, blur=3)
        trees = forest("maple", range(-200, 1500, 170), 520, (260, 360), (110, 70, 52), (220, 80, 50), 13, 0.4, blur=2)
        trees2 = forest("round", range(-120, 1500, 200), 560, (260, 340), (110, 76, 52), (210, 150, 60), 14, 0.6, blur=1)
        gr = ground(GY, (196, 160, 84), (150, 110, 70), 1.0, seed=6, flowers=[(230, 90, 60), (250, 190, 70)], tufts=(160, 130, 60))
        self.back1 = [sky, h1, trees, trees2]
        self.back2 = [gr]
        self.front = [fg_leaves([(220, 80, 50), (250, 160, 60), (200, 60, 40)], blur=7)]
        self.gift_src = {1: lambda dt: (930 - 440 * ease(dt / 1.6), 230 + 330 * ease(dt / 1.6))}

    def cam(self, rel):
        return 700 + 60 * math.sin(rel / 80 * 3), 360, 1.02 + 0.05 * ease(rel / 81)

    def actors(self, r, T, rel):
        mb, mm = self.ctx.m("boy", T), self.ctx.m("maple", T)
        keys = [(0, -60), (5, 420), (12, 330), (14, 470), (23, 470), (28, 480), (74, 700), (76, 700), (81, 740)]
        x, ph = walker(keys, rel)
        look = (0, 0)
        if 8 < rel < 17:
            look = (math.sin(rel * 1.3) * 1.0, 0)
        elif rel >= 17:
            look = (1, 0)
        arms = (8, 8)
        hug = ease((rel - 76) / 2)
        if hug > 0.05:
            arms = (lerp(8, 70, hug), lerp(8, 70, hug))
        gust = 1 if 59 < rel < 67 else 0
        maple(r, 930, GY + 28, 1.0, T + gust * math.sin(T * 5) * 0.8, mouth_=mm, blink=blink_at(T, 3), mood=0.9)
        boy(r, x, GY + 45, 1.1, t=T, mouth_=mb, walk=ph, arms=arms, mood=0.8, look=look, blink=blink_at(T))
        self.bh = (x, GY - 255)
        n = 40 if gust else 8
        falling(r, T, n, 5, [(220, 70, 50), (250, 160, 50), (240, 110, 40)], area=(300, 1250), top=-20, bot=640,
                speed=90 if gust else 30, size=9)

    def post(self, frame, r, T, rel):
        fireflies(r, T, 6, 4, (200, 200, 1200, 460), col=(255, 220, 140), a=0.45, size=14)


# ======================= ۶) میمون‌ها =======================
class S6(Scene):
    t0, t1 = 251.6, 335.6
    grade = ((0.97, 1.04, 0.97), (0, 6, 0))

    def build(self):
        sky = full_layer((210, 240, 200), (150, 220, 170), 0.03)
        far = forest("banana", range(-220, 1500, 130), 500, (260, 360), (110, 100, 60), (40, 130, 70), 31, 0.25, blur=3)
        mid = forest("banana", range(-200, 1500, 170), 540, (320, 440), (120, 100, 60), (50, 160, 80), 32, 0.5, blur=1.2)
        gr = ground(GY, (96, 176, 96), (50, 120, 70), 1.0, seed=9, flowers=[(255, 110, 160), (255, 220, 90)], tufts=(40, 130, 60))

        def branch(r):
            r.cap(1100, GY + 20, 1090, 120, 54, (118, 84, 56))
            r.ell(1096, GY + 10, 96, 20, (110, 76, 50), sh=0.3, hl=0)
            r.cap(1090, 340, 640, 330, 26, (126, 90, 60))
            for dx, dy, k in ((900, 150, 130), (1000, 100, 150), (780, 120, 120), (1150, 140, 140), (660, 160, 100)):
                r.ell(dx, dy, k, k * 0.5, (50, 150, 70), sh=0.5, ang=(dx % 40) - 20)
            for i in range(3):
                r.curve([(900 + i * 70, 340), (900 + i * 70 + math.sin(i) * 14, 440), (890 + i * 70, 520)], 4, (60, 150, 80))
        br = L(branch, 1.0)
        self.back1 = [sky, far, mid]
        self.back2 = [gr, br]
        self.front = [fg_leaves([(40, 130, 70), (60, 150, 80)], blur=6)]
        self.gift_src = {2: lambda dt: (880, 350 + 0 * dt)}

    def cam(self, rel):
        return 700 + 60 * ease(rel / 84), 360, 1.0 + 0.04 * ease(rel / 84)

    def actors(self, r, T, rel):
        mb, mk = self.ctx.m("boy", T), self.ctx.m("monkey", T)
        hold = 0 if rel < 19 else 1
        # پسر: ورود → رفتن بالا → پایین آمدن
        keys = [(0, -60), (8, 520), (21, 520), (26.5, 640), (30, 640), (73, 640), (77, 520), (78.5, 520), (84, 1500)]
        x, ph = walker(keys, rel)
        lift = ease((rel - 22.5) / 3.8) - ease((rel - 73) / 3.0)
        y = lerp(GY + 45, 330, lift)
        # میمون‌ها
        t3 = rel - 45
        m1x = lerp(820, 600, ease((rel - 17) / 3)) if rel < 40 else 700
        m1y = lerp(335, GY + 30, ease((rel - 17) / 3)) if rel < 40 else 335
        if lift > 0.02 and lift < 0.98:
            m1x, m1y = x - 62, y - 0
        elif lift >= 0.98:
            m1x, m1y = 790 + 24 * math.sin(T * 2), 335 - 14 * abs(math.sin(T * 4)) * (1 if rel < 70 else 0)
        m2x = 940 if rel < 20 else (x + 62 if lift < 0.98 and rel < 40 else 880)
        m2y = (335 if rel < 17 else lerp(335, GY + 30, ease((rel - 17) / 3))) if rel < 22 else (y if lift < 0.98 else 335)
        if lift >= 0.98:
            m2x, m2y = 940, 335 - 10 * abs(math.sin(T * 3 + 1))
        m3x, m3y = 330 + 20 * math.sin(T * 1.5), GY + 40
        monkey(r, m3x, m3y, 1.25, f=1, t=T, mouth_=0.3 * (rel > 38) * abs(math.sin(T * 6)),
               arms=(150, 150) if 36 < rel < 52 else (20, 20), jump=14 * abs(math.sin(T * 4)) * (rel > 38 and rel < 52))
        monkey(r, m1x, m1y, 1.25, f=1, t=T, mouth_=mk, blink=blink_at(T, 1), arms=(150 if 22 < rel < 27 else 30, 150 if 22 < rel < 27 else 30),
               jump=12 * abs(math.sin(T * 4)) * (22 < rel < 27))
        monkey(r, m2x, m2y, 1.25, f=-1, t=T, mouth_=0.0, blink=blink_at(T, 2), arms=(150 if 22 < rel < 27 else 30, 150 if 22 < rel < 27 else 30), banana=lift > 0.98)
        mood = 0.9 if rel < 42 else -0.8
        mouth_b = mb if (rel > 52) else (0.2 + 0.7 * abs(math.sin(rel * 6)) if 26.5 < rel < 40 else mb)
        boy(r, x, y, 1.1, t=T, mouth_=mouth_b, walk=ph if lift < 0.02 else 0, arms=(110, 110) if 0.02 < lift < 0.98 else
            ((120, 40) if 29 < rel < 40 and int(rel * 2) % 2 == 0 else (8, 8)), mood=mood, look=(1, 0), blink=blink_at(T))
        self.bh = (x, y - 255)
        # موزهای پرتابی
        if 28 < rel < 42:
            for i in range(4):
                u = ((rel * 0.7 + i / 4) % 1)
                banana_item(r, lerp(x - 20, m3x + 20, u), lerp(y - 130, GY - 40, u) - 150 * math.sin(u * math.pi), s=1.0)
        # هدیه (م زرد خال‌خالی)
        if 69 < rel < 76.5:
            u = ease((rel - 69) / 3)
            gift_m(r, lerp(940, 880, u), 360 - 10 * u, 1.2)

    def post(self, frame, r, T, rel):
        fireflies(r, T, 8, 6, (200, 140, 1200, 480), col=(255, 250, 180), a=0.4, size=16)


# ======================= ۷) اژدهای کوچولو =======================
class S7(Scene):
    t0, t1 = 335.6, 413.0
    grade = ((1.0, 0.98, 1.04), (4, 0, 8))

    def build(self):
        sky = full_layer((120, 110, 190), (250, 170, 140), 0.03)
        st = stars(40, 5, 0.04, ymax=220)
        far = hills(430, 70, (90, 80, 140), (70, 60, 120), 41, 0.2, blur=3)
        rocks = hills(500, 40, (126, 96, 100), (96, 70, 84), 42, 0.5, blur=1.2, freq=1.8)
        gr = ground(GY, (150, 116, 100), (100, 76, 76), 1.0, seed=10, tufts=(120, 100, 90))

        def cave(r):
            r.ell(1030, 430, 190, 220, (92, 70, 78), sh=0.6, rim=(200, 150, 140))
            r.ell(1030, 480, 120, 150, (30, 22, 30), sh=0, hl=0)
            r.ell(1030, 500, 90, 110, (50, 34, 40), sh=0, alpha=0.7, hl=0)
            for dx, dy, k in ((-150, 120, 60), (170, 100, 70), (-60, 170, 44)):
                r.ell(1030 + dx, 430 + dy, k, k * 0.8, (120, 92, 96), sh=0.6)
            r.ell(660, GY - 12, 74, 40, (130, 100, 104), sh=0.6, rim=(220, 180, 170))     # تخته‌سنگ نشیمن
            r.ell(660, GY - 40, 56, 22, (140, 108, 110), sh=0.5, hl=0)
        cv = L(cave, 1.0)
        self.back1 = [sky, st, far, rocks]
        self.back2 = [gr, cv]
        self.front = [fg_leaves([(60, 46, 70), (80, 60, 90)], blur=8, top=False)]
        self.gift_src = {3: lambda dt: (760, 380 - 20 * dt)}

    def cam(self, rel):
        return 680 + 30 * ease(rel / 77), 360, 1.0 + 0.06 * ease(rel / 77)

    def actors(self, r, T, rel):
        mb, md = self.ctx.m("boy", T), self.ctx.m("dragon", T)
        keys = [(0, -80), (9, 440), (36, 440), (41, 560), (62, 560), (72, 560), (77.4, 1500)]
        x, ph = walker(keys, rel)
        cry = 1.0 - ease((rel - 46) / 2.0)
        happy = ease((rel - 46) / 2.0)
        near = 1 if 38 < rel < 50 else 0
        dx = 760
        fire = 62.5 < rel < 67.5
        d_mouth = md if not fire else 0.7
        dragon(r, dx, GY + 22, 1.4, f=-1, t=T, mouth_=d_mouth, blink=1.0 if 44 < rel < 46.5 else blink_at(T, 1),
               mood=0.9 * happy, cry=cry, fire=0)
        blow = 42.5 < rel < 44.5
        boy(r, x, GY + 45, 1.1, t=T, mouth_=(0.45 if blow else mb), walk=ph, arms=(8, 8) if not (62 < rel < 70) else (8, 90),
            mood=0.8 if rel < 40 else 1.0, look=(1, 0), blink=blink_at(T))
        self.bh = (x, GY - 255)
        if blow:
            wave_lines(r, x + 50, GY - 160, 90, T)
        if 44.4 < rel < 50:
            u = ease((rel - 44.4) / 5.5)
            r.ell(lerp(dx - 12, dx - 150, u), lerp(GY - 190, GY - 40, u) - 70 * math.sin(u * math.pi), 6, 4, (100, 150, 70),
                  ang=u * 300, sh=0.3)
        if fire:
            fire_puff(r, dx - 55, GY - 105, T, dirn=-1, power=1.0)
        # چوب → حرف
        if rel < 62.5:
            if rel > 56:
                r.cap(500, GY + 24, 560, GY + 10, 9, (130, 90, 60))
        elif rel < 69.5:
            u = ease((rel - 64) / 4)
            if u < 0.5:
                r.cap(dx - 200, GY - 70, dx - 120, GY - 90, 9 * (1 - u), (200 - 80 * u, 120, 60))
            sp = letter_sprite("ا", (255, 190, 80))
            self._spr = (sp, lerp(dx - 170, 600, u), lerp(GY - 80, 380, u), 0.3 + 0.8 * u)
        else:
            self._spr = None
        if 62.5 < rel < 70:
            self.gift_src[3] = lambda dt: (dx - 170, 380)

    def post(self, frame, r, T, rel):
        if getattr(self, "_spr", None) and 64 < rel < 69.5:
            sp, x, y, s = self._spr
            blit_sprite(frame, sp, *self.to_screen(r, x, y), scale=s * r.k / K, add=0.3)
        fireflies(r, T, 6, 7, (100, 150, 1200, 500), col=(255, 190, 120), a=0.45, size=14)


# ======================= ۸) عمو نوروز =======================
class S8(Scene):
    t0, t1 = 413.0, 474.0
    grade = ((1.03, 1.0, 0.96), (6, 4, 0))

    def build(self):
        sky = full_layer((255, 220, 190), (200, 230, 250), 0.03)
        cl = clouds([100, 160], 51, 0.1, col=(255, 240, 240), blur=2)
        h1 = hills(450, 50, (170, 220, 170), (130, 200, 150), 52, 0.2, blur=3)
        bl = forest("round", range(-220, 1500, 140), 520, (240, 330), (120, 84, 66), (255, 176, 206), 53, 0.4, blur=1.5, pink=True)
        bl2 = forest("round", range(-150, 1500, 190), 560, (260, 350), (120, 84, 66), (255, 150, 190), 54, 0.65, blur=0.6, pink=True)
        gr = ground(GY, (120, 206, 110), (76, 160, 90), 1.0, seed=12, flowers=[(255, 90, 110), (255, 220, 80), (250, 250, 250), (200, 120, 250)])
        self.back1 = [sky, cl, h1, bl, bl2]
        self.back2 = [gr]
        self.front = [fg_leaves([(255, 176, 206), (255, 200, 220), (120, 200, 110)], blur=7)]
        self.gift_src = {4: lambda dt: (600 + 0 * dt, 380 - 18 * dt)}

    def cam(self, rel):
        return 600 + 200 * ease(rel / 22) - 30 * ease((rel - 24) / 30), 360, 1.0 + 0.05 * ease((rel - 22) / 30)

    def actors(self, r, T, rel):
        mb, ma = self.ctx.m("boy", T), self.ctx.m("amu", T)
        keys = [(0, 80), (21.5, 760), (36, 780), (37, 740), (60, 740)]
        x, ph = walker(keys, rel)
        sing = mb
        ax_keys = [(0, 1500), (22.5, 1400), (29, 1000), (36, 1000), (50, 1000), (58, 1100), (61, 1600)]
        ax, aph = walker(ax_keys, rel)
        aph = aph * 1.0
        take = 35.5 < rel < 40
        if rel > 22:
            amu(r, ax, GY + 38, 1.15, f=-1, t=T, mouth_=ma, blink=blink_at(T, 2), walk=aph,
                arms=(10, 70 if rel > 56 and int(T * 3) % 2 == 0 else 10) if rel > 56 else (10, 10), mood=1.0)
        boy(r, x, GY + 45, 1.1, t=T, mouth_=sing, walk=ph, arms=(8, 8) if not take else (8, 120), mood=1.0,
            look=(1, 0), blink=blink_at(T))
        self.bh = (x, GY - 255)
        if rel < 24:
            notes(r, T, x + 40, GY - 270, n=5)
        if 35 < rel < 36.5:
            pass

    def post(self, frame, r, T, rel):
        falling(r, T, 26, 9, [(255, 190, 215), (255, 220, 235)], area=(0, 1280), top=-20, bot=640, speed=36, size=7)
        fireflies(r, T, 6, 8, (100, 120, 1200, 480), col=(255, 240, 200), a=0.4, size=12)


# ======================= ۹) غروب و خانم ماه =======================
class S9(Scene):
    t0, t1 = 474.0, 514.5
    grade = ((0.96, 0.96, 1.06), (0, 0, 10))

    def build(self):
        sky = full_layer((70, 70, 140), (255, 150, 120), 0.03)
        st = stars(70, 6, 0.04, ymax=300)
        far = hills(440, 60, (110, 80, 140), (80, 60, 120), 61, 0.2, blur=3)
        mid = forest("pine", range(-200, 1500, 100), 540, (170, 260), (60, 44, 60), (50, 70, 100), 62, 0.5, blur=1.2)
        gr = ground(GY, (72, 110, 110), (46, 76, 90), 1.0, seed=14, tufts=(60, 100, 110))

        def rock(r):
            r.ell(560, GY - 2, 100, 34, (0, 0, 0), sh=0, alpha=0.2)
            r.ell(560, GY - 30, 90, 50, (120, 116, 136), sh=0.6, rim=(220, 200, 220))
        rk = L(rock, 1.0)
        self.back1 = [sky, st, far, mid]
        self.back2 = [gr, rk]
        self.front = [fg_leaves([(40, 60, 80), (56, 80, 100)], blur=8, top=False)]

    def cam(self, rel):
        return 640, 360, 1.0 + 0.05 * ease(rel / 40)

    def pre(self, r, T, rel):
        rise = ease((rel - 0.5) / 8)
        mm = self.ctx.m("moon", T)
        moon(r, 930, lerp(520, 190, rise), 80, T, mouth_=mm, mood=1.0, blink=blink_at(T, 4))

    def actors(self, r, T, rel):
        mb = self.ctx.m("boy", T)
        x = lerp(160, 560, ease(rel / 5))
        walking = rel < 5
        up = ease((rel - 35.5) / 5)
        y = GY + 20 - 60 * up - 40 * up * up * 3
        look = (0, -0.8) if rel > 8 else (1, 0)
        boy(r, x, GY - 20 - 330 * up * up + 0, 1.1, t=T, mouth_=mb, walk=(T * 5 if walking else 0), arms=(8, 8) if rel < 34 else (70, 70),
            mood=-0.5 if 24 < rel < 30 else 0.4, look=look, blink=0.5 if 5 < rel < 14 else blink_at(T))
        self.bh = (x, GY - 20 - 330 * up * up - 255)
        if rel > 34:
            for q in range(14):
                a = q / 14 * math.tau + T * 2
                sparkle(r, x + math.cos(a) * (50 + 20 * math.sin(T * 3 + q)), (GY - 20 - 330 * up * up) - 110 + math.sin(a) * 90, 8, T + q)
        fireflies(r, T, 12, 9, (100, 300, 1200, 540), col=(255, 240, 150), a=0.7, size=26)


# ======================= ۱۰) شب، ساخته شدن اسم =======================
class S10(Scene):
    t0, t1 = 514.5, 700.0
    grade = ((0.98, 0.98, 1.04), (0, 0, 4))
    hide_row = True

    def build(self):
        sky = full_layer((24, 26, 70), (52, 56, 120), 0.05)
        st = stars(90, 8, 0.06, ymax=500)
        self.back1 = [sky, st]
        near, _ = room_scene_layers(True)
        self.back2 = [near]
        self.front = []
        self.word = self._word()

    def _word(self):
        from PIL import Image, ImageDraw, ImageFont
        f = ImageFont.truetype("/home/user/Sarina-Earth-Animation/assets/fonts/Vazirmatn-ExtraBold.ttf", 300)
        txt = "سامان"
        bb = f.getbbox(txt, direction="rtl", language="fa")
        pad = 80
        w, h = bb[2] - bb[0] + 2 * pad, bb[3] - bb[1] + 2 * pad
        m = Image.new("L", (w, h), 0)
        ImageDraw.Draw(m).text((pad - bb[0], pad - bb[1]), txt, font=f, fill=255, direction="rtl", language="fa")
        m = np.array(m)
        glow = cv2.GaussianBlur(m, (0, 0), 18)
        g = np.array(bgr((255, 214, 110)), np.float32)
        body = m[..., None] / 255.0
        yy = np.linspace(1.2, 0.85, h)[:, None, None]
        img = (glow[..., None] / 255.0) * g * 0.9
        img = img * (1 - body) + body * np.clip(g * yy + 30, 0, 255)
        al = np.clip(np.maximum(m, glow * 0.85), 0, 255).astype(np.float32) / 255.0
        return np.clip(img, 0, 255).astype(np.uint8), al

    def cam(self, rel):
        return 640 + 20 - 60 * ease(rel / 69), 360, 1.1 - 0.02 * ease(rel / 69)

    def pre(self, r, T, rel):
        mm = self.ctx.m("moon", T)
        moon(r, 965, 275, 82, T, mouth_=mm, mood=1.0, blink=0.5 if (T > 570 or T < 518) else blink_at(T, 3))

    def actors(self, r, T, rel):
        mb = self.ctx.m("boy", T)
        sit = ease((T - 558.0) / 1.2) - ease((T - 569.5) / 1.5)
        hx, hy = 200, 405 - 70 * sit
        closed = (T < 514.5 + 6.5) is False and T < 558 or T > 572
        happy_mouth = mb if T > 558 else (0.0)
        if sit > 0.05:
            r.ell(hx + 10, hy + 110, 34, 46, (160, 196, 242), sh=0.5)
            for sgn, a in ((1, 40 if 558.5 < T < 566 else 10),):
                r.cap(hx + 30, hy + 80, hx + 70, hy + 30 - a * 0.8, 16, (160, 196, 242))
        lying_boy_head(r, hx, hy, 0.82, T, mouth_=happy_mouth if T > 558 and T < 569 else 0,
                       blink=0.0, mood=1.0 if T > 530 else 0.5, closed=closed, look=(1, 0))
        r.ell(340, 478, 195, 40, (80, 110, 190), sh=0.5, rim=(160, 190, 240))
        for k in range(6):
            r.ell(190 + k * 52, 470 + (k % 2) * 10, 9, 9, (255, 230, 120), sh=0.2, hl=0)
        self.bh = (hx + 20, hy - 100)
        # بوسه‌ی ماه
        if 515.5 < T < 519:
            u = (T - 515.5) / 3.5
            r.ell(lerp(950, 260, ease(u)), lerp(260, 360, ease(u)) - 30 * math.sin(u * math.pi), 9, 8, (255, 140, 170), sh=0.3, alpha=1 - u * 0.4)
            sparkle(r, lerp(950, 260, ease(u)), lerp(260, 360, ease(u)) - 30 * math.sin(u * math.pi), 10, T, col=(255, 180, 200))
        # حباب‌های خاطره 534–545
        if 533.9 < T < 545.8:
            idx = int((T - 533.9) / 2.4)
            idx = min(4, idx)
            u = (T - 533.9) / 2.4 - idx
            sc = ease(u * 4) * (1 - ease((u - 0.85) * 6.6))
            bx, by, rad = 330, 170, 130 * sc
            for i, (dx, dy, rr) in enumerate(((-60, 90, 7), (-40, 66, 11), (-14, 42, 16))):
                r.ell(hx + 60 + dx * 0.5 + 30, hy - 30 + dy * 0.7, rr * sc, rr * sc, (255, 255, 255), sh=0.3, alpha=0.9, hl=0)
            if sc > 0.05:
                r.ell(bx + 100, by, rad, rad, (255, 255, 255), sh=0.25, alpha=0.95, hl=0)
                r.ell(bx + 100, by, rad - 5, rad - 5, (190, 226, 250), sh=0.25, alpha=0.97, hl=0)
                s = rad / 130 * 0.55
                fy = by + rad * 0.55
                if idx == 0:
                    squirrel(r, bx + 100, fy, s * 1.5, t=T, mouth_=0, nuts=True)
                elif idx == 1:
                    maple(r, bx + 100, fy, s * 0.9, T)
                elif idx == 2:
                    monkey(r, bx + 100, fy, s * 1.5, t=T, mouth_=0, arms=(150, 150))
                elif idx == 3:
                    dragon(r, bx + 100, fy, s * 1.4, t=T, mouth_=0, mood=1.0)
                else:
                    amu(r, bx + 100, fy, s * 1.0, t=T, mouth_=0)
        for q in range(5):
            sparkle(r, 700 + q * 40, 150 + (q % 2) * 60, 7, T + q, a=0.4) if False else None

    def post(self, frame, r, T, rel):
        # حروف: از ردیف بالای سر → قوس → واژهٔ «سامان»
        if T < 545.0:
            return
        bx, by = 230, 170
        pos_final = {0: (790, 220), 1: (710, 220), 2: (630, 220), 3: (550, 220), 4: (470, 220)}   # س سمت راست
        # نمای قوس
        for i, (Tg, ch) in enumerate(GIFTS):
            spr = letter_sprite(ch, LETTER_COLS[i % 5])
            start = (220 - (i - 2) * 50, 270)
            arc = (330 + (4 - i) * 95 + 140, 215 + 20 * math.sin(i * 1.3))
            u = ease((T - 545.0) / 3.0)
            px, py = lerp(start[0], arc[0], u), lerp(start[1], arc[1], u) + math.sin(T * 2 + i) * 4
            pulse_t = 551.2 + i * 1.1
            pulse = max(0.0, 1 - abs(T - pulse_t) / 0.5)
            sc = lerp(0.5, 0.9, u) * (1 + 0.45 * pulse)
            join = ease((T - 556.2) / 1.6)
            if join < 1:
                blit_sprite(frame, spr, *self.to_screen(r, px, py), scale=sc * r.k / K, alpha=(1 - join), add=0.4 * pulse + 0.15)
            if pulse > 0:
                sparkle(r, px, py - 30, 12, T + i, a=0.7)
        join = ease((T - 556.2) / 1.6)
        if join > 0:
            wimg, wal = self.word
            fade = 1 - ease((T - 579.5) / 3)
            bob = math.sin(T * 1.5) * 6
            blit_sprite(frame, (wimg, wal), *self.to_screen(r, 580, 215 + bob), scale=(0.62 + 0.04 * math.sin(T * 2)) * r.k / K, alpha=join, add=0.2)
            for q in range(10):
                a = q / 10 * math.tau + T * 0.8
                sparkle(r, 580 + math.cos(a) * 230, 215 + math.sin(a) * 70 + bob, 8, T + q, a=0.6 * join)
        # ستاره‌ها و Zzz
        if T > 570.5:
            for q in range(3):
                u = ((T * 0.35 + q / 3) % 1)
                _z = letter_sprite("z", (200, 210, 255), 120) if False else None
