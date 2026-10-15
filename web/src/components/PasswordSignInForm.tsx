import { type Timestamp, timestampDate } from "@bufbuild/protobuf/wkt";
import { LoaderIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { setAccessToken } from "@/auth-state";
import ChallengeWidget, { CHALLENGE_TOKEN_HEADER } from "@/components/ChallengeWidget";
import CredentialFields from "@/components/CredentialFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authServiceClient } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import useLoading from "@/hooks/useLoading";
import useNavigateTo from "@/hooks/useNavigateTo";
import { ERROR_REASON_CHALLENGE_REQUIRED, handleError, hasErrorReason } from "@/lib/error";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";

interface PasswordSignInFormProps {
  redirectPath?: string;
}

function PasswordSignInForm({ redirectPath }: PasswordSignInFormProps) {
  const t = useTranslate();
  const navigateTo = useNavigateTo();
  const { initialize } = useAuth();
  const actionBtnLoadingState = useLoading(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [challengeResetKey, setChallengeResetKey] = useState(0);
  // TOTP second factor: set when the password was accepted but a TOTP code is still required.
  const [totpPendingToken, setTotpPendingToken] = useState<string | null>(null);
  const [totpUsername, setTotpUsername] = useState("");
  const [totpCode, setTotpCode] = useState("");

  const finishSignIn = async (accessToken: string, accessTokenExpireTime?: Timestamp) => {
    if (accessToken) {
      setAccessToken(accessToken, accessTokenExpireTime ? timestampDate(accessTokenExpireTime) : undefined);
    }
    await initialize();
    navigateTo(redirectPath || ROUTES.HOME, { replace: true });
  };

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (username === "" || password === "") {
      return;
    }

    if (actionBtnLoadingState.isLoading) {
      return;
    }

    try {
      actionBtnLoadingState.setLoading();
      const response = await authServiceClient.signIn(
        {
          credentials: {
            case: "passwordCredentials",
            value: { username, password },
          },
        },
        challengeToken ? { headers: { [CHALLENGE_TOKEN_HEADER]: challengeToken } } : undefined,
      );
      // Password verified; either done or waiting for the TOTP second factor.
      if (response.totpRequired) {
        setTotpPendingToken(response.totpPendingToken);
        setTotpUsername(response.user?.username ?? username);
        setTotpCode("");
      } else {
        await finishSignIn(response.accessToken, response.accessTokenExpireTime);
      }
    } catch (error: unknown) {
      if (hasErrorReason(error, ERROR_REASON_CHALLENGE_REQUIRED)) {
        setChallengeResetKey((key) => key + 1);
      }
      handleError(error, toast.error, {
        fallbackMessage: "Failed to sign in.",
      });
    }
    actionBtnLoadingState.setFinish();
  };

  const handleTOTPSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!totpPendingToken || totpCode === "" || actionBtnLoadingState.isLoading) {
      return;
    }

    try {
      actionBtnLoadingState.setLoading();
      const response = await authServiceClient.verifyTOTPLogin({
        pendingToken: totpPendingToken,
        code: totpCode,
      });
      await finishSignIn(response.accessToken, response.accessTokenExpireTime);
    } catch (error: unknown) {
      handleError(error, toast.error, {
        fallbackMessage: "Failed to verify TOTP code.",
      });
    }
    actionBtnLoadingState.setFinish();
  };

  if (totpPendingToken) {
    return (
      <form className="flex w-full flex-col gap-4" onSubmit={handleTOTPSubmit}>
        <p className="text-sm text-muted-foreground">{t("auth.totp-required-description", { username: totpUsername })}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signin-totp-code">{t("auth.totp-code-label")}</Label>
          <Input
            id="signin-totp-code"
            type="text"
            inputMode="numeric"
            placeholder="123456"
            value={totpCode}
            autoComplete="one-time-code"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            required
          />
        </div>
        <Button type="submit" disabled={actionBtnLoadingState.isLoading || totpCode.length < 6}>
          {t("auth.verify-totp")}
          {actionBtnLoadingState.isLoading && <LoaderIcon className="ml-1 h-4 w-auto animate-spin opacity-60" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setTotpPendingToken(null);
            setTotpCode("");
          }}
        >
          {t("common.back")}
        </Button>
      </form>
    );
  }

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={handleFormSubmit}>
      <CredentialFields
        idPrefix="signin"
        username={username}
        password={password}
        passwordAutoComplete="current-password"
        readOnly={actionBtnLoadingState.isLoading}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
      />
      <ChallengeWidget onToken={setChallengeToken} resetKey={challengeResetKey} />
      <Button type="submit" disabled={actionBtnLoadingState.isLoading}>
        {t("common.sign-in")}
        {actionBtnLoadingState.isLoading && <LoaderIcon className="ml-1 h-4 w-auto animate-spin opacity-60" />}
      </Button>
    </form>
  );
}

export default PasswordSignInForm;
