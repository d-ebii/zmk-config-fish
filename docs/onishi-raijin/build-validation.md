# 試作の検証記録

2026-09-08。リポジトリへのコミット・pushと、実機への書き込みは行っていません。

## 検証したソース

- ZMK: `641514a97db345f499dd50b0360e594270f008fe`
- Zephyr: `10ba6d0cb38bc3d258775d27982f707599320085`
- Zephyr SDK: `0.17.0`、ARM toolchain
- `fish.keymap` SHA-256: `0de4e6e594c2ba14c67a40e73220a8733439849619f97a54a6bd1af3785a8259`
- `behavior_onishi_raijin.c` SHA-256: `5e72f5d9a081d26b0bc5f955984fc368bd6e15500c672bcd9f7f5cf93556c935`
- `raijin.c` SHA-256: `58a71fd301daf49756cadbaec16af228527a7bc6468713410895143e2eef6ea4`

## 自動検証

- 入力状態処理: 厳格C11コンパイル、30テスト成功。14子音の可変Spaceと5母音、代表的な日本語、保持順、同指回避、両親指抑止、補助判定、解除・再入を確認。
- ZMK接続: 実adapterコードをstub環境で動かす9テスト成功。補助の初回キーを転送する経路、対応する解放、切断後の押し直し、タイマーとレイヤー退出を確認。実機通信を模擬するテストではありません。
- ビューアー: Node.jsの36テスト成功。設定解析・到達経路・解放時の復帰・生成一致・不正な保存からの復旧を確認。
- ブラウザー: Edgeで10レイヤー・32物理位置・7コンボ・4画面、L8/L9の専用表示とルーティングを確認。1440px / 390pxでページ全体の横はみ出しとJavaScriptエラーなし。保存→再読み込み、エラー保持→修復、レイヤー選択維持も確認。
- 指定したsystemのキーは位置4が `&to 8`、位置5が `&to 0`。L8/L9で既存コンボが無効であることと、L9→L8 / L9→L6→L0の経路を確認。

## ファームウェア

WSL Ubuntuの専用作業領域で `build.yaml` と同じ3ターゲットを検証しました。リポジトリのルートを `ZMK_EXTRA_MODULES` として指定し、左で専用behaviorの実コンパイルとStudio有効化を確認しています。

| ターゲット | Flash | RAM |
| --- | ---: | ---: |
| fish_left + Studio | 272,484 B | 81,730 B |
| fish_right | 196,016 B | 41,856 B |
| settings_reset | 58,916 B | 17,456 B |

左右のレイヤー名にはUTF-8で12バイトの「大西雷神」「雷神補助」を使用します。最初の長い名前で発生したZMKの20バイト配列長警告を解消しました。

最終UF2は `artifacts/raijin/` に保存し、Gitの無視対象にしています。Windows側で全UF2ブロックの形式とSHA-256を照合しました。

| ファイル | サイズ | SHA-256 |
| --- | ---: | --- |
| `fish_left.uf2` | 545,280 B | `63e99f26810dee0d15ff31c44f74199407624b07608345e556b6b46a12621d78` |
| `fish_right.uf2` | 392,192 B | `01fca44d6fbf81192c7138d2dba386f5846dbffd7b33edb061523451bdf4b234` |

左の実configでは `ZMK_STUDIO=y`、`ZMK_STUDIO_RPC=y`、`ZMK_STUDIO_TRANSPORT_UART=y`、`USB_CDC_ACM=y`、`ZMK_BEHAVIOR_METADATA=y`、`ZMK_BEHAVIOR_ONISHI_RAIJIN=y`、`ZMK_SPLIT_ROLE_CENTRAL=y` を確認しました。右はperipheral、settings_resetには専用behaviorを組み込んでいません。

ビルドログと作業環境はWSLの `/var/tmp/fish-raijin-build/`。再実行は同ディレクトリの `build.sh left` / `build.sh right` で行えます。環境準備に使用したツールはWest 1.5.0、ARM GCC 12.2.0、Python依存はuvで管理しています。

## 既存設定の確認事項

今回の標準ビルドログでは `config/boards/shields/fish/fish.conf` のマージが確認できませんでした。既存の配置に関する問題として記録し、この試作では配置や本体設定を変更していません。閲覧HTMLの本体設定はリポジトリに書かれた値で、最終ビルドの `.config` 全体とは区別してください。

残る警告は既存の `config/boards`、`label`、`KSCAN` の非推奨指定と、標準settings_resetの空キーマップに関するものです。今回追加したレイヤー名による警告は解消しています。

ファームウェアのビルド成功は、実際のBluetooth接続・OSのIME・押しやすさの確認を代替しません。現在の操作手順は [implementation.md](implementation.md) にあります。
