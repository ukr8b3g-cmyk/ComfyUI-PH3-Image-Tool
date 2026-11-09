# 公開とリリース

正本: [ukr8b3g-cmyk/ComfyUI-PH3-Image-Tool](https://github.com/ukr8b3g-cmyk/ComfyUI-PH3-Image-Tool)。2026-11-10、利用者が公開へ変更したことを接続済みGitHubツールで確認。v0.9.0から公開リリースを行います。

`tools/publish_private.ps1`は初回private作成用の旧補助であり、既存リポジトリでは使用しません。Codexのリモート確認/反映は接続済みGitHubツールを使います。

バージョンはpyproject、Python登録、API、画面表示を揃えます。Node/Python検証、モジュールキャッシュ更新、MANIFEST更新、`tools/release_package.py`でZIP内容を照合してコミットします。

mainのpyproject更新でGitHub Actionsが起動し、回帰テスト→Manifest検証→決定的ZIP作成→タグ/ReleaseとZIP・SHA256SUMSを公開します。同じReleaseがある場合は上書きしません。Actionsは手動実行も可能です。フォント・重み・利用者作品は含めません。Manager/Registry登録とリポジトリ公開設定の変更は別操作です。

4コマ対応は未確定の検討事項であり、リリースの機能や実装予定として約束しません。
