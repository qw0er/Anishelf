import type { SubscriptionView } from "../../shared/api/contracts.js";
import type { StatusTone } from "../../shared/components/ui/status-badge.js";
import i18n from "../../shared/i18n.js";
import { watchingReason } from "./watching-reason.js";

const blockedStates = new Set([
	"tracking_account_changed",
	"source_changed",
	"profile_unavailable",
	"destination_changed",
	"authorization_required",
	"source_reselection_required",
	"different_account_owner",
	"invalid_progress",
	"subscription_limit",
]);

export function subscriptionStatus(
	sub: SubscriptionView["subscription"],
	now = Date.now(),
): {
	label: string;
	tone: StatusTone;
	needsAttention: boolean;
	cooling: boolean;
} {
	const completed = sub?.runState === "completed";
	const cooling =
		!!sub && sub.error === "rate_limited" && sub.nextAttemptAt > now;
	const needsAttention =
		!!sub &&
		!completed &&
		!!(
			(sub.error && sub.error !== "no_eligible_source") ||
			(sub.runState && blockedStates.has(sub.runState))
		);
	let label = i18n.t("acquisition.manager.active");
	let tone: StatusTone = "neutral";
	if (!sub) label = i18n.t("acquisition.subscription.notSubscribed");
	else if (completed) label = watchingReason("completed", true);
	else if (cooling) {
		label = i18n.t("acquisition.manager.cooldown");
		tone = "warning";
	} else if (needsAttention) {
		const code = sub.error ?? sub.runState;
		label = i18n.t(`acquisition.manager.issues.${code}`, {
			defaultValue: watchingReason(code ?? "", true),
		});
		tone = ["fetch_failed", "discovery_unavailable", "source_busy"].includes(
			code ?? "",
		)
			? "warning"
			: "error";
	} else if (!sub.enabled) label = i18n.t("acquisition.subscription.paused");
	else if (
		sub.management === "watching" &&
		sub.runState &&
		sub.runState !== "active"
	)
		label = watchingReason(sub.runState, true);
	else if (sub.sourceKind === "automatic")
		label = i18n.t(
			sub.error === "no_eligible_source"
				? "acquisition.manager.waiting"
				: "acquisition.manager.searching",
		);
	return { label, tone, needsAttention, cooling };
}
