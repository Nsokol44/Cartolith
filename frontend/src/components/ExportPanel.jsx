import { useState } from "react"
import { exportDataset } from "../api"
const FORMATS = [
  { id:"csv", label:"CSV", desc:"Comma-separated, opens in Excel/Sheets" },
  { id:"tsv", label:"TSV", desc:"Tab-separated" },
  { id:"json", label:"JSON", desc:"Array of records" },
  { id:"geojson", label:"GeoJSON", desc:"Point features (needs lat/lon cols)" },
  { id:"parquet", label:"Parquet", desc:"Columnar format for Python/R" },
  { id:"xlsx", label:"Excel", desc:".xlsx for Microsoft Excel" },
]
export default function ExportPanel({ datasetId, datasetName, shape, style }) {
  const [fmt, setFmt] = useState("csv")
  const [downloading, setDownloading] = useState(false)
  function doExport() { setDownloading(true); exportDataset(datasetId, fmt); setTimeout(() => setDownloading(false), 1500) }
  return (
    <div style={{ background:"var(--bg3)", border:"1px solid var(--bdr)", borderRadius:"var(--rl)", padding:14, ...style }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
        <span style={{ fontSize:13, fontFamily:"var(--font-display)", fontWeight:300, color:"var(--txt)" }}>Export Dataset</span>
        {shape && <span className="badge gray">{shape[0]?.toLocaleString()} × {shape[1]} cols</span>}
      </div>
      {datasetName && <div style={{ fontSize:11, color:"var(--txt3)", marginBottom:10, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{datasetName}</div>}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5, marginBottom:12 }}>
        {FORMATS.map(f => (
          <button key={f.id} onClick={() => setFmt(f.id)} title={f.desc} style={{ padding:"6px 8px", borderRadius:"var(--r)", cursor:"pointer",
            background:fmt===f.id?"var(--accent-dim)":"var(--bg)", border:`1px solid ${fmt===f.id?"rgba(110,231,183,0.4)":"var(--bdr)"}`,
            color:fmt===f.id?"var(--accent)":"var(--txt2)", fontSize:11, fontWeight:500, fontFamily:"var(--font-body)", textAlign:"center" }}>{f.label}</button>
        ))}
      </div>
      <div style={{ fontSize:10, color:"var(--txt3)", marginBottom:10 }}>{FORMATS.find(f=>f.id===fmt)?.desc}</div>
      <button className="btn primary" onClick={doExport} disabled={downloading} style={{ width:"100%" }}>
        {downloading ? "↓ Downloading…" : `↓ Download as .${fmt}`}
      </button>
    </div>
  )
}
