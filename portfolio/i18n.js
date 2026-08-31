window.PortfolioI18n = (() => {
  const STORAGE_KEY = "portfolio_lang";
  let currentLang = "ru";

  const SITE_URL =
    typeof location !== "undefined"
      ? `${location.origin}${location.pathname.replace(/\/[^/]*$/, "")}/`
      : "https://vc.201-51-3-63.sslip.io/portfolio/";

  const STRINGS = {
    ru: {
      "meta.title": "Volkov Valerii · Software Engineer",
      "meta.description":
        "Volkov Valerii — разработка мобильных приложений, сайтов, Telegram-ботов и автоматизации под ключ.",

      "nav.services": "Услуги",
      "nav.works": "Работы",
      "nav.timeline": "Сроки",
      "nav.contact": "Контакты",
      "nav.lang": "Язык",

      "hero.badge": "Software Engineer · Self-employed · Russia",
      "hero.h1": "Приложения, сайты, боты и\u00a0автоматизация — под ключ",
      "hero.lead1":
        "Volkov Valerii — independent full-stack разработчик. Проектирую, пишу код, деплою и сопровождаю production-системы для клиентов.",
      "hero.lead2":
        "Мобильные приложения · веб-сайты · Telegram/VK-боты · любая автоматизация · backend · DevOps.",
      "hero.cta": "Обсудить проект",
      "hero.photoAlt": "Volkov Valerii — software engineer",

      "services.title": "Что делаю",
      "services.sub":
        "Полный цикл — от идеи до работающего продукта на сервере или в сторах.",
      "services.mobile.title": "Мобильные приложения",
      "services.mobile.desc":
        "Android, Capacitor, нативные виджеты, RuStore и Google Play.",
      "services.web.title": "Сайты и веб-приложения",
      "services.web.desc": "Лендинги, админ-панели, дашборды, PWA, API.",
      "services.bots.title": "Telegram и VK боты",
      "services.bots.desc": "Mini Apps, CRM, оплаты, webhooks, рассылки.",
      "services.auto.title": "Автоматизация",
      "services.auto.desc":
        "Любые скрипты, интеграции, cron, пайплайны данных.",
      "services.backend.title": "Backend и API",
      "services.backend.desc": "FastAPI, Node.js, базы данных, архитектура.",
      "services.devops.title": "DevOps и деплой",
      "services.devops.desc":
        "Linux, nginx/Caddy, TLS, systemd, бэкапы, мониторинг.",

      "works.title": "Примеры работ",
      "works.sub":
        "Все проекты в production — ссылки можно открыть и проверить.",
      "works.psyche.title": "Психея — Telegram Mini App",
      "works.psyche.meta":
        "13 программ, чат, AI, видео, NFT, оплаты · Lead engineer",
      "works.soulvoice.title": "SoulVoice — голос → задачи",
      "works.soulvoice.meta":
        "PWA + Android, виджет, русский NLP · Solo developer",
      "works.soulvoice.app": "Приложение",
      "works.pulse.title": "Market Pulse — сигналы рынка",
      "works.pulse.meta": "Dashboard + Telegram bot + backend",
      "works.pulse.dashboard": "Dashboard",
      "works.vpn.title": "VPN Bot Pulse209",
      "works.vpn.meta": "Подписки, AmneziaWG 2.0, auto peer configs",
      "works.whale.title": "WhaleBot — crypto alerts",
      "works.whale.meta": "Telegram-бот, алерты крупных сделок",

      "timeline.title": "Примерные сроки",
      "timeline.landing": "дней · лендинг / сайт",
      "timeline.automation": "дней · автоматизация",
      "timeline.bot": "нед · Telegram-бот",
      "timeline.miniapp": "нед · Mini App / веб-приложение",
      "timeline.mobile": "нед · мобильное приложение",
      "timeline.note":
        "Срок зависит от ТЗ. Оценку даю после короткого созвона или переписки.",

      "contact.title": "Связаться",
      "contact.sub":
        'Email: <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a> · GitHub: <a href="https://github.com/indopochta13-tech" target="_blank" rel="noopener">indopochta13-tech</a>',
      "contact.name": "Имя",
      "contact.email": "Email",
      "contact.message": "О проекте",
      "contact.placeholder":
        "Кратко опишите задачу: что нужно, сроки, бюджет (если есть)",
      "contact.consent":
        'Даю <a href="consent.html" target="_blank">согласие на обработку персональных данных</a> и ознакомлен(а) с <a href="privacy.html" target="_blank">политикой конфиденциальности</a>.',
      "contact.submit": "Отправить заявку",
      "contact.success":
        "Спасибо! Сообщение отправлено — отвечу на указанный email.",
      "contact.error": "Ошибка отправки",
      "contact.fallback":
        "Не удалось отправить. Напишите на indopochte13@gmail.com",

      "footer.line1":
        "© {year} Volkov Valerii · Independent Software Engineer · Russia",
      "footer.legal": "Волков Валерий Николаевич · ИНН 771576725515 · самозанятый",
      "footer.privacy": "Политика конфиденциальности",
      "footer.consent": "Согласие на обработку данных",

      "cookie.text":
        'Используем cookies для работы сайта. <a href="privacy.html">Подробнее</a>',
      "cookie.accept": "Принять",

      "consent.meta.title": "Согласие на обработку данных · Volkov Valerii",
      "consent.back": "← На главную",
      "consent.h1": "Согласие на обработку персональных данных",
      "consent.date": "Дата публикации: 30 августа 2026 г.",
      "consent.intro":
        'Настоящим я, заполняя форму на сайте <a href="{siteUrl}">{siteUrl}</a> или направляя обращение оператору, <strong>даю своё согласие</strong> Volkov Valerii (самозанятый, Россия, email: <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a>) на обработку моих персональных данных на следующих условиях:',
      "consent.s1.title": "1. Перечень данных",
      "consent.s1.li1": "Фамилия, имя (или имя, указанное в форме);",
      "consent.s1.li2": "Адрес электронной почты;",
      "consent.s1.li3": "Содержание сообщения / описание проекта;",
      "consent.s1.li4": "IP-адрес и технические параметры браузера.",
      "consent.s2.title": "2. Цели обработки",
      "consent.s2.li1": "Рассмотрение заявки и обратная связь;",
      "consent.s2.li2": "Подготовка коммерческого предложения и заключение договора;",
      "consent.s2.li3": "Исполнение договора на разработку программного обеспечения;",
      "consent.s2.li4": "Защита от спама и злоупотреблений.",
      "consent.s3.title": "3. Действия с данными",
      "consent.s3.p":
        "Сбор, запись, систематизация, хранение, уточнение, использование, удаление — с использованием автоматизированных средств.",
      "consent.s4.title": "4. Срок действия согласия",
      "consent.s4.p":
        "Согласие действует до достижения целей обработки или до его отзыва. Хранение данных — не более 3 лет с момента последнего контакта, если иное не требуется законом или договором.",
      "consent.s5.title": "5. Отзыв согласия",
      "consent.s5.p":
        'Согласие может быть отозвано путём направления письма на <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a> с темой «Отзыв согласия на обработку ПД». Оператор прекращает обработку в разумный срок, если нет иных законных оснований для продолжения.',
      "consent.s6.title": "6. Подтверждение",
      "consent.s6.p":
        "Отправляя форму на Сайте с отмеченным чекбоксом согласия, я подтверждаю, что:",
      "consent.s6.li1":
        'Ознакомлен(а) с <a href="privacy.html">Политикой конфиденциальности</a>;',
      "consent.s6.li2": "Даю согласие добровольно и осознанно;",
      "consent.s6.li3": "Указанные мной данные являются достоверными.",
      "consent.operator":
        '<strong>Оператор:</strong> Volkov Valerii · <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a>',

      "privacy.meta.title": "Политика конфиденциальности · Volkov Valerii",
      "privacy.back": "← На главную",
      "privacy.h1": "Политика конфиденциальности",
      "privacy.date": "Дата публикации: 30 августа 2026 г.",
      "privacy.s1.title": "1. Общие положения",
      "privacy.s1.p1":
        'Настоящая Политика конфиденциальности (далее — «Политика») определяет порядок обработки и защиты персональных данных пользователей сайта портфолио Volkov Valerii (далее — «Сайт»), расположенного по адресу <a href="{siteUrl}">{siteUrl}</a>',
      "privacy.s1.p2":
        'Оператор персональных данных: <strong>Volkov Valerii</strong>, самозанятый (НПД), Россия. Контакт: <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a>.',
      "privacy.s2.title": "2. Какие данные собираются",
      "privacy.s2.li1": "Имя, указанное в форме обратной связи;",
      "privacy.s2.li2": "Адрес электронной почты;",
      "privacy.s2.li3": "Текст сообщения о проекте;",
      "privacy.s2.li4":
        "Технические данные: IP-адрес, User-Agent браузера (для защиты от спама);",
      "privacy.s2.li5":
        "Данные cookie/localStorage — для запоминания согласия на использование cookies.",
      "privacy.s3.title": "3. Цели обработки",
      "privacy.s3.li1": "Обработка заявок и ответ на обращения клиентов;",
      "privacy.s3.li2": "Заключение и исполнение договоров на разработку ПО;",
      "privacy.s3.li3": "Обеспечение безопасности и предотвращение злоупотреблений;",
      "privacy.s3.li4": "Соблюдение требований законодательства РФ.",
      "privacy.s4.title": "4. Правовые основания",
      "privacy.s4.p":
        "Обработка осуществляется на основании согласия субъекта персональных данных (ст. 6 и 9 ФЗ-152 «О персональных данных»), а также для исполнения договора по инициативе субъекта.",
      "privacy.s5.title": "5. Хранение и защита",
      "privacy.s5.p1":
        "Данные хранятся на защищённом сервере (Linux VPS) с ограниченным доступом. Заявки из формы сохраняются в зашифрованном контуре сервера и не передаются третьим лицам, за исключением случаев, предусмотренных законом.",
      "privacy.s5.p2":
        "Срок хранения заявок — до 3 лет с момента последнего контакта, если иное не требуется для исполнения договора.",
      "privacy.s6.title": "6. Передача третьим лицам",
      "privacy.s6.p":
        "Персональные данные не продаются и не передаются третьим лицам в маркетинговых целях. Допускается использование инфраструктурных сервисов (хостинг, email) при соблюдении мер защиты.",
      "privacy.s7.title": "7. Права субъекта данных",
      "privacy.s7.p":
        'Вы вправе запросить доступ, исправление, удаление данных или отзыв согласия, направив запрос на <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a>. Ответ — в срок до 30 дней.',
      "privacy.s8.title": "8. Cookies",
      "privacy.s8.p":
        "Сайт использует минимально необходимые cookies/localStorage для запоминания согласия на cookies. Аналитические и рекламные cookies не используются.",
      "privacy.s9.title": "9. Изменения Политики",
      "privacy.s9.p":
        "Оператор вправе обновлять Политику. Актуальная версия всегда доступна на этой странице.",
      "privacy.contact":
        '<strong>Контакты:</strong> Volkov Valerii · <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a>',
    },

    en: {
      "meta.title": "Volkov Valerii · Software Engineer",
      "meta.description":
        "Volkov Valerii — mobile apps, websites, Telegram bots, and end-to-end automation.",

      "nav.services": "Services",
      "nav.works": "Work",
      "nav.timeline": "Timeline",
      "nav.contact": "Contact",
      "nav.lang": "Language",

      "hero.badge": "Software Engineer · Self-employed · Russia",
      "hero.h1": "Apps, websites, bots & automation — end to end",
      "hero.lead1":
        "Volkov Valerii — independent full-stack developer. I design, build, deploy, and maintain production systems for clients.",
      "hero.lead2":
        "Mobile apps · websites · Telegram/VK bots · any automation · backend · DevOps.",
      "hero.cta": "Discuss a project",
      "hero.photoAlt": "Volkov Valerii — software engineer",

      "services.title": "What I do",
      "services.sub":
        "Full cycle — from idea to a live product on server or app stores.",
      "services.mobile.title": "Mobile apps",
      "services.mobile.desc":
        "Android, Capacitor, native widgets, RuStore and Google Play.",
      "services.web.title": "Websites & web apps",
      "services.web.desc": "Landing pages, admin panels, dashboards, PWA, API.",
      "services.bots.title": "Telegram & VK bots",
      "services.bots.desc": "Mini Apps, CRM, payments, webhooks, broadcasts.",
      "services.auto.title": "Automation",
      "services.auto.desc":
        "Scripts, integrations, cron jobs, data pipelines.",
      "services.backend.title": "Backend & API",
      "services.backend.desc": "FastAPI, Node.js, databases, architecture.",
      "services.devops.title": "DevOps & deploy",
      "services.devops.desc":
        "Linux, nginx/Caddy, TLS, systemd, backups, monitoring.",

      "works.title": "Selected work",
      "works.sub":
        "All projects are in production — links are live and verifiable.",
      "works.psyche.title": "Psyche — Telegram Mini App",
      "works.psyche.meta":
        "13 programs, chat, AI, video, NFT, payments · Lead engineer",
      "works.soulvoice.title": "SoulVoice — voice → tasks",
      "works.soulvoice.meta":
        "PWA + Android, widget, Russian NLP · Solo developer",
      "works.soulvoice.app": "App",
      "works.pulse.title": "Market Pulse — market signals",
      "works.pulse.meta": "Dashboard + Telegram bot + backend",
      "works.pulse.dashboard": "Dashboard",
      "works.vpn.title": "VPN Bot Pulse209",
      "works.vpn.meta": "Subscriptions, AmneziaWG 2.0, auto peer configs",
      "works.whale.title": "WhaleBot — crypto alerts",
      "works.whale.meta": "Telegram bot, large trade alerts",

      "timeline.title": "Typical timelines",
      "timeline.landing": "days · landing / website",
      "timeline.automation": "days · automation",
      "timeline.bot": "wk · Telegram bot",
      "timeline.miniapp": "wk · Mini App / web app",
      "timeline.mobile": "wk · mobile app",
      "timeline.note":
        "Timeline depends on the spec. I provide an estimate after a short call or email.",

      "contact.title": "Get in touch",
      "contact.sub":
        'Email: <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a> · GitHub: <a href="https://github.com/indopochta13-tech" target="_blank" rel="noopener">indopochta13-tech</a>',
      "contact.name": "Name",
      "contact.email": "Email",
      "contact.message": "About the project",
      "contact.placeholder":
        "Briefly describe the task: what you need, timeline, budget (if any)",
      "contact.consent":
        'I give <a href="consent.html" target="_blank">consent to personal data processing</a> and have read the <a href="privacy.html" target="_blank">privacy policy</a>.',
      "contact.submit": "Send inquiry",
      "contact.success":
        "Thank you! Message sent — I will reply to the email you provided.",
      "contact.error": "Failed to send",
      "contact.fallback":
        "Could not send. Please email indopochte13@gmail.com",

      "footer.line1":
        "© {year} Volkov Valerii · Independent Software Engineer · Russia",
      "footer.legal":
        "Valerii Nikolaevich Volkov · TIN 771576725515 · self-employed",
      "footer.privacy": "Privacy policy",
      "footer.consent": "Data processing consent",

      "cookie.text":
        'We use cookies for site functionality. <a href="privacy.html">Learn more</a>',
      "cookie.accept": "Accept",

      "consent.meta.title": "Data Processing Consent · Volkov Valerii",
      "consent.back": "← Back to home",
      "consent.h1": "Consent to personal data processing",
      "consent.date": "Published: August 30, 2026",
      "consent.intro":
        'By filling out the form on <a href="{siteUrl}">{siteUrl}</a> or contacting the operator, I <strong>give my consent</strong> to Volkov Valerii (self-employed, Russia, email: <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a>) to process my personal data on the following terms:',
      "consent.s1.title": "1. Data collected",
      "consent.s1.li1": "Last name, first name (or name provided in the form);",
      "consent.s1.li2": "Email address;",
      "consent.s1.li3": "Message content / project description;",
      "consent.s1.li4": "IP address and browser technical parameters.",
      "consent.s2.title": "2. Processing purposes",
      "consent.s2.li1": "Reviewing inquiries and responding;",
      "consent.s2.li2": "Preparing proposals and entering into contracts;",
      "consent.s2.li3": "Performing software development contracts;",
      "consent.s2.li4": "Spam and abuse prevention.",
      "consent.s3.title": "3. Processing actions",
      "consent.s3.p":
        "Collection, recording, systematization, storage, updating, use, deletion — using automated means.",
      "consent.s4.title": "4. Consent validity",
      "consent.s4.p":
        "Consent is valid until processing purposes are fulfilled or until withdrawn. Data is stored for no more than 3 years from the last contact, unless otherwise required by law or contract.",
      "consent.s5.title": "5. Withdrawal of consent",
      "consent.s5.p":
        'Consent may be withdrawn by emailing <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a> with the subject "Withdrawal of personal data consent". The operator will stop processing within a reasonable time unless other legal grounds apply.',
      "consent.s6.title": "6. Confirmation",
      "consent.s6.p":
        "By submitting the form with the consent checkbox checked, I confirm that:",
      "consent.s6.li1":
        'I have read the <a href="privacy.html">Privacy Policy</a>;',
      "consent.s6.li2": "I give consent voluntarily and knowingly;",
      "consent.s6.li3": "The data I provide is accurate.",
      "consent.operator":
        '<strong>Operator:</strong> Volkov Valerii · <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a>',

      "privacy.meta.title": "Privacy Policy · Volkov Valerii",
      "privacy.back": "← Back to home",
      "privacy.h1": "Privacy Policy",
      "privacy.date": "Published: August 30, 2026",
      "privacy.s1.title": "1. General",
      "privacy.s1.p1":
        'This Privacy Policy ("Policy") describes how personal data of users of the Volkov Valerii portfolio site ("Site") is processed and protected. The Site is located at <a href="{siteUrl}">{siteUrl}</a>',
      "privacy.s1.p2":
        'Data operator: <strong>Volkov Valerii</strong>, self-employed (Russia). Contact: <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a>.',
      "privacy.s2.title": "2. Data collected",
      "privacy.s2.li1": "Name provided in the contact form;",
      "privacy.s2.li2": "Email address;",
      "privacy.s2.li3": "Project message text;",
      "privacy.s2.li4":
        "Technical data: IP address, browser User-Agent (for spam protection);",
      "privacy.s2.li5":
        "Cookie/localStorage data — to remember cookie consent.",
      "privacy.s3.title": "3. Processing purposes",
      "privacy.s3.li1": "Handling inquiries and responding to clients;",
      "privacy.s3.li2": "Entering into and performing software contracts;",
      "privacy.s3.li3": "Security and abuse prevention;",
      "privacy.s3.li4": "Compliance with applicable law.",
      "privacy.s4.title": "4. Legal basis",
      "privacy.s4.p":
        "Processing is based on the data subject's consent and, where applicable, on performing a contract at the subject's request.",
      "privacy.s5.title": "5. Storage and security",
      "privacy.s5.p1":
        "Data is stored on a secured server (Linux VPS) with restricted access. Form submissions are stored on the server and are not shared with third parties except as required by law.",
      "privacy.s5.p2":
        "Inquiries are stored for up to 3 years from the last contact, unless a contract requires otherwise.",
      "privacy.s6.title": "6. Third-party sharing",
      "privacy.s6.p":
        "Personal data is not sold or shared with third parties for marketing. Infrastructure services (hosting, email) may be used with appropriate safeguards.",
      "privacy.s7.title": "7. Your rights",
      "privacy.s7.p":
        'You may request access, correction, deletion, or withdrawal of consent by emailing <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a>. Response within 30 days.',
      "privacy.s8.title": "8. Cookies",
      "privacy.s8.p":
        "The Site uses minimal cookies/localStorage to remember cookie consent. No analytics or advertising cookies are used.",
      "privacy.s9.title": "9. Policy updates",
      "privacy.s9.p":
        "The operator may update this Policy. The current version is always available on this page.",
      "privacy.contact":
        '<strong>Contact:</strong> Volkov Valerii · <a href="mailto:indopochte13@gmail.com">indopochte13@gmail.com</a>',
    },
  };

  function detectLang() {
    const qp = new URLSearchParams(location.search).get("lang");
    if (qp === "ru" || qp === "en") return qp;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ru" || stored === "en") return stored;
    const nav = (navigator.language || "ru").toLowerCase();
    return nav.startsWith("en") ? "en" : "ru";
  }

  function format(str, vars = {}) {
    return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  }

  function t(key, lang = currentLang) {
    const raw = STRINGS[lang]?.[key] ?? STRINGS.ru[key] ?? key;
    return format(raw, { siteUrl: SITE_URL, year: String(new Date().getFullYear()) });
  }

  function applyLang(lang) {
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;

    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const val = t(key, lang);
      if (el.hasAttribute("data-i18n-html")) {
        el.innerHTML = val;
      } else if (el.hasAttribute("data-i18n-placeholder")) {
        el.placeholder = val;
      } else if (el.hasAttribute("data-i18n-alt")) {
        el.alt = val;
      } else {
        el.textContent = val;
      }
    });

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc?.dataset.i18n) {
      metaDesc.setAttribute("content", t(metaDesc.dataset.i18n, lang));
    }

    const titleKey = document.body?.dataset.i18nTitle;
    if (titleKey) document.title = t(titleKey, lang);

    document.querySelectorAll("[data-lang]").forEach(btn => {
      const active = btn.dataset.lang === lang;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    document.dispatchEvent(new CustomEvent("portfolio:lang", { detail: { lang } }));
  }

  function init() {
    const lang = detectLang();
    applyLang(lang);
    document.querySelectorAll("[data-lang]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.lang !== currentLang) applyLang(btn.dataset.lang);
      });
    });
  }

  return { init, applyLang, t, detectLang, get lang() { return currentLang; } };
})();
