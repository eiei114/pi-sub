import test from 'node:test';
import assert from 'node:assert/strict';
import { readScopedUsage } from '../src/usage/scoped-request.js';
import { getDefaultSettings } from '../src/settings-types.js';
import { createDeps } from './helpers.js';
import type { UsageProvider } from '../src/provider.js';
import { PROVIDERS, type ProviderName } from '../src/types.js';

const lifecycle = () => new AbortController();

test('an allowlisted identity without an installed adapter fails before credential resolution', async () => {
	const { deps } = createDeps();
	const registered = PROVIDERS.find((name) => name.toString() === 'xai');
	let calls = 0;
	const response = await readScopedUsage(
		{ provider: 'xai' },
		deps,
		getDefaultSettings(),
		lifecycle().signal,
		(name) => {
			calls++;
			return fixture(name);
		},
	);
	// Main has no xai adapter; this becomes an ordinary successful route after #66 lands.
	assert.equal(calls, registered ? 1 : 0);
	assert.equal(response?.error?.code, registered ? undefined : 'UNSUPPORTED_PROVIDER');
	assert.equal(response?.usage?.provider, registered);
});
const fixture = (name: ProviderName): UsageProvider => ({
	name,
	displayName: name,
	hasCredentials: () => true,
	fetchUsage: async () => ({
		provider: name,
		displayName: name,
		windows: [{ label: 'Week', usedPercent: 42 }],
	}),
});

test('scoped reads route exactly one base provider, preserve identity, and never infer aliases', async () => {
	const { deps } = createDeps();
	const settings = getDefaultSettings();
	for (const [provider, expected] of Object.entries({
		anthropic: 'anthropic',
		'github-copilot': 'copilot',
		zai: 'zai',
		openrouter: 'openrouter',
		'opencode-go': 'opencode',
	})) {
		const seen: string[] = [];
		const result = await readScopedUsage(
			{ provider },
			deps,
			settings,
			lifecycle().signal,
			(name) => {
				seen.push(name);
				return fixture(name);
			},
		);
		assert.deepEqual(seen, [expected]);
		assert.equal(result?.provider, provider);
		assert.equal(result?.version, 1);
		assert.equal(result?.usage?.provider, expected);
	}
	for (const provider of [
		'xai-2',
		'x-ai',
		'XAI',
		'openrouter-2',
		'anthropic-2',
		'opencode',
		'openai-codex',
		'constructor',
		'__proto__',
		'cursor',
		'command-code',
		'google',
	]) {
		const result = await readScopedUsage({ provider }, deps, settings, lifecycle().signal, () => {
			throw new Error('must not inspect credentials');
		});
		assert.equal(result?.error?.code, 'UNSUPPORTED_PROVIDER');
	}
});

test('disabled providers are rejected before credentials are inspected', async () => {
	const { deps } = createDeps();
	const settings = getDefaultSettings();
	settings.providers.openrouter.enabled = 'off';
	assert.equal(
		(
			await readScopedUsage({ provider: 'openrouter' }, deps, settings, lifecycle().signal, () => {
				throw new Error('unexpected');
			})
		)?.error?.code,
		'DISABLED',
	);
});

test('scoped failures contain only safe error codes, not provider secrets', async () => {
	const { deps } = createDeps();
	for (const kind of ['missing', 'throw', 'identity', 'error'] as const) {
		const result = await readScopedUsage(
			{ provider: 'openrouter' },
			deps,
			getDefaultSettings(),
			lifecycle().signal,
			(name) => ({
				...fixture(name),
				hasCredentials: () => kind !== 'missing',
				fetchUsage: async () => {
					if (kind === 'throw') throw new Error('secret credential');
					return {
						provider: kind === 'identity' ? 'zai' : name,
						displayName: name,
						windows: [],
						...(kind === 'error'
							? { error: { code: 'HTTP_ERROR' as const, message: 'secret credential' } }
							: {}),
					};
				},
			}),
		);
		assert.equal(result?.error?.code, kind === 'missing' ? 'NO_CREDENTIALS' : 'FETCH_FAILED');
		assert.ok(!JSON.stringify(result).includes('secret'));
	}
});

