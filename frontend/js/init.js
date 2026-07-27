/* ═══════════════ INIT ═══════════════ */
initStudio(); renderSizeGrid(); draw(); renderProducts(); applyAuthUI(); checkSession();
initScrollStack('#stepsStack'); initCursorGrid('#heroBand'); applyTheme();
loadReviewSummary();
loadMocks(()=>{ draw(); renderProducts(); heroLoop(); drawAiPreview(); });
