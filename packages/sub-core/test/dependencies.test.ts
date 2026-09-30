import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDependencies } from '../src/dependencies.js';

test('failed shell-free child commands do not poison the next invocation on Windows', () => {
	const deps = createDefaultDependencies();
	const failedArgs = ['-e', "process.stderr.write('child failed'); process.exit(23)"];

	assert.throws(
		() => deps.execFileSyncWithStderr(process.execPath, failedArgs, {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}),
		/status 23/,
	);

	// Reusing the same dependency after the failed child is the regression check:
	// spawnSync must have reaped the child before returning, including on Windows.
	const recovered = deps.execFileSyncWithStderr(
		process.execPath,
		['-e', "process.stdout.write('recovered')"],
		{
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	assert.deepEqual(recovered, { stdout: 'recovered', stderr: '' });
});
