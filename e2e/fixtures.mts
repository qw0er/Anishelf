import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test as base } from "@playwright/test";

const run = promisify(execFile);
export const repository = fileURLToPath(new URL("../", import.meta.url));
const serverDist = join(repository, "apps/server/dist");

// An episode number alone gives automatic identification no title to look up.
export const sampleName = "01.mkv";

export const secondEpisode = "02.mkv";
export const fixtureWorkId = 12345;
export const fixtureWork = "Playwright Fixture Anime";
export const embeddedCue = "Embedded regression cue";
export const offlineCue = "Cached sidecar regression cue";

type MediaFixture = "single" | "subtitles" | "episodes" | "offline";

export const test = base.extend<{
	media: MediaFixture;
	configured: boolean;
	hostWeb: boolean;
	backend: {
		origin: string;
		password: string;
		mediaDirectory: string;
		directory: string;
		logPath: string;
		close(): Promise<void>;
	};
}>({
	media: ["single", { option: true }],
	configured: [true, { option: true }],
	hostWeb: [true, { option: true }],
	backend: async ({ media, configured, hostWeb }, use, testInfo) => {
		const directory = await mkdtemp(join(tmpdir(), "anishelf-e2e-"));
		const mediaDirectory = join(directory, "media");
		const logPath = join(directory, "backend.log");
		const ffmpeg = process.env.ANISHELF_FFMPEG_PATH || "ffmpeg";
		const env = {
			PATH: process.env.PATH,
			PATHEXT: process.env.PATHEXT,
			ANISHELF_DATA_DIR: join(directory, "data"),
			ANISHELF_HOST: "127.0.0.1",
			ANISHELF_LOG_DESTINATION: "file",
			ANISHELF_LOG_LEVEL: "debug",
			ANISHELF_LOG_PATH: logPath,
			ANISHELF_FRONTEND_DIR: hostWeb
				? join(repository, "apps/web/dist")
				: undefined,
			ANISHELF_INITIAL_RESOURCE_ROOTS: configured ? mediaDirectory : undefined,
			ANISHELF_FFMPEG_PATH: process.env.ANISHELF_FFMPEG_PATH,
			ANISHELF_FFPROBE_PATH: process.env.ANISHELF_FFPROBE_PATH,
		};
		try {
			await mkdir(mediaDirectory);
			await generateMedia(ffmpeg, mediaDirectory, media);
			const { stdout } = await run(
				process.execPath,
				[join(serverDist, "cli.js"), "auth", "reset-password"],
				{ env, timeout: 15_000 },
			);
			const password = /^New password: (\S+)$/m.exec(stdout)?.[1];
			if (!password) throw new Error("Test password setup failed.");

			const entry = pathToFileURL(
				join(serverDist, "app/bootstrap/start-backend.js"),
			);
			const {
				startBackend,
			}: typeof import("../apps/server/src/app/bootstrap/start-backend.js") =
				await import(entry.href);
			const backend = await withBangumiFixture(media, () =>
				startBackend({ env, listenPort: 0 }),
			);
			try {
				await use({ ...backend, password, mediaDirectory, directory, logPath });
			} finally {
				await backend.close();
			}
		} finally {
			if (testInfo.status !== testInfo.expectedStatus) {
				await testInfo.attach("backend log", { path: logPath }).catch(() => {});
			}
			await rm(directory, { recursive: true, force: true });
		}
	},
	baseURL: async ({ backend }, use) => {
		await use(backend.origin);
	},
});

async function generateMedia(
	ffmpeg: string,
	directory: string,
	media: MediaFixture,
) {
	const subtitles = media === "subtitles";
	const embedded = join(directory, "embedded.srt");
	if (subtitles) {
		await writeFile(
			embedded,
			`1\n00:00:07,000 --> 00:00:16,000\n${embeddedCue}\n`,
		);
		await writeFile(
			join(directory, "01.external.ass"),
			`[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,sans-serif,22,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,12,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:07.00,0:00:16.00,Default,,0,0,0,,{\\an7\\pos(150,80)\\p1}m 0 0 l 20 0 20 20 0 20
`,
		);
	}
	if (media === "offline") {
		await writeFile(
			join(directory, "01.external.srt"),
			`1\n00:00:05,000 --> 00:00:18,000\n${offlineCue}\n`,
		);
	}

	await run(
		ffmpeg,
		[
			"-nostdin",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=128x72:rate=12",
			...(subtitles ? ["-i", embedded] : []),
			"-t",
			media === "episodes" ? "38" : "24",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-g",
			"12",
			...(subtitles
				? ["-c:s", "srt", "-metadata:s:s:0", "title=Embedded SRT"]
				: []),
			join(directory, sampleName),
		],
		{ timeout: 15_000 },
	);
	if (subtitles) await rm(embedded);
	if (media === "episodes") {
		await copyFile(join(directory, sampleName), join(directory, secondEpisode));
	}
}

async function withBangumiFixture<T>(
	media: MediaFixture,
	start: () => Promise<T>,
) {
	if (media !== "episodes") return start();
	const fetch = globalThis.fetch;
	// The backend captures fetch when constructing its provider clients.
	globalThis.fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.origin === "https://api.bgm.tv") {
			if (url.pathname === "/v0/me")
				return Response.json({
					id: 1,
					username: "fixture",
					nickname: "Fixture",
				});
			if (url.pathname === "/v0/users/fixture/collections")
				return Response.json({ total: 0, limit: 50, offset: 0, data: [] });
			if (url.pathname !== `/v0/subjects/${fixtureWorkId}`)
				return new Response(null, { status: 404 });
			return Response.json({
				id: fixtureWorkId,
				type: 2,
				name: fixtureWork,
				name_cn: "",
				summary: "Deterministic catalogue fixture.",
				date: "2025-01-01",
				platform: "TV",
				eps: 2,
				images: null,
				rating: { score: 0 },
				tags: [],
			});
		}
		return fetch(input, init);
	};
	try {
		return await start();
	} finally {
		globalThis.fetch = fetch;
	}
}
