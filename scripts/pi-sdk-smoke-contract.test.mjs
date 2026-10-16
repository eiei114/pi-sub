import assert from "node:assert/strict";
import test from "node:test";
import { behaviorAssertions, EXPECTED_STATUS, sanitizeEvidence } from "./pi-sdk-smoke-contract.mjs";

const commands = ["sub-core:settings", "sub-bar:settings", "sub-bar:import"];
const commandResponse = {
	type: "response",
	command: "get_commands",
	success: true,
	data: { commands: commands.map((name) => ({ name })) },
};
const statusResponse = {
	type: "extension_ui_request",
	method: "setStatus",
	statusKey: "sub-status:usage",
	statusText: EXPECTED_STATUS,
};
const clearStatusResponse = {
	type: "extension_ui_request",
	method: "setStatus",
	statusKey: "sub-status:usage",
};
const parseErrorResponse = {
	type: "response",
	command: "parse",
	success: false,
	error: "Failed to parse command: Unexpected token",
};
const importPromptResponse = {
	id: "bad-import",
	type: "response",
	command: "prompt",
	success: true,
	data: { disposition: "handled" },
};
const importErrorResponse = {
	type: "extension_ui_request",
	method: "notify",
	message: "Invalid theme share string",
	notifyType: "error",
};

function assertions(name, responses, extras = {}) {
	return behaviorAssertions(name, {
		responses,
		exit_code: 0,
		fullOutput: "",
		expectedVersion: "1.2.0",
		processExitObserved: true,
		timedOut: false,
		...extras,
	});
}

test("extension registration requires all package commands from actual RPC", () => {
	assert.equal(assertions("extension_load", [commandResponse])[0].passed, true);
	assert.equal(assertions("extension_load", [
		{ ...commandResponse, data: { commands: [{ name: "sub-core:settings" }] } },
	])[0].passed, false);
	assert.equal(assertions("extension_load", [])[0].passed, false);
});

test("feature response requires the actual expected sub-status output", () => {
	assert.equal(assertions("happy_path", [statusResponse])[0].passed, true);
	assert.equal(assertions("happy_path", [])[0].passed, false);
	assert.equal(assertions("happy_path", [{ ...statusResponse, statusText: "" }])[0].passed, false);
});

test("handled error requires a rejected malformed input and a later successful RPC response", () => {
	assert.equal(assertions("error_path", [
		parseErrorResponse,
		importPromptResponse,
		importErrorResponse,
		commandResponse,
	])[0].passed, true);
	assert.equal(assertions("error_path", [importPromptResponse, importErrorResponse, commandResponse])[0].passed, false);
	assert.equal(assertions("error_path", [parseErrorResponse, importErrorResponse, commandResponse])[0].passed, false);
	assert.equal(assertions("error_path", [parseErrorResponse, importPromptResponse, commandResponse])[0].passed, false);
	assert.equal(assertions("error_path", [parseErrorResponse, importPromptResponse, importErrorResponse])[0].passed, false);
});

test("reload assertions require second-process registration, feature output, cleanup, and natural exit", () => {
	const actual = assertions("reload_cleanup", [commandResponse, statusResponse, clearStatusResponse]);
	assert.deepEqual(actual.map((item) => item.id), [
		"reloaded_extension_registered",
		"reloaded_feature_response",
		"clean_shutdown",
	]);
	assert.ok(actual.every((item) => item.passed));

	const withoutFeature = assertions("reload_cleanup", [commandResponse, clearStatusResponse]);
	assert.equal(withoutFeature.find((item) => item.id === "reloaded_feature_response").passed, false);
	const withoutCleanup = assertions("reload_cleanup", [commandResponse, statusResponse]);
	assert.equal(withoutCleanup.find((item) => item.id === "clean_shutdown").passed, false);
	const killed = assertions("reload_cleanup", [commandResponse, statusResponse, clearStatusResponse], {
		exit_code: null,
		processExitObserved: false,
		timedOut: true,
	});
	assert.equal(killed.find((item) => item.id === "clean_shutdown").passed, false);
});

test("host shell boundary checks the exact pinned runtime version", () => {
	assert.equal(assertions("host_shell", [], { fullOutput: "1.2.0\n" })[0].passed, true);
	assert.equal(assertions("host_shell", [], { fullOutput: "1.1.0\n" })[0].passed, false);
});

test("evidence sanitization removes literal and JSON-escaped Windows checkout paths", () => {
	const repoRoot = "C:\\Users\\Keisu\\pi-sub";
	const escapedRoot = JSON.stringify(repoRoot).slice(1, -1);
	const evidence = `json=${escapedRoot}\\source.ts; literal=${repoRoot}\\source.ts`;
	assert.equal(sanitizeEvidence(evidence, repoRoot), "json=<repo>\\source.ts; literal=<repo>\\source.ts");
});
