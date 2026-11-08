# ComfyUI-PH3-Image-Tool

## 現在の開発版 — AI効果文字と元文字保持

文字プロパティの「AI効果文字」で、文字・プリセット・縦横・色/グラデーションを選んでT2I生成できます。参照は初期オフです。生成した候補へトゲ/思考吹き出しを追加する際は、AIには空の枠だけを生成させ、元文字を描き直さず合成します。

横書き・縦書きの「ビクッ!!」をSeed42/43/44で実GPU検証し、各3/3で濁点分離、感嘆符2個、文字領域の全画素一致、端切れなし、外側透過を確認しました。Python126件・JavaScript99件成功。GPU検証は標準API経由で、更新後の実エディター画面からの操作確認は未実施です。[検証方法と制約](docs/PRESERVED_LETTERING_VALIDATION_JA.md)。

導入/更新後は作品を保存してComfyUIを再起動し、Ctrl+F5で再読み込みしてください。以下のrc3/editor.1記録は過去の移植段階の記録です。

## ローカル移植版 editor.1（未公開）

Speech-Bubble-Comic-Editor-Appの吹き出し本体・しっぽの合成描画、縦書き、字間、文字の縦横比、下線・取り消し線、ローカルフォント一覧、集中線、白黒フレームと効果音・スタンプ・付箋素材329点を移植しています。

「表示レイヤーを合成」は原寸の合成画像を追加し、元レイヤーを非表示で保持します。Undoで戻せます。PNG/WebP/JPEGの画像書出しと、編集可能なプロジェクト書出しは別操作です。フォントファイルは同梱しません。別PCで編集する場合は同じフォントのインストールが必要です。

導入後はComfyUIを再起動し、ブラウザーを再読み込みしてください（フォントAPI追加）。Python76件・JS55件とWindows上の隔離編集画面で検証。実ComfyUIでの編集操作・GPU生成は本移植の検証対象外です。詳細は [検証記録](docs/EDITOR_PORT_VALIDATION_JA.md)。


**0.2.0-rc3 — グラフィカル編集・操作改善版**

P-H3 Imageを使う、一枚画像専用の生成・レイヤー編集カスタムノードです。ノードの **Open PH3 Image Tool** ボタンから大きな編集画面を開き、新規生成・全体編集・部分生成と、文字・装飾・画像処理を同じ画面で扱います。

本版は利用者から動作確認の報告があった **0.1.1-rc2** を基準にしています。`PH3ImageTool` のID、入出力、作品形式1、生成グラフ作成・結果取得、ノード出力処理は維持しています。元リポジトリや利用者の実環境には変更していません。

**今回の開発側確認は、Python 73件、JavaScript 51件、隔離Chromiumの操作確認44項目です。実ComfyUI・Windows・P-H3 GPU・任意のISNet推論による本版の再確認は含みません。** 利用者の前版の動作報告と、本版の開発テストを区別しています。[検証範囲](docs/VALIDATION.md)

## 0.2.0-rc3 の変更

| 項目 | 内容 |
|---|---|
| スタイル・装飾 | プレビュー付きカード、名前検索、文字スタイル、常時表示するレイヤー一覧とサムネイル |
| 漫画変換 | 元アプリのグレースケール・2値・漫画調・XDoG処理を移植。6つの視覚プリセット、処理前後比較、明るさ・濃さ・階調等の調整、原寸適用 |
| 背景削除 | 処理前後比較、クリックによる背景色指定、選択切り抜き、フチ色補正・収縮・内側ぼかし。任意の既存ISNet経路は維持 |
| キャンバス | ホイールでカーソル中心ズーム、中ボタン/Spaceで移動、R/Altホイールで表示回転。8方向変形・回転・吹き出し尻尾ハンドル |
| 操作 | Delete、Undo/Redo、マウスの戻る/進む、複製、コピー貼付、矢印移動。文字入力・IMEを保護 |
| 書き出し | エンコード済みの実プレビューと容量。PNG圧縮0–9、JPEG/WebP品質1–100、可逆WebP、透過/下地色 |

[画面と操作ガイド](docs/BRUSHUP_GUIDE.md) / [変更履歴](CHANGELOG.md)

## インストール

ZIP内の `ComfyUI-PH3-Image-Tool` フォルダーを、次の位置に配置します。

```text
ComfyUI/
└─ custom_nodes/
   └─ ComfyUI-PH3-Image-Tool/
      ├─ __init__.py
      ├─ nodes.py
      └─ web/
```

