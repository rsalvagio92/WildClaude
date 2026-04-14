export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>WildClaude</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0f0f23;
  --bg2: #1a1a2e;
  --bg3: #16213e;
  --accent: #7c3aed;
  --accent-light: #a78bfa;
  --accent-dim: rgba(124,58,237,0.15);
  --text: #e2e8f0;
  --text-muted: #94a3b8;
  --text-dim: #64748b;
  --border: rgba(255,255,255,0.08);
  --border-accent: rgba(124,58,237,0.4);
  --green: #10b981;
  --red: #ef4444;
  --yellow: #f59e0b;
  --blue: #3b82f6;
  --glass: rgba(26,26,46,0.8);
  --radius: 12px;
  --radius-sm: 8px;
}
html, body { height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 14px; line-height: 1.5; overflow: hidden; }
a { color: var(--accent-light); text-decoration: none; }

/* Layout */
.app { display: flex; height: 100dvh; overflow: hidden; }

/* Sidebar */
.sidebar { width: 220px; min-width: 220px; background: var(--bg2); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; transition: width 0.2s, min-width 0.2s; z-index: 20; }
.sidebar.collapsed { width: 56px; min-width: 56px; }
.sidebar-header { padding: 16px 14px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.sidebar-logo { font-size: 20px; flex-shrink: 0; }
.sidebar-title { font-size: 13px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; }
.sidebar-sub { font-size: 10px; color: var(--text-dim); white-space: nowrap; overflow: hidden; }
.sidebar-toggle { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: color 0.15s, background 0.15s; margin-left: auto; flex-shrink: 0; }
.sidebar-toggle:hover { color: var(--text); background: rgba(255,255,255,0.05); }
.sidebar-nav { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px 6px; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.15s, color 0.15s; color: var(--text-muted); white-space: nowrap; overflow: hidden; border: 1px solid transparent; margin-bottom: 2px; }
.nav-item:hover { background: rgba(255,255,255,0.05); color: var(--text); }
.nav-item.active { background: var(--accent-dim); color: var(--accent-light); border-color: var(--border-accent); }
.nav-icon { font-size: 16px; flex-shrink: 0; width: 20px; text-align: center; }
.nav-label { font-size: 13px; font-weight: 500; }
.sidebar-footer { padding: 10px 12px; border-top: 1px solid var(--border); display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-dim); flex-shrink: 0; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.status-dot.connected { background: var(--green); box-shadow: 0 0 6px var(--green); }
.status-dot.disconnected { background: var(--red); }

/* Main content */
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.topbar { height: 50px; background: var(--bg2); border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 16px; gap: 12px; flex-shrink: 0; }
.topbar-title { font-size: 15px; font-weight: 700; flex: 1; }
.topbar-actions { display: flex; align-items: center; gap: 8px; }
.btn { padding: 5px 12px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid var(--border); background: rgba(255,255,255,0.04); color: var(--text-muted); transition: all 0.15s; white-space: nowrap; }
.btn:hover { background: rgba(255,255,255,0.08); color: var(--text); border-color: var(--border-accent); }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-primary:hover { background: #6d28d9; border-color: #6d28d9; color: #fff; }
.btn-danger { border-color: rgba(239,68,68,0.4); color: #f87171; }
.btn-danger:hover { background: rgba(239,68,68,0.1); }
.btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
.btn-sm { padding: 3px 8px; font-size: 11px; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.content { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 20px; }

/* Pages */
.page { display: none; }
.page.active { display: block; }

/* Cards */
.card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 14px; }
.card-glass { background: var(--glass); backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
.card-title { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
.section-heading { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }

/* Stat grid */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 16px; }
.stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; text-align: center; }
.stat-val { font-size: 22px; font-weight: 700; color: var(--text); }
.stat-label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }

/* Badges */
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.badge-purple { background: rgba(124,58,237,0.2); color: #c4b5fd; border: 1px solid rgba(124,58,237,0.3); }
.badge-blue { background: rgba(59,130,246,0.2); color: #93c5fd; border: 1px solid rgba(59,130,246,0.3); }
.badge-green { background: rgba(16,185,129,0.2); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.3); }
.badge-red { background: rgba(239,68,68,0.2); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); }
.badge-yellow { background: rgba(245,158,11,0.2); color: #fcd34d; border: 1px solid rgba(245,158,11,0.3); }
.badge-gray { background: rgba(100,116,139,0.2); color: #94a3b8; border: 1px solid rgba(100,116,139,0.3); }

/* Progress bar */
.progress-wrap { background: rgba(255,255,255,0.05); border-radius: 999px; height: 6px; overflow: hidden; margin: 4px 0; }
.progress-bar { height: 100%; border-radius: 999px; transition: width 0.4s; }
.progress-bar.purple { background: var(--accent); }
.progress-bar.green { background: var(--green); }
.progress-bar.blue { background: var(--blue); }
.progress-bar.red { background: var(--red); }
/* Chat */
.chat-layout { display: flex; flex-direction: column; height: calc(100dvh - 90px); }
.chat-messages { flex: 1; overflow-y: auto; padding: 12px 0; display: flex; flex-direction: column; gap: 8px; }
.chat-msg { display: flex; flex-direction: column; max-width: 80%; }
.chat-msg.user { align-self: flex-end; }
.chat-msg.assistant { align-self: flex-start; }
.chat-bubble { padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.6; word-break: break-word; }
.chat-msg.user .chat-bubble { background: var(--accent); color: #ede9fe; border-bottom-right-radius: 4px; }
.chat-msg.assistant .chat-bubble { background: var(--bg2); border: 1px solid var(--border); color: var(--text); border-bottom-left-radius: 4px; }
.chat-meta { font-size: 10px; color: var(--text-dim); margin-top: 3px; padding: 0 4px; }
.chat-msg.user .chat-meta { text-align: right; }
.chat-bubble code { background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.chat-bubble pre { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; overflow-x: auto; margin: 6px 0; font-size: 12px; }
.chat-bubble pre code { background: none; padding: 0; }
.chat-input-area { display: flex; gap: 8px; padding: 12px 0 0; border-top: 1px solid var(--border); }
.chat-textarea { flex: 1; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); padding: 10px 14px; font-size: 14px; resize: none; outline: none; max-height: 120px; font-family: inherit; transition: border-color 0.15s; }
.chat-textarea:focus { border-color: var(--accent); }
.chat-send-btn {
  background: var(--accent); color: #fff; border: none;
  border-radius: var(--radius); padding: 0 16px; cursor: pointer;
  font-size: 18px; transition: background 0.15s; flex-shrink: 0;
}
.chat-send-btn:hover { background: #6d28d9; }
.chat-send-btn:disabled { background: var(--bg3); color: var(--text-dim); cursor: not-allowed; }
.chat-thinking { align-self: flex-start; color: var(--text-dim); font-size: 13px; padding: 6px 0; }
.typing-dots span { animation: blink 1.4s infinite; }
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%,80%,100%{opacity:0.2} 40%{opacity:1} }
/* Memory */
.mem-search { width: 100%; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); padding: 10px 14px; font-size: 14px; outline: none; margin-bottom: 14px; transition: border-color 0.15s; }
.mem-search:focus { border-color: var(--accent); }
.mem-item { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 8px; transition: border-color 0.15s; cursor: pointer; }
.mem-item:hover { border-color: var(--border-accent); }
.mem-item-header { display: flex; align-items: flex-start; gap: 10px; }
.mem-summary { flex: 1; font-size: 13px; color: var(--text); line-height: 1.5; }
.mem-score { font-size: 20px; font-weight: 700; color: var(--accent-light); flex-shrink: 0; min-width: 32px; text-align: center; }
.mem-footer { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.mem-date { font-size: 11px; color: var(--text-dim); flex: 1; }
/* Mission */
.mission-item { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; margin-bottom: 10px; }
.mission-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.mission-title { font-size: 14px; font-weight: 600; flex: 1; }
.mission-prompt { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin-bottom: 8px; }
.mission-footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* Agents */
.agents-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.agent-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; transition: border-color 0.15s; }
.agent-card:hover { border-color: var(--border-accent); }
.agent-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.agent-name { font-size: 14px; font-weight: 700; flex: 1; }
.agent-desc { font-size: 12px; color: var(--text-muted); margin-bottom: 10px; line-height: 1.4; }
.agent-stats { display: flex; gap: 12px; font-size: 11px; color: var(--text-dim); }
.lane-header { font-size: 11px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.8px; margin: 16px 0 8px; display: flex; align-items: center; gap: 6px; }
.lane-header::after { content: ''; flex: 1; height: 1px; background: var(--border); }
/* Workflow */
.task-item { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; margin-bottom: 10px; }
.task-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 6px; }
.task-prompt { font-size: 13px; color: var(--text); flex: 1; line-height: 1.5; }
.task-cron { font-size: 11px; font-family: monospace; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; color: var(--accent-light); }
.task-meta { font-size: 11px; color: var(--text-dim); margin-bottom: 8px; }
.task-result { font-size: 11px; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 6px 8px; border-radius: 6px; margin-bottom: 8px; white-space: pre-wrap; word-break: break-word; max-height: 80px; overflow: hidden; cursor: pointer; transition: max-height 0.3s; }
.task-result.expanded { max-height: none; }
.task-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.new-task-form { background: var(--bg2); border: 1px solid var(--border-accent); border-radius: var(--radius); padding: 16px; margin-bottom: 14px; }
.form-row { display: flex; gap: 10px; margin-bottom: 10px; }
.form-input { flex: 1; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); padding: 8px 12px; font-size: 13px; outline: none; font-family: inherit; transition: border-color 0.15s; }
.form-input:focus { border-color: var(--accent); }
.form-input.mono { font-family: monospace; }
textarea.form-input { resize: vertical; min-height: 70px; }
/* Vitals */
.vitals-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
.vitals-card { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
.vitals-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.vitals-val { font-size: 24px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.vitals-sub { font-size: 11px; color: var(--text-muted); }
/* Journal */
.conv-item { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; margin-bottom: 10px; }
.conv-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.conv-model { font-size: 11px; }
.conv-turns-preview { font-size: 13px; color: var(--text-muted); line-height: 1.5; }
.conv-turns-preview b { color: var(--text); }
/* Settings */
.settings-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border); }
.settings-row:last-child { border-bottom: none; }
.settings-key { font-size: 13px; color: var(--text-muted); }
.settings-val { font-size: 13px; font-weight: 600; color: var(--text); font-family: monospace; }
/* Placeholder */
.placeholder-box { text-align: center; padding: 60px 20px; color: var(--text-dim); }
.placeholder-icon { font-size: 48px; margin-bottom: 16px; }
.placeholder-title { font-size: 18px; font-weight: 700; color: var(--text-muted); margin-bottom: 8px; }
.placeholder-desc { font-size: 14px; max-width: 380px; margin: 0 auto; line-height: 1.6; }
/* Token screen */
.token-screen { position: fixed; inset: 0; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 100; }
.token-card { background: var(--bg2); border: 1px solid var(--border-accent); border-radius: 16px; padding: 32px; width: 360px; max-width: 90vw; text-align: center; }
.token-logo { font-size: 40px; margin-bottom: 16px; }
.token-title { font-size: 20px; font-weight: 800; margin-bottom: 6px; }
.token-sub { font-size: 13px; color: var(--text-muted); margin-bottom: 24px; }
.token-input { width: 100%; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); padding: 10px 14px; font-size: 14px; outline: none; margin-bottom: 12px; transition: border-color 0.15s; text-align: center; font-family: monospace; }
.token-input:focus { border-color: var(--accent); }
.token-error { font-size: 12px; color: #f87171; margin-bottom: 10px; min-height: 18px; }

/* Modals */
.modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.6);display:none;align-items:center;justify-content:center;z-index:1000; }
.modal-overlay.open { display:flex; }
.modal-card { background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto; }
.modal-title { font-size:18px;font-weight:700;margin-bottom:16px; }
.modal-close { float:right;background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;padding:0 4px;line-height:1; }
.modal-close:hover { color:var(--text); }
.form-group { margin-bottom:12px; }
.form-label { display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px; }
/* Lane badges */
.lane-badge { font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;text-transform:uppercase; }
.lane-build { background:rgba(59,130,246,0.2);color:var(--blue); }
.lane-review { background:rgba(245,158,11,0.2);color:var(--yellow); }
.lane-domain { background:rgba(16,185,129,0.2);color:var(--green); }
.lane-coordination { background:rgba(124,58,237,0.2);color:var(--accent-light); }
.lane-life { background:rgba(236,72,153,0.2);color:#ec4899; }
/* Secrets & MCP */
.secret-dot { width:8px;height:8px;border-radius:50%;display:inline-block; }
.secret-set { background:var(--green); }
.secret-missing { background:var(--red); }
.mcp-card { padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;background:var(--bg2); }
.mcp-card-header { display:flex;justify-content:space-between;align-items:center; }
.model-select { background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);padding:2px 6px;font-size:11px;outline:none;cursor:pointer; }
.model-select:focus { border-color:var(--accent); }
.secrets-table-wrap { overflow-x:auto;-webkit-overflow-scrolling:touch; }
.secrets-table { width:100%;border-collapse:collapse;min-width:500px; }
.secrets-table th { font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap; }
.secrets-table td { padding:8px 10px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:middle; }
.secrets-table td:first-child { font-size:11px;word-break:break-all; }
.secrets-table tr:last-child td { border-bottom:none; }
@media (max-width:768px) {
  .sidebar { display:none; }
  .sidebar.mobile-open { display:flex;position:fixed;z-index:100;width:240px;height:100%;box-shadow:4px 0 20px rgba(0,0,0,0.5); }
  .main { margin-left:0; padding-bottom: env(safe-area-inset-bottom, 20px); }
  .topbar { padding:8px 12px; }
  .page { padding:10px; padding-bottom: 80px; overflow-y: auto; }
  .card { padding:12px; }
  .vitals-grid { grid-template-columns:1fr 1fr !important; }
  .agents-grid { grid-template-columns:1fr !important; }
  .secrets-table { min-width:400px; }
  .secrets-table th, .secrets-table td { padding:6px;font-size:12px; }
  .secrets-table td:first-child { max-width:120px;overflow:hidden;text-overflow:ellipsis; }
  .chat-messages { font-size:13px; }
  .chat-msg { max-width:92% !important; }
  .form-input { font-size:16px; }
  .modal-card { width:95%;max-width:95%;padding:16px; }
  .page [style*="grid-template-columns:1fr 1fr"],
  .page [style*="grid-template-columns: 1fr 1fr"] { grid-template-columns:1fr !important; }
  .chat-input-area { padding-bottom: env(safe-area-inset-bottom, 10px); }
  .fe-panels { flex-direction:column !important; height:auto !important; min-height:0 !important; }
  .fe-tree-panel { max-width:100% !important; min-width:0 !important; max-height:60vh; }
  .fe-preview-panel { min-height:300px; }
  .fe-mobile-back { display:flex !important; }
  .fe-panels.preview-active .fe-tree-panel { display:none !important; }
  .fe-panels.preview-active .fe-preview-panel { min-height:calc(100dvh - 260px); }
  .fe-panels:not(.preview-active) .fe-preview-panel { display:none !important; }
}

/* Scrollbar */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }

/* Responsive */
@media (max-width: 640px) {
  .sidebar { position: fixed; top: 0; bottom: 0; left: 0; z-index: 30; transform: translateX(-100%); transition: transform 0.25s; }
  .sidebar.mobile-open { transform: translateX(0); width: 220px; min-width: 220px; }
  .sidebar.collapsed { transform: translateX(-100%); }
  .main { width: 100%; }
  .agents-grid { grid-template-columns: 1fr 1fr; }
  .stat-grid { grid-template-columns: 1fr 1fr; }
  .vitals-grid { grid-template-columns: 1fr 1fr; }
  .topbar { padding: 0 10px; }
  .content { padding: 12px; }
  .chat-layout { height: calc(100dvh - 94px); }
}
@media (min-width: 641px) {
  #mobile-menu-btn { display: none; }
  .sidebar-overlay { display: none; }
}
.sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 25; display: none; }
.sidebar-overlay.show { display: block; }

/* Pulse animation for running */
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
.pulse { animation: pulse 2s infinite; }

/* Spinner */
@keyframes spin { to{transform:rotate(360deg)} }
.spin { animation: spin 0.8s linear infinite; }
.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.1); border-top-color: var(--accent-light); border-radius: 50%; }

/* Toast */
.toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 200; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.toast { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 14px; font-size: 13px; color: var(--text); max-width: 300px; opacity: 0; transform: translateY(10px); transition: all 0.25s; pointer-events: auto; }
.toast.show { opacity: 1; transform: translateY(0); }
.toast.success { border-color: rgba(16,185,129,0.4); color: #6ee7b7; }
.toast.error { border-color: rgba(239,68,68,0.4); color: #fca5a5; }

/* Header SSE indicator */
.sse-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); flex-shrink: 0; transition: background 0.3s; }
.sse-dot.connected { background: var(--green); box-shadow: 0 0 6px var(--green); animation: pulse 3s infinite; }
</style>
</head>
<body>

<!-- Token screen -->
<div id="token-screen" class="token-screen">
  <div class="token-card">
    <div class="token-logo">&#x1F916;</div>
    <div class="token-title">WildClaude</div>
    <div class="token-sub">Enter your dashboard token to continue</div>
    <input id="token-input" class="token-input" type="password" placeholder="dashboard token" autocomplete="off" />
    <div id="token-error" class="token-error"></div>
    <button class="btn btn-primary" style="width:100%;padding:10px" onclick="submitToken()">Connect</button>
  </div>
</div>

