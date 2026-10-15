package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/pquerna/otp/totp"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/clientip"
	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const (
	// totpPendingLoginTTL is how long a sealed pending-login token stays valid.
	totpPendingLoginTTL = 5 * time.Minute
	// totpBackupCodeCount is the number of backup codes issued on enrollment.
	totpBackupCodeCount = 10
)

// totpPendingLogin is the sealed payload carried between SignIn (password OK,
// TOTP still required) and VerifyTOTPLogin. Stateless so it survives
// serverless cold starts; integrity and expiry are enforced by HMAC.
type totpPendingLogin struct {
	UserID int32 `json:"uid"`
	Exp    int64 `json:"exp"`
}

func totpKeyedHash(key []byte, message []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(message)
	return mac.Sum(nil)
}

func (s *APIService) totpPendingKey() []byte {
	sum := sha256.Sum256([]byte("memos-totp-pending-v1:" + s.Secret))
	return sum[:]
}

func (s *APIService) totpSecretEncryptionKey() []byte {
	sum := sha256.Sum256([]byte("memos-totp-secret-encryption-v1:" + s.Secret))
	return sum[:]
}

// sealTOTPLogin seals a pending-login token for the user.
func (s *APIService) sealTOTPLogin(userID int32) (string, error) {
	payload, err := json.Marshal(totpPendingLogin{
		UserID: userID,
		Exp:    time.Now().Add(totpPendingLoginTTL).Unix(),
	})
	if err != nil {
		return "", errors.Wrap(err, "failed to marshal pending login")
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	sig := base64.RawURLEncoding.EncodeToString(totpKeyedHash(s.totpPendingKey(), []byte(encoded)))
	return encoded + "." + sig, nil
}

// openTOTPLogin verifies a pending-login token and returns the user ID.
func (s *APIService) openTOTPLogin(token string) (int32, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return 0, errors.New("invalid pending token format")
	}
	expected := totpKeyedHash(s.totpPendingKey(), []byte(parts[0]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, errors.Wrap(err, "invalid pending token signature")
	}
	if !hmac.Equal(expected, sig) {
		return 0, errors.New("invalid pending token signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, errors.Wrap(err, "invalid pending token payload")
	}
	var pending totpPendingLogin
	if err := json.Unmarshal(payload, &pending); err != nil {
		return 0, errors.Wrap(err, "invalid pending token payload")
	}
	if time.Now().Unix() > pending.Exp {
		return 0, errors.New("pending token expired")
	}
	if pending.UserID == 0 {
		return 0, errors.New("invalid pending token user")
	}
	return pending.UserID, nil
}

// encryptTOTPSecret encrypts a base32 TOTP secret with AES-GCM.
func (s *APIService) encryptTOTPSecret(plaintext string) ([]byte, error) {
	block, err := aes.NewCipher(s.totpSecretEncryptionKey())
	if err != nil {
		return nil, errors.Wrap(err, "failed to create cipher")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create GCM")
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, errors.Wrap(err, "failed to generate nonce")
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

// decryptTOTPSecret decrypts a base32 TOTP secret encrypted by encryptTOTPSecret.
func (s *APIService) decryptTOTPSecret(ciphertext []byte) (string, error) {
	block, err := aes.NewCipher(s.totpSecretEncryptionKey())
	if err != nil {
		return "", errors.Wrap(err, "failed to create cipher")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", errors.Wrap(err, "failed to create GCM")
	}
	if len(ciphertext) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, sealed := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", errors.Wrap(err, "failed to decrypt TOTP secret")
	}
	return string(plaintext), nil
}

// getUserTOTPSetting returns the TOTP setting for the user, or nil when TOTP
// is not enabled.
func (s *APIService) getUserTOTPSetting(ctx context.Context, userID int32) (*storepb.TotpUserSetting, error) {
	setting, err := s.Store.GetUserSetting(ctx, &store.FindUserSetting{
		UserID: &userID,
		Key:    storepb.UserSetting_TOTP,
	})
	if err != nil {
		return nil, err
	}
	if setting == nil {
		return nil, nil
	}
	return setting.GetTotp(), nil
}

func hashBackupCode(code string) string {
	sum := sha256.Sum256([]byte("memos-totp-backup-v1:" + code))
	return hex.EncodeToString(sum[:])
}

// generateBackupCodes generates human-typable backup codes (xxxx-xxxx).
func generateBackupCodes() ([]string, error) {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	codes := make([]string, 0, totpBackupCodeCount)
	for len(codes) < totpBackupCodeCount {
		buf := make([]byte, 8)
		if _, err := rand.Read(buf); err != nil {
			return nil, errors.Wrap(err, "failed to generate backup code")
		}
		var sb strings.Builder
		for i, b := range buf {
			if i == 4 {
				sb.WriteByte('-')
			}
			sb.WriteByte(alphabet[int(b)%len(alphabet)])
		}
		codes = append(codes, sb.String())
	}
	return codes, nil
}

// BeginTOTPSetup starts TOTP enrollment for the current user.
// Returns the otpauth URL (render as QR code) and the raw secret for manual entry.
func (s *APIService) BeginTOTPSetup(ctx context.Context, _ *apipb.BeginTOTPSetupRequest) (*apipb.BeginTOTPSetupResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "not authenticated")
	}
	if existing, err := s.getUserTOTPSetting(ctx, user.ID); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get TOTP setting: %v", err)
	} else if existing != nil {
		return nil, status.Errorf(codes.AlreadyExists, "TOTP is already enabled; disable it first")
	}

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "memos",
		AccountName: user.Username,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to generate TOTP secret: %v", err)
	}
	return &apipb.BeginTOTPSetupResponse{
		OtpauthUrl: key.URL(),
		Secret:     key.Secret(),
	}, nil
}

