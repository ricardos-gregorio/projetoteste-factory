#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cmd = existsSync(join(root, "package-lock.json")) ? "npm ci" : "npm install";
execSync(cmd, { cwd: root, stdio: "inherit" });
