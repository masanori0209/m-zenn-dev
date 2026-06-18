---
title: "声だけで Minecraft を動かす：AmiVoice × 生成AIで作るサバイバル音声エージェント"
emoji: "⛏️"
type: "tech"
topics: ["amivoice", "minecraft", "aiagent", "java", "fabric"]
published: false
---

## 作ったもの

[KoeCraft Agent](https://github.com/masanori0209/koe-craft-agent) は、Minecraft Java Edition サバイバル向けの **日本語音声ファースト** エージェント MOD です。

たとえば、プレイヤーがこう話します。

```text
土を掘って
```

KoeCraft は Minecraft 内で音声を録音し、AmiVoice API で認識し、発話を Goal に変換し、サバイバル操作として実行します。

![KoeCraft Voice が発話を検知している画面](/images/koecraft-voice-speaking.jpg)

![音声操作後にタスクが進んだ画面](/images/koecraft-task-complete.jpg)

今回の記事で一番書きたいのは、Minecraft 攻略 AI そのものではありません。

主題は、**音声認識と生成 AI を組み合わせたアプリで、話し言葉をどう安全に実行可能な手順へ変換するか** です。

:::message
この記事は Minecraft 公式プロジェクトではありません。Minecraft 本体や改造クライアントの配布も行っていません。AmiVoice API と生成 AI を組み合わせた **音声体験の実装知見** を共有するための記事です。
:::

リポジトリ: https://github.com/masanori0209/koe-craft-agent

<!-- TODO: 公開前にここへ 30〜60 秒の動画を埋め込む。構成: Vキー → SPEAKING → AmiVoice認識 → Goal/Task → Minecraft内で実行 -->

---

## この記事で扱う課題

音声入力アプリでは、単に Speech-to-Text ができても、そのまま実行できるわけではありません。

特にゲーム操作や業務画面操作のように、実行先の状態が変わるアプリでは、次の課題が出ます。

- 音声認識結果をそのまま LLM に渡すと、解釈が揺れる
- LLM に操作手順を直接出させると、危険な操作や未対応操作が混ざる
- 曖昧な日本語を、アプリ内部の Goal や Action に落とす必要がある
- live API 前提で開発すると、失敗の再現や回帰検証が重くなる
- マイク状態、言い直し、中断を曖昧にすると、ユーザーが安心して操作できない

KoeCraft Agent では、この課題に対して次の分担で向き合っています。

```text
Native mic
  -> AmiVoice
  -> recognized text
  -> rule planner
  -> OpenAI fallback only when needed
  -> deterministic recipe / action planner
  -> survival executor
```

設計方針はシンプルです。

- AmiVoice は、日本語の聞き取りに集中する
- Rule Planner で、よくある発話を決定的な Goal に変換する
- 生成 AI は、ルールで解釈できない発話の補助に限定する
- Recipe / Action / Safety は、決定的なコードで処理する
- fixture と trace で、live API に依存しない再現可能な検証ループを作る

---

## 現在の構成

KoeCraft は、以前は外部 Voice Agent と Minecraft MOD を分けていました。現在の標準ランタイムは **MOD-only** です。

```text
Minecraft Java Edition
  + Fabric Client MOD
      + native mic recorder
      + AmiVoice HTTP adapter
      + OpenAI JSON-goal fallback
      + deterministic planner / recipe resolver
      + survival Action executor
```

この形に寄せた理由は、体験として「Minecraft を開いて V キーを押して話す」だけにしたかったからです。外部ブラウザ UI や別 daemon を前提にすると、デモとしては説明が増えます。MOD 内に寄せることで、音声操作の入口から実行までを Minecraft の中で見せられます。

実装上の入口は次の流れです。

```text
Minecraft V key
  -> KoeCraftNativeVoiceLoop
  -> KoeCraftNativeMicRecorder
  -> KoeCraftAmiVoiceRecognizer
  -> KoeCraftRecognizedTextProcessor
  -> KoeCraftNativeGoalPlanner
  -> SurvivalActionExecutor
```

マイクは常に明示的に ON/OFF します。`V` キーで ON にすると、画面左上に `KoeCraft Voice: SPEAKING` や `LISTENING` が出ます。発話後は無音区間を検出して AmiVoice に送信します。

---

## AmiVoice をどう使ったか

AmiVoice 呼び出しは MOD 側の `KoeCraftAmiVoiceRecognizer` に集約しています。

```java
String boundary = "KoeCraftBoundary" + UUID.randomUUID().toString().replace("-", "");
byte[] body = multipartBody(boundary, audio, contentType, config);
HttpRequest request = HttpRequest.newBuilder(URI.create(config.amivoiceEndpoint()))
    .header("content-type", "multipart/form-data; boundary=" + boundary)
    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
    .build();
```

`d` パラメータでは `grammarFileNames` と `profileWords` を組み立てます。

```java
StringBuilder builder = new StringBuilder("grammarFileNames=")
    .append(URLEncoder.encode(config.amivoiceEngine(), StandardCharsets.UTF_8));
String profileWords = loadProfileWords(config);
if (!profileWords.isBlank()) {
    builder.append(" profileWords=").append(URLEncoder.encode(profileWords, StandardCharsets.UTF_8));
}
```

`profileWords` は `data/amivoice/dict.txt` から読み込みます。

```text
松明    たいまつ    item
石のピッケル    いしのぴっける    item
クリーパー    くりーぱー    mob
```

辞書は「何でも入れる」のではなく、Minecraft 固有語に寄せています。曖昧な意味解釈は AmiVoice 側に寄せず、KoeCraft 側で扱います。

たとえば:

```text
あれ、明かりつけるやつ置いて
  -> AmiVoice: 聞き取り
  -> KoeCraft: light_source + place
  -> Goal: place_light / minecraft:torch
```

この分離が大事でした。AmiVoice は耳、KoeCraft は意味解釈、生成 AI は曖昧さの保険、実行判断は deterministic planner です。

---

## AmiVoice 実測

手元では、同じ音声素材に対して `-a-general-input` / `-a-general`、辞書あり/なしで認識を見ました。

`logs/amivoice-tests/20260618-152032/results.json` の結果を要約すると、短い基本発話では `-a-general-input` が素直でした。

| clip | engine | dict | result | confidence |
| --- | --- | --- | --- | --- |
| `s1_norm.wav` | `-a-general-input` | あり | `土を掘って` | 1.000 |
| `s1_norm.wav` | `-a-general-input` | なし | `土を掘って` | 1.000 |
| `s1_norm.wav` | `-a-general` | あり | `土を掘って、` | 1.000 |
| `s2_norm.wav` | `-a-general-input` | あり | `土を掘って` | 0.989 |
| `s3_norm.wav` | `-a-general-input` | あり | `土を掘って` | 0.995 |
| `s4_norm.wav` | `-a-general-input` | あり | rejected | 0.956 |

ここで分かったことは、少し地味ですが重要です。

- `土を掘って` のような一般語では、辞書あり/なしの差はほぼ出ない
- `-a-general` は句読点が入るなど、短い操作コマンドにはやや余計な差分が出る
- 信頼度が低い音声は空返答として拒否されるため、UI 側で聞き返しや継続待機が必要
- `profileWords` は魔法ではなく、`松明`、`石のピッケル`、mob 名などの固有語に絞って効かせるのがよい

つまり「AmiVoice の辞書で全部解く」のではなく、**聞き取りやすくする語彙だけ AmiVoice に渡し、意味解釈はアプリ側で持つ** のが扱いやすいです。

辞書チェックもハーネス化しています。

```bash
npm run amivoice:dict-check
```

実行結果:

```text
[dict] 235 entries OK
```

短すぎる読みや重複 surface+reading は警告として出します。音声辞書は多ければ強い、ではありません。短い読みや似た語を増やすと誤認識の入口になるので、記事ではここを正直に書くのが有益だと思っています。

---

## 生成 AI はどこで使うか

KoeCraft では、生成 AI に Action を直接出させません。

理由は単純で、実行先が Minecraft だからです。LLM に自由に手順を書かせると、`/give` や `/setblock` のような世界改変コマンドに逃げる可能性があります。それはサバイバル体験としては壊れています。

そのため、生成 AI の役割は狭くしています。

**使うところ**

- ルールで解釈できない発話の Goal JSON fallback
- ひどく崩れた認識結果の speech normalization

**使わないところ**

- レシピ解決
- Action の最終生成
- Safety 判定
- Minecraft コマンド文字列の生成

実際の流れはこうです。

```text
recognized text
  -> normalizeRecognizedText()
  -> planRuleBased()
  -> OpenAI speech normalizer only when needed
  -> OpenAI JSON-goal fallback only when needed
  -> planLlmGoal()
  -> SurvivalActionExecutor
```

OpenAI fallback の出力は Goal JSON 候補だけです。そこから先は `KoeCraftNativeGoalPlanner` が既知の action に落とします。

---

## 深い計画例：「暗いから松明置いて」

ライブ動画では `土を掘って` のような短い操作が見せやすいです。一方で、KoeCraft の設計が一番見えるのは、目的から不足素材を逆算するケースです。

そこで、再現可能な dry-run では次を使っています。

```text
暗いから松明置いて
```

松明も石炭もない状態だと、KoeCraft は `charcoal_route` を選びます。

```bash
make agent-dry-run
```

出力:

```json
{
  "recognized_text": "暗いから松明置いて",
  "goal": {
    "type": "place_light",
    "target_item": "minecraft:torch"
  },
  "selected_route": "charcoal_route",
  "tasks": [
    "collect_log",
    "pickup_items",
    "craft_planks",
    "craft_sticks",
    "craft_crafting_table",
    "open_crafting_table",
    "craft_wooden_pickaxe",
    "close_screen",
    "collect_cobblestone",
    "pickup_items",
    "open_crafting_table",
    "craft_furnace",
    "close_screen",
    "open_furnace",
    "smelt_charcoal",
    "close_screen",
    "craft_torch",
    "ensure_torch_hotbar",
    "place_torch"
  ],
  "safety": {
    "valid": true,
    "errors": []
  }
}
```

「松明を置く」だけなら簡単に見えます。しかしサバイバル序盤では、松明を作るために棒と石炭または木炭が必要です。石炭がなければ木炭を焼く必要があり、そのためにはかまどが必要で、かまどには丸石が必要で、丸石には木のピッケルが必要です。

この依存関係を LLM の自然文推論だけで扱うのではなく、レシピカタログと deterministic planner に寄せています。

---

## Safety: サバイバル合法にする

KoeCraft は、Minecraft を便利にする MOD ではありますが、`/give` で解決する MOD ではありません。

禁止している代表例:

```text
/give
/fill
/setblock
/tp
/summon
/kill
```

`ExecutorProtocol` は Action JSON 全体を走査し、禁止コマンド文字列が含まれていれば拒否します。WebSocket 経由の executor でも `banned command text detected` として落とします。

また、`SurvivalActionExecutor` は次のような実プレイ上の安全も見ます。

- lava / fire / fall risk で通常移動や採掘を止める
- hostile mob が近い場合は防御・退避・シェルターを優先する
- block breaking / movement / eating / smelting などを bounded timeout で止める
- abort が来たら ongoing action を中断する

この設計のおかげで、音声認識や LLM fallback が多少揺れても、最後に実行できる Action は制限されたものだけになります。

---

## 再現性

live AmiVoice や Minecraft 実機だけで開発すると、失敗の再現が難しくなります。そこで、KoeCraft では fixture とハーネスを厚めにしています。

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

さらに dry-run で trace JSON も残します。

```text
logs/traces/2026-06-18T14-00-28-554937Z-charcoal_route.json
```

この「live で見せる部分」と「fixture で検証する部分」を分けるのは、音声アプリではかなり重要でした。live API の成功だけを見ていると、失敗ケースや境界条件が育ちません。

---

## 作ってみて残った整理

Minecraft はかなり特殊な題材です。ただ、作っている途中で「これはゲームに限らず、音声で何かを操作するアプリでは同じ悩みになりそうだな」と感じた部分がありました。

自分の中では、最終的に次の流れで考えると整理しやすかったです。

```text
Speech-to-Text
  -> Intent / Goal
  -> deterministic planner
  -> safety gate
  -> execution
  -> trace
```

特に効いたのは、次の 5 つでした。

- 音声認識と意味理解を分ける
- LLM には Action を直接出させず、Goal JSON に閉じ込める
- 実行判断は deterministic code に寄せる
- Safety gate を最後に置く
- live API と fixture 検証を分ける

この形にしておくと、音声認識が多少揺れても、実行側の安全性と再現性を保ちやすくなりました。

---

## まとめ

KoeCraft Agent は、AmiVoice API と生成 AI を使って、日本語の話し言葉を Minecraft サバイバルの実行手順に変換する MOD です。

この記事で特に共有したかったのは、次の設計です。

```text
AmiVoice は耳
LLM は曖昧さの保険
実行判断は deterministic planner
最後に safety gate
検証は fixture と trace
```

音声認識と生成 AI を組み合わせるとき、「聞き取れたテキストをどう安全に行動へ変えるか」が一番おもしろい部分でした。

Minecraft は派手な題材ですが、今回悩んだことは「音声で何かを安全に操作する」アプリならかなり近い形で出てきそうだと感じています。

---

## 参考リンク

- KoeCraft Agent: https://github.com/masanori0209/koe-craft-agent
- コンテスト: https://zenn.dev/contests/zennfes-spring-2026-amivoice
- Zennfes Spring 2026: https://zenn.dev/events/zennfes-spring-2026
- AmiVoice API: https://acp.amivoice.com/
- AmiVoice API マニュアル: https://docs.amivoice.com/
