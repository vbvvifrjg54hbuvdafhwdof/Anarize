# Anarize（アナライズ）

答案の写真やPDFを送るだけで、**知識不足（単元別ノート）**と**不注意ミス（傾向ログ）**を自動で切り分けて記録・整理する、サーバーレス・ブラウザ完結型の大学受験向けPWAアプリです。

## 主な特徴

- **完全ブラウザ完結型**: バックエンドサーバーを持たず、ブラウザから直接 Google Gemini API（`gemini-4-hydrogen`）を呼び出します。
- **端末内保存（IndexedDB）**: 知識項目・単元フォルダ・ミスの傾向・添削履歴・整理提案・操作ログ・設定はすべてブラウザ内の IndexedDB に保存されます。APIキーは `localStorage` にのみ保存され、ビルド成果物やソースコードには一切含まれません。
- **PWA（オフライン対応・ホーム画面追加）**: iPhone / iPad（Safari）、Android / PC（Chrome / Edge）でホーム画面にインストールでき、オフライン時でも知識ノート・傾向・履歴の閲覧や PDF / Anki 出力が行えます。
- **多彩な入力と出力**: スマホ背面カメラ／PC Webカメラ撮影（複数ページ・縮小JPEG圧縮）・PDF入力に対応し、復習シートの PDF 出力（赤シート対応・段組・サイズ指定）および Anki 用 TSV 出力が行えます。

---

## GitHub Pages での公開手順

1. GitHub で新しいリポジトリを作成し、このプロジェクトのコードを `main` ブランチへ push します。
2. リポジトリの **Settings** → **Pages** を開きます。
3. **Build and deployment** の **Source** を **「GitHub Actions」** に変更します。
4. `main` ブランチへの push をトリガーに `.github/workflows/deploy.yml` が自動実行され、`npm ci` → `npm run build` → `dist/` のデプロイが完了します。
5. ワークフロー完了後、**Settings → Pages** に表示される公開 URL（`https://<ユーザー名>.github.io/<リポジトリ名>/`）からアクセスできます。

> **注記**: ワークフロー実行時はリポジトリ名を自動検出して `BASE_PATH=/<リポジトリ名>/` でビルドされます。ローカルで特定のサブパス向けにビルドしたい場合は `BASE_PATH=/your-repo/ npm run build` を実行してください（未指定時のデフォルトは `/anarize/` です）。

---

## ローカル開発

```bash
npm install
npm run dev
```

ビルド確認:

```bash
npm run build
npm run preview
```
