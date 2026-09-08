(() => {
  'use strict';
  const model = JSON.parse(document.getElementById('keymap-data').textContent);
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const reachable = new Set(model.routing.reachableLayers);
  const layerById = id => model.layers.find(layer => layer.id === Number(id));
  const layerName = layer => layer.displayName || layer.name.replace(/^layer_/, '');
  const empty = layer => layer.bindings.every(binding => binding.behavior === 'none');
  const aliases = { RET:'Enter', ENTER:'Enter', SPACE:'Space', BSPC:'Backspace', BACKSPACE:'Backspace', DEL:'Delete', DELETE:'Delete', ESC:'Esc', TAB:'Tab', MINUS:'−', EQUAL:'=', COMMA:',', DOT:'.', PERIOD:'.', SLASH:'/', SEMI:';', SQT:"'", BSLH:'\\', LBKT:'[', RBKT:']', GRAVE:'`', LGUI:'L Gui', RGUI:'R Gui', LALT:'L Alt', RALT:'R Alt', LSHFT:'L Shift', RSHFT:'R Shift', LCTRL:'L Ctrl', RCTRL:'R Ctrl', LEFT:'←', LEFT_ARROW:'←', RIGHT:'→', RIGHT_ARROW:'→', UP:'↑', UP_ARROW:'↑', DOWN:'↓', DOWN_ARROW:'↓', PG_UP:'PgUp', PG_DN:'PgDn', HOME:'Home', END:'End', LANG1:'かな', LANG2:'英数', LC:'Ctrl', RC:'Ctrl', LS:'Shift', RS:'Shift', LA:'Alt', RA:'Alt', LG:'Gui', RG:'Gui', C_VOL_UP:'Vol +', C_VOL_DN:'Vol −', C_MUTE:'Mute', C_PP:'Play', C_NEXT:'Next', C_PREV:'Prev', EXCL:'!', AT:'@', HASH:'#', DLLR:'$', PRCNT:'%', CARET:'^', AMPS:'&', STAR:'*', LPAR:'(', RPAR:')', UNDER:'_', PLUS:'+', COLON:':', DQT:'"', QMARK:'?', LT:'<', GT:'>', PIPE:'|', TILDE:'~', LBRC:'{', RBRC:'}' };
  function codeLabel(value) {
    value = String(value ?? '');
    const wrapped = value.match(/^([A-Z_]+)\((.*)\)$/);
    if (wrapped) return `${aliases[wrapped[1]] || wrapped[1]}+${codeLabel(wrapped[2])}`;
    return aliases[value] || (/^N[0-9]$/.test(value) ? value.slice(1) : value);
  }
  function describe(binding) {
    if (!binding) return { main:'?', sub:'未設定', action:'bindingがありません' };
    const [a, b] = binding.args;
    const custom = model.behaviors.find(item=>item.name===binding.behavior);
    if(custom?.compatible==='zmk,behavior-onishi-raijin') {
      const aux = custom.properties['auxiliary-layer'];
      switch(Number(a)) {
        case 0: return {main:'Space',sub:'母音 / 可変',tap:'単独タップはSpace',hold:'先に保持すると母音。子音保持中は指別の母音'};
        case 1: return {main:'Backspace',sub:`U / Hold L${aux}`,tap:'単独タップはBackspace。子音保持中はU',hold:`子音がなければL${aux}へ（${custom.properties['tapping-term-ms']}ms または次の右文字キー）`,target:Number(aux)};
        case 2: return {main:codeLabel(b)||'—',action:`${codeLabel(b)} を1回送る`};
        case 3: return {main:codeLabel(b)+codeLabel(b),action:`${codeLabel(b)} を2回送る（ん）`};
        default: return {main:codeLabel(a),sub:`親指 → ${codeLabel(b)}`,tap:`${codeLabel(a)} を1回送る`,hold:`次のキーを母音化。Spaceなら ${codeLabel(b)}、Backspaceなら U`};
      }
    }
    switch (binding.behavior) {
      case 'kp': return { main:codeLabel(a), action:codeLabel(a) };
      case 'mt': return { main:codeLabel(b), sub:codeLabel(a), tap:codeLabel(b), hold:codeLabel(a) };
      case 'lt': return { main:codeLabel(b), sub:`Hold → L${a}`, tap:codeLabel(b), hold:`L${a} を押している間だけ有効`, target:Number(a) };
      case 'mo': return { main:`L${a}`, sub:'Hold', hold:`L${a} を押している間だけ有効`, target:Number(a) };
      case 'to': return { main:`L${a}`, sub:'Switch', action:`L${a} へ切替（他の層を解除）`, target:Number(a) };
      case 'tog': return { main:`L${a}`, sub:'Toggle', action:`L${a} の有効 / 無効を反転`, target:Number(a) };
      case 'sl': return { main:`L${a}`, sub:'Sticky', action:`L${a} を次の入力まで有効`, target:Number(a) };
      case 'none': return { main:'—', action:'入力なし。下のレイヤーにも渡しません。' };
      case 'trans': return { main:'▽', action:'下位の有効レイヤーの割り当てを使います。' };
      case 'bt': return { main:a === 'BT_SEL' ? `BT ${b}` : a?.replace('BT_', 'BT '), action:binding.raw };
      case 'bootloader': return { main:'Boot', action:'ブートローダーへ移行' };
      case 'sys_reset': return { main:'Reset', action:'キーボードを再起動' };
      case 'studio_unlock': return { main:'Unlock', action:'ZMK Studioをアンロック' };
      default: return { main:binding.behavior.replace(/^macro_/, ''), sub:binding.args.map(codeLabel).join(' '), action:binding.raw };
    }
  }
  let selectedLayer = 0, selectedKey = 28, selectedCombo = 0, tab = 'layout';
  const warnings = [...model.warnings, ...model.routing.warnings];
  function setLocation(nextTab = tab, nextLayer = selectedLayer) { location.hash = `${nextTab}-${nextLayer}`; }
  function readLocation() {
    const match = location.hash.match(/^#(layout|routes|combos|settings)-(\d+)$/);
    if (match) { tab = match[1]; selectedLayer = layerById(match[2]) ? Number(match[2]) : 0; }
    render();
  }
  function svgKeyboard(layer, highlight = [], comboMode = false) {
    const corners = model.layout.flatMap(key => [[key.x,key.y],[key.x+key.width,key.y],[key.x,key.y+key.height],[key.x+key.width,key.y+key.height]].map(([x,y]) => {
      const a = key.rotation * Math.PI / 180;
      return [key.rx + (x-key.rx)*Math.cos(a) - (y-key.ry)*Math.sin(a), key.ry + (x-key.rx)*Math.sin(a) + (y-key.ry)*Math.cos(a)];
    }));
    const minX = Math.min(...corners.map(p=>p[0]))-12, minY = Math.min(...corners.map(p=>p[1]))-12;
    const width = Math.max(...corners.map(p=>p[0]))-minX+12, height = Math.max(...corners.map(p=>p[1]))-minY+18;
    return `<svg viewBox="${minX} ${minY} ${width} ${height}" role="group" aria-label="${esc(layerName(layer))}の物理配置">${model.layout.map(key => {
      const binding = layer.bindings[key.index], label = describe(binding);
      const cls = ['key',label.sub?'hold-key':'',binding?.behavior==='none'?'empty-key':'',highlight.includes(key.index)?'highlight':'',!comboMode&&selectedKey===key.index?'selected':''].join(' ');
      const fontSize = label.main.length > 10 ? 12 : label.main.length > 7 ? 14 : label.main.length > 4 ? 17 : 23;
      return `<g class="${cls}" data-key="${key.index}" transform="rotate(${key.rotation} ${key.rx} ${key.ry})" role="button" tabindex="0" aria-label="キー${key.index}: ${esc(binding?.raw)}"><title>${esc(binding?.raw)}</title><rect x="${key.x+5}" y="${key.y+5}" width="${key.width-10}" height="${key.height-10}" rx="11"/><text class="key-number" x="${key.x+13}" y="${key.y+21}" ${!$('#show-positions').checked&&!comboMode?'visibility="hidden"':''}>${key.index}</text><text class="main-label" x="${key.x+key.width/2}" y="${key.y+(label.sub?50:57)}" font-size="${fontSize}">${esc(label.main)}</text>${label.sub?`<text class="hold-label" x="${key.x+key.width/2}" y="${key.y+72}" ${label.sub.length>13?'style="font-size:9px"':''}>${esc(label.sub)}</text>`:''}</g>`;
    }).join('')}</svg>`;
  }
  function keyCaption(step) {
    if (step.via === 'combo') return `コンボ ${step.comboName} (#${step.positions?.join(' + #')})`;
    if (step.keyIndex === undefined) return step.raw || step.kind;
    const sourceLayer = layerById(step.declaredFrom ?? step.from);
    const binding = sourceLayer?.bindings[step.keyIndex];
    // Release steps refer to the original binding, even after changing layers.
    const rawTap = step.raw?.match(/^&lt\s+\S+\s+(\S+)/);
    const name = step.via === 'release' && rawTap ? codeLabel(rawTap[1]) : describe(binding).main;
    const base = describe(layerById(0)?.bindings[step.keyIndex]).main;
    return `${name}${binding && ['tog','to','mo','sl'].includes(binding.behavior) && base!==name ? ` / ${base}の位置` : ''} (#${step.keyIndex})`;
  }
  function operation(step) {
    const name = keyCaption(step);
    if (step.via === 'release') return `${name} を離す${step.kind==='expire'?' / 消費・期限切れ':''}`;
    const suffix = { hold:'を長押し', toggle:'を押して切替', to:'を押して移動', sticky:'を押す', conditional:'が成立' }[step.kind] || 'を操作';
    return `${name} ${suffix}${step.tapCount?`（${step.tapCount}連打）`:''}${step.trigger?`［${step.trigger}］`:''}`;
  }
  function pathHtml(id) {
    if (id === 0) return '<p class="muted">電源を入れると、このレイヤーから始まります。</p>';
    const path = model.routing.paths[id];
    if (!path) return `<p class="notice">${empty(layerById(id))?'全キーが無効の空きレイヤーです。':'起動状態から、この層の設定を使える経路が見つかりません。'}入口の割り当てを追加すると、ここに操作手順が表示されます。</p>`;
    return `<div class="path"><button class="layer-chip" data-layer="0">L0</button>${path.map(step => `<span class="path-op">→ ${esc(operation(step))} →</span><button class="layer-chip" data-layer="${step.to}">L${step.to}</button>`).join('')}</div><p class="muted">長押しは次の操作中も保持。${path.some(step=>step.kind==='to')?'「移動」で切り替えたら、一度すべて離してから入力します。':'離すと元の層へ戻ります。'}</p>`;
  }
  function renderKeyDetail() {
    const layer = layerById(selectedLayer), binding = layer.bindings[selectedKey], d = describe(binding);
    const custom = model.behaviors.find(item => item.name === binding?.behavior);
    const rows = [['タップ',d.tap],['長押し',d.hold],['動作',d.action]].filter(row=>row[1]);
    const expanded = custom?.bindings.length ? `<div class="code">${esc(custom.bindings.map(b=>b.raw).join(' → '))}</div>` : '';
    const combos = model.combos.filter(combo=>combo.positions.includes(selectedKey)).map(combo=>`<p class="muted">同時押し：${esc(combo.name)} (#${combo.positions.join(', #')})${combo.layers&&!combo.layers.includes(selectedLayer)?' · この層では無効':''}</p>`).join('');
    $('#key-detail').innerHTML = `<div class="detail-title"><h3>選択したキー</h3><span class="tiny">POSITION ${selectedKey}</span></div>${rows.map(([label,value])=>`<div class="detail-row"><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}<div class="code binding-source">${esc(binding?.raw || '未設定')}</div><p class="tiny">fish.keymap : ${binding?.line ?? '—'} 行</p>${d.target!==undefined?`<button class="action-link" data-layer="${d.target}">L${d.target} の配列を見る →</button>`:''}${custom?`<p class="muted">${esc(custom.compatible)}</p>${expanded}`:''}${combos}`;
  }
  function renderRoutes() {
    const ids = model.layers.map(layer=>layer.id), positions = new Map();
    const depthGroups = new Map();
    for (const id of ids.filter(id=>reachable.has(id))) {
      const depth = (model.routing.paths[id] || []).length;
      if (!depthGroups.has(depth)) depthGroups.set(depth, []);
      depthGroups.get(depth).push(id);
    }
    const maxDepth = Math.max(1,...depthGroups.keys());
    const graphWidth = Math.max(800, (maxDepth+1)*185);
    const topHeight = Math.max(230,...[...depthGroups.values()].map(ids=>ids.length*105+60));
    for (const [depth,group] of depthGroups) group.forEach((id,i)=>positions.set(id,{x:80+depth*(graphWidth-160)/maxDepth,y:(i+1)*topHeight/(group.length+1)}));
    const inaccessible = ids.filter(id=>!reachable.has(id));
    inaccessible.forEach((id,i)=>positions.set(id,{x:80+(i%5)*(graphWidth-160)/Math.max(1,Math.min(5,inaccessible.length)-1),y:topHeight+80+Math.floor(i/5)*85}));
    const graphHeight = topHeight + (inaccessible.length?Math.ceil(inaccessible.length/5)*85+50:20);
    const edges = model.routing.transitions.filter(step=>step.via!=='release');
    const unique = edges.filter((edge,i)=>edges.findIndex(other=>other.from===edge.from&&other.to===edge.to&&other.blocked===edge.blocked)===i);
    $('#route-map').innerHTML = `<svg viewBox="0 0 ${graphWidth} ${graphHeight}" role="group" aria-label="レイヤーの遷移図"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10Z" fill="#81b7a1"/></marker><marker id="arrow-blocked" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10Z" fill="#c57f43"/></marker></defs>${inaccessible.length?`<line x1="20" x2="${graphWidth-20}" y1="${topHeight+6}" y2="${topHeight+6}" stroke="#dce5dc"/><text x="25" y="${topHeight+30}" fill="#7d8d7e" font-size="10">設定を使える経路が見つからないレイヤー</text>`:''}${unique.map(edge=>{
      const a=positions.get(edge.from),b=positions.get(edge.to);if(!a||!b)return '';
      const curve=edge.to<=edge.from, x1=a.x+(curve?0:59), y1=a.y+(curve?-29:0), x2=b.x+(curve?0:-62),y2=b.y+(curve?-32:0);
      const d=curve?`M${x1} ${y1} C${x1} ${Math.min(y1,y2)-80} ${x2} ${Math.min(y1,y2)-80} ${x2} ${y2}`:`M${x1} ${y1} C${(x1+x2)/2} ${y1} ${(x1+x2)/2} ${y2} ${x2} ${y2}`;
      return `<path class="route-edge ${edge.blocked?'blocked':!edge.reachable?'unreachable':''}" d="${d}" marker-end="url(#${edge.blocked?'arrow-blocked':'arrow'})" data-edge-from="${edge.from}" role="button" tabindex="0" aria-label="L${edge.from}からL${edge.to}: ${esc(operation(edge))}"><title>${esc(operation(edge))}${edge.reason?' / '+esc(edge.reason):''}</title></path>`;
    }).join('')}${ids.map(id=>{const p=positions.get(id);return `<g class="route-node ${id===selectedLayer?'active':''} ${!reachable.has(id)?'unreachable':''}" data-layer="${id}" role="button" tabindex="0" aria-label="レイヤー${id}" transform="translate(${p.x} ${p.y})"><rect x="-59" y="-29" width="118" height="58" rx="11"/><text y="-2">L${id}</text><text class="node-name" y="16">${esc(layerName(layerById(id)).slice(0,18))}</text></g>`;}).join('')}</svg>`;
    const outgoing = model.routing.transitions.filter(step=>step.from===selectedLayer);
    $('#route-details').innerHTML = `<h3>L${selectedLayer} · ${esc(layerName(layerById(selectedLayer)))}</h3>${pathHtml(selectedLayer)}<h3 style="margin-top:22px">この層からの移動・復帰</h3><div class="route-list">${outgoing.length?outgoing.map(step=>`<div class="route-row ${step.blocked?'blocked':''}"><div><button class="layer-chip" data-layer="${step.to}">L${step.from} → L${step.to}</button></div><div><strong>${esc(operation(step))}</strong><code class="code">${esc(step.raw)}</code>${step.reason?`<p>${esc(step.reason)}</p>`:''}${step.blocked?'<p class="badge-warning">この操作では目的のレイヤーを使えません。</p>':!step.reachable?'<p>この割り当ての入口に到達できません。</p>':''}</div></div>`).join(''):'<p class="empty-message">この層からのレイヤー移動は定義されていません。</p>'}</div>`;
  }
  function renderCombos() {
    const combo = model.combos[selectedCombo];
    $('#combo-count').textContent = `${model.combos.length} COMBOS`;
    $('#combo-keyboard').innerHTML = svgKeyboard(layerById(selectedLayer),combo?.positions||[],true);
    $('#combo-detail').innerHTML = combo ? `<strong>${esc(combo.name)}</strong> · ${combo.positions.map(index=>`${esc(describe(layerById(selectedLayer).bindings[index]).main)} (#${index})`).join(' + ')}<br>出力：${combo.bindings.map(binding=>esc(describe(binding).action || binding.raw)).join(' → ')}<br>${combo.layers===null?'すべてのレイヤーで有効':`最高位が ${combo.layers.map(id=>`L${id}`).join(' / ')} のとき有効`} · 同時押し猶予 ${combo.timeoutMs}ms · 直前の無入力条件 ${combo.priorIdleMs<0?'なし':`${combo.priorIdleMs}ms`}${combo.layers!==null&&!combo.layers.includes(selectedLayer)?'<br>選択中の層が最高位のときは、このコンボは対象外です。':''}` : 'コンボはありません。';
    $('#combo-list').innerHTML = model.combos.map((item,i)=>`<button class="combo-button ${i===selectedCombo?'active':''}" data-combo="${i}"><strong>${esc(item.name)} <span class="tiny">#${item.positions.join(' + #')}</span></strong><div class="code">${item.bindings.map(b=>esc(b.raw)).join(' → ')}</div><small>${item.layers===null?'全レイヤー':item.layers.map(id=>`L${id}`).join(' / ')} · ${item.timeoutMs}ms</small></button>`).join('');
  }
  function propertiesHtml(properties) {
    const entries = Object.entries(properties).filter(([key])=>!['compatible','bindings','#binding-cells','label'].includes(key));
    return entries.length?entries.map(([key,value])=>`<div class="detail-row"><span>${esc(key)}</span><strong>${esc(typeof value==='object'?JSON.stringify(value):value)}</strong></div>`).join(''):'<p class="muted">追加指定なし（ZMKの標準設定を使用）</p>';
  }
  function renderSettings() {
    $('#settings-content').innerHTML = `<h3 style="margin-top:24px">タップと長押しの判定</h3><div class="settings-grid">${model.overrides.map(item=>`<section class="card"><h3>&amp;${esc(item.name)}</h3>${propertiesHtml(item.properties)}</section>`).join('')}</div><h3>キーボード本体</h3><p class="muted">明示された設定とKconfigの既定値。最終ビルド全体の設定一覧ではありません。</p><table class="settings-table"><thead><tr><th>設定</th><th>値 / 条件</th></tr></thead><tbody>${model.settings.map(item=>`<tr><td>${esc(item.key)}<p class="tiny">${esc(item.source.split('/').pop())} : ${item.line}</p></td><td>${esc(item.value)}${item.kind==='default'?'<br><span class="tiny">既定値</span>':''}${item.condition?`<p class="tiny">${esc(item.condition)}</p>`:''}</td></tr>`).join('')}</tbody></table><h3>独自behavior / マクロ</h3><div class="settings-grid">${model.behaviors.map(item=>`<section class="card behavior"><h3>${esc(item.name)}</h3><p class="tiny">${esc(item.compatible)}</p><div class="code">${esc(item.bindings.map(binding=>binding.raw).join('\n'))}</div><details><summary>定義の詳細 · ${item.line}行</summary>${propertiesHtml(item.properties)}</details></section>`).join('')}</div>${model.conditionalLayers.length?`<h3>条件レイヤー</h3>${model.conditionalLayers.map(item=>`<p class="code">${item.ifLayers.map(id=>`L${id}`).join(' + ')} → L${item.thenLayer}</p>`).join('')}`:''}`;
  }
  function render() {
    const layer = layerById(selectedLayer);
    document.querySelectorAll('[data-tab]').forEach(button=>{button.classList.toggle('active',button.dataset.tab===tab);button.setAttribute('aria-current',button.dataset.tab===tab?'page':'false');});
    document.querySelectorAll('.panel').forEach(panel=>panel.hidden=panel.id!==`panel-${tab}`);
    $('#layer-list').innerHTML = model.layers.map(item=>`<button class="layer-button ${item.id===selectedLayer?'active':''}" data-layer="${item.id}" aria-pressed="${item.id===selectedLayer}"><span class="layer-num">${String(item.id).padStart(2,'0')}</span><span><strong>${esc(layerName(item))}</strong><small>${item.id===0?'起動時の配列':empty(item)?'空き · 全キー無効':reachable.has(item.id)?'到達できる':'到達経路なし'}</small></span></button>`).join('');
    $('#layer-status').textContent = `LAYER ${String(selectedLayer).padStart(2,'0')} / ${empty(layer)?'EMPTY':reachable.has(selectedLayer)?'REACHABLE':'NO USABLE ROUTE'}`;
    $('#layer-title').textContent = layerName(layer);
    $('#keyboard').innerHTML = svgKeyboard(layer);
    renderKeyDetail();
    const returns = model.routing.transitions.filter(step=>step.from===selectedLayer&&step.via==='release');
    const problems = model.routing.transitions.filter(step=>step.from===selectedLayer&&step.blocked);
    const raijin = model.behaviors.find(item=>item.compatible==='zmk,behavior-onishi-raijin');
    const isRaijin = raijin && Number(raijin.properties['main-layer'])===selectedLayer;
    const vowelPairs = raijin ? [].concat(raijin.properties['vowel-positions']).map((position,i)=>`${describe(layer.bindings[position]).main}位置 → ${codeLabel([].concat(raijin.properties['vowel-keycodes'])[i])}`) : [];
    const raijinHelp = isRaijin ? `<div class="notice"><strong>大西雷神 · 右手入力の試作</strong><br>子音を保持して、次のキーで母音を入力。${vowelPairs.map(esc).join(' / ')}。<br>同じ指の母音はSpaceへ。例：Kを保持 → Spaceでko、N位置でka。母音だけならSpaceを先に保持します。<br>入力の区切りで子音を離します。IMEはローマ字入力をONにしてください。</div>` : '';
    $('#entry-detail').innerHTML = `<h3>このレイヤーへの入り方</h3>${pathHtml(selectedLayer)}${returns.length?`<p class="muted">戻る：${returns.map(step=>`${esc(operation(step))} → L${step.to}`).join(' / ')}</p>`:''}${problems.map(step=>`<p class="notice">${esc(step.reason)}</p>`).join('')}${raijinHelp}<button class="action-link" data-open-routes>経路を図で見る →</button>`;
    renderRoutes(); renderCombos(); renderSettings();
  }
  $('#stats').innerHTML = [[model.layout.length,'KEYS'],[model.layers.length,'LAYERS'],[model.combos.length,'COMBOS']].map(([n,label])=>`<div class="stat"><strong>${n}</strong><span>${label}</span></div>`).join('');
  $('#source-hash').textContent = `SOURCE ${model.source.hash}`;
  $('#source-path').textContent = model.source.path;
  $('#layer-count').textContent = model.layers.length;
  $('#route-assumptions').innerHTML = model.routing.assumptions.map(text=>`<li>${esc(text)}</li>`).join('')+`<li>探索した状態：${model.routing.stateCount}。${model.routing.complete?'対応する構文の探索は完了。':'未対応構文または探索制限があるため、未到達の判定は参考値です。'}</li>`;
  $('#warnings').innerHTML = warnings.length?`<details><summary>設定から見つかった注意点 · ${warnings.length}件</summary><div class="warning-list">${warnings.map(item=>`<div class="notice"><p>${esc(item.message)}</p><span class="tiny">${esc(item.code)}${item.line?` · fish.keymap : ${item.line}`:''}</span></div>`).join('')}</div></details>`:'';
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-tab],[data-layer],[data-key],[data-combo],[data-open-routes],[data-edge-from]');if(!target)return;
    if(target.hasAttribute('data-tab'))setLocation(target.dataset.tab);
    else if(target.hasAttribute('data-layer'))setLocation(tab,Number(target.dataset.layer));
    else if(target.hasAttribute('data-key')){selectedKey=Number(target.dataset.key);if(tab==='combos'){setLocation('layout');}else{render();}}
    else if(target.hasAttribute('data-combo')){selectedCombo=Number(target.dataset.combo);renderCombos();}
    else if(target.hasAttribute('data-open-routes'))setLocation('routes');
    else if(target.hasAttribute('data-edge-from')){setLocation('routes',Number(target.dataset.edgeFrom));setTimeout(()=>$('#route-details').scrollIntoView({behavior:'smooth',block:'nearest'}),50);}
  });
  document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('svg [role="button"]')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
  $('#show-positions').addEventListener('change',render);
  window.addEventListener('hashchange',readLocation);
  readLocation();
  let liveSeen = false;
  async function poll() {
    try {
      const response = await fetch('/__status',{cache:'no-store'});
      if(!response.ok)return;
      const status = await response.json();
      if(typeof status.hash!=='string' && !status.error)return;
      liveSeen = true;
      $('#live-status').textContent = status.error?'更新エラー':'保存に追従中';
      $('#live-status').classList.toggle('live',!status.error);
      $('#update-error').hidden = !status.error;
      $('#update-error').textContent = status.error?`更新できませんでした。前回成功した配列を表示しています。${status.error}`:'';
      if(!status.error&&status.hash&&status.hash!==model.revision)location.reload();
    } catch { if(liveSeen){$('#live-status').textContent='更新サーバーに接続できません';$('#live-status').classList.remove('live');} }
  }
  if(location.protocol==='http:'&&['127.0.0.1','localhost'].includes(location.hostname)){poll();setInterval(poll,1200);}
})();
