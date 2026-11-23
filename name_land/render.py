"""رندر: python3 render.py frame T out.png   |   python3 render.py chunk i n  (خروجی mp4 بخش)"""
import sys, os, subprocess, numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
import scenes as S
FPS = 24
DUR = float(os.environ.get("DUR", "583.8"))
HERE = os.path.dirname(os.path.abspath(__file__))
ENV = np.load(os.path.join(HERE, "env.npy"))
ctx = S.Ctx(ENV)
LIST = [S.S1, S.S2, S.S3, S.S4, S.S5, S.S6]
for nm in ("S7", "S8", "S9", "S10"):
    if hasattr(S, nm):
        LIST.append(getattr(S, nm))
SC = [c(ctx) for c in LIST]
VIG = None


def grade(frame, sc):
    global VIG
    if VIG is None or VIG.shape[:2] != frame.shape[:2]:
        VIG = vignette(frame.shape[0], frame.shape[1], 0.38)
    m, a = sc.grade
    f = frame.astype(np.float32) * VIG
    f = f * np.array([m[2], m[1], m[0]], np.float32) + np.array([a[2], a[1], a[0]], np.float32)
    return np.clip(f, 0, 255).astype(np.uint8)


def frame_at(T):
    idx = 0
    for i, s in enumerate(SC):
        if T >= s.t0:
            idx = i
    s = SC[idx]
    img = grade(s.render(T), s)
    X = 0.45
    if idx + 1 < len(SC) and T > s.t1 - X:
        n = SC[idx + 1]
        k = ease((T - (s.t1 - X)) / X)
        img = (img * (1 - k) + grade(n.render(T), n) * k).astype(np.uint8)
    elif idx > 0 and T < s.t0 + 0.0:
        pass
    if T > DUR - 4:
        k = ease((T - (DUR - 4)) / 4)
        img = (img * (1 - k)).astype(np.uint8)
    if T < 0.8:
        img = (img * ease(T / 0.8)).astype(np.uint8)
    return img


if __name__ == "__main__":
    if sys.argv[1] == "frame":
        for t in sys.argv[2].split(","):
            cv2.imwrite(sys.argv[3].replace(".png", f"_{t}.png"), cv2.resize(frame_at(float(t)), (1280, 720), interpolation=cv2.INTER_AREA))
    else:
        i, n = int(sys.argv[2]), int(sys.argv[3])
        total = int(DUR * FPS)
        per = (total + n - 1) // n
        a, b = i * per, min(total, (i + 1) * per)
        out = os.path.join(HERE, "parts", f"part_{i:02d}.mp4")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        w, h = int(W * K), int(H * K)
        p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
                              "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                              "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
        for k in range(a, b):
            p.stdin.write(frame_at(k / FPS).tobytes())
            if k % 200 == 0:
                print(i, k, b, flush=True)
        p.stdin.close(); p.wait()
