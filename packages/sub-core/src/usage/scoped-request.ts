/** Selective base-provider reads: no selection, shared cache, broadcasts or status polling. */
import type { ScopedUsageResponse } from '@eiei114/pi-sub-shared';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { PROVIDERS, type Dependencies, type ProviderName, type UsageSnapshot } from '../types.js';
import type { Settings } from '../settings-types.js';
import { createProvider } from '../providers/registry.js';
import type { UsageProvider } from '../provider.js';

const IDENTITIES: Readonly<Record<string, string>> = Object.freeze({
	anthropic: 'anthropic',
	'github-copilot': 'copilot',
	zai: 'zai',
	openrouter: 'openrouter',
	'opencode-go': 'opencode',
	xai: 'xai',
});

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

export async function readScopedUsage(
	payload: unknown,
	deps: Dependencies,
	settings: Settings,
	lifecycle: AbortSignal,
	factory: (provider: ProviderName) => UsageProvider = createProvider,
): Promise<ScopedUsageResponse | undefined> {
	if (!payload || typeof payload !== 'object') return undefined;
	const request = payload as { provider?: unknown; signal?: unknown };
	if (typeof request.provider !== 'string' || request.provider.length > 100) return undefined;
	const provider = request.provider;
	const error = (code: NonNullable<ScopedUsageResponse['error']>['code']): ScopedUsageResponse => ({
		version: 1,
		provider,
		error: { code },
	});
	// Own-property membership prevents aliases and prototype keys from resolving credentials.
	if (!Object.hasOwn(IDENTITIES, provider)) return error('UNSUPPORTED_PROVIDER');
	// The allowlist can name a future adapter without asserting that this installation has it.
	const name = PROVIDERS.find((candidate) => candidate === IDENTITIES[provider]);
	if (!name) return error('UNSUPPORTED_PROVIDER');
	if (settings.providers[name]?.enabled === 'off' || settings.providers[name]?.enabled === false)
		return error('DISABLED');
	if (request.signal !== undefined && !(request.signal instanceof AbortSignal))
		return error('CANCELLED');
	const timeout = AbortSignal.timeout(15_000);
	const deadline = Date.now() + 15_000;
	const signal = AbortSignal.any([
		lifecycle,
		timeout,
		...(request.signal ? [request.signal as AbortSignal] : []),
	]);
	const check = () => {
		signal.throwIfAborted();
		if (Date.now() >= deadline) throw new Error('Deadline elapsed');
	};
	const commandOptions = (
		options?: ExecFileSyncOptionsWithStringEncoding,
	): ExecFileSyncOptionsWithStringEncoding => {
		check();
		return {
			...options,
			encoding: options?.encoding ?? 'utf8',
			timeout: Math.max(
				1,
				Math.min(
					5000,
					deadline - Date.now(),
					options?.timeout && options.timeout > 0 ? options.timeout : 5000,
				),
			),
		};
	};
	try {
		check();
		const adapter = factory(name);
		const bounded: Dependencies = {
			...deps,
			execFileSync: (file, args, options) => deps.execFileSync(file, args, commandOptions(options)),
			execFileSyncWithStderr: (file, args, options) =>
				deps.execFileSyncWithStderr(file, args, commandOptions(options)),
			fetch: async (input, init) => {
				check();
				const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
				if (method.toUpperCase() !== 'GET') throw new Error('Read-only usage request');
				const original = init?.signal ?? (input instanceof Request ? input.signal : undefined);
				return deps.fetch(input, {
					...init,
					redirect: 'error',
					signal: original ? AbortSignal.any([signal, original]) : signal,
				});
			},
		};
		const hasCredentials = !adapter.hasCredentials || adapter.hasCredentials(bounded);
		check();
		if (!hasCredentials) return error('NO_CREDENTIALS');
		const usage: UsageSnapshot = await withAbort(adapter.fetchUsage(bounded), signal);
		check();
		if (usage.provider !== name) return error('FETCH_FAILED');
		if (usage.error) {
			const code = usage.error.code;
			return error(
				code === 'NO_CREDENTIALS' || code === 'NOT_LOGGED_IN' ? 'NO_CREDENTIALS' : 'FETCH_FAILED',
			);
		}
		return { version: 1, provider, usage };
	} catch {
		return error(
			timeout.aborted || Date.now() >= deadline
				? 'TIMEOUT'
				: signal.aborted
					? 'CANCELLED'
					: 'FETCH_FAILED',
		);
	}
}
