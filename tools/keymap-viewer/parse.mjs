import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// This is a deliberately bounded DTS reader, not a C preprocessor or dtc.
// Unsupported constructs remain visible in warnings instead of being guessed.
const builtinCells = new Map(Object.entries({
  kp: 1, mt: 2, lt: 2, mo: 1, to: 1, tog: 1, sl: 1, sk: 1,
  none: 0, trans: 0, bootloader: 0, reset: 0, sys_reset: 0,
  studio_unlock: 0, caps_word: 0, key_repeat: 0, out: 1,
  ext_power: 1, rgb_ug: 1, bl: 1, soft_off: 0, bt: [1, 2],
  mkp: 1, mmv: 1, msc: 1, inc_dec_kp: 2,
  macro_tap: 0, macro_press: 0, macro_release: 0,
  macro_wait_time: 1, macro_tap_time: 1, macro_pause_for_release: 0,
  macro_param_1to1: 0, macro_param_1to2: 0,
  macro_param_2to1: 0, macro_param_2to2: 0,
}));

function warn(warnings, code, message, line) {
  warnings.push({ code, message, ...(line ? { line } : {}) });
}

function blank(text) { return text.replace(/[^\r\n]/g, ' '); }

function prepare(source, warnings) {
  // Preserve offsets and newlines so every binding can link back to its source.
  const uncommented = source.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    value => value.startsWith('"') ? value : blank(value));
  const defines = new Map();
  let line = 0;
  const text = uncommented.split(/(?<=\n)/).map(chunk => {
    line += 1;
    // DTS properties such as #binding-cells are not preprocessor directives.
    const directive = chunk.match(/^\s*#([A-Za-z_]\w*)(?=\s|$)([^\r\n]*)/);
    if (!directive) return chunk;
    const [, command, rest] = directive;
    if (command === 'define') {
      const simple = rest.trim().match(/^([A-Za-z_]\w*)\s+(.+)$/);
      const number = simple ? numeric(simple[2], defines) : null;
      if (simple && number !== null) defines.set(simple[1], number);
      else warn(warnings, 'UNSUPPORTED_DEFINE', `数値以外の #define は展開していません: ${rest.trim()}`, line);
    } else if (command === 'include') {
      // These headers provide the documented built-ins and symbolic keycodes.
      if (!/^\s*<(?:behaviors|physical_layouts)\.dtsi>\s*$/.test(rest)
        && !/^\s*<dt-bindings\/zmk\/[\w/-]+\.h>\s*$/.test(rest)) {
        warn(warnings, 'INCLUDE_NOT_EXPANDED', `外部ファイルの #include は展開していません: ${rest.trim()}`, line);
      }
    } else {
      warn(warnings, 'UNSUPPORTED_PREPROCESSOR', `#${command} は評価していません。条件分岐内の結果は確定できません。`, line);
    }
    return blank(chunk);
  }).join('');
  return { text, defines };
}

