import type { AnimeCatalogApi } from "../public.js";
import { AssociationApplication } from "./associations.js";
import { AutomaticAdmission } from "./automatic.js";
import { CatalogContext, type CatalogOptions } from "./context.js";
import { CatalogQueries } from "./queries.js";
import { ReviewApplication } from "./review.js";
import { WorkApplication } from "./work.js";

/** Public facade; use cases share one lifecycle and transactional Catalog store. */
export class AnimeCatalogApplication implements AnimeCatalogApi {
	private readonly context: CatalogContext;
	private readonly associations: AssociationApplication;
	readonly list: AnimeCatalogApi["list"];
	readonly artwork: AnimeCatalogApi["artwork"];
	readonly detail: AnimeCatalogApi["detail"];
	readonly publish: AnimeCatalogApi["publish"];
	readonly source: AnimeCatalogApi["source"];
	readonly review: AnimeCatalogApi["review"];
	readonly fileReviews: AnimeCatalogApi["fileReviews"];
	readonly reviews: AnimeCatalogApi["reviews"];
	readonly reject: AnimeCatalogApi["reject"];
	readonly remove: AnimeCatalogApi["remove"];
	readonly preview: AnimeCatalogApi["preview"];
	readonly confirm: AnimeCatalogApi["confirm"];
	readonly editEpisode: AnimeCatalogApi["editEpisode"];
	readonly refresh: AnimeCatalogApi["refresh"];
	constructor(options: CatalogOptions) {
		this.context = new CatalogContext(options);
		const queries = new CatalogQueries(this.context);
		const review = new ReviewApplication(this.context);
		this.associations = new AssociationApplication(this.context);
		const work = new WorkApplication(this.context, queries);
		this.list = queries.list.bind(queries);
		this.artwork = queries.artwork.bind(queries);
		this.detail = queries.detail.bind(queries);
		const automatic = new AutomaticAdmission(this.context, this.associations);
		this.publish = async (results, root, signal) => {
			signal?.throwIfAborted();
			review.publish(results, root);
			await automatic.admit(results, root, signal);
		};
		this.source = review.source.bind(review);
		this.review = review.get.bind(review);
		this.fileReviews = review.fileReviews.bind(review);
		this.reviews = review.reviews.bind(review);
		this.reject = review.reject.bind(review);
		this.remove = review.remove.bind(review);
		this.preview = this.associations.preview.bind(this.associations);
		this.confirm = this.associations.confirm.bind(this.associations);
		this.editEpisode = work.editEpisode.bind(work);
		this.refresh = work.refresh.bind(work);
	}
	close(): void {
		this.context.close();
		this.associations.close();
	}
}
