import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";
import { useTheme } from "../../theme/useTheme.js";
import { useHomePresentation } from "./HomePresentationContext.jsx";
import PresentationLink from "./PresentationLink.jsx";
import { localAsset, iconAsset, themeChoice } from "./presentationPolicy.js";
import "./home.css";

export function HomeHeader() {
  const presentation = useHomePresentation();
  const { navigation } = presentation;
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const close = () => setOpen(false);
  return (
    <header className="reqro-home-header" data-home-theme={themeChoice(presentation.theme)}>
      <nav className="reqro-home-container reqro-home-nav" aria-label={navigation.label}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            close();
            event.currentTarget.querySelector('[aria-controls="reqro-home-navigation"]').focus();
          }
        }}>
        <PresentationLink className="reqro-home-brand" action={navigation.links[0]}
          aria-label={`${presentation.brandName} ${navigation.homeSuffix}`} onClick={close}>
          <img src={localAsset(presentation.wordmark) || localAsset(presentation.logo)} width={presentation.wordmarkSize.width} height={presentation.wordmarkSize.height} alt={presentation.brandName} />
        </PresentationLink>
        <button className="reqro-menu-toggle" type="button" aria-controls="reqro-home-navigation"
          aria-expanded={open} aria-label={open ? navigation.closeMenu : navigation.openMenu}
          onClick={() => setOpen(!open)}>
          <i className={`bi ${open ? "bi-x-lg" : "bi-list"}`} aria-hidden="true" />{navigation.menu}
        </button>
        <div className={`reqro-home-navigation${open ? " is-open" : ""}`} id="reqro-home-navigation">
          <ul>
            {navigation.links.map((link) => <li key={link.id}>
              <PresentationLink action={link} onClick={close}
                aria-current={link.actionType === "internal" && location.pathname === link.target ? "page" : undefined}>
                {link.label}
              </PresentationLink>
            </li>)}
            {auth.enabled && auth.isAuthenticated && <li>
              <PresentationLink action={{ actionType: "internal", target: navigation.staffTarget }} onClick={close}>{navigation.staff}</PresentationLink>
            </li>}
          </ul>
          {auth.enabled && <button type="button" className="reqro-sign-in" onClick={auth.isAuthenticated ? auth.signOut : auth.signIn}>
            {auth.isAuthenticated ? navigation.signOut : navigation.signIn}
          </button>}
        </div>
      </nav>
    </header>
  );
}

function HomeThemeToggle({ footer }) {
  const { theme, toggleTheme } = useTheme();
  return <button className="reqro-theme-toggle" type="button" onClick={toggleTheme}
    aria-label={theme === "dark" ? footer.switchToLight : footer.switchToDark} aria-pressed={theme === "dark"}>
    {theme === "dark" ? <i className="bi bi-sun-fill" aria-hidden="true" />
      : <img src={iconAsset("moon")} alt="" width="24" height="24" />}
  </button>;
}

export function HomeFooter() {
  const presentation = useHomePresentation();
  const { footer } = presentation;
  return (
    <footer className="reqro-home-footer" data-home-theme={themeChoice(presentation.theme)}>
      <div className="reqro-home-container reqro-footer-content">
        <img className="reqro-footer-wordmark" src={localAsset(footer.wordmark) || localAsset(presentation.wordmark)}
          width={presentation.wordmarkSize.width} height={presentation.wordmarkSize.height} alt={presentation.brandName} />
        <p>{footer.message}</p>
        {footer.links?.length > 0 && <ul className="reqro-footer-links">
          {footer.links.map((link) => <li key={link.id}><PresentationLink action={link}>{link.label}</PresentationLink></li>)}
        </ul>}
        {footer.showThemeToggle && <HomeThemeToggle footer={footer} />}
      </div>
    </footer>
  );
}
