// Client for the Jev Decisions API (the shape the Jev Tab Switcher uses). Returns null without a key.
export function makeJev(cfg, fetchImpl = fetch) {
  if (!cfg.apiKey) return null;
  return {
    async decide(body) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
      try {
        const res = await fetchImpl(cfg.endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const err = new Error(`decision api ${res.status}`);
          err.code = `jev_${res.status}`;
          throw err;
        }
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
