# キーマップ変更時のHTML更新

- 実際の設定の閲覧ページは `docs/keymap/index.html`。生成物なので直接編集しない。
- `config/boards/shields/fish/fish.keymap`、`fish-layouts.dtsi`、`fish.conf`、`Kconfig.defconfig`、または `tools/keymap-viewer/` を変更したら、`npm test` と `npm run keymap:build` を実行する。
- 最後に `npm run keymap:check` で生成物の一致を確認し、設定とHTMLを一緒に差分へ含める。
- 表示や操作を変更した場合はブラウザーで確認する。自動QAは `tools/keymap-viewer/verify.cjs`（Playwrightがある環境で実行）。
- `docs/onishi-raijin/` は提案資料。現行キーマップの自動表示と混同しない。
- 大西雷神の実装は `src/raijin/`（入力状態）、`src/behaviors/`（ZMK接続）、`dts/bindings/behaviors/`。変更時はCコンパイラーのあるLinux/WSLで `sh tests/raijin/run.sh` と `sh tests/raijin/run_adapter.sh` を実行し、ZMK接続の変更は左右のfirmwareビルドでも確認する。
- 雷神の現在の使い方は `docs/onishi-raijin/implementation.md`。提案HTMLは初期設計の操作デモであり、実際の入口・出口は現行キーマップを優先する。
