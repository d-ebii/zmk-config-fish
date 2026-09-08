const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  console.log('検証 1/4: ブラウザーでHTMLを読み込みます');
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  const executablePath = candidates.find(p => fs.existsSync(p));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
    const source = fs.readFileSync(path.join(__dirname, '../../config/boards/shields/fish/fish-layouts.dtsi'), 'utf8');
    const sourcePositions = [...source.matchAll(/&key_physical_attrs\s+100\s+100\s+(\d+)\s+(\d+)\s+(\(?-?\d+\)?)/g)].map(m => [Number(m[1]), Number(m[2]), Number(m[3].replace(/[()]/g, '')) / 100]);
    const data = await page.evaluate(() => ({ positions: RaijinDesign.positions.map(p => [p[0], p[1], p[2] || 0]), results: RaijinDesign.results, right: RaijinDesign.right, vowels: RaijinDesign.vowels, consonants: RaijinDesign.consonants }));
    assert.deepEqual(data.positions, sourcePositions, '物理座標/親指回転はソースと一致する');
    assert.equal(data.positions.length, 32);
    assert.equal(data.right.length, 14);
    assert.equal(Object.keys(data.vowels).length, 5);
    assert.equal(Object.values(data.consonants).join(''), 'kwrygtnshpdmzb');
    assert(data.results.every(r => r.passed), JSON.stringify(data.results));

    console.log('検証 2/4: 入力順序・保持・復帰・親指の境界条件');
    const extra = await page.evaluate(() => {
      const { createState, stepState } = RaijinDesign;
      const run = events => { const s = createState(); events.forEach(([type, id]) => stepState(s, {type, id})); return s; };
      return {
        space: run([['down',31],['up',31]]),
        backspace: run([['down',30],['up',30]]),
        invalidVowel: run([['down',31],['down',4],['up',4],['up',31]]),
        thumbCollision1: run([['down',31],['down',30],['up',30],['up',31]]),
        thumbCollision2: run([['down',30],['down',31],['up',31],['up',30]]),
        priority: run([['down',4],['down',7],['down',31],['up',31],['up',7],['down',31],['up',31],['up',4]]),
        repeat: run([['down',4],['down',4],['up',4]]),
        delayedAux: run([['down',30],['wait'],['down',6],['up',6],['up',30]]),
        releaseRole: run([['down',4],['down',31],['up',4],['up',31]]),
        rightExit: run([['down',30],['down',7],['up',30],['up',7]]),
        leftExit: run([['down',4],['down',28],['up',4],['up',28]]),
        outputBeforeExit: run([['down',4],['up',4],['down',30],['down',7],['up',7],['up',30]]),
        xu: run([['down',30],['down',14],['up',14],['up',30],['down',31],['down',6],['up',6],['up',31]]),
      };
    });
    const expected = {space:' ',backspace:'⟨Bksp⟩',invalidVowel:'',thumbCollision1:'',thumbCollision2:'',priority:'kyio',repeat:'k',delayedAux:'⟨Enter⟩',releaseRole:'ko',rightExit:'',leftExit:'k',outputBeforeExit:'k',xu:'xu'};
    for (const [name, s] of Object.entries(extra)) {
      assert.equal(s.output, expected[name], name);
      assert.equal(Object.keys(s.held).length, 0, `${name}: 全解放`);
      assert.equal(s.anchors.length, 0, `${name}: 子音残留なし`);
      assert.equal(s.mode30, null, `${name}: 30残留なし`);
      assert.equal(s.mode31, null, `${name}: 31残留なし`);
      assert.equal(s.layer, /Exit$/.test(name) ? 0 : 8, `${name}: 復帰先`);
    }

    console.log('検証 3/4: 表示切替・キー詳細・全例のUI操作');
    for (const plane of ['base', 'raijin', 'vowel', 'aux']) {
      await page.locator(`[data-plane="${plane}"]`).click();
      assert.equal(await page.locator('#keyboard [data-key]').count(), 32);
      await page.locator('#keyboard [data-key="26"]').click();
      assert((await page.locator('#key-detail').textContent()).includes('26'));
    }
    for (let i = 0; i < data.results.length; i++) {
      await page.selectOption('#example', String(i));
      const count = await page.evaluate(i => RaijinDesign.examples[i].events.length, i);
      for (let j = 0; j < count; j++) await page.locator('#next').click();
      assert(await page.locator('#next').isDisabled());
      const output = await page.locator('#demo-output').textContent();
      assert.equal(output, data.results[i].expected || '—');
    }
    await page.selectOption('#example', '0');
    await page.locator('[data-plane="raijin"]').click();
    await page.locator('#focus-right').uncheck();
    const outDir = path.join(__dirname, 'qa');
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'desktop.png'), fullPage: true, animations: 'disabled' });
    await page.locator('[data-plane="vowel"]').click();
    await page.screenshot({ path: path.join(outDir, 'vowels.png'), fullPage: false, animations: 'disabled' });
    console.log('検証 4/4: モバイル表示とコンソールエラー');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    assert(await page.locator('#focus-right').isChecked());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'ページ全体の横はみ出しなし');
    await page.screenshot({ path: path.join(outDir, 'mobile.png'), fullPage: true, animations: 'disabled' });
    await page.locator('#layout').screenshot({ path: path.join(outDir, 'mobile-layout.png'), animations: 'disabled' });
    await page.selectOption('#example', '5');
    await page.locator('#next').click();
    await page.locator('#next').click();
    assert.equal(await page.locator('#demo-output').textContent(), 'ky');
    await page.locator('#focus-right').uncheck();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, '全体配列を選んでも図内のみ横スクロール');
    assert.deepEqual(errors, []);
    console.log(`PASS: 32座標、${data.results.length}入力例、${Object.keys(extra).length}境界条件、4表示、PC/モバイル。`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
