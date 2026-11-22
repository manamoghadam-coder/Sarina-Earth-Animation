const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const b = await chromium.launch(); const svg = fs.readFileSync(process.argv[2], 'utf8');
  for (const [name, size, pad] of [['logo-1024', 1024, 0], ['icon-512', 512, 0], ['icon-192', 192, 0], ['icon-maskable-512', 512, 0.12]]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    const inner = pad ? `<div style="width:100%;height:100%;background:#4a2a9e;display:grid;place-items:center"><div style="width:${100 - pad * 200}%;height:${100 - pad * 200}%">${svg}</div></div>` : svg;
    await p.setContent(`<style>body{margin:0}svg{width:100%;height:100%;display:block}</style>${inner}`); await p.screenshot({ path: `${process.argv[3]}/${name}.png`, omitBackground: true }); await p.close(); }
  await b.close(); })();
