/* ═══════════════ INIT ═══════════════ */
initStudio(); renderSizeGrid(); draw(); renderProducts(); applyAuthUI(); checkSession();
renderHomeCategories(); renderHomeProducts();
enhancePasswordFields();
initScrollStack('#stepsStack'); initCursorGrid('#heroBand'); applyTheme();
loadReviewSummary();
loadMocks(()=>{ draw(); renderProducts(); renderHomeProducts(); heroLoop(); drawAiPreview(); });
