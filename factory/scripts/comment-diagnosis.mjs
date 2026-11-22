#!/usr/bin/env node
/**
 * Usage: node factory/scripts/comment-diagnosis.mjs <issue> --file <path>
 *    or: node factory/scripts/comment-diagnosis.mjs <issue> --body "<text>"
 */
import { readFileSync } from "node:fs";
import { loadConfig, gh } from "./lib.mjs";

const args = process.argv.slice(2);
const issue = args[0];
let body = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--file") body = readFileSync(args[++i], "utf8");
  if (args[i] === "--body") body = args[++i];
}

if (!issue || !body) {
  console.error(
    "Usage: node factory/scripts/comment-diagnosis.mjs <issue> (--file path | --body text)"
  );
  process.exit(2);
}

const config = loadConfig();
const footer =
  "\n\n---\n_asked by factory automation via Orca · fail-closed (no PR opened)_";
gh(["issue", "comment", issue, "--body", `${body.trim()}${footer}`], {
  repo: config.repo,
});
console.log(`Commented diagnosis on #${issue}`);
