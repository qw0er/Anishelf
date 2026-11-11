import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { Check } from "typebox/value";
import { afterEach, beforeEach, expect, test } from "vitest";
import { stringify } from "yaml";
import { TranscodeProfileSchema } from "../../../../src/contracts/schemas/transcode-profiles.js";
import { ConfigurationService } from "../../../../src/modules/system/configuration/application/service.js";
import { builtinTranscodeProfiles } from "../../../../src/modules/system/configuration/domain/transcode-profiles.js";
import { transcodeProfileCatalog } from "../../../../src/modules/system/configuration/http/profile-presenter.js";
import { parseTranscodeProfiles } from "../../../../src/modules/system/configuration/infrastructure/transcode-profiles.js";
import { createHttpApp } from "../../../support/http.js";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "anishelf-profiles-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
const load = () => ConfigurationService.load({ ANISHELF_DATA_DIR: directory });
const customProfile = () => ({
	...structuredClone(builtinTranscodeProfiles[0]),
	id: "custom:small",
	name: "Small",
	description: "Smaller Web copy.",
	video: { ...builtinTranscodeProfiles[0]?.video, maxHeight: 720 },
});
const writeProfiles = (profiles: unknown[]) =>
	writeFile(
		join(directory, "transcode-profiles.yaml"),
		stringify({ version: 2, profiles }),
	);

test("built-ins use the shared schema and missing external files create no configuration files", async () => {
	const service = await load();
	expect(
		builtinTranscodeProfiles.every((profile) =>
			Check(TranscodeProfileSchema, profile),
		),
	).toBe(true);
	expect(service.transcodeProfiles.map((profile) => profile.id)).toEqual([
		"builtin:balanced",
		"builtin:fast",
		"builtin:efficient",
		"builtin:compact",
	]);
	expect(transcodeProfileCatalog(service)).toMatchObject({
		selectedProfileId: "builtin:balanced",
		selectionAvailable: true,
	});
	expect(service.settings).toEqual({ resourceRoots: [] });
	await expect(
		readFile(join(directory, "settings.json")),
	).rejects.toMatchObject({ code: "ENOENT" });
	await expect(
		readFile(join(directory, "transcode-profiles.yaml")),
	).rejects.toMatchObject({ code: "ENOENT" });
});

test("external profiles merge into an immutable startup snapshot and choices survive restart", async () => {
	await writeProfiles([customProfile()]);
	const service = await load();
	await service.selectTranscodeProfile("custom:small");
	expect(
		JSON.parse(await readFile(join(directory, "settings.json"), "utf8")),
	).toEqual({ resourceRoots: [], defaultTranscodeProfileId: "custom:small" });
	expect(transcodeProfileCatalog(await load())).toMatchObject({
		selectedProfileId: "custom:small",
		selectionAvailable: true,
	});
	expect(
		Object.isFrozen(
			service.transcodeProfiles[builtinTranscodeProfiles.length]?.video,
		),
	).toBe(true);
	await writeProfiles([]);
	expect(transcodeProfileCatalog(service).selectionAvailable).toBe(true);
	const reload = await load();
	expect(transcodeProfileCatalog(reload)).toMatchObject({
		selectedProfileId: "custom:small",
		selectionAvailable: false,
	});
	await reload.update({ ...reload.settings });
	expect(reload.settings.defaultTranscodeProfileId).toBe("custom:small");
	await reload.selectTranscodeProfile(null);
	expect(transcodeProfileCatalog(reload)).toMatchObject({
		selectedProfileId: "builtin:balanced",
		selectionAvailable: true,
	});
	expect(reload.settings.defaultTranscodeProfileId).toBeUndefined();
});

test.each([
	"{",
	stringify({ version: 1, profiles: [] }),
	stringify({ version: 2, profiles: [builtinTranscodeProfiles[0]] }),
	stringify({ version: 2, profiles: [customProfile(), customProfile()] }),
	stringify({
		version: 2,
		profiles: [{ ...customProfile(), copyCompatibleStreams: true }],
	}),
	stringify({
		version: 2,
		profiles: [{ ...customProfile(), usage: "preparation" }],
	}),
	stringify({
		version: 2,
		profiles: [{ ...customProfile(), inputOptions: { i: "other" } }],
	}),
	stringify({
		version: 2,
		profiles: [
			{ ...customProfile(), video: { encoder: "copy", options: { crf: 20 } } },
		],
	}),
	stringify({
		version: 2,
		profiles: [
			{
				...customProfile(),
				video: { ...customProfile().video, filters: ["trim=duration=1"] },
			},
		],
	}),
	stringify({
		version: 2,
		profiles: [
			{
				...customProfile(),
				video: { ...customProfile().video, filters: ["null;movie=other"] },
			},
		],
	}),
	"version: 2\nversion: 2\nprofiles: []\n",
])(
	"rejects invalid v2 structure and application-owned overrides: %s",
	(source) => {
		expect(() => parseTranscodeProfiles(source)).toThrow();
	},
);

