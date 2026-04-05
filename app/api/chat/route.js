import { NextResponse } from "next/server";

var CALLRAIL_API_KEY = process.env.CALLRAIL_API_KEY;
var MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var APP_PASSWORD = process.env.APP_PASSWORD || "ARC2026";

var BOARDS = [
  { id: "1514008919", name: "Inpatient Leads" },
  { id: "1947645460", name: "Bayside Leads" },
  { id: "1514008920", name: "Inpatient Active Census" },
  { id: "1948020271", name: "Bayside Active Census" }
];

async function searchMonday(searchTerm) {
  var results = [];
  var safeTerm = searchTerm.replace(/"/g, '\\"');
  console.log("MONDAY: searching '" + safeTerm + "'");
  console.log("MONDAY: token present:", !!MONDAY_API_TOKEN, "length:", MONDAY_API_TOKEN ? MONDAY_API_TOKEN.length : 0);
  for (var i = 0; i < BOARDS.length; i++) {
    var board = BOARDS[i];
    var q = 'query { boards(ids: ' + board.id + ') { items_page(limit: 10, query_params: { rules: [{ column_id: "name", compare_value: "' + safeTerm + '", operator: contains_text }] }) { items { id name column_values { id text value } } } } }';
    try {
      var resp = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": MONDAY_API_TOKEN, "API-Version": "2024-10" },
        body: JSON.stringify({ query: q })
      });
      var raw = await resp.text();
      console.log("MONDAY " + board.name + " HTTP:" + resp.status + " len:" + raw.length);
      var data;
      try { data = JSON.parse(raw); } catch (e) { console.error("MONDAY parse error:", raw.substring(0, 200)); continue; }
      if (data.errors) { console.error("MONDAY errors:", JSON.stringify(data.errors).substring(0, 300)); continue; }
      if (data.error_message) { console.error("MONDAY auth:", data.error_message); continue; }
      var items = [];
      try { items = data.data.boards[0].items_page.items; } catch (e) {}
      console.log("MONDAY " + board.name + ": " + items.length + " items");
      for (var j = 0; j < items.length; j++) {
        results.push(Object.assign({}, items[j], { boardName: board.name }));
      }
    } catch (err) { console.error("MONDAY fetch err:", err.message); }
  }
  console.log("MONDAY total: " + results.length);
  return results;
}

async function getMondayFilter(boardId, statusLabel) {
  var q = 'query { boards(ids: ' + boardId + ') { items_page(limit: 25, query_params: { rules: [{ column_id: "lead_status", compare_value: "' + statusLabel + '", operator: contains_terms }] }) { items { id name column_values { id text value } } } } }';
  try {
    var resp = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": MONDAY_API_TOKEN, "API-Version": "2024-10" },
      body: JSON.stringify({ query: q })
    });
    var raw = await resp.text();
    console.log("MONDAY filter " + boardId + " HTTP:" + resp.status);
    var data;
    try { data = JSON.parse(raw); } catch (e) { return []; }
    if (data.errors || data.error_message) { console.error("MONDAY filter err:", data.error_message || JSON.stringify(data.errors).substring(0, 200)); return []; }
    var items = [];
    try { items = data.data.boards[0].items_page.items; } catch (e) {}
    console.log("MONDAY filter " + boardId + " (" + statusLabel + "): " + items.length);
    return items;
  } catch (err) { console.error("MONDAY filter err:", err.message); return []; }
}

var cachedAcct = null;

async function getCallRailAcct() {
  if (cachedAcct) return cachedAcct;
  var resp = await fetch("https://api.callrail.com/v3/a.json", {
    headers: { "Authorization": "Token token=" + CALLRAIL_API_KEY }
  });
  if (!resp.ok) { var b = await resp.text(); console.error("CR acct err:", resp.status, b.substring(0, 200)); throw new Error("CR acct " + resp.status); }
  var data = await resp.json();
  cachedAcct = data.accounts[0].id;
  console.log("CR acct:", cachedAcct);
  return cachedAcct;
}

async function searchCallRail(searchTerm) {
  try {
    var acctId = await getCallRailAcct();
    var url = "https://api.callrail.com/v3/a/" + acctId + "/calls.json?per_page=10&sort=start_time&order=desc";
    if (searchTerm && searchTerm.trim()) url += "&search=" + encodeURIComponent(searchTerm.trim());
    console.log("CR URL:", url);
    var resp = await fetch(url, { headers: { "Authorization": "Token token=" + CALLRAIL_API_KEY } });
    if (!resp.ok) { var b = await resp.text(); console.error("CR err:", resp.status, b.substring(0, 300)); return { calls: [], error: "HTTP " + resp.status }; }
    var data = await resp.json();
    console.log("CR: " + (data.calls || []).length + " calls of " + (data.total_records || 0));
    return data;
  } catch (err) { console.error("CR err:", err.message); return { calls: [], error: err.message }; }
}

