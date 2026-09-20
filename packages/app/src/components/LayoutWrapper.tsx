/**
 * 扩展主容器
 * 桌面弹窗提供固定测量尺寸；手机紧凑页铺满视口；独立控制台自然延展
 */
import type { ReactNode } from 'react'

interface LayoutWrapperProps {
  children: ReactNode
  isFullTab?: boolean
  isMobile?: boolean
}

export const LayoutWrapper = ({ children, isFullTab = false, isMobile = false }: LayoutWrapperProps) => {
  if (isFullTab) {
    return (
      <div className={`${isMobile ? 'mobile-layout' : ''} relative min-h-[100dvh] w-full bg-background text-foreground font-sans flex flex-col transition-colors duration-300 overflow-x-hidden pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]`}>
        {/* 大屏环境背景微光 */}
        <div
          className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full pointer-events-none transition-opacity duration-700 opacity-70 dark:opacity-60"
          style={{
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.18) 0%, rgba(99, 102, 241, 0.05) 45%, transparent 70%)',
          }}
        />
        <div
          className="absolute top-60 -right-40 w-[500px] h-[500px] rounded-full pointer-events-none transition-opacity duration-700 opacity-60 dark:opacity-50"
          style={{
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0.04) 45%, transparent 70%)',
          }}
        />

        {/* 顶部高光边界 */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/5 to-transparent dark:via-white/15 pointer-events-none" />

        <div className="relative z-10 flex flex-col flex-1 w-full max-w-[1440px] 2xl:max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-10 xl:px-12 py-3 sm:py-7">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className={`compact-layout ${isMobile ? 'mobile-layout' : ''} relative bg-background text-foreground font-sans overflow-hidden rounded-xl flex flex-col transition-colors duration-300 border border-border/70 dark:border-white/[0.08]`}>
      {/* 弹窗微光 */}
      <div
        className="absolute -top-20 -left-20 w-80 h-80 rounded-full pointer-events-none transition-opacity duration-700 opacity-90 dark:opacity-80"
        style={{
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.20) 0%, rgba(99, 102, 241, 0.06) 45%, transparent 70%)',
        }}
      />
      <div
        className="absolute top-36 -right-20 w-64 h-64 rounded-full pointer-events-none transition-opacity duration-700 opacity-80 dark:opacity-75"
        style={{
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.16) 0%, rgba(139, 92, 246, 0.05) 45%, transparent 70%)',
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/5 to-transparent dark:via-white/15 pointer-events-none" />

      <div className="relative z-10 flex flex-col h-full min-h-0 pb-[env(safe-area-inset-bottom,0px)]">
        {children}
      </div>
    </div>
  )
}
