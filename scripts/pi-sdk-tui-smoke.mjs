/* global process, console, setTimeout, clearTimeout */
import fs, { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync as mkdirSync2, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Buffer } from "node:buffer";

const root = resolve(import.meta.dirname, "..");
const reportPath = process.argv.includes("--update-curated-report")
	? resolve(root, "docs/verification/pi-sdk-tui-smoke.json")
	: resolve(root, ".tmp/pi-sdk-tui-smoke.json");
const agentDir = mkdtempSync(join(tmpdir(), "pi-sub-tui-smoke-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

// Seed minimal settings/cache context used by sub-bar flows.
mkdirSync(join(agentDir, "cache", "sub-core"), { recursive: true });

// sub-bar starts a settings file watcher on session_start; on Windows this can
// emit an async EPERM error. Attach a handler and suppress this specific crash.
const originalWatch = fs.watch.bind(fs);
fs.watch = (...args) => {
	try {
		const watcher = originalWatch(...args);
		try { watcher?.on?.("error", () => { /* ignore watcher errors in smoke */ }); } catch { /* ignore */ }
		return watcher;
	} catch {
		return { on() { /* noop */ }, close() { /* noop */ }, unref() { /* noop */ } };
	}
};
process.on("uncaughtException", (err) => {
	if (err && err.code === "EPERM" && err.syscall === "watch") return;
	console.error(err);
	process.exit(1);
});

function assert(condition, message, observed) {
	if (!condition) {
		const detail = observed === undefined ? "" : `\nObserved: ${JSON.stringify(observed, null, 2)}`;
		throw new Error(`${message}${detail}`);
	}
}

function stripAnsi(value) {
	return String(value).replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x07]*\x07/g, "");
}

function renderedText(component, width = 100) {
	const lines = component.render(width);
	return lines.map(stripAnsi).join("\n");
}

function createTheme() {
	const identity = (s) => String(s ?? "");
	return {
		fg: (_color, text) => String(text ?? ""),
		bg: (_color, text) => String(text ?? ""),
		bold: identity,
		italic: identity,
		strikethrough: identity,
		getBgAnsi: () => "",
		getFgAnsi: () => "\x1b[39m",
	};
}

function createKb() {
	const map = {
		"tui.select.up": ["\x1b[A"],
		"tui.select.down": ["\x1b[B"],
		"tui.select.confirm": ["\r", "\n"],
		"tui.select.cancel": ["\x1b", "\x03"],
		"tui.select.pageUp": ["\x1b[5~"],
		"tui.select.pageDown": ["\x1b[6~"],
	};
	return {
		matches(keyData, id) {
			return (map[id] ?? []).includes(keyData);
		},
	};
}

class EventBus {
	constructor() {
		this.handlers = new Map();
	}
	on(event, handler) {
		const list = this.handlers.get(event) ?? [];
		list.push(handler);
		this.handlers.set(event, list);
		return () => {
			const current = this.handlers.get(event) ?? [];
			this.handlers.set(event, current.filter((h) => h !== handler));
		};
	}
	emit(event, payload) {
		for (const handler of this.handlers.get(event) ?? []) {
			handler(payload);
		}
	}
}

