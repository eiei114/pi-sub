/**
 * Provider registry - exports all providers
 */

export { AnthropicProvider } from "./impl/anthropic.js";
export { CopilotProvider } from "./impl/copilot.js";
export { GeminiProvider } from "./impl/gemini.js";
export { AntigravityProvider } from "./impl/antigravity.js";
export { CodexProvider } from "./impl/codex.js";
export { KiroProvider } from "./impl/kiro.js";
export { ZaiProvider } from "./impl/zai.js";
export { KimiCodingProvider } from "./impl/kimi-coding.js";
export { OpenRouterProvider } from "./impl/openrouter.js";
export { CursorProvider } from "./impl/cursor.js";
export { OpenCodeProvider } from "./impl/opencode.js";
export { CommandCodeProvider } from "./impl/command-code.js";
export { XaiProvider } from "./impl/xai.js";

import type { Dependencies, ProviderName } from "../types.js";
import type { UsageProvider } from "../provider.js";
import { PROVIDERS } from "./metadata.js";
import { AnthropicProvider } from "./impl/anthropic.js";
import { CopilotProvider } from "./impl/copilot.js";
import { GeminiProvider } from "./impl/gemini.js";
import { AntigravityProvider } from "./impl/antigravity.js";
import { CodexProvider } from "./impl/codex.js";
import { KiroProvider } from "./impl/kiro.js";
import { ZaiProvider } from "./impl/zai.js";
import { KimiCodingProvider } from "./impl/kimi-coding.js";
import { OpenRouterProvider } from "./impl/openrouter.js";
import { CursorProvider } from "./impl/cursor.js";
import { OpenCodeProvider } from "./impl/opencode.js";
import { CommandCodeProvider } from "./impl/command-code.js";
import { XaiProvider } from "./impl/xai.js";

const PROVIDER_FACTORIES: Record<ProviderName, () => UsageProvider> = {
	anthropic: () => new AnthropicProvider(),
	copilot: () => new CopilotProvider(),
	gemini: () => new GeminiProvider(),
	antigravity: () => new AntigravityProvider(),
	codex: () => new CodexProvider(),
	kiro: () => new KiroProvider(),
	zai: () => new ZaiProvider(),
	"kimi-coding": () => new KimiCodingProvider(),
	openrouter: () => new OpenRouterProvider(),
	cursor: () => new CursorProvider(),
	opencode: () => new OpenCodeProvider(),
	"command-code": () => new CommandCodeProvider(),
	xai: () => new XaiProvider(),
};

/**
 * Create a provider instance by name
 */
export function createProvider(name: ProviderName): UsageProvider {
	return PROVIDER_FACTORIES[name]();
}

/**
 * Get all provider instances
 */
export function getAllProviders(): UsageProvider[] {
	return PROVIDERS.map((name) => PROVIDER_FACTORIES[name]());
}

export function hasProviderCredentials(name: ProviderName, deps: Dependencies): boolean {
	const provider = createProvider(name);
	if (provider.hasCredentials) {
		return provider.hasCredentials(deps);
	}
	return true;
}
