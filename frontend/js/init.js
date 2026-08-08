/* ═══════════════ INIT ═══════════════ */
initStudio(); renderSizeGrid(); draw(); renderProducts(); applyAuthUI(); checkSession();
renderHomeCategories(); renderHomeProducts(); renderHomeBestSellers(); renderHomeNewArrivals(); renderHomeDeals();
renderPromoBar();
enhancePasswordFields();
initReset();                 // opens the reset form if the URL carries ?reset=
initScrollStack('#stepsStack'); applyTheme();
loadReviewSummary();
loadMocks(()=>{ draw(); renderProducts(); renderHomeProducts(); renderHomeBestSellers(); renderHomeNewArrivals();
  renderHomeCategories(); drawHeroHoodie(); drawAiPreview(); });
