import { useApp } from "../store"

export const TABS = ["Explore", "Statistics", "Visualize", "Analyze", "Compare", "Cartography", "SQL Lab", "Geoprocess"]

export default function Topbar({ activeTab, setActiveTab, onOpenLearn }) {
  const { state } = useApp()
  const dsCount = Object.keys(state.datasets).length
  return (
    <div style={{ height: "var(--topbar)", background: "var(--bg2)", borderBottom: "1px solid var(--bdr)", display: "flex", alignItems: "center", paddingLeft: 16, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginRight: 20, minWidth: 150, flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 300, color: "var(--txt)", letterSpacing: "-0.5px" }}>Cartolith</span>
        <span style={{ fontSize: 10, color: "var(--txt3)", letterSpacing: "1px", textTransform: "uppercase" }}>Explorer</span>
      </div>
      <div style={{ display: "flex", height: "100%", overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none" }}>
        {TABS.map(t => (
          <button key={t} className={`tab-btn${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 8 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingRight: 16, flexShrink: 0 }}>
        <button className="btn sm" onClick={onOpenLearn} title="Plain-English GIS help" style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-dim)" }}>
          <span style={{ fontWeight: 700 }}>?</span> Learn GIS
        </button>
        {dsCount > 0 && <span className="badge green">{dsCount} dataset{dsCount !== 1 ? "s" : ""}</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: state.backendOnline ? "var(--accent)" : state.backendOnline === false ? "var(--accent4)" : "var(--txt3)" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: state.backendOnline ? "var(--accent)" : state.backendOnline === false ? "var(--accent4)" : "var(--txt3)" }} />
          {state.backendOnline ? "Online" : state.backendOnline === false ? "Offline" : "…"}
        </div>
      </div>
    </div>
  )
}
