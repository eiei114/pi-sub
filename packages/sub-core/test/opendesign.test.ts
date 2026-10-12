import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { OpenDesignProvider } from "../src/providers/impl/opendesign.js";
import {
	labelForCodingPlanDuration,
	parseBillingPreflightJson,
	parseLinkUsageJson,
} from "../src/providers/impl/opendesign-parse.js";
import { parseWorkspaceListJson } from "../src/providers/impl/opendesign-vela.js";
import { createDeps, createJsonResponse, getAuthPath } from "./helpers.js";
import {
	OPENDESIGN_BILLING_SUMMARY_URL,
	OPENDESIGN_LINK_USAGE_URL,
} from "../src/config.js";

const PREFLIGHT_FIXTURE = {
	schemaVersion: 1,
	workspaceId: "ws-test",
	workspaceMemberId: "member-test",
	modelId: null,
	generatedAt: "2026-10-12T00:00:00.000Z",
	balanceUsd: "0.00",
	modelCovered: true,
	funding: "coding_plan",
	codingPlan: {
		workspaceId: "ws-test",
		generatedAt: "2026-10-12T00:00:00.000Z",
		eligible: true,
		tier: "go",
		windows: [
			{
				policyId: "five-hour",
				durationSeconds: 18_000,
				resetMode: "activity_triggered",
				usedCredits: "10",
				limitCredits: "100",
				remainingCredits: "90",
				windowStart: null,
				resetsAt: "2099-01-01T00:00:00.000Z",
			},
			{
				policyId: "weekly",
				durationSeconds: 604_800,
				resetMode: "anchored_recurring",
				usedCredits: "5",
				limitCredits: "50",
				remainingCredits: "45",
				windowStart: null,
				resetsAt: null,
			},
		],
	},
};

test("labelForCodingPlanDuration maps Go plan windows", () => {
	assert.equal(labelForCodingPlanDuration(18_000), "5h");
	assert.equal(labelForCodingPlanDuration(604_800), "Week");
});

test("parseBillingPreflightJson maps credit windows to used percent", () => {
	const windows = parseBillingPreflightJson(JSON.stringify(PREFLIGHT_FIXTURE));
	assert.equal(windows.length, 2);
	assert.equal(windows[0]?.label, "5h");
	assert.equal(windows[0]?.usedPercent, 10);
	assert.equal(windows[1]?.label, "Week");
	assert.equal(windows[1]?.usedPercent, 10);
});

test("parseWorkspaceListJson prefers the personal workspace", () => {
	const id = parseWorkspaceListJson(
		JSON.stringify({
			items: [
				{
					workspaceId: "team-ws",
					workspaceType: "team",
					memberStatus: "active",
					lifecycleState: "active",
				},
				{
					workspaceId: "personal-ws",
					workspaceType: "personal",
					memberStatus: "active",
					lifecycleState: "active",
				},
			],
		})
	);
	assert.equal(id, "personal-ws");
});

test("parseLinkUsageJson accepts OpenCode-shaped link usage", () => {
	const windows = parseLinkUsageJson(
		JSON.stringify({
			usage: {
				rolling: { percent: 42, resetsAt: "2099-01-01T00:00:00.000Z" },
				weekly: { percent: 7 },
			},
		})
	);
	assert.equal(windows.length, 2);
	assert.equal(windows[0]?.label, "5h");
	assert.equal(windows[0]?.usedPercent, 42);
});

test("opendesign reads key from pi auth.json", async () => {
	const provider = new OpenDesignProvider();
	const urls: string[] = [];

	const { deps, files } = createDeps({
		fetch: async (url) => {
			urls.push(String(url));
			if (String(url) === OPENDESIGN_LINK_USAGE_URL) {
				return createJsonResponse({}, { ok: false, status: 404 });
			}
			return createJsonResponse({ preflight: PREFLIGHT_FIXTURE });
		},
	});
	files.set(
		getAuthPath(deps.homedir()),
		JSON.stringify({ opendesign: { type: "api_key", key: "sk-amr-test" } })
	);

	const usage = await provider.fetchUsage(deps);
	assert.ok(!usage.error, usage.error?.message);
	assert.equal(usage.windows.find((w) => w.label === "5h")?.usedPercent, 10);
	assert.ok(urls.includes(OPENDESIGN_BILLING_SUMMARY_URL));
});

