import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const roadmapPath = path.join(repoRoot, "ROADMAP.md");
const ciWorkflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
const packagesDir = path.join(repoRoot, "packages");

test("ROADMAP does not claim PR CI is missing when ci.yml exists", () => {
	const roadmap = fs.readFileSync(roadmapPath, "utf8");
	const ciExists = fs.existsSync(ciWorkflowPath);

	if (!ciExists) {
		return;
	}

	assert.doesNotMatch(roadmap, /there is still no workflow on `pull_request`/);
	assert.doesNotMatch(roadmap, /No PR CI \/ no Windows CI/);
	assert.match(roadmap, /\.github\/workflows\/ci\.yml/);
});

test("ROADMAP release table matches workspace package versions", () => {
	const roadmap = fs.readFileSync(roadmapPath, "utf8");
	const lines = roadmap.split(/\r?\n/);

	for (const pkgDir of fs.readdirSync(packagesDir)) {
		const pkgJsonPath = path.join(packagesDir, pkgDir, "package.json");
		if (!fs.existsSync(pkgJsonPath)) {
			continue;
		}

		const { name, version } = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
			name: string;
			version: string;
		};

		const row = lines.find((line) => line.includes(name));
		const versionCell = "| `" + version + "` |";

		assert.ok(row, "ROADMAP release table should mention " + name);
		assert.ok(
			row?.includes(versionCell),
			"ROADMAP release table should list " + name + " at " + version,
		);
	}
});
