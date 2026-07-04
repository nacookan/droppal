// ============================================================================
// シグナリングモジュール
//
// ここでの「シグナリング」とは、WebRTCの接続確立に必要なSDP(と、その中に
// まとめて含まれるICE候補)を、2人のユーザーの間でどう運ぶかという部分のみを
// 指す。DataChannel確立後のチャット/ファイル転送ロジック(rtc-connection.js)
// はここには一切依存させない。
//
// 実装の差し替えを容易にするため、シグナリングプロバイダーは以下の3メソッドの
// インターフェースを満たすオブジェクトとして定義する。将来コピペ方式から
// WebSocketサーバー方式などに差し替える場合は、この3メソッドを同じシグネチャで
// 実装すればよい(呼び出し側 app.js の変更は最小限で済む想定)。
//
//   createInvite(pc)             : ホスト側。オファーを生成し「招待コード」を返す
//   createReply(pc, inviteCode)  : ゲスト側。招待コードを取り込み「応答コード」を返す
//   completeConnection(pc, replyCode) : ホスト側。応答コードを取り込み接続を完了する
//
// このファイルの実装(CopyPasteSignaling)は、コード文字列を「人間がコピペで
// 運ぶ」ことを前提に、SDPをテキスト圧縮+base64url化した1行の文字列として
// 生成・消費する。
// ============================================================================

import { compressToBase64Url, decompressFromBase64Url, sanitizeCode } from './compress.js';

const ICE_GATHERING_TIMEOUT_MS = 3000;

// Trickle ICEが使えないため、setLocalDescription後にICE候補の収集が
// 完了する(icegatheringstate === 'complete')まで待つ。
// 環境によっては complete にならず固まることがあるため、タイムアウトとの
// raceにし、時間切れの場合はその時点のlocalDescriptionをそのまま使う。
function waitForIceGatheringComplete(pc, timeoutMs) {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icegatheringstatechange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    pc.addEventListener('icegatheringstatechange', onChange);
    const timer = setTimeout(finish, timeoutMs);
  });
}

export const CopyPasteSignaling = {
  /**
   * ホスト側: オファーを生成し、圧縮済みの招待コードを返す。
   * DataChannelは呼び出し側が事前に pc.createDataChannel() 済みであること。
   */
  async createInvite(pc) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc, ICE_GATHERING_TIMEOUT_MS);
    const sdpText = JSON.stringify(pc.localDescription);
    return compressToBase64Url(sdpText);
  },

  /**
   * ゲスト側: 招待コードからオファーを復元して応答(アンサー)を生成し、
   * 圧縮済みの応答コードを返す。
   */
  async createReply(pc, inviteCode) {
    const offerText = await decompressFromBase64Url(sanitizeCode(inviteCode));
    const offer = JSON.parse(offerText);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(pc, ICE_GATHERING_TIMEOUT_MS);
    const sdpText = JSON.stringify(pc.localDescription);
    return compressToBase64Url(sdpText);
  },

  /**
   * ホスト側: 応答コードからアンサーを復元し、接続を完了する。
   */
  async completeConnection(pc, replyCode) {
    const answerText = await decompressFromBase64Url(sanitizeCode(replyCode));
    const answer = JSON.parse(answerText);
    await pc.setRemoteDescription(answer);
  },
};
