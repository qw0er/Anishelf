import type { SubscriptionView } from "../../shared/api/contracts.js";
import i18n from "../../shared/i18n.js";

type Schedule = NonNullable<
	NonNullable<SubscriptionView["subscription"]>["schedule"]
>;
export function airingWaitLabel(schedule: Schedule | null | undefined) {
	return schedule &&
		["waiting_for_premiere", "waiting_for_episode", "release_delay"].includes(
			schedule.reason,
		)
		? i18n.t(
				schedule.metadataFresh
					? `acquisition.schedule.${schedule.reason}`
					: "acquisition.schedule.verificationPending",
				{
					episode: schedule.episode,
				},
			)
		: null;
}
/** Format absolute instants in an explicit IANA zone; never parse calendar-only dates. */
export function formatAiringTime(
	time: number,
	locale = i18n.language,
	timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
	return `${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "long", timeZone }).format(time)} · ${timeZone}`;
}
export function SubscriptionSchedule({
	schedule,
}: {
	schedule: Schedule | null | undefined;
}) {
	if (!schedule) return null;
	const waiting = airingWaitLabel(schedule);
	return (
		<div className="space-y-1 text-sm text-muted-foreground">
			{waiting && <p>{waiting}</p>}
			{schedule.airingAt !== null && (
				<p>
					{i18n.t("acquisition.schedule.airingAt", {
						time: formatAiringTime(schedule.airingAt),
					})}
				</p>
			)}
			<p>
				{schedule.nextCheckAt === null
					? i18n.t("acquisition.schedule.awaitingTime")
					: schedule.nextCheckAt > Date.now()
						? i18n.t("acquisition.schedule.nextCheck", {
								time: formatAiringTime(schedule.nextCheckAt),
							})
						: i18n.t("acquisition.schedule.checkDue")}
			</p>
			{waiting && (
				<p>
					{i18n.t("acquisition.schedule.metadataCheck", {
						time: formatAiringTime(schedule.metadataCheckAt),
					})}
				</p>
			)}
			{!schedule.metadataFresh && (
				<p>
					{i18n.t(
						schedule.reason === "fallback"
							? "acquisition.schedule.fallback"
							: "acquisition.schedule.verificationPending",
					)}
				</p>
			)}
		</div>
	);
}
