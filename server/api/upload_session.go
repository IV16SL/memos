package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	apipb "github.com/usememos/memos/proto/gen/api"
)

// Limits shared by every chunked upload RPC.
const (
	uploadChunkSize        = 2 << 20
	uploadRequestLimit     = 4 << 20
	uploadTTL              = 30 * time.Minute
	uploadMaxSessions      = 1024
	uploadMaxActive        = 128
	uploadMaxActivePerUser = 8
	// finalizeLeaseTTL bounds a finalization claim; it also bounds recovery
	// when a finalizer crashes mid-finalize.
	finalizeLeaseTTL = time.Minute
)

// Upload sessions used to live in process memory with chunks staged in temp
// files, which breaks on serverless platforms where consecutive RPCs may land
// on different instances. Sessions are now persisted in the database (two
// tables created lazily, chunk bytes as one row per chunk), so any instance
// can continue any session. The wire protocol is unchanged.
const (
	uploadKindAttachment = "attachment"
	uploadKindMemoImport = "memo_import"
)

// uploadSessionCodec serializes the kind-specific state T carried by a
// session. State is small (IDs, flags, a proto message), never chunk bytes.
type uploadSessionCodec[T any] struct {
	encode func(T) ([]byte, error)
	decode func([]byte) (T, error)
}

// uploadSessions manages chunked-upload sessions of one kind backed by the
// database. It is safe for concurrent use and, unlike the old in-memory
// version, for concurrent use across processes: every mutation is atomic.
type uploadSessions[T any] struct {
	db     *sql.DB
	driver string
	kind   string
	codec  uploadSessionCodec[T]

	ensureOnce sync.Once
	ensureErr  error
}

// uploadSession is one chunked upload staged in the database.
type uploadSession[T any] struct {
	mgr *uploadSessions[T]

	id            string
	ownerID       int32
	totalSize     int64
	committedSize int64
	complete      bool
	expireTime    time.Time
	state         T
}

func newUploadSessions[T any](db *sql.DB, driver, kind string, encode func(T) ([]byte, error), decode func([]byte) (T, error)) uploadSessions[T] {
	return uploadSessions[T]{
		db:     db,
		driver: driver,
		kind:   kind,
		codec:  uploadSessionCodec[T]{encode: encode, decode: decode},
	}
}