ComfyUIを通常の方法で再起動し、ブラウザーを再読み込みします。ノード検索で **PH3 Image Tool** または **ComfyUI-PH3-Image-Tool** を入力して追加するか、`examples/PH3_Image_Tool.json` を読み込みます。最初はQueueする前にノードのボタンからエディターを開いてください。

ComfyUIに既に含まれるPythonパッケージを利用します。追加パッケージやモデルの自動インストール、外部サービスへの画像送信はありません。通常編集・漫画変換・色指定による背景削除には生成モデルは不要です。

### rc1 / rc2から更新

先にエディターで「保存・ノードへ適用」とComfyUIワークフロー保存を行い、必要に応じて`.ph3tool`も書き出します。ComfyUIを終了し、同じ `custom_nodes/ComfyUI-PH3-Image-Tool/` に新しいソースを上書きしてください。ZIPの外側にもう一段フォルダーを作らないでください。

**`ComfyUI/user/default/ph3_image_tool/` の作品データは削除しないでください。** ノードを作り直す必要はありません。再起動後に `Ctrl+F5` でブラウザーを更新し、画面右下の `0.2.0-rc3` を確認します。HTTPの書き出し経路も追加しているため、ブラウザー更新だけでなくComfyUIの再起動が必要です。

本版は添付されていたSaveWebPMetaのファイル名・保存先・品質を変更しません。**後段保存ノードの品質と、エディター内書き出しの品質は別設定**です。

### 必要なComfyUI機能

生成には、`PH3ImageConditioning`、`MiniMaxH3SigmaShift`、`LoraLoaderModelOnly`、`SamplerCustomAdvanced`などの標準ノードが必要です。文章補助を使う場合のみ、`TextGenerateV2`が必要です。起動時と生成要求時に必要なノード名を検査します。

固定のバージョン番号だけではなく、必要ノードが実際に登録されていることを確認してください。この版の実ComfyUI互換確認は受入試験として残っています。

## 最初の操作

まず上部の **設定 → P-H3モデル** で、導入済みの拡散モデル・テキストエンコーダー・VAE・LoRAを確認して選択し、OKを押してください。一意に見つかるモデルは自動入力されますが、初回は設定で確認してください。モデルの自動ダウンロードは行いません。

画面は開いた時点のComfyUIロケールに合わせ、日本語では日本語、英語では英語で表示します。エディター内の **設定 → 言語** でも変更できます。操作ボタンにマウスを重ねると説明が表示されます。

**English quick start:** Open **Settings → P-H3 models** first. Check/select your installed diffusion model, text encoder, VAE and LoRA, then click OK. Unique installed matches may be filled automatically; no models are downloaded. The editor follows the ComfyUI locale when opened (Japanese or English). You can also change **Settings → Language**. Hover over controls for help.


### 画像を開いて部分生成

1. **画像を追加**で元画像を読み込みます。投げ縄、矩形、楕円、選択ブラシで生成範囲を指定します。
2. 導入済みモデルの名前が既知のP-H3ファイル名と一意に一致する場合、**モデル選択は自動的に入力**されます。不明・重複の場合は**設定 → P-H3モデル**で手動選択します。モデル未設定の場合は下部に設定への案内が表示され、設定内で不足項目を確認できます。
3. 「赤いリンゴを手のひらに置く」などの指示を入力して、**選択範囲**モードで生成します。
4. 結果は候補として記録されます。自動採用がONで編集状態が変化していなければ、新しい画像レイヤーとして追加します。自動採用をOFFにすると、候補から明示的に採用します。
5. **保存・ノードへ適用**で編集状態と原寸合成画像を保存します。その後ComfyUIの通常のQueueで、後続ノードへ画像を渡せます。

生成中に画像・選択範囲・指示等を変更すると、古い結果を自動反映しません。候補は残り、確認した上で手動追加できます。編集元の画像は直接書き換えません。

### 白紙から生成

**新規**で作品を作り、必要に応じて**設定 → キャンバス**でサイズを指定し、生成モードを**新規画像**にします。文章から生成した画像が同じキャンバスへ追加され、そのまま文字・吹き出し・画像編集を続けられます。新規画像モードでは参照画像を渡しません。P-H3に画像を渡すと最初の画像が編集対象になるためです。

### ComfyUIから画像を受け取る

