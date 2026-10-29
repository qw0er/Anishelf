import type {
	InfiniteData,
	UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { CalendarDays, Info, RefreshCw } from "lucide-react";
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
					role={query.isPending ? "status" : undefined}
					className="text-xs text-muted-foreground"
				>
					{query.isPending
						? t("anime.airingLoading")
						: t("anime.airingRecordCount", { count: records.length })}
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
			{query.data && !records.length && (
				<p className="text-xs text-muted-foreground">
					{t("anime.airingUnknown")}
				</p>
			)}
			{records.length > 0 && (
				<div className="max-h-80 overflow-auto rounded-md border">
					<table className="w-full table-fixed border-collapse text-left text-xs">
						<caption className="sr-only">{t("anime.airingSchedule")}</caption>
						<colgroup>
							<col className="w-[26%]" />
							<col className="w-[44%]" />
							<col className="w-[30%]" />
						</colgroup>
						<thead className="sticky top-0 z-10 bg-card">
							<tr className="border-b">
								<th
									scope="col"
									className="px-2 py-2 font-medium text-muted-foreground"
								>
									{t("anime.airingEpisodeColumn")}
								</th>
								<th
									scope="col"
									className="px-2 py-2 font-medium text-muted-foreground"
								>
									{t("anime.airingWhenColumn")}
								</th>
								<th
									scope="col"
									className="px-2 py-2 font-medium text-muted-foreground"
								>
									{t("anime.airingStatusColumn")}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{records.map((item) => {
								const date = new Date(item.airingAt * 1000);
								const upcoming =
									!item.stale && item.airingAt * 1000 > Date.now();
								return (
									<tr key={item.id} className="align-top">
										<th
											scope="row"
											className="px-2 py-2 font-medium whitespace-nowrap"
										>
											{t("player.episodeTitle", { number: item.episode })}
										</th>
										<td className="px-2 py-2 text-muted-foreground tabular-nums">
											<time
												dateTime={date.toISOString()}
												className="grid gap-0.5"
											>
												<span>
													{date.toLocaleDateString(i18n.language, {
														month: "short",
														day: "numeric",
														year: "numeric",
													})}
												</span>
												<span>
													{date.toLocaleTimeString(i18n.language, {
														hour: "2-digit",
														minute: "2-digit",
													})}
												</span>
											</time>
										</td>
										<td className="px-2 py-2 whitespace-nowrap">
											<span
												className={`inline-block rounded-full px-2 py-0.5 text-xs ${upcoming ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
											>
												{t(
													item.stale
														? "anime.airingUnverified"
														: upcoming
															? "anime.notYetAired"
															: "anime.aired",
												)}
											</span>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
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
						onClick={() => void query.fetchNextPage()}
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
