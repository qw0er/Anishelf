import { useState } from "react";

export function Artwork({
	url,
	title,
	banner = false,
}: {
	url: string | null;
	title: string;
	banner?: boolean;
}) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const style = banner
		? "h-40 w-full object-cover sm:h-56"
		: "aspect-[2/3] w-full object-cover";
	return url && failedUrl !== url ? (
		<img
			src={url}
			alt={banner ? "" : title}
			loading="lazy"
			className={`${style} bg-muted`}
			onError={() => setFailedUrl(url)}
		/>
	) : banner ? null : (
		<div
			className={`${style} flex items-center justify-center bg-muted p-4 text-center text-sm text-muted-foreground`}
		>
			<span className="wrap-anywhere">{title}</span>
		</div>
	);
}
