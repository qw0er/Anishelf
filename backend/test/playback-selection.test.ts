import pino from "pino";
import { beforeEach, expect, test, vi } from "vitest";
import { createHttpApp } from "../src/bootstrap/http.js";
import { createPlaybackCopies } from "../src/bootstrap/playback-selection.js";
import type {
	CompatibilityInspection,
	PlaybackSelectionRequest,
} from "../src/contracts/http.js";
import type { CheckedCompatibility } from "../src/modules/media-planning/public.js";
import { PlaybackSelectionApplication } from "../src/modules/playback-selection/application/selection.js";
import type { PreparationView } from "../src/modules/preparation/public.js";
import { DomainError } from "../src/shared/errors.js";

const fileId = "a".repeat(64);
const source = {
	identity: {
		fileId,
		canonicalRoot: "/media",
		relativePath: "video.mkv",
		sourceVersion: "version",
	},
	rootEpoch: 1,
	file: {
		id: fileId,
		kind: "file" as const,
		parentId: "b".repeat(64),
		name: "Video.mkv",
		sizeBytes: 100,
		modifiedAt: "date",
		mimeType: "video/x-matroska",
	},
};
const decision = { status: "supported" as const, reason: "browser-supported" };
const original: CheckedCompatibility = {
	fileId,
	sourceVersion: "version",
	rulesVersion: "4",
	selectedVideo: null,
	defaultAudioStreamIndex: 1,
	selectedAudioStreamIndices: [1, 2],
	audioTracks: [1, 2].map((index) => ({
		stream: {
			kind: "audio" as const,
			index,
			codec: "aac",
			codecString: "mp4a.40.2",
			profile: null,
			bitrate: null,
			sampleRate: 48000,
			channels: 2,
		},
		compatibility: decision,
	})),
	direct: { status: "unknown", reason: "native-track-selection-uncertain" },
	container: decision,
	video: decision,
	audio: decision,
	output: null,
	warnings: [],
	canonicalRoot: "/media",
	profile: null,
};
const description = {
	fileId,
	sourceVersion: "version",
	rulesVersion: "4",
	descriptionId: "d".repeat(64),
	container: "matroska",
	video: null,
	defaultAudioStreamIndex: 1,
	selectedAudioStreamIndices: [1, 2],
	audioTracks: original.audioTracks.map((t) => t.stream),
	multipleTracks: true,
	queries: [],
	output: null,
} as CompatibilityInspection;
function copy(
	id: string,
	profileId = "builtin:web",
	audio = [1, 2],
): PreparationView {
	return {
		availability: "ready",
		artifact: {
			delivery: "file",
			id,
			taskId: id,
			sizeBytes: 100,
			mimeType: "video/mp4",
		},
		task: {
			id,
			profileId,
			filename: "Video.mkv",
			createdAtMs: 1,
			state: {
				status: "ready",
				progress: null,
				failureReason: null,
				updatedAtMs: 1,
			},
			spec: {
				source: source.identity,
				executionPlanId: id,
				profileFingerprint: "fp",
				settings: {
					version: 1,
					mode: "remux",
					reasons: { video: "copy", audio: "copy" },
					videoStreamIndex: 0,
					audioStreamIndices: audio,
					plan: {
						container: "mp4",
						video: { action: "copy" },
						audio: { action: "copy" },
						filters: [],
						outputFormat: "mp4",
					},
				},
			},
		},
	} as PreparationView;
}
let tasks: PreparationView[];
const sources = {
	resolveSource: vi.fn(async (_id: string, _version?: string) => source),
	revalidateSource: vi.fn(async () => source),
	assertRootEpoch: vi.fn(),
};
const planning = {
	inspect: vi.fn(async () => description),
	check: vi.fn(
		async (
			input: NonNullable<PlaybackSelectionRequest["original"]> & {
				fileId: string;
			},
		) =>
			({
				...original,
				selectedAudioStreamIndices: input.audioStreamIndices ?? [1, 2],
				output: input.output
					? {
							profileId: input.output.profileId,
							target: "file",
							combinations: { "copy-copy": "supported" },
						}
					: null,
			}) as CheckedCompatibility,
	),
};
const copies = {
	list: vi.fn(async () => ({ tasks })),
	get: vi.fn(
		async (id: string) => tasks.find((t) => t.task.id === id) ?? copy(id),
	),
};
let application: PlaybackSelectionApplication;
function request(audio?: number[]): PlaybackSelectionRequest & {
	original: NonNullable<PlaybackSelectionRequest["original"]>;
} {
	return {
		fileId,
		...(audio !== undefined ? { audioStreamIndices: audio } : {}),
		original: {
			sourceVersion: "version",
			descriptionId: description.descriptionId,
			...(audio !== undefined ? { audioStreamIndices: audio } : {}),
			output: null,
			evidence: [],
		},
		candidates: tasks.map(({ task }) => ({
			taskId: task.id,
			check: {
				sourceVersion: "version",
				descriptionId: description.descriptionId,
				audioStreamIndices: audio ?? [1, 2],
				output: { profileId: task.profileId, target: "file" },
				evidence: [],
			},
		})),
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	tasks = [];
	application = new PlaybackSelectionApplication({
		sources,
		planning,
		copies: createPlaybackCopies(copies),
		selectedProfileId: () => "builtin:preferred",
	});
});
test("server chooses selected profile, independent of submitted order, without creating tasks", async () => {
	tasks = [copy("other"), copy("preferred", "builtin:preferred")];
	expect((await application.select(request())).choice).toMatchObject({
		kind: "prepared",
		artifactId: "preferred",
	});
	expect(copies.get).toHaveBeenCalledWith("preferred");
});
test.each([[[]], [[2]], [[2, 1]]])(
	"exact ordered audio %s excludes default and other subsets",
	async (audio) => {
		tasks = [
			copy("all"),
			copy("one", "builtin:web", [1]),
			copy("selected", "builtin:web", audio),
		];
		expect((await application.select(request(audio))).choice).toMatchObject({
			kind: "prepared",
			artifactId: "selected",
		});
	},
);
test("default-all excludes subset and wrong-root copies", async () => {
	const wrongRoot = copy("root");
	wrongRoot.task = {
		...wrongRoot.task,
		spec: {
			...wrongRoot.task.spec,
			source: { ...source.identity, canonicalRoot: "/old" },
		},
	};
	tasks = [copy("one", "builtin:web", [2]), wrongRoot];
	expect((await application.select(request())).choice.kind).toBe("blocked");
});
test("failed bytes are excluded and unsupported output cannot become ready playback", async () => {
	tasks = [copy("failed"), copy("unsupported")];
	planning.check
		.mockImplementationOnce(async () => original)
		.mockImplementationOnce(
			async () =>
				({
					...original,
					output: { combinations: { "copy-copy": "unsupported" } },
				}) as CheckedCompatibility,
		);
	expect(
		(await application.select({ ...request(), failedResourceIds: ["failed"] }))
			.choice.kind,
	).toBe("blocked");
});
test("availability is re-read after evidence; deleted or invalidated copies are not selected", async () => {
	tasks = [copy("copy")];
	copies.get.mockResolvedValueOnce({
		...copy("copy"),
		availability: "unavailable",
		artifact: null,
	});
	expect((await application.select(request())).choice.kind).toBe("blocked");
});
test("pending is guidance and never a playable URL or an implicit command", async () => {
	const pending = copy("pending");
	tasks = [pending];
	pending.task.state = {
		status: "queued",
		progress: null,
		failureReason: null,
		updatedAtMs: 1,
	};
	pending.availability = "unavailable";
	pending.artifact = null;
	expect(await application.select(request())).toMatchObject({
		pending: true,
		choice: { kind: "blocked", reason: "preparation-pending" },
	});
});
test("explicit original attempt bypasses unavailable preparation but still validates source and evidence", async () => {
	copies.list.mockRejectedValueOnce(
		new DomainError("PREPARATION_UNAVAILABLE", "Unavailable"),
	);
	expect(
		(await application.select({ ...request(), tryOriginal: true })).choice.kind,
	).toBe("direct");
	expect(copies.list).not.toHaveBeenCalled();
	expect(planning.check).not.toHaveBeenCalled();
	expect(sources.revalidateSource).toHaveBeenCalled();
	copies.list.mockReset().mockImplementation(async () => ({ tasks }));
});
test("supported single-audio source selects original unless an explicit selection requires a copy", async () => {
	planning.check.mockResolvedValueOnce({
		...original,
		direct: decision,
		audioTracks: original.audioTracks.slice(0, 1),
		selectedAudioStreamIndices: [1],
	});
	const input = request();
	expect((await application.select(input)).choice.kind).toBe("direct");
	expect((await application.select(request([1]))).choice.kind).toBe("blocked");
});
test("stale browser evidence and post-selection root switch fail rather than leaking a URL", async () => {
	planning.check.mockRejectedValueOnce(
		new DomainError("PLAYBACK_CONFLICT", "Stale evidence"),
	);
	await expect(application.select(request())).rejects.toMatchObject({
		code: "PLAYBACK_CONFLICT",
	});
	sources.assertRootEpoch.mockImplementationOnce(() => {
		throw new DomainError("PLAYBACK_CONFLICT", "Root changed");
	});
	await expect(
		application.select({ ...request(), tryOriginal: true }),
	).rejects.toMatchObject({ code: "PLAYBACK_CONFLICT" });
});
test("intent mismatch and duplicate candidate evidence are rejected", async () => {
	await expect(
		application.select({ ...request(), audioStreamIndices: [2] }),
	).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	tasks = [copy("copy")];
	const input = request();
	input.candidates.push(...input.candidates);
	await expect(application.select(input)).rejects.toMatchObject({
		code: "INVALID_REQUEST",
	});
});
test("HTTP projects the selected URL with no progress generation or private source paths", async () => {
	const app = createHttpApp({
		config: { host: "127.0.0.1", port: 80 },
		logger: pino({ level: "silent" }),
		playbackSelection: application,
	});
	try {
		const response = await app.inject({
			method: "POST",
			url: "/api/playback/selection",
			payload: { ...request(), tryOriginal: true },
		});
		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.json().plan.resource.url).toBe(`/api/media/${fileId}`);
		expect(response.json()).not.toHaveProperty("generation");
		expect(response.body).not.toContain('"canonicalRoot"');
		const invalid = await app.inject({
			method: "POST",
			url: "/api/playback/selection",
			payload: { ...request(), audioStreamIndices: [-1] },
		});
		expect(invalid.statusCode).toBe(400);
	} finally {
		await app.close();
	}
});