<!-- Main app (hidden until authenticated) -->
<div id="app" class="app" style="display:none">

  <!-- Sidebar overlay for mobile -->
  <div class="sidebar-overlay" id="sidebar-overlay" onclick="closeSidebar()"></div>

  <!-- Sidebar -->
  <nav class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-logo">&#x1F916;</span>
      <div style="flex:1;overflow:hidden">
        <div class="sidebar-title" id="sidebar-bot-name">WildClaude</div>
        <div class="sidebar-sub" id="sidebar-bot-tagline">Personal AI OS</div>
      </div>
      <button class="sidebar-toggle" onclick="toggleSidebar()" title="Collapse sidebar">&#9776;</button>
    </div>
    <div class="sidebar-nav" id="sidebar-nav">
      <div class="nav-item active" data-page="command" onclick="navigate('command')">
        <span class="nav-icon">&#128172;</span><span class="nav-label">Command Center</span>
      </div>
      <div class="nav-item" data-page="memory" onclick="navigate('memory')">
        <span class="nav-icon">&#129504;</span><span class="nav-label">Memory Palace</span>
      </div>
      <div class="nav-item" data-page="mission" onclick="navigate('mission')">
        <span class="nav-icon">&#127919;</span><span class="nav-label">Mission Control</span>
      </div>
      <div class="nav-item" data-page="agents" onclick="navigate('agents')">
        <span class="nav-icon">&#129302;</span><span class="nav-label">Agent Hub</span>
      </div>
      <div class="nav-item" data-page="workflow" onclick="navigate('workflow')">
        <span class="nav-icon">&#9200;</span><span class="nav-label">Automation</span>
      </div>
      <div class="nav-item" data-page="plugins" onclick="navigate('plugins')">
        <span class="nav-icon">&#129520;</span><span class="nav-label">Skills &amp; MCP</span>
      </div>
      <div class="nav-item" data-page="vitals" onclick="navigate('vitals')">
        <span class="nav-icon">&#128200;</span><span class="nav-label">System Vitals</span>
      </div>
      <div class="nav-item" data-page="journal" onclick="navigate('journal')">
        <span class="nav-icon">&#128213;</span><span class="nav-label">Daily Journal</span>
      </div>
      <div class="nav-item" data-page="dashboards" onclick="navigate('dashboards')">
        <span class="nav-icon">&#128202;</span>
        <span class="nav-label">Dashboards</span>
      </div>
      <div class="nav-item" data-page="files" onclick="navigate('files')">
        <span class="nav-icon">&#128193;</span>
        <span class="nav-label">File Explorer</span>
      </div>
      <div class="nav-item" data-page="activity" onclick="navigate('activity')">
        <span class="nav-icon">&#128308;</span>
        <span class="nav-label">Live Activity</span>
      </div>
      <div class="nav-item" data-page="settings" onclick="navigate('settings')">
        <span class="nav-icon">&#9881;</span><span class="nav-label">Settings</span>
      </div>
    </div>
    <div class="sidebar-footer">
      <div class="status-dot disconnected" id="sse-status-dot"></div>
      <span id="sse-status-text" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Connecting...</span>
    </div>
  </nav>

  <!-- Main -->
  <div class="main">
    <div class="topbar">
      <button id="mobile-menu-btn" class="btn btn-sm" onclick="openSidebar()">&#9776;</button>
      <span class="topbar-title" id="page-title">Command Center</span>
      <div class="topbar-actions">
        <div class="sse-dot" id="sse-dot" title="SSE connection"></div>
        <button class="btn btn-sm" onclick="refreshCurrentPage()" title="Refresh">&#8635;</button>
      </div>
    </div>

    <div class="content" id="content">

      <!-- Page 1: Command Center -->
      <div class="page active" id="page-command">
        <div class="chat-layout">
          <div class="chat-messages" id="chat-messages">
            <div class="chat-thinking" id="chat-empty" style="text-align:center;padding-top:40px;color:var(--text-dim)">
              <div style="font-size:32px;margin-bottom:8px">&#128172;</div>
              <div style="font-size:14px">Send a message to WildClaude</div>
            </div>
          </div>
          <div id="chat-thinking-row" class="chat-thinking" style="display:none">
            <span class="typing-dots"><span>&#9679;</span><span>&#9679;</span><span>&#9679;</span></span>
            <span id="chat-thinking-text">&nbsp;Thinking...</span>
          </div>
          <div class="chat-input-area">
            <textarea id="chat-input" class="chat-textarea" rows="1" placeholder="Message WildClaude..." onkeydown="chatKeydown(event)"></textarea>
            <button id="chat-send" class="chat-send-btn" onclick="sendChat()">&#9654;</button>
          </div>
        </div>
      </div>

      <!-- Page 2: Memory Palace -->
      <div class="page" id="page-memory">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="section-heading" style="margin:0">&#129504; Memory Palace</div>
          <button class="btn btn-sm" onclick="exportMemories()" title="Export all memories as JSON">&#128229; Export All</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
          <input id="mem-search" class="mem-search" type="text" placeholder="Search memories..." oninput="debounceMemSearch()" style="flex:1;min-width:200px" />
          <button class="btn btn-sm" onclick="toggleMemFilters()" title="Toggle filters">&#128269; Filters</button>
          <button class="btn btn-sm" onclick="clearMemFilters()" title="Clear all filters">Clear</button>
        </div>
        <div id="mem-filters" style="display:none;background:var(--card-bg);border-radius:var(--radius);padding:12px;margin-bottom:12px;border:1px solid var(--border);gap:12px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
          <div>
            <label class="form-label">Topic</label>
            <select id="mem-filter-topic" class="form-input" style="padding:6px;font-size:12px" onchange="debounceMemSearch()">
              <option value="">All topics</option>
            </select>
          </div>
          <div>
            <label class="form-label">Importance Min</label>
            <input id="mem-filter-imp-min" type="number" min="0" max="1" step="0.1" class="form-input" placeholder="0.0" style="padding:6px;font-size:12px" onchange="debounceMemSearch()" />
          </div>
          <div>
            <label class="form-label">Importance Max</label>
            <input id="mem-filter-imp-max" type="number" min="0" max="1" step="0.1" class="form-input" placeholder="1.0" style="padding:6px;font-size:12px" onchange="debounceMemSearch()" />
          </div>
          <div>
            <label class="form-label">Date From</label>
            <input id="mem-filter-date-from" type="date" class="form-input" style="padding:6px;font-size:12px" onchange="debounceMemSearch()" />
          </div>
          <div>
            <label class="form-label">Date To</label>
            <input id="mem-filter-date-to" type="date" class="form-input" style="padding:6px;font-size:12px" onchange="debounceMemSearch()" />
          </div>
          <div style="display:flex;align-items:flex-end;gap:4px">
            <input id="mem-filter-pinned" type="checkbox" class="form-input" style="width:20px;height:20px" onchange="debounceMemSearch()" />
            <label class="form-label" style="margin:0">Pinned only</label>
          </div>
        </div>
        <div id="mem-stats-row" class="stat-grid" style="margin-bottom:16px"></div>
        <div class="section-heading" style="font-size:12px;color:var(--text-dim)">MEMORIES</div>
        <div id="mem-list"></div>
        <div id="mem-loading" class="chat-thinking" style="padding:20px 0;display:none">Loading...</div>
        <div id="mem-empty" style="display:none" class="placeholder-box">
          <div class="placeholder-icon">&#129504;</div>
          <div class="placeholder-title">No memories found</div>
          <div class="placeholder-desc">Memories are created automatically during conversations.</div>
        </div>
      </div>

      <!-- Page 3: Mission Control -->
      <div class="page" id="page-mission">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div class="section-heading" style="margin:0">&#127919; Mission Control</div>
          <button class="btn btn-primary btn-sm" onclick="toggleNewMissionForm()">+ New Mission</button>
        </div>
        <div id="mission-form" style="display:none" class="new-task-form">
          <div class="card-title" style="margin-bottom:12px">Create Mission Task</div>
          <div class="form-row">
            <input id="mission-title" class="form-input" type="text" placeholder="Title" />
          </div>
          <div class="form-row">
            <textarea id="mission-prompt" class="form-input" placeholder="Describe the task..." rows="3"></textarea>
          </div>
          <div class="form-row">
            <input id="mission-agent" class="form-input" type="text" placeholder="Assigned agent (optional, e.g. main)" />
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onclick="createMission()">Create</button>
            <button class="btn btn-sm" onclick="toggleNewMissionForm()">Cancel</button>
          </div>
        </div>
        <div class="card-title">ACTIVE &amp; QUEUED</div>
        <div id="mission-list"></div>
        <div id="mission-loading" class="chat-thinking" style="padding:20px 0;display:none">Loading...</div>
        <div id="mission-empty" style="display:none" class="placeholder-box">
          <div class="placeholder-icon">&#127919;</div>
          <div class="placeholder-title">No active missions</div>
          <div class="placeholder-desc">Create a mission to assign tasks to your agents.</div>
        </div>
      </div>

      <!-- Page 4: Agent Hub -->
      <div class="page" id="page-agents">
        <div class="section-heading">&#129302; Agent Hub</div>
        <div id="agents-container"></div>
        <div id="agents-loading" class="chat-thinking" style="padding:20px 0;display:none">Loading...</div>
        <div id="agents-empty" style="display:none" class="placeholder-box">
          <div class="placeholder-icon">&#129302;</div>
          <div class="placeholder-title">No agents found</div>
        </div>
      </div>

      <!-- Page 5: Automation -->
      <div class="page" id="page-workflow">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div class="section-heading" style="margin:0">&#9200; Automation</div>
          <button class="btn btn-primary btn-sm" onclick="showNewAutomationModal()">+ New Automation</button>
        </div>
        <div id="automations-list"><div class="chat-thinking" style="padding:12px 0">Loading automations...</div></div>

        <!-- Ad-hoc Scheduled Tasks -->
        <div style="margin-top:24px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div class="section-heading" style="margin:0;font-size:14px">&#9881; Ad-hoc Tasks</div>
            <button class="btn btn-sm" onclick="toggleNewTaskForm()">+ Task</button>
          </div>
          <div id="workflow-form" style="display:none" class="new-task-form">
            <div class="card-title" style="margin-bottom:12px">Schedule One-off Task</div>
            <div class="form-row">
              <textarea id="wf-prompt" class="form-input" placeholder="Task prompt..." rows="3"></textarea>
            </div>
            <div class="form-row">
              <input id="wf-cron" class="form-input mono" type="text" placeholder="Cron expression (e.g. 0 9 * * *)" />
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary btn-sm" onclick="createWorkflowTask()">Schedule</button>
              <button class="btn btn-sm" onclick="toggleNewTaskForm()">Cancel</button>
            </div>
          </div>
          <div id="workflow-list"></div>
          <div id="workflow-loading" class="chat-thinking" style="padding:20px 0;display:none">Loading...</div>
          <div id="workflow-empty" style="display:none;padding:12px 0;font-size:12px;color:var(--text-muted)">No ad-hoc tasks scheduled.</div>
        </div>

        <!-- Automation Modals -->
        <div id="automation-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center">
          <div class="card" style="width:min(420px,90vw);padding:20px">
            <div class="card-title" id="automation-modal-title">Edit Automation</div>
            <input type="hidden" id="automation-modal-id" />
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="form-input" id="automation-modal-name" placeholder="Morning Briefing" />
            </div>
            <div class="form-group">
              <label class="form-label">Cron Expression</label>
              <input class="form-input mono" id="automation-modal-cron" placeholder="0 8 * * *" />
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
                Examples: <code>0 8 * * *</code> = 8am daily &nbsp;|&nbsp; <code>0 18 * * 0</code> = Sunday 6pm &nbsp;|&nbsp; <code>0 20 * * 1-5</code> = weekdays 8pm
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Prompt</label>
              <textarea class="form-input" id="automation-modal-prompt" rows="4" style="font-size:12px;resize:vertical"></textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
              <button class="btn btn-sm" onclick="closeAutomationModal()">Cancel</button>
              <button class="btn btn-primary btn-sm" onclick="saveAutomationModal()">Save</button>
            </div>
          </div>
        </div>

        <div id="new-automation-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center">
          <div class="card" style="width:min(420px,90vw);padding:20px">
            <div class="card-title">New Custom Automation</div>
            <div class="form-group">
              <label class="form-label">Name</label>
              <input class="form-input" id="new-auto-name" placeholder="My Custom Task" />
            </div>
            <div class="form-group">
              <label class="form-label">Cron Expression</label>
              <input class="form-input mono" id="new-auto-cron" placeholder="0 9 * * *" />
            </div>
            <div class="form-group">
              <label class="form-label">Prompt (what to ask Claude)</label>
              <textarea class="form-input" id="new-auto-prompt" rows="4" placeholder="Read life/goals/_kernel/key.md and..." style="resize:vertical"></textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
              <button class="btn btn-sm" onclick="closeNewAutomationModal()">Cancel</button>
              <button class="btn btn-primary btn-sm" onclick="createCustomAutomation()">Create</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Page 6: Skills & MCP -->
      <div class="page" id="page-plugins">
        <div class="section-heading">&#129520; Skills</div>
        <div id="skills-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
          <div class="chat-thinking" style="padding:20px 0">Loading skills...</div>
        </div>
        <div class="section-heading" style="margin-top:20px">&#128268; MCP Servers &mdash; Installed</div>
        <div id="mcp-installed-list"></div>
        <div class="section-heading" style="margin-top:20px">&#128268; MCP Servers &mdash; Available</div>
        <div id="mcp-available-list"></div>
      </div>

      <!-- Page 7: System Vitals -->
      <div class="page" id="page-vitals">
        <div class="section-heading">&#128200; System Vitals</div>
        <div id="vitals-content">
          <div class="chat-thinking" style="padding:20px 0">Loading vitals...</div>
        </div>
        <div class="section-heading" style="margin-top:8px">&#128176; Token &amp; Cost</div>
        <div id="tokens-content">
          <div class="chat-thinking" style="padding:20px 0">Loading token data...</div>
        </div>
        <div class="section-heading" style="margin-top:8px">&#128260; System Update</div>
        <div id="update-content">
          <div class="chat-thinking" style="padding:20px 0">Loading version info...</div>
        </div>
        <div class="section-heading" style="margin-top:8px">&#9881;&#65039; Device Controls</div>
        <div id="device-controls-content">
          <div class="card" style="margin-bottom:8px">
            <div class="card-title">SERVICE</div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
              <button class="btn btn-primary" id="restart-btn" onclick="restartService()">&#8635; Restart Bot</button>
              <span style="font-size:12px;color:var(--text-dim)">Restarts the WildClaude process without pulling new code.</span>
            </div>
            <div id="restart-log" style="display:none;margin-top:10px;font-family:monospace;font-size:12px;background:var(--bg-input);border-radius:6px;padding:12px;line-height:1.8;max-height:150px;overflow-y:auto"></div>
          </div>
          <div class="card">
            <div class="card-title">DEVICE</div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
              <button class="btn btn-danger" id="reboot-btn" onclick="confirmReboot()">&#128256; Reboot Device</button>
              <span style="font-size:12px;color:var(--text-dim)">Reboots the host machine. Dashboard reconnects when it\'s back (~30-60s).</span>
            </div>
            <div id="reboot-log" style="display:none;margin-top:10px;font-family:monospace;font-size:12px;background:var(--bg-input);border-radius:6px;padding:12px;line-height:1.8;max-height:100px;overflow-y:auto"></div>
          </div>
        </div>
      </div>

      <!-- Page 8: Daily Journal -->
      <div class="page" id="page-journal">
        <div class="section-heading">&#128213; Daily Journal</div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">ABOUT THIS VIEW</div>
          <p style="font-size:13px;color:var(--text-muted);line-height:1.6">Journal entries are captured during your <b style="color:var(--text)">/evening</b> reviews and stored as session memories. Below are your 5 most recent conversations.</p>
        </div>
        <div class="section-heading" style="font-size:12px;color:var(--text-dim)">RECENT CONVERSATIONS</div>
        <div id="journal-list"></div>
        <div id="journal-loading" class="chat-thinking" style="padding:20px 0;display:none">Loading...</div>
        <div id="journal-empty" style="display:none" class="placeholder-box">
          <div class="placeholder-icon">&#128213;</div>
          <div class="placeholder-title">No conversations yet</div>
          <div class="placeholder-desc">Start chatting to build your journal history.</div>
        </div>
      </div>

      <!-- Page 10: External Dashboards -->
      <div class="page" id="page-dashboards">
        <div class="section-heading" style="display:flex;justify-content:space-between;align-items:center">
          <span>&#128202; External Dashboards</span>
          <button class="btn btn-primary btn-sm" onclick="openCreateDashboard()">+ Add Service</button>
        </div>
        <div id="dashboards-services" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
          <div class="chat-thinking" style="padding:12px 0">Loading services...</div>
        </div>
        <div id="dashboards-content">
          <div style="color:var(--text-muted);padding:16px;text-align:center">Select a service above to view its data.</div>
        </div>
      </div>

      <!-- Page: File Explorer -->
      <div class="page" id="page-files">
        <div class="section-heading">&#128193; File Explorer</div>
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-sm fe-root-btn" id="fe-root-data" onclick="switchFileRoot('data')" style="background:var(--accent);color:#fff">User Data</button>
          <button class="btn btn-sm btn-ghost fe-root-btn" id="fe-root-project" onclick="switchFileRoot('project')">Project</button>
          <button class="btn btn-sm btn-ghost fe-root-btn" id="fe-root-system" onclick="feShowSystemInput()">System</button>
          <span style="margin-left:auto;cursor:pointer;font-size:14px" title="Bookmark this folder" onclick="feToggleBookmark()">&#9734;</span>
        </div>
        <div id="fe-system-bar" style="display:none;margin-bottom:8px;gap:6px;align-items:center">
          <input id="fe-system-path" class="form-input" style="flex:1;font-size:13px;padding:5px 8px" placeholder="/home/gighy/..." value="/home/gighy" onkeydown="if(event.key==='Enter')feGoSystem()" />
          <button class="btn btn-sm btn-primary" onclick="feGoSystem()">Go</button>
        </div>
        <div id="fe-bookmarks" style="display:none;margin-bottom:8px;gap:6px;flex-wrap:wrap"></div>
        <div id="fe-breadcrumb" style="font-size:12px;color:var(--text-muted);margin-bottom:10px;display:flex;flex-wrap:wrap;gap:4px;align-items:center"></div>
        <div class="fe-panels" id="fe-panels" style="display:flex;gap:12px;height:calc(100dvh - 240px);min-height:300px">
          <div class="fe-tree-panel" style="flex:1;min-width:200px;max-width:320px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)">
            <div id="fe-tree" style="padding:8px;font-size:13px"></div>
          </div>
          <div class="fe-preview-panel" style="flex:2;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg);padding:16px">
            <div class="fe-mobile-back" style="display:none;align-items:center;gap:6px;margin-bottom:10px;cursor:pointer;color:var(--accent);font-size:13px" onclick="feBackToTree()">&#8592; Back to files</div>
            <div id="fe-preview" style="color:var(--text-muted);text-align:center;padding:40px;font-size:13px">
              Select a file to preview
            </div>
          </div>
        </div>
      </div>

      <!-- Page 11: Live Activity -->
      <div class="page" id="page-activity">
        <div class="section-heading">&#128308; Live Activity Stream</div>

        <!-- Live SSE stream -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
            <span>LIVE STREAM</span>
            <div style="display:flex;gap:8px;align-items:center">
              <span id="activity-live-dot" class="status-dot connected" style="width:6px;height:6px"></span>
              <button class="btn btn-ghost btn-sm" onclick="clearActivityLog()">Clear</button>
              <label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px">
                <input type="checkbox" id="activity-autoscroll" checked style="accent-color:var(--accent)"> Auto-scroll
              </label>
            </div>
          </div>
          <div id="activity-stream" style="height:400px;overflow-y:auto;font-family:monospace;font-size:12px;line-height:1.8;background:var(--bg);border-radius:var(--radius-sm);padding:12px;border:1px solid var(--border)">
            <div style="color:var(--text-dim)">Waiting for events...</div>
          </div>
        </div>

        <!-- Audit Log -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
            <span>AUDIT LOG</span>
            <button class="btn btn-ghost btn-sm" onclick="loadAuditLog()">Refresh</button>
          </div>
          <div id="audit-log-content">
            <div class="chat-thinking" style="padding:12px 0">Loading...</div>
          </div>
        </div>

        <!-- Hive Mind (agent delegation history) -->
        <div class="card">
          <div class="card-title">AGENT DELEGATION HISTORY</div>
          <div id="hivemind-content">
            <div class="chat-thinking" style="padding:12px 0">Loading...</div>
          </div>
        </div>
      </div>

      <!-- Page 11: Settings -->
      <div class="page" id="page-settings">
        <div class="section-heading">&#9881; Settings</div>

        <!-- Bot Identity -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">&#128039; BOT IDENTITY</div>
          <div class="form-group">
            <label class="form-label">Bot Name &amp; Icon</label>
            <div style="display:flex;gap:8px">
              <input class="form-input" id="identity-name" placeholder="WildClaude" style="flex:1;font-size:15px;font-weight:600" />
              <input class="form-input" id="identity-emoji" placeholder="&#128058;" style="width:50px;font-size:20px;text-align:center" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Tagline</label>
            <input class="form-input" id="identity-tagline" placeholder="Personal AI Operating System" style="width:100%" />
          </div>
          <div class="form-group">
            <label class="form-label">Welcome Message (custom /start greeting)</label>
            <textarea class="form-input" id="identity-welcome" rows="2" placeholder="Leave empty for default"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Theme Color</label>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm" style="background:#7c3aed;color:white" onclick="setIdentityTheme('purple')">Purple</button>
              <button class="btn btn-sm" style="background:#3b82f6;color:white" onclick="setIdentityTheme('blue')">Blue</button>
              <button class="btn btn-sm" style="background:#10b981;color:white" onclick="setIdentityTheme('green')">Green</button>
              <button class="btn btn-sm" style="background:#64748b;color:white" onclick="setIdentityTheme('dark')">Dark</button>
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:8px">
            <button class="btn btn-primary btn-sm" onclick="saveIdentity()">Save Identity</button>
          </div>
        </div>

        <!-- Personality -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">&#127775; PERSONALITY</div>
          <div id="personality-presets" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div>
              <label class="form-label">Tone</label>
              <select class="form-input" id="personality-tone" onchange="personalityChanged()">
                <option value="direct">Direct</option>
                <option value="friendly">Friendly</option>
                <option value="formal">Formal</option>
                <option value="casual">Casual</option>
                <option value="warm">Warm</option>
              </select>
            </div>
            <div>
              <label class="form-label">Response Length</label>
              <select class="form-input" id="personality-length" onchange="personalityChanged()">
                <option value="brief">Brief</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </div>
            <div>
              <label class="form-label">Language</label>
              <select class="form-input" id="personality-language" onchange="personalityChanged()">
                <option value="auto">Auto (match user)</option>
                <option value="en">English</option>
                <option value="it">Italian</option>
                <option value="es">Spanish</option>
                <option value="de">German</option>
                <option value="fr">French</option>
                <option value="pt">Portuguese</option>
              </select>
            </div>
            <div>
              <label class="form-label">Pushback</label>
              <select class="form-input" id="personality-pushback" onchange="personalityChanged()">
                <option value="gentle">Gentle</option>
                <option value="normal">Normal</option>
                <option value="assertive">Assertive</option>
              </select>
            </div>
          </div>
          <div style="margin-bottom:10px">
            <label class="form-label">Humor: <span id="personality-humor-val">2</span>/10</label>
            <input type="range" id="personality-humor" min="0" max="10" value="2" style="width:100%;accent-color:var(--accent)" oninput="document.getElementById('personality-humor-val').textContent=this.value;personalityChanged()">
          </div>
          <div style="margin-bottom:10px;display:flex;align-items:center;gap:10px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="personality-emoji" onchange="personalityChanged()" style="accent-color:var(--accent)">
              Use emoji
            </label>
          </div>
          <div style="margin-bottom:10px">
            <label class="form-label">Custom Instructions</label>
            <textarea class="form-input" id="personality-custom" rows="3" placeholder="Additional instructions appended to the personality prompt..." oninput="personalityChanged()" style="resize:vertical;font-size:13px"></textarea>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="previewPersonality()">Preview Prompt</button>
            <button class="btn btn-ghost btn-sm" onclick="savePersonality()" id="personality-save-btn">Save</button>
            <button class="btn btn-primary btn-sm" onclick="applyPersonality()">Save &amp; Apply Now</button>
            <span id="personality-status" style="font-size:12px;color:var(--text-muted)"></span>
          </div>
        </div>

        <!-- Verbosity -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">&#128483; NOTIFICATION LEVEL</div>
          <div style="margin-bottom:12px">
            <label class="form-label">Verbosity Level</label>
            <select class="form-input" id="verbosity-level" onchange="saveVerbosity()" style="max-width:200px">
              <option value="minimal">Minimal — only final response</option>
              <option value="normal">Normal — agents + key progress</option>
              <option value="detailed">Detailed — all tools + agents</option>
              <option value="debug">Debug — everything</option>
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer">
              <input type="checkbox" id="verbosity-tools" onchange="saveVerbosity()" style="accent-color:var(--accent)"> Tool usage (Reading file, Running command...)
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer">
              <input type="checkbox" id="verbosity-subagents" onchange="saveVerbosity()" style="accent-color:var(--accent)"> Sub-agent start/complete
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer">
              <input type="checkbox" id="verbosity-routing" onchange="saveVerbosity()" style="accent-color:var(--accent)"> Model routing info
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer">
              <input type="checkbox" id="verbosity-memory" onchange="saveVerbosity()" style="accent-color:var(--accent)"> Memory notifications
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer">
              <input type="checkbox" id="verbosity-progress" onchange="saveVerbosity()" style="accent-color:var(--accent)"> Progress updates
            </label>
          </div>
          <div id="verbosity-status" style="font-size:11px;color:var(--text-dim);margin-top:6px"></div>
        </div>

        <!-- Secrets Manager -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">&#128272; SECRETS MANAGER</div>
          <div id="secrets-content">
            <div class="chat-thinking" style="padding:12px 0">Loading secrets...</div>
          </div>
        </div>

        <!-- Profile Editor -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">&#128100; PROFILE &amp; LIFE CONTEXT</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <button class="btn btn-ghost btn-sm" onclick="loadProfileEditor('me')" id="profile-tab-me" style="border-color:var(--accent)">Me</button>
            <button class="btn btn-ghost btn-sm" onclick="loadProfileEditor('goals')" id="profile-tab-goals">Goals</button>
            <button class="btn btn-ghost btn-sm" onclick="loadProfileEditor('health')" id="profile-tab-health">Health</button>
            <button class="btn btn-ghost btn-sm" onclick="loadProfileEditor('finance')" id="profile-tab-finance">Finance</button>
            <button class="btn btn-ghost btn-sm" onclick="loadProfileEditor('learning')" id="profile-tab-learning">Learning</button>
          </div>
          <textarea class="form-input" id="profile-editor-content" rows="12" style="font-family:monospace;font-size:13px;resize:vertical"></textarea>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
            <button class="btn btn-primary btn-sm" onclick="saveProfile()">Save</button>
          </div>
        </div>

        <!-- Import -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">&#128230; IMPORT DATA</div>
          <div id="import-sources" style="font-size:13px;color:var(--text-muted)">Loading sources...</div>
          <div style="margin-top:8px">
            <button class="btn btn-primary btn-sm" onclick="runImport()">Import All Detected Sources</button>
          </div>
          <div id="import-result" style="margin-top:8px;font-size:13px"></div>
        </div>

        <!-- System Info -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">SYSTEM INFO</div>
          <div class="settings-row">
            <span class="settings-key">Bot Name</span>
            <span id="settings-bot-name" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">Bot Status</span>
            <span id="settings-bot-status" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">Platform</span>
            <span id="settings-platform" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">Active Model</span>
            <span id="settings-model" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">Process PID</span>
            <span id="settings-pid" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">Uptime</span>
            <span id="settings-uptime" class="settings-val">-</span>
          </div>
        </div>

        <!-- Connection -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">CONNECTION</div>
          <div class="settings-row">
            <span class="settings-key">Telegram</span>
            <span id="settings-telegram" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">WhatsApp</span>
            <span id="settings-wa" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">Slack</span>
            <span id="settings-slack" class="settings-val">-</span>
          </div>
        </div>

        <!-- Configuration (read-only) -->
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">CONFIGURATION</div>
          <div class="settings-row">
            <span class="settings-key">Context %</span>
            <span id="settings-ctx" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">Turns</span>
            <span id="settings-turns" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">Compactions</span>
            <span id="settings-compactions" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">Session Age</span>
            <span id="settings-age" class="settings-val">-</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">Dashboard Port</span>
            <span id="settings-port" class="settings-val">3141</span>
          </div>
        </div>

        <!-- Dashboard -->
        <div class="card">
          <div class="card-title">DASHBOARD</div>
          <div class="settings-row">
            <span class="settings-key">Token</span>
            <span class="settings-val" style="font-size:11px;color:var(--text-dim)">stored in URL / session</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">SSE Stream</span>
            <span class="settings-val">/api/chat/stream</span>
          </div>
          <div class="settings-row" style="border:none">
            <span class="settings-key">Config file</span>
            <span class="settings-val" style="font-size:11px">.env</span>
          </div>
        </div>
      </div>

    </div><!-- /content -->
  </div><!-- /main -->
