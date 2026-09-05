/**
 * Parsing helpers for the OpenRouter usage provider.
 *
 * Both endpoints return untrusted JSON, so every field is validated before use.
 * Nothing derived here is ever taken from a field the API controls as free text
 * (key label, account id, error body); only numbers are read.
 */

/** Per-credential cap and spend, from `GET /api/v1/key`. */
export interface OpenRouterKeyInfo {
	/** All-time spend on this credential, in account currency. */
	usage?: number;
	/**
	 * Spending cap of this credential.
	 * `null` = documented "no cap on this key" (NOT an unlimited wallet).
	 * `undefined` = the cap could not be determined.
	 */
	limit?: number | null;
	/**
	 * Authoritative remaining cap, straight from `limit_remaining`.
	 * Never derived from `limit - usage`: `usage` is all-time while the cap can
	 * be periodic, so the difference would be wrong.
	 */
	remaining?: number;
}

/** Account wallet totals, from `GET /api/v1/credits`. */
export interface OpenRouterCreditsInfo {
	total: number;
	usage: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accept only finite, non-negative numbers. Strings, booleans, `NaN`,
 * `Infinity` and negative amounts are treated as unknown rather than coerced.
 */
function toAmount(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return value;
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

/**
 * Parse `GET /api/v1/key`. Returns `undefined` when the payload carries no
 * usable field, so callers can report a static API error instead of guessing.
 *
 * `limit_reset` is deliberately ignored: it is a period name such as "daily",
 * not a timestamp, and there is no way to turn it into a reset date.
 * `rate_limit` is deprecated and also ignored.
 */
export function parseKeyResponse(payload: unknown): OpenRouterKeyInfo | undefined {
	if (!isRecord(payload)) return undefined;
	const data = payload.data;
	if (!isRecord(data)) return undefined;

	const usage = toAmount(data.usage);
	// Only an explicit `null` means "uncapped"; any other invalid value leaves
	// the cap unknown so no quota is fabricated for it.
	const limit = data.limit === null ? null : toAmount(data.limit);
	// A remaining amount is only meaningful when a numeric cap exists.
	const remaining = typeof limit === "number" ? toAmount(data.limit_remaining) : undefined;

	if (usage === undefined && limit === undefined) return undefined;
	return { usage, limit, remaining };
}

/**
 * Percentage of the key cap already used, or `undefined` when no honest
 * percentage exists (cap known but remaining unknown).
 */
export function keyLimitUsedPercent(limit: number, remaining: number | undefined): number | undefined {
	// A zero cap can never have anything left, whatever `limit_remaining` says.
	if (limit === 0) return 100;
	if (remaining === undefined) return undefined;
	return clampPercent(((limit - remaining) / limit) * 100);
}

/**
 * Parse `GET /api/v1/credits`. Missing or malformed totals are unknown, not
 * zero, so a partial payload never renders as an empty wallet.
 */
export function parseCreditsResponse(payload: unknown): OpenRouterCreditsInfo | undefined {
	if (!isRecord(payload)) return undefined;
	const data = payload.data;
	if (!isRecord(data)) return undefined;

	const total = toAmount(data.total_credits);
	const usage = toAmount(data.total_usage);
	if (total === undefined || usage === undefined) return undefined;
	return { total, usage };
}

/** Percentage of the account wallet already used. A zero wallet is exhausted. */
export function creditsUsedPercent(total: number, usage: number): number {
	if (total === 0) return 100;
	return clampPercent((usage / total) * 100);
}
