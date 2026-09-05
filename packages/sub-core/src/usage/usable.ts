/**
 * Shared rule for "does this snapshot carry data worth showing?".
 */

import type { UsageSnapshot } from "../types.js";

/**
 * Some providers report usable numbers without any percentage window — an
 * uncapped OpenRouter key has a spend total but no quota to draw a bar for — so
 * an empty `windows` array does not mean an empty snapshot.
 */
export function hasUsableUsageData(usage: UsageSnapshot | undefined): boolean {
	if (!usage) return false;
	if (usage.windows.length > 0) return true;
	return (
		usage.keyUsage !== undefined
		// `null` (uncapped) is a real answer, so presence is what matters here.
		|| usage.keyLimit !== undefined
		|| usage.keyRemaining !== undefined
		|| usage.creditTotal !== undefined
		|| usage.creditUsage !== undefined
		|| usage.creditRemaining !== undefined
		|| usage.requestsRemaining !== undefined
		|| usage.requestsEntitlement !== undefined
		|| Boolean(usage.requestsSummary)
	);
}
