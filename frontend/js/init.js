/* ═══════════════ INIT ═══════════════ */
initStudio(); renderSizeGrid(); draw(); renderProducts(); applyAuthUI(); checkSession();
renderHomeCategories(); renderHomeProducts();
enhancePasswordFields();
initReset();                 // opens the reset form if the URL carries ?reset=
initScrollStack('#stepsStack'); applyTheme();
loadReviewSummary();
loadMocks(()=>{ draw(); renderProducts(); renderHomeProducts(); drawHeroHoodie(); drawAiPreview(); });