// bind rewrites ? placeholders to $n for postgres (lib/pq); mysql and
// sqlite use ? natively. Call sites write ? and wrap with m.bind(...).
func (m *uploadSessions[T]) bind(query string) string {
	if m.driver != "postgres" {
		return query
	}
	var sb strings.Builder
	n := 0
	for _, r := range query {
		if r == '?' {
			n++
			sb.WriteString("$" + strconv.Itoa(n))
		} else {
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

// ensureTables creates the session tables if they do not exist. Timestamps
// are unix seconds and completion is 0/1 so the DDL works on postgres, mysql
// and sqlite; only the binary column type varies.
func (m *uploadSessions[T]) ensureTables(ctx context.Context) error {
	m.ensureOnce.Do(func() {
		blobType := "BYTEA"
		if m.driver == "mysql" {
			blobType = "LONGBLOB"
		} else if m.driver == "sqlite" {
			blobType = "BLOB"
		}
		sessionDDL := `CREATE TABLE IF NOT EXISTS vercel_upload_session (
			id VARCHAR(64) PRIMARY KEY,
			owner_id INTEGER NOT NULL,
			kind VARCHAR(32) NOT NULL,
			total_size BIGINT NOT NULL,
			committed_size BIGINT NOT NULL DEFAULT 0,
			chunk_count BIGINT NOT NULL DEFAULT 0,
			last_digest ` + blobType + `,
			state ` + blobType + `,
			expire_at BIGINT NOT NULL,
			complete INTEGER NOT NULL DEFAULT 0,
			finalize_lease BIGINT NOT NULL DEFAULT 0
		)`
		chunkDDL := `CREATE TABLE IF NOT EXISTS vercel_upload_chunk (
			session_id VARCHAR(64) NOT NULL,
			seq BIGINT NOT NULL,
			data ` + blobType + ` NOT NULL,
			PRIMARY KEY (session_id, seq)
		)`
		if _, err := m.db.ExecContext(ctx, sessionDDL); err != nil {
			m.ensureErr = err
			return
		}
		_, m.ensureErr = m.db.ExecContext(ctx, chunkDDL)
	})
	return m.ensureErr
}

// sweepExpired deletes expired sessions and their chunks. It runs
// opportunistically on create; resume additionally enforces expiry per
// session, so no background goroutine is needed (serverless-friendly).
func (m *uploadSessions[T]) sweepExpired(ctx context.Context) error {
	_, err := m.db.ExecContext(ctx, m.bind(`DELETE FROM vercel_upload_chunk WHERE session_id IN (
		SELECT id FROM vercel_upload_session WHERE kind = ? AND expire_at < ?
	)`), m.kind, time.Now().Unix())
	if err != nil {
		return err
	}
	_, err = m.db.ExecContext(ctx, m.bind(`DELETE FROM vercel_upload_session WHERE kind = ? AND expire_at < ?`), m.kind, time.Now().Unix())
	return err
}

// create registers a new session for ownerID with totalSize bytes to come.
func (m *uploadSessions[T]) create(ctx context.Context, ownerID int32, totalSize int64, state T) (string, *uploadSession[T], error) {
	if err := m.ensureTables(ctx); err != nil {
		return "", nil, status.Errorf(codes.Internal, "failed to prepare upload storage: %v", err)
	}
	if err := m.sweepExpired(ctx); err != nil {
		return "", nil, status.Errorf(codes.Internal, "failed to sweep expired uploads: %v", err)
	}
	stateBytes, err := m.codec.encode(state)
	if err != nil {
		return "", nil, status.Errorf(codes.Internal, "failed to encode upload state: %v", err)
	}

	var owned, total, active int64
	if err := m.db.QueryRowContext(ctx, m.bind(`SELECT COUNT(*) FROM vercel_upload_session WHERE kind = ? AND owner_id = ? AND complete = 0`), m.kind, ownerID).Scan(&owned); err != nil {
		return "", nil, status.Errorf(codes.Internal, "failed to count uploads: %v", err)
	}
	if owned >= uploadMaxActivePerUser {
		return "", nil, status.Errorf(codes.ResourceExhausted, "too many active uploads")
	}
	if err := m.db.QueryRowContext(ctx, m.bind(`SELECT COUNT(*) FROM vercel_upload_session WHERE kind = ? AND complete = 0`), m.kind).Scan(&active); err != nil {
		return "", nil, status.Errorf(codes.Internal, "failed to count uploads: %v", err)
	}
	if err := m.db.QueryRowContext(ctx, m.bind(`SELECT COUNT(*) FROM vercel_upload_session WHERE kind = ?`), m.kind).Scan(&total); err != nil {
		return "", nil, status.Errorf(codes.Internal, "failed to count uploads: %v", err)
	}
	if total >= uploadMaxSessions || active >= uploadMaxActive {
		return "", nil, status.Errorf(codes.ResourceExhausted, "too many uploads")
	}

	id := rand.Text()
	expireAt := time.Now().Add(uploadTTL).Unix()
	if _, err := m.db.ExecContext(ctx, m.bind(`INSERT INTO vercel_upload_session
		(id, owner_id, kind, total_size, committed_size, chunk_count, state, expire_at, complete)
		VALUES (?, ?, ?, ?, 0, 0, ?, ?, 0)`),
		id, ownerID, m.kind, totalSize, stateBytes, expireAt); err != nil {
		return "", nil, status.Errorf(codes.Internal, "failed to create upload session: %v", err)
	}
	return id, &uploadSession[T]{
		mgr:        m,
		id:         id,
		ownerID:    ownerID,
		totalSize:  totalSize,
		expireTime: time.Unix(expireAt, 0),
		state:      state,
	}, nil
}

// resume looks up a session for a continuing call and extends its expiry.
func (m *uploadSessions[T]) resume(ctx context.Context, id string, ownerID int32) (*uploadSession[T], error) {
	if err := m.ensureTables(ctx); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to prepare upload storage: %v", err)
	}
	var (
		rowOwnerID    int32
		rowKind       string
		totalSize     int64
		committedSize int64
		stateBytes    []byte
		expireAt      int64
		completeInt   int64
	)
	if err := m.db.QueryRowContext(ctx, m.bind(`SELECT owner_id, kind, total_size, committed_size, state, expire_at, complete
		FROM vercel_upload_session WHERE id = ?`), id).Scan(
		&rowOwnerID, &rowKind, &totalSize, &committedSize, &stateBytes, &expireAt, &completeInt); err != nil {
		if err == sql.ErrNoRows {
			return nil, status.Errorf(codes.NotFound, "upload not found or expired")
		}
		return nil, status.Errorf(codes.Internal, "failed to load upload session: %v", err)
	}
	if rowKind != m.kind || rowOwnerID != ownerID {
		return nil, status.Errorf(codes.NotFound, "upload not found or expired")
	}
	now := time.Now()
	if !now.Before(time.Unix(expireAt, 0)) {
		return nil, status.Errorf(codes.NotFound, "upload not found or expired")
	}
	state, err := m.codec.decode(stateBytes)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to decode upload state: %v", err)
	}
	upload := &uploadSession[T]{
		mgr:           m,
		id:            id,
		ownerID:       rowOwnerID,
		totalSize:     totalSize,
		committedSize: committedSize,
		complete:      completeInt != 0,
		expireTime:    time.Unix(expireAt, 0),
		state:         state,
	}
	// Extend the expiry on every continuing call, like the old in-memory version.
	if err := upload.touch(ctx); err != nil {
		return nil, err
	}
	return upload, nil
}

// write appends one chunk at writeOffset. With no data and finishWrite false
// it only reports progress. Semantics mirror the old in-memory version;
// concurrent writers to the same session are serialized by compare-and-swap
// on committed_size, and a lost response can be retried idempotently.
func (u *uploadSession[T]) write(ctx context.Context, writeOffset int64, data []byte, finishWrite bool) error {
	if len(data) == 0 {
		if finishWrite && writeOffset != u.committedSize {
			return status.Errorf(codes.OutOfRange, "write_offset must equal committed_size")
		}
		return nil
	}
	if len(data) > uploadChunkSize {
		return status.Errorf(codes.ResourceExhausted, "upload chunk exceeds the limit")
	}

	var (
		committedSize int64
		chunkCount    int64
		lastDigest    []byte
		completeInt   int64
		expireAt      int64
	)
	if err := u.mgr.db.QueryRowContext(ctx, u.mgr.bind(`SELECT committed_size, chunk_count, last_digest, complete, expire_at
		FROM vercel_upload_session WHERE id = ?`), u.id).Scan(
		&committedSize, &chunkCount, &lastDigest, &completeInt, &expireAt); err != nil {
		if err == sql.ErrNoRows {
			return status.Errorf(codes.NotFound, "upload not found or expired")
		}
		return status.Errorf(codes.Internal, "failed to load upload session: %v", err)
	}
	if !time.Now().Before(time.Unix(expireAt, 0)) {
		return status.Errorf(codes.NotFound, "upload not found or expired")
	}
	digest := sha256.Sum256(data)
	if committedSize > 0 && writeOffset+int64(len(data)) == committedSize && string(digest[:]) == string(lastDigest) {
		return nil // A lost response can be retried without appending bytes twice.
	}
	if completeInt != 0 {
		return status.Errorf(codes.FailedPrecondition, "upload is already complete")
	}
	if writeOffset != committedSize {
		return status.Errorf(codes.OutOfRange, "write_offset must equal committed_size")
	}
	if int64(len(data)) > u.totalSize-committedSize {
		return status.Errorf(codes.InvalidArgument, "data exceeds total_size")
	}

	tx, err := u.mgr.db.BeginTx(ctx, nil)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to begin upload transaction: %v", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, u.mgr.bind(`INSERT INTO vercel_upload_chunk (session_id, seq, data) VALUES (?, ?, ?)`),
		u.id, chunkCount, data); err != nil {
		return status.Errorf(codes.Internal, "failed to store upload chunk: %v", err)
	}
	res, err := tx.ExecContext(ctx, u.mgr.bind(`UPDATE vercel_upload_session
		SET committed_size = committed_size + ?, chunk_count = chunk_count + 1, last_digest = ?
		WHERE id = ? AND committed_size = ? AND complete = 0`),
		len(data), digest[:], u.id, committedSize)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to commit upload chunk: %v", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return status.Errorf(codes.Internal, "failed to commit upload chunk: %v", err)
	}
	if affected == 0 {
		return status.Errorf(codes.OutOfRange, "write_offset must equal committed_size")
	}
	if err := tx.Commit(); err != nil {
		return status.Errorf(codes.Internal, "failed to commit upload chunk: %v", err)
	}
	u.committedSize = committedSize + int64(len(data))
	return nil
}

