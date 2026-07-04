import { CopyPasteSignaling } from './signaling.js';
import { RtcConnection } from './rtc-connection.js';
import { copyText } from './clipboard.js';
import { formatBytes, formatBps, formatTime, randomShortToken } from './utils.js';
import { computeFingerprintEmoji } from './fingerprint.js';
import { initViewportController } from './viewport.js';
import { startStatsMonitor } from './stats.js';
import { t, getLang, setLang, initI18n } from './i18n.js';

// キーボード対応のビューポート制御(チャット画面でのみ有効化する)
const viewport = initViewportController();

initI18n();

// ----------------------------------------------------------------------------
// DOM参照
// ----------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const statusbar = $('statusbar');
const statusText = $('statusText');
const statusStats = $('statusStats');
const langToggle = $('langToggle');

const screens = {
  start: $('screen-start'),
  preparing: $('screen-preparing'),
  hostWaiting: $('screen-host-waiting'),
  guestWaiting: $('screen-guest-waiting'),
  error: $('screen-error'),
  chat: $('screen-chat'),
};

const preparingText = $('preparingText');

const inviteUrlField = $('inviteUrlField');
const inviteUrlLengthHint = $('inviteUrlLengthHint');
const btnCopyInvite = $('btnCopyInvite');
const inviteCopiedMsg = $('inviteCopiedMsg');
const replyCodeInput = $('replyCodeInput');
const btnSubmitReply = $('btnSubmitReply');
const hostReplyError = $('hostReplyError');
const hostSlowHint = $('hostSlowHint');

const replyCodeField = $('replyCodeField');
const replyCodeLengthHint = $('replyCodeLengthHint');
const btnCopyReply = $('btnCopyReply');
const replyCopiedMsg = $('replyCopiedMsg');

const errorText = $('errorText');
const btnRestart = $('btnRestart');
const backLinkHost = $('backLinkHost');
const backLinkGuest = $('backLinkGuest');

const chatLayout = $('chatLayout');
const chatLog = $('chatLog');
const chatForm = $('chatForm');
const chatInput = $('chatInput');
const dropOverlay = $('dropOverlay');
const btnPickFile = $('btnPickFile');
const fileInput = $('fileInput');
const typingIndicator = $('typingIndicator');

const tmplMsgText = $('tmpl-msg-text');
const tmplMsgFile = $('tmpl-msg-file');

const connectionInfoCard = $('connectionInfoCard');
const connectionRouteRow = $('connectionRouteRow');
const fingerprintBar = $('fingerprintBar');
const fingerprintEmoji = $('fingerprintEmoji');
const connectedMessageCard = $('connectedMessageCard');

const btnCreateRoom = $('btnCreateRoom');

// ----------------------------------------------------------------------------
// アプリ状態
// ----------------------------------------------------------------------------
let conn = null;
let hasEverConnected = false;
let hostFailTimer = null;
let role = null; // 'host' | 'guest'
let stopStatsMonitor = null;
let typingSendThrottleTimer = null;
let typingHideTimer = null;
const fileMsgElements = new Map(); // id -> {bubble, bar, meta}

function showScreen(name) {
  for (const key in screens) {
    screens[key].hidden = key !== name;
  }
  // 言語切り替えボタンは画面の右上に固定表示だが、チャット画面では
  // 同じ場所にステータスバーの速度表示が来るため、そこでだけ隠す。
  langToggle.hidden = name === 'chat';
  // キーボード用のビューポート制御(高さクランプ+パン打ち消し)は、
  // 入力欄が最下部固定のチャット画面でだけ必要。他の画面ではSafariの
  // 自然な挙動(入力欄への自動スクロール等)に任せる。
  if (name === 'chat') {
    viewport.enable();
  } else {
    viewport.disable();
  }
}

function setStatus(tone, text) {
  statusbar.hidden = false;
  statusbar.dataset.tone = tone;
  statusText.textContent = text;
}

function guardBeforeUnload(on) {
  if (on) {
    window.addEventListener('beforeunload', beforeUnloadHandler);
  } else {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
  }
}
function beforeUnloadHandler(e) {
  e.preventDefault();
  e.returnValue = '';
}

function showError(message) {
  guardBeforeUnload(false);
  clearTimeout(hostFailTimer);
  clearTimeout(typingHideTimer);
  stopStatsMonitor?.();
  stopStatsMonitor = null;
  statusStats.textContent = '';
  statusStats.hidden = true;
  typingIndicator.hidden = true;
  errorText.textContent = message;
  setStatus('error', hasEverConnected ? t('statusDisconnected') : t('statusFailed'));
  showScreen('error');
}