function createExtensionHarness() {
	const bus = new EventBus();
	const commands = new Map();
	const shortcuts = new Map();
	const tools = new Map();
	const listeners = new Map();
	const messages = [];
	const notifications = [];
	const statuses = [];
	const widgets = [];
	const execCalls = [];
	const customCalls = [];
	const inputCalls = [];
	const confirmCalls = [];
	const selectCalls = [];

	let currentContext = null;
	let pendingCustom = null; // { resolve, reject, factory, doneWrapper }

	const pi = {
		events: bus,
		registerCommand(name, def) { commands.set(name, def); },
		registerShortcut(key, def) { shortcuts.set(key, { key, ...def }); },
		registerTool(def) { tools.set(def.name, def); },
		on(event, handler) {
			const list = listeners.get(event) ?? [];
			list.push(handler);
			listeners.set(event, list);
		},
		sendMessage(msg) { messages.push(msg); },
		exec: async (cmd, args) => { execCalls.push({ cmd, args }); return { code: 1, stderr: "not available", stdout: "" }; },
	};

	function makeUi(ctxState) {
		return {
			notify(message, type) { notifications.push({ message, type }); },
			setStatus(key, text) { statuses.push({ key, text }); ctxState.statuses[key] = text; },
			setWidget(name, factory, options) { widgets.push({ name, factory, options }); ctxState.widget = { name, factory, options }; },
			setEditorText(text) { ctxState.editorText = text; },
			getEditorText() { return ctxState.editorText ?? ""; },
			input: async (title, placeholder) => {
				inputCalls.push({ title, placeholder });
				if (ctxState.nextInput !== undefined) {
					const v = ctxState.nextInput;
					ctxState.nextInput = undefined;
					return v;
				}
				return undefined;
			},
			confirm: async (title, message) => {
				confirmCalls.push({ title, message });
				if (ctxState.nextConfirm !== undefined) {
					const v = ctxState.nextConfirm;
					ctxState.nextConfirm = undefined;
					return v;
				}
				return false;
			},
			select: async (title, options) => {
				selectCalls.push({ title, options });
				if (ctxState.nextSelect !== undefined) {
					const v = ctxState.nextSelect;
					ctxState.nextSelect = undefined;
					return v;
				}
				return undefined;
			},
			editor: async () => undefined,
			custom(factory) {
				return new Promise((resolve) => {
					let settled = false;
					const done = (value) => {
						if (settled) return;
						settled = true;
						pendingCustom = null;
						resolve(value);
					};
					const tui = {
						requestRender() { ctxState.renderRequests = (ctxState.renderRequests ?? 0) + 1; },
					};
					const theme = ctxState.theme ?? createTheme();
					const kb = ctxState.kb ?? createKb();
					const component = factory(tui, theme, kb, done);
					const record = { factory, component, done, resolved: () => settled };
					customCalls.push(record);
					pendingCustom = record;
					ctxState.lastCustom = record;
				});
			},
			theme: createTheme(),
		};
	}

	function createContext(overrides = {}) {
		const ctxState = {
			editorText: "",
			statuses: {},
			renderRequests: 0,
			theme: createTheme(),
			kb: createKb(),
			...overrides,
		};
		const ctx = {
			hasUI: true,
			cwd: root,
			model: { provider: "anthropic", id: "claude-sonnet-4-20250514" },
			getContextUsage: () => ({ tokens: 0, contextWindow: 200000, percent: 0 }),
			ui: makeUi(ctxState),
			_state: ctxState,
		};
		currentContext = ctx;
		return ctx;
	}

	async function emitSessionEvent(eventName, event = {}, ctx = currentContext) {
		const handlers = listeners.get(eventName) ?? [];
		for (const handler of handlers) {
			await handler(event, ctx);
		}
	}

	return {
		pi, bus, commands, shortcuts, tools, listeners,
		messages, notifications, statuses, widgets, execCalls,
		customCalls, inputCalls, confirmCalls, selectCalls,
		createContext,
		emitSessionEvent,
		getPendingCustom: () => pendingCustom,
	};
}

function makeDisplayShareString(name, displayOverride = {}) {
	const display = {
		providerLabel: true,
		providerLabelColon: false,
		providerLabelBold: true,
		statusIndicatorMode: "icon+text",
		statusIconPack: "minimal",
		statusIconCustom: "●◐◔○×◇",
		statusProviderDivider: false,
		statusDismissOk: true,
		showSessionTokens: false,
		...displayOverride,
	};
	const payload = { v: 1, display };
	const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return name ? `${name}:${encoded}` : encoded;
}

async function tick(ms = 0) {
	await new Promise((r) => setTimeout(r, ms));
}

// Await a promise but reject if it has not settled before the deadline, so an
// unfinished command reaches the failure path instead of silently passing.
async function withDeadline(promise, ms, label) {
	let timer;
	const deadline = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
	});
	try {
		return await Promise.race([promise, deadline]);
	} finally {
		clearTimeout(timer);
	}
}

// Label of the currently highlighted SelectList row ("→ Label   description").
function selectedLabel(text) {
	const match = text.match(/^→\s+(.+?)(?:\s{2,}|$)/m);
	return match ? match[1].trim() : null;
}