// readAll assembles the staged bytes in chunk order.
func (u *uploadSession[T]) readAll(ctx context.Context) ([]byte, error) {
	rows, err := u.mgr.db.QueryContext(ctx, u.mgr.bind(`SELECT data FROM vercel_upload_chunk WHERE session_id = ? ORDER BY seq`), u.id)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to read upload chunks: %v", err)
	}
	defer rows.Close()
	buf := make([]byte, 0, u.totalSize)
	for rows.Next() {
		var chunk []byte
		if err := rows.Scan(&chunk); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to read upload chunk: %v", err)
		}
		buf = append(buf, chunk...)
	}
	if err := rows.Err(); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to read upload chunks: %v", err)
	}
	return buf, nil
}

// touch extends the session expiry by the TTL.
func (u *uploadSession[T]) touch(ctx context.Context) error {
	expireAt := time.Now().Add(uploadTTL).Unix()
	if _, err := u.mgr.db.ExecContext(ctx, u.mgr.bind(`UPDATE vercel_upload_session SET expire_at = ? WHERE id = ?`), expireAt, u.id); err != nil {
		return status.Errorf(codes.Internal, "failed to extend upload expiry: %v", err)
	}
	u.expireTime = time.Unix(expireAt, 0)
	return nil
}

// saveState persists a mutated state T.
func (u *uploadSession[T]) saveState(ctx context.Context) error {
	stateBytes, err := u.mgr.codec.encode(u.state)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to encode upload state: %v", err)
	}
	if _, err := u.mgr.db.ExecContext(ctx, u.mgr.bind(`UPDATE vercel_upload_session SET state = ? WHERE id = ?`), stateBytes, u.id); err != nil {
		return status.Errorf(codes.Internal, "failed to save upload state: %v", err)
	}
	return nil
}

