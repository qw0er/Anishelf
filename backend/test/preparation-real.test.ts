import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pino from "pino";
import { expect, test, vi } from "vitest";
import { ApplicationDatabase } from "../src/bootstrap/database.js";
import { createHttpApp } from "../src/bootstrap/http.js";
import { createLibraryModule } from "../src/bootstrap/library.js";
import { builtinTranscodeProfiles } from "../src/modules/configuration/public.js";
import { LibraryIndex } from "../src/modules/library/infrastructure/index.js";
import { MediaInspectionApplication } from "../src/modules/media-inspection/application/inspection.js";
import { MediaPlanningApplication } from "../src/modules/media-planning/application/planning.js";
import { MediaProcessingApplication } from "../src/modules/media-processing/application/processing.js";
import { PlaybackApplication } from "../src/modules/playback/application/playback.js";
import { PreparationApplication } from "../src/modules/preparation/application/preparation.js";
import {
	FfmpegExecutionAdapter,
	MediaTools,
} from "../src/platform/media/index.js";
import { settingsStore } from "./settings-store.js";

const run = promisify(execFile);
function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Missing fixture value");
	return value;
}
test("real prepared media covers all processing branches, copy preservation, HTTP seeking and restart reuse", async (context) => {
	const tools = await MediaTools.create();
	if (!tools.status.ffmpeg.available || !tools.status.ffprobe.available) {
		context.skip();
		return;
	}
	const ffmpeg = tools.status.ffmpeg.path;
	const ffprobe = tools.status.ffprobe.path;
	const root = await mkdtemp(join(tmpdir(), "anishelf-preparation-real-"));
	const dataDir = join(root, "data");
	const media = join(root, "media");
	await mkdir(media);
	const sourcePath = join(media, "真实样本 $(literal).mkv");
	const logger = pino({ enabled: false });
	const index = new LibraryIndex();
	const library = createLibraryModule({
		index,
		configuration: settingsStore(media),
		logger,
	});
	const inspection = new MediaInspectionApplication({
		sources: library.sources,
		tools,
	});
	const database = ApplicationDatabase.open(dataDir);
	const compatibility = new MediaPlanningApplication({
		sources: library.sources,
		inspection,
		profiles: builtinTranscodeProfiles,
	});
	const playback = new PlaybackApplication({
		sources: library.sources,
		repository: database.playback,
		logger,
	});
	let processing: MediaProcessingApplication | undefined;
	let preparation: PreparationApplication | undefined;
	let app: ReturnType<typeof createHttpApp> | undefined;
	const headers = { host: "127.0.0.1:3000" };
	async function start() {
		processing = new MediaProcessingApplication({
			sources: library.sources,
			inspection,
			tools,
			executor: new FfmpegExecutionAdapter(tools.status.ffmpeg),
			dataDir,
		});
		preparation = new PreparationApplication({
			sources: library.sources,
			planning: compatibility,
			processing,
			repository: database.preparation,
			profiles: builtinTranscodeProfiles,
			dataDir,
			logger,
		});
		await preparation.initialize();
		app = createHttpApp({
			config: { host: "127.0.0.1", port: 3000 },
			logger,
			preparation,
		});
	}
	try {
		await run(
			ffmpeg,
			[
				"-nostdin",
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"testsrc2=size=160x90:rate=24",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440:sample_rate=48000",
				"-t",
				"2",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"aac",
				sourcePath,
			],
			{ timeout: 30000 },
		);
		await library.startScan();
		await library.waitForCompletion();
		const file = [...index.snapshot.entriesById.values()].find(
			(entry) => entry.kind === "file",
		);
		if (!file) throw new Error("Missing source");
		const source = await library.sources.resolveSource(file.id);
		const profile = builtinTranscodeProfiles[0];
		if (!profile) throw new Error("Missing profile");
		await start();
		async function packets(path: string, selector: "v" | "a") {
			const output = await run(
				ffprobe,
				[
					"-v",
					"error",
					"-select_streams",
					selector,
					"-show_packets",
					"-show_data_hash",
					"sha256",
					"-show_entries",
					"packet=data_hash",
					"-of",
					"json",
					path,
				],
				{ timeout: 30000 },
			);
			return (JSON.parse(output.stdout).packets as { data_hash: string }[]).map(
				(packet) => packet.data_hash,
			);
		}
		const originals = {
			v: await packets(sourcePath, "v"),
			a: await packets(sourcePath, "a"),
		};
		const starts = vi.spyOn(required(processing), "start");
		for (const [video, audio, mode] of [
			[false, false, "remux"],
			[false, true, "transcode-audio"],
			[true, false, "transcode-video"],
			[true, true, "transcode"],
		] as const) {
			const description = await compatibility.inspect({
				fileId: file.id,
				sourceVersion: source.identity.sourceVersion,
				output: { profileId: profile.id, target: "file" },
			});
			const request = {
				sourceVersion: description.sourceVersion,
				descriptionId: description.descriptionId,
				output: { profileId: profile.id, target: "file" as const },
				evidence: description.queries.map((query) => {
					const status =
						query.id.startsWith("original") ||
						(query.id === "copy-video" && video) ||
						(query.id === "copy-audio" && audio)
							? ("unsupported" as const)
							: ("supported" as const);
					return {
						id: query.id,
						status,
						reason:
							status === "supported"
								? ("browser-supported" as const)
								: ("browser-rejected" as const),
						smooth: null,
					};
				}),
			};
			const response = await required(app).inject({
				method: "POST",
				url: `/api/files/${file.id}/preparations`,
				headers,
				payload: request,
			});
			expect(response.statusCode).toBe(200);
			const id = response.json().task.id as string;
			await vi.waitFor(
				async () =>
					expect((await required(preparation).get(id)).status).toBe("ready"),
				{ timeout: 15000 },
			);
			const task = await required(preparation).get(id);
			expect(task.mode).toBe(mode);
			const prepared = await required(app).inject({
				url: required(task.resource?.url),
				headers,
			});
			expect(prepared.statusCode).toBe(200);
			const path = join(root, `${mode}.mp4`);
			await writeFile(path, prepared.rawPayload);
			const info = await tools.probe(path);
			expect(info.duration).toBeCloseTo(2, 0);
			if (!video) expect(await packets(path, "v")).toEqual(originals.v);
			if (!audio) expect(await packets(path, "a")).toEqual(originals.a);
			await run(
				ffmpeg,
				[
					"-nostdin",
					"-v",
					"error",
					"-ss",
					"0.75",
					"-i",
					path,
					"-frames:v",
					"1",
					"-f",
					"null",
					"-",
				],
				{ timeout: 30000 },
			);
			const range = await required(app).inject({
				url: required(task.resource?.url),
				headers: { ...headers, range: "bytes=0-31" },
			});
			expect(range.statusCode).toBe(206);
			expect(range.rawPayload).toEqual(prepared.rawPayload.subarray(0, 32));
			const duplicate = await required(preparation).create({
				...request,
				fileId: file.id,
			});
			expect(duplicate.kind).toBe("task");
			if (duplicate.kind === "task") expect(duplicate.task.id).toBe(id);
		}
		expect(starts).toHaveBeenCalledTimes(4);
		const tasks = await required(preparation).list();
		await required(app).close();
		await required(processing).close();
		await start();
		const restartedStarts = vi.spyOn(required(processing), "start");
		for (const task of tasks.tasks) {
			expect((await required(preparation).get(task.id)).status).toBe("ready");
			expect(
				(
					await required(app).inject({
						url: required(task.resource?.url),
						headers,
					})
				).statusCode,
			).toBe(200);
		}
		expect(restartedStarts).not.toHaveBeenCalled();
	} finally {
		await app?.close();
		await processing?.close();
		playback.close();
		await inspection.close();
		await library.close();
		database.close();
		await rm(root, { recursive: true, force: true });
	}
}, 60000);
