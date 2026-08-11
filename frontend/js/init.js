/* ═══════════════ INIT ═══════════════ */
initStudio(); renderSizeGrid(); draw(); renderProducts(); applyAuthUI(); checkSession();
renderHomeCategories(); renderHomeProducts(); renderHomeBestSellers(); renderHomeNewArrivals(); renderHomeDeals();
renderHeaderCatNav();
enhancePasswordFields();
initReset();                 // opens the reset form if the URL carries ?reset=
applyTheme();
loadReviewSummary();
loadMocks(()=>{ draw(); renderProducts(); renderHomeProducts(); renderHomeBestSellers(); renderHomeNewArrivals();
  renderHomeCategories(); drawHeroHoodie(); drawAiPreview(); });
