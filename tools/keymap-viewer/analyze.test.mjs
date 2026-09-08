import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeModel, effectiveBinding } from './analyze.mjs';

const binding = (behavior, ...args) => ({ behavior, args: args.map(String), raw: `&${behavior}${args.length ? ` ${args.join(' ')}` : ''}`, line: 1 });
const layer = (id, ...bindings) => ({ id, name: `layer_${id}`, displayName: `L${id}`, bindings, line: id + 1 });
const model = (layers, other = {}) => ({ layers, behaviors: [], combos: [], conditionalLayers: [], warnings: [], ...other });
const kp = () => binding('kp', 'A');
const trans = () => binding('trans');
const none = () => binding('none');

test('Raijin exposes its conditional auxiliary hold and exclusive return without pretending to emulate vowels', () => {
  const data = model([
    layer(0, binding('to', 1), kp(), kp()),
    layer(1, binding('rj', 'K', 'O'), binding('rj', 1, 0), binding('to', 0)),
    layer(2, binding('to', 0), binding('rj', 1, 0), binding('rj', 2, 'LEFT')),
  ], {behaviors:[{name:'rj',compatible:'zmk,behavior-onishi-raijin',properties:{'main-layer':1,'auxiliary-layer':2},bindings:[]}]});
  const result = analyzeModel(data);
  assert.equal(result.complete,true);
  assert.deepEqual(result.reachableLayers,[0,1,2]);
  const enter = result.transitions.find(route=>route.from===1&&route.to===2);
  assert.equal(enter.kind,'hold');
  assert.match(enter.trigger,/子音を離して/);
  assert.ok(result.transitions.some(route=>route.from===2&&route.to===1&&route.via==='release'));
  assert.ok(result.transitions.some(route=>route.from===2&&route.to===0&&route.kind==='to'&&route.reachable));
  assert.equal(result.transitions.some(route=>route.from===2&&route.to===2),false,'補助から同じ補助へ入る架空経路を作らない');
});

test('a latched nontransparent higher layer blocks a lower hold target', () => {
  const result = analyzeModel(model([
    layer(0, binding('lt', 1, 'RET'), kp()),
    layer(1, none(), binding('tog', 3)),
    layer(2, kp(), binding('to', 0)),
    layer(3, binding('lt', 2, 'SPACE'), binding('tog', 0)),
  ]));
  assert.deepEqual(result.reachableLayers, [0, 1, 3]);
  assert.ok(result.declaredActiveLayers.includes(2), 'the lower layer activates, but no binding can use it');
  const blocked = result.transitions.find(route => route.from === 3 && route.to === 2);
  assert.equal(blocked.reachable, true);
  assert.equal(blocked.blocked, true);
  assert.match(blocked.reason, /非透過/);
  assert.equal(result.paths[2], undefined);
  assert.ok(result.warnings.some(warning => warning.code === 'toggle-base-no-return'));
});

test('a transparent higher layer allows lower layer bindings to be reached', () => {
  const result = analyzeModel(model([
    layer(0, binding('to', 3), kp()),
    layer(1, none(), none()),
    layer(2, kp(), binding('to', 0)),
    layer(3, binding('mo', 2), trans()),
  ]));
  assert.deepEqual(result.reachableLayers, [0, 2, 3]);
  assert.equal(result.transitions.find(route => route.from === 3 && route.to === 2).blocked, false);
  assert.equal(result.paths[2].at(-1).targetLayer, 2);
  assert.equal(result.paths[2].at(-1).to, 2);
  assert.equal(result.transitions.find(route => route.from === 2 && route.to === 0).reachable, true);
});

test('&none consumes a key while &trans falls through', () => {
  const data = model([layer(0, binding('mo', 1), kp()), layer(1, none(), trans())]);
  assert.equal(effectiveBinding(data, [0, 1], 0).layerId, 1);
  assert.equal(effectiveBinding(data, [0, 1], 1).layerId, 0);
});

test('&to 0 clears a latched high layer and reaches a valid return key', () => {
  const result = analyzeModel(model([
    layer(0, binding('to', 4)),
    layer(4, binding('to', 0)),
  ]));
  const back = result.transitions.find(route => route.from === 4 && route.to === 0);
  assert.equal(back.reachable, true);
  assert.equal(back.blocked, false);
  assert.equal(result.warnings.some(warning => warning.code === 'toggle-base-no-return'), false);
});

test('toggling the active layer off creates an actual return transition', () => {
  const result = analyzeModel(model([
    layer(0, binding('tog', 2)),
    layer(2, binding('tog', 2)),
  ]));
  assert.ok(result.transitions.some(route => route.from === 2 && route.to === 0 && route.kind === 'toggle' && route.effect === 'deactivate'));
});

test('hold releases use the originally pressed binding and release order', () => {
  const result = analyzeModel(model([
    layer(0, binding('lt', 1, 'RET'), binding('lt', 2, 'SPACE')),
    layer(1, none(), binding('lt', 6, 'SPACE')),
    layer(2, binding('lt', 6, 'RET'), none()),
    layer(6, none(), none()),
  ]));
  assert.deepEqual(result.reachableLayers, [0, 1, 2, 6]);
  assert.deepEqual(result.paths[6].map(step => step.keyIndex), [0, 1]);
  assert.ok(result.transitions.some(route => route.from === 6 && route.to === 1 && route.kind === 'release'));
  assert.ok(result.transitions.some(route => route.from === 6 && route.to === 2 && route.kind === 'release'));
});

