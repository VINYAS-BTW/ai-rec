import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import Papa from "papaparse";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Sparkles,
  TrendingUp,
  ChevronDown,
  Loader2,
  CheckCircle,
  AlertCircle,
  Play,
  Trash2,
  FileText,
  Users,
  Zap,
  Target,
  Award,
  Clock,
  RotateCw,
} from "lucide-react";
import { API_BACKEND, getBackendAuthHeaders } from "../api";
import { useAuth } from "../context/AuthContext";

const Input = (props) => (
  <motion.input
    whileFocus={{ scale: 1.0 }}
    {...props}
    className="w-full px-4 py-3 border-1 border-slate-200 rounded-2xl shadow-sm focus:outline-none focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400 transition-all duration-300 bg-white text-sm font-third cursor-pointer"
  />
);

const Select = (props) => (
  <div className="relative">
    <motion.select
      whileFocus={{ scale: 1.01 }}
      {...props}
      className="w-full px-4 py-3 border-2 border-slate-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 bg-white appearance-none transition-all duration-300 text-sm font-third hover:border-slate-300"
    >
      {props.children}
    </motion.select>
    <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
  </div>
);

/** Searchable dropdown for many options: type to filter, scroll to browse, click to select. */
const SearchableSelect = ({ value, onChange, options, placeholder = "Any", id }) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef(null);
  const filtered = useMemo(() => {
    const f = (filter || "").trim().toLowerCase();
    if (!f) return options;
    return options.filter((o) => String(o).toLowerCase().includes(f));
  }, [options, filter]);
  useEffect(() => {
    const h = (e) => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 border-2 border-slate-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 bg-white text-left text-sm font-third hover:border-slate-300 flex items-center justify-between"
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
            placeholder="Type to filter..."
            className="w-full px-3 py-2 border-b border-slate-200 text-sm font-third focus:outline-none focus:ring-0"
          />
          <div className="max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); setFilter(""); }}
              className="w-full px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100 font-third"
            >
              {placeholder}
            </button>
            {filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); setFilter(""); }}
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
};

