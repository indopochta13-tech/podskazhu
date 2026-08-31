# Персонаж «Подскажу»: промпты для генерации

Задача — набор монохромных лиц под каждый ответ приложения. Одно лицо, много выражений, по несколько вариантов на каждое. Все они потом разбираются на точки и собираются на экране.

Файл описывает, что и как генерировать, чтобы результат гарантированно превратился в точки без потери качества.

---

## Почему такие жёсткие требования к рисунку

Точки не копируют картинку — они её пересказывают. Что переживёт пересказ, а что нет, проверено на практике:

**Толстые линии выживают, тонкие исчезают.** Линия тоньше сотой доли ширины картинки на двух тысячах точек пропадает совсем.

**Чистый чёрный на белом читается лучше полутонов.** Объёмный смайлик с тенями потребовал 5000 точек, чтобы не превратиться в кашу. Плоское лицо линиями читается на 2000 и выглядит чище.

**Мелкие детали становятся грязью.** Ресницы, блики в зрачках, штриховка — всё это на выходе даёт случайные точки, которые только мешают.

**Лицо должно стоять по центру с полями.** Точки слетаются из круга снаружи внутрь. Если рисунок прижат к краю, сборка выглядит кривой.

Отсюда все требования ниже. Они не про красоту — они про то, что дойдёт до экрана.

---

## Персонаж

**Мягкий неровный круг с лицом внутри.** Не идеальная окружность, а чуть смятая — как галька или капля. Внутри только глаза и рот, нарисованные толстой кистью.

Почему так:

**Идеальный круг выглядит машинным.** Намеренная неровность оживляет — тот же приём, что с иконками, где мы сделали третью черту меню короче.

**Без волос, тела, ушей и цвета кожи.** Как только они появляются, часть людей себя не узнаёт. Круг подходит и «ей», и «ему»: лицо одно, разница только в интонации ответа.

**Он уже почти есть.** Облако частиц на экране записи круглое. Если персонаж — тот же круг, всё сходится: экран записи, ответы, иконка приложения. Ничего нового изобретать не надо.

---

## Постоянная часть промпта

Эта часть **не меняется никогда**. Её нужно вставлять в каждый запрос:

```
Minimalist monochrome cartoon face illustration.

CHARACTER: A soft, slightly irregular circle — like a smooth pebble or
a water droplet, never a perfect geometric circle. The outline is a single
confident brush stroke with subtly varying thickness, as if drawn with ink
in one motion. No body, no hair, no ears, no nose.

STYLE: Pure black ink on pure white background. High contrast, no grey,
no gradients, no shading, no texture, no outline glow.
Bold, thick strokes — every line at least 3% of the image width.
Generous empty space inside the face. Elegant and confident, like a single
brushstroke by a skilled illustrator. Warm and appealing, never creepy.

COMPOSITION: Square 1:1. The face is centered and occupies about 70% of
the frame, leaving clear white margin on all sides.

SIGNATURE STYLE — this is essential:
The facial features are SMALL relative to the face — eyes no wider than
6% of the image, mouth no wider than 18%. They sit LOW, in the bottom
third of the circle, leaving the upper half generously empty.
The face is restrained and understated, never a big cartoon grin.
Quiet confidence rather than loud emotion.

STRICTLY AVOID: thin lines, hatching, eyelashes, pupil highlights, dotted
textures, drop shadows, gradients, coloured areas, background elements,
text, watermarks, borders, frames, multiple faces in one image,
large cartoon eyes, features filling the whole face, wide open grins,
features centered vertically.
```

---

## Переменная часть: выражения

К постоянной части добавляется одна строка с выражением. Ниже — все, с приоритетом.

### Первая очередь — без них приложение не заработает

| Ключ | Когда показывается | Строка для промпта |
|---|---|---|
| `saved` | записала, готово | `EXPRESSION: calm contentment — relaxed curved eyes, a small satisfied smile.` |
| `reminded` | напоминание поставлено | `EXPRESSION: attentive and reassuring — alert round eyes, a gentle closed smile, slightly raised brows.` |
| `unheard` | не расслышала | `EXPRESSION: puzzled — one brow raised higher than the other, eyes slightly narrowed, mouth a small wavy line.` |
| `thinking` | идёт разбор фразы | `EXPRESSION: concentrating — eyes looking upward to one side, mouth a short straight line.` |
| `calm` | тяжёлая тема | `EXPRESSION: quiet and neutral — softly closed eyes, mouth a simple horizontal line. Serene, respectful, no smile at all.` |

### Вторая очередь — оживляют приложение

