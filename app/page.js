"use client";
import { useState, useRef, useEffect } from "react";
 
var STATUS_COLORS = {
  "New Lead": { bg: "#fdab3d", text: "#000" },
  "Scheduled Admission": { bg: "#037f4c", text: "#fff" },
  "Potential Admission": { bg: "#ff6d3b", text: "#fff" },
  "Waiting Medical": { bg: "#ff5ac4", text: "#fff" },
  "Waiting Clinical": { bg: "#a1e3f6", text: "#000" },
  "Admitted Inpatient": { bg: "#9cd326", text: "#000" },
  "Denied": { bg: "#bb3354", text: "#fff" },
  "Medical Denied": { bg: "#579bfc", text: "#fff" },
  "Unqualified": { bg: "#563e3e", text: "#fff" },
  "BD Referral": { bg: "#ff007f", text: "#fff" },
  "Incoming Online Lead": { bg: "#007eb5", text: "#fff" },
  "Insurance Denial": { bg: "#4eccc6", text: "#000" },
};
 
var QUICK_ACTIONS = [
  { label: "Potential Admissions", query: "Show me all leads with Potential Admission status" },
  { label: "Scheduled Admissions", query: "Show me all Scheduled Admissions" },
  { label: "Waiting Medical", query: "Show me all leads in Waiting Medical status" },
  { label: "Recent Calls", query: "Show me the 10 most recent calls from CallRail with summaries" },
  { label: "New Leads Today", query: "Show me any new leads from today" },
  { label: "BD Referrals", query: "Show me all BD Referral leads" },
];
 
function StatusBadge(props) {
  var c = STATUS_COLORS[props.status] || { bg: "#475569", text: "#fff" };
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text, whiteSpace: "nowrap" }}>
      {props.status}
    </span>
  );
}
 
function formatMessage(text) {
  var names = Object.keys(STATUS_COLORS);
  var pat = new RegExp("\\b(" + names.join("|") + ")\\b", "g");
  var parts = text.split(pat);
  return parts.map(function(part, i) {
    return STATUS_COLORS[part] ? <StatusBadge key={i} status={part} /> : <span key={i}>{part}</span>;
  });
}
 
function LoginScreen(props) {
  var [pw, setPw] = useState("");
  var [error, setError] = useState(false);
  var [loading, setLoading] = useState(false);
 
  var handleLogin = async function() {
    setLoading(true);
    setError(false);
    try {
      var resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auth", password: pw }),
      });
      var data = await resp.json();
      if (data.authenticated) {
        props.onLogin();
      } else {
        setError(true);
      }
    } catch (err) {
      setError(true);
    }
    setLoading(false);
  };
 
  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", padding: 20 }}>
      <div style={{ textAlign: "center", maxWidth: 360, width: "100%" }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700, color: "#fff", margin: "0 auto 20px" }}>A</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", marginBottom: 6 }}>ARC Client Lookup</div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 30 }}>Enter your team password to continue</div>
        <input
          type="password"
          value={pw}
          onChange={function(e) { setPw(e.target.value); }}
          onKeyDown={function(e) { if (e.key === "Enter") handleLogin(); }}
          placeholder="Password"
          style={{
            width: "100%", padding: "12px 16px", borderRadius: 12, border: error ? "1px solid #ef4444" : "1px solid #334155",
            background: "#1e293b", color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12,
            fontFamily: "inherit",
          }}
        />
        {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>Incorrect password. Try again.</div>}
        <button
          onClick={handleLogin}
          disabled={loading || !pw.trim()}
          style={{
            width: "100%", padding: "12px", borderRadius: 12, border: "none",
            background: loading || !pw.trim() ? "#334155" : "linear-gradient(135deg, #3b82f6, #6366f1)",
            color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading || !pw.trim() ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {loading ? "Checking..." : "Sign In"}
        </button>
      </div>
    </div>
  );
}
 
