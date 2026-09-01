import test from "node:test";
import assert from "node:assert/strict";
import { getStorage, setStorage, type StorageAdapter } from "../src/storage.js";
import { tryAcquireFileLock, releaseFileLock } from "../src/storage/lock.js";

function createMemoryStorage(): { storage: StorageAdapter; files: Map<string, string> } {
	const files = new Map<string, string>();
	const mtimes = new Map<string, number>();
	const storage: StorageAdapter = {
		readFile: (filePath) => files.get(filePath),
		writeFile: (filePath, contents) => {
			files.set(filePath, contents);
			mtimes.set(filePath, Date.now());
		},
		writeFileExclusive: (filePath, contents) => {
			if (files.has(filePath)) return false;
			files.set(filePath, contents);
			mtimes.set(filePath, Date.now());
			return true;
		},
		exists: (filePath) => files.has(filePath),
		removeFile: (filePath) => {
			files.delete(filePath);
			mtimes.delete(filePath);
		},
		mtimeMs: (filePath) => {
			return mtimes.get(filePath);
		},
		ensureDir: () => {},
	};
	return { storage, files };
}

test("tryAcquireFileLock replaces stale locks with owned tokens", () => {
	const { storage, files } = createMemoryStorage();
	const originalStorage = getStorage();
	setStorage(storage);

	try {
		const lockPath = "/tmp/lock";
		const firstToken = tryAcquireFileLock(lockPath, 10);
		assert.ok(firstToken);
		files.set(lockPath, String(Date.now() - 1000));
		const secondToken = tryAcquireFileLock(lockPath, 10);
		assert.ok(secondToken);
		assert.notEqual(secondToken, firstToken);

		releaseFileLock(lockPath, firstToken ?? undefined);
		assert.equal(files.has(lockPath), true);

		releaseFileLock(lockPath, secondToken ?? undefined);
		assert.equal(files.has(lockPath), false);
	} finally {
		setStorage(originalStorage);
	}
});

test("tryAcquireFileLock treats a fresh unparseable (empty) lock as held", () => {
	const { storage, files } = createMemoryStorage();
	const originalStorage = getStorage();
	setStorage(storage);

	try {
		const lockPath = "/tmp/corrupt-lock";
		// Simulate a crash leftover: file exists but is empty/unparseable.
		files.set(lockPath, "");
		// Fresh unparseable lock (likely a writer mid-create): treated as held.
		assert.equal(tryAcquireFileLock(lockPath, 5000), null);
	} finally {
		setStorage(originalStorage);
	}
});

test("tryAcquireFileLock reclaims an old empty lock and retries acquisition", () => {
	const { storage, files } = createMemoryStorage();
	const originalStorage = getStorage();
	setStorage(storage);

	try {
		const lockPath = "/tmp/old-empty-lock";
		// Empty lock file aged past the stale window: must be reclaimed and re-acquired.
		files.set(lockPath, "");
		const oldMtime = Date.now() - 60_000;
		const wrapped: StorageAdapter = {
			...storage,
			mtimeMs: () => oldMtime,
		};
		setStorage(wrapped);

		const token = tryAcquireFileLock(lockPath, 5000);
		assert.ok(token, "expected the stale empty lock to be reclaimed and re-acquired");
		// The lock file is now owned by our token.
		assert.equal(tryAcquireFileLock(lockPath, 5000), null);
		releaseFileLock(lockPath, token ?? undefined);
		assert.equal(files.has(lockPath), false);
	} finally {
		setStorage(originalStorage);
	}
});
