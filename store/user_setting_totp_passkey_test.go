package store

import (
	"testing"

	storepb "github.com/usememos/memos/proto/gen/store"
)

// TestUserSettingTOTPKeyRoundTrip ensures the TOTP user setting key survives
// the storepb -> raw -> storepb conversion used by the DB layer.
func TestUserSettingTOTPKeyRoundTrip(t *testing.T) {
	original := &storepb.UserSetting{
		UserId: 1,
		Key:    storepb.UserSetting_TOTP,
		Value: &storepb.UserSetting_Totp{Totp: &storepb.TotpUserSetting{
			EncryptedSecret:  []byte("encrypted"),
			BackupCodeHashes: []string{"a", "b"},
		}},
	}
	raw, err := convertUserSettingToRaw(original)
	if err != nil {
		t.Fatalf("convertUserSettingToRaw: %v", err)
	}
	back, err := convertUserSettingFromRaw(raw)
	if err != nil {
		t.Fatalf("convertUserSettingFromRaw: %v", err)
	}
	if back.GetTotp() == nil || string(back.GetTotp().GetEncryptedSecret()) != "encrypted" {
		t.Fatalf("TOTP setting did not round-trip: %+v", back)
	}
}

// TestUserSettingPasskeysKeyRoundTrip ensures the PASSKEYS user setting key
// survives the storepb -> raw -> storepb conversion used by the DB layer.
func TestUserSettingPasskeysKeyRoundTrip(t *testing.T) {
	original := &storepb.UserSetting{
		UserId: 1,
		Key:    storepb.UserSetting_PASSKEYS,
		Value: &storepb.UserSetting_Passkeys{Passkeys: &storepb.PasskeysUserSetting{
			Credentials: []*storepb.PasskeyCredential{{CredentialId: []byte("cred-1"), Name: "key"}},
		}},
	}
	raw, err := convertUserSettingToRaw(original)
	if err != nil {
		t.Fatalf("convertUserSettingToRaw: %v", err)
	}
	back, err := convertUserSettingFromRaw(raw)
	if err != nil {
		t.Fatalf("convertUserSettingFromRaw: %v", err)
	}
	creds := back.GetPasskeys().GetCredentials()
	if len(creds) != 1 || string(creds[0].GetCredentialId()) != "cred-1" {
		t.Fatalf("PASSKEYS setting did not round-trip: %+v", back)
	}
}
