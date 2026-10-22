import {
  BrowserCacheLocation,
  PublicClientApplication,
} from "@azure/msal-browser";
import { authenticationReturnUris } from "../config/developmentCallback.mjs";

export function createMsalInstance(config, origin = window.location.origin) {
  return new PublicClientApplication({
    auth: {
      clientId: config.webClientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      ...authenticationReturnUris(import.meta.env, origin),
    },
    cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
  });
}
