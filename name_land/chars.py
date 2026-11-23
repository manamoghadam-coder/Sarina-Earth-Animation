"""شخصیت‌ها: همه با بیضی‌های سایه‌دار. مختصات محلی: پای شخصیت = (0,0)، بالا منفی."""
import math, numpy as np, cv2
from lib import *

SKIN = (244, 196, 158)
DARK = (52, 34, 40)
MOUTH = (150, 45, 55)


class C:
    def __init__(self, r, x, y, s=1.0, f=1):
        self.r, self.x, self.y, self.s, self.f = r, x, y, s, f

    def p(self, dx, dy):
        return self.x + self.f * dx * self.s, self.y + dy * self.s

    def e(self, dx, dy, rx, ry, col, ang=0, **kw):
        x, y = self.p(dx, dy)
        self.r.ell(x, y, rx * self.s, ry * self.s, col, ang * self.f, **kw)

    def cap(self, x0, y0, x1, y1, w, col, **kw):
        a, b = self.p(x0, y0), self.p(x1, y1)
        self.r.cap(a[0], a[1], b[0], b[1], w * self.s, col, **kw)

    def poly(self, pts, col, **kw):
        self.r.poly([self.p(a, b) for a, b in pts], col, **kw)

    def curve(self, pts, w, col):
        self.r.curve([self.p(a, b) for a, b in pts], w * self.s, col)

    def shadow(self, rx=40, ry=9, a=0.28):
        self.r.ell(self.x, self.y + 2 * self.s, rx * self.s * 1.15, ry * self.s * 1.15, (0, 0, 0), sh=0, alpha=a * 0.5)
        self.r.ell(self.x, self.y + 2 * self.s, rx * self.s, ry * self.s, (0, 0, 0), sh=0, alpha=a)


def eye(c, dx, dy, rx, ry, blink=0.0, look=(0, 0), iris=(70, 45, 35), white=(255, 255, 255), sad=0.0):
    k = 1 - 0.92 * blink
    c.e(dx, dy, rx, ry * k, white, sh=0.2, hl=0)
    if k > 0.3:
        c.e(dx + look[0] * rx * 0.35, dy + look[1] * ry * 0.3, rx * 0.62, ry * 0.7 * k, iris, sh=0.3, hl=0)
        c.e(dx + look[0] * rx * 0.35 - rx * 0.18, dy + look[1] * ry * 0.3 - ry * 0.25, rx * 0.2, ry * 0.2 * k,
            (255, 255, 255), sh=0, hl=0)


def mouth(c, dx, dy, w, m, mood=0.5, col=MOUTH):
    """m: باز بودن 0..1. mood: لبخند(+) / ناراحتی(-) برای حالت بسته."""
    if m > 0.08:
        c.e(dx, dy + 2 + 3 * m, w * (0.7 + 0.15 * m), 2.5 + 11 * m * w / 12, col, sh=0.3, hl=0)
        if m > 0.35:
            c.e(dx, dy + 5 + 8 * m, w * 0.45, 3 * m + 1, (235, 110, 120), sh=0, hl=0)
    else:
        pts = []
        for i in range(9):
            u = i / 8 * 2 - 1
            pts.append((dx + u * w, dy + (0.5 - u * u) * 7 * mood))
        c.curve(pts, 2.4, col)


def brows(c, dx, dy, w, mood, col=DARK):
    # mood>0 شاد (کمی بالا)، <0 غمگین (پایین‌داخل)
    if mood < -0.1:
        c.cap(-dx - w / 2, dy + 3, -dx + w / 2, dy - 3 + 2 * mood * -1, 3, col, hl=False)
        c.cap(dx + w / 2, dy + 3, dx - w / 2, dy - 3 + 2 * mood * -1, 3, col, hl=False)
    else:
        c.cap(-dx - w / 2, dy + 1, -dx + w / 2, dy - 2 * mood, 3, col, hl=False)
        c.cap(dx + w / 2, dy + 1, dx - w / 2, dy - 2 * mood, 3, col, hl=False)


