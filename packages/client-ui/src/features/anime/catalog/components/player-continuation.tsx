import { useQuery } from "@tanstack/react-query";

import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
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
import {
	animePlayerPath,
	libraryReturnPath,
} from "../../../../shared/navigation.js";
import type { NextEpisodeAction } from "../../../playback/public.js";
import { continuationContext, continuationEpisode } from "../continuation.js";
import type { Version } from "../detail-format.js";
import { localWorkDetailQuery, sourceQuery } from "../queries.js";

export function PlayerContinuation({
	fileId,
	sourceVersion,
	renderPlayer,
}: {
	fileId: string;
	sourceVersion: string;
	renderPlayer(next?: NextEpisodeAction): ReactNode;
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

	useEffect(() => {
		if (source.error || detail.error)
			console.warn("[playback] Next episode lookup failed.", {
				fileId,
				stage: source.error ? "source" : "episodes",
			});
	}, [source.error, detail.error, fileId]);
	const data = detail.data;
	const next =
		context && data?.work.id === context.workId && !detail.error
			? continuationEpisode(data.episodes, context.nextNumber, fileId)
			: null;
	const failedLookup = source.error ? source : detail.error ? detail : null;
	return (
		<ContinuationControls
			contextKey={JSON.stringify([
				fileId,
				sourceVersion,
				context?.workId,
				next?.id,
			])}
			episodeId={next?.id ?? ""}
			workId={context?.workId ?? ""}
			number={context?.nextNumber ?? 0}
			versions={next?.versions ?? []}
			renderPlayer={renderPlayer}
			retry={failedLookup ? () => void failedLookup.refetch() : undefined}
		/>
	);
}

function ContinuationControls({
	contextKey,
	episodeId,
	workId,
	number,
	versions,
	renderPlayer,
	retry,
}: {
	contextKey: string;
	episodeId: string;
	workId: string;
	number: number;
	versions: Version[];
	renderPlayer(next?: NextEpisodeAction): ReactNode;
	retry: (() => void) | undefined;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const nextLabel = t("player.continuation.next", { number });
	const [choosing, setChoosing] = useState<string | null>(null);
	const navigating = useRef<string | null>(null);
	const [only] = versions;
	const play = useCallback(
		(version: Version) => {
			if (navigating.current === contextKey) return;
			navigating.current = contextKey;
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
		[contextKey, workId, episodeId, params, navigate],
	);
	const next = versions.length
		? {
				label: nextLabel,
				run: () => {
					if (versions.length === 1 && only) play(only);
					else setChoosing(contextKey);
				},
			}
		: undefined;
	return (
		<>
			{renderPlayer(next)}
			{retry && (
				<Button variant="ghost" onClick={retry}>
					{t("player.continuation.retry")}
				</Button>
			)}
			<Dialog
				open={choosing === contextKey}
				onOpenChange={(open) => setChoosing(open ? contextKey : null)}
			>
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
		</>
	);
}