test("open encoders and options are retained without a fixed parameter whitelist", () => {
	const value = parseTranscodeProfiles(
		stringify({
			version: 2,
			profiles: [
				{
					...customProfile(),
					video: {
						encoder: "new_encoder",
						options: {
							new_quality: 17,
							"8x8dct": 1,
							"encoder-params": "new-feature=1",
						},
					},
					audio: { encoder: "copy" },
				},
			],
		}),
	);
	expect(value[0]).toMatchObject({
		video: { encoder: "new_encoder", codec: "", options: { new_quality: 17 } },
		audio: { encoder: "copy" },
	});
});

test("external profile, preset and settings edits apply only to a new startup snapshot", async () => {
	await writeProfiles([customProfile()]);
	const preset = {
		id: "custom:reference",
		name: "Reference",
		description: "Uses a custom profile.",
		transcodeProfileId: "custom:small",
	};
	await writeFile(
		join(directory, "auto-preparation-presets.yaml"),
		stringify({ version: 1, presets: [preset] }),
	);
	const service = await load();
	await service.selectTranscodeProfile("custom:small");
	const revision = service.transcodeRevision;
	await writeProfiles([]);
	await writeFile(
		join(directory, "auto-preparation-presets.yaml"),
		stringify({ version: 1, presets: [] }),
	);
	await writeFile(
		join(directory, "settings.json"),
		JSON.stringify({
			resourceRoots: [],
			defaultTranscodeProfileId: "builtin:fast",
		}),
	);
	await service.refreshTranscodeValidation();
	expect(service.transcodeRevision).toBe(revision);
	expect(service.settings.defaultTranscodeProfileId).toBe("custom:small");
	expect(transcodeProfileCatalog(service).selectionAvailable).toBe(true);
	const restarted = await load();
	expect(restarted.transcodeRevision).not.toBe(revision);
	expect(restarted.settings.defaultTranscodeProfileId).toBe("builtin:fast");
	expect(restarted.transcodeProfiles.some((p) => p.id === "custom:small")).toBe(
		false,
	);
});

test("detected unsupported profiles cannot be selected; unverified profiles remain selectable", async () => {
	const service = await load();
	await service.configureTranscodeValidation(async (profiles) => ({
		profiles: structuredClone(
			profiles,
		) as typeof service.transcodeProfiles extends readonly (infer T)[]
			? T[]
			: never,
		validation: {
			"builtin:fast": {
				status: "unsupported",
				issues: [{ field: "video.encoder", message: "Missing encoder." }],
			},
		},
	}));
	await expect(service.selectTranscodeProfile("builtin:fast")).rejects.toThrow(
		"existing transcode profile",
	);
	await service.selectTranscodeProfile("builtin:compact");
	expect(transcodeProfileCatalog(service).selectedProfileId).toBe(
		"builtin:compact",
	);
});

test("legacy preparationMode is ignored and removed on the next settings write", async () => {
	await writeFile(
		join(directory, "settings.json"),
		JSON.stringify({ resourceRoots: [], preparationMode: "fast" }),
	);
	const service = await load();
	expect(service.settings).not.toHaveProperty("preparationMode");
	await service.selectTranscodeProfile("builtin:fast");
	expect(
		JSON.parse(await readFile(join(directory, "settings.json"), "utf8")),
	).not.toHaveProperty("preparationMode");
});

test("HTTP catalog exposes the startup snapshot and has no reload endpoint", async () => {
	const service = await load();
	const app = createHttpApp({
		logger: pino({ enabled: false }),
		configuration: service,
		config: service.deployment,
	});
	const headers = { host: `127.0.0.1:${service.deployment.port}` };
	try {
		const before = await app.inject({
			method: "GET",
			url: "/api/transcode-profiles",
			headers,
		});
		expect(before.statusCode).toBe(200);
		expect(before.json().profiles[0]).toMatchObject({
			videoCodec: "h264",
			audioCodec: "aac",
			validation: { status: "unverified" },
		});
		expect(before.json()).not.toHaveProperty("preparationMode");
		expect(
			(
				await app.inject({
					method: "PUT",
					url: "/api/transcode-profiles/selection",
					headers,
					payload: { profileId: "builtin:balanced", preparationMode: "fast" },
				})
			).statusCode,
		).toBe(400);
		await writeProfiles([customProfile()]);
		const removed = await app.inject({
			method: "POST",
			url: "/api/transcode-profiles/reload",
			headers,
		});
		expect(removed.statusCode).toBe(404);
		const unchanged = await app.inject({
			method: "GET",
			url: "/api/transcode-profiles",
			headers,
		});
		expect(unchanged.json()).toEqual(before.json());
	} finally {
		await app.close();
	}
});

test("the documented v2 YAML example loads", async () => {
	const source = await readFile(
		new URL(
			"../../../../../docs/examples/transcode-profiles-example.yaml",
			import.meta.url,
		),
		"utf8",
	);
	expect(parseTranscodeProfiles(source)[0]).toMatchObject({
		id: "custom:hevc-quality",
		video: { options: { "x265-params": "aq-mode=3:psy-rd=2.0" } },
		audio: { channels: 2 },
	});
});
