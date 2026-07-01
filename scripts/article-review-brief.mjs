#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage:
  npm run review:article -- articles/my-article.md
  npm run review:article -- --network articles/my-article.md

Creates a Markdown brief that can be pasted into an LLM for a pre-publication review table.`);
  process.exit(args.length === 0 ? 1 : 0);
}

const checkerArgs = ["scripts/check-articles.mjs", "--json", "--skip-image-inventory", ...args];
const aiSmellArgs = ["scripts/check-ai-smell.mjs", "--json", ...args.filter((arg) => !arg.startsWith("--"))];

const result = spawnSync(process.execPath, checkerArgs, {
  cwd: rootDir,
  encoding: "utf8",
});

const aiSmellResult = spawnSync(process.execPath, aiSmellArgs, {
  cwd: rootDir,
  encoding: "utf8",
});

if (!result.stdout.trim()) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const report = JSON.parse(result.stdout);
const aiSmellReport = aiSmellResult.stdout.trim() ? JSON.parse(aiSmellResult.stdout) : null;
const files = report.files ?? [];
const ignoredCount = report.ignoredIssues?.length ?? 0;
const issueRows = (report.issues ?? []).map((issue) => {
  return `| ${issue.severity} | ${issue.code} | ${issue.file}:${issue.line} | ${escapeCell(issue.message)} |`;
});

console.log("# 公開前レビュー表プロンプト");
console.log("");
console.log("以下のハーネス結果と記事本文をもとに、Zenn 公開前レビュー表を作ってください。");
console.log("観点は `ブロッカー`, `根拠`, `文体`, `読者体験`, `公開前に直すこと` に分けてください。");
console.log("誇張せず、言えることと言えないことを分けて、日本語で簡潔にまとめてください。");
console.log("");
console.log("## ハーネス結果");
console.log("");
if (ignoredCount > 0) {
  console.log(`有効な指摘とは別に、ignore 設定で ${ignoredCount} 件を除外しています。`);
  console.log("");
}
console.log("| severity | code | location | message |");
console.log("|---|---|---|---|");
if (issueRows.length === 0) {
  console.log("| ok | - | - | ハーネス上の指摘はありません |");
} else {
  console.log(issueRows.join("\n"));
}
console.log("");
if (aiSmellReport?.reports?.length) {
  console.log("## AI 臭チェック");
  console.log("");
  console.log("| file | score | level | hits |");
  console.log("|---|---:|---|---:|");
  for (const item of aiSmellReport.reports) {
    console.log(`| ${item.file} | ${item.score} | ${item.levelLabel} | ${item.hits.length} |`);
  }
  console.log("");
}
console.log("## チェック JSON");
console.log("");
console.log("```json");
console.log(JSON.stringify(report, null, 2));
console.log("```");
if (aiSmellReport) {
  console.log("");
  console.log("## AI 臭チェック JSON");
  console.log("");
  console.log("```json");
  console.log(JSON.stringify(aiSmellReport, null, 2));
  console.log("```");
}

for (const relative of files) {
  const fullPath = path.join(rootDir, relative);
  if (!fs.existsSync(fullPath)) {
    continue;
  }
  console.log("");
  console.log(`## 記事本文: ${relative}`);
  console.log("");
  console.log("```markdown");
  console.log(fs.readFileSync(fullPath, "utf8"));
  console.log("```");
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}
