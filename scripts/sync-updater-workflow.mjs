import { readFileSync, writeFileSync } from "node:fs";

const workflowPath = ".github/workflows/upstream-updates.yml";
const sourcePath = "lib/updater-workflow.ts";
const declarationStartMarker = "export const UPDATER_WORKFLOW_YAML = ";
const sourceSuffixMarker = "\n\nexport type UpdatesInfo =";

const workflow = readFileSync(workflowPath, "utf8");
const source = readFileSync(sourcePath, "utf8");
const declaration =
  `export const UPDATER_WORKFLOW_YAML = ${JSON.stringify(workflow)};`;
const declarationStart = source.indexOf(declarationStartMarker);
const sourceSuffixStart = source.lastIndexOf(sourceSuffixMarker);

if (declarationStart === -1 || sourceSuffixStart <= declarationStart) {
  console.error(`Could not find UPDATER_WORKFLOW_YAML in ${sourcePath}.`);
  process.exit(1);
}

const synchronized =
  source.slice(0, declarationStart) +
  declaration +
  source.slice(sourceSuffixStart);
if (synchronized === source) {
  console.log("Embedded updater workflow is already synchronized.");
} else {
  writeFileSync(sourcePath, synchronized);
  console.log(`Synchronized ${sourcePath} from ${workflowPath}.`);
}
