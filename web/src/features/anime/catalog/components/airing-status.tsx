import type {
	InfiniteData,
	UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { CalendarDays, ChevronDown, Info, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MetadataAiringResponse } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";

export function AiringStatus({
	query,
}: {
	query: UseInfiniteQueryResult<InfiniteData<MetadataAiringResponse>>;
}) {
	const { t, i18n } = useTranslation();
	const records = Array.from(
		new Map(
			(query.data?.pages ?? []).flatMap((page) =>
				page.data.items.map(
					(item) =>
						[
							item.id,
							{ ...item, stale: page.stale || Boolean(page.refreshError) },
						] as const,
				),
			),
		).values(),
	).sort((a, b) => a.airingAt - b.airingAt);
	const cached =
		records.some((item) => item.stale) ||
		query.data?.pages.some((page) => page.stale || page.refreshError);
	const refreshing =
		query.isFetching || query.data?.pages.some((page) => page.refreshing);
	return (
		<section aria-label={t("anime.airingSchedule")} className="space-y-2">
			<div className="flex flex-wrap items-start gap-2 text-sm">
				<CalendarDays
					className="mt-1 size-4 text-muted-foreground"
					aria-hidden="true"
				/>
				<details className="group min-w-0 flex-1">
					<summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
						<span className="font-medium">{t("anime.airingSchedule")}</span>
						<span className="text-xs text-muted-foreground">
							{query.isPending
								? t("anime.airingLoading")
								: t("anime.airingRecordCount", { count: records.length })}
						</span>
						<ChevronDown
							className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180"
							aria-hidden="true"
						/>
					</summary>
					<div className="mt-2 space-y-3">
						{query.data && !records.length && (
							<p className="text-xs text-muted-foreground">
								{t("anime.airingUnknown")}
							</p>
						)}
						<ul className="divide-y">
							{records.map((item) => (
								<li
									key={item.id}
									className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
								>
									<span className="min-w-20 font-medium">
										{t("player.episodeTitle", { number: item.episode })}
									</span>
									<time
										dateTime={new Date(item.airingAt * 1000).toISOString()}
										className="flex-1 tabular-nums text-muted-foreground"
									>
										{new Date(item.airingAt * 1000).toLocaleString(
											i18n.language,
											{ dateStyle: "medium", timeStyle: "short" },
										)}
									</time>
									<span
										className={`rounded-full px-2 py-0.5 text-xs ${!item.stale && item.airingAt * 1000 > Date.now() ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
									>
										{t(
											item.stale
												? "anime.airingUnverified"
												: item.airingAt * 1000 > Date.now()
													? "anime.notYetAired"
													: "anime.aired",
										)}
									</span>
								</li>
							))}
						</ul>
						{query.hasNextPage && (
							<div className="space-y-2">
								<p className="text-xs text-muted-foreground">
									{t("anime.airingPartial")}
								</p>
								<Button
									variant="outline"
									className="h-8 px-3 text-xs"
									disabled={query.isFetchingNextPage}
									onClick={() => void query.fetchNextPage()}
								>
									{t("anime.loadMoreAiring")}
								</Button>
							</div>
						)}
					</div>
				</details>
				<Tooltip content={t("anime.airingScopeHint")} openOnClick>
					<Button
						variant="ghost"
						className="size-6 shrink-0 p-0 text-muted-foreground"
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
			{query.error && (
				<div
					role="alert"
					className="flex items-center gap-2 text-xs text-muted-foreground"
				>
					{t("anime.airingFailed")}
					<Button
						variant="outline"
						className="h-8 px-3 text-xs"
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
