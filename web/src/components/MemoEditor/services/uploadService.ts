import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { attachmentServiceClient } from "@/connect";
import type { Attachment, UploadAttachmentRequest } from "@/types/proto/api/attachment_service_pb";
import { AttachmentSchema, MotionMediaSchema, UploadAttachmentSpecSchema } from "@/types/proto/api/attachment_service_pb";
import type { LocalFile } from "../types/attachment";

const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024;
// The server allows eight unfinished uploads per user; stay well under it.
const MAX_CONCURRENT_UPLOADS = 4;

export const uploadService = {
  async uploadFile(localFile: LocalFile, signal?: AbortSignal): Promise<Attachment> {
    const { file, motionMedia } = localFile;
    // Read the whole file into memory up front. On Android the file picker
    // hands the browser a content URI whose read permission can lapse after
    // the reference is acquired; the old code re-read the File once per
    // chunk (metadata extraction, then a spec round-trip, then one round-trip
    // per chunk), so a later slice could fail with "The requested file could
    // not be read" even though the file was picked fine. Buffering once keeps
    // the upload working after the underlying file becomes unreadable.
    // Bounded by the instance upload size limit (30 MB by default).
    const buffer = new Uint8Array(await file.arrayBuffer());
    const mediaMetadata = await localFile.mediaMetadata;
    const spec = create(UploadAttachmentSpecSchema, {
      attachment: create(AttachmentSchema, {
        filename: file.name,
        type: file.type,
        motionMedia: motionMedia ? create(MotionMediaSchema, motionMedia) : undefined,
        mediaMetadata,
      }),
      totalSize: BigInt(buffer.length),
    });
    // The spec call carries no data so that retrying it after a lost response
    // can at worst orphan an upload, never create a duplicate attachment.
    const initial = await attachmentServiceClient.uploadAttachment({ upload: { case: "spec", value: spec } }, { signal });
    if (!initial.uploadId || initial.committedSize !== 0n || initial.maxChunkSize <= 0) {
      throw new Error("Invalid upload initialization response");
    }
    const chunkSize = Math.min(initial.maxChunkSize, DEFAULT_CHUNK_SIZE);
    for (let offset = 0; ; ) {
      signal?.throwIfAborted();
      const end = Math.min(offset + chunkSize, buffer.length);
      const request: Pick<UploadAttachmentRequest, "upload" | "writeOffset" | "data" | "finishWrite"> = {
        upload: { case: "uploadId", value: initial.uploadId },
        writeOffset: BigInt(offset),
        data: buffer.slice(offset, end),
        finishWrite: end === buffer.length,
      };
      // Retrying the identical last write is safe even if its response was lost
      // after the server finalized the attachment.
      let response;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await attachmentServiceClient.uploadAttachment(request, { signal });
          break;
        } catch (error) {
          if (signal?.aborted || ConnectError.from(error).code !== Code.Unavailable || attempt >= 2) throw error;
        }
      }
      if (response.committedSize !== BigInt(end)) {
        throw new Error("Unexpected upload offset");
      }
      if (request.finishWrite) {
        if (!response.attachment) throw new Error("Upload completed without an attachment");
        return response.attachment;
      }
      offset = end;
    }
  },

  async uploadFiles(localFiles: LocalFile[]): Promise<Attachment[]> {
    const attachments: Attachment[] = new Array(localFiles.length);
    let next = 0;
    const worker = async () => {
      for (let index = next++; index < localFiles.length; index = next++) {
        attachments[index] = await this.uploadFile(localFiles[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, localFiles.length) }, worker));
    return attachments;
  },
};
