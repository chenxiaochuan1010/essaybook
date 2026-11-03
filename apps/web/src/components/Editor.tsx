import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

interface EditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  indent?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * A plain textarea is intentionally used instead of a contenteditable editor:
 * it is by far the most reliable option for Chinese IME input on iPad Safari.
 */
export function Editor({
  value,
  onChange,
  readOnly = false,
  placeholder = '开始写吧……',
  indent = true,
  className = '',
  ariaLabel = '作文正文',
}: EditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly || !indent || !onChange) return;
    if (event.key !== 'Enter') return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const before = value.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    const currentLine = before.slice(lineStart);

    if (currentLine.trim() === '') return;

    event.preventDefault();
    const insertion = '\n　　';
    const next = value.slice(0, start) + insertion + value.slice(end);
    onChange(next);

    requestAnimationFrame(() => {
      const position = start + insertion.length;
      element.selectionStart = position;
      element.selectionEnd = position;
    });
  };

  const handleFocus = () => {
    if (readOnly || !indent || !onChange) return;
    if (value.trim() !== '') return;

    // 空文档第一次聚焦时补上首行缩进，避免中文输入法在 composition 阶段被打断。
    onChange('　　');
    requestAnimationFrame(() => {
      const element = ref.current;
      if (!element) return;
      element.selectionStart = element.selectionEnd = element.value.length;
    });
  };

  return (
    <textarea
      ref={ref}
      className={`editor-textarea ${readOnly ? 'is-readonly' : ''} ${className}`}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      onFocus={handleFocus}
      onClick={handleFocus}
      onKeyDown={handleKeyDown}
      readOnly={readOnly}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      aria-label={ariaLabel}
    />
  );
}
