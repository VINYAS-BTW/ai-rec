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
    <h3 className="font-bold text-slate-900 mb-5 flex items-center font-third text-sm">
      <Sparkles className="w-4 h-4 mr-2 text-cyan-600" />
      {title}
    </h3>
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
  const [contentFile, setContentFile] = useState(null);
  const [interactionFile, setInteractionFile] = useState(null);

  const [contentHeaders, setContentHeaders] = useState([]);
  const [interactionHeaders, setInteractionHeaders] = useState([]);

  const [contentSchema, setContentSchema] = useState({
    item_id: "",
    item_title: "",
    feature_cols: [],
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
  const [selectedItemTitle, setSelectedItemTitle] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [recommendations, setRecommendations] = useState(null);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const selectedProjectIdRef = useRef(selectedProjectId);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

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
      } else if (data.status === "error") {
        setErrorMessage("Project processing failed.");
      }
    } catch (error) {
      console.error("Status check failed:", error);
      setCurrentStatus("error");
    }
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!projectName || (!contentFile && !interactionFile)) {
      setErrorMessage("Project name and at least one file are required.");
      return;
    }

    setErrorMessage("");
    setCurrentStatus("uploading");
    setRecommendations(null);

    const formData = new FormData();
    formData.append("project_name", projectName);

    if (contentFile) {
      formData.append("content_file", contentFile);
      formData.append("content_schema_json", JSON.stringify(contentSchema));
    }
    if (interactionFile) {
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

    if (project.status !== "ready" || !project.model_type) return;

    const needsItems = ["content", "hybrid"].includes(project.model_type);
    const needsUsers = ["collaborative", "hybrid"].includes(project.model_type);
    if (needsItems) setLoadingItems(true);
    if (needsUsers) setLoadingUsers(true);

    const headers = getBackendAuthHeaders();
    const stillForThisProject = () => selectedProjectIdRef.current === projectId;

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

    await Promise.all([fetchItems, fetchUsers]);
  };

  const handleGetRecommendations = async (e) => {
    e.preventDefault();
    if (!selectedProject) return;

    setIsLoadingRecs(true);
    setRecommendations(null);
    setErrorMessage("");

    const params = new URLSearchParams();
    if (["content", "hybrid"].includes(selectedProject.model_type)) {
      params.append("item_title", selectedItemTitle);
    }
    if (["collaborative", "hybrid"].includes(selectedProject.model_type)) {
      params.append("user_id", selectedUserId);
    }

    try {
      params.append("n", "10");
      const url = `${API_BACKEND}/project/${selectedProjectId}/recommendations?${params.toString()}`;

      const response = await fetch(url, {
        headers: getBackendAuthHeaders(),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to get recommendations");
      }

      const data = await response.json();
      setRecommendations(data.recommendations);
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
            Build and deploy intelligent recommendation systems with content-based, collaborative, and hybrid filtering.
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
                        placeholder="e.g., My Movie Recommender"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                      />
                    </div>

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
                            Upload item details (e.g., movies.csv)
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
                                  { key: "item_id", label: "Item ID Column" },
                                  { key: "item_title", label: "Item Title Column" },
                                  {
                                    key: "feature_cols",
                                    label: "Feature Columns",
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
                            Upload user ratings (e.g., ratings.csv)
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
                                title="Map Interaction Schema"
                                headers={interactionHeaders}
                                schema={interactionSchema}
                                onChange={setInteractionSchema}
                                schemaKeys={[
                                  { key: "user_id", label: "User ID Column" },
                                  { key: "item_id", label: "Item ID Column" },
                                  { key: "rating", label: "Rating Column" },
                                ]}
                              />
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    </div>

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
                              selectedProject.model_type === "content"
                                ? "bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-800 border-2 border-emerald-200"
                                : selectedProject.model_type === "collaborative"
                                ? "bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-800 border-2 border-amber-200"
                                : "bg-gradient-to-r from-purple-100 to-pink-100 text-purple-800 border-2 border-purple-200"
                            }`}
                          >
                            {selectedProject.model_type?.toUpperCase()}
                          </motion.span>
                        </div>
                      </motion.div>

                      {(selectedProject.model_type === "content" ||
                        selectedProject.model_type === "hybrid") && (
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 }}
                        >
                          <label className="block text-sm font-bold text-gray-700 mb-2 font-third">
                            Select Item
                          </label>
                          <Select
                            value={selectedItemTitle}
                            onChange={(e) =>
                              setSelectedItemTitle(e.target.value)
                            }
                            disabled={loadingItems}
                          >
                            <option value="">
                              {loadingItems
                                ? "Loading items..."
                                : itemsList.length === 0
                                ? "No items"
                                : "Select an item..."}
                            </option>
                            {itemsList.map((item) => (
                              <option key={item.id} value={item.title}>
                                {item.title}
                              </option>
                            ))}
                          </Select>
                        </motion.div>
                      )}

                      {(selectedProject.model_type === "collaborative" ||
                        selectedProject.model_type === "hybrid") && (
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
                              {recommendations.map((rec, index) => {
                                const titleKey = Object.keys(rec).find(
                                  (k) =>
                                    k.toLowerCase().includes("title") ||
                                    k.toLowerCase().includes("name")
                                );
                                const idKey = Object.keys(rec).find((k) =>
                                  k.toLowerCase().includes("id")
                                );
                                return (
                                  <motion.div
                                    key={index}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.05, duration: 0.3 }}
                                    whileHover={{ scale: 1.00, x: 0 }}
                                    className="p-5 bg-gradient-to-r from-white via-emerald-50/30 to-teal-50/30 rounded-2xl border-2 border-slate-200  transition-all duration-300 shadow-sm hover:shadow-md"
                                  >
                                    <div className="flex items-center space-x-4">
                                      <motion.div
                                        whileHover={{ rotate: 0 }}
                                        transition={{ duration: 0.6 }}
                                        className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-rose-600 rounded-3xl flex items-center justify-center text-white font-bold font-third text-sm shadow-lg flex-shrink-0"
                                      >
                                        {index + 1}
                                      </motion.div>
                                      <p className="text-gray-900 font-semibold font-third flex-1">
                                        {titleKey
                                          ? rec[titleKey]
                                          : `ID: ${rec[idKey]}`}
                                      </p>
                                      <div className="absolute bottom-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-rose-400 via-cyan-100 to-rose-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"></div>
    <div className="absolute top-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-cyan-400 via-cyan-100 to-cyan-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-right"></div>
                                    </div>
                                  </motion.div>
                                );
                              })}
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
                              p.model_type === "content"
                                ? "bg-gradient-to-r from-emerald-300 to-teal-100 text-emerald-800 border-2 border-emerald-200"
                                : p.model_type === "collaborative"
                                ? "bg-gradient-to-r from-pink-300 to-yellow-100 text-amber-800 border-2 border-amber-200"
                                : p.model_type === "hybrid"
                                ? "bg-gradient-to-r from-blue-300 to-pink-100 text-purple-800 border-2 border-purple-200"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {p.model_type || "N/A"}
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