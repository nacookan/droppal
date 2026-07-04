// ============================================================================
// モバイル(特にiOS Safari)のソフトウェアキーボード対応
//
// この制御は「入力欄が画面最下部に固定されているチャット画面」専用。
// 通常のフォーム画面(接続の準備など)では、Safariの自然な挙動
// (フォーカスした入力欄への自動スクロール、キーボードの下にコンテンツが
// 透けて見える)に任せた方が使いやすいため、何もしない。
// チャット画面の表示中だけ enable() で有効化する。
//
// 有効時にやることは2つ:
//
// 1. --app-height の更新
//    iOS Safari は 100dvh をソフトウェアキーボードに追従させないため、
//    window.visualViewport.height(キーボードを除いた実際の可視高さ)を
//    CSSカスタムプロパティに反映し、#app をその高さにピッタリ合わせる。
//    これで入力欄が常にキーボードの上に見える。
//
// 2. Safariの自動パンの打ち消し
//    iOS Safari はキーボードが開くと、フォーカスした入力欄を見せようと
//    ページ全体を強制的に上へスクロール(パン)する。チャット画面では
//    入力欄は最初からキーボードの上に見えているので、このパンは不要
//    どころか「画面上部が切れて下に余白が出る」崩れの原因になる。
//    scrollY が 0 以外になったら即座に 0 へ戻して打ち消す。
//
// 無効時は --app-height を外して CSS の 100dvh フォールバックに戻す。
// ============================================================================

export function initViewportController() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  let active = false;

  const cancelPan = () => {
    if (!active) return;
    if (window.scrollY !== 0 || window.scrollX !== 0) {
      window.scrollTo(0, 0);
    }
  };

  const apply = () => {
    if (!active) return;
    const height = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--app-height', `${Math.round(height)}px`);
    cancelPan();
  };

  if (vv) {
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
  }
  window.addEventListener('resize', apply);
  window.addEventListener('scroll', cancelPan);

  return {
    enable() {
      if (active) return;
      active = true;
      apply();
    },
    disable() {
      if (!active) return;
      active = false;
      root.style.removeProperty('--app-height');
      window.scrollTo(0, 0);
    },
  };
}
