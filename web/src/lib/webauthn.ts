/**
 * Whether the error represents the user dismissing / the browser refusing the
 * WebAuthn ceremony (NotAllowedError: "The operation either timed out or was
 * not allowed.").
 *
 * @simplewebauthn/browser wraps the raw DOMException in its own WebAuthnError
 * (code "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY") with the original error on
 * `.cause`, so checking only `error.name` misses it. Walk the cause chain.
 */
export function isWebAuthnNotAllowedError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (current.name === "NotAllowedError") {
      return true;
    }
    const cause = (current as { cause?: unknown }).cause;
    if (cause === undefined || cause === null) {
      return false;
    }
    current = cause;
  }
  return false;
}
