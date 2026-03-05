import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:background_downloader/background_downloader.dart';
import 'package:cancellation_token_http/http.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/constants.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:logging/logging.dart';
import 'package:immich_mobile/utils/debug_print.dart';

class UploadTaskWithFile {
  final File file;
  final UploadTask task;

  const UploadTaskWithFile({required this.file, required this.task});
}

final uploadRepositoryProvider = Provider((ref) => UploadRepository());

class UploadRepository {
  final Logger logger = Logger('UploadRepository');
  void Function(TaskStatusUpdate)? onUploadStatus;
  void Function(TaskProgressUpdate)? onTaskProgress;

  UploadRepository() {
    FileDownloader().registerCallbacks(
      group: kBackupGroup,
      taskStatusCallback: (update) => onUploadStatus?.call(update),
      taskProgressCallback: (update) => onTaskProgress?.call(update),
    );
    FileDownloader().registerCallbacks(
      group: kBackupLivePhotoGroup,
      taskStatusCallback: (update) => onUploadStatus?.call(update),
      taskProgressCallback: (update) => onTaskProgress?.call(update),
    );
    FileDownloader().registerCallbacks(
      group: kManualUploadGroup,
      taskStatusCallback: (update) => onUploadStatus?.call(update),
      taskProgressCallback: (update) => onTaskProgress?.call(update),
    );
  }

  Future<void> enqueueBackground(UploadTask task) {
    return FileDownloader().enqueue(task);
  }

  Future<List<bool>> enqueueBackgroundAll(List<UploadTask> tasks) {
    return FileDownloader().enqueueAll(tasks);
  }

  Future<void> deleteDatabaseRecords(String group) {
    return FileDownloader().database.deleteAllRecords(group: group);
  }

  Future<bool> cancelAll(String group) {
    return FileDownloader().cancelAll(group: group);
  }

  Future<int> reset(String group) {
    return FileDownloader().reset(group: group);
  }

  /// Get a list of tasks that are ENQUEUED or RUNNING
  Future<List<Task>> getActiveTasks(String group) {
    return FileDownloader().allTasks(group: group);
  }

  Future<void> start() {
    return FileDownloader().start();
  }

  Future<void> getUploadInfo() async {
    final [enqueuedTasks, runningTasks, canceledTasks, waitingTasks, pausedTasks] = await Future.wait([
      FileDownloader().database.allRecordsWithStatus(TaskStatus.enqueued, group: kBackupGroup),
      FileDownloader().database.allRecordsWithStatus(TaskStatus.running, group: kBackupGroup),
      FileDownloader().database.allRecordsWithStatus(TaskStatus.canceled, group: kBackupGroup),
      FileDownloader().database.allRecordsWithStatus(TaskStatus.waitingToRetry, group: kBackupGroup),
      FileDownloader().database.allRecordsWithStatus(TaskStatus.paused, group: kBackupGroup),
    ]);

    dPrint(
      () =>
          """
      Upload Info:
      Enqueued: ${enqueuedTasks.length}
      Running: ${runningTasks.length}
      Canceled: ${canceledTasks.length}
      Waiting: ${waitingTasks.length}
      Paused: ${pausedTasks.length}
    """,
    );
  }

  Future<UploadResult> uploadFile({
    required File file,
    required String originalFileName,
    required Map<String, String> headers,
    required Map<String, String> fields,
    required Client httpClient,
    required CancellationToken cancelToken,
    required void Function(int bytes, int totalBytes) onProgress,
    required String logContext,
    int chunkSizeMB = 0,
  }) async {
    final fileSize = file.lengthSync();
    final chunkSizeBytes = chunkSizeMB > 0 ? chunkSizeMB * 1024 * 1024 : 0;

    if (chunkSizeBytes > 0 && fileSize > chunkSizeBytes) {
      return _uploadFileInChunks(
        file: file,
        originalFileName: originalFileName,
        headers: headers,
        fields: fields,
        httpClient: httpClient,
        cancelToken: cancelToken,
        onProgress: onProgress,
        logContext: logContext,
        chunkSizeBytes: chunkSizeBytes,
      );
    }

    return _uploadFileSingle(
      file: file,
      originalFileName: originalFileName,
      headers: headers,
      fields: fields,
      httpClient: httpClient,
      cancelToken: cancelToken,
      onProgress: onProgress,
      logContext: logContext,
    );
  }

