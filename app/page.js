"use client";
import { useState, useRef, useEffect } from "react";

const CALLRAIL_API_KEY = "3c8f93edc04a4be66e47017b1af79277";
const CALLRAIL_ACCOUNT_ID_CACHE = { id: null };

const BOARD_IDS = {
  inpatientLeads: "1514008919",
  baysideLeads: "1947645460",
  inpatientCensus: "1514008920",
  baysideCensus: "1948020271",
};

const SYSTEM_PROMPT = `You are a client status assistant for Addiction Rehab Centers. You help staff quickly look up client information from monday.com boards AND CallRail call data.

MONDAY.COM BOARDS:
- Inpatient Leads (board 1514008919): inpatient lead pipeline
- Bayside Leads (board 1947645460): Bayside lead pipeline
- Inpatient Active Census (board 1514008920): current inpatient clients
- Bayside Active Census (board 1948020271): current Bayside clients

Key status values: New Lead, BD Referral, Incoming Online Lead, Waiting Medical, Waiting Clinical, Potential Admission, Scheduled Admission, Admitted Inpatient, Denied, Medical Denied, Clinician Denied, Detox Denial, Insurance Denial, Unqualified, Response Delayed / Unqualified, Approved Not Admitted, Unable To Make Contact, Converted To Lead.

Important columns: lead_status (Status), text2__1 (Client Name), text1__1 (Client Phone), status_13__1 (Insurance Type), long_text__1 (Notes), date_mkvkva1d (P/A Date), date2__1 (Follow up date), people__1 (Owner), color_mknzpj24 (BD Rep Referral), status_11__1 (Lead Type), dropdown_mkr5eh7a (Client Category).

CALLRAIL DATA:
You will receive CallRail call history appended to the user message when available. It includes caller name, phone, duration, direction, source, answered status, tags, notes, and summaries.

HOW TO RESPOND:
- When asked about a client: Present their pipeline status from monday AND call history from CallRail together.
- When asked for lists: Query the relevant boards and present results clearly.
- When asked about calls: Show call timeline, patterns, summaries.
- Cross-reference data: If monday says "Scheduled Admission" but CallRail shows no recent contact, flag it.
- Be concise and professional. Use plain text, dashes, and line breaks for structure. No markdown formatting.`;

const STATUS_COLORS = {
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
  "Clinician Denied": { bg: "#7f5347", text: "#fff" },
  "Detox Denial": { bg: "#c4c4c4", text: "#000" },
  "Approved Not Admitted": { bg: "#e2445c", text: "#fff" },
  "Unable To Make Contact": { bg: "#808080", text: "#fff" },
  "Response Delayed": { bg: "#faa1f1", text: "#000" },
  "Converted To Lead": { bg: "#66ccff", text: "#000" },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || { bg: "#475569", text: "#fff" };
  return (
    <span style={{
      display: "inline-block", padding: "1px 8px", borderRadius: 12, fontSize: 11,
      fontWeight: 600, background: c.bg, color: c.text, whiteSpace: "nowrap", verticalAlign: "middle",
    }}>{status}</span>
  );
}

function ThinkingIndicator({ phase }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
      borderRadius: "14px 14px 14px 4px", background: "#1a1f2e", border: "1px solid #2a3040" }}>
      <div style={{ display: "flex", gap: 3 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: "50%", background: "#6b8afd",
            animation: `pulse 1.2s ease-in-out ${i * 0.15}s infinite`,
          }} />
        ))}
      </div>
      <span style={{ fontSize: 12, color: "#6b7a99" }}>{phase}</span>
      <style>{`@keyframes pulse{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1.1)}}`}</style>
    </div>
  );
}

