import test from "node:test";
import assert from "node:assert/strict";
import { containsAllTokens, getModelMultiplier, normalizeTokens } from "../model-utils.js";

test("normalizeTokens lowercases and splits on non-alphanumeric boundaries", () => {
	assert.deepEqual(normalizeTokens("GPT-5.3-Codex-Spark"), ["gpt", "5", "3", "codex", "spark"]);
	assert.deepEqual(normalizeTokens("  Hello-World_123  "), ["hello", "world", "123"]);
	assert.deepEqual(normalizeTokens(""), []);
});

test("containsAllTokens matches non-empty token subsets without matching empty candidates", () => {
	assert.equal(containsAllTokens(["gpt", "5"], ["gpt", "5", "codex"]), true);
	assert.equal(containsAllTokens(["gpt", "6"], ["gpt", "5", "codex"]), false);
	assert.equal(containsAllTokens([], ["gpt", "5"]), false);
});

test("getModelMultiplier matches known models case-insensitively", () => {
	assert.equal(getModelMultiplier("GPT-4o"), 0);
	assert.equal(getModelMultiplier("gpt-4o"), 0);
	assert.equal(getModelMultiplier("claude-sonnet-4"), 1);
	assert.equal(getModelMultiplier("Claude Sonnet 4.5"), 1);
});

test("getModelMultiplier prefers the longest matching label", () => {
	assert.equal(getModelMultiplier("gpt-5.1-codex-mini"), 0.33);
	assert.equal(getModelMultiplier("gpt-5.1-codex"), 1);
});

test("getModelMultiplier returns undefined for unknown or empty ids", () => {
	assert.equal(getModelMultiplier("unknown-model"), undefined);
	assert.equal(getModelMultiplier(undefined), undefined);
	assert.equal(getModelMultiplier(""), undefined);
});
