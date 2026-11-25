import type { TorrentClient } from "../../torrent-clients/public.js";
import type { DownloadIntent, EpisodeFilePlan } from "../domain/model.js";
import { DownloadError } from "../public.js";
import type {
	DownloadApplicationContext,
	DownloadExecution,
} from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";
import type { OneOffDownloads } from "./one-off.js";
/** Business eligibility and destination checks immediately before an external mutation. */
export class SubmissionAdmission {
	constructor(
		private readonly context: DownloadApplicationContext,
		private readonly destination: DownloadDestinationSettings,
		private readonly oneOff: OneOffDownloads,
	) {}
	private stopped(execution: DownloadExecution): null {
		if (execution.current.state === "pending")
			this.context.options.logger.info(
				{
					event: "acquisition.submission_stopped",
					intentId: execution.current.id,
					workKey: execution.current.workKey,
				},
				"Subscription permission changed before submission; no new download was submitted.",
			);
		return null;
	}
	async authorize(
		execution: DownloadExecution,
		client: TorrentClient,
		snapshot: Awaited<ReturnType<TorrentClient["tasks"]>>,
		selection?: EpisodeFilePlan,
	): Promise<{ subscriptionRevision: string | null } | null> {
		const item = execution.current;
		const subscription = this.context.options.selection.subscription(
			item.workKey,
		);
		if (
			item.origin === "subscription" &&
			(!subscription || !this.destination.authorized(subscription))
		)
			return this.stopped(execution);
		if (
			item.origin === "subscription" &&
			subscription &&
			subscription.startEpisode > item.episode
		)
			return null;
		if (item.origin === "one-off" && !this.oneOff.authorized(item)) {
			execution.save({
				...item,
				state: "blocked",
				error: "acquisition_configuration_changed",
			});
			return null;
		}
		const destination = this.context.options.store.destination();
		if (!destination || destination.revision !== item.destination.revision)
			throw new DownloadError("destination_changed");
		const target = await this.context.options.anime.target(
			item.workKey,
			this.context.signal,
		);
		if (target.availableEpisodes.includes(item.episode)) {
			execution.save({
				...item,
				state: "blocked",
				error: "already_available",
			});
			return null;
		}
		const assessment = this.context.options.anime.assessReleaseTitle(
			item.title,
			target,
		);
		const matches = selection
			? this.matchesPlan(
					item,
					target,
					selection,
					assessment.inspectionCandidate,
				)
			: assessment.eligible && assessment.episode === item.episode;
		if (!matches) {
			execution.save({
				...item,
				state: "blocked",
				error: "release_evidence_changed",
			});
			this.context.options.logger.info(
				{
					event: "acquisition.release_rejected_at_submission",
					intentId: item.id,
					workKey: item.workKey,
					episode: item.episode,
					inspectionCandidate: assessment.inspectionCandidate,
					reasons: assessment.reasons,
				},
				"Release no longer qualifies for single-episode submission.",
			);
			return null;
		}
		if (
			snapshot.some((task) => {
				if (
					selection &&
					[task.hash, task.v1Hash, task.v2Hash].includes(item.hash)
				)
					return false;
				const assessment = this.context.options.anime.assessReleaseTitle(
					task.name,
					target,
				);
				return assessment.eligible && assessment.episode === item.episode;
			})
		) {
			execution.save({
				...item,
				state: "blocked",
				error: "episode_downloading",
			});
			return null;
		}
		const probe = await client.probe(this.context.signal);
		if (selection && (!probe.selectiveFiles || !client.enableFiles))
			throw new DownloadError("metadata_unsupported");
		await this.destination.validateIncomplete(probe, item.destination);
		this.context.open();
		if (item.origin === "one-off") {
			if (!this.oneOff.authorized(item)) {
				execution.save({
					...item,
					state: "blocked",
					error: "acquisition_configuration_changed",
				});
				return null;
			}
			return { subscriptionRevision: null };
		}
		const before = this.context.options.selection.subscription(item.workKey);
		if (
			!before ||
			before.revision !== subscription?.revision ||
			!this.destination.authorized(before)
		)
			return this.stopped(execution);
		const choice = this.context.options.selection
			.candidates(item.workKey)
			.find(
				(candidate) =>
					candidate.id === item.candidateId &&
					candidate.episode === item.episode &&
					candidate.status === "selected",
			);
		if (!choice) {
			execution.save({
				...item,
				state: "blocked",
				error: "selection_changed",
			});
			return null;
		}

		return { subscriptionRevision: before.revision };
	}

	current(item: DownloadIntent): boolean {
		const { options } = this.context;
		const destination = options.store.destination();
		return Boolean(
			!this.context.signal.aborted &&
				destination?.validated &&
				destination.revision === item.destination.revision &&
				options.connectionGeneration() ===
					item.destination.connectionGeneration &&
				options.store.intent(item.id)?.revision === item.revision &&
				options.store.episodeIntent(item.workKey, item.episode)?.id ===
					item.id &&
				options.transport.isCurrent(item.source) &&
				item.origin === "one-off" &&
				this.oneOff.authorized(item),
		);
	}

	private matchesPlan(
		item: DownloadIntent,
		target: Awaited<
			ReturnType<DownloadApplicationContext["options"]["anime"]["target"]>
		>,
		plan: EpisodeFilePlan,
		plausible: boolean,
	) {
		const accepted = item.acceptedTarget;
		if (
			!plausible ||
			accepted?.workKey !== item.workKey ||
			accepted.episode !== item.episode ||
			accepted.reference.id !== target.work.reference.id ||
			accepted.snapshotId !== target.work.snapshotId
		)
			return false;
		const coverage = this.context.options.anime.mapReleaseFiles?.(
			item.title,
			target,
			plan.manifest.files,
		);
		return (
			coverage?.videos.some(
				(video) =>
					video.index === plan.videoIndex &&
					video.episodes.length === 1 &&
					video.episodes[0] === item.episode &&
					JSON.stringify([...video.subtitleIndices].sort((a, b) => a - b)) ===
						JSON.stringify(plan.subtitleIndices),
			) === true
		);
	}
}
