// 文字列 <-> 圧縮base64url 変換
// ブラウザ標準の CompressionStream / DecompressionStream (deflate-raw) を使用する。
// 招待URLのフラグメントや返信コードとしてそのまま貼り付けられるよう、
// base64url (+/= を使わない変種) にエンコードする。

export async function compressToBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  return bytesToBase64Url(compressed);
}

export async function decompressFromBase64Url(base64url) {
  const bytes = base64UrlToBytes(base64url);
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const decompressed = new Uint8Array(await new Response(ds.readable).arrayBuffer());
  return new TextDecoder().decode(decompressed);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(base64url) {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// 貼り付け時に混入しがちな空白・改行を取り除く
export function sanitizeCode(code) {
  return code.replace(/\s+/g, '');
}
