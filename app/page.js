"use client";

import React, { useState, useRef, useEffect } from "react";

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
  "Insurance Denial": { bg: "#4eccc6", text: "#000" }
};

var QUICK_ACTIONS = [
  { label: "Potential Admissions", query: "Show me all leads with Potential Admission status" },
  { label: "Scheduled Admissions", query: "Show me all Scheduled Admissions" },
  { label: "Waiting Medical", query: "Show me all leads in Waiting Medical status" },
  { label: "Recent Calls", query: "Show me the 10 most recent calls" },
  { label: "New Leads Today", query: "Show me any new leads from today" },
  { label: "BD Referrals", query: "Show me all BD Referral leads" }
];

function StatusBadge(props) {
  var c = STATUS_COLORS[props.status] || { bg: "#475569", text: "#fff" };
  return React.createElement("span", {
    style: { display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text, whiteSpace: "nowrap" }
  }, props.status);
}

function formatMsg(text) {
  var names = Object.keys(STATUS_COLORS);
  var pat = new RegExp("\\b(" + names.join("|") + ")\\b", "g");
  var parts = text.split(pat);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    if (STATUS_COLORS[parts[i]]) {
      out.push(React.createElement(StatusBadge, { key: i, status: parts[i] }));
    } else {
      out.push(React.createElement("span", { key: i }, parts[i]));
    }
  }
  return out;
}

