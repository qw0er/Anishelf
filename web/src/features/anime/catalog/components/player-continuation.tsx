import { useQuery } from "@tanstack/react-query";
import { SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { useAutomaticContinuation } from "../../../settings/public.js";
import { continuationContext, continuationEpisode } from "../continuation.js";
import type { Version } from "../detail-format.js";
import { localWorkDetailQuery, sourceQuery } from "../queries.js";

const countdownSeconds = 10;

export function PlayerContinuation({
	fileId,
	sourceVersion,
	ended,
	overlayTarget,
}: {
	fileId: string;
	sourceVersion: string;
	ended: boolean;
	overlayTarget?: HTMLElement | null | undefined;
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
			<span role="status" className="text-sm text-muted-foreground">
				{t("player.continuation.loading")}
			</span>
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
			ended={ended}
			overlayTarget={overlayTarget}
		/>
	);
}

function ContinuationControls({
	episodeId,
	workId,
	number,
	versions,
	ended,
	overlayTarget,
}: {
	episodeId: string;
	workId: string;
	number: number;
	versions: Version[];
	ended: boolean;
	overlayTarget?: HTMLElement | null | undefined;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const { enabled: automatic } = useAutomaticContinuation();
	const [endAutomatic, setEndAutomatic] = useState(automatic);
	const [choosing, setChoosing] = useState(false);
	const [cancelled, setCancelled] = useState(false);
	const targetIdentity = JSON.stringify(
		versions.map((version) => [version.fileId, version.sourceVersion]),
	);
	const [countdownTarget, setCountdownTarget] = useState(targetIdentity);
	const [remaining, setRemaining] = useState(countdownSeconds);
	const navigating = useRef(false);
	const [only] = versions;
	const counting =
		ended &&
		automatic &&
		endAutomatic &&
		!cancelled &&
		versions.length === 1 &&
		targetIdentity === countdownTarget;
	const play = useCallback(
		(version: Version, reason: "manual" | "automatic") => {
			if (navigating.current) return;
			navigating.current = true;
			setCancelled(true);
			console.info("[playback] Next episode selected.", {
				workId,
				episodeId,
				reason,
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
	useEffect(() => {
		if (!ended) {
			setCancelled(false);
			setRemaining(countdownSeconds);
			setCountdownTarget(targetIdentity);
			setEndAutomatic(automatic);
		} else if (!automatic || targetIdentity !== countdownTarget)
			setCancelled(true);
	}, [ended, automatic, targetIdentity, countdownTarget]);
	useEffect(() => {
		if (!counting) return;
		const timer = window.setInterval(
			() => setRemaining((value) => Math.max(0, value - 1)),
			1000,
		);
		return () => window.clearInterval(timer);
	}, [counting]);
	useEffect(() => {
		if (counting && remaining === 0 && only) play(only, "automatic");
	}, [counting, remaining, only, play]);
	const countdown = (
		<div className="flex flex-wrap items-center gap-2">
			{overlayTarget && only && (
				<Button onClick={() => play(only, "manual")}>
					{t("player.continuation.next", { number })}
				</Button>
			)}
			<p role="status" className="text-sm">
				{t("player.continuation.countdown", { count: remaining })}
			</p>
			<Button
				variant="outline"
				onClick={() => {
					setCancelled(true);
					console.info("[playback] Automatic continuation cancelled.");
				}}
			>
				{t("actions.cancel")}
			</Button>
		</div>
	);
	return (
		<section
			aria-label={t("player.continuation.label")}
			className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
		>
			<Button
				variant={versions.length ? "default" : "outline"}
				disabled={versions.length === 0}
				onClick={() => {
					if (versions.length === 1 && only) play(only, "manual");
					else {
						setCancelled(true);
						setChoosing(true);
					}
				}}
			>
				<SkipForward className="size-4" aria-hidden="true" />
				{t("player.continuation.next", { number })}
			</Button>

			{ended && versions.length > 1 && (
				<p role="status" className="text-sm text-muted-foreground">
					{t("player.continuation.choose")}
				</p>
			)}
			{counting &&
				(overlayTarget ? createPortal(countdown, overlayTarget) : countdown)}
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
								<Button onClick={() => play(version, "manual")}>
									{t("anime.play")}
								</Button>
							</li>
						))}
					</ul>
				</DialogContent>
			</Dialog>
		</section>
	);
}
