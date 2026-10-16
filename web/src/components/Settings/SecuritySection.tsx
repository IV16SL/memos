import { startRegistration } from "@simplewebauthn/browser";
import { FingerprintIcon, KeyRoundIcon, PencilIcon, PlusIcon, ShieldCheckIcon, ShieldIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import QRCode from "react-qr-code";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authServiceClient } from "@/connect";
import { useDialog } from "@/hooks/useDialog";
import { handleError } from "@/lib/error";
import { isWebAuthnNotAllowedError } from "@/lib/webauthn";
import type { Passkey } from "@/types/proto/api/auth_service_pb";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";

const SecuritySection = () => {
  const t = useTranslate();
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const setupDialog = useDialog();
  const disableDialog = useDialog();

  useEffect(() => {
    authServiceClient
      .getTOTPStatus({})
      .then((res) => setTotpEnabled(res.enabled))
      .catch(() => setTotpEnabled(false));
  }, []);

  return (
    <SettingGroup showSeparator title={t("setting.security.title")} description={t("setting.security.description")}>
      <div className="flex flex-col gap-3 rounded-xl border p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-muted p-2">
            <ShieldIcon className="h-4 w-4" />
          </div>
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-foreground">{t("setting.security.totp-title")}</p>
            <p className="text-sm text-muted-foreground">{t("setting.security.totp-description")}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {totpEnabled ? (
              <>
                <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <ShieldCheckIcon className="h-3.5 w-3.5" />
                  {t("setting.security.enabled")}
                </span>
                <Button variant="outline" size="sm" onClick={disableDialog.open}>
                  {t("setting.security.disable")}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={setupDialog.open}>
                <KeyRoundIcon className="h-4 w-4 mr-1.5" />
                {t("setting.security.enable-totp")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <PasskeyCard />

      <TOTPSetupDialog open={setupDialog.isOpen} onOpenChange={setupDialog.setOpen} onEnabled={() => setTotpEnabled(true)} />
      <TOTPDisableDialog open={disableDialog.isOpen} onOpenChange={disableDialog.setOpen} onDisabled={() => setTotpEnabled(false)} />
    </SettingGroup>
  );
};

function PasskeyCard() {
  const t = useTranslate();
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [registering, setRegistering] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Passkey | null>(null);
  const [renameTarget, setRenameTarget] = useState<Passkey | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const reload = () => {
    authServiceClient
      .listPasskeys({})
      .then((res) => setPasskeys(res.passkeys))
      .catch((error) => {
        handleError(error, toast.error, { context: "List passkeys" });
        setPasskeys([]);
      });
  };

  useEffect(reload, []);

  const handleRegister = async () => {
    if (registering) return;
    setRegistering(true);
    try {
      const begin = await authServiceClient.beginPasskeyRegistration({});
      let attestation;
      try {
        attestation = await startRegistration({ optionsJSON: JSON.parse(begin.optionsJson) });
      } catch (error) {
        if (isWebAuthnNotAllowedError(error)) {
          return;
        }
        throw error;
      } finally {
        setRegistering(false);
      }
      await authServiceClient.finishPasskeyRegistration({
        sessionToken: begin.sessionToken,
        credentialJson: JSON.stringify(attestation),
      });
      toast.success(t("setting.security.passkey-added"));
      reload();
    } catch (error) {
      handleError(error, toast.error, { context: "Register passkey" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await authServiceClient.deletePasskey({ name: deleteTarget.name });
      toast.success(t("setting.security.passkey-deleted"));
      setDeleteTarget(null);
      reload();
    } catch (error) {
      handleError(error, toast.error, { context: "Delete passkey" });
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await authServiceClient.renamePasskey({ name: renameTarget.name, displayName: renameValue.trim() });
      toast.success(t("setting.security.passkey-renamed"));
      setRenameTarget(null);
      reload();
    } catch (error) {
      handleError(error, toast.error, { context: "Rename passkey" });
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-muted p-2">
          <FingerprintIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">{t("setting.security.passkey-title")}</p>
          <p className="text-sm text-muted-foreground">{t("setting.security.passkey-description")}</p>
        </div>
        <Button variant="outline" size="sm" disabled={registering} onClick={handleRegister}>
          <PlusIcon className="h-4 w-4 mr-1.5" />
          {t("setting.security.add-passkey")}
        </Button>
      </div>
      {passkeys !== null && passkeys.length > 0 && (
        <div className="flex flex-col divide-y divide-border rounded-lg border">
          {passkeys.map((pk) => (
            <div key={pk.name} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm font-medium truncate">{pk.displayName || t("setting.security.passkey-default-name")}</p>
                <p className="text-xs text-muted-foreground">
                  {pk.createTime ? new Date(Number(pk.createTime.seconds) * 1000).toLocaleDateString() : ""}
                  {pk.lastUsedTime
                    ? ` · ${t("setting.security.passkey-last-used")} ${new Date(Number(pk.lastUsedTime.seconds) * 1000).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRenameTarget(pk);
                  setRenameValue(pk.displayName);
                }}
              >
                <PencilIcon className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(pk)}>
                <Trash2Icon className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {passkeys !== null && passkeys.length === 0 && <p className="text-sm text-muted-foreground">{t("setting.security.passkey-empty")}</p>}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("setting.security.passkey-delete-title")}
        description={t("setting.security.passkey-delete-description", { name: deleteTarget?.displayName ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDelete}
        confirmVariant="destructive"
      />
      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("setting.security.passkey-rename-title")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="passkey-rename">{t("setting.security.passkey-name-label")}</Label>
            <Input id="passkey-rename" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={64} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TOTPSetupDialog({
  open,
  onOpenChange,
  onEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnabled: () => void;
}) {
  const t = useTranslate();
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Reset state when closed, unless backup codes are being shown.
      if (backupCodes.length === 0) {
        setOtpauthUrl("");
        setSecret("");
        setCode("");
      }
    }
    onOpenChange(next);
  };

  // Start enrollment when the dialog opens. This cannot live in
  // handleOpenChange: Radix does not fire onOpenChange for programmatic
  // opens (parent flipping the controlled `open` prop), only for
  // user-initiated closes (X, overlay, Escape).
  useEffect(() => {
    if (!open || otpauthUrl || backupCodes.length > 0) return;
    setLoading(true);
    authServiceClient
      .beginTOTPSetup({})
      .then((res) => {
        setOtpauthUrl(res.otpauthUrl);
        setSecret(res.secret);
      })
      .catch((error) => {
        handleError(error, toast.error, { context: "Begin TOTP setup" });
        onOpenChange(false);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const handleConfirm = async () => {
    if (!code) return;
    setLoading(true);
    try {
      const res = await authServiceClient.confirmTOTPSetup({ secret, code });
      setBackupCodes(res.backupCodes);
      onEnabled();
      toast.success(t("setting.security.totp-enabled"));
    } catch (error) {
      handleError(error, toast.error, { context: "Confirm TOTP setup" });
    }
    setLoading(false);
  };

  const handleBackupDone = () => {
    setOtpauthUrl("");
    setSecret("");
    setCode("");
    setBackupCodes([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("setting.security.enable-totp")}</DialogTitle>
        </DialogHeader>
        {backupCodes.length > 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t("setting.security.backup-codes-description")}</p>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 font-mono text-sm">
              {backupCodes.map((c) => (
                <span key={c} className="select-all">
                  {c}
                </span>
              ))}
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(backupCodes.join("\n")).catch(() => {});
                  toast.success(t("common.copied"));
                }}
                variant="outline"
              >
                {t("common.copy")}
              </Button>
              <Button onClick={handleBackupDone}>{t("setting.security.backup-codes-saved")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t("setting.security.totp-scan-description")}</p>
            {otpauthUrl && (
              <div className="mx-auto w-fit rounded bg-white p-2">
                <QRCode value={otpauthUrl} size={180} />
              </div>
            )}
            {secret && <p className="text-center font-mono text-sm text-muted-foreground select-all break-all">{secret}</p>}
            <div className="flex flex-col gap-2">
              <Label htmlFor="totp-code">{t("setting.security.totp-code-label")}</Label>
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="XXXXXX"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleConfirm} disabled={loading || code.length < 6}>
                {t("common.confirm")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TOTPDisableDialog({
  open,
  onOpenChange,
  onDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}) {
  const t = useTranslate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!code) return;
    setLoading(true);
    try {
      await authServiceClient.disableTOTP({ code });
      onDisabled();
      setCode("");
      onOpenChange(false);
      toast.success(t("setting.security.totp-disabled"));
    } catch (error) {
      handleError(error, toast.error, { context: "Disable TOTP" });
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("setting.security.disable-totp-title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("setting.security.disable-totp-description")}</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="totp-disable-code">{t("setting.security.totp-code-label")}</Label>
            <Input
              id="totp-disable-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="XXXXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={loading || code.length < 6}>
              {t("setting.security.disable")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SecuritySection;
