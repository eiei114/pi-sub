/**
 * Usage fetching helpers with cache integration.
 */

import type { Dependencies, ProviderName, ProviderStatus, UsageSnapshot } from "../types.js";
import type { Settings } from "../settings-types.js";
import type { ProviderUsageEntry } from "./types.js";
import { createProvider } from "../providers/registry.js";
import { fetchWithCache, getCachedData, readCache, updateCacheStatus, type Cache } from "../cache.js";
import { fetchProviderStatusWithFallback, providerHasStatus } from "../providers/status.js";
import { hasProviderCredentials } from "../providers/registry.js";
import { isExpectedMissingData } from "../errors.js";

export function getCacheTtlMs(settings: Settings): number {
	return settings.behavior.refreshInterval * 1000;
}

export function getMinRefreshIntervalMs(settings: Settings): number {
	return settings.behavior.minRefreshInterval * 1000;
}

export function getStatusCacheTtlMs(settings: Settings): number {
	return settings.statusRefresh.refreshInterval * 1000;
}

export function getStatusMinRefreshIntervalMs(settings: Settings): number {
	return settings.statusRefresh.minRefreshInterval * 1000;
}

const PROVIDER_FETCH_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	if (items.length === 0) return [];
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(limit, items.length);
	const workers = Array.from({ length: workerCount }, async () => {
		while (true) {
			const currentIndex = nextIndex++;
			if (currentIndex >= items.length) {
				return;
			}
			results[currentIndex] = await mapper(items[currentIndex], currentIndex);
		}
	});
	await Promise.all(workers);
	return results;
}

function resolveStatusFetchedAt(entry?: { fetchedAt: number; statusFetchedAt?: number } | null): number | undefined {
	if (!entry) return undefined;
	return entry.statusFetchedAt ?? entry.fetchedAt;
}

function isWithinMinInterval(fetchedAt: number | undefined, minIntervalMs: number): boolean {
	if (!fetchedAt || minIntervalMs <= 0) return false;
	return Date.now() - fetchedAt < minIntervalMs;
}

function shouldRefreshStatus(
	settings: Settings,
	entry?: { fetchedAt: number; statusFetchedAt?: number } | null,
	options?: { force?: boolean }
): boolean {
	const fetchedAt = resolveStatusFetchedAt(entry);
	const minIntervalMs = getStatusMinRefreshIntervalMs(settings);
	if (isWithinMinInterval(fetchedAt, minIntervalMs)) return false;
	if (options?.force) return true;
	const ttlMs = getStatusCacheTtlMs(settings);
	if (ttlMs <= 0) return true;
	if (!fetchedAt) return true;
	return Date.now() - fetchedAt >= ttlMs;
}

export async function refreshStatusForProvider(
	deps: Dependencies,
	settings: Settings,
	provider: ProviderName,
	options?: { force?: boolean }
): Promise<ProviderStatus | undefined> {
	const enabledSetting = settings.providers[provider].enabled;
	if (enabledSetting === "off" || enabledSetting === false) {
		return undefined;
	}
	if (enabledSetting === "auto" && !hasProviderCredentials(provider, deps)) {
		return undefined;
	}
	if (!settings.providers[provider].fetchStatus) {
		return undefined;
	}

	const cache = readCache();
	const entry = cache[provider];
	const providerInstance = createProvider(provider);
	const shouldFetch = providerHasStatus(provider, providerInstance) && shouldRefreshStatus(settings, entry, options);
	if (!shouldFetch) {
		return entry?.status;
	}
	const status = await fetchProviderStatusWithFallback(provider, providerInstance, deps);
	await updateCacheStatus(provider, status, { statusFetchedAt: Date.now() });
	return status;
}