`Load Image`や生成済み画像の`IMAGE`をPH3 Image Toolの`image`へ接続し、一度通常のQueueを実行します。エディターの**入力画像を取り込み**を押すと、実際に上流から渡された画像を追加できます。接続しただけでは未実行のテンソルを取得できません。バッチ入力は先頭1枚を編集対象とします。

## 編集機能

| 分類 | 実装内容 |
|---|---|
| 画像レイヤー | PNG/JPEG/WebP読込、ドラッグ&ドロップ、位置・倍率・回転・不透明度、表示・ロック・順序・複製・削除 |
| 選択範囲 | 矩形、楕円、投げ縄、ブラシ、マスク消しゴム、追加・除外・共通範囲、反転・解除 |
| 文字・装飾 | 横書き・縦書き、太字・斜体・縁取り、6文字スタイル、11吹き出し、16文字SFX、10シンボル、画像スタンプ、6集中線、8フレーム |
| 漫画変換 | グレースケール・白黒2値・漫画・XDoG・ソフト漫画・網点漫画。元アプリの計算をWeb Workerで処理し、原寸の新レイヤーへ追加。従来CPUプリセットも保持 |
| 背景削除 | 指定色とつながる領域の透明化、選択範囲を残す切り抜き、導入済みISNet ONNXによる任意のAI削除 |
| 保存 | サーバー上の作品保存、ブラウザー下書き、可搬`.ph3tool`プロジェクト、PNG/JPEG/WebP画像書き出し |
| 設定 | 日本語/英語、明暗テーマ、キャンバス、履歴上限、生成モデル、原文/AI文、参照画像の役割、seed、Sampler、sigma列、生成解像度上限、周辺余白、境界ぼかし、書き出し形式 |

既存Speech Bubbleシリーズの全素材・全設定をそのまま移植したものではありません。同梱装飾は文字・手続き的図形と、元アプリから移植した2種類の吹き出しSVGパスを中心とする軽量セットです。元アプリの全ラスター素材集を一括移植した版ではありません。任意のPNG/WebP等は**スタンプ画像**から追加できます。第三者フォントは同梱しません。ブラウザーから利用できるインストール済みフォント名を指定してください。

**別画面のQuick Retouch、4コマ・漫画ページ、PSD、`.sbeproj`互換は含めません。** 本ツールのブラシは主に生成範囲の指定用で、一般のペイントブラシではありません。

## 生成モデルの設定

以下は今回の入力ワークフローに対応するファイル名の例です。実際にインストールされているファイルを設定画面から選択します。モデルの置換やダウンロードは自動で行いません。

| 項目 | ファイル名の例 | ComfyUI models配下 |
|---|---|---|
| Diffusion model | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `diffusion_models` |
| Text encoder | `p-h3-image_text_encoder_int8_convrot.safetensors` | `text_encoders` |
| VAE | `p-h3-image_vae_int8_convrot.safetensors` | `vae` |
| P-H3 LoRA | `p-h3-image_lora_bf16.safetensors` | `loras` |
| 任意の文章補助 | `p-h3-image_prompt_upsampler_w4a8.safetensors` | `text_encoders` |

LoRA強度は1.0、H3のvideo/audio shiftは両方1.0です。標準Samplerは`er_sde`、sigma列は次の通りです。

```text
1.0, 0.984753, 0.967905, 0.951688, 0.925372, 0.881923, 0.810083, 0.528718, 0.0
```

編集キャンバスの寸法と生成寸法は別です。初期の生成上限は1.0MPで、元の切り出しを縦横32のグリッドへ縮小して生成し、全生成範囲を元の座標へ戻します。上限は0.25〜8.5MPで設定できますが、この設定は16GB GPUでの動作・速度・品質を保証するものではありません。モデルによって小さい生成寸法の品質が悪い可能性もあるため、実機で調整してください。モデル読込自体の必要メモリーは解像度を下げても残ります。

### 原文とAI文

**AI文を生成**は文章補助だけを別のComfyUIジョブとして実行します。画像生成は開始しません。原文は保持し、AI文を編集するか原文へ戻してから画像を生成できます。補助の結果を自動採用できない場合も、結果から明示的に取り込めます。

### 部分生成の意味

P-H3には、この経路で使用する専用の選択マスク入力はありません。選択範囲と周辺を含む画像を通常の画像編集として生成し、戻った画像をマスクで合成します。モデル自身が選択内だけを変更する保証ではありません。

