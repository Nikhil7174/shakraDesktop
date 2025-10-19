import { useState, useEffect } from 'react';
import { getMonacoPromise, isMonacoReady as checkMonacoReady } from '../config/monaco';

interface UseMonacoResult {
  isMonacoReady: boolean;
  isMonacoLoading: boolean;
  monacoError: string | null;
}

/**
 * Hook to manage Monaco Editor initialization
 * Only initializes Monaco when the component mounts
 */
export const useMonaco = (): UseMonacoResult => {
  const [isMonacoReady, setIsMonacoReady] = useState(false);
  const [isMonacoLoading, setIsMonacoLoading] = useState(false);
  const [monacoError, setMonacoError] = useState<string | null>(null);

  useEffect(() => {
    // Check if Monaco is already ready
    if (checkMonacoReady()) {
      setIsMonacoReady(true);
      return;
    }

    // Initialize Monaco lazily
    const initializeMonaco = async () => {
      setIsMonacoLoading(true);
      setMonacoError(null);

      try {
        await getMonacoPromise();
        setIsMonacoReady(true);
        console.log('Monaco Editor ready for use');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to initialize Monaco Editor';
        setMonacoError(errorMessage);
        console.error('Monaco initialization failed:', error);
      } finally {
        setIsMonacoLoading(false);
      }
    };

    initializeMonaco();
  }, []);

  return {
    isMonacoReady,
    isMonacoLoading,
    monacoError,
  };
};
