# PH3 Image Tool — 編集状態保護修正

対象正本: `ukr8b3g-cmyk/ComfyUI-PH3-Image-Tool`

確認基準: `38b25ca35e4c7cfcff5b65ee4e15a692563b7aec`（main）。前回監査の `badb196` 以降に追加された実Chrome・GPU検証文書、画像、Seed/ハッシュ記録を保持する。

## 変更内容

1. **下書きの復元保護**
   保存済みプロジェクトの読込直後に既存下書きを確保する。復元・明示的な破棄を選ぶまで、モデル自動選択と下書き書込みを停止する。復元確認を閉じるだけでは破棄しない。不正な下書きも退避可能とする。保存世代が異なる場合は別作品として復元し、読込失敗時は原下書きを残す。作品切替前に予約タイマーを解除し、別作品への遅延書込みを防ぐ。
2. **画像化した装飾の保護**
   `decoration: true` の画像と `generation.mode: lettering` を通常画像と区別する。新しい画像は既存装飾の下へ挿入し、既存の並び順自体は変更しない。`include_text` がOFFの生成用合成からも画像スタンプ・AI文字を除外する。通常のプレビュー・書出しは全表示レイヤーを含む。
3. **ライブ編集と古い生成結果**
   スライダー・色の最初のプレビュー変更時点で `canvas_revision` を進める。操作途中、元の値に戻した場合にも、変更前のジョブが再び自動適用可能にはならない。Undoは確定した1操作につき1件を維持する。
4. **レイヤー上限の統一**
   画像読込、複数画像/スタンプの読込、生成採用、漫画4レイヤー、画像処理、複製、合成等で共有の容量検査を使用する。256枚を超える操作はアップロード、履歴変更、元画像の非表示化より前に止める。生成候補は残す。TキーとCtrl+Vによる上限エラーも画面の既存エラー表示へ渡す。

## 非変更範囲

P-H3モデル、Sampler、sigmas、生成グラフ、Pythonノードの登録名/入出力、作品形式version 1、保存先、既存の画像/マスク/元文字を変更しない。個人のワークフローとSaveWebPMetaの保存設定を変更しない。追加パッケージ、モデル/フォントのダウンロード、Quick Retouch別画面、漫画ページ機能を追加しない。公開バージョン番号と既存の検証文書は変更しない。

## 今回の実行結果

- JavaScript **100件成功・0失敗**。既存59件（core 20、brushup 31、manga 5、layer-order 3）と今回追加41件。
- 新規テストは `tests/editor-safety.test.mjs`。実装関数と、現行studioから切り出したイベント処理をNode.jsの隔離コンテキストで実行する。DOM、通信、タイマーは試験用代替であり、ブラウザーの実操作ではない。
- Python **30件成功・0失敗**。ハッシュ照合済みの変更していないschema/storage/exportingと対象既存テストのみ。全Python126件を再実行した結果ではない。
- 変更した4つのES moduleの構文検査成功。
- Linux / Python 3.13.5 / Node.js 22.16.0。新規依存関係の導入なし。

## 未確認・反映状態

今回の修正後のWindows実画面、実ComfyUI、P-H3 GPU、ISNet推論は未実施。前のmainに含まれる実Chrome/GPU確認とは別の検証である。外部から削除したComfyUI待機ジョブの追跡については前回の追加調査事項のまま、今回の修正には含めない。

本修正をGitHub mainへ反映するための修正・検証記録。適用補助スクリプトはローカル専用であり、GitHubの操作には使用していない。

## 回帰確認コマンド

```powershell
node --test tests/core.test.mjs tests/brushup.test.mjs tests/manga.test.mjs tests/layer-order.test.mjs tests/editor-safety.test.mjs
node --check web/core.mjs
node --check web/render.mjs
node --check web/manga-core.mjs
node --check web/studio.mjs
```

適用時は既存の `tools/version_web.py` を検証して再利用し、同じwebモジュール群のキャッシュ識別子をまとめて更新する。その結果、その他のwebモジュールにもimport識別子のみの差分が出る。MANIFESTには変更対象と新規文書/テストのハッシュだけを更新し、他の項目を保持する。