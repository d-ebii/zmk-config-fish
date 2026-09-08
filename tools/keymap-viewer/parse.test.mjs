import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseKeymap, parseLayout, parseSettings, readModel } from './parse.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = 'config/boards/shields/fish';
// Assertions about specific keys and settings use a stable snapshot. The live
// repository remains free to change its layout, layer count, and behaviors.
const read = file => readFileSync(join(root, 'tools/keymap-viewer/fixtures', file), 'utf8');
const readCurrent = file => readFileSync(join(root, directory, file), 'utf8');
const minimal = binding => `/ { keymap { compatible = "zmk,keymap"; base { bindings = <${binding}>; }; }; };`;

test('repository keymaps have layers whose binding counts match the current physical layout', () => {
  const files = readdirSync(join(root, directory)).filter(name => name.endsWith('.keymap'));
  const layout = parseLayout(readCurrent('fish-layouts.dtsi'));
  assert.ok(files.length > 0, 'at least one repository keymap exists');
  assert.ok(layout.length > 0, 'the current physical layout has keys');
  for (const file of files) {
    const model = parseKeymap(readCurrent(file));
    assert.ok(model.layers.length > 0, file);
    for (const layer of model.layers) assert.equal(layer.bindings.length, layout.length, `${file}: ${layer.name}`);
    assert.equal(model.warnings.filter(item => item.code === 'BINDING_ARITY').length, 0, file);
  }
});

test('physical coordinates retain centi-key units and convert rotations to degrees', () => {
  const layout = parseLayout(read('fish-layouts.dtsi'));
  assert.equal(layout.length, 32);
  assert.deepEqual(layout[0], { index: 0, x: 200, y: 12, width: 100, height: 100, rotation: 0, rx: 0, ry: 0 });
  assert.equal(layout[28].rotation, 15);
  assert.equal(layout[30].rotation, -15);
});

test('comments, labels, empty nodes, macros, modifiers and source lines survive parsing', () => {
  const text = `// ignored &kp BAD
/ {
 behaviors {
  act: macro_node { compatible = "zmk,behavior-macro"; #binding-cells = <0>; bindings = <&kp X>, <&kp N>; };
 };
 conditional_layers {};
 keymap {
  compatible = "zmk,keymap";
  layer: base { display-name = "Base // literal"; bindings = <
    &kp LS(LG(N3)) /* &kp BAD */ &act &mt LCTRL SPACE
  >; };
 };
};`;
  const model = parseKeymap(text);
  assert.equal(model.layers[0].displayName, 'Base // literal');
  assert.deepEqual(model.layers[0].bindings.map(({ behavior, args }) => ({ behavior, args })), [
    { behavior: 'kp', args: ['LS(LG(N3))'] }, { behavior: 'act', args: [] }, { behavior: 'mt', args: ['LCTRL', 'SPACE'] },
  ]);
  assert.equal(model.layers[0].bindings[0].line, 10);
  assert.equal(model.layers[0].bindings[0].raw, '&kp LS(LG(N3))');
  assert.deepEqual(model.behaviors[0].bindings.map(binding => binding.args[0]), ['X', 'N']);
  assert.deepEqual(model.conditionalLayers, []);
  assert.deepEqual(model.warnings, []);
});

test('unknown behaviors preserve arguments without stealing the following binding', () => {
  const model = parseKeymap(minimal('&mystery 1 LS(LG(N3)) (2 + 3) &kp A'));
  assert.deepEqual(model.layers[0].bindings[0].args, ['1', 'LS(LG(N3))', '(2 + 3)']);
  assert.equal(model.layers[0].bindings[1].behavior, 'kp');
  assert.ok(model.warnings.some(item => item.code === 'UNKNOWN_BEHAVIOR'));
});

test('invalid built-in argument counts are warned about', () => {
  const model = parseKeymap(minimal('&lt 1 &none A'));
  assert.equal(model.warnings.filter(item => item.code === 'BINDING_ARITY').length, 2);
});

test('combo defaults ignore parent properties and respect individual overrides', () => {
  const model = parseKeymap(`/ { combos { compatible = "zmk,combos"; timeout-ms = <100>; require-prior-idle-ms = <150>;
    default_combo { key-positions = <0 1>; bindings = <&kp ESC>; };
    custom_combo { key-positions = <2 3>; layers = <0 2>; timeout-ms = <80>; require-prior-idle-ms = <120>; bindings = <&kp TAB>; };
  }; keymap { base { bindings = <&none>; }; }; };`);
  assert.equal(model.combos[0].timeoutMs, 50);
  assert.equal(model.combos[0].priorIdleMs, -1);
  assert.equal(model.combos[0].layers, null);
  assert.equal(model.combos[1].timeoutMs, 80);
  assert.equal(model.combos[1].priorIdleMs, 120);
  assert.deepEqual(model.combos[1].layers, [0, 2]);
  assert.equal(model.warnings.filter(item => item.code === 'COMBO_PARENT_PROPERTY').length, 2);
});