async function testThemeImportUiFlows(subBarModule, harness) {
	const { pi, commands, createContext, emitSessionEvent, messages, notifications } = harness;
	const extension = subBarModule.default;
	await extension(pi);
	const ctx = createContext();
	await emitSessionEvent("session_start", {}, ctx);
	await tick(20);

	const importCmd = commands.get("sub-bar:import");
	assert(importCmd && typeof importCmd.handler === "function", "sub-bar:import command should be registered");

	// 1) Valid share string -> promptImportAction custom SelectList, cancel path
	const share = makeDisplayShareString("TuiSmoke", { providerLabel: true });
	const run1 = importCmd.handler(share, ctx);
	await tick(30);
	const actionCustom = ctx._state.lastCustom;
	assert(actionCustom?.component, "Import should open custom SelectList action prompt");
	const actionText = renderedText(actionCustom.component, 100);
	assert(actionText.includes("Save & apply"), "Action prompt should render Save & apply", actionText);
	assert(actionText.includes("Save"), "Action prompt should render Save", actionText);
	assert(actionText.includes("Cancel"), "Action prompt should render Cancel", actionText);
	// Cancel: move down twice then enter? Easier send Escape (tui.select.cancel)
	actionCustom.component.handleInput("\x1b");
	await run1;

	// 2) No-arg import -> promptImportString custom Input prompt, then action prompt
	ctx._state.lastCustom = null;
	const run2 = importCmd.handler("", ctx);
	await tick(30);
	const inputCustom = ctx._state.lastCustom;
	assert(inputCustom?.component, "No-arg import should open custom string input prompt");
	const inputText = renderedText(inputCustom.component, 100);
	assert(inputText.includes("Paste Theme Share string"), "Import string prompt should render label", inputText);
	// Find Input component behavior: container child is Input; send chars + Enter
	const share2 = makeDisplayShareString("TuiSmoke2", { providerLabel: false });
	for (const ch of share2) inputCustom.component.handleInput(ch);
	inputCustom.component.handleInput("\r");
	await tick(30);
	// After submit, handler proceeds to action prompt (new custom)
	const actionCustom2 = ctx._state.lastCustom;
	assert(actionCustom2?.component && actionCustom2 !== inputCustom, "After pasting share string, action prompt should open");
	const actionText2 = renderedText(actionCustom2.component, 100);
	assert(actionText2.includes("Save & apply"), "Second action prompt should render Save & apply", actionText2);
	// Choose Save (down once then enter)
	actionCustom2.component.handleInput("\x1b[B");
	actionCustom2.component.handleInput("\r");
	await run2;
	await tick(20);

	const savedOrImported = notifications.some((n) => /Imported TuiSmoke2|sub-bar Theme/i.test(String(n.message ?? "")))
		|| messages.some((m) => /TuiSmoke2|Theme/i.test(String(m.content ?? "")));
	assert(savedOrImported, "Saving imported theme should produce user-visible feedback", { notifications, messages });

	return {
		name: "theme_import_tui",
		assertions: [
			{ id: "import_action_selectlist", expected: "Custom SelectList action prompt renders Save & apply/Save/Cancel", observed: actionText, passed: actionText.includes("Save & apply") && actionText.includes("Save") && actionText.includes("Cancel") },
			{ id: "import_string_prompt", expected: "Custom input prompt renders Paste Theme Share string and accepts input", observed: inputText, passed: inputText.includes("Paste Theme Share string") },
			{ id: "import_save_feedback", expected: "Saving imported theme via UI selection emits feedback", observed: { notifications, messageCount: messages.length }, passed: savedOrImported },
		],
	};
}