function numeric(value, defines = new Map()) {
  let text = String(value).trim();
  while (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim();
  if (defines.has(text)) return defines.get(text);
  if (/^[+-]?(?:0x[\da-f]+|\d+)(?:[uUlL]+)?$/i.test(text)) {
    const suffixFree = text.replace(/[uUlL]+$/, '');
    const sign = suffixFree.startsWith('-') ? -1 : 1;
    return sign * Number(suffixFree.replace(/^[+-]/, ''));
  }
  return null;
}

function tokenize(text, warnings) {
  const result = [];
  let pos = 0;
  let line = 1;
  while (pos < text.length) {
    const start = pos;
    const startLine = line;
    if (/\s/.test(text[pos])) {
      if (text[pos] === '\n') line += 1;
      pos += 1;
      continue;
    }
    if ('{};=<>:,[]'.includes(text[pos])) pos += 1;
    else if (text[pos] === '"') {
      pos += 1;
      while (pos < text.length && text[pos] !== '"') {
        if (text[pos] === '\\') pos += 1;
        if (text[pos] === '\n') line += 1;
        pos += 1;
      }
      if (pos === text.length) warn(warnings, 'UNTERMINATED_STRING', '閉じられていない文字列があります。', startLine);
      else pos += 1;
    } else {
      // A complete parenthesized keycode expression is a single cell. Do not
      // infer binding boundaries from argument counts: the next & starts one.
      let depth = 0;
      while (pos < text.length) {
        const char = text[pos];
        if (depth === 0 && (/\s/.test(char) || '{};=<>:,[]'.includes(char))) break;
        if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
        if (char === '\n') line += 1;
        pos += 1;
      }
      if (depth !== 0) warn(warnings, 'UNBALANCED_EXPRESSION', '括弧の対応が取れない式があります。', startLine);
    }
    result.push({ value: text.slice(start, pos), start, end: pos, line: startLine });
  }
  return result;
}

function readDts(source) {
  const warnings = [];
  const { text, defines } = prepare(source, warnings);
  const tokens = tokenize(text, warnings);
  let cursor = 0;
  function scope(isChild = false) {
    const nodes = [];
    const props = new Map();
    while (cursor < tokens.length) {
      if (tokens[cursor].value === '}') {
        cursor += 1;
        if (!isChild) warn(warnings, 'UNEXPECTED_CLOSE', '対応する開始ノードがない閉じ括弧です。', tokens[cursor - 1].line);
        return { nodes, props };
      }
      if (tokens[cursor].value === ';') { cursor += 1; continue; }
      const head = [];
      while (cursor < tokens.length && !['{', '=', ';', '}'].includes(tokens[cursor].value)) head.push(tokens[cursor++]);
      const kind = tokens[cursor]?.value;
      if (!head.length) {
        warn(warnings, 'UNSUPPORTED_SYNTAX', `解釈できない構文: ${tokens[cursor]?.value ?? 'EOF'}`, tokens[cursor]?.line);
        cursor += 1;
        continue;
      }
      if (kind === '{') {
        cursor += 1;
        const labelIndex = head.findIndex(token => token.value === ':');
        const name = head.slice(labelIndex + 1).map(token => token.value).join('');
        const label = labelIndex >= 0 ? head.slice(0, labelIndex).map(token => token.value).join('') : null;
        if (head.some(token => token.value.startsWith('/delete-'))) warn(warnings, 'UNSUPPORTED_DELETE', 'DTSの削除ディレクティブは適用していません。', head[0].line);
        nodes.push({ name, label, line: head[0].line, ...scope(true) });
      } else if (kind === '=') {
        cursor += 1;
        const value = [];
        while (cursor < tokens.length && ![';', '}'].includes(tokens[cursor].value)) value.push(tokens[cursor++]);
        const name = head.map(token => token.value).join('');
        if (props.has(name)) warn(warnings, 'DUPLICATE_PROPERTY', `${name} が同一ノードで重複しています。`, head[0].line);
        if (value.some(token => ['[', ']', '/bits/'].includes(token.value))) {
          warn(warnings, 'UNSUPPORTED_VALUE', `${name} のバイト配列または /bits/ 指定は解釈していません。`, head[0].line);
        }
        props.set(name, { tokens: value, line: head[0].line });
        if (tokens[cursor]?.value === ';') cursor += 1;
        else warn(warnings, 'MISSING_SEMICOLON', `${name} の終端セミコロンがありません。`, head[0].line);
      } else if (kind === ';') {
        cursor += 1;
        const name = head.map(token => token.value).join('');
        props.set(name, { tokens: [], line: head[0].line });
        if (head.length !== 1) warn(warnings, 'UNSUPPORTED_SYNTAX', `解釈できない宣言: ${head.map(token => token.value).join(' ')}`, head[0].line);
      } else {
        warn(warnings, 'INCOMPLETE_DECLARATION', `未完了の宣言: ${head.map(token => token.value).join(' ')}`, head[0].line);
        if (kind === '}') continue;
      }
    }
    if (isChild) warn(warnings, 'UNCLOSED_NODE', '閉じられていないDTSノードがあります。');
    return { nodes, props };
  }
  return { ...scope(), source, text, defines, warnings };
}

function walk(nodes) { return nodes.flatMap(node => [node, ...walk(node.nodes)]); }

function cells(prop, ast) {
  return (prop?.tokens ?? []).filter(token => !['<', '>', ','].includes(token.value)).map(token => {
    const number = numeric(token.value, ast.defines);
    if (number !== null) return number;
    if (token.value.startsWith('"')) {
      try { return JSON.parse(token.value); } catch { return token.value.slice(1, -1); }
    }
    return token.value;
  });
}

function properties(node, ast) {
  return Object.fromEntries([...node.props].map(([name, prop]) => {
    if (!prop.tokens.length) return [name, true];
    const values = cells(prop, ast);
    return [name, values.length === 1 ? values[0] : values];
  }));
}

function bindings(prop, ast) {
  if (!prop) return [];
  const result = [];
  let current = null;
  function finish() {
    if (!current) return;
    result.push({ behavior: current.behavior, args: current.args,
      raw: ast.source.slice(current.start, current.end).trim(), line: current.line });
  }
  for (const token of prop.tokens) {
    if (['<', '>', ','].includes(token.value)) continue;
    if (/^&[\w-]+$/.test(token.value)) {
      finish();
      current = { behavior: token.value.slice(1), args: [], line: token.line, start: token.start, end: token.end };
    } else if (current) {
      current.args.push(String(ast.defines.has(token.value) ? ast.defines.get(token.value) : token.value));
      current.end = token.end;
    } else {
      warn(ast.warnings, 'UNSUPPORTED_BINDING', `&behavior で始まらないbinding: ${token.value}`, token.line);
    }
  }
  finish();
  return result;
}

function integers(prop, ast, label) {
  const values = cells(prop, ast);
  if (values.some(value => !Number.isInteger(value))) {
    warn(ast.warnings, 'UNRESOLVED_NUMBER', `${label} に未解決の数値があります: ${values.join(' ')}`, prop?.line);
  }
  return values.filter(Number.isInteger);
}

export function parseKeymap(text) {
  const ast = readDts(text);
  const nodes = walk(ast.nodes);
  const keymapNodes = nodes.filter(node => properties(node, ast).compatible === 'zmk,keymap' || node.name === 'keymap');
  if (!keymapNodes.length) warn(ast.warnings, 'MISSING_KEYMAP', 'keymapノードが見つかりません。');
  if (keymapNodes.length > 1) warn(ast.warnings, 'MULTIPLE_KEYMAPS', '複数のkeymapノードがあります。DTSオーバーレイのマージは未対応です。');
  const layers = keymapNodes.flatMap(node => node.nodes).map((node, id) => {
    const props = properties(node, ast);
    if (!node.props.has('bindings')) warn(ast.warnings, 'MISSING_BINDINGS', `${node.name} にbindingsがありません。`, node.line);
    return { id, name: node.name, displayName: props['display-name'] ?? props.label ?? node.name,
      bindings: bindings(node.props.get('bindings'), ast), line: node.line };
  });
  const behaviors = nodes.filter(node => {
    const compatible = properties(node, ast).compatible;
    return typeof compatible === 'string' && compatible.startsWith('zmk,behavior-');
  }).map(node => {
    const props = properties(node, ast);
    return { name: node.label ?? node.name, compatible: props.compatible, properties: props,
      bindings: bindings(node.props.get('bindings'), ast), line: node.line };
  });
  const overrides = nodes.filter(node => node.name.startsWith('&')).map(node => ({
    name: node.name.slice(1), properties: properties(node, ast), line: node.line,
    ...(node.props.has('bindings') ? { bindings: bindings(node.props.get('bindings'), ast) } : {}),
  }));
  for (const override of overrides) {
    if (!builtinCells.has(override.name)) warn(ast.warnings, 'UNMERGED_OVERLAY', `&${override.name} のオーバーレイは定義とマージしていません。`, override.line);
  }
  const combos = nodes.filter(node => properties(node, ast).compatible === 'zmk,combos' || node.name === 'combos').flatMap(parent => {
    for (const name of ['timeout-ms', 'require-prior-idle-ms']) {
      if (parent.props.has(name)) warn(ast.warnings, 'COMBO_PARENT_PROPERTY', `combos親ノードの ${name} は各コンボには適用されません。各コンボ内で設定が必要です。`, parent.props.get(name).line);
    }
    return parent.nodes.map(node => {
      const props = properties(node, ast);
      return { name: node.name, positions: integers(node.props.get('key-positions'), ast, 'key-positions'),
        layers: node.props.has('layers') ? integers(node.props.get('layers'), ast, 'layers') : null,
        bindings: bindings(node.props.get('bindings'), ast), properties: props,
        timeoutMs: props['timeout-ms'] ?? 50, priorIdleMs: props['require-prior-idle-ms'] ?? -1, line: node.line };
    });
  });
  const conditionalLayers = nodes.filter(node => properties(node, ast).compatible === 'zmk,conditional-layers' || node.name === 'conditional_layers').flatMap(parent => parent.nodes.map(node => ({
    ifLayers: integers(node.props.get('if-layers'), ast, 'if-layers'),
    thenLayer: integers(node.props.get('then-layer'), ast, 'then-layer')[0] ?? null,
  })));
  const known = new Map(builtinCells);
  for (const behavior of behaviors) {
    const count = behavior.properties['#binding-cells'];
    if (!Number.isInteger(count) || count < 0) warn(ast.warnings, 'UNKNOWN_BINDING_CELLS', `&${behavior.name} の #binding-cells が未指定または未解決です。`, behavior.line);
    known.set(behavior.name, count);
  }
  const bindingUses = [...layers, ...behaviors, ...combos, ...overrides].flatMap(node =>
    (node.bindings ?? []).map(binding => ({ binding, parameterized: [
      'zmk,behavior-hold-tap', 'zmk,behavior-sticky-key', 'zmk,behavior-sensor-rotate',
    ].includes(node.compatible) })));
  for (const { binding, parameterized } of bindingUses) {
    if (!known.has(binding.behavior)) {
      warn(ast.warnings, 'UNKNOWN_BEHAVIOR', `未定義または未対応のbehavior: &${binding.behavior}（生のbindingを表示します）`, binding.line);
      continue;
    }
    const expected = known.get(binding.behavior);
    const allowed = Array.isArray(expected) ? expected : [expected];
    // Wrapper definitions supply parameters when invoked (e.g. hold-tap's
    // bindings = <&mo>, <&kp>); these are not direct key invocations.
    if (!parameterized && allowed.every(Number.isInteger) && !allowed.includes(binding.args.length)) {
      warn(ast.warnings, 'BINDING_ARITY', `&${binding.behavior} の引数は ${allowed.join(' または ')} 個ですが ${binding.args.length} 個あります。`, binding.line);
    }
  }
  return { layers, behaviors, overrides, combos, conditionalLayers, warnings: ast.warnings };
}

export function parseLayout(text) {
  const ast = readDts(text);
  const layouts = walk(ast.nodes).filter(node => properties(node, ast).compatible === 'zmk,physical-layout');
  if (layouts.length !== 1) throw new Error(`物理配置は1個必要です（${layouts.length}個）。`);
  const entries = bindings(layouts[0].props.get('keys'), ast);
  if (ast.warnings.length) throw new Error(`物理配置を確定できません: ${ast.warnings.map(item => item.message).join(' / ')}`);
  return entries.map((binding, index) => {
    const values = binding.args.map(value => numeric(value, ast.defines));
    if (binding.behavior !== 'key_physical_attrs' || values.length !== 7 || values.some(value => value === null)) {
      throw new Error(`物理キー ${index} の座標は7個の数値で指定してください。`);
    }
    const [width, height, x, y, rotation, rx, ry] = values;
    return { index, x, y, width, height, rotation: rotation / 100, rx, ry };
  });
}

export function parseSettings(text) {
  const settings = [];
  const conditions = [];
  let key = null;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    const assignment = line.match(/^(CONFIG_\w+)\s*=\s*("(?:\\.|[^"\\])*"|[^#]*)(?:\s*#.*)?$/);
    const disabled = line.match(/^#\s*(CONFIG_\w+)\s+is not set$/);
    if (assignment) settings.push({ key: assignment[1], value: settingValue(assignment[2].trim()), line: index + 1 });
    else if (disabled) settings.push({ key: disabled[1], value: 'n', line: index + 1 });
    else if (/^if\s/.test(line)) conditions.push(line.slice(3));
    else if (line === 'endif') { conditions.pop(); key = null; }
    else if (/^(?:menu)?config\s/.test(line)) key = `CONFIG_${line.replace(/^(?:menu)?config\s+/, '')}`;
    else if (key && /^default\s/.test(line)) {
      const match = line.match(/^default\s+("(?:\\.|[^"\\])*"|\S+)(?:\s+if\s+(.+))?/);
      if (match) settings.push({ key, value: settingValue(match[1]), line: index + 1,
        condition: [...conditions, ...(match[2] ? [match[2]] : [])].join(' && ') || null, kind: 'default' });
    }
  }
  return settings;
}

function settingValue(text) {
  if (text.startsWith('"')) { try { return JSON.parse(text); } catch { return text; } }
  return numeric(text) ?? text;
}

export function readModel(root) {
  const directory = 'config/boards/shields/fish';
  const paths = ['fish.keymap', 'fish-layouts.dtsi', 'fish.conf', 'Kconfig.defconfig'].map(file => `${directory}/${file}`);
  const inputs = paths.map(path => ({ path, text: readFileSync(join(root, path), 'utf8') }));
  const model = parseKeymap(inputs[0].text);
  const layout = parseLayout(inputs[1].text);
  const settings = inputs.slice(2).flatMap(input => parseSettings(input.text).map(setting => ({ ...setting, source: input.path })));
  for (const layer of model.layers) {
    if (layer.bindings.length !== layout.length) warn(model.warnings, 'LAYER_BINDING_COUNT', `${layer.name}: 配置 ${layout.length} キーに対して ${layer.bindings.length} 個のbindingがあります。`, layer.line);
  }
  for (const combo of model.combos) {
    if (combo.positions.length < 2) warn(model.warnings, 'COMBO_POSITION_COUNT', `${combo.name} のキー番号が2個未満です。`, combo.line);
    if (combo.bindings.length !== 1) warn(model.warnings, 'COMBO_BINDING_COUNT', `${combo.name} のbindingsは1個必要です。`, combo.line);
    if (combo.positions.some(position => position < 0 || position >= layout.length)) warn(model.warnings, 'COMBO_POSITION_RANGE', `${combo.name} のキー番号が配置の範囲外です。`, combo.line);
    if (combo.layers?.some(layer => layer < 0 || layer >= model.layers.length)) warn(model.warnings, 'COMBO_LAYER_RANGE', `${combo.name} のレイヤー番号が範囲外です。`, combo.line);
  }
  const hash = createHash('sha256');
  for (const input of inputs) hash.update(`${input.path}\0${input.text}\0`);
  return { source: { path: paths[0], hash: hash.digest('hex').slice(0, 12) },
    sources: inputs.map(input => input.path), layout, ...model, settings };
}
