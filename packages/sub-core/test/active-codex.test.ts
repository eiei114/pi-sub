import test from "node:test";
import assert from "node:assert/strict";
import { createActiveCodexUsage } from "../src/usage/active-codex.js";
import { createDeps, createJsonResponse } from "./helpers.js";
import type { UsageSnapshot } from "../src/types.js";

function ctx(provider: string, account = provider) {
	return {
		model: { provider, id: "gpt-5.4" },
		modelRegistry: { getApiKeyAndHeaders: async (model: { provider: string }) => {
			assert.equal(model.provider, provider);
			return { ok: true, apiKey: `x.${Buffer.from(JSON.stringify({
				"https://api.openai.com/auth": { chatgpt_account_id: account },
			})).toString("base64url")}.x` };
		} },
	};
}
const response = (used: number) => createJsonResponse({ rate_limit: {
	primary_window: { used_percent: used, limit_window_seconds: 18000 },
} });

test("active Codex uses resolved alias credentials, never legacy auth files or environment overrides", async () => {
	const accounts: string[] = [];
	const { deps } = createDeps({ fetch: async (_url, init) => {
		const headers = new Headers(init?.headers);
		accounts.push(headers.get("chatgpt-account-id")!);
		return response(accounts.at(-1) === "openai-codex-2" ? 20 : 80);
	} });
	deps.readFile = () => assert.fail("must not read global credentials/cache");
	deps.env.OPENAI_CODEX_ACCESS_TOKEN = "wrong-base-account";
	const active = createActiveCodexUsage(deps);
	const updates: Array<UsageSnapshot | undefined> = [];
	await active.refresh(ctx("openai-codex-2") as never, 60000, 1000, (usage) => updates.push(usage));
	assert.equal(updates.at(-1)?.windows[0].usedPercent, 20);
	assert.match(updates.at(-1)!.displayName, /openai-codex-2/);
	await active.refresh(ctx("openai-codex-2") as never, 60000, 1000, () => {});
	assert.equal(accounts.length, 1, "same account uses session cache");
	updates.length = 0;
	await active.refresh(ctx("openai-codex-3") as never, 60000, 1000, (usage) => updates.push(usage));
	assert.equal(updates[0], undefined, "old account clears synchronously");
	assert.equal(updates.at(-1)?.windows[0].usedPercent, 80);
	assert.deepEqual(accounts, ["openai-codex-2", "openai-codex-3"]);
});

test("late responses cannot overwrite the new account; shutdown clear also invalidates pending work", async () => {
	let release!: (value: Response) => void;
	const { deps } = createDeps({ fetch: async (_url, init) =>
		new Headers(init?.headers).get("chatgpt-account-id") === "A"
			? new Promise<Response>((resolve) => { release = resolve; }) : response(70),
	});
	const active = createActiveCodexUsage(deps);
	const updates: Array<UsageSnapshot | undefined> = [];
	const slow = active.refresh(ctx("openai-codex-2", "A") as never, 0, 0, (usage) => updates.push(usage));
	await new Promise((resolve) => setImmediate(resolve));
	await active.refresh(ctx("openai-codex-3", "B") as never, 0, 0, (usage) => updates.push(usage));
	release(response(10));
	await slow;
	assert.equal(updates.at(-1)?.windows[0].usedPercent, 70);
	assert.match(active.usage!.displayName, /openai-codex-3/);
	const pending = active.refresh(ctx("openai-codex-2", "A") as never, 0, 0, (usage) => updates.push(usage));
	await new Promise((resolve) => setImmediate(resolve));
	active.clear();
	const count = updates.length;
	release(response(10));
	await pending;
	assert.equal(updates.length, count);
	assert.equal(active.usage, undefined);
});

test("same alias re-login invalidates cached quota and failed auth never falls back", async () => {
	let calls = 0;
	const { deps } = createDeps({ fetch: async () => { calls++; return response(calls * 10); } });
	const active = createActiveCodexUsage(deps);
	await active.refresh(ctx("openai-codex", "old") as never, 60000, 60000, () => {});
	await active.refresh(ctx("openai-codex", "new") as never, 60000, 60000, () => {});
	assert.equal(calls, 2);
	const failed = ctx("openai-codex-2");
	failed.modelRegistry.getApiKeyAndHeaders = async () => { throw new Error("secret auth error"); };
	await active.refresh(failed as never, 60000, 60000, () => {});
	assert.equal(calls, 2);
	assert.equal(active.usage?.windows.length, 0);
	assert.doesNotMatch(JSON.stringify(active.usage), /secret/);
});

test("older Pi getApiKey host and explicit account headers are supported", async () => {
	const { deps } = createDeps({ fetch: async (_url, init) => {
		const headers = new Headers(init?.headers);
		assert.equal(headers.get("chatgpt-account-id"), "workspace");
		assert.equal(headers.get("authorization"), "Bearer opaque");
		return response(50);
	} });
	const active = createActiveCodexUsage(deps);
	await active.refresh({ model: { provider: "openai-codex-2", headers: { "ChatGPT-Account-Id": "workspace" } },
		modelRegistry: { getApiKey: async () => "opaque" },
	} as never, 0, 0, () => {});
	assert.equal(active.usage?.windows[0].usedPercent, 50);
});
