import { timestampDate } from "@bufbuild/protobuf/wkt";
import { startRegistration } from "@simplewebauthn/browser";
import { FingerprintIcon, LoaderIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { setAccessToken } from "@/auth-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import useLoading from "@/hooks/useLoading";
import useNavigateTo from "@/hooks/useNavigateTo";
import { handleError } from "@/lib/error";
import { isWebAuthnNotAllowedError } from "@/lib/webauthn";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";

interface PasskeySignupSectionProps {
  redirectPath?: string;
}

// "Sign up with passkey": like first-time SSO login, this provisions a local
// account in one ceremony. Unlike SSO there is no identity provider, so the
// username is supplied here.
function PasskeySignupSection({ redirectPath }: PasskeySignupSectionProps) {
  const t = useTranslate();
  const navigateTo = useNavigateTo();
  const { initialize } = useAuth();
  const loading = useLoading(false);
  const [expanded, setExpanded] = useState(false);
  const [username, setUsername] = useState("");

  const webauthnAvailable = typeof window !== "undefined" && !!window.PublicKeyCredential;
  if (!webauthnAvailable) {
    return null;
  }

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!username || loading.isLoading) {
      return;
    }
    try {
      loading.setLoading();
      const begin = await authServiceClient.beginPasskeySignup({ username });
      let attestation;
      try {
        attestation = await startRegistration({ optionsJSON: JSON.parse(begin.optionsJson) });
      } catch (error) {
        if (isWebAuthnNotAllowedError(error)) {
          return;
        }
        throw error;
      }
      const finish = await authServiceClient.finishPasskeySignup({
        sessionToken: begin.sessionToken,
        credentialJson: JSON.stringify(attestation),
      });
      if (finish.accessToken) {
        setAccessToken(finish.accessToken, finish.accessTokenExpireTime ? timestampDate(finish.accessTokenExpireTime) : undefined);
      }
      await initialize();
      navigateTo(redirectPath || ROUTES.HOME, { replace: true });
    } catch (error: unknown) {
      handleError(error, toast.error, {
        fallbackMessage: t("auth.passkey-signup-failed"),
      });
    }
    loading.setFinish();
  };

  if (!expanded) {
    return (
      <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setExpanded(true)}>
        <FingerprintIcon className="h-4 w-4 mr-2" />
        {t("auth.sign-up-with-passkey")}
      </Button>
    );
  }

  return (
    <form className="flex w-full flex-col gap-3 rounded-xl border p-4" onSubmit={handleSignup}>
      <p className="text-sm text-muted-foreground">{t("auth.passkey-signup-description")}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="passkey-signup-username">{t("common.username")}</Label>
        <Input
          id="passkey-signup-username"
          type="text"
          placeholder={t("common.username")}
          value={username}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={() => setExpanded(false)}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" className="flex-1" disabled={loading.isLoading || !username}>
          <FingerprintIcon className="h-4 w-4 mr-2" />
          {t("auth.sign-up-with-passkey")}
          {loading.isLoading && <LoaderIcon className="ml-1 h-4 w-auto animate-spin opacity-60" />}
        </Button>
      </div>
    </form>
  );
}

export default PasskeySignupSection;
