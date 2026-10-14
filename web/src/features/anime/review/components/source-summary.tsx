import { FileVideo } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { CatalogReviewItem } from "../../../../shared/api/contracts.js";
import { episodeName } from "../../shared/episode-name.js";
import { DecisionBadge } from "./decision-badge.js";

export function SourceSummary({ item }: { item: CatalogReviewItem }) {
	const { t } = useTranslation();
	const existing = item.associations;
	return (
		<section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5">
			<div className="flex items-center justify-between gap-2">
				<span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
					<FileVideo className="size-4" aria-hidden="true" />
					{t("review.source")}
				</span>
				<DecisionBadge decision={item.decision} />
			</div>
			<h2 className="font-semibold leading-relaxed wrap-anywhere">
				{item.evidence.originalName}
			</h2>
			{item.relativePath !== item.evidence.originalName && (
				<p className="text-xs leading-relaxed text-muted-foreground wrap-anywhere">
					{item.relativePath}
				</p>
			)}
			{!item.available && (
				<p
					role="alert"
					className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
				>
					{t("review.unavailable")}
				</p>
			)}
			<dl className="border-t pt-3 text-sm">
				<dt className="mb-1 text-xs text-muted-foreground">
					{t("review.rawNumbers")}
				</dt>
				<dd className="wrap-anywhere font-medium">
					{item.evidence.rawEpisodes.join(", ") || t("anime.unknown")}
				</dd>
			</dl>
			{existing.length > 0 && (
				<section className="space-y-2 border-t pt-3">
					<h3 className="text-xs text-muted-foreground">
						{t("review.current")}
					</h3>
					<ul className="space-y-2">
						{existing.map((link) => (
							<li
								key={link.episodeId}
								className="rounded-lg bg-muted/40 p-3 text-sm"
							>
								<Link
									className="font-medium hover:underline wrap-anywhere"
									to={`/anime/${encodeURIComponent(link.workId)}`}
								>
									{link.workTitle}
								</Link>
								<p className="mt-1 text-xs text-muted-foreground wrap-anywhere">
									{episodeName(link, t)}
									{link.label !== episodeName(link, t) && ` · ${link.label}`}
								</p>
							</li>
						))}
					</ul>
				</section>
			)}
			<details className="border-t pt-3 text-xs">
				<summary className="cursor-pointer font-medium text-muted-foreground">
					{t("review.evidence")}
				</summary>
				<div className="mt-3 space-y-3 leading-relaxed text-muted-foreground">
					<p className="wrap-anywhere">
						{item.evidence.titles.join(" · ") || t("review.noMatch")}
					</p>
					{item.reason && <p className="wrap-anywhere">{item.reason}</p>}
					<ul className="space-y-2">
						{item.unresolved.map((reason) => (
							<li className="wrap-anywhere" key={reason}>
								{reason}
							</li>
						))}
					</ul>
				</div>
			</details>
		</section>
	);
}