適用マスクは元の選択の内側へぼかします。したがって、元の選択が0の画素には生成画像を合成しません。生成前後の色や境界、手や指との接触の自然さは別途評価が必要です。リンゴと手の接触影まで必要なら、その部分も選択してください。結果は「リンゴだけの透明オブジェクト」とは限らず、手や背景を含む編集パッチです。

画像レイヤー、適用マスク、元の生成結果を分けて保存します。通常の生成画像は、既存の文字・装飾より下に追加します。文字を生成入力へ含める設定をONにすると、文字が絵へ焼き込まれ、編集可能な文字と重複する場合があります。

## 背景削除

通常の色指定・選択範囲による切り抜きは追加依存なしで使用できます。

任意のAI削除は、ComfyUI環境に`onnxruntime`が既に存在し、以下のモデルが利用者により配置されている場合のみ選択できます。

```text
ComfyUI/models/rembg/isnet-general-use.onnx
```

CPU実行です。モデルやライブラリの自動ダウンロードは行いません。この版ではAIモデル推論を実機検証していません。モデルごとの利用条件を確認してください。BiRefNet等の任意ONNXとの互換性はありません。

## 保存と出力

標準保存先は `ComfyUI/user/default/ph3_image_tool/` です。ComfyUIのuserディレクトリー設定に従います。画像・マスクをPNGで保持し、同一内容の画像はハッシュで共有します。世代の違う作品への上書きを拒否し、別作品としての保存を用意しています。

`.ph3tool`には編集状態と、その作品から参照される画像・マスク・生成元情報をまとめます。サーバーに残っている未採用候補全体は含みません。Undo/Redo履歴は現在の編集セッション内だけです。再開時はレイヤー・選択・設定から再編集できます。自動の不要ファイル削除は行いません。

| ノード出力 | 内容 |
|---|---|
| `image` | 保存した原寸合成画像のRGB |
| `alpha` | 白=不透明、黒=透明のマスク。LoadImageの透明部分マスクとは向きが異なります |
| `selection` | 白=現在の選択、黒=非選択 |

透明画像をそのまま保存するときはエディターからPNGまたはWebPで「透過を維持」をONにして書き出してください。標準SaveImageへRGBだけを接続してもアルファは保存されません。

画像合成はブラウザーのCanvasで原寸描画し、形式ごとの最終圧縮はComfyUI環境の既存Pillowで行います。プレビューに使ったバイト列をそのままダウンロードするため、表示容量は実エンコード結果です。**PNG/JPEG/WebPへComfyUIワークフロー情報を自動埋め込みする機能はありません。** 再編集には`.ph3tool`、後段の生成情報付き保存には別の保存ノードを使います。

## 運用上の制約

- 信頼できる単一利用者のローカルComfyUIが対象です。複数ユーザーの作品分離・認証は提供しません。公開サーバー用ではありません。
- 停止操作は本ツール自身の待機ジョブの取消と自動採用停止です。実行中のジョブを止めるためにComfyUI全体のinterruptを呼びません。他ジョブを巻き込まないためです。
- 生成候補の追加は未保存変更です。採用後に**保存・ノードへ適用**してください。
- 編集上限は8192px/辺かつ16,777,216画素、256レイヤーです。表示用プレビューは縮小し、原寸書き出しは別に処理します。大量の大画像ではブラウザーメモリーが必要です。
- 保存画像は8bit RGBA PNGです。HDR、広色域、完全なICC色管理は対象外です。
- 同じワークフローの別ノードが同じ作品を参照する場合、競合時に自動上書きせず再読込を要求します。

## 開発・検証

ComfyUI相当の既存依存がある環境で実行します。

```powershell
python -m unittest discover -s tests -p "test_*.py"
node --test tests/*.test.mjs
```

Chromium画面試験には開発環境に既に導入されたPlaywrightとChromiumが必要です。製品のランタイム依存ではありません。

```powershell
python tests/browser_smoke.py --output ./browser-evidence
python tests/browser_brushup.py --output ./brushup-evidence
```

[設計](docs/ARCHITECTURE.md) / [検証](docs/VALIDATION.md) / [実機受入チェック](docs/ACCEPTANCE.md) / [GitHubへの配置](docs/PUBLISH.md)

## English

A local, single-image P-H3 generation and layered editing custom node. Open the editor from the **PH3 Image Tool** node, select installed model files, and use new-image, full-image or selection editing. Generation uses ordinary ComfyUI API graphs and its existing queue, not a nested sampler. Crop results are returned as new masked image layers. Text, speech bubbles, procedural SFX/symbols, image stamps, focus lines, frames, CPU comic conversion, cutout, project archives and export share one editor.

