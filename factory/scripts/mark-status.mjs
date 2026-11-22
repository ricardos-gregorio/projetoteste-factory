#!/usr/bin/env node
/**
 * Usage: node factory/scripts/mark-status.mjs <issue> <running|blocked|needsHuman|done|clear>
 */
import { loadConfig, gh } from "./lib.mjs";

const [, , issueArg, statusKey] = process.argv;
if (!issueArg || !statusKey) {
  console.error(
    "Usage: node factory/scripts/mark-status.mjs <issue> <running|blocked|needsHuman|done|clear>"
  );
  process.exit(2);
}

const config = loadConfig();
const issue = String(issueArg);
const allStatus = Object.values(config.statusLabels);

for (const label of allStatus) {
  try {
    gh(["issue", "edit", issue, "--remove-label", label], { repo: config.repo });
  } catch {
    // label may not be present
  }
}

if (statusKey !== "clear") {
  const label = config.statusLabels[statusKey];
  if (!label) {
    console.error(`Unknown status key: ${statusKey}`);
    process.exit(2);
  }
  gh(["issue", "edit", issue, "--add-label", label], { repo: config.repo });
  console.log(`Labeled #${issue} with ${label}`);
} else {
  console.log(`Cleared factory status labels on #${issue}`);
}
