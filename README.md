# Defender 2025 iPhone ウィジェット

2025年式ディフェンダー向けのScriptableウィジェットと、Google Cloudで自動取得を検証する接続テストです。

**現在のウィジェットは手入力版です。Remoteからの自動取得はまだ接続されていません。** まずCloud Shellで車両データの取得を確認し、成功した場合にCloud Run経由の自動更新へ進めます。

## iPhoneのウィジェット

- 燃料残量・航続距離・ロック状態・オドメーターを表示
- ナンバー・最終確認日時を表示
- ディフェンダーの写真を背景に設定
- タップでショートカット経由でRemoteを起動

[スクリプト](scriptable/Defender.js)をScriptableに登録し、[設定手順](scriptable/README.md)に従ってください。

背景画像として使える[サントリーニブラックの生成イメージ](assets/defender-santorini-black.png)も同梱しています。Defender 110を参考にした生成画像で、実車の写真や仕様の正確な再現ではありません。画像をiPhoneの「写真」に保存してから、スクリプトの「ディフェンダーの画像を設定」で選択します。

![サントリーニブラックのディフェンダーの生成イメージ](assets/defender-santorini-black.png)

## 自動取得の接続テスト（Cloud Shell）

[Google Cloud Shell](https://shell.cloud.google.com/)で次を実行します。

```bash
git clone https://github.com/ducat595/Landrober.git
cd Landrober/cloud-test
bash run.sh
```

InControlのメール・パスワード・必要に応じてメール確認コードを、Cloud Shellの入力欄に入れます。Google CloudのVMやCloud Runは作成しません。接続成功後も常時稼働や自動更新は開始されません。

最後の「共有用の結果」は取得できた項目の成否だけを表示します。パスワードやトークンをチャットやGitHubへ貼らないでください。[接続テストの詳細](cloud-test/README.md)

## 状況と制約

| 項目 | 状況 |
| --- | --- |
| 手入力のウィジェット | ソース実装済み、模擬環境で検証済み |
| 写真背景・Remote起動ショートカット | ソース実装済み、iPhone実機確認は未実施 |
| 車両データの接続テスト | ソース実装済み、実アカウント確認待ち |
| Cloud Runでの自動取得 | 未実装 |
| ウィジェットへの自動反映 | 未実装 |

非公式JLR連携はメーカー側の制限で停止する可能性があります。ロック状態は最後に報告された値で、現在の施錠を保証しません。iOSのウィジェット更新頻度もOSが決めます。Cloud Runを使う本番運用が無料枠に収まるかは、取得時間と構成を検証して判断します。

## ローカル検証

```bash
node tests/verify-widget.cjs
python3 -m venv .venv
.venv/bin/python -m pip install -r cloud-test/requirements.txt
.venv/bin/python -m unittest discover -s cloud-test -p 'test_*.py' -v
bash -n cloud-test/run.sh
```

JLR通信モジュールの出典・改変内容は[NOTICE](cloud-test/vendor/NOTICE.md)、第三者コードのライセンスは[MIT License](cloud-test/vendor/LICENSE)に記載しています。
