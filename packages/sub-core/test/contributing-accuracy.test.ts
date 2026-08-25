import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const contributingPath = path.join(repoRoot, "CONTRIBUTING.md");
const packagesDir = path.join(repoRoot, "packages");

function workspacePackageNames(): string[] {
	return fs
		.readdirSync(packagesDir)
		.map((dir) => path.join(packagesDir, dir, "package.json"))
		.filter((pkgJsonPath) => fs.existsSync(pkgJsonPath))
		.map((pkgJsonPath) => JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")).name as string)
		.sort();
}

test("CONTRIBUTING lists workspace-specific check and test commands for every package", () => {
	const contributing = fs.readFileSync(contributingPath, "utf8");

	for (const name of workspacePackageNames()) {
		assert.match(
			contributing,
			new RegExp(`npm run check -w ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
			`CONTRIBUTING should document check command for ${name}`,
		);
		assert.match(
			contributing,
			new RegExp(`npm run test -w ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
			`CONTRIBUTING should document test command for ${name}`,
		);
	}
});

test("CONTRIBUTING lists watch-mode commands for packages that expose them", () => {
	const contributing = fs.readFileSync(contributingPath, "utf8");

	for (const pkgDir of fs.readdirSync(packagesDir)) {
		const pkgJsonPath = path.join(packagesDir, pkgDir, "package.json");
		if (!fs.existsSync(pkgJsonPath)) {
			continue;
		}

		const { name, scripts } = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
			name: string;
			scripts?: Record<string, string>;
		};

		if (scripts?.["check:watch"]) {
			assert.match(
				contributing,
				new RegExp(`npm run check:watch -w ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
				`CONTRIBUTING should document check:watch for ${name}`,
			);
		}

		if (scripts?.["test:watch"]) {
			assert.match(
				contributing,
				new RegExp(`npm run test:watch -w ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
				`CONTRIBUTING should document test:watch for ${name}`,
			);
		}
	}
});
