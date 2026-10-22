const MODE = "f067-bridge";
const ORIGIN = "http://localhost:5174";

// Shared by the Vite configuration gate and browser initialization. Never accept
// a caller-supplied URL or silently normalize an unsupported selector.
export function developmentCallbackMode(environment) {
  const mode = environment?.VITE_ENTRA_DEVELOPMENT_CALLBACK_MODE;
  if (mode === undefined || mode === "") return undefined;
  if (mode !== MODE)
    throw new Error("Unsupported development authentication callback mode.");
  const profile = environment?.VITE_CITYVUE_DEPLOYMENT_PROFILE ?? "development";
  if (
    environment?.DEV !== true ||
    environment?.PROD !== false ||
    profile !== "development"
  ) {
    throw new Error(
      "Development authentication callbacks require Vite development and the development profile.",
    );
  }
  return mode;
}

export function authenticationReturnUris(environment, origin) {
  if (!developmentCallbackMode(environment)) {
    return { redirectUri: `${origin}/`, postLogoutRedirectUri: `${origin}/` };
  }
  if (origin !== ORIGIN)
    throw new Error(
      "Development authentication callbacks require the approved localhost origin.",
    );
  return {
    redirectUri: `${ORIGIN}/redirect.html`,
    postLogoutRedirectUri: `${ORIGIN}/auth/signed-out`,
  };
}