def boy(r, x, y, s=1.0, f=1, t=0, mouth_=0.0, walk=0.0, arms=(8, 8), mood=0.6, look=(0, 0), outfit="day",
        blink=0.0, shadow=True, bob=True):
    c = C(r, x, y, s, f)
    sw = math.sin(walk)
    b = (math.sin(t * 2.2) * 1.5 if bob else 0) - abs(sw) * 4 * (1 if abs(walk) > 0 else 0)
    if outfit == "day":
        shirt, short, shoe = (250, 196, 64), (64, 138, 176), (200, 80, 70)
    else:
        shirt, short, shoe = (160, 196, 242), (160, 196, 242), (240, 220, 190)
    if shadow:
        c.shadow(36, 9)
    c.y = y + b * s
    # پاها
    for side in (-1, 1):
        a = math.radians(sw * 26 * side)
        hip = (side * 11, -62)
        foot = (hip[0] + math.sin(a) * 52, -10 + (math.cos(a) - 1) * 14 - (abs(sw) * 6 if side * sw > 0 else 0))
        c.cap(hip[0], hip[1], foot[0], foot[1], 15, SKIN if outfit == "day" else short)
        c.e(foot[0] + 4, foot[1] + 6, 17, 9, shoe)
    # بدن
    c.e(0, -74, 31, 22, short)
    c.e(0, -102, 29, 38, shirt, rim=(255, 220, 180))
    # دست‌ها
    for side, ang in ((-1, arms[0]), (1, arms[1])):
        a = math.radians(ang)
        sh = (side * 26, -122)
        hand = (sh[0] + side * math.sin(a) * 46, sh[1] + math.cos(a) * 46)
        c.cap(sh[0], sh[1], hand[0], hand[1], 14, shirt if ang < 100 else SKIN)
        c.e(hand[0], hand[1], 8.5, 8.5, SKIN)
    # سر
    c.e(0, -170, 46, 44, SKIN, rim=(255, 215, 170))
    c.e(-46, -166, 8, 10, SKIN, sh=0.3)
    c.e(46, -166, 8, 10, SKIN, sh=0.3)
    c.e(0, -194, 48, 26, (84, 56, 42), sh=0.5)
    c.e(-24, -190, 26, 14, (84, 56, 42), ang=-18, sh=0.5)
    c.e(14, -218, 9, 15, (84, 56, 42), ang=22 + math.sin(t * 2) * 4, sh=0.5)
    for sgn in (-1, 1):
        eye(c, sgn * 17, -168, 11, 13, blink, look)
    brows(c, 17, -186 if mood > -0.1 else -184, 18, mood)
    c.e(0, -158, 4, 3, shade(SKIN, 0.85), sh=0, hl=0)
    c.e(-29, -152, 8, 5, (255, 140, 130), sh=0, alpha=0.45, hl=0)
    c.e(29, -152, 8, 5, (255, 140, 130), sh=0, alpha=0.45, hl=0)
    mouth(c, 0, -145, 9, mouth_, mood)


def sun(r, x, y, rad, t, mouth_=0.0, mood=1.0, blink=0.0, rays=True, glow=True):
    c = C(r, x, y, rad / 90, 1)
    if glow:
        r.glow(x, y, rad * 3.0, (255, 210, 120), 0.55)
    if rays:
        for i in range(14):
            a = i / 14 * math.tau + t * 0.25
            L = 38 + 8 * math.sin(t * 2 + i * 1.7)
            pts = []
            for da, rr in ((-0.11, 96), (0, 96 + L), (0.11, 96)):
                pts.append((math.cos(a + da) * rr, math.sin(a + da) * rr))
            c.poly(pts, (255, 190, 60), alpha=0.95)
    c.e(0, 0, 92, 92, (255, 200, 70), sh=0.5, rim=(255, 240, 160))
    for sgn in (-1, 1):
        eye(c, sgn * 30, -10, 11, 14, blink, iris=(120, 70, 30))
        c.e(sgn * 52, 20, 13, 8, (255, 130, 100), sh=0, alpha=0.5, hl=0)
    mouth(c, 0, 26, 17, mouth_, mood)


def moon(r, x, y, rad, t, mouth_=0.0, mood=1.0, blink=0.0):
    c = C(r, x, y, rad / 90, 1)
    r.glow(x, y, rad * 3.2, (200, 215, 255), 0.5)
    c.e(0, 0, 92, 92, (226, 232, 250), sh=0.5, rim=(255, 255, 255))
    for cx_, cy_, rr in ((-48, -40, 14), (52, 38, 18), (-40, 52, 10)):
        c.e(cx_, cy_, rr, rr, (205, 212, 238), sh=0.2, hl=0)
    for sgn in (-1, 1):
        eye(c, sgn * 30, -10, 11, 13, max(blink, 0.35), iris=(70, 70, 110))
        c.e(sgn * 52, 20, 13, 8, (255, 160, 170), sh=0, alpha=0.5, hl=0)
    mouth(c, 0, 26, 16, mouth_, mood)


