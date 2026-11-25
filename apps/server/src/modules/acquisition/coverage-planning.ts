import type { AcquisitionTarget } from "../anime/public.js";
import type {
	ManifestPreview,
	ManifestPreviewCandidate,
} from "./manifest-preview.js";
import { manifestVersions } from "./manifest-versions.js";
import { selectCandidates } from "./release-selection.js";
import type { Candidate } from "./subscriptions/domain/model.js";

const versionReasons = new Set([
	"another_version_selected",
	"newer_revision_available",
]);

export function unlockedCandidate(candidate: Candidate) {
	return (
		candidate.episode !== null &&
		(candidate.status === "selected" ||
			(candidate.reasons.length > 0 &&
				candidate.reasons.every((reason) => versionReasons.has(reason))))
	);
}

function byVersion(a: Candidate | undefined, b: Candidate | undefined) {
	if (!a || !b) return Number(Boolean(b)) - Number(Boolean(a));
	return (
		Number(a.reasons.includes("newer_revision_available")) -
			Number(b.reasons.includes("newer_revision_available")) ||
		(a.selection?.order ?? Infinity) - (b.selection?.order ?? Infinity) ||
		a.id.localeCompare(b.id)
	);
}

function fileKey(candidate: Candidate) {
	const file = candidate.selection?.file;
	return file
		? JSON.stringify([candidate.entryId, file.hash, file.videoIndex])
		: candidate.id;
}

interface ReleaseSelection {
	previous?: ReleaseSelection;
	group?: Candidate[];
	coverage: number;
	files: number;
	bytes: number;
}

function compareReleaseFiles(a: ReleaseSelection, b: ReleaseSelection) {
	return (
		b.coverage - a.coverage ||
		a.files - b.files ||
		a.bytes - b.bytes ||
		byVersion(a.group?.[0], b.group?.[0])
	);
}

/** Each mapped video is a contiguous interval of regular episodes. */
function chooseReleaseFiles(release: Candidate[][]) {
	const byEnd = new Map<number, { start: number; group: Candidate[] }[]>();
	const boundaries = new Set<number>();
	for (const group of release) {
		const episodes = group.flatMap(({ episode }) =>
			episode === null ? [] : [episode],
		);
		const start = Math.min(...episodes);
		const end = Math.max(...episodes);
		const choices = byEnd.get(end) ?? [];
		choices.push({ start, group });
		byEnd.set(end, choices);
		boundaries.add(start - 1);
		boundaries.add(end);
	}
	const empty: ReleaseSelection = { coverage: 0, files: 0, bytes: 0 };
	const best = new Map<number, ReleaseSelection>();
	let result = empty;
	for (const episode of [...boundaries].sort((a, b) => a - b)) {
		let current = result;
		for (const { start, group } of byEnd.get(episode) ?? []) {
			const previous = best.get(start - 1) ?? empty;
			const option: ReleaseSelection = {
				previous,
				group,
				coverage: previous.coverage + group.length,
				files: previous.files + 1,
				bytes: previous.bytes + (group[0]?.selection?.file?.sizeBytes ?? 0),
			};
			if (compareReleaseFiles(option, current) < 0) current = option;
		}
		best.set(episode, current);
		result = current;
	}
	const groups: Candidate[][] = [];
	for (
		let selection = result;
		selection.group && selection.previous;
		selection = selection.previous
	)
		groups.push(selection.group);
	return {
		chosen: groups.reverse().flat(),
		bytes: result.bytes,
		files: result.files,
	};
}

/** Recompute the best feasible release after each choice. Shared videos are indivisible. */
export function coverageChoices(
	candidates: readonly Candidate[],
	target: AcquisitionTarget,
	startEpisode: number,
	firstOnly = false,
) {
	const videos = new Map<string, Candidate[]>();
	for (const candidate of candidates) {
		if (!unlockedCandidate(candidate)) continue;
		const key = fileKey(candidate);
		const group = videos.get(key) ?? [];
		group.push(candidate);
		videos.set(key, group);
	}
	const remaining = new Set(
		candidates.flatMap(({ episode }) => (episode === null ? [] : [episode])),
	);
	const choices: Candidate[][] = [];
	while (remaining.size) {
		const feasible = [...videos.values()].filter((group) => {
			const file = group[0]?.selection?.file;
			return (
				(!file || file.episodes.length === group.length) &&
				group.every(({ episode }) => episode !== null && remaining.has(episode))
			);
		});
		if (!feasible.length) break;
		const best = new Map<number | null, number>();
		for (const { episode, selection } of feasible.flat()) {
			const level = selection?.levelIndex ?? 0;
			best.set(episode, Math.min(best.get(episode) ?? Infinity, level));
		}
		const releases = new Map<string, Candidate[][]>();
		for (const group of feasible) {
			if (
				!group.every(
					({ episode, selection }) =>
						(selection?.levelIndex ?? 0) === best.get(episode),
				)
			)
				continue;
			const first = group[0];
			if (!first) continue;
			const file = first.selection?.file;
			const key = file ? JSON.stringify([first.entryId, file.hash]) : first.id;
			const release = releases.get(key) ?? [];
			release.push(group);
			releases.set(key, release);
		}
		const ranked = [...releases.values()].map(chooseReleaseFiles);
		const count = target.work.episodeCount;
		const wholeSeason =
			startEpisode === 1 &&
			!target.availableEpisodes.length &&
			(target.airing?.status == null || target.airing.status === "FINISHED") &&
			count != null &&
			count > 1 &&
			remaining.size === count;
		const complete = (group: Candidate[]) =>
			wholeSeason &&
			group.length === count &&
			group[0]?.selection?.file?.complete === true;
		ranked.sort(
			(a, b) =>
				Number(complete(b.chosen)) - Number(complete(a.chosen)) ||
				b.chosen.length - a.chosen.length ||
				(a.chosen.length === 1
					? Number(Boolean(a.chosen[0]?.selection?.file)) -
						Number(Boolean(b.chosen[0]?.selection?.file))
					: 0) ||
				a.files - b.files ||
				a.bytes - b.bytes ||
				byVersion(a.chosen[0], b.chosen[0]),
		);
		const selected = ranked[0]?.chosen;
		if (!selected?.length) break;
		choices.push(selected);
		if (firstOnly) break;
		for (const { episode } of selected)
			if (episode !== null) remaining.delete(episode);
	}
	return choices;
}

