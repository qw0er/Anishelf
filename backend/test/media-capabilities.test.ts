import { afterEach, expect, test, vi } from "vitest";
import {
	detectMediaCapabilities,
	parseMediaCapabilities,
} from "../src/platform/media/capabilities.js";
import { mediaToolPolicy } from "../src/platform/media/policy.js";
import * as processTools from "../src/platform/media/process.js";
import { MediaTools } from "../src/platform/media/tools.js";
import {
	hasMediaCapability,
	type MediaCapabilityKind,
	mediaCapabilityKinds,
} from "../src/shared/media-capabilities.js";

const listings: Record<MediaCapabilityKind, string> = {
	codecs:
		"Codecs:\n D..... = Decoding supported\n -------\n DEV.L. hevc HEVC (decoders: hevc hevc_cuvid) (encoders: libx265 hevc_nvenc)\n ..D... bin_data binary data\n DES... subrip SubRip subtitle\n",
	encoders:
		"Encoders:\n V..... = Video\n ------\n V....D libx265 libx265 H.265 (codec hevc)\n V....D hevc_nvenc NVIDIA NVENC hevc encoder (codec hevc)\n A....D libopus libopus Opus (codec opus)\n S..... srt SubRip subtitle (codec subrip)\n",
	decoders:
		"Decoders:\n ------\n VFS..D hevc HEVC\n V..... hevc_cuvid Nvidia CUVID HEVC decoder (codec hevc)\n A....D opus Opus\n S..... srt SubRip (codec subrip)\n",
	muxers:
		"Formats:\n D.. = Demuxing supported\n .E. = Muxing supported\n ..d = Is a device\n ---\n  E  hls Apple HTTP Live Streaming\n  E  mp4 MP4\n DE matroska,webm Matroska / WebM\n",
	demuxers:
		"Formats:\n ---\n D  mov,mp4,m4a,3gp,3g2,mj2 QuickTime / MOV\n D  matroska,webm Matroska / WebM\n",
	filters:
		"Filters:\n T.. = Timeline support\n ------\n TS scale V->V Scale input\n ... pad V->V Pad video\n .. anull A->A Pass audio\n .. testsrc |->V Video source\n",
	bitstreamFilters: "Bitstream filters:\nhevc_mp4toannexb\naac_adtstoasc\n",
	protocols:
		"Supported file protocols:\nInput:\n file\n https\nOutput:\n file\n pipe\n",
	devices:
		"Devices:\n ---\n DE alsa ALSA audio\n D  video4linux2,v4l2 Video4Linux\n D  libcdio\n",
	pixelFormats:
		"Pixel formats:\nFLAGS NAME NB_COMPONENTS BITS_PER_PIXEL BIT_DEPTHS\n-----\nIO... yuv420p 3 12 8-8-8\n..H.. cuda 0 0 0\nIO... rgb24 3 24\n",
	sampleFormats: "name depth\nu8 8\nfltp 32\ns64p 64\n",
	hardwareAccelerations:
		"Hardware acceleration methods:\ncuda\nvaapi\nvulkan\n",
};
const switches: Record<string, MediaCapabilityKind> = {
	"-codecs": "codecs",
	"-encoders": "encoders",
	"-decoders": "decoders",
	"-muxers": "muxers",
	"-demuxers": "demuxers",
	"-filters": "filters",
	"-bsfs": "bitstreamFilters",
	"-protocols": "protocols",
	"-devices": "devices",
	"-pix_fmts": "pixelFormats",
	"-sample_fmts": "sampleFormats",
	"-hwaccels": "hardwareAccelerations",
};
const available = {
	available: true as const,
	path: "/private/tools/ffmpeg",
	version: "ffmpeg version test",
};
const statuses = {
	ffmpeg: available,
	ffprobe: { ...available, version: "ffprobe version test" },
};
afterEach(() => vi.restoreAllMocks());

test.each(mediaCapabilityKinds)(
	"parses all advertised %s without admitting legends",
	(kind) => {
		const entries = parseMediaCapabilities(kind, listings[kind]);
		expect(entries.length).toBeGreaterThan(0);
		expect(
			entries.every(
				(entry) =>
					entry.name !== "=" && !entry.description.includes("supported\n"),
			),
		).toBe(true);
		expect(entries.map((entry) => entry.name)).toEqual(
			[...new Set(entries.map((entry) => entry.name))].sort(),
		);
	},
);

test("retains codec identities, all stream kinds, format aliases and protocol direction", () => {
	expect(parseMediaCapabilities("encoders", listings.encoders)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				name: "libx265",
				codec: "hevc",
				mediaType: "video",
			}),
			expect.objectContaining({
				name: "libopus",
				codec: "opus",
				mediaType: "audio",
			}),
			expect.objectContaining({
				name: "srt",
				codec: "subrip",
				mediaType: "subtitle",
			}),
		]),
	);
	expect(parseMediaCapabilities("codecs", listings.codecs)).toContainEqual(
		expect.objectContaining({
			name: "bin_data",
			mediaType: "data",
			flags: "..D...",
		}),
	);
	expect(
		parseMediaCapabilities("demuxers", listings.demuxers).map(
			(entry) => entry.name,
		),
	).toEqual(["3g2", "3gp", "m4a", "matroska", "mj2", "mov", "mp4", "webm"]);
	expect(
		parseMediaCapabilities("protocols", listings.protocols),
	).toContainEqual(expect.objectContaining({ name: "file", flags: "IO" }));
});

