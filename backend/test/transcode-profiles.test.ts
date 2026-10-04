import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { Check } from "typebox/value";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createHttpApp } from "../src/bootstrap/http.js";
import { TranscodeProfileSchema } from "../src/contracts/schemas/transcode-profiles.js";
import { ConfigurationService } from "../src/modules/configuration/application/service.js";
import { builtinTranscodeProfiles } from "../src/modules/configuration/domain/transcode-profiles.js";
import { parseTranscodeProfiles } from "../src/modules/configuration/infrastructure/transcode-profiles.js";

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
		join(directory, "transcode-profiles.json"),
		JSON.stringify({ version: 1, profiles }),
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
	]);
	expect(service.getTranscodeProfileCatalog()).toMatchObject({
		selectedProfileId: "builtin:balanced",
		selectionAvailable: true,
	});
	expect(service.settings).toEqual({ resourceRoot: null });
	await expect(
		readFile(join(directory, "settings.json")),
	).rejects.toMatchObject({ code: "ENOENT" });
	await expect(
		readFile(join(directory, "transcode-profiles.json")),
	).rejects.toMatchObject({ code: "ENOENT" });
});

test("external profiles merge into an immutable startup snapshot and choices survive restart", async () => {
	await writeProfiles([customProfile()]);
	const service = await load();
	await service.selectTranscodeProfile("custom:small");
	expect(
		JSON.parse(await readFile(join(directory, "settings.json"), "utf8")),
	).toEqual({ resourceRoot: null, defaultTranscodeProfileId: "custom:small" });
	expect((await load()).getTranscodeProfileCatalog()).toMatchObject({
		selectedProfileId: "custom:small",
		selectionAvailable: true,
	});
	expect(Object.isFrozen(service.transcodeProfiles[2]?.video)).toBe(true);
	await writeProfiles([]);
	expect(service.getTranscodeProfileCatalog().selectionAvailable).toBe(true);
	const reload = await load();
	expect(reload.getTranscodeProfileCatalog()).toMatchObject({
		selectedProfileId: "custom:small",
		selectionAvailable: false,
	});
	await reload.update({ ...reload.settings, scanIntervalMinutes: 0 });
	expect(reload.settings.defaultTranscodeProfileId).toBe("custom:small");
	await reload.selectTranscodeProfile(null);
	expect(reload.getTranscodeProfileCatalog()).toMatchObject({
		selectedProfileId: "builtin:balanced",
		selectionAvailable: true,
	});
	expect(reload.settings.defaultTranscodeProfileId).toBeUndefined();
});

