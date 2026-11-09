'use strict';

// The page where the user makes their own themes: a prompt for any AI chat, a field for its answer and the list of
// saved themes. The answer is a JSON description that MindTheme.custom checks and turns into the look (see
// src/shared/theme.js); nothing from it is used as CSS or markup.

const $ = id => document.getElementById(id);
const custom = MindTheme.custom;

function buildPrompt() {
    const o = custom.OPTIONS;
    const example = {
        name: 'Тёплый закат',
        shape: { radius: 'soft', border: 'thin', font: 'system', glass: true, glow: 0.5, grain: 0.15 },
        dark: { bg: '#140B12', surface: '#24141D', fg: '#F7EDE6', muted: '#B9A19A', accent: '#F2784B', accent2: '#E5B25D', link: '#FFB38A', warn: '#F0B040' },
        light: { bg: '#FBF3EC', surface: '#FFFFFF', fg: '#2A1A14', muted: '#7A5F55', accent: '#C9501F', accent2: '#B8862B', link: '#A8431B', warn: '#B26A00' },
        decor: [
            { type: 'gradient', angle: 160, stops: [['bg', 0], ['accent', 100]], opacity: 0.12 },
            { type: 'glow', x: 85, y: 12, size: 55, color: 'accent2', opacity: 0.25 },
            { type: 'shape', shape: 'ring', x: 78, y: 22, size: 30, rotate: 0, color: 'accent', opacity: 0.3, stroke: 0.3 },
            { type: 'lines', pattern: 'diagonal', gap: 3, width: 0.08, color: 'fg', opacity: 0.05 },
            { type: 'svg', fit: 'cover', opacity: 0.5, svg: "<svg viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='$accent' stop-opacity='0.8'/><stop offset='1' stop-color='$accent2' stop-opacity='0'/></linearGradient></defs><path d='M0 72 C25 56 55 88 100 62 L100 100 L0 100 Z' fill='url(#g)'/></svg>" }
        ]
    };
    return [
        'Ты помогаешь оформить цветовую тему для окон браузерного расширения (небольшие страницы с карточками, списками, кнопками и полями ввода).',
        'Ответь ОДНИМ JSON-объектом и больше ничем: без пояснений до и после. Можно поместить его в один блок кода.',
        '',
        'Формат ответа (это пример формата, значения придумай свои под описание):',
        JSON.stringify(example, null, 2),
        '',
        'Что означают поля.',
        'name: короткое название темы, до 32 символов, буквы, цифры и пробелы.',
        'shape (форма, одна на обе палитры):',
        '- radius: ' + o.radius.join(' / ') + ' (острые углы / мягкие / сильно скруглённые);',
        '- border: ' + o.border.join(' / ') + ' (толщина рамок);',
        '- font: ' + o.font.join(' / ') + ' (системный / с засечками / моноширинный / скруглённый);',
        '- glass: true или false (true: полупрозрачные панели с размытием фона, false: плотные панели);',
        '- glow: число от 0 до 1 (сила свечения вокруг кнопок и панелей, 0 без свечения);',
        '- grain: число от 0 до 1 (зернистость поверх всего, 0 без зерна, обычно 0-0.3).',
        'dark и light (две палитры одного настроения, нужны обе). Цвета только в формате #RRGGBB:',
        '- bg: фон окна; surface: фон панелей и полей ввода; fg: основной текст; muted: второстепенный текст и подписи;',
        '- accent: главные кнопки, выбранные дни недели, рамка поля при фокусе; accent2: второй цвет для градиента кнопок и свечения (подбери к accent);',
        '- link: ссылки (необязательно); warn: предупреждения (необязательно).',
        '',
        'decor: необязательный список деталей фона. Можно не добавлять совсем или добавить от 3 до ' + custom.MAX_DECOR + ' деталей: решай сам, нужны ли они этой теме и какие. Детали рисуются под панелями, по порядку списка снизу вверх.',
        'Координаты x и y и размеры size даны в процентах окна (x и y от 0 до 100, можно чуть выйти за край). Цвет детали: имя из палитры (' + custom.COLOR_KEYS.join(', ') + ') или #RRGGBB; лучше имя, тогда деталь сама подстроится под тёмную и светлую палитру. opacity от 0 до 0.8; для тонких деталей 0.04-0.3.',
        'Типы деталей:',
        '- {"type":"glow","x":10,"y":90,"size":60,"color":"accent2","opacity":0.25}: мягкое световое пятно;',
        '- {"type":"shape","shape":"' + custom.DECOR_SHAPES.join('|') + '","x":80,"y":20,"size":18,"rotate":15,"color":"accent","opacity":0.3,"fill":true,"stroke":0.4}: фигура (size примерно 5-60; fill true: заливка, false: только контур толщиной stroke);',
        '- {"type":"lines","pattern":"' + custom.LINE_PATTERNS.join('|') + '","gap":6,"width":0.15,"color":"fg","opacity":0.08}: узор из тонких линий (gap расстояние между линиями, 2-10);',
        '- {"type":"dots","gap":4,"size":0.3,"color":"fg","opacity":0.1}: сетка точек;',
        '- {"type":"gradient","angle":160,"stops":[["accent",0],["accent2",100]],"opacity":0.15}: плавный градиент на весь фон (от 2 до 5 пар [цвет, положение от 0 до 100]);',
        '- {"type":"svg","fit":"cover","tile":120,"opacity":0.6,"svg":"<svg viewBox=\'0 0 100 100\'>...</svg>"}: свой рисунок в формате SVG (правила ниже). Так можно нарисовать то, чего нет среди готовых деталей: волны, горы, сложные формы, узоры, градиентные сцены.',
        'Правила для svg (рисунок ложится на фон как картинка: анимации и скрипты в нём не работают):',
        '- fit: cover (рисунок на весь фон с обрезкой по краям, важное держи ближе к центру), contain (целиком, без обрезки) или tile (бесшовная плитка размером tile пикселей, 20-400, для текстур и узоров); opacity от 0 до 1;',
        '- у <svg> обязателен viewBox (для сцены удобно viewBox=\'0 0 100 100\'), width и height не нужны;',
        '- разрешены только элементы: ' + custom.SVG_ELEMENTS.join(', ') + ';',
        '- значения атрибутов: числа, пути d из команд пути, transform из translate/rotate/scale/skewX/skewY/matrix, цвета, none и url(#id) на градиент, clipPath, mask или filter из этого же рисунка. Нельзя: style, class, text, <image>, <use>, <style>, ссылки, анимацию, любые другие атрибуты;',
        '- цвета пиши именами палитры с долларом: fill=\'$accent\', stroke=\'$fg\', stop-color=\'$accent2\' (доступны $bg $surface $fg $muted $accent $accent2), тогда рисунок сам подстроится под тёмную и светлую палитру; можно и #RRGGBB;',
        '- рисунок не длиннее ' + custom.SVG_MAX_CHARS + ' знаков и не больше 300 элементов; в теме не больше ' + custom.SVG_MAX_PICTURES + ' рисунков svg. Весь рисунок это строка JSON в одну строку: внутри svg используй только одинарные кавычки.',
        'Детали это только фон: не загораживай ими текст, держи их приглушёнными, не делай из фона кашу. Хорошо работают 1-2 крупные формы, пара световых пятен и один тонкий узор.',
        '',
        'Требования:',
        '- fg должен хорошо читаться на bg и на surface: контраст не ниже 4.5:1; muted не ниже 3:1;',
        '- accent должен заметно отличаться от bg;',
        '- не добавляй других полей, не используй названия цветов вроде red, rgb(), градиенты внутри цветов и ссылки: цвета только #RRGGBB (в decor ещё имена палитры).',
        '',
        'Если к сообщению приложена картинка, возьми из неё палитру и настроение: самые характерные цвета для accent и accent2, фон и текст подбери так, чтобы они читались; повторяющиеся формы и линии с картинки можно передать деталями decor. Тёмную и светлую палитру построй на тех же цветах.',
        '',
        'Описание темы (или картинка):',
        ''
    ].join('\n');
}

