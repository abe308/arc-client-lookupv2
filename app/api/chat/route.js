import { NextResponse } from "next/server";

var CRK = process.env.CALLRAIL_API_KEY;
var MDT = process.env.MONDAY_API_TOKEN;
var ANT = process.env.ANTHROPIC_API_KEY;
var APP = process.env.APP_PASSWORD || "ARC2026";

var BRD = [
  { id: "1514008919", name: "Inpatient Leads" },
  { id: "1947645460", name: "Bayside Leads" },
  { id: "1514008920", name: "Inpatient Active Census" },
  { id: "1948020271", name: "Bayside Active Census" }
];

async function mSearch(term) {
  var r = [];
  var s = term.replace(/"/g, '\\"');
  for (var i = 0; i < BRD.length; i++) {
    var b = BRD[i];
    try {
      var res = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": MDT, "API-Version": "2024-10" },
        body: JSON.stringify({ query: 'query{boards(ids:' + b.id + '){items_page(limit:10,query_params:{rules:[{column_id:"name",compare_value:"' + s + '",operator:contains_text}]}){items{id name column_values{id text value}}}}}' })
      });
      var d = await res.json();
      var it = [];
      try { it = d.data.boards[0].items_page.items; } catch(e) {}
      for (var j = 0; j < it.length; j++) r.push(Object.assign({}, it[j], { boardName: b.name }));
    } catch(e) { console.error("M err:", e.message); }
  }
  return r;
}

async function mFilter(bid, st) {
  try {
    var res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": MDT, "API-Version": "2024-10" },
      body: JSON.stringify({ query: 'query{boards(ids:' + bid + '){items_page(limit:25,query_params:{rules:[{column_id:"lead_status",compare_value:"' + st + '",operator:contains_terms}]}){items{id name column_values{id text value}}}}}' })
    });
    var d = await res.json();
    try { return d.data.boards[0].items_page.items; } catch(e) { return []; }
  } catch(e) { return []; }
}

var caid = null;
async function crAcct() {
  if (caid) return caid;
  var r = await fetch("https://api.callrail.com/v3/a.json", { headers: { "Authorization": "Token token=" + CRK } });
  if (!r.ok) throw new Error("CR acct " + r.status);
  var d = await r.json();
  caid = d.accounts[0].id;
  return caid;
}

async function crSearch(term) {
  try {
    var a = await crAcct();
    var u = "https://api.callrail.com/v3/a/" + a + "/calls.json?per_page=10&sort=start_time&order=desc";
    if (term && term.trim()) u += "&search=" + encodeURIComponent(term.trim());
    var r = await fetch(u, { headers: { "Authorization": "Token token=" + CRK } });
    if (!r.ok) return { calls: [], error: "HTTP " + r.status };
    return await r.json();
  } catch(e) { return { calls: [], error: e.message }; }
}

