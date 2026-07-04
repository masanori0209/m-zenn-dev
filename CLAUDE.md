@AGENTS.md

# Claude Code 補足

このファイルは Claude Code 用の入口です。文体・構成・禁止事項の唯一の正は、上で読み込んでいる `AGENTS.md` です。

- `CLAUDE.md` には文体ルールを重複して増やさない。
- Claude Code 固有の補足だけをここに書く。
- 記事のアイデア出し、タイトル案、切り口相談 → `@skills/article-ideation/SKILL.md`
- 公開・再公開（check → commit → push）→ `@skills/article-publish/SKILL.md`（**ユーザーが明示したときだけ**）
- 記事編集時のメタ混入防止 → `AGENTS.md` §5.10 / `.cursor/rules/no-meta-in-articles.mdc`
- 個人用の一時メモは `CLAUDE.local.md` に置き、コミットしない。
