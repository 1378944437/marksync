/**
 * 帮助说明问号提示图标组件
 * 点击或轻触问号图标弹出轻量级解释文本框浮层，避免过长的描述文字撑大卡片高度
 */
import { FC, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, Info } from 'lucide-react'
import { cn } from '../infrastructure/utils/format'

export interface HelpTipProps {
  /** 提示内容文本 */
  content: string
  /** 图标自定义样式类 */
  className?: string
  /** 浮层最大宽度，默认 260px */
  maxWidth?: number
}

export const HelpTip: FC<HelpTipProps> = ({ content, className, maxWidth = 260 }) => {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const tipId = useId()
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; isAbove: boolean }>({
    top: 0,
    left: 0,
    width: 260,
    isAbove: false,
  })

  // 计算浮层弹出坐标，自适应视口边界防溢出
  const calculatePosition = () => {
    if (!triggerRef.current || typeof window === 'undefined') return
    const rect = triggerRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const boxWidth = Math.min(maxWidth, viewportWidth - 24)

    // 水平定位：以图标中心对齐，限制在屏幕安全边界内
    let left = rect.left + rect.width / 2 - boxWidth / 2
    if (left < 12) left = 12
    if (left + boxWidth > viewportWidth - 12) {
      left = viewportWidth - boxWidth - 12
    }

    // 垂直定位：优先向下弹出；若底部空间紧张则向上弹出
    const estimatedHeight = 90
    const spaceBelow = viewportHeight - rect.bottom
    const isAbove = spaceBelow < estimatedHeight && rect.top > estimatedHeight

    const top = isAbove ? rect.top - 6 : rect.bottom + 6

    setCoords(previous => previous.top === top && previous.left === left &&
      previous.width === boxWidth && previous.isAbove === isAbove
      ? previous : { top, left, width: boxWidth, isAbove })
  }

  const open = () => {
    calculatePosition()
    setIsOpen(true)
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    open()
  }

  // 监听窗口缩放与按键关闭
  useEffect(() => {
    if (!isOpen) return
    const handleClose = () => setIsOpen(false)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    const handleOutside = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !tipRef.current?.contains(e.target as Node)) handleClose()
    }

    document.addEventListener('pointerdown', handleOutside)
    // Edge 原生 popup 会在内容绘制时发送 resize，不能因此关闭刚打开的提示。
    window.addEventListener('resize', calculatePosition)
    window.addEventListener('scroll', handleClose, true)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handleOutside)
      window.removeEventListener('resize', calculatePosition)
      window.removeEventListener('scroll', handleClose, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleClick}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') open() }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setIsOpen(false) }}
        onFocus={open}
        onBlur={() => setIsOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
        aria-describedby={isOpen ? tipId : undefined}
        aria-label="查看说明"
        className={cn(
          'inline-flex shrink-0 items-center justify-center w-6 h-6 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isOpen && 'text-primary bg-primary/10',
          className
        )}
      >
        <HelpCircle className="w-3.5 h-3.5 shrink-0" />
      </button>

      {isOpen && typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-50 pointer-events-none">
            {/* 浮层提示框主体 */}
            <div
              ref={tipRef}
              id={tipId}
              role="tooltip"
              style={{
                top: coords.top,
                left: coords.left,
                width: coords.width,
                transform: coords.isAbove ? 'translateY(-100%)' : undefined,
              }}
              onClick={(e) => e.stopPropagation()}
              className="absolute z-50 p-2.5 rounded-xl bg-popover/95 dark:bg-zinc-900/95 border border-border shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <p className="text-[11px] text-foreground dark:text-zinc-200 leading-relaxed select-text">
                  {content}
                </p>
              </div>
            </div>
          </div>,
          triggerRef.current?.closest('dialog') ?? document.body
        )}
    </>
  )
}
