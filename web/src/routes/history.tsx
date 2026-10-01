import { Library, Play, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { Button, buttonStyles } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import type { historyLoader } from "./loaders.js";
import { filePath } from "./paths.js";

function timestamp(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function HistoryPage() {
	const { t, i18n } = useTranslation();
	const history = useLoaderData<typeof historyLoader>();
	const revalidator = useRevalidator();
	return (
		<section className="stack-page" aria-labelledby="history-title">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0 space-y-2">
					<h1 id="history-title" className="page-title">
						{t("history.title")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t("history.description")}
					</p>
				</div>
				<Button
					variant="outline"
					disabled={revalidator.state !== "idle"}
					aria-busy={revalidator.state !== "idle"}
					onClick={() => void revalidator.revalidate()}
				>
					<RefreshCw size={16} aria-hidden="true" />
					{t("history.refresh")}
				</Button>
			</div>
			<Card>
				<CardContent>
					{history.availability === "unknown" || history.items.length === 0 ? (
						<div className="space-y-4">
							<p className="text-sm text-muted-foreground">
								{t(
									history.availability === "unknown"
										? "history.unknown"
										: "history.empty",
								)}
							</p>
							<Link className={buttonStyles("outline")} to="/">
								<Library size={16} aria-hidden="true" />
								{t("app.library")}
							</Link>
						</div>
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
										className={buttonStyles("outline")}
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
