import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, writeViewer } from './generate.mjs';

// Poll file contents so replacement/rename saves work on Windows and Linux alike.
function inputFingerprint(root) {
  const hash = createHash('sha256');
  const walk = (directory, accept) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(relative, accept);
      else if (entry.isFile() && accept(entry.name)) hash.update(relative).update('\0').update(readFileSync(join(root, relative))).update('\0');
    }
  };
  walk('config', () => true);
  walk('tools/keymap-viewer', name => /\.(?:html|css|js)$/.test(name));
  return hash.digest('hex');
}

export async function startViewer({ root = repoRoot, port = 4173, pollInterval = 500, logger = console.log } = {}) {
  root = resolve(root);
  let html = null;
  let revision = null;
  let error = null;
  let fingerprint = null;
  let stopped = false;

  const rebuild = () => {
    if (stopped) return;
    try {
      const nextFingerprint = inputFingerprint(root);
      if (nextFingerprint === fingerprint) return;
      fingerprint = nextFingerprint;
      const result = writeViewer(root);
      html = result.html;
      revision = result.revision;
      error = null;
      logger(`HTML を更新しました: ${revision}`);
    } catch (cause) {
      fingerprint = null;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message !== error) logger(`更新に失敗しました（前回の表示を保持）: ${message}`);
      error = message;
    }
  };
  rebuild();

  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    let pathname;
    try { pathname = new URL(request.url, 'http://127.0.0.1').pathname; }
    catch { response.writeHead(400); response.end('Bad request'); return; }
    let body;
    if (pathname === '/__status') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      body = JSON.stringify({ hash: revision, error });
    } else if (['/', '/index.html', '/docs/keymap/index.html'].includes(pathname)) {
      response.writeHead(html === null ? 503 : 200, { 'Content-Type': html === null ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8' });
      body = html ?? `キーマップを表示できません。ファイルを修正すると自動で再生成します。\n${error}`;
    } else {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      body = 'Not found';
    }
    response.end(request.method === 'HEAD' ? undefined : body);
  });

  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); accept(); });
  });
  const timer = setInterval(rebuild, pollInterval);
  const url = `http://127.0.0.1:${server.address().port}/`;
  logger(`キーマップを表示: ${url}`);
  logger('保存を監視しています。終了は Ctrl+C。');
  return {
    server,
    url,
    async close() {
      stopped = true;
      clearInterval(timer);
      await new Promise((accept, reject) => {
        server.close(cause => cause ? reject(cause) : accept());
        server.closeIdleConnections();
      });
    },
  };
}

function optionsFromArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--root') {
      if (!args[index + 1]) throw new Error('--root にディレクトリを指定してください。');
      options.root = args[++index];
    } else if (option === '--port') {
      const value = args[++index];
      if (!/^\d+$/.test(value ?? '') || Number(value) > 65535) throw new Error('--port は 0〜65535 の整数を指定してください。');
      options.port = Number(value);
    } else throw new Error(`未対応のオプション: ${option}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const viewer = await startViewer(optionsFromArgs(process.argv.slice(2)));
    const stop = async () => { await viewer.close(); process.exit(0); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (cause) {
    console.error(cause.message);
    process.exitCode = 1;
  }
}
