import { useAuth } from './AuthContext.jsx';
export default function StaffRouteGuard({ children }) {
    const auth = useAuth();
    if (!auth.enabled) return children;
    if (!auth.isAuthenticated) return <main className="container py-5"><h1>Staff sign-in required</h1><p>Sign in with an authorized City account to continue.</p><button className="btn btn-primary" onClick={auth.signIn}>Sign in</button>{auth.error && <p role="alert" className="mt-3">{auth.error}</p>}</main>;
    return children;
}
