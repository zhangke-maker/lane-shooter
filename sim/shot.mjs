// Playwright 截图工具：起静态服务 → 开 web 原型 → 跑 N 秒 → 截图。
// 用法：node sim/shot.mjs [输出文件名] [跑多少秒] [是否看AI(1/0)]
//   node sim/shot.mjs base.png 3 1
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || 'shot.png';
const seconds = parseFloat(process.argv[3] || '3');
const watchAI = process.argv[4] === '1';

const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ico':'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (req.url === '/' || req.url === '/web/') p = path.join(root, 'web/index.html');
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
});

await new Promise(r => server.listen(8088, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 1400 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));

await page.goto('http://localhost:8088/web/', { waitUntil: 'networkidle' });
if (watchAI) await page.click('#watch');   // 切到看AI玩，能看到怪/子弹/战斗
await page.waitForTimeout(seconds * 1000);

const canvas = await page.$('#cv');
await canvas.screenshot({ path: path.join(root, 'web', out) });

console.log('截图保存: web/' + out);
if (errors.length) { console.log('⚠️ 页面错误:'); errors.slice(0, 10).forEach(e => console.log('  ', e)); }
else console.log('✅ 无页面错误');

await browser.close();
server.close();
