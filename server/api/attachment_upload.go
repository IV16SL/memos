package api

import (
	"bytes"
	"context"
	"log/slog"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/ratelimit"
	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/store"
)

const (
	attachmentUploadMetadataLimit = 64 << 10
	attachmentUploadProcedure     = "/memos.api.AttachmentService/UploadAttachment"
)

// attachmentUploadState is what an attachment upload carries besides its
// bytes. Only Attachment is an API resource.
type attachmentUploadState struct {
	metadata          *apipb.Attachment
	uid               string
	finalizeAttempted bool
}

type (
	attachmentUpload  = uploadSession[attachmentUploadState]
	attachmentUploads = uploadSessions[attachmentUploadState]
)

// UploadAttachment accepts bounded unary chunks. A call carrying a spec opens
// a new upload; a call carrying an upload ID continues one. Either kind may
// write data and finalize.
func (s *APIService) UploadAttachment(ctx context.Context, request *apipb.UploadAttachmentRequest) (*apipb.UploadAttachmentResponse, error) {
	user, err := s.requireCurrentSpaceUser(ctx)
	if err != nil {
		return nil, err
	}
	if len(request.Data) > uploadChunkSize {
		return nil, status.Errorf(codes.ResourceExhausted, "upload chunk exceeds the limit")
	}
	var id string
	var upload *attachmentUpload
	switch u := request.Upload.(type) {
	case *apipb.UploadAttachmentRequest_Spec:
		if err := s.throttleAndCharge(ratelimit.ScopeUploadUser, userKey(user.ID), 1); err != nil {
			return nil, err
		}
		id, upload, err = s.startAttachmentUpload(ctx, request, u.Spec, user.ID)
		if err != nil {
			return nil, err
		}
	case *apipb.UploadAttachmentRequest_UploadId:
		id = u.UploadId
		upload, err = s.attachmentUploads.resume(ctx, id, user.ID)
		if err != nil {
			return nil, err
		}
	default:
		return nil, status.Errorf(codes.InvalidArgument, "spec or upload_id is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	if err := upload.write(ctx, request.WriteOffset, request.Data, request.FinishWrite); err != nil {
		return nil, err
	}
	var attachment *apipb.Attachment
	finished := false
	if upload.complete {
		// Recheck access and existence; a completed upload must not resurrect a
		// deleted attachment or disclose metadata after access is revoked.
		attachment, err = s.GetAttachment(ctx, &apipb.GetAttachmentRequest{Name: "attachments/" + upload.state.uid})
	} else if request.FinishWrite {
		if upload.committedSize != upload.totalSize {
			return nil, status.Errorf(codes.FailedPrecondition, "upload is incomplete")
		}
		attachment, err = s.finishAttachmentUpload(ctx, upload)
		if err == nil {
			if err := upload.markComplete(ctx); err != nil {
				return nil, err
			}
			if err := upload.deleteChunks(ctx); err != nil {
				return nil, err
			}
			finished = true
		}
	}
	if err != nil {
		return nil, err
	}
	if !finished {
		if err := upload.touch(ctx); err != nil {
			slog.Warn("failed to extend upload expiry", "error", err)
		}
	}
	return &apipb.UploadAttachmentResponse{
		UploadId: id, CommittedSize: upload.committedSize, Attachment: attachment, MaxChunkSize: uploadChunkSize,
	}, nil
}

// startAttachmentUpload validates the spec and registers a new upload. Every
// check that can fail on the accompanying data runs first, so a rejected call
// never leaves an orphaned upload behind.
func (s *APIService) startAttachmentUpload(ctx context.Context, request *apipb.UploadAttachmentRequest, spec *apipb.UploadAttachmentSpec, ownerID int32) (string, *attachmentUpload, error) {
	if spec.Attachment == nil {
		return "", nil, status.Errorf(codes.InvalidArgument, "spec.attachment is required")
	}
	if len(spec.Attachment.Content) != 0 {
		return "", nil, status.Errorf(codes.InvalidArgument, "spec.attachment.content must be empty; send file bytes in data")
	}
	if proto.Size(spec) > attachmentUploadMetadataLimit || spec.TotalSize < 0 {
		return "", nil, status.Errorf(codes.InvalidArgument, "invalid attachment metadata or total_size")
	}
	if request.WriteOffset != 0 {
		return "", nil, status.Errorf(codes.OutOfRange, "write_offset must be 0 for a new upload")
	}
	if int64(len(request.Data)) > spec.TotalSize {
		return "", nil, status.Errorf(codes.InvalidArgument, "data exceeds total_size")
	}
	setting, err := s.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return "", nil, status.Errorf(codes.Internal, "failed to get storage setting: %v", err)
	}
	if err := checkUploadSize(setting, spec.TotalSize); err != nil {
		return "", nil, err
	}
	// Validate before allocating a temporary file. Keep the original MIME type
	// so an omitted type can be sniffed from real bytes at finalization.
	metadata := proto.CloneOf(spec.Attachment)
	validationMetadata := proto.CloneOf(metadata)
	if validationMetadata.Type == "" {
		// Type-dependent metadata validation must wait for content sniffing.
		validationMetadata.MediaMetadata = nil
	}
	create, err := s.prepareAttachment(ctx, &apipb.CreateAttachmentRequest{Attachment: validationMetadata, AttachmentId: spec.AttachmentId})
	if err != nil {
		return "", nil, err
	}
	state := attachmentUploadState{metadata: metadata, uid: create.UID}
	return s.attachmentUploads.create(ctx, ownerID, spec.TotalSize, state)
}

