/**
 * Shared credential and JSON-shape helpers for provider implementations.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface NormalizeCredentialOptions {
	/** Reject `!command` indirection values that require shell execution. */
	rejectCommandPrefix?: boolean;
	/** Reject values containing CR/LF. */
	rejectNewlines?: boolean;
}

/**
 * Normalize an env/auth credential string: trim whitespace and optionally
 * reject values that are not safe static secrets for a provider to use directly.
 */
export function normalizeCredentialString(
	value: unknown,
	options: NormalizeCredentialOptions = {},
): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;
	if (options.rejectCommandPrefix && trimmed.startsWith("!")) return undefined;
	if (options.rejectNewlines && /[\r\n]/.test(trimmed)) return undefined;
	return trimmed;
}
