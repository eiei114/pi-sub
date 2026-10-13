export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_NAMES = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
];
export const UNHANDLED_ERROR_PATTERN = /UnhandledPromiseRejection|uncaught exception|shutdown error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /Failed to load extension|Error loading extension/i;
export const EXPECTED_STATUS = "3h 17% · 4d 29%";

export function sanitizeEvidence(value, repoRoot) {
	const escapedRoot = JSON.stringify(repoRoot).slice(1, -1);
	return value.replaceAll(escapedRoot, "<repo>").replaceAll(repoRoot, "<repo>");
}

function assertion(id, expected, observed, passed) {
	return { id, expected, observed: JSON.stringify(observed), passed: passed === true };
}

function commandNames(responses) {
	const response = responses.find((row) => row?.type === "response" && row.command === "get_commands");
	return response?.success === true ? response.data?.commands?.map((command) => command.name) ?? [] : [];
}

function hasStatus(responses) {
	return responses.find((row) => row?.type === "extension_ui_request"
		&& row.method === "setStatus"
		&& row.statusKey === "sub-status:usage"
		&& row.statusText === EXPECTED_STATUS);
}

export function behaviorAssertions(name, {
	responses,
	exit_code,
	fullOutput,
	expectedVersion,
	processExitObserved,
	timedOut,
}) {
	const names = commandNames(responses);
	const expectedCommands = ["sub-core:settings", "sub-bar:settings", "sub-bar:import"];
	const status = hasStatus(responses);
	if (name === "extension_load") {
		return [assertion(
			"extension_registered",
			"Actual Pi RPC discovers the core and bar extension commands",
			{ expectedCommands, observedCommands: names },
			expectedCommands.every((command) => names.includes(command)),
		)];
	}
	if (name === "happy_path") {
		return [assertion(
			"feature_response",
			"Real Pi loads core, status, and bar; the core cache event renders the seeded usage through sub-status",
			status ?? null,
			!!status,
		)];
	}
	if (name === "error_path") {
		const parse = responses.find((row) => row?.type === "response" && row.command === "parse");
		const importPrompt = responses.find((row) => row?.type === "response"
			&& row.id === "bad-import" && row.command === "prompt");
		const importError = responses.find((row) => row?.type === "extension_ui_request"
			&& row.method === "notify" && row.message === "Invalid theme share string"
			&& row.notifyType === "error");
		const getCommands = responses.find((row) => row?.type === "response" && row.command === "get_commands");
		return [assertion(
			"handled_error",
			"Pi reports malformed RPC input and sub-bar rejects an invalid theme share through its handled error notification, then remains responsive",
			{
				parse: parse ?? null,
				importPrompt: importPrompt ?? null,
				importError: importError ?? null,
				subsequentCommandSucceeded: getCommands?.success === true,
			},
			parse?.success === false && typeof parse.error === "string" && parse.error.length > 0
				&& importPrompt?.success === true && importPrompt.data?.disposition === "handled"
				&& !!importError && getCommands?.success === true,
		)];
	}
	if (name === "reload_cleanup") {
		const clearStatus = responses.find((row) => row?.type === "extension_ui_request"
			&& row.method === "setStatus" && row.statusKey === "sub-status:usage"
			&& !Object.hasOwn(row, "statusText"));
		return [
			assertion(
				"reloaded_extension_registered",
				"A separately started second Pi process registers the core and bar commands",
				{ expectedCommands, observedCommands: names },
				expectedCommands.every((command) => names.includes(command)),
			),
			assertion(
				"reloaded_feature_response",
				"The second Pi process emits the actual cached-usage status response",
				status ?? null,
				!!status,
			),
			assertion(
				"clean_shutdown",
				"The second Pi process clears its status and exits naturally without unhandled or shutdown errors",
			{
				exit_code,
				processExitObserved,
				timedOut,
				clearStatus: clearStatus ?? null,
				hasShutdownError: UNHANDLED_ERROR_PATTERN.test(fullOutput),
			},
			exit_code === 0 && processExitObserved === true && timedOut !== true
				&& !!clearStatus && !UNHANDLED_ERROR_PATTERN.test(fullOutput),
			),
		];
	}
	if (name === "host_shell") {
		return [assertion(
			"native_shell_boundary",
			"The native host shell launches this checkout's pinned Pi CLI and returns its exact version",
			{ exit_code, output: fullOutput.trim(), expectedVersion },
			exit_code === 0 && fullOutput.trim() === expectedVersion,
		)];
	}
	throw new Error(`Unknown smoke case: ${name}`);
}
