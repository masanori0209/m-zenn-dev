import fs from "node:fs";
import path from "node:path";

const defaultRulesFile = "article-ai-smell.rules.json";

export function loadAiSmellRules(rulesFile = defaultRulesFile, rootDir = process.cwd()) {
  const absPath = path.resolve(rootDir, rulesFile);
  if (!fs.existsSync(absPath)) {
    throw new Error(`AI smell rules file not found: ${rulesFile}`);
  }

  const parsed = JSON.parse(fs.readFileSync(absPath, "utf8"));
  if (!Array.isArray(parsed.rules)) {
    throw new Error('AI smell rules must include a "rules" array');
  }

  const rules = parsed.rules.map((rule, index) => normalizeRule(rule, index));
  const heuristics = Array.isArray(parsed.heuristics) ? parsed.heuristics : [];
  const thresholds = parsed.thresholds ?? { cleanMax: 2, warnMax: 7 };

  return {
    file: rulesFile,
    version: parsed.version ?? 1,
    thresholds,
    rules,
    heuristics,
  };
}

function normalizeRule(rule, index) {
  if (!rule || typeof rule !== "object") {
    throw new Error(`rules[${index}] must be an object`);
  }

  const required = ["id", "category", "severity", "match", "pattern", "message"];
  for (const key of required) {
    if (!(key in rule)) {
      throw new Error(`rules[${index}] is missing ${key}`);
    }
  }

  let regex = null;
  if (rule.match === "regex") {
    regex = new RegExp(rule.pattern, rule.flags ?? "");
  }

  return {
    ...rule,
    weight: Number.isFinite(rule.weight) ? rule.weight : 1,
    regex,
  };
}

export function extractMarkdownBody(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { body: text, bodyStartLine: 1 };
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (endIndex === -1) {
    return { body: text, bodyStartLine: 1 };
  }

  return {
    body: lines.slice(endIndex + 1).join("\n"),
    bodyStartLine: endIndex + 2,
  };
}

export function collectProseLines(body) {
  const lines = body.split(/\r?\n/);
  const prose = [];
  let inCodeFence = false;
  let fenceMarker = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);

    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inCodeFence) {
        inCodeFence = true;
        fenceMarker = marker;
      } else if (marker[0] === fenceMarker[0] && marker.length >= fenceMarker.length) {
        inCodeFence = false;
        fenceMarker = null;
      }
      continue;
    }

    if (inCodeFence) {
      continue;
    }
    if (trimmed.startsWith("<!--")) {
      continue;
    }
    if (trimmed === ":::" || trimmed.startsWith(":::")) {
      continue;
    }
    if (/^!\[/.test(trimmed)) {
      continue;
    }

    prose.push({
      index,
      lineNumber: index + 1,
      text: line,
      trimmed,
    });
  }

  return prose;
}

export function scanAiSmell(text, options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const rulesConfig = options.rulesConfig ?? loadAiSmellRules(options.rulesFile, rootDir);
  const { body, bodyStartLine } = extractMarkdownBody(text);
  const proseLines = collectProseLines(body);
  const hits = [];

  for (const rule of rulesConfig.rules) {
    for (const prose of proseLines) {
      if (prose.trimmed === "") {
        continue;
      }

      const matched = matchesRule(rule, prose.trimmed);
      if (!matched) {
        continue;
      }

      if (rule.id === "emoji.body" && /^#{1,6}\s/.test(prose.trimmed)) {
        continue;
      }

      hits.push({
        id: rule.id,
        category: rule.category,
        severity: rule.severity,
        weight: rule.weight,
        line: bodyStartLine + prose.index,
        excerpt: excerpt(prose.trimmed, rule.pattern),
        message: rule.message,
        suggestion: rule.suggestion ?? "",
        ruleType: "phrase",
      });
    }
  }

  for (const heuristic of rulesConfig.heuristics) {
    const heuristicHits = runHeuristic(heuristic, proseLines, bodyStartLine);
    hits.push(...heuristicHits);
  }

  hits.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));

  const score = hits.reduce((sum, hit) => sum + (hit.weight ?? 0), 0);
  const level = classifyScore(score, rulesConfig.thresholds);

  return {
    score,
    level,
    hits,
    proseLineCount: proseLines.filter((line) => line.trimmed !== "").length,
    rulesFile: rulesConfig.file,
    thresholds: rulesConfig.thresholds,
  };
}

