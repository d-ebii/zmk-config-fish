/**
 * Small, deterministic layer-state explorer for a parsed ZMK keymap.
 * This models resolved hold/tap outcomes, not input timing or firmware execution.
 * Higher active layers consume a position unless their binding is &trans.
 */

const KIND = { mo: 'hold', lt: 'hold', tog: 'toggle', to: 'to', sl: 'sticky' };
const BUILTINS_WITHOUT_LAYERS = new Set([
  'kp', 'mt', 'sk', 'kt', 'trans', 'none', 'bt', 'out', 'bootloader', 'sys_reset',
  'reset', 'studio_unlock', 'caps_word', 'key_repeat', 'rgb_ug', 'bl', 'ext_power',
  'soft_off', 'mkp', 'mmv', 'msc', 'inc_dec_kp', 'sensor_rotate', 'sensor_rotate_var',
]);
const MACRO_CONTROLS = new Set([
  'macro_tap', 'macro_press', 'macro_release', 'macro_pause_for_release',
  'macro_tap_time', 'macro_wait_time', 'macro_param_1to1', 'macro_param_1to2',
  'macro_param_2to1', 'macro_param_2to2',
]);
const COMPATIBLE_KIND = {
  'zmk,behavior-momentary-layer': 'hold',
  'zmk,behavior-toggle-layer': 'toggle',
  'zmk,behavior-to-layer': 'to',
  'zmk,behavior-sticky-layer': 'sticky',
};
const sorted = values => [...values].sort((a, b) => a - b);
const behaviorName = binding => String(binding?.behavior || '').replace(/^&/, '');
const propertyText = value => String(Array.isArray(value) ? value[0] : value ?? '').replace(/["<>]/g, '').trim();

/** Resolve a key through the active stack. &none stops traversal, just like &kp. */
export function effectiveBinding(model, activeLayers, keyIndex) {
  const byId = new Map(model.layers.map(layer => [layer.id, layer]));
  for (const id of sorted(activeLayers).reverse()) {
    const binding = byId.get(id)?.bindings[keyIndex];
    if (binding && behaviorName(binding) !== 'trans') return { layerId: id, binding };
  }
  return null;
}

export function analyzeModel(model, { maxStates = 12000 } = {}) {
  const layers = model.layers || [];
  const layerIds = new Set(layers.map(layer => layer.id));
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const definitions = new Map((model.behaviors || []).map(def => [def.name, def]));
  const keyCount = Math.max(0, ...layers.map(layer => layer.bindings.length));
  const warnings = [];
  const warningKeys = new Set();
  const warn = (code, message, line) => {
    const key = `${code}:${message}:${line ?? ''}`;
    if (!warningKeys.has(key)) {
      warningKeys.add(key);
      warnings.push({ code, message, ...(line ? { line } : {}) });
    }
  };

  // Each option is one possible resolved action. Multiple operations in an
  // option form a sequential macro; alternatives represent hold/tap or dances.
  function optionsFor(binding, chain = []) {
    const name = behaviorName(binding);
    const definition = definitions.get(name);
    const kind = KIND[name] || COMPATIBLE_KIND[definition?.compatible];
    if (kind) {
      const arg = binding.args?.[0];
      const target = Number(arg);
      if (arg === undefined || !Number.isInteger(target) || !layerIds.has(target)) {
        warn('invalid-layer-target', `${binding.raw || `&${name}`} の移動先レイヤーを解決できません。`, binding.line);
        return [];
      }
      return [[{ kind, target, raw: binding.raw, line: binding.line,
        toggleMode: propertyText(definition?.properties?.['toggle-mode']) || 'toggle',
        locking: name === 'tog' || name === 'to' || Object.hasOwn(definition?.properties || {}, 'locking'),
      }]];
    }
    if (BUILTINS_WITHOUT_LAYERS.has(name) || MACRO_CONTROLS.has(name) && !definition) return [];
    if (!definition) {
      warn('unknown-behavior-routing', `&${name} の定義を解析できないため、内部のレイヤー移動は未確認です。`, binding.line);
      return [];
    }
    if (chain.includes(name)) {
      warn('recursive-behavior-routing', `&${name} の再帰参照によるレイヤー移動は解析対象外です。`, binding.line);
      return [];
    }
    const children = definition.bindings || [];
    const nextChain = [...chain, name];
    if (definition.compatible === 'zmk,behavior-onishi-raijin') {
      // The entry path uses Backspace while no consonant is held. Character
      // state is handled by the firmware, not by this layer-only explorer.
      if (Number(binding.args?.[0]) !== 1) return [];
      const target = Number(definition.properties['auxiliary-layer']);
      const main = Number(definition.properties['main-layer']);
      if (!layerIds.has(target) || !layerIds.has(main)) {
        warn('invalid-raijin-layer', `&${name} の本体または補助レイヤーが存在しません。`, binding.line);
        return [];
      }
      return [[{kind:'hold',target,onlyFrom:main,raw:binding.raw,line:binding.line,
        customBehavior:name,trigger:'子音を離してからBackspaceを保持'}]];
    }
    if (String(definition.compatible).startsWith('zmk,behavior-macro')) {
      const operations = [];
      let supported = true;
      for (const child of children) {
        const childName = behaviorName(child);
        if (MACRO_CONTROLS.has(childName) && !definitions.has(childName)) {
          if (childName !== 'macro_tap') supported = false;
          continue;
        }
        const warningCount = warnings.length;
        const options = optionsFor(child, nextChain);
        if (warnings.length !== warningCount) supported = false;
        if (options.length > 1 || options.some(option => option.some(op => !['toggle', 'to'].includes(op.kind)))) supported = false;
        if (options.length === 1) operations.push(...options[0]);
      }
      if (!supported) {
        warn('macro-routing-unresolved', `&${name} の押下・解放制御や一時レイヤーを含むマクロは、入口として確定していません。`, binding.line);
        return [];
      }
      return operations.length ? [operations.map(op => ({ ...op, customBehavior: name }))] : [];
    }
    if (definition.compatible === 'zmk,behavior-hold-tap') {
      return children.flatMap((child, index) => optionsFor({
        ...child, args: child.args?.length ? child.args : [binding.args?.[index]],
      }, nextChain).map(option => option.map(op => ({ ...op, customBehavior: name, trigger: index ? 'tap' : 'hold' }))));
    }
    if (definition.compatible === 'zmk,behavior-tap-dance') {
      return children.flatMap((child, index) => optionsFor(child, nextChain).map(option => option.map(op => ({
        ...op, customBehavior: name, tapCount: index + 1,
      }))));
    }
    // A known custom behavior containing no layer operations is harmless for
    // this analysis; unknown compatible types must not invent reachable routes.
    if (!children.length || children.some(child => optionsFor(child, nextChain).length)) {
      warn('custom-routing-unresolved', `&${name} (${definition.compatible || 'compatible不明'}) のレイヤー動作は未解析です。`, binding.line);
    }
    return [];
  }

  const transitions = [];
  const keyOptions = new Map();
  const comboOptions = new Map();
  function register(binding, metadata) {
    return optionsFor(binding).filter(operations=>operations.every(op=>op.onlyFrom===undefined||op.onlyFrom===metadata.from)).map(operations => operations.map(op => {
      const id = `route-${transitions.length}`;
      const transition = {
        id, ...metadata, to: op.target, kind: op.kind, raw: binding.raw,
        line: binding.line, reachable: false, blocked: false,
        ...(op.customBehavior ? { customBehavior: op.customBehavior, operationRaw: op.raw } : {}),
        ...(op.trigger ? { trigger: op.trigger } : {}),
        ...(op.tapCount ? { tapCount: op.tapCount } : {}),
      };
      transitions.push(transition);
      return { ...op, transition };
    }));
  }
  for (const layer of layers) {
    layer.bindings.forEach((binding, keyIndex) => {
      keyOptions.set(`${layer.id}:${keyIndex}`, register(binding, { from: layer.id, via: 'key', keyIndex }));
    });
  }
  for (const [comboIndex, combo] of (model.combos || []).entries()) {
    const allowedLayers = combo.layers?.length ? combo.layers : sorted(layerIds);
    for (const from of allowedLayers) {
      comboOptions.set(`${comboIndex}:${from}`, (combo.bindings || []).flatMap(binding => register(binding, {
        from, via: 'combo', comboName: combo.name, positions: combo.positions,
      })));
    }
  }

  const conditionals = (model.conditionalLayers || []).filter(rule => {
    const valid = layerIds.has(rule.thenLayer) && rule.ifLayers?.length && rule.ifLayers.every(id => layerIds.has(id));
    if (!valid) warn('invalid-conditional-layer', '条件レイヤーの参照先を解決できません。', rule.line);
    return valid;
  });
  for (const rule of conditionals) {
    for (const from of rule.ifLayers) transitions.push({
      id: `route-${transitions.length}`, from, to: rule.thenLayer,
      kind: 'conditional', via: 'conditional', ifLayers: rule.ifLayers,
      raw: `if-layers = <${rule.ifLayers.join(' ')}>; then-layer = <${rule.thenLayer}>;`,
      line: rule.line, reachable: false, blocked: false,
    });
  }
  function normalize(state) {
    state.active.add(0);
    // Conditional layers own the activation of their then-layer. Iterate to
    // allow normal forward chains; report oscillating/cyclic configurations.
    for (let pass = 0; pass <= conditionals.length; pass++) {
      const before = sorted(state.active).join(',');
      for (const rule of conditionals) {
        if (rule.ifLayers.every(id => state.active.has(id))) state.active.add(rule.thenLayer);
        else if (rule.thenLayer !== 0) state.active.delete(rule.thenLayer);
      }
      if (before === sorted(state.active).join(',')) return state;
    }
    warn('conditional-cycle', '条件レイヤーの循環があるため、到達結果は不完全な可能性があります。');
    return state;
  }
  const clone = state => ({
    active: new Set(state.active), locked: new Set(state.locked), held: [...state.held],
    causes: new Map([...state.causes].map(([id, routes]) => [id, new Set(routes)])),
  });
  const top = state => Math.max(0, ...state.active);
  function visible(state) {
    const result = new Set([top(state)]);
    const stack = sorted(state.active).reverse();
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
      for (const id of stack) {
        const binding = byId.get(id)?.bindings[keyIndex];
        if (binding && behaviorName(binding) !== 'trans') {
          result.add(id);
          break;
        }
      }
    }
    return result;
  }
  function stateKey(state) {
    const causes = [...state.causes].sort(([a], [b]) => a - b).map(([id, routes]) => `${id}:${[...routes].sort().join(',')}`).join(';');
    return `${sorted(state.active)}|${sorted(state.locked)}|${state.held.map(held => held.token).sort().join(';')}|${causes}`;
  }
  const reachable = new Set();
  const activated = new Set();
  const paths = {};
  const seen = new Set();
  const queue = [];
  const observed = new Map(transitions.map(transition => [transition.id, { usable: false, noEffect: true, coveredBy: new Set(), effects: new Set() }]));
  const returnTransitions = new Map();
  let truncated = false;

  function enqueue(state, path) {
    normalize(state);
    const effectiveLayers = visible(state);
    for (const transition of transitions) {
      if (transition.kind !== 'conditional' || !transition.ifLayers.every(id => state.active.has(id))) continue;
      transition.reachable = true;
      const record = observed.get(transition.id);
      record.noEffect = false;
      record.effects.add('activate');
      if (effectiveLayers.has(transition.to)) record.usable = true;
      else if (top(state) > transition.to) record.coveredBy.add(top(state));
    }
    for (const id of state.active) activated.add(id);
    for (const id of effectiveLayers) {
      reachable.add(id);
      if (!paths[id] || path.length < paths[id].length) paths[id] = path;
    }
    // A layer can become usable only after a previously blocking hold releases.
    for (const [id, routes] of state.causes) {
      if (!state.active.has(id)) state.causes.delete(id);
      else if (effectiveLayers.has(id)) for (const route of routes) observed.get(route).usable = true;
    }
    const key = stateKey(state);
    if (seen.has(key)) return;
    if (queue.length >= maxStates) { truncated = true; return; }
    seen.add(key);
    queue.push({ state, path });
  }

  if (!layerIds.has(0)) {
    warn('missing-base-layer', 'レイヤー0が見つからず、起動状態からの経路を解析できません。');
  } else enqueue({ active: new Set([0]), locked: new Set(), held: [], causes: new Map() }, []);

  function press(state, path, operations, source) {
    const next = clone(state);
    const releases = [];
    const beforeTop = top(state);
    const operationsSummary = [];
    for (const op of operations) {
      const transition = op.transition;
      transition.reachable = true;
      const record = observed.get(transition.id);
      const beforeActive = next.active.has(op.target);
      const oldActive = sorted(next.active).join(',');
      if (op.kind === 'hold' || op.kind === 'sticky') {
        next.active.add(op.target);
        releases.push({ target: op.target, kind: op.kind });
      } else if (op.kind === 'to') {
        next.active = new Set([0, op.target, ...(op.locking ? [] : next.locked)]);
        if (op.locking) next.locked = new Set(op.target ? [op.target] : []);
      } else if (op.kind === 'toggle') {
        const activate = op.toggleMode === 'on' || (op.toggleMode !== 'off' && !beforeActive);
        if (activate) {
          next.active.add(op.target);
          if (op.locking) next.locked.add(op.target);
        } else if (op.target !== 0 && (op.locking || !next.locked.has(op.target))) {
          next.active.delete(op.target); next.locked.delete(op.target);
        }
      }
      normalize(next);
      const afterActive = next.active.has(op.target);
      const changed = oldActive !== sorted(next.active).join(',');
      record.noEffect &&= !changed;
      record.effects.add(afterActive ? (beforeActive ? 'keep' : 'activate') : 'deactivate');
      const usable = visible(next).has(op.target);
      if (changed && (!afterActive || usable)) record.usable = true;
      if (afterActive && !usable) {
        const stack = sorted(next.active).reverse();
        for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
          const blocker = stack.find(id => {
            const binding = byId.get(id)?.bindings[keyIndex];
            return binding && behaviorName(binding) !== 'trans';
          });
          if (blocker > op.target) record.coveredBy.add(blocker);
        }
      }
      // Associate an activation with later release states, but never promote
      // toggling base 0 into a route back to base.
      if (afterActive && changed && op.target !== 0) {
        if (!next.causes.has(op.target)) next.causes.set(op.target, new Set());
        next.causes.get(op.target).add(transition.id);
      }
      operationsSummary.push({ targetLayer: op.target, kind: op.kind, effect: afterActive ? 'activate' : 'deactivate' });
    }
    const token = `${source.via}:${source.keyIndex ?? source.comboName}:${operations.map(op => op.transition.id).join('+')}`;
    if (releases.length) {
      const occupiedPositions = releases.every(release => release.kind === 'sticky') ? [] : source.positions;
      // A sticky key can be released while its layer awaits consumption/expiry.
      // Repeating that key refreshes the same pending state rather than adding
      // multiple physical holds for a single position.
      next.held = next.held.filter(held => held.token !== token);
      next.held.push({ token, releases, ...source, positions: occupiedPositions });
    }
    const last = operations.at(-1);
    const afterTop = top(next);
    const step = {
      from: beforeTop, to: next.active.has(last.target) && visible(next).has(last.target) ? last.target : afterTop,
      declaredFrom: source.from, targetLayer: last.target,
      kind: last.kind, via: source.via, raw: source.raw, line: source.line,
      ...(source.keyIndex !== undefined ? { keyIndex: source.keyIndex } : {}),
      ...(source.comboName ? { comboName: source.comboName, positions: source.positions } : {}),
      activeLayers: sorted(next.active),
      ...(operations.length > 1 ? { operations: operationsSummary } : {}),
      ...(last.tapCount ? { tapCount: last.tapCount } : {}),
      ...(last.trigger ? { trigger: last.trigger } : {}),
    };
    if (last.kind === 'toggle' && state.active.has(last.target) && !next.active.has(last.target) && beforeTop !== afterTop) {
      returnTransitions.set(`toggle:${beforeTop}:${afterTop}:${source.via}:${source.keyIndex ?? source.comboName}`, {
        ...step, to: afterTop, effect: 'deactivate', derived: true, reachable: true, blocked: false,
      });
    }
    enqueue(next, [...path, step]);
  }

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { state, path } = queue[cursor];
    const occupied = new Set(state.held.flatMap(held => held.positions));
    const stack = sorted(state.active).reverse();
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
      if (occupied.has(keyIndex)) continue;
      const sourceLayer = stack.find(id => {
        const binding = byId.get(id)?.bindings[keyIndex];
        return binding && behaviorName(binding) !== 'trans';
      });
      if (sourceLayer === undefined) continue;
      for (const operations of keyOptions.get(`${sourceLayer}:${keyIndex}`) || []) {
        const binding = byId.get(sourceLayer).bindings[keyIndex];
        press(state, path, operations, { from: sourceLayer, via: 'key', keyIndex, positions: [keyIndex], raw: binding.raw, line: binding.line });
      }
    }
    for (const [comboIndex, combo] of (model.combos || []).entries()) {
      if (!combo.positions?.length || combo.positions.some(index => occupied.has(index))) continue;
      for (const operations of comboOptions.get(`${comboIndex}:${top(state)}`) || []) {
        press(state, path, operations, { from: top(state), via: 'combo', comboName: combo.name, positions: combo.positions, raw: combo.bindings[0]?.raw, line: combo.line });
      }
    }
    for (const held of state.held) {
      const next = clone(state);
      next.held = next.held.filter(item => item !== held);
      for (const release of held.releases) {
        if (release.target !== 0 && !next.locked.has(release.target)) next.active.delete(release.target);
      }
      normalize(next);
      const step = {
        from: top(state), to: top(next), kind: held.releases.some(release => release.kind === 'sticky') ? 'expire' : 'release',
        via: 'release', raw: held.raw, line: held.line,
        ...(held.keyIndex !== undefined ? { keyIndex: held.keyIndex } : {}),
        ...(held.comboName ? { comboName: held.comboName, positions: held.positions } : {}),
        activeLayers: sorted(next.active),
      };
      if (step.from !== step.to) returnTransitions.set(`${step.from}:${step.to}:${held.token}`, { ...step, derived: true, reachable: true, blocked: false });
      enqueue(next, [...path, step]);
    }
  }

  for (const transition of transitions) {
    const record = observed.get(transition.id);
    transition.effects = [...record.effects];
    if (transition.kind === 'toggle' && transition.to === 0) {
      transition.blocked = true;
      transition.reason = 'レイヤー0は常時有効です。&tog 0 は高位レイヤーを解除せず、通常配列へ戻れません。';
      warn('toggle-base-no-return', `L${transition.from} の ${transition.raw}: ${transition.reason}`, transition.line);
    } else if (transition.reachable && !record.usable && record.coveredBy.size) {
      transition.blocked = true;
      transition.reason = `L${transition.to} は有効になりますが、上位の ${sorted(record.coveredBy).map(id => `L${id}`).join(' / ')} が非透過のため、その設定を使用できません。`;
      warn('layer-shadowed', `L${transition.from} → L${transition.to}: ${transition.reason}`, transition.line);
    } else if (transition.reachable && record.noEffect) {
      transition.reason = '到達した状態ではレイヤー状態が変化しません。';
    } else if (!transition.reachable) {
      transition.reason = '起動状態から、この割り当てを操作できる経路は見つかっていません。';
    }
  }
  const unreachableLayers = sorted(layerIds).filter(id => !reachable.has(id));
  for (const id of unreachableLayers) {
    warn('layer-unreachable', `L${id} (${byId.get(id).name}) は起動状態から設定を使用できる経路が見つかっていません。`, byId.get(id).line);
  }
  if (truncated) warn('state-search-limit', `${maxStates} 状態で探索を打ち切りました。未到達レイヤーが実際には利用できる可能性があります。`);
  return {
    transitions: [...transitions, ...returnTransitions.values()],
    reachableLayers: sorted(reachable), unreachableLayers,
    declaredActiveLayers: sorted(activated), paths, warnings,
    stateCount: queue.length, complete: !truncated && !warnings.some(warning => /unresolved|unknown|recursive|cycle|invalid/.test(warning.code)),
    assumptions: [
      '起動時はレイヤー0。複数の有効レイヤーを番号の大きい順に参照し、&trans だけ下位へ透過します。',
      '標準の hold / toggle / to / sticky、コンボ、条件レイヤーから押下・解放の状態を探索します。',
      '長押しや連打が成立するタイミングを仮定した静的解析です。実機の入力判定、コンボ競合、Studioで保存した変更は再現しません。',
      'Sticky layerの消費・タイムアウトは解除操作へ簡略化し、toggle / to のロック動作は現在のZMK標準を前提とします。',
      '大西雷神の補助入口は、子音をすべて離してからBackspaceを保持する経路を解析します。母音化や可変Spaceの文字状態はこの図の対象外です。',
    ],
    sources: [
      { title: 'ZMK: Layers', url: 'https://zmk.dev/docs/keymaps/behaviors/layers' },
      { title: 'ZMK: Conditional Layers', url: 'https://zmk.dev/docs/keymaps/conditional-layers' },
      { title: 'ZMK: Combos', url: 'https://zmk.dev/docs/keymaps/combos' },
    ],
  };
}
