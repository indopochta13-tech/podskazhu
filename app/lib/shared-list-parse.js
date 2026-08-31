/**
 * Голосовые команды в общие списки:
 * «отправь жене молоко», «отправь общий список мужу купить молоко».
 * registry — из nicknameRegistry(viewer).
 */

const L = "а-яa-z0-9";
const W = `[${L}]+`;

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Падежные формы и разговорные синонимы для частых прозвищ. */
const KNOWN_ALIASES = {
  муж: ["мужу", "мужа", "супруг", "супругу", "мужик", "мужу"],
  жена: ["жене", "жену", "супруга", "супруге", "жене"],
  мама: ["маме", "маму", "мамочка", "мамочке", "мамочку", "матери", "мать"],
  папа: ["папе", "папу", "папочка", "папочке", "отец", "отцу", "отца"],
  сын: ["сыну", "сына", "сынок", "сынку"],
  дочь: ["дочери", "дочку", "дочка", "дочке"],
  бабушка: ["бабушке", "бабушку", "бабуле", "бабулю"],
  дедушка: ["дедушке", "дедушку", "деду", "деда"],
  босс: ["босса", "боссу", "начальник", "начальнику", "начальника", "руководитель", "руководителю"],
  сотрудник: ["сотруднику", "сотрудника", "коллега", "коллеге", "коллегу", "подчиненный", "подчинённый", "подчиненному"],
  ребенок: ["ребёнок", "ребенку", "ребёнку", "дети", "детям"],
};

export function nickAliasForms(nickname) {
  const base = norm(nickname);
  if (!base) return [];
  const out = new Set([base]);
  for (const [key, list] of Object.entries(KNOWN_ALIASES)) {
    if (base === key || base.startsWith(key) || key.startsWith(base)) {
      list.forEach(a => out.add(norm(a)));
      out.add(key);
    }
  }
  // Простые окончания: «коле» → «коля», «ане» → «аня»
  if (base.endsWith("е") && base.length > 3) out.add(base.slice(0, -1) + "я");
  if (base.endsWith("у") && base.length > 3) out.add(base.slice(0, -1));
  if (base.endsWith("ю") && base.length > 3) out.add(base.slice(0, -1) + "я");
  return [...out].filter(Boolean);
}

function stem(word) {
  let w = norm(word);
  w = w.replace(/(ами|ями|ого|его|ому|ему|ой|ей|ых|их|ам|ям|ах|ях|ui|iu)$/i, "");
  w = w.replace(/(у|ю|е|и|а|я|о|ы)$/i, "");
  return w.slice(0, Math.max(3, w.length));
}

export function matchRegistryEntry(spoken, entry) {
  const s = norm(spoken);
  if (!s || !entry) return 0;
  const forms = new Set([
    ...(entry.aliases || []),
    ...nickAliasForms(entry.nickname),
    norm(entry.nickname),
  ]);
  for (const f of forms) {
    if (!f) continue;
    if (s === f) return 1;
    if (s.startsWith(f) || f.startsWith(s)) return 0.92;
    if (stem(s) === stem(f)) return 0.88;
    if (stem(s).startsWith(stem(f)) || stem(f).startsWith(stem(s))) return 0.82;
  }
  return 0;
}

export function pickRecipient(spoken, registry) {
  if (!registry?.length) return null;
  let best = null;
  let score = 0;
  for (const entry of registry) {
    const s = matchRegistryEntry(spoken, entry);
    if (s > score) {
      score = s;
      best = entry;
    }
  }
  return score >= 0.8 ? best : null;
}

const SHARED_CUE = /общ(?:ие?|ий|ую|ем)?\s+списк|в\s+общ(?:ий|ие)?\s+список|общ(?:ий|ие)?\s+список/i;
const VERB_WORDS = "(?:отправь|скинь|напиши|добавь|запиши|передай|скажи|напомни)";
const VERB = new RegExp(`^${VERB_WORDS}(?:\\s|$)`, "i");

