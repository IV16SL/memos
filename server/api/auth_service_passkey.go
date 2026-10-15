package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/pkg/errors"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/clientip"
	"github.com/usememos/memos/internal/random"
	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const (
	// webAuthnSessionTTL is how long a sealed WebAuthn session token stays valid.
	webAuthnSessionTTL = 5 * time.Minute
)

const (
	webAuthnSessionPurposeRegister = "register"
	webAuthnSessionPurposeLogin    = "login"
	webAuthnSessionPurposeSignup  = "signup"
)

// sealedWebAuthnSession is the HMAC-sealed envelope carried between the begin
// and finish steps of a WebAuthn ceremony. Stateless so it survives serverless
// cold starts; the client cannot read or tamper with it.
type sealedWebAuthnSession struct {
	Purpose  string          `json:"purpose"`
	UserID   int32           `json:"uid,omitempty"`
	Username string          `json:"username,omitempty"`
	Session  json.RawMessage `json:"session"`
	Exp      int64           `json:"exp"`
}

func (s *APIService) webAuthnSealKey() []byte {
	sum := sha256.Sum256([]byte("memos-webauthn-seal-v1:" + s.Secret))
	return sum[:]
}

func (s *APIService) sealWebAuthnSession(purpose string, userID int32, username string, session *webauthn.SessionData) (string, error) {
	sessionJSON, err := json.Marshal(session)
	if err != nil {
		return "", errors.Wrap(err, "failed to marshal WebAuthn session")
	}
	payload, err := json.Marshal(sealedWebAuthnSession{
		Purpose:  purpose,
		UserID:   userID,
		Username: username,
		Session:  sessionJSON,
		Exp:      time.Now().Add(webAuthnSessionTTL).Unix(),
	})
	if err != nil {
		return "", errors.Wrap(err, "failed to marshal sealed session")
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	sig := base64.RawURLEncoding.EncodeToString(totpKeyedHash(s.webAuthnSealKey(), []byte(encoded)))
	return encoded + "." + sig, nil
}

func (s *APIService) openWebAuthnSession(token, purpose string) (*sealedWebAuthnSession, *webauthn.SessionData, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, nil, errors.New("invalid session token format")
	}
	expected := totpKeyedHash(s.webAuthnSealKey(), []byte(parts[0]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, nil, errors.Wrap(err, "invalid session token signature")
	}
	if !hmacEqual(expected, sig) {
		return nil, nil, errors.New("invalid session token signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, nil, errors.Wrap(err, "invalid session token payload")
	}
	var sealed sealedWebAuthnSession
	if err := json.Unmarshal(payload, &sealed); err != nil {
		return nil, nil, errors.Wrap(err, "invalid session token payload")
	}
	if sealed.Purpose != purpose {
		return nil, nil, errors.New("session token purpose mismatch")
	}
	if time.Now().Unix() > sealed.Exp {
		return nil, nil, errors.New("session token expired")
	}
	var session webauthn.SessionData
	if err := json.Unmarshal(sealed.Session, &session); err != nil {
		return nil, nil, errors.Wrap(err, "invalid WebAuthn session")
	}
	return &sealed, &session, nil
}

func hmacEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := range a {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}

// passkeyRPConfig derives the WebAuthn relying-party config from the
// instance's canonical URL, falling back to the request authority.
func (s *APIService) passkeyRPConfig(ctx context.Context) (rpID string, origins []string, err error) {
	if instanceURL := strings.TrimSpace(s.Profile.InstanceURL); instanceURL != "" {
		if u, parseErr := url.Parse(instanceURL); parseErr == nil && u.Host != "" {
			rpID = u.Hostname()
			origins = []string{u.Scheme + "://" + u.Host}
			return rpID, origins, nil
		}
	}
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		if authorities := md.Get(":authority"); len(authorities) > 0 {
			host := authorities[0]
			if h, _, splitErr := net.SplitHostPort(host); splitErr == nil {
				host = h
			}
			if host != "" {
				return host, []string{"https://" + host, "http://" + host}, nil
			}
		}
	}
	return "", nil, errors.New("cannot determine relying party ID: instance URL is not configured")
}

func (s *APIService) newPasskeyWebAuthn(ctx context.Context) (*webauthn.WebAuthn, error) {
	rpID, origins, err := s.passkeyRPConfig(ctx)
	if err != nil {
		return nil, err
	}
	w, err := webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: "Memos",
		RPOrigins:     origins,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to create WebAuthn")
	}
	return w, nil
}

