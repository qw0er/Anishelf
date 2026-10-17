import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { createHttpApp } from "../src/app/bootstrap/http.js";
import { builtinPolicy } from "../src/app/policy.js";
import { createResourcesModule } from "../src/modules/resources/create.js";
import { SettingsApplication } from "../src/modules/system/configuration/application/settings.js";
import { createSystemModule } from "../src/modules/system/create.js";
import { registerSystemHttp } from "../src/modules/system/http.js";

const logger = pino({ enabled: false });
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
	const directory = await mkdtemp(
		join(tmpdir(), "anishelf-settings-ownership-"),
	);
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const root = join(directory, "media");
	const other = join(directory, "other");
	await mkdir(root);
	await mkdir(other);
	const system = await createSystemModule({
		ANISHELF_DATA_DIR: join(directory, "data"),
		ANISHELF_INITIAL_RESOURCE_ROOT: root,
	});
	await system.api.patchSettings({ scanIntervalMinutes: 0 });
	const resources = await createResourcesModule({ system: system.api, logger });
	cleanup.push(() => resources.close());
	await resources.api.cancelScan();
	return { system, resources, root, other };
}

test("System settings HTTP updates media settings while Resources reserves its scan gate", async () => {
	const { system, resources, root, other } = await fixture();
	const app = createHttpApp({
		config: system.api.deployment,
		logger,
		policy: builtinPolicy,
		registrations: [
			(app) =>
				registerSystemHttp(
					app,
					system.api,
					resources.api,
					builtinPolicy.library.maximumScanIntervalMinutes,
				),
		],
		closeDependencies: async () => {},
	});
	cleanup.push(() => app.close());
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const pending = resources.api.applySettingsChange({}, async () => {
		await gate;
		return system.api.patchSettings({});
	});
	const headers = { host: "127.0.0.1:3000" };
	try {
		const response = await app.inject({
			method: "PUT",
			url: "/api/settings",
			headers,
			payload: {
				resourceRoots: [root],
				transcodeCacheBudgetGiB: 12,
				defaultTranscodeProfileId: "builtin:fast",
				preparationMode: "fast",
			},
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			resourceRoots: [root],
			transcodeCacheBudgetGiB: 12,
			defaultTranscodeProfileId: "builtin:fast",
			preparationMode: "fast",
		});
		const rejected = await app.inject({
			method: "PUT",
			url: "/api/settings",
			headers,
			payload: { resourceRoots: [other] },
		});
		expect(rejected.statusCode).toBe(409);
		expect(rejected.json().error).toMatchObject({ code: "SETTINGS_BUSY" });
		expect(system.api.settings.resourceRoots).toEqual([root]);
		const profile = await app.inject({
			method: "GET",
			url: "/api/transcode-profiles",
			headers,
		});
		expect(profile.statusCode).toBe(200);
		expect(profile.json()).toMatchObject({
			selectedProfileId: "builtin:fast",
			preparationMode: "fast",
			selectionAvailable: true,
		});
	} finally {
		release();
		await pending;
	}
});

test("a media settings patch does not restore a stale root or overwrite concurrent profile selection", async () => {
	const { system, resources, root, other } = await fixture();
	const settings = new SettingsApplication(system.api, resources.api, logger);
	// All writes enqueue before persistence completes; the media patch observes the old root.
	const rootWrite = system.api.patchSettings({ resourceRoots: [other] });
	const profileWrite = system.api.selectTranscodeProfile(
		"builtin:fast",
		"fast",
	);
	const budgetWrite = settings.updateSettings({
		resourceRoots: [root],
		transcodeCacheBudgetGiB: 14,
	});
	await Promise.all([rootWrite, profileWrite, budgetWrite]);
	expect(system.api.settings).toMatchObject({
		resourceRoots: [other],
		transcodeCacheBudgetGiB: 14,
		defaultTranscodeProfileId: "builtin:fast",
		preparationMode: "fast",
	});
});
