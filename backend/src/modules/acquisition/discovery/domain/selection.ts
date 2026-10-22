import { createHash } from "node:crypto";
import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
} from "../../../anime/public.js";
import type { Candidate, FeedRecord, Subscription } from "./model.js";

/** Deterministic selection uses explicit snapshots; no transport, timers or persistence. */
export function selectCandidates(input: {
	subscription: Subscription;
	feed: FeedRecord;
	target: AcquisitionTarget;
	previous: ReadonlySet<string>;
	active: ReadonlySet<string>;
	downloadsUnknown: boolean;
	assessReleaseTitle: ReleaseAssessmentApi["assessReleaseTitle"];
}): Candidate[] {
	const {
		subscription,
		feed,
		target,
		previous,
		active,
		downloadsUnknown,
		assessReleaseTitle,
	} = input;
	const hash = (value: string) =>
		createHash("sha256").update(value).digest("hex");

	const candidates = feed.entries.map((entry): Candidate => {
		const assessment = assessReleaseTitle(entry.title, target),
			reasons = [...assessment.reasons];
		if (!entry.downloadUrl) reasons.push("download_unavailable");
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
		return {
			chosen: previous.has(entry.id),
			id: hash(`${subscription.workKey}:${entry.id}`),
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
	candidates.sort(
		(a, b) =>
			Number(previous.has(b.entryId)) - Number(previous.has(a.entryId)) ||
			(a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity) ||
			a.entryId.localeCompare(b.entryId),
	);
	const selected = new Set<number>();
	const downloading = new Set(
		candidates
			.filter(
				(candidate) =>
					candidate.reasons.includes("existing_download") &&
					!candidate.reasons.includes("identity_unconfirmed"),
			)
			.map((candidate) => candidate.episode),
	);
	for (const candidate of candidates)
		if (candidate.status === "selected" && candidate.episode !== null) {
			if (downloading.has(candidate.episode)) {
				candidate.status = "skipped";
				candidate.reasons.push("episode_downloading");
				continue;
			}
			if (selected.has(candidate.episode)) {
				candidate.status = "skipped";
				candidate.reasons.push("another_version_selected");
			} else {
				selected.add(candidate.episode);
				candidate.chosen = true;
			}
		}
	return candidates;
}
