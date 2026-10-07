import { ArrowLeft, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { FileResponse } from "../../../api/contracts.js";
import { QueryScope } from "../../../api/queries.js";
import { Button, buttonStyles } from "../../../components/ui/button.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { subtitlePolicy } from "../../../config/media-policy.js";
import { directoryPath } from "../../../routes/paths.js";
import { PreparationButton } from "../../preparation/public.js";
import { usePlaybackController } from "../hooks/use-playback-controller.js";
import { AudioSelection } from "./audio-selection.js";
import { CompatibilityDialog } from "./compatibility-dialog.js";

import { PlaybackActionsMenu } from "./external-player-menu.js";
import VideoPlayer from "./video-player.js";

export default function FilePlayer({
	data,

	returnDirectoryId,
	onRetry,
	compatibilityScope = "",
}: {
	data: FileResponse;
	returnDirectoryId: string | null;
	onRetry(): void;
	compatibilityScope?: string;
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
	} = usePlaybackController(data, compatibilityScope);
	const preparedCurrent = selectedPlan?.mode === "prepared";
	const blocked = !compatibility.loading && !resource;
	const unsupported = compatibility.result?.direct.status === "unsupported";
	const tryingOrigin = selectedPlan?.mode === "direct";
	const [compatibilityOpen, setCompatibilityOpen] = useState(false);
	function tryOrigin() {
		compatibility.tryDirect();
	}
	const preparationAction = (
		<PreparationButton
			key={audio ?? "all"}
			fileId={data.file.id}
			loading={compatibility.loading}
			result={compatibility.result}
			error={compatibility.error}
			onRecheck={recheck}
			showLabel
			tasks={prepared.tasks}
			onPrepared={onPrepared}
			{...(audioStreamIndices !== undefined ? { audioStreamIndices } : {})}
		/>
	);

	return (
		<section className="stack-page" aria-label={t("player.label")}>
			<div className="action-row">
				<Link
					className={buttonStyles("outline")}
					to={directoryPath(returnDirectoryId || data.file.parentId)}
				>
					<ArrowLeft size={16} aria-hidden="true" />
					{t("navigation.backToFiles")}
				</Link>
				<Button type="button" variant="outline" onClick={onRetry}>
					<RefreshCw size={16} aria-hidden="true" />
					{t("player.retry")}
				</Button>
			</div>
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
			<h1 className="page-title">{data.file.name}</h1>
			{preparedCurrent && (
				<p className="text-sm text-muted-foreground">
					{t("preparation.playing")}
				</p>
			)}
			{resource && (
				<QueryScope value={sourceScope}>
					<VideoPlayer
						key={`video:${data.file.id}:${resource.url}`}
						{...data}
						subtitlePolicy={subtitlePolicy}
						playbackUrl={resource.url}
						sourceVersion={compatibility.selection?.sourceVersion}
						timeline={resource.timeline}
						onMedia={playback.attach}
						onPlaybackFailure={compatibility.failed}
						expectsVideo={Boolean(compatibility.result?.selectedVideo)}
					/>
				</QueryScope>
			)}
			<AudioSelection
				audio={audio}
				audioTracks={audioTracks}
				audioStreamIndices={audioStreamIndices}
				selectAudio={selectAudio}
			/>
			<div className="action-row">
				{!blocked && preparationAction}
				<CompatibilityDialog
					compatibility={compatibility}
					open={compatibilityOpen}
					setOpen={setCompatibilityOpen}
					tryOrigin={tryOrigin}
					tryingOrigin={tryingOrigin}
				/>
				<PlaybackActionsMenu
					key={`actions:${data.file.id}`}
					fileId={data.file.id}
				/>
			</div>
		</section>
	);
}
