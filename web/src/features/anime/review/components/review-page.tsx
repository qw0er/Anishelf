import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { useQueryScope } from "../../../../shared/api/queries.js";
import { PageHeader } from "../../../../shared/components/page-header.js";
import { buttonStyles } from "../../../../shared/components/ui/button.js";
import { IdentificationStatus } from "../../identification-status.js";
import { reviewsQuery } from "../queries.js";
import { ReviewEditor } from "./review-editor.js";
import { ReviewList } from "./review-list.js";
export function ReviewPage() {
	const [params, setParams] = useSearchParams();
	const item = params.get("item");
	const decision = ["pending", "confirmed", "rejected"].includes(
		params.get("decision") ?? "",
	)
		? (params.get("decision") ?? "pending")
		: "pending";
	const rawPage = params.get("page") ?? "1";
	const page = /^[1-9][0-9]{0,4}$/.test(rawPage) ? Number(rawPage) : 1;
	const scope = useQueryScope();
	const { t } = useTranslation();
	const query = useQuery({
		...reviewsQuery(decision, page, scope),
		enabled: !item,
	});
	const listUrl = `/review?${new URLSearchParams({ decision, page: String(page) })}`;
	return (
		<section className="stack-page">
			<PageHeader
				title={t("review.title")}
				description={t("review.hint")}
				actions={
					item ? (
						<Link to={listUrl} className={buttonStyles("outline")}>
							<ArrowLeft className="size-4" aria-hidden="true" />
							{t("review.back")}
						</Link>
					) : undefined
				}
			/>
			<IdentificationStatus />
			{item ? (
				<ReviewEditor key={`${item}:${scope}`} id={item} />
			) : (
				<ReviewList
					decision={decision}
					page={page}
					query={query}
					onPage={(page) => setParams({ decision, page: String(page) })}
				/>
			)}
		</section>
	);
}
