// ============================================================================
// RtcConnection
//
// RTCPeerConnection の生成、DataChannel上でのチャット/ファイル転送の多重化を
// 担当する。SDPをどう相手に届けるか(シグナリング方式)には一切依存しない。
// signaling.js から返された招待コード/応答コードを使って
// pc.setLocalDescription / setRemoteDescription するのは呼び出し側(app.js)の
// 役目であり、このモジュールはその後のDataChannelの中身だけを扱う。
// ============================================================================

import { createId } from './utils.js';

export const ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

// 【重要】これ以上大きくしないこと。SCTPには1メッセージあたりの上限
// (a=max-message-size)があり、実測したところ Chromium 系ブラウザは
// 262144バイト(256KB)を1バイトでも超えると channel.send() が
// 例外を投げて転送そのものが失敗する(Firefoxは~1GB、WebKitもSDP上は
// 256KB申告)。相手がどのブラウザか分からない前提のアプリである以上、
// 最も厳しいChromiumの上限に合わせる必要があり、256KBが安全な上限値。
const CHUNK_SIZE = 256 * 1024; // 256KB (Chromiumの1メッセージ上限ぴったり)

// バックプレッシャーの閾値。bufferedAmount(バイト数)自体にSCTPの
// 1メッセージ上限のような明確な仕様上の制約はないが、実測したところ
// Chromiumはこれとは別に「キューに積めるメッセージの個数」自体にも
// 内部上限があり、閾値を上げすぎる(16MBで試したところ256KBチャンクが
// 64個分キューに積まれる)と "send queue is full" 例外で転送が失敗した。
// 8MB(256KBチャンク32個分)は実機での連続転送・クロスブラウザ
// (Chromium⇄WebKit)双方向転送で問題なく動作することを確認済み。
// なお、この個数上限はブラウザのバージョンに依存し得るため、_sendWithBackpressure
// 側でも例外時にリトライする防御的な実装にしてある。
const BUFFERED_AMOUNT_HIGH = 8 * 1024 * 1024; // 8MB: これを超えたら送信を一時停止
const BUFFERED_AMOUNT_LOW = 2 * 1024 * 1024; // 再開の閾値

// 進捗コールバックの間引き間隔。チャンクごとに毎回UIを更新すると
// メインスレッドの描画負荷が送信ループと競合するため、時間ベースで間引く。
const PROGRESS_THROTTLE_MS = 150;

export class RtcConnection {
  /**
   * @param {Object} handlers
   * @param {(state: RTCPeerConnectionState) => void} handlers.onConnectionStateChange
   * @param {() => void} handlers.onChannelOpen
   * @param {() => void} handlers.onChannelClose
   * @param {(text: string, ts: number) => void} handlers.onChatMessage
   * @param {(progress: {id, name, index, total, sent, size}) => void} handlers.onSendProgress
   * @param {(progress: {id, name, index, total, received, size}) => void} handlers.onReceiveProgress
   * @param {(file: {id, name, size, mime, index, total, url}) => void} handlers.onFileComplete
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.channel = null;
    this._currentReceive = null;
    this._sendQueue = Promise.resolve();
    this._currentSendId = null;
    this._cancelRequested = false;

    this.pc.addEventListener('connectionstatechange', () => {
      this.handlers.onConnectionStateChange?.(this.pc.connectionState);
    });

    // ゲスト側はここでDataChannelを受け取る
    this.pc.addEventListener('datachannel', (event) => {
      this._setupChannel(event.channel);
    });
  }

  /** ホスト側: オファー生成前に呼ぶこと(SDPにDataChannelの記述を含めるため) */
  createHostChannel() {
    const channel = this.pc.createDataChannel('data');
    this._setupChannel(channel);
    return channel;
  }

  _setupChannel(channel) {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;

    channel.addEventListener('open', () => {
      this.handlers.onChannelOpen?.();
    });
    channel.addEventListener('close', () => {
      this.handlers.onChannelClose?.();
    });
    channel.addEventListener('message', (event) => {
      this._handleMessage(event.data);
    });
  }