test('numeric layer defines and conditional layers resolve while unsupported preprocessing warns', () => {
  const model = parseKeymap(`#define BASE 0\n#define NAV (2)\n#define FN(x) x\n#if FLAG\n${minimal('&lt NAV SPACE &to BASE')}\n#endif\n/ { conditional_layers { tri { if-layers = <BASE NAV>; then-layer = <3>; }; }; };`);
  assert.deepEqual(model.layers[0].bindings.map(binding => binding.args), [['2', 'SPACE'], ['0']]);
  assert.deepEqual(model.conditionalLayers, [{ ifLayers: [0, 2], thenLayer: 3 }]);
  assert.ok(model.warnings.some(item => item.code === 'UNSUPPORTED_DEFINE'));
  assert.equal(model.warnings.filter(item => item.code === 'UNSUPPORTED_PREPROCESSOR').length, 2);
});

test('settings include only active conf entries and retain conditional Kconfig defaults', () => {
  const settings = parseSettings(read('fish.conf'));
  assert.equal(settings.find(item => item.key === 'CONFIG_ZMK_IDLE_SLEEP_TIMEOUT').value, 900000);
  assert.ok(!settings.some(item => item.key === 'CONFIG_ZMK_POINTING'));
  const defaults = parseSettings(read('Kconfig.defconfig'));
  assert.equal(defaults.find(item => item.key === 'CONFIG_ZMK_SPLIT_ROLE_CENTRAL').condition, 'SHIELD_FISH_LEFT');
  assert.equal(defaults.find(item => item.key === 'CONFIG_ZMK_KEYBOARD_NAME').value, 'Fish Keyboard');
});

test('external includes, unknown directives and malformed syntax cannot pass silently', () => {
  const model = parseKeymap(`#include "custom.dtsi"\n#unexpected value\n${minimal('&kp A')}\n/ { broken { value = <1> } };`);
  assert.ok(model.warnings.some(item => item.code === 'INCLUDE_NOT_EXPANDED'));
  assert.ok(model.warnings.some(item => item.code === 'UNSUPPORTED_PREPROCESSOR'));
  assert.ok(model.warnings.some(item => item.code === 'MISSING_SEMICOLON'));
  assert.equal(model.layers[0].bindings[0].raw, '&kp A');
});

test('custom binding cell counts validate arguments without affecting boundaries', () => {
  const model = parseKeymap(`/ { behaviors {
    dual: dual { compatible = "zmk,behavior-hold-tap"; #binding-cells = <2>; bindings = <&mo>, <&kp>; };
  }; keymap { base { bindings = <&dual 2 SPACE &kp A>; }; }; };`);
  assert.equal(model.layers[0].bindings.length, 2);
  assert.deepEqual(model.layers[0].bindings[0].args, ['2', 'SPACE']);
  assert.ok(!model.warnings.some(item => item.code === 'UNKNOWN_BEHAVIOR'));
  assert.ok(!model.warnings.some(item => item.code === 'BINDING_ARITY'));
});

test('readModel detects binding count errors and changes hashes when a source is updated', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'fish-keymap-parser-'));
  try {
    mkdirSync(join(fixture, directory), { recursive: true });
    for (const file of ['fish.keymap', 'fish-layouts.dtsi', 'fish.conf', 'Kconfig.defconfig']) writeFileSync(join(fixture, directory, file), read(file), 'utf8');
    const first = readModel(fixture);
    assert.equal(first.layout.length, 32);
    assert.equal(first.layers[0].bindings[0].args[0], 'L');
    writeFileSync(join(fixture, directory, 'fish.keymap'), read('fish.keymap').replace('&kp L ', '&kp B '), 'utf8');
    const changed = readModel(fixture);
    assert.notEqual(first.source.hash, changed.source.hash);
    assert.equal(changed.layers[0].bindings[0].args[0], 'B');
    writeFileSync(join(fixture, directory, 'fish.keymap'), minimal('&kp A'), 'utf8');
    assert.ok(readModel(fixture).warnings.some(item => item.code === 'LAYER_BINDING_COUNT'));
    writeFileSync(join(fixture, directory, 'fish.conf'), 'CONFIG_ZMK_SLEEP=n\n', 'utf8');
    assert.notEqual(readModel(fixture).source.hash, changed.source.hash);
  } finally {
    // The resolved target is a unique directory created by this test in tmpdir.
    assert.ok(resolve(fixture).startsWith(`${resolve(tmpdir())}\\`) || resolve(fixture).startsWith(`${resolve(tmpdir())}/`));
    rmSync(fixture, { recursive: true, force: true });
  }
});
