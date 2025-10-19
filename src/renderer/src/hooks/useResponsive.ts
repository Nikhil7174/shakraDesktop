// src/hooks/useResponsive.ts
import { Grid } from 'antd';
import { useEffect, useState } from 'react';

const { useBreakpoint } = Grid;

export const useResponsive = () => {
  const screens = useBreakpoint();
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsMobile(!screens.md);
    setIsTablet(Boolean(screens.md && !screens.lg));
    setIsDesktop(Boolean(screens.lg));
  }, [screens]);

  return {
    isMobile,
    isTablet,
    isDesktop,
    screens,
  };
};