// passkeyUser implements webauthn.User. The WebAuthnID is the 4-byte
// big-endian user ID, stable across ceremonies.
type passkeyUser struct {
	user        *store.User
	credentials []webauthn.Credential
}

func encodePasskeyUserID(userID int32) []byte {
	buf := make([]byte, 4)
	binary.BigEndian.PutUint32(buf, uint32(userID))
	return buf
}

func decodePasskeyUserID(raw []byte) (int32, error) {
	if len(raw) != 4 {
		return 0, errors.New("invalid user handle length")
	}
	return int32(binary.BigEndian.Uint32(raw)), nil
}

func (u *passkeyUser) WebAuthnID() []byte                         { return encodePasskeyUserID(u.user.ID) }
func (u *passkeyUser) WebAuthnName() string                       { return u.user.Username }
func (u *passkeyUser) WebAuthnDisplayName() string                { return u.user.Nickname }
func (u *passkeyUser) WebAuthnCredentials() []webauthn.Credential  { return u.credentials }

func passkeyCredentialToWebAuthn(c *storepb.PasskeyCredential) webauthn.Credential {
	transports := make([]protocol.AuthenticatorTransport, 0, len(c.GetTransports()))
	for _, t := range c.GetTransports() {
		transports = append(transports, protocol.AuthenticatorTransport(t))
	}
	return webauthn.Credential{
		ID:        c.GetCredentialId(),
		PublicKey: c.GetPublicKey(),
		Transport: transports,
		Flags: webauthn.CredentialFlags{
			BackupEligible: c.GetBackupEligible(),
			BackupState:    c.GetBackedUp(),
		},
		Authenticator: webauthn.Authenticator{
			SignCount: c.GetSignCount(),
		},
	}
}

func (s *APIService) getUserPasskeys(ctx context.Context, userID int32) (*storepb.PasskeysUserSetting, error) {
	setting, err := s.Store.GetUserSetting(ctx, &store.FindUserSetting{
		UserID: &userID,
		Key:    storepb.UserSetting_PASSKEYS,
	})
	if err != nil {
		return nil, err
	}
	if setting == nil || setting.GetPasskeys() == nil {
		return &storepb.PasskeysUserSetting{}, nil
	}
	return setting.GetPasskeys(), nil
}

func (s *APIService) upsertUserPasskeys(ctx context.Context, userID int32, passkeys *storepb.PasskeysUserSetting) error {
	_, err := s.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: userID,
		Key:    storepb.UserSetting_PASSKEYS,
		Value: &storepb.UserSetting_Passkeys{
			Passkeys: passkeys,
		},
	})
	return err
}

func (s *APIService) newPasskeyUser(ctx context.Context, user *store.User) (*passkeyUser, error) {
	passkeys, err := s.getUserPasskeys(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	credentials := make([]webauthn.Credential, 0, len(passkeys.GetCredentials()))
	for _, c := range passkeys.GetCredentials() {
		credentials = append(credentials, passkeyCredentialToWebAuthn(c))
	}
	nickname := user.Nickname
	if nickname == "" {
		nickname = user.Username
	}
	return &passkeyUser{
		user: &store.User{
			ID:       user.ID,
			Username: user.Username,
			Nickname: nickname,
		},
		credentials: credentials,
	}, nil
}

func passkeyResourceName(credentialID []byte) string {
	return "passkeys/" + base64.RawURLEncoding.EncodeToString(credentialID)
}

func parsePasskeyResourceName(name string) ([]byte, error) {
	id, ok := strings.CutPrefix(name, "passkeys/")
	if !ok || id == "" {
		return nil, errors.Errorf("invalid passkey resource name %q", name)
	}
	raw, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return nil, errors.Wrap(err, "invalid passkey credential ID")
	}
	return raw, nil
}