def squirrel(r, x, y, s=1.0, f=1, t=0, mouth_=0.0, blink=0.0, nuts=True, arms_up=0.0, mood=0.6):
    c = C(r, x, y, s, f)
    c.shadow(40, 8)
    wag = math.sin(t * 2.4) * 8
    c.e(-36, -78, 24, 62, (176, 100, 52), ang=18 + wag, rim=(255, 190, 120))
    c.e(-40, -108, 14, 28, (236, 196, 150), ang=18 + wag, sh=0.4)
    c.e(0, -46, 31, 42, (190, 112, 62), rim=(255, 190, 120))
    c.e(5, -42, 19, 30, (240, 214, 170), sh=0.4)
    for sgn in (-1, 1):
        c.e(sgn * 14, -6, 13, 8, (176, 100, 52))
    # سر
    c.e(2, -106, 32, 28, (196, 116, 66), rim=(255, 200, 130))
    for sgn in (-1, 1):
        c.e(sgn * 22 + 2, -132, 9, 14, (176, 100, 52), ang=sgn * 14)
        c.e(sgn * 22 + 2, -131, 4, 8, (240, 170, 150), ang=sgn * 14, sh=0, hl=0)
    c.e(4, -96, 18, 13, (244, 222, 184), sh=0.4)
    c.e(4, -102, 5, 4, (60, 36, 36), sh=0.3)
    for sgn in (-1, 1):
        eye(c, sgn * 13 + 2, -112, 7, 8.5, blink, look=(0.4, 0))
    c.e(-10, -98, 6, 4, (255, 150, 130), sh=0, alpha=0.4, hl=0)
    c.e(16, -98, 6, 4, (255, 150, 130), sh=0, alpha=0.4, hl=0)
    mouth(c, 4, -90, 6, mouth_, mood)
    c.e(0, -82, 3, 5, (250, 250, 240), sh=0, hl=0) if mouth_ > 0.4 else None
    # دست‌ها + فندق
    up = arms_up
    for sgn in (-1, 1):
        c.cap(sgn * 22, -62, sgn * 14 + 6, -46 - 10 * up, 10, (190, 112, 62), hl=False)
    if nuts:
        for dx, dy in ((8, -46), (22, -50), (14, -38)):
            c.e(dx, dy - 10 * up, 9, 8, (150, 100, 56), rim=(255, 220, 160))
            c.e(dx, dy - 10 * up - 5, 8, 4, (110, 72, 40), sh=0.2, hl=0)


def maple(r, x, y, s, t, mouth_=0.0, blink=0.0, mood=0.8, season=(214, 70, 44)):
    """درخت افرا با صورت."""
    c = C(r, x, y, s, 1)
    c.shadow(130, 16, 0.3)
    sway = math.sin(t * 0.9) * 3
    for dx in (-80, 70):
        c.e(dx, -6, 46, 12, (92, 58, 40), sh=0.3, hl=0)
    c.e(0, -150, 64, 170, (118, 76, 52), rim=(220, 170, 120))
    c.e(-30, -150, 26, 140, (104, 66, 46), sh=0.2, hl=0, alpha=0.5)
    c.cap(-30, -240, -120 + sway, -300, 22, (110, 70, 48), hl=False)
    c.cap(30, -240, 120 + sway, -296, 22, (110, 70, 48), hl=False)
    cols = [season, shade(season, 1.18), (240, 140, 50), shade(season, 0.88), (250, 180, 60)]
    blobs = [(-120, -330, 80), (-50, -380, 92), (40, -392, 94), (120, -340, 82), (0, -310, 90),
             (-170, -290, 60), (170, -290, 62), (-80, -300, 68), (80, -296, 70)]
    for i, (bx, by, br) in enumerate(blobs):
        c.e(bx + sway * (0.5 + i % 3 * 0.2), by + math.sin(t * 0.8 + i) * 2, br, br * 0.88, cols[i % 5], sh=0.5,
            rim=(255, 220, 140))
    # صورت
    for sgn in (-1, 1):
        eye(c, sgn * 26, -176, 17, 20, blink, iris=(60, 90, 50))
    brows(c, 26, -206, 30, mood, col=(70, 44, 30))
    c.e(0, -150, 7, 5, (96, 58, 40), sh=0.3, hl=0)
    c.e(-40, -150, 12, 8, (255, 140, 110), sh=0, alpha=0.4, hl=0)
    c.e(40, -150, 12, 8, (255, 140, 110), sh=0, alpha=0.4, hl=0)
    mouth(c, 0, -126, 17, mouth_, mood)