test('layer targets follow parsed numbers without fixed fish layer assumptions', () => {
  const result = analyzeModel(model([
    layer(0, binding('to', 9)),
    layer(4, none()),
    layer(9, binding('mo', 12)),
    layer(12, binding('to', 0)),
  ]));
  assert.deepEqual(result.reachableLayers, [0, 9, 12]);
  assert.deepEqual(result.unreachableLayers, [4]);
  assert.deepEqual(result.paths[12].map(step => step.targetLayer), [9, 12]);
});

test('global combos create an entry even when all physical keys are none', () => {
  const result = analyzeModel(model([
    layer(0, none(), none()),
    layer(8, none(), none()),
  ], { combos: [{ name: 'enter', positions: [0, 1], layers: null, bindings: [binding('to', 8)], line: 10 }] }));
  assert.deepEqual(result.reachableLayers, [0, 8]);
  assert.equal(result.paths[8][0].via, 'combo');
  assert.equal(result.paths[8][0].comboName, 'enter');
});

test('combo layer filters use highest active layer and occupied holds cannot form a new combo', () => {
  const result = analyzeModel(model([
    layer(0, binding('mo', 2), none(), none()),
    layer(2, trans(), none(), none()),
    layer(5, none(), none(), none()),
  ], { combos: [{ name: 'restricted', positions: [1, 2], layers: [1], bindings: [binding('to', 5)] }] }));
  assert.deepEqual(result.reachableLayers, [0, 2]);
  const occupied = analyzeModel(model([
    layer(0, binding('mo', 2), none()), layer(2, trans(), none()), layer(5, none(), none()),
  ], { combos: [{ name: 'occupied', positions: [0, 1], layers: [2], bindings: [binding('to', 5)] }] }));
  assert.equal(occupied.reachableLayers.includes(5), false);
});

test('conditional layer activates only when both held layers are active', () => {
  const result = analyzeModel(model([
    layer(0, binding('mo', 1), binding('mo', 2)),
    layer(1, trans(), trans()),
    layer(2, trans(), trans()),
    layer(3, kp(), kp()),
  ], { conditionalLayers: [{ ifLayers: [1, 2], thenLayer: 3 }] }));
  assert.ok(result.reachableLayers.includes(3));
  assert.deepEqual(result.paths[3].at(-1).activeLayers, [0, 1, 2, 3]);
  assert.ok(result.transitions.some(route => route.kind === 'conditional' && route.to === 3 && route.reachable));
});

test('sticky activation allows the original position to be pressed again', () => {
  const result = analyzeModel(model([
    layer(0, binding('sl', 2)),
    layer(2, binding('to', 3)),
    layer(3, binding('to', 0)),
  ]));
  assert.deepEqual(result.reachableLayers, [0, 2, 3]);
  assert.equal(result.paths[3][0].kind, 'sticky');
});

test('toggle-on locking preserves a layer after releasing its momentary key', () => {
  const result = analyzeModel(model([
    layer(0, binding('mo', 2), none()),
    layer(2, binding('to', 3), binding('latch', 2)),
    layer(3, none(), none()),
  ], { behaviors: [{ name: 'latch', compatible: 'zmk,behavior-toggle-layer', properties: { 'toggle-mode': 'on', locking: true } }] }));
  // The key which entered L2 cannot invoke &to 3 until it is released. L2 must
  // survive that release for L3 to be reachable through the same position.
  assert.deepEqual(result.reachableLayers, [0, 2, 3]);
  assert.deepEqual(result.paths[3].map(step => step.kind), ['hold', 'toggle', 'release', 'to']);
});

test('simple custom macros expose persistent layer operations', () => {
  const result = analyzeModel(model([layer(0, binding('enter')), layer(8, binding('to', 0))], {
    behaviors: [{ name: 'enter', compatible: 'zmk,behavior-macro', properties: {}, bindings: [binding('kp', 'ESC'), binding('to', 8)] }],
  }));
  assert.deepEqual(result.reachableLayers, [0, 8]);
  assert.equal(result.transitions[0].customBehavior, 'enter');
});

test('unknown custom behavior warns instead of asserting hidden routes are parsed', () => {
  const result = analyzeModel(model([layer(0, binding('unavailable')), layer(8, none())]));
  assert.deepEqual(result.reachableLayers, [0]);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some(warning => warning.code === 'unknown-behavior-routing'));
});

test('state exploration stops at its documented bound', () => {
  const result = analyzeModel(model([
    layer(0, binding('tog', 1), binding('tog', 2)),
    layer(1, trans(), trans()),
    layer(2, trans(), trans()),
  ]), { maxStates: 2 });
  assert.equal(result.stateCount, 2);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some(warning => warning.code === 'state-search-limit'));
});
