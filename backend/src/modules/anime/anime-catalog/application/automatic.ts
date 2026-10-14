import type { IdentificationResult } from "../../identification/public.js";
import { automaticProposal } from "../domain/admission.js";
import type { AssociationApplication } from "./associations.js";
import type { CatalogContext } from "./context.js";

export class AutomaticAdmission {
	constructor(
		private readonly context: CatalogContext,
		private readonly associations: AssociationApplication,
	) {}
	async admit(
		results: readonly IdentificationResult[],
		canonicalRoot: string,
		signal?: AbortSignal,
	) {
		const root = await this.context.root();
		if (root.canonicalRoot !== canonicalRoot) return;
		const started = performance.now();
		let admitted = 0;
		let skipped = 0;
		let failed = 0;
		for (const result of results) {
			signal?.throwIfAborted();
			this.context.open();
			this.context.options.sources.assertRootEpoch(root.epoch);
			const source = this.context.options.store.registerSource(result.source);
			const record = this.context.options.store.review(source.id);
			const proposal = record ? automaticProposal(record) : null;
			if (
				!record ||
				!proposal ||
				this.context.options.store.associations(source.id).length
			) {
				skipped++;
				continue;
			}
			let previewId: string | null = null;
			try {
				const preview = await this.associations.preview(
					{
						reference: proposal.candidate.work.reference,
						rows: [
							{
								reviewId: record.id,
								revision: record.revision,
								targets: proposal.mapping.targets.map((target) =>
									proposal.mapping.numbering
										? {
												...target,
												number: String(
													Number(target.number) -
														proposal.mapping.numbering.offset,
												),
											}
										: target,
								),
								offset: proposal.mapping.numbering?.offset ?? 0,
								reason:
									"Automatically identified from an unambiguous title and episode mapping.",
							},
						],
					},
					signal,
				);
				previewId = preview.id;
				signal?.throwIfAborted();
				await this.associations.confirm(
					{
						previewId: preview.id,
						operationKey: `automatic:${preview.id}`,
						replace: false,
					},
					signal,
				);
				admitted++;
			} catch (err) {
				signal?.throwIfAborted();
				this.context.open();
				this.context.options.sources.assertRootEpoch(root.epoch);
				failed++;
				this.context.options.logger.warn(
					{
						event: "catalog.automatic_admission_failed",
						sourceId: source.id,
						err,
					},
					"Automatic association failed; the source remains available for review.",
				);
			} finally {
				if (previewId) this.associations.discard(previewId);
			}
		}
		this.context.options.logger.info(
			{
				event: "catalog.automatic_admission_completed",
				rootId: root.rootId,
				sources: results.length,
				admitted,
				skipped,
				failed,
				elapsedMs: Math.round(performance.now() - started),
			},
			"Automatic catalog admission completed.",
		);
	}
}
