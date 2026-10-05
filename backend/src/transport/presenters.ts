import type {
	CompatibilityResult,
	ContinueWatchingResponse,
	DirectoryDto,
	DirectoryResponse,
	FileDto,
	LibraryIssueDto,
	LibraryResponse,
	PlaybackProgressDto,
	PlaybackSessionResponse,
	ResourceDto,
	ScanStateDto,
	SettingsResponse,
	SubtitleDiscoveryResponse,
	SubtitlePreparationResponse,
} from "../contracts/http.js";
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
import type { CheckedCompatibility } from "../modules/media-compatibility/public.js";
import type {
	ContinueWatchingResult,
	PlaybackProgress,
	PlaybackSession,
} from "../modules/playback/public.js";
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
		generation: session.generation,
		sourceVersion: session.sourceVersion,
		file: fileDto(session.file),
		plan: { mode: session.plan.mode, playbackUrl: session.plan.playbackUrl },
		progress: playbackProgressDto(session.progress),
	};
}

export function continueWatchingResponse(
	result: ContinueWatchingResult,
): ContinueWatchingResponse {
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
		selectedAudio: checked.selectedAudio ? { ...checked.selectedAudio } : null,
		selectedAudioTracks: checked.selectedAudioTracks.map((track) => ({
			...track,
		})),
		audioTracks: checked.audioTracks.map((track) => ({
			stream: { ...track.stream },
			compatibility: { ...track.compatibility },
		})),
		output: checked.output
			? { ...checked.output, combinations: { ...checked.output.combinations } }
			: null,
		warnings: [...checked.warnings],
	};
}
