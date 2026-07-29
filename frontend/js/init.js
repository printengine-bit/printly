/* ═══════════════ INIT ═══════════════ */
initStudio(); renderSizeGrid(); draw(); renderProducts(); applyAuthUI(); checkSession();
enhancePasswordFields();
initScrollStack('#stepsStack'); initCursorGrid('#heroBand'); applyTheme();
loadReviewSummary();
loadMocks(()=>{ draw(); renderProducts(); heroLoop(); drawAiPreview(); });
