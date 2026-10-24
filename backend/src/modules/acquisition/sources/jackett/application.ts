import { createHash, randomUUID } from "node:crypto";
import type { SourceContext } from "../application/context.js";
import type { SourceRead } from "../domain/adapter.js";
import type { SourceQuery } from "../domain/binding.js";
import { SourceError, type SourceRecord } from "../domain/model.js";
import type { SourceReference } from "../domain/reference.js";
import type { SourceLifecycleStore } from "../infrastructure/store.js";
import type { JackettConnection } from "./connection.js";

/** Private query adapter. It owns plans and connection validity, not the consumer API. */
export class JackettSource {
	private readonly references = new WeakMap<SourceReference, SourceQuery>();
	constructor(
		private readonly context: SourceContext,
		private readonly store: SourceLifecycleStore,
		private readonly connection?: JackettConnection,
	) {}
	reference(input: SourceQuery): SourceReference {
		this.context.open();
		if (!this.connection) throw new SourceError("source_unconfigured");
		const plan = this.connection.plan(input);
		const id = createHash("sha256")
			.update(
				JSON.stringify([
					"jackett",
					plan.generation,
					plan.indexerId,
					plan.titles,
				]),
			)
			.digest("hex");
		const reference = Object.freeze({ id });
		this.references.set(reference, plan);
		return reference;
	}
	plan(reference: SourceReference) {
		return this.references.get(reference);
	}
	current(generation: string) {
		return this.connection?.current(generation) ?? false;
	}
	async refresh(
		reference: SourceReference,
		accept?: (record: SourceRecord) => boolean,
	): Promise<SourceRead> {
		const plan = this.references.get(reference);
		if (!plan) throw new SourceError("invalid_source_reference");
		if (!this.connection) throw new SourceError("source_unconfigured");
		const result = await this.connection.search(
			plan,
			accept
				? (entries) =>
						accept({
							id: reference.id,
							revision: "preview",
							label: plan.indexerId,
							entries: entries.map((entry) => ({
								...entry,
								generation: plan.generation,
							})),
							checkedAt: this.context.now(),
							nextAttemptAt:
								this.context.now() + this.context.refreshIntervalMs(),
							error: null,
						})
				: undefined,
		);
		this.context.open();
		if (!this.current(plan.generation))
			throw new SourceError("source_conflict");
		const record = Object.freeze({
			id: reference.id,
			revision: randomUUID(),
			label: plan.indexerId,
			entries: Object.freeze(
				result.entries.map((entry) =>
					Object.freeze({
						...entry,
						generation: plan.generation,
						download: entry.download ? Object.freeze(entry.download) : null,
					}),
				),
			),
			checkedAt: this.context.now(),
			nextAttemptAt: this.context.now() + this.context.refreshIntervalMs(),
			error: null,
			coverage: Object.freeze(result.coverage),
			outcome: result.outcome,
		});
		return {
			record,
			generation: plan.generation,
			valid: () => this.current(plan.generation),
			persist: () => {
				const previous = this.store.source(record.id);
				this.store.saveSource({
					id: record.id,
					binding: { kind: "jackett", plan },
					enabled: previous?.enabled ?? false,
					failures: 0,
					snapshot: structuredClone(record),
				});
			},
		};
	}
	close() {
		return this.connection?.close();
	}
}
