import type { WatchingConfig } from "../public.js";
export interface WatchingGrant extends WatchingConfig {
	id: string;
	accountId: string;
	trackingGeneration: string;
	sourceRevision: string;
	profileFingerprint: string;
	destinationRevision: string;
	downloaderGeneration: string;
}
export interface WatchingPolicy {
	revision: string;
	enabled: boolean;
	grant: WatchingGrant | null;
	appliedSnapshot: string | null;
}
export interface WatchingMember {
	accountId: string;
	workKey: string;
	revision: string;
	title: string;
	excluded: boolean;
	paused: boolean;
	subscriptionRevision: string | null;
	grantId: string | null;
	startEpisode: number | null;
	reason: string;
	retryAt: number;
}
export interface WatchingStore {
	policy(): WatchingPolicy | null;
	savePolicy(value: WatchingPolicy): void;
	members(): WatchingMember[];
	member(accountId: string, workKey: string): WatchingMember | undefined;
	owner(workKey: string): WatchingMember | undefined;
	saveMember(value: WatchingMember): void;
}
