package api

import (
	"strings"
	"testing"

	"github.com/pquerna/otp/totp"
)

func testTOTPSvc() *APIService {
	return &APIService{Secret: "test-server-secret"}
}

func TestSealOpenTOTPLogin(t *testing.T) {
	s := testTOTPSvc()
	token, err := s.sealTOTPLogin(42)
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	uid, err := s.openTOTPLogin(token)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	if uid != 42 {
		t.Fatalf("expected user 42, got %d", uid)
	}
}

func TestOpenTOTPLoginTampered(t *testing.T) {
	s := testTOTPSvc()
	token, err := s.sealTOTPLogin(42)
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	// Tamper with the payload part.
	parts := strings.Split(token, ".")
	tampered := "AAAA." + parts[1]
	if _, err := s.openTOTPLogin(tampered); err == nil {
		t.Fatal("expected error for tampered token")
	}
	// Wrong format.
	if _, err := s.openTOTPLogin("not-a-token"); err == nil {
		t.Fatal("expected error for malformed token")
	}
	// Token sealed with a different server secret.
	other := &APIService{Secret: "other-secret"}
	otherToken, err := other.sealTOTPLogin(42)
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	if _, err := s.openTOTPLogin(otherToken); err == nil {
		t.Fatal("expected error for cross-secret token")
	}
}

func TestEncryptDecryptTOTPSecret(t *testing.T) {
	s := testTOTPSvc()
	key, err := totp.Generate(totp.GenerateOpts{Issuer: "memos", AccountName: "alice"})
	if err != nil {
		t.Fatalf("generate failed: %v", err)
	}
	encrypted, err := s.encryptTOTPSecret(key.Secret())
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	if strings.Contains(string(encrypted), key.Secret()) {
		t.Fatal("ciphertext contains plaintext secret")
	}
	decrypted, err := s.decryptTOTPSecret(encrypted)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if decrypted != key.Secret() {
		t.Fatal("decrypted secret does not match")
	}
	// Cross-secret decryption must fail.
	other := &APIService{Secret: "other-secret"}
	if _, err := other.decryptTOTPSecret(encrypted); err == nil {
		t.Fatal("expected decryption failure with wrong secret")
	}
}

func TestGenerateBackupCodes(t *testing.T) {
	codes, err := generateBackupCodes()
	if err != nil {
		t.Fatalf("generate failed: %v", err)
	}
	if len(codes) != totpBackupCodeCount {
		t.Fatalf("expected %d codes, got %d", totpBackupCodeCount, len(codes))
	}
	seen := map[string]struct{}{}
	for _, c := range codes {
		if len(c) != 9 || c[4] != '-' {
			t.Fatalf("unexpected code format: %q", c)
		}
		if _, dup := seen[c]; dup {
			t.Fatalf("duplicate code: %q", c)
		}
		seen[c] = struct{}{}
		// Hash must be deterministic and verifiable.
		h1, h2 := hashBackupCode(c), hashBackupCode(c)
		if h1 != h2 {
			t.Fatal("backup code hash not deterministic")
		}
	}
}
