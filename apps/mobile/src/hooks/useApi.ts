import { useState, useCallback } from 'react';

interface UseApiState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

interface UseApiReturn<T> extends UseApiState<T> {
  execute: (...args: unknown[]) => Promise<T | undefined>;
  reset: () => void;
}

export function useApi<T>(
  apiFunction: (...args: unknown[]) => Promise<T>,
): UseApiReturn<T> {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    error: null,
    isLoading: false,
  });

  const execute = useCallback(
    async (...args: unknown[]): Promise<T | undefined> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const result = await apiFunction(...args);
        setState({ data: result, error: null, isLoading: false });
        return result;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred';
        setState((prev) => ({ ...prev, error: message, isLoading: false }));
        return undefined;
      }
    },
    [apiFunction],
  );

  const reset = useCallback(() => {
    setState({ data: null, error: null, isLoading: false });
  }, []);

  return { ...state, execute, reset };
}
