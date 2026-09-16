import test from "node:test";
import assert from "node:assert/strict";
import { isRecord, normalizeCredentialString } from "../src/credentials.js";

test("isRecord accepts plain objects and rejects arrays and null", () => {
	assert.equal(isRecord({ key: "value" }), true);
	assert.equal(isRecord([]), false);
	assert.equal(isRecord(null), false);
	assert.equal(isRecord("text"), false);
});

test("normalizeCredentialString trims and rejects empty values", () => {
	assert.equal(normalizeCredentialString("  api-key  "), "api-key");
	assert.equal(normalizeCredentialString(""), undefined);
	assert.equal(normalizeCredentialString("   "), undefined);
	assert.equal(normalizeCredentialString(42), undefined);
});

test("normalizeCredentialString can reject command indirection values", () => {
	assert.equal(
		normalizeCredentialString("!op read openrouter", { rejectCommandPrefix: true }),
		undefined,
	);
	assert.equal(normalizeCredentialString("!op read openrouter"), "!op read openrouter");
});

test("normalizeCredentialString can reject newline-bearing secrets", () => {
	assert.equal(
		normalizeCredentialString("token\nsuffix", { rejectNewlines: true }),
		undefined,
	);
	assert.equal(normalizeCredentialString("token\nsuffix"), "token\nsuffix");
});

test("normalizeCredentialString combines openrouter and xai rejection rules", () => {
	const options = { rejectCommandPrefix: true, rejectNewlines: true };
	assert.equal(normalizeCredentialString(" oauth-token ", options), "oauth-token");
	assert.equal(normalizeCredentialString("!cmd", options), undefined);
	assert.equal(normalizeCredentialString("bad\nsuffix", options), undefined);
});
