import { useRef, useState } from "react"
import { useApp } from "../store"
import { api, uploadWithProgress, projectApi, loadUrlApi } from "../api"
import { useSampleLoader } from "./Learn"
import Pipeline from "./Pipeline"

const FORMAT_BADGES = {
  shapefile:{label:"SHP",color:"#6ee7b7"},dbf:{label:"DBF",color:"#6ee7b7"},
  tif:{label:"TIF",color:"#818cf8"},tiff:{label:"TIF",color:"#818cf8"},geotiff:{label:"GTIF",color:"#818cf8"},
  dem:{label:"DEM",color:"#f59e0b"},hgt:{label:"HGT",color:"#f59e0b"},asc:{label:"ASC",color:"#f59e0b"},
  img:{label:"IMG",color:"#818cf8"},nc:{label:"NC",color:"#38bdf8"},nc4:{label:"NC4",color:"#38bdf8"},
  cdf:{label:"CDF",color:"#38bdf8"},netcdf:{label:"NC",color:"#38bdf8"},
  las:{label:"LAS",color:"#fb7185"},laz:{label:"LAZ",color:"#fb7185"},
  png:{label:"PNG",color:"#a78bfa"},jpg:{label:"JPG",color:"#a78bfa"},jpeg:{label:"JPG",color:"#a78bfa"},
  csv:{label:"CSV",color:"#9499a8"},tsv:{label:"TSV",color:"#9499a8"},json:{label:"JSON",color:"#9499a8"},
  geojson:{label:"GEO",color:"#6ee7b7"},xlsx:{label:"XLS",color:"#9499a8"},parquet:{label:"PRQ",color:"#9499a8"},
}
const TYPE_INFO = {
  numeric:{label:"123",bg:"rgba(110,231,183,0.12)",color:"#6ee7b7"},
  categorical:{bg:"rgba(129,140,248,0.12)",color:"#818cf8",label:"Abc"},
  datetime:{bg:"rgba(245,158,11,0.12)",color:"#f59e0b",label:"Dt"},
}
function TypeBadge({type}){
  const s=TYPE_INFO[type]||TYPE_INFO.categorical
  return <span style={{fontSize:8,fontWeight:700,padding:"1px 4px",borderRadius:3,background:s.bg,color:s.color,fontFamily:"var(--font-mono)",flexShrink:0}}>{s.label}</span>
}

