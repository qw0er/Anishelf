import type { DownloadExecution } from "../downloads/application/context.js";
import { DownloadError } from "../downloads/public.js";
import type { QbittorrentApi } from "../qbittorrent/public.js";
import type { AcquisitionContext } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";
/** Business eligibility and destination checks immediately before an external mutation. */
export class SubmissionAdmission {
	constructor(
		private readonly context: AcquisitionContext,
		private readonly destination: DownloadDestinationSettings,
	) {}
	async authorize(
		execution: DownloadExecution,
		client: QbittorrentApi,
		snapshot: Awaited<ReturnType<QbittorrentApi["tasks"]>>,
	): Promise<string | null> {
		const item = execution.current;
		const subscription = this.context.options.selection.subscription(
			item.workKey,
		);
		if (!subscription || !this.destination.authorized(subscription))
			return null;
		if (subscription.startEpisode > item.episode) return null;
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
		const before = this.context.options.selection.subscription(item.workKey);
		if (
			!before ||
			before.revision !== subscription.revision ||
			!this.destination.authorized(before)
		)
			return null;
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

		return before.revision;
	}
}
