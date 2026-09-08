# 現行キーマップビューアー

`fish.keymap` から全レイヤーの物理配列とルーティングを生成する、依存パッケージ不要のNode.jsツールです。Node.js 22以上を使用します。

## 使い方

リポジトリ直下で `npm run keymap:view` を実行し、表示されたURLをブラウザーで開きます。設定の保存を500ms間隔で確認し、HTMLを再生成します。ブラウザーは約1.2秒間隔で更新を検出し、選択しているレイヤーと画面を保って再読み込みします。エディターがファイルを置き換えて保存する方式にも対応しています。

生成に失敗すると画面上部にエラーを出し、直前に成功したHTMLを保持します。初回生成から失敗した場合はエラーを表示し、ファイル修正後に同じURLを再読み込みできます。サーバーを終了すると、開いているページに接続できない旨を表示します。

| コマンド | 動作 |
| --- | --- |
| `npm run keymap:view` | 保存を監視して生成、ローカルで表示 |
| `npm run keymap:view -- --port 4174` | ポート変更 |
| `npm run keymap:build` | 単体HTMLを生成 |
| `npm run keymap:check` | 生成済みHTMLの鮮度を確認。不一致なら失敗 |
| `npm test` | 解析・ルーティング・更新追従のテスト |

インストールやサーバーがなくても、生成済みの `docs/keymap/index.html` をブラウザーで直接開けます。CSS・JavaScript・設定データはすべて内包し、外部ライブラリやフォントを読み込みません。

動作の固定期待値は `fixtures/` のテスト用設定で検証します。普段の配列変更に合わせてfixturesを書き換える必要はありません。実リポジトリについては、現在の物理配置と各レイヤーのキー数が整合することを別に確認します。

## 読み込む設定

- `config/boards/shields/fish/fish.keymap`：レイヤー、behavior、コンボ、判定時間
- `config/boards/shields/fish/fish-layouts.dtsi`：物理キーの座標・寸法・回転中心
- `config/boards/shields/fish/fish.conf`：本体の明示的な設定
- `config/boards/shields/fish/Kconfig.defconfig`：条件付きの既定値

代替の `fish_*.keymap` は現在のビルドに使うキーマップではないため表示対象に含めません。構文テストでは代替ファイルも確認しています。ソースの指紋をページ上部に表示します。生成は同じ入力に対して同じ結果になります。

## 画面

- **配列を見る**：全レイヤーの割り当て。キーをクリックするとタップ・長押し・生のbinding・元の行番号を表示。横長の物理配置はスマートフォンで左右にスクロールできます。
- **ルーティング**：レイヤー0からの操作手順、層ごとの移動と解放時の復帰。破線は到達できない入口や、上位レイヤーに隠れる経路です。
- **コンボ**：同時押し位置、出力、対象レイヤー、実際に適用される設定値。親のcombosノードにだけ指定した時間は適用されないため、警告と既定値を表示します。
- **設定とマクロ**：長押し判定の上書き、本体設定、独自behaviorの定義。

キーの表示名は読みやすい表記へ置き換えますが、未対応コードや独自behaviorは名前と生の設定を残します。ソースにないキーやマクロの動作を推測して表示しません。

## ルーティング解析の範囲

押しているキーと有効レイヤーを状態として探索します。番号の大きいレイヤーを優先し、`&trans` だけを下の層へ渡します。`&none` は入力を消費します。

標準の `&mo`、`&lt`、`&tog`、`&to`、`&sl`、コンボのレイヤー条件、条件レイヤー、独自hold-tap・tap-dance、対応範囲内のマクロを解析します。宣言上の移動先、キーを実際に操作できること、その層の設定を使えることを区別します。元のキーを離す操作も探索し、切替後の層に同じ長押しキーがなくても復帰経路へ反映します。

この解析はZMKのビルドや実機シミュレーターではありません。入力時間やコンボの競合、OS・IME、Studioの保存内容は再現しません。未対応のプリプロセッサー、外部include、複雑なマクロなどは警告します。探索は最大12,000状態で打ち切り、その場合は未到達判定が確定しないことを表示します。Kconfigも最終ビルドの全設定を解決するものではありません。

## 更新とCI

`.github/workflows/keymap-viewer.yml` は設定・生成ツールのpushとPR、手動実行を契機にテストと生成を行い、`keymap-viewer` に最新HTMLを保存します。ソースへの自動コミットやWeb公開は行いません。GitHub上で常時閲覧するURLが必要なら、別途Pages等の公開設定が必要です。

作業中の監視は設定とHTML/CSS/JavaScriptに追従します。生成器・解析器の `.mjs` を変更した場合はサーバーを再起動してください。CIでは常に新しいプロセスで生成します。プレビューは `127.0.0.1` のみで待ち受け、HTMLと更新状態以外のファイルを配信しません。

## 画面の検証

Playwrightが利用できる環境では `node tools/keymap-viewer/verify.cjs` を実行できます。既存のEdge/Chrome、またはPlaywrightのChromiumを利用します。任意のブラウザー実行ファイルは `BROWSER_PATH`、ライブ表示の検証先は `VIEWER_URL` で指定できます。結果画像は `docs/keymap/qa/` に保存します。通常の `npm test` にはPlaywrightは不要です。

## 参照

- [公式Fishキーマップエディター](https://o24.works/fish/editor/)：物理配列とキーの役割を一覧できる見せ方の参考
- [ZMK Layers](https://zmk.dev/docs/keymaps/behaviors/layers)
- [ZMK Conditional Layers](https://zmk.dev/docs/keymaps/conditional-layers)
- [ZMK Combos](https://zmk.dev/docs/keymaps/combos)
- [ZMK Combo configuration](https://zmk.dev/docs/config/combos)
