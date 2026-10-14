import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { CatalogDetailResponse } from "../../../../shared/api/contracts.js";
import { safeLink } from "../detail-format.js";
export function WorkSynopsis({ data }: { data: CatalogDetailResponse }) {
	const { t } = useTranslation();
	const { metadata } = data;
	const info = metadata.data;
	return (
		<div className="space-y-3">
			<h2 className="text-lg font-semibold">{t("anime.synopsis")}</h2>
			{info.description ? (
				<div className="space-y-2 wrap-anywhere [&_a]:underline [&_p]:my-2">
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
		</div>
	);
}