function getIntent(message) {
  var msg = message.toLowerCase();
  var sp = [
    { p: /potential admission/i, s: "Potential Admission" },
    { p: /scheduled admission/i, s: "Scheduled Admission" },
    { p: /waiting medical/i, s: "Waiting Medical" },
    { p: /waiting clinical/i, s: "Waiting Clinical" },
    { p: /new lead/i, s: "New Lead" },
    { p: /bd referral/i, s: "BD Referral" },
    { p: /admitted inpatient/i, s: "Admitted Inpatient" },
    { p: /medical denied/i, s: "Medical Denied" },
    { p: /insurance denial/i, s: "Insurance Denial" },
    { p: /\bdenied\b/i, s: "Denied" },
    { p: /unqualified/i, s: "Unqualified" }
  ];
  for (var i = 0; i < sp.length; i++) { if (sp[i].p.test(message)) return { type: "filter", status: sp[i].s }; }
  if (msg.includes("active lead")) return { type: "active" };
  var nm = message.match(/(?:status of|look up|find|search for|about|info on|check on|details for|story with|what.*about|who is|tell me about|calls?\s+(?:from|for|about|with))\s+([a-zA-Z][\w\s'-]+)/i);
  if (nm) return { type: "name", term: nm[1].trim().replace(/[?.!]+$/, "") };
  var ph = message.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
  if (ph) return { type: "name", term: ph[1] };
  var no = message.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s*[?.!]*$/);
  if (no) return { type: "name", term: no[1] };
  if (msg.includes("recent call") || msg.includes("latest call") || msg.includes("last call")) return { type: "calls" };
  return { type: "name", term: message.trim() };
}

async function askClaude(userMsg, monday, callrail, history) {
  var ctx = "USER QUESTION: " + userMsg + "\n\n";
  if (monday.length > 0) {
    ctx += "--- MONDAY.COM DATA ---\n";
    for (var i = 0; i < monday.length; i++) {
      var item = monday[i];
      ctx += "Board: " + item.boardName + "\nItem: " + item.name + "\n";
      var cols = item.column_values || [];
      for (var j = 0; j < cols.length; j++) { if (cols[j].text && cols[j].text.trim()) ctx += "  " + cols[j].id + ": " + cols[j].text + "\n"; }
      ctx += "\n";
    }
  } else { ctx += "--- MONDAY.COM ---\nNo items found.\n\n"; }
  if (callrail.calls && callrail.calls.length > 0) {
    ctx += "--- CALLRAIL (" + (callrail.total_records || callrail.calls.length) + " calls) ---\n";
    for (var k = 0; k < callrail.calls.length; k++) {
      var c = callrail.calls[k];
      ctx += "- Call: " + (c.start_time || "") + "\n  Caller: " + (c.customer_name || "Unknown") + "\n  Phone: " + (c.formatted_customer_phone_number || c.customer_phone_number || "") + "\n  Direction: " + (c.direction || "") + "\n  Duration: " + (c.duration != null ? Math.floor(c.duration / 60) + "m " + (c.duration % 60) + "s" : "") + "\n  Answered: " + (c.answered ? "Yes" : "No") + "\n  Source: " + (c.source || "") + "\n";
      if (c.call_summary) ctx += "  Summary: " + c.call_summary + "\n";
      if (c.transcription) ctx += "  Transcript: " + c.transcription.substring(0, 2000) + "\n";
      if (c.sentiment) ctx += "  Sentiment: " + c.sentiment + "\n";
      if (c.tags && c.tags.length) { var tn = []; for (var t = 0; t < c.tags.length; t++) tn.push(c.tags[t].name || c.tags[t]); ctx += "  Tags: " + tn.join(", ") + "\n"; }
      if (c.note) ctx += "  Note: " + c.note + "\n";
      if (c.voicemail) ctx += "  Voicemail: Yes\n";
      ctx += "\n";
    }
  } else if (callrail.error) { ctx += "--- CALLRAIL ---\nError: " + callrail.error + "\n\n"; }
  else { ctx += "--- CALLRAIL ---\nNo calls found.\n\n"; }

  var sys = "You are a client status assistant for Addiction Rehab Centers (ARC). You receive data from monday.com and CallRail and give clear, actionable answers.\n\nBUSINESS CONTEXT:\nARC runs addiction rehab with Inpatient and Bayside locations. Each has a Leads board and Active Census board.\n\nPIPELINE FLOW:\n1. New Lead / Incoming Online Lead / BD Referral - initial contact\n2. Waiting Medical - needs medical clearance (seizures, detox, meds)\n3. Waiting Clinical - needs clinical review\n4. Potential Admission - qualified, pending final steps\n5. Scheduled Admission - date set, may need transport\n6. Admitted Inpatient - now a patient\n\nDEAD ENDS: Denied, Medical Denied, Clinician Denied, Detox Denial, Insurance Denial, Unqualified, Unable To Make Contact, Approved Not Admitted\n\nCATEGORIES: Green=easy, Yellow=concerns, Medical Yellow=seizures etc, Clinical Yellow=behavioral, Red=high risk, Black=very high risk\n\nACTIVE LEADS = anyone in New Lead, BD Referral, Incoming Online Lead, Waiting Medical, Waiting Clinical, Potential Admission, or Scheduled Admission.\n\nKEY COLUMNS: lead_status=pipeline stage, text2__1=Client Name, text1__1=Phone, status_13__1=Insurance, long_text__1=Notes, date_mkvkva1d=P/A Date, date2__1=Follow up date, people__1=Owner, dropdown_mkr5eh7a=Category\n\nRULES:\n- Lead with the most important info first\n- Flag discrepancies (P/A date passed but status unchanged, notes say call but no CallRail record)\n- Suggest next steps\n- Show all entries if client appears on multiple boards\n- Be concise. Plain text only, no markdown, no asterisks, no hash symbols.";

  var msgs = (history || []).concat([{ role: "user", content: ctx }]);
  try {
    var resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, system: sys, messages: msgs })
    });
    var data = await resp.json();
    if (data.error) { console.error("CLAUDE err:", JSON.stringify(data.error)); return "AI error: " + (data.error.message || ""); }
    var parts = [];
    for (var p = 0; p < (data.content || []).length; p++) { if (data.content[p].text) parts.push(data.content[p].text); }
    return parts.join("\n") || "No response generated.";
  } catch (err) { console.error("CLAUDE err:", err.message); return "Error. Please try again."; }
}

