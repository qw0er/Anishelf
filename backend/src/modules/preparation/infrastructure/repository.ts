import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
	mediaSources,
	preparationTasks,
	preparedArtifacts,
	resourceRoots,
} from "../../../platform/database/schema.js";
import type { Store } from "../../../platform/database/store.js";
import { freeze } from "../../../shared/policy.js";
import type { SourceRegistry } from "../../resource-access/public.js";
import type {
	PreparationState,
	PreparationTask,
	PreparedArtifact,
} from "../domain/model.js";
import type { PreparationStore, PreparationSummaryRow } from "../ports.js";

export class PreparationRepository implements PreparationStore {
	constructor(
		private readonly store: Store,
		private readonly sources: SourceRegistry,
	) {}
	private query() {
		return this.store
			.select({
				task: preparationTasks,
				source: mediaSources,
				root: resourceRoots,
			})
			.from(preparationTasks)
			.innerJoin(mediaSources, eq(preparationTasks.sourceId, mediaSources.id))
			.innerJoin(resourceRoots, eq(mediaSources.rootId, resourceRoots.id));
	}
	private task(row: {
		task: typeof preparationTasks.$inferSelect;
		source: typeof mediaSources.$inferSelect;
		root: typeof resourceRoots.$inferSelect;
	}): PreparationTask {
		const { status, progress, failureReason, updatedAtMs } = row.task;
		let state: PreparationState;
		if (status === "queued" && progress === null && failureReason === null)
			state = { status, progress: null, failureReason: null, updatedAtMs };
		else if (
			(status === "processing" ||
				status === "cancelling" ||
				status === "ready") &&
			failureReason === null
		)
			state = { status, progress, failureReason: null, updatedAtMs };
		else if (status === "failed" && failureReason !== null)
			state = { status, progress, failureReason, updatedAtMs };
		else if (
			status === "cancelled" &&
			(failureReason === "cancelled" || failureReason === "cache-deleted")
		)
			state = { status, progress, failureReason, updatedAtMs };
		else throw new Error("Invalid persisted preparation state.");
		return {
			id: row.task.id,
			filename: row.task.filename,
			profileId: row.task.profileId,
			createdAtMs: row.task.createdAtMs,
			state,
			spec: freeze({
				source: {
					canonicalRoot: row.root.canonicalPath,
					fileId: row.source.fileId,
					relativePath: row.source.relativePath,
					sourceVersion: row.source.sourceVersion,
				},
				executionPlanId: row.task.executionPlanId,
				profileFingerprint: row.task.profileFingerprint,
				settings: row.task.snapshot,
			}),
		};
	}
	list(limit?: number, fileId?: string): PreparationTask[] {
		const query = this.query()
			.where(fileId ? eq(mediaSources.fileId, fileId) : undefined)
			.orderBy(desc(preparationTasks.createdAtMs), desc(preparationTasks.id));
		return (limit === undefined ? query.all() : query.limit(limit).all()).map(
			(row) => this.task(row),
		);
	}
	summaries(canonicalRoot: string, fileIds: string[]): PreparationSummaryRow[] {
		const rows: PreparationSummaryRow[] = [];
		// Bound SQLite parameters; each chunk is a set query, never a query per file.
		for (let offset = 0; offset < fileIds.length; offset += 500) {
			rows.push(
				...this.store
					.select({
						fileId: mediaSources.fileId,
						sourceVersion: mediaSources.sourceVersion,
						profileId: preparationTasks.profileId,
						profileFingerprint: preparationTasks.profileFingerprint,
						status: preparationTasks.status,
						updatedAtMs: preparationTasks.updatedAtMs,
						published:
							sql<boolean>`exists(select 1 from ${preparedArtifacts} where ${preparedArtifacts.taskId} = ${preparationTasks.id})`.mapWith(
								Boolean,
							),
					})
					.from(preparationTasks)
					.innerJoin(
						mediaSources,
						eq(preparationTasks.sourceId, mediaSources.id),
					)
					.innerJoin(resourceRoots, eq(mediaSources.rootId, resourceRoots.id))
					.where(
						and(
							eq(resourceRoots.canonicalPath, canonicalRoot),
							inArray(mediaSources.fileId, fileIds.slice(offset, offset + 500)),
						),
					)
					.all(),
			);
		}
		return rows;
	}

	get(id: string): PreparationTask | undefined {
		const row = this.query().where(eq(preparationTasks.id, id)).get();
		return row ? this.task(row) : undefined;
	}
	find(planId: string): PreparationTask | undefined {
		const row = this.query()
			.where(eq(preparationTasks.executionPlanId, planId))
			.get();
		return row ? this.task(row) : undefined;
	}
	queuedCount(): number {
		return (
			this.store
				.select({ value: sql<number>`count(*)` })
				.from(preparationTasks)
				.where(eq(preparationTasks.status, "queued"))
				.get()?.value ?? 0
		);
	}
	nextQueued(): PreparationTask | undefined {
		const row = this.query()
			.where(eq(preparationTasks.status, "queued"))
			.orderBy(asc(preparationTasks.updatedAtMs), asc(preparationTasks.id))
			.limit(1)
			.get();
		return row ? this.task(row) : undefined;
	}
	artifactBytes(): number {
		return (
			this.store
				.select({
					value: sql<number>`coalesce(sum(${preparedArtifacts.sizeBytes}), 0)`,
				})
				.from(preparedArtifacts)
				.get()?.value ?? 0
		);
	}
	insert(task: PreparationTask): void {
		this.store.transaction(() => {
			const source = this.sources.registerSource(task.spec.source);
			this.store
				.insert(preparationTasks)
				.values({
					id: task.id,
					sourceId: source.id,
					executionPlanId: task.spec.executionPlanId,
					profileFingerprint: task.spec.profileFingerprint,
					profileId: task.profileId,
					filename: task.filename,
					snapshot: task.spec.settings,
					...task.state,
					createdAtMs: task.createdAtMs,
				})
				.run();
		});
	}
	/** State updates never rewrite the immutable specification. */
	save(task: PreparationTask): void {
		this.store
			.update(preparationTasks)
			.set({ ...task.state, profileId: task.profileId })
			.where(eq(preparationTasks.id, task.id))
			.run();
	}
	publish(task: PreparationTask, artifact: PreparedArtifact): void {
		this.store.transaction(() => {
			this.save(task);
			const { delivery: _delivery, ...row } = artifact;
			this.store.insert(preparedArtifacts).values(row).run();
		});
	}
	artifact(id: string): PreparedArtifact | undefined {
		const row = this.store
			.select()
			.from(preparedArtifacts)
			.where(eq(preparedArtifacts.id, id))
			.get();
		return row ? { ...row, delivery: "file" } : undefined;
	}
	artifacts(): PreparedArtifact[] {
		return this.store
			.select()
			.from(preparedArtifacts)
			.all()
			.map((row) => ({ ...row, delivery: "file" }));
	}
	removeArtifact(task: PreparationTask): void {
		this.store.transaction(() => {
			this.store
				.delete(preparedArtifacts)
				.where(eq(preparedArtifacts.taskId, task.id))
				.run();
			this.save(task);
		});
	}
}