| Ключ | Когда | Строка |
|---|---|---|
| `happy` | хороший день, много закрыто | `EXPRESSION: genuine joy — eyes squeezed into upward crescents, wide open smile.` |
| `warm` | день рождения, поздравление | `EXPRESSION: warm affection — soft half-closed eyes, tender small smile, head tilted slightly.` |
| `laugh` | что-то смешное | `EXPRESSION: laughing — eyes as tight upward arcs, mouth wide open in a rounded laugh.` |
| `wink` | лёгкая шутка | `EXPRESSION: playful wink — one eye closed as a downward curve, the other open, a lopsided grin.` |
| `proud` | человек справился | `EXPRESSION: quiet pride — eyes gently closed, a confident closed smile, brows relaxed.` |
| `tired` | ночная запись | `EXPRESSION: sleepy — heavy half-closed eyelids, small tired smile, one brow drooping.` |
| `sleep` | глубокая ночь | `EXPRESSION: asleep — eyes as two closed curves, mouth a tiny relaxed line.` |

### Третья очередь — редкие состояния

| Ключ | Когда | Строка |
|---|---|---|
| `sad` | человек отменил важное | `EXPRESSION: gentle sadness — eyes turned down at the outer corners, mouth a soft downward curve.` |
| `worried` | много просрочено | `EXPRESSION: worried — brows drawn together and up, eyes wide, mouth a small uneven line.` |
| `surprised` | неожиданный результат | `EXPRESSION: surprised — wide round eyes, brows high, mouth a small open oval.` |
| `sly` | заметила закономерность | `EXPRESSION: knowing and sly — eyes narrowed into confident curves, one corner of the mouth raised.` |

---

## Как получить десять разных вариантов одной эмоции

Просто повторять запрос — плохо: получатся десять почти одинаковых картинок. Нужно менять то, что делает лица разными.

Добавляйте к промпту **одну** строку из списка. Каждая даёт свой вариант:

```
VARIATION: eyes noticeably larger and rounder than default.
VARIATION: eyes small and close together, more space around them.
VARIATION: the circle is wider than tall, slightly squashed.
VARIATION: the circle is taller than wide, slightly stretched.
VARIATION: the face is tilted about 10 degrees to the left.
VARIATION: the face is tilted about 10 degrees to the right.
VARIATION: eyes placed higher in the face, more room below the mouth.
VARIATION: eyes placed lower in the face, more room above.
VARIATION: the mouth is noticeably wider, taking most of the lower face.
VARIATION: the outline is more irregular, almost hand-wobbled.
```

**Не меняйте** толщину линий, цвет и композицию — на них держится единство набора.

---

## Как сохранить единый стиль

Главная опасность: генератор рисует каждый раз чуть иначе, и набор рассыпается на разнородные картинки.

Порядок работы:

**Сначала одна эталонная.** Сгенерируйте `saved` без вариаций, переберите несколько попыток и выберите ту, что нравится больше всех. Это образец.

**Дальше всё остальное — с ссылкой на эталон.** Загружайте его как референс и добавляйте в промпт:

```
Match the reference image exactly in line weight, circle shape,
proportions and overall style. Change ONLY the expression.
```

**Проверяйте партиями по десять** и сразу отбраковывайте выбившиеся. Один чужой рисунок в ряду портит впечатление от всего набора — мы это уже видели с иконками.

---

## Проверка каждой картинки

Отбраковывайте, если есть хоть одно:

- линия тоньше спички при просмотре на весь экран
- серые или размытые края вместо чёткого чёрного
- фон не белый, есть тень или рамка
- лицо смещено от центра или упирается в край
- появились нос, уши, волосы, румянец
- зрачки с бликами, ресницы, штриховка
- форма круга заметно отличается от эталона

**Формат:** PNG, квадрат, не меньше 1024×1024. Меньше не берите — при разборе на точки запас разрешения помогает.

---

## Сколько это займёт

Первая очередь: 5 выражений × 10 = **50 картинок**. Этого уже достаточно, чтобы приложение ожило.

Все три очереди: 16 × 10 = **160 картинок**. Это много для ручной проверки — лучше делать волнами.

Совет: начните с первой очереди и одного варианта на выражение — пять картинок. Проверим на них, как ложатся точки и как выглядит сборка. Если всё хорошо, дальше пойдёт быстро.

---

## Что прислать мне

Готовые PNG. Дальше я:

1. Разберу каждую на точки: сетка со сдвигом, толщина линии кодируется размером точки, гамма-коррекция под глаз
2. Проверю каждое лицо на читаемость до вставки в приложение
3. Соберу в один файл данных с анимацией сборки
4. Свяжу с ответами: `isHeavy` включает `calm`, ночная запись — `tired`, и так далее

Старые фигуры — галочка, часы, знак вопроса, улыбка, сердце, солнце, луна, восклицательный знак, точки, ладони — уберу. Останется один набор в одном стиле.

---

## Одно замечание про имена файлов

Называйте по схеме `ключ-номер.png`: `saved-1.png`, `saved-2.png`, `happy-1.png`. Так я разложу их автоматически, не переспрашивая, что где.
