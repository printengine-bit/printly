/* ═══════════════ INIT ═══════════════ */
initStudio(); draw(); renderProducts(); applyAuthUI(); checkSession();
loadReviewSummary();
loadMocks(()=>{ draw(); renderProducts(); heroLoop(); drawAiPreview(); });
