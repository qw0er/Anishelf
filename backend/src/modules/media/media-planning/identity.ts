/** Version-bound derived media identity shared by planning and persistent output owners. */
export interface DerivedMediaIdentity {
	rootId: string;
	fileId: string;
	sourceVersion: string;
	profileFingerprint: string;
	executionPlanId: string;
	videoStreamIndex: number;
	audioStreamIndices: readonly number[];
}
