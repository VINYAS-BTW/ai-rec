import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Server, Cpu, Database, Zap, BarChart3, FlaskConical, Radio, Settings2, CheckCircle2, AlertCircle, Clock, Trophy, RefreshCw, Plus, X, ChevronRight, Play, Flag, Layers } from "lucide-react";
import { API_BACKEND, API_AUTH, API_WEBHOOK, getBackendAuthHeaders } from "../api";

const TABS = [
  { id: "health",      label: "System Health",    Icon: Server },
  { id: "registry",   label: "Model Registry",   Icon: Layers },
  { id: "experiments",label: "Experiments",       Icon: FlaskConical },
  { id: "events",     label: "Event Stream",      Icon: Radio },
  { id: "serving",    label: "Serving Controls",  Icon: Settings2 },
];

const pill = (text, color="slate") => {
  const map = { green:"bg-emerald-100 text-emerald-700", amber:"bg-amber-100 text-amber-700", rose:"bg-rose-100 text-rose-700", slate:"bg-slate-100 text-slate-600", blue:"bg-blue-100 text-blue-700", purple:"bg-purple-100 text-purple-700" };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[color]||map.slate}`}>{text}</span>;
};

const Card = ({children,className=""})=><div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${className}`}>{children}</div>;
const SectionTitle = ({children})=><h3 className="text-base font-bold text-slate-800 mb-4 font-third">{children}</h3>;

