/**
 * Ollama Cloud usage provider
 *
 * `GET https://ollama.com/api/usage` reports per-window usage as a 0..1
 * fraction plus per-model request counts, and an `activity` block with the
 * total dollar cost of the current billing period. Windows appear only when
 * they apply to the account (`session`, `weekly`, `monthly` — Pro accounts
 * may only have `monthly`).
 *
 * Authentication is the API key from `OLLAMA_API_KEY` or the `ollama-cloud`
 * credential in pi's `auth.json` (`/login ollama-cloud`). Keys are created at
 * https://ollama.com/settings/keys — the Ed25519 CLI credentials from
 * `ollama signin` do not authenticate this endpoint.
 */

import * as path from "node:path";
import type { Dependencies, RateWindow, UsageSnapshot } from "../../types.js";
import { BaseProvider } from "../../provider.js";
import { noCredentials, fetchFailed, httpError, apiError } from "../../errors.js";
import { formatReset, createTimeoutController } from "../../utils.js";
import { API_TIMEOUT_MS, OLLAMA_USAGE_URL } from "../../config.js";

/** Static messages: API error bodies, exceptions and key material are never surfaced. */
const INVALID_USAGE_RESPONSE = "Invalid Ollama usage response";

interface OllamaWindow {
	/** 0..1 fraction of the window quota already used. */
	usage?: unknown;
	models?: unknown;
}

interface OllamaUsageResponse {
	limits?: {
		session?: OllamaWindow;
		weekly?: OllamaWindow;
		monthly?: OllamaWindow;
	};
	activity?: {
		cost?: unknown;
		period?: {
			type?: unknown;
			starting_at?: unknown;
			ending_at?: unknown;
		};
	};
}

const WINDOW_SPECS = [
	{ key: "session", label: "Session" },
	{ key: "weekly", label: "Week" },
	{ key: "monthly", label: "Month" },
] as const;

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
 * Auth precedence: `OLLAMA_API_KEY` → `~/.pi/agent/auth.json`
 * `ollama-cloud.access` / `.key` / `.apiKey`.
 *
 * Each candidate is normalized on its own so a blank or non-string value falls
 * through to the next one instead of shadowing it.
 */
function loadOllamaApiKey(deps: Dependencies): string | undefined {
	const envApiKey = normalizeApiKey(deps.env.OLLAMA_API_KEY);
	if (envApiKey) return envApiKey;

	const authPath = path.join(deps.homedir(), ".pi", "agent", "auth.json");
	try {
		if (deps.fileExists(authPath)) {
			const auth = JSON.parse(deps.readFile(authPath) ?? "{}") as Record<string, unknown>;
			const ollamaAuth = auth["ollama-cloud"] as Record<string, unknown> | undefined;
			return (
				normalizeApiKey(ollamaAuth?.access)
				?? normalizeApiKey(ollamaAuth?.key)
				?? normalizeApiKey(ollamaAuth?.apiKey)
			);
		}
	} catch {
		// Ignore parse errors
	}

	return undefined;
}

function toPercentUsed(usage: unknown): number | undefined {
	if (typeof usage !== "number" || !Number.isFinite(usage)) return undefined;
	// The API reports a 0..1 fraction; a value > 1 is already a percentage.
	return usage <= 1 ? usage * 100 : usage;
}

/** Absolute reset instants only; a non-ISO string is dropped rather than guessed. */
function resetFields(value: unknown): Pick<RateWindow, "resetAt" | "resetDescription"> {
	if (typeof value !== "string" || !value) return {};
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return {};
	return { resetAt: date.toISOString(), resetDescription: formatReset(date) };
}

/** Map a usage payload onto the windows the bar renders. */
export function buildOllamaWindows(data: OllamaUsageResponse): RateWindow[] {
	const windows: RateWindow[] = [];
	for (const spec of WINDOW_SPECS) {
		const entry = data.limits?.[spec.key];
		const percentUsed = toPercentUsed(entry?.usage);
		if (percentUsed === undefined) continue;
		// Per-window reset instants are not reported; the billing period's end
		// is the closest truth for the monthly window (e.g. `last_4_weeks`).
		const reset = spec.key === "monthly" ? resetFields(data.activity?.period?.ending_at) : {};
		windows.push({ label: spec.label, usedPercent: percentUsed, ...reset });
	}
	return windows;
}

export class OllamaCloudProvider extends BaseProvider {
	readonly name = "ollama-cloud" as const;
	readonly displayName = "Ollama Cloud";

	hasCredentials(deps: Dependencies): boolean {
		return Boolean(loadOllamaApiKey(deps));
	}

	async fetchUsage(deps: Dependencies): Promise<UsageSnapshot> {
		const apiKey = loadOllamaApiKey(deps);
		if (!apiKey) {
			return this.emptySnapshot(noCredentials());
		}

		const { controller, clear } = createTimeoutController(API_TIMEOUT_MS);
		try {
			const res = await deps.fetch(OLLAMA_USAGE_URL, {
				method: "GET",
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				// Keep credential-bearing requests on the explicitly selected endpoint.
				redirect: "error",
				signal: controller.signal,
			});

			if (!res.ok) {
				await res.body?.cancel().catch(() => undefined);
				return this.emptySnapshot(httpError(res.status));
			}

			let data: OllamaUsageResponse;
			try {
				data = (await res.json()) as OllamaUsageResponse;
			} catch {
				return this.emptySnapshot(apiError(INVALID_USAGE_RESPONSE));
			}

			const windows = buildOllamaWindows(data);
			if (windows.length === 0) {
				return this.emptySnapshot(apiError(INVALID_USAGE_RESPONSE));
			}

			const cost =
				typeof data.activity?.cost === "string" && data.activity.cost.length > 0
					? data.activity.cost
					: undefined;

			return this.snapshot({
				windows,
				requestsSummary: cost ? `Cost: $${cost}` : undefined,
			});
		} catch {
			return this.emptySnapshot(fetchFailed());
		} finally {
			clear();
		}
	}
}
