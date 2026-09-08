import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import createExtension from '../index.js';
import { createDeps } from './helpers.js';
import { getStorage, setStorage } from '../src/storage.js';
import { CACHE_PATH, clearCache } from '../src/cache.js';
import { SETTINGS_PATH, clearSettingsCache } from '../src/settings.js';
import { getDefaultSettings } from '../src/settings-types.js';
import { SCOPED_USAGE_EVENT, type ScopedUsageResponse } from '@eiei114/pi-sub-shared';
import { OPENROUTER_CREDITS_URL, OPENROUTER_KEY_URL } from '../src/config.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function harness(initialSettings: unknown, fetch?: typeof globalThis.fetch) {
	const original = getStorage();
	const files = new Map([
		[SETTINGS_PATH, JSON.stringify(initialSettings)],
		[CACHE_PATH, '{}'],
	]);
	const reads: string[] = [];
	const mutations: string[] = [];
	setStorage({
		readFile: (p) => {
			reads.push(p);
			return files.get(p);
		},
		exists: (p) => {
			reads.push(p);
			return files.has(p);
		},
		writeFile: (p, value) => {
			mutations.push(`write ${p}`);
			files.set(p, value);
		},
		ensureDir: (p) => {
			mutations.push(`mkdir ${p}`);
		},
		removeFile: (p) => {
			mutations.push(`remove ${p}`);
			files.delete(p);
		},
		writeFileExclusive: (p, value) => {
			mutations.push(`exclusive ${p}`);
			files.set(p, value);
			return true;
		},
	});
	clearSettingsCache();
	clearCache();
	const bus = new EventEmitter();
	const broadcasts: string[] = [];
	const handlers = new Map<string, (event?: unknown, ctx?: unknown) => Promise<void>>();
	let scopedHandler: (payload: unknown) => Promise<void>;
	const { deps } = createDeps({ env: { OPENROUTER_API_KEY: 'synthetic-key' }, fetch });
	createExtension(
		{
			events: {
				on: (event: string, handler: (payload: unknown) => Promise<void>) => {
					bus.on(event, handler);
					if (event === SCOPED_USAGE_EVENT) scopedHandler = handler;
					return () => bus.off(event, handler);
				},
				emit: (event: string, payload: unknown) => {
					broadcasts.push(event);
					return bus.emit(event, payload);
				},
			},
			on: (event: string, handler: () => Promise<void>) => handlers.set(event, handler),
			registerCommand: () => {},
			registerTool: () => {},
			setModel: () => assert.fail('scoped read must not switch providers'),
		} as never,
		deps,
	);
	return {
		bus,
		files,
		reads,
		mutations,
		broadcasts,
		invoke: (payload: unknown) => scopedHandler(payload),
		async start() {
			await handlers.get('session_start')!({}, { model: undefined, hasUI: false });
			// Let the existing upstream startup watcher timer settle before the request assertions.
			await tick();
			reads.length = 0;
			mutations.length = 0;
			broadcasts.length = 0;
		},
		async shutdown() {
			await handlers.get('session_shutdown')?.();
			handlers.delete('session_shutdown');
		},
		async restore() {
			await this.shutdown();
			setStorage(original);
			clearSettingsCache();
			clearCache();
		},
	};
}

test('cold scoped events never migrate settings or clear cache and shutdown removes the listener', async () => {
	const h = harness({ version: 0 });
	// clearCache above belongs to fixture setup, not to the request.
	h.files.set(CACHE_PATH, '{}');
	h.mutations.length = 0;
	try {
		for (const provider of ['openai-codex', 'xai']) {
			const response = await new Promise<ScopedUsageResponse>((resolve) =>
				h.bus.emit(SCOPED_USAGE_EVENT, { provider, reply: resolve }),
			);
			assert.equal(response.provider, provider);
			assert.equal(response.error?.code, 'FETCH_FAILED');
			assert.deepEqual(h.mutations, []);
			assert.equal(h.files.get(SETTINGS_PATH), JSON.stringify({ version: 0 }));
			assert.equal(h.files.get(CACHE_PATH), '{}');
		}
		await h.shutdown();
		assert.equal(h.bus.listenerCount(SCOPED_USAGE_EVENT), 0);
		await h.invoke({
			provider: 'xai',
			reply: () => assert.fail('no late callback after disposal'),
		});
	} finally {
		await h.restore();
	}
});

test('initialized scoped events use the existing adapter without shared cache, broadcasts or selection', async () => {
	const calls: string[] = [];
	const settings = getDefaultSettings();
	settings.behavior.refreshInterval = 0;
	settings.statusRefresh.refreshInterval = 0;
	const h = harness(settings, async (url, init) => {
		const href = String(url);
		calls.push(href);
		assert.equal(init?.method, 'GET');
		assert.equal(init?.redirect, 'error');
		if (href === OPENROUTER_KEY_URL) {
			return Response.json({ data: { limit: null, usage: 3 } });
		}
		assert.equal(href, OPENROUTER_CREDITS_URL);
		return Response.json({ data: { total_credits: 10, total_usage: 3 } });
	});
	try {
		await h.start();
		const response = await new Promise<ScopedUsageResponse>((resolve) =>
			h.bus.emit(SCOPED_USAGE_EVENT, { provider: 'openrouter', reply: resolve }),
		);
		assert.equal(response.provider, 'openrouter');
		assert.equal(response.usage?.provider, 'openrouter');
		assert.equal(response.usage?.creditRemaining, 7);
		assert.deepEqual(calls, [OPENROUTER_KEY_URL, OPENROUTER_CREDITS_URL]);
		assert.deepEqual(h.reads, []);
		assert.deepEqual(h.mutations, []);
		assert.deepEqual(h.broadcasts, []);
		// Exceptions in consumer callbacks do not become unhandled listener failures.
		await h.invoke({
			provider: 'openrouter',
			reply: () => {
				throw new Error('consumer failed');
			},
		});
		await h.invoke({ provider: 'openrouter', reply: null });
		assert.equal(calls.length, 4);
	} finally {
		await h.restore();
	}
});

test('shutdown aborts the scoped transport and suppresses an in-flight or retained listener reply', async () => {
	let transportSignal: AbortSignal | null | undefined;
	let release: (response: Response) => void = () => assert.fail('transport not started');
	let replies = 0;
	const settings = getDefaultSettings();
	settings.behavior.refreshInterval = 0;
	settings.statusRefresh.refreshInterval = 0;
	const h = harness(settings, async (_url, init) => {
		transportSignal = init?.signal;
		return new Promise<Response>((resolve) => {
			release = resolve;
		});
	});
	try {
		await h.start();
		const request = {
			provider: 'openrouter',
			reply: () => {
				replies++;
			},
		};
		const pending = h.invoke(request);
		assert.ok(transportSignal && !transportSignal.aborted);
		await h.shutdown();
		assert.equal(transportSignal.aborted, true);
		await pending;
		release(Response.json({ data: { total_credits: 10, total_usage: 3 } }));
		await tick();
		await h.invoke(request);
		assert.equal(replies, 0);
		assert.equal(h.bus.listenerCount(SCOPED_USAGE_EVENT), 0);
	} finally {
		await h.restore();
	}
});
