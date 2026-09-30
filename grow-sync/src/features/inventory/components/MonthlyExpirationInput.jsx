import React, { createContext, forwardRef, useContext } from 'react';
import { DatePicker } from 'antd';

const ClearMonth = createContext(null);
export function MonthlyExpirationPicker({ onChange, ...props }) {
  return <ClearMonth.Provider value={() => onChange?.(null, '')}>
    <DatePicker {...props} onChange={onChange} components={monthlyInputComponents} />
  </ClearMonth.Provider>;
}

// DatePicker retains parsing, validation and its month popup. Only text insertion
// is adapted: its native mask edits whole segments rather than a progressive input.
export function monthlyInputEdit(text, caret, previous = '', inputType = '') {
  let digits = text.replace(/\D/g, '').slice(0, 6);
  let before = text.slice(0, caret).replace(/\D/g, '').length;
  const deleting = inputType.startsWith('delete');
  if (inputType === 'deleteContentBackward' && previous.endsWith('/') && text === previous.slice(0, -1)) {
    digits = digits.slice(0, -1); before = digits.length;
  }
  const slash = digits.length > 2 || (digits.length === 2 && !deleting);
  const value = slash ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  return { value, caret: Math.min(value.length, before + (slash && before >= 2 ? 1 : 0)) };
}

const MonthlyExpirationInput = forwardRef(function MonthlyExpirationInput({ onChange, onKeyDown, value, ...props }, ref) {
  const clearMonth = useContext(ClearMonth);
  return <input {...props} ref={ref} value={value} inputMode="numeric"
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); return; }
      onKeyDown?.(event);
    }}
    onChange={event => {
      const input = event.target;
      const edit = monthlyInputEdit(input.value, input.selectionStart ?? input.value.length, value, event.nativeEvent.inputType || '');
      input.value = edit.value;
      input.setSelectionRange(edit.caret, edit.caret);
      onChange?.(event);
      if (!edit.value) clearMonth?.();
    }} />;
});
export const monthlyInputComponents = { input: MonthlyExpirationInput };
