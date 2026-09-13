import { useAuth } from './AuthContext.jsx';
export default function StaffRouteGuard({ children, requireEntra = false }) {
    const auth = useAuth();
    if (!auth.enabled) return requireEntra
        ? <section><h1>CityVUE AI Workspace</h1><p role="status">Staff AI access is not enabled. City sign-in must be configured.</p></section>
        : children;
    const Container = requireEntra ? 'section' : 'main';
    if (!auth.isAuthenticated) return <Container className="container py-5"><h1>Staff sign-in required</h1><p>Sign in with an authorized City account to continue.</p><button className="btn btn-primary" onClick={auth.signIn}>Sign in</button>{auth.error && <p role="alert" className="mt-3">{auth.error}</p>}</Container>;
    return children;
}
