import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { MsalProvider, useMsal } from '@azure/msal-react';
import { readResidentIntakeConfig } from '../config/runtimeConfig.js';
import { createMsalInstance } from './msalConfig.js';
import { setStaffTokenProvider } from './tokenProvider.js';

const AuthContext = createContext({ enabled:false, isAuthenticated:false, account:null, displayName:'', error:null });
function ActiveAuthProvider({ scope, children }) {
    const { instance, accounts } = useMsal(); const [error,setError] = useState(null);
    const account = instance.getActiveAccount() || accounts[0] || null;
    useEffect(() => { if (account && !instance.getActiveAccount()) instance.setActiveAccount(account); }, [account,instance]);
    const getAccessToken = useCallback(async () => {
        if (!account) throw new Error('staff-authentication-required');
        try { return (await instance.acquireTokenSilent({ account, scopes:[scope] })).accessToken; }
        catch (cause) {
            if (cause instanceof InteractionRequiredAuthError) { setError('CityVUE API access is awaiting administrator approval.'); }
            throw cause;
        }
    },[account,instance,scope]);
    useEffect(() => { setStaffTokenProvider(account ? getAccessToken : null); return () => setStaffTokenProvider(null); },[account,getAccessToken]);
    const value = useMemo(() => ({ enabled:true,isAuthenticated:Boolean(account),account,displayName:account?.name || account?.username || '',error,
        signIn: async () => { setError(null); try { await instance.loginRedirect({ scopes:[scope] }); } catch { setError('Sign-in was not completed.'); } },
        signOut: () => instance.logoutRedirect({ account }), getAccessToken }),[account,error,getAccessToken,instance,scope]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function AuthRoot({ children }) {
    const config = readResidentIntakeConfig();
    const [instance] = useState(() => config.entra.enabled ? createMsalInstance(config.entra) : null);
    if (!instance) return <AuthContext.Provider value={{ enabled:false,isAuthenticated:false,account:null,displayName:'',error:null }}>{children}</AuthContext.Provider>;
    return <MsalProvider instance={instance}><ActiveAuthProvider scope={config.entra.apiScope}>{children}</ActiveAuthProvider></MsalProvider>;
}
export const useAuth = () => useContext(AuthContext);