export default function Home() {
  var [authed, setAuthed] = useState(false);
  var [messages, setMessages] = useState([]);
  var [input, setInput] = useState("");
  var [loading, setLoading] = useState(false);
  var [loadingPhase, setLoadingPhase] = useState("");
  var chatEndRef = useRef(null);
 
  useEffect(function() {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);
 
  if (!authed) return <LoginScreen onLogin={function() { setAuthed(true); }} />;
 
  var sendMessage = async function(text) {
    if (!text.trim() || loading) return;
    var userMsg = { role: "user", content: text.trim() };
    setMessages(function(prev) { return prev.concat([userMsg]); });
    setInput("");
    setLoading(true);
    setLoadingPhase("Searching monday.com & CallRail...");
    try {
      var resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          history: messages.slice(-10).map(function(m) { return { role: m.role, content: m.content }; }),
        }),
      });
      setLoadingPhase("Processing results...");
      var data = await resp.json();
      if (data.error) {
        setMessages(function(prev) { return prev.concat([{ role: "assistant", content: "Error: " + data.error }]); });
      } else {
        var meta = data.meta;
        var sources = [];
        if (meta && meta.mondayResults > 0) sources.push(meta.mondayResults + " monday.com");
        if (meta && meta.callRailResults > 0) sources.push(meta.callRailResults + " CallRail");
        setMessages(function(prev) { return prev.concat([{ role: "assistant", content: data.reply, sources: sources.length ? sources.join(" + ") + " results" : null }]); });
      }
    } catch (err) {
      setMessages(function(prev) { return prev.concat([{ role: "assistant", content: "Something went wrong. Please try again." }]); });
    }
    setLoading(false);
    setLoadingPhase("");
  };
 
  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#0f172a", color: "#e2e8f0" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e293b", background: "linear-gradient(135deg, #0f172a, #1e293b)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#fff" }}>A</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: "#f1f5f9" }}>ARC Client Lookup</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>monday.com + CallRail w/ Transcripts</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          {["monday.com", "CallRail"].map(function(label) {
            return (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#22c55e", background: "#22c55e12", padding: "3px 10px", borderRadius: 20, border: "1px solid #22c55e30" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e60" }} />
                {label}
              </div>
            );
          })}
        </div>
      </div>
 
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 24, padding: "0 12px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", marginBottom: 6 }}>Client Status Lookup</div>
              <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 400, lineHeight: 1.6 }}>
                Search any client to see pipeline status, call history, transcripts, and summaries.
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 500 }}>
              {QUICK_ACTIONS.map(function(qa) {
                return (
                  <button key={qa.label} onClick={function() { sendMessage(qa.query); }}
                    style={{ padding: "8px 16px", borderRadius: 20, border: "1px solid #334155", background: "#1e293b", color: "#94a3b8", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}
                    onMouseOver={function(e) { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.color = "#e2e8f0"; }}
                    onMouseOut={function(e) { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#94a3b8"; }}
                  >{qa.label}</button>
                );
              })}
            </div>
          </div>
        )}
 
        {messages.map(function(msg, i) {
          return (
            <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "85%" }}>
                <div style={{
                  padding: "10px 14px", fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  background: msg.role === "user" ? "linear-gradient(135deg, #3b82f6, #6366f1)" : "#1e293b",
                  color: msg.role === "user" ? "#fff" : "#e2e8f0",
                  border: msg.role === "user" ? "none" : "1px solid #334155",
                }}>
                  {msg.role === "assistant" ? formatMessage(msg.content) : msg.content}
                </div>
                {msg.sources && <div style={{ fontSize: 10, marginTop: 4, paddingLeft: 4, color: "#64748b" }}>📊 {msg.sources}</div>}
              </div>
            </div>
          );
        })}
 
        {loading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ padding: "10px 14px", borderRadius: "16px 16px 16px 4px", background: "#1e293b", border: "1px solid #334155" }}>
              <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "4px 0" }}>
                {[0, 1, 2].map(function(i) { return <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#64748b", animation: "pulse-dot 1.2s ease-in-out " + (i * 0.2) + "s infinite" }} />; })}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{loadingPhase}</div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
 
      <div style={{ padding: "12px 16px 16px", borderTop: "1px solid #1e293b", background: "#0f172a", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", background: "#1e293b", borderRadius: 14, padding: "6px 6px 6px 14px", border: "1px solid #334155" }}>
          <input value={input}
            onChange={function(e) { setInput(e.target.value); }}
            onKeyDown={function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder="What's the status of John Smith?"
            disabled={loading}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", padding: "6px 0" }}
          />
          <button onClick={function() { sendMessage(input); }} disabled={loading || !input.trim()}
            style={{
              width: 36, height: 36, borderRadius: 10, border: "none",
              background: loading || !input.trim() ? "#334155" : "linear-gradient(135deg, #3b82f6, #6366f1)",
              color: "#fff", fontSize: 16, cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >↑</button>
        </div>
        <div style={{ textAlign: "center", fontSize: 10, color: "#475569", marginTop: 8 }}>monday.com + CallRail with transcripts & summaries</div>
      </div>
    </div>
  );
}
 
