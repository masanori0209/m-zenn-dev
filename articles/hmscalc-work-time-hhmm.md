---
title: "Python で作業時間を HH:MM 形式で足し算する"
emoji: "⏱️"
type: "tech"
topics: ["python", "pypi", "timedelta", "hmscalc"]
published: true
---

## はじめに

作業ログや学習時間を `"2:15:30"` のような文字列で持っているとき、**足し算・引き算・合計** をしたくなる場面はよくあります。

```python
sessions = ["2:15:30", "1:45:00", "0:30:15"]
# 今週の合計は？ 目標 8:00:00 との差は？
```

標準ライブラリだけでも実現できますが、**パース関数を自前で書いて、秒に直して、また `HH:MM:SS` に戻す** という手順が毎回必要になります。負の値（目標未達）や `HH:MM` / `HH:MM:SS` の混在まで考えると、コードが意外と長くなりがちです。

[hmscalc](https://pypi.org/project/hmscalc/) は **HH:MM / HH:MM:SS 文字列の加減算と集計** に特化した軽量ライブラリです。文字列をそのまま渡して演算できるので、上のような作業時間まわりはかなりスッキリ書けます。

```bash
pip install hmscalc
```

---

## 通常の Python だとこうなる

`datetime.timedelta` は日時計算の定番ですが、`"2:15:30"` のような文字列は **そのまま受け取れません**。自前でパースとフォーマットを用意する必要があります。

```python
def parse_hms(text: str) -> int:
    """'HH:MM' or 'HH:MM:SS' → 秒（ざっくり版）"""
    parts = text.strip().split(":")
    if len(parts) == 2:
        h, m = int(parts[0]), int(parts[1])
        s = 0
    else:
        h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
    return h * 3600 + m * 60 + s


def format_hms(total_seconds: int) -> str:
    """秒 → 'HH:MM:SS'（ざっくり版）"""
    sign = "-" if total_seconds < 0 else ""
    total = abs(total_seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{sign}{h}:{m:02}:{s:02}"


sessions = ["2:15:30", "1:45:00", "0:30:15"]

# 合計
total_sec = sum(parse_hms(t) for t in sessions)
print(format_hms(total_sec))  # 4:30:45

# 目標 8:00:00 との差（未達ならマイナス）
goal_sec = parse_hms("8:00:00")
print(format_hms(total_sec - goal_sec))  # -3:29:15

# 平均
avg_sec = round(total_sec / len(sessions))
print(format_hms(avg_sec))  # 1:30:15
```

動きます。ただ毎回 `parse_hms` / `format_hms` を持ち回るか、プロジェクト内にコピペすることになります。分・秒が 60 以上の入力、空白、負数、`HH:MM` と `HH:MM:SS` の混在など、**堅牢にするほどコードが膨らむ** のが現実です。

---

## hmscalc ならこう書ける

同じことを hmscalc では次のように書けます。

```python
from hmscalc import HMSTime

sessions = [
    HMSTime("2:15:30"),
    HMSTime("1:45:00"),
    HMSTime("0:30:15"),
]

weekly_total = HMSTime.sum(sessions)
print(weekly_total)                    # 4:30:45
print(str(weekly_total))               # "4:30:45" — そのまま表示に使える

goal = HMSTime("8:00:00")
print(weekly_total - goal)             # -3:29:15（目標との差）

print(HMSTime.average(sessions))       # 1:30:15（平均）
print(HMSTime.min(sessions))           # 0:30:15
print(HMSTime.max(sessions))           # 2:15:30
```

**パースもフォーマットもライブラリ側** なので、ビジネスロジック（「今週の合計」「目標との差」）だけに集中できます。

---

## 足し算・引き算

2 つの時間を直接つなげた演算もできます。

```python
from hmscalc import HMSTime

morning = HMSTime("2:15:30")
afternoon = HMSTime("1:45:00")

# 足し算
print(morning + afternoon)             # 4:00:30

# 引き算（残り時間、休憩控除など）
daily_target = HMSTime("8:00:00")
worked = HMSTime("5:30:00")
print(daily_target - worked)           # 2:30:00（あとこれだけ）

# 目標未達（マイナスもそのまま）
print(worked - daily_target)           # -2:30:00
```

`+` / `-` の結果も `HMSTime` なので、**チェーンして書けます**。

```python
# 実働 = セッション合計 − 休憩
sessions = [HMSTime("2:00"), HMSTime("1:30"), HMSTime("2:15")]
breaks = HMSTime("0:45")

net = HMSTime.sum(sessions) - breaks
print(net)  # 5:00:00
```

通常の Python なら、ここでも都度 `parse_hms` → 秒で計算 → `format_hms` が入ります。

---

## 複数件の合計（sum）

CSV や JSON から読んだ文字列リストを、そのまま集計する例です。

```python
from hmscalc import HMSTime

# スプレッドシートやログから来た想定
raw_times = ["1:30", "2:15:45", "0:45", "3:00:00"]

times = [HMSTime(t) for t in raw_times]
print(HMSTime.sum(times))  # 7:30:45
```

`HH:MM` と `HH:MM:SS` が **混在していても問題ありません**（hmscalc がそれぞれ解釈します）。

空リストの合計も安全です。

```python
print(HMSTime.sum([]))  # 0:00:00
```

---

## 集計まわり（平均・最小・最大）

週次レポートでよく使う集計もクラスメソッド 1 行です。

```python
from hmscalc import HMSTime

daily_logs = [
    HMSTime("7:45:00"),  # 月
    HMSTime("8:10:00"),  # 火
    HMSTime("6:30:00"),  # 水
    HMSTime("8:00:00"),  # 木
    HMSTime("7:15:00"),  # 金
]

print(HMSTime.sum(daily_logs))      # 37:40:00（週合計）
print(HMSTime.average(daily_logs))  # 7:32:00（1日平均）
print(HMSTime.min(daily_logs))      # 6:30:00（最短日）
print(HMSTime.max(daily_logs))      # 8:10:00（最長日）
```

通常の Python では `sum` / `min` / `max` の前後で毎回秒変換が必要ですが、hmscalc なら **リストを `HMSTime` にして渡すだけ** です。

---

## 比較：何行くらい違う？

| やりたいこと | 通常の Python（自前パース） | hmscalc |
|-------------|---------------------------|---------|
| 3 件の合計 | `format_hms(sum(parse_hms(t) for t in xs))` | `HMSTime.sum(map(HMSTime, xs))` |
| 2 件の引き算 | `format_hms(parse_hms(a) - parse_hms(b))` | `HMSTime(a) - HMSTime(b)` |
| 目標との差 | パース ×2 + 引き算 + フォーマット | `total - HMSTime("8:00:00")` |
| 平均 | 合計秒 ÷ 件数 → フォーマット | `HMSTime.average(times)` |

「関数を一度書けばあとは楽」も正しいですが、**小さなスクリプトやノートブックでは毎回コピペ** になりがちです。hmscalc は `pip install` するだけで、パース・演算・表示が一式そろいます。

---

## ターミナルから使う（CLI）

Python を書かずにサッと計算したいときは CLI も使えます（v0.6.0 以降）。

```bash
# 足し算（add / sum は同じ）
hmscalc add 2:15:30 1:45:00 0:30:15
# 4:30:45

hmscalc sum 1:30 2:15:45 0:45 3:00:00
# 7:30:45

# 引き算（先頭から残りを順に引く）
hmscalc sub 8:00:00 5:30:00
# 2:30:00

hmscalc sub 5:30:00 8:00:00
# -2:30:00
```

シェルスクリプトや CI ログの集計にもそのまま使えます。

---

## 入力の使い分け

| データ | API |
|--------|-----|
| 文字列 `"1:30:00"` | `HMSTime("1:30:00")` |
| 秒数 `5400` | `HMSTime.from_seconds(5400)` |
| `datetime.timedelta` | `HMSTime.from_timedelta(delta)` |

文字列以外は factory メソッド経由です。`HMSTime(123)` のように数値を直接渡すと `TypeError` になるので、`from_seconds()` を使います。

---

## timedelta との関係

| | hmscalc | timedelta |
|--|---------|-----------|
| `"1:30:15"` を直接パース | ✅ | ❌（別途変換） |
| 文字列での表示 | `"1:30:15"` | repr 依存 |
| 24 時間超の duration | ✅ | ✅ |
| 標準ライブラリ | ❌ | ✅ |

hmscalc は **人間が読む時刻文字列** を扱う層、timedelta は **日時計算の基盤** として併用するのがおすすめです。

```python
import datetime
from hmscalc import HMSTime

t = HMSTime("1:30:00")
delta = t.to_timedelta()
restored = HMSTime.from_timedelta(delta)  # "1:30:00" に戻せる
```

---

## まとめ

- **足し算** → `HMSTime("1:30") + HMSTime("2:00")` または `HMSTime.sum(...)`
- **引き算** → `HMSTime("8:00:00") - HMSTime("5:30:00")`（目標との差・休憩控除）
- **複数件の合計** → `HMSTime.sum(times)`（空リストも `0:00:00`）
- **平均・最小・最大** → `HMSTime.average` / `min` / `max`
- **ターミナル一発** → `hmscalc add` / `sub` / `sum`

自前で `parse` / `format` を書くより、**文字列のまま読み書きできる** のが hmscalc のいちばんの楽さです。

- PyPI: https://pypi.org/project/hmscalc/
- GitHub: https://github.com/masanori0209/hmscalc/
- 前編（PyPI 公開の記録）: [Pythonパッケージ開発からPyPI公開までの道のりと実践知見](https://zenn.dev/m2lab/articles/454a3a0dd27dc8)
