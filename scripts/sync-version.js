#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const manifestFiles = ["openclaw.plugin.json", "moltbot.plugin.json", "clawdbot.plugin.json"];

for (const manifestName of manifestFiles) {
  const manifestPath = path.join(rootDir, manifestName);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = packageJson.version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
