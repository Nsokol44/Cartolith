import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../store'
import { sqlApi } from '../api'
import { InfoDot, ConceptCard, useSampleLoader } from './Learn'

export default function SqlLabTab({ go }) {
  const { state, dispatch } = useApp()
  const [schema, setSchema] = useState(null)
  const [sql, setSql] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [savedMsg, setSavedMsg] = useState(null)
  const [openTable, setOpenTable] = useState(null)
  const editorRef = useRef(null)
  const sample = useSampleLoader(dispatch)

  const dsCount = Object.keys(state.datasets).length

  const loadSchema = useCallback(() => {
    sqlApi.schema().then(setSchema).catch(() => setSchema({ available: false, tables: [] }))
  }, [])
  useEffect(() => { loadSchema() }, [loadSchema, dsCount])

  const firstTable = schema?.tables?.[0]?.table
  useEffect(() => {
    if (!sql && firstTable) setSql(`SELECT *\nFROM ${firstTable}\nLIMIT 20;`)
  }, [firstTable]) // eslint-disable-line

  async function run() {
    const q = sql.trim()
    if (!q) return
    setRunning(true); setError(null); setSavedMsg(null)
    try {
      const r = await sqlApi.query(q, 1000)
      setResult(r)
      setHistory(h => [q, ...h.filter(x => x !== q)].slice(0, 12))
    } catch (e) {
      setError(e.message?.split('\n')[0] || String(e)); setResult(null)
    } finally { setRunning(false) }
  }

  function onEditorKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run() }
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.target, s = el.selectionStart, en = el.selectionEnd
      const next = sql.slice(0, s) + '  ' + sql.slice(en)
      setSql(next)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2 })
    }
  }

  function insertAtCursor(text) {
    const el = editorRef.current
    if (!el) { setSql(s => s + text); return }
    const s = el.selectionStart, en = el.selectionEnd
    setSql(sql.slice(0, s) + text + sql.slice(en))
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + text.length })
  }

  function exportCsv() {
    if (!result?.rows?.length) return
    const cols = result.columns
    const esc = v => v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)
    const csv = [cols.join(','), ...result.rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'query_result.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  async function saveAsDataset() {
    const name = saveName.trim() || 'query_result'
    setRunning(true); setError(null)
    try {
      const ds = await sqlApi.materialize(sql.trim(), name)
      dispatch({ type: 'ADD_DATASET', dataset: ds })
      setSaving(false); setSaveName('')
      setSavedMsg(`Saved "${ds.id}" — ${ds.shape[0]} rows. It's now in your datasets and works in every tab.`)
    } catch (e) { setError(e.message?.split('\n')[0] || String(e)) }
    finally { setRunning(false) }
  }

  const examples = firstTable ? [
    { label: 'Peek at rows', q: `SELECT *\nFROM ${firstTable}\nLIMIT 20;` },
    { label: 'Count rows', q: `SELECT count(*) AS n\nFROM ${firstTable};` },
    { label: 'Group & total', q: `SELECT <column>, count(*) AS n\nFROM ${firstTable}\nGROUP BY <column>\nORDER BY n DESC;` },
    ...(schema?.tables?.length > 1 ? [{ label: 'Join two tables', q: `SELECT a.*, b.*\nFROM ${schema.tables[0].table} a\nJOIN ${schema.tables[1].table} b\n  ON a.<key> = b.<key>\nLIMIT 50;` }] : []),
  ] : []

  // ── Empty state (no data yet) ───────────────────────────────────────────────
  if (dsCount === 0) {
    return (
      <div style={{ height: '100%', overflow: 'auto', padding: 24, display: 'flex', justifyContent: 'center' }}>
        <div style={{ maxWidth: 560, width: '100%', marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300 }}>SQL Lab</span>
            <InfoDot concept="sql" />
          </div>
          <div style={{ color: 'var(--txt2)', fontSize: 13, marginBottom: 18, lineHeight: 1.6 }}>
            Ask your data questions with SQL — filter, group, count, and join across every dataset you load. Results can become new datasets you keep using.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ConceptCard concept="sql" accent="var(--accent5)" />
            <ConceptCard concept="dataset" accent="var(--accent)" />
          </div>
          <div style={{ marginTop: 18, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 10 }}>Load a file from the left, or start with ready-made data:</div>
            <button className="btn primary" disabled={sample.loading} onClick={() => sample.load('both')}>
              {sample.loading ? 'Loading…' : 'Load sample data'}
            </button>
            {sample.err && <div className="error-box" style={{ marginTop: 12, textAlign: 'left' }}>{sample.err}</div>}
          </div>
        </div>
      </div>
    )
  }

  // ── Main workspace ──────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Schema browser */}
      <div style={{ width: 224, flexShrink: 0, borderRight: '1px solid var(--bdr)', background: 'var(--bg2)', overflow: 'auto', padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="section-title" style={{ margin: 0 }}>Tables</span>
          <span className="badge gray" title="Click a table or column to insert its name">{schema?.tables?.length || 0}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {schema?.tables?.map(t => {
            const isOpen = openTable === t.table
            return (
              <div key={t.table}>
                <div onClick={() => setOpenTable(isOpen ? null : t.table)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', borderRadius: 'var(--r)', cursor: 'pointer', background: isOpen ? 'var(--bg3)' : 'transparent' }}>
                  <span style={{ color: 'var(--txt3)', fontSize: 10, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>▸</span>
                  <span onClick={(e) => { e.stopPropagation(); insertAtCursor(t.table) }} className="mono" style={{ fontSize: 11.5, color: 'var(--accent5)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${t.id} · click to insert`}>{t.table}</span>
                  <span style={{ fontSize: 9.5, color: 'var(--txt4)' }}>{t.row_count}</span>
                </div>
                {isOpen && (
                  <div style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
                    {t.columns.map(col => (
                      <div key={col.name} onClick={() => insertAtCursor(col.name)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <span className="mono" style={{ color: 'var(--txt2)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.name}</span>
                        <span style={{ fontSize: 8.5, color: 'var(--txt4)' }}>{col.type.replace(/\d+/g, '')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {history.length > 0 && (
          <>
            <hr className="divider" />
            <span className="section-title">History</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {history.map((h, i) => (
                <div key={i} onClick={() => setSql(h)} className="mono" title={h} style={{ fontSize: 10.5, color: 'var(--txt3)', padding: '4px 6px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: 'var(--bg3)' }}>
                  {h.replace(/\s+/g, ' ')}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Editor + results */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--bdr)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 300 }}>SQL Lab</span>
            <InfoDot concept="sql" />
            {schema?.available && <span className="badge blue" title="Spatial ST_ functions load at run time when available"><InfoDot concept="spatial_sql" size={12} />&nbsp;spatial SQL</span>}
            <div style={{ flex: 1 }} />
            {examples.map((ex, i) => (
              <button key={i} className="tag" onClick={() => setSql(ex.q)}>{ex.label}</button>
            ))}
          </div>
          <textarea
            ref={editorRef}
            value={sql}
            onChange={e => setSql(e.target.value)}
            onKeyDown={onEditorKey}
            spellCheck={false}
            placeholder="SELECT * FROM …"
            style={{ width: '100%', minHeight: 96, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--bdr2)', borderRadius: 'var(--r)', color: 'var(--txt)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button className="btn primary sm" onClick={run} disabled={running}>{running ? 'Running…' : '▶ Run'}</button>
            <span style={{ fontSize: 10.5, color: 'var(--txt4)' }}>⌘/Ctrl + Enter</span>
            <div style={{ flex: 1 }} />
            {result && !error && (
              <span style={{ fontSize: 11, color: 'var(--txt3)' }}>
                {result.message ? result.message
                  : <>{result.total_rows != null ? result.total_rows.toLocaleString() : result.returned} rows{result.truncated ? ` · showing first ${result.returned}` : ''} · {result.elapsed_ms} ms{result.spatial ? ' · spatial on' : ''}</>}
              </span>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {error && <div className="error-box" style={{ marginBottom: 12 }}><strong>Query error</strong><br />{error}</div>}
          {savedMsg && <div className="result-box" style={{ marginBottom: 12 }}>✓ {savedMsg} {go && <button className="btn sm ghost" style={{ marginLeft: 6 }} onClick={() => go('Cartography')}>Open Cartography</button>}</div>}

          {result && result.rows?.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="section-title" style={{ margin: 0 }}>Result</span>
                <div style={{ flex: 1 }} />
                <button className="btn sm" onClick={exportCsv}>↓ Export CSV</button>
                {!saving
                  ? <button className="btn sm" onClick={() => { setSaving(true); setSaveName('') }} title="Turn this result into a reusable dataset">◇ Save as dataset</button>
                  : (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="dataset name" style={{ width: 150 }} onKeyDown={e => e.key === 'Enter' && saveAsDataset()} />
                      <button className="btn sm primary" onClick={saveAsDataset} disabled={running}>Save</button>
                      <button className="btn sm ghost" onClick={() => setSaving(false)}>Cancel</button>
                    </span>
                  )}
              </div>
              <div style={{ border: '1px solid var(--bdr)', borderRadius: 'var(--rl)', overflow: 'auto', maxHeight: '100%' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>{result.columns.map(c => (
                      <th key={c} style={{ padding: '7px 10px', textAlign: 'left', position: 'sticky', top: 0, background: 'var(--bg3)', borderBottom: '1px solid var(--bdr2)', whiteSpace: 'nowrap', color: 'var(--txt2)', fontWeight: 500, fontSize: 11 }}>{c}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--bdr)' }}>
                        {result.columns.map(c => {
                          const v = row[c]; const isNull = v === null || v === undefined
                          const isNum = typeof v === 'number'
                          return <td key={c} style={{ padding: '5px 10px', color: isNull ? 'var(--txt4)' : 'var(--txt)', fontFamily: isNum ? 'var(--font-mono)' : 'inherit', fontSize: isNum ? 11 : 12, textAlign: isNum ? 'right' : 'left', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isNull ? <span style={{ fontStyle: 'italic', fontSize: 10 }}>null</span> : String(v)}</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {result && result.rows?.length === 0 && !error && (
            <div className="empty-state">{result.message || 'No rows returned.'}</div>
          )}
          {!result && !error && (
            <div style={{ maxWidth: 520 }}>
              <ConceptCard concept="sql" accent="var(--accent5)" />
              <div style={{ fontSize: 11.5, color: 'var(--txt3)', marginTop: 10, lineHeight: 1.7 }}>
                Click a table on the left to see its columns, or a chip above to drop in a starter query. Replace the <span className="mono" style={{ color: 'var(--accent3)' }}>&lt;column&gt;</span> placeholders with real column names, then Run.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
