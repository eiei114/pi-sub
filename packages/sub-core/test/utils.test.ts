import test from "node:test";
import assert from "node:assert/strict";
import {
	buildShellCommandLine,
	quoteWindowsArg,
} from "../src/utils.js";

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