test("accepts empty component lists, but rejects malformed or unrecognized output", () => {
	expect(
		parseMediaCapabilities(
			"hardwareAccelerations",
			"Hardware acceleration methods:\n",
		),
	).toEqual([]);
	expect(parseMediaCapabilities("encoders", "Encoders:\n ------\n")).toEqual(
		[],
	);
	for (const output of [
		"",
		"not an FFmpeg inventory",
		"Encoders:\n ------\ncorrupt row\n",
		"Encoders:\n truncated",
	]) {
		expect(() => parseMediaCapabilities("encoders", output)).toThrow();
	}
	expect(() =>
		parseMediaCapabilities(
			"protocols",
			"Supported file protocols:\nInput:\nfile\n",
		),
	).toThrow();
});

test("isolates failed categories, bounds enumeration and distinguishes absent from unknown", async () => {
	let active = 0;
	let maximumActive = 0;
	const run = vi
		.spyOn(processTools, "runTool")
		.mockImplementation(async (_path, args, options) => {
			expect(options).toMatchObject({
				timeoutMs: mediaToolPolicy.detectionTimeoutMs,
				maxBytes: mediaToolPolicy.capabilityMaximumBytes,
			});
			active++;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active--;
			const kind = switches[args[1] as string];
			if (!kind) throw new Error("unexpected command");
			if (kind === "encoders")
				throw new Error("secret executable path /private/tools/ffmpeg");
			return listings[kind];
		});
	const result = await detectMediaCapabilities(statuses, mediaToolPolicy);
	expect(run).toHaveBeenCalledTimes(mediaCapabilityKinds.length);
	expect(maximumActive).toBe(mediaToolPolicy.capabilityConcurrency);
	expect(result.status).toBe("partial");
	expect(result.inventory.encoders).toMatchObject({
		status: "failed",
		entries: [],
	});
	expect(hasMediaCapability(result.inventory.encoders, "libx264")).toBeNull();
	expect(hasMediaCapability(result.inventory.muxers, "missing")).toBe(false);
	expect(result.inventory.hardwareAccelerations.status).toBe("ready");
	expect(result.runtimeValidation).toBe("unverified");
	expect(JSON.stringify(result)).not.toContain("/private/");
});

test("marks complete detection failure and missing FFmpeg separately", async () => {
	const run = vi
		.spyOn(processTools, "runTool")
		.mockResolvedValue("not an inventory");
	expect(
		(await detectMediaCapabilities(statuses, mediaToolPolicy)).status,
	).toBe("failed");
	run.mockClear();
	const result = await detectMediaCapabilities(
		{ ...statuses, ffmpeg: { available: false, message: "secret path" } },
		mediaToolPolicy,
	);
	expect(result.status).toBe("unavailable");
	expect(result.tools.ffprobe.available).toBe(true);
	expect(
		Object.values(result.inventory).every(
			(category) => category.status === "unavailable",
		),
	).toBe(true);
	expect(run).not.toHaveBeenCalled();
});

test("deduplicates concurrent inventories, preserves partial results and isolates returned snapshots", async () => {
	// Concurrent discovery can finish in either order; identify the tool by path.
	vi.spyOn(processTools, "resolveExecutable").mockImplementation(
		async (command) => command,
	);
	const run = vi
		.spyOn(processTools, "runTool")
		.mockImplementation(async (path, args) => {
			if (args[0] === "-version")
				return path === "/test/ffmpeg"
					? "ffmpeg version test"
					: "ffprobe version test";
			const kind = switches[args[1] as string];
			if (!kind) throw new Error("unexpected command");
			return kind === "filters" ? "broken output" : listings[kind];
		});
	const tools = await MediaTools.create({
		ffmpegPath: "/test/ffmpeg",
		ffprobePath: "/test/ffprobe",
	});
	run.mockClear();
	const [first, second] = await Promise.all([
		tools.capabilities(),
		tools.capabilities(),
	]);
	expect(first.status).toBe("partial");
	expect(first).toEqual(second);
	expect(first).not.toBe(second);
	first.inventory.encoders.entries.length = 0;
	const third = await tools.capabilities();
	expect(third.inventory.encoders.entries.length).toBeGreaterThan(0);
	expect(third.inventory.filters.status).toBe("failed");
	expect(run).toHaveBeenCalledTimes(mediaCapabilityKinds.length);
});

test("enumerates the installed FFmpeg build with bounded child processes", async () => {
	const tools = await MediaTools.create();
	if (!tools.status.ffmpeg.available) return;
	const result = await tools.capabilities();
	expect(result.status).toBe("ready");
	expect(result.tools.ffmpeg.version).toMatch(/^ffmpeg version /);
	expect(result.inventory.codecs.entries.length).toBeGreaterThan(3);
	expect(
		result.inventory.encoders.entries.some(
			(entry) => entry.mediaType === "subtitle",
		),
	).toBe(true);
	expect(
		result.inventory.decoders.entries.some((entry) => entry.codec === "hevc"),
	).toBe(true);
	expect(result.inventory.protocols.entries).toContainEqual(
		expect.objectContaining({ name: "file", flags: "IO" }),
	);
	expect(result.detectedAtMs).not.toBeNull();
	expect(JSON.stringify(result)).not.toContain(tools.status.ffmpeg.path);
});
