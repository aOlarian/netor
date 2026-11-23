/* MAP
 * Scop: Temele vizuale Netor. Fiecare tema imita un browser cunoscut (Chrome, Firefox, Edge, Internet Explorer,
 *       Opera, Safari, Brave, Vivaldi) sau e tema proprie Netor; "family" schimba forma taburilor si a barei URL
 *       (regulile structurale stau in styles/themes.css), culorile se aplica prin variabile CSS.
 * Legaturi: styles/themes.css, app.js (applyTheme), settings.js si browser-settings.js (carduri de previzualizare)
 * Sectiuni:
 *   §1 Definitii teme (familie, mod, culori)
 *   §2 Aplicare tema pe document + culorile butoanelor de fereastra
 *   §3 Card de previzualizare pentru selectoarele de tema
 */

// §1 Definitii teme (familie, mod, culori)
const T = (name, family, mode, c) => ({ name, family, mode, ...c });

const NETOR_THEMES = {
  'chrome-light': T('Chrome', 'chrome', 'light', {
    frame: '#DEE1E6', frameFg: '#3C4043', tabHover: '#E8EAED', tabActive: '#FFFFFF', toolbar: '#FFFFFF',
    url: '#F1F3F4', urlFg: '#202124', accent: '#1A73E8', surface: '#FFFFFF', surface2: '#F1F3F4',
    text: '#202124', muted: '#5F6368', border: '#DADCE0' }),
  'chrome-dark': T('Chrome Dark', 'chrome', 'dark', {
    frame: '#202124', frameFg: '#BDC1C6', tabHover: '#2A2B2E', tabActive: '#35363A', toolbar: '#35363A',
    url: '#202124', urlFg: '#E8EAED', accent: '#8AB4F8', surface: '#292A2D', surface2: '#35363A',
    text: '#E8EAED', muted: '#9AA0A6', border: '#4A4C50' }),
  'firefox-light': T('Firefox', 'firefox', 'light', {
    frame: '#F0F0F4', frameFg: '#15141A', tabHover: '#E0E0E6', tabActive: '#FFFFFF', toolbar: '#F9F9FB',
    url: '#FFFFFF', urlFg: '#15141A', accent: '#0061E0', surface: '#FFFFFF', surface2: '#F0F0F4',
    text: '#15141A', muted: '#5B5B66', border: '#CFCFD8' }),
  'firefox-dark': T('Firefox Dark', 'firefox', 'dark', {
    frame: '#1C1B22', frameFg: '#FBFBFE', tabHover: '#33323A', tabActive: '#42414D', toolbar: '#2B2A33',
    url: '#1C1B22', urlFg: '#FBFBFE', accent: '#00DDFF', surface: '#2B2A33', surface2: '#42414D',
    text: '#FBFBFE', muted: '#BFBFC9', border: '#52525E' }),
  'edge-light': T('Edge', 'edge', 'light', {
    frame: '#E9EEF4', frameFg: '#1B1B1B', tabHover: '#F3F6FA', tabActive: '#FFFFFF', toolbar: '#FFFFFF',
    url: '#F3F3F3', urlFg: '#1B1B1B', accent: '#0F6CBD', surface: '#FFFFFF', surface2: '#F5F7FA',
    text: '#1B1B1B', muted: '#616161', border: '#D6DCE4' }),
  'edge-dark': T('Edge Dark', 'edge', 'dark', {
    frame: '#1F1F1F', frameFg: '#D6D6D6', tabHover: '#2B2B2B', tabActive: '#333333', toolbar: '#333333',
    url: '#262626', urlFg: '#F0F0F0', accent: '#4CC2FF', surface: '#2B2B2B', surface2: '#383838',
    text: '#F0F0F0', muted: '#ABABAB', border: '#454545' }),
  'ie-classic': T('Internet Explorer', 'ie', 'light', {
    frame: '#DCE6F4', frameFg: '#1E395B', tabHover: '#EAF1FB', tabActive: '#FFFFFF', toolbar: '#F3F7FC',
    url: '#FFFFFF', urlFg: '#000000', accent: '#1E64C8', surface: '#FFFFFF', surface2: '#EEF3FA',
    text: '#000000', muted: '#4D5D73', border: '#A9BCD6' }),
  'opera-dark': T('Opera', 'opera', 'dark', {
    frame: '#121418', frameFg: '#C9CDD4', tabHover: '#1D2027', tabActive: '#2A2E37', toolbar: '#2A2E37',
    url: '#1A1D23', urlFg: '#F2F3F5', accent: '#FF1B2D', surface: '#22252C', surface2: '#2E323B',
    text: '#F2F3F5', muted: '#9AA1AD', border: '#3A3F4A' }),
  'opera-light': T('Opera Light', 'opera', 'light', {
    frame: '#EDEFF3', frameFg: '#2B2F36', tabHover: '#F5F6F8', tabActive: '#FFFFFF', toolbar: '#FFFFFF',
    url: '#F2F3F6', urlFg: '#1C1F24', accent: '#E8192C', surface: '#FFFFFF', surface2: '#F2F3F6',
    text: '#1C1F24', muted: '#646B76', border: '#D5D9E0' }),
  'safari-light': T('Safari', 'safari', 'light', {
    frame: '#ECECEC', frameFg: '#3A3A3C', tabHover: '#E2E2E2', tabActive: '#F6F6F6', toolbar: '#F6F6F6',
    url: '#E3E3E5', urlFg: '#1D1D1F', accent: '#007AFF', surface: '#FFFFFF', surface2: '#F2F2F4',
    text: '#1D1D1F', muted: '#6E6E73', border: '#D2D2D7' }),
  'safari-dark': T('Safari Dark', 'safari', 'dark', {
    frame: '#2A2A2C', frameFg: '#D1D1D6', tabHover: '#38383A', tabActive: '#3A3A3C', toolbar: '#3A3A3C',
    url: '#48484A', urlFg: '#F5F5F7', accent: '#0A84FF', surface: '#2C2C2E', surface2: '#3A3A3C',
    text: '#F5F5F7', muted: '#AEAEB2', border: '#545458' }),
  'brave-dark': T('Brave', 'chrome', 'dark', {
    frame: '#1E2029', frameFg: '#C2C4CF', tabHover: '#2A2D38', tabActive: '#343846', toolbar: '#343846',
    url: '#1E2029', urlFg: '#F0F1F5', accent: '#FB542B', surface: '#2A2D38', surface2: '#343846',
    text: '#F0F1F5', muted: '#A1A4B3', border: '#474B5C' }),
  'vivaldi-red': T('Vivaldi', 'vivaldi', 'light', {
    frame: '#EF3939', frameFg: '#FFFFFF', tabHover: '#F35A5A', tabActive: '#F7F7F7', toolbar: '#F7F7F7',
    url: '#FFFFFF', urlFg: '#202020', accent: '#EF3939', surface: '#FFFFFF', surface2: '#F1F1F1',
    text: '#202020', muted: '#6B6B6B', border: '#D9D9D9' }),
  'netor-amber-dark': T('Netor Amber', 'netor', 'dark', {
    frame: '#1A1714', frameFg: '#CFC6BB', tabHover: '#24201C', tabActive: '#2D2823', toolbar: '#2D2823',
    url: '#1F1B18', urlFg: '#F2ECE4', accent: '#D97757', surface: '#24201C', surface2: '#2F2A25',
    text: '#F2ECE4', muted: '#A89F94', border: '#423B33' }),
  'netor-amber-light': T('Netor Amber Light', 'netor', 'light', {
    frame: '#EDE6DB', frameFg: '#4A4037', tabHover: '#F3EEE6', tabActive: '#FFFDF9', toolbar: '#FFFDF9',
    url: '#F5F0E8', urlFg: '#221E1A', accent: '#C4603E', surface: '#FFFDF9', surface2: '#F5F0E8',
    text: '#221E1A', muted: '#73685D', border: '#D9CFC1' }),
};