export async function fetchUsageForProvider(
	deps: Dependencies,
	settings: Settings,
	provider: ProviderName,
	options?: { force?: boolean; forceStatus?: boolean }
): Promise<{ usage?: UsageSnapshot; status?: ProviderStatus }> {
	const enabledSetting = settings.providers[provider].enabled;
	if (enabledSetting === "off" || enabledSetting === false) {
		return {};
	}
	if (enabledSetting === "auto" && !hasProviderCredentials(provider, deps)) {
		return {};
	}

	const ttlMs = getCacheTtlMs(settings);
	const cache = readCache();
	const cachedEntry = cache[provider];
	const cachedStatus = cachedEntry?.status;
	const minIntervalMs = getMinRefreshIntervalMs(settings);
	if (cachedEntry?.usage && isWithinMinInterval(cachedEntry.fetchedAt, minIntervalMs)) {
		const usage = { ...cachedEntry.usage, status: cachedEntry.status } as UsageSnapshot;
		return { usage, status: cachedEntry.status };
	}
	const providerInstance = createProvider(provider);
	const shouldFetchStatus = Boolean(options?.forceStatus)
		&& settings.providers[provider].fetchStatus
		&& providerHasStatus(provider, providerInstance);

	if (!options?.force) {
		const cachedUsage = await getCachedData(provider, ttlMs, cache);
		if (cachedUsage) {
			let status = cachedUsage.status;
			if (shouldFetchStatus) {
				status = await refreshStatusForProvider(deps, settings, provider, { force: options?.forceStatus ?? options?.force });
			}
			const usage = cachedUsage.usage ? { ...cachedUsage.usage, status } : undefined;
			return { usage, status };
		}
	}

	return fetchWithCache(
		provider,
		ttlMs,
		async () => {
			const usage = await providerInstance.fetchUsage(deps);
			let status = cachedStatus;
			let statusFetchedAt = resolveStatusFetchedAt(cachedEntry);
			if (shouldFetchStatus) {
				status = await fetchProviderStatusWithFallback(provider, providerInstance, deps);
				statusFetchedAt = Date.now();
			} else if (!status) {
				status = { indicator: "none" as const };
			}

			return { usage, status, statusFetchedAt };
		},
		options,
	);
}

export async function getCachedUsageEntry(
	provider: ProviderName,
	settings: Settings,
	cacheSnapshot?: Cache
): Promise<ProviderUsageEntry | undefined> {
	const ttlMs = getCacheTtlMs(settings);
	const cachedEntry = await getCachedData(provider, ttlMs, cacheSnapshot);
	const usage = cachedEntry?.usage ? { ...cachedEntry.usage, status: cachedEntry.status } : undefined;
	if (!usage || (usage.error && isExpectedMissingData(usage.error))) {
		return undefined;
	}
	return { provider, usage };
}

export async function getCachedUsageEntries(
	providers: ProviderName[],
	settings: Settings
): Promise<ProviderUsageEntry[]> {
	const cache = readCache();
	const ttlMs = getCacheTtlMs(settings);
	const now = Date.now();
	const entries: ProviderUsageEntry[] = [];
	for (const provider of providers) {
		const cachedEntry = cache[provider];
		if (!cachedEntry || now - cachedEntry.fetchedAt >= ttlMs) continue;
		if (cachedEntry.usage?.error && !isExpectedMissingData(cachedEntry.usage.error)) continue;
		const usage = cachedEntry.usage
			? { ...cachedEntry.usage, status: cachedEntry.status }
			: undefined;
		if (!usage || (usage.error && isExpectedMissingData(usage.error))) continue;
		entries.push({ provider, usage });
	}
	return entries;
}

export async function fetchUsageEntries(
	deps: Dependencies,
	settings: Settings,
	providers: ProviderName[],
	options?: { force?: boolean }
): Promise<ProviderUsageEntry[]> {
	const concurrency = Math.max(1, Math.min(PROVIDER_FETCH_CONCURRENCY, providers.length));
	const results = await mapWithConcurrency(providers, concurrency, async (provider) => {
		const result = await fetchUsageForProvider(deps, settings, provider, options);
		const usage = result.usage
			? ({ ...result.usage, status: result.status } as UsageSnapshot)
			: undefined;
		if (!usage || (usage.error && isExpectedMissingData(usage.error))) {
			return undefined;
		}
		return { provider, usage } as ProviderUsageEntry;
	});
	return results.filter(Boolean) as ProviderUsageEntry[];
}
