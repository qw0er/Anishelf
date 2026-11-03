/** Database adapter entry; never import this from business or HTTP code. */
export {
	metadataArtwork,
	metadataPins,
	metadataReferences,
	metadataSnapshots,
	metadataWorks,
} from "./infrastructure/schema.js";

export { saveWorkSummary } from "./infrastructure/works.js";
