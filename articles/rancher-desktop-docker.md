---
title: "Rancher Desktop ではじめる Docker 入門 - 自作アプリをコンテナで動かすまで"
emoji: "🐳"
type: "tech"
topics: ["docker", "rancherdesktop", "python", "flask", "コンテナ"]
published: false
---

## はじめに

「Docker をやってみたいけど、Docker Desktop って会社で使うとライセンス料がかかるんだっけ？」

そんな話を最近よく聞きます。実際、Docker Desktop は一定規模以上の企業だと有償なので、代替を探している人も多いと思います。

そこで今回は、無料で使える [Rancher Desktop](https://rancherdesktop.io/) を入れて、Docker の基本的なところをひと通り触りつつ、最終的に**自分で書いた Flask アプリをコンテナにして動かす**ところまでをやってみます。

「コンテナって結局なに？」というところから、「自分のコードが箱の中で動いた！」という体験までを一気にやるのがゴールです。手元で一緒に動かしながら読んでもらえると一番身につくと思います。

:::message
この記事は macOS (Apple Silicon) で動作確認しています。Windows / Linux でも Rancher Desktop は使えますが、インストール手順やパスは多少変わります。
:::

---

## Rancher Desktop とは

ざっくり言うと、**Docker Desktop の代わりになる無料のツール**です。

Docker のコマンド（`docker build` とか `docker run`）をローカルで使えるようにしてくれる、いわば「裏方」です。中では軽量な Linux VM が動いていて、その上で Docker（正確には Moby）が動いています。

特徴としてはこんな感じ。

- **オープンソースで無料**（ライセンス料を気にしなくていい）
- Docker CLI がそのまま使える（`docker` コマンドに慣れていれば移行も楽）
- Kubernetes も付いてくる（今回は使いませんが、後々 k8s を触りたくなったときに便利）
- GUI でコンテナやイメージを一覧できる

Docker Desktop からの乗り換え先としては一番無難な選択肢かなと思います。

---

## インストール

[公式サイト](https://rancherdesktop.io/) から自分の OS 用のインストーラをダウンロードして、普通にインストールするだけです。難しいところはありません。

初回起動時に「コンテナエンジンをどうするか」を聞かれます。ここは **dockerd (moby)** を選んでおきましょう。`docker` コマンドが使えるようになります。

起動するとこんなウェルカム画面が表示されます。左側のサイドバーから Containers や Images などの各画面に移動できます。

![Rancher Desktop の起動画面](/images/rancher-welcome.png)

画面下部のステータスバーに `CE:moby` と出ていれば、コンテナエンジンとして moby（dockerd）が選択されている状態です。

:::message
もう一つ `containerd` という選択肢もありますが、こちらを選ぶと `docker` ではなく `nerdctl` というコマンドになります。Docker に慣れる目的なら `dockerd (moby)` が無難です。
:::

Kubernetes は今回使わないので、設定でオフにしておくと起動が軽くなります。

起動が完了したら、ターミナルで確認してみましょう。

```bash
$ docker version
```

こんな感じでクライアントとサーバ両方のバージョンが出れば準備完了です。

```
Client:
 Version:           29.1.4-rd
 API version:       1.52
 ...
 Context:           rancher-desktop
Server:
 ...
```

`Context: rancher-desktop` になっているのがポイントです。Rancher Desktop 経由で Docker が動いている証拠ですね。

---

## まずは定番の hello-world

Docker を入れたらまずこれ、という定番があります。`hello-world` というお試し用のイメージです。

```bash
$ docker run --rm hello-world
```

`docker run` は「イメージからコンテナを作って実行する」コマンドです。`--rm` は「終わったらコンテナを自動で消す」オプション。

初回はイメージを持っていないので、Docker Hub から自動でダウンロード（pull）してきます。

```
Unable to find image 'hello-world:latest' locally
latest: Pulling from library/hello-world
58dee6a49ef1: Pull complete
Digest: sha256:96498ffd522e70807ab6384a5c0485a79b9c7c08ca79ba08623edcad1054e62d
Status: Downloaded newer image for hello-world:latest

Hello from Docker!
This message shows that your installation appears to be working correctly.
```

`Hello from Docker!` が出たら成功です。この時点で「Docker Hub からイメージを落としてきて、コンテナとして起動して、出力を返す」という一連の流れが動いています。

ちなみに出力の続きには、今まさに起きたことが丁寧に書いてあります。

> 1. Docker クライアントが Docker デーモンに連絡した
> 2. デーモンが Docker Hub から `hello-world` イメージを pull した
> 3. そのイメージからコンテナを作成して実行した
> 4. 出力をクライアントに返した

これがコンテナ実行の基本の流れです。

---

## 用語をさらっと整理

ここで一回、最低限の言葉を整理しておきます。完璧に覚えなくても、なんとなくのイメージで大丈夫です。

| 用語 | ざっくりした意味 |
|------|----------------|
| **イメージ (image)** | アプリと実行環境をまとめた「設計図」。読み取り専用のテンプレート |
| **コンテナ (container)** | イメージを元に起動した「実体」。実際に動いているプロセス |
| **Dockerfile** | イメージの作り方を書いたレシピ |
| **Docker Hub** | イメージの公開リポジトリ。GitHub のイメージ版みたいなもの |

「**Dockerfile** でレシピを書く → `build` で **イメージ** を作る → `run` で **コンテナ** として動かす」

この流れさえ掴めれば、Docker の 8 割は理解したようなものです。次はこれを実際にやってみます。

---

## 自作の Flask アプリをコンテナで動かす

ここからが本番です。「他人が作ったイメージを動かす」だけじゃなくて、**自分で書いたコードをコンテナにする**ところをやります。

題材はシンプルに、アクセスすると挨拶を返すだけの Flask アプリにします。

### ファイルを 3 つ用意する

適当なディレクトリを作って、その中に 3 つのファイルを置きます。

```
docker-demo/
├── app.py
├── requirements.txt
└── Dockerfile
```

まずはアプリ本体の `app.py`。

```python:app.py
from flask import Flask

app = Flask(__name__)

@app.route("/")
def hello():
    return """
    <html>
      <head><title>Docker Demo</title></head>
      <body style="font-family: sans-serif; text-align: center; padding-top: 80px;">
        <h1>🐳 Hello from Docker!</h1>
        <p>Rancher Desktop で動かした Flask アプリです</p>
      </body>
    </html>
    """

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
```

ポイントは `host="0.0.0.0"` のところ。コンテナの外からアクセスできるようにするために必要です（`127.0.0.1` だとコンテナの中からしか繋がりません）。

次に依存ライブラリを書く `requirements.txt`。

```text:requirements.txt
flask==3.0.0
```

### Dockerfile を書く

そしてメインの `Dockerfile`。これがイメージの「レシピ」です。

```dockerfile:Dockerfile
# ベースになるイメージ（Python 3.12 の軽量版）
FROM python:3.12-slim

# コンテナ内の作業ディレクトリ
WORKDIR /app

# 先に requirements だけコピーして install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリ本体をコピー
COPY app.py .

# 5000 番ポートを使うことを明示
EXPOSE 5000

# コンテナ起動時に実行するコマンド
CMD ["python", "app.py"]
```

各行を簡単に説明すると、

- `FROM` … 土台になるイメージ。今回は Python が入った公式イメージを使います
- `WORKDIR` … コンテナの中での作業フォルダを `/app` に設定
- `COPY` … ホスト側のファイルをコンテナの中にコピー
- `RUN` … イメージを作る途中で実行するコマンド（ここでは pip install）
- `CMD` … コンテナが起動したときに走るコマンド

:::message
`requirements.txt` を先にコピーして `pip install` し、その後でアプリ本体をコピーしているのには理由があります。Docker はレイヤーごとにキャッシュを効かせるので、アプリのコードだけ変えてもライブラリの再インストールが走らず、ビルドが速くなります。地味ですが効いてくるテクニックです。
:::

### イメージをビルドする

レシピが書けたら、`docker build` でイメージを作ります。

```bash
$ cd docker-demo
$ docker build -t docker-demo:latest .
```

`-t docker-demo:latest` はイメージに付ける名前（タグ）です。最後の `.` は「カレントディレクトリの Dockerfile を使う」という意味で、忘れがちなので注意。

ビルドが進むとこんな出力が流れます。

```
 => [1/5] FROM python:3.12-slim
 => [2/5] WORKDIR /app
 => [3/5] COPY requirements.txt .
 => [4/5] RUN pip install --no-cache-dir -r requirements.txt
 => [5/5] COPY app.py .
 => exporting to image
 => naming to docker.io/library/docker-demo:latest
```

`Dockerfile` の各ステップが順番に実行されているのがわかります。

できあがったイメージは `docker images` で確認できます。

```bash
$ docker images docker-demo
REPOSITORY    TAG       SIZE
docker-demo   latest    223MB
```

### コンテナを起動する

いよいよ起動です。

```bash
$ docker run -d --name docker-demo -p 5001:5000 docker-demo:latest
```

オプションの意味はこんな感じ。

- `-d` … バックグラウンドで起動（ターミナルが占有されない）
- `--name docker-demo` … コンテナに名前を付ける
- `-p 5001:5000` … **ホストの 5001 番をコンテナの 5000 番に繋ぐ**（ここ重要）

`-p` のポート指定がコンテナ活用のキモです。コンテナの中で動いているアプリは隔離されているので、このマッピングをしないと外からアクセスできません。今回は「手元の 5001 番にアクセスしたら、コンテナの中の 5000 番（Flask）に届く」という設定にしています。

起動できたか `docker ps` で確認します。

```bash
$ docker ps
NAMES         STATUS         PORTS
docker-demo   Up 3 seconds   0.0.0.0:5001->5000/tcp
```

`Up` になっていれば動いています。`PORTS` のところにポートのマッピングも出ていますね。

### ブラウザで確認

それでは `http://localhost:5001` をブラウザで開いてみましょう。

![ブラウザで表示した Flask アプリ](/images/docker-app-browser.png)

出ました 🎉

自分で書いた Python のコードが、コンテナの中で動いて、ブラウザから見えています。「環境構築なしで（Python すら直接入れずに）アプリが動いた」というのが Docker の気持ちいいところです。

---

## コンテナの中身をのぞいてみる

動いているコンテナのログを見たいときは `docker logs`。

```bash
$ docker logs docker-demo
 * Serving Flask app 'app'
 * Running on all addresses (0.0.0.0)
 * Running on http://127.0.0.1:5000
 * Running on http://172.17.0.2:5000
```

ちゃんと Flask が起動しているのが見えます。

コンテナの中に入って調べたいときは `docker exec` でシェルを起動できます。

```bash
$ docker exec -it docker-demo /bin/bash
root@9b263628773e:/app# ls
app.py  requirements.txt
root@9b263628773e:/app# python --version
Python 3.12.x
root@9b263628773e:/app# exit
```

`-it` を付けると対話的に操作できます。コンテナの中はちゃんと隔離された Linux 環境になっていて、`/app` の中に自分が COPY したファイルが入っているのが確認できます。

---

## GUI でも確認できる

Rancher Desktop のいいところは、コマンドだけじゃなく **GUI でもコンテナやイメージを見られる**ことです。

アプリのウィンドウ左側の「Containers」タブを開くと、今動いているコンテナが一覧で確認できます。停止・削除・ログ表示もボタンでできるので、コマンドを覚える前の段階でも直感的に操作できます。`docker ps` の結果が GUI で見えるイメージですね。

「Images」タブには、さっき `build` したイメージや pull してきたイメージが並びます。こちらは `docker images` の GUI 版です。

CLI に慣れていない最初のうちは、この GUI とコマンドを行き来しながら「あ、さっきのコマンドはこの操作のことか」と確認していくと理解が早いです。慣れてくると結局コマンドの方が速いので、自然と CLI 中心になっていくと思います。

---

## 後片付け

遊び終わったらコンテナを止めて消しておきましょう。立ち上げっぱなしだとリソースを食いますし、ポートも占有されたままになります。

```bash
# コンテナを止める
$ docker stop docker-demo

# コンテナを削除する
$ docker rm docker-demo

# イメージも消すなら
$ docker rmi docker-demo:latest
```

「止める」と「消す」が別コマンドなのが最初は戸惑いポイントです。`stop` しただけだとコンテナは停止状態で残っているので、完全に消すには `rm` まで実行します。

---

## まとめ

今回やったことを振り返ると、

- **Rancher Desktop** を入れれば、無料で Docker 環境が手に入る
- `docker run hello-world` で動作確認
- 「Dockerfile → build でイメージ → run でコンテナ」という流れを体験
- 自作の Flask アプリをコンテナ化して、ブラウザから動かすところまで到達

最初は用語が多くてとっつきにくいですが、一度自分のコードをコンテナで動かしてみると「なるほどこういうことか」と一気に腑に落ちます。環境を汚さずに何でも試せるようになるので、開発がかなり気楽になります。

次のステップとしては、

- 複数のコンテナをまとめて扱う **Docker Compose**（DB と Web アプリを一緒に立てるとか）
- 作ったイメージを **Docker Hub に公開**してみる
- Rancher Desktop に付いてくる **Kubernetes** に手を出してみる

あたりがおすすめです。まずは「自分のコードが箱の中で動いた」という今回の体験を足がかりに、少しずつ広げていってもらえればと思います。
