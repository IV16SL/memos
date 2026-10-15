package api

import (
	"encoding/json"
	"testing"

	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/usememos/memos/store"
)

func testPasskeySvc() *APIService {
	return &APIService{Secret: "test-server-secret"}
}

func TestSealOpenWebAuthnSession(t *testing.T) {
	s := testPasskeySvc()
	session := &webauthn.SessionData{
		Challenge: "test-challenge",
		UserID:    encodePasskeyUserID(7),
	}
	token, err := s.sealWebAuthnSession(webAuthnSessionPurposeLogin, 0, "", session)
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	sealed, opened, err := s.openWebAuthnSession(token, webAuthnSessionPurposeLogin)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	if sealed.Purpose != webAuthnSessionPurposeLogin {
		t.Fatalf("expected purpose login, got %q", sealed.Purpose)
	}
	if opened.Challenge != "test-challenge" {
		t.Fatalf("challenge did not round-trip: %q", opened.Challenge)
	}
	uid, err := decodePasskeyUserID(opened.UserID)
	if err != nil {
		t.Fatalf("decode user id failed: %v", err)
	}
	if uid != 7 {
		t.Fatalf("expected user 7, got %d", uid)
	}
}

func TestOpenWebAuthnSessionWrongPurpose(t *testing.T) {
	s := testPasskeySvc()
	token, err := s.sealWebAuthnSession(webAuthnSessionPurposeRegister, 42, "", &webauthn.SessionData{Challenge: "c"})
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	if _, _, err := s.openWebAuthnSession(token, webAuthnSessionPurposeLogin); err == nil {
		t.Fatal("expected error for purpose mismatch")
	}
	// Tampered token.
	if _, _, err := s.openWebAuthnSession(token+"x", webAuthnSessionPurposeRegister); err == nil {
		t.Fatal("expected error for tampered token")
	}
	// Cross-secret token.
	other := &APIService{Secret: "other-secret"}
	otherToken, err := other.sealWebAuthnSession(webAuthnSessionPurposeLogin, 0, "", &webauthn.SessionData{Challenge: "c"})
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	if _, _, err := s.openWebAuthnSession(otherToken, webAuthnSessionPurposeLogin); err == nil {
		t.Fatal("expected error for cross-secret token")
	}
}

func TestPasskeyResourceNameRoundTrip(t *testing.T) {
	raw := []byte{1, 2, 3, 250, 255}
	name := passkeyResourceName(raw)
	got, err := parsePasskeyResourceName(name)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if string(got) != string(raw) {
		t.Fatal("credential ID did not round-trip")
	}
	if _, err := parsePasskeyResourceName("bogus/name"); err == nil {
		t.Fatal("expected error for invalid resource name")
	}
	if _, err := parsePasskeyResourceName("passkeys/!!!"); err == nil {
		t.Fatal("expected error for invalid base64")
	}
}

func TestEncodeDecodePasskeyUserID(t *testing.T) {
	for _, id := range []int32{1, 42, 2147483647} {
		raw := encodePasskeyUserID(id)
		got, err := decodePasskeyUserID(raw)
		if err != nil {
			t.Fatalf("decode failed: %v", err)
		}
		if got != id {
			t.Fatalf("expected %d, got %d", id, got)
		}
	}
	if _, err := decodePasskeyUserID([]byte{1, 2, 3}); err == nil {
		t.Fatal("expected error for short user handle")
	}
}

// TestPasskeyOptionsShape guards the wire format that @simplewebauthn/browser
// expects: the marshaled options must be the flat
// PublicKeyCredentialCreationOptions / PublicKeyCredentialRequestOptions
// object (top-level challenge), NOT wrapped in {"publicKey": ...}.
// Marshaling protocol.CredentialCreation / protocol.CredentialAssertion
// directly nests everything under "publicKey", which makes simplewebauthn
// throw "Cannot read properties of undefined (reading 'replace')".
func TestPasskeyOptionsShape(t *testing.T) {
	w, err := webauthn.New(&webauthn.Config{
		RPID:          "example.com",
		RPDisplayName: "memos",
		RPOrigins:     []string{"https://example.com"},
	})
	if err != nil {
		t.Fatalf("webauthn.New: %v", err)
	}
	user := &passkeyUser{user: &store.User{ID: 1, Username: "alice"}, credentials: []webauthn.Credential{{ID: []byte{0x01}}}}

	creation, _, err := w.BeginRegistration(user)
	if err != nil {
		t.Fatalf("BeginRegistration: %v", err)
	}
	var regShape map[string]any
	if err := json.Unmarshal(mustMarshal(t, creation.Response), &regShape); err != nil {
		t.Fatalf("unmarshal registration options: %v", err)
	}
	assertTopLevelChallenge(t, regShape, "registration")

	assertion, _, err := w.BeginLogin(user)
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	var loginShape map[string]any
	if err := json.Unmarshal(mustMarshal(t, assertion.Response), &loginShape); err != nil {
		t.Fatalf("unmarshal login options: %v", err)
	}
	assertTopLevelChallenge(t, loginShape, "login")
}

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func assertTopLevelChallenge(t *testing.T, shape map[string]any, what string) {
	t.Helper()
	if _, ok := shape["challenge"]; !ok {
		t.Fatalf("%s options: missing top-level challenge", what)
	}
	if _, ok := shape["publicKey"]; ok {
		t.Fatalf("%s options: must not be wrapped in publicKey", what)
	}
}
