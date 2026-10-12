/**
 * Utility functions for the sub-bar extension
 */

import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import type { CommandOutput, Dependencies, RateWindow } from "./types.js";
import { containsAllTokens, normalizeTokens } from "@eiei114/pi-sub-shared";

// Only allow simple CLI names (no spaces/paths) to avoid unsafe command execution.
const SAFE_CLI_NAME = /^[a-zA-Z0-9._-]+$/;

/**
 * Format a reset date as a relative time string
 */
export function formatReset(date: Date): string {
	const diffMs = date.getTime() - Date.now();
	if (diffMs < 0) return "now";

	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 60) return `${diffMins}m`;

	const hours = Math.floor(diffMins / 60);
	const mins = diffMins % 60;
	if (hours < 24) return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;

	const days = Math.floor(hours / 24);
	const remHours = hours % 24;
	return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
}

/**
 * Format elapsed time since a timestamp (milliseconds)
 */
export function formatElapsedSince(timestamp: number): string {
	const diffMs = Date.now() - timestamp;
	if (diffMs < 60000) return "just now";

	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 60) return `${diffMins}m`;

	const hours = Math.floor(diffMins / 60);
	const mins = diffMins % 60;
	if (hours < 24) return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;

	const days = Math.floor(hours / 24);
	const remHours = hours % 24;
	return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
}

/**
 * Strip ANSI escape codes from a string
 */
export function stripAnsi(text: string): string {
	 
	return text.replace(/\x1B\[[0-9;?]*[A-Za-z]|\x1B\].*?\x07/g, "");
}

/**
 * Reorder usage windows so those matching the active model come first.
 * A window matches when every model-ID token appears in the window label
 * AND the model tokens form a strict majority of the label tokens.
 * The majority check prevents a short model name (e.g. "gpt-5.3") from
 * falsely matching a longer, more specific label (e.g. "GPT-5.3-Codex-Spark 5h").
 * Non-matching windows keep their original relative order.
 */
export function prioritizeWindowsForModel(
	windows: RateWindow[],
	model?: { id?: string } | null,
): RateWindow[] {
	if (!model?.id || windows.length <= 1) return windows;

	const modelTokens = normalizeTokens(model.id);
	if (modelTokens.length === 0) return windows;

	const matched: RateWindow[] = [];
	const rest: RateWindow[] = [];

	for (const window of windows) {
		const labelTokens = normalizeTokens(window.label);
		const isMatch = containsAllTokens(modelTokens, labelTokens)
			&& modelTokens.length * 2 > labelTokens.length;
		if (isMatch) {
			matched.push(window);
		} else {
			rest.push(window);
		}
	}

	if (matched.length === 0 || matched.length === windows.length) return windows;

	return [...matched, ...rest];
}

function isWindowsEnv(deps: Dependencies): boolean {
	return deps.env.OS === "Windows_NT";
}

function pickWindowsExecutablePath(lines: string[]): string | null {
	const trimmed = lines.map((line) => line.trim()).filter(Boolean);
	for (const ext of [".exe", ".cmd", ".bat"]) {
		const hit = trimmed.find((line) => line.toLowerCase().endsWith(ext));
		if (hit) return hit;
	}
	return trimmed[0] ?? null;
}

function needsWindowsShell(deps: Dependencies, binary: string): boolean {
	if (!isWindowsEnv(deps)) return false;
	const base = path.basename(binary).toLowerCase();
	return base.endsWith(".cmd") || base.endsWith(".bat") || !path.extname(base);
}

/**
 * Arguments that are safe to place on a `cmd.exe` command line.
 *
 * `quoteWindowsArg` follows CommandLineToArgvW rules, but `cmd.exe` parses the
 * line first: `&`, `|`, `<` and `>` are operators, `%VAR%` is expanded even
 * inside quotes, and `"` is not an escape. A workspace id or model id can come
 * from a config file or an HTTP response body, so arguments are allowlisted
 * rather than escaped.
 */
const SAFE_SHELL_ARG = /^[A-Za-z0-9._:/\\ -]+$/;

