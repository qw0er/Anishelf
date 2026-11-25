import { unlockedCandidate } from "../../coverage-planning.js";
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
		additional: readonly { item: DownloadIntent; plan: EpisodeFilePlan }[] = [],
	): Promise<{ subscriptionRevision: string | null } | null> {
		const item = execution.current;
		const members = [item, ...additional.map(({ item }) => item)];
		const episodes = new Set(members.map(({ episode }) => episode));
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
		if (target.availableEpisodes.some((episode) => episodes.has(episode))) {
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
					target,
					[{ item, plan: selection }, ...additional],
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
				"Release evidence no longer matches the reserved episodes.",
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
				return (
					assessment.eligible &&
					assessment.episode !== null &&
					episodes.has(assessment.episode)
				);
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
		if (
			members.some(
				(member) => !this.subscriptionChoice(member, Boolean(selection)),
			)
		) {
			execution.save({
				...execution.current,
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
				(item.origin === "one-off"
					? this.oneOff.authorized(item)
					: this.subscriptionChoice(item, true)),
		);
	}

	private subscriptionChoice(item: DownloadIntent, selective: boolean) {
		const { selection } = this.context.options;
		const subscription = selection.subscription(item.workKey);
		if (
			!subscription?.feedId ||
			!this.destination.authorized(subscription) ||
			subscription.startEpisode > item.episode ||
			(selective && item.subscriptionRevision !== subscription.revision)
		)
			return false;
		const choice = selection
			.candidates(item.workKey)
			.find(
				(candidate) =>
					candidate.id === item.candidateId &&
					candidate.episode === item.episode,
			);
		if (
			!choice ||
			(choice.status !== "selected" &&
				(choice.selection?.order === undefined || !unlockedCandidate(choice)))
		)
			return false;
		const file = choice.selection?.file;
		if (!selective) return !file;
		return Boolean(
			file &&
				file.reference === item.source &&
				file.hash === item.hash &&
				choice.snapshotId === item.acceptedTarget?.snapshotId &&
				selection.release(subscription.feedId, choice.entryId)?.download ===
					item.source,
		);
	}

	private matchesPlan(
		target: Awaited<
			ReturnType<DownloadApplicationContext["options"]["anime"]["target"]>
		>,
		members: readonly { item: DownloadIntent; plan: EpisodeFilePlan }[],
		plausible: boolean,
	) {
		const first = members[0];
		if (!plausible || !first) return false;
		const episodesByVideo = new Map<number, number[]>();
		for (const { item, plan } of members) {
			const accepted = item.acceptedTarget;
			const reference = target.work.reference;
			if (
				accepted?.workKey !== item.workKey ||
				accepted.episode !== item.episode ||
				accepted.reference.id !== reference.id ||
				accepted.snapshotId !== target.work.snapshotId
			)
				return false;
			const episodes = episodesByVideo.get(plan.videoIndex) ?? [];
			episodes.push(item.episode);
			episodesByVideo.set(plan.videoIndex, episodes);
		}
		const coverage = this.context.options.anime.mapReleaseFiles?.(
			first.item.title,
			target,
			first.plan.manifest.files,
		);
		const videos = new Map(
			coverage?.videos.map((video) => [video.index, video]),
		);
		for (const { item, plan } of members) {
			const video = videos.get(plan.videoIndex);
			const episodes = episodesByVideo.get(plan.videoIndex);
			if (
				!video ||
				!episodes ||
				JSON.stringify(item.acceptedTarget?.fileEpisodes ?? [item.episode]) !==
					JSON.stringify(video.episodes) ||
				JSON.stringify(video.episodes.toSorted((a, b) => a - b)) !==
					JSON.stringify(episodes.toSorted((a, b) => a - b)) ||
				JSON.stringify(video.subtitleIndices.toSorted((a, b) => a - b)) !==
					JSON.stringify(plan.subtitleIndices)
			)
				return false;
		}
		return true;
	}
}
