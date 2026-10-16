import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaProvider, hasMetaSubscriptionCredential } from '../src/providers/impl/meta.js';
import { createDeps, getAuthPath } from './helpers.js';

const OAUTH_ENTRY = { type: 'oauth', access: 'minted-key', refresh: 'identity-token', expires: 1 };

function withAuth(
	files: Map<string, string>,
	payload: Record<string, unknown>,
	home: string,
): void {
	files.set(getAuthPath(home), JSON.stringify(payload));
}

const neverFetch = async (): Promise<Response> =>
	assert.fail('meta must not fetch: no usage endpoint exists');

test('meta reports a signed-in subscription with unknown (empty) quota windows', async () => {
	const { deps, files } = createDeps({ fetch: neverFetch });
	withAuth(files, { meta: OAUTH_ENTRY }, deps.homedir());

	const usage = await new MetaProvider().fetchUsage(deps);

	assert.equal(usage.provider, 'meta');
	assert.equal(usage.displayName, 'Meta (Muse)');
	assert.equal(usage.error, undefined);
	assert.deepEqual(usage.windows, []);
	assert.doesNotMatch(JSON.stringify(usage), /minted-key|identity-token/);
});

test('meta credential presence accepts either OAuth token and respects hasCredentials', async () => {
	for (const entry of [
		{ type: 'oauth', access: 'minted-key' },
		{ type: 'oauth', refresh: 'identity-token' },
		{ type: 'oauth', access: '  ', refresh: 'identity-token' },
	]) {
		const { deps, files } = createDeps({ fetch: neverFetch });
		withAuth(files, { meta: entry }, deps.homedir());
		assert.equal(hasMetaSubscriptionCredential(deps), true);
		assert.equal(new MetaProvider().hasCredentials(deps), true);
		assert.equal((await new MetaProvider().fetchUsage(deps)).error, undefined);
	}
});

test('meta never treats developer API keys as the subscription', async () => {
	for (const entry of [
		{ type: 'api_key', key: 'developer-key' },
		{ type: 'api', key: 'developer-key' },
		{ type: 'oauth' },
		{ type: 'oauth', access: '  ', refresh: '' },
	]) {
		const { deps, files } = createDeps({ fetch: neverFetch });
		withAuth(files, { meta: entry }, deps.homedir());
		assert.equal(hasMetaSubscriptionCredential(deps), false);
		assert.equal((await new MetaProvider().fetchUsage(deps)).error?.code, 'NO_CREDENTIALS');
	}
});

test('meta rejects command-valued or multiline OAuth strings without fetching', async () => {
	for (const entry of [
		{ type: 'oauth', access: '!secret-command' },
		{ type: 'oauth', access: 'token\r\nInjected: value', refresh: '!mint-command' },
	]) {
		const { deps, files } = createDeps({ fetch: neverFetch });
		withAuth(files, { meta: entry }, deps.homedir());
		assert.equal((await new MetaProvider().fetchUsage(deps)).error?.code, 'NO_CREDENTIALS');
	}
});

test('meta reports missing credentials when auth.json or the entry is absent or malformed', async () => {
	const missing = createDeps({ fetch: neverFetch });
	assert.equal((await new MetaProvider().fetchUsage(missing.deps)).error?.code, 'NO_CREDENTIALS');

	const { deps, files } = createDeps({ fetch: neverFetch });
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());
	assert.equal((await new MetaProvider().fetchUsage(deps)).error?.code, 'NO_CREDENTIALS');

	const malformed = createDeps({ fetch: neverFetch });
	malformed.files.set(getAuthPath(malformed.deps.homedir()), '{not-json');
	assert.equal((await new MetaProvider().fetchUsage(malformed.deps)).error?.code, 'NO_CREDENTIALS');
});