const LEGACY_THEME_MAP = {
  'amber-dark': 'netor-amber-dark', 'amber-light': 'netor-amber-light', 'obsidian-dark': 'chrome-dark',
  'slate-neutral': 'edge-dark', 'emerald-neutral': 'opera-dark', 'ivory-light': 'chrome-light',
};

function resolveThemeKey(key) {
  const k = LEGACY_THEME_MAP[key] || key;
  return NETOR_THEMES[k] ? k : 'chrome-light';
}

// §2 Aplicare tema pe document + culorile butoanelor de fereastra
function applyNetorTheme(key) {
  const k = resolveThemeKey(key);
  const th = NETOR_THEMES[k];
  const root = document.documentElement;
  root.dataset.family = th.family;
  root.dataset.mode = th.mode;
  const vars = {
    '--frame': th.frame, '--frame-fg': th.frameFg, '--tab-hover': th.tabHover, '--tab-active': th.tabActive,
    '--toolbar': th.toolbar, '--url-bg': th.url, '--url-fg': th.urlFg, '--accent': th.accent,
    '--surface': th.surface, '--surface-2': th.surface2, '--text': th.text, '--muted': th.muted, '--border': th.border,
  };
  for (const [name, val] of Object.entries(vars)) root.style.setProperty(name, val);
  if (window.netorAPI && window.netorAPI.titlebar) {
    window.netorAPI.titlebar({ color: th.frame, symbolColor: th.frameFg, mode: th.mode });
  }
  return k;
}

// §3 Card de previzualizare pentru selectoarele de tema
function themePreviewHTML(key, selected) {
  const th = NETOR_THEMES[key];
  const radius = { chrome: '7px 7px 0 0', firefox: '5px', edge: '7px', ie: '2px 2px 0 0', opera: '6px', safari: '5px', vivaldi: '5px 5px 0 0', netor: '7px 7px 0 0' }[th.family];
  return `
    <button class="theme-card${selected ? ' selected' : ''}" data-theme="${key}" title="${th.name}">
      <div class="theme-mock" style="background:${th.frame}">
        <div class="theme-mock-tabs">
          <span style="background:${th.tabActive};border-radius:${radius}"></span>
          <span style="background:${th.tabHover};border-radius:${radius};opacity:.7"></span>
        </div>
        <div class="theme-mock-toolbar" style="background:${th.toolbar}">
          <span style="background:${th.url}"></span><i style="background:${th.accent}"></i>
        </div>
        <div class="theme-mock-page" style="background:${th.surface}"></div>
      </div>
      <div class="theme-card-name">${th.name}</div>
    </button>`;
}

window.NetorThemes = { NETOR_THEMES, resolveThemeKey, applyNetorTheme, themePreviewHTML };
