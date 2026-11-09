# ComfyUI-PH3-Image-Tool v0.9.0

P-H3による1枚画像の生成と、文字・吹き出し・画像を重ねて編集するComfyUIカスタムノードです。ノードの **Open PH3 Image Tool** から同じ編集画面で作業します。

A single-image P-H3 generation and layered editor for ComfyUI. Generate, edit selected regions, add editable text and speech bubbles, and export the composition in one workspace.

## インストール・更新

[Releases](https://github.com/ukr8b3g-cmyk/ComfyUI-PH3-Image-Tool/releases)からZIPを取得し、中の`ComfyUI-PH3-Image-Tool`フォルダーを`ComfyUI/custom_nodes/`へ配置します。Gitで導入する場合:

```sh
cd ComfyUI/custom_nodes
git clone https://github.com/ukr8b3g-cmyk/ComfyUI-PH3-Image-Tool.git
```

更新前にエディターとComfyUIワークフローを保存し、必要なら`.ph3tool`プロジェクトも書き出してください。既存フォルダーへ更新後、**ComfyUIを再起動してCtrl+F5**。右下の表示は **0.9.0** です。

**`ComfyUI/user/default/ph3_image_tool/` の作品データは削除しないでください。** ノードID、image / alpha / selection出力、作品形式version 1は保持しています。モデル・フォント・利用者作品は配布ZIPに含めません。ComfyUI-Manager/Registryへの登録は今回のリリースに含みません。

Install the ZIP's inner folder under `ComfyUI/custom_nodes/`, or clone the repository there. Save projects before upgrading, preserve `user/default/ph3_image_tool`, restart ComfyUI, then hard-refresh the browser. Existing node IDs, outputs and project format are retained.

## 最初の操作

1. ノード検索で **PH3 Image Tool** を追加するか、[ワークフロー例](examples/PH3_Image_Tool.json)を読み込みます。
2. キューを実行する前にノードの **Open PH3 Image Tool** を開きます。
3. **設定 → P-H3モデル** で導入済みのH3モデル、P-H3テキストエンコーダー、VAE、Image LoRAを選びます。追加LoRAは2枠、初期OFF、強度調整付きです。生成モデルの自動取得は行いません。
4. 画像を読み込むか、新規キャンバスから生成します。候補を確認して新しいレイヤーとして適用します。
5. **保存・ノードへ適用** は再編集可能な作品とノード出力を保存します。**画像書出し** は見た目の合成結果、**プロジェクト書出し** は画像と編集状態を含む`.ph3tool`です。

Open the editor before queueing the outer workflow. Choose installed P-H3 components in Settings. Review generated candidates before adoption. Save / Apply to Node, Export image and Export project are separate operations.

## v0.9.0でできること

| 操作 | 内容 |
|---|---|
| 生成 | T2I・画像全体・選択範囲の編集。通常のComfyUIキューを利用し、共通バーでステップ/進捗率と対象ジョブの停止を表示 |
| 作業の継続 | 生成中も編集可能。履歴は手動で開き、候補更新でフォーカスを移動しません。採用は新規レイヤーとして追加し、編集中の文字やレイヤーを保持 |
| 文字・吹き出し | 縦横書き、ローカルフォントの書体別選択、自動枠調整、字間/縦横比、線幅、色、集中線、フレーム |
| AI効果文字 | 初期はT2I・参照OFF。ポップ/キュート/ファンシー、縦横、色/グラデーション。生成済み文字へ空の吹き出しを生成・合成し、文字を描き直さない方式 |
| スタンプ | 記号・図形・ハート・音符・動線・レアリティ等を含む110点。文字型SFXは一覧から外し、旧作品用の素材は保持 |
| 選択 | 矩形・楕円・投げ縄・自動選択・色から選択・選択ブラシ。追加/除外/共通部分、境界表示 |
| 調整・描画 | 選択プロパティから色相/彩度、明るさ/コントラスト、RGB/各色カーブ、塗り、透明化、コピー、部分生成、効果文字配置。元データ付き調整と透明ペイントをレイヤーとして保持 |
| 漫画仕上げ | CPU漫画フィルター、P-H3漫画フィルター。元画像を保持し、白地・トーン・線画/ベタ・白抜きの4レイヤーへ分離 |
| 背景削除 | Auto/ISNet/色指定/選択。クリックで追加削除・復元し、新しい透過レイヤーとして適用。ISNetは初回の取得確認後に保存・再利用 |
| UI | 分離できるプロパティ/レイヤー/履歴、コンパクトな新規/復元画面、4色の重要操作、共有スウォッチ。表示回転は上部操作バーとRキー |

[現行の操作ガイド](docs/USAGE.md) / [リリース内容](docs/releases/v0.9.0.md) / [変更履歴](CHANGELOG.md)

## 保存・書き出し

- メイン上部の**自動保存**で、生成候補をWebP・既定品質80として保存できます。Save Imageノードの接続は不要です。
- 保存先は設定の先頭でフォルダー選択。ComfyUIサーバーPC上のフォルダーを選び、未指定なら標準outputを使います。プロジェクトには保存先IDだけを保持するため、別PCでは選び直してください。
- PNG/WebP/JPEGの合成書出しと、再編集用`.ph3tool`を利用できます。透過を保持する場合はPNGまたはWebPを使います。JPEGにはアルファがありません。
- 外側のSave Imageは、エディターでノードへ反映後に外側ワークフローを実行した場合の保存です。エディター内生成の自動保存とは別です。
- 未保存の下書きがあると「新規で開く」「編集を再開」を表示します。新規でも前の下書きを削除しません。

Auto-save stores completed generation candidates as WebP (default quality 80) without an outer Save Image node. Select a server-local output folder at the top of Settings. Export the composition separately as PNG/WebP/JPEG, or retain editable layers/assets in a `.ph3tool` project. Use PNG/WebP for transparency.

## 検証と範囲

- v0.9.0公開後の修正（main）: [v0.9.0監査5件の修正・回帰検証](docs/AUDIT_FIXES_JA.md)。品質1〜100の保存互換性、加工・ペイントの整合、対象レイヤーだけのプレビュー、外部削除ジョブの終了を修正。新規/サイズ変更は最大2048×2048、旧作品の読込・保存互換性は維持しています。
- リリース時のPython/JavaScriptテストとZIP照合は[リリース記録](docs/releases/v0.9.0.md)を参照してください。
- [2026-11-09の実Chrome/P-H3検証](docs/PRESERVED_LETTERING_VALIDATION_JA.md)では横書き/縦書きの文字保持と透過PNGを確認しています。**これは以前の検証で、v0.9.0全体の新しい実GPU/実画面確認を意味しません。** 最新のUI変更はChrome操作ツールの接続障害により実画面未確認です。
- 任意の第三者画像生成では文字の保持を保証しません。空の吹き出しと既存文字を合成する処理は、元文字をAIへ描き直させません。
- 信頼できる単一利用者のローカルComfyUI向けです。独立した認証/複数利用者の分離はありません。
- PSD、旧`.sbeproj`、4コマ/複数ページ編集は未対応です。**4コマ対応は今後の検討事項であり、仕様・時期は未確定です。**

Historical Chrome/GPU results are linked above. Current CPU/Node regression tests do not certify every latest UI interaction, live ComfyUI startup or new GPU inference. This is a trusted single-user local editor. Four-panel comic/page editing remains an idea, with no committed scope or schedule.

## ライセンス・開発

MIT。元アプリおよびMangaScreen参照部分の出典・ライセンスは[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)と[MANGASCREEN_LICENSE.txt](MANGASCREEN_LICENSE.txt)を参照。第三者フォント/モデル重みは同梱しません。

```sh
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
python tools/release_package.py --check
```

テストにはPillow、NumPy、aiohttp、OpenCV、CPU版PyTorchを使用します。追加の開発用依存は利用者のComfyUIへ自動導入しません。過去の段階別資料は`docs/`に保持しています。[公開手順](docs/PUBLISH.md)