function setInfo(id, text, kind) {
    const el = $(id);
    el.textContent = text;
    el.className = 'info' + (kind ? ' ' + kind : '');
}

function showProblems(lines) {
    const list = $('problems');
    list.replaceChildren(...lines.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    list.hidden = !lines.length;
}

// ---- the saved themes ----

function renderSaved() {
    const list = custom.list();
    const active = MindTheme.style;
    $('savedEmpty').hidden = list.length > 0;
    $('saved').hidden = list.length === 0;
    $('savedCount').textContent = list.length ? list.length + ' из ' + MindTheme.MAX_THEMES : '';
    $('saved').replaceChildren(...list.map(theme => {
        const styleId = MindTheme.CUSTOM_PREFIX + theme.id;
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = theme.name;
        if (active === styleId) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'включена'; name.append(tag); }
        const use = document.createElement('button');
        use.type = 'button'; use.className = 'btn'; use.textContent = 'Включить'; use.disabled = active === styleId;
        use.addEventListener('click', () => { MindTheme.setStyle(styleId); setInfo('applyInfo', 'Включена тема «' + theme.name + '».', 'ok'); showProblems([]); renderSaved(); });
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'btn'; del.textContent = 'Удалить';
        del.addEventListener('click', () => { custom.remove(theme.id); setInfo('applyInfo', 'Тема «' + theme.name + '» удалена.', 'ok'); showProblems([]); renderSaved(); });
        li.append(name, use, del);
        return li;
    }));
}

