---
name: article-ideation
description: Generate, evaluate, and shape Zenn article ideas for this repository. Use when the user asks for article ideas, themes, titles, hooks, outlines, publication angles, or ways to turn recent development work, notes, repos, demos, failures, benchmarks, or contest entries into publishable Japanese technical articles for Codex, Claude Code, or Cursor.
---

# Article Ideation

Use this skill to turn rough material into article ideas that can actually be written. The goal is not a large generic list. The goal is a small set of article seeds with a clear reader promise, available evidence, honest limits, and a path to a draft.

Always use `AGENTS.md` as the writing-style source of truth. This skill controls the ideation workflow; `AGENTS.md` controls the voice.

## Workflow

1. Clarify the source material.
   - If the user names a repo, article, product, library, issue, PR, benchmark, demo, or contest, inspect that material before proposing ideas.
   - If the source is vague, make a reasonable assumption and label it. Ask only when the missing answer changes the article direction.
   - Separate verified facts from possible angles. Do not turn wishes into claims.

2. Find the articleable tension.
   Look for one of these shapes:
   - A thing was built, and the interesting part is why this shape worked.
   - A familiar task was harder than expected, and the useful part is the trap.
   - A tool or library changed the workflow, but only under specific conditions.
   - A benchmark or number exists, and the article is really about what that number does and does not prove.
   - A demo is fun, but the reusable lesson is outside the demo itself.
   - A failure, limitation, or workaround teaches more than the success path.

3. Generate candidates in layers.
   - Start with 5-8 rough ideas.
   - Collapse duplicates.
   - Keep the 3 strongest ideas, plus 1 risky-but-interesting idea if it exists.
   - For each idea, decide whether it wants Mode A (standard technical explanation) or Mode B (story-like essay) from `AGENTS.md`.

4. Score by publishability, not flashiness.
   Favor ideas that have:
   - Concrete source material: code, command output, screenshots, logs, before/after behavior, docs, or reproducible steps.
   - A reader who can act after reading.
   - A narrow scope that can be finished.
   - A natural limits section.
   - A demo, table, diagram, or small artifact that can appear early in the article.

5. Turn the best idea into a next step.
   End with the recommended first move:
   - collect evidence,
   - run a command,
   - make a screenshot/GIF,
   - draft an outline,
   - create `published: false` article scaffolding,
   - or intentionally drop the idea.

## Output Format

When brainstorming, use this table unless the user asks for a different shape:

| 優先 | 仮タイトル | 読者の得 | 根拠・素材 | モード | リスク | 次の一手 |
|---:|---|---|---|---|---|---|

Then add a short recommendation:

- `最初に書くなら`: one idea only.
- `理由`: why it is strongest.
- `まだ言えないこと`: claims that need evidence before drafting.

## Idea Filters

Reject or downgrade ideas when:

- The core claim depends on unverified speed, accuracy, adoption, popularity, or superiority.
- The article would only announce a feature without a reader-facing lesson.
- The demo is visually fun but the technical takeaway is thin.
- The idea requires touching old published articles just to satisfy new standards.
- The strongest title would need hype words such as `爆速`, `革命的`, or `圧倒的`.

## Title Guidance

Prefer titles that explain the actual article:

- `X を作った` is weaker than `X を作ったら Y が難所だった`.
- `速い` is weaker than `N件で Mms だったが、本当に見たいのは Z だった`.
- A story-like title is fine for Mode B, but the article still needs a technical landing.

Create 2-3 title variants for the top idea:

- Plain technical title.
- Slightly narrative title.
- Search-friendly title with product/library names.

## Evidence Notes

When an idea includes numbers, benchmarks, "fast", "accurate", "reduced", "improved", or similar claims, note what command or log would back them up before drafting:

```markdown
<!-- evidence: command="..."; log="..." -->
```

If evidence does not exist yet, say what to run or capture. Do not invent results. Put evidence in `<!-- evidence: ... -->` near numeric claims (invisible on Zenn; OK to keep after publish).

Do not put edit narration, chat replies, or internal labels in the article body. See `AGENTS.md` §5.10.

## Draft Handoff

If the user asks to proceed from idea to outline or draft:

1. Keep `published: false`.
2. Use the selected Mode A/B from `AGENTS.md`.
3. Put the demo or proof artifact early when available.
4. Include a scope message and a limits section.
5. Run `npm run check:articles -- articles/対象記事.md` after creating or editing a draft.

If the user asks to publish, switch to `skills/article-publish/SKILL.md` instead of finishing here.
