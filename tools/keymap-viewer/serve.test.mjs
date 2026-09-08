import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { repoRoot } from './generate.mjs';
import { startViewer } from './serve.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fish-viewer-test-'));
  cpSync(join(repoRoot, 'config'), join(root, 'config'), { recursive: true });
  for (const file of ['fish.keymap', 'fish-layouts.dtsi', 'fish.conf', 'Kconfig.defconfig']) {
    cpSync(join(repoRoot, 'tools/keymap-viewer/fixtures', file), join(root, 'config/boards/shields/fish', file));
  }
  cpSync(join(repoRoot, 'tools/keymap-viewer'), join(root, 'tools/keymap-viewer'), { recursive: true });
  return root;
}

function removeFixture(root) {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('fish-viewer-test-'));
  rmSync(root, { recursive: true, force: true });
}

async function eventually(read, accept) {
  const deadline = Date.now() + 15000;
  let value;
  do {
    value = await read();
    if (accept(value)) return value;
    await delay(75);
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for update: ${JSON.stringify(value)}`);
}

test('saved keymaps and templates update HTML; malformed input keeps last good output and recovers', async t => {
  const root = fixture();
  let viewer;
  t.after(async () => { if (viewer) await viewer.close(); removeFixture(root); });
  viewer = await startViewer({ root, port: 0, pollInterval: 40, logger: () => {} });
  const status = () => fetch(`${viewer.url}__status`).then(response => response.json());
  const readHtml = () => fetch(viewer.url).then(response => response.text());
  const originalStatus = await status();
  const originalHtml = await readHtml();
  assert.equal(originalStatus.error, null);
  assert.match(originalStatus.hash, /^[a-f0-9]+$/);
  assert.ok(originalHtml.includes(originalStatus.hash), 'browser model and status share the build revision');
  assert.equal(readFileSync(join(root, 'docs/keymap/index.html'), 'utf8'), originalHtml);

  const source = join(root, 'config/boards/shields/fish/fish.keymap');
  const original = readFileSync(source, 'utf8');
  const changed = original.replace(/&kp L\b/, '&kp F');
  assert.notEqual(changed, original);
  const replacement = `${source}.replacement`;
  writeFileSync(replacement, changed, 'utf8');
  renameSync(replacement, source);
  const changedStatus = await eventually(status, value => !value.error && value.hash !== originalStatus.hash);
  const changedHtml = await readHtml();
  assert.notEqual(changedHtml, originalHtml);
  assert.ok(changedHtml.includes(changedStatus.hash));
  assert.equal(readFileSync(join(root, 'docs/keymap/index.html'), 'utf8'), changedHtml);

  writeFileSync(source, '/ { keymap {', 'utf8');
  const failedStatus = await eventually(status, value => Boolean(value.error));
  assert.equal(failedStatus.hash, changedStatus.hash);
  assert.equal(await readHtml(), changedHtml);
  assert.equal(readFileSync(join(root, 'docs/keymap/index.html'), 'utf8'), changedHtml);

  writeFileSync(source, original, 'utf8');
  await eventually(status, value => value.error === null && value.hash === originalStatus.hash);
  assert.equal(await readHtml(), originalHtml);

  const template = join(root, 'tools/keymap-viewer/template.html');
  writeFileSync(template, `${readFileSync(template, 'utf8')}\n<!-- watch-template-proof -->`, 'utf8');
  await eventually(status, value => !value.error && value.hash !== originalStatus.hash);
  assert.ok((await readHtml()).includes('watch-template-proof'));

  for (const path of ['config/boards/shields/fish/fish.keymap', '.git/config', '%2e%2e/package.json', 'tools/keymap-viewer/parse.mjs']) {
    assert.equal((await fetch(`${viewer.url}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(viewer.url, { method: 'POST' })).status, 405);
  const head = await fetch(viewer.url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('an initially malformed keymap reports 503 then becomes available after repair', async t => {
  const root = fixture();
  let viewer;
  t.after(async () => { if (viewer) await viewer.close(); removeFixture(root); });
  const source = join(root, 'config/boards/shields/fish/fish.keymap');
  const original = readFileSync(source, 'utf8');
  writeFileSync(source, '/ { keymap {', 'utf8');
  viewer = await startViewer({ root, port: 0, pollInterval: 40, logger: () => {} });
  const status = () => fetch(`${viewer.url}__status`).then(response => response.json());
  assert.equal((await fetch(viewer.url)).status, 503);
  assert.equal((await status()).hash, null);
  assert.ok((await status()).error);
  writeFileSync(source, original, 'utf8');
  await eventually(status, value => value.error === null && Boolean(value.hash));
  assert.equal((await fetch(viewer.url)).status, 200);
});