test("opendesign reports http auth errors for link keys", async () => {
	const provider = new OpenDesignProvider();
	const { deps, files } = createDeps({
		fetch: async () =>
			createJsonResponse({ error: "unauthenticated" }, { ok: false, status: 401 }),
	});
	files.set(
		getAuthPath(deps.homedir()),
		JSON.stringify({ opendesign: { type: "api_key", key: "sk-amr-test" } })
	);

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "HTTP_ERROR");
	assert.equal(usage.error?.httpStatus, 401);
});

test("opendesign uses vela preflight when workspace id is configured", async () => {
	const provider = new OpenDesignProvider();
	const home = "/home/test";
	const workspaceFile = path.join(home, ".pi", "agent", "opendesign-workspace.json");

	const { deps, files } = createDeps({
		homedir: home,
		fetch: async () => createJsonResponse({}, { ok: false, status: 500 }),
		execFileSync: (file, args) => {
			if (file === "which" && args[0] === "vela") {
				return "/usr/bin/vela\n";
			}
			if (file === "/usr/bin/vela" && args[0] === "whoami") {
				return "user@test\n";
			}
			throw new Error(`unexpected execFileSync ${file} ${args.join(" ")}`);
		},
		execFileSyncWithStderr: (file, args) => {
			assert.equal(file, "/usr/bin/vela");
			assert.deepEqual(args, [
				"billing",
				"preflight",
				"--workspace-id",
				"ws-test",
				"--format",
				"json",
			]);
			return { stdout: JSON.stringify(PREFLIGHT_FIXTURE), stderr: "" };
		},
	});
	files.set(workspaceFile, JSON.stringify({ workspaceId: "ws-test" }));

	const usage = await provider.fetchUsage(deps);
	assert.ok(!usage.error, usage.error?.message);
	assert.equal(usage.windows.length, 2);
});

test("opendesign reports not logged in when vela has no session", async () => {
	const provider = new OpenDesignProvider();
	const { deps } = createDeps({
		fetch: async () => createJsonResponse({}, { ok: false, status: 500 }),
		execFileSync: (file, args) => {
			if (file === "which" && args[0] === "vela") {
				return "/usr/bin/vela\n";
			}
			if (file === "/usr/bin/vela" && args[0] === "whoami") {
				throw new Error('profile "prod" is not logged in; run `vela login`');
			}
			throw new Error(`unexpected execFileSync ${file} ${args.join(" ")}`);
		},
	});
	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "NOT_LOGGED_IN");
});

test("opendesign keeps the Vela failure when the Link key only gets a 401", async () => {
	const provider = new OpenDesignProvider();
	const home = "/home/test";
	const workspaceFile = path.join(home, ".pi", "agent", "opendesign-workspace.json");

	const { deps, files } = createDeps({
		homedir: home,
		fetch: async () => createJsonResponse({ error: "unauthenticated" }, { ok: false, status: 401 }),
		execFileSync: (file, args) => {
			if (file === "which" && args[0] === "vela") {
				return "/usr/bin/vela\n";
			}
			if (file === "/usr/bin/vela" && args[0] === "whoami") {
				throw new Error('profile "prod" is not logged in; run `vela login`');
			}
			throw new Error(`unexpected execFileSync ${file} ${args.join(" ")}`);
		},
	});
	files.set(workspaceFile, JSON.stringify({ workspaceId: "ws-test" }));
	files.set(
		getAuthPath(home),
		JSON.stringify({ opendesign: { type: "api_key", key: "sk-amr-test" } })
	);

	const usage = await provider.fetchUsage(deps);
	// The Link key can never read billing routes, so its 401 must not replace the
	// Vela error that tells the user to run `vela login`.
	assert.equal(usage.error?.code, "NOT_LOGGED_IN");
});

test("opendesign reports missing credentials", async () => {
	const provider = new OpenDesignProvider();
	const { deps } = createDeps({
		fetch: async () => createJsonResponse({}),
	});
	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "NO_CREDENTIALS");
});
