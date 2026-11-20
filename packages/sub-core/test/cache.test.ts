import { TEST_AGENT_DIR } from "./test-agent-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as path from "node:path";
import {
	CACHE_PATH,
	fetchWithCache,
	onCacheSnapshot,
	onCacheUpdate,
	readCache,
	updateCacheStatus,
	watchCacheUpdates,
} from "../src/cache.js";
import {
	getCacheLockPath,
	getLegacyAgentCacheLockPath,
	getLegacyAgentCachePath,
} from "../src/paths.js";

const LOCK_PATH = getCacheLockPath();
const LEGACY_AGENT_CACHE_PATH = getLegacyAgentCachePath();
const LEGACY_AGENT_LOCK_PATH = getLegacyAgentCacheLockPath();

function assertCachePathsUseTestAgentDir(): void {
	const expectedPaths = [
		[path.resolve(CACHE_PATH), path.resolve(TEST_AGENT_DIR, "cache", "sub-core", "cache.json")],
		[path.resolve(LOCK_PATH), path.resolve(TEST_AGENT_DIR, "cache", "sub-core", "cache.lock")],
		[path.resolve(LEGACY_AGENT_CACHE_PATH), path.resolve(TEST_AGENT_DIR, "pi-sub-core-cache.json")],
		[path.resolve(LEGACY_AGENT_LOCK_PATH), path.resolve(TEST_AGENT_DIR, "pi-sub-core-cache.lock")],
	];

	for (const [actualPath, expectedPath] of expectedPaths) {
		assert.equal(actualPath, expectedPath);
		const relativePath = path.relative(TEST_AGENT_DIR, actualPath);
		assert.notEqual(relativePath, "");
		assert.notEqual(relativePath, "..");
		assert.ok(!relativePath.startsWith(`..${path.sep}`));
		assert.ok(!path.isAbsolute(relativePath));
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withCacheFiles(fn: () => Promise<void> | void): Promise<void> {
	assertCachePathsUseTestAgentDir();
	const cacheDir = path.dirname(CACHE_PATH);
	fs.mkdirSync(cacheDir, { recursive: true });

	try {
		await fn();
	} finally {
		for (const filePath of [CACHE_PATH, LOCK_PATH, LEGACY_AGENT_CACHE_PATH, LEGACY_AGENT_LOCK_PATH]) {
			fs.rmSync(filePath, { force: true });
		}
	}
}

test("cache and migration paths use the temporary Pi agent directory", () => {
	assertCachePathsUseTestAgentDir();
});

test("readCache migrates legacy agent cache file", async () => {
	assertCachePathsUseTestAgentDir();
	await withCacheFiles(() => {
		const legacyValue = {
			anthropic: {
				fetchedAt: 456,
				usage: {
					provider: "anthropic",
					displayName: "Claude Plan",
					windows: [],
				},
			},
		};

		fs.mkdirSync(path.dirname(LEGACY_AGENT_CACHE_PATH), { recursive: true });
		fs.writeFileSync(LEGACY_AGENT_CACHE_PATH, JSON.stringify(legacyValue), "utf-8");

		const cache = readCache();
		assert.deepEqual(cache, legacyValue);
		assert.equal(cache.anthropic?.fetchedAt, 456);
		assert.ok(fs.existsSync(CACHE_PATH));
		assert.deepEqual(JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")), legacyValue);
		assert.equal(fs.existsSync(LEGACY_AGENT_CACHE_PATH), false);
	});
});

test("readCache recovers from truncated JSON", async () => {
	await withCacheFiles(() => {
		const cacheValue = {
			copilot: {
				fetchedAt: 123,
				usage: {
					provider: "copilot",
					displayName: "Copilot Plan",
					windows: [],
				},
			},
		};
		const corrupted = `${JSON.stringify(cacheValue)}garbage`;
		fs.writeFileSync(CACHE_PATH, corrupted, "utf-8");
		// Fast writes may share an mtime on Windows; ensure readCache sees this file update.
		const changedAt = new Date(Date.now() + 60_000);
		fs.utimesSync(CACHE_PATH, changedAt, changedAt);

		const cache = readCache();
		assert.equal(cache.copilot?.fetchedAt, 123);

		const repaired = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as typeof cacheValue;
		assert.ok(repaired.copilot);
	});
});

test("watchCacheUpdates waits for lock release", async () => {
	await withCacheFiles(async () => {
		fs.writeFileSync(CACHE_PATH, "{}", "utf-8");
		fs.writeFileSync(LOCK_PATH, String(Date.now()), "utf-8");

		const snapshots: Array<Record<string, unknown>> = [];
		const updates: Array<string> = [];
		const offSnapshot = onCacheSnapshot((cache) => snapshots.push(cache));
		const offUpdate = onCacheUpdate((provider) => updates.push(provider));
		const stop = watchCacheUpdates({ debounceMs: 5, pollIntervalMs: 20, lockRetryMs: 50 });

		const cacheValue = {
			copilot: {
				fetchedAt: Date.now(),
				usage: { provider: "copilot", displayName: "Copilot", windows: [] },
			},
		};
		fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheValue), "utf-8");

		await wait(40);
		assert.equal(snapshots.length, 0);

		fs.unlinkSync(LOCK_PATH);
		await wait(80);

		stop();
		offSnapshot();
		offUpdate();

		assert.ok(snapshots.length > 0);
		assert.ok(updates.includes("copilot"));
	});
});

test("fetchWithCache skips duplicate fetch when lock is unavailable", async () => {
	await withCacheFiles(async () => {
		if (fs.existsSync(CACHE_PATH)) {
			fs.unlinkSync(CACHE_PATH);
		}
		fs.writeFileSync(LOCK_PATH, JSON.stringify({ token: "other", acquiredAt: Date.now() }), "utf-8");
		const releaseTimer = setTimeout(() => {
			if (fs.existsSync(LOCK_PATH)) {
				fs.unlinkSync(LOCK_PATH);
			}
		}, 50);

		let fetchCalls = 0;
		const result = await fetchWithCache("copilot", 0, async () => {
			fetchCalls += 1;
			return {
				usage: {
					provider: "copilot" as const,
					displayName: "Copilot",
					windows: [],
				},
			};
		});
		clearTimeout(releaseTimer);

		assert.equal(fetchCalls, 0);
		assert.equal(result.usage, undefined);
	});
});

test("updateCacheStatus skips writes when lock is unavailable", async () => {
	await withCacheFiles(async () => {
		const initialCache = {
			copilot: {
				fetchedAt: 123,
				usage: {
					provider: "copilot",
					displayName: "Copilot",
					windows: [],
				},
				status: { indicator: "none" as const },
			},
		};
		fs.writeFileSync(CACHE_PATH, JSON.stringify(initialCache), "utf-8");
		fs.writeFileSync(LOCK_PATH, JSON.stringify({ token: "other", acquiredAt: Date.now() }), "utf-8");

		await updateCacheStatus("copilot", { indicator: "major" });

		const after = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as typeof initialCache;
		assert.equal(after.copilot.status?.indicator, "none");
	});
});
