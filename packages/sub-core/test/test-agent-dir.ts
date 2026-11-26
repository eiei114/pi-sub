import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const TEST_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sub-core-agent-"));

// Pi's path helpers read this when imported, so set it in a test bootstrap that
// runs before any cache modules are loaded.
process.env.PI_CODING_AGENT_DIR = TEST_AGENT_DIR;

process.once("exit", () => {
	fs.rmSync(TEST_AGENT_DIR, { recursive: true, force: true });
});
