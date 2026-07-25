/* ═══════════════ INIT ═══════════════ */
initStudio(); draw(); renderProducts(); applyAuthUI(); checkSession();
loadMocks(()=>{ draw(); renderProducts(); heroLoop(); });
