# m-zenn-dev

## 概要
- Zennでの活動記録

## 文章スタイルガイド（AIエージェント向け）

記事を書く・直すときの文体を、筆者本人らしい文章／小説風の文章に統一するための設定を置いています。

- [`AGENTS.md`](./AGENTS.md) … 文体ガイド本体（唯一の正）。Cursor / Codex が参照します。
- [`CLAUDE.md`](./CLAUDE.md) … Claude Code 用の入口。`@AGENTS.md` で本体を読み込みます。
- [`.cursor/rules/zenn-writing-style.mdc`](./.cursor/rules/zenn-writing-style.mdc) … Cursor 用ルール。`articles/` `books/` の Markdown を編集すると適用されます。
- [`.cursor/rules/no-meta-in-articles.mdc`](./.cursor/rules/no-meta-in-articles.mdc) … 成果物へのメタ情報混入を防ぐ（`<!-- evidence: ... -->` は例外）。
- [`.cursor/rules/article-publish.mdc`](./.cursor/rules/article-publish.mdc) … 公開・再公開を依頼したときに適用されます。
- [`skills/article-ideation/SKILL.md`](./skills/article-ideation/SKILL.md) … 記事アイデア出し用の共有 skill。タイトル案、切り口、構成の種出しで使います。
- [`skills/article-publish/SKILL.md`](./skills/article-publish/SKILL.md) … 公開・再公開用（check → commit → push）。**ユーザーが明示したときだけ**使います。

文体を変えたいときは、まず `AGENTS.md` を編集してください。

`CODEX.md` / `codex.md` は置いていません。Codex 向けの共有ルールは `AGENTS.md` に集約します。

Agent Skills / `SKILL.md` は、文体ルールではなく繰り返し使う作業手順ができたときに追加します。`article-ideation`（種出し）と `article-publish`（公開）がその扱いです。文体の正は `AGENTS.md` のままにします。

記事アイデア出しを頼むときは、各ツールで次のように呼び出せます。

```text
Use $article-ideation to turn recent work into Zenn article ideas.
記事のアイデア出しをしたいので、skills/article-ideation/SKILL.md を使ってください。
```

公開・再公開を頼むとき:

```text
Use $article-publish to publish articles/cobol-webfw-nextjs-django.md
公開して / 公開し直して
```

## 公開前チェック

記事の frontmatter、Zenn 記法、ローカル画像、コードフェンス、文体上の気になる表現をまとめて確認できます。

```bash
# 全記事をチェック（error のみ終了コード 1）
npm run check:articles

# 特定の記事だけチェック
npm run check:articles -- articles/handovergap-rag-tidb.md

# warning も落とす公開直前モード
npm run check:articles:strict -- articles/handovergap-rag-tidb.md

# AI 臭チェック（定型・誇張・ナレーションなど）
npm run check:ai-smell -- articles/handovergap-rag-tidb.md

# AI 臭 warning も落とす
npm run check:ai-smell:strict -- articles/handovergap-rag-tidb.md

# 記事チェックに AI 臭判定を足す
npm run check:articles -- --ai-smell articles/handovergap-rag-tidb.md

# 外部リンクの死活チェックも行う
npm run check:articles:network -- articles/handovergap-rag-tidb.md

# 既存記事 ignore も含め、あえて全指摘を見る
npm run check:articles -- --no-ignore

# published: true に変わった記事だけ strict にする
npm run check:published-strict -- --published-diff-base=origin/main

# レポートや別ツールに渡す JSON 出力
node scripts/check-articles.mjs --json articles/handovergap-rag-tidb.md

# LLM に渡す公開前レビュー表プロンプトを生成
npm run review:article -- articles/handovergap-rag-tidb.md
```

`warn` は必ず直すものではなく、人間が公開前に見るためのメモです。古い公開済み記事もあるので、まずは `error` を機械的なブロッカー、`warn` を品質チェックとして扱います。

既存記事を新しい基準に合わせて無理に直さないため、`article-check.config.json` で ignore できます。現在は、導入前からある記事と一部の既存画像について `warn` だけを ignore しています。`error` は ignore していないので、リンク切れやファイル欠落などの壊れ方は通常どおり検出されます。

ignore ルールは次の形です。`path` は `*` / `**` が使えますが、新規記事まで黙らせないよう、既存記事はできるだけファイル名を明示します。

```json
{
  "path": "articles/example.md",
  "severities": ["warn"],
  "codes": ["content.evidence"],
  "reason": "legacy article; do not edit existing published posts just to satisfy the new harness"
}
```

ローカル画像は Zenn の GitHub 連携ルールに合わせて `/images` 配下に置きます。対応拡張子は `.png` `.jpg` `.jpeg` `.gif` `.webp`、ファイルサイズは 3MB 以内です。ローカル `.mp4` は `/images` 配下に置かず、必要なら YouTube など外部埋め込みに逃がします。

ベンチ・数字・「速い」系の主張を書くときは、近くに単行 HTML コメントで根拠を残す（**Zenn 上は非表示**なので公開後も残してよい）。

```markdown
<!-- evidence: command="npm run bench"; log="reports/bench-2026-07-01.md" -->
```

成果物へのメタ情報（編集ナレーション・`NOTE:`・evidence 以外の HTML コメント）は `AGENTS.md` §5.10 と `content.meta.*` warn で検知する。

pre-push でも published 差分 strict を走らせたい場合は、次を一度だけ実行します。

```bash
npm run setup:hooks
```


## Zenn CLI コマンド

### 記事の作成
```bash
# 新規記事の作成
npx zenn new:article

# プレビュー表示
npx zenn preview
```

### 本の作成
```bash
# 新規本の作成
npx zenn new:book

# 本のチャプター作成
npx zenn new:book:chapter
```

### その他のコマンド
```bash
# ヘルプの表示
npx zenn --help

# バージョン確認
npx zenn --version
```
