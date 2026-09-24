import { useEffect, useState } from "react";
import { useTheme } from "../theme/useTheme.js";
export const reqroBrand = Object.freeze({
  name: "Reqro",
  tagline: "People • Requests • Progress",
  message: "Built for Today. Ready for a Stronger Tomorrow.",
});
const exampleLogo = "/branding/examples/example-organization.png";
export function ReqroBrand({ compact = false, dark = false }) {
  const { theme } = useTheme();
  const variant = dark ? "dark" : theme;
  const source = `/branding/reqro/reqro-${compact ? "mark" : "logo"}-${variant}.png`;
  const [failed, setFailed] = useState(null);
  return failed === source ? (
    <span className="reqro-text">Reqro</span>
  ) : (
    <img
      className={compact ? "reqro-mark" : "reqro-wordmark"}
      src={source}
      alt="Reqro"
      onError={() => setFailed(source)}
    />
  );
}
export function OrganizationBrand({ branding, dark = true }) {
  const valid =
    branding?.mode === "ORGANIZATION" &&
    typeof branding.displayName === "string" &&
    branding.displayName.trim().length > 0 &&
    branding.displayName.length <= 100;
  const source =
    valid && branding.logoKey === "example-organization" ? exampleLogo : null;
  const identity = valid
    ? `${branding.revision}-${branding.displayName}-${source}`
    : "default";
  const [failed, setFailed] = useState(null);
  return (
    <div
      className="configuration-brand"
      aria-label={valid ? "Organization branding" : "Reqro product branding"}
    >
      {valid ? (
        <>
          {source && failed !== identity ? (
            <img
              className="organization-logo"
              src={source}
              alt=""
              onError={() => setFailed(identity)}
            />
          ) : (
            <ReqroBrand compact dark={dark} />
          )}
          <p className="organization-name">{branding.displayName}</p>
          {typeof branding.tagline === "string" && branding.tagline.trim() && (
            <p className="organization-tagline">
              {branding.tagline.slice(0, 140)}
            </p>
          )}
          <p className="powered-by">Powered by Reqro</p>
        </>
      ) : (
        <>
          <ReqroBrand dark={dark} />
          <p className="organization-tagline">{reqroBrand.tagline}</p>
        </>
      )}
    </div>
  );
}
export function useAdminProductIdentity() {
  useEffect(() => {
    const oldTitle = document.title;
    document.title = "Reqro Administration";
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/png";
    icon.sizes = "32x32";
    icon.href = "/branding/reqro/reqro-favicon-32.png";
    document.head.append(icon);
    return () => {
      document.title = oldTitle;
      icon.remove();
    };
  }, []);
}
