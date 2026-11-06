import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** True only for the latest request of the path that is still on screen. */
export function responseStillCurrent(requestGen, currentGen, requestPath, currentPath) {
  return requestGen === currentGen && requestPath === currentPath;
}

/** Fetch `path` and refetch whenever any value in `deps` changes. */
export function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const pathRef = useRef(path);
  const gen = useRef(0);
  useEffect(() => {
    if (!path) return undefined;
    const requestGen = ++gen.current;
    const requestPath = path;
    const pathChanged = pathRef.current !== path;
    pathRef.current = path;
    if (pathChanged) setData(null);
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api(path, { signal: ctrl.signal })
      .then((d) => {
        // A slower response for an older path or an older refresh must not replace the current one.
        if (!responseStillCurrent(requestGen, gen.current, requestPath, pathRef.current)) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!responseStillCurrent(requestGen, gen.current, requestPath, pathRef.current)) return;
        if (e.name !== 'AbortError') setError(e);
      })
      .finally(() => {
        if (requestGen === gen.current && !ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