test.each([
	"{",
	JSON.stringify({ version: 2, profiles: [] }),
	JSON.stringify({ version: 1, profiles: [builtinTranscodeProfiles[0]] }),
	JSON.stringify({ version: 1, profiles: [customProfile(), customProfile()] }),
	JSON.stringify({
		version: 1,
		profiles: [{ ...customProfile(), args: ["-i", "other"] }],
	}),
	JSON.stringify({
		version: 1,
		profiles: [
			{ ...customProfile(), video: { ...customProfile().video, crf: 52 } },
		],
	}),
	JSON.stringify({
		version: 1,
		profiles: [
			{
				...customProfile(),
				video: { ...customProfile().video, preset: "invalid" },
			},
		],
	}),
	JSON.stringify({
		version: 1,
		profiles: [{ ...customProfile(), id: "custom:../file" }],
	}),
	JSON.stringify({
		version: 1,
		profiles: [{ ...customProfile(), name: "   " }],
	}),
	JSON.stringify({
		version: 1,
		profiles: [
			{
				...customProfile(),
				video: { ...customProfile().video, maxHeight: 721 },
			},
		],
	}),
])(
	"rejects malformed or conflicting administrator configuration: %s",
	async (source) => {
		expect(() => parseTranscodeProfiles(source)).toThrowError(
			expect.objectContaining({ code: "CONFIG_INVALID" }),
		);
		await writeFile(join(directory, "transcode-profiles.json"), source);
		await expect(load()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
	},
);

test("unreadable external file and failed selection writes fail without changing the snapshot", async () => {
	await mkdir(join(directory, "transcode-profiles.json"));
	await expect(load()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
	await rm(join(directory, "transcode-profiles.json"), { recursive: true });
	const service = await load();
	const before = service.snapshot;
	await mkdir(join(directory, "settings.json"));
	await expect(
		service.selectTranscodeProfile("builtin:fast"),
	).rejects.toMatchObject({ code: "CONFIG_WRITE_FAILED" });
	expect(service.snapshot).toBe(before);
	await rm(join(directory, "settings.json"), { recursive: true });
	await service.selectTranscodeProfile("builtin:fast");
	expect(service.snapshot.settings.defaultTranscodeProfileId).toBe(
		"builtin:fast",
	);
});

test("catalog and selection APIs expose names only, validate IDs, and preserve existing settings", async () => {
	await writeProfiles([customProfile()]);
	const service = await load();
	await service.update({ resourceRoot: null, scanIntervalMinutes: 17 });
	const app = createHttpApp({
		configuration: service,
		config: service.deployment,
		logger: pino({ enabled: false }),
	});
	try {
		const response = await app.inject({
			headers: { host: `127.0.0.1:${service.deployment.port}` },
			url: "/api/transcode-profiles",
		});
		expect(response.statusCode).toBe(200);
		expect(response.json().profiles[2]).toEqual({
			id: "custom:small",
			name: "Small",
			description: "Smaller Web copy.",
			source: "custom",
			usage: "preparation",
		});
		const select = await app.inject({
			headers: { host: `127.0.0.1:${service.deployment.port}` },
			method: "PUT",
			url: "/api/transcode-profiles/selection",
			payload: { profileId: "custom:small" },
		});
		expect(select.statusCode).toBe(200);
		expect(select.json().selectedProfileId).toBe("custom:small");
		expect(service.settings).toEqual({
			resourceRoot: null,
			scanIntervalMinutes: 17,
			defaultTranscodeProfileId: "custom:small",
		});
		for (const payload of [
			{ profileId: "custom:missing" },
			{ profileId: "builtin:fast", video: {} },
			{},
			{ profileId: 1 },
		]) {
			const rejected = await app.inject({
				headers: { host: `127.0.0.1:${service.deployment.port}` },
				method: "PUT",
				url: "/api/transcode-profiles/selection",
				payload,
			});
			expect(rejected.statusCode).toBe(400);
		}
		expect(service.settings.defaultTranscodeProfileId).toBe("custom:small");
		const reset = await app.inject({
			headers: { host: `127.0.0.1:${service.deployment.port}` },
			method: "PUT",
			url: "/api/transcode-profiles/selection",
			payload: { profileId: null },
		});
		expect(reset.statusCode).toBe(200);
		expect(reset.json().selectedProfileId).toBe("builtin:balanced");
	} finally {
		await app.close();
	}
});

const videoVariants = [
	{ encoder: "libx264", codec: "h264", crf: 23, preset: "medium" },
	{ encoder: "libx265", codec: "hevc", crf: 28, preset: "slow" },
	{ encoder: "libsvtav1", codec: "av1", crf: 35, preset: 8 },
	{ encoder: "libaom-av1", codec: "av1", crf: 32, cpuUsed: 6 },
	{ encoder: "libvpx-vp9", codec: "vp9", crf: 32, cpuUsed: 4 },
	{ encoder: "h264_nvenc", codec: "h264", bitrateKbps: 5000 },
	{ encoder: "hevc_nvenc", codec: "hevc", bitrateKbps: 4000 },
	{ encoder: "av1_nvenc", codec: "av1", bitrateKbps: 3000 },
	{ encoder: "h264_qsv", codec: "h264", bitrateKbps: 5000 },
	{ encoder: "hevc_qsv", codec: "hevc", bitrateKbps: 4000 },
	{ encoder: "av1_qsv", codec: "av1", bitrateKbps: 3000 },
	{ encoder: "h264_videotoolbox", codec: "h264", bitrateKbps: 5000 },
	{ encoder: "hevc_videotoolbox", codec: "hevc", bitrateKbps: 4000 },
];
const audioVariants = [
	{ encoder: "aac", codec: "aac", bitrateKbps: 192 },
	{ encoder: "libopus", codec: "opus", bitrateKbps: 128 },
	{ encoder: "libvorbis", codec: "vorbis", bitrateKbps: 160 },
	{ encoder: "flac", codec: "flac", compressionLevel: 8 },
	{ encoder: "alac", codec: "alac" },
	{ encoder: "pcm_s16le", codec: "pcm_s16le" },
];

test("loads software and hardware declarations without requiring installed encoders", async () => {
	const profiles = videoVariants.map((video, index) => ({
		...customProfile(),
		id: `custom:variant-${index}`,
		container: "matroska",
		video: { ...video, pixelFormat: index === 1 ? "yuv420p10le" : "yuv420p" },
	}));
	await writeProfiles(profiles);
	const service = await load();
	expect(service.transcodeProfiles.slice(2)).toEqual(profiles);
	await service.selectTranscodeProfile("custom:variant-1");
	expect((await load()).getTranscodeProfileCatalog()).toMatchObject({
		selectedProfileId: "custom:variant-1",
		selectionAvailable: true,
	});
	expect(service.getTranscodeProfileCatalog().profiles[3]).not.toHaveProperty(
		"video",
	);
});

test.each(audioVariants)(
	"accepts the declared $encoder audio parameters",
	(audio) => {
		const profile = {
			...customProfile(),
			container: "matroska",
			audio: { ...audio, channels: "preserve" },
		};
		expect(
			parseTranscodeProfiles(
				JSON.stringify({ version: 1, profiles: [profile] }),
			),
		).toEqual([profile]);
	},
);

test.each(["mp4", "webm", "matroska", "mov"])(
	"accepts %s packaging declarations",
	(container) => {
		const profile = {
			...customProfile(),
			container,
			video: {
				encoder: "libsvtav1",
				codec: "av1",
				pixelFormat: "yuv420p10le",
				crf: 40,
				preset: 10,
			},
			audio: {
				encoder: "libopus",
				codec: "opus",
				bitrateKbps: 128,
				channels: "stereo",
			},
		};
		expect(Check(TranscodeProfileSchema, profile)).toBe(true);
	},
);

test.each([
	{ encoder: "libx265", codec: "h264", crf: 28, preset: "medium" },
	{ encoder: "libx265", codec: "hevc", crf: 52, preset: "medium" },
	{ encoder: "libsvtav1", codec: "av1", crf: 64, preset: 8 },
	{ encoder: "libsvtav1", codec: "av1", crf: 35, preset: "medium" },
	{ encoder: "libsvtav1", codec: "av1", crf: 35, preset: 14 },
	{ encoder: "libaom-av1", codec: "av1", crf: 32, cpuUsed: 9 },
	{ encoder: "libvpx-vp9", codec: "vp9", crf: 32, cpuUsed: 6 },
	{ encoder: "hevc_nvenc", codec: "hevc", bitrateKbps: 4000, crf: 28 },
	{ encoder: "hevc_videotoolbox", codec: "hevc", bitrateKbps: 0 },
	{ encoder: "h264_qsv", codec: "h264", bitrateKbps: 5000, preset: "medium" },
	{ encoder: "unknown", codec: "hevc", bitrateKbps: 4000 },
])("rejects mismatched or invalid video options: %j", (video) => {
	const profile = {
		...customProfile(),
		video: { ...video, pixelFormat: "yuv420p" },
	};
	expect(() =>
		parseTranscodeProfiles(JSON.stringify({ version: 1, profiles: [profile] })),
	).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
});

test.each([
	{ encoder: "libopus", codec: "aac", bitrateKbps: 128 },
	{ encoder: "libopus", codec: "opus", bitrateKbps: 511 },
	{ encoder: "flac", codec: "flac", compressionLevel: 13 },
	{ encoder: "flac", codec: "flac", compressionLevel: 8, bitrateKbps: 192 },
	{ encoder: "alac", codec: "alac", bitrateKbps: 192 },
])("rejects mismatched or invalid audio options: %j", (audio) => {
	const profile = {
		...customProfile(),
		audio: { ...audio, channels: "preserve" },
	};
	expect(Check(TranscodeProfileSchema, profile)).toBe(false);
});

test.each(["-pix_fmt yuv420p", "../pixel", "yuv420p;command"])(
	"rejects malformed pixel format tokens: %s",
	(pixelFormat) => {
		expect(
			Check(TranscodeProfileSchema, {
				...customProfile(),
				video: { ...customProfile().video, pixelFormat },
			}),
		).toBe(false);
	},
);
