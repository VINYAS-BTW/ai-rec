import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Truck,
  Package,
  Sparkles,
  Loader2,
  ChevronDown,
  Upload,
  Play,
  RefreshCw,
} from "lucide-react";
import { API_BACKEND, getBackendAuthHeaders } from "../api";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

const TABS = {
  logistics: {
    label: "Logistics",
    headline: "Logistics recommendations",
    sub: "Train all 3 logistics HYBRID models (carriers, lanes, warehouses) and recommend from constraints.",
    icon: Truck,
    domains: ["logistics_carriers", "logistics_lanes", "logistics_warehouses"],
  },
  supply: {
    label: "Supply chain",
    headline: "Supply chain recommendations",
    sub: "Train and recommend across suppliers, materials, and SKUs.",
    icon: Package,
    domains: ["supply_chain_suppliers", "supply_chain_materials", "supply_chain_skus"],
  },
};

function parseConstraintQuery(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return {};
  if (raw.startsWith("{")) {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }
  const out = {};
  for (const part of raw.split(/[\n,;]+/)) {
    const m = String(part).trim().match(/^([^=:]+)[=:](.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function SearchableSelect({ value, onChange, options, placeholder = "Any", id }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef(null);
  const filtered = useMemo(() => {
    const f = (filter || "").trim().toLowerCase();
    if (!f) return options;
    return options.filter((o) => String(o).toLowerCase().includes(f));
  }, [options, filter]);
  useEffect(() => {
    const h = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 border-2 border-slate-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 bg-white text-left text-sm font-third hover:border-slate-300 flex items-center justify-between"
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border-2 border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="w-full px-3 py-2 border-b border-slate-200 text-sm font-third focus:outline-none"
          />
          <div className="max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                setFilter("");
              }}
              className="w-full px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100 font-third"
            >
              {placeholder}
            </button>
            {filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                  setFilter("");
                }}
                className={`w-full px-3 py-2 text-left text-sm font-third hover:bg-cyan-50 ${value === opt ? "bg-cyan-50 text-cyan-800" : ""}`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DomainAgents() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState("logistics");
  const cfg = TABS[tab];

  const [mode, setMode] = useState("recommend");
  const [logisticsTarget, setLogisticsTarget] = useState("logistics_carriers"); // carriers | lanes | warehouses
  const [supplyTarget, setSupplyTarget] = useState("supply_chain_suppliers"); // suppliers | materials | skus

  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [ctxOptions, setCtxOptions] = useState(null);
  const [projectId, setProjectId] = useState(null);

  const [selectedCriteria, setSelectedCriteria] = useState([]);
  const [contextSelections, setContextSelections] = useState({});
  const [queryText, setQueryText] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [n, setN] = useState(10);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [trainName, setTrainName] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [logisticsUploads, setLogisticsUploads] = useState({
    carriers_content_file: null,
    carriers_interactions_file: null,
    lanes_content_file: null,
    lanes_interactions_file: null,
    warehouses_content_file: null,
    warehouses_interactions_file: null,
  });
  const [training, setTraining] = useState(false);
  const [trainJobs, setTrainJobs] = useState([]);

  const selectedDomainSlug = useMemo(() => {
    const domains = cfg.domains || [];
    if (!domains.length) return "";
    if (domains.length === 1) return domains[0];
    if (tab === "logistics") return logisticsTarget;
    if (tab === "supply") return supplyTarget;
    return domains[0];
  }, [cfg, tab, logisticsTarget, supplyTarget]);

  const fetchContextOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError("");
    setCtxOptions(null);
    setProjectId(null);
    try {
      if (!selectedDomainSlug) throw new Error("Missing domain for this agent UI.");

      const res = await fetch(
        `${API_BACKEND}/agent/v1/context-options?domain_slug=${encodeURIComponent(selectedDomainSlug)}`,
        { headers: getBackendAuthHeaders() },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          navigate("/login", { replace: true });
          return;
        }
        const detail = data?.detail || data?.message || `Failed (${res.status})`;
        throw new Error(detail);
      }

      const featureColumns = (data.feature_columns || []).filter(
        (fc) => String(fc?.name || "") !== "mean_rating",
      );

      setCtxOptions({
        target_column: data.target_column,
        feature_columns: featureColumns,
        target_values: data.target_values,
      });
      setProjectId(data.project_id);

      // Do NOT auto-select constraints; user explicitly chooses which to apply.
      setSelectedCriteria([]);

      const init = {};
      for (const fc of featureColumns) {
        if (fc.column_type === "numeric" && fc.numeric_range) {
          const { min, max } = fc.numeric_range;
          const mid = min + (max - min) / 2;
          init[fc.name] = String(Number(mid.toFixed(6)));
        } else if (fc.values?.length) {
          init[fc.name] = fc.values[0];
        }
      }
      setContextSelections(init);
    } catch (e) {
      setOptionsError(e?.message || String(e));
    } finally {
      setOptionsLoading(false);
    }
  }, [selectedDomainSlug, logout, navigate]);

  useEffect(() => {
    if (mode !== "recommend") return;
    fetchContextOptions();
  }, [mode, tab, logisticsTarget, fetchContextOptions]);

  useEffect(() => {
    if (!trainJobs?.length) return;

    const active = trainJobs.some(
      (j) => !["ready", "failed", "error"].includes(String(j.status || "").toLowerCase()),
    );
    if (!active) return;

    const t = setInterval(async () => {
      try {
        const updated = await Promise.all(
          trainJobs.map(async (job) => {
            const res = await fetch(`${API_BACKEND}/project/${job.id}/status`, {
              headers: getBackendAuthHeaders(),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) return { ...job, status: "error" };
            const st = String(data.status || "").toLowerCase();
            return { ...job, status: st };
          }),
        );

        setTrainJobs(updated);

        const allReady = updated.every((j) => String(j.status || "").toLowerCase() === "ready");
        const anyFailed = updated.some((j) =>
          ["failed", "error"].includes(String(j.status || "").toLowerCase()),
        );

        if (allReady) {
          toast.success("Training finished.");
          clearInterval(t);
          fetchContextOptions();
        } else if (anyFailed) {
          toast.error("Training failed.");
          clearInterval(t);
        }
      } catch {
        /* ignore */
      }
    }, 2500);

    return () => clearInterval(t);
  }, [trainJobs, fetchContextOptions]);

  const buildContext = () => {
    const ctx = {};
    for (const name of selectedCriteria) {
      const v = contextSelections[name];
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      ctx[name] = v;
    }
    const parsed = parseConstraintQuery(queryText);
    return { ...ctx, ...parsed };
  };

  const runRecommend = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const context = buildContext();
      if (!selectedDomainSlug) throw new Error("Missing domain selection.");

      const body = {
        correlation_id: "domain-agents-ui",
        target_domain: selectedDomainSlug,
        context,
        n: Number(n) || 10,
      };
      const it = itemTitle && String(itemTitle).trim();
      if (it) body.item_title = it;

      const res = await fetch(`${API_BACKEND}/agent/v1/recommend`, {
        method: "POST",
        headers: {
          ...getBackendAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          navigate("/login", { replace: true });
          return;
        }
        throw new Error(data?.detail || data?.message || `Request failed (${res.status})`);
      }
      setResult(data);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  const runTrainPreset = async () => {
    setTraining(true);
    setError("");
    try {
      const fd = new FormData();

      let res;
      let data = {};

      if (tab === "logistics" && (cfg.domains || []).length > 1) {
        // Logistics: train all 3 HYBRID models from bundled datasets.
        fd.append("project_name_prefix", trainName.trim() || "logistics");
        res = await fetch(`${API_BACKEND}/agent/v1/train-logistics-all`, {
          method: "POST",
          headers: getBackendAuthHeaders(),
          body: fd,
        });
      } else {
        fd.append("preset", selectedDomainSlug);
        if (trainName.trim()) fd.append("project_name", trainName.trim());
        res = await fetch(`${API_BACKEND}/agent/v1/train-preset`, {
          method: "POST",
          headers: getBackendAuthHeaders(),
          body: fd,
        });
      }

      data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          navigate("/login", { replace: true });
          return;
        }
        throw new Error(data?.detail || data?.message || `Train failed (${res.status})`);
      }

      if (tab === "logistics" && (cfg.domains || []).length > 1) {
        const created = Array.isArray(data?.created) ? data.created : [];
        if (!created.length) throw new Error(data?.detail || "No projects returned.");
        setTrainJobs(
          created.map((j) => ({
            id: j.id,
            domain_slug: j.domain_slug,
            status: String(j.status || "pending").toLowerCase(),
          })),
        );
        toast.success(`Logistics training started for ${created.length} projects.`);
      } else {
        toast.success(`Training started (project #${data.id}).`);
        setTrainJobs([
          { id: data.id, status: String(data.status || "pending").toLowerCase() },
        ]);
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setTraining(false);
    }
  };

  const runTrainUpload = async () => {
    setTraining(true);
    setError("");
    try {
      const fd = new FormData();

      let res;
      if (tab === "logistics" && (cfg.domains || []).length > 1) {
        // Logistics: upload 6 files.
        const u = logisticsUploads || {};
        const required = [
          "carriers_content_file",
          "carriers_interactions_file",
          "lanes_content_file",
          "lanes_interactions_file",
          "warehouses_content_file",
          "warehouses_interactions_file",
        ];
        const missing = required.filter((k) => !u[k]);
        if (missing.length) {
          throw new Error(`Choose all logistics CSVs first (missing: ${missing.join(", ")})`);
        }

        fd.append("project_name_prefix", trainName.trim() || "logistics");
        fd.append("carriers_content_file", u.carriers_content_file);
        fd.append("carriers_interactions_file", u.carriers_interactions_file);
        fd.append("lanes_content_file", u.lanes_content_file);
        fd.append("lanes_interactions_file", u.lanes_interactions_file);
        fd.append("warehouses_content_file", u.warehouses_content_file);
        fd.append("warehouses_interactions_file", u.warehouses_interactions_file);

        res = await fetch(`${API_BACKEND}/agent/v1/train-logistics-upload`, {
          method: "POST",
          headers: getBackendAuthHeaders(),
          body: fd,
        });
      } else {
        if (!uploadFile) throw new Error("Choose a CSV file first.");
        fd.append("domain", selectedDomainSlug);
        fd.append("content_file", uploadFile);
        if (trainName.trim()) fd.append("project_name", trainName.trim());

        res = await fetch(`${API_BACKEND}/agent/v1/train-upload`, {
          method: "POST",
          headers: getBackendAuthHeaders(),
          body: fd,
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          navigate("/login", { replace: true });
          return;
        }
        throw new Error(data?.detail || data?.message || `Upload train failed (${res.status})`);
      }

      if (tab === "logistics" && (cfg.domains || []).length > 1) {
        const created = Array.isArray(data?.created) ? data.created : [];
        if (!created.length) throw new Error(data?.detail || "No projects returned.");
        setTrainJobs(
          created.map((j) => ({
            id: j.id,
            domain_slug: j.domain_slug,
            status: String(j.status || "pending").toLowerCase(),
          })),
        );
        toast.success(`Logistics training started (${created.length} projects).`);
        setLogisticsUploads({
          carriers_content_file: null,
          carriers_interactions_file: null,
          lanes_content_file: null,
          lanes_interactions_file: null,
          warehouses_content_file: null,
          warehouses_interactions_file: null,
        });
      } else {
        toast.success(`Training started (project #${data.id}).`);
        setTrainJobs([
          { id: data.id, status: String(data.status || "pending").toLowerCase() },
        ]);
        setUploadFile(null);
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setTraining(false);
    }
  };

  const Icon = cfg.icon;

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10 min-h-full bg-gradient-to-br from-neutral-50 via-white to-slate-50">
      <div className="max-w-4xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <p className="text-xs font-semibold tracking-[0.3em] uppercase text-slate-400 font-third flex items-center gap-2">
            <span className="w-8 h-[2px] bg-gradient-to-r from-rose-400 to-transparent" />
            Domain agents
          </p>
          <h1 className="text-3xl lg:text-4xl font-bold text-neutral-900 font-main tracking-tight">
            Logistics &amp; supply chain
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl font-third leading-relaxed">
            Two flows: train a parameter-driven model on your data (bundled CSV or upload with the same columns as
            the template), or get recommendations from an already trained model by setting constraints and
            optional &quot;similar to&quot; seed.
          </p>
        </motion.div>

        <div className="flex flex-wrap gap-2 p-1 bg-slate-100/80 rounded-2xl border border-slate-200">
          {Object.entries(TABS).map(([key, c]) => {
            const I = c.icon;
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex-1 min-w-[140px] flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-third font-bold transition-all ${
                  active
                    ? "bg-white text-slate-900 shadow-md border border-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <I className="w-4 h-4" />
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap gap-2 shadow-sm">
          <button
            type="button"
            onClick={() => setMode("recommend")}
            className={`px-4 py-2 rounded-2xl text-sm font-third font-bold ${
              mode === "recommend"
                ? "bg-gradient-to-r from-rose-700 to-cyan-800 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Use existing model
          </button>
          <button
            type="button"
            onClick={() => setMode("train")}
            className={`px-4 py-2 rounded-2xl text-sm font-third font-bold ${
              mode === "train"
                ? "bg-gradient-to-r from-rose-700 to-cyan-800 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Train on data source
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden"
        >
          <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-rose-50/50 to-cyan-50/50 flex items-start gap-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-rose-600 to-cyan-800 text-white shadow-lg">
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 font-third">{cfg.headline}</h2>
              <p className="text-xs text-slate-600 font-third mt-1">{cfg.sub}</p>
              {projectId != null && mode === "recommend" && (
                <p className="text-[11px] text-slate-500 mt-2 font-mono">Project #{projectId}</p>
              )}
            </div>
          </div>

          <div className="p-6 space-y-6">
            {mode === "train" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-2 font-third">
                    Project name (optional)
                  </label>
                  <input
                    type="text"
                    value={trainName}
                    onChange={(e) => setTrainName(e.target.value)}
                    placeholder={`e.g. ${(cfg.domains && cfg.domains[0]) || "domain"}_my_team`}
                    className="w-full px-4 py-3 border-2 border-slate-200 rounded-2xl text-sm font-third focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  />
                </div>

                {(cfg.domains || []).length > 1 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                      <p className="text-sm font-bold text-slate-800 font-third">Bundled datasets</p>
                      <p className="text-xs text-slate-500 font-third">
                        Trains HYBRID models for carriers, lanes, and warehouses using content + interactions from{" "}
                        <code className="text-[11px] bg-slate-100 px-1 rounded">backend/agent_datasets</code>.
                      </p>
                      <button
                        type="button"
                        disabled={training}
                        onClick={runTrainPreset}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-third font-bold hover:bg-slate-800 disabled:opacity-50"
                      >
                        {training ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                        Train from preset (all 3)
                      </button>
                    </div>

                    <div className="rounded-2xl border border-dashed border-slate-300 p-4 space-y-3">
                      <p className="text-sm font-bold text-slate-800 font-third">Upload datasets</p>
                      <p className="text-xs text-slate-500 font-third">
                        Upload 6 CSVs: content + interactions for carriers, lanes, and warehouses.
                      </p>

                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-bold text-slate-700 font-third">Carriers content</p>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={(e) =>
                              setLogisticsUploads((prev) => ({
                                ...prev,
                                carriers_content_file: e.target.files?.[0] || null,
                              }))
                            }
                            className="mt-2"
                          />
                          {logisticsUploads.carriers_content_file && (
                            <p className="text-[11px] text-slate-600 font-mono truncate">
                              {logisticsUploads.carriers_content_file.name}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-700 font-third">Carriers interactions</p>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={(e) =>
                              setLogisticsUploads((prev) => ({
                                ...prev,
                                carriers_interactions_file: e.target.files?.[0] || null,
                              }))
                            }
                            className="mt-2"
                          />
                          {logisticsUploads.carriers_interactions_file && (
                            <p className="text-[11px] text-slate-600 font-mono truncate">
                              {logisticsUploads.carriers_interactions_file.name}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-700 font-third">Lanes content</p>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={(e) =>
                              setLogisticsUploads((prev) => ({
                                ...prev,
                                lanes_content_file: e.target.files?.[0] || null,
                              }))
                            }
                            className="mt-2"
                          />
                          {logisticsUploads.lanes_content_file && (
                            <p className="text-[11px] text-slate-600 font-mono truncate">
                              {logisticsUploads.lanes_content_file.name}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-700 font-third">Lanes interactions</p>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={(e) =>
                              setLogisticsUploads((prev) => ({
                                ...prev,
                                lanes_interactions_file: e.target.files?.[0] || null,
                              }))
                            }
                            className="mt-2"
                          />
                          {logisticsUploads.lanes_interactions_file && (
                            <p className="text-[11px] text-slate-600 font-mono truncate">
                              {logisticsUploads.lanes_interactions_file.name}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-700 font-third">Warehouses content</p>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={(e) =>
                              setLogisticsUploads((prev) => ({
                                ...prev,
                                warehouses_content_file: e.target.files?.[0] || null,
                              }))
                            }
                            className="mt-2"
                          />
                          {logisticsUploads.warehouses_content_file && (
                            <p className="text-[11px] text-slate-600 font-mono truncate">
                              {logisticsUploads.warehouses_content_file.name}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-700 font-third">Warehouses interactions</p>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={(e) =>
                              setLogisticsUploads((prev) => ({
                                ...prev,
                                warehouses_interactions_file: e.target.files?.[0] || null,
                              }))
                            }
                            className="mt-2"
                          />
                          {logisticsUploads.warehouses_interactions_file && (
                            <p className="text-[11px] text-slate-600 font-mono truncate">
                              {logisticsUploads.warehouses_interactions_file.name}
                            </p>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={training}
                        onClick={runTrainUpload}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-third font-bold hover:border-cyan-400 disabled:opacity-50"
                      >
                        {training ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Train from uploads (all 3)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                      <p className="text-sm font-bold text-slate-800 font-third">Bundled dataset</p>
                      <p className="text-xs text-slate-500 font-third">
                        Trains a HYBRID model using content + interactions from{" "}
                        <code className="text-[11px] bg-slate-100 px-1 rounded">backend/agent_datasets</code>.
                      </p>
                      <button
                        type="button"
                        disabled={training}
                        onClick={runTrainPreset}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-third font-bold hover:bg-slate-800 disabled:opacity-50"
                      >
                        {training ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                        Train from preset
                      </button>
                    </div>

                    <div className="rounded-2xl border border-dashed border-slate-300 p-4 space-y-3">
                      <p className="text-sm font-bold text-slate-800 font-third">Your CSV</p>
                      <p className="text-xs text-slate-500 font-third">
                        For uploads, we train from content only (same headers as the bundled content template).
                      </p>
                      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer font-third">
                        <Upload className="w-4 h-4" />
                        <span className="text-cyan-700 font-bold">Choose file</span>
                        <input
                          type="file"
                          accept=".csv"
                          className="hidden"
                          onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                        />
                      </label>
                      {uploadFile && (
                        <p className="text-xs text-slate-600 truncate font-mono">{uploadFile.name}</p>
                      )}
                      <button
                        type="button"
                        disabled={training || !uploadFile}
                        onClick={runTrainUpload}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-third font-bold hover:border-cyan-400 disabled:opacity-50"
                      >
                        {training ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Train from upload
                      </button>
                    </div>
                  </div>
                )}

                {trainJobs?.length > 0 && (
                  <div className="space-y-2">
                    {trainJobs.map((j) => (
                      <p key={j.id} className="text-xs text-slate-600 font-third">
                        Active job: project <strong>#{j.id}</strong>{" "}
                        {j.domain_slug && (
                          <span className="text-slate-500 font-mono">· {j.domain_slug}</span>
                        )}{" "}
                        — status <strong>{j.status}</strong>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {mode === "recommend" && (
              <div className="space-y-4">
                {(cfg.domains || []).length > 1 && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-xs font-bold text-slate-600 font-third mb-2">
                      What do you want recommended?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(tab === "logistics"
                        ? [
                            { id: "logistics_carriers", label: "Carriers" },
                            { id: "logistics_lanes", label: "Lanes" },
                            { id: "logistics_warehouses", label: "Warehouses" },
                          ]
                        : [
                            { id: "supply_chain_suppliers", label: "Suppliers" },
                            { id: "supply_chain_materials", label: "Materials" },
                            { id: "supply_chain_skus", label: "SKUs" },
                          ]
                      ).map((opt) => {
                        const active =
                          tab === "logistics" ? logisticsTarget === opt.id : supplyTarget === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              if (tab === "logistics") setLogisticsTarget(opt.id);
                              else setSupplyTarget(opt.id);
                              setItemTitle("");
                              setQueryText("");
                              setResult(null);
                              setError("");
                            }}
                            className={`px-3 py-2 rounded-xl text-sm font-third font-bold border transition-all ${
                              active
                                ? "bg-white border-cyan-300 text-cyan-900 shadow-sm"
                                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-white"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={fetchContextOptions}
                    className="inline-flex items-center gap-2 text-xs font-bold text-cyan-800 font-third"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reload constraints
                  </button>
                  {optionsLoading && (
                    <span className="text-xs text-slate-500 flex items-center gap-1 font-third">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                    </span>
                  )}
                </div>

                {optionsError && (
                  <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 font-third">
                    {optionsError}{" "}
                    <span className="text-amber-800">
                      Switch to <strong>Train on data source</strong> to create a model first.
                    </span>
                  </div>
                )}

                {!optionsError && ctxOptions?.feature_columns?.length > 0 && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2 font-third">
                        Constraints to use
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {ctxOptions.feature_columns.map((fc) => {
                          const on = selectedCriteria.includes(fc.name);
                          return (
                            <button
                              key={fc.name}
                              type="button"
                              onClick={() => {
                                setSelectedCriteria((prev) =>
                                  on ? prev.filter((x) => x !== fc.name) : [...prev, fc.name],
                                );
                              }}
                              className={`px-3 py-1.5 rounded-full text-xs font-third font-bold border ${
                                on
                                  ? "bg-cyan-50 border-cyan-300 text-cyan-900"
                                  : "bg-slate-50 border-slate-200 text-slate-600"
                              }`}
                            >
                              {fc.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {ctxOptions.feature_columns
                        .filter((fc) => selectedCriteria.includes(fc.name))
                        .map((fc) => {
                          const isNumeric = fc.column_type === "numeric" && fc.numeric_range;
                          const range = fc.numeric_range || {};
                          const catOptions = (fc.values || []).filter(
                            (v) => v != null && String(v).trim() && String(v).toLowerCase() !== "nan",
                          );
                          return (
                            <div key={fc.name}>
                              <label className="block text-xs font-bold text-slate-600 mb-1 font-third">
                                {fc.name}
                                {isNumeric && range.min != null && range.max != null && (
                                  <span className="text-slate-400 font-normal ml-1">
                                    ({range.min} – {range.max})
                                  </span>
                                )}
                              </label>
                              {isNumeric ? (
                                <input
                                  type="number"
                                  min={range.min}
                                  max={range.max}
                                  step="any"
                                  value={contextSelections[fc.name] ?? ""}
                                  onChange={(e) =>
                                    setContextSelections((prev) => ({ ...prev, [fc.name]: e.target.value }))
                                  }
                                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-2xl text-sm font-third focus:outline-none focus:ring-2 focus:ring-cyan-400"
                                />
                              ) : (
                                <SearchableSelect
                                  id={`ctx-${fc.name}`}
                                  value={contextSelections[fc.name] ?? ""}
                                  onChange={(v) => setContextSelections((prev) => ({ ...prev, [fc.name]: v }))}
                                  options={catOptions}
                                />
                              )}
                            </div>
                          );
                        })}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2 font-third">
                        Optional query (JSON or key=value lines)
                      </label>
                      <textarea
                        value={queryText}
                        onChange={(e) => setQueryText(e.target.value)}
                        rows={3}
                        placeholder={'mode=road\nregion=North\nor {"mode":"road","region":"North"}'}
                        className="w-full px-4 py-3 border-2 border-slate-200 rounded-2xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400"
                      />
                    </div>

                    <div
                      className={`grid grid-cols-1 gap-4 ${
                        (cfg.domains || []).length > 1 ? "sm:grid-cols-1" : "sm:grid-cols-2"
                      }`}
                    >
                      {(cfg.domains || []).length === 1 && (
                        <div>
                          <label className="block text-xs font-bold text-slate-600 mb-2 font-third">
                            Similar to ({ctxOptions.target_column || "target"})
                          </label>
                          <SearchableSelect
                            id="similar-to"
                            value={itemTitle}
                            onChange={(v) => setItemTitle(v)}
                            options={(ctxOptions.target_values || []).slice(0, 2000)}
                            placeholder="Optional seed"
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-2 font-third">Count</label>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={n}
                          onChange={(e) => setN(e.target.value)}
                          className="w-full px-4 py-3 border-2 border-slate-200 rounded-2xl text-sm font-third"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={running}
                      onClick={runRecommend}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3 rounded-2xl bg-gradient-to-r from-rose-700 to-cyan-800 text-white font-third font-bold shadow-lg hover:opacity-95 disabled:opacity-50"
                    >
                      {running ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                      Get recommendations
                    </button>
                  </>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-900 font-third">
                {error}
              </div>
            )}

            {result?.results?.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                <p className="text-sm font-bold text-slate-900 font-third">Results</p>
                {result.results.map((block) => (
                  <div key={block.domain_slug} className="space-y-2">
                    <p className="text-xs text-slate-500 font-third">
                      {block.domain_slug} · project #{block.project_id}
                    </p>
                    <ul className="space-y-2">
                      {(block.recommendations || []).map((r, i) => (
                        <li
                          key={i}
                          className="flex flex-wrap gap-2 text-sm text-slate-800 font-third bg-white rounded-xl border border-slate-200 px-3 py-2"
                        >
                          {(r.title != null || r.value != null) && (
                            <span className="font-bold">{r.title ?? r.value}</span>
                          )}
                          {r.item_id != null && (
                            <span className="text-slate-500 font-mono text-xs">{r.item_id}</span>
                          )}
                          {r.score != null && (
                            <span className="text-cyan-800 text-xs">score: {Number(r.score).toFixed(4)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
