import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import RecommenderPanel from "./components/RecommenderPanel";
import Dashboard from "./pages/Dashboard";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Layers,
  LogOut,
  Webhook,
  BarChart3,
  CreditCard,
  Settings,
  Home as HomeIcon,
  Zap,
  ArrowRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { useAuth } from "./context/AuthContext";
import { toast } from "react-toastify";
import { API_BACKEND, API_WEBHOOK, getBackendAuthHeaders } from "./api";
import { ChevronLeft, ChevronRight } from "lucide-react";

const NAV_ITEMS = [
  {
    id: "home",
    label: "Home",
    icon: HomeIcon,
    description: "Overview of your workspace",
  },
  {
    id: "recommender",
    label: "Recommender Studio",
    icon: Activity,
    description: "Create projects & train models",
  },
  {
    id: "dashboard",
    label: "Webhook Dashboard",
    icon: Webhook,
    description: "Apps, API keys & webhooks",
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: BarChart3,
    description: "Traffic & usage",
  },
  {
    id: "billing",
    label: "Billing",
    icon: CreditCard,
    description: "Plan & consumption",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    description: "Workspace configuration",
  },
];

const ShellSection = ({ title, eyebrow, description, children }) => (
  <motion.div
    initial={{ opacity: 0, y: -100 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
    className="px-6 py-8 lg:px-10 lg:py-10 bg-gradient-to-br from-neutral-50 via-white to-slate-50"
  >
    <div className="max-w-6xl xl:max-w-7xl mx-auto space-y-8">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="space-y-3"
      >
        {eyebrow && (
          <p className="text-xs font-semibold tracking-[0.3em] uppercase text-slate-400 font-third flex items-center gap-2">
            <span className="w-8 h-[2px] bg-gradient-to-r from-rose-400 to-transparent"></span>
            {eyebrow}
          </p>
        )}
        <h2 className="text-3xl lg:text-6xl font-bold text-neutral-900 font-main tracking-tight">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-slate-600 max-w-2xl font-third leading-relaxed">
            {description}
          </p>
        )}
      </motion.div>
      {children}
    </div>
  </motion.div>
);

const StatCard = ({ label, value, hint, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.2 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay, duration: 0.4, type: "spring" }}
    whileHover={{ scale: 1.0, y: 0 }}
    className="group relative bg-white rounded-3xl border-r-0 border-t-1 border-b-1 border-t-cyan-300 border-b-rose-200 shadow-sm overflow-hidden hover:shadow-lg transition-all duration-300"
  >
    <div className="absolute inset-0 bg-gradient-to-br from-rose-50/0 via-cyan-50/0 to-rose-50/50 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
    <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-rose-100/20 to-cyan-100/20 rounded-full blur-2xl transform translate-x-12 -translate-y-12 group-hover:scale-150 transition-transform duration-700"></div>

    <div className="relative p-6">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-semibold text-slate-600 font-third">
          {label}
        </p>
        <motion.div
          initial={{ rotate: 0 }}
          whileHover={{ rotate: 90 }}
          transition={{ duration: 0.5 }}
        >
          <TrendingUp className="w-4 h-4 text-rose-900" />
        </motion.div>
      </div>
      <p className="text-3xl font-bold text-slate-900 mb-2 font-main">
        {value}
      </p>
      {hint && (
        <p className="text-xs text-slate-500 font-third flex items-center gap-1">
          <span className="w-1 h-1 rounded-full bg-cyan-400"></span>
          {hint}
        </p>
      )}
    </div>

    <div className="absolute bottom-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-rose-400 via-cyan-100 to-rose-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"></div>
    <div className="absolute top-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-cyan-400 via-cyan-100 to-cyan-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-right"></div>
  </motion.div>
);

const StatusRow = ({ label, status = "ok" }) => (
  <div className="flex items-center justify-between text-xs">
    <div className="flex items-center gap-2">
      <motion.span
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
        className={`w-2 h-2 rounded-full ${
          status === "ok" ? "bg-emerald-500" : "bg-amber-400"
        }`}
      />
      <span className="text-slate-700">{label}</span>
    </div>
    <span className="text-slate-500">
      {status === "ok" ? "Operational" : "Degraded"}
    </span>
  </div>
);

