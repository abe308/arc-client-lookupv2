import { NextResponse } from "next/server";
 
var CALLRAIL_API_KEY = process.env.CALLRAIL_API_KEY;
var MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var APP_PASSWORD = process.env.APP_PASSWORD || "ARC2026";
 
var BOARDS = [
  { id: "1514008919", name: "Inpatient Leads" },
  { id: "1947645460", name: "Bayside Leads" },
  { id: "1514008920", name: "Inpatient Active Census" },
  { id: "1948020271", name: "Bayside Active Census" },
];
 
async function searchMonday(searchTerm) {
  var results = [];
  var safeTerm = searchTerm.replace(/"/g, '\\"');
  console.log("MONDAY: searching for '" + safeTerm + "' across " + BOARDS.length + " boards");
  console.log("MONDAY: token starts with", MONDAY_API_TOKEN ? MONDAY_API_TOKEN.substring(0, 20) + "..." : "MISSING");
 
  for (var i = 0; i < BOARDS.length; i++) {
    var board = BOARDS[i];
    var query = 'query { boards(ids: ' + board.id + ') { items_page(limit: 10, query_params: { rules: [{ column_id: "name", compare_value: "' + safeTerm + '", operator: contains_text }] }) { items { id name column_values { id text value } } } } }';
    try {
      var resp = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": MONDAY_API_TOKEN,
          "API-Version": "2024-10"
        },
        body: JSON.stringify({ query: query }),
      });
      var rawText = await resp.text();
      console.log("MONDAY " + board.name + " status:", resp.status, "response length:", rawText.length);
 
      var data;
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        console.error("MONDAY " + board.name + " JSON parse error:", rawText.substring(0, 200));
        continue;
      }
 
      if (data.errors) {
        console.error("MONDAY " + board.name + " API errors:", JSON.stringify(data.errors).substring(0, 300));
        continue;
      }
      if (data.error_message) {
        console.error("MONDAY " + board.name + " auth error:", data.error_message, data.error_code);
        continue;
      }
 
      var items = [];
      try {
        items = data.data.boards[0].items_page.items;
      } catch (e) {
        console.log("MONDAY " + board.name + ": no items path in response");
      }
 
      console.log("MONDAY " + board.name + ": found " + items.length + " items");
      for (var j = 0; j < items.length; j++) {
        results.push(Object.assign({}, items[j], { boardName: board.name, boardId: board.id }));
      }
    } catch (err) {
      console.error("MONDAY " + board.name + " fetch error:", err.message);
    }
  }
  console.log("MONDAY: total results:", results.length);
  return results;
}
 
async function getMondayItemsByFilter(boardId, statusLabel) {
  var query = 'query { boards(ids: ' + boardId + ') { items_page(limit: 25, query_params: { rules: [{ column_id: "lead_status", compare_value: "' + statusLabel + '", operator: contains_terms }] }) { items { id name column_values { id text value } } } } }';
  try {
    var resp = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": MONDAY_API_TOKEN,
        "API-Version": "2024-10"
      },
      body: JSON.stringify({ query: query }),
    });
    var rawText = await resp.text();
    console.log("MONDAY filter " + boardId + " status:", resp.status);
    var data;
    try { data = JSON.parse(rawText); } catch (e) { console.error("MONDAY filter parse error"); return []; }
    if (data.errors) { console.error("MONDAY filter errors:", JSON.stringify(data.errors).substring(0, 200)); return []; }
    if (data.error_message) { console.error("MONDAY filter auth error:", data.error_message); return []; }
    var items = [];
    try { items = data.data.boards[0].items_page.items; } catch (e) { }
    console.log("MONDAY filter " + boardId + " (" + statusLabel + "): " + items.length + " items");
    return items;
  } catch (err) {
    console.error("MONDAY filter error:", err.message);
    return [];
  }
}
 
var cachedAccountId = null;
 
async function getCallRailAccountId() {
  if (cachedAccountId) return cachedAccountId;
  console.log("CALLRAIL: fetching account ID, key starts with:", CALLRAIL_API_KEY ? CALLRAIL_API_KEY.substring(0, 10) + "..." : "MISSING");
  var resp = await fetch("https://api.callrail.com/v3/a.json", {
    headers: { "Authorization": "Token token=" + CALLRAIL_API_KEY },
  });
  if (!resp.ok) {
    var body = await resp.text();
    console.error("CALLRAIL account error:", resp.status, body.substring(0, 200));
    throw new Error("CallRail account error " + resp.status);
  }
  var data = await resp.json();
  cachedAccountId = data.accounts && data.accounts[0] && data.accounts[0].id;
  console.log("CALLRAIL account ID:", cachedAccountId);
  return cachedAccountId;
}
 
