import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateEnum } from 'src/validation';

export enum AssetMediaStatus {
  CREATED = 'created',
  REPLACED = 'replaced',
  DUPLICATE = 'duplicate',
}
export class AssetMediaResponseDto {
  @ValidateEnum({ enum: AssetMediaStatus, name: 'AssetMediaStatus', description: 'Upload status' })
  status!: AssetMediaStatus;
  @ApiProperty({ description: 'Asset media ID' })
  id!: string;
}

export enum AssetUploadAction {
  ACCEPT = 'accept',
  REJECT = 'reject',
}

export enum AssetRejectReason {
  DUPLICATE = 'duplicate',
  UNSUPPORTED_FORMAT = 'unsupported-format',
}

export class AssetBulkUploadCheckResult {
  @ApiProperty({ description: 'Asset ID' })
  id!: string;
  @ApiProperty({ description: 'Upload action', enum: AssetUploadAction })
  action!: AssetUploadAction;
  @ApiPropertyOptional({ description: 'Rejection reason if rejected', enum: AssetRejectReason })
  reason?: AssetRejectReason;
  @ApiPropertyOptional({ description: 'Existing asset ID if duplicate' })
  assetId?: string;
  @ApiPropertyOptional({ description: 'Whether existing asset is trashed' })
  isTrashed?: boolean;
}

export class AssetBulkUploadCheckResponseDto {
  @ApiProperty({ description: 'Upload check results' })
  results!: AssetBulkUploadCheckResult[];
}

export class CheckExistingAssetsResponseDto {
  @ApiProperty({ description: 'Existing asset IDs' })
  existingIds!: string[];
}

export enum AssetUploadChunkStatus {
  PARTIAL = 'partial',
  COMPLETE = 'complete',
  DUPLICATE = 'duplicate',
}

export class AssetUploadSessionResponseDto {
  @ApiProperty({ description: 'Upload session ID' })
  uploadId!: string;
}

export class AssetUploadChunkResponseDto {
  @ApiProperty({ description: 'Upload chunk status', enum: AssetUploadChunkStatus })
  status!: AssetUploadChunkStatus;
  @ApiPropertyOptional({ description: 'Asset ID when upload is complete or duplicate' })
  id?: string;
  @ApiPropertyOptional({ description: 'Number of chunks received so far' })
  receivedChunks?: number;
}
