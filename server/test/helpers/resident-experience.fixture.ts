import type { ResidentSnapshot } from '../../src/resident-experience/resident-experience.domain.js';
export function residentFixture(): ResidentSnapshot {
  return {
    schemaVersion: 1,
    presentation: {
      branding: {
        applicationName: 'Synthetic Community',
        organizationDisplayName: null,
        logoKey: 'reqro-mark',
        wordmarkKey: 'reqro-wordmark',
        faviconKey: 'reqro-favicon',
        themeKey: 'reqro',
      },
      metadata: {
        title: 'Synthetic Community',
        description: 'Synthetic test presentation',
      },
      navigation: {
        label: 'Primary navigation',
        homeSuffix: 'home',
        menu: 'Menu',
        openMenu: 'Open menu',
        closeMenu: 'Close menu',
        staff: 'Service Requests',
        signIn: 'Staff sign in',
        signOut: 'Sign out',
        links: [
          { id: 'home', label: 'Home', actionType: 'internal', target: '/' },
        ],
      },
      hero: {
        taglineWords: ['People', 'Requests', 'Progress'],
        headline: [
          { text: 'Synthetic community ', highlighted: false },
          { text: 'connections.', highlighted: true },
        ],
        assetKey: 'reqro-scenery',
        decorative: true,
        alt: '',
      },
      actionsTitle: 'Resident Actions',
      benefitsLabel: 'Benefits',
      footer: {
        tagline: 'Synthetic footer',
        wordmarkKey: 'reqro-wordmark',
        showThemeToggle: true,
        switchToDark: 'Dark mode',
        switchToLight: 'Light mode',
        links: [],
      },
    },
    actions: [
      {
        id: 'report',
        enabled: true,
        order: 10,
        iconKey: 'report',
        title: 'Report a Concern',
        description: 'Submit a request',
        ctaLabel: 'Report',
        actionType: 'internal',
        target: '/report',
        contactId: null,
        tone: 'primary',
      },
    ],
    benefits: [
      {
        id: 'residents',
        enabled: true,
        order: 10,
        iconKey: 'residents',
        title: 'Connected residents',
        description: 'Synthetic benefit',
      },
    ],
    contacts: [],
  };
}
export function phoneFixture(): ResidentSnapshot {
  const result = residentFixture();
  result.contacts = [
    {
      id: 'help',
      kind: 'phone',
      classification: 'non_emergency',
      displayValue: '+1 (202) 555-0100',
      phoneTarget: '+12025550100',
      guidance: 'Synthetic test contact; not verified',
    },
  ];
  result.actions.push({
    id: 'help',
    enabled: true,
    order: 20,
    iconKey: 'water',
    title: 'Synthetic help',
    description: 'Fictional contact',
    ctaLabel: 'Call',
    actionType: 'phone',
    target: null,
    contactId: 'help',
    tone: 'warning',
  });
  return result;
}
