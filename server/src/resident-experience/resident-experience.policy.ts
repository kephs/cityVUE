// Packaged assets only. Paths are implementation metadata, never tenant input.
export const residentAssets = {
  'reqro-mark': {
    role: 'logo',
    path: '/branding/reqro/branding/reqro-mark-transparent.png',
  },
  'reqro-wordmark': {
    role: 'wordmark',
    path: '/branding/reqro/branding/reqro-wordmark-white-transparent.png',
  },
  'reqro-favicon': {
    role: 'favicon',
    path: '/branding/reqro/reqro-favicon-32.png',
  },
  'reqro-scenery': {
    role: 'hero',
    path: '/branding/reqro/hero/reqro-home-background.png',
  },
} as const;
export const residentActionIcons = ['report', 'emergency', 'water'] as const;
export const residentBenefitIcons = [
  'residents',
  'responsive',
  'operations',
  'community',
] as const;
export const residentRoutes = ['/', '/report'] as const;
export const residentThemes = ['reqro'] as const;
export const residentTones = ['primary', 'danger', 'warning'] as const;
