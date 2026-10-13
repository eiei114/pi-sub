/**
 * OpenDesign (AMR Link) usage provider (unofficial / source-derived).
 *
 * Coding Plan windows are read from `vela billing preflight --format json` when
 * the Vela CLI is installed and a workspace id is configured. AMR Link API keys
 * (`sk-amr-…` in Pi auth.json) authenticate chat only today; billing routes on
 * amr-api return 401 until OpenDesign exposes link-key quota reads.
 */

import * as path from "node:path";
import type { Dependencies, UsageError, UsageSnapshot } from "../../types.js";
import { BaseProvider } from "../../provider.js";
import { noCredentials, fetchFailed, httpError, apiError, noCli, notLoggedIn } from "../../errors.js";import { isRecord, normalizeCredentialString } from "../../credentials.js";
import { createTimeoutController } from "../../utils.js";
import {
	API_TIMEOUT_MS,
	OPENDESIGN_BILLING_SUMMARY_URL,
	OPENDESIGN_LINK_USAGE_URL,
} from "../../config.js";
import {
	parseBillingPreflightJson,
	parseBillingResponseJson,
	parseLinkUsageJson,
} from "./opendesign-parse.js";
import {
	isVelaLoggedIn,
	loadWorkspaceIdFromAmrWorkspaces,
	loadWorkspaceIdFromOpenDesignApp,
	resolveVelaBinary,
	runVelaBillingPreflight,
} from "./opendesign-vela.js";

const normalizeApiKey = normalizeCredentialString;

function piAuthFilePath(deps: Dependencies): string {
	return path.join(deps.homedir(), ".pi", "agent", "auth.json");
}

function workspaceConfigPath(deps: Dependencies): string {
	return path.join(deps.homedir(), ".pi", "agent", "opendesign-workspace.json");
}

function credentialKey(credential: unknown): string | undefined {
	if (typeof credential === "string") return normalizeApiKey(credential);
	if (!isRecord(credential)) return undefined;
	if (credential.type === "api" || credential.type === "api_key") {
		const key = normalizeApiKey(credential.key);
		if (key) return key;
	}
	return (
		normalizeApiKey(credential.key) ??
		normalizeApiKey(credential.access) ??
		normalizeApiKey(credential.apiKey)
	);
}

function keyFromAuthContent(contents: string | undefined): string | undefined {
	try {
		if (!contents) return undefined;
		const auth = JSON.parse(contents) as Record<string, unknown>;
		return credentialKey(auth.opendesign);
	} catch {
		return undefined;
	}
}

function loadOpenDesignApiKeys(deps: Dependencies): string[] {
	const candidates: string[] = [];
	const push = (key: string | undefined) => {
		const normalized = normalizeApiKey(key);
		if (normalized && !candidates.includes(normalized)) {
			candidates.push(normalized);
		}
	};

	push(normalizeApiKey(deps.env.OPENDESIGN_API_KEY));
	push(keyFromAuthContent(deps.fileExists(piAuthFilePath(deps)) ? deps.readFile(piAuthFilePath(deps)) : undefined));
	return candidates;
}

function loadWorkspaceIdSync(deps: Dependencies): string | undefined {
	const fromEnv = deps.env.OPENDESIGN_WORKSPACE_ID?.trim();
	if (fromEnv) return fromEnv;

	const configPath = workspaceConfigPath(deps);
	if (deps.fileExists(configPath)) {
		try {
			const raw = JSON.parse(deps.readFile(configPath) ?? "") as { workspaceId?: unknown };
			if (typeof raw.workspaceId === "string" && raw.workspaceId.trim()) {
				return raw.workspaceId.trim();
			}
		} catch {
			// fall through
		}
	}

	return loadWorkspaceIdFromOpenDesignApp(deps);
}

async function resolveWorkspaceId(deps: Dependencies): Promise<string | undefined> {
	const sync = loadWorkspaceIdSync(deps);
	if (sync) return sync;
	return loadWorkspaceIdFromAmrWorkspaces(deps);
}

/** An auth failure on the Link key says nothing about quota; it is never the real cause. */
function isAuthError(error: UsageError | undefined): boolean {
	return (
		error?.code === "HTTP_ERROR" && (error.httpStatus === 401 || error.httpStatus === 403)
	);
}