// The answer may come with words around it, a code fence, or typographic quotes: take what is between the outer braces.
function extractJson(text) {
    const body = text.replace(/```(?:json)?/gi, '');
    const from = body.indexOf('{'), to = body.lastIndexOf('}');
    if (from < 0 || to <= from) throw new Error('В тексте нет описания в фигурных скобках { ... }.');
    const piece = body.slice(from, to + 1);
    try {
        return JSON.parse(piece);
    } catch (e) {
        try {
            return JSON.parse(piece.replace(/[“”]/g, '"'));
        } catch (e2) {
            throw new Error('Не удалось прочитать JSON: ' + e.message);
        }
    }
}

$('copyBtn').addEventListener('click', async () => {
    const text = buildPrompt();
    const done = () => setInfo('copyInfo', 'Промпт скопирован. Вставьте его в чат с нейросетью и допишите описание в конце.', 'ok');
    try {
        await navigator.clipboard.writeText(text);
        done();
    } catch (e) {
        // no clipboard permission: put the text into a field and select it
        const area = document.createElement('textarea');
        area.value = text;
        document.body.append(area);
        area.select();
        const copied = document.execCommand && document.execCommand('copy');
        area.remove();
        if (copied) done(); else setInfo('copyInfo', 'Не удалось скопировать автоматически.', 'error');
    }
});

$('applyBtn').addEventListener('click', () => {
    showProblems([]);
    const text = $('answer').value.trim();
    if (!text) { setInfo('applyInfo', 'Сначала вставьте ответ нейросети.', 'error'); return; }
    let raw;
    try {
        raw = extractJson(text);
    } catch (e) {
        setInfo('applyInfo', e.message, 'error');
        return;
    }
    const checked = custom.sanitize(raw);
    if (!checked.ok) {
        setInfo('applyInfo', 'Тема не применена: в описании есть ошибки. Попросите нейросеть исправить их.', 'error');
        showProblems(checked.errors.concat(checked.warnings));
        return;
    }
    if (custom.list().length >= MindTheme.MAX_THEMES) {
        setInfo('applyInfo', 'Сохранено уже ' + MindTheme.MAX_THEMES + ' тем: удалите ненужные, чтобы добавить новую.', 'error');
        return;
    }
    const id = custom.add(checked.theme);
    if (!id) {
        setInfo('applyInfo', 'Не удалось сохранить тему: браузер не даёт писать в хранилище.', 'error');
        return;
    }
    MindTheme.setStyle(MindTheme.CUSTOM_PREFIX + id);
    $('answer').value = '';
    setInfo('applyInfo', 'Тема «' + MindTheme.labelOf(MindTheme.CUSTOM_PREFIX + id) + '» сохранена и включена. Прежние темы остались в списке.', 'ok');
    showProblems(checked.warnings);
    renderSaved();
});

$('resetBtn').addEventListener('click', () => {
    MindTheme.setStyle('prism');
    showProblems([]);
    setInfo('applyInfo', 'Включено обычное оформление «Призма». Сохранённые темы остались в списке.', 'ok');
    renderSaved();
});

window.addEventListener('storage', renderSaved);
renderSaved();
