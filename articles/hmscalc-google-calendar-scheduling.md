---
title: "Claude Code SkillでGoogle Calendarの空き時間候補を探す"
emoji: "🗓️"
type: "tech"
topics: ["python", "googlecalendar", "claudecode", "aiagent", "hmscalc"]
published: true
---

## はじめに

「来週どこかで1時間ください」

このくらいの予定調整でも、実際には条件がいくつもあります。

- 平日の 9:00〜18:00 だけ
- 前後15分は準備や移動のバッファとして空けたい
- 30分刻みで候補を出したい
- 祝日や独自休日は避けたい
- Google Calendar に入っている予定とは重ねたくない
- 候補は出してほしいが、勝手に予定作成はしてほしくない

毎回 Claude Code にこの条件を自然文で説明してもよいのですが、予定調整は境界条件が地味に多いです。たとえば「12:00〜13:00 は空いているように見えるが、13:00 から別予定があるので後ろ15分バッファを入れると候補にできない」ようなケースです。

Google Calendar などから取得した予定をもとに、**Claude Code Skill と小さな Python スクリプトで空き時間候補を探す** 形にしておくと、このあたりの条件を毎回同じルールで扱えます。

呼び出しは次のような形です。

```text
/find-meeting-slots 来週の平日で、1時間の打ち合わせ候補を出して。
Google Calendar の予定を避けて、前後15分バッファ、9:00-18:00、30分刻み。
```