// ConfirmTOTPSetup verifies the code against the new secret and enables TOTP.
// Returns single-use backup codes, shown only once.
func (s *APIService) ConfirmTOTPSetup(ctx context.Context, request *apipb.ConfirmTOTPSetupRequest) (*apipb.ConfirmTOTPSetupResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "not authenticated")
	}
	secret := strings.ToUpper(strings.ReplaceAll(request.GetSecret(), " ", ""))
	if secret == "" || request.GetCode() == "" {
		return nil, status.Errorf(codes.InvalidArgument, "secret and code are required")
	}
	if !totp.Validate(request.GetCode(), secret) {
		return nil, status.Errorf(codes.InvalidArgument, "invalid TOTP code")
	}

	encrypted, err := s.encryptTOTPSecret(secret)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to encrypt TOTP secret: %v", err)
	}
	backupCodes, err := generateBackupCodes()
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to generate backup codes: %v", err)
	}
	hashes := make([]string, 0, len(backupCodes))
	for _, code := range backupCodes {
		hashes = append(hashes, hashBackupCode(code))
	}
	if _, err := s.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: user.ID,
		Key:    storepb.UserSetting_TOTP,
		Value: &storepb.UserSetting_Totp{
			Totp: &storepb.TotpUserSetting{
				EncryptedSecret:   encrypted,
				BackupCodeHashes: hashes,
			},
		},
	}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store TOTP setting: %v", err)
	}
	return &apipb.ConfirmTOTPSetupResponse{BackupCodes: backupCodes}, nil
}

// DisableTOTP disables TOTP for the current user after verifying a current
// TOTP code or an unused backup code.
func (s *APIService) DisableTOTP(ctx context.Context, request *apipb.DisableTOTPRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "not authenticated")
	}
	totpSetting, err := s.getUserTOTPSetting(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get TOTP setting: %v", err)
	}
	if totpSetting == nil {
		return nil, status.Errorf(codes.NotFound, "TOTP is not enabled")
	}
	if !s.verifyTOTPCode(totpSetting, request.GetCode()) {
		return nil, status.Errorf(codes.InvalidArgument, "invalid TOTP code")
	}
	if err := s.Store.DeleteUserSettings(ctx, &store.DeleteUserSetting{
		UserID: &user.ID,
		Key:    storepb.UserSetting_TOTP,
	}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to disable TOTP: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// GetTOTPStatus returns whether TOTP is enabled for the current user.
func (s *APIService) GetTOTPStatus(ctx context.Context, _ *apipb.GetTOTPStatusRequest) (*apipb.GetTOTPStatusResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "not authenticated")
	}
	totpSetting, err := s.getUserTOTPSetting(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get TOTP setting: %v", err)
	}
	return &apipb.GetTOTPStatusResponse{Enabled: totpSetting != nil}, nil
}

