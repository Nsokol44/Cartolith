import { useState, useRef, useEffect, useCallback } from 'react'
import { useApp } from '../store'
import { notebookApi } from '../api'
import { fireLessonEvent } from '../lesson-events'

// ─────────────────────────────────────────────────────────────────────────────
// NotebookTab — a small Jupyter-style notebook wired to the app's own data.
//
// Cells share one Python namespace on the backend, so `df = ...` in one cell
// is visible in the next. Two helpers bridge the notebook and the rest of
// Cartolith: use('name') pulls a loaded dataset in as a DataFrame, and
// publish(df, 'name') pushes a result back out so it appears in Explore,
// Cartography and SQL Lab like any other dataset.
//
// Export produces a genuine .ipynb (validates against nbformat) or a .py that
// actually runs standalone — the exported script carries a small shim so
// use()/publish() still work outside the app.
// ─────────────────────────────────────────────────────────────────────────────

const STARTER = `# Your loaded datasets are available here.
# use('name') fetches one; publish(df, 'name') sends a result back to the app.

df = use('World cities')
df.head()`

let seq = 0
const newCell = (type = 'code', source = '') => ({
  id: `c${Date.now()}_${seq++}`,
  cell_type: type,
  source,
  stdout: '', stderr: '', result: null, table: null, image_b64: null,
  error: null, running: false, ran: false,
})

