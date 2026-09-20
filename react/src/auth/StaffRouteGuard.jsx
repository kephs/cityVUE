import { useAuth } from './AuthContext.jsx';
export default function StaffRouteGuard({ children, requireEntra = false, title = "CityVUE AI Workspace", disabledMessage = "Staff AI access is not enabled. City sign-in must be configured.", signInMessage = "Sign in with an authorized City account to continue." }) {
    const auth = useAuth();
    if (!auth.enabled) return requireEntra
        ? <section><h1>{title}</h1><p role="status">{disabledMessage}</p></section>
        : children;
    const Container = requireEntra ? 'section' : 'main';
    if (!auth.isAuthenticated) return <Container className="container py-5"><h1>Staff sign-in required</h1><p>{signInMessage}</p><button className="btn btn-primary" onClick={auth.signIn}>Sign in</button>{auth.error && <p role="alert" className="mt-3">{auth.error}</p>}</Container>;
    return children;
}