func convertPasskeyCredential(c *storepb.PasskeyCredential) *apipb.Passkey {
	return &apipb.Passkey{
		Name:         passkeyResourceName(c.GetCredentialId()),
		DisplayName:  c.GetName(),
		Transports:   c.GetTransports(),
		CreateTime:   c.GetCreatedAt(),
		LastUsedTime: c.GetLastUsedAt(),
	}
}

// BeginPasskeyRegistration starts a WebAuthn registration ceremony for the
// current user, adding a passkey to an existing account.
func (s *APIService) BeginPasskeyRegistration(ctx context.Context, _ *apipb.BeginPasskeyRegistrationRequest) (*apipb.BeginPasskeyRegistrationResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "not authenticated")
	}
	w, err := s.newPasskeyWebAuthn(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to configure WebAuthn: %v", err)
	}
	pkUser, err := s.newPasskeyUser(ctx, user)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load passkeys: %v", err)
	}
	creation, session, err := w.BeginRegistration(pkUser,
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationPreferred,
		}),
		webauthn.WithExclusions(pkUserCredentialsToDescriptors(pkUser.credentials)),
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to begin registration: %v", err)
	}
	optionsJSON, err := json.Marshal(creation)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to marshal options: %v", err)
	}
	sessionToken, err := s.sealWebAuthnSession(webAuthnSessionPurposeRegister, user.ID, "", session)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to seal session: %v", err)
	}
	return &apipb.BeginPasskeyRegistrationResponse{
		OptionsJson:  string(optionsJSON),
		SessionToken: sessionToken,
	}, nil
}

func pkUserCredentialsToDescriptors(credentials []webauthn.Credential) []protocol.CredentialDescriptor {
	descriptors := make([]protocol.CredentialDescriptor, 0, len(credentials))
	for _, c := range credentials {
		descriptors = append(descriptors, c.Descriptor())
	}
	return descriptors
}

// FinishPasskeyRegistration completes the ceremony and stores the credential.
func (s *APIService) FinishPasskeyRegistration(ctx context.Context, request *apipb.FinishPasskeyRegistrationRequest) (*apipb.FinishPasskeyRegistrationResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "not authenticated")
	}
	sealed, session, err := s.openWebAuthnSession(request.GetSessionToken(), webAuthnSessionPurposeRegister)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid or expired session: %v", err)
	}
	if sealed.UserID != user.ID {
		return nil, status.Errorf(codes.PermissionDenied, "session does not belong to the current user")
	}
	w, err := s.newPasskeyWebAuthn(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to configure WebAuthn: %v", err)
	}
	pkUser, err := s.newPasskeyUser(ctx, user)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load passkeys: %v", err)
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes([]byte(request.GetCredentialJson()))
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid credential response: %v", err)
	}
	credential, err := w.CreateCredential(pkUser, *session, parsed)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to verify credential: %v", err)
	}

	passkeys, err := s.getUserPasskeys(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load passkeys: %v", err)
	}
	for _, c := range passkeys.GetCredentials() {
		if string(c.GetCredentialId()) == string(credential.ID) {
			return nil, status.Errorf(codes.AlreadyExists, "this passkey is already registered")
		}
	}
	name := strings.TrimSpace(request.GetName())
	if name == "" {
		name = "Passkey"
	}
	transports := make([]string, 0, len(credential.Transport))
	for _, t := range credential.Transport {
		transports = append(transports, string(t))
	}
	stored := &storepb.PasskeyCredential{
		CredentialId:   credential.ID,
		PublicKey:      credential.PublicKey,
		SignCount:      credential.Authenticator.SignCount,
		Name:           name,
		Transports:     transports,
		BackupEligible: credential.Flags.BackupEligible,
		BackedUp:       credential.Flags.BackupState,
		CreatedAt:      timestamppb.Now(),
	}
	passkeys.Credentials = append(passkeys.GetCredentials(), stored)
	if err := s.upsertUserPasskeys(ctx, user.ID, passkeys); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store passkey: %v", err)
	}
	return &apipb.FinishPasskeyRegistrationResponse{
		Passkey: convertPasskeyCredential(stored),
	}, nil
}

