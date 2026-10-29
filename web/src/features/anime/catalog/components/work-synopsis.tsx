import { useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { LocalWorkDetailResponse } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { safeLink } from "../detail-format.js";
export function WorkSynopsis({
	data,
}: {
	data: Pick<LocalWorkDetailResponse, "metadata">;
}) {
	const { t } = useTranslation();
	const { metadata } = data;
	const info = metadata.data;
	const [expanded, setExpanded] = useState(false);
	const long = (info.description?.length ?? 0) > 400;
	return (
		<div className="surface-panel space-y-3">
			<h2 className="section-title-prominent">{t("anime.synopsis")}</h2>
			{info.description ? (
				<div
					className={`space-y-2 wrap-anywhere [&_a]:underline [&_p]:my-2 ${long && !expanded ? "line-clamp-5" : ""}`}
				>
					<Markdown
						rehypePlugins={[rehypeRaw, rehypeSanitize]}
						components={{
							img: () => null,
							a: ({ href, children }) =>
								safeLink(href ?? null) ? (
									<a
										href={safeLink(href ?? null)}
										target="_blank"
										rel="noopener noreferrer"
									>
										{children}
									</a>
								) : (
									<span>{children}</span>
								),
						}}
					>
						{info.description}
					</Markdown>
				</div>
			) : (
				<p>{t("anime.unknownSynopsis")}</p>
			)}
			{long && (
				<Button
					variant="ghost"
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
				>
					{t(expanded ? "anime.hideSynopsis" : "anime.showSynopsis")}
				</Button>
			)}
		</div>
	);
}
