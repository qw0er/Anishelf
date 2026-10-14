import type {
	InfiniteData,
	UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { MetadataAiringResponse } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";

export function AiringStatus({
	query,
}: {
	query: UseInfiniteQueryResult<InfiniteData<MetadataAiringResponse>>;
}) {
	const { t, i18n } = useTranslation();
	const records =
		query.data?.pages.flatMap((page) =>
			page.data.items.map((item) => ({
				...item,
				stale: page.stale || Boolean(page.refreshError),
			})),
		) ?? [];
	return (
		<details className="space-y-3 rounded-lg border p-4">
			<summary className="cursor-pointer font-medium">
				{t("anime.airingSchedule")}
			</summary>
			<p className="text-sm text-muted-foreground">
				{t("anime.airingScopeHint")}
			</p>
			{query.isPending && !query.error && (
				<p role="status">{t("anime.loading")}</p>
			)}
			{query.error && (
				<p role="alert">
					{t("anime.airingUnknown")}{" "}
					<Button variant="outline" onClick={() => void query.refetch()}>
						{t("actions.retry")}
					</Button>
				</p>
			)}
			{query.data?.pages.some((page) => page.stale || page.refreshError) && (
				<p role="status">{t("anime.stale")}</p>
			)}
			{query.data && !records.length && <p>{t("anime.airingUnknown")}</p>}
			<ul className="space-y-2 text-sm">
				{records.map((item) => (
					<li key={item.id}>
						{t("player.episodeTitle", { number: item.episode })} ·{" "}
						{new Date(item.airingAt * 1000).toLocaleString(i18n.language)} ·{" "}
						{t(
							item.stale
								? "anime.airingUnknown"
								: item.airingAt * 1000 > Date.now()
									? "anime.notYetAired"
									: "anime.aired",
						)}
					</li>
				))}
			</ul>
			{query.hasNextPage && (
				<Button
					variant="outline"
					disabled={query.isFetchingNextPage}
					onClick={() => void query.fetchNextPage()}
				>
					{t("anime.loadMoreAiring")}
				</Button>
			)}
		</details>
	);
}
