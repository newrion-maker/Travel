// 저장한 코스 로컬 보관함. 기기(브라우저) 로컬 저장이라 재설치·다른 기기에는 동기화되지 않는다.
// TODO(백엔드 도입 시): 여러 기기 동기화가 필요해지면 서버 저장으로 교체.

const STORAGE_KEY = 'travelapp.savedCourses'
const MAX_SAVED = 20

function readAll() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(list) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // 저장 공간 부족 등 — 실패해도 화면 동작에는 지장 없음
  }
}

export function getSavedCourses() {
  return readAll()
}

// course는 CoursesScreen의 effectiveCourse(사용자가 바꾸기/빼기한 결과 포함) 스냅샷을 그대로 저장한다.
export function saveCourse({ input, course }) {
  const entry = {
    id: `${Date.now()}`,
    savedAt: new Date().toISOString(),
    regionLabel: input.regionLabel || input.region,
    period: input.period,
    arrivalTime: input.arrivalTime,
    course,
  }
  writeAll([entry, ...readAll()].slice(0, MAX_SAVED))
  return entry
}

export function removeSavedCourse(id) {
  writeAll(readAll().filter((entry) => entry.id !== id))
}