def monkey(r, x, y, s=1.0, f=1, t=0, mouth_=0.0, blink=0.0, arms=(30, 30), jump=0.0, mood=0.8, banana=False):
    c = C(r, x, y - jump, s, f)
    if jump < 1:
        c.shadow(34, 8, 0.25)
    br = (150, 96, 60)
    fc = (244, 208, 164)
    tail = [(-20, -30 + math.sin(t * 3) * 3), (-56, -22), (-70, -52 + math.sin(t * 3 + 1) * 6), (-52, -78)]
    c.curve(tail, 9, br)
    for sgn in (-1, 1):
        c.cap(sgn * 12, -34, sgn * 18 + sgn * math.sin(t * 5 + sgn) * 8, -6, 13, br)
        c.e(sgn * 18, -4, 14, 8, shade(br, 0.8))
    c.e(0, -56, 27, 34, br, rim=(255, 200, 150))
    c.e(0, -50, 17, 22, fc, sh=0.4)
    for side, ang in ((-1, arms[0]), (1, arms[1])):
        a = math.radians(ang)
        sh = (side * 24, -72)
        hd = (sh[0] + side * math.sin(a) * 34, sh[1] + math.cos(a) * 34)
        c.cap(sh[0], sh[1], hd[0], hd[1], 11, br)
        c.e(hd[0], hd[1], 7.5, 7.5, shade(br, 0.85))
    c.e(0, -106, 30, 27, br, rim=(255, 200, 150))
    for sgn in (-1, 1):
        c.e(sgn * 32, -108, 12, 12, br)
        c.e(sgn * 32, -108, 7, 7, (240, 170, 150), sh=0, hl=0)
    c.e(-10, -110, 13, 14, fc, sh=0.3)
    c.e(10, -110, 13, 14, fc, sh=0.3)
    c.e(0, -97, 17, 14, fc, sh=0.3)
    for sgn in (-1, 1):
        eye(c, sgn * 10, -112, 6.5, 8, blink)
    c.e(0, -104, 3, 2, (110, 70, 50), sh=0, hl=0)
    mouth(c, 0, -94, 8, mouth_, mood)
    if banana:
        c.curve([(30, -72), (40, -84), (50, -82), (58, -72)], 9, (252, 220, 70))


def dragon(r, x, y, s=1.0, f=1, t=0, mouth_=0.0, blink=0.0, mood=0.0, cry=0.0, fire=0.0):
    c = C(r, x, y, s, f)
    c.shadow(52, 10, 0.3)
    gr, bel = (112, 190, 112), (240, 232, 150)
    flap = math.sin(t * 6) * 18
    for sgn in (-1, 1):
        c.e(sgn * 38 - 4, -92, 18, 40, (140, 208, 128), ang=sgn * (40 + flap), rim=(220, 255, 200))
    c.curve([(-30, -22), (-70, -18), (-92, -40), (-88, -62 + math.sin(t * 3) * 6)], 14, gr)
    c.poly([(-92, -62), (-72, -64), (-86, -86)], (240, 110, 90))
    c.e(0, -56, 44, 48, gr, rim=(220, 255, 190))
    c.e(4, -50, 28, 34, bel, sh=0.4)
    for sgn in (-1, 1):
        c.e(sgn * 18, -6, 17, 9, shade(gr, 0.9))
        c.cap(sgn * 38, -62, sgn * 52, -38, 12, gr, hl=False)
    for i, (dx, dy) in enumerate(((-18, -96), (22, -94), (-8, -80))):
        c.e(dx, dy, 6, 5, (90, 160, 90), sh=0.2, hl=0)
    c.e(0, -122, 42, 36, gr, rim=(220, 255, 190))
    for sgn in (-1, 1):
        c.poly([(sgn * 24, -146), (sgn * 34, -176), (sgn * 12, -152)], (250, 220, 120))
    c.e(0, -108, 24, 17, shade(gr, 1.12), sh=0.35)
    for sgn in (-1, 1):
        c.e(sgn * 9, -112, 2.4, 3, (60, 110, 60), sh=0, hl=0)
        eye(c, sgn * 21, -132, 11, 13, blink, iris=(50, 90, 130), white=(250, 252, 255))
        c.e(sgn * 33, -112, 7, 5, (255, 150, 140), sh=0, alpha=0.4, hl=0)
    brows(c, 21, -152, 18, -0.6 if cry > 0.3 else mood, col=(60, 110, 60))
    mouth(c, 0, -102, 11, mouth_, 0.5 if cry < 0.3 else -1.0)
    if cry > 0:
        for sgn in (-1, 1):
            for k in range(3):
                u = (t * 1.3 + k / 3 + (0.2 if sgn > 0 else 0)) % 1
                c.e(sgn * 25 + sgn * 2, -122 + u * 36, 3.2 * (1 - u * 0.3), 5 * (1 - u * 0.3), (150, 210, 255),
                    sh=0.2, alpha=cry * (1 - u))


