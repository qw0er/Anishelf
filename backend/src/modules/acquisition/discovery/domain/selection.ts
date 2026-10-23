import { createHash } from "node:crypto";
import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
} from "../../../anime/public.js";
import type { SourceSnapshot } from "../../sources/public.js";
import type { Candidate, Subscription } from "./model.js";
import { matchesRelease } from "./profile-matching.js";
import {
	type AcquisitionProfile,
	acquisitionProfileFingerprint,
	builtinAcquisitionProfiles,
} from "./profiles.js";

const seedRank = (candidate: Candidate) => {
	const count = candidate.selection?.seeders;
	return count == null ? -1 : count === 0 ? -2 : count;
};
const stableOrder = (a: Candidate, b: Candidate) =>
	(a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity) ||
	a.entryId.localeCompare(b.entryId);

/** Explicit snapshots only: no transport, persistence or clock access. */
export function selectCandidates(input: {
	subscription: Subscription;
	feed: Pick<SourceSnapshot, "entries">;
	target: AcquisitionTarget;
	history?: Candidate[];
	profile?: AcquisitionProfile | null;
	now: number;
	locked?: ReadonlySet<string>;
	active: ReadonlySet<string>;
	downloadsUnknown: boolean;
	assessReleaseTitle: ReleaseAssessmentApi["assessReleaseTitle"];
}): Candidate[] {
	const {
		subscription,
		feed,
		target,
		active,
		downloadsUnknown,
		assessReleaseTitle,
		now,
	} = input;
	const profile =
		input.profile === undefined ? builtinAcquisitionProfiles[0] : input.profile;
	const fingerprint = profile
		? acquisitionProfileFingerprint(profile)
		: "missing";
	const levels = new Map<string, number>();
	const revisions = new Map<string, { group: string; version: number }>();
	const history = input.history ?? [];
	const previous = new Map(
		history.map((candidate) => [candidate.id, candidate]),
	);
	const firstSeen = new Map<number, number>();
	const reserved = new Map<number, string>();
	for (const candidate of history) {
		if (candidate.episode === null) continue;
		const time = candidate.selection?.firstSeenAt;
		if (time != null)
			firstSeen.set(
				candidate.episode,
				Math.min(time, firstSeen.get(candidate.episode) ?? Infinity),
			);
		if (input.locked?.has(candidate.id))
			reserved.set(candidate.episode, candidate.id);
	}
	const candidates = feed.entries.map((entry): Candidate => {
		const assessment = assessReleaseTitle(entry.title, target);
		const reasons = [...assessment.reasons];
		const seeders =
			entry.seedersObservedAt != null &&
			entry.seedersObservedAt <= now &&
			now - entry.seedersObservedAt <= 60 * 60_000
				? (entry.seeders ?? null)
				: null;
		let levelIndex = -1;
		if (!profile) reasons.push("profile_unavailable");
		else if (
			!matchesRelease(
				profile.requirements ?? {},
				assessment.attributes,
				entry.title,
				seeders,
			)
		)
			reasons.push("requirements_not_met");
		else {
			levelIndex = profile.levels.findIndex((level) =>
				("anyOf" in level.match ? level.match.anyOf : [level.match]).some(
					(condition) =>
						matchesRelease(
							condition,
							assessment.attributes,
							entry.title,
							seeders,
						),
				),
			);
			if (levelIndex < 0) reasons.push("no_matching_level");
		}
		levels.set(entry.id, levelIndex);
		if (!entry.download) reasons.push("download_unavailable");
		if (
			assessment.episode !== null &&
			assessment.episode < subscription.startEpisode
		)
			reasons.push("outside_scope");
		if (
			assessment.episode !== null &&
			target.availableEpisodes.includes(assessment.episode)
		)
			reasons.push("already_available");
		if (entry.hash && active.has(entry.hash)) reasons.push("existing_download");
		if (downloadsUnknown) reasons.push("downloader_unavailable");
		if (
			!reasons.length &&
			assessment.episode !== null &&
			!firstSeen.has(assessment.episode)
		)
			firstSeen.set(assessment.episode, now);
		if (assessment.attributes?.releaseGroups.length)
			revisions.set(entry.id, {
				group: assessment.attributes.releaseGroups
					.map((group) => group.normalize("NFKC").trim().toLowerCase())
					.sort()
					.join("|"),
				version: assessment.attributes.revision,
			});
		return {
			selection: {
				profileId: profile?.id ?? subscription.profileId ?? "unavailable",
				fingerprint,
				level: profile?.levels[levelIndex]?.name ?? null,
				firstSeenAt: null,
				eligibleAt: null,
				seeders,
			},
			chosen: false,
			id: createHash("sha256")
				.update(`${subscription.workKey}:${entry.id}`)
				.digest("hex"),
			entryId: entry.id,
			workKey: subscription.workKey,
			title: entry.title,
			episode: assessment.episode,
			status: reasons.length ? "skipped" : "selected",
			reasons,
			version: assessment.version,
			snapshotId: target.work.snapshotId,
			publishedAt: entry.publishedAt,
		};
	});
	const downloading = new Set(
		candidates
			.filter(
				(candidate) =>
					candidate.reasons.includes("existing_download") &&
					!candidate.reasons.includes("identity_unconfirmed"),
			)
			.map((candidate) => candidate.episode),
	);
	for (const candidate of candidates) {
		if (candidate.episode === null || !candidate.selection) continue;
		const time = firstSeen.get(candidate.episode) ?? null;
		const level = profile?.levels[levels.get(candidate.entryId) ?? -1];
		candidate.selection.firstSeenAt = time;
		candidate.selection.eligibleAt =
			time !== null && level ? time + level.acceptAfterMinutes * 60_000 : null;
		if (candidate.status !== "selected") continue;
		if (
			reserved.has(candidate.episode) &&
			reserved.get(candidate.episode) !== candidate.id
		)
			candidate.reasons.push("episode_reserved");
		else if (downloading.has(candidate.episode))
			candidate.reasons.push("episode_downloading");
		else if (
			candidate.selection.eligibleAt !== null &&
			candidate.selection.eligibleAt > now
		)
			candidate.reasons.push("waiting_for_level");
		if (candidate.reasons.length) candidate.status = "skipped";
	}
	// Resolve revision preferences within equivalent group/level/seed buckets first.
	// Pairwise "same group" comparisons mixed with dates would not be transitive.
	const revisionBucket = (candidate: Candidate) => {
		const revision = revisions.get(candidate.entryId);
		return revision
			? JSON.stringify([
					candidate.episode,
					levels.get(candidate.entryId),
					profile?.preferMoreSeeders !== false ? seedRank(candidate) : 0,
					revision.group,
				])
			: null;
	};
	const latest = new Map<string, number>();
	for (const candidate of candidates) {
		const bucket = revisionBucket(candidate);
		if (candidate.status === "selected" && bucket !== null)
			latest.set(
				bucket,
				Math.max(
					latest.get(bucket) ?? 1,
					revisions.get(candidate.entryId)?.version ?? 1,
				),
			);
	}
	for (const candidate of candidates) {
		const bucket = revisionBucket(candidate);
		if (
			candidate.status === "selected" &&
			bucket !== null &&
			(revisions.get(candidate.entryId)?.version ?? 1) <
				(latest.get(bucket) ?? 1)
		) {
			candidate.status = "skipped";
			candidate.reasons.push("newer_revision_available");
		}
	}
	candidates.sort(
		(a, b) =>
			(levels.get(a.entryId) ?? Infinity) -
				(levels.get(b.entryId) ?? Infinity) ||
			(profile?.preferMoreSeeders !== false ? seedRank(b) - seedRank(a) : 0) ||
			stableOrder(a, b),
	);
	const selected = new Set<number>();
	for (const candidate of candidates) {
		if (candidate.status !== "selected" || candidate.episode === null) continue;
		if (selected.has(candidate.episode)) {
			candidate.status = "skipped";
			candidate.reasons.push("another_version_selected");
		} else {
			selected.add(candidate.episode);
			candidate.chosen = true;
		}
	}
	// Final admission still rechecks identity, destination and local availability.
	for (const candidate of candidates) {
		const prior = previous.get(candidate.id);
		if (prior && input.locked?.has(candidate.id))
			Object.assign(candidate, prior);
	}
	return candidates;
}