export default function NotebookTab() {
  const { state } = useApp()
  const [cells, setCells] = useState(() => [newCell('code', STARTER)])
  const [name, setName] = useState('cartolith-notebook')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    notebookApi.status()
      .then(s => setEnabled(s.enabled !== false))
      .catch(() => {/* backend may be older; assume available */})
  }, [])

  const patch = useCallback((id, p) => {
    setCells(cs => cs.map(c => (c.id === id ? { ...c, ...p } : c)))
  }, [])

  const runCell = useCallback(async (id) => {
    const cell = cells.find(c => c.id === id)
    if (!cell || cell.cell_type !== 'code') return
    patch(id, { running: true, error: null })
    try {
      const r = await notebookApi.execute(cell.source)
      if (r.ok) {
        fireLessonEvent('notebook:ran')
        if (/\bpublish\s*\(/.test(cell.source)) fireLessonEvent('notebook:published')
      }
      patch(id, {
        running: false, ran: true,
        stdout: r.stdout || '', stderr: r.stderr || '',
        result: r.result, table: r.table, image_b64: r.image_b64,
        error: r.ok ? null : (r.error || 'Execution failed'),
      })
    } catch (e) {
      patch(id, { running: false, ran: true, error: e.message || String(e) })
    }
  }, [cells, patch])

  async function runAll() {
    setBusy(true)
    // Sequential on purpose: cells share a namespace, so order matters.
    for (const c of cells) {
      if (c.cell_type === 'code') await runCell(c.id)
    }
    setBusy(false)
  }

  function addCell(type, afterId) {
    setCells(cs => {
      const i = afterId ? cs.findIndex(c => c.id === afterId) : cs.length - 1
      const next = [...cs]
      next.splice(i + 1, 0, newCell(type))
      return next
    })
  }

  const removeCell = (id) => setCells(cs => (cs.length > 1 ? cs.filter(c => c.id !== id) : cs))

  function moveCell(id, dir) {
    setCells(cs => {
      const i = cs.findIndex(c => c.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= cs.length) return cs
      const next = [...cs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function reset() {
    await notebookApi.reset().catch(() => {})
    setCells(cs => cs.map(c => ({
      ...c, stdout: '', stderr: '', result: null, table: null,
      image_b64: null, error: null, ran: false,
    })))
  }

  const exportAs = (format) =>
    notebookApi.download(
      cells.map(c => ({
        cell_type: c.cell_type, source: c.source,
        stdout: c.stdout, result: c.result, image_b64: c.image_b64,
      })),
      format, name,
    ).catch(e => alert(`Export failed: ${e.message}`))

  const dsNames = Object.values(state.datasets || {}).map(d => d.name || d.id)

  if (!enabled) {
    return (
      <div style={{ padding: 28, color: 'var(--txt2)', fontSize: 13, lineHeight: 1.7, maxWidth: 560 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--txt)', marginBottom: 8 }}>
          Notebook disabled
        </div>
        This server was started with <code style={S.code}>CARTOLITH_DISABLE_NOTEBOOK</code> set.
        Running Python cells executes code on the machine hosting the backend, so it is
        turned off on shared deployments. It is available when you run Cartolith locally.
      </div>
    )
  }

  return (
    <div style={S.wrap}>
      <div style={S.toolbar}>
        <button className="btn sm primary" onClick={runAll} disabled={busy}>
          {busy ? 'Running…' : '▶ Run all'}
        </button>
        <button className="btn sm" onClick={() => addCell('code')}>+ Code</button>
        <button className="btn sm" onClick={() => addCell('markdown')}>+ Text</button>
        <button className="btn sm" onClick={reset} title="Clear all variables and outputs">
          Restart kernel
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="notebook name" style={S.nameInput}
          />
          <button className="btn sm" onClick={() => exportAs('ipynb')}>Export .ipynb</button>
          <button className="btn sm" onClick={() => exportAs('py')}>Export .py</button>
        </div>
      </div>

      <div style={S.scroll}>
        <div style={S.helpBar}>
          <span><code style={S.code}>use('name')</code> load a dataset</span>
          <span><code style={S.code}>publish(df, 'name')</code> send a result back to the app</span>
          <span style={{ color: 'var(--txt3)' }}>pd, np, plt{' '}already imported</span>
          <span style={{ marginLeft: 'auto', color: 'var(--txt3)' }}>⌘/Ctrl + Enter to run a cell</span>
        </div>

        {dsNames.length > 0 && (
          <div style={S.dsBar}>
            Loaded: {dsNames.map((n, i) => (
              <code key={i} style={{ ...S.code, marginRight: 6 }}>{n}</code>
            ))}
          </div>
        )}

        {cells.map((c, i) => (
          <Cell
            key={c.id} cell={c} index={i}
            onChange={src => patch(c.id, { source: src })}
            onRun={() => runCell(c.id)}
            onAdd={type => addCell(type, c.id)}
            onRemove={() => removeCell(c.id)}
            onMove={dir => moveCell(c.id, dir)}
          />
        ))}
      </div>
    </div>
  )
}

// ── one cell ────────────────────────────────────────────────────────────────
function Cell({ cell, index, onChange, onRun, onAdd, onRemove, onMove }) {
  const ta = useRef(null)
  const isCode = cell.cell_type === 'code'

  // Grow the textarea to fit content — a fixed-height editor in a notebook is
  // miserable to work in.
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 44)}px`
  }, [cell.source])

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onRun() }
    if (e.key === 'Tab') {
      // Insert a real indent rather than losing focus.
      e.preventDefault()
      const el = e.target
      const { selectionStart: s, selectionEnd: end } = el
      const next = `${cell.source.slice(0, s)}    ${cell.source.slice(end)}`
      onChange(next)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4 })
    }
  }

  const hasOutput = cell.ran && (cell.stdout || cell.stderr || cell.result || cell.table || cell.image_b64 || cell.error)

  return (
    <div style={S.cell}>
      <div style={S.gutter}>
        <span style={S.cellLabel}>
          {isCode ? (cell.running ? '[*]' : cell.ran ? `[${index + 1}]` : '[ ]') : 'md'}
        </span>
        {isCode && (
          <button style={S.runBtn} onClick={onRun} disabled={cell.running} title="Run (⌘/Ctrl+Enter)">▶</button>
        )}
        <div style={{ flex: 1 }} />
        <button style={S.gBtn} onClick={() => onMove(-1)} title="Move up">↑</button>
        <button style={S.gBtn} onClick={() => onMove(1)} title="Move down">↓</button>
        <button style={S.gBtn} onClick={() => onAdd('code')} title="Add code cell below">+</button>
        <button style={{ ...S.gBtn, color: 'var(--accent3)' }} onClick={onRemove} title="Delete cell">✕</button>
      </div>

      <textarea
        ref={ta} value={cell.source} onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown} spellCheck={false}
        placeholder={isCode ? '# Python…' : 'Notes (markdown)…'}
        style={{ ...S.editor, fontFamily: isCode ? 'var(--font-mono)' : 'var(--font-body)' }}
      />

      {hasOutput && (
        <div style={S.output}>
          {cell.stdout && <pre style={S.pre}>{cell.stdout}</pre>}
          {cell.stderr && <pre style={{ ...S.pre, color: 'var(--accent3)' }}>{cell.stderr}</pre>}
          {cell.error && <pre style={{ ...S.pre, color: '#f87171' }}>{cell.error}</pre>}
          {cell.image_b64 && (
            <img
              src={`data:image/png;base64,${cell.image_b64}`} alt="plot"
              style={{ maxWidth: '100%', borderRadius: 'var(--r)', marginTop: 6 }}
            />
          )}
          {cell.table && <ResultTable table={cell.table} />}
          {!cell.table && cell.result && <pre style={{ ...S.pre, color: 'var(--accent2)' }}>{cell.result}</pre>}
        </div>
      )}
    </div>
  )
}

// ── DataFrame result ────────────────────────────────────────────────────────
function ResultTable({ table }) {
  const [rows, cols] = [table.rows || [], table.columns || []]
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginBottom: 4 }}>
        {table.shape?.[0]} rows × {table.shape?.[1]} cols
        {rows.length < (table.shape?.[0] || 0) && ` — showing first ${rows.length}`}
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>{cols.map((c, i) => <th key={i} style={S.th}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} style={S.td}>{v === null || v === undefined ? '—' : String(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── styles ──────────────────────────────────────────────────────────────────
const S = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px',
    borderBottom: '1px solid var(--bdr2)', flexShrink: 0, flexWrap: 'wrap',
  },
  nameInput: {
    background: 'var(--bg3)', border: '1px solid var(--bdr)', color: 'var(--txt)',
    borderRadius: 'var(--r)', padding: '4px 8px', fontSize: 11.5, width: 150,
    fontFamily: 'inherit',
  },
  scroll: { flex: 1, overflowY: 'auto', padding: '14px 16px 80px' },
  helpBar: {
    display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
    fontSize: 11, color: 'var(--txt2)', marginBottom: 8, paddingBottom: 8,
    borderBottom: '1px solid var(--bdr)',
  },
  dsBar: { fontSize: 11, color: 'var(--txt2)', marginBottom: 14 },
  code: {
    fontFamily: 'var(--font-mono)', fontSize: 10.5, background: 'var(--bg3)',
    border: '1px solid var(--bdr)', borderRadius: 3, padding: '1px 5px', color: 'var(--accent2)',
  },
  cell: {
    border: '1px solid var(--bdr)', borderRadius: 'var(--rl)', marginBottom: 10,
    background: 'var(--bg2)', overflow: 'hidden',
  },
  gutter: {
    display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px',
    borderBottom: '1px solid var(--bdr)', background: 'var(--bg3)',
  },
  cellLabel: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--txt3)', minWidth: 26 },
  runBtn: {
    background: 'transparent', border: '1px solid var(--bdr3)', color: 'var(--accent2)',
    borderRadius: 3, cursor: 'pointer', fontSize: 9, padding: '2px 7px', lineHeight: 1.4,
  },
  gBtn: {
    background: 'transparent', border: 'none', color: 'var(--txt3)',
    cursor: 'pointer', fontSize: 11, padding: '2px 5px', lineHeight: 1,
  },
  editor: {
    width: '100%', border: 'none', outline: 'none', resize: 'none',
    background: 'transparent', color: 'var(--txt)', fontSize: 12.5,
    lineHeight: 1.65, padding: '10px 12px', display: 'block', minHeight: 44,
  },
  output: { borderTop: '1px solid var(--bdr)', padding: '9px 12px', background: 'var(--bg)' },
  pre: {
    margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.55,
    color: 'var(--txt)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--bdr)', borderRadius: 'var(--r)' },
  table: { borderCollapse: 'collapse', fontSize: 11.5, width: '100%' },
  th: {
    textAlign: 'left', padding: '5px 9px', borderBottom: '1px solid var(--bdr2)',
    color: 'var(--txt2)', fontWeight: 500, whiteSpace: 'nowrap', background: 'var(--bg3)',
  },
  td: {
    padding: '4px 9px', borderBottom: '1px solid var(--bdr)', color: 'var(--txt)',
    whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 11,
  },
}
