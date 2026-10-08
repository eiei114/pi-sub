import test from "node:test";
import assert from "node:assert/strict";
import { detectProviderFromModel } from "../src/providers/detection.js";


test("detectProviderFromModel prefers provider tokens over model tokens", () => {
	const provider = detectProviderFromModel({ provider: "OpenAI", id: "claude-3-opus" });
	assert.equal(provider, "codex");
});

test("detectProviderFromModel is case-insensitive", () => {
	const provider = detectProviderFromModel({ provider: "GITHUB", id: "copilot" });
	assert.equal(provider, "copilot");
});

test("detectProviderFromModel falls back to model tokens", () => {
	const provider = detectProviderFromModel({ id: "claude-3.5-sonnet" });
	assert.equal(provider, "anthropic");
});

test("detectProviderFromModel handles overlapping provider tokens", () => {
	const provider = detectProviderFromModel({ provider: "z.ai", id: "model" });
	assert.equal(provider, "zai");
});

test("detectProviderFromModel detects openrouter by provider", () => {
	const provider = detectProviderFromModel({ provider: "openrouter", id: "openrouter/auto" });
	assert.equal(provider, "openrouter");
});

test("detectProviderFromModel detects openrouter case-insensitively", () => {
	const provider = detectProviderFromModel({ provider: "OpenRouter", id: "meta-llama" });
	assert.equal(provider, "openrouter");
});

test("detectProviderFromModel detects cursor by provider", () => {
	const provider = detectProviderFromModel({ provider: "cursor", id: "composer" });
	assert.equal(provider, "cursor");
});

test("detectProviderFromModel detects opencode by provider", () => {
	const provider = detectProviderFromModel({ provider: "opencode", id: "opencode/auto" });
	assert.equal(provider, "opencode");
});

test("base and non-numbered OpenCode provider ids show the OpenCode Go usage", () => {
	assert.equal(detectProviderFromModel({ provider: "opencode", id: "glm-5.3" }), "opencode");
	assert.equal(detectProviderFromModel({ provider: "opencode-go", id: "glm-5.3" }), "opencode");
	assert.equal(detectProviderFromModel({ provider: "OpenCode-Go", id: "kimi-k3" }), "opencode");
	// Only numbered ids are aliases: a custom id may reuse the base key.
	assert.equal(detectProviderFromModel({ provider: "opencode-go-work", id: "gpt-6-luna" }), "opencode");
});

test("numbered OpenCode aliases resolve to no provider instead of the base account", () => {
	// The usage is read with the base credential only; a numbered alias such as
	// `opencode-go-2` holds another account's key and must not borrow the base
	// account's quota, nor fall through to model tokens (`gpt-6-luna` would read
	// as Codex).
	for (const provider of ["opencode-go-2", "opencode-go2", "opencode-2", "opencode3"]) {
		for (const id of ["glm-5.3", "gpt-6-luna"]) {
			assert.equal(detectProviderFromModel({ provider, id }), undefined, `${provider}/${id}`);
		}
	}
});

test("detectProviderFromModel detects command-code by provider", () => {
	const provider = detectProviderFromModel({ provider: "command-code", id: "auto" });
	assert.equal(provider, "command-code");
});

test("xAI is not z.ai and must not display its unrelated quota", () => {
	for (const provider of ["xai", "XAI"]) {
		assert.equal(detectProviderFromModel({ provider, id: "grok-code-fast-1" }), "xai");
	}
	for (const provider of ["zai", "z.ai", "ZAI", "zai-2"]) {
		assert.equal(detectProviderFromModel({ provider, id: "glm-5" }), "zai");
	}
});

test("numbered xAI aliases resolve to no provider instead of the base account", () => {
	// Only the base `xai` auth entry can be read, so an alias account must not
	// borrow the base account's subscription quota.
	for (const provider of ["xai-2", "xai2", "xai-work", "x-ai-2", "x-ai", "x.ai"]) {
		assert.equal(detectProviderFromModel({ provider, id: "grok-code-fast-1" }), undefined);
	}
});

test("grok models routed through other providers are not detected as xAI", () => {
	assert.equal(
		detectProviderFromModel({ provider: "openrouter", id: "x-ai/grok-code-fast-1" }),
		"openrouter",
	);
	assert.equal(detectProviderFromModel({ provider: "google", id: "gemini-3-pro" }), "gemini");
	// An unknown provider serving a grok model stays unknown: xAI is only
	// detected from the provider id, never from the model id.
	assert.equal(detectProviderFromModel({ provider: "someproxy", id: "grok-4" }), undefined);
});
