import test from "node:test";
import assert from "node:assert/strict";
import { hasUsableUsageData } from "../src/usage/usable.js";
import type { UsageSnapshot } from "../src/types.js";

function emptySnapshot(extra?: Partial<UsageSnapshot>): UsageSnapshot {
	return {
		provider: "openrouter",
		displayName: "OpenRouter",
		windows: [],
		...extra,
	};
}

test("snapshots without windows or amounts carry no usable data", () => {
	assert.equal(hasUsableUsageData(undefined), false);
	assert.equal(hasUsableUsageData(emptySnapshot()), false);
	assert.equal(
		hasUsableUsageData(emptySnapshot({ error: { code: "NO_CREDENTIALS", message: "No credentials found" } })),
		false,
	);
});

test("a window makes a snapshot usable", () => {
	assert.equal(
		hasUsableUsageData(emptySnapshot({ windows: [{ label: "Key limit", usedPercent: 40 }] })),
		true,
	);
});

test("an uncapped openrouter key is usable without any window", () => {
	// `limit: null` plus a spend total is the whole answer for such a key.
	assert.equal(hasUsableUsageData(emptySnapshot({ keyLimit: null, keyUsage: 4.2 })), true);
	assert.equal(hasUsableUsageData(emptySnapshot({ keyUsage: 0 })), true);
	assert.equal(hasUsableUsageData(emptySnapshot({ keyRemaining: 0 })), true);
});

test("account credit and request amounts keep a window-less snapshot usable", () => {
	assert.equal(hasUsableUsageData(emptySnapshot({ creditRemaining: 0 })), true);
	assert.equal(hasUsableUsageData(emptySnapshot({ creditTotal: 0 })), true);
	assert.equal(hasUsableUsageData(emptySnapshot({ creditUsage: 0 })), true);
	assert.equal(hasUsableUsageData(emptySnapshot({ requestsRemaining: 0 })), true);
	assert.equal(hasUsableUsageData(emptySnapshot({ requestsSummary: "free 3" })), true);
});

test("an unavailable wallet alone is not usable data", () => {
	// creditUnavailable states that nothing could be read, so it must not make
	// an otherwise empty snapshot look like it has something to show.
	assert.equal(hasUsableUsageData(emptySnapshot({ creditUnavailable: true })), false);
});
