/* global process, console, setTimeout, clearTimeout */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import {
	behaviorAssertions,
	EXTENSION_LOAD_ERROR_PATTERN,
	sanitizeEvidence,
	SDK_NAMES,
	UNHANDLED_ERROR_PATTERN,
	VERIFICATION_CONTRACT,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = process.argv.includes("--update-curated-report")
  ? resolve(root, "docs/verification/pi-sdk-smoke.json")
  : resolve(root, ".tmp/pi-sdk-smoke.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(resolve(root, "package.json"));
const sdkVersions = Object.fromEntries(SDK_NAMES.map((name) => [
	name,
	readJson(resolve(root, "node_modules", name, "package.json")).version,
]));
for (const name of SDK_NAMES) {
	if (manifest.devDependencies?.[name] !== sdkVersions[name]) {
		throw new Error(`Smoke requires the exact dev/test SDK pin for ${name}: installed ${sdkVersions[name]}`);
	}
}

const piManifest = readJson(resolve(root, "node_modules/@earendil-works/pi-coding-agent/package.json"));
const piCli = resolve(root, "node_modules/@earendil-works/pi-coding-agent", piManifest.bin.pi);
const agentDir = mkdtempSync(join(tmpdir(), "pi-sub-sdk-smoke-"));
const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
const reportCommand = "npm run smoke:pi";
const PROBE_TIMEOUT_MS = 15_000;
const CLEANUP_GRACE_MS = 1_000;
const expectedCommands = [
	resolve(root, "packages/sub-core/index.ts"),
	resolve(root, "packages/sub-status/index.ts"),
	resolve(root, "packages/sub-bar/index.ts"),
];
const rpcArgs = [
	piCli,
	"--offline",
	"--no-session",
	"--no-tools",
	"--no-skills",
	"--no-context-files",
	"--no-prompt-templates",
	"--no-mcp",
	"--no-extensions",
	...expectedCommands.flatMap((path) => ["--extension", path]),
	"--provider",
	"anthropic",
	"--model",
	"claude-sonnet-4-20250514",
	"--mode",
	"rpc",
];

function seedOfflineUsage() {
	mkdirSync(join(agentDir, "cache", "sub-core"), { recursive: true });
	writeFileSync(join(agentDir, "pi-sub-core-settings.json"), JSON.stringify({
		version: 3,
		providers: { anthropic: { enabled: "on", fetchStatus: false } },
	}, null, 2));
	writeFileSync(join(agentDir, "cache", "sub-core", "cache.json"), JSON.stringify({
		anthropic: {
			fetchedAt: 0,
			usage: {
				provider: "anthropic",
				displayName: "Anthropic",
				windows: [
					{ label: "5h", usedPercent: 17, resetDescription: "3h" },
					{ label: "Week", usedPercent: 29, resetDescription: "4d" },
				],
			},
		},
	}, null, 2));
}

function parseJsonLines(output) {
	const rows = [];
	const invalid = [];
	for (const line of output.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			rows.push(JSON.parse(line));
		} catch {
			invalid.push(line);
		}
	}
	return { rows, invalid };
}

function sanitize(value) {
	return sanitizeEvidence(value, root);
}

function runProcess(executable, args, input) {
	return new Promise((resolveProcess) => {
		const child = spawn(executable, args, { cwd: root, env, windowsHide: true });
		let stdout = "";
		let stderr = "";
		let spawnError;
		let timedOut = false;
		let settled = false;
		let deadlineTimer;
		let hardKillTimer;
		let cleanupTimer;

		const finish = (status, signal, processExitObserved) => {
			if (settled) return;
			settled = true;
			clearTimeout(deadlineTimer);
			clearTimeout(hardKillTimer);
			clearTimeout(cleanupTimer);
			resolveProcess({ stdout, stderr, status, signal, error: spawnError, timedOut, processExitObserved });
		};

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.once("error", (error) => { spawnError = error; });
		child.stdin.on("error", (error) => {
			if (error.code !== "EPIPE") spawnError = error;
		});
		child.once("close", (status, signal) => finish(status, signal, true));
		child.stdin.end(input);

		deadlineTimer = setTimeout(() => {
			timedOut = true;
			const cleanupStartedAt = Date.now();
			if (child.pid && process.platform === "win32") {
				child.kill();
				const killTree = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
					encoding: "utf8",
					timeout: 250,
					windowsHide: true,
				});
				if (killTree.error) spawnError ??= killTree.error;
			} else if (child.pid) {
				child.kill("SIGTERM");
				hardKillTimer = setTimeout(() => {
					if (!settled) child.kill("SIGKILL");
				}, 250);
			}
			const remainingGraceMs = Math.max(0, CLEANUP_GRACE_MS - (Date.now() - cleanupStartedAt));
			cleanupTimer = setTimeout(() => {
				if (!settled) {
					spawnError ??= new Error("Pi probe did not exit within its bounded cleanup grace");
					finish(null, null, false);
				}
			}, remainingGraceMs);
		}, PROBE_TIMEOUT_MS);
	});
}

