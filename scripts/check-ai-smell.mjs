#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  aiSmellHitsToIssues,
  aiSmellLevelLabel,
  loadAiSmellRules,
  scanAiSmell,
} from "./lib/ai-smell.mjs";

const rootDir = process.cwd();
const options = {
  strict: false,
  json: false,
  rulesFile: "article-ai-smell.rules.json",
};

const requestedFiles = [];

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--strict") {
    options.strict = true;
  } else if (arg === "--json") {
    options.json = true;
  } else if (arg.startsWith("--rules=")) {
    options.rulesFile = arg.slice("--rules=".length);
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else if (arg.startsWith("--")) {
    console.error(`unknown option: ${arg}`);
    process.exit(2);
  } else {
    requestedFiles.push(arg);
  }
}

function printHelp() {
  console.log(`Usage:
  npm run check:ai-smell -- articles/my-article.md
  node scripts/check-ai-smell.mjs --strict articles/my-article.md
  node scripts/check-ai-smell.mjs --json articles/my-article.md

Detects AI-ish phrasing and structure based on AGENTS.md and article-ai-smell.rules.json.
Warnings fail only with --strict. Score thresholds are configurable in the rules file.`);
}

function listMarkdownFiles(dir) {
  const absDir = path.join(rootDir, dir);
  if (!fs.existsSync(absDir)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const fullPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(path.relative(rootDir, fullPath)));
    } else if (entry.isFile() && fullPath.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectTargetFiles() {
  if (requestedFiles.length > 0) {
    return requestedFiles.map((file) => path.resolve(rootDir, file));
  }
  return [...listMarkdownFiles("articles"), ...listMarkdownFiles("books")].filter(
    (file) => !file.endsWith("/.keep"),
  );
}

function toRelative(file) {
  return path.relative(rootDir, file).replaceAll(path.sep, "/");
}

const rulesConfig = loadAiSmellRules(options.rulesFile, rootDir);
const files = collectTargetFiles();
const reports = [];
const allIssues = [];

for (const file of files) {
  if (!fs.existsSync(file)) {
    allIssues.push({
      severity: "error",
      code: "target.missing",
      file: toRelative(file),
      line: 1,
      message: "file does not exist",
    });
    continue;
  }

  const text = fs.readFileSync(file, "utf8");
  const result = scanAiSmell(text, { rootDir, rulesConfig });
  const issues = aiSmellHitsToIssues(toRelative(file), result.hits);
  allIssues.push(...issues);
  reports.push({
    file: toRelative(file),
    score: result.score,
    level: result.level,
    levelLabel: aiSmellLevelLabel(result.level),
    proseLineCount: result.proseLineCount,
    hits: result.hits,
  });
}

const errorCount = allIssues.filter((issue) => issue.severity === "error").length;
const warnCount = allIssues.filter((issue) => issue.severity === "warn").length;
const shouldFail = errorCount > 0 || (options.strict && warnCount > 0);

if (options.json) {
  console.log(
    JSON.stringify(
      {
        mode: { strict: options.strict, rulesFile: options.rulesFile },
        thresholds: rulesConfig.thresholds,
        reports,
        issues: allIssues,
      },
      null,
      2,
    ),
  );
} else {
  for (const report of reports) {
    console.log(
      `AI smell ${report.file}: score=${report.score} (${report.levelLabel}) hits=${report.hits.length}`,
    );
    for (const hit of report.hits) {
      console.log(
        `  ${hit.severity.toUpperCase()} ${hit.id}:${report.file}:${hit.line} ${hit.message} | ${hit.excerpt}`,
      );
    }
    if (report.hits.length === 0) {
      console.log("  ok no suspicious patterns");
    }
    console.log("");
  }

  const strictSuffix = options.strict ? " (strict mode)" : "";
  console.log(
    `ai-smell-check: checked ${files.length} file(s), ${errorCount} error(s), ${warnCount} warning(s)${strictSuffix}`,
  );
}

process.exit(shouldFail ? 1 : 0);
