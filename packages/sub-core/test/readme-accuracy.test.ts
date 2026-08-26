import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readmePath = path.join(repoRoot, "README.md");
const packagesDir = path.join(repoRoot, "packages");

function workspacePackageNames(): string[] {
	return fs
		.readdirSync(packagesDir)
		.map((dir) => path.join(packagesDir, dir, "package.json"))
		.filter((pkgJsonPath) => fs.existsSync(pkgJsonPath))
		.map((pkgJsonPath) => JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")).name as string)
		.sort();
}

function packagesWithTestScript(): string[] {
	return fs
		.readdirSync(packagesDir)
		.map((dir) => path.join(packagesDir, dir, "package.json"))
		.filter((pkgJsonPath) => fs.existsSync(pkgJsonPath))
		.map((pkgJsonPath) => JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
			name: string;
			scripts?: Record<string, string>;
		})
		.filter(({ scripts }) => Boolean(scripts?.test))
		.map(({ name }) => name)
		.sort();
}

test("README lists workspace-specific check and test commands for every package", () => {
	const readme = fs.readFileSync(readmePath, "utf8");

	for (const name of workspacePackageNames()) {
		assert.match(
			readme,
			new RegExp(`npm run check -w ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
			`README should document check command for ${name}`,
		);
	}

	for (const name of packagesWithTestScript()) {
		assert.match(
			readme,
			new RegExp(`npm run test -w ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
			`README should document test command for ${name}`,
		);
	}
});

test("README common test blurb mentions every package with a test script", () => {
	const readme = fs.readFileSync(readmePath, "utf8");
	const testBlurb = readme.match(/npm run test` — run workspace tests \(([^)]+)\)/);

	assert.ok(testBlurb, "README should describe npm run test with a package list");
	const mentioned = testBlurb[1]
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);

	for (const pkgDir of fs.readdirSync(packagesDir)) {
		const pkgJsonPath = path.join(packagesDir, pkgDir, "package.json");
		if (!fs.existsSync(pkgJsonPath)) {
			continue;
		}

		const { scripts } = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
			scripts?: Record<string, string>;
		};

		if (scripts?.test) {
			assert.ok(
				mentioned.includes(pkgDir),
				`README test blurb should mention ${pkgDir}`,
			);
		}
	}
});

test("README lists watch-mode commands for packages that expose them", () => {
	const readme = fs.readFileSync(readmePath, "utf8");

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
				readme,
				new RegExp(`npm run check:watch -w ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
				`README should document check:watch for ${name}`,
			);
		}

		if (scripts?.["test:watch"]) {
			assert.match(
				readme,
				new RegExp(`npm run test:watch -w ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
				`README should document test:watch for ${name}`,
			);
		}
	}
});
