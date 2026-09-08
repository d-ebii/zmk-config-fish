const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const permitted = new Set([
  '/docs/onishi-raijin/index.html',
  '/docs/onishi-raijin/design.md',
  '/config/boards/shields/fish/fish.keymap',
  '/config/boards/shields/fish/fish-layouts.dtsi',
]);
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') { response.writeHead(302, { Location: '/docs/onishi-raijin/index.html' }); response.end(); return; }
  if (!permitted.has(pathname)) { response.writeHead(404); response.end('Not found'); return; }
  const file = path.join(root, pathname);
  response.writeHead(200, { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(response);
});
server.listen(0, '127.0.0.1', () => console.log(`設計プレビュー: http://127.0.0.1:${server.address().port}/docs/onishi-raijin/index.html`));
