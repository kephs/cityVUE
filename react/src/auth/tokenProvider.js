let provider = null;
export function setStaffTokenProvider(next) { provider = next; }
export async function getStaffAccessToken() {
    if (!provider) throw new Error('staff-authentication-required');
    return provider();
}
