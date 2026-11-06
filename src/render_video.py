# -*- coding: utf-8 -*-
"""رندر چندپردازشی فریم‌ها و کدگذاری قطعه‌ها با FFmpeg (x264). سپس اتصال قطعه‌ها در make_all.sh"""
import os, subprocess, sys, time
from multiprocessing import Pool
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "src"))
FPS = 30; TOTAL = 60 * FPS; CHUNK = 75
SEG = ROOT / "build" / "segments"

def render_chunk(k):
    from src.anim.compose import frame_at
    from src.anim.util import W, H
    a, b = k * CHUNK, min((k + 1) * CHUNK, TOTAL)
    out = SEG / f"seg_{k:03d}.mp4"
    if out.exists(): return k, 0.0
    tmp = SEG / f"seg_{k:03d}.part.mp4"
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", "-g", str(FPS), str(tmp)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    t0 = time.time()
    for i in range(a, b):
        f = frame_at(i / FPS)
        p.stdin.write(f.astype("uint8").tobytes())
    p.stdin.close(); p.wait()
    os.replace(tmp, out)
    return k, time.time() - t0

if __name__ == "__main__":
    SEG.mkdir(parents=True, exist_ok=True)
    n = (TOTAL + CHUNK - 1) // CHUNK
    ks = list(range(n))
    if len(sys.argv) > 1: ks = [int(x) for x in sys.argv[1:]]
    t0 = time.time()
    with Pool(4) as pool:
        for k, dt in pool.imap_unordered(render_chunk, ks):
            print(f"segment {k:02d}/{n} done in {dt:5.1f}s  (elapsed {time.time()-t0:6.1f}s)", flush=True)
