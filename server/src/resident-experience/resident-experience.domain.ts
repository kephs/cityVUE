import { BadRequestException } from '@nestjs/common';
import { approvedDestination } from '../catalog/issue-action.domain.js';
import {
  residentAssets,
  residentActionIcons,
  residentBenefitIcons,
  residentRoutes,
  residentThemes,
  residentTones,
} from './resident-experience.policy.js';

type RecordValue = Record<string, unknown>;
export interface ResidentContact {
  id: string;
  kind: 'phone';
  classification: 'emergency' | 'non_emergency';
  displayValue: string;
  phoneTarget: string;
  guidance: string;
}
export interface ResidentLink {
  id: string;
  label: string;
  actionType: 'internal' | 'external';
  target: string;
}
export interface ResidentPresentation {
  branding: {
    applicationName: string;
    organizationDisplayName: string | null;
    logoKey: string;
    wordmarkKey: string;
    faviconKey: string;
    themeKey: 'reqro';
  };
  metadata: { title: string; description: string };
  navigation: {
    label: string;
    homeSuffix: string;
    menu: string;
    openMenu: string;
    closeMenu: string;
    staff: string;
    signIn: string;
    signOut: string;
    links: ResidentLink[];
  };
  hero: {
    taglineWords: string[];
    headline: { text: string; highlighted: boolean }[];
    assetKey: string;
    decorative: boolean;
    alt: string;
  };
  actionsTitle: string;
  benefitsLabel: string;
  footer: {
    tagline: string;
    wordmarkKey: string;
    showThemeToggle: boolean;
    switchToDark: string;
    switchToLight: string;
    links: ResidentLink[];
  };
}
export interface ResidentAction {
  id: string;
  enabled: boolean;
  order: number;
  iconKey: string;
  title: string;
  description: string;
  // Phone labels are constructed from this number-free label plus the referenced displayValue.
  ctaLabel: string;
  actionType: 'internal' | 'external' | 'phone';
  target: string | null;
  contactId: string | null;
  tone: 'primary' | 'danger' | 'warning';
}
export interface ResidentBenefit {
  id: string;
  enabled: boolean;
  order: number;
  iconKey: string;
  title: string;
  description: string;
}
export interface ResidentSnapshot {
  schemaVersion: 1;
  presentation: ResidentPresentation;
  actions: ResidentAction[];
  benefits: ResidentBenefit[];
  contacts: ResidentContact[];
}
function invalid(): never {
  throw new BadRequestException('Invalid resident experience configuration');
}
function record(value: unknown, keys: readonly string[]): RecordValue {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  const result = value as RecordValue;
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(result, key))
  )
    invalid();
  return result;
}
function text(value: unknown, max: number, empty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[<>\p{Cc}\p{Cf}\p{Cs}]/u.test(value)
  )
    invalid();
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid();
  return value as T;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value as unknown[];
}
function id(value: unknown): string {
  const result = text(value, 48);
  if (!/^[a-z][a-z0-9-]*$/.test(result)) invalid();
  return result;
}
function order(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 10000
  )
    invalid();
  return value;
}
function asset(
  value: unknown,
  role: (typeof residentAssets)[keyof typeof residentAssets]['role'],
): string {
  if (
    typeof value !== 'string' ||
    !Object.hasOwn(residentAssets, value) ||
    residentAssets[value as keyof typeof residentAssets].role !== role
  )
    invalid();
  return value;
}
function destination(type: 'internal' | 'external', value: unknown): string {
  const target = text(value, 2048);
  if (type === 'internal') return choice(target, residentRoutes);
  // Reject encoded control, backslash and markup tricks, including nested encoding.
  let decoded = target;
  for (let count = 0; count < 5; count++) {
    if (/[<>\\\p{Cc}\p{Cf}\p{Cs}]/u.test(decoded)) invalid();
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      invalid();
    }
    if (next === decoded) return approvedDestination(target);
    decoded = next;
  }
  invalid();
}
function unique<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length) invalid();
  return items;
}
function ordered<T extends { id: string; order: number }>(items: T[]): T[] {
  unique(items);
  if (new Set(items.map((item) => item.order)).size !== items.length) invalid();
  return items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
function links(value: unknown, max: number): ResidentLink[] {
  return unique(
    array(value, max).map((entry) => {
      const link = record(entry, ['id', 'label', 'actionType', 'target']);
      const actionType = choice(link.actionType, ['internal', 'external']);
      return {
        id: id(link.id),
        label: text(link.label, 80),
        actionType,
        target: destination(actionType, link.target),
      };
    }),
  );
}
export function validatePhone(
  displayValue: unknown,
  phoneTarget: unknown,
): { displayValue: string; phoneTarget: string } {
  const display = text(displayValue, 32),
    target = text(phoneTarget, 16);
  if (!/^\+?[0-9]{2,15}$/.test(target)) invalid();

  // Consume each character once: optional leading +, digit groups (optionally
  // parenthesized), and at most one space/dot/hyphen between groups. No backtracking.
  const isDigit = (character: string | undefined): boolean =>
    character !== undefined && character >= '0' && character <= '9';
  let normalized = display.startsWith('+') ? '+' : '';
  let index = normalized.length;
  while (index < display.length) {
    const parenthesized = display[index] === '(';
    if (parenthesized) index++;
    const start = index;
    while (isDigit(display[index])) normalized += display.charAt(index++);
    if (index === start) invalid();
    if (parenthesized) {
      if (display[index] !== ')') invalid();
      index++;
    }
    const separator = display[index];
    if (separator === ' ' || separator === '.' || separator === '-') {
      index++;
      if (index === display.length) invalid();
    }
  }
  if (normalized !== target) invalid();
  return { displayValue: display, phoneTarget: target };
}
function presentation(value: unknown): ResidentPresentation {
  const p = record(value, [
    'branding',
    'metadata',
    'navigation',
    'hero',
    'actionsTitle',
    'benefitsLabel',
    'footer',
  ]);
  const b = record(p.branding, [
    'applicationName',
    'organizationDisplayName',
    'logoKey',
    'wordmarkKey',
    'faviconKey',
    'themeKey',
  ]);
  const m = record(p.metadata, ['title', 'description']);
  const n = record(p.navigation, [
    'label',
    'homeSuffix',
    'menu',
    'openMenu',
    'closeMenu',
    'staff',
    'signIn',
    'signOut',
    'links',
  ]);
  const h = record(p.hero, [
    'taglineWords',
    'headline',
    'assetKey',
    'decorative',
    'alt',
  ]);
  const f = record(p.footer, [
    'tagline',
    'wordmarkKey',
    'showThemeToggle',
    'switchToDark',
    'switchToLight',
    'links',
  ]);
  const words = array(h.taglineWords, 4).map((word) => text(word, 40));
  const headline = array(h.headline, 4).map((entry) => {
    const segment = record(entry, ['text', 'highlighted']);
    return {
      text: text(segment.text, 160),
      highlighted: bool(segment.highlighted),
    };
  });
  if (
    !words.length ||
    !headline.length ||
    headline.reduce((length, segment) => length + segment.text.length, 0) > 200
  )
    invalid();
  const decorative = bool(h.decorative),
    alt = text(h.alt, 240, decorative);
  if (decorative && alt !== '') invalid();
  const navigationLinks = links(n.links, 4);
  if (
    !navigationLinks.length ||
    navigationLinks[0]?.actionType !== 'internal' ||
    navigationLinks[0].target !== '/'
  )
    invalid();
  return {
    branding: {
      applicationName: text(b.applicationName, 100),
      organizationDisplayName:
        b.organizationDisplayName === null
          ? null
          : text(b.organizationDisplayName, 100),
      logoKey: asset(b.logoKey, 'logo'),
      wordmarkKey: asset(b.wordmarkKey, 'wordmark'),
      faviconKey: asset(b.faviconKey, 'favicon'),
      themeKey: choice(b.themeKey, residentThemes),
    },
    metadata: {
      title: text(m.title, 160),
      description: text(m.description, 320),
    },
    navigation: {
      label: text(n.label, 80),
      homeSuffix: text(n.homeSuffix, 40),
      menu: text(n.menu, 40),
      openMenu: text(n.openMenu, 80),
      closeMenu: text(n.closeMenu, 80),
      staff: text(n.staff, 80),
      signIn: text(n.signIn, 80),
      signOut: text(n.signOut, 80),
      links: navigationLinks,
    },
    hero: {
      taglineWords: words,
      headline,
      assetKey: asset(h.assetKey, 'hero'),
      decorative,
      alt,
    },
    actionsTitle: text(p.actionsTitle, 100),
    benefitsLabel: text(p.benefitsLabel, 100),
    footer: {
      tagline: text(f.tagline, 160),
      wordmarkKey: asset(f.wordmarkKey, 'wordmark'),
      showThemeToggle: bool(f.showThemeToggle),
      switchToDark: text(f.switchToDark, 80),
      switchToLight: text(f.switchToLight, 80),
      links: links(f.links, 4),
    },
  };
}
export function validateResidentSnapshot(value: unknown): ResidentSnapshot {
  const root = record(value, [
    'schemaVersion',
    'presentation',
    'actions',
    'benefits',
    'contacts',
  ]);
  if (root.schemaVersion !== 1) invalid();
  const contacts = unique(
    array(root.contacts, 12).map((entry): ResidentContact => {
      const c = record(entry, [
        'id',
        'kind',
        'classification',
        'displayValue',
        'phoneTarget',
        'guidance',
      ]);
      return {
        id: id(c.id),
        kind: choice(c.kind, ['phone']),
        classification: choice(c.classification, [
          'emergency',
          'non_emergency',
        ]),
        ...validatePhone(c.displayValue, c.phoneTarget),
        guidance: text(c.guidance, 500, true),
      };
    }),
  ).sort((a, b) => a.id.localeCompare(b.id));
  const actions = ordered(
    array(root.actions, 6).map((entry): ResidentAction => {
      const a = record(entry, [
        'id',
        'enabled',
        'order',
        'iconKey',
        'title',
        'description',
        'ctaLabel',
        'actionType',
        'target',
        'contactId',
        'tone',
      ]);
      const actionType = choice(a.actionType, [
        'internal',
        'external',
        'phone',
      ]);
      const ctaLabel = text(a.ctaLabel, 80);
      let target: string | null = null,
        contactId: string | null = null;
      if (actionType === 'phone') {
        contactId = id(a.contactId);
        if (
          a.target !== null ||
          !contacts.some((contact) => contact.id === contactId) ||
          /\p{N}/u.test(ctaLabel)
        )
          invalid();
      } else {
        if (a.contactId !== null) invalid();
        target = destination(actionType, a.target);
      }
      return {
        id: id(a.id),
        enabled: bool(a.enabled),
        order: order(a.order),
        iconKey: choice(a.iconKey, residentActionIcons),
        title: text(a.title, 100),
        description: text(a.description, 320),
        ctaLabel,
        actionType,
        target,
        contactId,
        tone: choice(a.tone, residentTones),
      };
    }),
  );
  const benefits = ordered(
    array(root.benefits, 4).map((entry): ResidentBenefit => {
      const b = record(entry, [
        'id',
        'enabled',
        'order',
        'iconKey',
        'title',
        'description',
      ]);
      return {
        id: id(b.id),
        enabled: bool(b.enabled),
        order: order(b.order),
        iconKey: choice(b.iconKey, residentBenefitIcons),
        title: text(b.title, 100),
        description: text(b.description, 240),
      };
    }),
  );
  const result: ResidentSnapshot = {
    schemaVersion: 1,
    presentation: presentation(root.presentation),
    actions,
    benefits,
    contacts,
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 65536) invalid();
  return result;
}

export interface ResidentChanges {
  changedFields: string[];
  consequential: boolean;
  reasons: string[];
}
/** Collection IDs and arbitrary content never enter audit paths. Conservative whole-section classification. */
export function classifyResidentChanges(
  before: ResidentSnapshot | null,
  after: ResidentSnapshot,
): ResidentChanges {
  const changedFields: string[] = [],
    reasons: string[] = [];
  for (const key of [
    'branding',
    'metadata',
    'navigation',
    'hero',
    'actionsTitle',
    'benefitsLabel',
    'footer',
  ] as const) {
    if (
      JSON.stringify(before?.presentation[key]) !==
      JSON.stringify(after.presentation[key])
    )
      changedFields.push(`presentation.${key}`);
  }
  for (const key of ['actions', 'benefits', 'contacts'] as const) {
    if (JSON.stringify(before?.[key] ?? []) !== JSON.stringify(after[key]))
      changedFields.push(key);
  }
  // All action/contact changes include removals, type switches, labels, guidance and ordering.
  if (changedFields.includes('actions')) reasons.push('actions_changed');
  if (changedFields.includes('contacts')) reasons.push('contacts_changed');
  for (const section of ['navigation', 'footer'] as const) {
    if (
      JSON.stringify(before?.presentation[section].links ?? []) !==
      JSON.stringify(after.presentation[section].links)
    )
      reasons.push(`${section}_links_changed`);
  }
  return { changedFields, consequential: reasons.length > 0, reasons };
}
