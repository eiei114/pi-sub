/**
 * OpenCode Go usage provider (unofficial API)
 */

import * as path from "node:path";
import type { Dependencies, RateWindow, UsageSnapshot } from "../../types.js";
import { BaseProvider } from "../../provider.js";
import { noCredentials, fetchFailed, httpError, apiError } from "../../errors.js";
import { formatReset, createTimeoutController } from "../../utils.js";
import { API_TIMEOUT_MS, OPENCODE_USAGE_URL } from "../../config.js";

interface OpenCodeUsageWindow {
	percent?: number;
	status?: string;
	resetsAt?: string;
}

interface OpenCodeUsageResponse {
	usage?: {
		rolling?: OpenCodeUsageWindow;
		weekly?: OpenCodeUsageWindow;
		monthly?: OpenCodeUsageWindow;
	};
}

function normalizeApiKey(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function authFilePath(deps: Dependencies): string {
	const dataHome = deps.env.XDG_DATA_HOME || path.join(deps.homedir(), ".local", "share");
	return path.join(dataHome, "opencode", "auth.json");
}

/**
 * Read OpenCode Go API key from local auth file, OPENCODE_AUTH_CONTENT, or env.
 */
function loadOpenCodeApiKey(deps: Dependencies): string | undefined {
	const envKey = normalizeApiKey(deps.env.OPENCODE_API_KEY ?? deps.env.OPENCODE_GO_API_KEY);
	if (envKey) return envKey;

	try {
		const contents = deps.env.OPENCODE_AUTH_CONTENT
			? deps.env.OPENCODE_AUTH_CONTENT
			: deps.fileExists(authFilePath(deps))
				? deps.readFile(authFilePath(deps))
				: undefined;
		if (!contents) return undefined;
		const auth = JSON.parse(contents) as Record<string, unknown>;
		const credential = auth["opencode-go"];
		if (isRecord(credential) && credential.type === "api") {
			return normalizeApiKey(credential.key);
		}
		if (typeof credential === "string") return normalizeApiKey(credential);
		if (isRecord(credential)) {
			return normalizeApiKey(credential.key) ?? normalizeApiKey(credential.access);
		}
	} catch {
		// Ignore parse errors
	}

	return undefined;
}

function pushWindow(
	windows: RateWindow[],
	label: string,
	window: OpenCodeUsageWindow | undefined
): void {
	if (!window || typeof window.percent !== "number" || !Number.isFinite(window.percent)) return;
	const resetDate =
		typeof window.resetsAt === "string" && window.resetsAt.trim()
			? new Date(window.resetsAt)
			: undefined;
	const validReset = resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate : undefined;
	windows.push({
		label,
		usedPercent: clampPercent(window.percent),
		resetDescription: validReset ? formatReset(validReset) : undefined,
		resetAt: validReset?.toISOString(),
	});
}

export class OpenCodeProvider extends BaseProvider {
	readonly name = "opencode" as const;
	readonly displayName = "OpenCode";

	hasCredentials(deps: Dependencies): boolean {
		return Boolean(loadOpenCodeApiKey(deps));
	}

	async fetchUsage(deps: Dependencies): Promise<UsageSnapshot> {
		const apiKey = loadOpenCodeApiKey(deps);
		if (!apiKey) {
			return this.emptySnapshot(noCredentials());
		}

		const { controller, clear } = createTimeoutController(API_TIMEOUT_MS);

		try {
			const res = await deps.fetch(OPENCODE_USAGE_URL, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: "application/json",
				},
				signal: controller.signal,
			});
			clear();

			if (!res.ok) {
				return this.emptySnapshot(httpError(res.status));
			}

			let data: OpenCodeUsageResponse;
			try {
				data = (await res.json()) as OpenCodeUsageResponse;
			} catch {
				return this.emptySnapshot(apiError("Invalid OpenCode usage response"));
			}

			const windows: RateWindow[] = [];
			// Primary quota: rolling 5h + weekly (plan: 1–2 windows).
			pushWindow(windows, "5h", data.usage?.rolling);
			pushWindow(windows, "Week", data.usage?.weekly);

			if (windows.length === 0) {
				return this.emptySnapshot(apiError("Invalid OpenCode usage response"));
			}

			return this.snapshot({ windows });
		} catch {
			clear();
			return this.emptySnapshot(fetchFailed());
		}
	}
}
