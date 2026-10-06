import { playbackSelectionConstraints } from "../../../contracts/defaults.js";
import { DomainError } from "../../../shared/errors.js";
import type {
	PlaybackCopies,
	PlaybackCopy,
	PlaybackSelectionPlanning,
	PlaybackSelectionSources,
} from "../ports.js";
import type {
	PlaybackOptionsRequest,
	PlaybackOptionsResponse,
	PlaybackSelection,
	PlaybackSelectionApi,
	PlaybackSelectionRequest,
} from "../public.js";

const combination = {
	remux: "copy-copy",
	"transcode-audio": "copy-encode",
	"transcode-video": "encode-copy",
	transcode: "encode-encode",
} as const;
/** Owns candidate eligibility, priority and the sole final resource decision. */
export class PlaybackSelectionApplication implements PlaybackSelectionApi {
	constructor(
		private readonly options: {
			sources: PlaybackSelectionSources;
			planning: PlaybackSelectionPlanning;
			copies: PlaybackCopies;
			selectedProfileId: () => string | null;
		},
	) {}
	private async copies(fileId: string): Promise<PlaybackCopy[]> {
		try {
			return (await this.options.copies.list(fileId)).tasks;
		} catch (error) {
			if (
				error instanceof DomainError &&
				error.code === "PREPARATION_UNAVAILABLE"
			)
				return [];
			throw error;
		}
	}
	private prioritize(tasks: PlaybackCopy[]): PlaybackCopy[] {
		const selected = this.options.selectedProfileId();
		return tasks.sort(
			(a, b) =>
				Number(b.profileId === selected) - Number(a.profileId === selected) ||
				b.updatedAtMs - a.updatedAtMs ||
				a.taskId.localeCompare(b.taskId),
		);
	}
	private matches(
		view: PlaybackCopy,
		fileId: string,
		version: string,
		audio: readonly number[],
		canonicalRoot: string,
	): boolean {
		const { source } = view;
		return (
			source.canonicalRoot === canonicalRoot &&
			source.fileId === fileId &&
			source.sourceVersion === version &&
			JSON.stringify(view.audioStreamIndices) === JSON.stringify(audio)
		);
	}
	async inspect(
		input: PlaybackOptionsRequest,
	): Promise<PlaybackOptionsResponse> {
		const source = await this.options.sources.resolveSource(
			input.fileId,
			input.sourceVersion,
		);
		const original = await this.options.planning.inspect({
			...input,
			sourceVersion: source.identity.sourceVersion,
			output: null,
		});
		const tasks = input.tryOriginal ? [] : await this.copies(input.fileId);
		const candidates = [];
		for (const view of this.prioritize(tasks)) {
			if (
				!this.matches(
					view,
					input.fileId,
					original.sourceVersion,
					original.selectedAudioStreamIndices,
					source.identity.canonicalRoot,
				) ||
				view.availability !== "ready" ||
				!view.artifact ||
				input.failedResourceIds?.includes(view.artifact.id)
			)
				continue;
			try {
				const description = await this.options.planning.inspect({
					fileId: input.fileId,
					sourceVersion: original.sourceVersion,
					audioStreamIndices: original.selectedAudioStreamIndices,
					output: { profileId: view.profileId, target: "file" },
				});
				candidates.push({ taskId: view.taskId, description });
				if (
					candidates.length === playbackSelectionConstraints.maximumCandidates
				)
					break;
			} catch (error) {
				if (error instanceof DomainError && error.code === "INVALID_REQUEST")
					continue;
				throw error;
			}
		}
		await this.options.sources.revalidateSource(source);
		this.options.sources.assertRootEpoch(source.rootEpoch);
		return { original, candidates };
	}
	async select(input: PlaybackSelectionRequest): Promise<PlaybackSelection> {
		if (input.tryOriginal) {
			const source = await this.options.sources.resolveSource(
				input.fileId,
				input.sourceVersion,
			);
			await this.options.sources.revalidateSource(source);
			this.options.sources.assertRootEpoch(source.rootEpoch);
			return {
				sourceVersion: source.identity.sourceVersion,
				compatibility: null,
				pending: false,
				choice: {
					kind: "direct",
					fileId: input.fileId,
					mimeType: source.file.mimeType,
				},
			};
		}
		if (!input.original)
			throw new DomainError(
				"INVALID_REQUEST",
				"Browser evidence is required for automatic playback selection.",
			);
		const source = await this.options.sources.resolveSource(
			input.fileId,
			input.original.sourceVersion,
		);
		if (
			input.original.output ||
			(input.sourceVersion &&
				input.sourceVersion !== input.original.sourceVersion)
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Original evidence does not match the playback intent.",
			);
		if (
			(input.audioStreamIndices === undefined) !==
			(input.original.audioStreamIndices === undefined)
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Original evidence must retain default or explicit audio intent.",
			);
		const compatibility = await this.options.planning.check({
			fileId: input.fileId,
			...input.original,
		});
		const audio =
			input.audioStreamIndices ??
			compatibility.audioTracks.map(({ stream }) => stream.index);
		if (
			JSON.stringify(audio) !==
			JSON.stringify(compatibility.selectedAudioStreamIndices)
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Audio evidence does not match the playback intent.",
			);
		const tasks = (
			input.tryOriginal ? [] : await this.copies(input.fileId)
		).filter((view) =>
			this.matches(
				view,
				input.fileId,
				compatibility.sourceVersion,
				audio,
				source.identity.canonicalRoot,
			),
		);
		this.prioritize(tasks);
		const pending = tasks.some((copy) => copy.pending);
		const result = (
			choice: PlaybackSelection["choice"],
		): PlaybackSelection => ({
			sourceVersion: compatibility.sourceVersion,
			compatibility,
			pending,
			choice,
		});
		const finish = async (choice: PlaybackSelection["choice"]) => {
			await this.options.sources.revalidateSource(source);
			this.options.sources.assertRootEpoch(source.rootEpoch);
			return result(choice);
		};
		// Default multi-audio playback prefers a verified copy, as native track selection varies by browser.
		const preferCopy =
			input.audioStreamIndices !== undefined ||
			compatibility.audioTracks.length > 1 ||
			compatibility.direct.status !== "supported";
		if (!preferCopy && !input.failedResourceIds?.includes(input.fileId))
			return finish({
				kind: "direct",
				fileId: input.fileId,
				mimeType: source.file.mimeType,
			});
		if (
			new Set(input.candidates.map((c) => c.taskId)).size !==
			input.candidates.length
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Duplicate playback candidate evidence.",
			);
		for (const view of tasks) {
			if (
				view.availability !== "ready" ||
				!view.artifact ||
				input.failedResourceIds?.includes(view.artifact.id)
			)
				continue;
			const evidence = input.candidates.find(
				(c) => c.taskId === view.taskId,
			)?.check;
			if (!evidence) continue;
			if (
				evidence.sourceVersion !== compatibility.sourceVersion ||
				evidence.output?.profileId !== view.profileId ||
				evidence.output.target !== "file" ||
				JSON.stringify(evidence.audioStreamIndices) !== JSON.stringify(audio)
			)
				throw new DomainError(
					"INVALID_REQUEST",
					"Copy evidence does not match its specification.",
				);
			const checked = await this.options.planning.check({
				fileId: input.fileId,
				...evidence,
			});
			if (checked.output?.combinations[combination[view.mode]] !== "supported")
				continue;
			const current = await this.options.copies.get(view.taskId);
			if (
				current.availability !== "ready" ||
				current.artifact?.id !== view.artifact.id ||
				current.profileId !== view.profileId ||
				!this.matches(
					current,
					input.fileId,
					compatibility.sourceVersion,
					audio,
					source.identity.canonicalRoot,
				)
			)
				continue;
			return finish({
				kind: "prepared",
				artifactId: current.artifact.id,
				mimeType: current.artifact.mimeType,
			});
		}
		if (
			input.audioStreamIndices === undefined &&
			compatibility.direct.status === "supported" &&
			!input.failedResourceIds?.includes(input.fileId)
		)
			return finish({
				kind: "direct",
				fileId: input.fileId,
				mimeType: source.file.mimeType,
			});
		return finish({
			kind: "blocked",
			reason: pending
				? "preparation-pending"
				: input.audioStreamIndices !== undefined
					? "audio-selection-requires-copy"
					: compatibility.direct.reason,
		});
	}
}
