// クリップボード操作。navigator.clipboard が使えない/失敗する環境向けに
// テキストを選択状態にするフォールバックを用意する(主にiOS Safari対策)。

export async function copyText(text, fallbackEl) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // フォールバックへ
    }
  }
  if (fallbackEl) {
    selectText(fallbackEl);
  }
  return false;
}

export function selectText(el) {
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    el.focus();
    el.select();
    el.setSelectionRange(0, el.value.length);
  } else {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