function intent(msg) {
  var m = msg.toLowerCase();
  var sp = [
    [/potential admission/i, "Potential Admission"], [/scheduled admission/i, "Scheduled Admission"],
    [/waiting medical/i, "Waiting Medical"], [/waiting clinical/i, "Waiting Clinical"],
    [/new lead/i, "New Lead"], [/bd referral/i, "BD Referral"],
    [/admitted inpatient/i, "Admitted Inpatient"], [/medical denied/i, "Medical Denied"],
    [/insurance denial/i, "Insurance Denial"], [/\bdenied\b/i, "Denied"], [/unqualified/i, "Unqualified"]
  ];
  for (var i = 0; i < sp.length; i++) { if (sp[i][0].test(msg)) return { t: "f", s: sp[i][1] }; }
  if (m.includes("active lead")) return { t: "a" };
  var nm = msg.match(/(?:status of|look up|find|search for|about|info on|check on|details for|story with|what.*about|who is|tell me about|calls?\s+(?:from|for|about|with))\s+([a-zA-Z][\w\s'-]+)/i);
  if (nm) return { t: "n", v: nm[1].trim().replace(/[?.!]+$/, "") };
  var ph = msg.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
  if (ph) return { t: "n", v: ph[1] };
  var no = msg.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s*[?.!]*$/);
  if (no) return { t: "n", v: no[1] };
  if (m.includes("recent call") || m.includes("latest call") || m.includes("last call")) return { t: "c" };
  return { t: "n", v: msg.trim() };
}

async function ask(q, md, cr, h) {
  var ctx = "USER QUESTION: " + q + "\n\n";
  if (md.length > 0) {
    ctx += "--- MONDAY.COM DATA (" + md.length + " records) ---\n";
    for (var i = 0; i < md.length; i++) {
      ctx += "Board: " + md[i].boardName + " | Item: " + md[i].name + "\n";
      var c = md[i].column_values || [];
      for (var j = 0; j < c.length; j++) { if (c[j].text && c[j].text.trim()) ctx += "  " + c[j].id + ": " + c[j].text + "\n"; }
      ctx += "\n";
    }
  } else { ctx += "--- MONDAY.COM ---\nNo items found.\n\n"; }
  if (cr.calls && cr.calls.length > 0) {
    ctx += "--- CALLRAIL (" + (cr.total_records || cr.calls.length) + " calls) ---\n";
    for (var k = 0; k < cr.calls.length; k++) {
      var cl = cr.calls[k];
      ctx += "Call: " + (cl.start_time||"") + " | " + (cl.customer_name||"Unknown") + " | " + (cl.formatted_customer_phone_number||cl.customer_phone_number||"") + " | " + (cl.direction||"") + " | " + (cl.duration!=null?Math.floor(cl.duration/60)+"m "+(cl.duration%60)+"s":"") + " | Answered:" + (cl.answered?"Yes":"No") + " | Source:" + (cl.source||"") + "\n";
      if (cl.call_summary) ctx += "  Summary: " + cl.call_summary + "\n";
      if (cl.transcription) ctx += "  Transcript: " + cl.transcription.substring(0,2000) + "\n";
      if (cl.tags && cl.tags.length) ctx += "  Tags: " + cl.tags.map(function(t){return t.name||t}).join(", ") + "\n";
      if (cl.note) ctx += "  Note: " + cl.note + "\n";
    }
  } else if (cr.error) { ctx += "--- CALLRAIL ---\nError: " + cr.error + "\n\n"; }
  else { ctx += "--- CALLRAIL ---\nNo calls found.\n\n"; }

  var sys = "You are a client status assistant for Addiction Rehab Centers (ARC). You receive data from monday.com and CallRail.\n\nBUSINESS RULES:\n- Pipeline: New Lead > Waiting Medical > Waiting Clinical > Potential Admission > Scheduled Admission > Admitted Inpatient\n- Dead ends: Denied, Medical Denied, Insurance Denial, Unqualified, Unable To Make Contact\n- Categories: Green=easy, Yellow=concerns, Medical Yellow=seizures, Red=high risk, Black=very high risk\n- Active leads = anyone NOT in a dead-end status and NOT yet Admitted\n- If a client has MULTIPLE records, show ALL of them and note which is most recent\n- Key columns: lead_status=status, text2__1=Client Name, text1__1=Phone, status_13__1=Insurance, long_text__1=Notes, date_mkvkva1d=P/A Date, people__1=Owner, dropdown_mkr5eh7a=Category\n\nRULES:\n- Always show ALL matching records, highlight the most recent one\n- Flag if P/A date has passed but status unchanged\n- Cross-reference CallRail calls with monday.com notes\n- Suggest next steps\n- Plain text only, no markdown, no asterisks, no hash symbols";

  try {
    var r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANT, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, system: sys, messages: (h||[]).concat([{role:"user",content:ctx}]) })
    });
    var d = await r.json();
    if (d.error) return "Error: " + (d.error.message||"");
    var p = [];
    for (var x = 0; x < (d.content||[]).length; x++) { if (d.content[x].text) p.push(d.content[x].text); }
    return p.join("\n") || "No response.";
  } catch(e) { return "Error: " + e.message; }
}

export async function POST(req) {
  try {
    var b = await req.json();
    if (b.action === "auth") return NextResponse.json({ authenticated: b.password === APP });
    var msg = b.message;
    if (!msg || !msg.trim()) return NextResponse.json({ error: "No message" }, { status: 400 });
    var it = intent(msg);
    var md = [];
    var cr = { calls: [] };
    if (it.t === "n") {
      var rs = await Promise.all([mSearch(it.v), crSearch(it.v)]);
      md = rs[0]; cr = rs[1];
    } else if (it.t === "f") {
      var fs = await Promise.all([mFilter("1514008919", it.s), mFilter("1947645460", it.s)]);
      for (var a = 0; a < fs[0].length; a++) md.push(Object.assign({}, fs[0][a], { boardName: "Inpatient Leads" }));
      for (var bb = 0; bb < fs[1].length; bb++) md.push(Object.assign({}, fs[1][bb], { boardName: "Bayside Leads" }));
    } else if (it.t === "a") {
      var ss = ["New Lead","BD Referral","Incoming Online Lead","Waiting Medical","Waiting Clinical","Potential Admission","Scheduled Admission"];
      for (var s = 0; s < ss.length; s++) {
        var ii = await mFilter("1514008919", ss[s]);
        for (var x = 0; x < ii.length; x++) md.push(Object.assign({}, ii[x], { boardName: "Inpatient Leads" }));
      }
    } else if (it.t === "c") { cr = await crSearch(""); }
    var reply = await ask(msg, md, cr, b.history);
    return NextResponse.json({ reply: reply, meta: { mondayResults: md.length, callRailResults: (cr.calls||[]).length } });
  } catch(e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
