import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { ProfileCatalogIssue } from "../../../../shared/profile-issue.js";
import type { ReleaseAssessmentApi } from "../../../anime/public.js";
import type { SourcesApi } from "../../sources/public.js";
import type { Subscription } from "../domain/model.js";
import {
	type AcquisitionProfile,
	acquisitionProfileFingerprint,
	builtinAcquisitionProfiles,
	defaultAcquisitionProfileId,
} from "../domain/profiles.js";
import type { SubscriptionStore } from "../ports.js";
export type SubscriptionsOptions = {
	onRemoved?(workKey: string): void;
	managedStopReason?(subscription: Subscription): string | null;
	profiles?: readonly AcquisitionProfile[];
	profileIssue?: ProfileCatalogIssue;
	defaultProfileId?: () => string | undefined;
	defaultProfileRevision?: () => string;
	lockedCandidates?: (workKey: string) => string[];
	store: SubscriptionStore;
	sources: SourcesApi;
	anime: ReleaseAssessmentApi;
	downloads: (signal: AbortSignal) => Promise<string[] | null>;
	logger: Logger;
	now?: () => number;
	/** Read-only configuration stamp, not a dependency on the Downloads application. */
	downloadTarget?: () => {
		revision: string;
		connectionGeneration: string;
		validated: boolean;
	} | null;
};
export class SubscriptionsContext {
	private readonly profileLifetime = randomUUID();
	profileScope(subscription: Pick<Subscription, "profileId" | "createdBy">) {
		const followsDefault =
			subscription.createdBy === "watching" || !subscription.profileId;
		const id = followsDefault
			? (this.options.defaultProfileId?.() ?? defaultAcquisitionProfileId)
			: subscription.profileId;
		const profile = (this.options.profiles ?? builtinAcquisitionProfiles).find(
			(p) => p.id === id,
		);
		return JSON.stringify([
			id,
			profile ? acquisitionProfileFingerprint(profile) : null,
			followsDefault
				? this.profileLifetime + (this.options.defaultProfileRevision?.() ?? "")
				: "explicit",
		]);
	}
	readonly shutdown = new AbortController();
	readonly pending = new Set<Promise<unknown>>();
	constructor(readonly options: SubscriptionsOptions) {}
	get signal(): AbortSignal {
		return this.shutdown.signal;
	}

	stopReason(subscription: Subscription, selecting = true): string | null {
		if (!subscription.enabled) return "paused";
		if (subscription.completion && !subscription.completion.resumed)
			return "completed";
		if (subscription.createdBy === "watching") {
			const reason = this.options.managedStopReason
				? this.options.managedStopReason(subscription)
				: "authorization_required";
			if (reason) return reason;
			const id =
				this.options.defaultProfileId?.() ?? defaultAcquisitionProfileId;
			if (
				selecting &&
				!(this.options.profiles ?? builtinAcquisitionProfiles).some(
					(p) => p.id === id,
				)
			)
				return "profile_unavailable";
		}
		return null;
	}
	runnable(subscription: Subscription) {
		return this.stopReason(subscription) === null;
	}
	now() {
		return this.options.now?.() ?? Date.now();
	}
	open() {
		if (this.shutdown.signal.aborted)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Subscriptions are stopping.",
			);
	}
	tracked<T>(operation: () => Promise<T>): Promise<T> {
		this.open();
		const task = operation();
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => {});
		return task;
	}
}
