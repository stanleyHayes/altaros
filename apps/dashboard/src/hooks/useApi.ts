import { useState, useCallback } from "react";

interface UseApiState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

interface UseApiReturn<T, A extends unknown[]> extends UseApiState<T> {
  execute: (...args: A) => Promise<T | null>;
  reset: () => void;
}

export function useApi<T, A extends unknown[] = []>(
  apiFunction: (...args: A) => Promise<T>,
): UseApiReturn<T, A> {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    error: null,
    isLoading: false,
  });

  const execute = useCallback(
    async (...args: A): Promise<T | null> => {
      setState({ data: null, error: null, isLoading: true });
      try {
        const data = await apiFunction(...args);
        setState({ data, error: null, isLoading: false });
        return data;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        setState({ data: null, error: message, isLoading: false });
        return null;
      }
    },
    [apiFunction],
  );

  const reset = useCallback(() => {
    setState({ data: null, error: null, isLoading: false });
  }, []);

  return { ...state, execute, reset };
}
