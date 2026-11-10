// app.bus: minimal event bus. on() returns an unsubscribe function; a throwing handler never stops the others.
function createBus() {
  const handlers = new globalThis.Map();
  const bus = {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      return () => bus.off(event, fn);
    },
    off(event, fn) { handlers.get(event)?.delete(fn); },
    emit(event, payload) {
      for (const fn of [...(handlers.get(event) || [])]) {
        try { fn(payload); } catch (e) { console.error(`handler for "${event}" failed`, e); }
      }
    },
  };
  return bus;
}
