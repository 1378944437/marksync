/**
 * 全局主题上下文 Provider
 * 统一管理深浅色切换、系统媒体查询监听及 DOM classList，消除组件分散监听与闪烁
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { useStorage } from '../hooks/useStorage'

export type Theme = 'dark' | 'light' | 'system'

export interface ThemeContextType {
  theme: Theme
  resolvedTheme: 'dark' | 'light'
  setTheme: (theme: Theme) => void
}

export const ThemeContext = createContext<ThemeContextType | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 默认跟随系统：桌面弹窗外沿那 1 px 边框由宿主绘制、颜色跟随浏览器主题，
  // 固定深色界面在浅色宿主上会让这条边框格外显眼；跟随系统可让界面与边框同色系。
  const [themeSetting, setThemeSetting] = useStorage<Theme>('theme', 'system')
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark')

  // 获取系统主题偏好
  const getSystemTheme = useCallback((): 'dark' | 'light' => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'dark'
  }, [])

  // 统一应用主题到 DOM 根节点
  const applyTheme = useCallback((targetTheme: 'dark' | 'light') => {
    const root = document.documentElement
    if (targetTheme === 'dark') {
      root.classList.add('dark')
      root.classList.remove('light')
    } else {
      root.classList.add('light')
      root.classList.remove('dark')
    }
    // 使用实际页面背景；无 media 限制，应用主题与系统主题不同时也能生效。
    const themeColor = getComputedStyle(root).backgroundColor
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', themeColor)
    }
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', targetTheme)
    setResolvedTheme(targetTheme)
  }, [])

  // 监听主题设置变化
  useEffect(() => {
    if (themeSetting === 'system') {
      applyTheme(getSystemTheme())
    } else {
      applyTheme(themeSetting)
    }
  }, [themeSetting, applyTheme, getSystemTheme])

  // 监听系统主题变化
  useEffect(() => {
    if (themeSetting !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => applyTheme(getSystemTheme())

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [themeSetting, applyTheme, getSystemTheme])

  return (
    <ThemeContext.Provider
      value={{
        theme: themeSetting,
        resolvedTheme,
        setTheme: setThemeSetting,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useThemeContext(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (!context) {
    // 降级兜底：在未挂载 ThemeProvider 时安全运行（如轻量单元测试）
    return {
      theme: 'dark',
      resolvedTheme: 'dark',
      setTheme: () => {},
    }
  }
  return context
}