// markComplete flags the session complete (its bytes stay staged until expiry
// or deleteChunks, so a repeated finalize call resolves the same outcome).
func (u *uploadSession[T]) markComplete(ctx context.Context) error {
	if _, err := u.mgr.db.ExecContext(ctx, u.mgr.bind(`UPDATE vercel_upload_session SET complete = 1 WHERE id = ?`), u.id); err != nil {
		return status.Errorf(codes.Internal, "failed to complete upload session: %v", err)
	}
	u.complete = true
	return nil
}

// deleteChunks removes staged chunk bytes, keeping the session row so
// repeated finalize calls still resolve.
func (u *uploadSession[T]) deleteChunks(ctx context.Context) error {
	if _, err := u.mgr.db.ExecContext(ctx, u.mgr.bind(`DELETE FROM vercel_upload_chunk WHERE session_id = ?`), u.id); err != nil {
		return status.Errorf(codes.Internal, "failed to delete upload chunks: %v", err)
	}
	return nil
}

// claimFinalize atomically claims the right to finalize the session. Exactly
// one caller across all instances wins; losers must resolve the winner's
// outcome instead of finalizing twice. A crashed finalizer's lease expires
// after finalizeLeaseTTL, making the session reclaimable.
func (u *uploadSession[T]) claimFinalize(ctx context.Context) (bool, error) {
	now := time.Now().Unix()
	res, err := u.mgr.db.ExecContext(ctx, u.mgr.bind(
		`UPDATE vercel_upload_session SET finalize_lease = ? WHERE id = ? AND finalize_lease < ? AND complete = 0`),
		now+int64(finalizeLeaseTTL/time.Second), u.id, now)
	if err != nil {
		return false, status.Errorf(codes.Internal, "failed to claim upload finalization: %v", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return false, status.Errorf(codes.Internal, "failed to claim upload finalization: %v", err)
	}
	return affected == 1, nil
}

// releaseFinalize releases a finalization claim without finalizing, so a
// retry can reclaim it (e.g. after a failpoint-injected failure).
func (u *uploadSession[T]) releaseFinalize(ctx context.Context) error {
	if _, err := u.mgr.db.ExecContext(ctx, u.mgr.bind(
		`UPDATE vercel_upload_session SET finalize_lease = 0 WHERE id = ?`), u.id); err != nil {
		return status.Errorf(codes.Internal, "failed to release upload finalization: %v", err)
	}
	return nil
}

// refresh reloads the complete flag and state from the database.
func (u *uploadSession[T]) refresh(ctx context.Context) error {
	var (
		completeInt int64
		stateBytes  []byte
	)
	if err := u.mgr.db.QueryRowContext(ctx, u.mgr.bind(
		`SELECT complete, state FROM vercel_upload_session WHERE id = ?`), u.id).Scan(&completeInt, &stateBytes); err != nil {
		if err == sql.ErrNoRows {
			return status.Errorf(codes.NotFound, "upload not found or expired")
		}
		return status.Errorf(codes.Internal, "failed to refresh upload session: %v", err)
	}
	state, err := u.mgr.codec.decode(stateBytes)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to decode upload state: %v", err)
	}
	u.complete = completeInt != 0
	u.state = state
	return nil
}