// 経路(host/srflx等)は一度確立すると通話中に変わらないため、チャットログの
// 冒頭カード(connection-info-card)に1回だけ反映する。速度だけは常に変わるので
// ステータスバーに都度反映する。
// host/srflxはどちらも実際のデータはサーバーを経由しない直接P2P経路
// (srflxはSTUNで自分の公開IP:portを知るためだけに使う)。relay(TURN)の
// 場合だけ第三者サーバーを中継するが、本アプリはTURNを設定していないため
// 通常relayになることはない。
function updateStatsDisplay({ localType, remoteType, sentRate, receivedRate }) {
  if (localType && remoteType) {
    const isRelay = localType === 'relay' || remoteType === 'relay';
    connectionRouteRow.textContent = t(isRelay ? 'routeRelay' : 'routeDirect', { local: localType, remote: remoteType });
  }
  if (sentRate !== null && receivedRate !== null) {
    statusStats.textContent = `↑ ${formatBps(sentRate)} / ↓ ${formatBps(receivedRate)}`;
    statusStats.hidden = false;
  }
}

btnRestart.addEventListener('click', () => {
  location.href = location.pathname;
});

// サブディレクトリ配信(GitHub Pagesのプロジェクトページ等)でも正しくトップに
// 戻れるよう、"/" 決め打ちではなく現在のパス(クエリ・フラグメント抜き)にする
backLinkHost.href = location.pathname;
backLinkGuest.href = location.pathname;

// ----------------------------------------------------------------------------
// 言語切り替え(日本語 / English)
// ----------------------------------------------------------------------------
function updateLangToggleLabel() {
  langToggle.textContent = getLang() === 'ja' ? 'EN' : '日本語';
}
updateLangToggleLabel();
langToggle.addEventListener('click', () => {
  setLang(getLang() === 'ja' ? 'en' : 'ja');
  updateLangToggleLabel();
});

// ----------------------------------------------------------------------------
// コピー機能(共通)
// ----------------------------------------------------------------------------
function wireCopyButton(btn, fieldEl, msgEl) {
  btn.addEventListener('click', async () => {
    const ok = await copyText(fieldEl.value, fieldEl);
    if (ok) {
      msgEl.textContent = t('copied');
      msgEl.hidden = false;
      setTimeout(() => { msgEl.hidden = true; }, 1800);
    } else {
      msgEl.textContent = t('copyFailed');
      msgEl.hidden = false;
    }
  });
}
wireCopyButton(btnCopyInvite, inviteUrlField, inviteCopiedMsg);
wireCopyButton(btnCopyReply, replyCodeField, replyCopiedMsg);

// ----------------------------------------------------------------------------
// RtcConnection のハンドラ生成
// ----------------------------------------------------------------------------
function buildConnection() {
  return new RtcConnection({
    onConnectionStateChange: (state) => {
      if (state === 'connected') {
        // 実際の画面遷移は DataChannel の open を基準にする(下記 onChannelOpen)
        return;
      }
      if (hasEverConnected) {
        // 一度確立した接続が切れた場合は、状態に関わらず切断として案内する
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          showError(t('errDisconnected'));
        }
        return;
      }
      // まだ一度も接続できていない場合。
      // ゲスト側は、相手(ホスト)が返信コードを貼り付けるまでの間
      // ローカルのICEが一時的に failed/disconnected を報告することがあるが、
      // 実際には相手が貼り付けた時点で問題なく接続できるケースがほとんどのため、
      // ここでは反応しない(ホスト側の completeConnection 後の安全装置タイマーのみで判定する)。
      if (role === 'guest') return;
      if (state === 'failed') {
        showError(t('errCouldNotConnect'));
      }
    },
    onChannelOpen: () => {
      hasEverConnected = true;
      clearTimeout(hostFailTimer);
      setStatus('connected', t('statusConnected'));
      showScreen('chat');
      chatInput.focus();
      revealSystemCards();
      stopStatsMonitor = startStatsMonitor(conn.pc, updateStatsDisplay);
    },
    onChannelClose: () => {
      if (hasEverConnected) {
        showError(t('errDisconnected'));
      }
    },
    onChatMessage: (text, ts) => {
      appendTextMessage('peer', text, ts);
      typingIndicator.hidden = true;
      clearTimeout(typingHideTimer);
    },
    onPeerTyping: () => {
      typingIndicator.hidden = false;
      clearTimeout(typingHideTimer);
      typingHideTimer = setTimeout(() => {
        typingIndicator.hidden = true;
      }, 3000);
    },
    onSendProgress: ({ id, name, size, index, total, sent }) => {
      ensureFileMessage('self', id, name, size, index, total);
      updateFileProgress(id, sent, size);
    },
    onReceiveProgress: ({ id, name, size, index, total, received }) => {
      ensureFileMessage('peer', id, name, size, index, total);
      updateFileProgress(id, received, size);
    },
    onFileComplete: ({ id, name, size, url, index, total }) => {
      finalizeReceivedFile(id, name, size, url);
    },
  });
}

