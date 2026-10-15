import { timestampDate } from "@bufbuild/protobuf/wkt";
import { startRegistration } from "@simplewebauthn/browser";
import { FingerprintIcon, LoaderIcon } from "lucide-react";
import { toast } from "react-hot-toast";
import { setAccessToken } from "@/auth-state";
import { Button } from "@/components/ui/button";
import { authServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import useLoading from "@/hooks/useLoading";
import useNavigateTo from "@/hooks/useNavigateTo";
import { handleError } from "@/lib/error";
import { isWebAuthnNotAllowedError } from "@/lib/webauthn";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";

interface PasskeySignupButtonProps {
  username: string;
  redirectPath?: string;
}

// "Sign up with passkey": like first-time SSO login, this provisions a local
// account in one ceremony. The username comes from the sign-up form.
function PasskeySignupButton({ username, redirectPath }: PasskeySignupButtonProps) {
  const t = useTranslate();
  const navigateTo = useNavigateTo();
  const { initialize } = useAuth();
  const loading = useLoading(false);

  // WebAuthn requires a secure context; hide the button when unavailable.
  const webauthnAvailable = typeof window !== "undefined" && !!window.PublicKeyCredential;
  if (!webauthnAvailable) {
    return null;
  }

  const handleSignup = async () => {
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

  return (
    <Button type="button" variant="outline" className="w-full" disabled={loading.isLoading || !username} onClick={handleSignup}>
      <FingerprintIcon className="h-4 w-4 mr-2" />
      {t("auth.sign-up-with-passkey")}
      {loading.isLoading && <LoaderIcon className="ml-1 h-4 w-auto animate-spin opacity-60" />}
    </Button>
  );
}

export default PasskeySignupButton;
