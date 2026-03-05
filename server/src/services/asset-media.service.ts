import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile as fsReadFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import sanitize from 'sanitize-filename';
import { StorageCore } from 'src/cores/storage.core';
import { Asset } from 'src/database';
import {
  AssetBulkUploadCheckResponseDto,
  AssetMediaResponseDto,
  AssetMediaStatus,
  AssetRejectReason,
  AssetUploadAction,
  AssetUploadChunkResponseDto,
  AssetUploadChunkStatus,
  AssetUploadSessionResponseDto,
  CheckExistingAssetsResponseDto,
} from 'src/dtos/asset-media-response.dto';
import {
  AssetBulkUploadCheckDto,
  AssetMediaCreateDto,
  AssetMediaCreateSessionDto,
  AssetMediaOptionsDto,
  AssetMediaReplaceDto,
  AssetMediaSize,
  AssetUploadChunkDto,
  CheckExistingAssetsDto,
  UploadFieldName,
} from 'src/dtos/asset-media.dto';
import { AssetDownloadOriginalDto } from 'src/dtos/asset.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AssetFileType,
  AssetStatus,
  AssetVisibility,
  CacheControl,
  JobName,
  Permission,
  StorageFolder,
} from 'src/enum';
import { AuthRequest } from 'src/middleware/auth.guard';
import { BaseService } from 'src/services/base.service';
import { UploadFile, UploadRequest } from 'src/types';
import { requireUploadAccess } from 'src/utils/access';
import { asUploadRequest, onBeforeLink } from 'src/utils/asset.util';
import { isAssetChecksumConstraint } from 'src/utils/database';
import { getFilenameExtension, getFileNameWithoutExtension, ImmichFileResponse } from 'src/utils/file';
import { mimeTypes } from 'src/utils/mime-types';
import { fromChecksum } from 'src/utils/request';

export interface AssetMediaRedirectResponse {
  targetSize: AssetMediaSize | 'original';
}

@Injectable()
export class AssetMediaService extends BaseService {
  async getUploadAssetIdByChecksum(auth: AuthDto, checksum?: string): Promise<AssetMediaResponseDto | undefined> {
    if (!checksum) {
      return;
    }

    const assetId = await this.assetRepository.getUploadAssetIdByChecksum(auth.user.id, fromChecksum(checksum));
    if (!assetId) {
      return;
    }

    return { id: assetId, status: AssetMediaStatus.DUPLICATE };
  }

  canUploadFile({ auth, fieldName, file, body }: UploadRequest): true {
    requireUploadAccess(auth);

    const filename = body.filename || file.originalName;

    switch (fieldName) {
      case UploadFieldName.ASSET_DATA: {
        if (mimeTypes.isAsset(filename)) {
          return true;
        }
        break;
      }

      case UploadFieldName.SIDECAR_DATA: {
        if (mimeTypes.isSidecar(filename)) {
          return true;
        }
        break;
      }

      case UploadFieldName.PROFILE_DATA: {
        if (mimeTypes.isProfile(filename)) {
          return true;
        }
        break;
      }
    }

    this.logger.error(`Unsupported file type ${filename}`);
    throw new BadRequestException(`Unsupported file type ${filename}`);
  }

  getUploadFilename({ auth, fieldName, file, body }: UploadRequest): string {
    requireUploadAccess(auth);

    const extension = extname(body.filename || file.originalName);

    const lookup = {
      [UploadFieldName.ASSET_DATA]: extension,
      [UploadFieldName.SIDECAR_DATA]: '.xmp',
      [UploadFieldName.PROFILE_DATA]: extension,
    };

    return sanitize(`${file.uuid}${lookup[fieldName]}`);
  }

  getUploadFolder({ auth, fieldName, file }: UploadRequest): string {
    auth = requireUploadAccess(auth);

    let folder = StorageCore.getNestedFolder(StorageFolder.Upload, auth.user.id, file.uuid);
    if (fieldName === UploadFieldName.PROFILE_DATA) {
      folder = StorageCore.getFolderLocation(StorageFolder.Profile, auth.user.id);
    }

    this.storageRepository.mkdirSync(folder);

    return folder;
  }

