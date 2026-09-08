import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildHtml, repoRoot, writeViewer } from './generate.mjs';

const sourcePath = 'config/boards/shields/fish/fish.keymap';
const layoutPath = 'config/boards/shields/fish/fish-layouts.dtsi';
const outputPath = 'docs/keymap/index.html';
const files = [sourcePath, layoutPath,
  'config/boards/shields/fish/fish.conf', 'config/boards/shields/fish/Kconfig.defconfig',
  'tools/keymap-viewer/template.html', 'tools/keymap-viewer/style.css', 'tools/keymap-viewer/viewer.js'];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fish-generator-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('fish-generator-test-'));
    rmSync(root, { recursive: true, force: true });
  });
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    // Keep fixed key/setting expectations independent of the user's current
    // config; render with the real, current viewer assets under test.
    const input = file.startsWith('config/') ? join(repoRoot, 'tools/keymap-viewer/fixtures', basename(file)) : join(repoRoot, file);
    writeFileSync(join(root, file), readFileSync(input, 'utf8'), 'utf8');
  }
  return root;
}

function embeddedModel(html) {
  const match = html.match(/<script id="keymap-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'generated HTML includes its application/json model');
  return JSON.parse(match[1]);
}

test('generation is deterministic and the embedded model matches the actual source', t => {
  const root = fixture(t);
  const first = buildHtml(root);
  const second = buildHtml(root);
  assert.equal(first.html, second.html);
  assert.equal(first.revision, second.revision);
  const embedded = embeddedModel(first.html);
  assert.deepEqual(embedded.layers, first.model.layers);
  assert.equal(embedded.source.hash, first.model.source.hash);
  assert.equal(embedded.revision, first.revision);
  assert.ok(first.model.warnings.some(warning => warning.code === 'COMBO_PARENT_PROPERTY'), 'nonfatal existing issues stay visible');
});

test('saved binding values and renderer changes alter the generated output', t => {
  const root = fixture(t);
  const first = writeViewer(root);
  const source = join(root, sourcePath);
  const original = readFileSync(source, 'utf8');
  writeFileSync(source, original.replace(/&kp L\b/, '&kp F'), 'utf8');
  const changed = writeViewer(root);
  assert.equal(embeddedModel(changed.html).layers[0].bindings[0].args[0], 'F');
  assert.notEqual(changed.model.source.hash, first.model.source.hash);
  assert.notEqual(changed.revision, first.revision);
  assert.equal(readFileSync(join(root, outputPath), 'utf8'), changed.html);
  const stylesheet = join(root, 'tools/keymap-viewer/style.css');
  writeFileSync(stylesheet, `${readFileSync(stylesheet, 'utf8')}\n/* generation-test */`, 'utf8');
  const styled = buildHtml(root);
  assert.equal(styled.model.source.hash, changed.model.source.hash);
  assert.notEqual(styled.revision, changed.revision);
  assert.ok(styled.html.includes('/* generation-test */'));
});

test('--check detects stale HTML without overwriting it and succeeds after regeneration', t => {
  const root = fixture(t);
  const cli = () => spawnSync(process.execPath, [join(repoRoot, 'tools/keymap-viewer/generate.mjs'), '--root', root, '--check'], { encoding: 'utf8' });
  const original = writeViewer(root).html;
  assert.equal(cli().status, 0);
  const source = join(root, sourcePath);
  writeFileSync(source, readFileSync(source, 'utf8').replace(/&kp L\b/, '&kp F'), 'utf8');
  const stale = cli();
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /HTMLが最新ではありません/);
  assert.equal(readFileSync(join(root, outputPath), 'utf8'), original);
  writeViewer(root);
  assert.equal(cli().status, 0);
});

test('embedded JSON cannot terminate its script element', t => {
  const root = fixture(t);
  const source = join(root, sourcePath);
  const payload = '</script><script>globalThis.injected = true</script><!--';
  writeFileSync(source, readFileSync(source, 'utf8').replace('layer_keymap {', `layer_keymap {\n label = ${JSON.stringify(payload)};`), 'utf8');
  const result = buildHtml(root);
  assert.ok(!result.html.includes(payload));
  assert.ok(result.html.includes('\\u003c/script>'));
  assert.equal(embeddedModel(result.html).layers[0].displayName, payload);
});

test('unknown behavior remains inspectable as raw data with a warning', t => {
  const root = fixture(t);
  const source = join(root, sourcePath);
  writeFileSync(source, readFileSync(source, 'utf8').replace(/&kp L\b/, '&future_behavior 1 LS(LG(N3))'), 'utf8');
  const model = embeddedModel(writeViewer(root).html);
  assert.equal(model.layers[0].bindings[0].raw, '&future_behavior 1 LS(LG(N3))');
  assert.ok(model.warnings.some(warning => warning.code === 'UNKNOWN_BEHAVIOR'));
});

test('malformed or incomplete keymaps never replace the last good HTML', t => {
  const root = fixture(t);
  const good = writeViewer(root).html;
  const source = join(root, sourcePath);
  const original = readFileSync(source, 'utf8');
  const invalidSources = new Map([
    ['unclosed node', '/ { keymap {'],
    ['missing keymap', '/ { unrelated {}; };'],
    ['zero layers', '/ { keymap { compatible = "zmk,keymap"; }; };'],
    ['missing binding', original.replace(/&kp L\b/, '')],
    ['wrong behavior argument count', original.replace(/&kp L\b/, '&lt 1')],
    ['unresolved conditional preprocessing', `#if EXTERNAL_FLAG\n${original}\n#endif\n`],
    ['unmatched closing brace', `${original}\n};`],
  ]);
  for (const [reason, text] of invalidSources) {
    writeFileSync(source, text, 'utf8');
    assert.throws(() => writeViewer(root), /HTMLを更新しません/, reason);
    assert.equal(readFileSync(join(root, outputPath), 'utf8'), good, reason);
  }
  writeFileSync(source, original, 'utf8');
  assert.equal(writeViewer(root).html, good, 'generation recovers after a valid save');
});

test('an empty physical layout cannot replace the last good HTML', t => {
  const root = fixture(t);
  const good = writeViewer(root).html;
  writeFileSync(join(root, layoutPath), '/ { physical_layout0: physical_layout_0 { compatible = "zmk,physical-layout"; keys = <>; }; };', 'utf8');
  assert.throws(() => writeViewer(root), /物理キーの配置が空です/);
  assert.equal(readFileSync(join(root, outputPath), 'utf8'), good);
});