  _handleMessage(data) {
    if (typeof data === 'string') {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === 'chat') {
        this.handlers.onChatMessage?.(msg.text, msg.ts);
      } else if (msg.type === 'typing') {
        this.handlers.onPeerTyping?.();
      } else if (msg.type === 'file-meta') {
        this._currentReceive = {
          id: msg.id,
          name: msg.name,
          size: msg.size,
          mime: msg.mime,
          index: msg.index,
          total: msg.total,
          chunks: [],
          received: 0,
          lastProgressAt: 0,
        };
        this.handlers.onReceiveProgress?.({ ...this._currentReceive, received: 0 });
      } else if (msg.type === 'file-end') {
        this._finishReceivingFile(msg.id);
      } else if (msg.type === 'file-cancel') {
        if (this._currentReceive && this._currentReceive.id === msg.id) {
          this._currentReceive = null;
          this.handlers.onReceiveCancelled?.(msg.id);
        }
      } else if (msg.type === 'file-delete') {
        this.handlers.onFileDeleted?.(msg.id);
      }
    } else {
      this._appendChunk(data);
    }
  }

  _appendChunk(buffer) {
    const rx = this._currentReceive;
    if (!rx) return;
    rx.chunks.push(buffer);
    rx.received += buffer.byteLength;

    // 完了時は必ず通知し、途中経過はUI更新負荷を抑えるため時間で間引く
    const now = performance.now();
    const isDone = rx.received >= rx.size;
    if (!isDone && now - rx.lastProgressAt < PROGRESS_THROTTLE_MS) return;
    rx.lastProgressAt = now;

    this.handlers.onReceiveProgress?.({
      id: rx.id,
      name: rx.name,
      size: rx.size,
      index: rx.index,
      total: rx.total,
      received: rx.received,
    });
  }

  _finishReceivingFile(id) {
    const rx = this._currentReceive;
    if (!rx || rx.id !== id) return;
    const blob = new Blob(rx.chunks, { type: rx.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    this.handlers.onFileComplete?.({
      id: rx.id,
      name: rx.name,
      size: rx.size,
      mime: rx.mime,
      index: rx.index,
      total: rx.total,
      url,
    });
    this._currentReceive = null;
  }

  sendChatMessage(text) {
    this.channel.send(JSON.stringify({ type: 'chat', text, ts: Date.now() }));
  }

  sendTypingSignal() {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify({ type: 'typing' }));
    }
  }

  /**
   * 複数ファイルを1件ずつ順番に送信する。呼び出し元の送信キューに積んで
   * 直列化することで、受信側の状態管理(同時に1ファイルのみ受信)と対応させる。
   */
  sendFiles(fileList) {
    const files = Array.from(fileList);
    const total = files.length;
    const run = async () => {
      for (let index = 0; index < files.length; index++) {
        await this._sendOneFile(files[index], index, total);
      }
    };
    this._sendQueue = this._sendQueue.then(run, run);
    return this._sendQueue;
  }

  async _sendOneFile(file, index, total) {
    const id = createId();
    this._currentSendId = id;
    this._cancelRequested = false;

    const meta = {
      type: 'file-meta',
      id,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      index,
      total,
    };
    this.channel.send(JSON.stringify(meta));
    this.handlers.onSendProgress?.({ id, name: file.name, size: file.size, index, total, sent: 0 });

    let offset = 0;
    let lastProgressAt = 0;
    // 次に送るチャンクの読み込みを先読みしておくことで、バックプレッシャー待ち
    // (相手の受信待ち)の間にディスク読み込みを終わらせ、待ち時間を隠す。
    let nextChunkPromise = this._readChunk(file, offset);
    while (offset < file.size) {
      if (this._cancelRequested) break;
      const buffer = await nextChunkPromise;
      const nextOffset = offset + buffer.byteLength;
      nextChunkPromise = nextOffset < file.size ? this._readChunk(file, nextOffset) : null;

      await this._sendWithBackpressure(buffer);
      offset = nextOffset;

      // 完了時は必ず通知し、途中経過はUI更新負荷を抑えるため時間で間引く
      const now = performance.now();
      const isDone = offset >= file.size;
      if (isDone || now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
        lastProgressAt = now;
        this.handlers.onSendProgress?.({ id, name: file.name, size: file.size, index, total, sent: offset });
      }
    }

    this._currentSendId = null;
    if (this._cancelRequested) {
      this._cancelRequested = false;
      this.channel.send(JSON.stringify({ type: 'file-cancel', id }));
      this.handlers.onSendCancelled?.(id);
      return;
    }
    this.channel.send(JSON.stringify({ type: 'file-end', id }));
  }

  /** 送信中のファイルをキャンセルする(送信側専用) */
  cancelSend(id) {
    if (this._currentSendId === id) {
      this._cancelRequested = true;
    }
  }

  /** 送信済みファイルの削除を相手に伝える(送信側専用) */
  deleteFile(id) {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify({ type: 'file-delete', id }));
    }
  }

  _readChunk(file, offset) {
    return file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
  }

  async _sendWithBackpressure(buffer) {
    const channel = this.channel;
    if (channel.bufferedAmount > BUFFERED_AMOUNT_HIGH) {
      await new Promise((resolve) => {
        const onLow = () => {
          channel.removeEventListener('bufferedamountlow', onLow);
          resolve();
        };
        channel.addEventListener('bufferedamountlow', onLow);
      });
    }
    await this._sendWithRetry(buffer);
  }

  // bufferedAmount(バイト数)の閾値だけでは避けきれない、ブラウザ内部の
  // 「キューに積めるメッセージ数」上限に達した場合の防御。
  // 通常はここに来ないが、来た場合は少し待って再試行する。
  _sendWithRetry(buffer) {
    return new Promise((resolve, reject) => {
      const attemptSend = (attempt) => {
        try {
          this.channel.send(buffer);
          resolve();
        } catch (err) {
          if (attempt >= 20) {
            reject(err);
            return;
          }
          setTimeout(() => attemptSend(attempt + 1), 20);
        }
      };
      attemptSend(0);
    });
  }

  close() {
    try {
      this.channel?.close();
    } catch {
      /* noop */
    }
    try {
      this.pc.close();
    } catch {
      /* noop */
    }
  }
}
