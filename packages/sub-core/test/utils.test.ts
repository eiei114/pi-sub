import test from "node:test";
import assert from "node:assert/strict";
import {
	buildShellCommandLine,
	clampPercent,
	execCliSync,
	formatReset,
	isSafeShellArg,
	isSafeShellCommandPath,
	quoteWindowsArg,
} from "../src/utils.js";
import { createDeps } from "./helpers.js";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

for (const [offsetMs, expected] of [
	[-1, "now"],
	[0, "0m"],
	[minute - 1, "0m"],
	[minute, "1m"],
	[hour - 1, "59m"],
	[hour, "1h"],
	[hour + minute, "1h1m"],
	[day - 1, "23h59m"],
	[day, "1d"],
	[day + 2 * hour + 30 * minute, "1d2h"],
] as const) {
	test(`formatReset returns ${expected} for a reset ${offsetMs}ms from now`, ({ mock }) => {
		const now = Date.UTC(2026, 0, 1);
		mock.timers.enable({ apis: ["Date"], now });
		try {
			assert.equal(formatReset(new Date(now + offsetMs)), expected);
		} finally {
			mock.timers.reset();
		}
	});
}

test("clampPercent keeps values in the inclusive 0–100 range", () => {
	assert.equal(clampPercent(-1), 0);
	assert.equal(clampPercent(0), 0);
	assert.equal(clampPercent(42.5), 42.5);
	assert.equal(clampPercent(100), 100);
	assert.equal(clampPercent(101), 100);
});

test("clampPercent preserves the existing non-finite arithmetic behavior", () => {
	assert.equal(clampPercent(Number.POSITIVE_INFINITY), 100);
	assert.equal(clampPercent(Number.NEGATIVE_INFINITY), 0);
	assert.ok(Number.isNaN(clampPercent(Number.NaN)));
});

test("quoteWindowsArg wraps a plain argument", () => {
	assert.equal(quoteWindowsArg("vela"), '"vela"');
});

test("quoteWindowsArg escapes an embedded quote", () => {
	assert.equal(quoteWindowsArg('a"b'), '"a\\"b"');
});

test("quoteWindowsArg doubles trailing backslashes before the closing quote", () => {
	assert.equal(quoteWindowsArg("C:\\dir\\"), '"C:\\dir\\\\"');
});

test("buildShellCommandLine joins the binary and every argument", () => {
	assert.equal(
		buildShellCommandLine("C:\\npm\\vela.cmd", ["billing", "preflight", "--format", "json"]),
		'"C:\\npm\\vela.cmd" "billing" "preflight" "--format" "json"',
	);
});

test("execCliSync refuses cmd metacharacters in an argument", () => {
	const { deps } = createDeps({
		env: { OS: "Windows_NT" },
	});
	assert.throws(
		() => execCliSync(deps, "C:\\npm\\vela.cmd", ["--workspace-id", 'x" & calc & "']),
		/Refusing unsafe argument/,
	);
});

test("execCliSync refuses a percent-expansion argument", () => {
	const { deps } = createDeps({
		env: { OS: "Windows_NT" },
	});
	assert.throws(
		() => execCliSync(deps, "C:\\npm\\vela.cmd", ["--model", "%PATH%"]),
		/Refusing unsafe argument/,
	);
});

test("isSafeShellCommandPath allows ordinary Windows install paths", () => {
	assert.equal(isSafeShellCommandPath("C:\\Program Files (x86)\\nodejs\\vela.cmd"), true);
	assert.equal(isSafeShellCommandPath("C:\\Users\\me\\AppData\\Roaming\\npm\\vela.cmd"), true);
});

test("isSafeShellCommandPath refuses cmd control characters", () => {
	assert.equal(isSafeShellCommandPath("C:\\npm\\vela.cmd & calc"), false);
	assert.equal(isSafeShellCommandPath("C:\\npm\\%TEMP%\\vela.cmd"), false);
});

test("isSafeShellArg accepts workspace ids and model ids", () => {
	assert.equal(isSafeShellArg("bxfy4qdrtvs0y4rm83wuk6kv"), true);
	assert.equal(isSafeShellArg("deepseek-v4.1-flash"), true);
	assert.equal(isSafeShellArg("json"), true);
});

test("execCliSync still delegates to execFileSync when no shell is needed", () => {
	const calls: Array<{ file: string; args: string[] }> = [];
	const { deps } = createDeps({
		env: {},
		execFileSync: (file, args) => {
			calls.push({ file, args });
			return "ok";
		},
	});
	assert.equal(execCliSync(deps, "/usr/bin/vela", ["whoami"]), "ok");
	assert.deepEqual(calls, [{ file: "/usr/bin/vela", args: ["whoami"] }]);
});