func (s *APIService) finishAttachmentUpload(ctx context.Context, upload *attachmentUpload) (*apipb.Attachment, error) {
	// Exactly one instance may finalize a session; concurrent finishers
	// resolve the winner's outcome instead of inserting a duplicate.
	claimed, err := upload.claimFinalize(ctx)
	if err != nil {
		return nil, err
	}
	if !claimed {
		return s.resolveFinalizedAttachment(ctx, upload)
	}
	finalized := false
	defer func() {
		if !finalized {
			if rerr := upload.releaseFinalize(ctx); rerr != nil {
				slog.Warn("failed to release upload finalize lease", "error", rerr)
			}
		}
	}()
	if upload.state.finalizeAttempted {
		// A database operation may commit before returning an error. Resolve that
		// outcome before saving another object under the upload's stable UID.
		persisted, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &upload.state.uid})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to resolve previous finalization: %v", err)
		}
		if persisted != nil {
			if persisted.CreatorID != upload.ownerID {
				return nil, status.Errorf(codes.AlreadyExists, "attachment ID already exists")
			}
			return s.GetAttachment(ctx, &apipb.GetAttachmentRequest{Name: "attachments/" + upload.state.uid})
		}
	}
	setting, err := s.Store.GetInstanceStorageSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get storage setting: %v", err)
	}
	if err := checkUploadSize(setting, upload.totalSize); err != nil {
		return nil, err
	}
	file, err := upload.readAll(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to read staged upload: %v", err)
	}
	metadata := proto.CloneOf(upload.state.metadata)
	headerLen := min(len(file), int(min(upload.totalSize, 512)))
	metadata.Content = file[:headerLen]
	// Revalidate memo permissions and media metadata with the actual MIME type.
	create, err := s.prepareAttachment(ctx, &apipb.CreateAttachmentRequest{Attachment: metadata, AttachmentId: upload.state.uid})
	if err != nil {
		return nil, err
	}
	create.Size = upload.totalSize
	upload.state.finalizeAttempted = true
	if err := upload.saveState(ctx); err != nil {
		return nil, err
	}
	attachment, err := s.processAndSaveAttachment(ctx, create, setting, bytes.NewReader(file))
	if err == nil {
		finalized = true
	}
	return attachment, err
}

// resolveFinalizedAttachment waits for another instance's in-flight
// finalization of the same session and returns its outcome.
func (s *APIService) resolveFinalizedAttachment(ctx context.Context, upload *attachmentUpload) (*apipb.Attachment, error) {
	deadline := time.Now().Add(30 * time.Second)
	for {
		persisted, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &upload.state.uid})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to resolve previous finalization: %v", err)
		}
		if persisted != nil {
			if persisted.CreatorID != upload.ownerID {
				return nil, status.Errorf(codes.AlreadyExists, "attachment ID already exists")
			}
			return s.GetAttachment(ctx, &apipb.GetAttachmentRequest{Name: "attachments/" + upload.state.uid})
		}
		if time.Now().After(deadline) {
			return nil, status.Errorf(codes.Internal, "attachment finalization did not complete")
		}
		select {
		case <-ctx.Done():
			return nil, status.FromContextError(ctx.Err()).Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}
