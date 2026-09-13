import { BrowserCacheLocation, PublicClientApplication } from '@azure/msal-browser';
export function createMsalInstance(config, origin = window.location.origin) {
    return new PublicClientApplication({ auth: { clientId: config.webClientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`, redirectUri: `${origin}/`, postLogoutRedirectUri: `${origin}/` },
    cache: { cacheLocation: BrowserCacheLocation.SessionStorage } });
}
