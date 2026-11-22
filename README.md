<a id="readme-top"></a>

<div align="center">

<h1>colab-status</h1>

<p>
  <b>Colab で焼いている間、進み具合と料金の目安が見える。</b><br>
  Claude Code の入力欄の右下に、Colab の画像・動画・音楽の生成の進み具合、VM が立ってからの時間、円の目安を出す mod です。
</p>

[![Claude Code][claude-shield]][claude-url]
[![TypeScript][ts-shield]][ts-url]
[![Platform][platform-shield]](#前提)
[![Version][version-shield]](src/colab-status/.claude-plugin/plugin.json)
[![MIT-0 License][license-shield]](LICENSE)

<img src="docs/screenshot.png" alt="Claude Code の入力欄の右下に、Colab の画像生成の行と進み具合のバーが出ている画面" width="720">

<sub>画面は見本のデータを渡して撮ったものです。表示の部分は本物の mod がそのまま描いています。</sub>

<p>
  <a href="#導入">導入</a>
  ·
  <a href="#使い方">使い方</a>
  ·
  <a href="https://github.com/takamiya1021/colab-status/issues">不具合の報告・要望</a>
</p>

</div>

> **English summary** — A Claude Code mod that shows, at the lower right of the prompt, the progress of a running Google Colab generation chain (image / video / music skills), the minutes since the VM came up and a yen estimate for an A100. It reads `/proc` and the chain's own log every 10 seconds, never calls the Colab CLI, and shows nothing when no chain runs. Linux (including WSL2) only. UI text is in Japanese.

<details>
<summary><b>目次</b></summary>

- [この mod について](#この-mod-について)
- [前提](#前提)
- [導入](#導入)
- [使い方](#使い方)
- [何を読んでいるか](#何を読んでいるか)
- [注意](#注意)
- [開発](#開発)
- [不具合の報告・要望](#不具合の報告要望)
- [利用条件](#利用条件)

</details>

## この mod について

Colab で画像や動画を焼いている間は、どこまで進んだか、VM が立ってから何分たったかを、聞かないと分かりません。ログの行も流れていきます。この mod を入れると、**焼いている間だけ右下に 2 行が出て、終わると消えます**。

- **自動で出て、自動で消える** — 設定はありません。焼いていない時は何も出しません
- **料金の目安つき** — VM が立ってからの分を、A100 の実消費で円に直して出します
- **VM が立つ前は課金なしと分かる** — VM を待っている間は「VM 待ち（まだ課金なし）」と出ます
- **表示だけ** — colab CLI を呼ばず、課金・ログイン・VM の操作には触りません

<p align="right">(<a href="#readme-top">先頭へ</a>)</p>

## 前提

| 要るもの | 無いとどうなるか |
|---|---|
| **Claude Code**（mod＝フックモジュールのプラグインが使える版。2.1.325 と 2.1.330 で確認） | 入れられません |
| **Linux**（WSL2 を含む）。動いている処理を `/proc` から読みます | macOS とネイティブの Windows では何も出ません |
| **`python3`**（PATH にあること） | 何も出ません |
| **状態を出す相手のスキル**（下の 3 つ。置き場所はどこでもかまいません） | 何も出ません |

今出せるのは、次の 3 つのスキルの鎖です。

| スキル | 種類 | 鎖のスクリプト |
|---|---|---|
| `run-h3-image` | 画像（MiniMax H3-Image） | `chain_h3image*.sh` |
| `run-h3-video` | 動画（MiniMax H3） | `chain_h3_all.sh` / `chain_h3_ref2va.sh` / `chain_ctxloop.sh` |
| `run-minimax-music` | 音楽 | `chain_music*.sh` |

## 導入

Claude Code のターミナルの入力欄で:

```
/plugin install colab-status --marketplace takamiya1021/colab-status
```

`Add marketplace?` と聞かれたら `y`、入れる範囲（scope）は user のまま Enter で入ります。

<details>
<summary>シェルから入れる・外す</summary>

シェルからなら:

```bash
claude plugin install colab-status --marketplace takamiya1021/colab-status
```

外す時は:

```
/plugin uninstall colab-status
```

</details>

<p align="right">(<a href="#readme-top">先頭へ</a>)</p>

## 使い方

入れたら何もしなくてかまいません。スキル（`/run-h3-image` など）で焼き始めると右下に出て、VM を止めて鎖が終わると消えます。

```
☁ Colab 画像 my-job　VM 5分・約 7 円
[████████████████████████████░░]  91%  生成 5/8 pose_time_a（edit 864x1152）  画像 4/8
```

- **1 行目**: 種類（画像・動画・音楽）・ジョブの名前・VM が立ってからの分・円の目安。VM が立つ前は「VM 待ち（まだ課金なし）」
- **2 行目**: そのスキルの進捗スクリプトが出す進み具合
- 10 秒ごとに読み直します。鎖が 2 本動いていれば 2 組出ます

円の目安は、A100 80GB high-mem の実消費 6.55 CU/時 × 1 CU = 11.79 円で計算しています。実際に引かれた CU は、Colab の使用量のページで確かめてください。

<p align="right">(<a href="#readme-top">先頭へ</a>)</p>

## 何を読んでいるか

1. `/proc/<pid>/cmdline` から、上の表の鎖のスクリプトを `bash` で動かしている処理を探します
2. その処理の環境変数 `OUT`（書き先）・`JOB`（ジョブの名前）・`GPU` を `/proc/<pid>/environ` から読みます
3. `OUT/chain.log` の `[chain] new rc=0`（VM が立った行）の時刻から、VM が立ってからの分を出します
4. 鎖のスクリプトと同じフォルダにある進捗スクリプト（`h3image_progress.py` / `progress_bar.py`）を `--once` で呼び、最後の 1 行を 2 行目に出します

colab CLI は呼びません。ネットワーク通信・ファイルへの書き込みもしません。

## 注意

- **円は目安です。** `GPU` が `A100` 以外の時は円を出しません
- **表示の位置**: 全画面（`/tui fullscreen`）でも通常の表示でも、ステータス行の右端に出ます。ほかの mod が同じ場所に出している時は、その下に並びます
- **表示の遅れ**: 読み直すのは 10 秒おきです。始まりや終わりが表示に出るまで最大 10 秒ほどかかります
- **表示だけ**: VM を止める・立てるなどの操作はしません。止め忘れの見張りは、この mod の役目ではありません

## 開発

```bash
claude plugin validate src/colab-status        # 書式の確認
claude --plugin-dir src/colab-status           # この mod を読み込んで Claude Code を起動
```

<details>
<summary>ファイルの構成</summary>

```
.claude-plugin/
  marketplace.json         # /plugin install で入れるための目録
src/colab-status/
  .claude-plugin/plugin.json
  hooks/hooks.json         # 読み込むモジュール
  hooks/register.tsx       # 本体（状態を読む Python を埋め込み、右下に描く）
  types/index.d.ts         # 状態の型
docs/screenshot.png        # README の画面
```

</details>

## 不具合の報告・要望

[Issues](https://github.com/takamiya1021/colab-status/issues) へどうぞ。表示がおかしい時は、`ps -eo pid=,args=` のうち `chain_` を含む行と、`OUT/chain.log` の先頭の数行を添えてもらえると助かります。

## 利用条件

MIT No Attribution（MIT-0）です。自由に使ってかまいません。改変・再配布・商用いずれも可で、作者表記も要りません。動作や結果は保証しません。全文は [LICENSE](LICENSE) にあります。

<p align="right">(<a href="#readme-top">先頭へ</a>)</p>

<!-- バッジのリンク -->
[claude-shield]: https://img.shields.io/badge/Claude_Code-mod-D97757?style=for-the-badge&logo=anthropic&logoColor=white
[claude-url]: https://docs.claude.com/en/docs/claude-code/overview
[ts-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[ts-url]: https://www.typescriptlang.org/
[platform-shield]: https://img.shields.io/badge/Linux_%2F_WSL2-FCC624?style=for-the-badge&logo=linux&logoColor=black
[version-shield]: https://img.shields.io/badge/version-0.2.1-2ea44f?style=for-the-badge
[license-shield]: https://img.shields.io/badge/license-MIT--0-blue?style=for-the-badge
