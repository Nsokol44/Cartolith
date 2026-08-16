import { useState, useEffect } from "react"
import { useApp } from "../store"
import { api } from "../api"
import NetCDFExplorer from "./NetCDFExplorer"
import ExportPanel from "./ExportPanel"
import Suggestions from "./Suggestions"

export default function ExploreTab({ go }) {
  const { state, dispatch } = useApp()
  const [preview, setPreview] = useState(null)
  const [sort, setSort] = useState({ col: null, asc: true })
  const [search, setSearch] = useState("")
  const [filterCol, setFilterCol] = useState("")
  const [filterVal, setFilterVal] = useState("")
  const [filters, setFilters] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [showExport, setShowExport] = useState(false)
  const PAGE = 200
  const ds = state.activeDataset ? state.datasets[state.activeDataset] : null

  useEffect(() => {
    if (!state.activeDataset) return
    setLoading(true)
    api.getPreview(state.activeDataset, PAGE, page * PAGE)
      .then(p => { setPreview(p); setLoading(false) })
      .catch(() => setLoading(false))
  }, [state.activeDataset, page])

  function handleBandLoaded(result) {
    dispatch({ type: "UPDATE_DATASET", id: state.activeDataset, patch: { shape: result.shape, columns: result.columns, types: result.types } })
    setPreview({ ...result.preview, total_rows: result.shape[0] })
  }

  if (!ds) return (
    <div className="empty-state" style={{ padding: "80px 40px" }}>
      <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 10 }}>◈</div>
      <div style={{ fontSize: 15, fontFamily: "var(--font-display)", fontWeight: 300, color: "var(--txt2)", marginBottom: 8 }}>No dataset loaded</div>
      <div>Load a CSV, JSON, GeoJSON, XLSX, TSV, Parquet,<br/>Shapefile, NetCDF, LiDAR, or raster file.</div>
    </div>
  )

  const cols = (preview?.columns || ds.columns || []).slice(0, 20)
  let rows = preview?.rows || []
  if (search) { const q = search.toLowerCase(); rows = rows.filter(r => Object.values(r).some(v => String(v ?? "").toLowerCase().includes(q))) }
  filters.forEach(f => { rows = rows.filter(r => { const v = r[f.col]; if (f.op==="=") return String(v)===f.val; if (f.op===">") return parseFloat(v)>parseFloat(f.val); if (f.op==="<") return parseFloat(v)<parseFloat(f.val); if (f.op==="contains") return String(v??"").toLowerCase().includes(f.val.toLowerCase()); return true }) })
  if (sort.col) { const isNum = ds.types?.[sort.col]==="numeric"; rows = [...rows].sort((a,b) => { const av=a[sort.col],bv=b[sort.col]; const cmp=isNum?(parseFloat(av)||0)-(parseFloat(bv)||0):String(av??"").localeCompare(String(bv??"")); return sort.asc?cmp:-cmp }) }

  const numCols = ds.columns?.filter(c => ds.types?.[c]==="numeric") || []
  const catCols = ds.columns?.filter(c => ds.types?.[c]==="categorical") || []
  const missing = ds.missing || {}
  const totalMissing = Object.values(missing).reduce((a,b)=>a+b,0)

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14, padding:16, height:"100%", overflow:"auto" }}>
      {go && <Suggestions ds={ds} go={go}/>}
      {/* NetCDF Explorer */}
      {ds.format && ["nc","nc4","cdf","netcdf"].includes(ds.format) && ds.netcdf_meta && (
        <NetCDFExplorer datasetId={state.activeDataset} netcdfMeta={ds.netcdf_meta} onBandLoaded={handleBandLoaded}/>
      )}
      {/* Raster Band Explorer — shown for any raster with more than 1 band */}
      {ds.raster_meta && ds.raster_meta.bands > 1 && (
        <NetCDFExplorer datasetId={state.activeDataset} rasterMeta={ds.raster_meta} onBandLoaded={handleBandLoaded}/>
      )}
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div className="grid-4" style={{ flex:1 }}>
          <div className="metric"><div className="metric-label">Rows</div><div className="metric-val">{(ds.shape?.[0]||preview?.total_rows||0).toLocaleString()}</div></div>
          <div className="metric"><div className="metric-label">Columns</div><div className="metric-val">{ds.shape?.[1]||ds.columns?.length||0}</div></div>
          <div className="metric"><div className="metric-label">Numeric</div><div className="metric-val">{numCols.length}</div></div>
          <div className="metric"><div className="metric-label">Missing</div><div className="metric-val">{totalMissing.toLocaleString()}</div></div>
        </div>
        <button className="btn sm" onClick={() => setShowExport(e=>!e)} style={{ flexShrink:0, borderColor:showExport?"var(--accent)":undefined, color:showExport?"var(--accent)":undefined }}>↓ Export</button>
      </div>
      {showExport && <ExportPanel datasetId={state.activeDataset} datasetName={ds.name} shape={ds.shape}/>}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        <input type="text" placeholder="Search rows…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:200}}/>
        <select value={filterCol} onChange={e=>setFilterCol(e.target.value)} style={{width:130}}>
          <option value="">Filter column…</option>
          {ds.columns?.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select style={{width:90}} id="filter-op"><option value="=">=</option><option value=">">&gt;</option><option value="<">&lt;</option><option value="contains">contains</option></select>
        <input type="text" placeholder="value" value={filterVal} onChange={e=>setFilterVal(e.target.value)} style={{width:110}}/>
        <button className="btn sm" onClick={()=>{if(!filterCol||!filterVal)return;const op=document.getElementById("filter-op").value;setFilters(f=>[...f,{col:filterCol,op,val:filterVal}]);setFilterVal("")}}>Add filter</button>
        {filters.length>0&&<button className="btn sm danger" onClick={()=>setFilters([])}>Clear filters</button>}
      </div>
      {filters.length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{filters.map((f,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 8px",borderRadius:20,background:"var(--bg3)",border:"1px solid var(--bdr2)",fontSize:11,color:"var(--txt2)"}}>
          <span style={{color:"var(--accent2)"}}>{f.col}</span><span>{f.op}</span><span style={{color:"var(--accent3)"}}>{f.val}</span>
          <span style={{cursor:"pointer",color:"var(--txt4)",marginLeft:2}} onClick={()=>setFilters(fs=>fs.filter((_,j)=>j!==i))}>×</span>
        </div>
      ))}</div>}
      {loading?<div className="loading"><div className="spinner"/><span>Loading…</span></div>:(
        <div style={{flex:1,overflow:"auto",border:"1px solid var(--bdr)",borderRadius:"var(--rl)"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr>{cols.map(col=>{const t=ds.types?.[col];const isSorted=sort.col===col;return(
                <th key={col} onClick={()=>setSort(s=>({col,asc:s.col===col?!s.asc:true}))} style={{padding:"7px 10px",textAlign:"left",position:"sticky",top:0,background:"var(--bg3)",borderBottom:"1px solid var(--bdr2)",cursor:"pointer",whiteSpace:"nowrap",userSelect:"none",color:isSorted?"var(--accent)":"var(--txt2)",fontWeight:500,fontSize:11}}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <span style={{fontSize:8,padding:"1px 4px",borderRadius:3,fontFamily:"var(--font-mono)",background:t==="numeric"?"rgba(110,231,183,0.1)":"rgba(129,140,248,0.1)",color:t==="numeric"?"var(--accent)":"var(--accent2)"}}>{t==="numeric"?"123":t==="datetime"?"Dt":"Abc"}</span>
                    <span>{col}</span>{isSorted&&<span style={{fontSize:10}}>{sort.asc?"↑":"↓"}</span>}
                  </div>
                </th>
              )})}</tr>
            </thead>
            <tbody>{rows.slice(0,500).map((row,i)=>(
              <tr key={i} style={{borderBottom:"1px solid var(--bdr)"}}>
                {cols.map(col=>{const v=row[col];const isNull=v===null||v===undefined||v==="";const isNum=ds.types?.[col]==="numeric";return(
                  <td key={col} style={{padding:"5px 10px",color:isNull?"var(--txt4)":"var(--txt)",fontFamily:isNum?"var(--font-mono)":"inherit",fontSize:isNum?11:12,textAlign:isNum?"right":"left",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {isNull?<span style={{fontStyle:"italic",fontSize:10}}>null</span>:String(v)}
                  </td>
                )})}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div style={{display:"flex",alignItems:"center",gap:10,fontSize:11,color:"var(--txt3)"}}>
        <span>Showing {Math.min(500,rows.length).toLocaleString()} of ~{preview?.total_rows?.toLocaleString()} rows</span>
        {ds.columns?.length>20&&<span>· {ds.columns.length-20} more columns hidden</span>}
        <div style={{flex:1}}/>
        <button className="btn sm ghost" disabled={page===0} onClick={()=>setPage(p=>p-1)}>← Prev</button>
        <span>Page {page+1}</span>
        <button className="btn sm ghost" onClick={()=>setPage(p=>p+1)}>Next →</button>
      </div>
    </div>
  )
}