def amu(r, x, y, s=1.0, f=1, t=0, mouth_=0.0, blink=0.0, arms=(20, 20), mood=1.0, walk=0.0):
    c = C(r, x, y, s, f)
    c.shadow(52, 10, 0.3)
    sw = math.sin(walk)
    c.y = y - abs(sw) * 3 * s
    for sgn in (-1, 1):
        a = math.radians(sw * 22 * sgn)
        c.cap(sgn * 14, -76, sgn * 14 + math.sin(a) * 50, -8, 20, (50, 50, 70))
        c.e(sgn * 14 + math.sin(a) * 50 + 5, -4, 22, 10, (90, 60, 50))
    c.e(0, -118, 48, 72, (205, 44, 54), rim=(255, 140, 120))
    c.e(0, -92, 50, 10, (250, 200, 70), sh=0.2)
    for side, ang in ((-1, arms[0]), (1, arms[1])):
        a = math.radians(ang)
        sh = (side * 40, -160)
        hd = (sh[0] + side * math.sin(a) * 66, sh[1] + math.cos(a) * 66)
        c.cap(sh[0], sh[1], hd[0], hd[1], 22, (205, 44, 54))
        c.e(hd[0], hd[1], 11, 11, (236, 184, 152))
    # خورجین راه‌راه
    c.poly([(-70, -120), (-36, -128), (-30, -64), (-66, -58)], (60, 120, 190), col2=(40, 90, 150))
    for i in range(4):
        yy = -116 + i * 14
        c.cap(-66 + i * 0.5, yy + 4, -34, yy - 4, 4, (250, 210, 90), hl=False)
    c.cap(-60, -150, 28, -170, 6, (130, 80, 50), hl=False)
    # سر
    c.e(0, -190, 36, 34, (238, 186, 154), rim=(255, 215, 180))
    c.e(0, -160, 42, 36, (250, 250, 252), sh=0.5, rim=(255, 255, 255))
    c.e(-15, -176, 17, 9, (250, 250, 252), ang=-12, sh=0.5)
    c.e(15, -176, 17, 9, (250, 250, 252), ang=12, sh=0.5)
    c.e(0, -184, 6, 5, (230, 160, 132), sh=0.3, hl=0)
    for sgn in (-1, 1):
        if blink > 0.5:
            c.curve([(sgn * 16 - 7, -198), (sgn * 16, -193), (sgn * 16 + 7, -198)], 2.5, DARK)
        else:
            c.curve([(sgn * 16 - 8, -194), (sgn * 16, -202), (sgn * 16 + 8, -194)], 3, DARK)
        c.e(sgn * 28, -186, 8, 5, (255, 130, 120), sh=0, alpha=0.5, hl=0)
        c.cap(sgn * 12, -212, sgn * 26, -214 - 2 * mood, 4, (240, 240, 240), hl=False)
    mouth(c, 0, -166, 11, mouth_, mood)
    # کلاه نمدی قرمز
    c.e(0, -222, 38, 22, (210, 40, 52), rim=(255, 150, 130))
    c.poly([(-32, -222), (-20, -280), (20, -280), (32, -222)], (200, 36, 48), col2=(210, 44, 56))
    c.e(0, -282, 20, 8, (225, 62, 70), sh=0.4)
    c.e(0, -224, 40, 7, (255, 240, 220), sh=0.3, hl=0)


