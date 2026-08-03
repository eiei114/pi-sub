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
	assert.ok(fs.existsSync(ciWorkflowPath), "ci.yml must exist for completed S-2");
	const s2Start = roadmap.indexOf("### S-2");
	assert.notEqual(s2Start, -1, "ROADMAP must contain S-2");
	const s2End = roadmap.indexOf("\n---", s2Start);
	const s2 = roadmap.slice(s2Start, s2End === -1 ? roadmap.length : s2End);

	assert.match(s2, /\*\*Status:\*\* done/);
	assert.doesNotMatch(s2, /there is still no workflow on `pull_request`/);
	assert.doesNotMatch(s2, /No PR CI \/ no Windows CI/);
	assert.match(s2, /\.github\/workflows\/ci\.yml/);
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

		const versionCell = "| `" + version + "` |";
		const row = lines.find((line) => line.startsWith("| [`" + name + "`]"));

		assert.ok(row, "ROADMAP release table should mention " + name);
		assert.ok(
			row.includes(versionCell),
			"ROADMAP release table should list " + name + " at " + version,
		);
	}
});
