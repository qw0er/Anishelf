import { ArrowLeft, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { FileResponse } from "../../../../shared/api/contracts.js";
import { QueryScope } from "../../../../shared/api/queries.js";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../../../../shared/components/ui/dialog.js";
import { Skeleton } from "../../../../shared/components/ui/skeleton.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { directoryPath } from "../../../../shared/navigation.js";
import type { PlaybackUiSlots } from "../../public.js";
import { usePlaybackController } from "../hooks/use-playback-controller.js";

import { PlaybackActionsMenu } from "./external-player-menu.js";
import { PlaybackVersionSelection } from "./version-selection.js";
import VideoPlayer from "./video-player.js";
export default function FilePlayer({
	data,
	displayTitle,
	autoPlay = false,
	returnDirectoryId,
	returnTo,
	onRetry,
	slots,
}: {
	data: FileResponse;
	autoPlay?: boolean;
	displayTitle?: { title: string; sourceVersion: string } | undefined;
	returnDirectoryId: string | null;
	returnTo?: string | null;
	onRetry(): void;
	slots?: PlaybackUiSlots;
}) {
	const { t } = useTranslation();
	const {
		audioValid,
		playback,
		selection,
		source,
		active,
		selectedAssetId,
		sourceScope,
		selectAudio,
		selectAsset,
		tryOrigin,
		onAssetsChanged,
		recheck,
	} = usePlaybackController(data, autoPlay);
	const title =
		displayTitle &&
		(!source || displayTitle.sourceVersion === source.sourceVersion)
			? displayTitle.title
			: data.file.name;
	const [fullscreen, setFullscreen] = useState(false);
	const [continuationOverlay, setContinuationOverlay] =
		useState<HTMLDivElement | null>(null);
	const [endedAsset, setEndedAsset] = useState<string | null>(null);
	const activeKey = active
		? `${active.asset.id}:${active.asset.revision}`
		: null;
	const blocked = !selection.loading && !active;
	const [optionsOpen, setOptionsOpen] = useState(false);
	const preparationAction = slots?.renderPreparation({
		key: data.file.id,
		fileId: data.file.id,
		source,
		onRecheck: recheck,
		onAssetsChanged,
		showLabel: true,
	});
	return (
		<section
			className="flex min-w-0 flex-col gap-3 sm:gap-4"
			aria-label={t("player.label")}
		>
			<header className="flex min-w-0 items-center gap-2">
				<Tooltip
					content={t(
						returnTo ? "anime.backToDetail" : "navigation.backToFiles",
					)}
				>
					<Link
						className={buttonStyles("ghost", "size-11 shrink-0 p-0")}
						aria-label={t(
							returnTo ? "anime.backToDetail" : "navigation.backToFiles",
						)}
						to={
							returnTo ?? directoryPath(returnDirectoryId || data.file.parentId)
						}
					>
						<ArrowLeft size={20} aria-hidden="true" />
					</Link>
				</Tooltip>
				<h1 className="line-clamp-2 min-w-0 break-all text-base font-semibold sm:text-xl">
					{title}
				</h1>
			</header>
			{selection.loading && (
				<div role="status" aria-label={t("loading.generic")}>
					<Skeleton className="aspect-video w-full" />
				</div>
			)}
			{blocked && (
				<section
					className="space-y-3 rounded-md border p-6"
					aria-labelledby="playback-unavailable-title"
				>
					<h2
						id="playback-unavailable-title"
						className="section-title-prominent"
					>
						{t("player.unavailableTitle")}
					</h2>
					<p role="status" className="text-sm text-muted-foreground">
						{t(
							!audioValid
								? "audioTracks.invalidSelection"
								: selection.error
									? "player.unavailableTitle"
									: selection.runtimeFailure
										? `player.failures.${selection.runtimeFailure.kind}`
										: "player.noMatchingAsset",
						)}
					</p>
					<div className="action-row">
						<Button variant="outline" onClick={recheck}>
							<RefreshCw className="size-4" aria-hidden="true" />
							{t("actions.retry")}
						</Button>
						<Button variant="outline" onClick={tryOrigin}>
							<Play className="size-4" aria-hidden="true" />
							{t("player.assets.original")}
						</Button>
						{preparationAction}
					</div>
				</section>
			)}
			{active && source && (
				<div className="-mx-4 sm:mx-0">
					<QueryScope value={sourceScope}>
						<VideoPlayer
							key={`${active.asset.id}:${active.asset.revision}`}
							fileId={data.file.id}
							displayTitle={title}
							active={active}
							sourceVersion={source.sourceVersion}
							onFullscreenChange={setFullscreen}
							onContinuationOverlay={setContinuationOverlay}
							onEndedChange={(ended) => setEndedAsset(ended ? activeKey : null)}
							onMedia={playback.attach}
							onPlaybackFailure={selection.failed}
							onAudioChange={(index) => selectAudio(String(index))}
						/>
					</QueryScope>
				</div>
			)}
			{selection.runtimeFailure && (
				<div
					role="alert"
					className="flex items-center gap-3 text-sm text-destructive"
				>
					<span>{t(`player.failures.${selection.runtimeFailure.kind}`)}</span>
					<Button variant="outline" onClick={onRetry}>
						{t("actions.retry")}
					</Button>
				</div>
			)}

			<div className="player-action-bar">
				<div className="player-action-group">
					{playback.session &&
						slots?.renderViewing?.({
							fileId: data.file.id,
							sourceVersion: playback.session.sourceVersion,
						})}
					{source &&
						slots?.renderContinuation?.({
							fileId: data.file.id,
							sourceVersion: source.sourceVersion,
							ended: Boolean(activeKey && endedAsset === activeKey),
							overlayTarget: fullscreen ? continuationOverlay : null,
						})}
					<PlaybackActionsMenu
						key={`actions:${data.file.id}`}
						fileId={data.file.id}
						onOptions={() => setOptionsOpen(true)}
						onRetry={() => {
							console.info("[playback] Manual playback retry requested.");
							onRetry();
						}}
					/>
				</div>
			</div>
			<Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("player.options")}</DialogTitle>
					</DialogHeader>
					<p className="break-all text-sm text-muted-foreground">
						{data.file.name}
					</p>
					{active && (
						<p className="text-sm text-muted-foreground">
							{t(`player.assets.${active.asset.kind}`)} ·{" "}
							{active.asset.video?.codec?.toUpperCase()} /{" "}
							{active.asset.audioTracks
								.find(
									(track) => track.stream.index === active.audio?.streamIndex,
								)
								?.stream.codec?.toUpperCase() ?? t("audioTracks.none")}
						</p>
					)}
					{source && (
						<PlaybackVersionSelection
							source={source}
							audioStreamIndex={
								selection.selection?.resolvedAudioStreamIndex ?? null
							}
							selectedAssetId={selectedAssetId}
							onSelect={selectAsset}
						/>
					)}
					{slots?.renderOptions?.()}
					<div className="action-row">{!blocked && preparationAction}</div>
				</DialogContent>
			</Dialog>
		</section>
	);
}
