// From CUPPEE Brand Foundation v0.1: warm cream + deep green foundation, orange accent.
// Exact values are placeholders until the brand palette is finalised.
export const colors = {
  cream: '#F4EBDD',
  creamDeep: '#EADCC6',
  green: '#1F4D3A',
  greenSoft: '#2F6B52',
  orange: '#E8743B',
  ink: '#1B1B18',
  muted: '#6B675E',
  white: '#FFFFFF',
  danger: '#B3261E',
  line: '#D9CBB4',
};

export const radius = { sm: 10, md: 16, lg: 24, pill: 999 };
export const space = (n: number) => n * 4;

export const type = {
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.green, letterSpacing: 0.2 },
  h2: { fontSize: 20, fontWeight: '700' as const, color: colors.ink },
  body: { fontSize: 16, color: colors.ink },
  small: { fontSize: 13, color: colors.muted },
};