def lying_boy_head(r, x, y, s, t, mouth_=0.0, blink=0.0, mood=0.6, f=1, look=(0, 0), closed=False):
    """سر پسر روی بالش (نیم‌رخ جلو)"""
    c = C(r, x, y, s, f)
    c.e(0, 0, 46, 44, SKIN, rim=(255, 215, 170))
    c.e(-46, 6, 8, 10, SKIN, sh=0.3)
    c.e(46, 6, 8, 10, SKIN, sh=0.3)
    c.e(0, -24, 48, 26, (84, 56, 42), sh=0.5)
    c.e(-24, -20, 26, 14, (84, 56, 42), ang=-18, sh=0.5)
    c.e(14, -48, 9, 15, (84, 56, 42), ang=22, sh=0.5)
    for sgn in (-1, 1):
        if closed:
            c.curve([(sgn * 17 - 9, -1), (sgn * 17, 4), (sgn * 17 + 9, -1)], 2.8, DARK)
        else:
            eye(c, sgn * 17, 0, 11, 13, blink, look)
    brows(c, 17, -18, 18, mood if not closed else 0.6)
    c.e(0, 12, 4, 3, shade(SKIN, 0.85), sh=0, hl=0)
    c.e(-29, 18, 8, 5, (255, 140, 130), sh=0, alpha=0.45, hl=0)
    c.e(29, 18, 8, 5, (255, 140, 130), sh=0, alpha=0.45, hl=0)
    mouth(c, 0, 26, 9, mouth_, mood)


# ---------- حروف داستان ----------
_FONT = {}
LETTER_COLS = [(255, 150, 80), (240, 80, 90), (120, 200, 120), (110, 170, 250), (250, 200, 70)]


def letter_sprite(ch, col, size=220):
    from PIL import Image, ImageDraw, ImageFont
    key = (ch, col, size)
    if key in _FONT:
        return _FONT[key]
    f = ImageFont.truetype("/home/user/Sarina-Earth-Animation/assets/fonts/Vazirmatn-ExtraBold.ttf", size)
    pad = 60
    bb = f.getbbox(ch)
    w, h = bb[2] - bb[0] + 2 * pad, bb[3] - bb[1] + 2 * pad
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).text((pad - bb[0], pad - bb[1]), ch, font=f, fill=255)
    m = np.array(m)
    glow = cv2.GaussianBlur(m, (0, 0), 14)
    hi = cv2.GaussianBlur(m, (0, 0), 3)
    img = np.zeros((h, w, 3), np.float32)
    g = np.array(bgr(col), np.float32)
    img += (glow[..., None] / 255.0) * g * 0.8
    body = (m[..., None] / 255.0)
    yy = np.linspace(1.25, 0.8, h)[:, None, None]
    img = img * (1 - body) + body * np.clip(g * yy + 25, 0, 255)
    edge = np.clip(hi.astype(np.float32) - m.astype(np.float32) * 0.0, 0, 255)
    alpha = np.clip(np.maximum(m, glow * 0.8), 0, 255).astype(np.float32) / 255.0
    out = (np.clip(img, 0, 255).astype(np.uint8), alpha)
    _FONT[key] = out
    return out


def blit_sprite(frame, spr, cx, cy, scale=1.0, ang=0.0, alpha=1.0, add=0.0):
    img, al = spr
    h, w = img.shape[:2]
    sc = scale * K * 0.5
    M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, sc)
    M[0, 2] += cx * K - w / 2
    M[1, 2] += cy * K - h / 2
    size = (frame.shape[1], frame.shape[0])
    bw = int(w * sc * 1.5 + 4)
    im2 = cv2.warpAffine(img, M, size, flags=cv2.INTER_LINEAR)
    a2 = cv2.warpAffine(al, M, size, flags=cv2.INTER_LINEAR)[..., None] * alpha
    frame[:] = np.clip(frame * (1 - a2) + im2 * a2 + im2 * add * a2, 0, 255).astype(np.uint8)


def sparkle(r, x, y, size, t, col=(255, 240, 180), a=0.8):
    tw = 0.6 + 0.4 * math.sin(t * 6 + x)
    r.glow(x, y, size * 2.2, col, a * tw)
    for ang in (0, 90):
        dx, dy = math.cos(math.radians(ang)) * size * tw, math.sin(math.radians(ang)) * size * tw
        r.cap(x - dx, y - dy, x + dx, y + dy, 1.6, (255, 255, 240), hl=False)
