# Defender 自動取得・接続テスト

Google CloudのCloud Shellで、自分のInControlアカウントにログインし、短時間の接続で必要な車両情報が届くかを確認します。

**これは自動更新版の完成品ではなく、接続検証用です。** 現在のScriptableウィジェットにはまだ接続されません。テスト成功後、認証付きのCloud Run取得処理とウィジェットの通信機能を実装する必要があります。

## GitHubから実行（おすすめ）

[Cloud Shell](https://shell.cloud.google.com/)で、次を実行してください。

```bash
git clone https://github.com/ducat595/Landrober.git
cd Landrober/cloud-test
bash run.sh
```

すでにcloneしている場合は、既存のLandroberフォルダで `git pull --ff-only` を実行してから `cd cloud-test` → `bash run.sh` を実行します。

## ZIPを使ってiPhoneから実行する場合

1. `defender-cloud-test.zip` をiPhoneの「ファイル」に保存します。
2. Safariで [Cloud Shell](https://shell.cloud.google.com/) を開きます。必要ならSafariの「デスクトップ用Webサイトを表示」に切り替えます。
3. Cloud Shellのメニュー「⋮」→「アップロード」からZIPをアップロードします。ホームディレクトリに保存してください。
4. 次のコマンドを実行します。

```bash
unzip defender-cloud-test.zip
cd defender-cloud-test
bash run.sh
```

5. InControlのメールアドレス・パスワードを入力します。入力中は画面に表示されません。必要に応じてJLRから届くメールの確認コードを入力します。Google Cloudのパスワードではありません。
6. 複数の車両があれば、車台番号の末尾4桁を見て対象を選択します。
7. 車両一覧の取得後、最大45秒、車両データを待ちます。準備やログインを含めた全体の実行時間は45秒より長くなります。

終了コード2でシェルに戻る場合は、一部または全部の項目が受信できなかったことを意味します。表示された結果を確認してください。

このスクリプトは、Google CloudのVM、Cloud Run、ストレージ、スケジューラ、APIキーなどを作成しません。Cloud Shell内でPythonの仮想環境を作り、PyPIからaiohttpをインストールし、JLRの認証サーバー・車両一覧API・テレメトリーへ接続します。

## 結果の見方

最後に表示される「共有用の結果」だけをチャットに貼り付けてください。各項目のtrueは、その項目の値が読み取れたことを意味します。車の状態そのものを表すtrue/falseではありません。

- `result: all_fields`：燃料・航続距離・オドメーター・ロックの4項目を取得。
- `result: partial`：一部の項目を取得。
- `result: no_fields`：必要な項目は未取得。
- `telemetryConnected`：テレメトリーの接続が確立したか。
- `elapsedSeconds`：テレメトリーを待った時間。ログインや車両一覧取得の時間は含みません。
- `vehicleTimestampPresent`：車両情報側に時刻の項目があったか。各項目やロック状態の鮮度を保証するものではありません。

共有用レポートにはメール、VIN、ナンバー、位置、トークン、車両の実数値は含めません。失敗した場合はエラー名が表示されます。その名前だけを共有してください。

## 2回目の取得テスト

最初の成功だけでは継続運用できるかはわかりません。1回目を終えてから数分後に、同じCloud Shellで次を実行します。

```bash
bash run.sh
```

保存した更新用トークンで再取得します。再ログインが必要な場合は次を使います。

```bash
bash run.sh --login
```

受信待ちを長めにしたい場合は `bash run.sh --wait 90` を使えます。複数プロセスで同時に実行しないでください。更新用トークンは利用のたびに変わるため、同時実行をロックで防いでいます。

## 保存されるもの

作業フォルダの `.state` に次を保存します。フォルダは所有者だけがアクセスでき、ファイルは所有者だけが読み書きできます。アプリ独自の暗号化はしていません。

- `auth.json`：メール、デバイスID、ユーザーID、更新用トークン。パスワードとメール確認コードは保存しません。
- `snapshot.json`：取得した燃料・距離・ロック状態、受信時刻、車両側の時刻。ナンバーは取得しません。
- `report.json`：共有用の取得成否レポート。

`.state` はGitに登録しない設定です。GitHub Pages等へアップロードしないでください。テストの保存情報を削除するには、作業フォルダで次を実行します。

```bash
rm -r .state
```

## 現在の制約と次の判断

- 非公式連携のため、この車両・アカウントで動くかは実行するまでわかりません。JLR側の変更で停止する可能性もあります。
- ロック操作、解錠操作、車両を起こす操作は実行しません。取得値はJLRが最後に保持した状態であり、キーで操作した直後に反映されるとは限りません。
- 受信した時刻を「車両の最終更新時刻」と扱いません。車両側の時刻がなくても、勝手に現在時刻で補いません。
- オドメーターはJLRの `ODOMETER_MILES` をkmに換算します。燃料航続距離 `DISTANCE_TO_EMPTY_FUEL` はkmとして扱います。実際のRemoteの表示と一致するか、本人の画面で確認してください。
- 短時間で2回取得できれば、Cloud Runを必要なときだけ起動する構成の候補になります。Cloud Runの起動時間、トークンの永続化、通信量、ビルド、保存領域なども含めた料金確認はその後に行います。現時点で本番環境の料金0円は保証しません。
- Cloud Shellは無料ですが常時稼働用ではありません。今回は手動で短時間の接続を試すためだけに使います。
- この環境では実アカウントへの接続をしていません。構文と模擬応答での受信・保存・タイムアウト処理を検証しています。

## 出典

- [Cloud Shell料金](https://cloud.google.com/shell/pricing)
- [Cloud Shellの制限](https://docs.cloud.google.com/shell/docs/quotas-limits)
- [Cloud Run料金](https://cloud.google.com/run/pricing)
- [非公式JLR連携の原作者リポジトリ](https://github.com/willbeeching/ha-jlr-incontrol)

`vendor` にMITライセンスの通信モジュールを固定コミットから同梱しています。出典と改変内容は `vendor/NOTICE.md`、ライセンスは `vendor/LICENSE` を参照してください。
