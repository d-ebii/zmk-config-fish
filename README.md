# おさかなキーボード  
これは、[おさかなキーボード](https://o24.works/fish/)のためのZMK Firmareの設定リポジトリです。  
キーマップを書き換えておさかなを更新する手順は[ユーザーガイド](https://o24.works/fish/guide/)を参照してください。  

## 現在の配列とルーティングを見る

extra2（L8）に [大西雷神の試作](docs/onishi-raijin/implementation.md) を追加しています。systemの旧「L7 Toggle」で入り、旧「INS」で通常配列へ戻ります。専用behaviorはこのリポジトリ内のZMKモジュールとして組み込みます。

[キーマップビューアー](docs/keymap/index.html) をダウンロードしてブラウザーで開くと、全レイヤーの配列、タップと長押し、入り方と戻り方、コンボ、設定を確認できます。HTMLひとつで動作します。

編集中は Node.js 22 以上で次を実行し、表示されたURLを開いてください。パッケージのインストールは不要です。

```sh
npm run keymap:view
```

`fish.keymap` などの保存に追従して、画面と `docs/keymap/index.html` を更新します。通常のURLは `http://127.0.0.1:4173/`、終了は Ctrl+C です。ポートを変える場合は `npm run keymap:view -- --port 4174`。

- 1回だけ生成：`npm run keymap:build`
- 保存したHTMLと現在の設定の一致を確認：`npm run keymap:check`
- 解析と更新処理を検証：`npm test`
- GitHubへ対象ファイルをpushすると、Actionsの **Keymap viewer** がHTMLを生成し、**keymap-viewer** 成果物として保存します。PRでも実行されます。成果物をダウンロード・展開して `index.html` を開けます。

静的HTMLだけを開いた場合は、生成時点の内容です。自動更新には上記のプレビューを起動してください。雷神の[設計案](docs/onishi-raijin/index.html)とは別に、実際のリポジトリ設定を表示します。詳しくは[ビューアーの仕様](tools/keymap-viewer/README.md)を参照してください。
  
## 書き換えていいファイル  
### [fish.keymap](config/boards/shields/fish/fish.keymap)  
キーの割り当てや入力の内容を設定できます。このファイルを視覚的に編集できる[キーマップエディター](https://o24.works/fish/editor/)も活用してください。  
### [fish.conf](config/boards/shields/fish/fish.conf)  
スリープ時間、検出名など、キーボード本体の挙動を設定できます。  
### [Kconfig.defconfig](config/boards/shields/fish/Kconfig.defconfig)
親機の左右を変えることができます。  
