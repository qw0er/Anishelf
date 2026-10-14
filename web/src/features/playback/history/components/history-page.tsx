import { useQuery } from "@tanstack/react-query";
import { History, Library, Play, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLoaderData } from "react-router";
import type { HistoryResponse } from "../../../../shared/api/contracts.js";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { EmptyState } from "../../../../shared/components/empty-state.js";
import { PageHeader } from "../../../../shared/components/page-header.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { Card, CardContent } from "../../../../shared/components/ui/card.js";
import { filePath } from "../../../../shared/navigation.js";
import { historyQuery } from "../queries.js";

function timestamp(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function HistoryPage() {
	const { t, i18n } = useTranslation();
	const initial = useLoaderData<HistoryResponse>();
	const query = useQuery({ ...historyQuery(useQueryScope()) });
	const history = query.data ?? initial;
	if (query.error && !query.data) throw query.error;
	return (
		<section className="stack-page" aria-labelledby="history-title">
			<PageHeader
				id="history-title"
				title={t("history.title")}
				description={t("history.description")}
				actions={
					<Button
						variant="outline"
						disabled={query.isFetching}
						aria-busy={query.isFetching}
						onClick={() => void query.refetch()}
					>
						<RefreshCw size={16} aria-hidden="true" />
						{t("history.refresh")}
					</Button>
				}
			/>
			<Card
				className={
					history.availability === "unknown" || history.items.length === 0
						? "border-0 bg-transparent py-0"
						: undefined
				}
			>
				<CardContent
					className={
						history.availability === "unknown" || history.items.length === 0
							? "px-0"
							: undefined
					}
				>
					{history.availability === "unknown" || history.items.length === 0 ? (
						<EmptyState
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
									className="flex min-w-0 flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
								>
									<div className="min-w-0 flex-1 space-y-2">
										<Link
											className="font-medium wrap-anywhere underline-offset-4 hover:underline"
											to={filePath(file.id, file.parentId)}
										>
											{file.name}
										</Link>
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
											<progress
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
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