async function searchCallRail(searchTerm) {
  try {
    var accountId = await getCallRailAccountId();
    var url = "https://api.callrail.com/v3/a/" + accountId + "/calls.json?per_page=10&sort=start_time&order=desc";
    if (searchTerm && searchTerm.trim()) {
      url += "&search=" + encodeURIComponent(searchTerm.trim());
    }
    console.log("CALLRAIL URL:", url);
    var resp = await fetch(url, {
      headers: { "Authorization": "Token token=" + CALLRAIL_API_KEY },
    });
    if (!resp.ok) {
      var body = await resp.text();
      console.error("CALLRAIL calls error:", resp.status, body.substring(0, 300));
      return { calls: [], error: "HTTP " + resp.status };
    }
    var data = await resp.json();
    console.log("CALLRAIL returned " + (data.calls || []).length + " calls out of " + (data.total_records || 0));
    if (data.calls && data.calls.length > 0) {
      var first = data.calls[0];
      console.log("CALLRAIL first call:", first.customer_name, first.start_time, first.direction, "duration:" + first.duration);
    }
    return data;
  } catch (err) {
    console.error("CALLRAIL error:", err.message);
    return { calls: [], error: err.message };
  }
}
 
function extractSearchInfo(message) {
  var msg = message.toLowerCase();
  var statusPatterns = [
    { pattern: /potential admission/i, status: "Potential Admission" },
    { pattern: /scheduled admission/i, status: "Scheduled Admission" },
    { pattern: /waiting medical/i, status: "Waiting Medical" },
    { pattern: /waiting clinical/i, status: "Waiting Clinical" },
    { pattern: /new lead/i, status: "New Lead" },
    { pattern: /bd referral/i, status: "BD Referral" },
    { pattern: /admitted inpatient/i, status: "Admitted Inpatient" },
    { pattern: /denied/i, status: "Denied" },
    { pattern: /unqualified/i, status: "Unqualified" },
  ];
  for (var i = 0; i < statusPatterns.length; i++) {
    if (statusPatterns[i].pattern.test(message)) return { type: "status_filter", status: statusPatterns[i].status };
  }
  var nameMatch = message.match(/(?:status of|look up|find|search for|about|info on|check on|details for|story with|what.*about|calls?\s+(?:from|for|about|with))\s+([a-zA-Z][\w\s'-]+)/i);
  if (nameMatch) return { type: "name_search", term: nameMatch[1].trim().replace(/[?.!]+$/, "") };
  var phoneMatch = message.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
  if (phoneMatch) return { type: "name_search", term: phoneMatch[1] };
  var nameOnly = message.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s*[?.!]*$/);
  if (nameOnly) return { type: "name_search", term: nameOnly[1] };
  if (msg.includes("recent call") || msg.includes("latest call") || msg.includes("last call") || msg.includes("calls from callrail")) {
    return { type: "recent_calls" };
  }
  return { type: "name_search", term: message.trim() };
}
 
async function synthesizeWithClaude(userMessage, mondayData, callRailData, conversationHistory) {
  var context = "USER QUESTION: " + userMessage + "\n\n";
 
  if (mondayData && mondayData.length > 0) {
    context += "--- MONDAY.COM DATA ---\n";
    for (var i = 0; i < mondayData.length; i++) {
      var item = mondayData[i];
      context += "Board: " + item.boardName + "\nItem: " + item.name + "\n";
      var cols = item.column_values || [];
      for (var j = 0; j < cols.length; j++) {
        if (cols[j].text && cols[j].text.trim()) context += "  " + cols[j].id + ": " + cols[j].text + "\n";
      }
      context += "\n";
    }
  } else {
    context += "--- MONDAY.COM DATA ---\nNo matching items found.\n\n";
  }
 
  if (callRailData && callRailData.calls && callRailData.calls.length > 0) {
    context += "--- CALLRAIL DATA (" + (callRailData.total_records || callRailData.calls.length) + " total calls) ---\n";
    for (var k = 0; k < callRailData.calls.length; k++) {
      var call = callRailData.calls[k];
      context += "- Call:\n";
      context += "  Date: " + (call.start_time || "N/A") + "\n";
      context += "  Caller: " + (call.customer_name || "Unknown") + "\n";
      context += "  Phone: " + (call.formatted_customer_phone_number || call.customer_phone_number || "N/A") + "\n";
      context += "  Direction: " + (call.direction || "N/A") + "\n";
      context += "  Duration: " + (call.duration != null ? Math.floor(call.duration / 60) + "m " + (call.duration % 60) + "s" : "N/A") + "\n";
      context += "  Answered: " + (call.answered ? "Yes" : "No") + "\n";
      context += "  Source: " + (call.source || "N/A") + "\n";
      context += "  Tracking Number: " + (call.formatted_tracking_phone_number || "N/A") + "\n";
      if (call.call_summary) context += "  Call Summary: " + call.call_summary + "\n";
      if (call.transcription) context += "  Transcript: " + call.transcription.substring(0, 1500) + "\n";
      if (call.sentiment) context += "  Sentiment: " + call.sentiment + "\n";
      if (call.tags && call.tags.length > 0) {
        var tagNames = [];
        for (var t = 0; t < call.tags.length; t++) tagNames.push(call.tags[t].name || call.tags[t]);
        context += "  Tags: " + tagNames.join(", ") + "\n";
      }
      if (call.note) context += "  Note: " + call.note + "\n";
      if (call.voicemail) context += "  Voicemail: Yes\n";
      context += "\n";
    }
  } else if (callRailData && callRailData.error) {
    context += "--- CALLRAIL DATA ---\nError: " + callRailData.error + "\n\n";
  } else {
    context += "--- CALLRAIL DATA ---\nNo matching calls found.\n\n";
  }
 
  var systemPrompt = "You are a client status assistant for Addiction Rehab Centers. You receive data from monday.com (CRM pipeline) and CallRail (call tracking with transcripts and summaries) and synthesize it into clear, actionable answers. Lead with the most important status info. Highlight discrepancies between monday.com and call data. Include call summaries and transcript excerpts when available. Note follow-up actions needed. Cross-reference dates and notes. Be concise and professional. Use plain text only, no markdown, no asterisks, no hash symbols. Use line breaks and dashes for structure.";
 
  var messages = (conversationHistory || []).concat([{ role: "user", content: context }]);
 
  try {
    var resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1024, system: systemPrompt, messages: messages }),
    });
    var data = await resp.json();
    if (data.error) {
      console.error("CLAUDE error:", JSON.stringify(data.error));
      return "AI error: " + (data.error.message || JSON.stringify(data.error));
    }
    var parts = [];
    for (var p = 0; p < (data.content || []).length; p++) {
      if (data.content[p].text) parts.push(data.content[p].text);
    }
    return parts.join("\n") || "Could not generate a response.";
  } catch (err) {
    console.error("CLAUDE error:", err.message);
    return "Error generating response. Please try again.";
  }
}
 
