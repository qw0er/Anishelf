import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { stringify } from "yaml";
import { ConfigurationService } from "../../../../src/modules/system/configuration/application/service.js";
import {
	loadAutoPreparationPresets,
	parseAutoPreparationPresets,
} from "../../../../src/modules/system/configuration/infrastructure/auto-preparation.js";
import { builtinTranscodeProfiles } from "../../../../src/modules/system/configuration/public.js";
import { createSystemModule } from "../../../../src/modules/system/create.js";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});
const preset = {
	id: "custom:test",
	name: "Test",
	transcodeProfileId: "builtin:balanced",
};
function parse(extra: object = {}) {
	return parseAutoPreparationPresets(
		stringify({ version: 1, presets: [{ ...preset, ...extra }] }),
		builtinTranscodeProfiles,
	);
}
test("minimal preset accepts omitted and empty constraints", () => {
	expect(parse()).toEqual([preset]);
	expect(
		parse({
			accept: {
				containers: [],
				video: [{ codecs: [], maxHeight: null }],
				audio: [],
			},
		}),
	).toHaveLength(1);
});
test.each([
	{ id: "builtin:web" },
	{ transcodeProfileId: "custom:missing" },
	{ unexpected: true },
	{ audio: { selection: "language" } },
	{ audio: { selection: "languages" } },
	{ accept: { video: [{ codecs: ["h264", "vp9"], profiles: ["high"] }] } },
	{ accept: { video: [{ maxLevel: "5.1" }] } },
	{ accept: { containers: ["webm"] } },
	{ accept: { video: [{ codecs: ["vp9"] }] } },
])("rejects invalid or conflicting declarations %j", (extra) => {
	expect(() => parse(extra)).toThrow();
});
test("rejects duplicate IDs, YAML duplicates, multiple documents and unsupported versions", () => {
	for (const source of [
		stringify({ version: 1, presets: [preset, preset] }),
		"version: 1\nversion: 1",
		"version: 1\n---\nversion: 1",
		"version: 2",
	])
		expect(() =>
			parseAutoPreparationPresets(source, builtinTranscodeProfiles),
		).toThrow();
});
test("missing file uses built-ins; invalid file exposes issue and preserves built-ins", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-auto-config-"));
	directories.push(directory);
	expect(
		await loadAutoPreparationPresets(directory, builtinTranscodeProfiles),
	).toMatchObject({
		presets: [{ id: "builtin:web" }, { id: "builtin:web-conservative" }],
		issue: undefined,
	});
	await writeFile(
		join(directory, "auto-preparation-presets.yaml"),
		"presets: [broken",
	);
	const catalog = await loadAutoPreparationPresets(
		directory,
		builtinTranscodeProfiles,
	);
	expect(catalog.presets).toHaveLength(2);
	expect(catalog.issue?.file).toBe("auto-preparation-presets.yaml");
});
test("settings persist selection, notify changes, and preserve missing selection on restart", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-auto-settings-"));
	directories.push(directory);
	const env = { ANISHELF_DATA_DIR: directory };
	await writeFile(
		join(directory, "auto-preparation-presets.yaml"),
		stringify({ version: 1, presets: [preset] }),
	);
	const configuration = await ConfigurationService.load(env);
	let changes = 0;
	const unsubscribe = configuration.onSettingsChanged(() => {
		changes++;
	});
	await configuration.patchSettings({
		autoPreparationEnabled: true,
		autoPreparationPresetId: preset.id,
	});
	expect(changes).toBe(1);
	unsubscribe();
	await expect(
		configuration.patchSettings({ autoPreparationPresetId: "custom:missing" }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	await rm(join(directory, "auto-preparation-presets.yaml"));
	const restarted = await ConfigurationService.load(env);
	expect(restarted.settings.autoPreparationPresetId).toBe(preset.id);
	expect(restarted.autoPreparationPresets.some((p) => p.id === preset.id)).toBe(
		false,
	);
});

test("System module exposes preset catalog and settings notifications to the app", async () => {
	const directory = await mkdtemp(join(tmpdir(), "anishelf-auto-module-"));
	directories.push(directory);
	const { api } = await createSystemModule({ ANISHELF_DATA_DIR: directory });
	expect(api.autoPreparationPresets?.map((p) => p.id)).toEqual([
		"builtin:web",
		"builtin:web-conservative",
	]);
	let notified = false;
	const unsubscribe = api.onSettingsChanged?.(() => {
		notified = true;
	});
	await api.patchSettings({ autoPreparationEnabled: true });
	expect(notified).toBe(true);
	unsubscribe?.();
});