export async function POST(request) {
  try {
    var body = await request.json();
    if (body.action === "auth") return NextResponse.json({ authenticated: body.password === APP_PASSWORD });
    var message = body.message;
    if (!message || !message.trim()) return NextResponse.json({ error: "No message" }, { status: 400 });
    console.log("=== REQ === " + message);
    var intent = getIntent(message);
    console.log("INTENT:", JSON.stringify(intent));
    var md = [];
    var cr = { calls: [] };
    if (intent.type === "name") {
      var r = await Promise.all([searchMonday(intent.term), searchCallRail(intent.term)]);
      md = r[0]; cr = r[1];
    } else if (intent.type === "filter") {
      var f = await Promise.all([getMondayFilter("1514008919", intent.status), getMondayFilter("1947645460", intent.status)]);
      md = [];
      for (var a = 0; a < f[0].length; a++) md.push(Object.assign({}, f[0][a], { boardName: "Inpatient Leads" }));
      for (var b = 0; b < f[1].length; b++) md.push(Object.assign({}, f[1][b], { boardName: "Bayside Leads" }));
    } else if (intent.type === "active") {
      var sts = ["New Lead", "BD Referral", "Incoming Online Lead", "Waiting Medical", "Waiting Clinical", "Potential Admission", "Scheduled Admission"];
      md = [];
      for (var s = 0; s < sts.length; s++) {
        var items = await getMondayFilter("1514008919", sts[s]);
        for (var x = 0; x < items.length; x++) md.push(Object.assign({}, items[x], { boardName: "Inpatient Leads" }));
      }
    } else if (intent.type === "calls") {
      cr = await searchCallRail("");
    }
    console.log("=== RESULT === monday:" + md.length + " cr:" + (cr.calls || []).length);
    var reply = await askClaude(message, md, cr, body.history);
    return NextResponse.json({ reply: reply, meta: { mondayResults: md.length, callRailResults: (cr.calls || []).length } });
  } catch (err) { console.error("ERR:", err.message, err.stack); return NextResponse.json({ error: err.message }, { status: 500 }); }
}
