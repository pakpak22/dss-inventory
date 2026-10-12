/**
 * 파일 크기를 사람이 읽는 글자로 (2026-10-12 사용자: 「B 단위 말고 KB 혹은 MB 단위로」).
 * 1 MB 미만은 KB, 그 위는 MB. 소수 한 자리. 1,024 기준(탐색기와 같은 눈대중).
 * 아주 작은 파일(1 KB 미만)만 B 로 — 「0.0 KB」는 비어 있는 것처럼 보인다.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes.toLocaleString("ko-KR")} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
  const mb = kb / 1024;
  return `${mb.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}
