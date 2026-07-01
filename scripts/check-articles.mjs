#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { aiSmellHitsToIssues, scanAiSmell } from "./lib/ai-smell.mjs";

const rootDir = process.cwd();
const zennMediaMaxBytes = 3 * 1024 * 1024;
const zennImageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const mediaWarnBytes = 2.5 * 1024 * 1024;
const defaultIgnoreConfig = "article-check.config.json";

const options = {
  strict: false,
  json: false,
  network: false,
  skipImageInventory: false,
  publishedDiffBase: null,
  ignore: true,
  ignoreConfig: defaultIgnoreConfig,
  aiSmell: false,
  aiSmellStrict: false,
};

const requestedFiles = [];
const issues = [];
const networkLinks = [];
const networkResults = [];
const mediaResults = [];

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];

  if (arg === "--strict") {
    options.strict = true;
  } else if (arg === "--json") {
    options.json = true;
  } else if (arg === "--network") {
    options.network = true;
  } else if (arg === "--skip-image-inventory") {
    options.skipImageInventory = true;
  } else if (arg === "--published-diff") {
    options.publishedDiffBase = "origin/main";
  } else if (arg.startsWith("--published-diff-base=")) {
    options.publishedDiffBase = arg.slice("--published-diff-base=".length);
  } else if (arg === "--no-ignore") {
    options.ignore = false;
  } else if (arg.startsWith("--ignore-config=")) {
    options.ignoreConfig = arg.slice("--ignore-config=".length);
  } else if (arg === "--ai-smell") {
    options.aiSmell = true;
  } else if (arg === "--ai-smell-strict") {
    options.aiSmell = true;
    options.aiSmellStrict = true;
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
  npm run check:articles
  node scripts/check-articles.mjs articles/my-article.md
  node scripts/check-articles.mjs --strict articles/my-article.md
  node scripts/check-articles.mjs --network articles/my-article.md
  node scripts/check-articles.mjs --strict --published-diff-base=origin/main

Checks Zenn article/book markdown before publication.
Errors fail the command. Warnings fail only with --strict.
--network enables external link checking.
--no-ignore disables article-check.config.json ignore rules.
--ignore-config=path uses a different ignore config file.
--ai-smell adds AI-ish phrasing checks from article-ai-smell.rules.json.
--ai-smell-strict fails on AI smell warnings too.
--published-diff-base checks only articles changed from draft to published:true.`);
}

function addIssue(severity, file, line, message, code = "general") {
  issues.push({
    severity,
    code,
    file: toRelative(file),
    line,
    message,
  });
}

function compareIssues(a, b) {
  const byFile = a.file.localeCompare(b.file);
  if (byFile !== 0) {
    return byFile;
  }
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.code.localeCompare(b.code);
}

function toRelative(file) {
  return path.relative(rootDir, file).replaceAll(path.sep, "/");
}

function toRelativeConfigPath(file) {
  return path.relative(rootDir, file).replaceAll(path.sep, "/");
}

function listFiles(dir, predicate = () => true) {
  const absDir = path.join(rootDir, dir);
  if (!fs.existsSync(absDir)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const fullPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path.relative(rootDir, fullPath), predicate));
    } else if (entry.isFile() && predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function listMarkdownFiles(dir) {
  return listFiles(dir, (file) => file.endsWith(".md"));
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function getGitText(ref, relativeFile) {
  try {
    return runGit(["show", `${ref}:${relativeFile}`]);
  } catch {
    return null;
  }
}

function collectPublishedDiffFiles(baseRef) {
  let output = "";
  try {
    output = runGit([
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      `${baseRef}...HEAD`,
      "--",
      "articles",
    ]);
  } catch {
    output = runGit([
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      `${baseRef}..HEAD`,
      "--",
      "articles",
    ]);
  }

  const files = [];
  for (const relative of output.split(/\r?\n/).filter(Boolean)) {
    if (!relative.startsWith("articles/") || !relative.endsWith(".md")) {
      continue;
    }

    const currentFile = path.join(rootDir, relative);
    if (!fs.existsSync(currentFile)) {
      continue;
    }

    const current = extractFrontmatter(fs.readFileSync(currentFile, "utf8"), currentFile, {
      quiet: true,
    });
    if (!current || current.data.published !== true) {
      continue;
    }

    const previousText = getGitText(baseRef, relative);
    const previous = previousText
      ? extractFrontmatter(previousText, currentFile, { quiet: true })
      : null;

    if (!previous || previous.data.published !== true) {
      files.push(currentFile);
    }
  }

  return files;
}

function collectTargetFiles() {
  if (options.publishedDiffBase) {
    return collectPublishedDiffFiles(options.publishedDiffBase);
  }

  if (requestedFiles.length > 0) {
    return requestedFiles
      .map((file) => path.resolve(rootDir, file))
      .filter((file) => {
        if (!fs.existsSync(file)) {
          addIssue("error", file, 1, "file does not exist", "target.missing");
          return false;
        }
        if (!file.endsWith(".md")) {
          addIssue("error", file, 1, "target is not a markdown file", "target.not_markdown");
          return false;
        }
        return true;
      });
  }

  return [...listMarkdownFiles("articles"), ...listMarkdownFiles("books")].filter(
    (file) => !file.endsWith("/.keep"),
  );
}

function loadIgnoreConfig() {
  if (!options.ignore) {
    return {
      enabled: false,
      file: null,
      rules: [],
    };
  }

  const configFile = path.resolve(rootDir, options.ignoreConfig);
  if (!fs.existsSync(configFile)) {
    return {
      enabled: true,
      file: toRelativeConfigPath(configFile),
      rules: [],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch (error) {
    addIssue(
      "error",
      configFile,
      1,
      `ignore config is not valid JSON: ${error?.message ?? "parse error"}`,
      "config.ignore",
    );
    return {
      enabled: true,
      file: toRelativeConfigPath(configFile),
      rules: [],
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    addIssue("error", configFile, 1, "ignore config must be a JSON object", "config.ignore");
    return {
      enabled: true,
      file: toRelativeConfigPath(configFile),
      rules: [],
    };
  }

  if (!("ignore" in parsed)) {
    return {
      enabled: true,
      file: toRelativeConfigPath(configFile),
      rules: [],
    };
  }

  if (!Array.isArray(parsed.ignore)) {
    addIssue("error", configFile, 1, 'ignore config key "ignore" must be an array', "config.ignore");
    return {
      enabled: true,
      file: toRelativeConfigPath(configFile),
      rules: [],
    };
  }

  const rules = [];
  parsed.ignore.forEach((rule, index) => {
    const normalized = normalizeIgnoreRule(rule, index, configFile);
    if (normalized) {
      rules.push(normalized);
    }
  });

  return {
    enabled: true,
    file: toRelativeConfigPath(configFile),
    rules,
  };
}

function normalizeIgnoreRule(rule, index, configFile) {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
    addIssue("error", configFile, 1, `ignore[${index}] must be an object`, "config.ignore");
    return null;
  }

  if (typeof rule.path !== "string" || rule.path.trim() === "") {
    addIssue("error", configFile, 1, `ignore[${index}].path must be a non-empty string`, "config.ignore");
    return null;
  }

  const pathPattern = rule.path.replaceAll("\\", "/");
  const severities = normalizeOptionalStringArray(rule.severities, "severities", index, configFile);
  const codes = normalizeOptionalStringArray(rule.codes, "codes", index, configFile);
  const messageIncludes = normalizeOptionalStringArray(
    rule.messageIncludes,
    "messageIncludes",
    index,
    configFile,
  );
  if (severities === null || codes === null || messageIncludes === null) {
    return null;
  }

  if (severities) {
    for (const severity of severities) {
      if (!["error", "warn"].includes(severity)) {
        addIssue(
          "error",
          configFile,
          1,
          `ignore[${index}].severities includes unsupported value: ${severity}`,
          "config.ignore",
        );
        return null;
      }
    }
  }

  return {
    index,
    path: pathPattern,
    pathRegex: globToRegExp(pathPattern),
    severities,
    severitySet: severities ? new Set(severities) : null,
    codes,
    codeRegexes: codes ? codes.map(globToRegExp) : null,
    messageIncludes,
    reason: typeof rule.reason === "string" ? rule.reason : "",
  };
}

function normalizeOptionalStringArray(value, field, index, configFile) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    addIssue(
      "error",
      configFile,
      1,
      `ignore[${index}].${field} must be an array of non-empty strings`,
      "config.ignore",
    );
    return null;
  }
  return value.map((item) => item.trim());
}

function globToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  return new RegExp(`${source}$`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyIgnoreRules(allIssues, rules) {
  const activeIssues = [];
  const ignoredIssues = [];

  for (const issue of allIssues) {
    const ignoreRule = rules.find((rule) => issueMatchesIgnoreRule(issue, rule));
    if (!ignoreRule) {
      activeIssues.push(issue);
      continue;
    }

    ignoredIssues.push({
      ...issue,
      ignoredBy: {
        path: ignoreRule.path,
        severities: ignoreRule.severities,
        codes: ignoreRule.codes,
        reason: ignoreRule.reason,
      },
    });
  }

  return { activeIssues, ignoredIssues };
}

function issueMatchesIgnoreRule(issue, rule) {
  if (!rule.pathRegex.test(issue.file)) {
    return false;
  }
  if (rule.severitySet && !rule.severitySet.has(issue.severity)) {
    return false;
  }
  if (rule.codeRegexes && !rule.codeRegexes.some((regex) => regex.test(issue.code))) {
    return false;
  }
  if (rule.messageIncludes && !rule.messageIncludes.some((part) => issue.message.includes(part))) {
    return false;
  }
  return true;
}

function serializeIgnoreConfig(config) {
  return {
    enabled: config.enabled,
    file: config.file,
    rules: config.rules.map((rule) => ({
      path: rule.path,
      severities: rule.severities,
      codes: rule.codes,
      messageIncludes: rule.messageIncludes,
      reason: rule.reason,
    })),
  };
}

function stripInlineComment(value) {
  let quote = null;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (char === "#" && quote === null && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd();
    }
  }

  return value.trimEnd();
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitInlineArray(value) {
  const raw = value.trim();
  if (!raw.startsWith("[") || !raw.endsWith("]")) {
    return null;
  }

  const body = raw.slice(1, -1).trim();
  if (body === "") {
    return [];
  }

  const parts = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      current += char;
      continue;
    }
    if (char === quote) {
      quote = null;
      current += char;
      continue;
    }
    if (char === "," && quote === null) {
      parts.push(parseScalar(current));
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim() !== "") {
    parts.push(parseScalar(current));
  }

  return parts;
}

function parseScalar(value) {
  const cleaned = stripInlineComment(value).trim();
  const inlineArray = splitInlineArray(cleaned);
  if (inlineArray) {
    return inlineArray;
  }
  if (cleaned === "true") {
    return true;
  }
  if (cleaned === "false") {
    return false;
  }
  return unquote(cleaned);
}

function parseFrontmatter(raw) {
  const data = {};
  const keyLines = {};
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const originalLine = lines[index];
    const line = stripInlineComment(originalLine);
    if (line.trim() === "") {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!match) {
      continue;
    }

    const [, key, value = ""] = match;
    keyLines[key] = index + 2;

    if (value.trim() !== "") {
      data[key] = parseScalar(value);
      continue;
    }

    const items = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const itemMatch = lines[cursor].match(/^\s*-\s+(.+)$/);
      if (!itemMatch) {
        break;
      }
      items.push(parseScalar(itemMatch[1]));
      cursor += 1;
    }

    if (items.length > 0) {
      data[key] = items;
      index = cursor - 1;
    } else {
      data[key] = "";
    }
  }

  return { data, keyLines };
}

function extractFrontmatter(text, file, { quiet = false } = {}) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    if (!quiet) {
      addIssue(
        "error",
        file,
        1,
        "frontmatter must start at the first line with ---",
        "frontmatter.missing",
      );
    }
    return null;
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (endIndex === -1) {
    if (!quiet) {
      addIssue(
        "error",
        file,
        1,
        "frontmatter closing --- is missing",
        "frontmatter.unclosed",
      );
    }
    return null;
  }

  const raw = lines.slice(1, endIndex).join("\n");
  const body = lines.slice(endIndex + 1).join("\n");
  return {
    raw,
    body,
    bodyStartLine: endIndex + 2,
    ...parseFrontmatter(raw),
  };
}

function isUrl(value) {
  return /^(https?:)?\/\//.test(value) || value.startsWith("mailto:");
}

function isNetworkUrl(value) {
  return /^https?:\/\//.test(value);
}

function isArticle(file) {
  return toRelative(file).startsWith("articles/");
}

function isBookChapter(file) {
  return toRelative(file).startsWith("books/") && path.basename(file) !== "config.yaml";
}

function normalizeMarkdownDestination(raw) {
  const value = raw.trim();
  const match = value.match(/^(\S+)(?:\s+(.+))?$/);
  if (!match) {
    return { src: value, suffix: "" };
  }
  return { src: match[1], suffix: match[2] ?? "" };
}

function checkSlug(file) {
  const relative = toRelative(file);

  if (isArticle(file)) {
    const slug = path.basename(file, ".md");
    if (!/^[a-z0-9_-]{12,50}$/.test(slug)) {
      addIssue(
        "error",
        file,
        1,
        "article slug must be 12-50 chars using a-z, 0-9, hyphen, or underscore",
        "frontmatter.slug",
      );
    }
  }

  if (relative.startsWith("books/") && relative.endsWith(".md")) {
    const slug = path.basename(file, ".md").replace(/^\d+\./, "");
    if (!/^[a-z0-9_-]{1,50}$/.test(slug)) {
      addIssue(
        "error",
        file,
        1,
        "book chapter slug must be 1-50 chars using a-z, 0-9, hyphen, or underscore",
        "frontmatter.slug",
      );
    }
  }
}

function checkArticleFrontmatter(file, data, keyLines) {
  const required = ["title", "emoji", "type", "topics", "published"];
  for (const key of required) {
    if (!(key in data)) {
      addIssue("error", file, 1, `frontmatter is missing required key: ${key}`, "frontmatter.key");
    }
  }

  if (typeof data.title !== "string" || data.title.trim() === "") {
    addIssue("error", file, keyLines.title ?? 1, "title must be a non-empty string", "frontmatter.title");
  } else if ([...data.title].length > 70) {
    addIssue(
      "warn",
      file,
      keyLines.title,
      "title is long; check that it still reads well in cards",
      "frontmatter.title",
    );
  }

  if (typeof data.emoji !== "string" || data.emoji.trim() === "") {
    addIssue("error", file, keyLines.emoji ?? 1, "emoji must be set", "frontmatter.emoji");
  } else {
    const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
    const graphemes = [...segmenter.segment(data.emoji)].map((item) => item.segment);
    if (graphemes.length !== 1) {
      addIssue("warn", file, keyLines.emoji, "emoji should be one visible character", "frontmatter.emoji");
    }
  }

  if (!["tech", "idea"].includes(data.type)) {
    addIssue("error", file, keyLines.type ?? 1, 'type must be "tech" or "idea"', "frontmatter.type");
  }

  if (!Array.isArray(data.topics)) {
    addIssue("error", file, keyLines.topics ?? 1, "topics must be an array", "frontmatter.topics");
  } else {
    if (data.topics.length === 0) {
      addIssue("warn", file, keyLines.topics, "topics is empty; add at least one useful topic", "frontmatter.topics");
    }
    if (data.topics.length > 5) {
      addIssue("error", file, keyLines.topics, "topics must have at most 5 items", "frontmatter.topics");
    }
    if (data.type === "tech" && data.topics.length < 3) {
      addIssue("warn", file, keyLines.topics, "tech articles usually benefit from 3-5 topics", "frontmatter.topics");
    }

    for (const topic of data.topics) {
      if (typeof topic !== "string" || topic.trim() === "") {
        addIssue("error", file, keyLines.topics, "each topic must be a non-empty string", "frontmatter.topics");
      } else if (/[A-Z\s]/.test(topic)) {
        addIssue(
          "warn",
          file,
          keyLines.topics,
          `topic "${topic}" may not match Zenn tag conventions`,
          "frontmatter.topics",
        );
      }
    }
  }

  if (typeof data.published !== "boolean") {
    addIssue("error", file, keyLines.published ?? 1, "published must be true or false", "frontmatter.published");
  }

  if ("published_at" in data) {
    const value = String(data.published_at);
    if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/.test(value)) {
      addIssue(
        "error",
        file,
        keyLines.published_at,
        "published_at must be YYYY-MM-DD or YYYY-MM-DD hh:mm",
        "frontmatter.published_at",
      );
    }

    if (data.published !== true) {
      addIssue(
        "warn",
        file,
        keyLines.published_at,
        "published_at is usually meaningful when published is true",
        "frontmatter.published_at",
      );
    }
  }
}

function checkBookFrontmatter(file, data, keyLines) {
  if (!("title" in data)) {
    addIssue("error", file, 1, "book chapter frontmatter is missing title", "frontmatter.key");
  } else if (typeof data.title !== "string" || data.title.trim() === "") {
    addIssue("error", file, keyLines.title ?? 1, "title must be a non-empty string", "frontmatter.title");
  }

  if ("free" in data && typeof data.free !== "boolean") {
    addIssue("error", file, keyLines.free ?? 1, "free must be true or false", "frontmatter.free");
  }
}

function scanBody(file, body, bodyStartLine, data) {
  const lines = body.split(/\r?\n/);
  const headingCounts = new Map();
  const h1Lines = [];
  const localMedia = [];
  const codeBlocksWithoutLanguage = [];
  const zennContainers = [];
  const evidenceLines = [];
  const claimLines = [];
  let inCodeFence = false;
  let fenceMarker = null;
  let fenceLine = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = bodyStartLine + index;
    const line = lines[index];
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);

    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inCodeFence) {
        inCodeFence = true;
        fenceMarker = marker;
        fenceLine = lineNumber;
        if (fenceMatch[2].trim() === "") {
          codeBlocksWithoutLanguage.push(lineNumber);
        }
      } else if (marker[0] === fenceMarker[0] && marker.length >= fenceMarker.length) {
        inCodeFence = false;
        fenceMarker = null;
        fenceLine = 0;
      }
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    if (/<!--\s*evidence\s*:/i.test(line)) {
      evidenceLines.push(lineNumber);
    }

    if (looksLikeEvidenceNeedingClaim(line)) {
      claimLines.push({ line: lineNumber, text: trimmed });
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      headingCounts.set(title, (headingCounts.get(title) ?? 0) + 1);
      if (level === 1) {
        h1Lines.push(lineNumber);
      }
    }

    if (trimmed.startsWith(":::")) {
      if (trimmed === ":::") {
        if (zennContainers.length === 0) {
          addIssue("error", file, lineNumber, "Zenn container close marker has no opener", "zenn.container");
        } else {
          zennContainers.pop();
        }
      } else {
        zennContainers.push({ line: lineNumber, marker: trimmed });
      }
    }

    for (const match of line.matchAll(/!\[([^\]]*)\]\(([^)\n]+)\)/g)) {
      const [, alt, rawDestination] = match;
      const { src, suffix } = normalizeMarkdownDestination(rawDestination);
      localMedia.push({ line: lineNumber, alt, src, suffix, kind: "image" });
    }

    for (const match of line.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\n]+)\)/g)) {
      const [, text, rawDestination] = match;
      const { src } = normalizeMarkdownDestination(rawDestination);
      registerNetworkLink(file, lineNumber, src, text);
    }

    for (const match of line.matchAll(/https?:\/\/[^\s<>)]+/g)) {
      registerNetworkLink(file, lineNumber, match[0], "bare-url");
    }

    for (const match of line.matchAll(/<(img|video)\b([^>]*)>/g)) {
      const [, tag, attrs] = match;
      const src = readHtmlAttr(attrs, "src");
      const poster = readHtmlAttr(attrs, "poster");
      const alt = readHtmlAttr(attrs, "alt") ?? "html-media";
      if (src) {
        localMedia.push({ line: lineNumber, alt, src, suffix: "", kind: tag });
      }
      if (poster) {
        localMedia.push({ line: lineNumber, alt: `${alt} poster`, src: poster, suffix: "", kind: "image" });
      }
    }
  }

  if (inCodeFence) {
    addIssue("error", file, fenceLine, "code fence is not closed", "markdown.code_fence");
  }

  for (const line of codeBlocksWithoutLanguage) {
    addIssue("warn", file, line, "code fence should include a language tag", "markdown.code_fence");
  }

  for (const container of zennContainers) {
    addIssue("error", file, container.line, `Zenn container is not closed: ${container.marker}`, "zenn.container");
  }

  if (h1Lines.length > 1) {
    addIssue(
      "warn",
      file,
      h1Lines[1],
      "article has multiple H1 headings; frontmatter title is already the page title",
      "markdown.heading",
    );
  }

  for (const [heading, count] of headingCounts) {
    if (count > 1) {
      addIssue("warn", file, bodyStartLine, `duplicate heading: ${heading}`, "markdown.heading");
    }
  }

  for (const media of localMedia) {
    checkMediaReference(file, media);
  }

  checkEvidenceClaims(file, claimLines, evidenceLines);
  checkContentSignals(file, body, bodyStartLine, data, localMedia);
}

function readHtmlAttr(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
  return match ? match[1] : null;
}

function registerNetworkLink(file, line, href, label) {
  if (!isNetworkUrl(href)) {
    return;
  }

  const withoutFragment = href.split("#")[0];
  networkLinks.push({
    file,
    line,
    label,
    url: withoutFragment,
  });
}

function resolveLocalMediaPath(file, src) {
  if (src.startsWith("/")) {
    return path.join(rootDir, src.slice(1));
  }
  return path.resolve(path.dirname(file), src);
}

function checkMediaReference(file, media) {
  const { line, alt, src, kind } = media;

  if (kind === "image") {
    checkAltQuality(file, line, alt);
  }

  if (isNetworkUrl(src)) {
    registerNetworkLink(file, line, src, alt || "media");
    return;
  }

  if (isUrl(src) || src.startsWith("data:")) {
    return;
  }

  if (!src.startsWith("/images/")) {
    addIssue(
      "error",
      file,
      line,
      `local media should use an absolute /images/... path for Zenn GitHub deploy: ${src}`,
      "media.path",
    );
  }

  const mediaPath = resolveLocalMediaPath(file, src);
  if (!fs.existsSync(mediaPath)) {
    addIssue("error", file, line, `local media file is missing: ${src}`, "media.missing");
    return;
  }

  checkMediaFile(mediaPath, file, line, { referencedFromArticle: true, kind });
}

function checkAltQuality(file, line, alt) {
  const normalized = alt.trim();
  if (normalized === "") {
    addIssue("warn", file, line, "image alt text is empty", "media.alt");
    return;
  }

  if ([...normalized].length < 6) {
    addIssue("warn", file, line, "image alt text is very short; describe what the reader sees", "media.alt");
  }

  if (/^(image|img|画像|スクショ|screenshot|demo|デモ|アイキャッチ)$/i.test(normalized)) {
    addIssue("warn", file, line, `image alt text is too generic: ${normalized}`, "media.alt");
  }

  if (/\.(png|jpe?g|gif|webp|mp4)$/i.test(normalized)) {
    addIssue("warn", file, line, "image alt text looks like a filename", "media.alt");
  }
}

function checkMediaFile(mediaPath, articleFile, line, { referencedFromArticle = false, kind = "image" } = {}) {
  const ext = path.extname(mediaPath).toLowerCase();
  const relative = toRelative(mediaPath);
  const stats = fs.statSync(mediaPath);
  const bytes = stats.size;
  const result = {
    file: relative,
    bytes,
    ext,
    referencedFromArticle,
    dimensions: null,
  };

  if (kind === "video" || ext === ".mp4" || ext === ".mov" || ext === ".webm") {
    addIssue(
      "error",
      articleFile,
      line,
      `local video is not supported by Zenn GitHub image deploy: ${relative}`,
      "media.video",
    );
    mediaResults.push(result);
    return;
  }

  if (!zennImageExtensions.has(ext)) {
    addIssue(
      "error",
      articleFile,
      line,
      `unsupported image extension for Zenn GitHub deploy: ${relative}`,
      "media.extension",
    );
  }

  if (bytes > zennMediaMaxBytes) {
    addIssue(
      "error",
      articleFile,
      line,
      `image file exceeds Zenn 3MB limit: ${relative} (${formatBytes(bytes)})`,
      "media.size",
    );
  } else if (bytes > mediaWarnBytes) {
    addIssue(
      "warn",
      articleFile,
      line,
      `image file is close to Zenn 3MB limit: ${relative} (${formatBytes(bytes)})`,
      "media.size",
    );
  }

  const dimensions = readImageDimensions(mediaPath);
  result.dimensions = dimensions;
  if (!dimensions) {
    addIssue("warn", articleFile, line, `could not read image dimensions: ${relative}`, "media.dimensions");
  } else {
    const { width, height } = dimensions;
    const longEdge = Math.max(width, height);
    const isGif = ext === ".gif";
    const tooWide = isGif ? width > 1280 || height > 900 : width > 1800 || height > 1400;
    if (tooWide) {
      addIssue(
        "warn",
        articleFile,
        line,
        `image dimensions are large for article display: ${relative} (${width}x${height})`,
        "media.dimensions",
      );
    }
    if (isGif && (bytes > 2 * 1024 * 1024 || longEdge > 1000)) {
      addIssue(
        "warn",
        articleFile,
        line,
        `GIF is heavy; consider shortening, resizing, or using an external video embed: ${relative}`,
        "media.gif",
      );
    }
  }

  mediaResults.push(result);
}

function readImageDimensions(file) {
  const buffer = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();

  if (ext === ".png" && buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (ext === ".gif" && buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }

  if ((ext === ".jpg" || ext === ".jpeg") && buffer.length > 4) {
    return readJpegDimensions(buffer);
  }

  if (ext === ".webp" && buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF") {
    return readWebpDimensions(buffer);
  }

  return null;
}

function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebpDimensions(buffer) {
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function looksLikeEvidenceNeedingClaim(line) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("|")) {
    return false;
  }
  if (/<!--\s*evidence\s*:/i.test(trimmed)) {
    return false;
  }
  if (!/[0-9０-９]/.test(trimmed) && !/(速い|高速|爆速|レイテンシ|ベンチ|benchmark|精度|正確|改善|削減|短縮)/i.test(trimmed)) {
    return false;
  }
  return /(速い|高速|爆速|レイテンシ|ベンチ|benchmark|スループット|精度|正確|改善|削減|短縮|ms|ミリ秒|秒以内|%|％|倍|万行|MB|GB|件\/秒|req\/s|accuracy|recall|rate)/i.test(trimmed);
}

function checkEvidenceClaims(file, claimLines, evidenceLines) {
  for (const claim of claimLines) {
    const hasEvidenceNearby = evidenceLines.some((line) => Math.abs(line - claim.line) <= 3);
    if (!hasEvidenceNearby) {
      addIssue(
        "warn",
        file,
        claim.line,
        'numeric/performance claim should have a nearby evidence comment: <!-- evidence: command="..." log="..." -->',
        "content.evidence",
      );
    }
  }
}

function checkContentSignals(file, body, bodyStartLine, data, localMedia) {
  const spellingChecks = [
    ["Github", "GitHub"],
    ["ClaudeCode", "Claude Code"],
    ["GoogleCalendar", "Google Calendar"],
    ["Ami Voice", "AmiVoice"],
  ];

  for (const [wrong, right] of spellingChecks) {
    const line = findLine(body, wrong);
    if (line !== null) {
      addIssue("warn", file, bodyStartLine + line, `use "${right}" instead of "${wrong}"`, "content.spelling");
    }
  }

  const todoLine = findLineRegex(body, /\b(TODO|FIXME|要確認|あとで|未検証)\b/);
  if (todoLine !== null) {
    addIssue("warn", file, bodyStartLine + todoLine, "draft marker remains in the article body", "content.draft");
  }

  const hasScopeMessage = /:::message/.test(body);
  if (data.type === "tech" && !hasScopeMessage) {
    addIssue(
      "warn",
      file,
      bodyStartLine,
      "consider adding :::message to declare scope or verification limits",
      "content.scope",
    );
  }

  const hasLimitSection = /^#{2,3}\s*(限界|注意|今回作らないもの|できないこと|今後)/m.test(body);
  if (data.type === "tech" && !hasLimitSection) {
    addIssue("warn", file, bodyStartLine, "consider adding a limits/scope section before publishing", "content.limits");
  }

  if (body.length > 3000 && localMedia.length === 0) {
    addIssue("warn", file, bodyStartLine, "long article has no image/video; consider adding proof or a demo asset", "media.none");
  }
}

function findLine(text, needle) {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? null : index;
}

function findLineRegex(text, regex) {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => regex.test(line));
  return index === -1 ? null : index;
}

function checkImagesInventory() {
  if (!fs.existsSync(path.join(rootDir, "images"))) {
    return;
  }

  for (const mediaPath of listFiles("images")) {
    checkMediaFile(mediaPath, mediaPath, 1, { referencedFromArticle: false, kind: "image" });
  }
}

function checkFile(file) {
  checkSlug(file);

  const text = fs.readFileSync(file, "utf8");
  const parsed = extractFrontmatter(text, file);
  if (!parsed) {
    return;
  }

  if (isArticle(file)) {
    checkArticleFrontmatter(file, parsed.data, parsed.keyLines);
  } else if (isBookChapter(file)) {
    checkBookFrontmatter(file, parsed.data, parsed.keyLines);
  }

  scanBody(file, parsed.body, parsed.bodyStartLine, parsed.data);
  if (options.aiSmell) {
    checkAiSmell(file, text);
  }
}

function checkAiSmell(file, text) {
  const result = scanAiSmell(text, { rootDir });
  for (const issue of aiSmellHitsToIssues(toRelative(file), result.hits)) {
    addIssue(issue.severity, file, issue.line, issue.message, issue.code);
  }

  if (options.aiSmellStrict && result.level === "strong") {
    addIssue(
      "error",
      file,
      1,
      `AI smell score is high (${result.score}); review phrasing before publishing`,
      "content.ai_smell.score",
    );
  }
}

async function checkNetworkLinks() {
  const seen = new Set();
  for (const link of networkLinks) {
    if (seen.has(link.url)) {
      continue;
    }
    seen.add(link.url);
    const result = await probeUrl(link.url);
    networkResults.push({ ...link, ...result });

    if (result.ok) {
      continue;
    }

    const severity = result.status && [401, 403, 429].includes(result.status) ? "warn" : "error";
    addIssue(
      severity,
      link.file,
      link.line,
      `external link check failed (${result.status ?? result.error}): ${link.url}`,
      "network.link",
    );
  }
}

async function probeUrl(url) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
        headers: {
          "user-agent": "m-zenn-dev-article-check/1.0",
        },
      });
      if (response.status === 405 && method === "HEAD") {
        continue;
      }
      return {
        ok: response.status < 400,
        status: response.status,
        method,
        finalUrl: response.url,
      };
    } catch (error) {
      if (method === "HEAD") {
        continue;
      }
      return {
        ok: false,
        status: null,
        method,
        error: error?.name ?? "network_error",
      };
    }
  }

  return {
    ok: false,
    status: null,
    method: "GET",
    error: "unknown_network_error",
  };
}

const files = collectTargetFiles();
for (const file of files) {
  checkFile(file);
}
if (!options.publishedDiffBase && !options.skipImageInventory) {
  checkImagesInventory();
}

if (options.network) {
  await checkNetworkLinks();
}

const ignoreConfig = loadIgnoreConfig();
const { activeIssues, ignoredIssues } = applyIgnoreRules(issues, ignoreConfig.rules);
activeIssues.sort(compareIssues);
ignoredIssues.sort(compareIssues);

const errorCount = activeIssues.filter((issue) => issue.severity === "error").length;
const warnCount = activeIssues.filter((issue) => issue.severity === "warn").length;
const ignoredCount = ignoredIssues.length;
const shouldFail = errorCount > 0 || (options.strict && warnCount > 0);

if (options.json) {
  console.log(
    JSON.stringify(
      {
        mode: {
          strict: options.strict,
          network: options.network,
          skipImageInventory: options.skipImageInventory,
          publishedDiffBase: options.publishedDiffBase,
          ignore: options.ignore,
        },
        files: files.map(toRelative),
        issues: activeIssues,
        ignoredIssues,
        ignore: serializeIgnoreConfig(ignoreConfig),
        media: mediaResults,
        network: networkResults,
      },
      null,
      2,
    ),
  );
} else {
  for (const issue of activeIssues) {
    const marker = issue.severity.toUpperCase();
    console.log(`${marker} ${issue.file}:${issue.line} [${issue.code}] ${issue.message}`);
  }

  const strictSuffix = options.strict ? " (strict mode)" : "";
  const networkSuffix = options.network ? `, ${networkResults.length} link(s) checked` : "";
  const diffSuffix = options.publishedDiffBase
    ? `, published diff base=${options.publishedDiffBase}`
    : "";
  const ignoreSuffix = ignoredCount > 0 ? `, ${ignoredCount} ignored` : "";
  console.log(
    `article-check: checked ${files.length} file(s), ${errorCount} error(s), ${warnCount} warning(s)${strictSuffix}${networkSuffix}${diffSuffix}${ignoreSuffix}`,
  );
}

process.exit(shouldFail ? 1 : 0);
