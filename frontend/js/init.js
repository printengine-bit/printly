/* ═══════════════ INIT ═══════════════ */
initStudio(); renderSizeGrid(); draw(); renderProducts(); applyAuthUI(); checkSession();
renderHomeCategories(); renderHomeProducts();
enhancePasswordFields();
initScrollStack('#stepsStack'); applyTheme();
loadReviewSummary();
loadMocks(()=>{ draw(); renderProducts(); renderHomeProducts(); drawAiPreview(); });