// ----------------------------------------------------------------------------
// 接続フィンガープリント(絵文字)表示
// ----------------------------------------------------------------------------
async function showFingerprint() {
  if (!conn) return;
  const emoji = await computeFingerprintEmoji(conn.pc);
  if (!emoji) return;
  fingerprintEmoji.textContent = emoji;
  fingerprintBar.hidden = false;
}

// ----------------------------------------------------------------------------
// 接続直後に、通信方式カード → 指紋カード → 接続完了カードの順で
// 0.3秒間隔でチャットログに登場させる(メッセージ投稿と同じ入場アニメーション)
// ----------------------------------------------------------------------------
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function revealSystemCards() {
  connectionInfoCard.hidden = false;
  chatLog.scrollTop = chatLog.scrollHeight;

  await wait(300);
  await showFingerprint();
  chatLog.scrollTop = chatLog.scrollHeight;

  await wait(300);
  connectedMessageCard.hidden = false;
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ----------------------------------------------------------------------------
// チャットログ描画
// ----------------------------------------------------------------------------
function appendTextMessage(who, text, ts) {
  const node = tmplMsgText.content.cloneNode(true);
  const msg = node.querySelector('.msg');
  msg.classList.add(who);
  node.querySelector('.msg-bubble').textContent = text;
  node.querySelector('.msg-time').textContent = formatTime(ts);
  chatLog.appendChild(node);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function ensureFileMessage(who, id, name, size, index, total) {
  if (fileMsgElements.has(id)) return;
  const node = tmplMsgFile.content.cloneNode(true);
  const msg = node.querySelector('.msg');
  msg.classList.add(who);
  node.querySelector('.file-name').textContent = name;
  const metaEl = node.querySelector('.file-meta');
  metaEl.textContent = `${total > 1 ? `(${index + 1}/${total}) ` : ''}${formatBytes(size)}`;
  node.querySelector('.msg-time').textContent = formatTime(Date.now());
  const bar = node.querySelector('.progress-bar');
  const downloadLink = node.querySelector('.file-download');
  chatLog.appendChild(node);
  chatLog.scrollTop = chatLog.scrollHeight;
  fileMsgElements.set(id, { bar, downloadLink, metaEl, size, name });
}

function updateFileProgress(id, transferred, size) {
  const el = fileMsgElements.get(id);
  if (!el) return;
  const pct = size === 0 ? 100 : Math.min(100, Math.round((transferred / size) * 100));
  el.bar.style.width = `${pct}%`;
}

function finalizeReceivedFile(id, name, size, url) {
  const el = fileMsgElements.get(id);
  if (!el) return;
  el.bar.style.width = '100%';
  el.downloadLink.href = url;
  el.downloadLink.download = name;
  el.downloadLink.hidden = false;
  el.downloadLink.textContent = t('downloadWithSize', { size: formatBytes(size) });
}

// ----------------------------------------------------------------------------
// チャット送信 / ファイル送信 UI
// ----------------------------------------------------------------------------
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !conn) return;
  conn.sendChatMessage(text);
  appendTextMessage('self', text, Date.now());
  chatInput.value = '';
});

// 入力中であることを相手に伝える(送りすぎないよう2秒に1回まで)
chatInput.addEventListener('input', () => {
  if (!conn || !chatInput.value || typingSendThrottleTimer) return;
  conn.sendTypingSignal();
  typingSendThrottleTimer = setTimeout(() => {
    typingSendThrottleTimer = null;
  }, 2000);
});

// 他の場所にフォーカスがあった状態から入力欄をタップした際、チャットログが
// 一番下(最新メッセージ)に来るようにする。ソフトウェアキーボードが開く
// アニメーション中にレイアウトが変わることがあるため、少し遅らせても再実行する。
chatInput.addEventListener('focus', () => {
  chatLog.scrollTop = chatLog.scrollHeight;
  setTimeout(() => {
    chatLog.scrollTop = chatLog.scrollHeight;
  }, 300);
});

