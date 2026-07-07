import React, { useState, useMemo } from "react";
import { AppLog } from "../types";
import {
  Terminal,
  Trash2,
  RefreshCw,
  Search,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  MousePointerClick,
  Globe,
  Server,
  ChevronRight,
  ChevronDown,
  Download,
  Copy,
  Terminal as ConsoleIcon,
  Play
} from "lucide-react";

interface DiagnosticsLogViewerProps {
  logs: AppLog[];
  serverLogs: AppLog[];
  onClearLogs: () => void;
  onRefreshServerLogs: () => Promise<void>;
  isPolling: boolean;
  setIsPolling: (val: boolean) => void;
}

export default function DiagnosticsLogViewer({
  logs,
  serverLogs,
  onClearLogs,
  onRefreshServerLogs,
  isPolling,
  setIsPolling
}: DiagnosticsLogViewerProps) {
  const [filter, setFilter] = useState<"all" | "error" | "api" | "browser" | "server">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Combine local (browser) and server logs chronologically
  const combinedLogs = useMemo(() => {
    const combined = [...logs, ...serverLogs];
    // Sort descending by timestamp (newest first)
    return combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [logs, serverLogs]);

  // Filter logs based on selection and query
  const filteredLogs = useMemo(() => {
    return combinedLogs.filter((log) => {
      // Category / Level Filter
      if (filter === "error" && log.level !== "error") return false;
      if (filter === "api" && log.category !== "api") return false;
      if (filter === "browser" && log.category !== "browser" && log.category !== "click" && log.category !== "action") return false;
      if (filter === "server" && log.category !== "server") return false;

      // Text Search Filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesMsg = log.message.toLowerCase().includes(query);
        const matchesCategory = log.category.toLowerCase().includes(query);
        const matchesDetails = log.details ? log.details.toLowerCase().includes(query) : false;
        return matchesMsg || matchesCategory || matchesDetails;
      }

      return true;
    });
  }, [combinedLogs, filter, searchQuery]);

  // Telemetry stats
  const stats = useMemo(() => {
    const total = combinedLogs.length;
    const errors = combinedLogs.filter((l) => l.level === "error").length;
    const warnings = combinedLogs.filter((l) => l.level === "warn").length;
    const apiRequests = combinedLogs.filter((l) => l.category === "api").length;
    return { total, errors, warnings, apiRequests };
  }, [combinedLogs]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshServerLogs();
    } catch (e) {
      console.error("Failed to refresh server logs", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCopyLog = (log: AppLog) => {
    const text = `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.category.toUpperCase()}] ${log.message}${
      log.details ? "\nDetails:\n" + log.details : ""
    }`;
    navigator.clipboard.writeText(text);
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleDownloadLogs = () => {
    const text = JSON.stringify(combinedLogs, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `podcast_studio_diagnostics_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Icon mapping helper
  const getLogIcon = (log: AppLog) => {
    if (log.level === "error") return <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />;
    if (log.level === "warn") return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
    if (log.level === "success") return <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />;

    // Category fallback icons
    if (log.category === "click") return <MousePointerClick className="w-4 h-4 text-blue-400 shrink-0" />;
    if (log.category === "api") return <Globe className="w-4 h-4 text-indigo-400 shrink-0" />;
    if (log.category === "server") return <Server className="w-4 h-4 text-violet-400 shrink-0" />;

    return <Info className="w-4 h-4 text-slate-400 shrink-0" />;
  };

  // Class style helper
  const getLogLevelClass = (level: string) => {
    switch (level) {
      case "error":
        return "bg-rose-950/20 text-rose-300 border-rose-950/40 hover:bg-rose-950/30";
      case "warn":
        return "bg-amber-950/20 text-amber-300 border-amber-950/40 hover:bg-amber-950/30";
      case "success":
        return "bg-emerald-950/25 text-emerald-300 border-emerald-950/40 hover:bg-emerald-950/35";
      default:
        return "bg-slate-900/30 text-slate-300 border-slate-900/40 hover:bg-slate-900/50";
    }
  };

  return (
    <div className="flex flex-col gap-5 flex-1" id="diagnostics-log-viewer">
      {/* Upper Grid Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl backdrop-blur-md flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Total Events Captured</span>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-slate-100">{stats.total}</span>
            <span className="text-xs text-slate-500">all streams</span>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl backdrop-blur-md flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-rose-500">Exceptions / Errors</span>
          <div className="flex items-baseline gap-2">
            <span className={`text-xl font-bold font-mono ${stats.errors > 0 ? "text-rose-400" : "text-slate-400"}`}>
              {stats.errors}
            </span>
            {stats.errors > 0 && <span className="text-[10px] font-mono text-rose-500 animate-pulse">Critical</span>}
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl backdrop-blur-md flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400">Outgoing API Calls</span>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-indigo-300">{stats.apiRequests}</span>
            <span className="text-xs text-slate-500">Gemini & proxy</span>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl backdrop-blur-md flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">Server Stream Status</span>
          <div className="flex items-center gap-2 mt-0.5">
            <div className={`w-2.5 h-2.5 rounded-full ${isPolling ? "bg-emerald-500 animate-pulse" : "bg-slate-600"}`} />
            <span className="text-xs font-semibold font-mono text-slate-300">
              {isPolling ? "Connected & Polling" : "Inactive"}
            </span>
          </div>
        </div>
      </div>

      {/* Control Toolbar */}
      <div className="bg-slate-900/50 border border-slate-800/80 rounded-xl p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        {/* Stream Filter Options */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            id="log-filter-all"
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-all border ${
              filter === "all"
                ? "bg-slate-800 text-emerald-400 border-slate-700 font-semibold"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/50"
            }`}
          >
            Full Logging
          </button>
          <button
            id="log-filter-error"
            onClick={() => setFilter("error")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-all border ${
              filter === "error"
                ? "bg-rose-950/30 text-rose-400 border-rose-900/50 font-semibold"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/50"
            }`}
          >
            Errors Only
          </button>
          <button
            id="log-filter-api"
            onClick={() => setFilter("api")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-all border ${
              filter === "api"
                ? "bg-indigo-950/30 text-indigo-400 border-indigo-900/50 font-semibold"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/50"
            }`}
          >
            API Only
          </button>
          <button
            id="log-filter-browser"
            onClick={() => setFilter("browser")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-all border ${
              filter === "browser"
                ? "bg-blue-950/30 text-blue-400 border-blue-900/50 font-semibold"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/50"
            }`}
          >
            Local Browser
          </button>
          <button
            id="log-filter-server"
            onClick={() => setFilter("server")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-all border ${
              filter === "server"
                ? "bg-violet-950/30 text-violet-400 border-violet-900/50 font-semibold"
                : "text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800/50"
            }`}
          >
            Server Level
          </button>
        </div>

        {/* Text Search & Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 sm:w-60">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
            <input
              id="log-search-input"
              type="text"
              placeholder="Filter logs by keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 pl-9 pr-4 text-xs font-mono text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Auto refresh toggler */}
            <button
              id="log-toggle-polling"
              onClick={() => setIsPolling(!isPolling)}
              title={isPolling ? "Pause auto-refresh polling" : "Enable auto-refresh polling"}
              className={`p-2 rounded-lg border cursor-pointer transition-all text-xs font-semibold flex items-center gap-1.5 ${
                isPolling
                  ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/40 hover:bg-emerald-950/30"
                  : "bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300 hover:bg-slate-900"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${isPolling ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
              <span>{isPolling ? "Live Link" : "Stream Paused"}</span>
            </button>

            {/* Refresh server logs manual */}
            <button
              id="log-manual-refresh"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Manually fetch server logs"
              className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-emerald-400" : ""}`} />
            </button>

            {/* Download logs as JSON */}
            <button
              id="log-export-json"
              onClick={handleDownloadLogs}
              title="Download Logs as JSON"
              className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Clear logs */}
            <button
              id="log-clear-btn"
              onClick={onClearLogs}
              title="Clear all local console traces"
              className="p-2 bg-slate-950 border border-slate-800 hover:border-red-900/40 hover:bg-red-950/20 rounded-lg text-slate-500 hover:text-red-400 transition-all cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Terminal Display Panel */}
      <div className="bg-slate-950 border border-slate-900 rounded-2xl overflow-hidden flex flex-col flex-1 shadow-2xl min-h-[450px] max-h-[700px]">
        {/* Terminal Header */}
        <div className="bg-slate-900/60 border-b border-slate-900/80 px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-rose-500/25 border border-rose-500/40" />
              <span className="w-3 h-3 rounded-full bg-amber-500/25 border border-amber-500/40" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/25 border border-emerald-500/40" />
            </div>
            <div className="h-4 w-[1px] bg-slate-800/80 mx-2" />
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span>vocal_studio_telemetry_console.log</span>
            </div>
          </div>
          <span className="text-[10px] font-mono text-slate-600">
            Showing {filteredLogs.length} of {combinedLogs.length} entries
          </span>
        </div>

        {/* Terminal Feed Scroll Container */}
        <div className="flex-1 overflow-y-auto p-2 font-mono text-xs select-text divide-y divide-slate-900/50">
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-3">
              <ConsoleIcon className="w-10 h-10 text-slate-800 animate-pulse" />
              <p className="text-center max-w-sm font-sans">
                No telemetry traces match the filter conditions. Try interacting with the studio or resetting active logs.
              </p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const timestampStr = new Date(log.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                fractionalSecondDigits: 3
              } as any);

              return (
                <div
                  key={log.id}
                  className={`border-l-2 pl-3 py-2 transition-all ${getLogLevelClass(log.level)} ${
                    log.level === "error" ? "border-l-rose-500" : log.level === "warn" ? "border-l-amber-500" : log.level === "success" ? "border-l-emerald-500" : "border-l-slate-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Log main info */}
                    <div className="flex items-start gap-2.5 min-w-0">
                      {getLogIcon(log)}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-500 text-[10px] mb-0.5 font-sans">
                          <span className="font-mono text-slate-600">{timestampStr}</span>
                          <span className="font-mono bg-slate-900/80 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-wide">
                            {log.category}
                          </span>
                          <span className="font-mono uppercase font-bold text-[9px]">
                            {log.level}
                          </span>
                        </div>
                        <p className="text-slate-200 whitespace-pre-wrap break-all leading-relaxed text-[11px] font-mono">
                          {log.message}
                        </p>
                      </div>
                    </div>

                    {/* Actions on single log item */}
                    <div className="flex items-center gap-1.5 shrink-0 opacity-40 hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleCopyLog(log)}
                        title="Copy raw entry text"
                        className="p-1 hover:bg-slate-800/80 rounded hover:text-slate-200 cursor-pointer text-slate-500 transition-all"
                      >
                        {copiedId === log.id ? (
                          <span className="text-[9px] text-emerald-400 font-sans">Copied!</span>
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {log.details && (
                        <button
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                          title={isExpanded ? "Collapse payload JSON" : "Inspect payload details"}
                          className="p-1 hover:bg-slate-800/80 rounded hover:text-slate-200 cursor-pointer text-slate-500 transition-all flex items-center gap-0.5"
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail section */}
                  {isExpanded && log.details && (
                    <div className="mt-2 ml-6 bg-slate-950/80 border border-slate-900/90 rounded-lg p-3 font-mono text-[10px] text-slate-400 overflow-x-auto whitespace-pre leading-5 shadow-inner select-text max-h-80 overflow-y-auto">
                      {log.details}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
