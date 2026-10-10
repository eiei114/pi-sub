/**
 * Provider detection helpers.
 */

import type { ProviderName } from "../types.js";
import { PROVIDERS } from "../types.js";
import { PROVIDER_METADATA } from "./metadata.js";

interface ProviderDetectionHint {
	provider: ProviderName;
	providerTokens: string[];
	modelTokens: string[];
}

const PROVIDER_DETECTION_HINTS: ProviderDetectionHint[] = PROVIDERS.map((provider) => {
	const detection = PROVIDER_METADATA[provider].detection ?? { providerTokens: [], modelTokens: [] };
	return {
		provider,
		providerTokens: detection.providerTokens,
		modelTokens: detection.modelTokens,
	};
});

/**
 * xAI subscription usage is scoped to the single base `xai` credential in pi's
 * auth.json, so only the exact base provider id maps to the xAI provider.
 * Numbered aliases (`xai-2`, `xai2`, …) are separate accounts whose quota this
 * extension cannot read; they resolve to no provider instead of showing the
 * base account's usage.
 */
const XAI_PROVIDER_PREFIXES = ["xai", "x-ai", "x.ai"];
const XAI_BASE_PROVIDER_IDS = new Set(["xai"]);

/**
 * OpenCode Go usage is read with the base credential only
 * (OPENCODE_API_KEY/OPENCODE_GO_API_KEY, OPENCODE_AUTH_CONTENT, or the
 * `opencode-go` entry of OpenCode's or pi's auth.json). A numbered provider id
 * such as `opencode-go-2` (the `<provider>-<n>` naming of extra accounts) holds
 * another key whose quota this extension does not read; it resolves to no
 * provider instead of the base account's usage, and never falls through to
 * model tokens. Unlike the xAI rule this matches numbered ids only, so custom
 * ids that may reuse the base key (`opencode-go-work`) keep their usage.
 */
const OPENCODE_NUMBERED_ALIAS = /^opencode(?:-go)?-?\d+$/;

/**
 * Detect the provider from model metadata.
 */
export function detectProviderFromModel(
	model: { provider?: string; id?: string } | undefined
): ProviderName | undefined {
	if (!model) return undefined;
	const providerValue = model.provider?.toLowerCase() || "";
	const idValue = model.id?.toLowerCase() || "";

	if (OPENCODE_NUMBERED_ALIAS.test(providerValue)) {
		return undefined;
	}

	if (providerValue.includes("antigravity") || idValue.includes("antigravity")) {
		return "antigravity";
	}

	if (XAI_PROVIDER_PREFIXES.some((prefix) => providerValue.startsWith(prefix))) {
		return XAI_BASE_PROVIDER_IDS.has(providerValue) ? "xai" : undefined;
	}

	for (const hint of PROVIDER_DETECTION_HINTS) {
		if (hint.providerTokens.some((token) => providerValue.includes(token))) {
			return hint.provider;
		}
	}

	for (const hint of PROVIDER_DETECTION_HINTS) {
		if (hint.modelTokens.some((token) => idValue.includes(token))) {
			return hint.provider;
		}
	}

	return undefined;
}
