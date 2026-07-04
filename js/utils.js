// 汎用ユーティリティ

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${exp === 0 ? value : value.toFixed(1)} ${units[exp]}`;
}

// 回線速度の慣例に合わせてSI接頭辞(1000刻み)でbpsとして表示する
// (ファイルサイズのformatBytesは1024刻みのバイト単位なので使い分ける)
export function formatBps(bytesPerSecond) {
  const bits = Math.max(0, bytesPerSecond) * 8;
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  if (bits === 0) return '0 bps';
  const exp = Math.min(Math.floor(Math.log(bits) / Math.log(1000)), units.length - 1);
  const value = bits / Math.pow(1000, exp);
  return `${value.toFixed(1)} ${units[exp]}`;
}

export function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function createId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// 招待URL用の使い捨てトークン。パス・クエリが同一でフラグメント(#以降)だけ
// 異なるURLへの遷移は、ブラウザが「同一ドキュメント内のフラグメント移動」と
// みなしページの再読み込みを行わない(既にこのアプリのページを開いているタブに
// 招待URLを貼り付けても反応しない、という不具合の原因)。クエリ文字列にランダムな
// 値を入れておくことで、常に「別のURL」として扱われ、確実に読み込みが走るようにする。
export function randomShortToken(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