type SelectionInput = Parameters<typeof selectCandidates>[0];

export function selectWithCoverage(
	input: SelectionInput,
	inspection: readonly ManifestPreviewCandidate[],
	previews: readonly (
		| Awaited<ReturnType<ManifestPreview["preview"]>>[number]
		| undefined
	)[],
	reusable: (hash: string) => boolean,
) {
	const versions = new Map<
		string,
		ReturnType<typeof manifestVersions>[number] & {
			episode: number;
			foreign: boolean;
		}
	>();
	const entries = [...input.feed.entries];
	const local = new Set(input.target.availableEpisodes);
	const reusableHashes = new Map<string, boolean>();
	for (const version of manifestVersions({
		inspection,
		previews,
		target: input.target,
		assessTitle: input.assessReleaseTitle,
	})) {
		const { source, manifest, video } = version;
		const { entry } = source;
		if (
			!video.episodes.every(
				(episode) =>
					episode >= input.subscription.startEpisode &&
					!local.has(episode) &&
					!input.reservedEpisodes?.has(episode),
			)
		)
			continue;
		const mayReuse =
			reusableHashes.get(manifest.hash) ?? reusable(manifest.hash);
		reusableHashes.set(manifest.hash, mayReuse);
		for (const episode of video.episodes) {
			const id = JSON.stringify([
				entry.id,
				manifest.hash,
				video.index,
				episode,
			]);
			versions.set(id, {
				...version,
				episode,
				foreign: input.active.has(manifest.hash) && !mayReuse,
			});
			entries.push({
				...entry,
				id,
				hash: null,
			});
		}
	}
	const candidates = selectCandidates({
		...input,
		recordLevelIndex: input.recordLevelIndex || versions.size > 0,
		feed: { entries },
		assessReleaseTitle: (title, target, entry) => {
			const version = versions.get(entry.id);
			return version
				? {
						attributes: version.attributes,
						eligible: !version.foreign,
						inspectionCandidate: true,
						episode: version.episode,
						reasons: version.foreign ? ["external_task_conflict"] : [],
						version: "manifest-v1",
					}
				: input.assessReleaseTitle(title, target, entry);
		},
	});
	if (!versions.size) return retainLocked(candidates, input);
	const stored = new Set<string>();
	const mapped = candidates.map((candidate, order) => {
		const selection = candidate.selection;
		if (!selection || input.locked?.has(candidate.id)) return candidate;
		selection.order = order;
		const version = versions.get(candidate.entryId);
		if (!version) return candidate;
		const {
			source,
			manifest,
			video,
			coverage,
			subtitleIndices,
			path,
			sizeBytes,
		} = version;
		const reference = source.entry.download;
		if (!reference) return candidate;
		candidate.entryId = source.entry.id;
		selection.file = {
			hash: manifest.hash,
			reference,
			videoIndex: video.index,
			subtitleIndices,
			episodes: video.episodes,
			path,
			sizeBytes,
			complete: coverage.complete,
			...(!stored.has(candidate.entryId) ? { manifest } : {}),
		};
		stored.add(candidate.entryId);
		return candidate;
	});
	const selected = new Set(
		coverageChoices(
			mapped.filter(
				(candidate) =>
					!input.locked?.has(candidate.id) &&
					!input.reservedEpisodes?.has(candidate.episode ?? 0),
			),
			input.target,
			input.subscription.startEpisode,
		)
			.flat()
			.map(({ id }) => id),
	);
	for (const candidate of mapped) {
		if (input.locked?.has(candidate.id) || !unlockedCandidate(candidate))
			continue;
		candidate.chosen = selected.has(candidate.id);
		candidate.status = candidate.chosen ? "selected" : "skipped";
		candidate.reasons = candidate.chosen
			? []
			: [
					candidate.reasons.includes("newer_revision_available")
						? "newer_revision_available"
						: "another_version_selected",
				];
	}
	return retainLocked(mapped, input);
}

function retainLocked(candidates: Candidate[], input: SelectionInput) {
	const ids = new Set(candidates.map(({ id }) => id));
	return [
		...candidates,
		...(input.history ?? []).filter(
			({ id }) => input.locked?.has(id) && !ids.has(id),
		),
	];
}
