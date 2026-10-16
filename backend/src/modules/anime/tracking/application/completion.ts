import type { AnimeCatalogApi } from "../../anime-catalog/public.js";
import type { ViewingStatus } from "../domain/list.js";
import type { TrackingApi } from "../public.js";

interface Target {
	fileId: string;
	sourceVersion: string;
	reviewId: string;
	revision: number;
	episodeId: string;
	mediaId: number;
	episode: number;
	accountId: number;
	generation: string;
}
interface Decision {
	advance: boolean;
	initialStatus?: ViewingStatus;
}
interface Outcome {
	state: "queued" | "skipped" | "decision-required" | "unavailable";
	reason: string;
	mediaId?: number;
	episode?: number;
}
/** Resolves only confirmed single-episode targets; positions never imply skipped episodes. */
export class TrackingCompletions {
	constructor(
		private readonly catalog: Pick<AnimeCatalogApi, "fileReviews">,
		private readonly tracking: Pick<
			TrackingApi,
			"status" | "list" | "operations" | "update"
		>,
	) {}
	private async mapping(fileId: string, sourceVersion: string) {
		const [review] = await this.catalog.fileReviews([fileId]);
		const association = review?.associations[0];
		if (
			!review?.available ||
			review.decision !== "confirmed" ||
			review.sourceVersion !== sourceVersion ||
			review.associations.length !== 1 ||
			!association ||
			association.reference?.provider !== "anilist" ||
			!["regular", "movie"].includes(association.kind) ||
			!/^[1-9][0-9]*$/.test(association.number)
		)
			return null;
		const mediaId = Number(association.reference.id),
			episode = Number(association.number);
		if (
			!Number.isSafeInteger(mediaId) ||
			mediaId <= 0 ||
			mediaId > 2147483647 ||
			!Number.isSafeInteger(episode) ||
			episode > 2147483647 ||
			(association.kind === "movie" && episode !== 1)
		)
			return null;
		return {
			fileId,
			sourceVersion,
			reviewId: review.id,
			revision: review.revision,
			episodeId: association.episodeId,
			mediaId,
			episode,
		};
	}
	async capture(fileId: string, sourceVersion: string): Promise<string | null> {
		const account = this.tracking.status();
		if (!account.account || account.state !== "connected") return null;
		const mapping = await this.mapping(fileId, sourceVersion);
		if (this.tracking.status().generation !== account.generation) return null;
		return mapping
			? JSON.stringify({
					...mapping,
					accountId: account.account.id,
					generation: account.generation,
				} satisfies Target)
			: null;
	}
	async submit(
		context: string,
		capturedAt: number,
		decision: Decision | null,
	): Promise<Outcome> {
		const target: Target = JSON.parse(context);
		const account = this.tracking.status();
		if (account.account?.id !== target.accountId)
			return { state: "skipped", reason: "account-changed" };
		if (account.state !== "connected")
			return { state: "unavailable", reason: "reconnect-required" };
		const generation = account.generation;
		const current = await this.mapping(target.fileId, target.sourceVersion);
		if (this.tracking.status().generation !== generation)
			return { state: "unavailable", reason: "account-changing" };
		if (
			!current ||
			JSON.stringify(current) !==
				JSON.stringify({
					fileId: target.fileId,
					sourceVersion: target.sourceVersion,
					reviewId: target.reviewId,
					revision: target.revision,
					episodeId: target.episodeId,
					mediaId: target.mediaId,
					episode: target.episode,
				})
		)
			return { state: "skipped", reason: "mapping-changed" };
		const result = { mediaId: target.mediaId, episode: target.episode };
		if (decision?.advance === false)
			return { ...result, state: "skipped", reason: "kept-progress" };
		const list = this.tracking.list(generation);
		if (list.fetchedAt === null)
			return { ...result, state: "unavailable", reason: "list-unavailable" };
		const entry = list.entries.find((e) => e.mediaId === target.mediaId);
		const op = this.tracking
			.operations(generation)
			.find((o) => o.mediaId === target.mediaId);
		// A newer manual command wins, including explicit backwards corrections.
		if (op && !op.completion && op.updatedAt >= capturedAt)
			return { ...result, state: "skipped", reason: "manual-change" };
		if (
			(entry?.progress ?? 0) >= target.episode ||
			(op?.completion && (op.desired.progress ?? 0) >= target.episode)
		)
			return { ...result, state: "skipped", reason: "already-tracked" };
		if (op && !["succeeded", "cancelled"].includes(op.state))
			return { ...result, state: "unavailable", reason: "pending-change" };
		if (!decision?.advance && (!entry || target.episode > entry.progress + 1))
			return {
				...result,
				state: "decision-required",
				reason: !entry ? "initial-status-required" : "skipped-episodes",
			};
		if (!entry && !decision?.initialStatus)
			return {
				...result,
				state: "decision-required",
				reason: "initial-status-required",
			};
		this.tracking.update(target.mediaId, {
			generation,
			revision: op?.revision ?? null,
			baseline: entry
				? {
						id: entry.id,
						progress: entry.progress,
						status: entry.status,
						updatedAt: entry.updatedAt,
					}
				: null,
			desired: {
				progress: target.episode,
				...(!entry && decision?.initialStatus
					? { status: decision.initialStatus }
					: {}),
			},
			completion: true,
		});
		return { ...result, state: "queued", reason: "submission-queued" };
	}
}
