import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ciWorkflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");

test("pull-request CI workflow gates feature branches on verify", () => {
	const workflow = fs.readFileSync(ciWorkflowPath, "utf8");

	assert.match(workflow, /pull_request:/);
	assert.match(workflow, /branches-ignore:\s*\n\s*- main/);
	assert.match(workflow, /ubuntu-latest/);
	assert.match(workflow, /windows-latest/);
	assert.match(workflow, /node-version-file:\s*\.nvmrc/);
	assert.match(workflow, /npm run verify/);
});