const HomeOverview = ({ onNavigate, summary }) => {
  const {
    projects = [],
    apps = [],
    totalRequests = 0,
    readyProjects = 0,
    loading = true,
  } = summary || {};
  const { user } = useAuth();

  const userName = user?.name || user?.firstName || user?.username || "User";

  const [serviceHealth, setServiceHealth] = useState({
    mlBackend: { status: "checking", latency: null },
    webhook: { status: "checking", latency: null },
    auth: { status: "checking", latency: null },
  });

  useEffect(() => {
    const checkServiceHealth = async () => {
      const results = {
        mlBackend: { status: "degraded", latency: null },
        webhook: { status: "degraded", latency: null },
        auth: { status: "degraded", latency: null },
      };

      try {
        const startML = Date.now();
        const backendHeaders = getBackendAuthHeaders();
        const mlRes = await fetch(`${API_BACKEND}/projects/`, {
          method: "GET",
          headers: backendHeaders,
          signal: AbortSignal.timeout(5000),
        });
        const latencyML = Date.now() - startML;
        results.mlBackend = {
          status: mlRes.ok ? "ok" : "degraded",
          latency: `${latencyML}ms`,
        };
      } catch (error) {
        results.mlBackend = { status: "degraded", latency: "offline" };
      }

      try {
        const startWebhook = Date.now();
        const webhookRes = await fetch(`${API_WEBHOOK}/api/apps`, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });
        const latencyWebhook = Date.now() - startWebhook;
        results.webhook = {
          status: webhookRes.ok ? "ok" : "degraded",
          latency: `${latencyWebhook}ms`,
        };
      } catch (error) {
        results.webhook = { status: "degraded", latency: "offline" };
      }

      try {
        const startAuth = Date.now();
        const backendHeaders = getBackendAuthHeaders();
        const authRes = await fetch(`${API_BACKEND}/projects/`, {
          method: "GET",
          headers: backendHeaders,
          signal: AbortSignal.timeout(5000),
        });
        const latencyAuth = Date.now() - startAuth;
        results.auth = {
          status: authRes.ok ? "ok" : "degraded",
          latency: `${latencyAuth}ms`,
        };
      } catch (error) {
        results.auth = { status: "degraded", latency: "offline" };
      }

      setServiceHealth(results);
    };

    checkServiceHealth();
    const interval = setInterval(checkServiceHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const activeApps = apps.filter(
    (app) => app.status === "active" || !app.status,
  ).length;
  const avgRequestsPerApp =
    apps.length > 0 ? Math.floor(totalRequests / apps.length) : 0;

  const handleProjectClick = (project) => {
    sessionStorage.setItem(
      "selectedProject",
      JSON.stringify({
        id: project.id,
        name: project.name,
        status: project.status,
      }),
    );
    onNavigate("recommender");
  };

  return (
    <ShellSection
      eyebrow="Workspace"
      title="Welcome ,"
      description="Real-time operational status and performance metrics for your BaaS infrastructure."
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-third"
      >
        <StatCard
          label="Total Projects"
          value={loading ? "—" : projects.length}
          hint={`${readyProjects} ready to serve`}
          delay={0.1}
        />
        <StatCard
          label="Registered Apps"
          value={loading ? "—" : apps.length}
          hint={`${activeApps} active applications`}
          delay={0.2}
        />
        <StatCard
          label="Total Requests"
          value={loading ? "—" : totalRequests.toLocaleString()}
          hint="All-time API calls"
          delay={0.3}
        />
        <StatCard
          label="Avg per App"
          value={loading ? "—" : avgRequestsPerApp.toLocaleString()}
          hint="Request distribution"
          delay={0.4}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 font-third"
      >
        <StatusCard
          name="ML Backend"
          status={serviceHealth.mlBackend.status}
          endpoint={API_BACKEND}
          latency={serviceHealth.mlBackend.latency}
        />
        <StatusCard
          name="Webhook Service"
          status={serviceHealth.webhook.status}
          endpoint={API_WEBHOOK}
          latency={serviceHealth.webhook.latency}
        />
        <StatusCard
          name="Auth Service"
          status={serviceHealth.auth.status}
          endpoint="Auth verified"
          latency={serviceHealth.auth.latency}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.6 }}
        className="grid lg:grid-cols-[1.5fr_1fr] gap-6 mt-6"
      >
        <div className="relative bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-lg ">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-rose-100/30 to-cyan-100/30 rounded-full blur-3xl"></div>

          <div className="relative p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-third text-lg font-bold text-slate-900 tracking-tight">
                    Project Status
                  </p>
                  <p className="text-xs text-slate-500 font-third">
                    Active deployments
                  </p>
                </div>
              </div>
              <motion.div
                whileHover={{ scale: 1.0 }}
                className="px-4 py-2 bg-gradient-to-br from-rose-50 to-cyan-50 border border-rose-200/50 rounded-full shadow-sm"
              >
                <span className="text-sm font-bold text-slate-700 font-third">
                  {projects.length} total
                </span>
              </motion.div>
            </div>

            <div className="relative">
              {loading ? (
                <div className="text-center py-16">
                  <p className="text-sm text-slate-500 font-medium mt-4">
                    Loading projects...
                  </p>
                </div>
              ) : projects.length > 0 ? (
                <div className="space-y-3">
                  <AnimatePresence>
                    {projects.slice(0, 5).map((project, index) => (
                      <motion.div
                        key={project.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1, duration: 0.4 }}
                      >
                        <ProjectActivityItem
                          project={project}
                          onClick={() => handleProjectClick(project)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {projects.length > 5 && (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => onNavigate("recommender")}
                      className="group w-full mt-4 relative overflow-hidden bg-gradient-to-r from-rose-50 to-cyan-50 hover:from-rose-100 hover:to-cyan-100 border-2 border-dashed border-slate-300 rounded-2xl p-4 transition-all duration-300"
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-rose-500/0 via-cyan-500/10 to-rose-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                      <div className="relative flex items-center justify-center gap-2">
                        <span className="text-sm font-bold bg-gradient-to-br from-rose-600 to-cyan-600 bg-clip-text text-transparent font-third">
                          View all {projects.length} projects
                        </span>
                        <ArrowRight className="w-4 h-4 text-rose-600 group-hover:translate-x-2 transition-transform duration-300" />
                      </div>
                    </motion.button>
                  )}
                </div>
              ) : (
                <div className="text-center py-16">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", duration: 0.6 }}
                  >
                    <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  </motion.div>
                  <p className="text-sm text-slate-500 font-third mb-6">
                    No projects yet
                  </p>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onNavigate("recommender")}
                    className="group relative inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-br from-rose-600 to-cyan-600 hover:from-rose-700 hover:to-cyan-700 text-white font-third text-sm rounded-full shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                    <Zap className="w-4 h-4 relative z-10" />
                    <span className="relative z-10 font-semibold">
                      Create your first project
                    </span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform relative z-10" />
                  </motion.button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-lg hover:shadow-xl transition-all duration-500">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold text-slate-900 font-third">
                  Quick Actions
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 font-third">
              <QuickActionCard
                title="Create Project"
                description="Train a new recommender model"
                Icon={Zap}
                onClick={() => onNavigate("recommender")}
                gradient="from-rose-600 to-cyan-600"
              />
              <QuickActionCard
                title="Register App"
                description="Generate API keys & webhook"
                Icon={Webhook}
                onClick={() => onNavigate("dashboard")}
                gradient="from-rose-600 to-cyan-600"
              />
              <QuickActionCard
                title="View Analytics"
                description="Inspect usage and traffic trends"
                Icon={BarChart3}
                onClick={() => onNavigate("analytics")}
                gradient="from-rose-600 to-cyan-600"
              />
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.6 }}
        className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl border border-b-none border-t-cyan-100 border-slate-700 overflow-hidden  mt-6 mb-0 h-full py-3"
      >
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-rose-500/10 to-cyan-500/10 rounded-full blur-3xl"></div>

        <div className="relative p-8">
          <p className="text-sm font-semibold font-third mb-8 text-slate-300 flex items-center gap-2">
            Workspace Summary
          </p>
          <div className="grid grid-cols-3 gap-8">
            <SummaryItemPro
              label="Active Projects"
              value={loading ? "—" : projects.length}
              subtitle={`${readyProjects} ready`}
            />
            <SummaryItemPro
              label="Registered Apps"
              value={loading ? "—" : apps.length}
              subtitle={`${activeApps} active`}
            />
            <SummaryItemPro
              label="Total Requests"
              value={loading ? "—" : totalRequests.toLocaleString()}
              subtitle="All-time"
            />
          </div>
        </div>
      </motion.div>
    </ShellSection>
  );
};

const StatusCard = ({ name, status = "checking", endpoint, latency }) => {
  const statusConfig = {
    ok: {
      badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
      dot: "bg-emerald-400",
      text: "Operational",
      glow: "shadow-emerald-100",
    },
    degraded: {
      badge: "bg-amber-100 text-amber-700 border-amber-200",
      dot: "bg-amber-400",
      text: "Degraded",
      glow: "shadow-amber-100",
    },
    checking: {
      badge: "bg-slate-100 text-slate-700 border-slate-200",
      dot: "bg-slate-300",
      text: "Checking...",
      glow: "shadow-slate-100",
    },
  };

  const config = statusConfig[status] || statusConfig.checking;

  return (
    <motion.div
      className={`group relative bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm  ${config.glow} `}
    >
      <div className="absolute bottom-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-rose-400 via-cyan-100 to-rose-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-right"></div>
      <div className="absolute top-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-cyan-400 via-cyan-100 to-cyan-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-right"></div>

      <div className="relative p-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-900 font-third">
            {name}
          </span>
          <span
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${config.badge}`}
          >
            {config.text}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-600 font-third">
          <div className="flex items-center gap-2 truncate flex-1">
            <motion.span
              animate={status === "checking" ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity }}
              className={`w-2 h-2 rounded-full ${config.dot}`}
            />
            <span className="truncate">{endpoint}</span>
          </div>
          {latency && status !== "checking" && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className={`ml-2 font-bold whitespace-nowrap ${
                status === "ok" ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {latency}
            </motion.span>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const ProjectActivityItem = ({ project, onClick }) => {
  const statusConfig = {
    ready: {
      color: "from-emerald-500 to-emerald-600",
      text: "Ready",
      bgClass: "bg-emerald-50 text-emerald-700",
      icon: CheckCircle2,
      iconColor: "text-emerald-600",
    },
    training: {
      color: "from-blue-500 to-blue-600",
      text: "Training",
      bgClass: "bg-blue-50 text-blue-700",
      icon: Clock,
      iconColor: "text-blue-600",
    },
    failed: {
      color: "from-red-500 to-red-600",
      text: "Failed",
      bgClass: "bg-red-50 text-red-700",
      icon: AlertCircle,
      iconColor: "text-red-600",
    },
    pending: {
      color: "from-amber-500 to-rose-500",
      text: "Pending",
      bgClass: "bg-rose-50 text-amber-700",
      icon: Clock,
      iconColor: "text-amber-600",
    },
  };

  const config = statusConfig[project.status] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <motion.div
      whileHover={{ scale: 1.0, x: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="group relative overflow-hidden bg-white hover:bg-gradient-to-r hover:from-rose-50/30 hover:to-cyan-50/30 border border-slate-200 rounded-2xl cursor-pointer transition-all duration-300 shadow-sm hover:shadow-md"
    >
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/60 to-transparent"></div>

      <div className="relative p-5">
        <div className="flex items-center gap-4">
          {project.status === "training" && (
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-cyan-500 to-rose-600 animate-ping opacity-30"></div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 font-third">
              <h4 className="text-sm font-bold text-slate-900 truncate">
                {project.name || project.project_name || "Unnamed Project"}
              </h4>

              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-rose-500 flex-shrink-0 transition-colors" />
            </div>
            <p className="text-xs text-slate-500  font-third">
              ID: {project.id || project.project_id || "N/A"}
            </p>
          </div>

          <div
            className={`px-3 py-1.5  font-third text-sm  flex items-center gap-1.5 `}
          >
            {config.text}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const SummaryItemPro = ({ label, value, subtitle }) => (
  <motion.div
    whileHover={{ scale: 1.0 }}
    className="text-center p-4 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 transition-all duration-300"
  >
    <motion.p
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", duration: 0.6 }}
      className="text-4xl font-bold text-white mb-2 font-main"
    >
      {value}
    </motion.p>
    <p className="text-xs text-slate-300 mb-1 font-third">{label}</p>
    <span className="text-[10px] text-slate-400 font-third">{subtitle}</span>
  </motion.div>
);

const QuickActionCard = ({
  title,
  description,
  Icon,
  onClick,
  gradient = "from-rose-600 to-cyan-600",
}) => {
  return (
    <motion.div
      whileHover={{ scale: 1.01, x: 4 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="group relative overflow-hidden bg-white border border-slate-200 rounded-3xl cursor-pointer transition-all duration-300 shadow-sm hover:shadow-lg"
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
      ></div>
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>

      <div className="relative flex items-center gap-4 p-5">
        <motion.div
          className={`relative p-3 bg-gradient-to-br ${gradient} rounded-2xl shadow-lg group-hover:shadow-xl transition-all duration-300 flex-shrink-0`}
        >
          <Icon className="w-5 h-5 text-white relative z-10" />
          <div className="absolute inset-0 rounded-2xl bg-white opacity-0 group-hover:opacity-20 group-hover:scale-150 transition-all duration-500"></div>
        </motion.div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-slate-900 group-hover:text-white transition-colors duration-300 truncate font-third">
              {title}
            </h3>

            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-white opacity-0 group-hover:opacity-100 transition-all duration-300 flex-shrink-0" />
          </div>
          <p className="text-xs text-slate-600 group-hover:text-white/90 transition-colors duration-300 line-clamp-1 font-third">
            {description}
          </p>
        </div>
      </div>

      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-white/0 to-white/10 transform rotate-45 translate-x-10 -translate-y-10 group-hover:scale-150 transition-transform duration-500"></div>
    </motion.div>
  );
};

const AnalyticsView = ({ summary }) => {
  const {
    usage = [],
    totalRequests = 0,
    apps = [],
    loading = true,
  } = summary || {};

  const topApp =
    usage.length > 0
      ? usage.reduce(
          (max, app) =>
            (app.usage_count || 0) > (max.usage_count || 0) ? app : max,
          usage[0],
        )
      : null;

  const avgRequestsPerApp =
    apps.length > 0 ? Math.floor(totalRequests / apps.length) : 0;

  return (
    <ShellSection
      eyebrow="Analytics"
      title="Usage Analytics"
      description="Traffic trends, application performance, and infrastructure insights from your database."
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.6 }}
        className="grid grid-cols-1 md:grid-cols-4 gap-4"
      >
        <MetricCard
          label="Total Requests"
          value={loading ? "—" : totalRequests.toLocaleString()}
          change="All-time webhook calls"
          delay={0.1}
        />
        <MetricCard
          label="Registered Apps"
          value={loading ? "—" : apps.length}
          change={`${usage.length} with usage data`}
          delay={0.2}
        />
        <MetricCard
          label="Avg per App"
          value={loading ? "—" : avgRequestsPerApp.toLocaleString()}
          change="Request distribution"
          delay={0.3}
        />
        <MetricCard
          label="Top Performer"
          value={
            loading
              ? "—"
              : topApp
                ? topApp.app_name?.substring(0, 12) +
                  (topApp.app_name?.length > 12 ? "..." : "")
                : "N/A"
          }
          change={
            topApp
              ? `${(topApp.usage_count || 0).toLocaleString()} requests`
              : "No data"
          }
          delay={0.4}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
        className="bg-white rounded-3xl border border-slate-200 shadow-lg  duration-500 overflow-hidden mt-6"
      >
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-lg font-semibold text-slate-900 font-third">
                Request Distribution by App
              </p>
              <p className="text-xs text-slate-500 mt-1 font-third flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-cyan-400"></span>
                Based on webhooks.usage table
              </p>
            </div>
            <motion.div
              whileHover={{ scale: 1.05 }}
              className="text-xs font-bold text-slate-700 bg-slate-100 px-4 py-2 rounded-full"
            >
              {totalRequests.toLocaleString()} total
            </motion.div>
          </div>

          {loading ? (
            <div className="text-center py-16 text-slate-400 text-sm">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="inline-block"
              >
                <Clock className="w-8 h-8 text-slate-300" />
              </motion.div>
              <p className="mt-4">Loading usage data...</p>
            </div>
          ) : usage.length > 0 ? (
            <div className="flex items-end justify-between gap-4 h-64">
              {usage.map((app, i) => {
                const maxUsage = Math.max(
                  ...usage.map((u) => u.usage_count || 0),
                );
                const height =
                  maxUsage > 0 ? ((app.usage_count || 0) / maxUsage) * 100 : 5;
                const percent =
                  totalRequests > 0
                    ? Math.round(((app.usage_count || 0) / totalRequests) * 100)
                    : 0;

                return (
                  <motion.div
                    key={app.app_name || i}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    transition={{
                      delay: i * 0.1,
                      duration: 0.5,
                      type: "spring",
                    }}
                    className="flex-1 flex flex-col items-center gap-3"
                  >
                    <div className="w-full relative group">
                      <motion.div
                        whileHover={{ scale: 1.0 }}
                        className="w-full rounded-t-2xl bg-gradient-to-t from-emerald-600 via-teal-500 to-emerald-400 transition-all duration-300 hover:from-emerald-700 hover:via-teal-600 cursor-pointer shadow-lg relative overflow-hidden"
                        style={{ height: `${height}%`, minHeight: "24px" }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-t from-white/0 via-white/10 to-white/20"></div>
                      </motion.div>

                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        <motion.div
                          initial={{ y: 10 }}
                          whileHover={{ y: 0 }}
                          className="bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl text-xs whitespace-nowrap"
                        >
                          <p className="font-bold text-sm mb-1">
                            {(app.usage_count || 0).toLocaleString()} requests
                          </p>
                          <p className="text-slate-400 text-xs">
                            {app.app_name}
                          </p>
                          <p className="text-slate-400 text-xs">
                            {percent}% of total
                          </p>
                        </motion.div>
                      </div>
                    </div>
                    <div className="text-center w-full">
                      <p
                        className="text-xs font-bold text-slate-900 truncate px-1 font-third"
                        title={app.app_name}
                      >
                        {app.app_name && app.app_name.length > 8
                          ? app.app_name.substring(0, 8) + "..."
                          : app.app_name || "N/A"}
                      </p>
                      <p className="text-xs font-bold text-emerald-600 font-third">
                        {percent}%
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16">
              <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-sm text-slate-400 mb-2">
                No usage data available
              </p>
              <p className="text-xs text-slate-500 font-third">
                Register apps and start making requests to see analytics
              </p>
            </div>
          )}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.6 }}
        className="grid lg:grid-cols-2 gap-6 mt-6"
      >
        <div className="bg-white rounded-3xl border border-slate-200 shadow-lg hover:shadow-xl transition-all duration-500 overflow-hidden">
          <div className="p-8">
            <div className="flex items-center justify-between mb-6">
              <p className="text-lg font-semibold font-third text-slate-900">
                Traffic Distribution
              </p>
              <span className="text-xs text-slate-500 font-third">
                By application
              </span>
            </div>

            {loading ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                Loading...
              </div>
            ) : usage.length > 0 ? (
              <div className="space-y-5">
                {usage.map((u, idx) => {
                  const percent =
                    totalRequests > 0
                      ? Math.round(((u.usage_count || 0) / totalRequests) * 100)
                      : 0;

                  return (
                    <motion.div
                      key={u.app_name}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1, duration: 0.4 }}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-bold text-slate-900 truncate pr-2 font-third">
                          {u.app_name}
                        </span>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-xs text-slate-500 font-third">
                            {(u.usage_count || 0).toLocaleString()}
                          </span>
                          <span className="text-sm font-bold text-slate-900 font-third">
                            {percent}%
                          </span>
                        </div>
                      </div>
                      <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${percent}%` }}
                          transition={{
                            delay: idx * 0.1 + 0.3,
                            duration: 0.8,
                            ease: "easeOut",
                          }}
                          className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 rounded-full relative overflow-hidden"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 animate-shimmer"></div>
                        </motion.div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs">
                No usage data available
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-lg hover:shadow-xl transition-all duration-500 overflow-hidden">
          <div className="p-8">
            <div className="flex items-center justify-between mb-6">
              <p className="text-lg font-semibold font-third text-slate-900">
                Top Applications
              </p>
              <span className="text-xs text-slate-500 font-third">
                By request volume
              </span>
            </div>

            {loading ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                Loading...
              </div>
            ) : usage.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b-2 border-slate-200">
                    <tr>
                      <th className="text-left pb-4 font-bold text-slate-500 font-third">
                        Rank
                      </th>
                      <th className="text-left pb-4 font-bold text-slate-500 font-third">
                        Application
                      </th>
                      <th className="text-right pb-4 font-bold text-slate-500 font-third">
                        Requests
                      </th>
                      <th className="text-right pb-4 font-bold text-slate-500 font-third">
                        Share
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage
                      .slice()
                      .sort(
                        (a, b) => (b.usage_count || 0) - (a.usage_count || 0),
                      )
                      .map((u, idx) => {
                        const percent =
                          totalRequests > 0
                            ? Math.round(
                                ((u.usage_count || 0) / totalRequests) * 100,
                              )
                            : 0;
                        return (
                          <motion.tr
                            key={u.app_name || idx}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.1, duration: 0.4 }}
                            className="border-b border-slate-100 transition-colors cursor-pointer"
                          >
                            <td className="py-4">
                              <motion.span
                                whileHover={{ scale: 1.0 }}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-emerald-100 to-cyan-100 text-cyan-700 font-bold text-xs shadow-sm"
                              >
                                {idx + 1}
                              </motion.span>
                            </td>
                            <td
                              className="py-4 font-bold text-slate-900 truncate max-w-[150px] font-third"
                              title={u.app_name}
                            >
                              {u.app_name}
                            </td>
                            <td className="text-right font-bold text-slate-900 font-third">
                              {(u.usage_count || 0).toLocaleString()}
                            </td>
                            <td className="text-right">
                              <span className="px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 font-bold border border-emerald-200 font-third inline-block">
                                {percent}%
                              </span>
                            </td>
                          </motion.tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs">
                No usage data available
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </ShellSection>
  );
};

const MetricCard = ({ label, value, change, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay, duration: 0.4, type: "spring" }}
    whileHover={{ scale: 1.0, y: 0 }}
    className="group relative bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm transition-all duration-300"
  >
    <div className="absolute bottom-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-rose-400 via-cyan-100 to-rose-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"></div>
    <div className="absolute top-0 left-0 right-0 h-[0.5px] bg-gradient-to-r from-cyan-400 via-cyan-100 to-cyan-400 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-right"></div>

    <div className="relative p-6">
      <p className="text-sm font-semibold text-slate-500 mb-2 font-third">
        {label}
      </p>
      <p className="text-3xl font-bold text-slate-900 mb-3 font-main">
        {value}
      </p>
      <p className="text-xs text-slate-500 font-third flex items-center gap-1">
        <span className="w-1 h-1 rounded-full bg-cyan-400"></span>
        {change}
      </p>
    </div>
  </motion.div>
);

const Card = ({ label, value }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="text-2xl font-bold mt-1">
      {value?.toLocaleString?.() ?? value}
    </p>
  </div>
);

const BillingView = ({ summary }) => {
  const { totalRequests, loading } = summary;
  const pricePerThousand = 1.0;
  const estimatedCost = loading
    ? null
    : ((totalRequests / 1000) * pricePerThousand).toFixed(2);

  return (
    <ShellSection
      eyebrow="Billing"
      title="Billing & usage"
      description="Track how your workspace consumes recommendation capacity and manage your plan."
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.6 }}
        className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-8"
      >
        <div className="space-y-6">
          <motion.div
            whileHover={{ scale: 1.01 }}
            className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden"
          >
            <div className="p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-xs font-semibold text-slate-500 font-third mb-1">
                    Current plan
                  </p>
                  <p className="text-2xl font-bold text-slate-900 font-main">
                    Developer
                  </p>
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 border-slate-300 text-slate-700 hover:border-cyan-400 hover:text-slate-900 bg-white transition-all shadow-sm hover:shadow-md"
                >
                  <CreditCard className="w-4 h-4" />
                  <span className="font-third">Manage plan</span>
                </motion.button>
              </div>
              <p className="text-sm text-slate-600 font-third leading-relaxed">
                Ideal for prototyping and small workloads. Includes generous
                free quota and access to all core features of Recommender Studio
                and Webhook Dashboard.
              </p>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.01 }}
            className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden"
          >
            <div className="p-8">
              <p className="text-sm font-semibold text-slate-500 font-third mb-6">
                Current usage (from webhooks.usage)
              </p>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-slate-700 font-third">
                    Recommendation requests
                  </span>
                  <span className="text-xl font-bold text-slate-900 font-main">
                    {loading ? "—" : totalRequests.toLocaleString()}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "50%" }}
                    transition={{ delay: 0.5, duration: 1, ease: "easeOut" }}
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-400 relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 animate-shimmer"></div>
                  </motion.div>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-4 font-third">
                Request counts are taken directly from the `webhooks.usage`
                table. You can later plug in per-project quotas and limits.
              </p>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.01 }}
            className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden"
          >
            <div className="p-8">
              <p className="text-sm font-semibold text-slate-500 font-third mb-6">
                Estimated invoice (based on current usage)
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-slate-900 font-third">
                    Current cycle
                  </p>
                  <p className="text-xs text-slate-500 font-third mt-1">
                    Calculated at ${pricePerThousand.toFixed(2)} per 1k requests
                  </p>
                </div>
                <motion.p
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", duration: 0.6 }}
                  className="text-3xl font-bold text-slate-900 font-main"
                >
                  {loading || estimatedCost === null
                    ? "—"
                    : `$${estimatedCost}`}
                </motion.p>
              </div>
              <p className="text-xs text-slate-500 mt-6 font-third">
                Connect this card to your real billing system to show invoice
                status, payment method, and downloadable PDFs while still using
                live usage figures from your database.
              </p>
            </div>
          </motion.div>
        </div>

        <div className="space-y-6">
          <motion.div
            whileHover={{ scale: 1.01 }}
            className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-50 rounded-3xl border border-slate-700 overflow-hidden shadow-2xl"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-rose-500/20 to-cyan-500/20 rounded-full blur-3xl"></div>

            <div className="relative p-8">
              <p className="text-sm font-semibold text-slate-300 font-third mb-4">
                Invoices & exports
              </p>
              <p className="text-lg font-semibold mb-3 font-third">
                Export billing history for finance and analytics
              </p>
              <p className="text-xs text-slate-400 font-third">
                Attach your own backend endpoint here to stream invoices,
                payment methods, and CSV exports while keeping the minimal
                layout.
              </p>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.01 }}
            className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden"
          >
            <div className="p-8">
              <p className="text-sm font-semibold text-slate-500 font-third mb-4">
                Cost controls
              </p>
              <ul className="space-y-3 text-sm text-slate-600 font-third">
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2 flex-shrink-0"></span>
                  <span>Set soft limits on monthly recommendation volume.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-2 flex-shrink-0"></span>
                  <span>
                    Alert on sudden spikes per project or per API key.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2 flex-shrink-0"></span>
                  <span>Route high-volume tenants to dedicated backends.</span>
                </li>
              </ul>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </ShellSection>
  );
};

const SettingsView = () => (
  <ShellSection
    eyebrow="Settings"
    title="Workspace settings"
    description="Configure how your AiREC workspace connects to auth, the ML backend, and external clients."
  >
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.6 }}
      className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-sm"
    >
      <div className="lg:col-span-2 space-y-6">
        <motion.div
          whileHover={{ scale: 1.01 }}
          className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden"
        >
          <div className="p-8">
            <p className="text-sm font-semibold text-slate-500 font-third mb-6">
              Workspace profile
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2 font-third">
                  Workspace name
                </label>
                <input
                  type="text"
                  value="Personal workspace"
                  readOnly
                  className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 font-third focus:border-cyan-400 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2 font-third">
                  Environment
                </label>
                <input
                  type="text"
                  value="Development"
                  readOnly
                  className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 font-third focus:border-cyan-400 focus:outline-none transition-colors"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-4 font-third">
              Later, you can make these fields editable and persist them in your
              auth service or a dedicated workspace table.
            </p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.01 }}
          className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden"
        >
          <div className="p-8">
            <p className="text-sm font-semibold text-slate-500 font-third mb-6">
              API endpoints
            </p>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-slate-500 mb-2 font-third">
                  Auth service
                </p>
                <code className="block rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 border border-slate-200 px-4 py-3 text-xs text-slate-800 break-all font-mono">
                  http://localhost:8080
                </code>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2 font-third">
                  ML recommender (FastAPI)
                </p>
                <code className="block rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 border border-slate-200 px-4 py-3 text-xs text-slate-800 break-all font-mono">
                  http://localhost:8000
                </code>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2 font-third">
                  Webhook service
                </p>
                <code className="block rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 border border-slate-200 px-4 py-3 text-xs text-slate-800 break-all font-mono">
                  http://localhost:3001
                </code>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-4 font-third">
              These URLs are currently configured via environment variables in
              the backend and the Vite frontend. You can adapt this section
              later to surface workspace-level configuration.
            </p>
          </div>
        </motion.div>
      </div>

      <div className="space-y-6">
        <motion.div
          whileHover={{ scale: 1.01 }}
          className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden"
        >
          <div className="p-8">
            <p className="text-sm font-semibold text-slate-500 font-third mb-4">
              API tokens
            </p>
            <p className="text-xs text-slate-600 mb-4 font-third">
              Use personal API tokens for CLI access or automation. Webhook apps
              will still use their own scoped API keys.
            </p>
            <code className="block rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 border border-slate-200 px-4 py-3 text-xs text-slate-800 break-all font-mono mb-4">
              airec_live_••••••••••••••••••••
            </code>
            <div className="flex gap-2">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex-1 rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:border-cyan-400 hover:text-slate-900 transition-all font-third"
              >
                Copy token
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex-1 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 px-4 py-2 text-xs font-semibold text-slate-50 hover:from-slate-800 hover:to-slate-700 transition-all shadow-lg font-third"
              >
                Generate new
              </motion.button>
            </div>
            <p className="text-xs text-slate-500 mt-4 font-third">
              Wire these actions up to your backend to issue and revoke personal
              access tokens.
            </p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.01 }}
          className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-50 rounded-3xl border border-slate-700 overflow-hidden shadow-2xl"
        >
          <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-rose-500/20 to-cyan-500/20 rounded-full blur-3xl"></div>

          <div className="relative p-8">
            <p className="text-sm font-semibold text-slate-300 font-third mb-3">
              Theme & appearance
            </p>
            <p className="text-lg font-semibold mb-3 font-third">
              The dashboard uses a neutral/cyan palette by default.
            </p>
            <p className="text-xs text-slate-400 font-third">
              Hook this card up to user preferences to support per-user themes,
              light/dark modes, or custom accent colors without changing the
              underlying layout.
            </p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  </ShellSection>
);

function useDashboardSummary() {
  const [state, setState] = useState({
    projects: [],
    apps: [],
    usage: [],
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const backendHeaders = getBackendAuthHeaders();
        const [projectsRes, appsRes, usageRes] = await Promise.all([
          fetch(`${API_BACKEND}/projects/`, { headers: backendHeaders }).catch(
            () => null,
          ),
          fetch(`${API_WEBHOOK}/api/apps`).catch(() => null),
          fetch(`${API_WEBHOOK}/api/apps/usage`).catch(() => null),
        ]);

        const safeJson = async (res, fallback) => {
          if (!res || !res.ok) return fallback;
          try {
            const data = await res.json();
            return Array.isArray(data) ? data : fallback;
          } catch {
            return fallback;
          }
        };

        const projects = await safeJson(projectsRes, []);
        const apps = await safeJson(appsRes, []);
        const usage = await safeJson(usageRes, []);

        if (cancelled) return;

        setState({
          projects,
          apps,
          usage,
          loading: false,
        });
      } catch {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const totalRequests = state.usage.reduce(
      (acc, curr) =>
        acc + (typeof curr.usage_count === "number" ? curr.usage_count : 0),
      0,
    );
    const readyProjects = state.projects.filter(
      (p) => p.status === "ready",
    ).length;

    return {
      totalRequests,
      readyProjects,
      projectsCount: state.projects.length,
      appsCount: state.apps.length,
    };
  }, [state.projects, state.usage, state.apps]);

  return { ...state, ...totals };
}

export default function AppShell() {
  const [activeTab, setActiveTab] = useState("home");
  const { logout } = useAuth();
  const navigate = useNavigate();
  const summary = useDashboardSummary();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleLogout = () => {
    logout();
    toast.success("Signed out");
    navigate("/login", { replace: true });
  };

  const renderMainContent = () => {
    switch (activeTab) {
      case "home":
        return <HomeOverview onNavigate={setActiveTab} summary={summary} />;
      case "recommender":
        return <RecommenderPanel />;
      case "dashboard":
        return <Dashboard />;
      case "analytics":
        return <AnalyticsView summary={summary} />;
      case "billing":
        return <BillingView summary={summary} />;
      case "settings":
        return <SettingsView />;
      default:
        return <HomeOverview onNavigate={setActiveTab} summary={summary} />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-white to-slate-50">
      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      <div className="flex min-h-screen">
        <motion.aside
          initial={{ x: -280 }}
          animate={{ x: 0 }}
          transition={{ duration: 0.5, type: "tween" }}
          className={`fixed left-0 top-0 bg-white border-r rounded-r-4xl border-gray-200 flex flex-col shadow-3xl h-screen transition-all duration-500 z-50 ${
            isSidebarOpen ? "w-[280px]" : "w-[72px]"
          }`}
          onMouseEnter={() => !isSidebarOpen && setIsSidebarOpen(true)}
          onMouseLeave={() => isSidebarOpen && setIsSidebarOpen(false)}
        >
          <div className="h-full flex flex-col">
            <div className="px-3 py-6 border-b rounded-b-3xl border-gray-200 flex-shrink-0 bg-rose-50 shadow-sm">
              <div className="flex items-center gap-3">
                <motion.div
                  whileHover={{ rotate: 0 }}
                  transition={{ duration: 0.1 }}
                  className="w-11 h-11 bg-gradient-to-br from-rose-900 via-rose-800 to-cyan-600 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0"
                >
                  <Layers className="w-6 h-6 text-white" />
                </motion.div>
                <AnimatePresence>
                  {isSidebarOpen && (
                    <motion.h1
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="text-xl font-bold font-main text-gray-900 whitespace-nowrap"
                    >
                      BaaS Studio
                    </motion.h1>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto py-6 px-4 scrollbar-hide ">
              <div className="space-y-2">
                {NAV_ITEMS.map((item, index) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <motion.button
                      key={item.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.01, duration: 0.1 }}
                      onClick={() => setActiveTab(item.id)}
                      whileHover={{ scale: 1.02, x: 0 }}
                      whileTap={{ scale: 0.98 }}
                      className="group w-full flex items-center gap-3 px-0 py-3.5 rounded-2xl hover:border-t-1 hover:border-rose-500 transition-all duration-300 cursor-pointer"
                      title={!isSidebarOpen ? item.label : ""}
                    >
                      <motion.span
                        whileHover={{ rotate: isActive ? 0 : 0 }}
                        transition={{ duration: 0.6 }}
                        className={`inline-flex items-center justify-center rounded-2xl w-10 h-10  flex-shrink-0 transition-all duration-300 ${
                          isActive
                            ? "bg-gradient-to-br from-rose-600 to-cyan-600 text-white shadow-lg shadow-rose-200"
                            : "bg-gray-100 text-gray-600 group-hover:bg-gradient-to-br group-hover:from-rose-500 group-hover:to-cyan-500 group-hover:text-white group-hover:shadow-md"
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </motion.span>

                      <AnimatePresence>
                        {isSidebarOpen && (
                          <motion.div
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            className="flex-1 min-w-0 text-left"
                          >
                            <p
                              className={`text-sm font-bold font-third truncate transition-colors duration-300 ${
                                isActive
                                  ? "text-gray-900"
                                  : "text-gray-600 group-hover:text-gray-900"
                              }`}
                            >
                              {item.label}
                            </p>
                            <p className="text-[11px] font-sec text-gray-500 truncate">
                              {item.description}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  );
                })}
              </div>
            </nav>

            <div className="px-1 py-5 border-t shadow- rounded-t-3xl border-gray-300 bg-gradient-to-br from-red-50/50 to-rose-50/30 flex-shrink-0">
              <motion.button
                whileHover={{ scale: 1.0 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleLogout}
                className="group w-full px-3 py-3.5 rounded-2xl text-sm font-medium flex items-center transition-all hover:bg-red-100 border-1 border-transparent hover:border-red-200 cursor-pointer"
                title="Sign out"
              >
                <span className="flex items-center gap-3 w-full">
                  <motion.span
                    whileHover={{ rotate: 180 }}
                    transition={{ duration: 0.2 }}
                    className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-red-100 group-hover:bg-gradient-to-br group-hover:from-red-500 group-hover:to-rose-600 flex-shrink-0 transition-all duration-300 shadow-sm"
                  >
                    <LogOut className="w-5 h-5 text-rose-700 group-hover:text-white transition-colors duration-300" />
                  </motion.span>
                  <AnimatePresence>
                    {isSidebarOpen && (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="flex items-center justify-between w-full"
                      >
                        <span className="font-bold font-third text-rose-600 group-hover:text-red-700">
                          Sign out
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </span>
              </motion.button>
            </div>
          </div>
        </motion.aside>

        <main
          className={`flex-1 overflow-y-auto transition-all duration-500 ${
            isSidebarOpen ? "ml-[280px]" : "ml-[72px]"
          }`}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
            >
              {renderMainContent()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