/* ── System Health Tab ─────────────────────────────────────────────── */
function SystemHealthTab() {
  const [services, setServices] = useState({ mlBackend:"checking", auth:"checking", webhook:"checking", kafka:"checking" });
  const [latencies, setLatencies] = useState({});
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
    const h = getBackendAuthHeaders();
    const probe = async (url, opts={}) => {
      const t = Date.now();
      try { const r = await fetch(url,{...opts, signal:AbortSignal.timeout(5000)}); return { ok: r.ok||r.status===401, ms: Date.now()-t }; }
      catch { return { ok: false, ms: Date.now()-t }; }
    };
    const [ml,ka,wh,au] = await Promise.all([
      probe(`${API_BACKEND}/health`, {headers:h}),
      probe(`${API_BACKEND}/kafka/status`, {headers:h}),
      probe(`${API_WEBHOOK}/api/apps`),
      probe(`${API_AUTH}/`),
    ]);
    setServices({ mlBackend: ml.ok?"ok":"degraded", kafka: ka.ok?"ok":"degraded", webhook: wh.ok?"ok":"degraded", auth: au.ok?"ok":"degraded" });
    setLatencies({ mlBackend:`${ml.ms}ms`, kafka:`${ka.ms}ms`, webhook:`${wh.ms}ms`, auth:`${au.ms}ms` });
    try {
      const r = await fetch(`${API_BACKEND}/system/metrics`, {headers:h});
      if(r.ok) setMetrics(await r.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(()=>{ check(); const iv=setInterval(check,30000); return ()=>clearInterval(iv); },[check]);

  const svcs = [
    { key:"mlBackend", label:"ML Backend", url:API_BACKEND },
    { key:"kafka",     label:"Kafka",      url:`${API_BACKEND}/kafka/status` },
    { key:"webhook",   label:"Webhooks",   url:API_WEBHOOK },
    { key:"auth",      label:"Auth",       url:API_AUTH },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {svcs.map(({key,label,url})=>{
          const st = services[key]; const lat = latencies[key];
          const cfg = st==="ok"?{dot:"bg-emerald-400",badge:"text-emerald-700 bg-emerald-50",text:"Operational"}
                    : st==="degraded"?{dot:"bg-amber-400",badge:"text-amber-700 bg-amber-50",text:"Degraded"}
                    : {dot:"bg-slate-300 animate-pulse",badge:"text-slate-500 bg-slate-50",text:"Checking…"};
          return (
            <Card key={key} className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700 font-third">{label}</span>
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`}/>
              </div>
              <p className={`text-xs font-bold px-2 py-1 rounded-full inline-block ${cfg.badge}`}>{cfg.text}</p>
              {lat && st!=="checking" && <p className={`text-xs mt-2 font-mono ${st==="ok"?"text-emerald-600":"text-amber-600"}`}>{lat}</p>}
              <p className="text-xs text-slate-400 truncate mt-1">{url}</p>
            </Card>
          );
        })}
      </div>
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {label:"Total Projects", value:metrics.projects?.total??"-", hint: Object.entries(metrics.projects?.by_status||{}).map(([k,v])=>`${v} ${k}`).join(", ")},
            {label:"Champions",      value:metrics.model_registry?.champions??"-", hint:"Active champion models"},
            {label:"Challengers",    value:metrics.model_registry?.challengers??"-", hint:"Pending challenger models"},
            {label:"Experiments",    value:metrics.experiments?.total??"-", hint: Object.entries(metrics.experiments?.by_status||{}).map(([k,v])=>`${v} ${k}`).join(", ")||"None yet"},
          ].map(({label,value,hint})=>(
            <Card key={label} className="p-5">
              <p className="text-xs text-slate-500 font-third mb-1">{label}</p>
              <p className="text-3xl font-bold text-slate-900 font-main">{value}</p>
              <p className="text-xs text-slate-400 mt-1">{hint}</p>
            </Card>
          ))}
        </div>
      )}
      {metrics?.kafka && (
        <Card className="p-5">
          <SectionTitle>Kafka Producer Status</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-third">
            <div><span className="text-slate-500">Enabled</span><p className="font-bold">{String(metrics.kafka.enabled)}</p></div>
            <div><span className="text-slate-500">Initialized</span><p className="font-bold">{String(metrics.kafka.producer_initialized)}</p></div>
            <div><span className="text-slate-500">Total Success</span><p className="font-bold text-emerald-600">{metrics.kafka.total_success??0}</p></div>
            <div><span className="text-slate-500">Total Failures</span><p className="font-bold text-rose-600">{metrics.kafka.total_failures??0}</p></div>
          </div>
          {metrics.kafka.last_error && <p className="text-xs text-rose-500 mt-3 font-mono">Last error: {metrics.kafka.last_error}</p>}
        </Card>
      )}
    </div>
  );
}

/* ── Model Registry Tab ────────────────────────────────────────────── */
function ModelRegistryTab() {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const h = getBackendAuthHeaders();

  useEffect(()=>{
    fetch(`${API_BACKEND}/projects/`,{headers:h}).then(r=>r.json()).then(d=>{setProjects(Array.isArray(d)?d:[]); setLoading(false);}).catch(()=>setLoading(false));
  },[]);

  const loadRegistry = async (pid) => {
    setSelected(pid); setEntries([]);
    try { const r=await fetch(`${API_BACKEND}/project/${pid}/model-registry`,{headers:h}); const d=await r.json(); setEntries(d.entries||[]); } catch {}
  };

  const promote = async (pid, eid) => {
    await fetch(`${API_BACKEND}/project/${pid}/model-registry/${eid}/promote`,{method:"POST",headers:h});
    loadRegistry(pid);
  };
  const retire = async (pid, eid) => {
    await fetch(`${API_BACKEND}/project/${pid}/model-registry/${eid}/retire`,{method:"POST",headers:h});
    loadRegistry(pid);
  };

  const roleColor = r => r==="champion"?"green": r==="challenger"?"blue": "slate";

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <SectionTitle>Projects</SectionTitle>
        {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
          <div className="space-y-2">
            {projects.map(p=>(
              <button key={p.id} onClick={()=>loadRegistry(p.id)}
                className={`w-full text-left flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${selected===p.id?"border-rose-400 bg-rose-50":"border-slate-200 hover:border-slate-300"}`}>
                <div>
                  <p className="text-sm font-bold text-slate-900 font-third">{p.project_name}</p>
                  <p className="text-xs text-slate-400">ID: {p.id} · {p.model_type||"unknown"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {pill(p.status, p.status==="ready"?"green":p.status==="processing"?"blue":"amber")}
                  <ChevronRight className="w-4 h-4 text-slate-400"/>
                </div>
              </button>
            ))}
            {projects.length===0 && <p className="text-sm text-slate-400 text-center py-8">No projects yet.</p>}
          </div>
        )}
      </Card>

      {selected && (
        <Card className="p-5">
          <SectionTitle>Registry — Project {selected}</SectionTitle>
          <div className="space-y-3">
            {entries.map(e=>(
              <div key={e.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-slate-900 font-third">v{e.version}</span>
                    {pill(e.role, roleColor(e.role))}
                    {e.role==="champion" && <Trophy className="w-3.5 h-3.5 text-amber-500"/>}
                  </div>
                  <p className="text-xs text-slate-400 font-third">{e.model_type} · Created {e.created_at?new Date(e.created_at).toLocaleString():"—"}</p>
                </div>
                <div className="flex gap-2">
                  {e.role!=="champion" && !e.retired_at && (
                    <button onClick={()=>promote(selected,e.id)} className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-third">Promote</button>
                  )}
                  {!e.retired_at && e.role!=="champion" && (
                    <button onClick={()=>retire(selected,e.id)} className="text-xs px-3 py-1.5 bg-rose-100 text-rose-700 rounded-lg hover:bg-rose-200 font-third">Retire</button>
                  )}
                  {e.retired_at && <span className="text-xs text-slate-400 font-third">Retired</span>}
                </div>
              </div>
            ))}
            {entries.length===0 && <p className="text-sm text-slate-400 text-center py-4">No registry entries.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── Experiments Tab ───────────────────────────────────────────────── */
function ExperimentsTab() {
  const [exps, setExps] = useState([]);
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name:"", description:"", goal_metric:"click_rate", v1_label:"Control", v1_weight:50, v2_label:"Variant A", v2_weight:50 });
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const h = getBackendAuthHeaders();

  const load = useCallback(async()=>{
    try { const r=await fetch(`${API_BACKEND}/experiments`,{headers:h}); if(r.ok) setExps(await r.json()); } catch {}
  },[]);

  useEffect(()=>{ load(); },[load]);

  const loadResults = async (id) => {
    setSelected(id); setResults(null);
    try { const r=await fetch(`${API_BACKEND}/experiments/${id}/results`,{headers:h}); if(r.ok) setResults(await r.json()); } catch {}
  };

  const startExp = async (id) => {
    await fetch(`${API_BACKEND}/experiments/${id}/start`,{method:"POST",headers:h});
    load(); if(selected===id) loadResults(id);
  };

  const concludeExp = async (id, winner) => {
    await fetch(`${API_BACKEND}/experiments/${id}/conclude`,{method:"POST",headers:{...h,"Content-Type":"application/json"},body:JSON.stringify({winner_variant:winner})});
    load(); if(selected===id) loadResults(id);
  };

  const createExp = async () => {
    if(!form.name) { setMsg("Name required"); return; }
    if(form.v1_weight+form.v2_weight!==100) { setMsg("Weights must sum to 100"); return; }
    setCreating(true);
    try {
      const r=await fetch(`${API_BACKEND}/experiments`,{method:"POST",headers:{...h,"Content-Type":"application/json"},
        body:JSON.stringify({name:form.name,description:form.description,goal_metric:form.goal_metric,
          variants:[{id:"control",label:form.v1_label,weight:form.v1_weight},{id:"variant_a",label:form.v2_label,weight:form.v2_weight}]
        })});
      if(r.ok){ setMsg("Created!"); setShowCreate(false); load(); }
      else { const d=await r.json(); setMsg(d.detail||"Error"); }
    } catch(e){ setMsg(String(e)); }
    setCreating(false);
  };

  const statusColor = s => s==="running"?"green": s==="concluded"?"purple": s==="draft"?"amber": "slate";

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <SectionTitle>A/B Experiments</SectionTitle>
        <button onClick={()=>setShowCreate(!showCreate)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-rose-600 to-cyan-600 text-white rounded-xl text-sm font-bold font-third">
          <Plus className="w-4 h-4"/> New Experiment
        </button>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}}>
            <Card className="p-6">
              <div className="flex justify-between mb-4"><h4 className="font-bold text-slate-800 font-third">Create Experiment</h4><button onClick={()=>setShowCreate(false)}><X className="w-4 h-4 text-slate-400"/></button></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-xs font-semibold text-slate-600 font-third">Name *</label><input className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
                <div><label className="text-xs font-semibold text-slate-600 font-third">Goal Metric</label><input className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm" value={form.goal_metric} onChange={e=>setForm(f=>({...f,goal_metric:e.target.value}))}/></div>
                <div><label className="text-xs font-semibold text-slate-600 font-third">Control Label</label><input className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm" value={form.v1_label} onChange={e=>setForm(f=>({...f,v1_label:e.target.value}))}/></div>
                <div><label className="text-xs font-semibold text-slate-600 font-third">Control Weight (%)</label><input type="number" min="1" max="99" className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm" value={form.v1_weight} onChange={e=>setForm(f=>({...f,v1_weight:Number(e.target.value),v2_weight:100-Number(e.target.value)}))}/></div>
                <div><label className="text-xs font-semibold text-slate-600 font-third">Variant A Label</label><input className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm" value={form.v2_label} onChange={e=>setForm(f=>({...f,v2_label:e.target.value}))}/></div>
                <div><label className="text-xs font-semibold text-slate-600 font-third">Variant A Weight (%)</label><input type="number" className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm" value={form.v2_weight} readOnly/></div>
              </div>
              {msg && <p className="text-xs text-rose-600 mt-2">{msg}</p>}
              <button onClick={createExp} disabled={creating} className="mt-4 px-6 py-2.5 bg-gradient-to-br from-rose-600 to-cyan-600 text-white rounded-xl text-sm font-bold font-third disabled:opacity-50">{creating?"Creating…":"Create"}</button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="space-y-3">
            {exps.map(e=>(
              <button key={e.id} onClick={()=>loadResults(e.id)} className={`w-full text-left p-4 rounded-xl border transition-all ${selected===e.id?"border-rose-400 bg-rose-50":"border-slate-200 hover:border-slate-300"}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-900 font-third">{e.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{e.goal_metric} · {e.variants?.length} variants</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {pill(e.status, statusColor(e.status))}
                    {e.status==="draft" && <button onClick={ev=>{ev.stopPropagation();startExp(e.id);}} className="text-xs px-2 py-1 bg-emerald-600 text-white rounded-lg"><Play className="w-3 h-3"/></button>}
                    {e.status==="running" && <button onClick={ev=>{ev.stopPropagation();concludeExp(e.id,null);}} className="text-xs px-2 py-1 bg-slate-700 text-white rounded-lg"><Flag className="w-3 h-3"/></button>}
                  </div>
                </div>
                {e.winner_variant && <p className="text-xs text-purple-600 mt-1 font-semibold">Winner: {e.winner_variant}</p>}
              </button>
            ))}
            {exps.length===0 && <p className="text-sm text-slate-400 text-center py-8">No experiments yet. Create one above.</p>}
          </div>
        </Card>

        {results && (
          <Card className="p-5">
            <SectionTitle>Results — {results.name}</SectionTitle>
            <div className="space-y-3">
              {results.variants?.map(v=>(
                <div key={v.variant} className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-slate-900 font-third">{v.variant}</span>
                    {results.winner_variant===v.variant && <Trophy className="w-4 h-4 text-amber-500"/>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs font-third">
                    <div><span className="text-slate-500">Assignments</span><p className="font-bold">{v.assignments}</p></div>
                    <div><span className="text-slate-500">CTR</span><p className="font-bold text-blue-600">{(v.ctr*100).toFixed(1)}%</p></div>
                    <div><span className="text-slate-500">CVR</span><p className="font-bold text-emerald-600">{(v.cvr*100).toFixed(1)}%</p></div>
                  </div>
                  {v.lift_vs_control!=null && (
                    <p className={`text-xs mt-2 font-semibold font-third ${v.lift_vs_control>=0?"text-emerald-600":"text-rose-600"}`}>
                      Lift: {v.lift_vs_control>=0?"+":""}{(v.lift_vs_control*100).toFixed(1)}% vs control
                    </p>
                  )}
                  {v.variant==="control" && <p className="text-xs text-slate-400 mt-1">Baseline</p>}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ── Event Stream Tab ──────────────────────────────────────────────── */
function EventStreamTab() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const h = getBackendAuthHeaders();

  const load = useCallback(async()=>{
    try { const r=await fetch(`${API_BACKEND}/kafka/events?limit=50`,{headers:h}); if(r.ok){ const d=await r.json(); setEvents(d.events||[]); } }
    catch {} setLoading(false);
  },[]);

  useEffect(()=>{ load(); const iv=setInterval(load,10000); return()=>clearInterval(iv); },[load]);

  const typeColor = t => t==="recommendation_served"?"blue": t==="training_completed"?"emerald": t==="click"?"rose": t==="rating"?"amber": "slate";
  const typeIcon  = t => t==="training_completed"?<Cpu className="w-3 h-3"/>: t==="recommendation_served"?<Zap className="w-3 h-3"/>: <Activity className="w-3 h-3"/>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>Live Event Stream</SectionTitle>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 font-third"><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>
      </div>
      <Card className="p-5">
        {loading ? <p className="text-sm text-slate-400">Loading events…</p> : events.length===0 ? (
          <div className="text-center py-12">
            <Radio className="w-8 h-8 text-slate-300 mx-auto mb-3"/>
            <p className="text-sm text-slate-400 font-third">No events in buffer yet. Events appear here as they are produced.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            <AnimatePresence>
              {events.map((ev,i)=>(
                <motion.div key={ev.event_id||i} initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} transition={{delay:i*0.02}}
                  className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 bg-${typeColor(ev.event_type)}-100 text-${typeColor(ev.event_type)}-600`}>
                    {typeIcon(ev.event_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {pill(ev.event_type, typeColor(ev.event_type))}
                      {ev.project_id && <span className="text-xs text-slate-400 font-mono">proj:{ev.project_id}</span>}
                      {ev.source_service && <span className="text-xs text-slate-400">{ev.source_service}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 font-mono flex-wrap">
                      {ev.event_id && <span className="truncate max-w-[140px]">{ev.event_id}</span>}
                      {ev.occurred_at && <span>{new Date(ev.occurred_at).toLocaleTimeString()}</span>}
                      {ev.api_route && <span className="text-slate-300">{ev.api_route}</span>}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Serving Controls Tab ──────────────────────────────────────────── */
function ServingControlsTab() {
  const [projects, setProjects] = useState([]);
  const [controls, setControls] = useState({});
  const [saving, setSaving] = useState({});
  const h = getBackendAuthHeaders();

  useEffect(()=>{
    fetch(`${API_BACKEND}/projects/`,{headers:h}).then(r=>r.json()).then(ps=>{
      if(!Array.isArray(ps)) return;
      const ready = ps.filter(p=>p.status==="ready");
      setProjects(ready);
      ready.forEach(p=>{
        fetch(`${API_BACKEND}/project/${p.id}/serving-controls`,{headers:h})
          .then(r=>r.json()).then(d=>setControls(c=>({...c,[p.id]:d}))).catch(()=>{});
      });
    }).catch(()=>{});
  },[]);

  const update = async (pid, payload) => {
    setSaving(s=>({...s,[pid]:true}));
    try {
      const r=await fetch(`${API_BACKEND}/project/${pid}/serving-controls`,{method:"PATCH",headers:{...h,"Content-Type":"application/json"},body:JSON.stringify(payload)});
      if(r.ok){ const d=await r.json(); setControls(c=>({...c,[pid]:d})); }
    } catch {} setSaving(s=>({...s,[pid]:false}));
  };

  return (
    <div className="space-y-4">
      <SectionTitle>Serving Controls</SectionTitle>
      {projects.length===0 && <Card className="p-8 text-center"><p className="text-sm text-slate-400">No ready projects found.</p></Card>}
      {projects.map(p=>{
        const ctrl = controls[p.id]||{};
        return (
          <Card key={p.id} className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="font-bold text-slate-900 font-third">{p.project_name}</p>
                <p className="text-xs text-slate-400">Project {p.id} · {p.model_type}</p>
              </div>
              {pill(p.status,"green")}
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div className={`w-10 h-5 rounded-full transition-colors ${ctrl.shadow_enabled?"bg-cyan-500":"bg-slate-300"} relative`}
                    onClick={()=>update(p.id,{shadow_enabled:!ctrl.shadow_enabled})}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${ctrl.shadow_enabled?"translate-x-5":"translate-x-0.5"}`}/>
                  </div>
                  <span className="text-sm font-semibold text-slate-700 font-third">Shadow Serving</span>
                </label>
                <p className="text-xs text-slate-400 mt-1 ml-12">Route {ctrl.shadow_percentage||10}% to challenger</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 font-third block mb-1">Shadow % ({ctrl.shadow_percentage||10}%)</label>
                <input type="range" min="1" max="50" value={ctrl.shadow_percentage||10}
                  onChange={e=>setControls(c=>({...c,[p.id]:{...ctrl,shadow_percentage:Number(e.target.value)}}))}
                  onMouseUp={e=>update(p.id,{shadow_percentage:Number(e.target.value)})}
                  className="w-full accent-rose-500"/>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 font-third block mb-1">Latency Warn ({ctrl.latency_warn_ms||500}ms)</label>
                <input type="range" min="100" max="5000" step="100" value={ctrl.latency_warn_ms||500}
                  onChange={e=>setControls(c=>({...c,[p.id]:{...ctrl,latency_warn_ms:Number(e.target.value)}}))}
                  onMouseUp={e=>update(p.id,{latency_warn_ms:Number(e.target.value)})}
                  className="w-full accent-amber-500"/>
              </div>
            </div>
            {(ctrl.champion_latency_ms||ctrl.challenger_latency_ms) && (
              <div className="mt-4 flex gap-6 text-xs font-third">
                {ctrl.champion_latency_ms && <span className="text-emerald-600">Champion: {ctrl.champion_latency_ms.toFixed(1)}ms</span>}
                {ctrl.challenger_latency_ms && <span className="text-blue-600">Challenger: {ctrl.challenger_latency_ms.toFixed(1)}ms</span>}
              </div>
            )}
            {saving[p.id] && <p className="text-xs text-slate-400 mt-2 animate-pulse">Saving…</p>}
          </Card>
        );
      })}
    </div>
  );
}

/* ── Main Layout ───────────────────────────────────────────────────── */
export default function OperationsHub() {
  const [activeTab, setActiveTab] = useState("health");

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 font-main">Operations Hub</h1>
          <p className="text-slate-500 font-third mt-1">System health, observability, and experiment controls</p>
        </div>
      </div>

      <div className="flex overflow-x-auto gap-2 pb-2 scrollbar-hide">
        {TABS.map(t=>{
          const active = activeTab===t.id;
          const Icon = t.Icon;
          return (
            <button key={t.id} onClick={()=>setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-third text-sm font-semibold whitespace-nowrap transition-all ${
                active?"bg-slate-900 text-white shadow-md":"bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300"
              }`}>
              <Icon className="w-4 h-4"/>
              {t.label}
            </button>
          );
        })}
      </div>

      <motion.div key={activeTab} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.2}}>
        {activeTab==="health" && <SystemHealthTab/>}
        {activeTab==="registry" && <ModelRegistryTab/>}
        {activeTab==="experiments" && <ExperimentsTab/>}
        {activeTab==="events" && <EventStreamTab/>}
        {activeTab==="serving" && <ServingControlsTab/>}
      </motion.div>
    </div>
  );
}
