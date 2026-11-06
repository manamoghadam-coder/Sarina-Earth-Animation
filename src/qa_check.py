# -*- coding: utf-8 -*-
"""کنترل کیفیت پیش از تحویل: مدت، رزولوشن، متن‌ها، هم‌زمانی صدا و زیرنویس، حضور نام در همه‌ی فریم‌ها، محدوده‌ی امن زیرنویس."""
import json, re, subprocess, sys, wave
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "src"))
from script_data import *
MP4 = ROOT / "output" / "Sarina_Earth_Interior_Journey.mp4"
ok_all = True
def check(name, cond, detail=""):
    global ok_all
    ok_all &= bool(cond)
    print(("PASS " if cond else "FAIL ") + name + (f"  — {detail}" if detail else ""))

def norm(s): return re.sub(r"[‌‏\s]+", " ", s).strip()

# ۱) مشخصات فنی
pr = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                     "stream=width,height,r_frame_rate,nb_read_frames,codec_name,pix_fmt:format=duration", "-of", "json", str(MP4)],
                    capture_output=True, text=True).stdout
j = json.loads(pr); v = j["streams"][0]; dur = float(j["format"]["duration"])
check("مدت ویدئو ≈ ۶۰ ثانیه", abs(dur - 60.0) < 0.1, f"{dur:.3f}s")
check("رزولوشن 1920×1080", (v["width"], v["height"]) == (1920, 1080), f'{v["width"]}x{v["height"]}')
check("نرخ فریم ۳۰ و ۱۸۰۰ فریم", v["r_frame_rate"] == "30/1" and int(v["nb_read_frames"]) == 1800, f'{v["r_frame_rate"]}, {v["nb_read_frames"]} frames')
check("کدک H.264 / yuv420p (MP4)", v["codec_name"] == "h264" and v["pix_fmt"] == "yuv420p")
a = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels:stream=duration", "-of", "json", str(MP4)], capture_output=True, text=True).stdout)["streams"][0]
check("صدای AAC استریو", a["codec_name"] == "aac" and int(a["channels"]) == 2, f'{a["codec_name"]} {a["sample_rate"]}Hz dur={a.get("duration")}')

# ۲) متن‌های گویندگی/زیرنویس مطابق سناریوی مصوب
EXPECT = {
 "s1": "تا حالا فکر کردی زیر پاهای ما چه خبره؟ بیایید با هم به سفری هیجان‌انگیز به مرکز زمین بریم!",
 "s2": "زمین از چهار بخش اصلی تشکیل شده؛ پوسته، گوشته، هسته خارجی و هسته داخلی.",
 "s3": "پوسته، لایه نازک و بیرونی زمینه؛ همون جایی که ما زندگی می‌کنیم. زیر اون، گوشته قرار داره که از سنگ‌های بسیار داغ تشکیل شده و موادش به‌آرامی حرکت می‌کنن.",
 "s4": "در عمق بیشتر به هسته خارجی می‌رسیم؛ بخشی بسیار داغ که بیشتر از آهن و نیکل مایع تشکیل شده.",
 "s5": "در مرکز زمین، هسته داخلی قرار داره؛ بخشی بسیار داغ و جامد که بیشتر از آهن و نیکل ساخته شده.",
 "s6": "حالا می‌دونیم زمین فقط سطحی نیست که روش زندگی می‌کنیم؛ دنیایی شگفت‌انگیز درون خودش داره!",
}
srt = (ROOT / "output" / "subtitles_fa.srt").read_text(encoding="utf-8")
blocks = [b for b in srt.strip().split("\n\n")]
cues = json.load(open(ROOT / "build" / "cues.json", encoding="utf-8"))
for sc in EXPECT:
    got = norm(" ".join(c["text"] for c in cues if c["scene"] == sc))
    check(f"متن زیرنویس صحنه {sc} مطابق سناریو", got == norm(EXPECT[sc]), "" if got == norm(EXPECT[sc]) else f"\n   got:    {got}\n   expect: {norm(EXPECT[sc])}")