export default function Sidebar() {
  const {state,dispatch}=useApp()
  const fileRef=useRef()
  const projRef=useRef()
  const [uploading,setUploading]=useState({})
  const sample=useSampleLoader(dispatch)
  const [showUrl,setShowUrl]=useState(false)
  const [urlVal,setUrlVal]=useState("")
  const [urlBusy,setUrlBusy]=useState(false)
  const [urlErr,setUrlErr]=useState(null)
  const [showPipeline,setShowPipeline]=useState(false)
  const [projMsg,setProjMsg]=useState(null)

  async function loadFromUrl(){
    const url=urlVal.trim(); if(!url) return
    setUrlBusy(true); setUrlErr(null)
    try{
      const ds=await loadUrlApi.load(url)
      dispatch({type:"ADD_DATASET",dataset:ds})
      setShowUrl(false); setUrlVal("")
    }catch(e){ setUrlErr(e.message?.split("\n")[0]||"Could not load that URL.") }
    finally{ setUrlBusy(false) }
  }

  async function saveProject(){
    setProjMsg(null)
    try{
      const meta={}
      Object.values(state.datasets).forEach(d=>{ meta[d.id]={format:d.format,derived:d.derived,sample:d.sample,geo_meta:d.geo_meta,raster_meta:d.raster_meta} })
      const proj=await projectApi.save({dataset_meta:meta,map:null})
      const blob=new Blob([JSON.stringify(proj)],{type:"application/json"})
      const a=document.createElement("a"); a.href=URL.createObjectURL(blob)
      a.download="workspace.cartolith.json"; document.body.appendChild(a); a.click(); document.body.removeChild(a)
    }catch(e){ setProjMsg(e.message?.split("\n")[0]||"Save failed") }
  }

  async function openProject(e){
    const file=e.target.files?.[0]; e.target.value=""
    if(!file) return
    setProjMsg(null)
    try{
      const proj=JSON.parse(await file.text())
      const res=await projectApi.load(proj)
      res.restored.forEach(ds=>dispatch({type:"ADD_DATASET",dataset:ds}))
      setProjMsg(`Loaded ${res.restored.length} dataset${res.restored.length===1?"":"s"}${res.skipped.length?` · ${res.skipped.length} skipped`:""}`)
    }catch(e){ setProjMsg("That doesn't look like a Cartolith project file.") }
  }

  async function rerunDerived(ds,e){
    e.stopPropagation()
    try{
      const { pipelineApi }=await import("../api")
      const out=await pipelineApi.rerun(ds.derived,`${ds.id} (re-run)`)
      dispatch({type:"ADD_DATASET",dataset:out})
    }catch(err){ alert(`Re-run failed:\n${err.message?.split("\n")[0]}`) }
  }

  async function handleFiles(e){
    const files=Array.from(e.target.files)
    for(const file of files){
      setUploading(u=>({...u,[file.name]:0}))
      try{
        const result=await uploadWithProgress(file,file.name,pct=>{
          setUploading(u=>({...u,[file.name]:pct<100?pct:"parsing"}))
        })
        dispatch({type:"ADD_DATASET",dataset:result})
        setUploading(u=>{const n={...u};delete n[file.name];return n})
      }catch(err){
        setUploading(u=>({...u,[file.name]:"error"}))
        alert(`Failed to load "${file.name}":\n\n${err.message.split("\n\n")[0]}`)
        setTimeout(()=>setUploading(u=>{const n={...u};delete n[file.name];return n}),3000)
      }
    }
    e.target.value=""
  }

  async function handleDelete(id){
    if(!confirm(`Remove "${id}"?`))return
    try{await api.deleteDataset(id)}catch{}
    dispatch({type:"REMOVE_DATASET",id})
  }

  const datasets=Object.values(state.datasets)
  const activeDs=state.activeDataset?state.datasets[state.activeDataset]:null

  return (
    <div style={{width:"var(--sidebar)",flexShrink:0,background:"var(--bg2)",borderRight:"1px solid var(--bdr)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 12px 0",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span className="section-title" style={{margin:0}}>Datasets</span>
          <button className="btn sm primary" onClick={()=>fileRef.current.click()}>+ Load</button>
        </div>
        <div style={{display:"flex",gap:4,marginBottom:8}}>
          <button className="btn sm" style={{flex:1,fontSize:10,padding:"3px 4px"}} title="Load data from a URL" onClick={()=>{setShowUrl(v=>!v);setUrlErr(null)}}>URL</button>
          <button className="btn sm" style={{flex:1,fontSize:10,padding:"3px 4px"}} title="Open a saved project" onClick={()=>projRef.current.click()}>Open</button>
          <button className="btn sm" style={{flex:1,fontSize:10,padding:"3px 4px"}} title="Save the whole workspace" disabled={datasets.length===0} onClick={saveProject}>Save</button>
          <button className="btn sm" style={{flex:1,fontSize:10,padding:"3px 4px"}} title="See how datasets were made" disabled={datasets.length===0} onClick={()=>setShowPipeline(true)}>Pipeline</button>
        </div>
        <input ref={projRef} type="file" accept=".json,.cartolith.json" style={{display:"none"}} onChange={openProject}/>
        {showUrl&&(
          <div style={{marginBottom:8,padding:8,background:"var(--bg3)",border:"1px solid var(--bdr)",borderRadius:"var(--r)"}}>
            <input value={urlVal} onChange={e=>setUrlVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&loadFromUrl()} placeholder="https://…/data.geojson"
              style={{width:"100%",fontSize:11,marginBottom:6}}/>
            <div style={{fontSize:9.5,color:"var(--txt3)",marginBottom:6,lineHeight:1.4}}>GeoJSON · CSV · GeoParquet · FlatGeobuf · zipped Shapefile, streamed by link.</div>
            <div style={{display:"flex",gap:4}}>
              <button className="btn sm primary" style={{flex:1}} disabled={urlBusy} onClick={loadFromUrl}>{urlBusy?"Loading…":"Load"}</button>
              <button className="btn sm ghost" onClick={()=>setShowUrl(false)}>Cancel</button>
            </div>
            {urlErr&&<div style={{fontSize:10,color:"var(--accent4)",marginTop:6,lineHeight:1.4}}>{urlErr}</div>}
          </div>
        )}
        {projMsg&&<div style={{fontSize:10,color:"var(--accent2)",marginBottom:8,lineHeight:1.4}}>{projMsg}</div>}
        {showPipeline&&<Pipeline open={showPipeline} onClose={()=>setShowPipeline(false)}/>}
        <input ref={fileRef} type="file" multiple style={{display:"none"}}
          accept=".csv,.tsv,.json,.geojson,.xlsx,.parquet,.shp,.dbf,.zip,.tif,.tiff,.geotiff,.img,.dem,.hgt,.asc,.nc,.nc4,.cdf,.las,.laz,.png,.jpg,.jpeg,.bmp"
          onChange={handleFiles}/>
        {datasets.length===0?(
          <div style={{padding:"14px 0",textAlign:"center"}}>
            <div style={{fontSize:22,opacity:0.25,marginBottom:8}}>◈</div>
            <div style={{fontSize:11,color:"var(--txt3)",lineHeight:1.7}}>CSV · TSV · JSON · GeoJSON<br/>SHP · DBF · ZIP<br/>TIF · GeoTIFF · DEM · HGT<br/>NetCDF · NC4<br/>LAS · LAZ (LiDAR)<br/>PNG · JPG</div>
            <button className="btn sm" style={{marginTop:10,width:"100%"}} onClick={()=>fileRef.current.click()}>Browse files</button>
            <button className="btn sm primary" style={{marginTop:6,width:"100%"}} disabled={sample.loading} onClick={()=>sample.load("both")}>{sample.loading?"Loading…":"✦ Try sample data"}</button>
            {sample.err&&<div style={{fontSize:10,color:"var(--accent4)",marginTop:6,lineHeight:1.5}}>{sample.err}</div>}
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:6}}>
            {datasets.map(ds=>{
              const fmt=ds.format||""; const badge=FORMAT_BADGES[fmt]||{label:fmt.toUpperCase().slice(0,4),color:"#9499a8"}
              const isActive=state.activeDataset===ds.id
              return (
                <div key={ds.id} onClick={()=>dispatch({type:"SET_ACTIVE_DATASET",id:ds.id})}
                  style={{padding:"7px 10px",borderRadius:"var(--r)",cursor:"pointer",background:isActive?"var(--accent-dim)":"var(--bg3)",border:`1px solid ${isActive?"rgba(110,231,183,0.3)":"var(--bdr)"}`,transition:"all 0.12s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:4}}>
                    <span style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3,background:badge.color+"22",color:badge.color,fontFamily:"var(--font-mono)",flexShrink:0}}>{badge.label}</span>
                    <span style={{fontSize:12,fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:isActive?"var(--accent)":"var(--txt)"}} title={ds.name}>{ds.name}</span>
                    {ds.derived&&<button className="btn ghost icon sm" title="Re-run this recipe" onClick={e=>rerunDerived(ds,e)} style={{flexShrink:0,width:18,height:18,fontSize:12,padding:0,color:"var(--accent2)"}}>↻</button>}
                    <button className="btn ghost icon sm" onClick={e=>{e.stopPropagation();handleDelete(ds.id)}} style={{flexShrink:0,width:18,height:18,fontSize:13,padding:0}}>×</button>
                  </div>
                  <div style={{fontSize:10,color:"var(--txt3)",marginTop:2,display:"flex",alignItems:"center",gap:5}}>
                    <span>{ds.shape?`${ds.shape[0].toLocaleString()} × ${ds.shape[1]} cols`:`${ds.columns?.length??0} cols`}</span>
                    {ds.derived && <span title={ds.derived.detail||"Derived dataset"} style={{fontSize:8.5,fontWeight:600,padding:"0px 5px",borderRadius:3,background:"rgba(129,140,248,0.14)",color:"var(--accent2)",fontFamily:"var(--font-mono)",whiteSpace:"nowrap"}}>⤳ {ds.derived.op}</span>}
                    {ds.sample && <span title="Sample dataset" style={{fontSize:8.5,fontWeight:600,padding:"0px 5px",borderRadius:3,background:"rgba(56,189,248,0.14)",color:"var(--accent5)",fontFamily:"var(--font-mono)"}}>sample</span>}
                  </div>
                </div>
              )
            })}
            <button className="btn ghost sm" style={{width:"100%",marginTop:2}} onClick={()=>fileRef.current.click()}>+ Add another</button>
          </div>
        )}
        {Object.entries(uploading).map(([name,st])=>(
          <div key={name} style={{marginTop:4,padding:"7px 10px",background:st==="error"?"rgba(251,113,133,0.08)":"var(--bg3)",border:`1px solid ${st==="error"?"rgba(251,113,133,0.25)":"var(--bdr)"}`,borderRadius:"var(--r)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:11,color:st==="error"?"var(--accent4)":"var(--txt2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}} title={name}>{name}</span>
              <span style={{fontSize:10,fontFamily:"var(--font-mono)",color:"var(--txt3)",flexShrink:0,marginLeft:6}}>{st==="error"?"✗ failed":st==="parsing"?"parsing…":`${st}%`}</span>
            </div>
            {st!=="error"&&<div style={{height:3,background:"var(--bg4)",borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:2,background:st==="parsing"?"var(--accent3)":"var(--accent)",width:st==="parsing"?"100%":`${st}%`,transition:st==="parsing"?"none":"width 0.2s ease",animation:st==="parsing"?"pulse 1.2s ease-in-out infinite":"none"}}/>
            </div>}
          </div>
        ))}
      </div>
      <hr className="divider"/>
      {activeDs&&(activeDs.geo_meta||activeDs.raster_meta||activeDs.lidar_meta||activeDs.netcdf_meta||activeDs.image_meta)&&(
        <div style={{padding:"0 12px",flexShrink:0,overflowY:"auto",maxHeight:280}}>
          <GeoMetaPanel ds={activeDs}/>
        </div>
      )}
      {activeDs&&(activeDs.geo_meta||activeDs.raster_meta||activeDs.lidar_meta||activeDs.netcdf_meta||activeDs.image_meta)&&<hr className="divider"/>}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",padding:"0 12px 12px"}}>
        <div className="section-title">Variables</div>
        {activeDs?(
          <div style={{flex:1,overflowY:"auto"}}>
            <div style={{fontSize:10,color:"var(--txt3)",marginBottom:5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{activeDs.name}</div>
            {activeDs.columns?.map(col=>{
              const t=activeDs.types?.[col]||"categorical"
              const isSelected=state.selectedVars.some(v=>v.datasetId===state.activeDataset&&v.column===col)
              const missing=activeDs.missing?.[col]||0; const total=activeDs.shape?.[0]||1; const missingPct=total>0?missing/total:0
              return (
                <div key={col} onClick={()=>dispatch({type:"TOGGLE_VAR",datasetId:state.activeDataset,column:col})}
                  style={{display:"flex",alignItems:"center",gap:6,padding:"4px 6px",borderRadius:"var(--r)",cursor:"pointer",background:isSelected?"var(--accent2-dim)":"transparent",border:`1px solid ${isSelected?"rgba(129,140,248,0.3)":"transparent"}`,marginBottom:2,transition:"all 0.1s"}}>
                  <TypeBadge type={t}/>
                  <span style={{fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:isSelected?"var(--accent2)":"var(--txt)"}} title={col}>{col}</span>
                  {missingPct>0.05&&<span style={{fontSize:8,color:"var(--accent4)",fontFamily:"var(--font-mono)"}}>{(missingPct*100).toFixed(0)}%</span>}
                </div>
              )
            })}
          </div>
        ):<div style={{fontSize:11,color:"var(--txt3)"}}>Load a dataset to see variables</div>}
        {state.selectedVars.length>0&&(
          <div style={{marginTop:8,padding:"7px 9px",background:"var(--bg3)",borderRadius:"var(--r)",border:"1px solid var(--bdr)",flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:10,color:"var(--txt3)"}}>SELECTED ({state.selectedVars.length})</span>
              <span style={{fontSize:10,color:"var(--accent4)",cursor:"pointer"}} onClick={()=>dispatch({type:"CLEAR_VARS"})}>clear</span>
            </div>
            {state.selectedVars.map(v=>(
              <div key={v.key} style={{fontSize:10,color:"var(--txt2)",padding:"2px 0",display:"flex",gap:4,overflow:"hidden"}}>
                <span style={{color:"var(--txt4)",fontFamily:"var(--font-mono)"}}>{v.datasetId.split(".")[0].slice(0,7)}</span>
                <span style={{color:"var(--accent2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.column}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function GeoMetaPanel({ds}){
  const geo=ds.geo_meta,raster=ds.raster_meta,lidar=ds.lidar_meta,netcdf=ds.netcdf_meta,image=ds.image_meta
  if(!geo&&!raster&&!lidar&&!netcdf&&!image) return null
  const rows=[]
  if(geo){rows.push(["Type",geo.geometry_type],["Features",geo.feature_count?.toLocaleString()],["CRS",geo.crs?.slice(0,30)]);if(geo.bounds?.length===4){rows.push(["Bounds W",geo.bounds[0]?.toFixed(4)],["Bounds E",geo.bounds[2]?.toFixed(4)])}}
  if(raster){rows.push(["Driver",raster.driver],["Size",`${raster.width}×${raster.height}`],["Bands",raster.bands],["CRS",raster.crs?.slice(0,30)],["Res",raster.resolution?.map(r=>r.toFixed(6)).join(", ")]);if(raster.is_rgb)rows.push(["Type","RGB imagery"]);if(raster.is_dem)rows.push(["Type","DEM/Elevation"]);if(raster.band_stats?.[0]){const b=raster.band_stats[0];rows.push(["B1 min",b.min?.toFixed(3)],["B1 max",b.max?.toFixed(3)])}}
  if(lidar){rows.push(["Points",lidar.point_count?.toLocaleString()],["Sampled",lidar.sampled?.toLocaleString()],["Format",`LAS v${lidar.version}`],["Z min",lidar.xyz_stats?.z?.min?.toFixed(2)],["Z max",lidar.xyz_stats?.z?.max?.toFixed(2)])}
  if(netcdf){rows.push(["Variables",Object.keys(netcdf.variables||{}).length],["Dims",Object.keys(netcdf.dimensions||{}).length]);if(netcdf.time_info?.n_steps)rows.push(["Time steps",netcdf.time_info.n_steps]);Object.entries(netcdf.dimensions||{}).slice(0,4).forEach(([k,v])=>rows.push([k,v]))}
  if(image){rows.push(["Size",`${image.width}×${image.height}`],["Mode",image.mode],["Bands",image.bands])}
  const label=raster?"Raster":lidar?"LiDAR":netcdf?"NetCDF":geo?"Vector":"Image"
  return (
    <div style={{margin:"8px 0",padding:"8px 10px",background:"var(--bg3)",borderRadius:"var(--r)",border:"1px solid var(--bdr)"}}>
      <div style={{fontSize:9,fontWeight:600,letterSpacing:"0.8px",color:"var(--txt3)",textTransform:"uppercase",marginBottom:5}}>{label} Metadata</div>
      {rows.filter(([,v])=>v!=null&&v!=="").map(([k,v])=>(
        <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:10,padding:"1px 0",borderBottom:"1px solid var(--bdr)",color:"var(--txt3)"}}>
          <span style={{flexShrink:0,marginRight:6}}>{k}</span>
          <span style={{fontFamily:"var(--font-mono)",color:"var(--txt2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right"}}>{String(v)}</span>
        </div>
      ))}
      {raster?.thumbnails?.slice(0,2).map((t,i)=>t.thumbnail&&(
        <div key={i} style={{marginTop:6}}>
          <div style={{fontSize:9,color:"var(--txt3)",marginBottom:2}}>{typeof t.band==="string"?t.band:`Band ${t.band}`}</div>
          <img src={`data:image/png;base64,${t.thumbnail}`} alt="" style={{width:"100%",borderRadius:3,border:"1px solid var(--bdr)"}}/>
        </div>
      ))}
      {image?.thumbnail&&<div style={{marginTop:6}}><img src={`data:image/png;base64,${image.thumbnail}`} alt="preview" style={{width:"100%",borderRadius:3,border:"1px solid var(--bdr)"}}/></div>}
      {lidar?.density_thumbnail&&<div style={{marginTop:6}}><div style={{fontSize:9,color:"var(--txt3)",marginBottom:2}}>Point density</div><img src={`data:image/png;base64,${lidar.density_thumbnail}`} alt="density" style={{width:"100%",borderRadius:3,border:"1px solid var(--bdr)"}}/></div>}
    </div>
  )
}
