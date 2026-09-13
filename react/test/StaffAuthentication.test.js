import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api/apiClient.js';
import { setStaffTokenProvider } from '../src/auth/tokenProvider.js';

afterEach(() => setStaffTokenProvider(null));
describe('staff API authentication boundary', () => {
    it('attaches an MSAL-provided token only to authenticated calls', async () => {
        setStaffTokenProvider(async () => 'signed-test-token');
        const requests = [];
        const client = createApiClient({ baseUrl:'http://api', fetchImplementation: async (_url,options) => {
            requests.push(options); return { ok:true,status:200,headers:new Headers(),json:async()=>({}) };
        }});
        await client.get('/catalog/categories');
        await client.get('/service-requests',{authenticated:true});
        expect(requests[0].headers.Authorization).toBeUndefined();
        expect(requests[1].headers.Authorization).toBe('Bearer signed-test-token');
    });
    it('maps staff 401 and 403 responses without exposing backend detail', async () => {
        setStaffTokenProvider(async () => 'token');
        const response = (status,message) => ({ ok:false,status,headers:new Headers(),json:async()=>({message}) });
        const unauthorized = createApiClient({baseUrl:'http://api',fetchImplementation:async()=>response(401,'jwt detail')});
        await expect(unauthorized.get('/service-requests',{authenticated:true})).rejects.toMatchObject({code:'authentication-required'});
        const forbidden = createApiClient({baseUrl:'http://api',fetchImplementation:async()=>response(403,'internal role detail')});
        await expect(forbidden.get('/service-requests',{authenticated:true})).rejects.toMatchObject({code:'access-denied'});
    });
});
