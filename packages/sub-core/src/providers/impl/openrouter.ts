/**
 * OpenRouter usage provider
 *
 * `/key` is authoritative for the credential actually being used (its spending
 * cap and spend). `/credits` describes the account wallet, is documented as
 * requiring a management key, and is therefore only best-effort enrichment: a
 * wallet failure must never discard valid key data.
 */

import * as path from "node:path";
import type { Dependencies, RateWindow, UsageError, UsageSnapshot } from "../../types.js";
import { BaseProvider } from "../../provider.js";
import { noCredentials, fetchFailed, httpError, apiError } from "../../errors.js";
import { createTimeoutController } from "../../utils.js";
import { API_TIMEOUT_MS, OPENROUTER_CREDITS_URL, OPENROUTER_KEY_URL } from "../../config.js";
import {
	creditsUsedPercent,
	keyLimitUsedPercent,
	parseCreditsResponse,
	parseKeyResponse,
	type OpenRouterCreditsInfo,
	type OpenRouterKeyInfo,
} from "./openrouter-parse.js";

/** Window label for the per-key spending cap. */
export const OPENROUTER_KEY_LIMIT_WINDOW = "Key limit";
/** Window label for the account wallet. */
export const OPENROUTER_CREDITS_WINDOW = "Credits";

/** Static messages: API error bodies, exceptions and key material are never surfaced. */
const INVALID_KEY_RESPONSE = "Invalid OpenRouter key response";
const INVALID_CREDITS_RESPONSE = "Invalid OpenRouter credits response";

function normalizeApiKey(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;
	// `!command` values mean "run this to get the secret". This provider never
	// executes commands, so such a value is not a usable credential.
	if (trimmed.startsWith("!")) return undefined;
	return trimmed;
}

/**
 * Auth precedence (unchanged): `OPENROUTER_API_KEY` → `OPENROUTER_KEY` →
 * `~/.pi/agent/auth.json` `openrouter.access` / `.key` / `.apiKey`.
 *
 * Each candidate is normalized on its own so a blank or non-string value falls
 * through to the next one instead of shadowing it.
 *
 * Resolving a specific account alias out of a multi-account auth file is a
 * separate concern and is intentionally not handled here.
 */
function loadOpenRouterApiKey(deps: Dependencies): string | undefined {
	const envApiKey = normalizeApiKey(deps.env.OPENROUTER_API_KEY) ?? normalizeApiKey(deps.env.OPENROUTER_KEY);
	if (envApiKey) return envApiKey;

	const authPath = path.join(deps.homedir(), ".pi", "agent", "auth.json");
	try {
		if (deps.fileExists(authPath)) {
			const auth = JSON.parse(deps.readFile(authPath) ?? "{}") as Record<string, unknown>;
			const openrouterAuth = auth.openrouter as Record<string, unknown> | undefined;
			return (
				normalizeApiKey(openrouterAuth?.access)
				?? normalizeApiKey(openrouterAuth?.key)
				?? normalizeApiKey(openrouterAuth?.apiKey)
			);
		}
	} catch {
		// Ignore parse errors
	}

	return undefined;
}

type JsonResult =
	| { ok: true; payload: unknown }
	| { ok: false; error: UsageError };

async function requestJson(
	deps: Dependencies,
	url: string,
	headers: Record<string, string>,
	signal: AbortSignal,
	invalidMessage: string,
): Promise<JsonResult> {
	const res = await deps.fetch(url, {
		method: "GET",
		headers,
		// Keep credential-bearing requests on the explicitly selected endpoint.
		redirect: "error",
		signal,
	});
	if (!res.ok) {
		await res.body?.cancel().catch(() => undefined);
		return { ok: false, error: httpError(res.status) };
	}
	try {
		return { ok: true, payload: (await res.json()) as unknown };
	} catch {
		return { ok: false, error: apiError(invalidMessage) };
	}
}

export class OpenRouterProvider extends BaseProvider {
	readonly name = "openrouter" as const;
	readonly displayName = "OpenRouter";

	hasCredentials(deps: Dependencies): boolean {
		return Boolean(loadOpenRouterApiKey(deps));
	}

	async fetchUsage(deps: Dependencies): Promise<UsageSnapshot> {
		const apiKey = loadOpenRouterApiKey(deps);
		if (!apiKey) {
			return this.emptySnapshot(noCredentials());
		}

		// One timeout covers both requests and stays armed through JSON parsing.
		const { controller, clear } = createTimeoutController(API_TIMEOUT_MS);
		const headers = {
			Authorization: `Bearer ${apiKey}`,
			Accept: "application/json",
		};

		try {
			const keyResult = await requestJson(
				deps,
				OPENROUTER_KEY_URL,
				headers,
				controller.signal,
				INVALID_KEY_RESPONSE,
			);
			if (!keyResult.ok) {
				// This credential is the only one considered: a `/key` failure is
				// reported as-is instead of retrying with anything else.
				return this.emptySnapshot(keyResult.error);
			}

			const key = parseKeyResponse(keyResult.payload);
			if (!key) {
				return this.emptySnapshot(apiError(INVALID_KEY_RESPONSE));
			}

			const credits = await this.fetchAccountCredits(deps, headers, controller.signal);
			return this.buildSnapshot(key, credits);
		} catch {
			return this.emptySnapshot(fetchFailed());
		} finally {
			clear();
		}
	}

	/**
	 * Best-effort wallet lookup. Any failure (403 for an ordinary inference key,
	 * malformed body, abort, network error) yields `undefined` so the caller can
	 * report the wallet as unavailable while keeping the key data.
	 */
	private async fetchAccountCredits(
		deps: Dependencies,
		headers: Record<string, string>,
		signal: AbortSignal,
	): Promise<OpenRouterCreditsInfo | undefined> {
		try {
			const result = await requestJson(
				deps,
				OPENROUTER_CREDITS_URL,
				headers,
				signal,
				INVALID_CREDITS_RESPONSE,
			);
			return result.ok ? parseCreditsResponse(result.payload) : undefined;
		} catch {
			return undefined;
		}
	}

	private buildSnapshot(key: OpenRouterKeyInfo, credits: OpenRouterCreditsInfo | undefined): UsageSnapshot {
		const windows: RateWindow[] = [];

		// A percent window exists only for a real, numeric cap. Uncapped
		// (`limit: null`) and unknown caps get no window and no invented reset:
		// `limit_reset` is a period name, not a date.
		if (typeof key.limit === "number") {
			const usedPercent = keyLimitUsedPercent(key.limit, key.remaining);
			if (usedPercent !== undefined) {
				windows.push({ label: OPENROUTER_KEY_LIMIT_WINDOW, usedPercent });
			}
		}

		if (credits) {
			windows.push({
				label: OPENROUTER_CREDITS_WINDOW,
				usedPercent: creditsUsedPercent(credits.total, credits.usage),
			});
		}

		return this.snapshot({
			windows,
			keyUsage: key.usage,
			keyLimit: key.limit,
			keyRemaining: key.remaining,
			creditTotal: credits?.total,
			creditUsage: credits?.usage,
			creditRemaining: credits ? Math.max(0, credits.total - credits.usage) : undefined,
			creditUnavailable: credits ? undefined : true,
		});
	}
}
