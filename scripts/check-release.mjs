import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const errors = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseVersion(version, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    errors.push(`${label} must be a plain semver version (x.y.z), got "${version}".`);
    return null;
  }
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

const manifest = readJson("package.json");
const lockfile = readJson("package-lock.json");
const current = parseVersion(manifest.version, "package.json version");

if (lockfile.version !== manifest.version) {
  errors.push(
    `package-lock.json version (${lockfile.version}) does not match package.json (${manifest.version}).`,
  );
}

if (lockfile.packages?.[""]?.version !== manifest.version) {
  errors.push(
    `package-lock.json root package version (${lockfile.packages?.[""]?.version}) does not match package.json (${manifest.version}).`,
  );
}

const baseRef = process.argv[2];
if (baseRef && current) {
  try {
    const baseManifest = JSON.parse(
      execFileSync("git", ["show", `${baseRef}:package.json`], {
        encoding: "utf8",
      }),
    );
    const base = parseVersion(baseManifest.version, `${baseRef} package.json version`);
    if (base && compareVersions(current, base) <= 0) {
      errors.push(
        `Every Chief PR must increase the app version: ${manifest.version} is not newer than ${baseManifest.version}. Run npm run release:patch (or release:minor/release:major).`,
      );
    }
  } catch (error) {
    errors.push(`Could not read package.json from base ref "${baseRef}": ${error.message}`);
  }
}

const updaterSource = readFileSync("lib/updater-workflow.ts", "utf8");
const updaterMatch = updaterSource.match(
  /^export const UPDATER_WORKFLOW_YAML = (".*");$/m,
);

if (!updaterMatch) {
  errors.push("Could not read UPDATER_WORKFLOW_YAML from lib/updater-workflow.ts.");
} else {
  try {
    const embeddedWorkflow = JSON.parse(updaterMatch[1]);
    const workflow = readFileSync(
      ".github/workflows/upstream-updates.yml",
      "utf8",
    );
    if (embeddedWorkflow !== workflow) {
      errors.push(
        "lib/updater-workflow.ts is out of sync with .github/workflows/upstream-updates.yml. Run npm run release:sync-updater.",
      );
    }
  } catch (error) {
    errors.push(`Could not parse UPDATER_WORKFLOW_YAML: ${error.message}`);
  }
}

if (errors.length > 0) {
  console.error(`Release checks failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(
  `Release checks passed for Chief v${manifest.version}${baseRef ? ` against ${baseRef}` : ""}.`,
);
