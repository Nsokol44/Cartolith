import { useState, useEffect, useRef } from 'react'
import { CONCEPTS, FIRST_STEPS } from '../gis-concepts'
import { samplesApi } from '../api'

// ── InfoDot ─────────────────────────────────────────────────────────────────
// A small "?" you can drop next to any label. Click for a plain-English blurb.
export function InfoDot({ concept, label, size = 15 }) {
  const c = CONCEPTS[concept]
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [open])
  if (!c) return null
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        title={`What is ${c.term.toLowerCase()}?`}
        aria-label={`What is ${c.term}?`}
        style={{
          width: size, height: size, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--bdr3)'}`,
          background: open ? 'var(--accent-dim)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--txt3)',
          fontSize: size * 0.62, fontWeight: 700, lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-body)', padding: 0,
        }}
      >?</button>
      {label && <span style={{ marginLeft: 5 }}>{label}</span>}
      {open && (
        <div className="fade-in" style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 60, width: 288,
          background: 'var(--bg3)', border: '1px solid var(--bdr2)', borderLeft: '3px solid var(--accent)',
          borderRadius: 'var(--rl)', padding: '12px 14px', boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          cursor: 'default', textAlign: 'left',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 14, color: 'var(--txt)', marginBottom: 5 }}>{c.term}</div>
          <div style={{ fontSize: 12, color: 'var(--txt)', lineHeight: 1.6, marginBottom: 8 }}>{c.long}</div>
          {c.when && <div style={{ fontSize: 11.5, color: 'var(--txt2)', lineHeight: 1.55, marginBottom: 8 }}><span style={{ color: 'var(--accent2)' }}>Use it: </span>{c.when}</div>}
          {c.example && (
            <div style={{ fontSize: 11, color: 'var(--txt2)', background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '7px 9px', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--accent3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Example</span><br />{c.example}
            </div>
          )}
        </div>
      )}
    </span>
  )
}

// ── ConceptCard ───────────────────────────────────────────────────────────────
// A friendly explainer block for empty states and the Learn drawer.
export function ConceptCard({ concept, accent = 'var(--accent2)' }) {
  const c = CONCEPTS[concept]
  if (!c) return null
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--bdr)', borderLeft: `3px solid ${accent}`, borderRadius: 'var(--r)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--txt)' }}>{c.term}</span>
        <span style={{ fontSize: 11.5, color: 'var(--txt3)' }}>{c.short}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.6 }}>{c.long}</div>
      {c.example && <div style={{ fontSize: 11.5, color: 'var(--txt3)', marginTop: 7, lineHeight: 1.5 }}><span style={{ color: 'var(--accent3)' }}>e.g. </span>{c.example}</div>}
    </div>
  )
}

// ── LearnDrawer ───────────────────────────────────────────────────────────────
// A right-hand slide-over: a 3-step first map, then a browsable glossary.
export function LearnDrawer({ open, onClose, onLoadSample }) {
  const [expanded, setExpanded] = useState(null)
  useEffect(() => {
    if (!open) return
    const onEsc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open, onClose])
  if (!open) return null
  const keys = Object.keys(CONCEPTS)
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} className="fade-in" style={{
        width: 'min(440px, 92vw)', height: '100%', background: 'var(--bg2)', borderLeft: '1px solid var(--bdr2)',
        display: 'flex', flexDirection: 'column', boxShadow: '-16px 0 40px rgba(0,0,0,0.4)',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 300, color: 'var(--txt)' }}>Learn GIS</div>
            <div style={{ fontSize: 11.5, color: 'var(--txt3)', marginTop: 2 }}>Mapping, in plain English. No prior experience needed.</div>
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div className="section-title">Make your first map</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {FIRST_STEPS.map(s => (
                <div key={s.n} style={{ display: 'flex', gap: 11 }}>
                  <div style={{ width: 22, height: 22, flexShrink: 0, borderRadius: '50%', background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{s.n}</div>
                  <div>
                    <div style={{ fontSize: 12.5, color: 'var(--txt)', fontWeight: 500 }}>{s.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--txt2)', lineHeight: 1.55, marginTop: 1 }}>{s.body}</div>
                  </div>
                </div>
              ))}
            </div>
            {onLoadSample && (
              <button className="btn sm primary" style={{ marginTop: 12, width: '100%' }} onClick={() => { onLoadSample(); onClose() }}>
                Load sample data & show me on the map
              </button>
            )}
          </div>
          <div>
            <div className="section-title">Glossary</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {keys.map(k => {
                const c = CONCEPTS[k]; const isOpen = expanded === k
                return (
                  <div key={k} style={{ border: '1px solid var(--bdr)', borderRadius: 'var(--r)', overflow: 'hidden', background: isOpen ? 'var(--bg3)' : 'transparent' }}>
                    <button onClick={() => setExpanded(isOpen ? null : k)} style={{
                      width: '100%', textAlign: 'left', padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    }}>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontSize: 12.5, color: 'var(--txt)', fontWeight: 500 }}>{c.term}</span>
                        {!isOpen && <span style={{ fontSize: 11, color: 'var(--txt3)' }}>{c.short}</span>}
                      </span>
                      <span style={{ color: 'var(--txt3)', fontSize: 12, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: '0 12px 11px' }}>
                        <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.6 }}>{c.long}</div>
                        {c.when && <div style={{ fontSize: 11.5, color: 'var(--txt2)', marginTop: 6 }}><span style={{ color: 'var(--accent2)' }}>Use it: </span>{c.when}</div>}
                        {c.example && <div style={{ fontSize: 11.5, color: 'var(--txt3)', marginTop: 6 }}><span style={{ color: 'var(--accent3)' }}>e.g. </span>{c.example}</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SampleDataButton ──────────────────────────────────────────────────────────
// Shared one-click loader used across empty states.
export function useSampleLoader(dispatch) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  async function load(which = 'both') {
    setLoading(true); setErr(null)
    try {
      const ids = which === 'both' ? ['world_cities', 'world_regions'] : [which]
      for (const id of ids) {
        try { const ds = await samplesApi.load(id); dispatch({ type: 'ADD_DATASET', dataset: ds }) }
        catch (e) { if (id === 'world_cities') throw e /* regions need geopandas; ok to skip */ }
      }
    } catch (e) { setErr(e.message?.split('\n')[0] || 'Could not load sample data.') }
    finally { setLoading(false) }
  }
  return { load, loading, err }
}