// ListPasskeys lists the current user's registered passkeys.
func (s *APIService) ListPasskeys(ctx context.Context, _ *apipb.ListPasskeysRequest) (*apipb.ListPasskeysResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "not authenticated")
	}
	passkeys, err := s.getUserPasskeys(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load passkeys: %v", err)
	}
	resp := &apipb.ListPasskeysResponse{}
	for _, c := range passkeys.GetCredentials() {
		resp.Passkeys = append(resp.Passkeys, convertPasskeyCredential(c))
	}
	return resp, nil
}

// DeletePasskey deletes one of the current user's passkeys.
func (s *APIService) DeletePasskey(ctx context.Context, request *apipb.DeletePasskeyRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "not authenticated")
	}
	credentialID, err := parsePasskeyResourceName(request.GetName())
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}
	passkeys, err := s.getUserPasskeys(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load passkeys: %v", err)
	}
	remaining := make([]*storepb.PasskeyCredential, 0, len(passkeys.GetCredentials()))
	found := false
	for _, c := range passkeys.GetCredentials() {
		if string(c.GetCredentialId()) == string(credentialID) {
			found = true
			continue
		}
		remaining = append(remaining, c)
	}
	if !found {
		return nil, status.Errorf(codes.NotFound, "passkey not found")
	}
	passkeys.Credentials = remaining
	if err := s.upsertUserPasskeys(ctx, user.ID, passkeys); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete passkey: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// RenamePasskey changes the label of one of the current user's passkeys.
func (s *APIService) RenamePasskey(ctx context.Context, request *apipb.RenamePasskeyRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "not authenticated")
	}
	credentialID, err := parsePasskeyResourceName(request.GetName())
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}
	name := strings.TrimSpace(request.GetDisplayName())
	if name == "" {
		return nil, status.Errorf(codes.InvalidArgument, "display name is required")
	}
	passkeys, err := s.getUserPasskeys(ctx, user.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load passkeys: %v", err)
	}
	found := false
	for _, c := range passkeys.GetCredentials() {
		if string(c.GetCredentialId()) == string(credentialID) {
			c.Name = name
			found = true
			break
		}
	}
	if !found {
		return nil, status.Errorf(codes.NotFound, "passkey not found")
	}
	if err := s.upsertUserPasskeys(ctx, user.ID, passkeys); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to rename passkey: %v", err)
	}
	return &emptypb.Empty{}, nil
}

// BeginPasskeyLogin starts a usernameless WebAuthn login ceremony.
func (s *APIService) BeginPasskeyLogin(ctx context.Context, _ *apipb.BeginPasskeyLoginRequest) (*apipb.BeginPasskeyLoginResponse, error) {
	clientIP := clientip.FromContext(ctx)
	attempt, err := s.reserveSignIn(clientIP, "")
	if err != nil {
		return nil, err
	}
	defer attempt.succeeded() // Beginning a ceremony is not a guess.

	w, err := s.newPasskeyWebAuthn(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to configure WebAuthn: %v", err)
	}
	assertion, session, err := w.BeginDiscoverableLogin(
		webauthn.WithUserVerification(protocol.VerificationPreferred),
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to begin login: %v", err)
	}
	optionsJSON, err := json.Marshal(assertion)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to marshal options: %v", err)
	}
	sessionToken, err := s.sealWebAuthnSession(webAuthnSessionPurposeLogin, 0, "", session)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to seal session: %v", err)
	}
	return &apipb.BeginPasskeyLoginResponse{
		OptionsJson:  string(optionsJSON),
		SessionToken: sessionToken,
	}, nil
}

