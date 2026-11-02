import type {
	InfiniteData,
	UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { CalendarDays, ChevronDown, Info, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	MetadataAiringResponse,
	MetadataDetailsResponse,
} from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../../../shared/components/ui/collapsible.js";
import { StatusBadge } from "../../../../shared/components/ui/status-badge.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { type AiringRecord, airingSchedule } from "../airing-schedule.js";

export function AiringStatus({
	query,
	metadata,
}: {
	query: UseInfiniteQueryResult<InfiniteData<MetadataAiringResponse>>;
	metadata: MetadataDetailsResponse | null;
}) {
	const { t, i18n } = useTranslation();
	const [now, setNow] = useState(Date.now);
	const { plans, history } = airingSchedule(
		query.data?.pages ?? [],
		metadata,
		now,
	);
	const boundary = Math.min(
		...plans
			.filter((item) => item.airingAt * 1000 > now)
			.map((item) => item.airingAt * 1000),
	);
	useEffect(() => {
		if (!Number.isFinite(boundary)) return;
		const timer = setTimeout(
			() => setNow(Date.now()),
			Math.min(Math.max(1, boundary - Date.now()), 2_147_483_647),
		);
		return () => clearTimeout(timer);
	}, [boundary]);
	const cached =
		plans.some((item) => item.stale) ||
		history.some((item) => item.stale) ||
		query.data?.pages.some((page) => page.stale || page.refreshError);
	const timeZone = new Intl.DateTimeFormat(i18n.language, {
		timeZoneName: "short",
	})
		.formatToParts(now)
		.find((part) => part.type === "timeZoneName")?.value;
	const refreshing =
		query.isFetching || query.data?.pages.some((page) => page.refreshing);
	return (
		<section
			aria-label={t("anime.airingSchedule")}
			className="surface-panel space-y-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				<CalendarDays
					className="size-4 text-muted-foreground"
					aria-hidden="true"
				/>
				<h2 className="section-title">{t("anime.airingSchedule")}</h2>
				<span
					role={query.isPending && !plans.length ? "status" : undefined}
					className="text-xs text-muted-foreground"
				>
					{query.isPending && !plans.length
						? t("anime.airingLoading")
						: t("anime.airingPlanCount", { count: plans.length })}
				</span>
				<Tooltip content={t("anime.airingScopeHint")} openOnClick>
					<Button
						size="icon"
						variant="ghost"
						className="ml-auto text-muted-foreground"
						aria-label={t("anime.airingInfo")}
					>
						<Info className="size-3.5" aria-hidden="true" />
					</Button>
				</Tooltip>
				{cached && (
					<Tooltip content={t("anime.stale")} openOnClick>
						<Button
							variant="ghost"
							className="h-6 rounded-full bg-muted px-2 text-xs text-muted-foreground"
						>
							{t("trackingList.cached")}
						</Button>
					</Tooltip>
				)}
				{refreshing && (
					<span role="status" aria-label={t("anime.airingLoading")}>
						<RefreshCw
							className="size-3.5 animate-spin text-muted-foreground"
							aria-hidden="true"
						/>
					</span>
				)}
			</div>
			<p className="text-xs text-muted-foreground">
				{t("anime.airingTimeZone", { timeZone })}
			</p>
			{plans.length > 0 ? (
				<AiringTable records={plans} planned />
			) : (
				query.data &&
				!query.error &&
				!query.isPending && (
					<p className="text-sm text-muted-foreground">
						{t("anime.airingNoPlans")}
					</p>
				)
			)}
			{history.length > 0 && (
				<Collapsible
					onOpenChange={(open) =>
						console.debug("[AnimeDetail] Airing history toggled.", {
							open,
							count: history.length,
						})
					}
				>
					<CollapsibleTrigger className="group flex w-full items-center gap-2 text-sm text-muted-foreground">
						<ChevronDown
							className="size-4 transition-transform group-aria-expanded:rotate-180"
							aria-hidden="true"
						/>
						{t("anime.airingHistory", { count: history.length })}
					</CollapsibleTrigger>
					<CollapsibleContent>
						<AiringTable records={history} />
					</CollapsibleContent>
				</Collapsible>
			)}
			{query.hasNextPage && (
				<div className="space-y-2">
					<p className="text-xs text-muted-foreground">
						{t("anime.airingPartial")}
					</p>
					<Button
						size="sm"
						variant="outline"
						disabled={query.isFetchingNextPage}
						onClick={() => {
							console.debug("[AnimeDetail] Loading more airing records.");
							void query.fetchNextPage();
						}}
					>
						{t("anime.loadMoreAiring")}
					</Button>
				</div>
			)}
			{query.error && (
				<div role="alert" className="flex items-center gap-2 text-xs">
					{t("anime.airingFailed")}
					<Button
						size="sm"
						variant="outline"
						disabled={query.isFetching}
						onClick={() => void query.refetch()}
					>
						{t("actions.retry")}
					</Button>
				</div>
			)}
		</section>
	);
}

function AiringTable({
	records,
	planned = false,
}: {
	records: AiringRecord[];
	planned?: boolean;
}) {
	const { t, i18n } = useTranslation();
	const next = records.find(
		(item) => item.status === "scheduled" && !item.stale,
	);
	return (
		<div className="max-h-80 overflow-auto rounded-md border">
			<table className="w-full table-fixed border-collapse text-left text-xs">
				<caption className="sr-only">
					{t(planned ? "anime.airingSchedule" : "anime.airingHistory", {
						count: records.length,
					})}
				</caption>
				<colgroup>
					<col className="w-[24%]" />
					<col className="w-[46%]" />
					<col className="w-[30%]" />
				</colgroup>
				<thead className="sticky top-0 z-10 bg-card">
					<tr className="border-b">
						{[
							"anime.airingEpisodeColumn",
							"anime.airingWhenColumn",
							"anime.airingStatusColumn",
						].map((key) => (
							<th
								key={key}
								scope="col"
								className="px-2 py-2 font-medium text-muted-foreground"
							>
								{t(key)}
							</th>
						))}
					</tr>
				</thead>
				<tbody className="divide-y">
					{records.map((item) => {
						const date = new Date(item.airingAt * 1000);
						const isNext = planned && item === next;
						return (
							<tr
								key={item.episode}
								className={isNext ? "bg-primary/5 align-top" : "align-top"}
							>
								<th scope="row" className="px-2 py-2 font-medium">
									{t("player.episodeTitle", { number: item.episode })}
								</th>
								<td className="px-2 py-2 text-muted-foreground tabular-nums">
									<time dateTime={date.toISOString()} className="grid gap-0.5">
										<span>
											{date.toLocaleDateString(i18n.language, {
												month: "short",
												day: "numeric",
												year: "numeric",
											})}
										</span>
										<span>
											{date.toLocaleDateString(i18n.language, {
												weekday: "short",
											})}{" "}
											{date.toLocaleTimeString(i18n.language, {
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
									</time>
								</td>
								<td className="px-2 py-2">
									<StatusBadge
										tone={isNext ? "primary" : "neutral"}
										className="max-w-full whitespace-normal text-center"
									>
										{t(
											item.status === "unconfirmed"
												? "anime.airingAwaitingConfirmation"
												: item.stale
													? "anime.airingUnverified"
													: isNext
														? "anime.airingNext"
														: item.status === "scheduled"
															? "anime.notYetAired"
															: "anime.aired",
										)}
									</StatusBadge>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