The user reported the preceding rc2 works with their supplied workflow. This rc3 preserves its generation and node contracts while adding graphical galleries, source-resolution comic/cutout previews, view navigation and actual PNG/WebP/JPEG encoding controls. Python/Node tests and 44 isolated Chromium checks passed; generation responses in the regression harness are simulated. This build has not been revalidated in the user’s live ComfyUI/Windows/GPU environment or with optional ISNet inference. No dependency/model downloads occur automatically. Intended for a trusted single-user local ComfyUI server. No PSD, legacy `.sbeproj`, four-panel pages, or separate Quick Retouch workspace.

## License

MIT for this package's code. Model weights, fonts and third-party materials retain their own terms. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
# 白黒漫画仕上げ（ローカル manga.1）

MangaScreen方式の白黒仕上げ、4枚の透明レイヤー分離、PH3漫画化から仕上げ候補への連携を追加しました。元画像と文字・吹き出しを保持します。[操作と検証範囲](docs/MANGA_FINISH_JA.md)。PH3実GPU品質は未検証です。



## パネルと素材一覧（ローカルUI更新）

- 左側の「集中線」「フレーム」から一覧を直接開きます。移植元の集中線4種類・白枠/黒枠2種類と追加フレームを利用でき、追加したレイヤーのプロパティから設定・プリセットを変更できます。
- 「プロパティ」「レイヤー」「履歴」はフローティングパネルの表示切替です。ヘッダーで移動、右下でサイズ変更、×で閉じます。位置・サイズ・表示状態をブラウザーに保存します。「元の位置へ」で一体表示に戻せます。一体表示中のタブをもう一度押すと浮動表示に戻ります。
- 履歴は必要なときだけ表示します。停止済みで結果がないカードは一覧に表示しません。保存済みのジョブ記録や生成済み候補を削除する操作ではありません。
- 生成や参照画像の説明はボタンのマウスオーバーで表示します。言語変更時は固定ラベル・ツールチップ・フローティング見出しも更新します。

**Panels and libraries:** Open Focus lines or Frame from the left toolbar. Properties, Layers and History toggle floating panels. Drag the header, resize from the lower-right corner, or close with ×. Browser-local panel geometry and visibility are retained. Dock panel restores the integrated view; click its active tab again to float it. Empty cancelled jobs are hidden without deleting stored jobs or completed candidates. Hover over controls for help.

### 自動選択・色から選択 / Pixel selection
左の「自動選択」（W）は隣接した同系色を、「色から選択」は画像全体の同系色を選択します。ツール下の許容値（0–100）、表示レイヤー参照、境界を滑らかにする設定を調整できます。表示レイヤー参照をオフにすると選択レイヤーのみを参照します。Shift+クリックで追加、Alt+クリックで除外、Shift+Altで共通部分。上部の選択方式でも切替できます。選択はUndo/Redo・保存・背景削除・PH3部分編集で共通です。
Magic Wand (W) selects connected similar colors; Select by Color selects matching colors across the image. Set tolerance, sample merged and anti-alias below the tools. Shift adds, Alt subtracts and Shift+Alt intersects; the selection-operation menu offers the same modes. Disable Sample merged to sample the selected layer. Selections support undo/redo, saving, background removal and PH3 selection edits.

### 文字・レイヤー・分離パネル
「＋ 文字を追加」で文字レイヤーを作成してプロパティを表示します。文字色・アウトライン色にはそれぞれスウォッチ、サイズ・アウトライン幅にはスライダーがあります。レイヤー一覧は上ほど前面で、ドラッグまたは前面/背面ボタンで順序を変更できます。追加画像は文字・吹き出しより下に配置します。参照画像の点線枠へドロップすると参照、キャンバスへドロップすると画像レイヤーになります。右上の「プロパティ/レイヤー/履歴を浮かせる」ボタンで分離し、パネルの「元の位置へ」で戻します。未設定時は一体表示、保存済みの表示方式は保持します。
Add text opens its Properties. Drag layer rows to reorder (top is front); imported images stay below text and bubbles. Drop images into the dashed References area to add references, or onto the canvas to add image layers. Use the explicit Float properties / Float layers / Float history buttons to detach panels and Dock panel to return. Saved panel preferences are retained.
