import { MODEL_MULTIPLIERS } from "./model-multipliers.js";

/**
 * Normalize a string into tokens for fuzzy matching.
 */
export function normalizeTokens(value: string): string[] {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter(Boolean);
}

/** Return whether every candidate token appears in the available tokens. */
export function containsAllTokens(candidateTokens: string[], availableTokens: string[]): boolean {
	return candidateTokens.length > 0 && candidateTokens.every((token) => availableTokens.includes(token));
}

const MODEL_MULTIPLIER_TOKENS = Object.entries(MODEL_MULTIPLIERS).map(([label, multiplier]) => ({
	label,
	multiplier,
	tokens: normalizeTokens(label),
}));

/**
 * Get the request multiplier for a model ID.
 * Uses fuzzy matching against known model names.
 */
export function getModelMultiplier(modelId: string | undefined): number | undefined {
	if (!modelId) return undefined;
	const modelTokens = normalizeTokens(modelId);
	if (modelTokens.length === 0) return undefined;

	let bestMatch: { multiplier: number; tokenCount: number } | undefined;
	for (const entry of MODEL_MULTIPLIER_TOKENS) {
		const isMatch = containsAllTokens(entry.tokens, modelTokens);
		if (!isMatch) continue;
		const tokenCount = entry.tokens.length;
		if (!bestMatch || tokenCount > bestMatch.tokenCount) {
			bestMatch = { multiplier: entry.multiplier, tokenCount };
		}
	}

	return bestMatch?.multiplier;
}