  async onUploadError(request: AuthRequest, file: Express.Multer.File) {
    const uploadFilename = this.getUploadFilename(asUploadRequest(request, file));
    const uploadFolder = this.getUploadFolder(asUploadRequest(request, file));
    const uploadPath = `${uploadFolder}/${uploadFilename}`;

    await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [uploadPath] } });
  }

  async uploadAsset(
    auth: AuthDto,
    dto: AssetMediaCreateDto,
    file: UploadFile,
    sidecarFile?: UploadFile,
  ): Promise<AssetMediaResponseDto> {
    try {
      await this.requireAccess({
        auth,
        permission: Permission.AssetUpload,
        // do not need an id here, but the interface requires it
        ids: [auth.user.id],
      });

      this.requireQuota(auth, file.size);

      if (dto.livePhotoVideoId) {
        await onBeforeLink(
          { asset: this.assetRepository, event: this.eventRepository },
          { userId: auth.user.id, livePhotoVideoId: dto.livePhotoVideoId },
        );
      }
      const asset = await this.create(auth.user.id, dto, file, sidecarFile);

      await this.userRepository.updateUsage(auth.user.id, file.size);

      return { id: asset.id, status: AssetMediaStatus.CREATED };
    } catch (error: any) {
      return this.handleUploadError(error, auth, file, sidecarFile);
    }
  }

  async replaceAsset(
    auth: AuthDto,
    id: string,
    dto: AssetMediaReplaceDto,
    file: UploadFile,
    sidecarFile?: UploadFile,
  ): Promise<AssetMediaResponseDto> {
    try {
      await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [id] });
      const asset = await this.assetRepository.getById(id);

      if (!asset) {
        throw new Error('Asset not found');
      }

      this.requireQuota(auth, file.size);

      await this.replaceFileData(asset.id, dto, file, sidecarFile?.originalPath);

      // Next, create a backup copy of the existing record. The db record has already been updated above,
      // but the local variable holds the original file data paths.
      const copiedPhoto = await this.createCopy(asset);
      // and immediate trash it
      await this.assetRepository.updateAll([copiedPhoto.id], { deletedAt: new Date(), status: AssetStatus.Trashed });
      await this.eventRepository.emit('AssetTrash', { assetId: copiedPhoto.id, userId: auth.user.id });

      await this.userRepository.updateUsage(auth.user.id, file.size);

      return { status: AssetMediaStatus.REPLACED, id: copiedPhoto.id };
    } catch (error: any) {
      return this.handleUploadError(error, auth, file, sidecarFile);
    }
  }

  async downloadOriginal(auth: AuthDto, id: string, dto: AssetDownloadOriginalDto): Promise<ImmichFileResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetDownload, ids: [id] });

    if (auth.sharedLink) {
      dto.edited = true;
    }

    const { originalPath, originalFileName, editedPath } = await this.assetRepository.getForOriginal(
      id,
      dto.edited ?? false,
    );

    const path = editedPath ?? originalPath!;

    return new ImmichFileResponse({
      path,
      fileName: getFileNameWithoutExtension(originalFileName) + getFilenameExtension(path),
      contentType: mimeTypes.lookup(path),
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  async viewThumbnail(
    auth: AuthDto,
    id: string,
    dto: AssetMediaOptionsDto,
  ): Promise<ImmichFileResponse | AssetMediaRedirectResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [id] });

    if (dto.size === AssetMediaSize.Original) {
      throw new BadRequestException('May not request original file');
    }

    if (auth.sharedLink) {
      dto.edited = true;
    }

    const size = (dto.size ?? AssetMediaSize.THUMBNAIL) as unknown as AssetFileType;
    const { originalPath, originalFileName, path } = await this.assetRepository.getForThumbnail(
      id,
      size,
      dto.edited ?? false,
    );

    if (size === AssetFileType.FullSize && mimeTypes.isWebSupportedImage(originalPath) && !dto.edited) {
      // use original file for web supported images
      return { targetSize: 'original' };
    }

    if (dto.size === AssetMediaSize.FULLSIZE && !path) {
      // downgrade to preview if fullsize is not available.
      // e.g. disabled or not yet (re)generated
      return { targetSize: AssetMediaSize.PREVIEW };
    }

    if (!path) {
      throw new NotFoundException('Asset media not found');
    }

    const fileName = `${getFileNameWithoutExtension(originalFileName)}_${size}${getFilenameExtension(path)}`;

    return new ImmichFileResponse({
      fileName,
      path,
      contentType: mimeTypes.lookup(path),
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  async playbackVideo(auth: AuthDto, id: string): Promise<ImmichFileResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [id] });

    const asset = await this.assetRepository.getForVideo(id);

    if (!asset) {
      throw new NotFoundException('Asset not found or asset is not a video');
    }

    const filepath = asset.encodedVideoPath || asset.originalPath;

    return new ImmichFileResponse({
      path: filepath,
      contentType: mimeTypes.lookup(filepath),
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  async checkExistingAssets(
    auth: AuthDto,
    checkExistingAssetsDto: CheckExistingAssetsDto,
  ): Promise<CheckExistingAssetsResponseDto> {
    const existingIds = await this.assetRepository.getByDeviceIds(
      auth.user.id,
      checkExistingAssetsDto.deviceId,
      checkExistingAssetsDto.deviceAssetIds,
    );
    return { existingIds };
  }

  async bulkUploadCheck(auth: AuthDto, dto: AssetBulkUploadCheckDto): Promise<AssetBulkUploadCheckResponseDto> {
    const checksums: Buffer[] = dto.assets.map((asset) => fromChecksum(asset.checksum));
    const results = await this.assetRepository.getByChecksums(auth.user.id, checksums);
    const checksumMap: Record<string, { id: string; isTrashed: boolean }> = {};

    for (const { id, deletedAt, checksum } of results) {
      checksumMap[checksum.toString('hex')] = { id, isTrashed: !!deletedAt };
    }

    return {
      results: dto.assets.map(({ id, checksum }) => {
        const duplicate = checksumMap[fromChecksum(checksum).toString('hex')];
        if (duplicate) {
          return {
            id,
            action: AssetUploadAction.REJECT,
            reason: AssetRejectReason.DUPLICATE,
            assetId: duplicate.id,
            isTrashed: duplicate.isTrashed,
          };
        }

        return {
          id,
          action: AssetUploadAction.ACCEPT,
        };
      }),
    };
  }

  async createUploadSession(auth: AuthDto, dto: AssetMediaCreateSessionDto): Promise<AssetUploadSessionResponseDto> {
    requireUploadAccess(auth);

    const uploadId = this.cryptoRepository.randomUUID();
    const sessionDir = StorageCore.getChunkSessionFolder(auth.user.id, uploadId);
    this.storageRepository.mkdirSync(sessionDir);

    const sessionData = { uploadId, userId: auth.user.id, dto, totalChunks: dto.totalChunks };
    await this.storageRepository.createOrOverwriteFile(
      join(sessionDir, 'session.json'),
      Buffer.from(JSON.stringify(sessionData)),
    );

    return { uploadId };
  }

  async uploadAssetChunk(
    auth: AuthDto,
    uploadId: string,
    chunkDto: AssetUploadChunkDto,
    chunkBuffer: Buffer,
  ): Promise<AssetUploadChunkResponseDto> {
    requireUploadAccess(auth);

    const sessionDir = StorageCore.getChunkSessionFolder(auth.user.id, uploadId);
    const sessionFile = join(sessionDir, 'session.json');

    const sessionExists = await this.storageRepository.checkFileExists(sessionFile);
    if (!sessionExists) {
      throw new NotFoundException(`Upload session '${uploadId}' not found`);
    }

    const sessionData: { dto: AssetMediaCreateSessionDto; totalChunks: number } = JSON.parse(
      await this.storageRepository.readTextFile(sessionFile),
    );

    const { chunkIndex, totalChunks } = chunkDto;

    if (totalChunks !== sessionData.totalChunks) {
      throw new BadRequestException(`totalChunks mismatch: expected ${sessionData.totalChunks}, got ${totalChunks}`);
    }

    if (chunkIndex < 0 || chunkIndex >= totalChunks) {
      throw new BadRequestException(`chunkIndex ${chunkIndex} out of range [0, ${totalChunks - 1}]`);
    }

    // Write chunk to session directory
    const chunkFilename = `chunk-${String(chunkIndex).padStart(6, '0')}`;
    await this.storageRepository.createOrOverwriteFile(join(sessionDir, chunkFilename), chunkBuffer);

    // Check if all chunks have been received
    const receivedChunks = await this._countReceivedChunks(sessionDir, totalChunks);

    if (receivedChunks < totalChunks) {
      return { status: AssetUploadChunkStatus.PARTIAL, receivedChunks };
    }

    // All chunks received - assemble and create asset
    const dto = sessionData.dto as AssetMediaCreateDto;
    const extension = extname(dto.filename || 'upload');
    const assembledPath = join(sessionDir, `assembled${extension}`);

    let assembledFile: UploadFile | undefined;
    try {
      assembledFile = await this._assembleChunks(sessionDir, totalChunks, assembledPath, dto.filename || 'upload');

      // Move assembled file to permanent upload location
      const uploadFolder = StorageCore.getNestedFolder(StorageFolder.Upload, auth.user.id, assembledFile.uuid);
      this.storageRepository.mkdirSync(uploadFolder);
      const permanentPath = join(uploadFolder, `${assembledFile.uuid}${extension}`);
      await this.storageRepository.rename(assembledPath, permanentPath);

      // Update file reference to permanent path
      assembledFile = { ...assembledFile, originalPath: permanentPath };

      if (dto.livePhotoVideoId) {
        await onBeforeLink(
          { asset: this.assetRepository, event: this.eventRepository },
          { userId: auth.user.id, livePhotoVideoId: dto.livePhotoVideoId },
        );
      }

      this.requireQuota(auth, assembledFile.size);

      const asset = await this.create(auth.user.id, dto, assembledFile);
      await this.userRepository.updateUsage(auth.user.id, assembledFile.size);

      // Schedule session directory cleanup
      await this.jobRepository.queue({
        name: JobName.FileDelete,
        data: {
          files: [
            ...Array.from({ length: totalChunks }, (_, i) => join(sessionDir, `chunk-${String(i).padStart(6, '0')}`)),
            sessionFile,
          ],
        },
      });

      return { status: AssetUploadChunkStatus.COMPLETE, id: asset.id };
    } catch (error: any) {
      if (assembledFile && isAssetChecksumConstraint(error)) {
        const duplicateId = await this.assetRepository.getUploadAssetIdByChecksum(auth.user.id, assembledFile.checksum);
        if (duplicateId) {
          await this.jobRepository.queue({
            name: JobName.FileDelete,
            data: {
              files: [
                ...Array.from({ length: totalChunks }, (_, i) =>
                  join(sessionDir, `chunk-${String(i).padStart(6, '0')}`),
                ),
                sessionFile,
                assembledFile.originalPath,
              ],
            },
          });
          return { status: AssetUploadChunkStatus.DUPLICATE, id: duplicateId };
        }
      }
      this.logger.error(`Error assembling chunked upload ${uploadId}: ${error}`, error?.stack);
      throw error;
    }
  }

  private async _countReceivedChunks(sessionDir: string, totalChunks: number): Promise<number> {
    let count = 0;
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = join(sessionDir, `chunk-${String(i).padStart(6, '0')}`);
      if (await this.storageRepository.checkFileExists(chunkPath)) {
        count++;
      }
    }
    return count;
  }

  private async _assembleChunks(
    sessionDir: string,
    totalChunks: number,
    outputPath: string,
    originalName: string,
  ): Promise<UploadFile> {
    const hash = createHash('sha1');
    const writeStream = createWriteStream(outputPath);
    let totalSize = 0;

    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = join(sessionDir, `chunk-${String(i).padStart(6, '0')}`);
        const chunkBuffer = await fsReadFile(chunkPath);
        hash.update(chunkBuffer);
        totalSize += chunkBuffer.length;
        await new Promise<void>((resolve, reject) => {
          writeStream.write(chunkBuffer, (err) => (err ? reject(err) : resolve()));
        });
      }
    } finally {
      await new Promise<void>((resolve, reject) => writeStream.end((err: Error | null | undefined) => (err ? reject(err) : resolve())));
    }

    const uuid = this.cryptoRepository.randomUUID();

    return {
      uuid,
      checksum: hash.digest(),
      originalPath: outputPath,
      originalName,
      size: totalSize,
    };
  }

  private async handleUploadError(
    error: any,
    auth: AuthDto,
    file: UploadFile,
    sidecarFile?: UploadFile,
  ): Promise<AssetMediaResponseDto> {
    // clean up files
    await this.jobRepository.queue({
      name: JobName.FileDelete,
      data: { files: [file.originalPath, sidecarFile?.originalPath] },
    });

    // handle duplicates with a success response
    if (isAssetChecksumConstraint(error)) {
      const duplicateId = await this.assetRepository.getUploadAssetIdByChecksum(auth.user.id, file.checksum);
      if (!duplicateId) {
        this.logger.error(`Error locating duplicate for checksum constraint`);
        throw new InternalServerErrorException();
      }
      return { status: AssetMediaStatus.DUPLICATE, id: duplicateId };
    }

    this.logger.error(`Error uploading file ${error}`, error?.stack);
    throw error;
  }

  /**
   * Updates the specified assetId to the specified photo data file properties: checksum, path,
   * timestamps, deviceIds, and sidecar. Derived properties like: faces, smart search info, etc
   * are UNTOUCHED. The photo data files modification times on the filesysytem are updated to
   * the specified timestamps. The exif db record is upserted, and then A METADATA_EXTRACTION
   * job is queued to update these derived properties.
   */
  private async replaceFileData(
    assetId: string,
    dto: AssetMediaReplaceDto,
    file: UploadFile,
    sidecarPath?: string,
  ): Promise<void> {
    await this.assetRepository.update({
      id: assetId,

      checksum: file.checksum,
      originalPath: file.originalPath,
      type: mimeTypes.assetType(file.originalPath),
      originalFileName: file.originalName,

      deviceAssetId: dto.deviceAssetId,
      deviceId: dto.deviceId,
      fileCreatedAt: dto.fileCreatedAt,
      fileModifiedAt: dto.fileModifiedAt,
      localDateTime: dto.fileCreatedAt,
      duration: dto.duration || null,

      livePhotoVideoId: null,
    });

    await (sidecarPath
      ? this.assetRepository.upsertFile({ assetId, type: AssetFileType.Sidecar, path: sidecarPath })
      : this.assetRepository.deleteFile({ assetId, type: AssetFileType.Sidecar }));

    await this.storageRepository.utimes(file.originalPath, new Date(), new Date(dto.fileModifiedAt));
    await this.assetRepository.upsertExif(
      { assetId, fileSizeInByte: file.size },
      { lockedPropertiesBehavior: 'override' },
    );
    await this.jobRepository.queue({
      name: JobName.AssetExtractMetadata,
      data: { id: assetId, source: 'upload' },
    });
  }

  /**
   * Create a 'shallow' copy of the specified asset record creating a new asset record in the database.
   * Uses only vital properties excluding things like: stacks, faces, smart search info, etc,
   * and then queues a METADATA_EXTRACTION job.
   */
  private async createCopy(asset: Omit<Asset, 'id'>) {
    const created = await this.assetRepository.create({
      ownerId: asset.ownerId,
      originalPath: asset.originalPath,
      originalFileName: asset.originalFileName,
      libraryId: asset.libraryId,
      deviceAssetId: asset.deviceAssetId,
      deviceId: asset.deviceId,
      type: asset.type,
      checksum: asset.checksum,
      fileCreatedAt: asset.fileCreatedAt,
      localDateTime: asset.localDateTime,
      fileModifiedAt: asset.fileModifiedAt,
      livePhotoVideoId: asset.livePhotoVideoId,
    });

    const { size } = await this.storageRepository.stat(created.originalPath);
    await this.assetRepository.upsertExif(
      { assetId: created.id, fileSizeInByte: size },
      { lockedPropertiesBehavior: 'override' },
    );
    await this.jobRepository.queue({ name: JobName.AssetExtractMetadata, data: { id: created.id, source: 'copy' } });
    return created;
  }

  private async create(ownerId: string, dto: AssetMediaCreateDto, file: UploadFile, sidecarFile?: UploadFile) {
    const asset = await this.assetRepository.create({
      ownerId,
      libraryId: null,

      checksum: file.checksum,
      originalPath: file.originalPath,

      deviceAssetId: dto.deviceAssetId,
      deviceId: dto.deviceId,

      fileCreatedAt: dto.fileCreatedAt,
      fileModifiedAt: dto.fileModifiedAt,
      localDateTime: dto.fileCreatedAt,

      type: mimeTypes.assetType(file.originalPath),
      isFavorite: dto.isFavorite,
      duration: dto.duration || null,
      visibility: dto.visibility ?? AssetVisibility.Timeline,
      livePhotoVideoId: dto.livePhotoVideoId,
      originalFileName: dto.filename || file.originalName,
    });

    if (dto.metadata?.length) {
      await this.assetRepository.upsertMetadata(asset.id, dto.metadata);
    }

    if (sidecarFile) {
      await this.assetRepository.upsertFile({
        assetId: asset.id,
        path: sidecarFile.originalPath,
        type: AssetFileType.Sidecar,
      });
      await this.storageRepository.utimes(sidecarFile.originalPath, new Date(), new Date(dto.fileModifiedAt));
    }
    await this.storageRepository.utimes(file.originalPath, new Date(), new Date(dto.fileModifiedAt));
    await this.assetRepository.upsertExif(
      { assetId: asset.id, fileSizeInByte: file.size },
      { lockedPropertiesBehavior: 'override' },
    );

    await this.eventRepository.emit('AssetCreate', { asset });

    await this.jobRepository.queue({ name: JobName.AssetExtractMetadata, data: { id: asset.id, source: 'upload' } });

    return asset;
  }

  private requireQuota(auth: AuthDto, size: number) {
    if (auth.user.quotaSizeInBytes !== null && auth.user.quotaSizeInBytes < auth.user.quotaUsageInBytes + size) {
      throw new BadRequestException('Quota has been exceeded!');
    }
  }
}
