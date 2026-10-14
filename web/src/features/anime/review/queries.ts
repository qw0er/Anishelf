import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import { getReview, getReviews } from "./api.js";

export const reviewsQuery = (decision: string, page: number, scope: string) =>
	queryOptions({
		queryKey: ["catalog", scope, "reviews", decision, page],
		queryFn: ({ signal }) =>
			getReviews(decision, page, { signal: boundedSignal(signal) }),
	});
export const reviewQuery = (id: string, scope: string) =>
	queryOptions({
		queryKey: ["catalog", scope, "review", id],
		queryFn: ({ signal }) => getReview(id, { signal: boundedSignal(signal) }),
	});
