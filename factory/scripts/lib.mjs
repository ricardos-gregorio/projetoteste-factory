import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const factoryRoot = join(__dirname, "..");
export const repoRoot = join(factoryRoot, "..");

export function loadConfig() {
  return JSON.parse(readFileSync(join(factoryRoot, "config.json"), "utf8"));
}

export function gh(args, { repo } = {}) {
  const full = repo ? ["-R", repo, ...args] : [...args];
  return execFileSync("gh", full, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function ghJson(args, { repo } = {}) {
  const out = gh(args, { repo });
  return JSON.parse(out || "null");
}

export function issueType(labels = []) {
  const names = labels.map((l) => (typeof l === "string" ? l : l.name).toLowerCase());
  if (names.includes("bug")) return "bug";
  if (names.includes("enhancement")) return "enhancement";
  if (names.includes("feature")) return "feature";
  return null;
}

export function hasAnyLabel(labels = [], wanted = []) {
  const names = new Set(
    labels.map((l) => (typeof l === "string" ? l : l.name).toLowerCase())
  );
  return wanted.some((w) => names.has(w.toLowerCase()));
}

export function listOpenIssues(repo) {
  return ghJson(
    [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "50",
      "--json",
      "number,title,url,labels,body,createdAt,updatedAt",
    ],
    { repo }
  );
}

export function listOpenPrs(repo) {
  return ghJson(
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "50",
      "--json",
      "number,title,url,headRefName,body,labels",
    ],
    { repo }
  );
}

export function pickEligibleIssue(config, issues, prs) {
  const busyBranches = new Set(
    (prs || [])
      .filter((pr) => (pr.headRefName || "").startsWith(config.branchPrefix))
      .map((pr) => pr.headRefName)
  );

  const statusBlock = [
    config.statusLabels.running,
    config.statusLabels.blocked,
    config.statusLabels.needsHuman,
    config.statusLabels.done,
  ].map((s) => s.toLowerCase());

  const candidates = [];
  for (const issue of issues || []) {
    const labels = issue.labels || [];
    if (!hasAnyLabel(labels, config.triggerLabels)) continue;
    if (hasAnyLabel(labels, statusBlock)) continue;

    const type = issueType(labels) || "enhancement";
    if (!config.eligibleTypes.includes(type)) continue;

    const branch = `${config.branchPrefix}${issue.number}`;
    if (busyBranches.has(branch)) continue;

    const linkedPr = (prs || []).find(
      (pr) =>
        pr.headRefName === branch ||
        new RegExp(`(?:closes|fixes|resolves)\\s+#${issue.number}\\b`, "i").test(
          pr.body || ""
        )
    );
    if (linkedPr) continue;

    candidates.push({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      labels: labels.map((l) => (typeof l === "string" ? l : l.name)),
      type: type || "enhancement",
      updatedAt: issue.updatedAt,
      branch,
    });
  }

  candidates.sort((a, b) => {
    const rank = { bug: 0, enhancement: 1, feature: 2 };
    const d = (rank[a.type] ?? 9) - (rank[b.type] ?? 9);
    if (d !== 0) return d;
    return new Date(a.updatedAt) - new Date(b.updatedAt);
  });

  return candidates[0] || null;
}

export function detectScope(config, issue) {
  const text = `${issue.title || ""}\n${issue.body || ""}`.toLowerCase();
  const hit = [];
  for (const pkg of config.packages) {
    const tokens = [pkg.id, ...(pkg.globs || []).map((g) => g.split("/")[0])];
    if (tokens.some((t) => t && text.includes(String(t).toLowerCase()))) {
      hit.push(pkg.id);
    }
  }
  if (hit.length === 0) {
    hit.push(...config.packages.map((p) => p.id));
  }
  return {
    issue: {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      labels: issue.labels || [],
    },
    packages: [...new Set(hit)],
    reason:
      hit.length === config.packages.length
        ? "Default scope: whole product package (single-app repo)."
        : `Matched package tokens in issue text: ${hit.join(", ")}.`,
    confidence: hit.length === 1 ? "high" : "medium",
    needsE2e: false,
  };
}
