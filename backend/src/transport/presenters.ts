import type {
	CompatibilityResult,
	DirectoryDto,
	DirectoryResponse,
	FileDto,
	FilePlaybackResource,
	HistoryResponse,
	LibraryIssueDto,
	LibraryResponse,
	MediaTimeline,
	PlaybackPlanDto,
	PlaybackProgressDto,
	PlaybackSessionResponse,
	ResourceDto,
	ScanStateDto,
	SettingsResponse,
	SubtitleDiscoveryResponse,
	SubtitlePreparationResponse,
} from "../contracts/http.js";
import { directPlaybackPlan, originalTimeline } from "../contracts/media.js";
import type { PersistentSettings } from "../modules/configuration/public.js";
import type {
	DirectoryInfo,
	DirectoryListing,
	FileInfo,
	LibraryIssue,
	LibraryStatus,
	ResourceInfo,
	ScanState,
} from "../modules/library/public.js";
import type { CheckedCompatibility } from "../modules/media-planning/public.js";
import type {
	HistoryResult,
	PlaybackProgress,
	PlaybackSession,
} from "../modules/playback/public.js";
import type { PreparationCreation } from "../modules/preparation/public.js";
import type {
	SubtitleDiscovery,
	SubtitlePreparationResult,
} from "../modules/subtitles/public.js";
import type { DeepReadonly } from "../shared/policy.js";

/** Explicit projections keep backend additions out of public JSON responses. */
function directoryDto(directory: DirectoryInfo): DirectoryDto {
	return {
		kind: "directory",
		id: directory.id,
		parentId: directory.parentId,
		name: directory.name,
	};
}

export function fileDto(file: FileInfo): FileDto {
	return {
		kind: "file",
		id: file.id,
		parentId: file.parentId,
		name: file.name,
		sizeBytes: file.sizeBytes,
		modifiedAt: file.modifiedAt,
		mimeType: file.mimeType,
	};
}

function resourceDto(resource: ResourceInfo): ResourceDto {
	return resource.kind === "directory"
		? directoryDto(resource)
		: fileDto(resource);
}

function libraryIssueDto(issue: LibraryIssue): LibraryIssueDto {
	return { code: issue.code, message: issue.message };
}

export function scanStateDto(state: ScanState): ScanStateDto {
	const fields = {
		id: state.id,
		startedAt: state.startedAt,
		visitedCount: state.visitedCount,
		matchedCount: state.matchedCount,
		warnings: {
			count: state.warnings.count,
			messages: [...state.warnings.messages],
		},
	};
	switch (state.status) {
		case "running":
			return { ...fields, status: "running", finishedAt: null };
		case "failed":
			return {
				...fields,
				status: "failed",
				finishedAt: state.finishedAt,
				error: libraryIssueDto(state.error),
			};
		case "completed":
		case "cancelled":
			return { ...fields, status: state.status, finishedAt: state.finishedAt };
	}
}

export function libraryResponse(status: LibraryStatus): LibraryResponse {
	return {
		ready: status.ready,
		revision: status.revision,
		scan: status.scan ? scanStateDto(status.scan) : null,
		error: status.error ? libraryIssueDto(status.error) : null,
		stale: status.stale,
	};
}

export function directoryResponse(
	listing: DirectoryListing,
): DirectoryResponse {
	return {
		directory: directoryDto(listing.directory),
		children: listing.children.map(resourceDto),
	};
}

export function settingsResponse(
	settings: Readonly<PersistentSettings>,
): SettingsResponse {
	return {
		resourceRoot: settings.resourceRoot,
		...(settings.defaultTranscodeProfileId === undefined
			? {}
			: { defaultTranscodeProfileId: settings.defaultTranscodeProfileId }),
		...(settings.scanIntervalMinutes === undefined
			? {}
			: { scanIntervalMinutes: settings.scanIntervalMinutes }),
	};
}

export function playbackProgressDto(
	progress: PlaybackProgress,
): PlaybackProgressDto {
	return {
		positionMs: progress.positionMs,
		durationMs: progress.durationMs,
		lastViewedAtMs: progress.lastViewedAtMs,
		generation: progress.generation,
		lastSequence: progress.lastSequence,
	};
}

export function playbackSessionResponse(
	session: PlaybackSession,
): PlaybackSessionResponse {
	return {
		token: session.token,
		sourceVersion: session.sourceVersion,
		file: fileDto(session.file),
		progress: playbackProgressDto(session.progress),
	};
}

export function historyResponse(result: HistoryResult): HistoryResponse {
	return {
		availability: result.availability,
		items: result.items.map((item) => ({
			file: fileDto(item.file),
			progress: playbackProgressDto(item.progress),
		})),
	};
}

export function subtitleDiscoveryResponse(
	result: SubtitleDiscovery,
): SubtitleDiscoveryResponse {
	return {
		sourceVersion: result.sourceVersion,
		tracks: result.tracks.map((track) => {
			const base = {
				id: track.id,
				name: track.name,
				language: track.language,
				label: track.label,
				sourceVersion: track.sourceVersion,
			};
			return {
				...base,
				origin: track.origin,
				format: track.format,
				sizeBytes: track.sizeBytes,
				codec: track.origin === "embedded" ? track.codec : null,
				default: track.origin === "embedded" ? track.default : false,
				forced: track.origin === "embedded" ? track.forced : false,
				supported:
					track.origin === "external" ||
					(track.extractionSupported && track.webSupported),
				unsupportedReason:
					track.origin === "embedded" ? track.unsupportedReason : null,
			};
		}),
		warnings: result.warnings.map(({ name, code }) => ({ name, code })),
	};
}