/**
 * Characters that change meaning when `cmd.exe` parses the line.
 *
 * An executable path is not attacker-controlled the way an argument is, so the
 * path is only denied these characters; that keeps ordinary install locations
 * such as `C:\Program Files (x86)\nodejs` working.
 */
const UNSAFE_SHELL_PATH = /[&|<>^%!"\r\n]/;

/** Quote one argument for a Windows command line (CommandLineToArgvW rules). */
export function quoteWindowsArg(value: string): string {
	const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1");
	return `"${escaped}"`;
}

/** Build the single command line handed to a shell for a CLI invocation. */
export function buildShellCommandLine(file: string, args: string[]): string {
	return [file, ...args].map(quoteWindowsArg).join(" ");
}

/**
 * Run a shell-backed CLI (Windows npm shims such as `vela.cmd`).
 *
 * `execFileSync` cannot start a `.cmd` on Windows without a shell, and
 * `spawnSync(file, args, { shell: true })` triggers Node's DEP0190 warning for
 * unescaped concatenated args. Passing a single pre-quoted command line to
 * `shell: true` runs the shim without that warning.
 */
/** True when an argument can be placed on a `cmd.exe` line without interpretation. */
export function isSafeShellArg(value: string): boolean {
	return SAFE_SHELL_ARG.test(value);
}

/** True when an executable path contains no `cmd.exe` control characters. */
export function isSafeShellCommandPath(value: string): boolean {
	return !UNSAFE_SHELL_PATH.test(value);
}

function spawnShellCommand(
	file: string,
	args: string[],
	options?: ExecFileSyncOptionsWithStringEncoding
) {
	if (!isSafeShellCommandPath(file)) {
		throw new Error(`Refusing unsafe executable path for shell execution: ${file}`);
	}
	for (const value of args) {
		if (!isSafeShellArg(value)) {
			throw new Error(`Refusing unsafe argument for shell execution: ${value}`);
		}
	}
	const commandLine = buildShellCommandLine(file, args);
	return spawnSync(commandLine, {
		...options,
		encoding: options?.encoding ?? "utf-8",
		shell: true,
	});
}

/**
 * Run a CLI, falling back to a shell for Windows npm shims (.cmd/.bat).
 */
export function execCliSync(
	deps: Dependencies,
	file: string,
	args: string[],
	options?: ExecFileSyncOptionsWithStringEncoding
): string {
	if (!needsWindowsShell(deps, file)) {
		return deps.execFileSync(file, args, options);
	}

	const result = spawnShellCommand(file, args, options);
	if (result.error || result.status !== 0) {
		throw result.error ?? new Error(`${file} exited with status ${result.status}`);
	}
	return typeof result.stdout === "string" ? result.stdout : "";
}

export function execCliSyncWithStderr(
	deps: Dependencies,
	file: string,
	args: string[],
	options?: ExecFileSyncOptionsWithStringEncoding
): CommandOutput {
	if (!needsWindowsShell(deps, file)) {
		return deps.execFileSyncWithStderr(file, args, options);
	}

	const result = spawnShellCommand(file, args, options);
	if (result.error || result.status !== 0) {
		throw result.error ?? new Error(`${file} exited with status ${result.status}`);
	}
	return {
		stdout: typeof result.stdout === "string" ? result.stdout : "",
		stderr: typeof result.stderr === "string" ? result.stderr : "",
	};
}

/**
 * Check if a command exists in PATH
 */
export function whichSync(cmd: string, deps: Dependencies): string | null {
	if (!SAFE_CLI_NAME.test(cmd)) {
		return null;
	}

	const locator = isWindowsEnv(deps) ? "where.exe" : "which";
	try {
		const raw = deps.execFileSync(locator, [cmd], { encoding: "utf-8" }).trim();
		if (!raw) return null;
		const lines = raw.split(/\r?\n/);
		if (isWindowsEnv(deps)) {
			return pickWindowsExecutablePath(lines);
		}
		return lines.map((line) => line.trim()).find(Boolean) ?? null;
	} catch {
		return null;
	}
}

/**
 * Create an abort controller with a timeout
 */
export function createTimeoutController(timeoutMs: number): { controller: AbortController; clear: () => void } {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	return {
		controller,
		clear: () => clearTimeout(timeoutId),
	};
}
