import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pino from "pino";
import { expect, test } from "vitest";
import { ApplicationDatabase } from "../../../../src/app/bootstrap/database.js";
import { planAutomaticPreparation } from "../../../../src/modules/media/automatic-preparation/planning.js";
import { MediaInspectionApplication } from "../../../../src/modules/media/media-inspection/application.js";
import { MediaPlanningApplication } from "../../../../src/modules/media/media-planning/application/planning.js";
import { MediaProcessingApplication } from "../../../../src/modules/media/media-processing/application/processing.js";
import { createPreparationApplication } from "../../../../src/modules/media/preparation/create.js";
import { LibraryIndex } from "../../../../src/modules/resources/library/infrastructure/index.js";
import { builtinAutoPreparationPresets } from "../../../../src/modules/system/configuration/domain/auto-preparation.js";
import { builtinTranscodeProfiles } from "../../../../src/modules/system/configuration/public.js";
import {
	FfmpegExecutionAdapter,
	MediaTools,
} from "../../../../src/platform/media/index.js";
import { MemoryInspectionStore } from "../../../support/inspection-store.js";
import { createLibraryModule } from "../../../support/library.js";
import { settingsStore } from "../../../support/settings-store.js";
import { required } from "./support.js";

const run = promisify(execFile);
test("real automatic preparation copies AAC, encodes PCM and reuses the published copy after restart", async (context) => {
	const tools = await MediaTools.create();
	if (!tools.status.ffmpeg.available || !tools.status.ffprobe.available) {
		context.skip();
		return;
	}
	const root = await mkdtemp(join(tmpdir(), "anishelf-auto-real-"));
	const media = join(root, "media");
	const dataDir = join(root, "data");
	await mkdir(media);
	const logger = pino({ enabled: false });
	const library = createLibraryModule({
		index: new LibraryIndex(),
		configuration: settingsStore(media),
		logger,
	});
	const database = ApplicationDatabase.open(dataDir);
	const inspection = new MediaInspectionApplication({
		repository: new MemoryInspectionStore(),
		sources: library.sources,
		tools,
	});
	const processing = new MediaProcessingApplication({
		sources: library.sources,
		inspection,
		tools,
		executor: new FfmpegExecutionAdapter(() => tools.toolStatus("ffmpeg")),
		dataDir,
	});
	const planning = new MediaPlanningApplication({
		sources: library.sources,
		inspection,
		profiles: builtinTranscodeProfiles,
	});
	const create = () =>
		createPreparationApplication({
			sources: library.sources,
			planning,
			processing,
			repository: database.preparation,
			profiles: builtinTranscodeProfiles,
			dataDir,
			logger,
			probe: tools.probe.bind(tools),
		});
	let preparation = create();
	try {
		await run(tools.status.ffmpeg.path, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=160x90:rate=24:duration=1",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=1",
			"-map",
			"0:v",
			"-map",
			"1:a",
			"-map",
			"1:a",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a:0",
			"aac",
			"-c:a:1",
			"pcm_s16le",
			"-metadata:s:a:0",
			"language=jpn",
			"-metadata:s:a:1",
			"language=eng",
			"-disposition:a:0",
			"default",
			"-disposition:a:1",
			"0",
			join(media, "sample.mkv"),
		]);
		await library.startScan();
		await library.waitForCompletion();
		const status = await library.getStatus();
		const file = required(
			library.readFilePage(status.revision, 0, 10).files[0],
		);
		const inspected = await inspection.inspect(file.id);
		const preset = required(builtinAutoPreparationPresets[0]);
		const profile = {
			...required(builtinTranscodeProfiles[0]),
			copyCompatibleStreams: true,
		};
		const planned = planAutomaticPreparation(
			inspected.source.identity,
			inspected.info,
			preset,
			profile,
		);
		expect(planned).toMatchObject({
			kind: "processing-required",
			mode: "transcode-audio",
			execution: {
				plan: {
					audioTracks: [
						{ execution: { action: "copy" } },
						{ execution: { action: "encode" } },
					],
				},
			},
		});
		if (planned.kind !== "processing-required")
			throw new Error("Expected preparation");
		const result = await preparation.createAutomatic(
			file.id,
			inspected.source.identity.sourceVersion,
			profile.id,
			planned,
			{ origin: "automatic", presetId: preset.id },
		);
		await expect
			.poll(
				async () => (await preparation.get(result.task.id)).task.state.status,
				{ timeout: 10000 },
			)
			.toBe("ready");
		const assets = await preparation.catalog(file.id);
		expect(
			assets.assets[0]?.info.streams
				.filter((s) => s.type === "audio")
				.map((s) => [s.codec, s.tags.language]),
		).toEqual([
			["aac", "jpn"],
			["aac", "eng"],
		]);
		expect(assets.assets[0]?.sourceAudioStreamIndices).toEqual([1, 2]);
		await preparation.close();
		preparation = create();
		await preparation.initialize();
		expect((await preparation.catalog(file.id)).assets).toHaveLength(1);
	} finally {
		await preparation.close();
		await processing.close();
		await inspection.close();
		await library.close();
		database.close();
		await rm(root, { recursive: true, force: true });
	}
}, 20000);
