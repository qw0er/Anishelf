import type { SourceSnapshot } from "../../sources/public.js";
import type { AiringSchedule } from "../domain/airing-schedule.js";
import type {
	Candidate,
	Subscription,
	SubscriptionView,
} from "../domain/model.js";

const pageSize = 20;

export function projectSubscriptionView({
	subscription,
	feed,
	sourceChanged,
	runState,
	schedule,
	candidates,
	page,
	includeDiagnostics,
}: {
	subscription: Subscription | null;
	feed: SourceSnapshot | null;
	sourceChanged: boolean;
	runState: string;
	schedule: AiringSchedule | undefined;
	candidates: readonly Candidate[];
	page: number;
	includeDiagnostics: boolean;
}): SubscriptionView {
	const view: SubscriptionView = {
		subscription: null,
		candidates: [],
		total: candidates.length,
		page,
	};
	if (includeDiagnostics) {
		view.candidates = candidates
			.toSorted(
				(a, b) =>
					(a.episode ?? Infinity) - (b.episode ?? Infinity) ||
					a.id.localeCompare(b.id),
			)
			.slice((page - 1) * pageSize, page * pageSize);
		if (subscription?.discovery) view.discovery = subscription.discovery;
	}
	if (!subscription) return view;

	const fallbackSource = subscription.automatic
		? "Automatic source"
		: "Source unavailable";
	const fallbackSourceKind = subscription.automatic ? "automatic" : "feed";
	view.subscription = {
		workKey: subscription.workKey,
		feedId: subscription.feedId,
		startEpisode: subscription.startEpisode,
		profileId: subscription.profileId ?? null,
		enabled: subscription.enabled,
		management: subscription.createdBy === "watching" ? "watching" : "manual",
		runState,
		revision: subscription.revision,
		...(schedule ? { schedule } : {}),
		source: feed?.label ?? fallbackSource,
		sourceKind: subscription.sourceInput?.kind ?? fallbackSourceKind,
		checkedAt: feed?.checkedAt ?? subscription.discovery?.checkedAt ?? null,
		nextAttemptAt: feed?.nextAttemptAt ?? subscription.automatic?.retryAt ?? 0,
		error: sourceChanged
			? "source_changed"
			: (feed?.error ?? subscription.lastError ?? null),
	};
	return view;
}