function matchesRule(rule, line) {
  if (rule.match === "contains") {
    return line.includes(rule.pattern);
  }
  if (rule.match === "regex") {
    rule.regex.lastIndex = 0;
    return rule.regex.test(line);
  }
  return false;
}

function excerpt(line, pattern, max = 72) {
  const index = line.indexOf(typeof pattern === "string" ? pattern.slice(0, 20) : line.slice(0, 20));
  const start = Math.max(0, index - 10);
  const slice = line.slice(start, start + max);
  return slice.length < line.length ? `${slice}…` : slice;
}

function runHeuristic(heuristic, proseLines, bodyStartLine) {
  if (heuristic.id === "structure.repeated-sentence-opener") {
    return detectRepeatedSentenceOpeners(heuristic, proseLines, bodyStartLine);
  }
  if (heuristic.id === "structure.list-only-section") {
    return detectListOnlySections(heuristic, proseLines, bodyStartLine);
  }
  return [];
}

function detectRepeatedSentenceOpeners(heuristic, proseLines, bodyStartLine) {
  const hits = [];
  const endings = ["です。", "ます。", "でした。", "ません。"];

  for (let index = 2; index < proseLines.length; index += 1) {
    const window = proseLines.slice(index - 2, index + 1);
    if (window.some((line) => line.trimmed.startsWith("#") || line.trimmed.startsWith("- ") || line.trimmed.startsWith("|"))) {
      continue;
    }

    const allMatch = window.every((line) => endings.some((ending) => line.trimmed.endsWith(ending)));
    if (!allMatch) {
      continue;
    }

    hits.push({
      id: heuristic.id,
      category: heuristic.category,
      severity: heuristic.severity,
      weight: heuristic.weight,
      line: bodyStartLine + window[2].index,
      excerpt: window.map((line) => line.trimmed).join(" / ").slice(0, 72),
      message: heuristic.message,
      suggestion: heuristic.suggestion ?? "",
      ruleType: "heuristic",
    });
    index += 1;
  }

  return hits;
}

function detectListOnlySections(heuristic, proseLines, bodyStartLine) {
  const hits = [];

  for (let index = 0; index < proseLines.length; index += 1) {
    const line = proseLines[index];
    if (!/^#{2,3}\s+/.test(line.trimmed)) {
      continue;
    }

    let cursor = index + 1;
    let listItems = 0;
    let proseCount = 0;

    while (cursor < proseLines.length) {
      const current = proseLines[cursor];
      if (/^#{1,6}\s+/.test(current.trimmed)) {
        break;
      }
      if (current.trimmed === "") {
        cursor += 1;
        continue;
      }
      if (/^[-*]\s+/.test(current.trimmed)) {
        listItems += 1;
      } else if (!current.trimmed.startsWith("|")) {
        proseCount += 1;
      }
      cursor += 1;
    }

    if (listItems >= 4 && proseCount === 0) {
      hits.push({
        id: heuristic.id,
        category: heuristic.category,
        severity: heuristic.severity,
        weight: heuristic.weight,
        line: bodyStartLine + line.index,
        excerpt: line.trimmed,
        message: heuristic.message,
        suggestion: heuristic.suggestion ?? "",
        ruleType: "heuristic",
      });
    }
  }

  return hits;
}

function classifyScore(score, thresholds) {
  if (score <= thresholds.cleanMax) {
    return "clean";
  }
  if (score <= thresholds.warnMax) {
    return "warn";
  }
  return "strong";
}

export function aiSmellLevelLabel(level) {
  if (level === "clean") {
    return "低";
  }
  if (level === "warn") {
    return "中";
  }
  return "高";
}

export function aiSmellHitsToIssues(file, hits, { codePrefix = "content.ai_smell" } = {}) {
  return hits.map((hit) => ({
    severity: hit.severity === "info" ? "warn" : hit.severity,
    code: `${codePrefix}.${hit.id}`,
    file,
    line: hit.line,
    message: `[${hit.category}] ${hit.message}${hit.suggestion ? ` → ${hit.suggestion}` : ""} (${hit.excerpt})`,
  }));
}