test('scoped fetch composes abort signals, blocks writes, and prohibits redirects', async () => {
	const calls: RequestInit[] = [];
	const { deps } = createDeps({
		fetch: async (_url, init) => {
			calls.push(init!);
			return Response.json({});
		},
	});
	const parent = lifecycle();
	const caller = lifecycle();
	const fetchAbort = lifecycle();
	await readScopedUsage(
		{ provider: 'openrouter', signal: caller.signal },
		deps,
		getDefaultSettings(),
		parent.signal,
		(name) => ({
			...fixture(name),
			fetchUsage: async (bounded) => {
				await bounded.fetch('https://example.invalid/quota', {
					signal: fetchAbort.signal,
					redirect: 'follow',
				});
				await assert.rejects(() =>
					bounded.fetch('https://example.invalid/spend', { method: 'POST' }),
				);
				return { provider: name, displayName: name, windows: [] };
			},
		}),
	);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].redirect, 'error');
	assert.notEqual(calls[0].signal, fetchAbort.signal);
	caller.abort();
	assert.equal(calls[0].signal?.aborted, true);
});

test('caller cancellation bounds even an adapter that ignores cancellation', async () => {
	const { deps } = createDeps();
	const caller = lifecycle();
	const pending = readScopedUsage(
		{ provider: 'openrouter', signal: caller.signal },
		deps,
		getDefaultSettings(),
		lifecycle().signal,
		(name) => ({ ...fixture(name), fetchUsage: () => new Promise(() => {}) }),
	);
	caller.abort();
	assert.equal((await pending)?.error?.code, 'CANCELLED');
});

test('lifecycle disposal cancels in-flight reads and pre-aborts before credentials', async () => {
	const { deps } = createDeps();
	const parent = lifecycle();
	const pending = readScopedUsage(
		{ provider: 'openrouter' },
		deps,
		getDefaultSettings(),
		parent.signal,
		(name) => ({ ...fixture(name), fetchUsage: () => new Promise(() => {}) }),
	);
	parent.abort();
	assert.equal((await pending)?.error?.code, 'CANCELLED');
	assert.equal(
		(
			await readScopedUsage(
				{ provider: 'openrouter' },
				deps,
				getDefaultSettings(),
				parent.signal,
				() => {
					throw new Error('never invoked');
				},
			)
		)?.error?.code,
		'CANCELLED',
	);
});

test('malformed requests do not resolve credentials', async () => {
	const { deps } = createDeps();
	for (const payload of [null, undefined, 1, {}, { provider: 1 }, { provider: 'x'.repeat(101) }])
		assert.equal(
			await readScopedUsage(payload, deps, getDefaultSettings(), lifecycle().signal),
			undefined,
		);
	assert.equal(
		(
			await readScopedUsage(
				{ provider: 'openrouter', signal: {} },
				deps,
				getDefaultSettings(),
				lifecycle().signal,
			)
		)?.error?.code,
		'CANCELLED',
	);
});

test('native keychain fallback receives a finite timeout and respects shorter existing bounds', async () => {
	const seen: number[] = [];
	const { deps } = createDeps({
		execFileSync: (_file, _args, options) => {
			seen.push(options?.timeout ?? 0);
			return '';
		},
	});
	const response = await readScopedUsage(
		{ provider: 'anthropic' },
		deps,
		getDefaultSettings(),
		lifecycle().signal,
	);
	assert.equal(response?.error?.code, 'NO_CREDENTIALS');
	assert.ok(seen.length > 0);
	assert.ok(seen.every((value) => value > 0 && value <= 5000));
	await readScopedUsage(
		{ provider: 'openrouter' },
		deps,
		getDefaultSettings(),
		lifecycle().signal,
		(name) => ({
			...fixture(name),
			hasCredentials: (bounded) => {
				bounded.execFileSync('security', [], { encoding: 'utf8', timeout: 50 });
				return false;
			},
		}),
	);
	assert.equal(seen.at(-1), 50);
});

test('synchronous credential work crossing the deadline cannot report success or missing credentials', async () => {
	const { deps } = createDeps();
	const now = Date.now;
	let elapsed = 0;
	Date.now = () => now() + elapsed;
	try {
		const response = await readScopedUsage(
			{ provider: 'openrouter' },
			deps,
			getDefaultSettings(),
			lifecycle().signal,
			(name) => ({
				...fixture(name),
				hasCredentials: () => {
					elapsed = 16000;
					return false;
				},
			}),
		);
		assert.equal(response?.error?.code, 'TIMEOUT');
	} finally {
		Date.now = now;
	}
});
