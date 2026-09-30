import { ArrowLeft, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiClientError, getFile, isRequestCancelled } from "../api/client.js";
import type { FileResponse } from "../api/contracts.js";
import { directoryPath } from "../routes/paths.js";
import { Button, buttonStyles } from "./ui/button.js";

function NativePlayer({ file, playbackUrl }: FileResponse) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const errorRequest = useRef<AbortController | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const video = videoRef.current;
		// Restore the source when StrictMode replays this effect in development.
		video?.setAttribute("src", playbackUrl);
		return () => {
			errorRequest.current?.abort();
			video?.pause();
			video?.removeAttribute("src");
			video?.load();
		};
	}, [playbackUrl]);

	async function handleMediaError() {
		setError("This media could not be played in this browser.");
		errorRequest.current?.abort();
		const controller = new AbortController();
		errorRequest.current = controller;
		try {
			await getFile(file.id, { signal: controller.signal });
		} catch (error) {
			if (controller.signal.aborted || isRequestCancelled(error)) return;
			if (error instanceof ApiClientError) setError(error.message);
		}
	}

	return (
		<>
			{/* biome-ignore lint/a11y/useMediaCaption: V1 explicitly excludes subtitle support. */}
			<video
				ref={videoRef}
				src={playbackUrl}
				controls
				preload="metadata"
				aria-label={`Video: ${file.name}`}
				className="aspect-video max-h-[75vh] w-full bg-black"
				onError={() => void handleMediaError()}
			/>
			{error && <p role="alert">{error}</p>}
		</>
	);
}

export default function FilePlayer({
	data,
	returnDirectoryId,
	onRetry,
}: {
	data: FileResponse;
	returnDirectoryId: string | null;
	onRetry(): void;
}) {
	return (
		<section className="space-y-5" aria-label="Player">
			<div className="flex flex-wrap gap-2">
				<Link
					className={buttonStyles("outline")}
					to={directoryPath(returnDirectoryId || data.file.parentId)}
				>
					<ArrowLeft size={16} aria-hidden="true" /> Back to files
				</Link>
				<Button type="button" variant="outline" onClick={onRetry}>
					<RefreshCw size={16} aria-hidden="true" /> Retry file
				</Button>
			</div>
			<h1 className="wrap-break-word text-2xl font-semibold">
				{data.file.name}
			</h1>
			<NativePlayer {...data} />
		</section>
	);
}
