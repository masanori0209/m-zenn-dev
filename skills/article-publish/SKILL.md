---
name: article-publish
description: Publish or republish Zenn articles in m-zenn-dev. Use when the user explicitly asks to publish, republish, or push article changes after editing title, body, or images. Covers pre-flight checks, demo verification, git commit/push, and superseded draft cleanup. Do not run without explicit user request.
---

# Article Publish

Use this skill when the user **explicitly** asks to publish or republish a Zenn article. Voice and structure still follow `AGENTS.md`; this skill covers the release workflow only.

**Do not** set `published: true` or push to GitHub unless the user asked for publication.

## When to use

- 「公開して」「公開し直して」「push して記事を出して」
- Title / body / image edits followed by「再公開して」
- First-time publication after draft review

**Do not use** for drafting, ideation, or local preview only.

## Pre-flight

1. Identify the target file: `articles/<slug>.md`.
2. Run checks (error must be 0):

```bash
npm run check:articles -- articles/<slug>.md
npm run check:ai-smell -- articles/<slug>.md
```

Optional before first publish:

```bash
npm run check:articles:strict -- articles/<slug>.md
npm run check:ai-smell:strict -- articles/<slug>.md
```

`warn`（especially `content.evidence`） alone is not a blocker unless the user wants zero warnings.

3. If the article references a demo repo under `/Users/m_m/develop/9999_m2lab/`:
   - Run its verification script when one exists (`./scripts/run-all.sh`, `./scripts/verify.sh`, etc.).
   - Prefer `docker compose up --build` when the demo provides Compose.
   - Push demo repo changes **before or with** the article if the article depends on them.

4. Confirm images:
   - Markdown uses `![alt](/images/xxx.png)` — not plain text placeholders.
   - Files exist under `images/` and are within Zenn limits (see `AGENTS.md` §5.9).

5. Confirm no meta in the article body (`AGENTS.md` §5.10):
   - No edit narration, prompt echo, or internal labels (`NOTE:`, `Agent:`).
   - `<!-- evidence: ... -->` is allowed (invisible on Zenn).
   - `npm run check:articles` flags `content.meta.*` as warn.

## First publish

1. Set `published: true` in frontmatter **only now** (user requested publish).
2. Stage article + new/changed images under `images/`.
3. If replacing an old draft slug, also stage deletions of superseded `articles/*.md` and `images/*` files.
4. Commit with a message focused on **why** (e.g. publish new article, update title for republish).
5. Push `main` on `masanori0209/m-zenn-dev`.
6. Tell the user the Zenn URL:

```text
https://zenn.dev/m2lab/articles/<slug>
```

`<slug>` is the filename without `.md`. GitHub 連携で main への push 後、反映まで数分かかることがある。

## Republish (already published)

1. Keep `published: true`.
2. Commit only what changed (title, prose, images).
3. Push `main`. Slug unchanged → same Zenn URL.

## Git rules

- **Commit and push only when the user asked.** Do not commit unrelated edits.
- Demo repo (`9999_m2lab/<name>/`) and `m-zenn-dev` are separate remotes; push each that changed.
- Never force-push `main` unless the user explicitly requests it.

## Superseded drafts

When reframing or renaming (e.g. `cobol-cgi-ssr-*` → `cobol-webfw-*`):

1. Add the new article and images.
2. Delete the old article file and images that are no longer referenced.
3. Prefer a dedicated commit for large deletions if the publish commit is already pushed.

Do not rewrite old **already published** legacy articles just to satisfy new harness rules (`article-check.config.json` ignore list exists for that).

## After publish (optional)

- Framework/product repos (not `-demo`): README stays standalone; add Zenn URL only if the user asks.
- `-demo` repos: add or update Zenn URL in README when the user wants it.

## Handoff from ideation

`skills/article-ideation/SKILL.md` ends with draft scaffolding (`published: false`). Switch to this skill only after the user approves publication.
