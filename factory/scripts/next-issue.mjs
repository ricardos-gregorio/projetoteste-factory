#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  loadConfig,
  listOpenIssues,
  listOpenPrs,
  pickEligibleIssue,
  detectScope,
  ghJson,
  factoryRoot,
  repoRoot,
} from "./lib.mjs";

const config = loadConfig();
const issues = listOpenIssues(config.repo);
const prs = listOpenPrs(config.repo);
const pick = pickEligibleIssue(config, issues, prs);

if (!pick) {
  console.error("No eligible issue.");
  process.exit(1);
}

const full = ghJson(
  [
    "issue",
    "view",
    String(pick.number),
    "--json",
    "number,title,url,body,labels,comments",
  ],
  { repo: config.repo }
);

const scope = detectScope(config, {
  number: full.number,
  title: full.title,
  url: full.url,
  body: full.body,
  labels: (full.labels || []).map((l) => l.name),
});

const runId = `factory-${full.number}-${Date.now()}`;
const job = {
  runId,
  issue: full.number,
  state: "admitted",
  attempts: { implementValidate: 0, reviewFix: 0 },
  branch: pick.branch,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const outDir = join(repoRoot, ".factory");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "scope.json"), JSON.stringify(scope, null, 2));
writeFileSync(join(outDir, "job.json"), JSON.stringify(job, null, 2));
writeFileSync(
  join(outDir, "issue.json"),
  JSON.stringify(
    {
      number: full.number,
      title: full.title,
      url: full.url,
      body: full.body,
      labels: (full.labels || []).map((l) => l.name),
      comments: full.comments || [],
    },
    null,
    2
  )
);

console.log(
  JSON.stringify(
    {
      ok: true,
      runId,
      issue: full.number,
      title: full.title,
      url: full.url,
      branch: pick.branch,
      scopePath: join(outDir, "scope.json"),
      jobPath: join(outDir, "job.json"),
      configPath: join(factoryRoot, "config.json"),
    },
    null,
    2
  )
);