// CloseUploads is a no-op now: sessions live in the database and expire on
// their own; there are no goroutines or temp files to clean up. Kept for
// call-site compatibility with the long-lived server.
func (s *APIService) CloseUploads() {}

// State codecs. State is small; metadata/report are proto messages.

type attachmentStateJSON struct {
	UID               string `json:"uid"`
	FinalizeAttempted bool   `json:"finalize_attempted"`
	Metadata          []byte `json:"metadata"`
}

func encodeAttachmentState(s attachmentUploadState) ([]byte, error) {
	var md []byte
	if s.metadata != nil {
		var err error
		md, err = proto.Marshal(s.metadata)
		if err != nil {
			return nil, err
		}
	}
	return json.Marshal(attachmentStateJSON{UID: s.uid, FinalizeAttempted: s.finalizeAttempted, Metadata: md})
}

func decodeAttachmentState(b []byte) (attachmentUploadState, error) {
	var v attachmentStateJSON
	if err := json.Unmarshal(b, &v); err != nil {
		return attachmentUploadState{}, err
	}
	md := &apipb.Attachment{}
	if len(v.Metadata) > 0 {
		if err := proto.Unmarshal(v.Metadata, md); err != nil {
			return attachmentUploadState{}, err
		}
	}
	return attachmentUploadState{metadata: md, uid: v.UID, finalizeAttempted: v.FinalizeAttempted}, nil
}

type memoImportStateJSON struct {
	Report []byte `json:"report"`
}

func encodeMemoImportState(s memoImportState) ([]byte, error) {
	var rep []byte
	if s.report != nil {
		var err error
		rep, err = proto.Marshal(s.report)
		if err != nil {
			return nil, err
		}
	}
	return json.Marshal(memoImportStateJSON{Report: rep})
}

func decodeMemoImportState(b []byte) (memoImportState, error) {
	var v memoImportStateJSON
	if err := json.Unmarshal(b, &v); err != nil {
		return memoImportState{}, err
	}
	var rep *apipb.ImportMemosReport
	if len(v.Report) > 0 {
		rep = &apipb.ImportMemosReport{}
		if err := proto.Unmarshal(v.Report, rep); err != nil {
			return memoImportState{}, err
		}
	}
	return memoImportState{report: rep}, nil
}
