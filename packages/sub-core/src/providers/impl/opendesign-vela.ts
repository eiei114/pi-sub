/**
 * Vela CLI helpers for OpenDesign quota reads.
 */

import * as path from "node:path";
import type { Dependencies } from "../../types.js";
import { API_TIMEOUT_MS, CLI_TIMEOUT_MS, OPENDESIGN_WORKSPACES_URL } from "../../config.js";
import { isRecord, normalizeCredentialString } from "../../credentials.js";
import { execCliSync, execCliSyncWithStderr, whichSync } from "../../utils.js";

const VELA_CMD = "vela";

export function resolveVelaBinary(deps: Dependencies): string | null {
	const fromEnv = deps.env.OPENDESIGN_VELA_BIN?.trim() || deps.env.VELA_BIN?.trim();
	if (fromEnv) return fromEnv;
	return whichSync(VELA_CMD, deps);
}

export function isVelaLoggedIn(deps: Dependencies, velaBinary: string): boolean {
	try {
		execCliSync(deps, velaBinary, ["whoami"], {
			encoding: "utf-8",
			timeout: CLI_TIMEOUT_MS,
			env: deps.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return true;
	} catch {
		return false;
	}
}

export function runVelaBillingPreflight(
	deps: Dependencies,
	velaBinary: string,
	workspaceId: string,
	modelId?: string
): string {
	const args = ["billing", "preflight", "--workspace-id", workspaceId, "--format", "json"];
	const model = modelId?.trim();
	if (model) {
		args.push("--model", model);
	}
	const { stdout } = execCliSyncWithStderr(deps, velaBinary, args, {
		encoding: "utf-8",
		timeout: CLI_TIMEOUT_MS,
		env: deps.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	return stdout;
}

function workspaceFromAppConfig(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as {
			orbit?: { workspaceScope?: { workspaceId?: unknown } };
			workspaceScope?: { workspaceId?: unknown };
		};
		const fromOrbit = parsed.orbit?.workspaceScope?.workspaceId;
		if (typeof fromOrbit === "string" && fromOrbit.trim()) {
			return fromOrbit.trim();
		}
		const direct = parsed.workspaceScope?.workspaceId;
		if (typeof direct === "string" && direct.trim()) {
			return direct.trim();
		}
	} catch {
		return undefined;
	}
	return undefined;
}

/** Best-effort workspace id from OpenDesign desktop app-config.json (if installed). */
export function loadWorkspaceIdFromOpenDesignApp(deps: Dependencies): string | undefined {
	const candidates: string[] = [];
	const appData = deps.env.APPDATA;
	if (appData) {
		const roots = [
			path.join(appData, "Open Design Prerelease"),
			path.join(appData, "Open Design"),
		];
		for (const root of roots) {
			candidates.push(path.join(root, "data", "app-config.json"));
			candidates.push(path.join(root, "namespaces", "default", "data", "app-config.json"));
		}
	}

	const xdgConfig = deps.env.XDG_CONFIG_HOME || path.join(deps.homedir(), ".config");
	candidates.push(path.join(xdgConfig, "Open Design Prerelease", "data", "app-config.json"));
	candidates.push(
		path.join(deps.homedir(), "Library", "Application Support", "Open Design Prerelease", "data", "app-config.json")
	);

	for (const filePath of candidates) {
		if (!deps.fileExists(filePath)) continue;
		const workspaceId = workspaceFromAppConfig(deps.readFile(filePath));
		if (workspaceId) return workspaceId;
	}
	return undefined;
}

function amrConfigPath(deps: Dependencies): string {
	return path.join(deps.homedir(), ".amr", "config.json");
}

function amrProfileName(deps: Dependencies): string {
	const fromEnv = deps.env.VELA_PROFILE?.trim();
	return fromEnv || "prod";
}

/** Vela control key from `~/.amr/config.json` after `vela login` (never log this). */
export function loadAmrControlKey(deps: Dependencies): string | undefined {
	const configPath = amrConfigPath(deps);
	if (!deps.fileExists(configPath)) return undefined;
	try {
		const parsed = JSON.parse(deps.readFile(configPath) ?? "") as {
			profiles?: Record<string, { controlKey?: unknown; apiUrl?: unknown }>;
		};
		const profile = parsed.profiles?.[amrProfileName(deps)];
		return normalizeCredentialString(
			typeof profile?.controlKey === "string" ? profile.controlKey : undefined
		);
	} catch {
		return undefined;
	}
}

function amrApiBaseUrl(deps: Dependencies): string {
	const configPath = amrConfigPath(deps);
	if (deps.fileExists(configPath)) {
		try {
			const parsed = JSON.parse(deps.readFile(configPath) ?? "") as {
				profiles?: Record<string, { apiUrl?: unknown }>;
			};
			const apiUrl = parsed.profiles?.[amrProfileName(deps)]?.apiUrl;
			if (typeof apiUrl === "string" && apiUrl.trim()) {
				return apiUrl.trim().replace(/\/+$/, "");
			}
		} catch {
			// fall through
		}
	}
	const fromEnv = deps.env.VELA_API_URL?.trim();
	if (fromEnv) return fromEnv.replace(/\/+$/, "");
	return OPENDESIGN_WORKSPACES_URL.replace(/\/api\/v1\/workspaces$/, "");
}

export function parseWorkspaceListJson(text: string): string | undefined {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(data) || !Array.isArray(data.items)) return undefined;

	type Item = {
		workspaceId?: unknown;
		workspaceType?: unknown;
		memberStatus?: unknown;
		lifecycleState?: unknown;
	};
	const items = data.items as Item[];
	const active = items.filter(
		(item) =>
			typeof item.workspaceId === "string" &&
			item.workspaceId.trim() &&
			item.memberStatus === "active" &&
			item.lifecycleState === "active"
	);
	const personal = active.find((item) => item.workspaceType === "personal");
	const chosen = personal ?? active[0];
	return typeof chosen?.workspaceId === "string" ? chosen.workspaceId.trim() : undefined;
}

/** Personal/default workspace via `GET /api/v1/workspaces` and the Vela control key. */
export async function loadWorkspaceIdFromAmrWorkspaces(deps: Dependencies): Promise<string | undefined> {
	const controlKey = loadAmrControlKey(deps);
	if (!controlKey) return undefined;

	const url = `${amrApiBaseUrl(deps)}/api/v1/workspaces`;
	try {
		const res = await deps.fetch(url, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${controlKey}`,
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(API_TIMEOUT_MS),
		});
		if (!res.ok) return undefined;
		return parseWorkspaceListJson(await res.text());
	} catch {
		return undefined;
	}
}