export async function POST(request) {
  try {
    var body = await request.json();
 
    if (body.action === "auth") {
      return NextResponse.json({ authenticated: body.password === APP_PASSWORD });
    }
 
    var message = body.message;
    var history = body.history;
    if (!message || !message.trim()) return NextResponse.json({ error: "No message" }, { status: 400 });
 
    console.log("=== NEW REQUEST ===", message);
    var intent = extractSearchInfo(message);
    console.log("Intent:", JSON.stringify(intent));
 
    var mondayData = [];
    var callRailData = { calls: [] };
 
    if (intent.type === "name_search") {
      var results = await Promise.all([searchMonday(intent.term), searchCallRail(intent.term)]);
      mondayData = results[0];
      callRailData = results[1];
    } else if (intent.type === "status_filter") {
      var filtered = await Promise.all([
        getMondayItemsByFilter("1514008919", intent.status),
        getMondayItemsByFilter("1947645460", intent.status),
      ]);
      mondayData = [];
      for (var a = 0; a < filtered[0].length; a++) mondayData.push(Object.assign({}, filtered[0][a], { boardName: "Inpatient Leads" }));
      for (var b = 0; b < filtered[1].length; b++) mondayData.push(Object.assign({}, filtered[1][b], { boardName: "Bayside Leads" }));
    } else if (intent.type === "recent_calls") {
      callRailData = await searchCallRail("");
    }
 
    console.log("=== RESULTS === monday:" + mondayData.length + " callrail:" + (callRailData.calls || []).length);
 
    var reply = await synthesizeWithClaude(message, mondayData, callRailData, history);
    return NextResponse.json({ reply: reply, meta: { mondayResults: mondayData.length, callRailResults: (callRailData.calls || []).length } });
  } catch (err) {
    console.error("API error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
 