// FinishPasskeyLogin completes the ceremony and signs the user in.
// A passkey is phishing-resistant MFA by itself, so no TOTP step follows.
func (s *APIService) FinishPasskeyLogin(ctx context.Context, request *apipb.FinishPasskeyLoginRequest) (*apipb.SignInResponse, error) {
	_, session, err := s.openWebAuthnSession(request.GetSessionToken(), webAuthnSessionPurposeLogin)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid or expired session: %v", err)
	}
	w, err := s.newPasskeyWebAuthn(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to configure WebAuthn: %v", err)
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes([]byte(request.GetCredentialJson()))
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid credential response: %v", err)
	}

	handler := func(rawID, userHandle []byte) (webauthn.User, error) {
		userID, err := decodePasskeyUserID(userHandle)
		if err != nil {
			return nil, err
		}
		user, err := s.Store.GetUser(ctx, &store.FindUser{ID: &userID})
		if err != nil {
			return nil, err
		}
		if user == nil || user.RowStatus == store.Archived {
			return nil, errors.New("user not found")
		}
		pkUser, err := s.newPasskeyUser(ctx, user)
		if err != nil {
			return nil, err
		}
		for _, c := range pkUser.credentials {
			if string(c.ID) == string(rawID) {
				pkUser.credentials = []webauthn.Credential{c}
				return pkUser, nil
			}
		}
		return nil, errors.New("credential not found")
	}

	clientIP := clientip.FromContext(ctx)
	// Reserve before the lookup so unknown handles still cost the attacker.
	preAttempt, err := s.reserveSignIn(clientIP, "")
	if err != nil {
		return nil, err
	}

	validatedUser, validatedCredential, err := w.ValidatePasskeyLogin(handler, *session, parsed)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "passkey verification failed")
	}
	preAttempt.succeeded()
	pkUser, ok := validatedUser.(*passkeyUser)
	if !ok {
		return nil, status.Errorf(codes.Internal, "unexpected user type")
	}
	user, err := s.Store.GetUser(ctx, &store.FindUser{ID: &pkUser.user.ID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}
	if user == nil || user.RowStatus == store.Archived {
		return nil, status.Errorf(codes.PermissionDenied, "user is not active")
	}

	// Per-account rate limiting now that the account is known.
	attempt, err := s.reserveSignIn(clientIP, user.Username)
	if err != nil {
		return nil, err
	}
	attempt.succeeded()

	if err := s.touchPasskeyLogin(ctx, user.ID, validatedCredential); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update passkey: %v", err)
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

// touchPasskeyLogin persists the updated signature counter and last-used time.
func (s *APIService) touchPasskeyLogin(ctx context.Context, userID int32, credential *webauthn.Credential) error {
	passkeys, err := s.getUserPasskeys(ctx, userID)
	if err != nil {
		return err
	}
	for _, c := range passkeys.GetCredentials() {
		if string(c.GetCredentialId()) == string(credential.ID) {
			c.SignCount = credential.Authenticator.SignCount
			c.BackedUp = credential.Flags.BackupState
			c.LastUsedAt = timestamppb.Now()
			break
		}
	}
	return s.upsertUserPasskeys(ctx, userID, passkeys)
}

// BeginPasskeySignup starts a "sign up with passkey" ceremony, provisioning a
// new local user like first-time SSO login does. Refused when the instance
// disallows user registration.
func (s *APIService) BeginPasskeySignup(ctx context.Context, request *apipb.BeginPasskeySignupRequest) (*apipb.BeginPasskeySignupResponse, error) {
	username := strings.TrimSpace(request.GetUsername())
	if err := validateWritableUsername(username); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid username: %v", err)
	}
	clientIP := clientip.FromContext(ctx)
	attempt, err := s.reserveSignIn(clientIP, "")
	if err != nil {
		return nil, err
	}
	defer attempt.succeeded() // Beginning a ceremony is not a guess.

	instanceGeneralSetting, err := s.Store.GetInstanceGeneralSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get instance general setting: %v", err)
	}
	if instanceGeneralSetting.DisallowUserRegistration {
		return nil, status.Errorf(codes.PermissionDenied, "user registration is not allowed")
	}
	existing, err := s.Store.GetUser(ctx, &store.FindUser{Username: &username})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check username: %v", err)
	}
	if existing != nil {
		return nil, status.Errorf(codes.AlreadyExists, "username is already taken")
	}

	// Provision the user now so the ceremony has a stable user handle, mirroring
	// SSO provisioning. The random password is unusable; the passkey is the credential.
	password, err := random.String(20)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to generate password: %v", err)
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to hash password: %v", err)
	}
	user, err := s.Store.CreateUser(ctx, &store.User{
		Username:     username,
		Nickname:     username,
		Role:         store.RoleUser,
		PasswordHash: string(passwordHash),
	})
	if err != nil {
		if errors.Is(err, store.ErrUsernameTaken) {
			return nil, status.Errorf(codes.AlreadyExists, "username is already taken")
		}
		return nil, status.Errorf(codes.Internal, "failed to create user: %v", err)
	}

	w, err := s.newPasskeyWebAuthn(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to configure WebAuthn: %v", err)
	}
	pkUser, err := s.newPasskeyUser(ctx, user)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load passkeys: %v", err)
	}
	creation, session, err := w.BeginRegistration(pkUser,
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationPreferred,
		}),
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to begin registration: %v", err)
	}
	optionsJSON, err := json.Marshal(creation)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to marshal options: %v", err)
	}
	sessionToken, err := s.sealWebAuthnSession(webAuthnSessionPurposeSignup, user.ID, username, session)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to seal session: %v", err)
	}
	return &apipb.BeginPasskeySignupResponse{
		OptionsJson:  string(optionsJSON),
		SessionToken: sessionToken,
	}, nil
}

