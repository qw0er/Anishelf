import { ArrowLeft, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { FileResponse } from "../api/contracts.js";
import { usePlaybackSession } from "../hooks/use-playback-session.js";
import { directoryPath } from "../routes/paths.js";
import ArtPlayer from "./art-player.js";
import { Button, buttonStyles } from "./ui/button.js";

export default function FilePlayer({
	data,
	returnDirectoryId,
	onRetry,
}: {
	data: FileResponse;
	returnDirectoryId: string | null;
	onRetry(): void;
}) {
	const { t } = useTranslation();
	const playback = usePlaybackSession(data.file.id);
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
			<h1 className="page-title">{data.file.name}</h1>
			<ArtPlayer
				{...data}
				playbackUrl={playback.session?.plan.playbackUrl ?? data.playbackUrl}
				onMedia={playback.attach}
			/>
		</section>
	);
}
