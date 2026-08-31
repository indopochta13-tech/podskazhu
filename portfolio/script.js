/* global PortfolioI18n */
(() => {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function initScroll() {
    if (location.hash === "#contact") {
      $("#contact")?.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }
  initScroll();
  window.addEventListener("load", initScroll);

  PortfolioI18n.init();

  // Footer year (inside i18n string with {year} placeholder)
  const y = $("#year");
  if (y) {
    const updateFooter = () => {
      const line = PortfolioI18n.t("footer.line1");
      const p = y.closest("p");
      if (p) p.textContent = line;
    };
    updateFooter();
    document.addEventListener("portfolio:lang", updateFooter);
  }

  // Scroll reveal
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("on"); });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  $$(".reveal").forEach(el => io.observe(el));

  // Cookie bar
  const bar = $("#cookie-bar");
  if (bar && !localStorage.getItem("portfolio_cookie_ok")) {
    bar.classList.remove("hidden");
    $("#cookie-accept")?.addEventListener("click", () => {
      localStorage.setItem("portfolio_cookie_ok", "1");
      bar.classList.add("hidden");
    });
  }

  // Contact form
  const form = $("#contact-form");
  const msg = $("#form-msg");
  form?.addEventListener("submit", async e => {
    e.preventDefault();
    msg.textContent = "";
    msg.className = "form-msg";
    const fd = new FormData(form);
    const payload = {
      name: fd.get("name"),
      email: fd.get("email"),
      message: fd.get("message"),
      consent: fd.get("consent") === "on",
    };
    try {
      const res = await fetch("/api/portfolio/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || PortfolioI18n.t("contact.error"));
      msg.textContent = PortfolioI18n.t("contact.success");
      msg.classList.add("ok");
      form.reset();
    } catch (err) {
      msg.textContent = err.message || PortfolioI18n.t("contact.fallback");
      msg.classList.add("err");
    }
  });
})();
