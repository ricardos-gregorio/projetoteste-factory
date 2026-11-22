#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, repoRoot } from "./lib.mjs";

const config = loadConfig();
const scopePath = join(repoRoot, ".factory", "scope.json");
const packages = existsSync(scopePath)
  ? JSON.parse(readFileSync(scopePath, "utf8")).packages || []
  : config.packages.map((p) => p.id);

const selected = config.packages.filter((p) => packages.includes(p.id));
if (selected.length === 0) {
  console.error("No packages in scope");
  process.exit(1);
}

for (const pkg of selected) {
  if (!pkg.test) continue;
  console.log(`\n== test ${pkg.id}: ${pkg.test}`);
  execSync(pkg.test, { cwd: join(repoRoot, pkg.path), stdio: "inherit" });
}

console.log("\nAll scoped tests passed.");
