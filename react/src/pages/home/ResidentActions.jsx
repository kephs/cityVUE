import PresentationLink from "./PresentationLink.jsx";
import { actionHref, iconAsset, orderedEnabled, toneChoice } from "./presentationPolicy.js";

export default function ResidentActions({ actions, title }) {
  const enabled = orderedEnabled(actions).filter((action) => actionHref(action));
  if (!enabled.length) return null;
  return (
    <section className="reqro-home-actions" aria-labelledby="resident-actions-heading">
      <h2 id="resident-actions-heading" className="visually-hidden">{title}</h2>
      <div className="reqro-action-stack">
        {enabled.map((action) => (
          <article className={`reqro-action-card reqro-tone-${toneChoice(action.tone)}`} key={action.id}>
            <div className="reqro-action-icon" aria-hidden="true">
              {iconAsset(action.iconKey) && <img src={iconAsset(action.iconKey)} alt="" width="48" height="48" />}
            </div>
            <div className="reqro-action-copy"><h3>{action.title}</h3><p>{action.description}</p></div>
            <PresentationLink className="reqro-action-button" action={action}>
              {action.actionType === "phone" && <i className="bi bi-telephone-fill" aria-hidden="true" />}
              {action.ctaLabel}
            </PresentationLink>
          </article>
        ))}
      </div>
    </section>
  );
}