export function subtitlePreparationResponse(
	result: SubtitlePreparationResult,
): SubtitlePreparationResponse {
	if ("external" in result) {
		const { fileId, trackId, sourceVersion, subtitleVersion } = result.external;
		const query = new URLSearchParams({ sourceVersion, subtitleVersion });
		return {
			id: result.id,
			status: result.status,
			format: result.format,
			errorCode: null,
			statusUrl: null,
			contentUrl: `/api/files/${encodeURIComponent(fileId)}/subtitles/${encodeURIComponent(trackId)}/content?${query}`,
		};
	}
	const url = `/api/subtitle-assets/${encodeURIComponent(result.id)}`;
	return {
		id: result.id,
		status: result.status,
		format: result.format,
		errorCode: result.errorCode,
		statusUrl: `${url}/status`,
		contentUrl: result.status === "ready" ? url : null,
	};
}

/** Explicitly omit canonical source paths and executable profile parameters. */
export function presentCompatibility(
	checked: DeepReadonly<CheckedCompatibility>,
): CompatibilityResult {
	return {
		fileId: checked.fileId,
		sourceVersion: checked.sourceVersion,
		rulesVersion: checked.rulesVersion,
		direct: { ...checked.direct },
		container: { ...checked.container },
		video: { ...checked.video },
		audio: { ...checked.audio },
		selectedVideo: checked.selectedVideo ? { ...checked.selectedVideo } : null,
		defaultAudioStreamIndex: checked.defaultAudioStreamIndex,
		selectedAudioStreamIndices: [...checked.selectedAudioStreamIndices],
		audioTracks: checked.audioTracks.map((track) => ({
			stream: { ...track.stream },
			compatibility: { ...track.compatibility },
		})),
		output: checked.output
			? {
					...checked.output,
					combinations: { ...checked.output.combinations },
					audioTracks: checked.output.audioTracks.map((track) => ({
						...track,
						combinations: { ...track.combinations },
					})),
				}
			: null,
		warnings: [...checked.warnings],
	};
}

/** Project nested resources explicitly; never serialize structurally compatible private fields. */
export function playbackPlanDto(plan: PlaybackPlanDto): PlaybackPlanDto {
	switch (plan.mode) {
		case "blocked":
			return { mode: plan.mode, reason: plan.reason };
		case "direct":
			return {
				mode: plan.mode,
				resource: filePlaybackResourceDto(plan.resource),
			};
		case "prepared":
			return {
				mode: plan.mode,
				artifactId: plan.artifactId,
				resource: filePlaybackResourceDto(plan.resource),
			};
	}
}
function timelineDto(timeline: MediaTimeline) {
	return {
		sourceOriginMs: timeline.sourceOriginMs,
		mediaOriginMs: timeline.mediaOriginMs,
		sourceDurationMs: timeline.sourceDurationMs,
	};
}
function filePlaybackResourceDto(
	resource: FilePlaybackResource,
): FilePlaybackResource {
	return {
		delivery: "file",
		url: resource.url,
		mimeType: resource.mimeType,
		timeline: timelineDto(resource.timeline),
	};
}
/** Transport owns URLs and the small user-visible progress projection. */
export function preparationTaskResponse(
	view: import("../modules/preparation/public.js").PreparationView,
): import("../contracts/http.js").PreparationTaskResponse {
	const { task, artifact, availability } = view;
	const progress = task.state.progress;
	return {
		id: task.id,
		fileId: task.spec.source.fileId,
		sourceVersion: task.spec.source.sourceVersion,
		filename: task.filename,
		profileId: task.profileId,
		audioStreamIndices: [...task.spec.settings.audioStreamIndices],
		mode: task.spec.settings.mode,
		reasons: { ...task.spec.settings.reasons },
		status: task.state.status,
		progress: progress
			? {
					mediaTimeMs: progress.mediaTimeMs,
					percent: progress.percent,
					speed: progress.speed,
				}
			: null,
		failureReason: task.state.failureReason,
		createdAtMs: task.createdAtMs,
		updatedAtMs: task.state.updatedAtMs,
		playbackAvailability: availability,
		artifactId: artifact?.id ?? null,
		sizeBytes: artifact?.sizeBytes ?? null,
		resource:
			artifact && availability === "ready"
				? {
						delivery: "file",
						url: `/api/prepared-media/${artifact.id}`,
						mimeType: artifact.mimeType,
						timeline: originalTimeline(),
					}
				: null,
	};
}
export function preparationStartResponse(
	result: PreparationCreation,
): import("../contracts/http.js").PreparationStartResponse {
	switch (result.kind) {
		case "direct":
			return {
				kind: "direct",
				plan: directPlaybackPlan(result.fileId, result.mimeType),
			};
		case "blocked":
			return { kind: "blocked", reason: result.reason };
		case "task":
			return { kind: "task", task: preparationTaskResponse(result.view) };
	}
}

export function playbackSelectionResponse(
	result: import("../modules/playback-selection/public.js").PlaybackSelection,
): import("../contracts/http.js").PlaybackSelectionResponse {
	const { choice } = result;
	return {
		sourceVersion: result.sourceVersion,
		compatibility: result.compatibility
			? presentCompatibility(result.compatibility)
			: null,
		pending: result.pending,
		plan:
			choice.kind === "direct"
				? directPlaybackPlan(choice.fileId, choice.mimeType)
				: choice.kind === "blocked"
					? { mode: "blocked", reason: choice.reason }
					: {
							mode: "prepared",
							artifactId: choice.artifactId,
							resource: {
								delivery: "file",
								url: `/api/prepared-media/${choice.artifactId}`,
								mimeType: choice.mimeType,
								timeline: originalTimeline(),
							},
						},
	};
}
