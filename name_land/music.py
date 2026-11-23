import numpy as np, subprocess, wave, sys
SR=44100
DUR=583.8
src=sys.argv[1]
voice=np.frombuffer(subprocess.run(['ffmpeg','-loglevel','error','-i',src,'-f','f32le','-ar',str(SR),'-ac','1','-'],capture_output=True).stdout,dtype=np.float32)
n=int(DUR*SR)
voice=np.pad(voice,(0,max(0,n-len(voice))))[:n]
rng=np.random.default_rng(1)
def bell(f,dur=1.6,vel=1.0):
    t=np.arange(int(SR*dur))/SR
    y=(np.sin(2*np.pi*f*t)+0.35*np.sin(2*np.pi*f*2.76*t)*np.exp(-t*6)+0.15*np.sin(2*np.pi*f*5.4*t)*np.exp(-t*10))*np.exp(-t*2.6)
    y[:200]*=np.linspace(0,1,200)
    return y*vel
mus=np.zeros(n,np.float32)
pent=[261.63,293.66,329.63,392.0,440.0,523.25]
bpm=72; beat=60/bpm
melodies=[[0,2,4,2,3,2,1,0],[0,2,4,5,4,2,3,1],[2,4,5,4,3,2,1,0],[0,1,2,3,2,1,0,0]]
t=0.0; bar=0
while t<DUR-2:
    mel=melodies[(bar//2)%4]
    for i,nt in enumerate(mel):
        tt=t+i*beat*0.5
        s=int(tt*SR); y=bell(pent[nt],1.4,0.7)
        if s+len(y)<n: mus[s:s+len(y)]+=y
    # bass/pad
    root=[130.81,98.0,110.0,87.31][(bar//1)%4]
    s=int(t*SR); d=int(SR*beat*4.2); tt=np.arange(d)/SR
    pad=(np.sin(2*np.pi*root*tt)+0.5*np.sin(2*np.pi*root*1.5*tt))*np.minimum(1,tt*1.5)*np.minimum(1,(d/SR-tt)*1.5)*0.35
    mus[s:s+d]+=pad[:max(0,min(d,n-s))]
    t+=beat*4; bar+=1
# زنگوله‌ی هدیه
for Tg in (160.0,240.0,326.0,403.5,452.0,556.5):
    for k,f in enumerate((783.99,1046.5,1318.5,1568.0)):
        s=int((Tg+k*0.12)*SR); y=bell(f,1.8,0.9)
        mus[s:s+len(y)]+=y
# شدت: آرام‌تر در بخش خواب
env=np.ones(n,np.float32)
tt=np.arange(n)/SR
env*=np.clip(tt/3,0,1)*np.clip((DUR-tt)/5,0,1)
mus*=env
mus/=np.abs(mus).max()
# duck زیر صدا
v_env=np.convolve(np.abs(voice),np.ones(SR//5)/(SR//5),'same')
duck=1-0.55*np.clip(v_env/0.08,0,1)
mus*=duck*0.16
mix=voice+mus
mix=np.clip(mix,-0.98,0.98)
w=wave.open('mix.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((mix*32767).astype(np.int16).tobytes()); w.close()
print('ok',np.abs(voice).max(),np.abs(mus).max())
