const INDENT_KEY = 'essaybook.indent';
const THEME_KEY = 'essaybook.theme';

export type ThemePreference = 'light' | 'dark';

/** 自动首行缩进：默认开启，关闭后回车不插入全角空格。 */
export function getIndentPreference(): boolean {
  try {
    return localStorage.getItem(INDENT_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setIndentPreference(value: boolean): void {
  try {
    localStorage.setItem(INDENT_KEY, String(value));
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可。
  }
}

export function getThemePreference(): ThemePreference {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** 把主题写到 <html data-theme>，同时同步 iPad 状态栏颜色。 */
export function applyTheme(theme: ThemePreference): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#151815' : '#EEF1EC');
  }
}

export function setThemePreference(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 忽略隐私模式下的写入失败。
  }
  applyTheme(theme);
}

