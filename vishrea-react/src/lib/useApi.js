import { useCallback, useEffect, useRef, useState } from 'react';
import { cachedGet, peekCached } from './api';

/**
 * Load JSON from `path` (re-fetching when it changes) through the shared GET layer. Only the
 * newest load may update state, so a stale response never overwrites a newer one. `maxAge` (ms)
 * reuses a recent response and is meant for public data only.
 */
export function useApi(path, { enabled = true, maxAge = 0 } = {}) {
  const [state, setState] = useState(() => {
    const cached = path && enabled ? peekCached(path, maxAge) : undefined;
    return { data: cached ?? null, error: null, loading: Boolean(path && enabled) && cached === undefined };
  });
  const seq = useRef(0);

  const load = useCallback(
    async ({ fresh = false } = {}) => {
      if (!path || !enabled) return;
      const id = ++seq.current;
      const cached = fresh ? undefined : peekCached(path, maxAge);
      if (cached !== undefined) {
        setState({ data: cached, error: null, loading: false });
        return;
      }
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await cachedGet(path, { maxAge: fresh ? 0 : maxAge });
        if (id === seq.current) setState({ data, error: null, loading: false });
      } catch (error) {
        if (id === seq.current) setState((s) => ({ ...s, error, loading: false }));
      }
    },
    [path, enabled, maxAge]
  );

  useEffect(() => {
    load();
    return () => {
      seq.current += 1;
    };
  }, [load]);

  const reload = useCallback(() => load({ fresh: true }), [load]);
  const setData = useCallback((data) => setState((s) => ({ ...s, data })), []);
  return { ...state, reload, setData };
}

/** Lock a mutation while it runs: prevents double submits and always restores interaction. */
export function useMutation(fn) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const run = useCallback(
    async (...args) => {
      if (busy.current) return undefined;
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [fn]
  );
  return { run, pending, error, setError };
}
