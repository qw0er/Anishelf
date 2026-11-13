import { useState } from "react";
import { getClientRuntime } from "../../../../shared/api/connection.js";
import { isHttpUrl } from "../../../../shared/lib/url.js";

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
	const src =
		url &&
		(getClientRuntime().connection.resolveResourceUrl(url) ??
			(isHttpUrl(url) ? url : null));
	const style = banner
		? "h-40 w-full object-cover sm:h-56"
		: "aspect-[2/3] w-full object-cover";
	return src && failedUrl !== src ? (
		<img
			src={src}
			alt={banner ? "" : title}
			loading="lazy"
			decoding="async"
			className={`${style} bg-muted`}
			onError={() => setFailedUrl(src)}
		/>
	) : banner ? null : (
		<div
			className={`${style} flex items-center justify-center bg-muted p-4 text-center text-sm text-muted-foreground`}
		>
			<span className="wrap-anywhere">{title}</span>
		</div>
	);
}
