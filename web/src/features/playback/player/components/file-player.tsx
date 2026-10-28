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
import { AudioSelection } from "./audio-selection.js";
import { CompatibilityDialog } from "./compatibility-dialog.js";
import { PlaybackActionsMenu } from "./external-player-menu.js";
import { PlaybackVersionSelection } from "./version-selection.js";
import VideoPlayer from "./video-player.js";
export default function FilePlayer({
	data,
	displayTitle,
	returnDirectoryId,
	returnTo,
	onRetry,
	slots,
}: {
	data: FileResponse;
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
	} = usePlaybackController(data);
	const title =
		displayTitle &&
		(!source || displayTitle.sourceVersion === source.sourceVersion)
			? displayTitle.title
			: data.file.name;
	const blocked = !selection.loading && !active;
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [compatibilityOpen, setCompatibilityOpen] = useState(false);
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
				<div role="status" aria-label={t("compatibility.checking")}>
					<Skeleton className="aspect-video w-full" />
				</div>
			)}
			{blocked && (
				<section
					className="space-y-3 rounded-md border p-6"
					aria-labelledby="playback-unavailable-title"
				>
					<h2 id="playback-unavailable-title" className="text-lg font-semibold">
						{t("player.unavailableTitle")}
					</h2>
					<p role="status" className="text-sm text-muted-foreground">
						{t(
							!audioValid
								? "audioTracks.invalidSelection"
								: selection.error
									? "compatibility.failed"
									: selection.runtimeFailure
										? `player.failures.${selection.runtimeFailure.kind}`
										: selection.selection?.pending
											? "preparation.waitForCopy"
											: "player.noMatchingAsset",
						)}
					</p>
					<div className="action-row">
						<Button variant="outline" onClick={recheck}>
							<RefreshCw className="size-4" aria-hidden="true" />
							{t("compatibility.recheck")}
						</Button>
						<Button variant="outline" onClick={tryOrigin}>
							<Play className="size-4" aria-hidden="true" />
							{t("compatibility.tryDirect")}
						</Button>
						{preparationAction}
					</div>
				</section>
			)}
			{active && source && (
				<div className="-mx-4 sm:mx-0">
					<QueryScope value={sourceScope}>
						<VideoPlayer
							key={`${active.asset.id}:${active.asset.revision}:${active.audio?.streamIndex ?? "none"}`}
							fileId={data.file.id}
							displayTitle={title}
							active={active}
							sourceVersion={source.sourceVersion}
							renderSubtitles={slots?.renderSubtitles}
							onMedia={playback.attach}
							onPlaybackFailure={selection.failed}
							onAudioChange={(index) => selectAudio(String(index))}
						/>
					</QueryScope>
				</div>
			)}
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				<AudioSelection active={active} selectAudio={selectAudio} />
				<PlaybackActionsMenu
					key={`actions:${data.file.id}`}
					fileId={data.file.id}
					onOptions={() => setOptionsOpen(true)}
					onCompatibility={() => setCompatibilityOpen(true)}
					onRetry={() => {
						console.info("[playback] Manual playback retry requested.");
						onRetry();
					}}
				/>
			</div>
			<Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
				<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
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
					<div className="action-row">{!blocked && preparationAction}</div>
				</DialogContent>
			</Dialog>
			<CompatibilityDialog
				selection={selection}
				tryOrigin={tryOrigin}
				open={compatibilityOpen}
				setOpen={setCompatibilityOpen}
			/>
			<div className="min-w-0">
				{playback.session &&
					slots?.renderViewing?.({
						fileId: data.file.id,
						sourceVersion: playback.session.sourceVersion,
					})}
			</div>
		</section>
	);
}
