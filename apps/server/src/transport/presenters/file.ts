import type { FileDto } from "@anishelf/contracts/http";
import type { FileInfo } from "../../modules/resources/public.js";
export function fileDto(file: FileInfo): FileDto {
	return {
		kind: "file",
		id: file.id,
		parentId: file.parentId,
		name: file.name,
		sizeBytes: file.sizeBytes,
		modifiedAt: file.modifiedAt,
		mimeType: file.mimeType,
		...(file.sourceVersion ? { sourceVersion: file.sourceVersion } : {}),
	};
}
