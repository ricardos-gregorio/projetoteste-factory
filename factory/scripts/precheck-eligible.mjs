#!/usr/bin/env node
/**
 * Exit 0 when there is at least one eligible GitHub issue for the factory.
 * Exit 1 to skip the Orca scheduled automation run.
 */
import {
  loadConfig,
  listOpenIssues,
  listOpenPrs,
  pickEligibleIssue,
} from "./lib.mjs";

try {
  const config = loadConfig();
  const issues = listOpenIssues(config.repo);
  const prs = listOpenPrs(config.repo);
  const pick = pickEligibleIssue(config, issues, prs);
  if (!pick) {
    console.error("factory-precheck: no eligible issue");
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      ok: true,
      issue: pick.number,
      title: pick.title,
      branch: pick.branch,
      type: pick.type,
    })
  );
  process.exit(0);
} catch (err) {
  console.error(`factory-precheck: ${err.message || err}`);
  process.exit(1);
}
