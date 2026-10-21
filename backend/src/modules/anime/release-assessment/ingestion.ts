import { createHash } from "node:crypto";
import { basename } from "node:path";
import { DomainError } from "../../../shared/errors.js";
import { workKey } from "../../../shared/external-reference.js";
import type {
	ResourceAccessApi,
	SourceIdentity,
} from "../../resources/public.js";
import type { AnimeCatalogApi } from "../anime-catalog/public.js";
import type { IdentificationResult } from "../identification/public.js";
import type { ReleaseAssessmentApi, ReleaseParser } from "./public.js";

/** Accepted release intent is checked against the actual confined source before association. */
export class AcquisitionIngestion {
	constructor(
		private readonly assessment: ReleaseAssessmentApi,
		private readonly parser: ReleaseParser,
		private readonly catalog: AnimeCatalogApi,
		private readonly sources: ResourceAccessApi,
	) {}
	async ingest(
		key: string,
		episode: number,
		identity: SourceIdentity,
		signal: AbortSignal,
	): Promise<"available" | "review"> {
		const target = await this.assessment.target(key, signal);
		const current = await this.sources.resolveSource(
			identity.fileId,
			identity.sourceVersion,
		);
		if (
			current.identity.scopeId !== identity.scopeId ||
			current.identity.relativePath !== identity.relativePath
		)
			throw new DomainError(
				"ACQUISITION_CONFLICT",
				"The downloaded source changed.",
			);
		const assessment = this.assessment.assess(
			basename(identity.relativePath),
			target,
		);
		const matches = (item: {
			reference?: { provider: string; mediaType: "anime"; id: string };
			kind: string;
			number: string;
		}) =>
			item.reference &&
			workKey(item.reference) === key &&
			item.kind === "regular" &&
			item.number === String(episode);
		const existing = await this.catalog.source(identity.fileId);
		if (existing.associations.length)
			return existing.associations.every(matches) ? "available" : "review";
		const evidence = this.parser.extractRelease(
			basename(identity.relativePath),
		);
		evidence.relativePath = identity.relativePath;
		const result: IdentificationResult = {
			source: identity,
			evidence,
			status: "unresolved",
			metadataStatus: "searched",
			proposals: [],
			unresolved:
				assessment.eligible && assessment.episode === episode
					? []
					: ["download_target_conflict"],
		};
		const scope = await this.sources.getScope();
		await this.catalog.publish([result], scope.ids, signal, [identity.fileId]);
		const review = (await this.catalog.fileReviews([identity.fileId]))[0];
		if (
			!review ||
			review.decision === "rejected" ||
			!assessment.eligible ||
			assessment.episode !== episode
		)
			return "review";
		if (review.associations.length)
			return review.associations.every(matches) ? "available" : "review";
		const preview = await this.catalog.preview({
			reference: target.work.reference,
			rows: [
				{
					reviewId: review.id,
					revision: review.revision,
					targets: [{ kind: "regular", number: String(episode) }],
					offset: 0,
					reason: "Verified acquisition release and downloaded filename agree.",
				},
			],
		});
		signal.throwIfAborted();
		await this.sources.revalidateSource({ identity });
		await this.catalog.confirm({
			previewId: preview.id,
			operationKey: `acquisition:${createHash("sha256")
				.update(JSON.stringify([identity, key, episode]))
				.digest("hex")}`,
			replace: false,
		});
		const confirmed = await this.catalog.source(identity.fileId);
		return confirmed.sourceVersion === identity.sourceVersion &&
			confirmed.associations.length > 0 &&
			confirmed.associations.every(matches)
			? "available"
			: "review";
	}
}
