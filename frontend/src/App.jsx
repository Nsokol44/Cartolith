import { useState, useEffect } from "react"
import { AppProvider, useApp } from "./store"
import { api } from "./api"
import Topbar from "./components/Topbar"
import Sidebar from "./components/Sidebar"
import ExploreTab from "./components/ExploreTab"
import StatisticsTab from "./components/StatisticsTab"
import VisualizeTab from "./components/VisualizeTab"
import AnalyzeTab from "./components/AnalyzeTab"
import CompareTab from "./components/CompareTab"
import CartographyTab from "./components/CartographyTab"
import SqlLabTab from "./components/SqlLabTab"
import GeoprocessTab from "./components/GeoprocessTab"
import { LearnDrawer, useSampleLoader } from "./components/Learn"
import { FIRST_STEPS } from "./gis-concepts"

function Welcome({ onClose, onLoadSample, loading }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ width: "min(560px, 94vw)", background: "var(--bg2)", border: "1px solid var(--bdr2)", borderRadius: "var(--rl)", padding: "26px 28px", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 300 }}>Welcome to Cartolith</span>
          <span style={{ fontSize: 11, color: "var(--txt3)", letterSpacing: "1px", textTransform: "uppercase" }}>Explorer</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--txt2)", lineHeight: 1.65, marginTop: 8, marginBottom: 18 }}>
          A friendly place to explore data <em>and</em> maps. Never used GIS before? That's fine — every tool here explains itself in plain English, and the <strong style={{ color: "var(--accent)" }}>? Learn GIS</strong> button is always in the top bar.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {FIRST_STEPS.map(s => (
            <div key={s.n} style={{ display: "flex", gap: 11 }}>
              <div style={{ width: 22, height: 22, flexShrink: 0, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)" }}>{s.n}</div>
              <div>
                <div style={{ fontSize: 12.5, color: "var(--txt)", fontWeight: 500 }}>{s.title}</div>
                <div style={{ fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.5, marginTop: 1 }}>{s.body}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn primary" disabled={loading} onClick={onLoadSample}>{loading ? "Loading…" : "Load sample data & start"}</button>
          <button className="btn ghost" onClick={onClose}>I'll explore on my own</button>
        </div>
      </div>
    </div>
  )
}

function AppInner() {
  const { state, dispatch } = useApp()
  const [activeTab, setActiveTab] = useState("Explore")
  const [learnOpen, setLearnOpen] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const sample = useSampleLoader(dispatch)

  useEffect(() => {
    api.health()
      .then(d => dispatch({ type: "SET_BACKEND", online: true, capabilities: d.capabilities }))
      .catch(() => dispatch({ type: "SET_BACKEND", online: false }))
  }, [])

  const dsCount = Object.keys(state.datasets).length
  const showWelcome = !welcomeDismissed && dsCount === 0 && state.backendOnline !== false

  async function welcomeLoad() {
    await sample.load("both")
    setWelcomeDismissed(true)
    setActiveTab("Cartography")
  }

  const tabContent = {
    Explore: <ExploreTab go={setActiveTab} />, Statistics: <StatisticsTab />, Visualize: <VisualizeTab />,
    Analyze: <AnalyzeTab />, Compare: <CompareTab />, Cartography: <CartographyTab />,
    "SQL Lab": <SqlLabTab go={setActiveTab} />, Geoprocess: <GeoprocessTab go={setActiveTab} />,
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <Topbar activeTab={activeTab} setActiveTab={setActiveTab} onOpenLearn={() => setLearnOpen(true)} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar />
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {state.backendOnline === false && (
            <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderLeft: "3px solid var(--accent3)", padding: "8px 16px", fontSize: 12, color: "var(--accent3)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span>⚠</span>
              <span>Python backend offline. Run: <code style={{ fontFamily: "var(--font-mono)", color: "var(--txt)" }}>cd backend && uvicorn main:app --reload --http h11</code></span>
            </div>
          )}
          <div style={{ flex: 1, overflow: "hidden" }}>{tabContent[activeTab]}</div>
        </div>
      </div>
      <LearnDrawer open={learnOpen} onClose={() => setLearnOpen(false)} onLoadSample={() => sample.load("both")} />
      {showWelcome && <Welcome onClose={() => setWelcomeDismissed(true)} onLoadSample={welcomeLoad} loading={sample.loading} />}
    </div>
  )
}

export default function App() { return <AppProvider><AppInner /></AppProvider> }
