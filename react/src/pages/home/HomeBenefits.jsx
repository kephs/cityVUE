import { iconAsset, orderedEnabled } from "./presentationPolicy.js";

export default function HomeBenefits({ benefits, label }) {
  const enabled = orderedEnabled(benefits);
  if (!enabled.length) return null;
  return (
    <section className="reqro-home-benefits" aria-label={label}>
      <div className="reqro-home-container reqro-benefits-grid">
        {enabled.map((benefit) => (
          <article key={benefit.id}>
            <span className="reqro-benefit-icon" aria-hidden="true">
              {iconAsset(benefit.iconKey) && <img src={iconAsset(benefit.iconKey)} alt="" width="44" height="44" />}
            </span>
            <div><h2>{benefit.title}</h2><p>{benefit.description}</p></div>
          </article>
        ))}
      </div>
    </section>
  );
}