const Button = ({ children, variant = "primary", icon: Icon, ...props }) => {
  const variants = {
    primary:
      "bg-gradient-to-br from-rose-600 to-cyan-600 hover:from-rose-700 hover:to-cyan-700 text-white shadow-xs  hover:shadow-xs  cursor-pointer",
    secondary:
      "bg-white border-2 border-slate-200 hover:border-cyan-400 text-slate-700 hover:text-slate-900 shadow-sm ",
  };

  return (
    <motion.button
      whileHover={{ scale: 1.0, y: 0 }}
      whileTap={{ scale: 0.98 }}
      {...props}
      className={`w-full px-6 py-3.5 text-sm font-bold rounded-2xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-third relative overflow-hidden ${variants[variant]}`}
    >
      {variant === "primary" && (
        <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
      )}
      {Icon && (
        <Icon className={`w-5 h-5 ${props.disabled && variant === "primary" ? "animate-spin" : ""}`} />
      )}
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
};

const Card = ({ children, className = "", gradient = false }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
    className={`bg-white rounded-3xl shadow-lg border border-slate-200 overflow-hidden hover:shadow-xl transition-all duration-500 ${
      gradient ? "bg-gradient-to-br from-white via-slate-50 to-white" : ""
    } ${className}`}
  >
    {children}
  </motion.div>
);

const SchemaMapper = ({ title, headers, schema, onChange, schemaKeys }) => (
  <motion.div
    initial={{ opacity: 0, height: 0 }}
    animate={{ opacity: 1, height: "auto" }}
    transition={{ duration: 0.4 }}
    className="mt-6 p-6 bg-gradient-to-br from-slate-50 via-white to-cyan-50/30 border-2 border-slate-200 rounded-2xl"
  >
    {title ? (
      <h3 className="font-bold text-slate-900 mb-5 flex items-center font-third text-sm">
        <Sparkles className="w-4 h-4 mr-2 text-cyan-600" />
        {title}
      </h3>
    ) : null}
    <div className="space-y-4">
      {schemaKeys.map(({ key, label, multi }) => (
        <div key={key}>
          <label className="block text-sm font-bold text-slate-700 mb-2 font-third">
            {label}
          </label>
          <Select
            multiple={multi}
            value={schema[key]}
            onChange={(e) => {
              const value = multi
                ? Array.from(e.target.selectedOptions, (opt) => opt.value)
                : e.target.value;
              onChange({ ...schema, [key]: value });
            }}
            className={multi ? "h-32" : ""}
          >
            {!multi && <option value="">Select a column...</option>}
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
          {multi && (
            <p className="text-xs text-slate-500 mt-2 italic font-third flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-cyan-400"></span>
              Hold Ctrl/Cmd to select multiple columns
            </p>
          )}
        </div>
      ))}
    </div>
  </motion.div>
);

function RecommenderPanel() {
  const { logout } = useAuth();

  const [projectName, setProjectName] = useState("");
  const [projectMode, setProjectMode] = useState("parameter_driven"); // "parameter_driven" | "content_interaction"
  const [contentFile, setContentFile] = useState(null);
  const [interactionFile, setInteractionFile] = useState(null);

  const [contentHeaders, setContentHeaders] = useState([]);
  const [interactionHeaders, setInteractionHeaders] = useState([]);

  const [contentSchema, setContentSchema] = useState({
    item_id: "",
    item_title: "",
    target_column: "",
    feature_cols: [],
  });
  const [parameterDrivenSchema, setParameterDrivenSchema] = useState({
    target_column: "",
    feature_cols: [], // optional; backend uses all other columns if empty
  });
  const [interactionSchema, setInteractionSchema] = useState({
    user_id: "",
    item_id: "",
    rating: "",
  });

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [currentStatus, setCurrentStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [itemsList, setItemsList] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [contextOptions, setContextOptions] = useState(null);
  const [contextSelections, setContextSelections] = useState({});
  const [selectedCriteria, setSelectedCriteria] = useState([]); // which feature columns to use for this request
  const [selectedItemTitle, setSelectedItemTitle] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedItemForSimilar, setSelectedItemForSimilar] = useState(""); // "recommend similar to this item" for parameter_driven / hybrid
  const [recommendations, setRecommendations] = useState(null);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingContextOptions, setLoadingContextOptions] = useState(false);
  const [targetValuesData, setTargetValuesData] = useState(null); // { target_column, target_values } from /target-values for "similar to" dropdown
  const [loadingTargetValues, setLoadingTargetValues] = useState(false);

  const selectedProjectIdRef = useRef(selectedProjectId);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // Unified list for "similar to" — from /target-values API (works for content, parameter_driven, hybrid)
  const similarToOptions = useMemo(() => {
    if (!selectedProject || !targetValuesData?.target_values) return [];
    return Array.isArray(targetValuesData.target_values) ? targetValuesData.target_values : [];
  }, [selectedProject, targetValuesData?.target_values]);

  const similarToValue = selectedProject?.model_type === "content" ? selectedItemTitle : selectedItemForSimilar;
  const setSimilarToValue = selectedProject?.model_type === "content" ? setSelectedItemTitle : setSelectedItemForSimilar;
  const showSimilarToInput = selectedProject?.model_type === "content" || selectedProject?.model_type === "parameter_driven" || selectedProject?.model_type === "hybrid";

  // Display name for the column the model recommends (from /target-values or context-options)
  const targetColumnLabel = useMemo(() => {
    const raw = targetValuesData?.target_column || contextOptions?.target_column;
    if (!raw || typeof raw !== "string") return "item";
    return raw.replace(/_/g, " ").trim() || "item";
  }, [targetValuesData?.target_column, contextOptions?.target_column]);

  const projectStats = useMemo(() => {
    const total = projects.length;
    const ready = projects.filter((p) => p.status === "ready").length;
    const processing = projects.filter((p) => p.status === "processing")
      .length;
    return { total, ready, processing };
  }, [projects]);

  const parseHeaders = (file, setHeaders) => {
    if (!file) {
      setHeaders([]);
      return;
    }
    Papa.parse(file, {
      header: true,
      preview: 1,
      complete: (results) => setHeaders(results.meta.fields || []),
    });
  };

  useEffect(() => parseHeaders(contentFile, setContentHeaders), [contentFile]);
  useEffect(
    () => parseHeaders(interactionFile, setInteractionHeaders),
    [interactionFile]
  );

  const fetchProjects = useCallback(async () => {
    try {
      const response = await fetch(`${API_BACKEND}/projects/`, {
        headers: getBackendAuthHeaders(),
      });
      if (!response.ok) {
        if (response.status === 401) logout();
        setProjects([]);
        return;
      }
      const data = await response.json().catch(() => []);
      setProjects(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch projects:", error);
      setProjects([]);
    }
  }, [logout]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (currentStatus === "processing" && selectedProjectId) {
      const interval = setInterval(
        () => checkProjectStatus(selectedProjectId),
        3000
      );
      return () => clearInterval(interval);
    }
  }, [currentStatus, selectedProjectId]);

  const checkProjectStatus = async (projectId) => {
    try {
      const response = await fetch(
        `${API_BACKEND}/project/${projectId}/status`,
        {
          headers: getBackendAuthHeaders(),
        }
      );
      if (!response.ok) throw new Error("Failed to get status");
      const data = await response.json();

      setCurrentStatus(data.status);
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? data : p))
      );

      if (data.status === "ready") {
        handleSelectProject(data.id);
        clearCreateForm();
      } else if (data.status === "error") {
        setErrorMessage("Project processing failed.");
      }
    } catch (error) {
      console.error("Status check failed:", error);
      setCurrentStatus("error");
    }
  };

  const clearCreateForm = () => {
    setProjectName("");
    setContentFile(null);
    setInteractionFile(null);
    setContentHeaders([]);
    setInteractionHeaders([]);
    setContentSchema({ item_id: "", item_title: "", target_column: "", feature_cols: [] });
    setParameterDrivenSchema({ target_column: "", feature_cols: [] });
    setInteractionSchema({ user_id: "", item_id: "", rating: "" });
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    const isParamDriven = projectMode === "parameter_driven";
    if (isParamDriven && (!projectName || !contentFile)) {
      setErrorMessage("Project name and a dataset file are required.");
      return;
    }
    if (!isParamDriven && (!projectName || (!contentFile && !interactionFile))) {
      setErrorMessage("Project name and at least one file are required.");
      return;
    }
    if (isParamDriven && !parameterDrivenSchema.target_column) {
      setErrorMessage("Select what you want to recommend (target column).");
      return;
    }
    if (!isParamDriven && contentFile && interactionFile) {
      if (!contentSchema.item_id?.trim()) {
        setErrorMessage("Content file: select Item ID (links to ratings file).");
        return;
      }
      if (!contentSchema.target_column?.trim() && !contentSchema.item_title?.trim()) {
        setErrorMessage("Content file: select What to recommend or Item Title.");
        return;
      }
      if (!interactionSchema.item_id?.trim()) {
        setErrorMessage("Ratings file: select Item ID (must match content).");
        return;
      }
      if (!interactionSchema.rating?.trim()) {
        setErrorMessage("Ratings file: select Rating column.");
        return;
      }
    }

    setErrorMessage("");
    setCurrentStatus("uploading");
    setRecommendations(null);

    const formData = new FormData();
    formData.append("project_name", projectName);

    if (contentFile) {
      formData.append("content_file", contentFile);
      formData.append(
        "content_schema_json",
        JSON.stringify(isParamDriven ? parameterDrivenSchema : contentSchema)
      );
    }
    if (interactionFile && !isParamDriven) {
      formData.append("interaction_file", interactionFile);
      formData.append(
        "interaction_schema_json",
        JSON.stringify(interactionSchema)
      );
    }

    try {
      const response = await fetch(`${API_BACKEND}/create-project/`, {
        method: "POST",
        headers: getBackendAuthHeaders(),
        body: formData,
      });

      if (!response.ok) {
        if (response.status === 401) {
          setErrorMessage("Session expired. Please log in again.");
          logout();
          setCurrentStatus("error");
          return;
        }
        let detail = "Upload failed";
        try {
          const err = await response.json();
          detail = err.detail || (typeof err === "string" ? err : detail);
        } catch (_) {}
        throw new Error(detail);
      }

      const data = await response.json().catch(() => null);
      if (!data || !data.id) throw new Error("Invalid response from server");

      setSelectedProjectId(data.id);
      setCurrentStatus("processing");
      fetchProjects();
    } catch (error) {
      setErrorMessage(error.message);
      setCurrentStatus("error");
    }
  };

  const handleRetrainProject = async (e, projectId) => {
    e.stopPropagation();
    setErrorMessage("");
    try {
      const response = await fetch(`${API_BACKEND}/project/${projectId}/retrain`, {
        method: "POST",
        headers: getBackendAuthHeaders(),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Retrain failed");
      }
      setSelectedProjectId(projectId);
      setCurrentStatus("processing");
      fetchProjects();
    } catch (error) {
      setErrorMessage(error.message || "Failed to start retrain");
    }
  };

  const handleDeleteProject = async (e, projectId) => {
    e.stopPropagation();
    if (!window.confirm("Delete this project? This cannot be undone.")) return;
    try {
      const response = await fetch(`${API_BACKEND}/project/${projectId}`, {
        method: "DELETE",
        headers: getBackendAuthHeaders(),
      });
      if (!response.ok) throw new Error("Failed to delete");
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
        setCurrentStatus(null);
        setRecommendations(null);
        setItemsList([]);
        setUsersList([]);
        setTargetValuesData(null);
      }
      fetchProjects();
    } catch (err) {
      setErrorMessage(err.message || "Failed to delete project");
    }
  };

  const handleSelectProject = async (projectId) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    setSelectedProjectId(projectId);
    setCurrentStatus(project.status);
    setRecommendations(null);
    setErrorMessage("");
    setItemsList([]);
    setUsersList([]);
    setSelectedItemTitle("");
    setSelectedUserId("");
    setSelectedItemForSimilar("");
    setTargetValuesData(null);

    if (project.status !== "ready" || !project.model_type) return;

    const needsItems = project.model_type === "content";
    const needsUsers = project.model_type === "collaborative";
    const needsContextOptions = project.model_type === "parameter_driven" || project.model_type === "hybrid";
    const needsTargetValues = project.model_type === "content" || project.model_type === "parameter_driven" || project.model_type === "hybrid";
    if (needsItems) setLoadingItems(true);
    if (needsUsers) setLoadingUsers(true);
    if (needsTargetValues) setLoadingTargetValues(true);
    if (needsContextOptions) {
      setContextOptions(null);
      setContextSelections({});
      setLoadingContextOptions(true);
    }

    const headers = getBackendAuthHeaders();
    const stillForThisProject = () => selectedProjectIdRef.current === projectId;

    const fetchTargetValues = needsTargetValues
      ? fetch(`${API_BACKEND}/project/${projectId}/target-values`, { headers })
          .then(async (res) => {
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              if (res.status === 401) {
                setErrorMessage("Session expired. Please log in again.");
                logout();
              }
              throw new Error(err.detail || "Failed to load target values");
            }
            return res.json();
          })
          .then((data) => {
            if (!stillForThisProject()) return;
            setTargetValuesData(data && typeof data.target_values !== "undefined" ? { target_column: data.target_column || "item", target_values: Array.isArray(data.target_values) ? data.target_values : [] } : null);
            if (data?.target_values?.length && selectedProjectIdRef.current === projectId) {
              setSelectedItemTitle(data.target_values[0] || "");
              setSelectedItemForSimilar(data.target_values[0] || "");
            }
          })
          .catch((e) => {
            if (stillForThisProject()) setTargetValuesData(null);
            if (e.message && !e.message.includes("Session expired")) console.error("Failed to fetch target values", e);
          })
          .finally(() => {
            if (stillForThisProject()) setLoadingTargetValues(false);
          })
      : Promise.resolve();

    const fetchItems = needsItems
      ? fetch(`${API_BACKEND}/project/${projectId}/items`, { headers })
          .then(async (res) => {
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              const msg =
                err.detail ||
                err.message ||
                `Failed to load items (${res.status})`;
              if (res.status === 401) {
                setErrorMessage("Session expired. Please log in again.");
                logout();
              } else {
                setErrorMessage(msg);
              }
              throw new Error(msg);
            }
            return res.json();
          })
          .then((data) => {
            if (!stillForThisProject()) return;
            setErrorMessage("");
            const list = Array.isArray(data) ? data : [];
            setItemsList(list);
            setSelectedItemTitle(list[0]?.title || "");
          })
          .catch((e) => {
            if (stillForThisProject()) setItemsList([]);
            if (
              e.message &&
              !e.message.includes("Session expired")
            )
              console.error("Failed to fetch items", e);
          })
          .finally(() => {
            if (stillForThisProject()) setLoadingItems(false);
          })
      : Promise.resolve();

    const fetchUsers = needsUsers
      ? fetch(`${API_BACKEND}/project/${projectId}/users`, { headers })
          .then(async (res) => {
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              const msg =
                err.detail ||
                err.message ||
                `Failed to load users (${res.status})`;
              if (res.status === 401) {
                setErrorMessage("Session expired. Please log in again.");
                logout();
              } else {
                setErrorMessage(msg);
              }
              throw new Error(msg);
            }
            return res.json();
          })
          .then((data) => {
            if (!stillForThisProject()) return;
            setErrorMessage("");
            const list = Array.isArray(data) ? data : [];
            setUsersList(list);
            setSelectedUserId(list[0]?.id || "");
          })
          .catch((e) => {
            if (stillForThisProject()) setUsersList([]);
            if (
              e.message &&
              !e.message.includes("Session expired")
            )
              console.error("Failed to fetch users", e);
          })
          .finally(() => {
            if (stillForThisProject()) setLoadingUsers(false);
          })
      : Promise.resolve();

    const fetchContextOptions = needsContextOptions
      ? fetch(`${API_BACKEND}/project/${projectId}/context-options`, { headers })
          .then(async (res) => {
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              if (res.status === 401) {
                setErrorMessage("Session expired. Please log in again.");
                logout();
              } else setErrorMessage(err.detail || "Failed to load context options.");
              throw new Error(err.detail || "Failed to load context options");
            }
            return res.json();
          })
          .then((data) => {
            if (!stillForThisProject()) return;
            setErrorMessage("");
            setContextOptions(data);
            setContextSelections({});
            setSelectedCriteria([]);
          })
          .catch((e) => {
            if (stillForThisProject()) setContextOptions(null);
            if (e.message && !e.message.includes("Session expired")) console.error("Failed to fetch context options", e);
          })
          .finally(() => {
            if (stillForThisProject()) setLoadingContextOptions(false);
          })
      : Promise.resolve();

    await Promise.all([fetchItems, fetchUsers, fetchContextOptions, fetchTargetValues]);
  };

  const handleGetRecommendations = async (e) => {
    e.preventDefault();
    if (!selectedProject) return;

    setIsLoadingRecs(true);
    setRecommendations(null);
    setErrorMessage("");

    const params = new URLSearchParams();
    params.append("n", "10");
    if (selectedProject.model_type === "parameter_driven" || selectedProject.model_type === "hybrid") {
      if (selectedItemForSimilar && String(selectedItemForSimilar).trim()) {
        params.append("item_title", String(selectedItemForSimilar).trim());
      } else {
        (selectedCriteria || []).forEach((key) => {
          const val = contextSelections?.[key];
          if (val != null && String(val).trim() !== "") params.append(key, String(val).trim());
        });
      }
    }
    if (selectedProject.model_type === "collaborative") params.append("user_id", selectedUserId);
    if (selectedProject.model_type === "content") params.append("item_title", selectedItemTitle);

    try {
      const url = `${API_BACKEND}/project/${selectedProjectId}/recommendations?${params.toString()}`;
      const response = await fetch(url, { headers: getBackendAuthHeaders() });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to get recommendations");
      }

      const data = await response.json();
      const recs = Array.isArray(data.recommendations) ? data.recommendations : [];
      setRecommendations(recs);
    } catch (error) {
      console.error("Recommendation error:", error);
      setErrorMessage(error.message);
    } finally {
      setIsLoadingRecs(false);
    }
  };

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10 min-h-full bg-gradient-to-br from-neutral-50 via-white to-slate-50">
      <div className="max-w-6xl xl:max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-3"
        >
          <p className="text-xs font-semibold tracking-[0.3em] uppercase text-slate-400 font-third flex items-center gap-2">
            <span className="w-8 h-[2px] bg-gradient-to-r from-rose-400 to-transparent"></span>
            Recommender Studio
          </p>
          <h1 className="text-3xl lg:text-6xl font-bold text-neutral-900 font-main tracking-tight">
            AI-Powered Recommendations
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl font-third leading-relaxed">
            Upload your data, choose what to recommend and what to base it on, then get smart suggestions. Works with any CSV.
          </p>
        </motion.div>

        {/* Metrics */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          <motion.div
            whileHover={{ scale: 1.0, y: 0 }}
            className="group relative bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-sm transition-all duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-rose-50/0 to-cyan-50/50 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-rose-100/20 to-cyan-100/20 rounded-full blur-2xl"></div>
            
            <div className="relative p-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-slate-600 font-third">Total Projects</p>
                <Target className="w-4 h-4 text-rose-400" />
              </div>
              <p className="text-3xl font-bold text-slate-900 font-main">{projectStats.total}</p>
              <p className="text-sm text-slate-500 mt-2 font-third flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-rose-800"></span>
                All time
              </p>
            </div>
            
            <div className="absolute bottom-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-rose-400 via-cyan-100 to-rose-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"></div>
    <div className="absolute top-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-cyan-400 via-cyan-100 to-cyan-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-right"></div>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.0, y: 0 }}
            className="group relative bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-sm transition-all duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/0 to-emerald-50/50 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-emerald-100/20 to-teal-100/20 rounded-full blur-2xl"></div>
            
            <div className="relative p-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-slate-600 font-third">Ready to Recommend</p>
                <CheckCircle className="w-4 h-4 text-rose-500" />
              </div>
              <p className="text-3xl font-bold text-slate-900 font-main">{projectStats.ready}</p>
              <p className="text-xs text-slate-500 mt-2 font-third flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-rose-800"></span>
                Active models
              </p>
            </div>
            
            <div className="absolute bottom-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-rose-400 via-cyan-100 to-rose-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"></div>
    <div className="absolute top-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-cyan-400 via-cyan-100 to-cyan-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-right"></div>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.0, y: 0 }}
            className="group relative bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-sm transition-all duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-amber-50/0 to-amber-50/50 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-amber-100/20 to-orange-100/20 rounded-full blur-2xl"></div>
            
            <div className="relative p-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-slate-600 font-third">Training in Progress</p>
                <Clock className="w-4 h-4 text-rose-600" />
              </div>
              <p className="text-3xl font-bold text-neutral-900 font-main">{projectStats.processing}</p>
              <p className="text-xs text-slate-500 mt-2 font-third flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-amber-800"></span>
                Processing
              </p>
            </div>
            
            <div className="absolute bottom-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-rose-400 via-cyan-100 to-rose-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"></div>
    <div className="absolute top-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-cyan-400 via-cyan-100 to-cyan-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-right"></div>
          </motion.div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left side: create + recommend */}
          <div className="lg:col-span-2 space-y-8">
            <Card gradient>
              <div className="relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-rose-100/30 to-cyan-100/30 rounded-full blur-3xl"></div>
                
                <div className="relative p-8">
                  <div className="flex items-center space-x-4 mb-8">
                    <motion.div
                      whileHover={{ rotate: 360 }}
                      transition={{ duration: 0.6 }}
                      className="w-14 h-14 bg-gradient-to-br from-rose-700  to-cyan-600 rounded-full flex items-center justify-center "
                    >
                      <Sparkles className="w-7 h-7 text-white" />
                    </motion.div>
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 font-main">
                        Create New Project
                      </h2>
                      <p className="text-sm text-gray-600 font-third">
                        Build your AI-powered recommendation engine
                      </p>
                    </div>
                  </div>

                    <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-2 font-third">
                        Project Name
                      </label>
                      <Input
                        type="text"
                        placeholder="e.g., My Recommender"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2 font-third">
                        How do you want to build recommendations?
                      </label>
                      <Select
                        value={projectMode}
                        onChange={(e) => {
                          setProjectMode(e.target.value);
                          setContentFile(null);
                          setInteractionFile(null);
                          setContentHeaders([]);
                          setInteractionHeaders([]);
                        }}
                      >
                        <option value="parameter_driven">One file: recommend one column based on others (easiest)</option>
                        <option value="content_interaction">Two files: items + user ratings (advanced)</option>
                      </Select>
                      <p className="text-xs text-slate-500 mt-1.5 font-third">
                        {projectMode === "parameter_driven"
                          ? "Upload a single CSV and pick what to recommend and what to match on."
                          : "Upload a catalog of items and a file of user ratings."}
                      </p>
                    </div>

                    {projectMode === "parameter_driven" ? (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="relative p-6 border-2 border-dashed border-slate-300 rounded-2xl bg-gradient-to-br from-cyan-50/50 via-white to-blue-50/30 hover:border-cyan-400 transition-all duration-300 overflow-hidden"
                      >
                        <div className="relative">
                          <div className="flex items-center space-x-3 mb-2">
                            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-cyan-500 text-white text-sm font-bold">1</span>
                            <h3 className="font-bold text-base text-gray-900 font-third">
                              Upload your data
                            </h3>
                          </div>
                          <p className="text-sm text-gray-600 mb-4 ml-9 font-third">
                            Any CSV file (products, listings, etc.). The first row should be column headers.
                          </p>
                          <div className="ml-9 mb-6">
                            <Input
                              type="file"
                              accept=".csv"
                              onChange={(e) =>
                                setContentFile(e.target.files?.[0] ?? null)
                              }
                            />
                          </div>
                          <AnimatePresence>
                            {contentFile && (
                              <>
                                <div className="flex items-center space-x-3 mb-2">
                                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-cyan-500 text-white text-sm font-bold">2</span>
                                  <h3 className="font-bold text-base text-gray-900 font-third">
                                    What do you want to recommend?
                                  </h3>
                                </div>
                                <p className="text-sm text-gray-600 mb-4 ml-9 font-third">
                                  Choose the column whose values will appear as recommendations. We&apos;ll use all other columns to find similar rows—no extra setup needed.
                                </p>
                                <div className="ml-9">
                                  <SchemaMapper
                                    title=""
                                    headers={contentHeaders}
                                    schema={parameterDrivenSchema}
                                    onChange={setParameterDrivenSchema}
                                    schemaKeys={[
                                      { key: "target_column", label: "Recommend values from this column" },
                                    ]}
                                  />
                                </div>
                              </>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <motion.div
                        whileHover={{ scale: 1.0 }}
                        className="relative p-6 border-2 border-dashed border-slate-300 rounded-2xl bg-gradient-to-br from-blue-50/50 via-white to-cyan-50/30 hover:border-cyan-400 transition-all duration-300 overflow-hidden"
                      >
                        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-cyan-200/20 to-blue-200/20 rounded-full blur-2xl"></div>
                        
                        <div className="relative">
                          <div className="flex items-center space-x-3 mb-4">
                            <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center shadow-md ">
                              <FileText className="w-5 h-5 text-white" />
                            </div>
                            <h3 className="font-bold text-base text-gray-900 font-third">
                              Content Data
                            </h3>
                          </div>
                          <p className="text-sm text-gray-600 mb-4 font-third">
                            Item/catalog CSV. Must include a column that links to the ratings file (e.g. item ID).
                          </p>
                          <Input
                            type="file"
                            accept=".csv"
                            onChange={(e) =>
                              setContentFile(
                                e.target.files ? e.target.files[0] : null
                              )
                            }
                          />
                          <AnimatePresence>
                            {contentFile && (
                              <SchemaMapper
                                title="Map Content Schema"
                                headers={contentHeaders}
                                schema={contentSchema}
                                onChange={setContentSchema}
                                schemaKeys={[
                                  { key: "item_id", label: "Item ID (same column name as in ratings file)" },
                                  { key: "item_title", label: "Item Title / Name (for display)" },
                                  { key: "target_column", label: "What to recommend (e.g. item name or ID)" },
                                  {
                                    key: "feature_cols",
                                    label: "Feature Columns (filters)",
                                    multi: true,
                                  },
                                ]}
                              />
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>

                      <motion.div
                        whileHover={{ scale: 1.0 }}
                        className="relative p-6 border-2 border-dashed border-slate-300 rounded-2xl bg-gradient-to-br from-rose-50/50 via-white to-pink-50/30 hover:border-rose-400 transition-all duration-300 overflow-hidden"
                      >
                        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-rose-200/20 to-pink-200/20 rounded-full blur-2xl"></div>
                        
                        <div className="relative">
                          <div className="flex items-center space-x-3 mb-4">
                            <div className="w-10 h-10 bg-gradient-to-br from-rose-500 to-pink-500 rounded-xl flex items-center justify-center shadow-md">
                              <Users className="w-5 h-5 text-white" />
                            </div>
                            <h3 className="font-bold text-base text-gray-900 font-third">
                              Interaction Data
                            </h3>
                          </div>
                          <p className="text-sm text-gray-600 mb-4 font-third">
                            Ratings CSV: must have item ID (same as content) and rating. User ID only needed for collaborative.
                          </p>
                          <Input
                            type="file"
                            accept=".csv"
                            onChange={(e) =>
                              setInteractionFile(
                                e.target.files ? e.target.files[0] : null
                              )
                            }
                          />
                          <AnimatePresence>
                            {interactionFile && (
                              <SchemaMapper
                                title="Map Ratings Schema"
                                headers={interactionHeaders}
                                schema={interactionSchema}
                                onChange={setInteractionSchema}
                                schemaKeys={[
                                  { key: "item_id", label: "Item ID (must match content file)" },
                                  { key: "rating", label: "Rating Column" },
                                  { key: "user_id", label: "User ID (optional, for collaborative only)" },
                                ]}
                              />
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    </div>
                    )}

                    <Button
                      onClick={handleCreateProject}
                      disabled={
                        currentStatus === "uploading" ||
                        currentStatus === "processing"
                      }
                      icon={
                        currentStatus === "uploading" ||
                        currentStatus === "processing"
                          ? Loader2
                          : Zap
                      }
                    >
                      {currentStatus === "uploading" && "Uploading Files..."}
                      {currentStatus === "processing" && "Training Model..."}
                      {currentStatus !== "uploading" &&
                        currentStatus !== "processing" &&
                        "Create Project & Train Model"}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-emerald-100/30 to-teal-100/30 rounded-full blur-3xl"></div>
                
                <div className="relative p-8">
                  <div className="flex items-center space-x-4 mb-8">
                    
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 font-main">
                        Test Your Model...
                      </h2>
                      <p className="text-sm text-gray-600 font-third">
                        Generate personalized suggestions
                      </p>
                    </div>
                  </div>

                  {!selectedProjectId ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-center p-16 bg-gradient-to-br from-gray-50 via-slate-50 to-gray-50 rounded-2xl border-2 border-dashed border-gray-300"
                    >
                      <motion.div
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                      </motion.div>
                      <p className="text-gray-600 font-semibold font-third text-lg">
                        Please select a "Ready" project to begin
                      </p>
                      <p className="text-gray-500 font-third text-sm mt-2">
                        Choose from the projects list on the right
                      </p>
                    </motion.div>
                  ) : currentStatus === "processing" ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-center p-16 bg-gradient-to-br from-blue-50 via-cyan-50 to-blue-50 rounded-2xl border-2 border-blue-200"
                    >
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      >
                        <Loader2 className="w-16 h-16 text-cyan-600 mx-auto mb-5" />
                      </motion.div>
                      <p className="font-bold text-cyan-700 text-xl font-main">
                        Processing your project...
                      </p>
                      <p className="text-sm text-gray-600 mt-2 font-third">
                        This may take a few moments
                      </p>
                    </motion.div>
                  ) : errorMessage ? (
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-6 bg-gradient-to-r from-red-50 to-rose-50 border-2 border-red-200 text-red-700 rounded-2xl flex items-start space-x-4"
                    >
                      <AlertCircle className="w-6 h-6 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold font-third">Error</p>
                        <p className="text-sm mt-1 font-third">{errorMessage}</p>
                      </div>
                    </motion.div>
                  ) : currentStatus === "ready" && selectedProject ? (
                    <div className="space-y-6">
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-6 bg-gradient-to-br from-blue-50 via-cyan-50 to-blue-50 rounded-2xl border-2 border-cyan-200 shadow-sm"
                      >
                        <h3 className="text-xl font-bold text-gray-900 mb-3 font-main">
                          {selectedProject.project_name}
                        </h3>
                        <div className="flex items-center space-x-3">
                          <span className="text-sm text-gray-600 font-third font-semibold">
                            Model Type:
                          </span>
                          <motion.span
                            whileHover={{ scale: 1.05 }}
                            className={`text-xs font-bold px-4 py-2 rounded-full shadow-sm ${
                              selectedProject.model_type === "parameter_driven"
                                ? "bg-gradient-to-r from-cyan-100 to-blue-100 text-cyan-800 border-2 border-cyan-200"
                                : selectedProject.model_type === "content"
                                ? "bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-800 border-2 border-emerald-200"
                                : selectedProject.model_type === "collaborative"
                                ? "bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-800 border-2 border-amber-200"
                                : "bg-gradient-to-r from-purple-100 to-pink-100 text-purple-800 border-2 border-purple-200"
                            }`}
                          >
                            {selectedProject.model_type === "parameter_driven" ? "PARAMETER-DRIVEN" : selectedProject.model_type?.toUpperCase()}
                          </motion.span>
                        </div>
                      </motion.div>

                      {/* Use the same attribute the model recommends as the input: select a value → get similar values (works for any dataset: car brand, movie title, product name, etc.) */}
                      {showSimilarToInput && (
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.05 }}
                          className="p-4 rounded-2xl bg-gradient-to-br from-cyan-50 to-blue-50 border-2 border-cyan-200"
                        >
                          <h4 className="text-sm font-bold text-gray-800 font-third mb-1">
                            Use {targetColumnLabel} to get similar recommendations
                          </h4>
                          <p className="text-xs text-gray-600 font-third mb-3">
                            Select a {targetColumnLabel} from your dataset. You’ll get back other {targetColumnLabel}s that are similar (same type your model was trained to recommend).
                          </p>
                          {loadingTargetValues ? (
                            <p className="text-sm text-slate-500 font-third">Loading...</p>
                          ) : similarToOptions.length > 0 ? (
                            <SearchableSelect
                              id="similar-to-item"
                              value={similarToValue}
                              onChange={setSimilarToValue}
                              options={similarToOptions}
                              placeholder={`Select ${targetColumnLabel === "item" ? "an" : "a"} ${targetColumnLabel}...`}
                            />
                          ) : (
                            <p className="text-xs text-amber-700 font-third">
                              No {targetColumnLabel}s to show. {selectedProject.model_type === "parameter_driven" || selectedProject.model_type === "hybrid" ? "Use filters below instead." : "Check that the project has content data."}
                            </p>
                          )}
                        </motion.div>
                      )}

                      {(selectedProject.model_type === "parameter_driven" || selectedProject.model_type === "hybrid") && (
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.08 }}
                          className="space-y-4"
                        >
                          <h4 className="text-sm font-bold text-gray-700 font-third">
                            Or use filters instead
                          </h4>
                          <p className="text-xs text-gray-600 font-third">
                            {selectedProject.model_type === "hybrid"
                              ? "Pick features and a rating to get recommendations matching your criteria."
                              : "Leave “similar to” empty and set filter values below to get recommendations by criteria."}
                          </p>
                          {loadingContextOptions ? (
                            <p className="text-sm text-gray-500 font-third">Loading options...</p>
                          ) : contextOptions?.feature_columns?.length ? (
                            <>
                              <div>
                                <label className="block text-xs font-bold text-gray-600 mb-2 font-third">
                                  Filter by (select which to use)
                                </label>
                                <div className="flex flex-wrap gap-3">
                                  {contextOptions.feature_columns.map((fc) => {
                                    const isSelected = (selectedCriteria || []).includes(fc.name);
                                    return (
                                      <label
                                        key={fc.name}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 cursor-pointer transition-all font-third text-sm ${
                                          isSelected
                                            ? "bg-cyan-50 border-cyan-400 text-cyan-800"
                                            : "bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300"
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setSelectedCriteria((prev) => [...(prev || []), fc.name]);
                                              if (contextSelections[fc.name] != null) return;
                                              if (fc.column_type === "numeric" && fc.numeric_range) {
                                                const { min, max } = fc.numeric_range;
                                                const mid = min + (max - min) / 2;
                                                setContextSelections((s) => ({ ...s, [fc.name]: String(Number(mid.toFixed(6))) }));
                                              } else if (fc.values?.length) {
                                                setContextSelections((s) => ({ ...s, [fc.name]: fc.values[0] }));
                                              }
                                            } else {
                                              setSelectedCriteria((prev) => (prev || []).filter((c) => c !== fc.name));
                                            }
                                          }}
                                          className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-400"
                                        />
                                        <span>{fc.name}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                              {selectedCriteria?.length > 0 && (
                                <div className="space-y-3 pt-2 border-t border-slate-200">
                                  <p className="text-xs font-bold text-gray-600 font-third">Set values (optional)</p>
                                  {contextOptions.feature_columns
                                    .filter((fc) => selectedCriteria.includes(fc.name))
                                    .map((fc) => {
                                      const isNumeric = fc.column_type === "numeric" && fc.numeric_range;
                                      const range = fc.numeric_range || {};
                                      const numVal = contextSelections[fc.name];
                                      const catOptions = (fc.values || []).filter((v) => v != null && String(v).trim() && String(v).toLowerCase() !== "nan");
                                      return (
                                        <div key={fc.name}>
                                          <label className="block text-xs font-bold text-gray-600 mb-1 font-third">
                                            {fc.name}
                                            {isNumeric && range.min != null && range.max != null && (
                                              <span className="text-slate-400 font-normal ml-1">({range.min} – {range.max})</span>
                                            )}
                                          </label>
                                          {isNumeric ? (
                                            <input
                                              type="number"
                                              min={range.min}
                                              max={range.max}
                                              step="any"
                                              value={numVal ?? ""}
                                              onChange={(e) =>
                                                setContextSelections((prev) => ({ ...prev, [fc.name]: e.target.value }))
                                              }
                                              placeholder="Any"
                                              className="w-full px-4 py-3 border-2 border-slate-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 bg-white text-sm font-third"
                                            />
                                          ) : (
                                            <SearchableSelect
                                              id={`context-${fc.name}`}
                                              value={contextSelections[fc.name] ?? ""}
                                              onChange={(v) => setContextSelections((prev) => ({ ...prev, [fc.name]: v }))}
                                              options={catOptions}
                                              placeholder="Any"
                                            />
                                          )}
                                        </div>
                                      );
                                    })}
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-gray-500 font-third">No options available.</p>
                          )}
                        </motion.div>
                      )}

                      {selectedProject.model_type === "collaborative" && (
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.2 }}
                        >
                          <label className="block text-sm font-bold text-gray-700 mb-2 font-third">
                            Select User
                          </label>
                          <Select
                            value={selectedUserId}
                            onChange={(e) =>
                              setSelectedUserId(e.target.value)
                            }
                            disabled={loadingUsers}
                          >
                            <option value="">
                              {loadingUsers
                                ? "Loading users..."
                                : usersList.length === 0
                                ? "No users"
                                : "Select a user..."}
                            </option>
                            {usersList.map((user) => (
                              <option key={user.id} value={user.id}>
                                User {user.id}
                              </option>
                            ))}
                          </Select>
                        </motion.div>
                      )}

                      <Button
                        onClick={handleGetRecommendations}
                        disabled={isLoadingRecs}
                        icon={isLoadingRecs ? Loader2 : Play}
                      >
                        {isLoadingRecs ? "Generating..." : "Get Recommendations"}
                      </Button>

                      <AnimatePresence>
                        {recommendations && (
                          <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="pt-4"
                          >
                            <div className="flex items-center space-x-3 mb-6">
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: "spring", duration: 0.6 }}
                              >
                                
                              </motion.div>
                              <h3 className="text-2xl font-bold text-gray-900 font-main">
                                Top Recommendations  <h2 className="text-sm  text-gray-400 font-third"> Based on your input</h2>
                              </h3>
                            </div>
                            <div className="space-y-3">
                              {(() => {
                                const list = Array.isArray(recommendations)
                                  ? recommendations
                                  : [];
                                const valid = list.filter((rec) => {
                                  if (!rec || typeof rec !== "object") return false;
                                  const isParamDriven = "value" in rec;
                                  const v = isParamDriven
                                    ? rec.value
                                    : rec.title ??
                                      rec.item_title ??
                                      rec.id ??
                                      rec.item_id ??
                                      "";
                                  const s = String(v ?? "")
                                    .trim()
                                    .toLowerCase();
                                  return (
                                    s.length > 0 &&
                                    s !== "nan" &&
                                    s !== "none" &&
                                    s !== "null"
                                  );
                                });
                                if (valid.length === 0) {
                                  return (
                                    <p className="text-slate-600 font-third py-6 text-center">
                                      {list.length === 0
                                        ? "No recommendations to show. Try different criteria or leave some filters as &quot;Any&quot;."
                                        : "No valid recommendations in the response. Try different criteria."}
                                    </p>
                                  );
                                }
                                return (
                                  <>
                                    <p className="text-xs text-slate-500 font-third mb-2">
                                      Showing {valid.length} recommendation
                                      {valid.length !== 1 ? "s" : ""}
                                    </p>
                                    {valid.map((rec, index) => {
                                      const isParamDriven =
                                        "value" in rec && "score" in rec;
                                      const displayText = isParamDriven
                                        ? rec.value
                                        : rec.title ??
                                          rec.item_title ??
                                          (rec.id != null
                                            ? `ID: ${rec.id}`
                                            : rec.item_id != null
                                            ? `ID: ${rec.item_id}`
                                            : JSON.stringify(rec));
                                      const scoreNum =
                                        isParamDriven && rec.score != null
                                          ? Number(rec.score)
                                          : null;
                                      return (
                                        <motion.div
                                          key={index}
                                          initial={{ opacity: 0, x: -20 }}
                                          animate={{ opacity: 1, x: 0 }}
                                          transition={{
                                            delay: index * 0.05,
                                            duration: 0.3,
                                          }}
                                          whileHover={{ scale: 1.0, x: 0 }}
                                          className="p-5 bg-gradient-to-r from-white via-emerald-50/30 to-teal-50/30 rounded-2xl border-2 border-slate-200 hover:border-cyan-300 transition-all duration-300 shadow-sm hover:shadow-md"
                                        >
                                          <div className="flex items-center justify-between gap-4">
                                            <div className="flex items-center space-x-4 min-w-0">
                                              <span className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-teal-600 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg flex-shrink-0">
                                                {index + 1}
                                              </span>
                                              <p className="text-gray-900 font-semibold font-third truncate">
                                                {displayText}
                                              </p>
                                            </div>
                                            {scoreNum != null &&
                                              !Number.isNaN(scoreNum) && (
                                                <span className="text-xs text-slate-400 font-third flex-shrink-0">
                                                  match{" "}
                                                  {Math.round(scoreNum * 100)}%
                                                </span>
                                              )}
                                          </div>
                                        </motion.div>
                                      );
                                    })}
                                  </>
                                );
                              })()}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          </div>

          {/* Right side: projects */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <Card className="lg:col-span-1 h-fit sticky top-24">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900 font-main">
                    My Projects
                  </h2>
                  <motion.div
                    animate={{ scale: [1, 2.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-gradient-to-r from-rose-500 to-cyan-500"
                  ></motion.div>
                </div>
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 scrollbar-hide">
                  <style jsx>{`
                    .scrollbar-hide::-webkit-scrollbar {
                      display: none;
                    }
                    .scrollbar-hide {
                      -ms-overflow-style: none;
                      scrollbar-width: none;
                    }
                  `}</style>
                  
                  {projects.length === 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-center p-12 bg-gradient-to-br from-gray-50 to-slate-50 rounded-2xl border-2 border-dashed border-gray-300"
                    >
                      <Sparkles className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                      <p className="text-gray-500 font-semibold font-third">No projects yet</p>
                      <p className="text-xs text-gray-400 mt-2 font-third">
                        Create one to get started
                      </p>
                    </motion.div>
                  )}
                  
                  <AnimatePresence>
                    {projects.map((p, index) => (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ delay: index * 0.05, duration: 0.3 }}
                        whileHover={{ scale: 1.0, x: 0 }}
                        onClick={() => handleSelectProject(p.id)}
                        className={`group relative p-5 border-2 rounded-2xl cursor-pointer transition-all duration-300 overflow-hidden ${
                          selectedProjectId === p.id
                            ? "bg-gradient-to-br from-cyan-50 via-blue-50 to-cyan-50 border-cyan-400 shadow-lg shadow-cyan-100"
                            : "hover:bg-gradient-to-br hover:from-slate-50 hover:to-gray-50 border-slate-200 hover:border-slate-300 shadow-sm "
                        }`}
                      >
                        <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/60 to-transparent"></div>
                        
                        <div className="relative">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-sec bg-gradient-to-r from-slate-100 to-gray-100 text-gray-700 px-3 py-1.5 rounded-lg font-bold border border-slate-200">
                              #{p.id}
                            </span>
                            <div className="flex items-center gap-2">
                              {(p.status === "ready" || p.status === "error") && (
                                <motion.button
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                  type="button"
                                  onClick={(e) => handleRetrainProject(e, p.id)}
                                  className="p-2 rounded-xl text-gray-400 hover:text-cyan-600 transition-colors"
                                  title="Retrain model (same data)"
                                  aria-label="Retrain"
                                >
                                  <RotateCw className="w-4 h-4" />
                                </motion.button>
                              )}
                              <motion.button
                                whileHover={{ scale: 1.1, rotate: 0 }}
                                whileTap={{ scale: 0.9 }}
                                type="button"
                                onClick={(e) => handleDeleteProject(e, p.id)}
                                className="p-2 rounded-xl text-gray-400 hover:text-red-600 transition-colors "
                                title="Delete project"
                                aria-label="Delete project"
                              >
                                <Trash2 className="w-4 h-4" />
                              </motion.button>
                              <span
                                className={`flex items-center space-x-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${
                                  p.status === "ready"
                                    ? "text-emerald-700 bg-emerald-100 border-2 border-emerald-200"
                                    : p.status === "error"
                                    ? "text-red-700 bg-red-100 border-2 border-red-200"
                                    : "text-amber-700 bg-amber-100 border-2 border-amber-200"
                                }`}
                              >
                                {p.status === "ready" && (
                                  <CheckCircle className="w-3.5 h-3.5" />
                                )}
                                {p.status === "processing" && (
                                  <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                  >
                                    <Loader2 className="w-3.5 h-3.5" />
                                  </motion.div>
                                )}
                                {p.status === "error" && (
                                  <AlertCircle className="w-3.5 h-3.5" />
                                )}
                                <span className="uppercase font-third">{p.status}</span>
                              </span>
                            </div>
                          </div>
                          <div className="font-bold text-gray-900 mb-3 text-lg font-third">
                            {p.project_name}
                          </div>
                          <motion.span
                            whileHover={{ scale: 1.0 }}
                            className={`inline-block text-xs font-bold uppercase px-4 py-2 rounded-full  ${
                              p.model_type === "parameter_driven"
                                ? "bg-gradient-to-r from-cyan-300 to-blue-100 text-cyan-800 border-2 border-cyan-200"
                                : p.model_type === "content"
                                ? "bg-gradient-to-r from-emerald-300 to-teal-100 text-emerald-800 border-2 border-emerald-200"
                                : p.model_type === "collaborative"
                                ? "bg-gradient-to-r from-pink-300 to-yellow-100 text-amber-800 border-2 border-amber-200"
                                : p.model_type === "hybrid"
                                ? "bg-gradient-to-r from-blue-300 to-pink-100 text-purple-800 border-2 border-purple-200"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {p.model_type === "parameter_driven" ? "parameter-driven" : p.model_type || "N/A"}
                          </motion.span>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default RecommenderPanel;