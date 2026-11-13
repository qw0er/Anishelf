import type { TorrentClient } from "../../torrent-clients/public.js";
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
		if (!assessment.eligible || assessment.episode !== item.episode) {
			execution.save({
				...item,
				state: "blocked",
				error: "release_evidence_changed",
			});
			return null;
		}
		if (
			snapshot.some((task) => {
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
}