// textareaはEnterで改行されてしまうため、Enterのみで送信・Shift+Enterで改行にする。
// 日本語IMEなどの変換確定にもEnterが使われるため、変換中(isComposing)は
// 送信しない(keyCode 229は変換中のEnterを示す古いブラウザ向けの保険)。
chatInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  chatForm.requestSubmit();
});

btnPickFile.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    conn.sendFiles(fileInput.files);
  }
  fileInput.value = '';
});

// ドラッグ&ドロップ: 子要素をまたぐ dragenter/dragleave の連続発火による
// ちらつきを避けるため、ネストの深さをカウントして判定する
let dragDepth = 0;
chatLayout.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  dropOverlay.hidden = false;
});
chatLayout.addEventListener('dragover', (e) => {
  e.preventDefault();
});
chatLayout.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
chatLayout.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const files = e.dataTransfer?.files;
  if (files && files.length > 0 && conn) {
    conn.sendFiles(files);
  }
});

// ----------------------------------------------------------------------------
// ホストフロー(A): 新規ルーム作成
// ----------------------------------------------------------------------------
async function startHostFlow() {
  showScreen('preparing');
  preparingText.textContent = t('preparingHost');
  setStatus('waiting', t('statusPreparing'));

  role = 'host';
  conn = buildConnection();
  conn.createHostChannel();

  try {
    const inviteCode = await CopyPasteSignaling.createInvite(conn.pc);
    // ?のあとのランダム文字はページ再読み込みを確実に発生させるためのもので、
    // アプリ側では読み取らない(js/utils.js の randomShortToken 参照)。
    const url = `${location.origin}${location.pathname}?${randomShortToken(4)}#${inviteCode}`;
    inviteUrlField.value = url;
    inviteUrlLengthHint.textContent = t('lengthHint', { n: url.length });
    replyCodeInput.value = '';
    hostReplyError.hidden = true;
    setStatus('waiting', t('statusWaitingPeer'));
    guardBeforeUnload(true);
    showScreen('hostWaiting');
  } catch {
    showError(t('errInviteCreateFailed'));
  }
}

btnCreateRoom.addEventListener('click', startHostFlow);

btnSubmitReply.addEventListener('click', async () => {
  const code = replyCodeInput.value.trim();
  hostReplyError.hidden = true;
  hostSlowHint.hidden = true;
  if (!code) {
    hostReplyError.textContent = t('errPasteReplyCode');
    hostReplyError.hidden = false;
    return;
  }
  btnSubmitReply.disabled = true;
  try {
    await CopyPasteSignaling.completeConnection(conn.pc, code);
    setStatus('connecting', t('statusConnecting'));
    // 相手がブラウザから離れている(ページが一時停止している)間は接続が
    // 進まないが、相手が画面に戻れば普通につながる。そのため時間切れでも
    // エラー画面にはせず、控えめな案内だけ出してそのまま待ち続ける。
    // 本当に接続不可能なケースはICEの'failed'イベント側でエラー画面になる。
    hostFailTimer = setTimeout(() => {
      if (!hasEverConnected) {
        hostSlowHint.hidden = false;
      }
    }, 15000);
  } catch {
    hostReplyError.textContent = t('errBadCode');
    hostReplyError.hidden = false;
  } finally {
    btnSubmitReply.disabled = false;
  }
});

// ----------------------------------------------------------------------------
// ゲストフロー(B): URLを開いたら自動的に応答処理
// ----------------------------------------------------------------------------
async function startGuestFlow(inviteCode) {
  showScreen('preparing');
  preparingText.textContent = t('preparingGuest');
  setStatus('waiting', t('statusPreparing'));

  role = 'guest';
  conn = buildConnection();

  try {
    const replyCode = await CopyPasteSignaling.createReply(conn.pc, inviteCode);
    replyCodeField.value = replyCode;
    replyCodeLengthHint.textContent = t('lengthHint', { n: replyCode.length });
    setStatus('waiting', t('statusWaitingPeer'));
    guardBeforeUnload(true);
    showScreen('guestWaiting');
  } catch {
    showError(t('errInviteReadFailed'));
  }
}

// ----------------------------------------------------------------------------
// 初期化: URLフラグメントを見て A/B いずれのフローかを判定
// ----------------------------------------------------------------------------
function init() {
  const hash = location.hash;
  if (hash.length > 1) {
    startGuestFlow(hash.slice(1));
  } else {
    showScreen('start');
  }
}

init();
