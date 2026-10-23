import { and, eq, isNotNull } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type {
	WatchingMember,
	WatchingPolicy,
	WatchingStore,
} from "../domain/model.js";
import {
	acquisitionWatchingMembers as members,
	acquisitionWatchingPolicy as policy,
} from "./schema.js";
export class WatchingRepository implements WatchingStore {
	constructor(private readonly store: Store) {}
	policy() {
		return (
			this.store.select().from(policy).where(eq(policy.id, "default")).get()
				?.value ?? null
		);
	}
	savePolicy(value: WatchingPolicy) {
		this.store
			.insert(policy)
			.values({ id: "default", value })
			.onConflictDoUpdate({ target: policy.id, set: { value } })
			.run();
	}
	members() {
		return this.store.select().from(members).all();
	}
	member(accountId: string, workKey: string) {
		return this.store
			.select()
			.from(members)
			.where(
				and(eq(members.accountId, accountId), eq(members.workKey, workKey)),
			)
			.get();
	}
	owner(workKey: string) {
		return this.store
			.select()
			.from(members)
			.where(
				and(
					eq(members.workKey, workKey),
					isNotNull(members.subscriptionRevision),
				),
			)
			.get();
	}
	saveMember(value: WatchingMember) {
		this.store
			.insert(members)
			.values(value)
			.onConflictDoUpdate({
				target: [members.accountId, members.workKey],
				set: value,
			})
			.run();
	}
}
