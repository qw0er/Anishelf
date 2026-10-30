import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, vi } from "vitest";
import type {
	CompatibilityCheckRequest,
	CompatibilityEvidence,
} from "../../../../../src/contracts/http.js";
import { MediaInspectionApplication } from "../../../../../src/modules/media/media-inspection/application.js";
import { MediaPlanningApplication } from "../../../../../src/modules/media/media-planning/application/planning.js";
import { resolveExecutionPlan as resolvePreparationExecutionPlan } from "../../../../../src/modules/media/media-planning/public.js";
import { LibraryIndex } from "../../../../../src/modules/resources/library/infrastructure/index.js";
import {
	builtinTranscodeProfiles,
	type TranscodeProfile,
} from "../../../../../src/modules/system/configuration/public.js";
import { parseMediaInfo } from "../../../../../src/platform/media/tools.js";
import { MemoryInspectionStore } from "../../../../support/inspection-store.js";
import { createLibraryModule } from "../../../../support/library.js";
import { settingsStore } from "../../../../support/settings-store.js";

export const resolveExecutionPlan = (
	input: Parameters<typeof resolvePreparationExecutionPlan>[0],
) => resolvePreparationExecutionPlan(input, "fast");

export const cleanup: Array<() => Promise<unknown>> = [];

export async function fixture(
	audio = true,
	secondAudio = false,
	profileIndex = 0,
	preparationMode: () => "compatible" | "fast" = () => "fast",
	sourceSize?: { width: number; height: number },
) {
	const root = await mkdtemp(join(tmpdir(), "anishelf-planning-"));
	await writeFile(join(root, "source.mkv"), "source");
	const index = new LibraryIndex();
	const library = createLibraryModule({
		index,
		configuration: settingsStore(root),
		logger: pino({ enabled: false }),
	});
	await library.startScan();
	await library.waitForCompletion();
	const file = [...index.snapshot.entriesById.values()].find(
		(e) => e.kind === "file",
	);
	if (!file) throw new Error("Missing file");
	const source = await library.sources.resolveSource(file.id);
	const info = parseMediaInfo(
		JSON.stringify({
			format: { format_name: "matroska", duration: "2" },
			streams: [
				{
					index: 2,
					codec_type: "video",
					codec_name: "h264",
					width: sourceSize?.width ?? 1920,
					height: sourceSize?.height ?? 1080,
					avg_frame_rate: "24/1",
					pix_fmt: "yuv420p",
				},
				...(audio
					? [{ index: 4, codec_type: "audio", codec_name: "aac", channels: 6 }]
					: []),
			],
		}),
		"matroska",
	);
	const video = info.streams[0];
	if (video) video.codecString = "avc1.640028";
	const a = info.streams[1];
	if (a) a.codecString = "mp4a.40.2";
	if (secondAudio && a)
		info.streams.push({
			...a,
			index: 7,
			codec: "ac3",
			codecString: "ac-3",
			tags: { language: "jpn", title: "Japanese" },
		});
	const inspection = new MediaInspectionApplication({
		repository: new MemoryInspectionStore(),
		sources: library.sources,
		tools: { probe: vi.fn().mockResolvedValue(info) },
	});
	const profile = structuredClone(
		builtinTranscodeProfiles[profileIndex],
	) as TranscodeProfile;
	const profiles = [profile];
	const app = new MediaPlanningApplication({
		sources: library.sources,
		inspection,
		profiles,
		preparationMode,
	});
	cleanup.push(async () => {
		await inspection.close();
		await library.close();
		await rm(root, { recursive: true, force: true });
	});
	const inspectOutput = (
		fileId: string,
		sourceVersion: string,
		profileId = profile.id,
		target: "file" | "media-source" = "file",
	) => app.inspect({ fileId, sourceVersion, output: { profileId, target } });
	const description = await inspectOutput(
		file.id,
		source.identity.sourceVersion,
	);
	const evidence = (
		overrides: Record<string, CompatibilityEvidence["status"]> = {},
	): CompatibilityEvidence[] =>
		description.queries.map((query) => {
			const status =
				overrides[query.id] ??
				(query.id.startsWith("original") ? "unsupported" : "supported");
			return {
				id: query.id,
				status,
				reason:
					status === "supported"
						? "browser-supported"
						: status === "unsupported"
							? "browser-rejected"
							: "browser-uncertain",
				smooth: null,
			};
		});
	const resolveInput = async (
		input: Omit<CompatibilityCheckRequest, "output"> & {
			fileId: string;
			output?: CompatibilityCheckRequest["output"];
		},
	) =>
		resolveExecutionPlan(
			await app.check({
				...input,
				output: input.output ?? { profileId: profile.id, target: "file" },
			}),
		);
	const resolve = (overrides = {}) =>
		resolveInput({
			fileId: file.id,
			sourceVersion: source.identity.sourceVersion,
			descriptionId: description.descriptionId,
			evidence: evidence(overrides),
		});
	return {
		root,
		app,
		resolve,
		description,
		evidence,
		profile,
		profiles,
		resolveInput,
		inspectOutput,
		file,
		source,
		info,
		library,
	};
}

export function setupTestLifecycle() {
	afterEach(async () => {
		await Promise.all(cleanup.splice(0).map((fn) => fn()));
	});
}