async function run(name, executable, args, input = "") {
	const result = await runProcess(executable, args, input);
	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	const { rows: responses, invalid } = name === "host_shell"
		? { rows: [], invalid: [] }
		: parseJsonLines(stdout);
	const fullOutput = `${stdout}${stderr}`;
	const exitCode = result.status;
	const assertions = behaviorAssertions(name, {
		responses,
		exit_code: exitCode,
		fullOutput,
		expectedVersion: sdkVersions["@earendil-works/pi-coding-agent"],
		processExitObserved: result.processExitObserved,
		timedOut: result.timedOut,
	});
	const hasUnhandledError = UNHANDLED_ERROR_PATTERN.test(fullOutput);
	const hasLoadError = EXTENSION_LOAD_ERROR_PATTERN.test(fullOutput);
	const passed = exitCode === 0 && result.processExitObserved && !result.error && !result.timedOut && invalid.length === 0
		&& !hasUnhandledError && !hasLoadError && assertions.every((item) => item.passed);
	const deadlineEvidence = result.timedOut ? `\nProbe deadline exceeded (${PROBE_TIMEOUT_MS}ms)` : "";
	return {
		name,
		command: reportCommand,
		exit_code: exitCode,
		passed,
		evidence: sanitize(`${stdout}${stderr}${result.error ? `\n${result.error.message}` : ""}${deadlineEvidence}`),
		assertions,
		hasUnhandledError,
		hasLoadError,
		invalidStdoutLines: invalid.length,
		responses,
		timedOut: result.timedOut,
		processExitObserved: result.processExitObserved,
	};
}

async function runRpc(name, input) {
	return run(name, process.execPath, rpcArgs, input);
}

async function runHostShell() {
	if (process.platform === "win32") {
		const quote = (value) => `'${value.replaceAll("'", "''")}'`;
		const shell = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
		const command = `& ${quote(process.execPath)} ${quote(piCli)} --no-extensions --version; exit $LASTEXITCODE`;
		return run("host_shell", shell, ["-NoProfile", "-NonInteractive", "-Command", command]);
	}
	return run("host_shell", "/bin/sh", ["-c", '"$1" "$2" --no-extensions --version', "pi-host-shell", process.execPath, piCli]);
}

try {
	seedOfflineUsage();
	const cases = [];
	cases.push(await runRpc("extension_load", '{"type":"get_commands"}\n'));
	cases.push(await runRpc("happy_path", '{"type":"get_commands"}\n'));
	cases.push(await runRpc("error_path", [
		"not-json",
		JSON.stringify({ id: "bad-import", type: "prompt", message: "/sub-bar:import definitely-invalid" }),
		JSON.stringify({ type: "get_commands" }),
	].join("\n") + "\n"));
	const firstReloadProcess = await runRpc("reload_cleanup", '{"type":"get_commands"}\n');
	const secondReloadProcess = await runRpc("reload_cleanup", '{"type":"get_commands"}\n');
	const reloadAssertions = behaviorAssertions("reload_cleanup", {
		responses: secondReloadProcess.responses,
		exit_code: secondReloadProcess.exit_code,
		fullOutput: secondReloadProcess.evidence,
		expectedVersion: sdkVersions["@earendil-works/pi-coding-agent"],
		processExitObserved: secondReloadProcess.processExitObserved,
		timedOut: secondReloadProcess.timedOut,
	});
	const reloadCase = {
		...secondReloadProcess,
		name: "reload_cleanup",
		command: reportCommand,
		evidence: `${firstReloadProcess.evidence}\n--- second Pi process ---\n${secondReloadProcess.evidence}`,
		assertions: reloadAssertions,
		passed: firstReloadProcess.passed && secondReloadProcess.passed
			&& reloadAssertions.every((item) => item.passed),
		hasUnhandledError: firstReloadProcess.hasUnhandledError || secondReloadProcess.hasUnhandledError,
		hasLoadError: firstReloadProcess.hasLoadError || secondReloadProcess.hasLoadError,
	};
	cases.push(reloadCase, await runHostShell());

	const report = {
		schema_version: 1,
		verification_contract: VERIFICATION_CONTRACT,
		sdk_versions: sdkVersions,
		platform: process.platform,
		model_inference: "none; actual Pi host and extension lifecycle with a local deterministic cache fixture",
		unhandled_errors: cases.filter((item) => item.hasUnhandledError).length,
		extension_load_errors: cases.filter((item) => item.hasLoadError
			|| (item.name === "extension_load" && !item.assertions.every((assertion) => assertion.passed))).length,
		cases: cases.map(({ hasUnhandledError: _unhandled, hasLoadError: _loadError,
			invalidStdoutLines: _invalid, responses: _responses, timedOut: _timedOut,
			processExitObserved: _exitObserved, ...item }) => item),
	};
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify({
		verification_contract: VERIFICATION_CONTRACT,
		platform: process.platform,
		cases: cases.map(({ name, passed, exit_code }) => ({ name, passed, exit_code })),
	}));
	if (cases.some((item) => !item.passed)) process.exitCode = 1;
} finally {
	rmSync(agentDir, { recursive: true, force: true });
}
