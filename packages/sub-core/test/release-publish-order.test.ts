import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const changesetCliPath = path.join(repoRoot, 'node_modules', '@changesets', 'cli', 'bin.js');

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function createFakeNpmCommand(binDir: string, scriptPath: string): void {
	fs.mkdirSync(binDir, { recursive: true });

	if (process.platform === 'win32') {
		fs.writeFileSync(path.join(binDir, 'npm.cmd'), `@"${process.execPath}" "${scriptPath}" %*\r\n`);
		return;
	}

	const commandPath = path.join(binDir, 'npm');
	fs.writeFileSync(
		commandPath,
		`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"\n`,
	);
	fs.chmodSync(commandPath, 0o755);
}

test('release publishes internal dependencies before dependents', (t) => {
	const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-sub-publish-order-'));
	t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

	writeJson(path.join(fixtureDir, 'package.json'), {
		name: 'publish-order-fixture',
		version: '1.0.0',
		private: true,
		packageManager: 'npm@11.6.0',
		workspaces: ['packages/*'],
	});
	writeJson(path.join(fixtureDir, 'package-lock.json'), {
		name: 'publish-order-fixture',
		version: '1.0.0',
		lockfileVersion: 3,
		requires: true,
		packages: {},
	});
	writeJson(path.join(fixtureDir, '.changeset', 'config.json'), {
		changelog: false,
		commit: false,
		fixed: [],
		linked: [],
		access: 'public',
		baseBranch: 'main',
		updateInternalDependencies: 'patch',
	});
	writeJson(path.join(fixtureDir, 'packages', 'shared', 'package.json'), {
		name: '@pi-sub-test/shared',
		version: '1.0.0',
		publishConfig: { access: 'public' },
	});
	writeJson(path.join(fixtureDir, 'packages', 'core', 'package.json'), {
		name: '@pi-sub-test/core',
		version: '1.0.0',
		dependencies: { '@pi-sub-test/shared': '^1.0.0' },
		publishConfig: { access: 'public' },
	});

	const publishLogPath = path.join(fixtureDir, 'publish.log');
	const fakeNpmScriptPath = path.join(fixtureDir, 'fake-npm.mjs');
	fs.writeFileSync(
		fakeNpmScriptPath,
		`import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args[0] === "info") {
	console.log(JSON.stringify({ error: { code: "E404" } }));
	process.exit(1);
}
if (args[0] !== "publish") {
	console.error("Unexpected fake npm command: " + args.join(" "));
	process.exit(1);
}

const packageDir = args
	.slice(1)
	.find((arg) => !arg.startsWith("-") && fs.existsSync(path.join(arg, "package.json"))) ?? process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
fs.appendFileSync(process.env.PUBLISH_LOG, packageJson.name + ":start\\n");
if (packageJson.name === "@pi-sub-test/shared") {
	await new Promise((resolve) => setTimeout(resolve, 300));
}
fs.appendFileSync(process.env.PUBLISH_LOG, packageJson.name + ":end\\n");
console.log(JSON.stringify({ id: packageJson.name + "@" + packageJson.version }));
`,
	);

	const fakeNpmBinDir = path.join(fixtureDir, 'bin');
	createFakeNpmCommand(fakeNpmBinDir, fakeNpmScriptPath);

	const childEnv = { ...process.env, PUBLISH_LOG: publishLogPath };
	const pathKey = Object.keys(childEnv).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
	childEnv[pathKey] = fakeNpmBinDir + path.delimiter + (childEnv[pathKey] ?? '');

	const result = spawnSync(process.execPath, [changesetCliPath, 'publish', '--no-git-tag'], {
		cwd: fixtureDir,
		env: childEnv,
		encoding: 'utf8',
		timeout: 10_000,
	});

	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.ok(fs.existsSync(publishLogPath), result.stderr || result.stdout);
	assert.deepEqual(fs.readFileSync(publishLogPath, 'utf8').trim().split(/\r?\n/), [
		'@pi-sub-test/shared:start',
		'@pi-sub-test/shared:end',
		'@pi-sub-test/core:start',
		'@pi-sub-test/core:end',
	]);
});