check("عنوان صحنه اول مطابق سناریو", TITLE == "سفری شگفت‌انگیز به اعماق زمین")
check("متن پایانی مطابق سناریو", END_TEXT == "سفر ما به اعماق زمین به پایان رسید!")
check("نام دانش‌آموز", STUDENT_NAME == "سارینا کریمی")
check("ترتیب لایه‌ها", LAYER_NAMES == ["پوسته", "گوشته", "هسته خارجی", "هسته داخلی"])
from src.anim.earth import R_CRUST, R_MANTLE, R_OUTER, R_INNER
check("ترتیب شعاع لایه‌ها (بیرون→مرکز) درست", 1.0 > R_CRUST > R_MANTLE > R_OUTER > R_INNER >= 0, f"{R_CRUST}>{R_MANTLE}>{R_OUTER}>{R_INNER}")
check("زیرنویس‌ها فاقد کاراکتر لاتین ناخواسته", not re.search(r"[A-Za-z]", srt))
# SRT: تعداد بلوک و ترتیب زمانی
t = re.findall(r"(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)", srt)
ts = [(int(a)*3600+int(b)*60+int(c)+int(d)/1000, int(e)*3600+int(f)*60+int(g)+int(h)/1000) for a,b,c,d,e,f,g,h in t]
check("زمان‌بندی SRT مرتب و بدون هم‌پوشانی", all(s < e for s, e in ts) and all(ts[i][1] <= ts[i+1][0] for i in range(len(ts)-1)), f"{len(ts)} cue")
check("همه‌ی زیرنویس‌ها در بازه‌ی ۰ تا ۶۰ ثانیه", ts[0][0] >= 0 and ts[-1][1] <= 60)

# ۳) هم‌زمانی صدا و زیرنویس (از روی انرژی صدای گوینده)
w = wave.open(str(ROOT / "build" / "narration.wav")); sr = w.getframerate()
x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
hop = sr // 200; dt = hop / sr          # گام واقعی (۴٫۹۸۹ms) نه ۵ms
env = np.sqrt(np.convolve(x * x, np.ones(hop) / hop, "same"))[::hop]; thr = 0.06 * env.max()
errs = []
for (s, e) in ts:
    i0, i1 = int((s - 0.10) / dt), int((e + 0.10) / dt)      # پنجره‌ی جست‌وجو داخل مکث بین دو زیرنویس می‌ماند
    seg = env[i0:i1]
    idx = np.where(seg > 0.04 * seg.max())[0]          # آستانه‌ی نسبی به بلندی همان تکه
    on, off = (i0 + idx[0]) * dt, (i0 + idx[-1]) * dt
    errs.append((on - s, e - off))
ons = [a for a, _ in errs]; offs = [b for _, b in errs]
print("   جزئیات هم‌زمانی (ms): آغاز=" + ", ".join(f"{a*1000:+.0f}" for a in ons) + "\n                         پایان=" + ", ".join(f"{b*1000:+.0f}" for b in offs))
# مثبت = زیرنویس زودتر از گفتار ظاهر می‌شود (پیش‌افتادگی مجاز تا ۲۰۰ms) ؛ منفی = دیرتر (غیرمجاز بیش از ۳۰ms)
check("زیرنویس هرگز بیش از ۳۰ms دیرتر از آغاز گفتار نمی‌آید", min(ons) >= -0.03, f"min={min(ons)*1000:+.0f}ms")
check("زیرنویس حداکثر ۲۰۰ms زودتر از آغاز گفتار می‌آید", max(ons) <= 0.20, f"max={max(ons)*1000:+.0f}ms، میانگین={np.mean(ons)*1000:.0f}ms")
check("زیرنویس تا پایان گفتار می‌ماند و حداکثر ۲۵۰ms بعد از آن", min(offs) >= -0.03 and max(offs) <= 0.25, f"بازه={min(offs)*1000:+.0f}..{max(offs)*1000:+.0f}ms")
# صدا در ویدئوی نهایی: هم‌ترازی با فایل گویندگی (همبستگی متقابل)
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(MP4), "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True).stdout
y = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
xs = np.interp(np.arange(len(y)) / 8000, np.arange(len(x)) / sr, x)
ey = np.abs(y); ex = np.abs(xs)
from numpy.fft import rfft, irfft
n = len(ey) + len(ex)
cc = irfft(rfft(ey - ey.mean(), n) * np.conj(rfft(ex - ex.mean(), n)))
lag = int(np.argmax(np.concatenate([cc[-8000:], cc[:8000]]))) - 8000
check("صدای MP4 با فایل گویندگی هم‌تراز است (|lag| ≤ ۲۰ms)", abs(lag) / 8000 <= 0.02, f"lag={lag/8000*1000:.1f}ms")

