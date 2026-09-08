/**
 * xAI (Grok) subscription usage provider (unofficial API)
 *
 * Scope of this provider:
 * - It reports the SUBSCRIPTION quota (SuperGrok/Grok plan) of the single base
 *   `xai` OAuth credential managed by pi. It is not the developer API
 *   (`XAI_API_KEY`) billing bucket, and an xAI API key can never be used here.
 * - Only the quota percentage and its reset are surfaced. Prepaid balance,
 *   on-demand spend, unit/credit counts and plan names are intentionally not
 *   parsed: their meaning in this undocumented payload is unverified.
 * - The endpoint is derived from client behavior, not from public docs, so its
 *   shape can change without notice. Every failure soft-errors with a static
 *   message plus the HTTP status; response bodies are never surfaced.
 */

import * as path from "node:path";
import type { Dependencies, RateWindow, UsageSnapshot } from "../../types.js";
import { BaseProvider } from "../../provider.js";
import { noCredentials, fetchFailed, httpError, apiError } from "../../errors.js";
import { formatReset, createTimeoutController } from "../../utils.js";
import {
	API_TIMEOUT_MS,
	XAI_BILLING_URL,
	XAI_CLI_CLIENT_MODE,
	XAI_CLI_CLIENT_VERSION,
} from "../../config.js";

/** Static, sanitized parse error. Never include payload or account details. */
const INVALID_RESPONSE = "Invalid xAI usage response";

/** pi stores the xAI subscription credential under this auth.json key. */
const XAI_AUTH_KEY = "xai";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToken(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 && !trimmed.startsWith("!") && !/[\r\n]/.test(trimmed)
		? trimmed : undefined;
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

/**
 * Load the xAI subscription OAuth access token.
 *
 * Sources, in order:
 * 1. `XAI_OAUTH_TOKEN` — explicit OAuth-only override.
 * 2. pi's `~/.pi/agent/auth.json` entry `xai`, but only when it is an OAuth
 *    entry (`type === "oauth"`) with a non-blank `access` token.
 *
 * API keys are never used: `XAI_API_KEY` and `api_key`-style auth entries
 * belong to the developer API and cannot read subscription quota. Tokens are
 * never refreshed, no login/`!command` is executed, and no other provider's
 * credentials are read.
 */
function loadXaiOAuthToken(deps: Dependencies): string | undefined {
	const envToken = normalizeToken(deps.env.XAI_OAUTH_TOKEN);
	if (envToken) return envToken;

	const authPath = path.join(deps.homedir(), ".pi", "agent", "auth.json");
	try {
		if (!deps.fileExists(authPath)) return undefined;
		const auth = JSON.parse(deps.readFile(authPath) ?? "{}") as unknown;
		if (!isRecord(auth)) return undefined;
		const entry = auth[XAI_AUTH_KEY];
		if (!isRecord(entry) || entry.type !== "oauth") return undefined;
		return normalizeToken(entry.access);
	} catch {
		// Ignore parse errors
	}

	return undefined;
}

/**
 * Read the quota percentage (already 0-100) from the billing config.
 *
 * A missing, non-numeric, non-finite or negative value is invalid and yields
 * `undefined` so the caller can fail with an explicit error. It must never be
 * treated as `0`, which would render as "no quota used".
 */
function readUsagePercent(config: Record<string, unknown>): number | undefined {
	const raw =
		typeof config.creditUsagePercent === "number"
			? config.creditUsagePercent
			: config.credit_usage_percent;
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
	return raw;
}

function readPeriod(config: Record<string, unknown>): Record<string, unknown> | undefined {
	if (isRecord(config.currentPeriod)) return config.currentPeriod;
	if (isRecord(config.current_period)) return config.current_period;
	return undefined;
}

/**
 * Map the period type (e.g. `USAGE_PERIOD_TYPE_WEEKLY`) to a window label.
 * Unknown or missing period types fall back to a neutral label rather than
 * guessing a cadence.
 */
function periodLabel(type: unknown): string {
	if (typeof type === "string") {
		const normalized = type.trim().toUpperCase();
		if (normalized.endsWith("WEEKLY")) return "Week";
		if (normalized.endsWith("MONTHLY")) return "Month";
	}
	return "Usage";
}

function parseIsoDate(value: unknown): Date | undefined {
	const raw = normalizeToken(value);
	if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return undefined;
	const date = new Date(raw);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Parse the single subscription quota window from an unknown JSON payload.
 *
 * Returns `undefined` for anything that is not a usable current-schema
 * payload (null/array/wrong types, or an invalid percentage). Legacy cent-based
 * fields (`config.used.val` / `config.monthlyLimit.val`) are deliberately NOT
 * used as a fallback: their unit and relation to subscription quota are
 * unverified here, and treating a missing value as `0` would show an empty
 * quota bar for an account whose usage is simply unknown.
 */
export function parseXaiUsageWindow(payload: unknown): RateWindow | undefined {
	if (!isRecord(payload)) return undefined;
	const config = payload.config;
	if (!isRecord(config)) return undefined;

	const percent = readUsagePercent(config);
	if (percent === undefined) return undefined;

	const period = readPeriod(config);
	const resetDate = parseIsoDate(period?.end);

	return {
		label: periodLabel(period?.type),
		usedPercent: clampPercent(percent),
		resetDescription: resetDate ? formatReset(resetDate) : undefined,
		resetAt: resetDate?.toISOString(),
	};
}

export class XaiProvider extends BaseProvider {
	readonly name = "xai" as const;
	readonly displayName = "xAI (Grok) Plan";

	hasCredentials(deps: Dependencies): boolean {
		return Boolean(loadXaiOAuthToken(deps));
	}

	async fetchUsage(deps: Dependencies): Promise<UsageSnapshot> {
		const token = loadXaiOAuthToken(deps);
		if (!token) {
			return this.emptySnapshot(noCredentials());
		}

		// The timeout stays armed until the body has been parsed, so a stalled
		// response body cannot hang the refresh; it is cleared in `finally`.
		const { controller, clear } = createTimeoutController(API_TIMEOUT_MS);

		try {
			const res = await deps.fetch(XAI_BILLING_URL, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
					"x-grok-client-mode": XAI_CLI_CLIENT_MODE,
					"x-grok-client-version": XAI_CLI_CLIENT_VERSION,
				},
				// Keep credential-bearing requests on the selected endpoint.
				redirect: "error",
				signal: controller.signal,
			});

			if (!res.ok) {
				// Status only (401/403 auth, 426 client-version mismatch, …).
				// The response body may contain account details and is not read.
				await res.body?.cancel().catch(() => undefined);
				return this.emptySnapshot(httpError(res.status));
			}

			let payload: unknown;
			try {
				payload = await res.json();
			} catch {
				return this.emptySnapshot(apiError(INVALID_RESPONSE));
			}

			const usageWindow = parseXaiUsageWindow(payload);
			if (!usageWindow) {
				return this.emptySnapshot(apiError(INVALID_RESPONSE));
			}

			return this.snapshot({ windows: [usageWindow] });
		} catch {
			return this.emptySnapshot(fetchFailed());
		} finally {
			clear();
		}
	}

	// xAI has no status page wired up here.
}