</div><!-- /app -->

<!-- Toast container -->
<div class="toast-container" id="toast-container"></div>

<!-- Personality preview modal -->
<div class="modal-overlay" id="modal-personality-preview">
  <div class="modal-card" style="max-width:640px">
    <button class="modal-close" onclick="closeModal('modal-personality-preview')">&times;</button>
    <div class="modal-title">Personality Prompt Preview</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">This is the text injected into the system prompt.</div>
    <pre id="personality-preview-text" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:50vh;overflow-y:auto;color:var(--text)"></pre>
    <div style="display:flex;justify-content:flex-end;margin-top:12px">
      <button class="btn btn-ghost" onclick="closeModal('modal-personality-preview')">Close</button>
    </div>
  </div>
</div>

<!-- Memory detail modal -->
<div class="modal-overlay" id="modal-memory-detail">
  <div class="modal-card">
    <button class="modal-close" onclick="closeModal('modal-memory-detail')">&times;</button>
    <div class="modal-title" id="mem-detail-title">Memory Detail</div>
    <div id="mem-detail-body"></div>
  </div>
</div>

<!-- Secret set modal -->
<div class="modal-overlay" id="modal-secret-set">
  <div class="modal-card">
    <button class="modal-close" onclick="closeModal('modal-secret-set')">&times;</button>
    <div class="modal-title">Set Secret</div>
    <div class="form-group">
      <label class="form-label">Key</label>
      <input class="form-input" id="secret-modal-key" type="text" readonly style="opacity:0.7" />
    </div>
    <div class="form-group">
      <label class="form-label">Value</label>
      <input class="form-input" id="secret-modal-value" type="password" placeholder="Enter secret value..." />
    </div>
    <div id="secret-modal-url" style="margin-bottom:12px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal('modal-secret-set')">Cancel</button>
      <button class="btn btn-primary" id="secret-modal-save" onclick="saveSecret()">Save</button>
    </div>
  </div>
</div>

<!-- Skill editor modal -->
<div class="modal-overlay" id="modal-skill-editor">
  <div class="modal-card" style="max-width:700px">
    <button class="modal-close" onclick="closeModal('modal-skill-editor')">&times;</button>
    <div class="modal-title" id="skill-editor-title">Edit Skill</div>
    <div class="form-group">
      <label class="form-label">Skill Name</label>
      <input class="form-input" id="skill-editor-name" type="text" placeholder="my-skill" />
    </div>
    <div class="form-group">
      <label class="form-label">Content (SKILL.md)</label>
      <textarea class="form-input" id="skill-editor-content" rows="18" style="font-family:monospace;font-size:13px;resize:vertical" placeholder="---\nname: my-skill\ndescription: What it does\n---\n\n# Instructions..."></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal('modal-skill-editor')">Cancel</button>
      <button class="btn btn-primary" id="skill-editor-save" onclick="saveSkillEditor()">Save</button>
    </div>
  </div>
</div>

<!-- Agent editor modal -->
<div class="modal-overlay" id="modal-agent-editor">
  <div class="modal-card" style="max-width:700px">
    <button class="modal-close" onclick="closeModal('modal-agent-editor')">&times;</button>
    <div class="modal-title" id="agent-editor-title">Edit Agent</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="form-group" style="margin:0">
        <label class="form-label">Agent ID</label>
        <input class="form-input" id="agent-editor-id" type="text" placeholder="my-agent" />
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Lane</label>
        <select class="form-input" id="agent-editor-lane">
          <option value="build">Build</option>
          <option value="review">Review</option>
          <option value="domain">Domain</option>
          <option value="coordination">Coordination</option>
          <option value="life">Life</option>
        </select>
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Model</label>
        <select class="form-input" id="agent-editor-model">
          <option value="claude-opus-4-6">Opus</option>
          <option value="claude-sonnet-4-6">Sonnet</option>
          <option value="claude-haiku-4-5">Haiku</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">System Prompt</label>
      <textarea class="form-input" id="agent-editor-content" rows="16" style="font-family:monospace;font-size:13px;resize:vertical" placeholder="---\nname: agent-id\ndescription: What it does\nmodel: claude-sonnet-4-6\nlane: build\n---\n\n# Role..."></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal('modal-agent-editor')">Cancel</button>
      <button class="btn btn-primary" id="agent-editor-save" onclick="saveAgentEditor()">Save</button>
    </div>
  </div>
</div>

<!-- Create dashboard modal -->
<div class="modal-overlay" id="modal-create-dashboard">
  <div class="modal-card" style="max-width:600px">
    <button class="modal-close" onclick="closeModal('modal-create-dashboard')">&times;</button>
    <div class="modal-title">Add Custom Dashboard Service</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="form-group" style="margin:0">
        <label class="form-label">Service ID</label>
        <input class="form-input" id="dash-create-id" placeholder="my-api" />
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Display Name</label>
        <input class="form-input" id="dash-create-name" placeholder="My API" />
      </div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:8px">
      <div class="form-group" style="margin:0">
        <label class="form-label">Base URL</label>
        <input class="form-input" id="dash-create-url" placeholder="https://api.example.com/v1" />
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Secret Key Name</label>
        <input class="form-input" id="dash-create-secret" placeholder="MY_API_KEY" />
      </div>
    </div>
    <div class="form-group" style="margin-top:8px">
      <label class="form-label">Auth Type</label>
      <select class="form-input" id="dash-create-auth">
        <option value="Bearer">Bearer (default)</option>
        <option value="token">token (GitHub-style)</option>
        <option value="Basic">Basic Auth</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Endpoints (JSON array)</label>
      <textarea class="form-input" id="dash-create-endpoints" rows="4" style="font-family:monospace;font-size:12px" placeholder='[{"id":"list","name":"List Items","path":"/items?limit=10"}]'></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      <button class="btn btn-ghost" onclick="closeModal('modal-create-dashboard')">Cancel</button>
      <button class="btn btn-primary" onclick="saveCreateDashboard()">Save</button>
    </div>
  </div>
</div>

<script>
// ─────────────────────────────────────────────
// Token / Auth
// ─────────────────────────────────────────────
let TOKEN = '';

function getTokenFromUrl() {
  const u = new URLSearchParams(location.search).get('token');
  if (u) return u;
  const h = location.hash.replace('#','');
  if (h.startsWith('token=')) return h.slice(6);
  return '';
}

function init() {
  TOKEN = getTokenFromUrl() || sessionStorage.getItem('wcp_token') || '';
  if (TOKEN) {
    showApp();
  } else {
    document.getElementById('token-screen').style.display = 'flex';
    document.getElementById('token-input').focus();
    document.getElementById('token-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') submitToken();
    });
  }
}

async function submitToken() {
  const val = document.getElementById('token-input').value.trim();
  if (!val) return;
  document.getElementById('token-error').textContent = 'Connecting...';
  try {
    const r = await fetch('/api/info?token=' + encodeURIComponent(val));
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('HTTP ' + r.status + ': ' + txt);
    }
    TOKEN = val;
    sessionStorage.setItem('wcp_token', TOKEN);
    document.getElementById('token-error').textContent = '';
    showApp();
  } catch(e) {
    document.getElementById('token-error').textContent = 'Connection failed: ' + (e.message || 'Unknown error') + '. Check the token and ensure the bot is running.';
  }
}

function showApp() {
  document.getElementById('token-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  startSSE();
  navigate('command');
  loadChatHistory();
  loadBotIdentity();
  // Auto-refresh vitals every 5s when on vitals page
  setInterval(() => { if (currentPage === 'vitals') loadVitals(); }, 5000);
}

async function loadBotIdentity() {
  try {
    const info = await apiFetch('/api/info');
    const name = info.botName || 'WildClaude';
    const emoji = info.botEmoji || '\\u{1F43A}';
    const tagline = info.botTagline || 'Personal AI Operating System';
    const theme = info.botTheme || 'purple';
    document.getElementById('sidebar-bot-name').textContent = name;
    document.getElementById('sidebar-bot-tagline').textContent = tagline;
    document.title = emoji + ' ' + name;
    // Apply theme color
    const themeColors = { purple: '#7c3aed', blue: '#3b82f6', green: '#10b981', dark: '#64748b' };
    if (themeColors[theme]) {
      document.documentElement.style.setProperty('--accent', themeColors[theme]);
      document.documentElement.style.setProperty('--accent-light', themeColors[theme] + 'cc');
      document.documentElement.style.setProperty('--accent-dim', themeColors[theme] + '26');
      document.documentElement.style.setProperty('--border-accent', themeColors[theme] + '66');
    }
  } catch {}
}

function apiUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + 'token=' + encodeURIComponent(TOKEN);
}

async function apiFetch(path, opts) {
  const r = await fetch(apiUrl(path), opts);
  if (!r.ok) {
    const txt = await r.text().catch(() => r.statusText);
    throw new Error(txt || r.statusText);
  }
  return r.json();
}

// ─────────────────────────────────────────────
// Modal helpers
// ─────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
// Close modals on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('open')) {
    e.target.classList.remove('open');
  }
});

// ─────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────
let currentPage = 'command';
const PAGE_TITLES = {
  command: 'Command Center',
  memory: 'Memory Palace',
  mission: 'Mission Control',
  agents: 'Agent Hub',
  workflow: 'Automation',
  plugins: 'Skills & MCP',
  vitals: 'System Vitals',
  journal: 'Daily Journal',
  dashboards: 'Dashboards',
  files: 'File Explorer',
  activity: 'Live Activity',
  settings: 'Settings'
};

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  const nav = document.querySelector('[data-page="' + page + '"]');
  if (nav) nav.classList.add('active');
  document.getElementById('page-title').textContent = PAGE_TITLES[page] || page;
  currentPage = page;
  closeSidebar();
  // Lazy-load page data
  switch(page) {
    case 'memory':   loadMemories(); loadMemTopics(); break;
    case 'mission':  loadMissions(); break;
    case 'agents':   loadAgents(); break;
    case 'workflow': loadAutomations(); loadWorkflow(); break;
    case 'plugins':  loadSkills(); loadMcpServers(); break;
    case 'vitals':   loadVitals(); loadTokens(); loadVersions(); break;
    case 'journal':  loadJournal(); break;
    case 'dashboards': loadDashboardServices(); break;
    case 'files': loadFileExplorer(); break;
    case 'activity': loadAuditLog(); loadHiveMind(); break;
    case 'settings': loadSettings(); loadSecrets(); loadIdentity(); loadProfileEditor('me'); loadImportSources(); loadPersonality(); loadVerbosity(); break;
  }
}

function refreshCurrentPage() { navigate(currentPage); }

// ─────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────
let sidebarCollapsed = false;
function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
}
function openSidebar() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sidebar-overlay').classList.add('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('show');
}

// ─────────────────────────────────────────────
// SSE
// ─────────────────────────────────────────────
let sseSource = null;
let sseRetries = 0;

function startSSE() {
  if (sseSource) { sseSource.close(); sseSource = null; }
  sseSource = new EventSource(apiUrl('/api/chat/stream'));
  sseSource.onopen = () => {
    setSseStatus(true);
    sseRetries = 0;
    setupActivityStream();
  };
  sseSource.onerror = () => {
    setSseStatus(false);
    sseSource.close(); sseSource = null;
    const delay = Math.min(1000 * Math.pow(2, sseRetries++), 30000);
    setTimeout(startSSE, delay);
  };
  sseSource.addEventListener('processing', e => {
    try {
      const d = JSON.parse(e.data);
      document.getElementById('chat-thinking-row').style.display = d.processing ? 'block' : 'none';
      document.getElementById('chat-send').disabled = !!d.processing;
    } catch {}
  });
  sseSource.addEventListener('user_message', e => {
    try {
      const d = JSON.parse(e.data);
      appendChatMessage('user', d.content || '', null, null);
      document.getElementById('chat-thinking-row').style.display = 'block';
      document.getElementById('chat-send').disabled = true;
      document.getElementById('chat-empty').style.display = 'none';
    } catch {}
  });
  sseSource.addEventListener('assistant_message', e => {
    try {
      const d = JSON.parse(e.data);
      appendChatMessage('assistant', d.content || '', d.model, d.cost);
      document.getElementById('chat-thinking-row').style.display = 'none';
      document.getElementById('chat-send').disabled = false;
      document.getElementById('chat-empty').style.display = 'none';
    } catch {}
  });
  sseSource.addEventListener('progress', e => {
    try {
      const d = JSON.parse(e.data);
      const el = document.getElementById('chat-thinking-text');
      if (el) el.innerHTML = '&nbsp;' + escHtml(d.description || 'Thinking...');
    } catch {}
  });
  sseSource.addEventListener('error', e => {
    try {
      const d = JSON.parse(e.data);
      appendChatMessage('assistant', d.content || 'Error occurred', null, null);
      document.getElementById('chat-thinking-row').style.display = 'none';
      document.getElementById('chat-send').disabled = false;
    } catch {}
  });
}

