import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import { Link, useParams, useSearchParams } from "react-router";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { CatalogDetailResponse } from "../../../shared/api/contracts.js";
import { useQueryScope } from "../../../shared/api/queries.js";
import { Button, buttonStyles } from "../../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "../../../shared/components/ui/dialog.js";
import { Skeleton } from "../../../shared/components/ui/skeleton.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";
import {
	animePlayerPath,
	libraryReturnPath,
} from "../../../shared/navigation.js";
import { refreshWork } from "../api.js";
import { relationsQuery, workQuery } from "../queries.js";
import { Artwork } from "./artwork.js";

type Episode = CatalogDetailResponse["episodes"][number];
type Version = Episode["versions"][number];
function safeLink(value: string | null): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.href
			: undefined;
	} catch {
		return undefined;
	}
}
function releaseInfo(version: Version): string {
	return [
		...new Set(
			version.evidence.inputs.flatMap((input) =>
				input.elements
					.filter((element) =>
						[
							"ReleaseGroup",
							"ReleaseVersion",
							"Language",
							"VideoResolution",
							"VideoTerm",
							"AudioTerm",
							"Source",
							"release_group",
							"release_version",
							"language",
							"video_resolution",
							"video_term",
							"audio_term",
							"source",
						].includes(element.kind),
					)
					.map((element) => element.value),
			),
		),
	].join(" · ");
}
export function AnimeDetail() {
	const { id = "" } = useParams();
	const scope = useQueryScope();
	const query = useQuery(workQuery(id, scope));
	const { t } = useTranslation();
	if (!query.data)
		return query.error ? (
			<section className="stack-page">
				<p role="alert">
					{t(getErrorTranslationKey(query.error) ?? "errors.pageLoad")}
				</p>
				<Button variant="outline" onClick={() => void query.refetch()}>
					{t("actions.retry")}
				</Button>
				<Link to="/" className={buttonStyles("outline")}>
					{t("anime.back")}
				</Link>
			</section>
		) : (
			<div role="status" aria-label={t("anime.loading")}>
				<Skeleton className="h-64 w-full" />
			</div>
		);
	return <WorkDetail key={`${id}:${scope}`} data={query.data} />;
}
function WorkDetail({ data }: { data: CatalogDetailResponse }) {
	const { t } = useTranslation();
	const scope = useQueryScope();
	const client = useQueryClient();
	const [params] = useSearchParams();
	const libraryPath = libraryReturnPath(params.get("library"));
	const { work, metadata, episodes } = data;
	const info = metadata.data;
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = episodes.find((episode) => episode.id === selectedId);
	const [showSpoilers, setShowSpoilers] = useState(false);
	const [relationsPage, setRelationsPage] = useState(1);
	const relations = useQuery(
		relationsQuery(work.reference.provider, work.reference.id, relationsPage),
	);
	const refresh = useMutation({
		mutationFn: () => refreshWork(work.id, work.revision),
		onSuccess: async (result) => {
			client.setQueryData(workQuery(work.id, scope).queryKey, result);
			await client.invalidateQueries({ queryKey: ["catalog", scope, "list"] });
		},
	});
	const providerUrl = safeLink(info.siteUrl);
	function playPath(version: Version, episode: Episode) {
		return animePlayerPath(
			version.fileId,
			work.id,
			episode.id,
			libraryPath,
			version.sourceVersion,
		);
	}
	return (
		<section className="stack-page">
			<div className="action-row">
				<Link
					to={libraryPath}
					state={{ focusWork: work.id }}
					className={buttonStyles("outline")}
					preventScrollReset
				>
					<ArrowLeft size={16} aria-hidden="true" />
					{t("anime.back")}
				</Link>
				<Button
					variant="outline"
					disabled={refresh.isPending}
					onClick={() => refresh.mutate()}
				>
					<RefreshCw size={16} aria-hidden="true" />
					{t(refresh.isPending ? "anime.refreshing" : "anime.refresh")}
				</Button>
			</div>
			{refresh.error && (
				<p role="alert">
					{t(getErrorTranslationKey(refresh.error) ?? "anime.refreshFailed")}
				</p>
			)}
			{metadata.refreshError && <p role="alert">{t("anime.refreshFailed")}</p>}
			{metadata.stale && (
				<p role="status" className="text-sm text-muted-foreground">
					{t("anime.stale")}
				</p>
			)}
			{metadata.refreshing && <p role="status">{t("anime.refreshing")}</p>}
			<Artwork
				key={`banner:${metadata.fetchedAt}`}
				url={data.bannerUrl}
				title={work.displayTitle}
				banner
			/>
			<div className="grid min-w-0 gap-6 sm:grid-cols-[10rem_minmax(0,1fr)]">
				<div className="w-32 overflow-hidden rounded-lg sm:w-full">
					<Artwork
						key={`cover:${metadata.fetchedAt}`}
						url={work.coverUrl}
						title={work.displayTitle}
					/>
				</div>
				<div className="min-w-0 space-y-3">
					<h1 className="page-title">{work.displayTitle}</h1>
					<p className="text-sm text-muted-foreground wrap-anywhere">
						{[
							...new Set([
								...work.aliases,
								...info.titles.map((title) => title.value),
							]),
						]
							.filter((title) => title !== work.displayTitle)
							.join(" · ")}
					</p>
					<dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
						{[
							["format", work.format?.replaceAll("_", " ")],
							["year", work.year],
							["releaseStatus", info.status?.replaceAll("_", " ")],
							["episodeCount", work.episodeCount],
							["startDate", fuzzyDate(info.startDate)],
							["endDate", fuzzyDate(info.endDate)],
						].map(([key, value]) => (
							<div key={key}>
								<dt className="text-muted-foreground">{t(`anime.${key}`)}</dt>
								<dd>{value ?? t("anime.unknown")}</dd>
							</div>
						))}
					</dl>
					<p className="text-sm">
						{t("anime.provider", { provider: work.reference.provider })}
						{providerUrl && (
							<>
								{" "}
								·{" "}
								<a
									className="underline"
									href={providerUrl}
									target="_blank"
									rel="noopener noreferrer"
								>
									{t("anime.providerPage")}
								</a>
							</>
						)}
					</p>
				</div>
			</div>
			<div className="space-y-3">
				<h2 className="text-lg font-semibold">{t("anime.synopsis")}</h2>
				{info.description ? (
					<div className="space-y-2 wrap-anywhere [&_a]:underline [&_p]:my-2">
						<Markdown
							rehypePlugins={[rehypeRaw, rehypeSanitize]}
							components={{
								img: () => null,
								a: ({ href, children }) =>
									safeLink(href ?? null) ? (
										<a
											href={safeLink(href ?? null)}
											target="_blank"
											rel="noopener noreferrer"
										>
											{children}
										</a>
									) : (
										<span>{children}</span>
									),
							}}
						>
							{info.description}
						</Markdown>
					</div>
				) : (
					<p>{t("anime.unknownSynopsis")}</p>
				)}
			</div>
			<details className="space-y-3 rounded-lg border p-4">
				<summary className="cursor-pointer font-medium">
					{t("anime.moreMetadata")}
				</summary>
				<dl className="grid gap-3 text-sm sm:grid-cols-2">
					{[
						["genres", info.genres.join(", ") || null],
						[
							"studios",
							info.studios.map((studio) => studio.name).join(", ") || null,
						],
						["source", info.source],
						[
							"duration",
							info.durationMinutes === null
								? null
								: t("anime.minutes", { minutes: info.durationMinutes }),
						],
						[
							"rating",
							info.averageScore === null ? null : `${info.averageScore}/100`,
						],
					].map(([key, value]) => (
						<div key={key}>
							<dt className="text-muted-foreground">{t(`anime.${key}`)}</dt>
							<dd>{value ?? t("anime.unknown")}</dd>
						</div>
					))}
				</dl>
				<p className="text-sm">
					{info.tags
						.filter((tag) => showSpoilers || !tag.spoiler)
						.map((tag) => tag.name)
						.join(" · ")}
				</p>
				{info.tags.some((tag) => tag.spoiler) && (
					<Button
						variant="outline"
						onClick={() => setShowSpoilers(!showSpoilers)}
					>
						{t(showSpoilers ? "anime.hideSpoilers" : "anime.showSpoilers")}
					</Button>
				)}
			</details>
			<section className="space-y-3">
				<h2 className="text-lg font-semibold">{t("anime.episodes")}</h2>
				<p className="text-sm text-muted-foreground">
					{t(
						work.format === "MOVIE"
							? "anime.movieTimeline"
							: work.episodeCount === null
								? "anime.unknownTotal"
								: "anime.countDerived",
					)}
				</p>
				{episodes.length === 0 && <p>{t("anime.noEpisodes")}</p>}
				{(["regular", "special", "movie"] as const).map((kind) => {
					const group = episodes.filter((episode) => episode.kind === kind);
					return group.length ? (
						<section key={kind} className="space-y-2">
							<h3 className="font-medium">{t(`anime.${kind}`)}</h3>
							<ul className="divide-y rounded-lg border px-4">
								{group.map((episode) => {
									const usable = episode.versions.filter(
										(version) => version.available,
									);
									return (
										<li
											id={`episode-${episode.id}`}
											key={episode.id}
											className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
										>
											<div className="min-w-0 flex-1">
												<h4 className="font-medium wrap-anywhere">
													{episode.label}
												</h4>
												<p className="text-sm text-muted-foreground">
													{t(`anime.${episode.availability}`)} ·{" "}
													{t("anime.versionCount", {
														count: episode.versions.length,
													})}
												</p>
											</div>
											{usable.length === 1 && usable[0] ? (
												<Link
													className={buttonStyles()}
													to={playPath(usable[0], episode)}
													aria-label={`${t("anime.play")}: ${episode.label}`}
												>
													<Play size={16} aria-hidden="true" />
													{t("anime.play")}
												</Link>
											) : (
												<Button
													disabled={usable.length === 0}
													onClick={() => setSelectedId(episode.id)}
													aria-label={`${t("anime.play")}: ${episode.label}`}
												>
													<Play size={16} aria-hidden="true" />
													{t("anime.play")}
												</Button>
											)}
										</li>
									);
								})}
							</ul>
						</section>
					) : null;
				})}
				<p className="text-sm text-muted-foreground">
					{t("anime.unresolvedHint")}{" "}
					<Link to="/directories/root" className="underline">
						{t("app.files")}
					</Link>
				</p>
			</section>
			<section className="space-y-2">
				<h2 className="text-lg font-semibold">{t("anime.related")}</h2>
				{relations.data?.data.items.length ? (
					<ul className="space-y-1 text-sm">
						{relations.data.data.items.map((relation) => (
							<li
								key={`${relation.type}:${relation.work.reference.provider}:${relation.work.reference.id}`}
								className="wrap-anywhere"
							>
								{relation.type.replaceAll("_", " ")} ·{" "}
								{relation.work.titles[0]?.value ?? t("anime.unknown")}
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						{t("anime.unknownRelations")}
					</p>
				)}
				{(relationsPage > 1 || relations.data?.data.hasNextPage) && (
					<fieldset className="action-row" aria-label={t("anime.related")}>
						<Button
							variant="outline"
							disabled={relationsPage === 1 || relations.isFetching}
							onClick={() => setRelationsPage(relationsPage - 1)}
						>
							{t("anime.previous")}
						</Button>
						<span>{t("anime.page", { page: relationsPage })}</span>
						<Button
							variant="outline"
							disabled={
								!relations.data?.data.hasNextPage || relations.isFetching
							}
							onClick={() => setRelationsPage(relationsPage + 1)}
						>
							{t("anime.next")}
						</Button>
					</fieldset>
				)}
			</section>
			<Dialog
				open={Boolean(selected)}
				onOpenChange={(open) => {
					if (!open) setSelectedId(null);
				}}
			>
				<DialogContent className="max-h-[85vh] overflow-y-auto">
					<DialogTitle>
						{t("anime.chooseVersion")}: {selected?.label}
					</DialogTitle>
					<DialogDescription>{t("anime.versionHint")}</DialogDescription>
					{selected && (
						<ul className="space-y-4">
							{selected.versions.map((version) => (
								<li
									key={version.sourceId}
									className="min-w-0 space-y-2 rounded-md border p-3"
								>
									<p className="font-medium wrap-anywhere">
										{version.evidence.originalName}
									</p>
									<p className="text-sm text-muted-foreground wrap-anywhere">
										{version.relativePath}
									</p>
									<p className="text-sm wrap-anywhere">
										{t("anime.releaseInfo")}:{" "}
										{releaseInfo(version) || t("anime.unknown")}
									</p>
									{version.mapping.rawNumbers.length > 1 && (
										<p className="text-sm">{t("anime.multiEpisode")}</p>
									)}
									{version.available ? (
										<Link
											className={buttonStyles()}
											to={playPath(version, selected)}
										>
											{t("anime.play")}
										</Link>
									) : (
										<p>{t("anime.unavailable")}</p>
									)}
								</li>
							))}
						</ul>
					)}
				</DialogContent>
			</Dialog>
		</section>
	);
}
function fuzzyDate(
	date: CatalogDetailResponse["metadata"]["data"]["startDate"],
): string | null {
	if (!date?.year) return null;
	return [
		date.year,
		date.month?.toString().padStart(2, "0"),
		date.day?.toString().padStart(2, "0"),
	]
		.filter((value) => value !== null && value !== undefined)
		.join("-");
}
