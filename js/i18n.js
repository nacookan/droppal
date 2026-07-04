// ============================================================================
// 多言語対応(日本語 / English)
//
// フレームワークを使わない静的サイトなので、ネイティブのHTML/CSSには
// 「文字列を外部化して言語ごとに動的に割り当てる」ような仕組みがない
// (navigator.languageによる検出やIntlによる数値・日付の書式づけはあるが、
// 文言そのものの辞書機能ではない)。そのため、以下のシンプルな自前実装にする:
//
//   - 辞書オブジェクト DICT.ja / DICT.en をキーで引く t(key, params)
//   - 静的なHTMLの文言は data-i18n="key" (テキスト) /
//     data-i18n-html="key" (太字などを含む場合。辞書はこちらが管理する
//     信頼できる文字列なのでinnerHTMLで問題ない) /
//     data-i18n-placeholder="key" / data-i18n-title="key" /
//     data-i18n-aria-label="key" を属性に付けておき、
//     initI18n() / setLang() 実行時にまとめて書き換える
//   - JS側で動的に組み立てる文言は t(key, params) を直接呼ぶ
//
// 言語の決定順序: localStorageに保存済みの選択 > navigator.language
// ============================================================================

const STORAGE_KEY = 'droppal-lang';

const DICT = {
  ja: {
    startLead: 'あなたと相手のブラウザが直接つながって、そのままファイルを送り合えます。もちろんアカウント登録などは不要です。',
    startButton: 'はじめる',
    startHint: '招待URLを受け取った方は、そのURLをそのまま開いてください。',
    aboutSummary: 'DropPalはサーバーを使わずに直接通信します(技術的な話)',
    aboutP1: 'DropPalを使ったメッセージやファイルのやり取りは、特定のサーバーを利用・経由するものではなく、あなたと相手のブラウザが直接通信して行います(WebRTC)。DropPal自体を配信しているサーバーも、その他DropPalの開発運営者のサーバーも利用しません。インターネット上の経路を通る暗号化通信で相手と直接つながります。',
    aboutP2: 'もちろん、DropPal自体を表示するための最初の読み込みや、接続準備中に経路確認のため使うSTUNサーバーとの通信は発生します。ただし、これらが使われるのは接続が完了するまでの話で、接続完了後はどちらのサーバーも一切使用しません。',
    aboutP3: '心配な方は、公開されているソースコードをダウンロードして中身を確認できます。静的ファイルだけで作られているので、GitHub PagesやCloudflare Pages、またはそれらに限らず、ご自身の好きな場所(自分のサーバーや他のホスティングサービスなど)に自分でデプロイしてすぐに動かすこともできます。',

    preparingDefault: '準備しています…',
    preparingHost: '招待URLを作成しています…',
    preparingGuest: '接続の準備をしています…',

    hostStepTitle: '接続の準備',
    hostH2Invite: '① この招待URLを相手に送って、アクセスしてもらってください',
    copy: 'コピー',
    copied: 'コピーしました',
    hostH2Reply: '② 相手から届いた「返信コード」を貼り付けてください',
    replyPlaceholder: 'ここに返信コードを貼り付け',
    connectButton: '接続する',
    hostSlowHint: 'ℹ️ まだ接続できていません。相手がDropPalの画面に戻ってくると自動的に接続されます。このまましばらくお待ちください。(長い時間つながらない場合は、ネットワーク環境の相性で接続できないことがあります)',
    noticeDontClose: '⚠️ この画面を閉じたりリロードしたりしないでください。最初からやり直しになります。',
    backToTop: 'DropPalトップへもどる',

    guestWelcomeHtml: '相手と直接ファイルを送り合える "<strong>DropPal</strong>" にあなたは招待されました',
    guestH2Reply: '招待を受ける場合、この返信コードを相手に送り返してください',
    noticeTrustedOnlyHtml: 'ℹ️ <strong>信頼できる相手からの招待のみを受ける</strong>ようにしてください。',
    noticeComeBackHtml: 'ℹ️ 返信コードを送り返したら、<strong>この画面にもどってきて、そのまま待って</strong>いてください。相手が操作すると自動的に接続されます。',

    btnRestart: '最初からやり直す',

    connectionInfoP2P: '🔗 P2P — サーバーを経由しない直接通信です',
    connectionInfoEncrypted: '🔒 暗号化通信(DTLS)で保護されています',
    connectionRouteChecking: '🎯 経路を確認中…',
    routeDirect: '🎯 直接接続 ({local}/{remote})',
    routeRelay: '⚠️ 中継経由 ({local}/{remote})',
    fingerprintCaption: '🔒 相手の画面にも同じ絵文字が並んでいます。他の連絡手段で確認してから、このチャットを使い始めると安心です。',
    connectedMessage: '✅ 接続が完了しました。相手と通信できます。',
    typingIndicator: '相手が入力中…',

    attachTitle: 'ファイルを送る(目安: 数百MBまで)',
    attachLabel: 'ファイル',
    chatPlaceholder: 'メッセージを入力',
    sendLabel: '送信',
    dropOverlayText: 'ここにドロップしてファイルを送信',
    downloadWithSize: 'ダウンロード ({size})',
    fileCancelButton: 'キャンセル',
    fileDeleteButton: '削除',
    fileSendingMeta: '{sent} / {size} ({elapsed}秒経過)',
    fileDoneMeta: '{size} ({elapsed}秒)',
    fileCancelledMeta: 'キャンセルされました',
    fileDeletedMeta: '削除されました',

    statusConnected: '接続済み',
    statusPreparing: '準備中…',
    statusWaitingPeer: '相手を待機中…',
    statusConnecting: '接続中…',
    statusDisconnected: '切断されました',
    statusFailed: '接続できませんでした',

    errDisconnected: '相手との接続が切れました。最初からやり直してください。',
    errCouldNotConnect: '接続できませんでした。ネットワーク環境によっては繋がらないことがあります(モバイル回線同士など)。別の回線でお試しください。',
    errInviteCreateFailed: '招待URLの作成に失敗しました。ブラウザが対応していない可能性があります。',
    errInviteReadFailed: '招待コードの読み込みに失敗しました。URLが正しいか、送り主に確認してください。',
    errPasteReplyCode: '返信コードを貼り付けてください。',
    errBadCode: 'コードの形式が正しくないようです。正しい返信コードを貼り付けてください。',
    copyFailed: 'コピーできませんでした。表示中のテキストが選択されたので、そのままコピーしてください。',

    lengthHint: 'かなり長いけど全部をコピーしてください({n}文字)',
  },

  // やさしい英語(英語ネイティブでない人にも読めるよう、短く簡単な単語だけを使う)
  en: {
    startLead: 'Your browser connects directly to the other person’s browser. You can send files right away. No account is needed.',
    startButton: 'Start',
    startHint: 'Got an invite link? Just open it.',
    aboutSummary: 'DropPal connects directly, with no server (technical details)',
    aboutP1: 'Your messages and files do not pass through any server. Your browser talks directly to the other browser (this is called WebRTC). This is true even for the server that hosts this DropPal page. The connection is encrypted and goes straight to the other person.',
    aboutP2: 'Of course, loading this page uses a server. And getting ready to connect uses a small helper server called STUN. But once you are connected, DropPal does not use either of them anymore.',
    aboutP3: 'If you want to be sure, you can download the source code and check it yourself. DropPal is just static files, so you can also host it anywhere you like: GitHub Pages, Cloudflare Pages, your own server, or any other hosting service.',

    preparingDefault: 'Getting ready…',
    preparingHost: 'Creating your invite link…',
    preparingGuest: 'Getting ready to connect…',

    hostStepTitle: 'Getting Ready',
    hostH2Invite: '① Send this invite link to the other person',
    copy: 'Copy',
    copied: 'Copied!',
    hostH2Reply: '② Paste the "reply code" they send back',
    replyPlaceholder: 'Paste the reply code here',
    connectButton: 'Connect',
    hostSlowHint: 'ℹ️ Not connected yet. This will connect on its own once the other person goes back to the DropPal page. Please wait a little. (If this takes a very long time, your networks may not be able to connect to each other.)',
    noticeDontClose: '⚠️ Do not close or reload this page. You would have to start over.',
    backToTop: 'Back to DropPal home',

    guestWelcomeHtml: 'You are invited to <strong>DropPal</strong>: share files directly, with no server',
    guestH2Reply: 'To accept, send this reply code back to them',
    noticeTrustedOnlyHtml: 'ℹ️ <strong>Only accept invites from people you trust.</strong>',
    noticeComeBackHtml: 'ℹ️ After you send the reply code, <strong>come back to this page and wait here</strong>. It will connect on its own once the other person continues.',

    btnRestart: 'Start Over',

    connectionInfoP2P: '🔗 P2P — a direct connection, no server',
    connectionInfoEncrypted: '🔒 Protected by encryption (DTLS)',
    connectionRouteChecking: '🎯 Checking the connection path…',
    routeDirect: '🎯 Direct connection ({local}/{remote})',
    routeRelay: '⚠️ Routed through a relay ({local}/{remote})',
    fingerprintCaption: '🔒 The other person should see the same emoji. To be safe, check this some other way (not in this chat) before you start.',
    connectedMessage: '✅ Connected! You can now talk to each other.',
    typingIndicator: 'Typing…',

    attachTitle: 'Send a file (up to a few hundred MB)',
    attachLabel: 'File',
    chatPlaceholder: 'Type a message',
    sendLabel: 'Send',
    dropOverlayText: 'Drop here to send the file',
    downloadWithSize: 'Download ({size})',
    fileCancelButton: 'Cancel',
    fileDeleteButton: 'Delete',
    fileSendingMeta: '{sent} / {size} ({elapsed}s elapsed)',
    fileDoneMeta: '{size} ({elapsed}s)',
    fileCancelledMeta: 'Cancelled',
    fileDeletedMeta: 'Deleted',

    statusConnected: 'Connected',
    statusPreparing: 'Getting ready…',
    statusWaitingPeer: 'Waiting for the other person…',
    statusConnecting: 'Connecting…',
    statusDisconnected: 'Disconnected',
    statusFailed: 'Could not connect',

    errDisconnected: 'The connection was lost. Please start over.',
    errCouldNotConnect: 'Could not connect. Some networks cannot connect to each other (for example, two mobile networks). Please try a different network.',
    errInviteCreateFailed: 'Could not create the invite link. Your browser may not support this.',
    errInviteReadFailed: 'Could not read the invite link. Please check the link, or ask the sender for a new one.',
    errPasteReplyCode: 'Please paste the reply code.',
    errBadCode: 'This code does not look right. Please paste the correct reply code.',
    copyFailed: 'Could not copy automatically. The text is now selected — please copy it yourself.',

    lengthHint: 'This is long, but please copy all of it ({n} characters)',
  },
};

function detectLanguage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'ja' || saved === 'en') return saved;
  return (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

let currentLang = detectLanguage();

export function getLang() {
  return currentLang;
}

export function t(key, params) {
  const template = DICT[currentLang]?.[key] ?? DICT.ja[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => (name in params ? params[name] : ''));
}

function applyTranslations() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
}

export function setLang(lang) {
  if (lang !== 'ja' && lang !== 'en') return;
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  applyTranslations();
}

export function initI18n() {
  applyTranslations();
}
