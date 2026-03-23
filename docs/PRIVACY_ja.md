# プライバシーポリシー

**最終更新日:** 2026-03-23

ProvNote はオープンソースのクライアントサイドノートエディタです。このポリシーでは、アプリケーションがデータをどのように扱うかを説明します。

## ProvNote について

ProvNote は、プロヴェナンス（来歴）追跡機能付きのブロックベースノートエディタです。Google Drive との連携機能があります。すべての編集処理はブラウザ上で行われ、バックエンドサーバーは存在しません。

## データ収集

**ProvNote は個人データを一切収集・保存・送信しません。**

- アクセス解析やトラッキングなし
- Cookie なし（Google 認証に必要なものを除く）
- サーバーへのデータ保存なし — すべてブラウザ内で処理

## Google Drive 連携

Google でサインインすると、以下の権限を要求します：

- **`drive.file`** — ProvNote が作成したファイル、またはユーザーが ProvNote で明示的に開いたファイルのみにアクセス

### これが意味すること：

- ProvNote が作成したファイルの読み書きが**できる**
- それ以外の Google Drive 上のファイルには**アクセスできない**
- Google のアクセストークンは `sessionStorage` にのみ保存（ブラウザタブを閉じると削除）
- リフレッシュトークンは保存しない
- [Google アカウントの権限設定](https://myaccount.google.com/permissions)からいつでもアクセスを取り消せる

## データの保存先

| データ | 保存先 |
|--------|--------|
| ノート（ローカルモード） | ブラウザの localStorage |
| ノート（Drive モード） | Google Drive 内の「ProvNote」フォルダ |
| 認証トークン | ブラウザの sessionStorage（一時的） |
| 個人情報 | どこにも保存しない |

## サードパーティサービス

ProvNote が利用するサービス：

- **Google Identity Services** — OAuth 2.0 認証
- **Google Drive API** — ファイル保存（サインイン時のみ）

その他のサードパーティサービスは使用していません。

## 子どものプライバシー

ProvNote は 13 歳未満の子どもから意図的に情報を収集することはありません。

## ポリシーの変更

変更があった場合は、このファイルを更新し「最終更新日」に反映します。

## お問い合わせ

このポリシーに関するご質問は、[GitHub リポジトリ](https://github.com/kumagallium/provnote)の Issue からお願いします。

## オープンソース

ProvNote は MIT ライセンスのオープンソースソフトウェアです。ソースコードは [https://github.com/kumagallium/provnote](https://github.com/kumagallium/provnote) で公開しています。
