import {
	type ReactNode,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { LocalWorkDetailResponse } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Artwork } from "../../shared/components/artwork.js";
import { airedEpisodeCount, fuzzyDate } from "../detail-format.js";
export function WorkMetadataHeader({
	data,
	viewing,
	action,
	subscription,
	bannerUrl,
}: {
	bannerUrl?: string | null;
	viewing?: ReactNode;
	action?: ReactNode;
	subscription?: ReactNode;
	data: {
		metadata: LocalWorkDetailResponse["metadata"];
		work: Pick<
			LocalWorkDetailResponse["work"],
			"displayTitle" | "coverUrl" | "format" | "year" | "episodeCount"
		>;
	};
}) {
	const { t } = useTranslation();
	const { work, metadata } = data;
	const info = metadata.data;
	const [expanded, setExpanded] = useState(false);
	const aliasesId = useId();
	const aliasesRef = useRef<HTMLParagraphElement>(null);
	const [overflowing, setOverflowing] = useState(false);
	const aliases = [...new Set(info.titles.map((title) => title.value))].filter(
		(title) => title !== work.displayTitle,
	);

	const aliasesText = aliases.join(" · ");
	const aired = airedEpisodeCount(info);
	const startDate = fuzzyDate(info.startDate);
	const endDate = fuzzyDate(info.endDate);
	const airedValue =
		aired === null
			? null
			: info.episodeCount === null
				? String(aired)
				: `${aired} / ${info.episodeCount}`;
	useLayoutEffect(() => {
		const element = aliasesRef.current;
		if (!element || !aliasesText) return;
		const measure = () => {
			const lineHeight =
				Number.parseFloat(getComputedStyle(element).lineHeight) || 20;
			const overflows = element.scrollHeight > lineHeight * 2 + 1;
			setOverflowing(overflows);
			if (!overflows) setExpanded(false);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [aliasesText]);

	return (
		<div className="work-hero">
			{bannerUrl && (
				<div className="work-hero-banner" aria-hidden="true">
					<Artwork url={bannerUrl} title="" banner />
				</div>
			)}
			<div className="work-hero-content">
				<div className="work-hero-cover">
					<Artwork
						key={`cover:${metadata.fetchedAt}`}
						url={work.coverUrl}
						title={work.displayTitle}
					/>
				</div>
				<div className="min-w-0 max-w-3xl space-y-4">
					<h1 className="text-2xl leading-tight font-semibold tracking-tight wrap-anywhere sm:text-3xl xl:text-4xl">
						{work.displayTitle}
					</h1>
					{aliases.length > 0 && (
						<div className="space-y-1">
							<p
								id={aliasesId}
								ref={aliasesRef}
								className={`text-sm leading-5 text-muted-foreground wrap-anywhere ${expanded ? "" : "line-clamp-2"}`}
							>
								{aliasesText}
							</p>
							{overflowing && (
								<Button
									variant="ghost"
									className="h-auto px-0 py-0 text-xs text-muted-foreground"
									aria-expanded={expanded}
									aria-controls={aliasesId}
									onClick={() => {
										console.debug("[AnimeDetail] Alternative titles toggled.", {
											expanded: !expanded,
										});
										setExpanded(!expanded);
									}}
								>
									{t(expanded ? "anime.hideTitles" : "anime.showTitles")}
								</Button>
							)}
						</div>
					)}
					<dl className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
						{[
							["format", work.format?.replaceAll("_", " ")],
							["year", work.year],
							[
								"releaseStatus",
								info.status
									? t(`anime.releaseStatuses.${info.status}`, {
											defaultValue: info.status.replaceAll("_", " "),
										})
									: null,
							],
						].map(([key, value]) => (
							<div key={key} className="text-muted-foreground">
								<dt className="sr-only">{t(`anime.${key}`)}</dt>
								<dd className="font-medium">{value ?? t("anime.unknown")}</dd>
							</div>
						))}
					</dl>
					<dl className="flex max-w-3xl flex-wrap gap-x-6 gap-y-2 text-sm">
						{[
							["totalEpisodes", work.episodeCount ?? t("anime.unknown")],
							...(airedValue === null ? [] : [["airedEpisodes", airedValue]]),
							...(startDate ? [["startDate", startDate]] : []),
							...(endDate ? [["endDate", endDate]] : []),
						].map(([key, value]) => (
							<div key={key} className="flex items-baseline gap-2">
								<dt className="text-muted-foreground">{t(`anime.${key}`)}</dt>
								<dd className="font-medium tabular-nums">{value}</dd>
							</div>
						))}
					</dl>
					{(viewing || action) && (
						<div className="work-primary-actions">
							{action && (
								<div className="work-play-action flex flex-wrap items-center gap-2">
									{action}
								</div>
							)}
							{viewing}
						</div>
					)}
					{subscription}
				</div>
			</div>
		</div>
	);
}
