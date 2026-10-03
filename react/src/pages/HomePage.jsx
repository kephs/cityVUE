import ResidentAlertBanner from "../alerts/ResidentAlertBanner.jsx";
import Hero from "./home/Hero.jsx";
import HomeBenefits from "./home/HomeBenefits.jsx";
import { useHomePresentation } from "./home/HomePresentationContext.jsx";
import { useHomeMetadata } from "./home/useHomeMetadata.js";
import { themeChoice } from "./home/presentationPolicy.js";
import "./home/home.css";

export default function HomePage() {
  const presentation = useHomePresentation();
  useHomeMetadata(presentation);
  return (
    <div className="home-page reqro-home" data-home-theme={themeChoice(presentation.theme)}>
      <ResidentAlertBanner />
      <Hero presentation={presentation} />
      <HomeBenefits benefits={presentation.benefits} label={presentation.benefitsLabel} />
    </div>
  );
}
