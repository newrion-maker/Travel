// 하루 무료 코스 생성 횟수 카운트.
// TODO(앱인토스 인증 완료 후): 클라이언트 localStorage는 재설치/캐시 삭제로 우회 가능하므로
// 서버/스토리지 기준 카운트로 교체해야 함(유료화 정책 기획서 5장 참고).

const STORAGE_KEY = 'travelapp.dailyGenCount'

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function read() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed?.date === todayKey() && Number.isFinite(parsed.count)) return parsed
  } catch {
    // localStorage 접근 불가(시크릿 모드 등) — 카운트 없이 매번 무료로 취급
  }
  return { date: todayKey(), count: 0 }
}

export function getDailyGenCount() {
  return read().count
}

export function incrementDailyGenCount() {
  const next = { date: todayKey(), count: read().count + 1 }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 저장 실패해도 이번 요청은 이미 진행되므로 무시
  }
  return next.count
}
