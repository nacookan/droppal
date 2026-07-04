// ============================================================================
// 接続フィンガープリントの絵文字表示
//
// WebRTCの各PeerConnectionは接続ごとに固有のDTLS証明書を生成し、そのハッシュ値
// (フィンガープリント)が必ずSDPの `a=fingerprint:` 行に含まれる。
// お互いの証明書フィンガープリント(ローカル分・リモート分)を1つに結合して
// ハッシュ化すれば、両者が同じ相手と直接つながっている場合に限り、双方の画面で
// 完全に同じ値が得られる。これを絵文字の並びとして見せることで、
// 「途中でSDPがすり替えられていないか」を人間の目で確認できるようにする。
//
// 似た見た目の絵文字が並んで誤認されないよう、種類・色・輪郭が明確に異なる
// 絵文字だけを64種(2進6bit分)に厳選している。
// ============================================================================

export const EMOJI_ALPHABET = [
  '🦊', '🐢', '🐙', '🦁', '🐸', '🦉', '🐳', '🐨',
  '🐧', '🦄', '🐼', '🦒', '🦓', '🦔', '🦕', '🐘',
  '🦈', '🐬', '🦩', '🦚', '🐓', '🦢', '🐰', '🦥',
  '🍉', '🍇', '🍍', '🥑', '🌽', '🍄', '🍕', '🍔',
  '🍩', '🍦', '🍫', '🥨', '🍙', '🍰', '⚽', '🎸',
  '🎯', '🎁', '🔑', '💎', '🎈', '🧭', '⚓', '🎨',
  '🌵', '🌈', '🌙', '⭐', '🔥', '❄️', '🌊', '🌻',
  '🍀', '🎪', '🚀', '🎡', '🛸', '🧩', '🧸', '🪁',
];

const EMOJI_COUNT = 5; // 30bit相当。誤認防止のための目視確認用途としては十分な長さ

function extractDtlsFingerprint(sdp) {
  const match = /^a=fingerprint:(\S+)\s+(\S+)/m.exec(sdp || '');
  return match ? `${match[1]}:${match[2]}` : null;
}

// SubtleCrypto (crypto.subtle) はセキュアコンテキスト(HTTPS or localhost)でしか
// 使えない。GitHub Pages配信時は常にHTTPSだが、LAN内のIPアドレス直打ちなど
// 非セキュアコンテキストで開かれた場合でも表示が消えてしまわないよう、
// SubtleCryptoが使えないときは簡易ハッシュ(FNV-1a)にフォールバックする。
// あくまで人間の目視確認用の識別子であり暗号学的な強度は要求していないため、
// フォールバック経路でも実用上問題ない。
function fnv1aBytes(str, byteCount) {
  const bytes = [];
  for (let round = 0; round < byteCount; round++) {
    let h = 0x811c9dc5 ^ round;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    bytes.push((h ^ (h >>> 16)) & 0xff);
  }
  return bytes;
}

async function hashToBytes(str, byteCount) {
  if (window.crypto && window.crypto.subtle) {
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return new Uint8Array(digest);
  }
  return fnv1aBytes(str, byteCount);
}

/**
 * 接続済み(または少なくとも双方のSDPが揃った)PeerConnectionから、
 * 双方の画面で一致するはずの絵文字フィンガープリントを計算する。
 * ローカル/リモートの区別に依存しないよう、2つのフィンガープリントは
 * ソートしてから結合する。
 */
export async function computeFingerprintEmoji(pc) {
  const localSdp = pc.localDescription?.sdp;
  const remoteSdp = pc.remoteDescription?.sdp;
  const localFp = extractDtlsFingerprint(localSdp);
  const remoteFp = extractDtlsFingerprint(remoteSdp);
  if (!localFp || !remoteFp) return null;

  const combined = [localFp, remoteFp].sort().join('|');
  const hashBytes = await hashToBytes(combined, EMOJI_COUNT);

  let result = '';
  for (let i = 0; i < EMOJI_COUNT; i++) {
    result += EMOJI_ALPHABET[hashBytes[i] % EMOJI_ALPHABET.length];
  }
  return result;
}
