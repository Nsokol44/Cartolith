// ─────────────────────────────────────────────────────────────────────────────
// A deliberately tiny event bus so app actions can report "this happened"
// without knowing anything about lessons.
//
// Some lesson steps can be verified from app state alone (a dataset exists,
// two variables are selected). Others are actions that leave no trace in
// state — running a query, dragging the time slider, switching a
// classification method. Those call fireLessonEvent() at the point the action
// succeeds.
//
// Design rules:
//   - Firing an event is fire-and-forget. Nothing breaks if no one is
//     listening, which is the normal case (no lesson running).
//   - Never put user data in an event. The name is the whole payload.
//   - Call it AFTER the action succeeds, not when it is attempted, so a
//     failed query does not tick off "ran a query".
//
// This file imports nothing, so any component can use it without pulling in
// the lesson corpus.
// ─────────────────────────────────────────────────────────────────────────────

const listeners = new Set()

/** Report that something happened. Safe to call from anywhere, any time. */
export function fireLessonEvent(name) {
  if (!name) return
  listeners.forEach(fn => {
    try { fn(name) } catch { /* a broken listener must not break the app */ }
  })
}

/** Subscribe. Returns an unsubscribe function for useEffect cleanup. */
export function onLessonEvent(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
