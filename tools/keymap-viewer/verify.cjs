// Optional visual QA: provide Playwright via NODE_PATH or your local tooling.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const screenshotDir = path.join(root, 'docs/keymap/qa');
  fs.mkdirSync(screenshotDir, { recursive:true });
  const executablePath = process.env.BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(file=>fs.existsSync(file));
  const browser = await chromium.launch({ headless:true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:1100},deviceScaleFactor:1 });
    const errors = [], requests = [];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>requests.push(request.url()));
    console.log('検証 1/5: 単体HTML・全レイヤー・物理座標');
    await page.goto(pathToFileURL(path.join(root, 'docs/keymap/index.html')).href);
    const model = await page.locator('#keymap-data').textContent().then(JSON.parse);
    const { readModel } = await import('./parse.mjs');
    const current = readModel(root);
    assert.deepEqual(model.layers,current.layers,'HTMLのレイヤーは現在のソースと一致する');
    assert.deepEqual(model.layout,current.layout,'HTMLの物理配置は現在のソースと一致する');
    for (const layer of model.layers) {
      await page.locator(`#layer-list [data-layer="${layer.id}"]`).click();
      await page.waitForFunction(id=>document.querySelector('#layer-status').textContent.startsWith(`LAYER ${String(id).padStart(2,'0')}`),layer.id);
      assert.equal(await page.locator('#keyboard .key').count(),model.layout.length);
      const transforms = await page.locator('#keyboard .key').evaluateAll(keys=>keys.map(key=>key.getAttribute('transform')));
      assert.deepEqual(transforms,model.layout.map(key=>`rotate(${key.rotation} ${key.rx} ${key.ry})`));
      for (const key of [0,7,28,31].filter(key=>key<model.layout.length)) {
        await page.locator(`#keyboard [data-key="${key}"]`).click();
        assert.equal(await page.locator('#key-detail > .binding-source').textContent(),layer.bindings[key].raw);
      }
    }
    await page.locator('#layer-list [data-layer="0"]').click();
    await page.locator(`#keyboard [data-key="${Math.min(28,model.layout.length-1)}"]`).click();
    await page.screenshot({path:path.join(screenshotDir,'desktop.png'),fullPage:true});
    console.log('検証 2/5: ルーティング・到達不可・復帰手順');
    await page.locator('[data-tab="routes"]').click();
    const problemLayer = model.routing.transitions.find(step=>step.blocked)?.from ?? 0;
    await page.locator(`#layer-list [data-layer="${problemLayer}"]`).click();
    await page.waitForFunction(id=>document.querySelector('#route-details').textContent.includes(`L${id} ·`),problemLayer);
    for(const step of model.routing.transitions.filter(step=>step.from===problemLayer&&step.blocked)) {
      assert.ok((await page.locator('#route-details').textContent()).includes(step.reason));
    }
    assert.equal(await page.locator('#route-map .route-node').count(),model.layers.length);
    assert.equal(await page.locator('#route-map .route-node.unreachable').count(),model.routing.unreachableLayers.length);
    await page.screenshot({path:path.join(screenshotDir,'routes.png'),fullPage:true});
    const releaseLayer = model.routing.transitions.find(step=>step.via==='release')?.from;
    if(releaseLayer!==undefined) {
      await page.locator(`#route-map [data-layer="${releaseLayer}"]`).click();
      await page.waitForFunction(id=>document.querySelector('#route-details').textContent.includes(`L${id} ·`),releaseLayer);
      assert.match(await page.locator('#route-details').textContent(),/離す/);
    }
    console.log('検証 3/5: コンボ・設定・キーボード操作');
    await page.locator('[data-tab="combos"]').click();
    for (const [index,combo] of model.combos.entries()) {
      await page.locator(`[data-combo="${index}"]`).click();
      assert.equal(await page.locator('#combo-keyboard .highlight').count(),combo.positions.length);
      assert.ok((await page.locator('#combo-detail').textContent()).includes(`${combo.timeoutMs}ms`));
    }
    await page.screenshot({path:path.join(screenshotDir,'combos.png'),fullPage:true});
    await page.locator('[data-tab="settings"]').click();
    for(const setting of model.settings)assert.ok((await page.locator('#settings-content').textContent()).includes(setting.key));
    await page.locator('[data-tab="layout"]').click();
    await page.locator('#layer-list [data-layer="0"]').click();
    const accessibleKey = Math.min(10,model.layout.length-1);
    await page.locator(`#keyboard [data-key="${accessibleKey}"]`).focus();
    await page.keyboard.press('Enter');
    assert.ok((await page.locator('#key-detail').textContent()).includes(model.layers[0].bindings[accessibleKey].raw));
    assert.ok(!requests.some(url=>/^https?:/.test(url)), '単体HTMLは外部通信なしで表示できる');
    const raijin = model.behaviors.find(item=>item.compatible==='zmk,behavior-onishi-raijin');
    if(raijin) {
      const main = raijin.properties['main-layer'], aux = raijin.properties['auxiliary-layer'];
      await page.locator(`#layer-list [data-layer="${main}"]`).click();
      await page.locator('#keyboard [data-key="30"]').click();
      assert.match(await page.locator('#key-detail').textContent(),/子音保持中はU/);
      assert.ok((await page.locator('#key-detail').textContent()).includes(`L${aux}`));
      assert.match(await page.locator('#entry-detail').textContent(),/Kを保持/);
      await page.screenshot({path:path.join(screenshotDir,'raijin.png'),fullPage:true});
      await page.locator(`[data-layer="${aux}"]`).first().click();
      await page.locator('#keyboard [data-key="27"]').click();
      assert.match(await page.locator('#key-detail').textContent(),/2回送る/);
      await page.screenshot({path:path.join(screenshotDir,'raijin-auxiliary.png'),fullPage:true});
      await page.locator('[data-tab="routes"]').click();
      await page.locator(`#layer-list [data-layer="${main}"]`).click();
      await page.waitForFunction(id=>document.querySelector('#route-details').textContent.includes(`L${id} ·`),main);
      assert.match(await page.locator('#route-details').textContent(),/子音を離して/);
      await page.screenshot({path:path.join(screenshotDir,'raijin-routes.png'),fullPage:true});
    }
    console.log('検証 4/5: モバイル表示・横はみ出し');
    await page.setViewportSize({width:390,height:844});
    for (const tab of ['layout','routes','combos','settings']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      await page.waitForFunction(tab=>!document.querySelector(`#panel-${tab}`).hidden,tab);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tab}: ページ自体に横はみ出しがない`);
      if(tab==='layout'||tab==='routes')await page.screenshot({path:path.join(screenshotDir,`mobile-${tab}.png`),fullPage:true});
    }
    console.log('検証 5/5: ライブ更新・エラー保持・修復後の画面復旧');
    const { tmpdir } = require('node:os');
    const { startViewer } = await import('./serve.mjs');
    const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), 'fish-browser-qa-'));
    let temporaryViewer;
    try {
      fs.cpSync(path.join(root,'config'),path.join(temporaryRoot,'config'),{recursive:true});
      for(const file of ['fish.keymap','fish-layouts.dtsi','fish.conf','Kconfig.defconfig']) {
        fs.copyFileSync(path.join(__dirname,'fixtures',file),path.join(temporaryRoot,'config/boards/shields/fish',file));
      }
      fs.cpSync(path.join(root,'tools/keymap-viewer'),path.join(temporaryRoot,'tools/keymap-viewer'),{recursive:true});
      temporaryViewer = await startViewer({root:temporaryRoot,port:0,pollInterval:80,logger:()=>{}});
      await page.goto(`${temporaryViewer.url}#layout-6`);
      await page.waitForFunction(()=>document.querySelector('#live-status').textContent==='保存に追従中');
      const before = await page.locator('#source-hash').textContent();
      const sourcePath = path.join(temporaryRoot,'config/boards/shields/fish/fish.keymap');
      const original = fs.readFileSync(sourcePath,'utf8');
      fs.writeFileSync(sourcePath,original.replace(/&kp L\b/,'&kp F'),'utf8');
      await page.waitForFunction(before=>document.querySelector('#source-hash')?.textContent!==before,before);
      assert.equal(new URL(page.url()).hash,'#layout-6','自動更新で選択レイヤーを保持する');
      fs.writeFileSync(sourcePath,'/ { keymap {','utf8');
      await page.waitForFunction(()=>!document.querySelector('#update-error').hidden);
      assert.match(await page.locator('#layer-status').textContent(),/LAYER 06/);
      await page.screenshot({path:path.join(screenshotDir,'update-error.png'),fullPage:true});
      fs.writeFileSync(sourcePath,original,'utf8');
      await page.waitForFunction(before=>document.querySelector('#source-hash')?.textContent===before&&document.querySelector('#update-error')?.hidden===true,before);
      await page.waitForFunction(()=>document.querySelector('#live-status').textContent==='保存に追従中');
    } finally {
      if(temporaryViewer)await temporaryViewer.close();
      assert.equal(path.dirname(path.resolve(temporaryRoot)),path.resolve(tmpdir()));
      assert.ok(path.basename(temporaryRoot).startsWith('fish-browser-qa-'));
      fs.rmSync(temporaryRoot,{recursive:true,force:true});
    }
    if (process.env.VIEWER_URL) {
      await page.goto(process.env.VIEWER_URL);
      await page.waitForFunction(()=>document.querySelector('#live-status').textContent==='保存に追従中');
    }
    assert.deepEqual(errors,[]);
    console.log(`成功: 全${model.layers.length}レイヤー・${model.layout.length}座標・キー詳細・到達/復帰・全${model.combos.length}コンボ・4画面・モバイル・保存追従・JSエラーなし`);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
