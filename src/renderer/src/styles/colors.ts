// src/styles/colors.ts
export const colors = {
  // Primary palette
  primary: {
    main: '#0958d9',
    light: '#4096ff',
    dark: '#003eb3',
    contrast: '#ffffff',
  },

  // Neutral palette
  neutral: {
    900: '#141414',  // Almost black - headings
    800: '#262626',  // Dark gray
    700: '#434343',
    600: '#595959',  // Body text
    500: '#8c8c8c',  // Muted text
    400: '#bfbfbf',
    300: '#d9d9d9',  // Borders
    200: '#e8e8e8',  // Light borders
    100: '#f0f0f0',  // Very light gray
    50: '#fafafa',   // Background
    0: '#ffffff',    // White
  },

  // Semantic colors
  success: {
    main: '#52c41a',
    light: '#95de64',
    dark: '#389e0d',
  },

  warning: {
    main: '#faad14',
    light: '#ffc53d',
    dark: '#d48806',
  },

  error: {
    main: '#ff4d4f',
    light: '#ff7875',
    dark: '#cf1322',
  },

  info: {
    main: '#1890ff',
    light: '#40a9ff',
    dark: '#096dd9',
  },

  // Background colors
  background: {
    primary: '#ffffff',
    secondary: '#fafafa',
    tertiary: '#fafafa',
    elevated: '#ffffff',
    overlay: 'rgba(0, 0, 0, 0.45)',
  },

  // Special colors
  link: '#0958d9',
  divider: '#f0f0f0',

  // Card theme colors - matching website theme
  card: {
    dark: {
      background: '#262626', // Dark gray matching website theme
      text: '#ffffff', // White text
      subtitle: '#d9d9d9', // Light gray subtitle
      circle: '#0958d9', // Primary blue circle
    },
    light: {
      background: '#ffffff', // White background
      text: '#141414', // Dark text
      subtitle: '#595959', // Gray subtitle
      circle: '#4096ff', // Light blue circle
    },
  },

  // Gradient colors - matching website theme
  gradient: {
    primary: 'linear-gradient(135deg, #4096ff 0%, #0958d9 100%)',
    button: 'linear-gradient(135deg, #4096ff 0%, #0958d9 100%)',
  },

  // Shadows (technically not colors but related to design system)
  shadows: {
    xs: '0 1px 2px rgba(0, 0, 0, 0.04)',
    sm: '0 2px 8px rgba(0, 0, 0, 0.06)',
    md: '0 4px 12px rgba(0, 0, 0, 0.08)',
    lg: '0 8px 24px rgba(0, 0, 0, 0.10)',
    xl: '0 16px 48px rgba(0, 0, 0, 0.12)',
    primary: '0 8px 24px rgba(9, 88, 217, 0.1)',
  },
} as const;

// Type-safe color getter
export type ColorPath =
  | `primary.${keyof typeof colors.primary}`
  | `neutral.${keyof typeof colors.neutral}`
  | `success.${keyof typeof colors.success}`
  | `warning.${keyof typeof colors.warning}`
  | `error.${keyof typeof colors.error}`
  | `info.${keyof typeof colors.info}`
  | `background.${keyof typeof colors.background}`
  | keyof typeof colors.shadows;

