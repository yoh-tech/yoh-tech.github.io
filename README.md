# yoh-tech.github.io

YOH-TECH Corp.（個人事業主）の公式サイトです。GitHub Pages でホスティングしています。

- `/` — トップページ（YOH-TECH Corp. Studio）
- `/support/` — サポートページ一覧（アプリ選択ハブ）
- `/support/fx-lot/` — FX Lot 計算機 のサポートページ
- `/support/fx-lot/privacy.html` — FX Lot 計算機 のプライバシーポリシー
- `/support/okurinko/` — おくりん子 のサポートページ
- `/support/okurinko/privacy.html` — おくりん子 のプライバシーポリシー

両アプリとも提供元は Bitpark株式会社、開発は YOH-TECH Corp.（Yoichiro Taki）です。

## 公開前にやること

1. `index.html` のApp Storeリンク(`href="#"`)を実際のリンクに差し替える
2. 各アプリの `support/<app>/index.html` にあるFAQ・お問い合わせフォームのURL・対応OS/バージョン情報を実際の内容に差し替える
3. 各アプリの `support/<app>/privacy.html` を **Bitpark株式会社の確認・承認を得たうえで**、実際にアプリが収集する情報に合わせて見直す（App Store提出に必須）

## ローカル確認

```bash
python3 -m http.server 8000
# http://localhost:8000 を開く
```