候補計算には [hmscalc](https://pypi.org/project/hmscalc/) を使います。hmscalc はカレンダー連携そのものではなく、busy interval を受け取って候補時間を返す計算役として使います。

---

## 先に結論

構成は次のように分けます。

| 役割 | 担当 |
| --- | --- |
| 予定データの取得 | Google Calendar API / MCP / 手元の FreeBusy JSON |
| busy interval の整形 | 薄い Python 関数 |
| 空き時間、バッファ、営業日、TZ の計算 | hmscalc |
| 毎回の手順、前提確認、出力形式 | Claude Code Skill |

LLM に「なんとなく空いていそうな時間」を考えさせるのではなく、Claude Code には手順のオーケストレーションを任せ、候補計算は Python 側で決定論的に行います。

この分担にすると、次のような事故を避けやすくなります。

- 予定作成まで勝手に進む
- バッファを忘れる
- 稼働時間外の候補を出す
- タイムゾーンが混ざる
- 毎回プロンプトで同じ条件を書き直す

---

## Claude Code Skillとしての置き場所

Claude Code の Skill は、`SKILL.md` を持つディレクトリとして置きます。

プロジェクト内だけで使うなら、次のような構成です。

```text
.claude/
  skills/
    find-meeting-slots/
      SKILL.md
      scripts/
        find_slots.py
      examples/
        freebusy.sample.json
```

この場合、Skill のコマンド名はディレクトリ名から決まるので、`/find-meeting-slots` として呼べます。

Claude Code の Skill では、frontmatter の `name` は主に一覧表示用の名前です。通常の `.claude/skills/<skill-name>/SKILL.md` では、`/` で呼び出すコマンド名は `name` ではなく **ディレクトリ名** から決まります。

そのため、呼び出し名として使いたい名前を先にディレクトリ名にしておきます。

---

## SKILL.md

まずは Skill 本体です。

````markdown
---
name: find-meeting-slots
description: Find meeting slot candidates from calendar busy data. Use when the user asks for available times, meeting candidates, or schedule options with duration, working hours, timezone, buffers, or business-day constraints.
argument-hint: "[date range] [duration] [calendar source] [buffers]"
---

# Find Meeting Slots

Use this skill to find candidate meeting slots from calendar busy intervals.

User request:

```text
$ARGUMENTS
```

## Default assumptions

- Timezone: `Asia/Tokyo`
- Working hours: `9:00` to `18:00`
- Meeting duration: `1:00`
- Buffer before: `0:15`
- Buffer after: `0:15`
- Step: `0:30`
- Business days: weekdays only, unless holidays are provided
- Holidays: none by default; pass explicit dates when needed

Confirm missing constraints only when the answer would materially change.
Otherwise, use the defaults and state the assumptions in the result.

## Calendar data

Use available calendar tooling, MCP output, connector output, or a local FreeBusy JSON file
to obtain busy intervals.

If calendar access is not available, ask the user for one of:

- a FreeBusy JSON export
- a list of busy intervals
- permission to proceed with sample data

Do not create, update, or delete calendar events unless the user explicitly asks.

## Procedure

1. Extract the date range, duration, working hours, timezone, buffers, and step.
2. Convert calendar busy data into `(datetime_start, datetime_end)` intervals.
3. Run the deterministic slot calculation.
4. Return the best candidates first.
5. Include meeting time and reserved time including buffers.
6. State assumptions and skipped constraints.

## Deterministic calculation

When a FreeBusy JSON file is available, run the bundled script:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/find_slots.py \
  --freebusy freebusy.json \
  --start-date 2026-07-01 \
  --end-date 2026-07-07 \
  --tz Asia/Tokyo \
  --daily-start 9:00 \
  --daily-end 18:00 \
  --duration 1:00 \
  --buffer-before 0:15 \
  --buffer-after 0:15 \
  --step 0:30 \
  --holiday 2026-07-03
```

Use `${CLAUDE_SKILL_DIR}` so the script works whether the skill is installed as
a personal skill, project skill, or plugin skill.

## Output format

Return a concise list like:

```text
候補:
1. 2026-07-01 11:15-12:15 JST
   確保枠: 11:00-12:30 JST
2. 2026-07-01 11:45-12:45 JST
   確保枠: 11:30-13:00 JST

前提:
- 平日 9:00-18:00
- 前後15分バッファ
- 30分刻み
- カレンダー予定は FreeBusy の busy interval を使用
```
````

`SKILL.md` には、Claude Code に「候補を考えて」とだけ渡すのではなく、**予定取得、条件抽出、Pythonでの候補計算、出力形式** までを書いておきます。

また、`allowed-tools` は最初は書かない方が安全です。`allowed-tools` は「この Skill の実行中にそのツールを確認なしで使えるようにする」設定であって、使えるツールを制限する設定ではありません。共有リポジトリに置く Skill では、広い `Bash` 権限を安易に許可しない方がよいです。

プロジェクト内 Skill として使い、どうしても事前許可したい場合は、次のように実行コマンドを狭くします。

```yaml
allowed-tools: Bash(python3 .claude/skills/find-meeting-slots/scripts/find_slots.py *)
```

ただ、まずは許可なしで動かして、必要になってから絞った許可を追加するくらいで十分です。

---

## Google Calendarからbusyを取る

Google Calendar API には [FreeBusy API](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) があります。指定した期間とカレンダーに対して、予定が埋まっている時間帯を返してくれる API です。

認証まわりは公式の [Python quickstart](https://developers.google.com/workspace/calendar/api/quickstart/python) に任せるとして、ここでは `service` が作れている前提で FreeBusy を呼びます。

```python
from datetime import datetime


def load_freebusy(service, calendar_ids, time_min, time_max, tz="Asia/Tokyo"):
    body = {
        "timeMin": time_min.isoformat(),
        "timeMax": time_max.isoformat(),
        "timeZone": tz,
        "items": [{"id": calendar_id} for calendar_id in calendar_ids],
    }

    return service.freebusy().query(body=body).execute()
```

FreeBusy のレスポンスは、だいたい次のような形です。

```json
{
  "calendars": {
    "primary": {
      "busy": [
        {
          "start": "2026-07-01T10:00:00+09:00",
          "end": "2026-07-01T11:00:00+09:00"
        }
      ]
    }
  }
}
```

この `busy` を Python の `datetime` タプルに変換します。

```python
from datetime import datetime


def parse_rfc3339(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def busy_from_freebusy(response: dict) -> list[tuple[datetime, datetime]]:
    busy = []

    for calendar_id, payload in response.get("calendars", {}).items():
        if payload.get("errors"):
            reasons = ", ".join(error.get("reason", "unknown") for error in payload["errors"])
            raise RuntimeError(f"FreeBusy failed for {calendar_id}: {reasons}")

        for item in payload.get("busy", []):
            busy.append((parse_rfc3339(item["start"]), parse_rfc3339(item["end"])))

    return busy
```

Google Calendar 以外でも、Microsoft Graph、ICS、社内 API などから `[(start, end), ...]` にできれば同じ計算に流せます。

---

## 空き時間候補を計算する

候補計算には hmscalc の `scheduling` API を使います。

```bash
pip install "hmscalc>=1.4.0"
```

たとえば、Google Calendar から次の busy interval が取れたとします。

```python
freebusy_response = {
    "calendars": {
        "primary": {
            "busy": [
                {
                    "start": "2026-07-01T10:00:00+09:00",
                    "end": "2026-07-01T11:00:00+09:00",
                },
                {
                    "start": "2026-07-01T13:00:00+09:00",
                    "end": "2026-07-01T14:00:00+09:00",
                },
            ],
        },
    },
}
```

これを hmscalc に渡して、1時間の予定を前後15分バッファ込み、30分刻みで探します。

```python
from datetime import date

from hmscalc import business_days, scheduling

busy = busy_from_freebusy(freebusy_response)

slots = scheduling.find_availability_across_business_days(
    busy,
    date(2026, 7, 1),
    date(2026, 7, 1),
    calendar=business_days.BusinessCalendar.weekdays_only(),
    daily_start="9:00",
    daily_end="18:00",
    duration="1:00",
    buffer_before="0:15",
    buffer_after="0:15",
    step="0:30",
    tz="Asia/Tokyo",
)

for slot in slots[:5]:
    print(slot.start.isoformat(), "->", slot.end.isoformat())
    print("reserved:", slot.reserved_start.isoformat(), "->", slot.reserved_end.isoformat())
```

出力例です。

```text
2026-07-01T11:15:00+09:00 -> 2026-07-01T12:15:00+09:00
reserved: 2026-07-01T11:00:00+09:00 -> 2026-07-01T12:30:00+09:00

2026-07-01T11:45:00+09:00 -> 2026-07-01T12:45:00+09:00
reserved: 2026-07-01T11:30:00+09:00 -> 2026-07-01T13:00:00+09:00

2026-07-01T14:15:00+09:00 -> 2026-07-01T15:15:00+09:00
reserved: 2026-07-01T14:00:00+09:00 -> 2026-07-01T15:30:00+09:00
```

`slot.start` / `slot.end` は会議本体の時間です。

`slot.reserved_start` / `slot.reserved_end` は、バッファ込みで確保すべき時間です。これがあると、予定を入れる前に「前後の余白まで含めて安全か」を確認できます。

---

## Skillに同梱するスクリプト

Skill の本文に長い Python を毎回書くより、`scripts/find_slots.py` に寄せておくと安定します。

```python
import argparse
import json
from datetime import date, datetime
from pathlib import Path

from hmscalc import business_days, scheduling


def parse_rfc3339(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def busy_from_freebusy(response: dict) -> list[tuple[datetime, datetime]]:
    busy = []
    for calendar_id, payload in response.get("calendars", {}).items():
        if payload.get("errors"):
            reasons = ", ".join(error.get("reason", "unknown") for error in payload["errors"])
            raise RuntimeError(f"FreeBusy failed for {calendar_id}: {reasons}")
        for item in payload.get("busy", []):
            busy.append((parse_rfc3339(item["start"]), parse_rfc3339(item["end"])))
    return busy


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--freebusy", required=True)
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--tz", default="Asia/Tokyo")
    parser.add_argument("--daily-start", default="9:00")
    parser.add_argument("--daily-end", default="18:00")
    parser.add_argument("--duration", default="1:00")
    parser.add_argument("--buffer-before", default="0:15")
    parser.add_argument("--buffer-after", default="0:15")
    parser.add_argument("--step", default="0:30")
    parser.add_argument("--holiday", action="append", default=[])
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    response = json.loads(Path(args.freebusy).read_text())
    busy = busy_from_freebusy(response)
    holidays = [date.fromisoformat(value) for value in args.holiday]

    slots = scheduling.find_availability_across_business_days(
        busy,
        date.fromisoformat(args.start_date),
        date.fromisoformat(args.end_date),
        calendar=business_days.BusinessCalendar.weekdays_only(holidays=holidays),
        daily_start=args.daily_start,
        daily_end=args.daily_end,
        duration=args.duration,
        buffer_before=args.buffer_before,
        buffer_after=args.buffer_after,
        step=args.step,
        tz=args.tz,
    )

    for slot in slots[: args.limit]:
        print(
            json.dumps(
                {
                    "start": slot.start.isoformat(),
                    "end": slot.end.isoformat(),
                    "reserved_start": slot.reserved_start.isoformat(),
                    "reserved_end": slot.reserved_end.isoformat(),
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
```

このスクリプトは JSON Lines に近い形で1候補1行を出すので、Claude Code 側で読み取りやすくなります。

---

## 使い方の例

Skill を入れておくと、次のように頼めます。

```text
/find-meeting-slots 来週の平日で、1時間の打ち合わせ候補を5つ出して。
Google Calendar の primary を見て、前後15分バッファ。
9:00-18:00、30分刻み、Asia/Tokyo。
2026-07-03 は社内休日として除外。
```

Google Calendar を読むための MCP や連携設定がある環境なら、Claude Code が予定を取得して busy interval に変換します。まだカレンダー連携がない場合でも、FreeBusy JSON を渡せば同じ Skill で候補計算できます。

出力はこういう形を期待します。

```text
候補:
1. 2026-07-01 11:15-12:15 JST
   確保枠: 11:00-12:30 JST
2. 2026-07-01 11:45-12:45 JST
   確保枠: 11:30-13:00 JST
3. 2026-07-01 14:15-15:15 JST
   確保枠: 14:00-15:30 JST

前提:
- 平日 9:00-18:00
- 前後15分バッファ
- 30分刻み
- 2026-07-03 は社内休日として除外
- 予定作成は未実施
```

出力には「予定作成は未実施」も含めておきます。候補出しとイベント作成を分けることで、まず候補を確認し、選んだあとに別の明示的な依頼で予定作成へ進めます。

---

## なぜSkillにするのか

Skill にする理由は、予定調整が「毎回同じようで、少しずつ条件が違う」作業だからです。

- ある日は30分刻み
- ある日は15分刻み
- ある日は午前だけ
- ある日は祝日を除く
- ある日は複数人の busy をまとめる

こういう処理は、Skill に「確認すべき条件」「デフォルト値」「勝手に予定作成しないこと」「決定論的スクリプトを使うこと」を持たせると安定します。

Claude Code Skill は、単なるショートカットではなく、**自分の作業手順を小さな業務ツール化する仕組み** として使えます。

---

## まとめ

ここまでで、Claude Code Skill を使って Google Calendar の予定から空き時間候補を探す流れを作りました。

- Skill のディレクトリ名を `/find-meeting-slots` という呼び出し名にする
- `SKILL.md` に条件抽出、予定取得、候補計算、出力形式を書く
- Google Calendar FreeBusy の `busy` を `datetime` タプルに変換する
- hmscalc でバッファ込みの候補を決定論的に計算する
- 候補出しと予定作成は分ける

この構成にしておくと、予定調整を毎回の会話だけに閉じず、再利用できる手順として残せます。Claude Code は条件の読み取り、カレンダー情報の取り込み、候補の提示を担当し、スクリプトはバッファ込みで本当に入るかを判定します。

候補出しの段階では予定を作成しないので、最後の判断は人間側に残せます。チームで使うなら、稼働時間やバッファの標準値を Skill に寄せておくだけでも、日程調整のばらつきを減らせます。

## 参考

- [Claude Code: Extend Claude with skills](https://code.claude.com/docs/en/skills)
- [Anthropic: Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Google Calendar API: Freebusy query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Google Calendar API Python quickstart](https://developers.google.com/workspace/calendar/api/quickstart/python)
- [hmscalc - PyPI](https://pypi.org/project/hmscalc/)
- [hmscalc documentation](https://masanori0209.github.io/hmscalc/)
