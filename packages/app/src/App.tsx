import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LayoutWrapper } from './components/LayoutWrapper'
import { SettingsView } from './components/SettingsView'
import { SyncView } from './components/SyncView'
import { TabNav } from './components/TabNav'
import { ThemeProvider } from './components/ThemeProvider'
import { Toaster } from './components/Toaster'
import { FullTabConsole } from './components/fulltab/FullTabConsole'
import { useDisplayMode } from './hooks/useDisplayMode'
import { I18nProvider } from './i18n'
import { HostPermissionNotice } from './components/HostPermissionNotice'

function App() {
  const { isFullTab, isMobile } = useDisplayMode()
  const [activeTab, setActiveTab] = useState<'sync' | 'settings'>('sync')

  return (
    // 边界放最外层：I18nProvider 等基础 Provider 的初始化错误也要显示出来，
    // 而不是渲染成一块空的暗色面板
    <ErrorBoundary>
      <I18nProvider>
        <ThemeProvider>
          <LayoutWrapper isFullTab={isFullTab} isMobile={isMobile}>
            {isFullTab ? (
              <FullTabConsole />
            ) : (
              <>
                {/* 弹窗顶部导航 */}
                <div className="shrink-0 pt-6 pb-2 px-4 z-20">
                  <TabNav activeTab={activeTab} onTabChange={setActiveTab} isMobile={isMobile} />
                </div>

                {/* 弹窗主内容区 */}
                <div className="flex-1 min-h-0 relative overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] [overflow-anchor:none] px-4">
                  <HostPermissionNotice />
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={activeTab}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: isMobile ? 0.12 : 0.2, ease: 'easeOut' }}
                      className="h-full"
                    >
                      {activeTab === 'sync' ? <SyncView /> : <SettingsView />}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </>
            )}

            {/* Toast 提示 */}
            <Toaster position={isFullTab ? 'bottom-right' : 'bottom-center'} duration={2000} />
          </LayoutWrapper>
        </ThemeProvider>
      </I18nProvider>
    </ErrorBoundary>
  )
}

export { App }
