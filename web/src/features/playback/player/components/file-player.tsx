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
import { subtitlePolicy } from "../../../media/public.js";
import type { PlaybackUiSlots } from "../../public.js";
import { usePlaybackController } from "../hooks/use-playback-controller.js";
import { AudioSelection } from "./audio-selection.js";
import { CompatibilityDialog } from "./compatibility-dialog.js";

import { PlaybackActionsMenu } from "./external-player-menu.js";
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
		audio,
		audioValid,
		audioStreamIndices,
		playback,
		prepared,
		compatibility,
		audioTracks,
		selectedPlan,
		resource,
		sourceScope,
		selectAudio,
		onPrepared,
		recheck,
	} = usePlaybackController(data);
	const activeVersion =
		compatibility.selection?.sourceVersion ??
		compatibility.result?.sourceVersion;
	const title =
		displayTitle &&
		(!activeVersion || displayTitle.sourceVersion === activeVersion)
			? displayTitle.title
			: data.file.name;
	const preparedCurrent = selectedPlan?.mode === "prepared";
	const blocked = !compatibility.loading && !resource;
	const unsupported = compatibility.result?.direct.status === "unsupported";
	const tryingOrigin = selectedPlan?.mode === "direct";
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [compatibilityOpen, setCompatibilityOpen] = useState(false);
	function tryOrigin() {
		compatibility.tryDirect();
	}
	const preparationAction = slots?.renderPreparation({
		key: audio ?? "all",
		fileId: data.file.id,
		loading: compatibility.loading,
		result: compatibility.result,
		error: compatibility.error,
		onRecheck: recheck,
		tasks: prepared.tasks,
		onPrepared: onPrepared,
		...(audioStreamIndices !== undefined ? { audioStreamIndices } : {}),
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
			{compatibility.loading && (
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
								: compatibility.error
									? "compatibility.failed"
									: compatibility.runtimeFailed
										? "compatibility.runtimeFailed"
										: compatibility.selection?.pending
											? "preparation.waitForCopy"
											: audioStreamIndices !== undefined
												? "audioTracks.copyRequired"
												: unsupported
													? "compatibility.unsupported"
													: "compatibility.unknown",
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
			{resource && (
				<div className="-mx-4 sm:mx-0">
					<QueryScope value={sourceScope}>
						<VideoPlayer
							key={`video:${data.file.id}:${resource.url}`}
							{...data}
							displayTitle={title}
							subtitlePolicy={subtitlePolicy}
							renderSubtitles={slots?.renderSubtitles}
							playbackUrl={resource.url}
							sourceVersion={compatibility.selection?.sourceVersion}
							timeline={resource.timeline}
							onMedia={playback.attach}
							onPlaybackFailure={compatibility.failed}
							expectsVideo={Boolean(compatibility.result?.selectedVideo)}
						/>
					</QueryScope>
				</div>
			)}
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				<AudioSelection
					audio={audio}
					audioTracks={audioTracks}
					audioStreamIndices={audioStreamIndices}
					selectAudio={selectAudio}
				/>
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
					{preparedCurrent && (
						<p className="text-sm text-muted-foreground">
							{t("preparation.playing")}
						</p>
					)}
					<div className="action-row">{!blocked && preparationAction}</div>
				</DialogContent>
			</Dialog>
			<CompatibilityDialog
				showTrigger={false}
				compatibility={compatibility}
				open={compatibilityOpen}
				setOpen={setCompatibilityOpen}
				tryOrigin={tryOrigin}
				tryingOrigin={tryingOrigin}
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
