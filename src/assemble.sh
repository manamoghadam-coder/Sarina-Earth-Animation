#!/usr/bin/env bash
# اتصال قطعه‌های ویدئو + میکس صدا + سوزاندن زیرنویس فارسی (SRT) با FFmpeg → MP4 نهایی
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=output/Sarina_Earth_Interior_Journey.mp4
ls build/segments/seg_*.mp4 | grep -v part | sed "s|^|file '$PWD/|; s|$|'|" > build/concat.txt
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i build/concat.txt -c copy build/video_noaudio.mp4

STYLE="FontName=Vazirmatn,Bold=1,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H96000000,BorderStyle=1,Outline=2.4,Shadow=1.2,Alignment=2,MarginV=30,MarginL=22,MarginR=22"
ffmpeg -hide_banner -loglevel error -y -i build/video_noaudio.mp4 -i build/mix.wav \
  -vf "subtitles=output/subtitles_fa.srt:fontsdir=assets/fonts:force_style='${STYLE}'" \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100" \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -movflags +faststart -t 60 "$OUT"
# فایل صوتی گویندگی (تنها صدای گوینده)
ffmpeg -hide_banner -loglevel error -y -i build/narration.wav -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ar 44100 -ac 1 output/narration_fa.wav
ffmpeg -hide_banner -loglevel error -y -i build/mix.wav -af "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100" -c:a libmp3lame -b:a 192k output/soundtrack_full_mix.mp3
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of default=nw=1 "$OUT"
