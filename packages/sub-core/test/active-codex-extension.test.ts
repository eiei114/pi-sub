import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import createExtension from "../index.js";
import { createDeps } from "./helpers.js";
import { getStorage, setStorage } from "../src/storage.js";
import { CACHE_PATH, clearCache, updateCacheStatus } from "../src/cache.js";

test("extension events keep current usage account-scoped across shared cache and model changes", async () => {
	const original = getStorage();
	const files = new Map<string, string>();
	setStorage({ readFile: (p) => files.get(p), exists: (p) => files.has(p),
		writeFile: (p, v) => { files.set(p, v); }, ensureDir: () => {}, removeFile: (p) => { files.delete(p); },
		writeFileExclusive: (p, v) => { if (files.has(p)) return false; files.set(p, v); return true; },
	});
	const bus = new EventEmitter();
	clearCache();
	const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
	const updates: Array<{ usage?: { displayName: string; windows: Array<{ usedPercent: number }> } }> = [];
	bus.on("sub-core:update-current", ({ state }) => updates.push(state));
	const { deps } = createDeps({ fetch: async (_url, init) => {
		const account = new Headers(init?.headers).get("chatgpt-account-id");
		return Response.json({ rate_limit: { primary_window: {
			used_percent: account === "openai-codex-2" ? 22 : 77, limit_window_seconds: 18000,
		} } });
	} });
	const ctx = { model: { provider: "openai-codex-2", id: "gpt-5.4" }, modelRegistry: {
		getApiKeyAndHeaders: async (model: { provider: string }) => ({ ok: true, apiKey: "opaque",
			headers: { "chatgpt-account-id": model.provider } }),
	} };
	try {
		createExtension({ events: { on: (e: string, f: (...args: unknown[]) => void) => {
			bus.on(e, f); return () => bus.off(e, f);
		}, emit: (e: string, p: unknown) => bus.emit(e, p) },
			on: (e: string, f: (event: unknown, ctx: unknown) => Promise<void>) => handlers.set(e, f),
			registerCommand: () => {}, registerTool: () => {},
		} as never, deps);
		await handlers.get("session_start")!({}, ctx);
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(updates.at(-1)?.usage?.windows[0].usedPercent, 22);
		files.set(CACHE_PATH, JSON.stringify({ codex: { fetchedAt: Date.now(), usage: {
			provider: "codex", displayName: "WRONG BASE", windows: [{ label: "5h", usedPercent: 99 }],
		} } }));
		await updateCacheStatus("codex", { indicator: "none" });
		assert.equal(updates.at(-1)?.usage?.windows[0].usedPercent, 22);
		ctx.model = { provider: "openai-codex-3", id: "gpt-5.4" };
		await handlers.get("model_select")!({}, ctx);
		assert.equal(updates.at(-1)?.usage, undefined);
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(updates.at(-1)?.usage?.windows[0].usedPercent, 77);
		assert.ok(updates.every((state) => state.usage?.displayName !== "WRONG BASE"));
		await handlers.get("session_shutdown")!({}, ctx);
		handlers.delete("session_shutdown");
		for (const event of ["sub-core:request", "sub-core:action", "sub-core:settings:patch"]) {
			assert.equal(bus.listenerCount(event), 0, `shutdown unsubscribes ${event}`);
		}
		Object.defineProperty(ctx, "model", { get() { throw new Error("stale context"); } });
		await handlers.get("turn_end")!({}, ctx);
		bus.emit("sub-core:action", { type: "refresh", force: true });
		bus.emit("sub-core:settings:patch", { patch: { behavior: { refreshInterval: 1 } } });
	} finally {
		await handlers.get("session_shutdown")?.({}, ctx);
		clearCache();
		setStorage(original);
	}
});