export class OpenDesignProvider extends BaseProvider {
	readonly name = "opendesign" as const;
	readonly displayName = "OpenDesign";

	hasCredentials(deps: Dependencies): boolean {
		if (loadOpenDesignApiKeys(deps).length > 0) return true;
		return Boolean(resolveVelaBinary(deps));
	}

	private fetchUsageViaVela(deps: Dependencies, workspaceId: string): UsageSnapshot {
		const velaBinary = resolveVelaBinary(deps);
		if (!velaBinary) {
			return this.emptySnapshot(noCli("vela"));
		}

		if (!isVelaLoggedIn(deps, velaBinary)) {
			return this.emptySnapshot(notLoggedIn());
		}

		try {
			const stdout = runVelaBillingPreflight(
				deps,
				velaBinary,
				workspaceId,
				deps.env.OPENDESIGN_PREFLIGHT_MODEL?.trim()
			);
			const windows = parseBillingPreflightJson(stdout);
			if (windows.length === 0) {
				return this.emptySnapshot(apiError("Invalid OpenDesign billing preflight response"));
			}
			return this.snapshot({ windows });
		} catch {
			return this.emptySnapshot(fetchFailed());
		}
	}

	private async fetchUsageWithKey(deps: Dependencies, apiKey: string): Promise<UsageSnapshot> {
		const { controller, clear } = createTimeoutController(API_TIMEOUT_MS);
		const headers = {
			Authorization: `Bearer ${apiKey}`,
			Accept: "application/json",
		};

		try {
			for (const url of [OPENDESIGN_LINK_USAGE_URL, OPENDESIGN_BILLING_SUMMARY_URL]) {
				const res = await deps.fetch(url, { method: "GET", headers, signal: controller.signal });
				if (res.status === 401 || res.status === 403) {
					clear();
					return this.emptySnapshot(httpError(res.status));
				}
				if (!res.ok) {
					continue;
				}

				const text = await res.text();
				const windows =
					url === OPENDESIGN_LINK_USAGE_URL
						? parseLinkUsageJson(text)
						: parseBillingResponseJson(text);
				clear();
				if (windows.length === 0) {
					return this.emptySnapshot(apiError("Invalid OpenDesign usage response"));
				}
				return this.snapshot({ windows });
			}

			clear();
			return this.emptySnapshot(httpError(404));
		} catch {
			clear();
			return this.emptySnapshot(fetchFailed());
		}
	}

	async fetchUsage(deps: Dependencies): Promise<UsageSnapshot> {
		const candidates = loadOpenDesignApiKeys(deps);
		const velaBinary = resolveVelaBinary(deps);
		const workspaceId = await resolveWorkspaceId(deps);

		if (velaBinary) {
			if (!workspaceId) {
				if (!isVelaLoggedIn(deps, velaBinary)) {
					if (candidates.length === 0) {
						return this.emptySnapshot(notLoggedIn());
					}
				} else if (candidates.length === 0) {
					return this.emptySnapshot(
						apiError(
							"OpenDesign workspace id missing (set OPENDESIGN_WORKSPACE_ID or ~/.pi/agent/opendesign-workspace.json)"
						)
					);
				}
			} else {
				const velaResult = this.fetchUsageViaVela(deps, workspaceId);
				if (!velaResult.error) {
					return velaResult;
				}
				if (candidates.length === 0) {
					return velaResult;
				}
				// The Link key cannot read billing routes, so an auth error from it
				// would hide the Vela failure that names the real action to take.
				const keyResult = await this.fetchUsageWithKey(deps, candidates[0]);
				return isAuthError(keyResult.error) ? velaResult : keyResult;
			}
		}

		if (candidates.length === 0) {
			if (workspaceId && !velaBinary) {
				return this.emptySnapshot(noCli("vela"));
			}
			return this.emptySnapshot(noCredentials());
		}

		let lastResult: UsageSnapshot | undefined;
		for (let i = 0; i < candidates.length; i += 1) {
			const result = await this.fetchUsageWithKey(deps, candidates[i]);
			lastResult = result;
			if (!isAuthError(result.error) || i === candidates.length - 1) {
				return result;
			}
		}
		return lastResult ?? this.emptySnapshot(noCredentials());
	}
}