// verifyTOTPCode checks a code against the TOTP secret without consuming anything.
func (s *APIService) verifyTOTPCode(totpSetting *storepb.TotpUserSetting, code string) bool {
	if code == "" || totpSetting == nil {
		return false
	}
	secret, err := s.decryptTOTPSecret(totpSetting.GetEncryptedSecret())
	if err != nil {
		return false
	}
	if totp.Validate(code, secret) {
		return true
	}
	return hashBackupCodeInList(totpSetting.GetBackupCodeHashes(), code)
}

func hashBackupCodeInList(hashes []string, code string) bool {
	want := hashBackupCode(code)
	for _, h := range hashes {
		if hmac.Equal([]byte(h), []byte(want)) {
			return true
		}
	}
	return false
}

// consumeBackupCode removes a matching backup code hash and persists the change.
// Returns true when a backup code was consumed.
func (s *APIService) consumeBackupCode(ctx context.Context, userID int32, totpSetting *storepb.TotpUserSetting, code string) (bool, error) {
	want := hashBackupCode(code)
	remaining := make([]string, 0, len(totpSetting.GetBackupCodeHashes()))
	found := false
	for _, h := range totpSetting.GetBackupCodeHashes() {
		if !found && hmac.Equal([]byte(h), []byte(want)) {
			found = true
			continue
		}
		remaining = append(remaining, h)
	}
	if !found {
		return false, nil
	}
	totpSetting.BackupCodeHashes = remaining
	if _, err := s.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: userID,
		Key:    storepb.UserSetting_TOTP,
		Value: &storepb.UserSetting_Totp{
			Totp: totpSetting,
		},
	}); err != nil {
		return false, err
	}
	return true, nil
}

// VerifyTOTPLogin completes a password login that required TOTP.
// Accepts a current TOTP code or an unused backup code (single-use).
func (s *APIService) VerifyTOTPLogin(ctx context.Context, request *apipb.VerifyTOTPLoginRequest) (*apipb.SignInResponse, error) {
	userID, err := s.openTOTPLogin(request.GetPendingToken())
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid or expired login session")
	}
	user, err := s.Store.GetUser(ctx, &store.FindUser{ID: &userID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}
	if user == nil || user.RowStatus == store.Archived {
		return nil, status.Errorf(codes.InvalidArgument, "invalid or expired login session")
	}

	clientIP := clientip.FromContext(ctx)
	attempt, err := s.reserveSignIn(clientIP, user.Username)
	if err != nil {
		return nil, err
	}

	totpSetting, err := s.getUserTOTPSetting(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get TOTP setting: %v", err)
	}
	if totpSetting == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "TOTP is not enabled for this user")
	}

	code := strings.ReplaceAll(request.GetCode(), " ", "")
	secret, err := s.decryptTOTPSecret(totpSetting.GetEncryptedSecret())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to decrypt TOTP secret: %v", err)
	}
	if totp.Validate(code, secret) {
		attempt.succeeded()
	} else if consumed, err := s.consumeBackupCode(ctx, user.ID, totpSetting, code); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to verify backup code: %v", err)
	} else if consumed {
		attempt.succeeded()
	} else {
		return nil, status.Errorf(codes.InvalidArgument, "invalid TOTP code")
	}

	accessToken, accessExpiresAt, err := s.doSignIn(ctx, user)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to sign in: %v", err)
	}
	return &apipb.SignInResponse{
		User:                  convertUserFromStore(user, user),
		AccessToken:           accessToken,
		AccessTokenExpireTime: timestamppb.New(accessExpiresAt),
	}, nil
}