test("candidate descriptions are bounded after server priority, not by browser request size", async () => {
	tasks = Array.from({ length: 140 }, (_, i) => copy(`copy-${i}`));
	tasks.push(copy("preferred", "builtin:preferred"));
	const options = await application.inspect({ fileId });
	expect(options.candidates).toHaveLength(128);
	expect(options.candidates[0]?.taskId).toBe("preferred");
	expect(planning.inspect).toHaveBeenCalledTimes(129);
});

test("composition gives selection only copy metadata, detached from mutable owner state", async () => {
	tasks = [copy("copy")];
	const adapter = createPlaybackCopies(copies);
	const snapshot = await adapter.get("copy");
	expect(Object.keys(snapshot).sort()).toEqual(
		[
			"artifact",
			"audioStreamIndices",
			"availability",
			"mode",
			"pending",
			"profileId",
			"source",
			"taskId",
			"updatedAtMs",
		].sort(),
	);
	expect(snapshot.artifact).toEqual({ id: "copy", mimeType: "video/mp4" });
	expect(snapshot).not.toHaveProperty("task");
	expect(snapshot).not.toHaveProperty("spec");
	const task = tasks[0];
	if (!task) throw new Error("Missing fixture");
	task.task.profileId = "changed";
	snapshot.source.canonicalRoot = "/changed";
	expect(snapshot.profileId).toBe("builtin:web");
	expect(task.task.spec.source.canonicalRoot).toBe("/media");
});
