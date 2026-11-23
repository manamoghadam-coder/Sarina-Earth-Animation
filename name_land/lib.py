"""کتابخانهٔ رسم: بیضی‌های سایه‌دار (حس سه‌بعدی)، لایه‌های پارالاکس، ذرات."""
import cv2, numpy as np, math, os
K = float(os.environ.get("K", "1.5"))      # 1280*1.5 = 1920
W, H = 1280, 720
PAD_X, PAD_Y = 256, 72                      # لایه‌ها از این‌قدر بزرگ‌تر از قاب‌اند
LW, LH = W + 2 * PAD_X, H + 2 * PAD_Y


def bgr(c):
    return (c[2], c[1], c[0])


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def shade(c, f):
    return tuple(max(0, min(255, v * f)) for v in c)


class R:
    """بوم رسم؛ مختصات جهان 1280x720 → پیکسل با k و مبدأ (ox,oy)."""

    def __init__(self, img, k, ox, oy, al=None):
        self.img, self.k, self.ox, self.oy, self.al = img, k, ox, oy, al
        self.h, self.w = img.shape[:2]

    def _blend(self, x0, y0, x1, y1, a, colr):
        patch = self.img[y0:y1, x0:x1]
        patch[:] = (patch * (1 - a) + colr * a).astype(np.uint8)
        if self.al is not None:
            ap = self.al[y0:y1, x0:x1]
            ap[:] = (ap * (1 - a[..., 0]) + 255 * a[..., 0]).astype(np.uint8)

    def P(self, x, y):
        return (x - self.ox) * self.k, (y - self.oy) * self.k

    def ell(self, x, y, rx, ry, col, ang=0, sh=0.55, alpha=1.0, hl=0.25, rim=None):
        cx, cy = self.P(x, y)
        rx *= self.k; ry *= self.k
        if rx < 0.6 or ry < 0.6:
            return
        r = max(rx, ry) + 3
        x0, y0 = int(max(0, cx - r)), int(max(0, cy - r))
        x1, y1 = int(min(self.w, cx + r + 1)), int(min(self.h, cy + r + 1))
        if x1 <= x0 or y1 <= y0:
            return
        h, w = y1 - y0, x1 - x0
        m = np.zeros((h, w), np.uint8)
        S = 3
        cv2.ellipse(m, (int(round((cx - x0) * (1 << S))), int(round((cy - y0) * (1 << S)))),
                    (int(round(rx * (1 << S))), int(round(ry * (1 << S)))), ang, 0, 360, 255, -1,
                    cv2.LINE_AA, S)
        a = (m.astype(np.float32) * (alpha / 255.0))[..., None]
        base = np.array(bgr(col), np.float32)
        if sh > 0:
            yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
            ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
            dx, dy = xx - cx, yy - cy
            u = (dx * ca + dy * sa) / rx
            v = (-dx * sa + dy * ca) / ry
            z = np.sqrt(np.clip(1 - u * u - v * v, 0, 1))
            # نور از بالا-چپ
            lx, ly = -0.45, -0.62
            ux = u * ca - v * sa
            vy = u * sa + v * ca
            d = 0.55 * z + 0.55 * (-(ux * lx + vy * ly))
            f = (0.9 + sh * 0.75 * (d - 0.4)).clip(0.6, 1.3)
            colr = base[None, None, :] * f[..., None]
            if hl > 0:
                sp = np.clip(d - 0.8, 0, 1) * 2.0 * hl
                colr = colr + (255 * sp[..., None])
            if rim is not None:
                rm = np.clip((ux * 0.7 + vy * 0.6) - 0.55, 0, 1) * 1.6
                colr = colr + np.array(bgr(rim), np.float32)[None, None, :] * rm[..., None]
            colr = np.clip(colr, 0, 255)
        else:
            colr = base[None, None, :]
        self._blend(x0, y0, x1, y1, a, colr)

    def poly(self, pts, col, alpha=1.0, col2=None):
        p = np.array([self.P(x, y) for x, y in pts], np.float64)
        x0, y0 = int(max(0, p[:, 0].min() - 2)), int(max(0, p[:, 1].min() - 2))
        x1, y1 = int(min(self.w, p[:, 0].max() + 3)), int(min(self.h, p[:, 1].max() + 3))
        if x1 <= x0 or y1 <= y0:
            return
        m = np.zeros((y1 - y0, x1 - x0), np.uint8)
        S = 3
        q = np.round((p - [x0, y0]) * (1 << S)).astype(np.int32)
        cv2.fillPoly(m, [q], 255, cv2.LINE_AA, S)
        a = (m.astype(np.float32) * (alpha / 255.0))[..., None]
        if col2 is None:
            colr = np.array(bgr(col), np.float32)[None, None, :]
        else:
            g = np.linspace(0, 1, y1 - y0, dtype=np.float32)[:, None, None]
            colr = np.array(bgr(col), np.float32) * (1 - g) + np.array(bgr(col2), np.float32) * g
        self._blend(x0, y0, x1, y1, a, colr)

    def cap(self, x0, y0, x1, y1, w, col, hl=True):
        a, b = self.P(x0, y0), self.P(x1, y1)
        tw = max(1, int(round(w * self.k)))
        S = 2
        pa = (int(a[0] * 4), int(a[1] * 4)); pb = (int(b[0] * 4), int(b[1] * 4))
        tmp_img = self.img
        cv2.line(tmp_img, pa, pb, bgr(col), tw, cv2.LINE_AA, S)
        for p in (pa, pb):
            cv2.circle(tmp_img, (p[0], p[1]), int(tw * 2), bgr(col), -1, cv2.LINE_AA, S)
        if self.al is not None:
            cv2.line(self.al, pa, pb, 255, tw, cv2.LINE_AA, S)
            for p in (pa, pb):
                cv2.circle(self.al, p, int(tw * 2), 255, -1, cv2.LINE_AA, S)
        if hl and tw > 5:
            dx, dy = (b[0] - a[0]), (b[1] - a[1])
            L = math.hypot(dx, dy) + 1e-6
            nx, ny = -dy / L * tw * 0.22, dx / L * tw * 0.22
            cv2.line(tmp_img, (int((a[0] + nx) * 4), int((a[1] + ny) * 4)),
                     (int((b[0] + nx) * 4), int((b[1] + ny) * 4)), bgr(shade(col, 1.18)), max(1, tw // 4), cv2.LINE_AA, S)

    def curve(self, pts, w, col, alpha=1.0):
        p = np.array([self.P(x, y) for x, y in pts], np.float64)
        q = np.round(p * 4).astype(np.int32)
        tw = max(1, int(round(w * self.k)))
        cv2.polylines(self.img, [q], False, bgr(col), tw, cv2.LINE_AA, 2)
        if self.al is not None:
            cv2.polylines(self.al, [q], False, 255, tw, cv2.LINE_AA, 2)

    def glow(self, x, y, r, col, a=0.5):
        """نقطهٔ نورانی جمع‌شونده."""
        cx, cy = self.P(x, y); r *= self.k
        x0, y0 = int(max(0, cx - r)), int(max(0, cy - r))
        x1, y1 = int(min(self.w, cx + r + 1)), int(min(self.h, cy + r + 1))
        if x1 <= x0 or y1 <= y0:
            return
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
        g = np.clip(1 - d, 0, 1) ** 2 * a
        patch = self.img[y0:y1, x0:x1].astype(np.float32)
        patch += g[..., None] * np.array(bgr(col), np.float32)
        self.img[y0:y1, x0:x1] = np.clip(patch, 0, 255).astype(np.uint8)


def layer_from(draw_fn, blur=0):
    h, w = int(LH * K), int(LW * K)
    rgb = np.zeros((h, w, 3), np.uint8)
    al = np.zeros((h, w), np.uint8)
    draw_fn(R(rgb, K, -PAD_X, -PAD_Y, al))
    if blur:
        rgb = cv2.GaussianBlur(rgb, (0, 0), blur * K)
        al = cv2.GaussianBlur(al, (0, 0), blur * K)
    return rgb, al


class Layer:
    def __init__(self, rgb, alpha, f):
        self.rgb, self.alpha, self.f = rgb, alpha, f
        self.a3 = None


def comp_layer(frame, L, cam):
    """cam=(cx,cy,z). لایه را با ضریب پارالاکس روی frame ترکیب می‌کند."""
    cx, cy, z = cam
    f = L.f
    cxf = W / 2 + (cx - W / 2) * f
    zf = 1 + (z - 1) * f
    tx = K * zf * (-PAD_X - cxf + W / 2 / zf)
    ty = K * zf * (-PAD_Y - (cy if f == 1 else H / 2 + (cy - H / 2) * f) + H / 2 / zf)
    M = np.float32([[zf, 0, tx], [0, zf, ty]])
    size = (frame.shape[1], frame.shape[0])
    rgb = cv2.warpAffine(L.rgb, M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    al = cv2.warpAffine(L.alpha, M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    a = (al.astype(np.float32) / 255.0)[..., None]
    frame[:] = np.clip(frame * (1 - a) + rgb, 0, 255).astype(np.uint8)


def vgrad(h, w, c0, c1):
    g = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    return np.clip(np.array(bgr(c0), np.float32) * (1 - g) + np.array(bgr(c1), np.float32) * g, 0, 255) \
        .astype(np.uint8).repeat(w, 1)


def vignette(h, w, strength=0.35):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    return (1 - strength * np.clip(d - 0.55, 0, 1) ** 1.5)[..., None].astype(np.float32)


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def smooth_path(keys, t):
    """keys=[(t,value)...] درون‌یابی نرم؛ value عدد یا تاپل."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            u = ease((t - t0) / (t1 - t0 + 1e-9))
            if isinstance(v0, (tuple, list)):
                return tuple(lerp(a, b, u) for a, b in zip(v0, v1))
            return lerp(v0, v1, u)
    return keys[-1][1]