async function testSettingsUiFlow(subBarModule, harness) {
	const { pi, commands, createContext, emitSessionEvent } = harness;
	let settingsCmd = commands.get("sub-bar:settings");
	if (!settingsCmd) {
		await subBarModule.default(pi);
		settingsCmd = commands.get("sub-bar:settings");
	}
	const ctx = createContext();
	await emitSessionEvent("session_start", {}, ctx);
	await tick(30);
	assert(settingsCmd && typeof settingsCmd.handler === "function", "sub-bar:settings command should be registered");

	const run = settingsCmd.handler("", ctx);
	await tick(50);
	const custom = ctx._state.lastCustom;
	assert(custom?.component, "Settings command should open custom settings UI");
	const mainText = renderedText(custom.component, 120);
	assert(mainText.includes("Display") || mainText.includes("Providers") || mainText.includes("Settings") || mainText.includes("Themes"),
		"Settings main menu should render navigable items", mainText);

	const enter = () => custom.component.handleInput("\r");
	const down = () => custom.component.handleInput("\x1b[B");
	const esc = () => custom.component.handleInput("\x1b");
	const current = () => renderedText(custom.component, 120);

	// Labels that only exist on destination screens. Main-menu labels such as
	// "Themes" must not count as navigation evidence.
	const themesSubmenuLabels = ["Load & Manage themes", "Import theme"];
	const importScreenLabel = "Paste Theme Share string";
	const mainHasDestinationLabels = [...themesSubmenuLabels, importScreenLabel].some((label) => mainText.includes(label));
	const mainSelected = selectedLabel(mainText);

	// 1) Main menu: confirm the highlighted "Themes" item via handleInput.
	let themesText = "";
	if (mainSelected === "Themes") {
		enter();
		await tick(30);
		themesText = current();
	}
	const reachedThemesSubmenu = themesText !== ""
		&& !themesText.includes("sub-bar Settings")
		&& themesSubmenuLabels.every((label) => themesText.includes(label));

	// 2) Themes submenu: move the selection (not just visibility) to "Import theme".
	let selected = selectedLabel(themesText);
	if (reachedThemesSubmenu) {
		for (let i = 0; i < 10 && selected !== "Import theme"; i++) {
			down();
			await tick(10);
			selected = selectedLabel(current());
		}
	}
	const selectedImportTheme = reachedThemesSubmenu && selected === "Import theme";

	// 3) Confirm "Import theme" and require the distinct import input screen.
	let importText = "";
	if (selectedImportTheme) {
		enter();
		await tick(30);
		importText = current();
	}
	const reachedImportScreen = importText.includes(importScreenLabel)
		&& !themesSubmenuLabels.some((label) => importText.includes(label));

	// Exit settings UI completely; the command must settle before the deadline.
	for (let i = 0; i < 8; i++) { esc(); await tick(10); }
	await withDeadline(run, 1000, "sub-bar:settings command");

	const reachable = !mainHasDestinationLabels && reachedThemesSubmenu && selectedImportTheme && reachedImportScreen;
	return {
		name: "settings_tui",
		assertions: [
			{ id: "settings_custom_opened", expected: "Settings command opens custom UI component", observed: mainText.slice(0, 400), passed: !!custom?.component },
			{ id: "settings_menu_rendered", expected: "Settings menu renders interactive items", observed: mainText.slice(0, 400), passed: mainText.includes("Display") || mainText.includes("Providers") || mainText.includes("Settings") || mainText.includes("Themes") },
			{
				id: "settings_theme_import_reachable",
				expected: "handleInput navigation Main -> Themes -> Import theme reaches the distinct import input screen",
				observed: { mainSelected, themesSubmenu: themesText.slice(0, 600), selected, importScreen: importText.slice(0, 600) },
				passed: reachable,
			},
		],
	};
}

const results = [];
try {
	const subBarModule = await import(pathToFileURL(resolve(root, "packages/sub-bar/index.ts")).href);
	// Run flows in isolated harnesses to avoid state coupling.
	{
		const harness = createExtensionHarness();
		results.push(await testThemeImportUiFlows(subBarModule, harness));
	}
	{
		const harness = createExtensionHarness();
		results.push(await testSettingsUiFlow(subBarModule, harness));
	}
	const passed = results.every((r) => r.assertions.every((a) => a.passed));
	const report = {
		schema_version: 1,
		verification_contract: "pi-sdk-tui-behavior-v1",
		sdk_versions: {
			"@earendil-works/pi-coding-agent": JSON.parse(fs.readFileSync(resolve(root, "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8")).version,
			"@earendil-works/pi-tui": JSON.parse(fs.readFileSync(resolve(root, "node_modules/@earendil-works/pi-tui/package.json"), "utf8")).version,
		},
		platform: process.platform,
		model_inference: "none; actual Pi 1.5.0 extension and pi-tui component execution driven by automated UI interactions",
		passed,
		cases: results,
	};
	mkdirSync2(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify({ passed, reportPath, results }, null, 2));
	try { rmSync(agentDir, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
	// Let lingering async watcher callbacks settle; exit explicitly.
	setTimeout(() => process.exit(passed ? 0 : 1), 50);
} catch (error) {
	console.error(error);
	try { rmSync(agentDir, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
	setTimeout(() => process.exit(1), 50);
}
