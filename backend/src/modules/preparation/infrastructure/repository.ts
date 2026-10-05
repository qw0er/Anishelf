import { desc, eq } from "drizzle-orm";
import {
	mediaSources,
	preparationTasks,
	preparedArtifacts,
	resourceRoots,
} from "../../../platform/database/schema.js";
import type { Store } from "../../../platform/database/store.js";
import type { SourceRegistry } from "../../resource-access/public.js";
import type { PreparationTask, PreparedArtifact } from "../domain/model.js";

export class PreparationRepository {
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
		return {
			id: row.task.id,
			...row.task.snapshot,
			source: {
				canonicalRoot: row.root.canonicalPath,
				fileId: row.source.fileId,
				relativePath: row.source.relativePath,
				sourceVersion: row.source.sourceVersion,
			},
			filename: row.task.filename,
			profileId: row.task.profileId,
			status: row.task.status,
			progress: row.task.progress,
			failureReason: row.task.failureReason,
			createdAtMs: row.task.createdAtMs,
			updatedAtMs: row.task.updatedAtMs,
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
	get(id: string): PreparationTask | undefined {
		const row = this.query().where(eq(preparationTasks.id, id)).get();
		return row ? this.task(row) : undefined;
	}
	find(executionPlanId: string): PreparationTask | undefined {
		const row = this.query()
			.where(eq(preparationTasks.executionPlanId, executionPlanId))
			.get();
		return row ? this.task(row) : undefined;
	}
	save(task: PreparationTask): void {
		this.store.transaction(() => {
			const source = this.sources.registerSource(task.source);
			const values = {
				id: task.id,
				sourceId: source.id,
				executionPlanId: task.identity.executionPlanId,
				profileId: task.profileId,
				profileFingerprint: task.identity.profileFingerprint,
				filename: task.filename,
				snapshot: {
					request: task.request,
					mode: task.mode,
					reasons: task.reasons,
					identity: task.identity,
				},
				status: task.status,
				progress: task.progress,
				failureReason: task.failureReason,
				createdAtMs: task.createdAtMs,
				updatedAtMs: task.updatedAtMs,
			};
			this.store
				.insert(preparationTasks)
				.values(values)
				.onConflictDoUpdate({ target: preparationTasks.id, set: values })
				.run();
		});
	}
	publish(task: PreparationTask, artifact: PreparedArtifact): void {
		this.store.transaction(() => {
			this.save(task);
			const { delivery: _delivery, ...row } = artifact;
			this.store
				.insert(preparedArtifacts)
				.values(row)
				.onConflictDoUpdate({ target: preparedArtifacts.id, set: row })
				.run();
		});
	}
	artifact(id: string): PreparedArtifact | undefined {
		const artifact = this.store
			.select()
			.from(preparedArtifacts)
			.where(eq(preparedArtifacts.id, id))
			.get();
		return artifact ? { ...artifact, delivery: "file" } : undefined;
	}
	artifacts(): PreparedArtifact[] {
		return this.store
			.select()
			.from(preparedArtifacts)
			.all()
			.map((artifact) => ({ ...artifact, delivery: "file" }));
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
