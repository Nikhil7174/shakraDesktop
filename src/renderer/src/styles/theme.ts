import type { ThemeConfig } from 'antd';
import { colors, spacing, borderRadius, typography } from './index';

export const theme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary.main,
    colorSuccess: colors.success.main,
    colorWarning: colors.warning.main,
    colorError: colors.error.main,
    colorInfo: colors.info.main,
    colorTextBase: colors.neutral[900],
    colorBgBase: colors.background.primary,
    colorBgLayout: colors.background.secondary,
    borderRadius: borderRadius.lg,
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.primary,
    boxShadow: colors.shadows.sm,
    boxShadowSecondary: colors.shadows.md,
  },
  components: {
    Button: {
      controlHeight: 44,
      borderRadius: borderRadius.md,
      fontWeight: typography.fontWeight.medium,
      primaryShadow: colors.shadows.primary,
    },
    Card: {
      borderRadius: borderRadius.xl,
      boxShadow: colors.shadows.sm,
      paddingLG: spacing.xl,
    },
    Typography: {
      titleMarginBottom: '0.5em',
      titleMarginTop: 0,
    },
  },
};

