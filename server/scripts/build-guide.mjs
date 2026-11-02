// Builds the picture guide: src/guide/app-guide.html (one self-contained file) and, with --pdf, src/guide/app-guide.pdf.
// Run: node scripts/build-guide.mjs [--pdf]   (the pictures are in src/guide/shots; retake them with scripts/guide-shots.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { guideText } from '../src/guide/guide.js';
import { FIGURES } from '../src/guide/figures.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '../src/guide');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
const img = (f) => `data:image/jpeg;base64,${readFileSync(join(dir, 'shots', `${f}.jpg`)).toString('base64')}`;

function figures(n) {
  const list = FIGURES[n];
  if (!list) return '';
  const phones = list.filter((f) => !f.wide);
  const wides = list.filter((f) => f.wide);
  const fig = (f) => `<figure class="${f.wide ? 'wide' : 'phone'}"><img src="${img(f.file)}" alt="${esc(f.caption)}"><figcaption>${esc(f.caption)}</figcaption></figure>`;
  return `<div class="figs">${phones.map(fig).join('')}</div>${wides.map(fig).join('')}`;
}

export function guideHtml() {
  const lines = guideText().split('\n');
  const out = [];
  let list = null;
  let section = 0;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushSection = () => { if (section) out.push(figures(section)); };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('|')) {
      close();
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      i -= 1;
      const cells = (r) => r.slice(1, -1).split('|').map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(`<table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^#{1,3} /.test(l)) {
      close();
      const level = l.match(/^#+/)[0].length;
      const text = l.replace(/^#+ /, '');
      if (level === 2) { flushSection(); section = Number(text.match(/^(\d+)\./)?.[1] ?? 0); }
      out.push(`<h${level}>${inline(text)}</h${level}>`);
    } else if (/^\d+\. /.test(l)) {
      if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(l.replace(/^\d+\. /, ''))}</li>`);
    } else if (/^\s+- /.test(l) && list === 'ol') {
      out.push(`<li class="sub">${inline(l.trim().slice(2))}</li>`);
    } else if (l.startsWith('- ')) {
      if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(l.slice(2))}</li>`);
    } else if (l.trim()) {
      close();
      out.push(`<p>${inline(l)}</p>`);
    } else close();
  }
  close();
  flushSection();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nifty Paper Trader: how to use it</title>
<style>
:root { color-scheme: light; }
body { font: 15px/1.55 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1b2430; max-width: 860px; margin: 0 auto; padding: 20px 16px 48px; }
h1 { font-size: 26px; margin: 8px 0 6px; } h2 { font-size: 20px; margin: 34px 0 8px; padding-top: 6px; border-top: 2px solid #e4e8ee; } h3 { font-size: 16px; margin: 20px 0 6px; }
code { background: #eef1f5; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 14px; } th, td { border: 1px solid #dde3ea; padding: 6px 9px; text-align: left; vertical-align: top; } th { background: #f3f6f9; }
li { margin: 3px 0; } li.sub { list-style: disc; margin-left: 22px; }
.demo { background: #fff6e0; border: 1px solid #f0d9a0; border-radius: 10px; padding: 10px 12px; font-size: 13px; margin: 12px 0 4px; }
.figs { display: flex; flex-wrap: wrap; gap: 14px; margin: 14px 0; align-items: flex-start; }
figure { margin: 0; break-inside: avoid; } figure.phone { flex: 1 1 200px; max-width: 250px; } figure.wide { margin: 16px 0; }
figure img { width: 100%; height: auto; display: block; border-radius: 12px; border: 1px solid #cfd6df; box-shadow: 0 2px 8px #0002; }
figcaption { font-size: 12.5px; color: #4b5767; margin-top: 6px; }
@media print { body { font-size: 12.5px; padding: 0; } h2 { break-after: avoid; } figure.phone { max-width: 190px; } }
</style></head><body>
<div class="demo"><strong>About the pictures.</strong> Every screenshot is from the real app, taken on made-up demo data (a simulated Nifty tape and sample trades), so the numbers are only examples and are not your results.</div>
${out.join('\n')}
</body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = guideHtml();
  writeFileSync(join(dir, 'app-guide.html'), html);
  console.log('app-guide.html', Math.round(html.length / 1024), 'KB');
  if (process.argv.includes('--pdf')) {
    const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
    const b = await chromium.launch();
    const p = await b.newPage();
    await p.setContent(html, { waitUntil: 'load' });
    await p.pdf({ path: join(dir, 'app-guide.pdf'), format: 'A4', margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' }, printBackground: true });
    await b.close();
    console.log('app-guide.pdf written');
  }
}