  Future<UploadResult> _uploadFileSingle({
    required File file,
    required String originalFileName,
    required Map<String, String> headers,
    required Map<String, String> fields,
    required Client httpClient,
    required CancellationToken cancelToken,
    required void Function(int bytes, int totalBytes) onProgress,
    required String logContext,
  }) async {
    final String savedEndpoint = Store.get(StoreKey.serverEndpoint);

    try {
      final fileStream = file.openRead();
      final assetRawUploadData = MultipartFile("assetData", fileStream, file.lengthSync(), filename: originalFileName);

      final baseRequest = _CustomMultipartRequest('POST', Uri.parse('$savedEndpoint/assets'), onProgress: onProgress);

      baseRequest.headers.addAll(headers);
      baseRequest.fields.addAll(fields);
      baseRequest.files.add(assetRawUploadData);

      final response = await httpClient.send(baseRequest, cancellationToken: cancelToken);
      final responseBodyString = await response.stream.bytesToString();

      if (![200, 201].contains(response.statusCode)) {
        String? errorMessage;

        if (response.statusCode == 413) {
          errorMessage = 'Error(413) File is too large to upload';
          return UploadResult.error(statusCode: response.statusCode, errorMessage: errorMessage);
        }

        try {
          final error = jsonDecode(responseBodyString);
          errorMessage = error['message'] ?? error['error'];
        } catch (_) {
          errorMessage = responseBodyString.isNotEmpty
              ? responseBodyString
              : 'Upload failed with status ${response.statusCode}';
        }

        return UploadResult.error(statusCode: response.statusCode, errorMessage: errorMessage);
      }

      try {
        final responseBody = jsonDecode(responseBodyString);
        return UploadResult.success(remoteAssetId: responseBody['id'] as String);
      } catch (e) {
        return UploadResult.error(errorMessage: 'Failed to parse server response');
      }
    } on CancelledException {
      logger.warning("Upload $logContext was cancelled");
      return UploadResult.cancelled();
    } catch (error, stackTrace) {
      logger.warning("Error uploading $logContext: ${error.toString()}: $stackTrace");
      return UploadResult.error(errorMessage: error.toString());
    }
  }

