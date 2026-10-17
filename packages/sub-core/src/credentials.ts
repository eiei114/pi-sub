/**
 * Shared credential and JSON-shape helpers for provider implementations.
 */

import * as path from 'node:path';
import type { Dependencies } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** pi's agent auth file (`~/.pi/agent/auth.json`). */
export function piAuthFilePath(deps: Dependencies): string {
	return path.join(deps.homedir(), '.pi', 'agent', 'auth.json');
}

/**
 * Read one raw entry value of pi's agent auth.json, or `undefined` for a
 * missing file or malformed JSON. Never throws. Some providers deliberately
 * accept a bare string entry (`"<key>"`) as well as an object; this variant
 * preserves that shape for their existing extraction logic.
 */
export function readPiAuthEntryValue(deps: Dependencies, key: string): unknown {
	try {
		const authPath = piAuthFilePath(deps);
		if (!deps.fileExists(authPath)) return undefined;
		const auth: unknown = JSON.parse(deps.readFile(authPath) ?? '{}');
		if (!isRecord(auth)) return undefined;
		return auth[key];
	} catch {
		return undefined;
	}
}

/**
 * Read one object entry of pi's agent auth.json, or `undefined` for a missing
 * file, malformed JSON, or a non-object entry. Never throws. This only
 * locates the entry: callers must still gate on its `type` and pass any
 * token material through `normalizeCredentialString` — the entry record is
 * not a credential.
 */
export function readPiAuthEntry(
	deps: Dependencies,
	key: string,
): Record<string, unknown> | undefined {
	const entry = readPiAuthEntryValue(deps, key);
	return isRecord(entry) ? entry : undefined;
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
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;
	if (options.rejectCommandPrefix && trimmed.startsWith('!')) return undefined;
	if (options.rejectNewlines && /[\r\n]/.test(trimmed)) return undefined;
	return trimmed;
}