// FinishPasskeySignup completes the ceremony, stores the credential, and signs
// the new user in.
func (s *APIService) FinishPasskeySignup(ctx context.Context, request *apipb.FinishPasskeySignupRequest) (*apipb.SignInResponse, error) {
	sealed, session, err := s.openWebAuthnSession(request.GetSessionToken(), webAuthnSessionPurposeSignup)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid or expired session: %v", err)
	}
	clientIP := clientip.FromContext(ctx)
	attempt, err := s.reserveSignIn(clientIP, sealed.Username)
	if err != nil {
		return nil, err
	}
	defer attempt.succeeded()

	user, err := s.Store.GetUser(ctx, &store.FindUser{ID: &sealed.UserID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user: %v", err)
	}
	if user == nil || user.RowStatus == store.Archived {
		return nil, status.Errorf(codes.InvalidArgument, "invalid or expired session")
	}
	w, err := s.newPasskeyWebAuthn(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to configure WebAuthn: %v", err)
	}
	pkUser, err := s.newPasskeyUser(ctx, user)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load passkeys: %v", err)
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes([]byte(request.GetCredentialJson()))
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid credential response: %v", err)
	}
	credential, err := w.CreateCredential(pkUser, *session, parsed)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to verify credential: %v", err)
	}

	transports := make([]string, 0, len(credential.Transport))
	for _, t := range credential.Transport {
		transports = append(transports, string(t))
	}
	passkeys := &storepb.PasskeysUserSetting{
		Credentials: []*storepb.PasskeyCredential{
			{
				CredentialId:   credential.ID,
				PublicKey:      credential.PublicKey,
				SignCount:      credential.Authenticator.SignCount,
				Name:           "Passkey",
				Transports:     transports,
				BackupEligible: credential.Flags.BackupEligible,
				BackedUp:       credential.Flags.BackupState,
				CreatedAt:      timestamppb.Now(),
			},
		},
	}
	if err := s.upsertUserPasskeys(ctx, user.ID, passkeys); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store passkey: %v", err)
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