const PATTERNS = [
  new RegExp(`^${VERB_WORDS}\\s+(?:в\\s+)?общ(?:ий|ие|ую|ем)?\\s+спис(?:ок|ки)\\s+(${W})\\s+(.+)`, "i"),
  new RegExp(`^${VERB_WORDS}\\s+(${W})\\s+(?:в\\s+)?общ(?:ий|ие|ую|ем)?\\s+спис(?:ок|ки)\\s+(.+)`, "i"),
  new RegExp(`^общ(?:ий|ие|ую|ем)?\\s+спис(?:ок|ки)\\s+(${W})\\s+(.+)`, "i"),
  new RegExp(`^${VERB_WORDS}\\s+(?:в\\s+)?спис(?:ок|ки)\\s+(${W})\\s+(.+)`, "i"),
  new RegExp(`^${VERB_WORDS}\\s+(${W})\\s+(.+)`, "i"),
];

function cleanTask(raw) {
  let t = String(raw || "").trim();
  t = t.replace(/^(?:что|чтобы|надо|нужно|пусть|попроси)\s+/i, "");
  t = t.replace(/^(?:купи|купить|взять|забрать|сделать|не\s+забудь|не\s+забыть)\s+/i, "");
  return t.trim().slice(0, 120);
}

function splitTasks(text) {
  const t = cleanTask(text);
  if (!t) return [];
  const parts = t.split(/\s+и\s+|\s*,\s*/).map(p => cleanTask(p)).filter(Boolean);
  return parts.length ? parts : [t];
}

/**
 * @returns {{ pairId, nickname, titles: string[], title: string } | null}
 */
export function parseSharedList(text, registry = []) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const n = norm(raw);

  const words = n.split(/\s+/);
  const nickHit = registry.some(e =>
    matchRegistryEntry(words[0] || "", e) >= 0.8
    || (VERB.test(n) && matchRegistryEntry(words[1] || "", e) >= 0.8)
    || (words.length >= 2 && matchRegistryEntry(words[words.length - 1] || "", e) >= 0.8),
  );
  const hasCue = SHARED_CUE.test(raw) || (VERB.test(n) && registry.length > 0)
    || (registry.length > 0 && nickHit);
  if (!hasCue && !nickHit) return null;

  for (const re of PATTERNS) {
    const m = raw.match(re);
    if (!m) continue;
    const recipient = m[1];
    const taskRaw = m[2];
    const entry = pickRecipient(recipient, registry);
    if (!entry) continue;
    const titles = splitTasks(taskRaw);
    if (!titles.length) continue;
    return {
      pairId: entry.pairId,
      nickname: entry.nickname,
      titles,
      title: titles[0],
    };
  }

  // «мужу молоко» — прозвище в начале
  if (registry.length > 0) {
    const entryFirst = pickRecipient(words[0], registry);
    if (entryFirst && words.length > 1) {
      const titles = splitTasks(words.slice(1).join(" "));
      if (titles.length) {
        return { pairId: entryFirst.pairId, nickname: entryFirst.nickname, titles, title: titles[0] };
      }
    }
    // «купи хлеб маме» — прозвище в конце (дательный падеж)
    if (words.length >= 2) {
      const entryLast = pickRecipient(words[words.length - 1], registry);
      if (entryLast) {
        const titles = splitTasks(words.slice(0, -1).join(" "));
        if (titles.length) {
          return { pairId: entryLast.pairId, nickname: entryLast.nickname, titles, title: titles[0] };
        }
      }
    }
  }

  return null;
}

/** Текст с виджета «общие списки»: убираем служебные слова, оставляем задачу. */
export function taskFromWidgetSpeech(text, registry = []) {
  const parsed = parseSharedList(text, registry);
  if (parsed?.title) return parsed.title;
  let t = String(text || "").trim();
  t = t.replace(SHARED_CUE, "").trim();
  t = t.replace(new RegExp(`^${VERB_WORDS}\\s*`, "i"), "").trim();
  const titles = splitTasks(t);
  return titles[0] || t.slice(0, 120);
}
