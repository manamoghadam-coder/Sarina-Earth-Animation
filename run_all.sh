#!/usr/bin/env bash
# بازتولید کامل پروژه: صدا → موسیقی → رندر فریم‌ها → مونتاژ → کنترل کیفیت
set -euo pipefail
cd "$(dirname "$0")"
pip install -q -r requirements.txt
MODEL=assets/voice_models/vits-piper-fa_IR-amir-medium
if [ ! -f "$MODEL/fa_IR-amir-medium.onnx" ]; then
  mkdir -p assets/voice_models
  curl -L -o /tmp/amir.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-fa_IR-amir-medium.tar.bz2
  tar xjf /tmp/amir.tar.bz2 -C assets/voice_models
fi
python3 src/make_voice.py 1.0        # گویندگی فارسی + SRT
python3 src/make_audio.py            # موسیقی + جلوه‌ها + میکس
python3 src/render_video.py          # ۱۸۰۰ فریم (چندپردازشی)
bash src/assemble.sh                 # MP4 نهایی + زیرنویس
python3 src/qa_check.py              # کنترل کیفیت
