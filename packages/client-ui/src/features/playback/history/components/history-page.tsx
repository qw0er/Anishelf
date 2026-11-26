import { useQuery } from "@tanstack/react-query";
import { History, Library, Play } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { EmptyState } from "../../../../shared/components/empty-state.js";
import {
	LoadFailure,
	queryLoadFailure,
} from "../../../../shared/components/load-failure.js";
import { PageHeader } from "../../../../shared/components/page-header.js";
import { buttonStyles } from "../../../../shared/components/ui/button.js";
import { Card, CardContent } from "../../../../shared/components/ui/card.js";
import { Progress } from "../../../../shared/components/ui/progress.js";
import { RefreshButton } from "../../../../shared/components/ui/refresh-button.js";
import { Skeleton } from "../../../../shared/components/ui/skeleton.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { useRefreshError } from "../../../../shared/hooks/use-refresh-error.js";
import { filePath } from "../../../../shared/navigation.js";
import { historyQuery } from "../queries.js";

function timestamp(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function HistoryPage({
	loadRecovery,
}: {
	loadRecovery?: ReactNode;
}) {
	const { t, i18n } = useTranslation();
	const query = useQuery(historyQuery(useQueryScope()));
	useRefreshError(
		"playback-history",
		query.data ? query.error : null,
		query.errorUpdatedAt,
		() => void query.refetch(),
	);
	const history = query.data;
	const failure = queryLoadFailure(query);
	const initialState = failure ? (
		<LoadFailure message={t("errors.historyLoad")} {...failure}>
			{loadRecovery}
		</LoadFailure>
	) : (
		<div
			role="status"
			aria-label={t("loading.pageLabel")}
			className="space-y-3"
		>
			<Skeleton className="h-12 w-full" />
			<Skeleton className="h-12 w-full" />
		</div>
	);
	return (
		<section className="stack-page" aria-labelledby="history-title">
			<PageHeader
				id="history-title"
				title={t("history.title")}
				description={t("history.description")}
				actions={
					<RefreshButton
						label={t("history.refresh")}
						busy={query.isFetching}
						onClick={() => void query.refetch()}
					/>
				}
			/>
			<Card>
				<CardContent>
					{!history ? (
						initialState
					) : history.availability === "unknown" ||
						history.items.length === 0 ? (
						<EmptyState
							embedded
							icon={<History size={24} />}
							title={t(
								history.availability === "unknown"
									? "history.unknown"
									: "history.empty",
							)}
							actions={
								<Link className={buttonStyles("outline")} to="/">
									<Library size={16} aria-hidden="true" />
									{t("app.library")}
								</Link>
							}
						/>
					) : (
						<ul className="divide-y">
							{history.items.map(({ file, progress }) => (
								<li
									key={file.id}
									className="list-row flex flex-wrap items-center justify-between"
								>
									<div className="min-w-0 flex-1 space-y-2">
										<Tooltip content={file.name}>
											<Link
												className="block truncate font-medium underline-offset-4 hover:underline"
												to={filePath(file.id, file.parentId)}
											>
												{file.name}
											</Link>
										</Tooltip>
										<p className="text-sm text-muted-foreground tabular-nums">
											{t(
												progress.durationMs === null
													? "history.position"
													: "history.duration",
												{
													position: timestamp(progress.positionMs),
													duration: timestamp(progress.durationMs ?? 0),
												},
											)}
										</p>
										{progress.durationMs !== null && (
											<Progress
												className="block h-2 w-full accent-primary"
												aria-label={file.name}
												max={progress.durationMs}
												value={progress.positionMs}
											/>
										)}
										{progress.lastViewedAtMs !== null && (
											<time
												className="block text-sm text-muted-foreground"
												dateTime={new Date(
													progress.lastViewedAtMs,
												).toISOString()}
											>
												{new Date(progress.lastViewedAtMs).toLocaleString(
													i18n.language,
												)}
											</time>
										)}
									</div>
									<Tooltip content={file.name}>
										<Link
											className={[buttonStyles("outline"), "w-28"].join(" ")}
											to={filePath(file.id, file.parentId)}
											aria-label={`${t(progress.positionMs > 0 ? "history.resume" : "history.watch")}: ${file.name}`}
										>
											<Play size={16} aria-hidden="true" />
											{t(
												progress.positionMs > 0
													? "history.resume"
													: "history.watch",
											)}
										</Link>
									</Tooltip>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
