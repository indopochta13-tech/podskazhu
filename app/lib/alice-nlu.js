/**
 * Второй проход NLU как у Алисы: YandexGPT чинит STT и уточняет полку.
 * Правила parse.js всегда главнее явных маркеров (в заметки / купи / встреча).
 */
import { parse, classifyKind, shelfFor } from "./parse.js";
import { chatCompletion, llmConfigured } from "./llm.js";

const ALLOWED = new Set([
  "note", "task", "meeting", "buy", "sport", "care", "bills", "health", "alarm", "bday",
]);

const SYSTEM = `Ты разборчик русской речи для приложения «SoulVoice», в духе Алисы.
Задача: исправить огрехи распознавания речи и выбрать ОДНУ полку.
Полки (type):
- note — мысль, «напомни без часа», приготовить/сделать без времени
- task — дело С часом (отправить отчёт в 15:00)
- meeting — встреча, созвон, приём
- buy — купить, магазин, продукты, список покупок
- sport — тренировка, зал, пробежка
- care — уход за лицом, косметика
- bills — оплата, ЖКХ, показания
- health — таблетки, витамины, давление, курс
- alarm — будильник на час суток
- bday — день рождения
Жёстко:
- «в заметки / запиши заметку» → note, даже если внутри слово «купить»
- «напомни завтра X» без часа → note
- не выдумывай факты, которых нет во фразе
- title — суть без команд («напомни», «запиши»)
Ответ ТОЛЬКО JSON: {"text":"...","type":"note","title":"...","confident":true}`;

function extractJson(raw) {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function lockedByRules(draft, sourceText) {
  const hit = classifyKind(sourceText);
  if (hit.score >= 90) return true;
  if (draft?.timer) return true;
  if (draft?.type === "alarm") return true;
  return false;
}

export function needsAlice(result) {
  const d = result?.drafts?.[0];
  if (!d) return false;
  if (result.intent !== "create") return false;
  if (lockedByRules(d, d.source || "")) return false;
  if ((d.kindScore || 0) < 80) return true;
  // Раньше сюда попадало любое дело. Но task с высокой оценкой — это уже узнанный
  // глагол действия, а не «мы ничего не поняли и положили в общую кучу».
  if (d.type === "task" && (d.kindScore || 0) < 80) return true;
  // Заметкой запись становится, когда в фразе нет часа, — само по себе это не признак
  // неуверенности. Если словарь сработал, спрашивать модель не о чем.
  if (d.type === "note" && (d.kindScore || 0) < 82) return true;
  if (!d.title || d.title === "Без названия" || d.title.length < 4) return true;
  return false;
}

export async function refineWithAlice(text, parsed, ctx) {
  if (!llmConfigured()) return parsed;
  if (!needsAlice(parsed)) return parsed;

  let out;
  try {
    out = await chatCompletion({
      system: SYSTEM,
      messages: [{
        role: "user",
        content: JSON.stringify({
          speech: text,
          parsed: parsed.drafts.map(d => ({
            type: d.type,
            title: d.title,
            date: d.date,
            time: d.time,
            score: d.kindScore,
          })),
        }),
      }],
      temperature: 0,
      maxTokens: 180,
      timeoutMs: 2800,
    });
  } catch {
    return parsed;
  }

  const json = extractJson(out.text);
  if (!json) return parsed;

  const repaired = String(json.text || text).replace(/\s+/g, " ").trim();
  if (!repaired) return parsed;

  let next = parsed;
  if (repaired.toLowerCase() !== String(text).toLowerCase()) {
    next = parse(repaired, ctx);
  }
  if (next.intent !== "create" || !next.drafts?.length) return parsed;

  const draft = next.drafts[0];
  if (lockedByRules(draft, repaired)) return next;

  const type = ALLOWED.has(json.type) ? json.type : null;
  if (type && json.confident !== false) {
    // GPT не имеет права снять явную полку правил, но может поправить catch-all.
    if (draft.type === "task" || draft.type === "note" || (draft.kindScore || 0) < 80) {
      draft.type = type;
      if (type === "note" || type === "buy") draft.needsTime = false;
    }
  }
  const title = String(json.title || "").trim();
  if (title && title.length >= 2 && title.length <= 200) {
    draft.title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  draft.shelf = shelfFor(draft, ctx.settings || {});
  next.slots = { ...next.slots, kind: draft.type, shelf: draft.shelf, title: draft.title };
  return next;
}
