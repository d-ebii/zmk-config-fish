import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { readModel } from './parse.mjs';
import { analyzeModel } from './analyze.mjs';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Unknown behaviors can still be inspected as raw bindings. Structural errors
// cannot: rendering a partial parse would replace the last trustworthy view.
const fatalWarningCodes = new Set([
  'UNTERMINATED_STRING', 'UNBALANCED_EXPRESSION', 'UNEXPECTED_CLOSE',
  'UNSUPPORTED_SYNTAX', 'UNSUPPORTED_DELETE', 'INCOMPLETE_DECLARATION',
  'UNCLOSED_NODE', 'MISSING_SEMICOLON', 'DUPLICATE_PROPERTY',
  'MISSING_KEYMAP', 'MULTIPLE_KEYMAPS', 'MISSING_BINDINGS',
  'UNSUPPORTED_BINDING', 'BINDING_ARITY', 'LAYER_BINDING_COUNT',
  'UNRESOLVED_NUMBER', 'UNSUPPORTED_PREPROCESSOR',
  'COMBO_POSITION_COUNT', 'COMBO_BINDING_COUNT',
  'COMBO_POSITION_RANGE', 'COMBO_LAYER_RANGE',
]);

function validateModel(model) {
  const errors = [];
  if (!model.layers.length) errors.push('レイヤーがありません。');
  if (!model.layout.length) errors.push('物理キーの配置が空です。');
  errors.push(...model.warnings.filter(warning => fatalWarningCodes.has(warning.code))
    .map(warning => `${warning.line ? `${warning.line}行: ` : ''}${warning.message}`));
  for (const layer of model.layers) {
    if (layer.bindings.length !== model.layout.length && !model.warnings.some(warning => warning.code === 'LAYER_BINDING_COUNT' && warning.line === layer.line)) {
      errors.push(`${layer.name}: 配置とbindingの個数が一致しません。`);
    }
  }
  if (errors.length) throw new Error(`設定を確定できないためHTMLを更新しません。\n${errors.slice(0, 8).map(message => `- ${message}`).join('\n')}${errors.length > 8 ? '\n- ほかにも解析エラーがあります。' : ''}`);
}

export function buildHtml(root = repoRoot) {
  const model = readModel(root);
  validateModel(model);
  model.routing = analyzeModel(model);
  const assets = ['template.html', 'style.css', 'viewer.js'].map(name => readFileSync(join(root, 'tools/keymap-viewer', name), 'utf8'));
  const revision = createHash('sha256').update(JSON.stringify(model)).update(assets.join('\0')).digest('hex').slice(0, 16);
  const data = JSON.stringify({ ...model, revision }).replace(/</g, '\\u003c');
  const html = assets[0].replace('/*__STYLE__*/', () => assets[1]).replace('/*__MODEL__*/', () => data).replace('/*__SCRIPT__*/', () => assets[2]);
  return { html, model, revision };
}
export function writeViewer(root = repoRoot) {
  const result = buildHtml(root);
  mkdirSync(join(root, 'docs/keymap'), { recursive: true });
  writeFileSync(join(root, 'docs/keymap/index.html'), result.html, 'utf8');
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { check: { type: 'boolean' }, root: { type: 'string' } } });
    const root = resolve(values.root || repoRoot);
    if (values.check) {
      const expected = buildHtml(root).html;
      let actual = '';
      try { actual = readFileSync(join(root, 'docs/keymap/index.html'), 'utf8'); } catch {}
      if (expected !== actual) throw new Error('HTMLが最新ではありません。npm run keymap:build を実行してください。');
      console.log('確認完了: HTMLは現在の設定と一致しています。');
    } else {
      const { model, revision } = writeViewer(root);
      console.log(`生成完了: docs/keymap/index.html / ${model.layers.length} layers / ${model.layout.length} keys / ${revision}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