  Future<UploadResult> _uploadFileInChunks({
    required File file,
    required String originalFileName,
    required Map<String, String> headers,
    required Map<String, String> fields,
    required Client httpClient,
    required CancellationToken cancelToken,
    required void Function(int bytes, int totalBytes) onProgress,
    required String logContext,
    required int chunkSizeBytes,
  }) async {
    final String savedEndpoint = Store.get(StoreKey.serverEndpoint);
    final fileSize = file.lengthSync();
    final totalChunks = (fileSize / chunkSizeBytes).ceil();

    try {
      // Step 1: Create upload session
      final sessionRequest = Request('POST', Uri.parse('$savedEndpoint/assets/upload-session'));
      sessionRequest.headers.addAll(headers);
      sessionRequest.headers['Content-Type'] = 'application/json';
      final sessionFields = Map<String, dynamic>.from(fields);
      sessionFields['totalChunks'] = totalChunks;
      // Only set filename if not already provided in fields
      sessionFields.putIfAbsent('filename', () => originalFileName);
      sessionRequest.body = jsonEncode(sessionFields);

      final sessionResponse = await httpClient.send(sessionRequest, cancellationToken: cancelToken);
      final sessionBody = await sessionResponse.stream.bytesToString();

      if (sessionResponse.statusCode != 201) {
        String? errorMessage;
        try {
          final error = jsonDecode(sessionBody);
          errorMessage = error['message'] ?? error['error'];
        } catch (_) {
          errorMessage = sessionBody.isNotEmpty ? sessionBody : 'Failed to create upload session';
        }
        return UploadResult.error(statusCode: sessionResponse.statusCode, errorMessage: errorMessage);
      }

      final sessionData = jsonDecode(sessionBody);
      final String uploadId = sessionData['uploadId'] as String;

      // Step 2: Upload chunks
      final raf = await file.open(mode: FileMode.read);
      try {
        int bytesUploaded = 0;

        for (int chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          if (cancelToken.isCancelled) {
            return UploadResult.cancelled();
          }

          final chunkStart = chunkIndex * chunkSizeBytes;
          final chunkEnd = (chunkStart + chunkSizeBytes < fileSize) ? chunkStart + chunkSizeBytes : fileSize;
          final actualChunkSize = chunkEnd - chunkStart;

          final Uint8List chunkData = Uint8List(actualChunkSize);
          int totalBytesRead = 0;
          while (totalBytesRead < actualChunkSize) {
            final bytesRead = await raf.readInto(chunkData, totalBytesRead, actualChunkSize);
            if (bytesRead == 0) {
              break; // EOF
            }
            totalBytesRead += bytesRead;
          }

          final chunkRequest = MultipartRequest(
            'PATCH',
            Uri.parse('$savedEndpoint/assets/upload-session/$uploadId'),
          );
          chunkRequest.headers.addAll(headers);
          chunkRequest.fields['chunkIndex'] = chunkIndex.toString();
          chunkRequest.fields['totalChunks'] = totalChunks.toString();
          chunkRequest.files.add(MultipartFile.fromBytes(
            'assetData',
            chunkData,
            filename: 'chunk-$chunkIndex',
          ));

          final chunkResponse = await httpClient.send(chunkRequest, cancellationToken: cancelToken);
          final chunkBody = await chunkResponse.stream.bytesToString();

          if (chunkResponse.statusCode != 200 && chunkResponse.statusCode != 201) {
            String? errorMessage;
            try {
              final error = jsonDecode(chunkBody);
              errorMessage = error['message'] ?? error['error'];
            } catch (_) {
              errorMessage = chunkBody.isNotEmpty ? chunkBody : 'Chunk upload failed';
            }
            return UploadResult.error(statusCode: chunkResponse.statusCode, errorMessage: errorMessage);
          }

          bytesUploaded += actualChunkSize;
          onProgress(bytesUploaded, fileSize);

          // Check if this was the last chunk
          if (chunkIndex == totalChunks - 1) {
            try {
              final responseBody = jsonDecode(chunkBody);
              final status = responseBody['status'] as String?;
              if (status == 'complete' || status == 'duplicate') {
                return UploadResult.success(remoteAssetId: responseBody['id'] as String);
              }
            } catch (e) {
              return UploadResult.error(errorMessage: 'Failed to parse final chunk response');
            }
          }
        }

        return UploadResult.error(errorMessage: 'Chunked upload completed but no asset ID received');
      } finally {
        await raf.close();
      }
    } on CancelledException {
      logger.warning("Chunked upload $logContext was cancelled");
      return UploadResult.cancelled();
    } catch (error, stackTrace) {
      logger.warning("Error during chunked upload $logContext: ${error.toString()}: $stackTrace");
      return UploadResult.error(errorMessage: error.toString());
    }
  }
}

class UploadResult {
  final bool isSuccess;
  final bool isCancelled;
  final String? remoteAssetId;
  final String? errorMessage;
  final int? statusCode;

  const UploadResult({
    required this.isSuccess,
    required this.isCancelled,
    this.remoteAssetId,
    this.errorMessage,
    this.statusCode,
  });

  factory UploadResult.success({required String remoteAssetId}) {
    return UploadResult(isSuccess: true, isCancelled: false, remoteAssetId: remoteAssetId);
  }

  factory UploadResult.error({String? errorMessage, int? statusCode}) {
    return UploadResult(isSuccess: false, isCancelled: false, errorMessage: errorMessage, statusCode: statusCode);
  }

  factory UploadResult.cancelled() {
    return const UploadResult(isSuccess: false, isCancelled: true);
  }
}

class _CustomMultipartRequest extends MultipartRequest {
  _CustomMultipartRequest(super.method, super.url, {required this.onProgress});

  final void Function(int bytes, int totalBytes) onProgress;

  @override
  ByteStream finalize() {
    final byteStream = super.finalize();
    final total = contentLength;
    var bytes = 0;

    final t = StreamTransformer.fromHandlers(
      handleData: (List<int> data, EventSink<List<int>> sink) {
        bytes += data.length;
        onProgress.call(bytes, total);
        sink.add(data);
      },
    );
    final stream = byteStream.transform(t);
    return ByteStream(stream);
  }
}
