import { useState, useCallback } from "react";

interface UseApiState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

interface UseApiReturn<T> extends UseApiState<T> {
  execute: (...args: unknown[]) => Promise<T | undefined>;
  reset: () => void;
}

export function useApi<T>(
  apiFunc: (...args: unknown[]) => Promise<T>,
): UseApiReturn<T> {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    isLoading: false,
    error: null,
  });

  const execute = useCallback(
    async (...args: unknown[]): Promise<T | undefined> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const result = await apiFunc(...args);
        setState({ data: result, isLoading: false, error: null });
        return result;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "An error occurred";
        setState({ data: null, isLoading: false, error: message });
        return undefined;
      }
    },
    [apiFunc],
  );

  const reset = useCallback(() => {
    setState({ data: null, isLoading: false, error: null });
  }, []);

  return { ...state, execute, reset };
}
