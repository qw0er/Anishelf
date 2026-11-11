import { useQuery } from "@tanstack/react-query";
import { Loader2, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { Button } from "../../../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "../../../../shared/components/ui/dialog.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import {
	animePlayerPath,
	libraryReturnPath,
} from "../../../../shared/navigation.js";
import { continuationContext, continuationEpisode } from "../continuation.js";
import type { Version } from "../detail-format.js";
import { localWorkDetailQuery, sourceQuery } from "../queries.js";

export function PlayerContinuation({
	fileId,
	sourceVersion,
}: {
	fileId: string;
	sourceVersion: string;
}) {
	const scope = useQueryScope();
	const source = useQuery(sourceQuery(fileId, scope));
	const context =
		source.data?.associations && !source.error
			? continuationContext(source.data, sourceVersion)
			: null;
	const detail = useQuery({
		...localWorkDetailQuery(context?.workId ?? "", scope),
		enabled: Boolean(context),
	});
	const { t } = useTranslation();
	useEffect(() => {
		if (source.error || detail.error)
			console.warn("[playback] Next episode lookup failed.", {
				fileId,
				stage: source.error ? "source" : "episodes",
			});
	}, [source.error, detail.error, fileId]);
	if (source.error)
		return (
			<Button variant="ghost" onClick={() => void source.refetch()}>
				{t("player.continuation.retry")}
			</Button>
		);
	if (!context) return null;
	if (detail.error)
		return (
			<Button variant="ghost" onClick={() => void detail.refetch()}>
				{t("player.continuation.retry")}
			</Button>
		);
	if (!detail.data || detail.data.work.id !== context.workId)
		return (
			<Button variant="outline" disabled aria-busy="true">
				<Loader2
					className="size-4 motion-safe:animate-spin"
					aria-hidden="true"
				/>
				{t("player.continuation.loading")}
			</Button>
		);
	const next = continuationEpisode(
		detail.data.episodes,
		context.nextNumber,
		fileId,
	);
	return (
		<ContinuationControls
			key={JSON.stringify([
				fileId,
				sourceVersion,
				context.workId,
				context.nextNumber,
			])}
			episodeId={next?.id ?? ""}
			workId={context.workId}
			number={context.nextNumber}
			versions={next?.versions ?? []}
		/>
	);
}

function ContinuationControls({
	episodeId,
	workId,
	number,
	versions,
}: {
	episodeId: string;
	workId: string;
	number: number;
	versions: Version[];
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const nextLabel = t("player.continuation.next", { number });
	const [choosing, setChoosing] = useState(false);
	const navigating = useRef(false);
	const [only] = versions;
	const play = useCallback(
		(version: Version) => {
			if (navigating.current) return;
			navigating.current = true;
			console.info("[playback] Next episode selected.", {
				workId,
				episodeId,
				reason: "manual",
			});
			void navigate(
				animePlayerPath(
					version.fileId,
					workId,
					episodeId,
					libraryReturnPath(params.get("library")),
					version.sourceVersion,
				),
				{ state: { autoPlay: true } },
			);
		},
		[workId, episodeId, params, navigate],
	);
	return (
		<section
			aria-label={t("player.continuation.label")}
			className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
		>
			<Tooltip content={nextLabel}>
				<Button
					variant={versions.length ? "default" : "outline"}
					className="player-action"
					aria-label={nextLabel}
					disabled={versions.length === 0}
					onClick={() => {
						if (versions.length === 1 && only) play(only);
						else setChoosing(true);
					}}
				>
					<SkipForward className="size-4" aria-hidden="true" />
					<span className="player-action-label">{nextLabel}</span>
				</Button>
			</Tooltip>

			<Dialog open={choosing} onOpenChange={setChoosing}>
				<DialogContent>
					<DialogTitle>{t("anime.chooseVersion")}</DialogTitle>
					<DialogDescription>{t("anime.versionHint")}</DialogDescription>
					<ul className="space-y-3">
						{versions.map((version) => (
							<li
								key={version.sourceId}
								className="list-row flex min-w-0 flex-wrap items-center gap-2"
							>
								<span className="min-w-0 flex-1 wrap-anywhere">
									{version.relativePath}
								</span>
								<Button onClick={() => play(version)}>{t("anime.play")}</Button>
							</li>
						))}
					</ul>
				</DialogContent>
			</Dialog>
		</section>
	);
}
