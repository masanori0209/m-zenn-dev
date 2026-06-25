---
title: "マイクラを声で動かそうとしたら令和の「ピカチュウげんきでちゅう」になった話"
emoji: "⛏️"
type: "tech"
topics: ["amivoice", "minecraft", "aiagent", "java", "fabric"]
published: true
---

:::message
この記事は、Minecraft を声で操作する自作 MOD の開発記録です。
平成一桁生まれが、昔遊んだ「ピカチュウげんきでちゅう」のスイカ割りをふと思い出しながら書いています。

とはいえ、思い出話だけの記事ではありません。
AmiVoice API、音声入力のノイズ対策、生成 AI fallback、Minecraft 内での実行計画をどう分けたか、という実装の話をします。
:::

---

## 🎙️ 物語のはじまり

Minecraft を声で動かしたい。

最初は、ただそれだけだった。

キーボードもマウスも使わずに、

> 「まっすぐ進んで」
> 「木のツルハシ作って」
> 「石のツルハシ作って」

と言ったら、画面の中の Steve が動いてくれたら面白い。

そう思って [KoeCraft Agent](https://github.com/masanori0209/koe-craft-agent) という Fabric MOD を作り始めた。

でも、実際にデモを撮ってみると、思っていた「未来の音声操作」とは少し違った。

まっすぐ進む。
たしかに進む。

木のツルハシを作ろうとする。
それっぽく動き始める。

でも、作業台を開こうとして少し距離が足りなかったり、向きがずれていたりする。
認識候補を見ながら、

> 「今の、そう聞こえたかー」

となる瞬間がある。

そのとき、急に思い出した。

NINTENDO 64 の「ピカチュウげんきでちゅう」だ。

小学生のころ、スイカ割りが本当に難しかった。

画面の前で、

> 「右！」
> 「左！」
> 「そこ！」

みたいなことを一生懸命言っていた気がする。

こっちは必死なのに、ピカチュウはちょっと違う方向に行く。
伝わっているような、伝わっていないような。

あのもどかしさ。

KoeCraft のデモを見返したとき、

> 「あ、これ、令和のピカチュウげんきでちゅうだ」

と思ってしまった。

こちらは Minecraft なので、相手はピカチュウではない。
画面の中にいるのは、いつもの Steve だ。

いや、Steve のスキンをピカチュウにしておけば、もう少し可愛げがあったかもしれない。

でも、声で相棒にお願いして、ちょっと伝わったり、ちょっと伝わらなかったりする感じは、妙に懐かしかった。

---

## ⛏️ 作ったもの

KoeCraft Agent は、Minecraft Java Edition サバイバル向けの日本語音声ファースト MOD です。

プレイヤーがこう話す。

```text
石のツルハシ作って
```

MOD は Minecraft 内でマイク入力を録音し、AmiVoice API に投げる。
返ってきた認識結果を Goal に変換し、Minecraft の状態を見ながら実行手順に落とす。

先に、デモの雰囲気を置いておく。

![声で石のツルハシ作成まで進めるデモ](/images/koecraft-demo-stone-pickaxe.gif)

画面上では、Steve が村の近くを歩き、作業台を使い、木のツルハシを持ち、丸石を集め、石のツルハシへ進んでいく。

裏側でやっていることは、だいたいこの3つに分かれる。

- AmiVoice で短い日本語命令を速く文字にする
- Minecraft の語彙と状態で、崩れた認識結果を Goal に戻す
- よくある操作は LLM に投げず、deterministic な planner で進める

ざっくり書くと、こういう流れになる。

```text
Native mic
  -> AmiVoice
  -> recognized text
  -> rule planner
  -> OpenAI fallback only when needed
  -> deterministic recipe / action planner
  -> Minecraft executor
```

この記事で書きたいのは、Minecraft 攻略 AI そのものではない。

声で何かを操作するアプリを作るとき、

- どこまでを音声認識に任せるか
- どこからをアプリ側の意味解釈にするか
- 生成 AI を毎回呼ぶべきか
- ノイズや言い直しをどう扱うか
- live API 前提の失敗をどう再現可能にするか

という問題が一気に出てくる。

KoeCraft では、そこをかなり泥くさく分けた。

:::message
この記事は Minecraft 公式プロジェクトではありません。
Minecraft 本体や改造クライアントの配布も行っていません。
AmiVoice API と生成 AI を組み合わせた音声体験の実装知見を共有するための記事です。
:::

---

## 🐾 まず、声で歩かせてみる

まずは短い命令。

```text
まっすぐ進んで
```

![声でまっすぐ進むデモ](/images/koecraft-demo-forward.gif)

見た目には、Steve が前に歩いているだけに見える。

でも、実装としてはただ W キーを押しっぱなしにしているわけではない。

音声操作では、命令が短いほどテンポが大事になる。

> 「まっすぐ進んで」

と言ったあとに、数秒待たされると、もうゲーム操作として気持ちよくない。

一方で、何も見ずに前進するとすぐ破綻する。
前に段差があるかもしれない。
水辺かもしれない。
少し進んだら落ちるかもしれない。

KoeCraft の移動 Action は、近くの地形を軽く見る。
前方の足元と頭上を見て、進めそうなら進む。
危なそうなら距離を短くする。
1 ブロック段差ならジャンプを混ぜる。

このあたりは、記事の見た目としては地味だ。

でも、声で操作すると、こういう地味な部分が体験に効く。

声の命令は、キーボードのように細かく押し直せない。
だからこそ、実行側が少しだけ気を利かせる必要がある。

もちろん、毎回きれいには進まない。

![声の指示で少し詰まって聞き返すデモ](/images/koecraft-demo-stuck-recovery.gif)

少し詰まる。
候補が出る。
言い直す。
また動く。

このあたりが、デモを見返していて一番「ピカチュウげんきでちゅう」を思い出したところだった。

音声操作は、成功した瞬間だけ見ると魔法に見える。

でも、実際に作ると、成功と聞き返しの間に体験がある。

だから KoeCraft では、認識結果、候補、失敗理由、実行中の task を画面に出すようにした。

---

## 🪓 木のツルハシ、そして石のツルハシ

次は、少し Minecraft らしい命令。

```text
木のツルハシ作って
```

![木のツルハシを声で指示するデモ](/images/koecraft-demo-wooden-pickaxe.gif)

画面には、AmiVoice の認識候補が出る。
KoeCraft 側では、作業台や素材の状態を見ながら plan を進める。

そして、今回いちばん記事にしたかったのがこれ。

```text
石のツルハシ作って
```

「石のツルハシ作って」は、短い発話に見える。

でも、サバイバル序盤では、いきなり石のツルハシは作れない。

まず丸太を集める。
板材を作る。
棒を作る。
作業台を作る。
木のツルハシを作る。
木のツルハシで丸石を掘る。
最後に石のツルハシを作る。

言葉は一文。
中身はけっこう長い。

`examples/cases/craft_stone_pickaxe_start.json` では、このケースを fixture にしている。

```json
{
  "recognized_text": "石のツルハシ作って",
  "expected": {
    "goal": "craft_stone_pickaxe",
    "route": "stone_pickaxe_route",
    "tasks": [
      "collect_log",
      "pickup_items",
      "craft_planks",
      "craft_sticks",
      "craft_crafting_table",
      "open_crafting_table",
      "craft_wooden_pickaxe",
      "collect_cobblestone",
      "craft_stone_pickaxe"
    ]
  }
}
```

実際の trace では、認識結果だけでなく、その時点の inventory と周囲の world snapshot も一緒に残す。

```json
{
  "recognized_text": "石のツルハシ作って",
  "goal": {
    "type": "craft_item",
    "target_item": "minecraft:stone_pickaxe"
  },
  "inventory_snapshot": {
    "minecraft:wooden_pickaxe": 1,
    "minecraft:crafting_table": 2,
    "minecraft:cobblestone": 4
  },
  "world_snapshot": {
    "nearby": {
      "minecraft:stone": true,
      "minecraft:coal_ore": true,
      "minecraft:jungle_log": true
    },
    "light_level": 4
  },
  "explanation": "木材、作業台、木のピッケル、丸石を順にそろえて、石のピッケルを作る計画を選びました。"
}
```

声だけを見ると「石のツルハシ作って」の一言。

でも、実行側では、今どこまで素材があるか、近くに何があるか、暗さはどうかを見ている。

ここを LLM の自然文推論だけで解こうとすると、毎回それっぽい説明はできる。

でも、ゲーム内で本当に使いたいのは説明ではない。

必要なのは、今の inventory と周囲の状態から、同じ条件なら同じ手順を出すことだった。

なので、レシピ解決と Action 生成は deterministic code に寄せた。

---

## 🧭 MOD の中に寄せた理由

KoeCraft は、以前は外部 Voice Agent と Minecraft MOD を分けていた。

でも、現在の標準ランタイムは MOD-only に寄せている。

```text
Minecraft Java Edition
  + Fabric Client MOD
      + native mic recorder
      + AmiVoice HTTP adapter
      + OpenAI JSON-goal fallback
      + deterministic planner / recipe resolver
      + Action executor
```

理由は単純で、

> Minecraft を開いて、V キーを押して、話す

だけにしたかったから。

音声デモで、外部ブラウザ UI や daemon の説明が増えると、急に体験が遠くなる。

「声で動かしている」感じを出すには、入口も結果も Minecraft の中にあった方がいい。

実装上の入口はこうなっている。

```text
Minecraft V key
  -> KoeCraftNativeVoiceLoop
  -> KoeCraftNativeMicRecorder
  -> KoeCraftAmiVoiceRecognizer
  -> KoeCraftRecognizedTextProcessor
  -> KoeCraftNativeGoalPlanner
  -> SurvivalActionExecutor
```

`V` キーでマイクを ON にすると、画面左上に `KoeCraft Voice: SPEAKING` や `LISTENING` が出る。
発話後は無音区間を検出して、AmiVoice に送る。

設定画面も Minecraft 側に置いた。

![KoeCraft MOD 設定画面](/images/koecraft-mod-settings.png)

![KoeCraft 音声設定画面](/images/koecraft-mod-settings-voice.png)

こういう設定も含めて Minecraft の中に置くと、声で遊んでいる感じが途切れにくい。

---

## 👂 AmiVoice に任せるところ、任せないところ

AmiVoice 呼び出しは、MOD 側の `KoeCraftAmiVoiceRecognizer` に寄せた。

multipart で音声を投げる。

```java
String boundary = "KoeCraftBoundary" + UUID.randomUUID().toString().replace("-", "");
byte[] body = multipartBody(boundary, audio, contentType, config);
HttpRequest request = HttpRequest.newBuilder(URI.create(config.amivoiceEndpoint()))
    .header("content-type", "multipart/form-data; boundary=" + boundary)
    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
    .build();
```

`d` パラメータでは、`grammarFileNames` と `profileWords` を組み立てる。

```java
StringBuilder builder = new StringBuilder("grammarFileNames=")
    .append(URLEncoder.encode(config.amivoiceEngine(), StandardCharsets.UTF_8));
String profileWords = loadProfileWords(config);
if (!profileWords.isBlank()) {
    builder.append(" profileWords=").append(URLEncoder.encode(profileWords, StandardCharsets.UTF_8));
}
```

辞書には、Minecraft 固有語を入れる。

```text
松明    たいまつ    item
石のピッケル    いしのぴっける    item
クリーパー    くりーぱー    mob
```

ここで欲張りすぎないようにした。

AmiVoice には、Minecraft 固有語をなるべく聞き取りやすくするところまでを任せる。
でも、発話の意味を全部 AmiVoice 側で解こうとはしない。

`profileWords` は、`松明` や `石のピッケル` のような語彙を寄せるために使う。
一方で、「明かりつけるやつ」が松明なのか、今置ける状態なのか、そもそも作る必要があるのかは KoeCraft 側で判断する。

たとえば、こういう発話がある。

```text
あれ、明かりつけるやつ置いて
```

これは AmiVoice の辞書だけで解く話ではない。

```text
AmiVoice: 聞き取り
KoeCraft: light_source + place と解釈
Goal: place_light / minecraft:torch
```

聞き取りと、ゲーム内の意味を分ける。

この線引きが、作っていて一番大事だった。AmiVoice の認識結果をそのまま行動にするのではなく、Minecraft の状態と合わせて Goal に変える。

---

## 🗣️ 言い直しと聞き間違い

音声操作を作っていると、テキスト入力ではあまり出ない言い方が普通に出る。

```text
松明置いて、いや、先に石のピッケル作って
```

かなり人間っぽい。

最初に言いかけて、途中で気が変わる。

マイクラだと、

> 松明を置きたい。
> でも、その前にツルハシがいるな。

となりやすい。

KoeCraft では、このケースを `self_correction_pickaxe` として fixture にした。

```json
{
  "recognized_text": "松明置いて、いや、先に石のピッケル作って",
  "expected_features": {
    "has_self_correction": true,
    "cancelled_goal": "place_torch",
    "active_goal": "craft_stone_pickaxe"
  }
}
```

ここで毎回 LLM に聞けば、たぶん賢く処理できる。

でも、よく出る言い直しまで毎回 LLM に回すと、音声操作のテンポが落ちる。

なので、`いや`、`やっぱ`、`先に` のような兆候は、まず rule 側で拾う。

中断も同じ。

```text
待って、やっぱやめて
```

これは `abort` に落とす。

声の操作では、「やめて」が効くこと自体が安心感になる。
ここはピカチュウげんきでちゅうの仕様と比べたいというより、声で相手にお願いしているときの「いったん止まってほしい」という気持ちに近い。

もうひとつ面白かったのが、ASR の聞き間違い。

```text
木のツルハシ作って
```

が、文脈によっては、

```text
きのうつるはし作って
```

のように見えることがある。

文字だけ見ると、

> 昨日つるはし？

となる。

でも Minecraft の操作発話としては、`木のツルハシ` の可能性が高い。

こういうケースは、AmiVoice の辞書と KoeCraft 側の正規化を合わせて吸収する。

実装側では、`MinecraftVanillaTerms` に別名も持たせている。

```text
minecraft:stone_pickaxe
  -> 石のピッケル
  -> 石ピッケル
  -> ストーンピッケル
  -> 石のツルハシ
  -> 石つるはし
```

音声認識の結果を「きれいな日本語」として扱いすぎない。

ゲーム内で何をしたいかに寄せる。

この割り切りが効いた。

---

## 📊 AmiVoice で見たこと

最初は、同じ音声素材に対して `-a-general-input` / `-a-general`、辞書あり/なしを見ていた。

`土を掘って` のような短い基本発話では、`-a-general-input` が素直だった。

でも、それだけでは、マイクラを声で動かしたとは言いにくい。

Minecraft を声で動かすなら、見たいのはもっと泥くさいところだった。

```text
取って
まっすぐ歩いて
100歩歩いて
木のツルハシ作って
石のツルハシ作る
暗いから松明置いて
あれ、あの、あかりつけるやつ置いて
```

このあたりを実音声にして、AmiVoice と Whisper に通し、その後 KoeCraft の正規化・router・planner まで流した。

ログは `logs/reports/asr-comparison-report.json` と `logs/reports/asr-live-recognitions.json` に残している。

結果だけ見ると、20シナリオ中、AmiVoice も Whisper も 19件が planner まで到達した。

ただし平均レイテンシは違った。

| engine | planned | avg latency |
| --- | ---: | ---: |
| AmiVoice `-a-general-input` | 19 / 20 | 558 ms |
| Whisper | 19 / 20 | 1378 ms |

ここで、かなり納得した。

音声操作では、最終的な文字起こしのきれいさだけではなく、

> どれくらい早く、次の Goal に渡せるか

が体験になる。

実際のログは、わりと人間くさい。

| 発話 | AmiVoice | Whisper | 見えたこと |
| --- | --- | --- | --- |
| `取って` | `取って` / 256 ms | `撮って` / 676 ms | 一語命令は文脈がないと同音異義語に寄る |
| `まっすぐ歩いて` | `まっすぐ歩いて` / 370 ms | `まっすぐ歩いて` / 1259 ms | 移動命令は待ち時間の差がそのままテンポになる |
| `100歩歩いて` | `100歩歩いて` / 365 ms | `百歩吠えて` / 586 ms | 数字とゲーム文脈はアプリ側で活かせる |
| `木のツルハシ作って` | `木のつるはし作って` / 638 ms | `木のツルハシ作って` / 1769 ms | 表記揺れは正規化で吸収できる |
| `石のツルハシ作る` | `石野鶴橋作る` / 799 ms | `石のツルハシ作る` / 1222 ms | 文字は崩れても、クラフト文脈なら戻せる |
| `暗いから松明置いて` | `ぐらいから松明を置いて` / 1061 ms | `暗いから松明置いて` / 2809 ms | 先頭が崩れても、`松明` と `置いて` が拾えれば Goal にできる |

`石野鶴橋作る` は、ログで見たときにちょっと笑った。

大阪の駅かな、と思う。

でも、Minecraft の発話として見れば、これはかなり `石のツルハシ作る` っぽい。

ここで大事なのは、AmiVoice が常に完璧だった、という話ではない。

むしろ逆で、音声認識の結果は普通に崩れる。

だから、認識結果をそのまま正解文として扱わない。

`石野鶴橋` を `石のツルハシ` に戻せるように、Minecraft の語彙、別名、クラフト文脈を KoeCraft 側に持たせる。

```text
ASR: 石野鶴橋作る
normalize: 石のツルハシ 作る
router: craft
planner: craft_stone_pickaxe
```

これが、今回 AmiVoice を使って一番しっくり来たところだった。

AmiVoice の強みは、短い日本語命令をかなり速く返せるところにあった。

でも、認識テキストだけでゲームは動かない。

ゲーム側に文脈を持たせて、聞こえた文字を操作意図に戻す。

そこまで含めて、ようやく「声でマイクラを動かしている」感じになる。

辞書も、入れれば入れるほど強いわけではない。

```bash
npm run amivoice:dict-check
```

実行結果:

```text
[dict] 235 entries OK
```

短すぎる読みや、似た読みを増やしすぎると誤認識の入口になる。

なので、辞書は「全部を解く魔法」ではなく、Minecraft 固有語を聞き取りやすくする補助として使った。

---

## 🤖 生成 AI を最後の保険にした理由

KoeCraft では、生成 AI に Action を直接出させない。

理由は、きれいに言えばリアルタイム性。

本音を言えば、テンポとコスト。

もちろん、文字起こし結果を毎回 LLM に渡して、

> これは何をしたい発話ですか？

と解釈させれば、精度は上がる。

`石のツルハシ作って` と `石のピッケル作って` の言い換えも拾いやすい。
少し崩れた認識結果も吸収しやすい。

それは分かっていた。

でも、音声入力はキーボードよりも最初から少し遅い。

録音する。
無音を検知する。
AmiVoice に投げる。
認識結果を待つ。

この時点で、ユーザーはもう一拍待っている。

そこから毎回 LLM に投げると、Minecraft の操作としてはかなり重く感じる。

もうひとつ、本音がある。

あまりお金を使いたくなかった。

Minecraft でできる操作は、移動、採掘、クラフト、設置、退避のようにある程度限られている。
よくある発話まで毎回 LLM に聞くより、rule planner で即座に Goal に落とし、レシピ解決や Action 生成は deterministic code で進めた方が合っていた。

だから、生成 AI は「いつも使う頭脳」ではなく、最後の fallback にした。

```text
recognized text
  -> normalizeRecognizedText()
  -> planRuleBased()
  -> OpenAI speech normalizer only when needed
  -> OpenAI JSON-goal fallback only when needed
  -> planLlmGoal()
  -> SurvivalActionExecutor
```

OpenAI fallback の出力は Goal JSON 候補だけ。
そこから先は `KoeCraftNativeGoalPlanner` が既知の action に落とす。

---

## 🌫️ ノイズという、見えない敵

音声入力で一番地味に効いたのは、AmiVoice に送る前の録音区間だった。

Minecraft は、そもそも音が多い。

BGM。
環境音。
ブロックを壊す音。
マウスやキーボードの音。

ここを雑に扱うと、話していないのに録音が始まる。
発話の先頭が欠ける。
無音判定が遅れて、テンポが悪くなる。

KoeCraft では、まず RMS で音量を見る。

ただ、固定しきい値だけだと、部屋やマイクによってすぐズレる。

そこで、発話前の短い環境音からノイズ床を見積もり、発話検知しきい値を自動で調整する `AdaptiveNoiseGate` を入れた。

これはノイズサプレッションではない。

音をきれいにする仕組みではなく、AmiVoice に投げる録音開始を間違えにくくする軽量ゲートだ。

録音中には、こういう値を更新する。

```text
rms
maxRms
threshold
detectedSpeech
silence
```

さらに pre-roll も持つ。

発話を検知した瞬間から録音すると、先頭の「いしの...」の「い」が欠けることがある。
直前の短い buffer も一緒に入れることで、AmiVoice に渡す音声の頭を落としにくくした。

RMS だけでは足りない場合もある。

Minecraft の BGM や環境音を拾いやすいときは、Silero VAD の ONNX model を `KoeCraftVoiceActivityGate` として使う。

```text
RMS threshold
  + adaptive noise threshold
  + Silero VAD confidence
  -> speechActive
```

Silero VAD が読み込めない環境では、マイク自体を落とさず `rms` provider に戻す。
HUD や設定画面には、`vad_provider`、`vad_confidence`、`vad_fallback_reason` を出せるようにした。

完璧な音声認識を作りたかったわけではない。

声を出してから結果が返るまでのテンポを崩さずに、AmiVoice に渡す音声をできるだけ「発話らしい区間」に寄せたかった。

---

## 📜 失敗を fixture にする

live AmiVoice と Minecraft 実機だけで開発すると、失敗の再現が難しい。

さっきは動いた。
今は動かない。
でも、録音も状態も少し違う。

音声認識、LLM、planner、Minecraft MOD が全部絡むので、

> どこが悪かったのか

がすぐ分からない。

そこで、KoeCraft では失敗を fixture に昇格するループに寄せた。

```text
実装する
  -> デモで失敗する
  -> trace を読む
  -> 失敗を fixture に昇格する
  -> planner / 正規化 / executor を直す
  -> harness を回す
```

声で操作するデモは、成功すると気持ちいい。

でも、成功動画だけ見ていると何も強くならない。

> 今の失敗、次も再現できる？

を拾う方が大事だった。

```bash
make agent-check
```

今回の確認結果:

```text
BUILD SUCCESSFUL
[planner-fixtures] passed 108 routed fixture checks
[fixtures] speech fixtures passed
[recipe-catalog] vanilla catalog checks passed
[recipe-dependency-audit] total=1340 planned=1300 silk_touch_required=38 boss_route_missing=1 mob_head_route_missing=1
[harness] done
```

声で言ったらたまたま動いた、では終わらせない。

同じ入力状態なら同じ plan になる。
そこまでを fixture で見る。

これは地味だけど、音声アプリではかなり大事だった。

---

## 🧓 令和のスイカ割りを作ってみて

KoeCraft Agent は、AmiVoice API と生成 AI を使って、日本語の話し言葉を Minecraft の実行手順に変換する MOD です。

この記事で共有したかったのは、次の分担です。

```text
AmiVoice は固有語の聞き取りを助ける
KoeCraft は Minecraft の状態と合わせて Goal にする
LLM は最後の保険
ノイズ対策は AmiVoice に投げる前
検証は fixture と trace
```

作ってみて思った。

音声操作は、思ったより未来っぽくない。

むしろ、ちょっと懐かしい。

こちらが声を出す。
画面の中の相棒が少し考える。
伝わったり、伝わらなかったりする。
詰まったら、こちらもまた言い直す。

そこには、平成の音声ゲームっぽい手触りがある。

ただ、令和の自分たちには、AmiVoice があり、生成 AI があり、ログがあり、fixture がある。

昔はただ祈るしかなかった「伝われ」が、
今は少しずつ分解できる。

マイクのノイズなのか。
認識語彙なのか。
言い直しなのか。
planner なのか。
Minecraft 側の状態なのか。

ひとつずつ切り分けていくと、声でゲームを動かす体験は、単なるネタではなく、かなり実装しがいのある題材だった。

スイカ割りは、今でもたぶん難しい。

でも、あの頃よりは少しだけ、

> なぜ伝わらなかったのか

を調べられるようになった。

それだけでも、なんだか時代が進んだ気がする。

---

## 参考リンク

- KoeCraft Agent: https://github.com/masanori0209/koe-craft-agent
- コンテスト: https://zenn.dev/contests/zennfes-spring-2026-amivoice
- Zennfes Spring 2026: https://zenn.dev/events/zennfes-spring-2026
- AmiVoice API: https://acp.amivoice.com/
- AmiVoice API マニュアル: https://docs.amivoice.com/
