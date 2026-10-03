import SiteFooter from "./SiteFooter.jsx";
import SiteHeader from "./SiteHeader.jsx";
import { useLocation } from "react-router-dom";
import { HomeHeader, HomeFooter } from "../../pages/home/HomeShell.jsx";
import { HomePresentationProvider } from "../../pages/home/HomePresentationContext.jsx";
import PublishedHomePresentationProvider from "../../pages/home/PublishedHomePresentationProvider.jsx";

export default function AppLayout({ children, homepagePresentation }) {
  const location = useLocation();
  const mainClassName =
    location.pathname === "/"
      ? "flex-grow-1 reqro-home-main"
      : `container flex-grow-1 py-4 py-md-5${location.pathname === "/staff/requests" || location.pathname.startsWith("/staff/requests/") ? " request-workspace-container" : location.pathname === "/report" ? " report-workspace-container" : ""}`;

  const shell = (
    <div className="app-shell d-flex min-vh-100 flex-column">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {location.pathname === "/" ? <HomeHeader /> : <SiteHeader />}
      <main className={mainClassName} id="main-content" tabIndex="-1">
        {children}
      </main>
      {location.pathname === "/" ? <HomeFooter /> : <SiteFooter />}
    </div>
  );
  return location.pathname === "/"
    ? homepagePresentation === undefined
      ? <PublishedHomePresentationProvider>{shell}</PublishedHomePresentationProvider>
      : <HomePresentationProvider value={homepagePresentation}>{shell}</HomePresentationProvider>
    : shell;
}
