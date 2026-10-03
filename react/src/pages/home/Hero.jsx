import ResidentActions from "./ResidentActions.jsx";
import { localAsset, actionHref, orderedEnabled } from "./presentationPolicy.js";

export default function Hero({ presentation }) {
  const { tagline, hero, actions, actionsTitle } = presentation;
  const hasActions = orderedEnabled(actions).some((action) => actionHref(action));
  return (
    <section className={`reqro-hero${hasActions ? "" : " reqro-hero-no-actions"}`} aria-labelledby="reqro-home-heading">
      <div className="reqro-home-container reqro-hero-content">
        <div className="reqro-hero-heading">
          <p className="reqro-home-tagline">
            {tagline.words.map((word, index) => (
              <span className="reqro-tagline-word" key={`${index}-${word}`}>
                {index > 0 && <> <span className={`reqro-home-dot${tagline.separatorTone === "accent" ? " is-accent" : ""}`} aria-hidden="true">{tagline.separator}</span> </>}
                {word}
              </span>
            ))}
          </p>
          <h1 id="reqro-home-heading">{hero.headline.map((segment, index) =>
            <span className={segment.highlighted ? "reqro-headline-highlight" : undefined} key={index}>{segment.text}</span>
          )}</h1>
        </div>
        <ResidentActions actions={actions} title={actionsTitle} />
      </div>
      <img className="reqro-hero-background" src={localAsset(hero.image)} width={hero.width} height={hero.height}
        alt={hero.decorative ? "" : hero.alt} aria-hidden={hero.decorative || undefined} fetchPriority="high" />
    </section>
  );
}
