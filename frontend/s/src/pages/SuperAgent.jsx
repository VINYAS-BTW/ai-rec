import React, { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2, Send } from "lucide-react";
import { API_BACKEND, getBackendAuthHeaders } from "../api";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function SuperAgent() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [sessionId, setSessionId] = useState("");
  const [targetDomain, setTargetDomain] = useState("");
  const [message, setMessage] = useState("");
  const [n, setN] = useState(10);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState([]); // { role, text, payload? }

  const clearChat = () => {
    setTranscript([]);
    setMessage("");
    setError("");
    setSessionId("");
  };

  const send = async () => {
    const msg = String(message || "").trim();
    if (!msg) return;
    setRunning(true);
    setError("");
    setTranscript((t) => [...t, { role: "user", text: msg }]);
    setMessage("");

    try {
      const body = {
        session_id: sessionId || undefined,
        message: msg,
        target_domain: targetDomain || undefined,
        context: {},
        n: Number(n) || 10,
      };

      const res = await fetch(`${API_BACKEND}/superagent/v1/chat`, {
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

      if (data.session_id && !sessionId) setSessionId(String(data.session_id));

      if (data.status === "clarify" && data.question) {
        setTranscript((t) => [
          ...t,
          {
            role: "assistant",
            text: `${data.question.prompt}`,
            payload: data,
          },
        ]);
      } else {
        const pid = data?.results?.[0]?.project_id;
        const ctx = data?.used_context && Object.keys(data.used_context).length
          ? JSON.stringify(data.used_context)
          : "(no constraints — model used its default ranking)";
        const mode = data?.response_mode || "recommendation";
        const answer = data?.answer_text ? `\n${data.answer_text}` : "";
        setTranscript((t) => [
          ...t,
          {
            role: "assistant",
            text: `Domain: ${data.target_domain}${pid != null ? ` · project #${pid}` : ""}\nMode: ${mode}\nConstraints sent to the model: ${ctx}${answer}`,
            payload: data,
          },
        ]);
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10 min-h-full bg-gradient-to-br from-neutral-50 via-white to-slate-50">
      <div className="max-w-4xl mx-auto space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <p className="text-xs font-semibold tracking-[0.3em] uppercase text-slate-400 font-third flex items-center gap-2">
            <span className="w-8 h-[2px] bg-gradient-to-r from-rose-400 to-transparent" />
            Super agent
          </p>
          <h1 className="text-3xl lg:text-4xl font-bold text-neutral-900 font-main tracking-tight">
            Chat → intent → recommendations
          </h1>
            <p className="text-sm text-slate-600 max-w-2xl font-third leading-relaxed">
            Use <strong>exact CSV column names</strong> as keys (e.g. <code>mode=road</code>, <code>region=North</code>). You
            can chain several in one line: <code>mode=road region=North country=IN</code>. The same session remembers prior
            constraints until you change them. If the domain is unclear, pick it from the dropdown or answer the clarify
            prompt.
          </p>
        </motion.div>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-bold text-slate-600 mb-2 font-third">Session</label>
              <input
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                placeholder="auto"
                className="w-full px-4 py-2.5 border-2 border-slate-200 rounded-2xl text-sm font-mono"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-bold text-slate-600 mb-2 font-third">
                Target domain (optional)
              </label>
              <select
                value={targetDomain}
                onChange={(e) => setTargetDomain(e.target.value)}
                className="w-full px-4 py-2.5 border-2 border-slate-200 rounded-2xl text-sm font-third bg-white"
              >
                <option value="">Auto</option>
                <option value="logistics_carriers">logistics_carriers</option>
                <option value="logistics_lanes">logistics_lanes</option>
                <option value="logistics_warehouses">logistics_warehouses</option>
                <option value="supply_chain_suppliers">supply_chain_suppliers</option>
                <option value="supply_chain_materials">supply_chain_materials</option>
                <option value="supply_chain_skus">supply_chain_skus</option>
              </select>
            </div>
            <div className="w-[120px]">
              <label className="block text-xs font-bold text-slate-600 mb-2 font-third">Top N</label>
              <input
                type="number"
                min={1}
                max={50}
                value={n}
                onChange={(e) => setN(e.target.value)}
                className="w-full px-4 py-2.5 border-2 border-slate-200 rounded-2xl text-sm font-third"
              />
            </div>
          </div>

          <div className="p-4 space-y-3">
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 h-[340px] overflow-y-auto space-y-2">
              {transcript.length === 0 ? (
                <p className="text-sm text-slate-500 font-third">
                  Try: <code>Recommend a carrier mode=road region=North country=IN</code>
                </p>
              ) : (
                transcript.map((m, idx) => (
                  <div key={idx} className={`text-sm ${m.role === "user" ? "text-slate-900" : "text-cyan-900"}`}>
                    <span className="font-bold font-third mr-2">{m.role === "user" ? "You" : "Agent"}</span>
                    <span className="font-third whitespace-pre-wrap break-words">{m.text}</span>
                    {m.payload?.results?.[0]?.recommendations?.length ? (
                      <ul className="mt-2 ml-6 list-disc text-slate-700">
                        {m.payload.results[0].recommendations.slice(0, 10).map((r, i) => (
                          <li key={i} className="font-third">
                            {r.title ?? r.value ?? r.item_id}
                            {r.score != null ? <span className="text-xs text-slate-500"> · {Number(r.score).toFixed(4)}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : m.payload?.status === "ok" ? (
                      <p className="mt-2 text-xs text-slate-500 font-third">
                        No recommendations returned (model may be untrained or filters too strict).
                      </p>
                    ) : null}
                    {m.payload?.question?.options?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.payload.question.options.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              if (m.payload?.question?.key === "target_domain") {
                                setTargetDomain(opt);
                                setTranscript((t) => [
                                  ...t,
                                  { role: "assistant", text: `Set target_domain=${opt}. Now ask again.` },
                                ]);
                                return;
                              }
                              // constraint suggestion
                              setMessage((prev) => {
                                const base = String(prev || "");
                                const suffix = base && !base.endsWith(" ") ? " " : "";
                                return `${base}${suffix}${opt}=`;
                              });
                              setTranscript((t) => [
                                ...t,
                                { role: "assistant", text: `Added constraint key: ${opt}. Provide a value (e.g. ${opt}=...) and send.` },
                              ]);
                            }}
                            className="px-3 py-1.5 rounded-full text-xs font-third font-bold border bg-white hover:bg-cyan-50 border-slate-200"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {m.payload ? (
                      <details className="mt-2">
                        <summary className="text-xs text-slate-500 cursor-pointer font-third">
                          Show raw response
                        </summary>
                        <pre className="mt-2 text-[11px] leading-relaxed bg-white border border-slate-200 rounded-xl p-3 overflow-x-auto text-slate-800">
                          {JSON.stringify(m.payload, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {error ? (
              <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-900 font-third">
                {error}
              </div>
            ) : null}

            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!running) send();
                  }
                }}
                placeholder="Type your request…"
                className="flex-1 px-4 py-3 border-2 border-slate-200 rounded-2xl text-sm font-third focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
              <button
                type="button"
                disabled={running}
                onClick={clearChat}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-slate-300 bg-white text-slate-700 font-third font-bold disabled:opacity-50"
              >
                Clear chat
              </button>
              <button
                type="button"
                disabled={running}
                onClick={send}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-gradient-to-r from-rose-700 to-cyan-800 text-white font-third font-bold disabled:opacity-50"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-third">
              <Sparkles className="w-4 h-4" />
              MVP: rule-based intent + key=value extraction + domain agent call.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

