export const tokens = {
  brand: { primary: '#437118', navigation: '#1D2A62', accent: '#87AECE', lime: '#AFD06E', warm: '#F5F3D8' },
  background: '#F6F7F9', surface: '#FFFFFF', surfaceSubtle: '#F0F2F5', surfaceSelected: '#EDF3F8',
  border: '#DCE1E7', textPrimary: '#202936', textSecondary: '#596575', textDisabled: '#8A929E',
  success: '#287849', warning: '#A66A08', error: '#C43838', info: '#326D9C',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  type: { page: 28, section: 20, card: 16, body: 14, label: 13, helper: 12 },
  space: [4, 8, 12, 16, 20, 24, 32, 40, 48],
  radius: { control: 8, card: 12 },
  shadow: '0 8px 28px rgba(29, 42, 62, 0.12)',
  sidebar: { expanded: 240, collapsed: 80 },
};

// Both Ant Design and the small shell CSS layer consume this single source.
export const cssVariables = {
  ...Object.fromEntries(Object.entries(tokens.brand).map(([key,value])=>[`--gs-brand-${key}`,value])),
  ...Object.fromEntries(['background','surface','surfaceSubtle','surfaceSelected','border','textPrimary','textSecondary','textDisabled','success','warning','error','info','fontFamily','shadow'].map(key=>[`--gs-${key.replace(/[A-Z]/g,c=>`-${c.toLowerCase()}`)}`,tokens[key]])),
  ...Object.fromEntries(tokens.space.map(value=>[`--gs-space-${value}`,`${value}px`])),
};
