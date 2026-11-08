# editor.1 移植・検証記録

- 対象正本: 指定されたComfyUI_W/custom_nodes/ComfyUI-PH3-Image-Toolの0.2.0rc3。独立Git管理なし。記載されたPH3 GitHub URLは接続済みツールで404のため公開版との比較は未確認。
- 移植元: D:/Codex/Projects/Speech-Bubble-Comic-Editor-App。GitHub mainとローカルHEADは83109b21beb7af0926db8a9f02a7bb27eae3c87d、未コミット差分なし。移植元は変更なし。
- 作業版: D:/Codex/Work/PH3-Image-Tool-editor-port/source。
- 変更前退避: D:/Codex/_snapshots/ComfyUI-PH3-Image-Tool/20261107-230937-editor-port/package（76ファイル、キャッシュ込み）。コピー時の製品67ファイルは作業版とSHA256一致。
- 移植範囲: 吹き出しの曲線・しっぽと本体の一体化・二重輪郭、日本語縦書き、フォント一覧と実ファイル読込、文字幅・高さ・字間・揃え・下線、集中線、白黒フレーム、329素材と日英ラベル。
- フォントはWindows等の既存インストールを利用。配布物・プロジェクトにはフォント実体を含めない。
- 表示レイヤー合成: 原寸画像を新レイヤーとして追加し、元レイヤーは非表示で保持。既存のUndo/Redo・保存を利用。
- 既存プロジェクトの構造、画像資産、生成モデルの選択・ジョブ処理は保持。四コマ/コミックページ/Quick Retouchの別画面は移植範囲外。

## 実施済み

- Python76件、Node55件、全JS構文確認成功。
- Windows上の隔離aiohttp編集画面(port58143)をアプリ内Chromiumから操作。GPU処理なし。
- 吹き出し一覧、曲線・しっぽ、縦書き句読点、Meiryo選択とファイル読込、素材検索・追加、位置変更、保存、合成、再読み込み、集中線一覧を確認。
- 合成前後は1024×1024。元2レイヤーは表示フラグ以外一致。画像差は4画素だけ各チャンネル最大1/255（PNGのアルファ丸め）。
- 合成画像を実APIでPNG・可逆WebP・JPEGへエンコードしPillowでサイズを確認。UIでも3形式の容量とプレビューを確認。portable archiveに元レイヤーの画像資産を保持。
- ブラウザーの数値fill操作ではchangeが発火しない例があったため、キー入力で確定し、保存JSONの値で確認。

## 未実施・制約

- 稼働中ComfyUIの再起動、実ComfyUIの新フォントAPI読み込み、GPU生成は未実施。
- 全フォント・全素材の目視、英語全画面と狭幅の網羅、元アプリの全機能の完全一致は未検証。
- 公開、commit/push、モデル・依存関係追加なし。
- 実環境の反映照合は作業フォルダーのinstall-result.json、出力測定はverification.jsonを参照。