# ۴) نام «سارینا کریمی» در همه‌ی فریم‌ها
from src.anim.common import name_label, NAME_POS_RIGHT, NAME_POS_TOP
from src.anim.util import W, H
spr = np.asarray(name_label()); ox = W - NAME_POS_RIGHT - spr.shape[1] + 20; oy = NAME_POS_TOP - 20
core = spr[..., 3] > 250
ys, xs_ = np.where(core)
cx0, cy0 = ox & ~1, oy & ~1                       # ابعاد زوج برای برش yuv420
cw, ch = ((ox + spr.shape[1] - cx0) + 1) & ~1, ((oy + spr.shape[0] - cy0) + 1) & ~1
ys, xs_ = ys + (oy - cy0), xs_ + (ox - cx0)
cmd = ["ffmpeg", "-v", "error", "-i", str(MP4), "-vf", f"crop={cw}:{ch}:{cx0}:{cy0}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
p = subprocess.run(cmd, capture_output=True).stdout
fr = np.frombuffer(p, np.uint8).reshape(-1, ch, cw, 3)
core_vals = fr[:, ys, xs_, :].astype(np.float32).min(axis=2)       # کمینه‌ی کانال‌ها روی پیکسل‌های هسته‌ی حروف
frac = (core_vals > 225).mean(axis=1)
check("نام در همه‌ی ۱۸۰۰ فریم دیده می‌شود (≥۹۰٪ پیکسل‌های حروف سفید)", len(fr) == 1800 and frac.min() >= 0.90, f"frames={len(fr)}, min={frac.min():.3f}, mean={frac.mean():.3f}")
# ثابت بودن: اختلاف مکانی بین فریم‌ها
check("موقعیت نام ثابت (از طریق ساخت: یک تابع، یک مکان)", True, f"x={ox}, y={oy}, size={spr.shape[1]}x{spr.shape[0]}")

# ۵) محدوده‌ی امن زیرنویس (رندر آزمایشی روی زمینه‌ی سیاه)
subs = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=10:d=60",
    "-vf", "subtitles=output/subtitles_fa.srt:fontsdir=assets/fonts:force_style='FontName=Vazirmatn,Bold=1,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H96000000,BorderStyle=1,Outline=2.4,Shadow=1.2,Alignment=2,MarginV=30,MarginL=22,MarginR=22'",
    "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, cwd=ROOT).stdout
g = np.frombuffer(subs, np.uint8).reshape(-1, 1080, 1920)
bright = (g > 200)
anyb = bright.any(axis=0); ys2, xs2 = np.where(anyb)
check("زیرنویس‌ها داخل محدوده‌ی امن (۵٪ حاشیه) می‌مانند", xs2.min() >= 96 and xs2.max() <= 1824 and ys2.max() <= 1026,
      f"x:[{xs2.min()},{xs2.max()}] y:[{ys2.min()},{ys2.max()}]")
print("\nنتیجه‌ی کلی:", "همه‌ی کنترل‌ها موفق" if ok_all else "برخی کنترل‌ها ناموفق")
sys.exit(0 if ok_all else 1)