function setSseStatus(connected) {
  const dot = document.getElementById('sse-dot');
  const sdot = document.getElementById('sse-status-dot');
  const stxt = document.getElementById('sse-status-text');
  dot.classList.toggle('connected', connected);
  if (sdot) { sdot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected'); }
  if (stxt) { stxt.textContent = connected ? 'Connected' : 'Disconnected'; }
}

// ─────────────────────────────────────────────
// Command Center — Chat
// ─────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtChatText(text) {
  let s = escHtml(text);
  // code blocks
  s = s.replace(/\\\`\\\`\\\`([\\s\\S]*?)\\\`\\\`\\\`/g, '<pre><code>$1</code></pre>');
  // inline code
  s = s.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
  // bold
  s = s.replace(/\\*\\*(.+?)\\*\\*/g, '<b>$1</b>');
  // newlines
  s = s.replace(/\\n/g, '<br>');
  return s;
}

function modelBadge(model) {
  if (!model) return '';
  const m = String(model).toLowerCase();
  if (m.includes('opus')) return '<span class="badge badge-purple">Opus</span>';
  if (m.includes('sonnet')) return '<span class="badge badge-blue">Sonnet</span>';
  if (m.includes('haiku')) return '<span class="badge badge-green">Haiku</span>';
  return '<span class="badge badge-gray">' + escHtml(model) + '</span>';
}

function appendChatMessage(role, text, model, cost) {
  const container = document.getElementById('chat-messages');
  const empty = document.getElementById('chat-empty');
  if (empty) empty.style.display = 'none';
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  const costStr = cost ? ' &middot; $' + Number(cost).toFixed(4) : '';
  const modelStr = role === 'assistant' ? (modelBadge(model) + costStr) : '';
  div.innerHTML = '<div class="chat-bubble">' + fmtChatText(text) + '</div>'
    + (modelStr ? '<div class="chat-meta">' + modelStr + '</div>' : '');
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function loadChatHistory() {
  try {
    const info = await apiFetch('/api/info');
    const chatId = info.chatId || '';
    if (!chatId) return;
    const data = await apiFetch('/api/chat/history?chatId=' + encodeURIComponent(chatId) + '&limit=30');
    const turns = (data.turns || []).reverse();
    if (turns.length) {
      document.getElementById('chat-empty').style.display = 'none';
      turns.forEach(t => {
        if (t.role === 'user' || t.role === 'assistant') {
          const text = Array.isArray(t.content)
            ? t.content.filter(c => c.type === 'text').map(c => c.text).join('')
            : (t.content || '');
          appendChatMessage(t.role, text, t.model, t.cost);
        }
      });
    }
  } catch { /* ignore */ }
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  const btn = document.getElementById('chat-send');
  input.value = '';
  input.style.height = '';
  btn.disabled = true;
  appendChatMessage('user', msg, null, null);
  document.getElementById('chat-thinking-row').style.display = 'block';
  try {
    await apiFetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    // Response comes via SSE
  } catch(err) {
    document.getElementById('chat-thinking-row').style.display = 'none';
    btn.disabled = false;
    toast('Send failed: ' + err.message, 'error');
  }
}

// Auto-resize textarea
document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('chat-input');
  if (ta) ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });
});

// ─────────────────────────────────────────────
// Memory Palace
// ─────────────────────────────────────────────
let memSearchTimer = null;
let memCacheAll = [];

function toggleMemFilters() {
  const filters = document.getElementById('mem-filters');
  const isHidden = filters.style.display === 'none';
  filters.style.display = isHidden ? 'grid' : 'none';
  if (isHidden) loadMemTopics();
}

function clearMemFilters() {
  document.getElementById('mem-search').value = '';
  document.getElementById('mem-filter-topic').value = '';
  document.getElementById('mem-filter-imp-min').value = '';
  document.getElementById('mem-filter-imp-max').value = '';
  document.getElementById('mem-filter-date-from').value = '';
  document.getElementById('mem-filter-date-to').value = '';
  document.getElementById('mem-filter-pinned').checked = false;
  debounceMemSearch();
}

async function loadMemTopics() {
  try {
    const data = await apiFetch('/api/memories/topics');
    const topicSelect = document.getElementById('mem-filter-topic');
    const topics = data.topics || [];
    const currentValue = topicSelect.value;
    topicSelect.innerHTML = '<option value="">All topics</option>';
    topics.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.topic;
      opt.textContent = t.topic + ' (' + t.count + ')';
      topicSelect.appendChild(opt);
    });
    topicSelect.value = currentValue;
  } catch(err) {
    logger.error('Failed to load topics', err);
  }
}

function debounceMemSearch() {
  clearTimeout(memSearchTimer);
  memSearchTimer = setTimeout(loadMemories, 400);
}

async function loadMemories() {
  const q = document.getElementById('mem-search').value.trim();
  const list = document.getElementById('mem-list');
  const loading = document.getElementById('mem-loading');
  const empty = document.getElementById('mem-empty');
  list.innerHTML = '';
  loading.style.display = 'block';
  empty.style.display = 'none';
  try {
    // Stats
    const stats = await apiFetch('/api/memories');
    const sr = document.getElementById('mem-stats-row');
    if (stats.stats) {
      const s = stats.stats;
      sr.innerHTML =
        '<div class="stat-card"><div class="stat-val">' + (s.total || 0) + '</div><div class="stat-label">Total</div></div>' +
        '<div class="stat-card"><div class="stat-val">' + (s.pinned || 0) + '</div><div class="stat-label">Pinned</div></div>' +
        '<div class="stat-card"><div class="stat-val">' + (s.fading || 0) + '</div><div class="stat-label">Fading</div></div>' +
        '<div class="stat-card"><div class="stat-val">' + ((s.avgImportance || 0).toFixed(1)) + '</div><div class="stat-label">Avg Importance</div></div>';
    }
    // List with filters
    let url = '/api/memories/list?limit=40&sort=importance';
    if (q) {
      url += '&q=' + encodeURIComponent(q);
    } else {
      const topic = document.getElementById('mem-filter-topic').value;
      if (topic) url += '&topic=' + encodeURIComponent(topic);
      const impMin = document.getElementById('mem-filter-imp-min').value;
      if (impMin) url += '&importanceMin=' + encodeURIComponent(impMin);
      const impMax = document.getElementById('mem-filter-imp-max').value;
      if (impMax) url += '&importanceMax=' + encodeURIComponent(impMax);
      const dateFrom = document.getElementById('mem-filter-date-from').value;
      if (dateFrom) url += '&dateFrom=' + encodeURIComponent(dateFrom);
      const dateTo = document.getElementById('mem-filter-date-to').value;
      if (dateTo) url += '&dateTo=' + encodeURIComponent(dateTo);
      const pinned = document.getElementById('mem-filter-pinned').checked;
      if (pinned) url += '&pinned=1';
    }
    const data = await apiFetch(url);
    const memories = data.memories || data.items || [];
    memCacheAll = memories;
    loading.style.display = 'none';
    if (!memories.length) { empty.style.display = 'block'; return; }
    memories.forEach(m => {
      const score = m.importance !== undefined ? m.importance : (m.salience !== undefined ? m.salience : '-');
      const scoreNum = Number(score);
      const scoreColor = scoreNum >= 8 ? 'var(--green)' : scoreNum >= 5 ? 'var(--accent-light)' : 'var(--text-muted)';
      const date = m.created_at ? new Date(m.created_at * 1000).toLocaleDateString() : (m.date || '');
      const pinned = m.pinned || m.is_pinned;
      const memId = escHtml(String(m.id));
      const div = document.createElement('div');
      div.className = 'mem-item';
      div.onclick = function(e) {
        if (e.target.closest('button')) return;
        showMemoryDetail(m);
      };
      div.innerHTML =
        '<div class="mem-item-header">' +
          '<div class="mem-score" style="color:' + scoreColor + '">' + (isNaN(scoreNum) ? score : scoreNum.toFixed(1)) + '</div>' +
          '<div class="mem-summary">' + escHtml(m.summary || m.content || '') + '</div>' +
        '</div>' +
        '<div class="mem-footer">' +
          '<span class="mem-date">' + escHtml(date) + '</span>' +
          (pinned
            ? '<button class="btn btn-sm" onclick="unpinMemory(\\'' + memId + '\\',this)">&#128204; Unpin</button>'
            : '<button class="btn btn-sm" onclick="pinMemory(\\'' + memId + '\\',this)">&#128204; Pin</button>') +
          '<button class="btn btn-danger btn-sm" onclick="deleteMemory(\\'' + memId + '\\',this)" title="Delete">&#128465;</button>' +
        '</div>';
      list.appendChild(div);
    });
  } catch(err) {
    loading.style.display = 'none';
    list.innerHTML = '<div style="color:var(--red);padding:10px">' + escHtml(err.message) + '</div>';
  }
}

async function pinMemory(id, btn) {
  btn.disabled = true;
  try {
    await apiFetch('/api/memories/' + encodeURIComponent(id) + '/pin', { method: 'POST' });
    toast('Memory pinned', 'success');
    loadMemories();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; }
}
async function unpinMemory(id, btn) {
  btn.disabled = true;
  try {
    await apiFetch('/api/memories/' + encodeURIComponent(id) + '/unpin', { method: 'POST' });
    toast('Memory unpinned', 'success');
    loadMemories();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; }
}

async function deleteMemory(id, btn) {
  if (!confirm('Delete this memory permanently?')) return;
  btn.disabled = true;
  try {
    await apiFetch('/api/memories/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('Memory deleted', 'success');
    loadMemories();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; }
}

function showMemoryDetail(m) {
  const body = document.getElementById('mem-detail-body');
  const score = m.importance !== undefined ? m.importance : (m.salience !== undefined ? m.salience : '-');
  const date = m.created_at ? new Date(m.created_at * 1000).toLocaleString() : (m.date || 'Unknown');
  const entities = m.entities || [];
  const topics = m.topics || [];
  let html = '<div class="form-group">' +
    '<label class="form-label">Summary</label>' +
    '<div style="font-size:13px;color:var(--text);line-height:1.6">' + escHtml(m.summary || m.content || '') + '</div>' +
    '</div>';
  if (m.raw_text) {
    html += '<div class="form-group">' +
      '<label class="form-label">Full Text</label>' +
      '<div style="font-size:12px;color:var(--text-muted);line-height:1.6;max-height:200px;overflow-y:auto;background:var(--bg);padding:10px;border-radius:var(--radius-sm)">' + escHtml(m.raw_text) + '</div>' +
      '</div>';
  }
  html += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">' +
    '<div><span class="form-label" style="display:block">Importance</span><span style="font-weight:700;color:var(--accent-light)">' + score + '</span></div>' +
    '<div><span class="form-label" style="display:block">Created</span><span style="font-size:12px;color:var(--text-muted)">' + escHtml(date) + '</span></div>' +
    '<div><span class="form-label" style="display:block">Pinned</span><span style="font-size:12px;color:var(--text-muted)">' + (m.pinned || m.is_pinned ? 'Yes' : 'No') + '</span></div>' +
    '</div>';
  if (entities.length) {
    html += '<div class="form-group"><label class="form-label">Entities</label><div style="display:flex;gap:4px;flex-wrap:wrap">' +
      entities.map(e => '<span class="badge badge-blue">' + escHtml(typeof e === 'string' ? e : e.name || JSON.stringify(e)) + '</span>').join('') +
      '</div></div>';
  }
  if (topics.length) {
    html += '<div class="form-group"><label class="form-label">Topics</label><div style="display:flex;gap:4px;flex-wrap:wrap">' +
      topics.map(t => '<span class="badge badge-purple">' + escHtml(typeof t === 'string' ? t : t.name || JSON.stringify(t)) + '</span>').join('') +
      '</div></div>';
  }
  body.innerHTML = html;
  document.getElementById('mem-detail-title').textContent = 'Memory #' + (m.id || '');
  openModal('modal-memory-detail');
}

async function exportMemories() {
  try {
    toast('Exporting memories...', 'success');
    const data = await apiFetch('/api/memories/list?limit=10000&sort=importance');
    const memories = data.memories || data.items || [];
    const blob = new Blob([JSON.stringify(memories, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wildclaude-memories-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Exported ' + memories.length + ' memories', 'success');
  } catch(err) { toast('Export failed: ' + err.message, 'error'); }
}

// ─────────────────────────────────────────────
// Mission Control
// ─────────────────────────────────────────────
function toggleNewMissionForm() {
  const f = document.getElementById('mission-form');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function createMission() {
  const title = document.getElementById('mission-title').value.trim();
  const prompt = document.getElementById('mission-prompt').value.trim();
  const agent = document.getElementById('mission-agent').value.trim();
  if (!title || !prompt) { toast('Title and prompt required', 'error'); return; }
  try {
    await apiFetch('/api/mission/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, prompt, assigned_agent: agent || undefined })
    });
    toast('Mission created', 'success');
    document.getElementById('mission-title').value = '';
    document.getElementById('mission-prompt').value = '';
    document.getElementById('mission-agent').value = '';
    toggleNewMissionForm();
    loadMissions();
  } catch(err) { toast(err.message, 'error'); }
}

async function cancelMission(id, btn) {
  btn.disabled = true;
  try {
    await apiFetch('/api/mission/tasks/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
    toast('Mission cancelled', 'success');
    loadMissions();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; }
}

function missionStatusBadge(status) {
  switch((status||'').toLowerCase()) {
    case 'queued': return '<span class="badge badge-yellow">queued</span>';
    case 'running': return '<span class="badge badge-blue pulse">running</span>';
    case 'completed': return '<span class="badge badge-green">completed</span>';
    case 'failed': return '<span class="badge badge-red">failed</span>';
    case 'cancelled': return '<span class="badge badge-gray">cancelled</span>';
    default: return '<span class="badge badge-gray">' + escHtml(status||'unknown') + '</span>';
  }
}

async function loadMissions() {
  const list = document.getElementById('mission-list');
  const loading = document.getElementById('mission-loading');
  const empty = document.getElementById('mission-empty');
  list.innerHTML = '';
  loading.style.display = 'block';
  empty.style.display = 'none';
  try {
    const data = await apiFetch('/api/mission/tasks');
    const tasks = data.tasks || [];
    loading.style.display = 'none';
    if (!tasks.length) { empty.style.display = 'block'; return; }
    // Sort: running first, then queued, then completed/failed/cancelled
    const order = {running:0, queued:1, completed:2, failed:3, cancelled:4};
    tasks.sort((a,b) => (order[a.status]||9) - (order[b.status]||9));
    tasks.forEach(t => {
      const canCancel = t.status === 'queued' || t.status === 'running';
      const div = document.createElement('div');
      div.className = 'mission-item';
      div.innerHTML =
        '<div class="mission-header">' +
          missionStatusBadge(t.status) +
          '<span class="mission-title">' + escHtml(t.title || '(no title)') + '</span>' +
        '</div>' +
        '<div class="mission-prompt" style="cursor:' + ((t.prompt||'').length > 200 ? 'pointer' : 'default') + '" onclick="this.textContent=this.dataset.full||this.textContent;this.style.cursor=\\'default\\'" data-full="' + escHtml(t.prompt || '') + '">' + escHtml((t.prompt || '').substring(0, 200)) + ((t.prompt||'').length > 200 ? '... <em style=\\'color:var(--accent-light)\\'>[click to expand]</em>' : '') + '</div>' +
        '<div class="mission-footer">' +
          (t.assigned_agent ? '<span class="badge badge-gray">' + escHtml(t.assigned_agent) + '</span>' : '') +
          (t.priority > 0 ? '<span class="badge badge-yellow">P' + t.priority + '</span>' : '') +
          (canCancel ? '<button class="btn btn-danger btn-sm" onclick="cancelMission(\\'' + escHtml(t.id) + '\\',this)">Cancel</button>' : '') +
        '</div>';
      list.appendChild(div);
    });
  } catch(err) {
    loading.style.display = 'none';
    list.innerHTML = '<div style="color:var(--red);padding:10px">' + escHtml(err.message) + '</div>';
  }
}

// ─────────────────────────────────────────────
// Agent Hub
// ─────────────────────────────────────────────
const LANE_CONFIG = {
  build:        { label: 'Build',        css: 'lane-build',        keys: ['builder','code','dev','coder','debugger','tester','architect'] },
  review:       { label: 'Review',       css: 'lane-review',       keys: ['reviewer','review','security-reviewer','code-reviewer'] },
  domain:       { label: 'Domain',       css: 'lane-domain',       keys: ['analyst','research','domain','researcher','writer','data-analyst'] },
  coordination: { label: 'Coordination', css: 'lane-coordination', keys: ['coo','coordinator','main','orchestrator','critic'] },
  life:         { label: 'Life',         css: 'lane-life',         keys: ['coach','life','organizer','finance','health','learner'] }
};

function agentLaneInfo(a) {
  const id = (a.id || a.name || '').toLowerCase();
  const lane = (a.lane || '').toLowerCase();
  // Prefer explicit lane from API
  if (lane && LANE_CONFIG[lane]) return { key: lane, ...LANE_CONFIG[lane] };
  // Fuzzy match
  for (const [lk, lv] of Object.entries(LANE_CONFIG)) {
    for (const k of lv.keys) {
      if (id.includes(k)) return { key: lk, ...lv };
    }
  }
  return { key: 'other', label: 'Other', css: '' };
}

async function loadAgents() {
  const container = document.getElementById('agents-container');
  const loading = document.getElementById('agents-loading');
  const empty = document.getElementById('agents-empty');
  container.innerHTML = '';
  loading.style.display = 'block';
  empty.style.display = 'none';
  try {
    const data = await apiFetch('/api/agents');
    const agents = data.agents || [];
    loading.style.display = 'none';
    if (!agents.length) { empty.style.display = 'block'; return; }
    // Group by lane
    const lanes = {};
    agents.forEach(a => {
      const li = agentLaneInfo(a);
      if (!lanes[li.key]) lanes[li.key] = { label: li.label, css: li.css, agents: [] };
      lanes[li.key].agents.push(a);
    });
    const laneOrder = ['coordination', 'build', 'review', 'domain', 'life', 'other'];
    laneOrder.forEach(lk => {
      const group = lanes[lk];
      if (!group) return;
      const hdr = document.createElement('div');
      hdr.className = 'lane-header';
      hdr.innerHTML = (group.css ? '<span class="lane-badge ' + group.css + '">' + escHtml(group.label) + '</span> ' : '') + escHtml(group.label);
      container.appendChild(hdr);
      const grid = document.createElement('div');
      grid.className = 'agents-grid';
      group.agents.forEach(a => {
        const li = agentLaneInfo(a);
        const mBadge = a.model && a.model.includes('opus') ? 'badge-purple'
          : a.model && a.model.includes('sonnet') ? 'badge-blue' : 'badge-green';
        const modelShort = a.model
          ? a.model.replace('claude-','').replace('-4-6','').replace('-4-5','')
          : 'unknown';
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.innerHTML =
          '<div class="agent-card-header">' +
            '<span class="status-dot ' + (a.running ? 'connected' : 'disconnected') + '"></span>' +
            '<span class="agent-name">' + escHtml(a.name || a.id) + '</span>' +
            (li.css ? '<span class="lane-badge ' + li.css + '" style="font-size:8px">' + escHtml(li.label) + '</span>' : '') +
          '</div>' +
          '<div class="agent-desc">' + escHtml(a.description || '') + '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
            '<span class="badge ' + mBadge + '">' + escHtml(modelShort) + '</span>' +
            '<select class="model-select" onchange="updateAgentModel(\\'' + escHtml(a.id) + '\\', this.value)" title="Change model">' +
              '<option value="claude-opus-4-6"' + (modelShort.includes('opus') ? ' selected' : '') + '>Opus</option>' +
              '<option value="claude-sonnet-4-6"' + (modelShort.includes('sonnet') ? ' selected' : '') + '>Sonnet</option>' +
              '<option value="claude-haiku-4-5"' + (modelShort.includes('haiku') ? ' selected' : '') + '>Haiku</option>' +
            '</select>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
            '<div class="agent-stats">' +
              '<span>' + (a.todayTurns || 0) + ' turns</span>' +
              '<span>$' + (a.todayCost || 0).toFixed(3) + '</span>' +
            '</div>' +
            (a.id !== 'main' ? '<button class="btn btn-ghost btn-sm" onclick="openAgentEditor(\\'' + escHtml(a.id) + '\\')" title="Edit agent">&#9998;</button>' : '') +
          '</div>';
        grid.appendChild(card);
      });
      container.appendChild(grid);
    });
    // Create button at the end
    const createDiv = document.createElement('div');
    createDiv.style.cssText = 'padding:16px;text-align:center';
    createDiv.innerHTML = '<button class="btn btn-primary" onclick="openAgentEditor()">+ Create New Agent</button>';
    container.appendChild(createDiv);
  } catch(err) {
    loading.style.display = 'none';
    container.innerHTML = '<div style="color:var(--red);padding:10px">' + escHtml(err.message) + '</div>';
  }
}

// ─────────────────────────────────────────────
// Workflow Engine
// ─────────────────────────────────────────────
function toggleNewTaskForm() {
  const f = document.getElementById('workflow-form');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function createWorkflowTask() {
  const prompt = document.getElementById('wf-prompt').value.trim();
  const cron = document.getElementById('wf-cron').value.trim();
  if (!prompt || !cron) { toast('Prompt and cron expression required', 'error'); return; }
  try {
    await apiFetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, cron })
    });
    toast('Task scheduled', 'success');
    document.getElementById('wf-prompt').value = '';
    document.getElementById('wf-cron').value = '';
    toggleNewTaskForm();
    loadWorkflow();
  } catch(err) { toast(err.message, 'error'); }
}

async function pauseTask(id, btn) {
  btn.disabled = true;
  try {
    await apiFetch('/api/tasks/' + encodeURIComponent(id) + '/pause', { method: 'POST' });
    toast('Task paused', 'success');
    loadWorkflow();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; }
}
async function resumeTask(id, btn) {
  btn.disabled = true;
  try {
    await apiFetch('/api/tasks/' + encodeURIComponent(id) + '/resume', { method: 'POST' });
    toast('Task resumed', 'success');
    loadWorkflow();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; }
}
async function deleteTask(id, btn) {
  if (!confirm('Delete this scheduled task?')) return;
  btn.disabled = true;
  try {
    await apiFetch('/api/tasks/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('Task deleted', 'success');
    loadWorkflow();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; }
}

async function loadWorkflow() {
  const list = document.getElementById('workflow-list');
  const loading = document.getElementById('workflow-loading');
  const empty = document.getElementById('workflow-empty');
  list.innerHTML = '';
  loading.style.display = 'block';
  empty.style.display = 'none';
  try {
    const data = await apiFetch('/api/tasks');
    const tasks = data.tasks || [];
    loading.style.display = 'none';
    if (!tasks.length) { empty.style.display = 'block'; return; }
    tasks.forEach(t => {
      const paused = t.paused || t.status === 'paused';
      const nextRun = t.nextRun || t.next_run;
      const lastResult = t.lastResult || t.last_result;
      const div = document.createElement('div');
      div.className = 'task-item';
      div.innerHTML =
        '<div class="task-header">' +
          '<div class="task-prompt">' + escHtml((t.prompt || '').substring(0, 140)) + ((t.prompt||'').length > 140 ? '...' : '') + '</div>' +
          '<span class="task-cron">' + escHtml(t.cron || '') + '</span>' +
        '</div>' +
        '<div class="task-meta">' +
          (nextRun ? 'Next: ' + escHtml(String(nextRun)) : '') +
          (paused ? ' &middot; <span style="color:var(--yellow)">paused</span>' : '') +
        '</div>' +
        (lastResult ? '<div class="task-result" onclick="this.classList.toggle(\\'expanded\\')">' + escHtml(String(lastResult)) + '</div>' : '') +
        '<div class="task-actions">' +
          (paused
            ? '<button class="btn btn-sm" onclick="resumeTask(\\'' + escHtml(t.id) + '\\',this)">&#9654; Resume</button>'
            : '<button class="btn btn-sm" onclick="pauseTask(\\'' + escHtml(t.id) + '\\',this)">&#9646;&#9646; Pause</button>') +
          '<button class="btn btn-danger btn-sm" onclick="deleteTask(\\'' + escHtml(t.id) + '\\',this)">&#128465; Delete</button>' +
        '</div>';
      list.appendChild(div);
    });
  } catch(err) {
    loading.style.display = 'none';
    list.innerHTML = '<div style="color:var(--red);padding:10px">' + escHtml(err.message) + '</div>';
  }
}

// ─────────────────────────────────────────────
// Skills & MCP
// ─────────────────────────────────────────────
async function loadSkills() {
  const container = document.getElementById('skills-list');
  try {
    const data = await apiFetch('/api/skills');
    const skills = data.skills || [];
    // Create button always first
    let html = '<div class="card" style="padding:12px;border:2px dashed var(--border);cursor:pointer;text-align:center" onclick="openSkillEditor()">' +
      '<div style="font-size:24px;opacity:0.5">+</div>' +
      '<div style="font-size:13px;color:var(--text-muted)">Create New Skill</div>' +
    '</div>';
    if (skills.length) {
      html += skills.map(s => {
        const sid = escHtml(String(s.name || s.id || ''));
        return '<div class="card" style="padding:12px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
            '<div style="flex:1;cursor:pointer" onclick="openSkillEditor(\\'' + sid + '\\')">' +
              '<div style="font-weight:600;margin-bottom:4px">' + escHtml(s.name) + '</div>' +
              '<div style="font-size:12px;color:var(--text-muted)">' + escHtml(s.description || 'No description') + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:4px">' +
              '<button class="btn btn-ghost btn-sm" onclick="openSkillEditor(\\'' + sid + '\\')" title="Edit">&#9998;</button>' +
              '<button class="btn btn-danger btn-sm" onclick="deleteSkill(\\'' + sid + '\\',this)" title="Delete">&#128465;</button>' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:6px"><span class="badge badge-' + (s.source === 'user' ? 'purple' : 'gray') + '">' + escHtml(s.source || 'system') + '</span></div>' +
        '</div>';
      }).join('');
    }
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div style="color:var(--red)">Failed to load skills</div>';
  }
}

async function deleteSkill(name, btn) {
  if (!confirm('Delete skill "' + name + '"?')) return;
  btn.disabled = true;
  try {
    await apiFetch('/api/skills/' + encodeURIComponent(name), { method: 'DELETE' });
    toast('Skill deleted', 'success');
    loadSkills();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; }
}

let skillEditorMode = 'create'; // 'create' or 'edit'
async function openSkillEditor(name) {
  if (name) {
    skillEditorMode = 'edit';
    document.getElementById('skill-editor-title').textContent = 'Edit Skill: ' + name;
    document.getElementById('skill-editor-name').value = name;
    document.getElementById('skill-editor-name').readOnly = true;
    try {
      const data = await apiFetch('/api/skills/' + encodeURIComponent(name));
      document.getElementById('skill-editor-content').value = data.content || '';
    } catch { document.getElementById('skill-editor-content').value = ''; }
  } else {
    skillEditorMode = 'create';
    document.getElementById('skill-editor-title').textContent = 'Create New Skill';
    document.getElementById('skill-editor-name').value = '';
    document.getElementById('skill-editor-name').readOnly = false;
    document.getElementById('skill-editor-content').value = '---\\nname: my-skill\\ndescription: What this skill does\\n---\\n\\n# My Skill\\n\\n## When to Use\\nDescribe triggers\\n\\n## Instructions\\n1. Step one\\n2. Step two\\n';
  }
  openModal('modal-skill-editor');
}

async function saveSkillEditor() {
  const name = document.getElementById('skill-editor-name').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const content = document.getElementById('skill-editor-content').value;
  if (!name || !content) { toast('Name and content required', 'error'); return; }
  const btn = document.getElementById('skill-editor-save');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    if (skillEditorMode === 'edit') {
      await apiFetch('/api/skills/' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    } else {
      await apiFetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content }) });
    }
    toast('Skill saved: ' + name, 'success');
    closeModal('modal-skill-editor');
    loadSkills();
  } catch(err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}

let agentEditorMode = 'create';
async function openAgentEditor(id) {
  if (id) {
    agentEditorMode = 'edit';
    document.getElementById('agent-editor-title').textContent = 'Edit Agent: @' + id;
    document.getElementById('agent-editor-id').value = id;
    document.getElementById('agent-editor-id').readOnly = true;
    try {
      const data = await apiFetch('/api/agents/' + encodeURIComponent(id) + '/prompt');
      document.getElementById('agent-editor-lane').value = data.lane || 'build';
      document.getElementById('agent-editor-model').value = data.model || 'claude-sonnet-4-6';
      document.getElementById('agent-editor-content').value = data.fullContent || data.systemPrompt || '';
    } catch { document.getElementById('agent-editor-content').value = ''; }
  } else {
    agentEditorMode = 'create';
    document.getElementById('agent-editor-title').textContent = 'Create New Agent';
    document.getElementById('agent-editor-id').value = '';
    document.getElementById('agent-editor-id').readOnly = false;
    document.getElementById('agent-editor-lane').value = 'build';
    document.getElementById('agent-editor-model').value = 'claude-sonnet-4-6';
    document.getElementById('agent-editor-content').value = '---\\nname: my-agent\\ndescription: What this agent does. Trigger keywords.\\nmodel: claude-sonnet-4-6\\nlane: build\\n---\\n\\n# Role\\nYou are a specialized agent.\\n\\n# Success Criteria\\n- Measurable outcomes\\n\\n# Constraints\\n- Boundaries\\n\\n# Execution Protocol\\n1. Steps\\n';
  }
  openModal('modal-agent-editor');
}

async function updateAgentModel(agentId, model) {
  try {
    await apiFetch('/api/agents/' + encodeURIComponent(agentId) + '/model', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
    toast('Model updated: ' + model.split('-').slice(-2, -1)[0], 'success');
    loadAgents();
  } catch(err) { toast(err.message, 'error'); }
}

async function saveAgentEditor() {
  const id = document.getElementById('agent-editor-id').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const lane = document.getElementById('agent-editor-lane').value;
  const model = document.getElementById('agent-editor-model').value;
  const content = document.getElementById('agent-editor-content').value;
  if (!id || !content) { toast('ID and content required', 'error'); return; }
  const btn = document.getElementById('agent-editor-save');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    if (agentEditorMode === 'edit') {
      await apiFetch('/api/agents/' + encodeURIComponent(id) + '/prompt', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, model, lane }) });
    } else {
      await apiFetch('/api/agents/registry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: id, description: '', model, lane, systemPrompt: content }) });
    }
    toast('Agent saved: @' + id, 'success');
    closeModal('modal-agent-editor');
    loadAgents();
  } catch(err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}

async function loadMcpServers() {
  const installedEl = document.getElementById('mcp-installed-list');
  const availableEl = document.getElementById('mcp-available-list');
  installedEl.innerHTML = '<div class="chat-thinking" style="padding:12px 0">Loading MCP servers...</div>';
  availableEl.innerHTML = '';
  try {
    const data = await apiFetch('/api/mcp');
    const installed = data.installed || [];
    const available = data.available || [];
    // Installed
    if (!installed.length) {
      installedEl.innerHTML = '<div style="color:var(--text-muted);padding:12px;font-size:13px">No MCP servers installed.</div>';
    } else {
      installedEl.innerHTML = installed.map(s => {
        const sid = escHtml(String(s.id || s.name || ''));
        const status = s.status === 'running' || s.connected
          ? '<span class="badge badge-green">running</span>'
          : '<span class="badge badge-gray">stopped</span>';
        return '<div class="mcp-card">' +
          '<div class="mcp-card-header">' +
            '<div>' +
              '<div style="font-weight:600;font-size:13px">' + escHtml(s.name || s.id) + '</div>' +
              '<div style="font-size:11px;color:var(--text-muted)">' + escHtml(s.description || '') + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center">' +
              status +
              '<button class="btn btn-danger btn-sm" onclick="removeMcp(\\'' + sid + '\\',this)" title="Remove">&#128465;</button>' +
            '</div>' +
          '</div>' +
          (s.tools ? '<div style="font-size:11px;color:var(--text-dim);margin-top:6px">' + (s.tools || 0) + ' tools</div>' : '') +
        '</div>';
      }).join('');
    }
    // Available
    if (!available.length) {
      availableEl.innerHTML = '<div style="color:var(--text-muted);padding:12px;font-size:13px">No additional MCP servers available.</div>';
    } else {
      availableEl.innerHTML = available.map(s => {
        const sid = escHtml(String(s.id || s.name || ''));
        const missingSecrets = s.missingSecrets || [];
        let secretsHtml = '';
        if (missingSecrets.length) {
          secretsHtml = '<div style="margin-top:6px;font-size:11px;color:var(--yellow)">' +
            'Missing secrets: ' + missingSecrets.map(k => '<a href="#" onclick="navigate(\\\'settings\\\');return false" style="color:var(--yellow)">' + escHtml(k) + '</a>').join(', ') +
            '</div>';
        }
        return '<div class="mcp-card">' +
          '<div class="mcp-card-header">' +
            '<div>' +
              '<div style="font-weight:600;font-size:13px">' + escHtml(s.name || s.id) + '</div>' +
              '<div style="font-size:11px;color:var(--text-muted)">' + escHtml(s.description || '') + '</div>' +
            '</div>' +
            '<button class="btn btn-primary btn-sm" onclick="installMcp(\\'' + sid + '\\',this)">Install</button>' +
          '</div>' +
          secretsHtml +
        '</div>';
      }).join('');
    }
  } catch(err) {
    installedEl.innerHTML = '<div style="color:var(--text-muted);padding:12px;font-size:13px">' +
      'Use <code>/mcp</code> in Telegram to manage MCP servers. 30 pre-configured servers: Notion, GitHub, Slack, Google Drive, and more.</div>';
    availableEl.innerHTML = '';
  }
}

async function installMcp(id, btn) {
  btn.disabled = true;
  btn.textContent = 'Installing...';
  try {
    const result = await apiFetch('/api/mcp/' + encodeURIComponent(id) + '/install', { method: 'POST' });
    toast('MCP server installed: ' + id, 'success');
    if (result.missingSecrets && result.missingSecrets.length) {
      toast('Missing secrets: ' + result.missingSecrets.join(', ') + '. Go to Settings to configure.', 'error');
    }
    loadMcpServers();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Install'; }
}

async function removeMcp(id, btn) {
  if (!confirm('Remove MCP server "' + id + '"?')) return;
  btn.disabled = true;
  try {
    await apiFetch('/api/mcp/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('MCP server removed', 'success');
    loadMcpServers();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; }
}

// ─────────────────────────────────────────────
// System Vitals
// ─────────────────────────────────────────────
async function loadVitals() {
  const el = document.getElementById('vitals-content');
  try {
    const d = await apiFetch('/api/vitals');
    const sys = d.system || {};
    const proc = d.process || {};
    const usedPct = sys.usedMemPct || 0;
    const usedColor = usedPct > 85 ? 'red' : usedPct > 65 ? 'yellow' : 'green';
    const load = parseFloat(sys.loadAvg1m || 0);
    const loadColor = load > 2 ? 'red' : load > 1 ? 'yellow' : 'green';
    const temp = sys.temperature;
    const tempColor = temp ? (parseFloat(temp) > 70 ? 'red' : parseFloat(temp) > 55 ? 'yellow' : 'green') : 'text-muted';
    const disk = sys.disk || {};

    el.innerHTML =
      '<div class="vitals-grid">' +
        '<div class="vitals-card">' +
          '<div class="vitals-label">CPU Load (1m / 5m / 15m)</div>' +
          '<div class="vitals-val" style="color:var(--' + loadColor + ')">' + load.toFixed(2) + '</div>' +
          '<div class="vitals-sub">' + (sys.loadAvg5m || '0') + ' / ' + (sys.loadAvg15m || '0') + ' &middot; ' + (sys.cpuCount || '?') + ' cores</div>' +
        '</div>' +
        '<div class="vitals-card">' +
          '<div class="vitals-label">RAM Used</div>' +
          '<div class="vitals-val" style="color:var(--' + usedColor + ')">' + usedPct + '%</div>' +
          '<div class="progress-wrap"><div class="progress-bar ' + usedColor + '" style="width:' + usedPct + '%"></div></div>' +
          '<div class="vitals-sub">' + Math.round((sys.totalMemMB - sys.freeMemMB) || 0) + ' MB / ' + (sys.totalMemMB || '?') + ' MB</div>' +
        '</div>' +
        '<div class="vitals-card">' +
          '<div class="vitals-label">Heap / RSS</div>' +
          '<div class="vitals-val">' + (proc.heapUsedMB || 0) + ' / ' + (proc.rssMB || 0) + ' MB</div>' +
          '<div class="vitals-sub">Heap: ' + (proc.heapTotalMB || '?') + ' MB total &middot; External: ' + (proc.externalMB || 0) + ' MB</div>' +
        '</div>' +
        '<div class="vitals-card">' +
          '<div class="vitals-label">Process Uptime</div>' +
          '<div class="vitals-val">' + fmtUptime(proc.uptimeMin || 0) + '</div>' +
          '<div class="vitals-sub">System: ' + (sys.sysUptimeHours || 0) + 'h &middot; PID ' + (proc.pid || '?') + ' &middot; ' + escHtml(proc.nodeVersion || '') + '</div>' +
        '</div>' +
        (temp ? '<div class="vitals-card">' +
          '<div class="vitals-label">Temperature</div>' +
          '<div class="vitals-val" style="color:var(--' + tempColor + ')">' + escHtml(temp) + '</div>' +
          '<div class="vitals-sub">' + escHtml(sys.hostname || '') + ' &middot; ' + escHtml(sys.platform || '') + ' ' + escHtml(sys.arch || '') + '</div>' +
        '</div>' : '') +
        (disk.total ? '<div class="vitals-card">' +
          '<div class="vitals-label">Disk Usage</div>' +
          '<div class="vitals-val">' + escHtml(disk.usedPct || '?') + '</div>' +
          '<div class="vitals-sub">' + escHtml(disk.used || '?') + ' / ' + escHtml(disk.total || '?') + ' (free: ' + escHtml(disk.free || '?') + ')</div>' +
        '</div>' : '') +
        ((sys.network || []).length ? '<div class="vitals-card">' +
          '<div class="vitals-label">Network</div>' +
          '<div class="vitals-val" style="font-size:14px">' + sys.network.map(n => escHtml(n.ip)).join(', ') + '</div>' +
          '<div class="vitals-sub">' + sys.network.map(n => escHtml(n.interface)).join(', ') + '</div>' +
        '</div>' : '') +
      '</div>';
  } catch(err) {
    el.innerHTML = '<div style="color:var(--red);padding:10px">' + escHtml(err.message) + '</div>';
  }
}

function fmtUptime(min) {
  if (min < 60) return min + 'm';
  if (min < 1440) return Math.floor(min/60) + 'h ' + (min%60) + 'm';
  return Math.floor(min/1440) + 'd ' + Math.floor((min%1440)/60) + 'h';
}

async function loadTokens() {
  const el = document.getElementById('tokens-content');
  try {
    const d = await apiFetch('/api/tokens');
    const s = d.stats || {};
    el.innerHTML =
      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="stat-val">' + fmtNum(s.tokensToday || 0) + '</div><div class="stat-label">Tokens Today</div></div>' +
        '<div class="stat-card"><div class="stat-val">$' + (s.costToday || 0).toFixed(3) + '</div><div class="stat-label">Cost Today</div></div>' +
        '<div class="stat-card"><div class="stat-val">$' + (s.costMonth || s.costThisMonth || 0).toFixed(2) + '</div><div class="stat-label">Cost This Month</div></div>' +
        '<div class="stat-card"><div class="stat-val">' + fmtNum(s.tokensTotal || 0) + '</div><div class="stat-label">Total Tokens</div></div>' +
      '</div>';
  } catch(err) {
    el.innerHTML = '<div style="color:var(--red);padding:10px">' + escHtml(err.message) + '</div>';
  }
}

function fmtNum(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1) + 'K';
  return String(n);
}

// ─────────────────────────────────────────────
// System Update — upgrade / downgrade
// ─────────────────────────────────────────────
let _upgradePolling = false;

async function loadVersions() {
  const el = document.getElementById('update-content');
  try {
    const d = await apiFetch('/api/system/versions');
    const current = d.current || 'unknown';
    const remote = d.remote || current;
    const upToDate = d.upToDate !== false && current === remote;
    const behindBy = d.behindBy || 0;
    const commits = d.commits || [];
    const currentCommit = commits[0] || {};

    const statusBadge = upToDate
      ? '<span style="background:var(--green);color:#000;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">UP TO DATE</span>'
      : '<span style="background:var(--yellow);color:#000;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">' + behindBy + ' COMMIT' + (behindBy !== 1 ? 'S' : '') + ' BEHIND</span>';

    const upgradeBtn = upToDate
      ? '<button class="btn" id="upgrade-btn" onclick="confirmUpgrade()" style="opacity:0.5" title="Already up to date">&#8593; Upgrade</button>'
      : '<button class="btn btn-primary" id="upgrade-btn" onclick="confirmUpgrade()">&#8593; Upgrade</button>';

    const downgradeOptions = commits.slice(1).map(c =>
      '<option value="' + escHtml(c.hash) + '">' + escHtml(c.hash) + ' — ' + escHtml(c.message) + ' (' + escHtml(c.date) + ')</option>'
    ).join('');

    el.innerHTML =
      '<div class="card" style="margin-bottom:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px">' +
          '<div class="card-title" style="margin:0">VERSION</div>' +
          statusBadge +
        '</div>' +
        // Installed row
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:3px">INSTALLED</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<span style="font-family:monospace;color:var(--accent-light);font-size:14px">' + escHtml(current) + '</span>' +
              '<span style="color:var(--text-muted);font-size:13px">' + escHtml(currentCommit.message || '') + '</span>' +
              '<span style="color:var(--text-dim);font-size:11px">' + escHtml(currentCommit.date || '') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // Latest on git row (only if different)
        (!upToDate ?
          '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:3px">LATEST ON GIT</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<span style="font-family:monospace;color:var(--yellow);font-size:14px">' + escHtml(remote) + '</span>' +
              '<span style="color:var(--text-muted);font-size:13px">' + escHtml(d.remoteMessage || '') + '</span>' +
              '<span style="color:var(--text-dim);font-size:11px">' + escHtml(d.remoteDate || '') + '</span>' +
            '</div>' +
          '</div>'
        : '') +
        // Upgrade button
        '<div style="margin-top:12px;display:flex;justify-content:flex-end">' +
          upgradeBtn +
        '</div>' +
        '<div id="upgrade-log" style="display:none;margin-top:12px;font-family:monospace;font-size:12px;' +
          'background:var(--bg-input);border-radius:6px;padding:12px;line-height:1.8;max-height:200px;overflow-y:auto"></div>' +
      '</div>' +
      (downgradeOptions ?
        '<div class="card">' +
          '<div class="card-title">DOWNGRADE</div>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<select id="downgrade-select" style="flex:1;background:var(--bg-input);color:var(--text);border:1px solid var(--border);' +
              'border-radius:6px;padding:6px 10px;font-size:13px">' +
              downgradeOptions +
            '</select>' +
            '<button class="btn btn-danger" id="downgrade-btn" onclick="confirmDowngrade()">&#8595; Downgrade</button>' +
          '</div>' +
          '<div style="margin-top:6px;font-size:11px;color:var(--text-dim)">&#9888;&#65039; Reverts to a previous commit, rebuilds, and restarts the service.</div>' +
          '<div id="downgrade-log" style="display:none;margin-top:12px;font-family:monospace;font-size:12px;' +
            'background:var(--bg-input);border-radius:6px;padding:12px;line-height:1.8;max-height:200px;overflow-y:auto"></div>' +
        '</div>'
      : '');
  } catch(err) {
    el.innerHTML = '<div style="color:var(--red);padding:10px">' + escHtml(err.message) + '</div>';
  }
}

function confirmUpgrade() {
  if (!confirm('Upgrade WildClaude? The service will pull the latest code, rebuild, and restart. The dashboard will reconnect automatically.')) return;
  startSystemOp('upgrade', null);
}

function confirmDowngrade() {
  const sel = document.getElementById('downgrade-select');
  if (!sel) return;
  const commit = sel.value;
  const label = sel.options[sel.selectedIndex]?.text || commit;
  if (!confirm('Downgrade to ' + label + '? The service will check out this commit, rebuild, and restart. The dashboard will reconnect automatically.')) return;
  startSystemOp('downgrade', commit);
}

async function startSystemOp(op, commit) {
  const logId = op === 'upgrade' ? 'upgrade-log' : 'downgrade-log';
  const btnId = op === 'upgrade' ? 'upgrade-btn' : 'downgrade-btn';
  const logEl = document.getElementById(logId);
  const btnEl = document.getElementById(btnId);
  if (!logEl) return;

  logEl.style.display = 'block';
  logEl.innerHTML = '';
  if (btnEl) btnEl.disabled = true;

  function appendLog(icon, text, color) {
    logEl.innerHTML += '<div style="color:' + (color || 'var(--text)') + '">' + icon + ' ' + escHtml(text) + '</div>';
    logEl.scrollTop = logEl.scrollHeight;
  }

  try {
    appendLog('⏳', 'Starting ' + op + '...', 'var(--text-muted)');
    const url = '/api/system/' + op;
    const body = op === 'downgrade' ? JSON.stringify({ commit }) : '{}';
    await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    appendLog('✓', 'Job started', 'var(--green)');

    // Poll status
    _upgradePolling = true;
    let lastStatus = '';
    const statusIcons = { pulling: '📥', 'checking-out': '📦', building: '🔨', restarting: '🔄', done: '✅', error: '❌' };

    while (_upgradePolling) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const s = await apiFetch('/api/system/upgrade/status');
        if (s.status !== lastStatus && s.status !== 'idle') {
          const icon = statusIcons[s.status] || '↺';
          const color = s.status === 'error' ? 'var(--red)' : s.status === 'restarting' ? 'var(--yellow)' : s.status === 'done' ? 'var(--green)' : 'var(--text-muted)';
          appendLog(icon, s.message || s.status, color);
          lastStatus = s.status;
        }
        if (s.status === 'error') {
          _upgradePolling = false;
          if (btnEl) btnEl.disabled = false;
          break;
        }
        if (s.status === 'restarting' || s.status === 'done') {
          _upgradePolling = false;
          // Wait for service to come back (either systemd restart or direct node restart)
          await new Promise(r => setTimeout(r, 3000));
          appendLog('🔌', 'Waiting for service to come back online...', 'var(--text-muted)');
          await waitForRestart(logEl);
          break;
        }
      } catch { /* service may have gone down during restart — normal */ break; }
    }
  } catch(err) {
    appendLog('❌', err.message || 'Failed', 'var(--red)');
    if (btnEl) btnEl.disabled = false;
  }
}

async function waitForRestart(logEl) {
  const start = Date.now();
  const maxWait = 120000; // 2 min
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const r = await fetch(apiUrl('/api/system/upgrade/status'), { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        logEl.innerHTML += '<div style="color:var(--green)">✅ Service is back online!</div>';
        logEl.innerHTML += '<div style="color:var(--text-muted);font-size:11px">Reloading in 2 seconds...</div>';
        logEl.scrollTop = logEl.scrollHeight;
        await new Promise(r => setTimeout(r, 2000));
        location.reload();
        return;
      }
    } catch { /* still down */ }
  }
  logEl.innerHTML += '<div style="color:var(--yellow)">⚠️ Service did not respond within 2 minutes. Check manually.</div>';
  logEl.scrollTop = logEl.scrollHeight;
}

async function restartService() {
  if (!confirm('Restart the WildClaude service? The dashboard will reconnect automatically.')) return;
  const logEl = document.getElementById('restart-log');
  const btnEl = document.getElementById('restart-btn');
  logEl.style.display = 'block';
  logEl.innerHTML = '';
  if (btnEl) btnEl.disabled = true;
  function appendRestartLog(icon, text, color) {
    logEl.innerHTML += '<div style="color:' + (color || 'var(--text)') + '">' + icon + ' ' + escHtml(text) + '</div>';
    logEl.scrollTop = logEl.scrollHeight;
  }
  try {
    appendRestartLog('⏳', 'Sending restart command...', 'var(--text-muted)');
    await apiFetch('/api/system/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    appendRestartLog('✓', 'Restart initiated', 'var(--green)');
    await new Promise(r => setTimeout(r, 3000));
    appendRestartLog('🔌', 'Waiting for service to come back online...', 'var(--text-muted)');
    await waitForRestart(logEl);
  } catch(err) {
    appendRestartLog('❌', err.message || 'Failed', 'var(--red)');
    if (btnEl) btnEl.disabled = false;
  }
}

function confirmReboot() {
  if (!confirm('Reboot the host device? The dashboard will be unavailable for ~30-60 seconds while it restarts.')) return;
  rebootDevice();
}

async function rebootDevice() {
  const logEl = document.getElementById('reboot-log');
  const btnEl = document.getElementById('reboot-btn');
  logEl.style.display = 'block';
  logEl.innerHTML = '';
  if (btnEl) btnEl.disabled = true;
  function appendRebootLog(icon, text, color) {
    logEl.innerHTML += '<div style="color:' + (color || 'var(--text)') + '">' + icon + ' ' + escHtml(text) + '</div>';
    logEl.scrollTop = logEl.scrollHeight;
  }
  try {
    appendRebootLog('⏳', 'Sending reboot command...', 'var(--text-muted)');
    await apiFetch('/api/system/reboot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    appendRebootLog('🔄', 'Device is rebooting...', 'var(--yellow)');
    appendRebootLog('🔌', 'Waiting for device to come back online (~30-60s)...', 'var(--text-muted)');
    await new Promise(r => setTimeout(r, 12000));
    await waitForRestart(logEl);
  } catch(err) {
    appendRebootLog('❌', err.message || 'Failed', 'var(--red)');
    if (btnEl) btnEl.disabled = false;
  }
}

// ─────────────────────────────────────────────
// Daily Journal — recent conversations
// ─────────────────────────────────────────────
async function loadJournal() {
  const list = document.getElementById('journal-list');
  const loading = document.getElementById('journal-loading');
  const empty = document.getElementById('journal-empty');
  list.innerHTML = '';
  loading.style.display = 'block';
  empty.style.display = 'none';
  try {
    const info = await apiFetch('/api/info');
    const chatId = info.chatId || '';
    if (!chatId) {
      loading.style.display = 'none';
      empty.style.display = 'block';
      return;
    }
    const data = await apiFetch('/api/chat/history?chatId=' + encodeURIComponent(chatId) + '&limit=5');
    const turns = (data.turns || []).slice(0, 5);
    loading.style.display = 'none';
    if (!turns.length) { empty.style.display = 'block'; return; }
    // Group into conversation-like blocks
    const div = document.createElement('div');
    div.className = 'conv-item';
    let html = '';
    turns.forEach(t => {
      const role = t.role || '';
      const text = Array.isArray(t.content)
        ? t.content.filter(c=>c.type==='text').map(c=>c.text).join('').substring(0,300)
        : String(t.content || '').substring(0,300);
      const ellipsis = (String(t.content||'').length > 300) ? '...' : '';
      html += '<div style="margin-bottom:8px">' +
        '<b style="color:var(--' + (role==='user'?'accent-light':'green') + ')">' + escHtml(role) + '</b>: ' +
        '<span class="conv-turns-preview">' + escHtml(text) + ellipsis + '</span>' +
        (t.model ? ' ' + modelBadge(t.model) : '') +
        '</div>';
    });
    div.innerHTML = html;
    list.appendChild(div);
  } catch(err) {
    loading.style.display = 'none';
    list.innerHTML = '<div style="color:var(--red);padding:10px">' + escHtml(err.message) + '</div>';
  }
}

// ─────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// Automations
// ─────────────────────────────────────────────
let automationsCache = [];

async function loadAutomations() {
  const el = document.getElementById('automations-list');
  if (!el) return;
  try {
    const data = await apiFetch('/api/automations');
    automationsCache = data.automations || [];
    renderAutomations(automationsCache);
  } catch(err) {
    el.innerHTML = '<div style="color:var(--red);padding:8px">' + escHtml(err.message) + '</div>';
  }
}

function statusBadge(auto) {
  const s = auto.status;
  if (!auto.enabled) return '<span class="badge" style="background:var(--bg3);color:var(--text-muted)">disabled</span>';
  if (s === 'not-installed') return '<span class="badge" style="background:var(--bg3);color:var(--text-muted)">not installed</span>';
  if (s === 'running') return '<span class="badge badge-blue">running</span>';
  if (s === 'paused') return '<span class="badge" style="background:var(--yellow,#f59e0b);color:#000">paused</span>';
  if (auto.last_status === 'failed') return '<span class="badge" style="background:var(--red);color:#fff">last: failed</span>';
  if (auto.last_status === 'timeout') return '<span class="badge" style="background:var(--yellow,#f59e0b);color:#000">last: timeout</span>';
  return '<span class="badge badge-green">active</span>';
}

function renderAutomations(list) {
  const el = document.getElementById('automations-list');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">No automations configured.</div>';
    return;
  }
  el.innerHTML = list.map(a => {
    const lastRun = a.last_run ? new Date(a.last_run * 1000).toLocaleString() : 'never';
    const nextRun = a.next_run ? new Date(a.next_run * 1000).toLocaleString() : '-';
    const snippet = a.last_result ? escHtml(a.last_result.slice(0,100)) + (a.last_result.length > 100 ? '...' : '') : '';
    const toggleLabel = a.enabled ? 'Disable' : 'Enable';
    const toggleStyle = a.enabled ? 'color:var(--red)' : 'color:var(--green)';
    return \`<div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
            <span style="font-weight:600;font-size:13px">\${escHtml(a.name)}</span>
            \${statusBadge(a)}
            \${a.source === 'user' ? '<span class="badge badge-purple">custom</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">
            <code style="background:var(--bg3);padding:1px 5px;border-radius:3px">\${escHtml(a.cron)}</code>
            &nbsp;Last: \${escHtml(lastRun)}&nbsp;|&nbsp;Next: \${escHtml(nextRun)}
          </div>
          \${snippet ? \`<div style="font-size:11px;color:var(--text-dim);font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\${snippet}</div>\` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" style="\${toggleStyle}" onclick="toggleAutomation('\${escHtml(a.id)}', \${!a.enabled})">\${toggleLabel}</button>
          <button class="btn btn-ghost btn-sm" onclick="editAutomationSchedule('\${escHtml(a.id)}')">Edit</button>
        </div>
      </div>
    </div>\`;
  }).join('');
}

async function toggleAutomation(id, enabled) {
  try {
    await apiFetch('/api/automations/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    toast(enabled ? 'Automation enabled' : 'Automation disabled', 'success');
    loadAutomations();
  } catch(err) { toast(err.message, 'error'); }
}

function editAutomationSchedule(id) {
  const auto = automationsCache.find(a => a.id === id);
  if (!auto) return;
  document.getElementById('automation-modal-id').value = id;
  document.getElementById('automation-modal-title').textContent = 'Edit: ' + auto.name;
  document.getElementById('automation-modal-name').value = auto.name;
  document.getElementById('automation-modal-cron').value = auto.cron;
  document.getElementById('automation-modal-prompt').value = auto.prompt || '';
  const modal = document.getElementById('automation-modal');
  modal.style.display = 'flex';
}

function closeAutomationModal() {
  document.getElementById('automation-modal').style.display = 'none';
}

async function saveAutomationModal() {
  const id = document.getElementById('automation-modal-id').value;
  const name = document.getElementById('automation-modal-name').value.trim();
  const cron = document.getElementById('automation-modal-cron').value.trim();
  const prompt = document.getElementById('automation-modal-prompt').value.trim();
  if (!cron) { toast('Cron expression required', 'error'); return; }
  try {
    await apiFetch('/api/automations/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cron, prompt })
    });
    closeAutomationModal();
    toast('Automation updated', 'success');
    loadAutomations();
  } catch(err) { toast(err.message, 'error'); }
}

function showNewAutomationModal() {
  document.getElementById('new-auto-name').value = '';
  document.getElementById('new-auto-cron').value = '0 9 * * *';
  document.getElementById('new-auto-prompt').value = '';
  document.getElementById('new-automation-modal').style.display = 'flex';
}

function closeNewAutomationModal() {
  document.getElementById('new-automation-modal').style.display = 'none';
}

async function createCustomAutomation() {
  const name = document.getElementById('new-auto-name').value.trim();
  const cron = document.getElementById('new-auto-cron').value.trim();
  const prompt = document.getElementById('new-auto-prompt').value.trim();
  if (!name) { toast('Name required', 'error'); return; }
  if (!cron) { toast('Cron expression required', 'error'); return; }
  if (!prompt) { toast('Prompt required', 'error'); return; }
  try {
    await apiFetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cron, prompt })
    });
    closeNewAutomationModal();
    toast('Automation created', 'success');
    loadAutomations();
  } catch(err) { toast(err.message, 'error'); }
}

// Close modals on backdrop click
document.addEventListener('click', function(e) {
  const autoModal = document.getElementById('automation-modal');
  const newAutoModal = document.getElementById('new-automation-modal');
  if (e.target === autoModal) closeAutomationModal();
  if (e.target === newAutoModal) closeNewAutomationModal();
});

// ─────────────────────────────────────────────
// Profile Editor
// ─────────────────────────────────────────────
let currentProfileDomain = 'me';
let profileData = {};

async function loadProfileEditor(domain) {
  currentProfileDomain = domain || 'me';
  // Update tab styles
  ['me','goals','health','finance','learning'].forEach(d => {
    const tab = document.getElementById('profile-tab-' + d);
    if (tab) tab.style.borderColor = d === currentProfileDomain ? 'var(--accent)' : 'var(--border)';
  });
  try {
    const data = await apiFetch('/api/profile');
    profileData = data.profile || {};
    document.getElementById('profile-editor-content').value = profileData[currentProfileDomain] || '# ' + currentProfileDomain + '\\n\\nNo data yet. Edit here.';
  } catch(err) {
    document.getElementById('profile-editor-content').value = '# Error loading profile: ' + err.message;
  }
}

async function saveProfile() {
  const content = document.getElementById('profile-editor-content').value;
  if (!content) return;
  try {
    await apiFetch('/api/profile/' + encodeURIComponent(currentProfileDomain), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    toast('Profile saved: ' + currentProfileDomain, 'success');
  } catch(err) { toast(err.message, 'error'); }
}

async function loadImportSources() {
  const el = document.getElementById('import-sources');
  try {
    const data = await apiFetch('/api/import/sources');
    const sources = data.sources || [];
    if (!sources.length) {
      el.innerHTML = 'No importable sources detected.';
      return;
    }
    el.innerHTML = sources.map((s, i) =>
      '<div style="margin-bottom:6px">' +
        '<span class="badge badge-' + (s.type === 'claude-mem' ? 'purple' : 'blue') + '">' + escHtml(s.type) + '</span> ' +
        escHtml(s.description) +
      '</div>'
    ).join('');
  } catch(err) {
    el.innerHTML = 'Could not scan sources.';
  }
}

async function runImport() {
  const el = document.getElementById('import-result');
  el.innerHTML = '<span style="color:var(--accent)">Importing...</span>';
  try {
    const data = await apiFetch('/api/import/auto', { method: 'POST' });
    el.innerHTML = '<span style="color:var(--green)">Imported ' + (data.totalMemories || 0) + ' memories from ' + (data.totalFiles || 0) + ' files</span>';
    toast('Import complete: ' + (data.totalMemories || 0) + ' memories', 'success');
  } catch(err) {
    el.innerHTML = '<span style="color:var(--red)">' + escHtml(err.message) + '</span>';
  }
}

// ─────────────────────────────────────────────
// Bot Identity
// ─────────────────────────────────────────────
let currentIdentityTheme = 'purple';

async function loadIdentity() {
  try {
    const data = await apiFetch('/api/config');
    const id = data.botIdentity || {};
    document.getElementById('identity-name').value = id.name || '';
    document.getElementById('identity-emoji').value = id.emoji || '';
    document.getElementById('identity-tagline').value = id.tagline || '';
    document.getElementById('identity-welcome').value = id.welcomeMessage || '';
    currentIdentityTheme = id.theme || 'purple';
  } catch {}
}

function setIdentityTheme(theme) {
  currentIdentityTheme = theme;
  // Preview immediately
  const themeColors = { purple: '#7c3aed', blue: '#3b82f6', green: '#10b981', dark: '#64748b' };
  if (themeColors[theme]) {
    document.documentElement.style.setProperty('--accent', themeColors[theme]);
    document.documentElement.style.setProperty('--accent-light', themeColors[theme] + 'cc');
  }
}

async function saveIdentity() {
  const identity = {
    name: document.getElementById('identity-name').value.trim() || undefined,
    emoji: document.getElementById('identity-emoji').value.trim() || undefined,
    tagline: document.getElementById('identity-tagline').value.trim() || undefined,
    welcomeMessage: document.getElementById('identity-welcome').value.trim() || undefined,
    theme: currentIdentityTheme,
  };
  try {
    await apiFetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botIdentity: identity })
    });
    toast('Identity saved', 'success');
    loadBotIdentity(); // refresh sidebar
  } catch(err) { toast(err.message, 'error'); }
}

// ─────────────────────────────────────────────
// Verbosity
// ─────────────────────────────────────────────
async function loadVerbosity() {
  try {
    const d = await apiFetch('/api/verbosity');
    document.getElementById('verbosity-level').value = d.level || 'normal';
    document.getElementById('verbosity-tools').checked = d.showTools !== false;
    document.getElementById('verbosity-subagents').checked = d.showSubAgents !== false;
    document.getElementById('verbosity-routing').checked = d.showRouting === true;
    document.getElementById('verbosity-memory').checked = d.showMemory !== false;
    document.getElementById('verbosity-progress').checked = d.showProgress !== false;
    applyVerbosityPreset(d.level || 'normal');
  } catch {}
}

function applyVerbosityPreset(level) {
  // When level changes, auto-set the checkboxes to match
  const presets = {
    minimal:  { showTools: false, showSubAgents: false, showRouting: false, showMemory: false, showProgress: false },
    normal:   { showTools: true,  showSubAgents: true,  showRouting: false, showMemory: true,  showProgress: true },
    detailed: { showTools: true,  showSubAgents: true,  showRouting: true,  showMemory: true,  showProgress: true },
    debug:    { showTools: true,  showSubAgents: true,  showRouting: true,  showMemory: true,  showProgress: true },
  };
  const p = presets[level];
  if (p) {
    document.getElementById('verbosity-tools').checked = p.showTools;
    document.getElementById('verbosity-subagents').checked = p.showSubAgents;
    document.getElementById('verbosity-routing').checked = p.showRouting;
    document.getElementById('verbosity-memory').checked = p.showMemory;
    document.getElementById('verbosity-progress').checked = p.showProgress;
  }
}

async function saveVerbosity() {
  const level = document.getElementById('verbosity-level').value;
  // If level changed, apply preset first
  applyVerbosityPreset(level);
  const config = {
    level,
    showTools: document.getElementById('verbosity-tools').checked,
    showSubAgents: document.getElementById('verbosity-subagents').checked,
    showRouting: document.getElementById('verbosity-routing').checked,
    showMemory: document.getElementById('verbosity-memory').checked,
    showProgress: document.getElementById('verbosity-progress').checked,
  };
  try {
    await apiFetch('/api/verbosity', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    document.getElementById('verbosity-status').textContent = 'Saved. Takes effect immediately.';
    setTimeout(() => { document.getElementById('verbosity-status').textContent = ''; }, 3000);
  } catch(err) { toast(err.message, 'error'); }
}

async function loadSettings() {
  try {
    const [info, health] = await Promise.all([
      apiFetch('/api/info'),
      apiFetch('/api/health')
    ]);
    const setVal = (id, v, color) => {
      const el = document.getElementById(id);
      if (el) { el.textContent = v; if (color) el.style.color = color; }
    };
    setVal('settings-bot-name', info.botName || info.botUsername || '-');
    setVal('settings-pid', String(info.pid || '-'));
    setVal('settings-bot-status', health.telegramConnected ? 'Connected' : 'Disconnected',
      health.telegramConnected ? 'var(--green)' : 'var(--red)');
    setVal('settings-telegram', health.telegramConnected ? 'Connected' : 'Disconnected',
      health.telegramConnected ? 'var(--green)' : 'var(--text-muted)');
    setVal('settings-wa', health.waConnected ? 'Enabled' : 'Disabled',
      health.waConnected ? 'var(--green)' : 'var(--text-muted)');
    setVal('settings-slack', health.slackConnected ? 'Enabled' : 'Disabled',
      health.slackConnected ? 'var(--green)' : 'var(--text-muted)');
    setVal('settings-model', health.model || '-');
    setVal('settings-platform', (info.platform || health.platform || '-') + ' ' + (info.arch || health.arch || ''));
    setVal('settings-ctx', (health.contextPct || 0) + '%',
      (health.contextPct||0) > 80 ? 'var(--red)' : (health.contextPct||0) > 50 ? 'var(--yellow)' : 'var(--green)');
    setVal('settings-turns', String(health.turns || 0));
    setVal('settings-compactions', String(health.compactions || 0));
    setVal('settings-age', health.sessionAge || '-');
    // Uptime from vitals
    try {
      const v = await apiFetch('/api/vitals');
      if (v.process && v.process.uptimeMin) {
        setVal('settings-uptime', fmtUptime(v.process.uptimeMin));
      }
    } catch {}
  } catch(err) {
    toast(err.message, 'error');
  }
}

// ─────────────────────────────────────────────
// Personality
// ─────────────────────────────────────────────
let _personalityChanged = false;

async function loadPersonality() {
  try {
    const [cfg, presetsData] = await Promise.all([
      apiFetch('/api/personality'),
      apiFetch('/api/personality/presets'),
    ]);
    // Populate preset buttons
    const container = document.getElementById('personality-presets');
    if (container) {
      const activeId = cfg.preset || 'default';
      container.innerHTML = (presetsData.presets || []).map(p =>
        '<button class="btn btn-sm ' + (p.id === activeId ? 'btn-primary' : 'btn-ghost') + '" onclick="applyPreset(\\'' + escHtml(p.id) + '\\')" title="' + escHtml(p.description) + '">' + escHtml(p.name) + '</button>'
      ).join('');
    }
    // Populate form
    setFormVal('personality-tone', cfg.tone || 'direct');
    setFormVal('personality-length', cfg.responseLength || 'balanced');
    setFormVal('personality-language', cfg.language || 'auto');
    setFormVal('personality-pushback', cfg.pushback || 'normal');
    const humorEl = document.getElementById('personality-humor');
    if (humorEl) { humorEl.value = String(cfg.humor ?? 2); document.getElementById('personality-humor-val').textContent = String(cfg.humor ?? 2); }
    const emojiEl = document.getElementById('personality-emoji');
    if (emojiEl) emojiEl.checked = !!cfg.emoji;
    const customEl = document.getElementById('personality-custom');
    if (customEl) customEl.value = cfg.customPrompt || '';
    _personalityChanged = false;
    const status = document.getElementById('personality-status');
    if (status) status.textContent = '';
  } catch(err) {
    toast('Failed to load personality: ' + err.message, 'error');
  }
}

function setFormVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function getPersonalityFromForm() {
  return {
    preset: document.getElementById('personality-tone') ? undefined : undefined, // auto-cleared on manual change
    tone: document.getElementById('personality-tone')?.value || 'direct',
    responseLength: document.getElementById('personality-length')?.value || 'balanced',
    humor: parseInt(document.getElementById('personality-humor')?.value || '2', 10),
    emoji: document.getElementById('personality-emoji')?.checked || false,
    language: document.getElementById('personality-language')?.value || 'auto',
    pushback: document.getElementById('personality-pushback')?.value || 'normal',
    customPrompt: document.getElementById('personality-custom')?.value || '',
  };
}

function personalityChanged() {
  _personalityChanged = true;
  const status = document.getElementById('personality-status');
  if (status) status.textContent = 'Unsaved changes';
}

async function applyPreset(id) {
  try {
    const presetsData = await apiFetch('/api/personality/presets');
    const preset = (presetsData.presets || []).find(p => p.id === id);
    if (!preset) return;
    // Apply immediately — saves config + clears session
    const cfg = { ...preset.config, preset: id };
    await apiFetch('/api/personality/apply', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(cfg) });
    // Sync form to reflect applied values
    setFormVal('personality-tone', preset.config.tone || 'direct');
    setFormVal('personality-length', preset.config.responseLength || 'balanced');
    setFormVal('personality-language', preset.config.language || 'auto');
    setFormVal('personality-pushback', preset.config.pushback || 'normal');
    const humorEl = document.getElementById('personality-humor');
    if (humorEl) { const h = preset.config.humor ?? 2; humorEl.value = String(h); document.getElementById('personality-humor-val').textContent = String(h); }
    const emojiEl = document.getElementById('personality-emoji');
    if (emojiEl) emojiEl.checked = !!preset.config.emoji;
    const customEl = document.getElementById('personality-custom');
    if (customEl) customEl.value = preset.config.customPrompt || '';
    // Update preset buttons highlight
    document.querySelectorAll('#personality-presets button').forEach(btn => {
      btn.className = btn.onclick?.toString().includes("'" + id + "'") ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
    });
    _personalityChanged = false;
    const status = document.getElementById('personality-status');
    if (status) { status.textContent = 'Applied'; status.style.color = 'var(--green)'; setTimeout(() => { status.textContent = ''; }, 2000); }
    toast('Preset "' + id + '" applied — session cleared, new style active', 'success');
  } catch(err) {
    toast('Failed to apply preset: ' + err.message, 'error');
  }
}

async function savePersonality() {
  const cfg = getPersonalityFromForm();
  try {
    await apiFetch('/api/personality', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(cfg) });
    _personalityChanged = false;
    const status = document.getElementById('personality-status');
    if (status) { status.textContent = 'Saved'; status.style.color = 'var(--green)'; setTimeout(() => { status.textContent = ''; }, 2000); }
    toast('Personality saved', 'success');
  } catch(err) {
    toast('Save failed: ' + err.message, 'error');
  }
}

async function applyPersonality() {
  const cfg = getPersonalityFromForm();
  try {
    await apiFetch('/api/personality/apply', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(cfg) });
    _personalityChanged = false;
    const status = document.getElementById('personality-status');
    if (status) { status.textContent = 'Applied'; status.style.color = 'var(--green)'; setTimeout(() => { status.textContent = ''; }, 2000); }
    toast('Personality applied — session cleared, new style active', 'success');
  } catch(err) {
    toast('Apply failed: ' + err.message, 'error');
  }
}

async function previewPersonality() {
  const cfg = getPersonalityFromForm();
  try {
    const data = await apiFetch('/api/personality/preview', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(cfg) });
    const el = document.getElementById('personality-preview-text');
    if (el) el.textContent = data.text || '(empty)';
    openModal('modal-personality-preview');
  } catch(err) {
    toast('Preview failed: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────
// Secrets Manager
// ─────────────────────────────────────────────
async function loadSecrets() {
  const container = document.getElementById('secrets-content');
  try {
    const data = await apiFetch('/api/secrets');
    const secrets = data.secrets || [];
    if (!secrets.length) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">No secrets configured. API keys and tokens will appear here.</div>';
      return;
    }
    let html = '<div class="secrets-table-wrap"><table class="secrets-table"><thead><tr>' +
      '<th>Name</th><th>Feature</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>';
    secrets.forEach(s => {
      const isSet = s.set === true || s.status === 'set' || s.isSet || s.value;
      const dotClass = isSet ? 'secret-set' : 'secret-missing';
      const statusLabel = isSet ? 'Set' : 'Missing';
      const key = escHtml(String(s.key || s.name || ''));
      const feature = escHtml(String(s.feature || s.description || '-'));
      const obtainUrl = s.obtainUrl || s.obtain_url || '';
      html += '<tr>' +
        '<td style="font-family:monospace;font-size:12px;color:var(--text)">' + key + '</td>' +
        '<td style="font-size:12px;color:var(--text-muted)">' + feature +
          (obtainUrl ? ' <a href="' + escHtml(obtainUrl) + '" target="_blank" rel="noopener" style="font-size:11px">Get key</a>' : '') +
        '</td>' +
        '<td><span class="secret-dot ' + dotClass + '"></span> <span style="font-size:12px;color:var(--text-muted)">' + statusLabel + '</span></td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn btn-primary btn-sm" onclick="openSecretModal(\\'' + key + '\\',\\'' + escHtml(obtainUrl) + '\\')">' + (isSet ? 'Update' : 'Set') + '</button> ' +
          (isSet ? '<button class="btn btn-danger btn-sm" onclick="removeSecret(\\'' + key + '\\',this)">Remove</button>' : '') +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch(err) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Secrets API not available. Manage secrets via <code>.env</code> file.</div>';
  }
}

function openSecretModal(key, obtainUrl) {
  document.getElementById('secret-modal-key').value = key;
  document.getElementById('secret-modal-value').value = '';
  const urlEl = document.getElementById('secret-modal-url');
  if (obtainUrl) {
    urlEl.innerHTML = '<a href="' + escHtml(obtainUrl) + '" target="_blank" rel="noopener" style="font-size:12px">&#128279; Get API key</a>';
  } else {
    urlEl.innerHTML = '';
  }
  openModal('modal-secret-set');
  setTimeout(() => document.getElementById('secret-modal-value').focus(), 100);
}

async function saveSecret() {
  const key = document.getElementById('secret-modal-key').value.trim();
  const value = document.getElementById('secret-modal-value').value;
  if (!key || !value) { toast('Key and value required', 'error'); return; }
  const btn = document.getElementById('secret-modal-save');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    await apiFetch('/api/secrets/' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
    toast('Secret saved: ' + key, 'success');
    closeModal('modal-secret-set');
    loadSecrets();
  } catch(err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

async function removeSecret(key, btn) {
  if (!confirm('Remove secret "' + key + '"?')) return;
  btn.disabled = true;
  try {
    await apiFetch('/api/secrets/' + encodeURIComponent(key), { method: 'DELETE' });
    toast('Secret removed', 'success');
    loadSecrets();
  } catch(err) { toast(err.message, 'error'); btn.disabled = false; }
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// External Dashboards
// ─────────────────────────────────────────────
let dashboardServices = [];
let activeDashboardService = null;

async function loadDashboardServices() {
  const container = document.getElementById('dashboards-services');
  try {
    const data = await apiFetch('/api/dashboards');
    dashboardServices = data.services || [];

    // Group services: built-in (no group) and grouped (by group field)
    const builtIn = dashboardServices.filter(s => !s.group);
    const groups = {};
    dashboardServices.filter(s => s.group).forEach(s => {
      if (!groups[s.group]) groups[s.group] = [];
      groups[s.group].push(s);
    });

    let html = '';

    // Built-in services row
    if (builtIn.length) {
      html += '<div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;grid-column:1/-1">Services</div>';
      html += builtIn.map(s => renderServiceCard(s)).join('');
    }

    // Grouped services
    for (const [groupName, services] of Object.entries(groups)) {
      html += '<div style="font-size:11px;color:var(--accent-light);text-transform:uppercase;letter-spacing:1px;margin-top:12px;margin-bottom:6px;grid-column:1/-1">' + escHtml(groupName) + '</div>';
      html += services.map(s => renderServiceCard(s)).join('');
    }

    container.innerHTML = html;
  } catch(err) {
    container.innerHTML = '<div style="color:var(--red)">Failed to load services</div>';
  }
}

function renderServiceCard(s) {
  const configured = s.configured;
  const active = activeDashboardService === s.id;
  return '<div class="card" style="padding:10px;text-align:center;cursor:pointer;min-width:120px;' +
    (active ? 'border-color:var(--accent);background:var(--accent-dim);' : '') +
    (!configured ? 'opacity:0.4;' : '') +
    '" onclick="selectDashboardService(\\'' + escHtml(s.id) + '\\')">' +
    '<div style="font-size:20px">' + (s.icon || '&#128300;') + '</div>' +
    '<div style="font-size:12px;font-weight:600;margin-top:4px">' + escHtml(s.name) + '</div>' +
    '<div style="font-size:10px;color:' + (configured ? 'var(--green)' : 'var(--red)') + '">' +
      (configured ? 'Connected' : 'Not configured') +
    '</div>' +
  '</div>';
}

async function selectDashboardService(serviceId) {
  activeDashboardService = serviceId;
  loadDashboardServices(); // refresh tabs

  const service = dashboardServices.find(s => s.id === serviceId);
  if (!service) return;

  const content = document.getElementById('dashboards-content');

  if (!service.configured) {
    content.innerHTML =
      '<div class="card" style="padding:20px;text-align:center">' +
        '<div style="font-size:32px;margin-bottom:8px">' + service.icon + '</div>' +
        '<div style="font-weight:600;margin-bottom:8px">' + escHtml(service.name) + ' not configured</div>' +
        '<div style="color:var(--text-muted);font-size:13px;margin-bottom:12px">' +
          'Set your API key to connect: <code>' + escHtml(service.secretKey || '') + '</code>' +
        '</div>' +
        '<button class="btn btn-primary" onclick="navigate(\\'settings\\')">Go to Settings</button>' +
        (service.source === 'user' ? ' <button class="btn btn-danger btn-sm" style="margin-left:8px" onclick="deleteCustomDashboard(\\'' + escHtml(service.id) + '\\')">Delete</button>' : '') +
      '</div>';
    return;
  }

  // Vercel-specific purpose-built dashboard
  if (service.id === 'vercel' || (service.service === 'vercel') || service.id.startsWith('vercel') || (service.secretKey === 'VERCEL_TOKEN' && service.endpoints?.some(e => e.path?.includes('vercel.com') || e.path?.includes('/v6/deployments')))) {
    await renderVercelDashboard(service);
    return;
  }

  // Load each endpoint (generic fallback)
  const endpoints = service.endpoints || [];
  content.innerHTML = '<div style="font-size:13px;color:var(--accent)">Loading ' + escHtml(service.name) + '...</div>';

  let html = '';
  for (const ep of endpoints) {
    try {
      const data = await apiFetch('/api/dashboards/' + encodeURIComponent(serviceId) + '/' + encodeURIComponent(ep.id));
      const result = data.data;

      html += '<div class="card" style="margin-bottom:12px">' +
        '<div class="card-title">' + escHtml(ep.name) + '</div>';

      if (Array.isArray(result)) {
        // Array of items — render as table
        html += renderDashboardTable(result, serviceId);
      } else if (result && typeof result === 'object') {
        // Check if it has a nested array (common API pattern)
        const arrayKey = Object.keys(result).find(k => Array.isArray(result[k]));
        if (arrayKey && result[arrayKey].length > 0) {
          html += renderDashboardTable(result[arrayKey], serviceId);
        } else {
          // Object — render as key-value
          html += renderDashboardObject(result);
        }
      } else {
        html += '<div style="color:var(--text-muted);font-size:13px">No data</div>';
      }

      html += '</div>';
    } catch(err) {
      html += '<div class="card" style="margin-bottom:12px">' +
        '<div class="card-title">' + escHtml(ep.name) + '</div>' +
        '<div style="color:var(--red);font-size:13px">' + escHtml(err.message) + '</div>' +
      '</div>';
    }
  }

  content.innerHTML = html || '<div style="color:var(--text-muted)">No data available</div>';
}

// ── Vercel Purpose-Built Dashboard ────────────────────────
async function renderVercelDashboard(service) {
  const content = document.getElementById('dashboards-content');
  content.innerHTML = '<div style="font-size:13px;color:var(--accent)">Loading Vercel dashboard for ' + escHtml(service.name) + '...</div>';

  // Extract projectId from service config or endpoints
  let projectId = service.config?.projectId || null;
  if (!projectId && service.endpoints) {
    for (const ep of service.endpoints) {
      const m = ep.path?.match(/projectId=([^&]+)/) || ep.path?.match(/\\/v9\\/projects\\/([^/]+)/);
      if (m) { projectId = m[1]; break; }
    }
  }

  let html = '';

  // ── Header: Project Info ──
  if (projectId) {
    try {
      const projData = await apiFetch('/api/dashboards/vercel/project/' + encodeURIComponent(projectId));
      const proj = projData.data || {};
      html += '<div class="card" style="margin-bottom:14px;padding:16px">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">' +
          '<div style="font-size:28px">&#9650;</div>' +
          '<div>' +
            '<div style="font-size:16px;font-weight:700">' + escHtml(proj.name || service.name) + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted)">' +
              (proj.framework ? escHtml(proj.framework) + ' &middot; ' : '') +
              (proj.nodeVersion ? 'Node ' + escHtml(proj.nodeVersion) + ' &middot; ' : '') +
              (proj.region ? escHtml(proj.region) : '') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    } catch(err) {
      html += '<div class="card" style="margin-bottom:14px;padding:12px;color:var(--red)">Failed to load project info: ' + escHtml(err.message) + '</div>';
    }
  }

  // ── Section 1: Deployment Cards ──
  html += '<div class="card" style="margin-bottom:14px">' +
    '<div class="card-title">RECENT DEPLOYMENTS</div>' +
    '<div id="vercel-deployments-list">';

  try {
    const depQuery = projectId ? '?projectId=' + encodeURIComponent(projectId) + '&limit=5' : '?limit=5';
    const depData = await apiFetch('/api/dashboards/vercel/deployments' + depQuery);
    const deployments = depData.data?.deployments || [];

    if (deployments.length === 0) {
      html += '<div style="color:var(--text-muted);font-size:13px;padding:8px">No deployments found.</div>';
    } else {
      for (const dep of deployments) {
        const status = (dep.readyState || dep.state || 'UNKNOWN').toUpperCase();
        let statusColor = 'var(--text-dim)';
        let statusLabel = status;
        if (status === 'READY') { statusColor = 'var(--green)'; statusLabel = 'Ready'; }
        else if (status === 'ERROR') { statusColor = 'var(--red)'; statusLabel = 'Error'; }
        else if (status === 'BUILDING') { statusColor = 'var(--yellow)'; statusLabel = 'Building'; }
        else if (status === 'QUEUED') { statusColor = 'var(--text-dim)'; statusLabel = 'Queued'; }
        else if (status === 'CANCELED' || status === 'CANCELLED') { statusColor = 'var(--text-dim)'; statusLabel = 'Canceled'; }

        const createdAt = dep.createdAt || dep.created;
        const timeAgo = createdAt ? getTimeAgo(createdAt) : '';
        const commitSha = dep.meta?.githubCommitSha || dep.meta?.gitlabCommitSha || '';
        const commitMsg = dep.meta?.githubCommitMessage || dep.meta?.gitlabCommitMessage || '';
        const branch = dep.meta?.githubCommitRef || dep.meta?.gitlabCommitRef || dep.gitSource?.ref || '';
        const commitUrl = dep.meta?.githubCommitOrg && dep.meta?.githubCommitRepo && commitSha
          ? 'https://github.com/' + dep.meta.githubCommitOrg + '/' + dep.meta.githubCommitRepo + '/commit/' + commitSha
          : '';
        const deployUrl = dep.url ? 'https://' + dep.url : '';
        const depId = dep.uid || dep.id || '';

        html += '<div class="vercel-deploy-card" style="padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;cursor:pointer;transition:border-color 0.15s" ' +
          'onclick="toggleVercelBuildLogs(this, \\'' + escHtml(depId) + '\\')" ' +
          'onmouseover="this.style.borderColor=\\'var(--accent)\\'" onmouseout="this.style.borderColor=\\'var(--border)\\'">' +

          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
            '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">' +
              '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;color:#000;background:' + statusColor + '">' + escHtml(statusLabel) + '</span>' +
              (branch ? '<span style="font-size:12px;color:var(--accent-light);font-family:monospace">&#9741; ' + escHtml(branch) + '</span>' : '') +
              (commitSha ? (commitUrl
                ? '<a href="' + escHtml(commitUrl) + '" target="_blank" rel="noopener" style="font-family:monospace;font-size:11px;color:var(--text-muted)" title="' + escHtml(commitMsg) + '">' + escHtml(commitSha.slice(0, 7)) + '</a>'
                : '<span style="font-family:monospace;font-size:11px;color:var(--text-muted)" title="' + escHtml(commitMsg) + '">' + escHtml(commitSha.slice(0, 7)) + '</span>'
              ) : '') +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              (deployUrl ? '<a href="' + escHtml(deployUrl) + '" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent-light)" onclick="event.stopPropagation()">Visit &rarr;</a>' : '') +
              '<span style="font-size:11px;color:var(--text-dim)">' + escHtml(timeAgo) + '</span>' +
            '</div>' +
          '</div>' +

          (commitMsg ? '<div style="font-size:12px;color:var(--text-muted);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(commitMsg.slice(0, 100)) + '</div>' : '') +

          '<div class="vercel-build-logs" style="display:none;margin-top:10px"></div>' +
        '</div>';
      }
    }
  } catch(err) {
    html += '<div style="color:var(--red);font-size:13px;padding:8px">' + escHtml(err.message) + '</div>';
  }

  html += '</div></div>';

  // ── Section 2: Domains ──
  if (projectId) {
    html += '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-title">DOMAINS</div>';
    try {
      const domData = await apiFetch('/api/dashboards/vercel/project/' + encodeURIComponent(projectId) + '/domains');
      const domains = domData.data?.domains || [];
      if (domains.length === 0) {
        html += '<div style="color:var(--text-muted);font-size:13px;padding:8px">No custom domains configured.</div>';
      } else {
        html += '<div style="display:flex;flex-direction:column;gap:6px;padding:4px 0">';
        for (const d of domains) {
          const verified = d.verified !== false;
          const configured = d.configured !== false && d.misconfigured !== true;
          html += '<div style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)">' +
            '<span style="width:8px;height:8px;border-radius:50%;background:' + (verified && configured ? 'var(--green)' : 'var(--red)') + ';flex-shrink:0"></span>' +
            '<a href="https://' + escHtml(d.name) + '" target="_blank" rel="noopener" style="color:var(--accent-light);font-size:13px;font-weight:500">' + escHtml(d.name) + '</a>' +
            '<span style="font-size:11px;color:var(--text-dim);margin-left:auto">' +
              (verified ? 'Verified' : 'Not verified') + ' &middot; ' +
              (configured ? 'Active' : 'Misconfigured') +
            '</span>' +
          '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    } catch(err) {
      html += '<div style="color:var(--red);font-size:13px;padding:8px">' + escHtml(err.message) + '</div></div>';
    }
  }

  // ── Section 3: Environment Variables ──
  if (projectId) {
    html += '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-title">ENVIRONMENT VARIABLES</div>';
    try {
      const envData = await apiFetch('/api/dashboards/vercel/project/' + encodeURIComponent(projectId) + '/env');
      const envVars = envData.data?.envs || [];
      if (envVars.length === 0) {
        html += '<div style="color:var(--text-muted);font-size:13px;padding:8px">No environment variables.</div>';
      } else {
        html += '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">' +
          '<thead><tr style="border-bottom:1px solid var(--border)">' +
            '<th style="text-align:left;padding:6px;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase">KEY</th>' +
            '<th style="text-align:left;padding:6px;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase">VALUE</th>' +
            '<th style="text-align:left;padding:6px;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase">TARGET</th>' +
            '<th style="text-align:left;padding:6px;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase">TYPE</th>' +
          '</tr></thead><tbody>';
        for (const env of envVars) {
          const targets = Array.isArray(env.target) ? env.target.join(', ') : (env.target || '-');
          const envId = env.id || '';
          html += '<tr style="border-bottom:1px solid var(--border)">' +
            '<td style="padding:6px;font-family:monospace;font-weight:600;color:var(--text)">' + escHtml(env.key || '') + '</td>' +
            '<td style="padding:6px;font-family:monospace;color:var(--text-dim)">' +
              '<span id="env-val-' + escHtml(envId) + '">' + escHtml(env.value || '***') + '</span> ' +
              '<button class="btn btn-ghost" style="font-size:10px;padding:1px 6px" onclick="revealVercelEnvVar(\\'' + escHtml(projectId) + '\\', \\'' + escHtml(envId) + '\\')">Reveal</button>' +
            '</td>' +
            '<td style="padding:6px;font-size:11px;color:var(--text-muted)">' + escHtml(targets) + '</td>' +
            '<td style="padding:6px;font-size:11px;color:var(--text-muted)">' + escHtml(env.type || '-') + '</td>' +
          '</tr>';
        }
        html += '</tbody></table></div>';
      }
      html += '</div>';
    } catch(err) {
      html += '<div style="color:var(--red);font-size:13px;padding:8px">' + escHtml(err.message) + '</div></div>';
    }
  }

  content.innerHTML = html || '<div style="color:var(--text-muted)">No Vercel data available.</div>';
}

// Helper: relative time
function getTimeAgo(timestamp) {
  const now = Date.now();
  const t = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const diff = Math.max(0, now - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(t).toLocaleDateString();
}

// Toggle build logs for a deployment card
async function toggleVercelBuildLogs(cardEl, deploymentId) {
  const logsEl = cardEl.querySelector('.vercel-build-logs');
  if (!logsEl) return;

  // Toggle visibility
  if (logsEl.style.display !== 'none' && logsEl.innerHTML) {
    logsEl.style.display = 'none';
    return;
  }
  logsEl.style.display = 'block';

  if (logsEl.dataset.loaded) return; // already loaded

  logsEl.innerHTML = '<div style="color:var(--accent);font-size:12px;padding:4px">Loading build logs...</div>';

  try {
    const data = await apiFetch('/api/dashboards/vercel/deployment/' + encodeURIComponent(deploymentId) + '/logs');
    const lines = data.data || [];
    if (lines.length === 0) {
      logsEl.innerHTML = '<div style="color:var(--text-dim);font-size:12px">No build logs available.</div>';
    } else {
      let logHtml = '<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-all">';
      for (const line of lines) {
        const text = line.text || '';
        const isError = text.toLowerCase().includes('error') || text.toLowerCase().includes('failed');
        const isWarn = text.toLowerCase().includes('warn');
        const color = isError ? 'var(--red)' : isWarn ? 'var(--yellow)' : 'var(--text-muted)';
        logHtml += '<div style="color:' + color + '">' + escHtml(text) + '</div>';
      }
      logHtml += '</div>';
      logsEl.innerHTML = logHtml;
      // Auto-scroll to bottom
      const scrollEl = logsEl.querySelector('div');
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    }
    logsEl.dataset.loaded = '1';
  } catch(err) {
    logsEl.innerHTML = '<div style="color:var(--red);font-size:12px">' + escHtml(err.message) + '</div>';
  }
}

// Reveal a masked Vercel env var value
async function revealVercelEnvVar(projectId, envId) {
  const el = document.getElementById('env-val-' + envId);
  if (!el) return;
  if (el.dataset.revealed) {
    // Toggle back to masked
    el.textContent = el.dataset.masked;
    el.dataset.revealed = '';
    return;
  }
  el.textContent = 'Loading...';
  try {
    const data = await apiFetch('/api/dashboards/vercel/project/' + encodeURIComponent(projectId) + '/env/' + encodeURIComponent(envId) + '/reveal');
    el.dataset.masked = el.textContent;
    el.textContent = data.data?.value || '(empty)';
    el.dataset.revealed = '1';
  } catch(err) {
    el.textContent = 'Error: ' + err.message;
  }
}

function renderDashboardTable(items, serviceId) {
  if (!items.length) return '<div style="color:var(--text-muted);font-size:13px">Empty</div>';
  const maxItems = items.slice(0, 20);
  // Pick display columns based on service
  const firstItem = maxItems[0];
  const allKeys = Object.keys(firstItem);
  // Smart column selection: prefer human-readable fields
  const preferred = ['name', 'full_name', 'title', 'status', 'state', 'readyState', 'url', 'html_url', 'domain', 'framework', 'nodeVersion', 'region', 'created_at', 'createdAt', 'updated_at', 'updatedAt', 'amount', 'currency', 'email', 'description', 'private', 'language', 'stargazers_count'];
  const excluded = new Set(['id', 'accountId', 'autoExposeSystemEnvs', 'autoAssignCustomDomains', 'autoAssignCustomDomainsUpdatedBy', 'buildCommand', 'devCommand', 'directoryListing', 'installCommand', 'gitForkProtection', 'serverlessFunctionRegion', 'skipGitConnectDuringLink', 'sourceFilesOutsideRootDirectory', 'enablePreviewFeedback', 'enableProductionFeedback', 'enableAffectedProjectsDeployments', 'ssoProtection', 'oidcTokenConfig', 'tier', 'lastRollbackTarget', 'lastAliasRequest', 'protectionBypass', 'trustedIps', 'passiveConnectConfigurationId']);
  let cols = preferred.filter(k => allKeys.includes(k));
  if (cols.length < 2) cols = allKeys.filter(k => !excluded.has(k) && !k.endsWith('Id') && typeof firstItem[k] !== 'object' && typeof firstItem[k] !== 'boolean').slice(0, 6);

  let html = '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">' +
    '<thead><tr style="border-bottom:1px solid var(--border)">' +
    cols.map(c => '<th style="text-align:left;padding:6px;color:var(--text-muted);font-weight:600;text-transform:uppercase;font-size:10px">' + escHtml(c) + '</th>').join('') +
    '</tr></thead><tbody>';

  for (const item of maxItems) {
    html += '<tr style="border-bottom:1px solid var(--border)">';
    for (const c of cols) {
      let val = item[c];
      if (val === null || val === undefined) val = '-';
      else if (typeof val === 'object') val = JSON.stringify(val).slice(0, 50);
      else val = String(val);

      // Make URLs clickable
      if (val.startsWith('http')) {
        html += '<td style="padding:6px"><a href="' + escHtml(val) + '" target="_blank" rel="noopener" style="color:var(--accent-light);font-size:11px">' + escHtml(val.slice(0, 40)) + '</a></td>';
      }
      // Format dates
      else if (c.includes('_at') && !isNaN(Date.parse(val))) {
        html += '<td style="padding:6px;color:var(--text-muted)">' + new Date(val).toLocaleString() + '</td>';
      }
      // Format money (Stripe)
      else if ((c === 'amount') && !isNaN(Number(val))) {
        html += '<td style="padding:6px">' + (Number(val) / 100).toFixed(2) + '</td>';
      }
      else {
        html += '<td style="padding:6px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(val.slice(0, 80)) + '</td>';
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  if (items.length > 20) html += '<div style="color:var(--text-dim);font-size:11px;padding:4px">Showing 20 of ' + items.length + '</div>';
  return html;
}

function renderDashboardObject(obj) {
  let html = '<div style="font-size:12px;font-family:monospace">';
  for (const [k, v] of Object.entries(obj)) {
    let val = v;
    if (val === null || val === undefined) val = '-';
    else if (typeof val === 'object') val = JSON.stringify(val, null, 2);
    else val = String(val);
    html += '<div style="padding:3px 0;border-bottom:1px solid var(--border)">' +
      '<span style="color:var(--text-muted)">' + escHtml(k) + ':</span> ' +
      '<span style="color:var(--text)">' + escHtml(String(val).slice(0, 200)) + '</span>' +
    '</div>';
  }
  html += '</div>';
  return html;
}

function openCreateDashboard() {
  document.getElementById('dash-create-id').value = '';
  document.getElementById('dash-create-name').value = '';
  document.getElementById('dash-create-url').value = '';
  document.getElementById('dash-create-secret').value = '';
  document.getElementById('dash-create-auth').value = 'Bearer';
  document.getElementById('dash-create-endpoints').value = '[{"id":"list","name":"List Items","path":"/items"}]';
  openModal('modal-create-dashboard');
}

async function saveCreateDashboard() {
  const id = document.getElementById('dash-create-id').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const name = document.getElementById('dash-create-name').value.trim();
  const baseUrl = document.getElementById('dash-create-url').value.trim();
  const secretKey = document.getElementById('dash-create-secret').value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const authHeader = document.getElementById('dash-create-auth').value;
  let endpoints = [];
  try { endpoints = JSON.parse(document.getElementById('dash-create-endpoints').value); } catch { toast('Invalid endpoints JSON', 'error'); return; }

  if (!id || !name || !baseUrl || !secretKey) { toast('All fields required', 'error'); return; }

  try {
    await apiFetch('/api/dashboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, icon: '&#128300;', secretKey, baseUrl, authHeader, endpoints })
    });
    toast('Dashboard "' + name + '" created! Set the API key in Settings.', 'success');
    closeModal('modal-create-dashboard');
    loadDashboardServices();
  } catch(err) { toast(err.message, 'error'); }
}

async function deleteCustomDashboard(serviceId) {
  if (!confirm('Delete dashboard "' + serviceId + '"?')) return;
  try {
    await apiFetch('/api/dashboards/' + encodeURIComponent(serviceId), { method: 'DELETE' });
    toast('Dashboard deleted', 'success');
    activeDashboardService = null;
    loadDashboardServices();
    document.getElementById('dashboards-content').innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">Select a service above.</div>';
  } catch(err) { toast(err.message, 'error'); }
}

// ─────────────────────────────────────────────
// Live Activity Stream
// ─────────────────────────────────────────────
const activityLog = [];
const MAX_ACTIVITY_LINES = 500;

// Hook into existing SSE — capture ALL events for the activity stream
function setupActivityStream() {
  if (!sseSource) return;

  const eventTypes = ['user_message', 'assistant_message', 'progress', 'error', 'processing'];
  eventTypes.forEach(type => {
    sseSource.addEventListener(type, e => {
      try {
        const d = JSON.parse(e.data);
        const time = new Date().toLocaleTimeString();
        let icon = '', color = 'var(--text-muted)', text = '';

        switch(type) {
          case 'user_message':
            icon = '\\u2709'; color = 'var(--blue)';
            text = 'User: ' + (d.content || '');
            break;
          case 'assistant_message':
            icon = '\\u{1F916}'; color = 'var(--green)';
            text = 'Assistant: ' + (d.content || '');
            break;
          case 'progress':
            icon = '\\u2699'; color = 'var(--accent-light)';
            text = d.description || 'Working...';
            break;
          case 'error':
            icon = '\\u274C'; color = 'var(--red)';
            text = 'Error: ' + (d.content || d.message || '');
            break;
          case 'processing':
            icon = d.processing ? '\\u23F3' : '\\u2705'; color = 'var(--text-dim)';
            text = d.processing ? 'Processing started' : 'Processing complete';
            break;
        }

        addActivityLine(time, icon, color, text);
      } catch {}
    });
  });
}

function addActivityLine(time, icon, color, text) {
  const container = document.getElementById('activity-stream');
  if (!container) return;

  // Remove placeholder
  if (activityLog.length === 0) container.innerHTML = '';

  const line = document.createElement('div');
  line.style.cssText = 'border-bottom:1px solid var(--border);padding:4px 0;word-break:break-word;cursor:pointer';
  const isLong = text.length > 300;
  const textSpanId = 'activity-text-' + activityLog.length;
  line.innerHTML =
    '<span style="color:var(--text-dim)">' + escHtml(time) + '</span> ' +
    '<span>' + icon + '</span> ' +
    '<span id="' + textSpanId + '" style="color:' + color + (isLong ? ';display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden' : '') + '">' + escHtml(text) + '</span>' +
    (isLong ? '<span style="color:var(--text-dim);font-size:10px"> [click to expand]</span>' : '');
  if (isLong) {
    line.onclick = function() {
      const el = document.getElementById(textSpanId);
      if (el) { el.style.display = 'inline'; el.style.webkitLineClamp = 'unset'; }
      line.querySelector('span:last-child').style.display = 'none';
      line.style.cursor = 'default';
    };
  }
  container.appendChild(line);

  activityLog.push({ time, text });
  if (activityLog.length > MAX_ACTIVITY_LINES) {
    activityLog.shift();
    if (container.firstChild) container.removeChild(container.firstChild);
  }

  // Auto-scroll
  if (document.getElementById('activity-autoscroll')?.checked) {
    container.scrollTop = container.scrollHeight;
  }
}

// ─── File Explorer ───────────────────────────────────────────────
let feRoot = 'data';
let fePath = '';
let feBase = ''; // for system root
let feBookmarks = JSON.parse(localStorage.getItem('wc_fe_bookmarks') || '[]');

function switchFileRoot(root) {
  feRoot = root;
  fePath = '';
  feBase = '';
  document.getElementById('fe-system-bar').style.display = 'none';
  document.querySelectorAll('.fe-root-btn').forEach(b => {
    b.className = 'btn btn-sm ' + (b.id === 'fe-root-' + root ? '' : 'btn-ghost') + ' fe-root-btn';
    if (b.id === 'fe-root-' + root) b.style.cssText = 'background:var(--accent);color:#fff';
    else b.style.cssText = '';
  });
  feBackToTree();
  loadFileExplorer();
}

function feShowSystemInput() {
  switchFileRoot('system');
  document.getElementById('fe-system-bar').style.display = 'flex';
  document.getElementById('fe-system-path').focus();
}

function feGoSystem() {
  const inp = document.getElementById('fe-system-path');
  if (!inp || !inp.value.trim()) return;
  feBase = inp.value.trim();
  fePath = '';
  feBackToTree();
  loadFileExplorer();
}

// Bookmarks
function feLoadBookmarks() {
  const el = document.getElementById('fe-bookmarks');
  if (!el) return;
  if (!feBookmarks.length) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = feBookmarks.map(function(b, i) {
    return '<button class="btn btn-sm btn-ghost" style="font-size:11px" onclick="feGoBookmark(' + i + ')">' +
      '&#9733; ' + escHtml(b.label) +
      ' <span style="cursor:pointer;margin-left:4px;color:var(--text-dim)" onclick="event.stopPropagation();feRemoveBookmark(' + i + ')">&#10005;</span>' +
      '</button>';
  }).join('');
}

function feToggleBookmark() {
  var label = feRoot === 'system' ? feBase : (feRoot === 'data' ? '~/.wild-claude-pi' : 'project');
  if (fePath) label += '/' + fePath;
  var existing = feBookmarks.findIndex(function(b) { return b.root === feRoot && b.base === feBase && b.path === fePath; });
  if (existing >= 0) {
    feBookmarks.splice(existing, 1);
  } else {
    feBookmarks.push({ root: feRoot, base: feBase, path: fePath, label: label });
  }
  localStorage.setItem('wc_fe_bookmarks', JSON.stringify(feBookmarks));
  feLoadBookmarks();
}

function feGoBookmark(i) {
  var b = feBookmarks[i];
  if (!b) return;
  feRoot = b.root;
  feBase = b.base || '';
  fePath = b.path || '';
  if (feRoot === 'system') {
    document.getElementById('fe-system-bar').style.display = 'flex';
    document.getElementById('fe-system-path').value = feBase;
  } else {
    document.getElementById('fe-system-bar').style.display = 'none';
  }
  document.querySelectorAll('.fe-root-btn').forEach(function(btn) {
    btn.className = 'btn btn-sm ' + (btn.id === 'fe-root-' + feRoot ? '' : 'btn-ghost') + ' fe-root-btn';
    if (btn.id === 'fe-root-' + feRoot) btn.style.cssText = 'background:var(--accent);color:#fff';
    else btn.style.cssText = '';
  });
  feBackToTree();
  loadFileExplorer();
}

function feRemoveBookmark(i) {
  feBookmarks.splice(i, 1);
  localStorage.setItem('wc_fe_bookmarks', JSON.stringify(feBookmarks));
  feLoadBookmarks();
}

// Mobile: toggle tree/preview
function feShowPreview() {
  var panels = document.getElementById('fe-panels');
  if (panels) panels.classList.add('preview-active');
}
function feBackToTree() {
  var panels = document.getElementById('fe-panels');
  if (panels) panels.classList.remove('preview-active');
}

function renderBreadcrumb() {
  const el = document.getElementById('fe-breadcrumb');
  if (!el) return;
  const parts = fePath.split('/').filter(Boolean);
  const rootLabel = feRoot === 'system' ? escHtml(feBase || '/') : (feRoot === 'data' ? '~/.wild-claude-pi' : 'project');
  let html = '<span style="cursor:pointer;color:var(--accent)" onclick="fePath=\\'\\';loadFileExplorer()">' + rootLabel + '</span>';
  let acc = '';
  parts.forEach((p, i) => {
    acc += (acc ? '/' : '') + p;
    const escapedPath = acc.replace(/'/g, "\\\\'");
    html += ' <span style="color:var(--text-dim)">/</span> ';
    if (i < parts.length - 1) {
      html += '<span style="cursor:pointer;color:var(--accent)" onclick="fePath=\\'' + escapedPath + '\\';loadFileExplorer()">' + escHtml(p) + '</span>';
    } else {
      html += '<span>' + escHtml(p) + '</span>';
    }
  });
  el.innerHTML = html;
}

function feApiParams() {
  var q = 'root=' + feRoot;
  if (feRoot === 'system' && feBase) q += '&base=' + encodeURIComponent(feBase);
  return q;
}

function feDownload(filePath, filename) {
  // Must be synchronous — iOS Safari blocks window/anchor interaction after await.
  // window.open called directly from onclick (user gesture) works on all mobile browsers.
  const url = apiUrl('/api/files/download?' + feApiParams() + '&path=' + encodeURIComponent(filePath));
  window.open(url, '_blank', 'noopener');
}

async function loadFileExplorer() {
  const tree = document.getElementById('fe-tree');
  if (!tree) return;
  tree.innerHTML = '<div style="color:var(--text-dim);padding:8px">Loading...</div>';
  renderBreadcrumb();
  feLoadBookmarks();
  try {
    const data = await apiFetch('/api/files?' + feApiParams() + '&path=' + encodeURIComponent(fePath));
    if (!data.files || data.files.length === 0) {
      tree.innerHTML = '<div style="color:var(--text-dim);padding:8px">Empty directory</div>';
      return;
    }
    tree.innerHTML = '';
    if (fePath) {
      const back = document.createElement('div');
      back.style.cssText = 'padding:6px 8px;cursor:pointer;border-radius:4px;margin:2px 0;color:var(--text-muted);display:flex;align-items:center;gap:6px';
      back.innerHTML = '&#8592; ..';
      back.onmouseover = function() { this.style.background = 'var(--bg2)'; };
      back.onmouseout = function() { this.style.background = ''; };
      back.onclick = function() {
        const parts = fePath.split('/').filter(Boolean);
        parts.pop();
        fePath = parts.join('/');
        loadFileExplorer();
      };
      tree.appendChild(back);
    }
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    data.files.forEach(function(f) {
      const div = document.createElement('div');
      div.className = 'fe-item';
      div.style.cssText = 'padding:6px 8px;cursor:pointer;border-radius:4px;margin:2px 0;display:flex;align-items:center;gap:6px;font-size:13px;position:relative';
      const icon = f.isDir ? '&#128193;' : feFileIcon(f.name);
      const fileFull = fePath ? fePath + '/' + f.name : f.name;
      const dlBtn = f.isDir ? '' :
        '<button class="fe-dl-btn btn btn-sm" ' +
        'style="display:' + (isTouchDevice ? 'inline-block' : 'none') + ';font-size:11px;padding:2px 6px;flex-shrink:0" ' +
        'title="Download" onclick="event.stopPropagation();feDownload(' + JSON.stringify(fileFull) + ',' + JSON.stringify(f.name) + ')">&#128229;</button>';
      const sizeStr = f.isDir ? '' : '<span style="font-size:11px;color:var(--text-dim);white-space:nowrap">' + feFormatSize(f.size) + '</span>';
      div.innerHTML = '<span>' + icon + '</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(f.name) + '</span>' + sizeStr + dlBtn;
      div.onmouseover = function() {
        this.style.background = 'var(--bg2)';
        const btn = this.querySelector('.fe-dl-btn');
        if (btn) btn.style.display = 'inline-block';
      };
      div.onmouseout = function() {
        this.style.background = '';
        const btn = this.querySelector('.fe-dl-btn');
        if (btn) btn.style.display = 'none';
      };
      if (f.isDir) {
        div.onclick = function() {
          fePath = fePath ? fePath + '/' + f.name : f.name;
          loadFileExplorer();
        };
      } else {
        div.onclick = function() { loadFileContent(f.name); };
      }
      tree.appendChild(div);
    });
  } catch(err) {
    tree.innerHTML = '<div style="color:var(--red);padding:8px">' + escHtml(err.message) + '</div>';
  }
}

async function loadFileContent(name) {
  const preview = document.getElementById('fe-preview');
  if (!preview) return;
  const filePath = fePath ? fePath + '/' + name : name;
  preview.innerHTML = '<div style="color:var(--text-dim)">Loading...</div>';
  feShowPreview();
  try {
    const data = await apiFetch('/api/files/read?' + feApiParams() + '&path=' + encodeURIComponent(filePath));
    const isMd = name.endsWith('.md');
    const isCode = /\\.(ts|js|tsx|jsx|json|yml|yaml|sh|css|html|sql|prisma|env)$/i.test(name);

    let html = '<div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);padding-bottom:10px;flex-wrap:wrap">' +
      '<span style="font-size:16px">' + feFileIcon(name) + '</span>' +
      '<span style="font-weight:600;color:var(--text);word-break:break-all;flex:1">' + escHtml(name) + '</span>' +
      '<span style="font-size:11px;color:var(--text-dim)">' + feFormatSize(data.size) + '</span>' +
      '<button class="btn btn-sm" onclick="feDownload(' + JSON.stringify(filePath) + ',' + JSON.stringify(name) + ')" title="Download file">&#128229; Download</button>' +
      '</div>';

    if (isMd) {
      html += '<div class="md-preview" style="line-height:1.7;color:var(--text)">' + renderMarkdown(data.content) + '</div>';
    } else if (isCode) {
      html += '<pre style="background:var(--bg2);padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.6;color:var(--text);white-space:pre-wrap;word-break:break-word">' + escHtml(data.content) + '</pre>';
    } else {
      html += '<pre style="background:var(--bg2);padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.6;color:var(--text);white-space:pre-wrap">' + escHtml(data.content) + '</pre>';
    }
    preview.innerHTML = html;
  } catch(err) {
    preview.innerHTML = '<div style="color:var(--red);padding:12px">' + escHtml(err.message) + '</div>';
  }
}

function renderMarkdown(md) {
  // Basic markdown → HTML rendering
  let html = md
    // Code blocks
    .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(m, code) {
      return '<pre style="background:var(--bg2);padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;margin:12px 0">' + escHtml(code.trim()) + '</pre>';
    })
    // Inline code
    .replace(/\`([^\`]+)\`/g, '<code style="background:var(--bg2);padding:2px 6px;border-radius:4px;font-size:12px">$1</code>')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4 style="margin:16px 0 8px;font-size:14px;color:var(--text)">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 style="margin:18px 0 8px;font-size:15px;color:var(--text)">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="margin:20px 0 10px;font-size:17px;color:var(--text);border-bottom:1px solid var(--border);padding-bottom:6px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="margin:20px 0 12px;font-size:20px;color:var(--text)">$1</h1>')
    // Bold and italic
    .replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0">')
    // Checkboxes
    .replace(/^- \\[x\\] (.+)$/gm, '<div style="padding:2px 0"><span style="color:var(--green)">&#9745;</span> <s style="color:var(--text-dim)">$1</s></div>')
    .replace(/^- \\[ \\] (.+)$/gm, '<div style="padding:2px 0"><span style="color:var(--text-dim)">&#9744;</span> $1</div>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<div style="padding:2px 0 2px 16px">&#8226; $1</div>')
    // Ordered lists
    .replace(/^(\\d+)\\. (.+)$/gm, '<div style="padding:2px 0 2px 16px">$1. $2</div>')
    // Links
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" style="color:var(--accent)">$1</a>')
    // Tables (basic)
    .replace(/^\\|(.+)\\|$/gm, function(m, row) {
      const cells = row.split('|').map(function(c) { return c.trim(); });
      if (cells.every(function(c) { return /^[-:]+$/.test(c); })) return '';
      return '<tr>' + cells.map(function(c) { return '<td style="padding:4px 8px;border:1px solid var(--border)">' + c + '</td>'; }).join('') + '</tr>';
    })
    // Paragraphs (double newlines)
    .replace(/\\n\\n/g, '</p><p style="margin:8px 0">')
    // Single newlines in paragraphs
    .replace(/\\n/g, '<br>');

  // Wrap tables
  html = html.replace(/(<tr>.*?<\\/tr>(?:\\s*<tr>.*?<\\/tr>)*)/gs, '<table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:13px">$1</table>');

  return '<div style="padding:4px"><p style="margin:8px 0">' + html + '</p></div>';
}

function feFileIcon(name) {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return '&#9881;';
  if (name.endsWith('.js') || name.endsWith('.jsx')) return '&#128312;';
  if (name.endsWith('.json')) return '&#123;&#125;';
  if (name.endsWith('.md')) return '&#128221;';
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return '&#9889;';
  if (name.endsWith('.sql')) return '&#128451;';
  if (name.endsWith('.sh') || name.endsWith('.bash')) return '&#128187;';
  if (name.endsWith('.css')) return '&#127912;';
  if (name.endsWith('.html')) return '&#127760;';
  if (name.endsWith('.env')) return '&#128274;';
  return '&#128196;';
}

function feFormatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function clearActivityLog() {
  activityLog.length = 0;
  const container = document.getElementById('activity-stream');
  if (container) container.innerHTML = '<div style="color:var(--text-dim)">Cleared. Waiting for events...</div>';
}

async function loadAuditLog() {
  const container = document.getElementById('audit-log-content');
  try {
    const data = await apiFetch('/api/audit?limit=50');
    const entries = data.entries || data.logs || [];
    if (!entries.length) {
      container.innerHTML = '<div style="color:var(--text-muted);padding:8px;font-size:13px">No audit entries yet.</div>';
      return;
    }
    container.innerHTML = '<div style="max-height:300px;overflow-y:auto;font-size:12px;font-family:monospace">' +
      entries.map(e => {
        const time = e.created_at ? new Date(e.created_at * 1000).toLocaleString() : '';
        const icon = e.blocked ? '\\u{1F6AB}' : (e.action === 'message' ? '\\u2709' : '\\u2699');
        const color = e.blocked ? 'var(--red)' : 'var(--text-muted)';
        return '<div style="border-bottom:1px solid var(--border);padding:4px 0;color:' + color + '">' +
          '<span style="color:var(--text-dim)">' + escHtml(time) + '</span> ' +
          icon + ' ' +
          '<span style="color:var(--text)">[' + escHtml(e.agent_id || 'main') + ']</span> ' +
          escHtml(e.action || '') + ': ' +
          escHtml(e.detail || '') +
        '</div>';
      }).join('') +
    '</div>';
  } catch(err) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Audit log not available.</div>';
  }
}

async function loadHiveMind() {
  const container = document.getElementById('hivemind-content');
  try {
    const data = await apiFetch('/api/hive-mind?limit=30');
    const entries = data.entries || [];
    if (!entries.length) {
      container.innerHTML = '<div style="color:var(--text-muted);padding:8px;font-size:13px">No delegation history yet. Use @agent to delegate tasks.</div>';
      return;
    }
    container.innerHTML = '<div style="max-height:250px;overflow-y:auto;font-size:12px">' +
      entries.map(e => {
        const time = e.created_at ? new Date(e.created_at * 1000).toLocaleString() : '';
        const agent = e.agent_id || e.from_agent || '';
        const action = e.action || '';
        const actionColor = action === 'delegate' ? 'badge-purple' : 'badge-blue';
        const actionIcon = action === 'delegate' ? '\\u2192' : '\\u2190';
        const text = e.summary || e.prompt || '';
        return '<div style="border-bottom:1px solid var(--border);padding:6px 0">' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
            '<span><span class="badge ' + actionColor + '">' + escHtml(agent) + '</span> <span style="font-size:11px;color:var(--text-dim)">' + escHtml(action) + '</span></span>' +
            '<span style="color:var(--text-dim);font-size:11px">' + escHtml(time) + '</span>' +
          '</div>' +
          '<div style="color:var(--text-muted);margin-top:2px;font-size:12px">' + escHtml(text.slice(0, 300)) + '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  } catch(err) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Hive mind not available.</div>';
  }
}

// Toast
// ─────────────────────────────────────────────
function toast(msg, type) {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  c.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────
init();
</script>
</body>
</html>`;
}