function LoginScreen(props) {
  var pwState = useState("");
  var pw = pwState[0];
  var setPw = pwState[1];
  var errState = useState(false);
  var error = errState[0];
  var setError = errState[1];
  var ldState = useState(false);
  var ld = ldState[0];
  var setLd = ldState[1];

  var doLogin = function() {
    setLd(true);
    setError(false);
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "auth", password: pw })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.authenticated) { props.onLogin(); } else { setError(true); }
      setLd(false);
    }).catch(function() { setError(true); setLd(false); });
  };

  return React.createElement("div", { style: { height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", padding: 20 } },
    React.createElement("div", { style: { textAlign: "center", maxWidth: 360, width: "100%" } },
      React.createElement("div", { style: { width: 60, height: 60, borderRadius: 16, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700, color: "#fff", margin: "0 auto 20px" } }, "A"),
      React.createElement("div", { style: { fontSize: 22, fontWeight: 700, color: "#f1f5f9", marginBottom: 6 } }, "ARC Client Lookup"),
      React.createElement("div", { style: { fontSize: 13, color: "#64748b", marginBottom: 30 } }, "Enter your team password to continue"),
      React.createElement("input", {
        type: "password", value: pw,
        onChange: function(e) { setPw(e.target.value); },
        onKeyDown: function(e) { if (e.key === "Enter") doLogin(); },
        placeholder: "Password",
        style: { width: "100%", padding: "12px 16px", borderRadius: 12, border: error ? "1px solid #ef4444" : "1px solid #334155", background: "#1e293b", color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12, fontFamily: "inherit" }
      }),
      error ? React.createElement("div", { style: { color: "#ef4444", fontSize: 12, marginBottom: 12 } }, "Incorrect password.") : null,
      React.createElement("button", {
        onClick: doLogin, disabled: ld || !pw.trim(),
        style: { width: "100%", padding: "12px", borderRadius: 12, border: "none", background: ld || !pw.trim() ? "#334155" : "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: ld || !pw.trim() ? "not-allowed" : "pointer", fontFamily: "inherit" }
      }, ld ? "Checking..." : "Sign In")
    )
  );
}

export default function Home() {
  var authState = useState(false);
  var authed = authState[0];
  var setAuthed = authState[1];
  var msgState = useState([]);
  var messages = msgState[0];
  var setMessages = msgState[1];
  var inpState = useState("");
  var input = inpState[0];
  var setInput = inpState[1];
  var ldState = useState(false);
  var loading = ldState[0];
  var setLoading = ldState[1];
  var phState = useState("");
  var phase = phState[0];
  var setPhase = phState[1];
  var chatEndRef = useRef(null);

  useEffect(function() {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  if (!authed) return React.createElement(LoginScreen, { onLogin: function() { setAuthed(true); } });

  var sendMessage = function(text) {
    if (!text.trim() || loading) return;
    var userMsg = { role: "user", content: text.trim() };
    setMessages(function(p) { return p.concat([userMsg]); });
    setInput("");
    setLoading(true);
    setPhase("Searching monday.com & CallRail...");
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text.trim(), history: messages.slice(-10).map(function(m) { return { role: m.role, content: m.content }; }) })
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) {
        setMessages(function(p) { return p.concat([{ role: "assistant", content: "Error: " + data.error }]); });
      } else {
        var src = [];
        if (data.meta && data.meta.mondayResults > 0) src.push(data.meta.mondayResults + " monday.com");
        if (data.meta && data.meta.callRailResults > 0) src.push(data.meta.callRailResults + " CallRail");
        setMessages(function(p) { return p.concat([{ role: "assistant", content: data.reply, sources: src.length ? src.join(" + ") + " results" : null }]); });
      }
      setLoading(false);
      setPhase("");
    }).catch(function() {
      setMessages(function(p) { return p.concat([{ role: "assistant", content: "Something went wrong. Please try again." }]); });
      setLoading(false);
      setPhase("");
    });
  };

  var header = React.createElement("div", { style: { padding: "14px 20px", borderBottom: "1px solid #1e293b", background: "linear-gradient(135deg, #0f172a, #1e293b)", flexShrink: 0 } },
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
      React.createElement("div", { style: { width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#fff" } }, "A"),
      React.createElement("div", { style: { flex: 1 } },
        React.createElement("div", { style: { fontWeight: 700, fontSize: 17, color: "#f1f5f9" } }, "ARC Client Lookup"),
        React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginTop: 2 } }, "monday.com + CallRail")
      )
    ),
    React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 10 } },
      ["monday.com", "CallRail"].map(function(label) {
        return React.createElement("div", { key: label, style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#22c55e", background: "#22c55e12", padding: "3px 10px", borderRadius: 20, border: "1px solid #22c55e30" } },
          React.createElement("div", { style: { width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e60" } }),
          label
        );
      })
    )
  );

  var emptyState = messages.length === 0 ? React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 24, padding: "0 12px" } },
    React.createElement("div", { style: { textAlign: "center" } },
      React.createElement("div", { style: { fontSize: 32, marginBottom: 8 } }, "\uD83D\uDD0D"),
      React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "#f1f5f9", marginBottom: 6 } }, "Client Status Lookup"),
      React.createElement("div", { style: { fontSize: 13, color: "#94a3b8", maxWidth: 400, lineHeight: 1.6 } }, "Search any client to see pipeline status, call history, and transcripts.")
    ),
    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 500 } },
      QUICK_ACTIONS.map(function(qa) {
        return React.createElement("button", {
          key: qa.label, onClick: function() { sendMessage(qa.query); },
          style: { padding: "8px 16px", borderRadius: 20, border: "1px solid #334155", background: "#1e293b", color: "#94a3b8", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }
        }, qa.label);
      })
    )
  ) : null;

  var msgList = messages.map(function(msg, i) {
    var isUser = msg.role === "user";
    return React.createElement("div", { key: i, style: { display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" } },
      React.createElement("div", { style: { maxWidth: "85%" } },
        React.createElement("div", {
          style: {
            padding: "10px 14px", fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word",
            borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
            background: isUser ? "linear-gradient(135deg, #3b82f6, #6366f1)" : "#1e293b",
            color: isUser ? "#fff" : "#e2e8f0",
            border: isUser ? "none" : "1px solid #334155"
          }
        }, isUser ? msg.content : formatMsg(msg.content)),
        msg.sources ? React.createElement("div", { style: { fontSize: 10, marginTop: 4, paddingLeft: 4, color: "#64748b" } }, "\uD83D\uDCCA " + msg.sources) : null
      )
    );
  });

  var loadingEl = loading ? React.createElement("div", { style: { display: "flex", justifyContent: "flex-start" } },
    React.createElement("div", { style: { padding: "10px 14px", borderRadius: "16px 16px 16px 4px", background: "#1e293b", border: "1px solid #334155" } },
      React.createElement("div", { style: { display: "flex", gap: 4, alignItems: "center", padding: "4px 0" } },
        [0, 1, 2].map(function(i) { return React.createElement("div", { key: i, style: { width: 7, height: 7, borderRadius: "50%", background: "#64748b", animation: "pulse-dot 1.2s ease-in-out " + (i * 0.2) + "s infinite" } }); })
      ),
      React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginTop: 4 } }, phase)
    )
  ) : null;

  var inputBar = React.createElement("div", { style: { padding: "12px 16px 16px", borderTop: "1px solid #1e293b", background: "#0f172a", flexShrink: 0 } },
    React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "flex-end", background: "#1e293b", borderRadius: 14, padding: "6px 6px 6px 14px", border: "1px solid #334155" } },
      React.createElement("input", {
        value: input,
        onChange: function(e) { setInput(e.target.value); },
        onKeyDown: function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } },
        placeholder: "What's the status of John Smith?",
        disabled: loading,
        style: { flex: 1, background: "transparent", border: "none", outline: "none", color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", padding: "6px 0" }
      }),
      React.createElement("button", {
        onClick: function() { sendMessage(input); },
        disabled: loading || !input.trim(),
        style: { width: 36, height: 36, borderRadius: 10, border: "none", background: loading || !input.trim() ? "#334155" : "linear-gradient(135deg, #3b82f6, #6366f1)", color: "#fff", fontSize: 16, cursor: loading || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }
      }, "\u2191")
    ),
    React.createElement("div", { style: { textAlign: "center", fontSize: 10, color: "#475569", marginTop: 8 } }, "monday.com + CallRail")
  );

  return React.createElement("div", { style: { fontFamily: "'DM Sans', sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#0f172a", color: "#e2e8f0" } },
    header,
    React.createElement("div", { style: { flex: 1, overflowY: "auto", padding: "16px 16px 8px", display: "flex", flexDirection: "column", gap: 12 } },
      emptyState, msgList, loadingEl,
      React.createElement("div", { ref: chatEndRef })
    ),
    inputBar
  );
}
