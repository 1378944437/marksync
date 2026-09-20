import { useModalDialog } from '../hooks/useModalDialog';
import { useRef } from 'react';
import { motion, AnimatePresence, PanInfo, useDragControls } from 'framer-motion';
import { X } from 'lucide-react';
import { useI18n } from '../i18n';


interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Drawer({ isOpen, onClose, title, children, footer }: DrawerProps) {
  const { t } = useI18n();
  const controls = useDragControls();
  const drawerRef = useRef<HTMLDivElement>(null);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  };

  const dialogRef = useModalDialog(isOpen);
  return (
    <dialog ref={dialogRef} aria-label={title || 'Dialog'} onCancel={(event) => { event.preventDefault(); onClose(); }} className="sync-drawer fixed inset-0 m-0 h-full w-full max-h-none max-w-none overflow-hidden border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent">
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 dark:bg-black/65 backdrop-blur-sm z-40"
          />

          {/* 固定外框高度：加载、空态和展开操作只改变内部滚动内容，不重新定位面板。 */}
          <motion.div
            ref={drawerRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.2 }}
            onDragEnd={handleDragEnd}
            className="absolute bottom-0 left-0 right-0 mx-auto z-50 flex flex-col h-[90%] w-full max-w-2xl bg-card/95 dark:bg-card/90 backdrop-blur-xl border border-border rounded-t-[20px] shadow-2xl"
          >
            {/* Handle Bar */}
            <div
                className="w-full shrink-0 flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
                onPointerDown={(e) => controls.start(e)}
            >
              <div className="w-12 h-1.5 rounded-full bg-border dark:bg-white/20" />
            </div>

            {/* Header */}
            <div className="shrink-0 px-4 pb-3 flex items-center justify-between gap-3 border-b border-border">
              <h2 className="min-w-0 break-words text-lg font-semibold text-foreground tracking-tight">{title}</h2>
              <button
                aria-label={t('repair.close')}
                onClick={onClose}
                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Scroller */}
            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain [overflow-anchor:none] [scrollbar-gutter:stable] px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] touch-pan-y custom-scrollbar">
              {children}
            </div>

            {/* Footer which sticks to bottom */}
            {footer && (
               <div className="shrink-0 px-6 py-4 border-t border-border bg-card backdrop-blur flex gap-3">
                 {footer}
               </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
    </dialog>
  );
}
