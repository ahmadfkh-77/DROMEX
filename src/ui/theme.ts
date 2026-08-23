export const colors = {
  brand: '#C84B31',
  brandDark: '#8E2E1B',
  navy: '#173F67',
  navyDeep: '#082D61',
  cream: '#FFF8ED',
  creamSoft: '#F5F2EC',
  ink: '#17212B',
  muted: '#65717D',
  background: '#F5F2EC',
  surface: '#FFFFFF',
  line: '#DDD7CC',
  success: '#287A55',
  warning: '#9A6512',
  danger: '#B3261E',
  result: '#087F8C',
  resultDark: '#04545D',
  resultSoft: '#DDF7F5',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
export const radius = { sm: 10, md: 13, lg: 16, xl: 19, pill: 999 } as const;
export const typography = {
  eyebrow: { fontSize: 11, fontWeight: '900' as const, letterSpacing: 1.4 },
  pageTitle: { fontSize: 28, fontWeight: '900' as const },
  sectionTitle: { fontSize: 19, fontWeight: '900' as const },
  cardTitle: { fontSize: 16, fontWeight: '900' as const },
  body: { fontSize: 14, lineHeight: 20 },
  helper: { fontSize: 13, lineHeight: 19 },
} as const;
