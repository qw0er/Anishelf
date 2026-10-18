import type {
	CatalogPreviewRequest,
	CatalogReviewItem,
} from "../../../shared/api/contracts.js";
export function parseMapping(
	form: FormData,
	item: Pick<CatalogReviewItem, "id" | "revision">,
	reference: CatalogPreviewRequest["reference"],
): CatalogPreviewRequest | null {
	const kind = String(form.get("kind")) as "regular" | "special" | "movie";
	const numbers = String(form.get("numbers") ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const label = String(form.get("label") ?? "").trim();
	const reason = String(form.get("reason") ?? "").trim();
	if (
		!numbers.length ||
		!reason ||
		(kind === "regular" && numbers.some((number) => !/^\d+$/.test(number))) ||
		(kind === "special" && !label)
	)
		return null;
	return {
		reference,
		rows: [
			{
				reviewId: item.id,
				revision: item.revision,
				targets: numbers.map((number) => ({
					kind,
					number,
					...(label ? { label } : {}),
				})),
				offset: Number(form.get("offset") || 0),
				reason,
			},
		],
	};
}
