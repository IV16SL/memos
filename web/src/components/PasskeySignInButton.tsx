import { timestampDate } from "@bufbuild/protobuf/wkt";
import { startAuthentication } from "@simplewebauthn/browser";
import { FingerprintIcon, LoaderIcon } from "lucide-react";
import { toast } from "react-hot-toast";
import { setAccessToken } from "@/auth-state";
import { Button } from "@/components/ui/button";
import { authServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import useLoading from "@/hooks/useLoading";
import useNavigateTo from "@/hooks/useNavigateTo";
import { handleError } from "@/lib/error";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";

interface PasskeySignInButtonProps {
  redirectPath?: string;
}

// Usernameless passkey login, placed below the password login button.
function PasskeySignInButton({ redirectPath }: PasskeySignInButtonProps) {
  const t = useTranslate();
  const navigateTo = useNavigateTo();
  const { initialize } = useAuth();
  const loading = useLoading(false);

  // WebAuthn requires a secure context; hide the button when unavailable.
  const webauthnAvailable = typeof window !== "undefined" && !!window.PublicKeyCredential;

  const handleClick = async () => {
    if (loading.isLoading) {
      return;
    }
    try {
      loading.setLoading();
      const begin = await authServiceClient.beginPasskeyLogin({});
      let assertion;
      try {
        assertion = await startAuthentication({ optionsJSON: JSON.parse(begin.optionsJson) });
      } catch (error) {
        // User cancelled the browser prompt or no passkey is available.
        if (error instanceof Error && error.name === "NotAllowedError") {
          return;
        }
        throw error;
      }
      const finish = await authServiceClient.finishPasskeyLogin({
        sessionToken: begin.sessionToken,
        credentialJson: JSON.stringify(assertion),
      });
      if (finish.accessToken) {
        setAccessToken(finish.accessToken, finish.accessTokenExpireTime ? timestampDate(finish.accessTokenExpireTime) : undefined);
      }
      await initialize();
      navigateTo(redirectPath || ROUTES.HOME, { replace: true });
    } catch (error: unknown) {
      handleError(error, toast.error, {
        fallbackMessage: t("auth.passkey-signin-failed"),
      });
    }
    loading.setFinish();
  };

  // Hide the button when WebAuthn is unavailable (e.g. insecure context).
  if (!webauthnAvailable) {
    return null;
  }

  return (
    <Button type="button" variant="outline" className="w-full" disabled={loading.isLoading} onClick={handleClick}>
      <FingerprintIcon className="h-4 w-4 mr-2" />
      {t("auth.sign-in-with-passkey")}
      {loading.isLoading && <LoaderIcon className="ml-1 h-4 w-auto animate-spin opacity-60" />}
    </Button>
  );
}

export default PasskeySignInButton;
