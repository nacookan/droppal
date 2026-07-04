// ============================================================================
// 接続の実効スループット・経路種別の監視
//
// RTCPeerConnection.getStats() を定期的に呼び出し、実際に使われている
// candidate-pair (nominated) から、経路の種類(host/srflx/relay)と、
// 直近の送受信バイト数の差分から実効スループットを計算する。
// あくまで画面表示用の目安であり、厳密な計測を意図したものではない。
// ============================================================================

const POLL_INTERVAL_MS = 1500;

/**
 * @param {RTCPeerConnection} pc
 * @param {(info: {localType: string|null, remoteType: string|null, sentRate: number|null, receivedRate: number|null}) => void} onUpdate
 * @returns {() => void} 監視を停止する関数
 */
export function startStatsMonitor(pc, onUpdate) {
  let prevBytesSent = null;
  let prevBytesReceived = null;
  let prevTime = null;
  let stopped = false;

  // nominatedなペアを優先しつつ、ローカル環境ではhost/srflxなど複数の
  // candidate-pairが同時にsucceededになることがあるため、同条件なら
  // 実際の送受信バイト数が多い(＝実際にデータを運んでいる)ペアを選ぶ
  function findActiveCandidatePair(report) {
    let best = null;
    let bestScore = -1;
    report.forEach((stat) => {
      if (stat.type !== 'candidate-pair' || stat.state !== 'succeeded') return;
      const score = (stat.bytesSent || 0) + (stat.bytesReceived || 0);
      if (!best) {
        best = stat;
        bestScore = score;
        return;
      }
      if (stat.nominated && !best.nominated) {
        best = stat;
        bestScore = score;
        return;
      }
      if (stat.nominated === best.nominated && score > bestScore) {
        best = stat;
        bestScore = score;
      }
    });
    return best;
  }

  async function poll() {
    if (stopped) return;
    try {
      const report = await pc.getStats();
      const pair = findActiveCandidatePair(report);

      let localType = null;
      let remoteType = null;
      let bytesSent = null;
      let bytesReceived = null;

      if (pair) {
        bytesSent = pair.bytesSent ?? null;
        bytesReceived = pair.bytesReceived ?? null;
        const local = report.get(pair.localCandidateId);
        const remote = report.get(pair.remoteCandidateId);
        localType = local?.candidateType ?? null;
        remoteType = remote?.candidateType ?? null;
      }

      const now = performance.now();
      let sentRate = null;
      let receivedRate = null;
      if (prevTime !== null && bytesSent !== null && bytesReceived !== null) {
        const dtSec = (now - prevTime) / 1000;
        if (dtSec > 0) {
          sentRate = Math.max(0, (bytesSent - prevBytesSent) / dtSec);
          receivedRate = Math.max(0, (bytesReceived - prevBytesReceived) / dtSec);
        }
      }
      prevBytesSent = bytesSent;
      prevBytesReceived = bytesReceived;
      prevTime = now;

      onUpdate({ localType, remoteType, sentRate, receivedRate });
    } catch {
      // getStatsが取得できない環境でも致命的ではないため無視する
    }
  }

  poll();
  const timer = setInterval(poll, POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