function parseSearchIntent(message) {
  const msg = message.toLowerCase().trim();

  const statusQueries = [
    { patterns: ["potential admission", "potential"], status: "Potential Admission" },
    { patterns: ["scheduled admission", "scheduled"], status: "Scheduled Admission" },
    { patterns: ["waiting medical"], status: "Waiting Medical" },
    { patterns: ["waiting clinical"], status: "Waiting Clinical" },
    { patterns: ["new lead", "new leads"], status: "New Lead" },
    { patterns: ["bd referral"], status: "BD Referral" },
    { patterns: ["admitted", "inpatient"], status: "Admitted Inpatient" },
    { patterns: ["denied"], status: "Denied" },
    { patterns: ["unqualified"], status: "Unqualified" },
  ];
  for (const sq of statusQueries) {
    if (sq.patterns.some(p => msg.includes(p)) && (msg.includes("show") || msg.includes("list") || msg.includes("all") || msg.includes("who"))) {
      return { type: "status_list", status: sq.status };
    }
  }

  if (msg.includes("recent call") || msg.includes("latest call") || msg.includes("last call") || msg.includes("calls from callrail")) {
    return { type: "recent_calls" };
  }

  const namePatterns = [
    /(?:status of|look up|find|search for|about|info on|check on|details for|calls?\s+(?:from|for|about|with))\s+([a-zA-Z][\w\s'-]+)/i,
  ];
  for (const pat of namePatterns) {
    const m = message.match(pat);
    if (m) return { type: "name_search", term: m[1].trim().replace(/[?.!]+$/, "") };
  }

  const phoneMatch = message.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
  if (phoneMatch) return { type: "name_search", term: phoneMatch[1] };

  const nameOnly = message.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s*[?.!]*$/);
  if (nameOnly) return { type: "name_search", term: nameOnly[1] };

  return { type: "general", term: message.trim() };
}

async function getCallRailAccountId() {
  if (CALLRAIL_ACCOUNT_ID_CACHE.id) return CALLRAIL_ACCOUNT_ID_CACHE.id;
  try {
    const res = await fetch("https://api.callrail.com/v3/a.json", {
      headers: { "Authorization": `Token token="${CALLRAIL_API_KEY}"` },
    });
    const data = await res.json();
    if (data?.items?.[0]?.id) {
      CALLRAIL_ACCOUNT_ID_CACHE.id = data.items[0].id;
      return data.items[0].id;
    }
  } catch (e) {
    console.error("CallRail account fetch error:", e);
  }
  return null;
}

async function fetchCallRailCalls(searchTerm, limit = 10) {
  try {
    const accountId = await getCallRailAccountId();
    if (!accountId) return { error: "Could not connect to CallRail", calls: [] };

    const fields = "duration,voicemail,summary,tags,note,score,customer_name,customer_phone_number,formatted_customer_phone_number,source,answered,first_call,start_time,direction,call_type";
    let url = `https://api.callrail.com/v3/a/${accountId}/calls.json?per_page=${limit}&sort=start_time&order=desc&fields=${fields}`;
    if (searchTerm) url += `&search=${encodeURIComponent(searchTerm)}`;

    const res = await fetch(url, {
      headers: { "Authorization": `Token token="${CALLRAIL_API_KEY}"` },
    });
    const data = await res.json();
    return {
      calls: data?.calls || [],
      total: data?.total_records || 0,
      error: null,
    };
  } catch (e) {
    console.error("CallRail fetch error:", e);
    return { error: "CallRail API error: " + e.message, calls: [] };
  }
}

function formatCallRailContext(crData, searchTerm) {
  if (crData.error) return `\n--- CALLRAIL ---\nError: ${crData.error}\n`;
  if (!crData.calls.length) return `\n--- CALLRAIL ---\nNo calls found${searchTerm ? ` for "${searchTerm}"` : ""}.\n`;

  let ctx = `\n--- CALLRAIL DATA (${crData.total || crData.calls.length} total) ---\n`;
  for (const call of crData.calls) {
    ctx += `- ${call.start_time || "N/A"} | ${call.customer_name || "Unknown"} | ${call.formatted_customer_phone_number || call.customer_phone_number || "N/A"} | ${call.direction || "?"} | ${call.duration != null ? Math.floor(call.duration / 60) + "m " + (call.duration % 60) + "s" : "N/A"} | Answered: ${call.answered ? "Yes" : "No"} | Source: ${call.source || "N/A"}`;
    if (call.tags?.length) ctx += ` | Tags: ${call.tags.map(t => t.name || t).join(", ")}`;
    if (call.note) ctx += ` | Note: ${call.note}`;
    if (call.summary) ctx += ` | Summary: ${call.summary}`;
    if (call.voicemail) ctx += ` | Voicemail: Yes`;
    ctx += "\n";
  }
  return ctx;
}

const QUICK_ACTIONS = [
  { label: "Potential Admissions", query: "Show me all Potential Admission leads" },
  { label: "Scheduled Admissions", query: "Show me all Scheduled Admissions" },
  { label: "Waiting Medical", query: "Show me all Waiting Medical leads" },
  { label: "Recent Calls", query: "Show me the 10 most recent calls" },
  { label: "New Leads", query: "Show me all New Leads" },
  { label: "BD Referrals", query: "Show me all BD Referral leads" },
];

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState("");
  const [crStatus, setCrStatus] = useState("checking");
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    getCallRailAccountId().then(id => {
      setCrStatus(id ? "connected" : "error");
    }).catch(() => setCrStatus("error"));
  }, []);

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;
    const userText = text.trim();
    setMessages(prev => [...prev, { role: "user", content: userText }]);
    setInput("");
    setLoading(true);

    try {
      const intent = parseSearchIntent(userText);
      let callRailContext = "";

      if (intent.type === "name_search" && intent.term) {
        setPhase("Searching CallRail for " + intent.term + "...");
        const crData = await fetchCallRailCalls(intent.term);
        callRailContext = formatCallRailContext(crData, intent.term);
      } else if (intent.type === "recent_calls") {
        setPhase("Fetching recent calls...");
        const crData = await fetchCallRailCalls(null, 15);
        callRailContext = formatCallRailContext(crData, null);
      } else if (intent.type === "general") {
        setPhase("Searching CallRail...");
        const crData = await fetchCallRailCalls(intent.term);
        callRailContext = formatCallRailContext(crData, intent.term);
      }

      setPhase("Querying monday.com...");
      let enrichedContent = userText;
      if (callRailContext) enrichedContent += "\n" + callRailContext;

      const conversationHistory = messages.map(m => ({ role: m.role, content: m.content }));
      conversationHistory.push({ role: "user", content: enrichedContent });

      setPhase("Analyzing data...");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: conversationHistory,
          mcp_servers: [
            { type: "url", url: "https://mcp.monday.com/mcp", name: "monday-mcp" },
          ],
        }),
      });

      const data = await response.json();

      const textParts = data.content
        ?.filter(b => b.type === "text")
        .map(b => b.text)
        .filter(Boolean);

      const reply = textParts?.join("\n") || "I couldn't retrieve that information. Please try again.";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      console.error("Error:", err);
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong — " + err.message }]);
    } finally {
      setLoading(false);
      setPhase("");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const formatMessage = (text) => {
    const statusPattern = /\b(New Lead|Scheduled Admission|Potential Admission|Waiting Medical|Waiting Clinical|Admitted Inpatient|Denied|Medical Denied|Clinician Denied|Detox Denial|Insurance Denial|Unqualified|BD Referral|Incoming Online Lead|Response Delayed|Approved Not Admitted|Unable To Make Contact|Converted To Lead)\b/g;
    return text.split(statusPattern).map((part, i) =>
      part.match(statusPattern) ? <StatusBadge key={i} status={part} /> : <span key={i}>{part}</span>
    );
  };

  const crDotColor = crStatus === "connected" ? "#22c55e" : crStatus === "error" ? "#ef4444" : "#f59e0b";

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh", width: "100%",
      background: "#0c1019", fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif", color: "#d0d8e8",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px", borderBottom: "1px solid #1c2333",
        background: "linear-gradient(180deg, #111827 0%, #0c1019 100%)",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, #3b6cf5, #8b5cf6)", fontSize: 15, fontWeight: 700, color: "#fff",
          }}>A</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e8ecf4", letterSpacing: "-0.01em" }}>
              ARC Client Lookup
            </div>
            <div style={{ fontSize: 10, color: "#5c6b88", marginTop: 1 }}>
              monday.com + CallRail
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 10, color: "#5c6b88" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
            monday.com
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: crDotColor }} />
            CallRail
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      {messages.length === 0 && (
        <div style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 20, flexShrink: 0 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#c8d0e0", marginBottom: 4 }}>Client Status Lookup</div>
            <div style={{ fontSize: 12, color: "#5c6b88" }}>Search clients, view pipeline status, check call history</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 480 }}>
            {QUICK_ACTIONS.map((qa, i) => (
              <button key={i} onClick={() => sendMessage(qa.query)}
                style={{
                  padding: "7px 14px", borderRadius: 20, border: "1px solid #1e2a40",
                  background: "#111827", color: "#8b9bc0", fontSize: 12, cursor: "pointer",
                  transition: "all 0.15s", fontFamily: "inherit",
                }}
                onMouseEnter={e => { e.target.style.background = "#1a2540"; e.target.style.borderColor = "#2e4070"; e.target.style.color = "#a8b8e0"; }}
                onMouseLeave={e => { e.target.style.background = "#111827"; e.target.style.borderColor = "#1e2a40"; e.target.style.color = "#8b9bc0"; }}
              >{qa.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "16px 16px 8px",
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "85%", padding: "10px 14px",
              borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              background: msg.role === "user"
                ? "linear-gradient(135deg, #3b6cf5, #5b4cf5)"
                : "#1a1f2e",
              color: msg.role === "user" ? "#fff" : "#c8d4e8",
              fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word",
              border: msg.role === "user" ? "none" : "1px solid #242d40",
            }}>
              {msg.role === "assistant" ? formatMessage(msg.content) : msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <ThinkingIndicator phase={phase} />
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 16px 16px", borderTop: "1px solid #1c2333", background: "#0c1019", flexShrink: 0 }}>
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-end",
          background: "#111827", borderRadius: 14, padding: "5px 5px 5px 14px", border: "1px solid #1e2a40",
        }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Search a client name, phone, or ask a question...'
            disabled={loading}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "#c8d4e8", fontSize: 13, fontFamily: "inherit", padding: "7px 0",
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            style={{
              width: 34, height: 34, borderRadius: 10, border: "none",
              background: loading || !input.trim() ? "#1e2a40" : "linear-gradient(135deg, #3b6cf5, #5b4cf5)",
              color: "#fff", fontSize: 15, cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              transition: "all 0.15s",
            }}
          >↑</button>
        </div>
        <div style={{ textAlign: "center", fontSize: 9, color: "#3a4560", marginTop: 6 }}>
          Powered by Claude Haiku · monday.com + CallRail
        </div>
      </div>
    </div>
  );
}
