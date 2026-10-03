import {
  validateResidentSnapshot,
  type ResidentAction,
  type ResidentBenefit,
  type ResidentPresentation,
} from './resident-experience.domain.js';

export interface PublicResidentAction extends Omit<
  ResidentAction,
  'contactId' | 'target'
> {
  target: string;
}
/** Versioned public wire contract; no persistence identifiers or contact history. */
export interface PublicResidentExperienceDto {
  schemaVersion: 1;
  configuration: {
    presentation: ResidentPresentation;
    actions: PublicResidentAction[];
    benefits: ResidentBenefit[];
  } | null;
}

export function projectPublishedResidentExperience(
  input: unknown,
): PublicResidentExperienceDto {
  const snapshot = validateResidentSnapshot(input);
  return {
    schemaVersion: 1,
    configuration: {
      presentation: snapshot.presentation,
      actions: snapshot.actions
        .filter((a) => a.enabled)
        .map((a) => {
          const contact = snapshot.contacts.find((c) => c.id === a.contactId);
          const target = contact?.phoneTarget ?? a.target;
          if (target === null) throw new Error('Invalid public action');
          return {
            id: a.id,
            enabled: true,
            order: a.order,
            iconKey: a.iconKey,
            title: a.title,
            description: a.description,
            ctaLabel: contact
              ? a.ctaLabel === '{phone}'
                ? contact.displayValue
                : `${a.ctaLabel} ${contact.displayValue}`
              : a.ctaLabel,
            actionType: a.actionType,
            target,
            tone: a.tone,
          };
        }),
      benefits: snapshot.benefits.filter((b) => b.enabled),
    },
  };
}
