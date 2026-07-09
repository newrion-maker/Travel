import { useEffect, useMemo, useRef, useState } from 'react'
import { QUESTIONS } from './data/questions.js'
import regionData from './data/regions.json'
import curatedData from './data/curated-regions.json'
import { formatKRW, sumCostRange, budgetState, formatPlaceCost } from './lib/budget.js'
import { computePersonality } from './lib/personality.js'
import { generateCourses } from './lib/courses.js'
import { fetchTourPlaces, hasTourApiKey } from './lib/tourApi.js'
import { getDailyGenCount, incrementDailyGenCount } from './lib/dailyLimit.js'
import { getSavedCourses, saveCourse, removeSavedCourse } from './lib/savedCourses.js'
import { TossAds } from '@apps-in-toss/web-framework'
import splashBackground from './assets/splash-background.jpg'
import splashTravel from './assets/splash-travel.webp'
import personalityFood from './assets/personality-food.webp'
import personalitySight from './assets/personality-sight.webp'
import personalityStay from './assets/personality-stay.webp'

const initialInput = {
  region: '',
  regionLabel: '',
  period: '1박2일',
  party: 2,
  arrivalTime: '오후',
  budget: 150000,
}

const DAILY_FREE_LIMIT = 3
const BUDGET_STEP = 50000
const BUDGET_MIN = 30000

const periods = ['당일치기', '1박2일', '2박3일']
const arrivalTimes = ['오전', '오후', '저녁']
const accentClass = {
  teal: { text: 'text-teal-deep', bg: 'bg-teal-tint', chip: 'bg-teal-tint text-teal-deep' },
  coral: { text: 'text-coral-deep', bg: 'bg-coral-tint', chip: 'bg-coral-tint text-coral-deep' },
  amber: { text: 'text-amber-text', bg: 'bg-amber/15', chip: 'bg-amber/15 text-amber-text' },
}

const personalityImages = {
  L: personalityStay,
  F: personalityFood,
  A: personalitySight,
}

function parsePositiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function readSharedState() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('view') !== 'courses') return null

  const nextInput = {
    ...initialInput,
    region: params.get('r') || initialInput.region,
    regionLabel: params.get('rl') || params.get('r') || initialInput.regionLabel,
    period: params.get('p') || initialInput.period,
    party: parsePositiveNumber(params.get('party'), initialInput.party),
    arrivalTime: params.get('arr') || initialInput.arrivalTime,
    budget: parsePositiveNumber(params.get('b'), initialInput.budget),
  }
  const encodedAnswers = params.get('ans') || ''
  const nextAnswers = {}
  QUESTIONS.forEach((question, index) => {
    const answer = encodedAnswers[index]
    if (answer) nextAnswers[question.id] = answer
  })

  return {
    input: nextInput,
    answers: nextAnswers,
    activeCourse: Math.max(0, Number(params.get('c')) || 0),
    screen: 'courses',
  }
}

function buildShareUrl({ input, answers, active }) {
  const url = new URL(window.location.href)
  const params = new URLSearchParams()
  params.set('view', 'courses')
  params.set('r', input.region)
  if (input.regionLabel && input.regionLabel !== input.region) params.set('rl', input.regionLabel)
  params.set('p', input.period)
  params.set('party', String(input.party))
  params.set('arr', input.arrivalTime)
  params.set('b', String(input.budget))
  params.set('ans', QUESTIONS.map((question) => answers[question.id] || '').join(''))
  params.set('c', String(active))
  url.search = params.toString()
  return url.toString()
}

function compactPlaceForAi(place) {
  return {
    name: place.name,
    kind: place.kind,
    tag: place.kakaoAddress || place.tag,
    cost: place.cost,
  }
}

function compactCourseForAi(course) {
  return {
    key: course.key,
    label: course.label,
    title: course.title,
    budget: course.budget,
    ratios: course.ratios,
    budgetTier: course.budgetTier,
    places: course.places.slice(0, 6).map(compactPlaceForAi),
    days: course.days.slice(0, 3).map((day) => ({
      day: day.day,
      title: day.title,
      summary: day.summary,
      places: day.places.slice(0, 4).map(compactPlaceForAi),
    })),
  }
}

function buildCourseShareMessage({ input, course, days, shareUrl }) {
  const cityName = input.regionLabel || input.region.split(' ').at(-1)
  const title = `${cityName} ${input.period} ${course.label} 코스`
  const lines = [title, '']

  days.forEach((day, index) => {
    const places = day.places.slice(0, 5)
    if (!places.length) return
    lines.push(`${index + 1}일차: ${places.map((place) => place.name).join(', ')}`)
  })

  lines.push('', `예상 비용 ${course.budget}`, '', '내 코스 보기', shareUrl)
  return lines.join('\n')
}

function isKakaoVerifiedPlace(place) {
  return Boolean(place?.kakaoSupported !== false && place?.kakaoPlaceId && /^https?:\/\/place\.map\.kakao\.com\//u.test(place.mapUrl || ''))
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Some in-app browsers block the modern clipboard API.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  return copied
}

export default function App() {
  const [sharedState] = useState(readSharedState)
  const [screen, setScreen] = useState(sharedState?.screen || 'splash')
  const [input, setInput] = useState(sharedState?.input || initialInput)
  const [answers, setAnswers] = useState(sharedState?.answers || {})
  const [questionIndex, setQuestionIndex] = useState(0)
  const [activeCourse, setActiveCourse] = useState(sharedState?.activeCourse || 0)
  const [tourPlaces, setTourPlaces] = useState([])
  const [aiPlans, setAiPlans] = useState({})
  const [aiPlanSource, setAiPlanSource] = useState('fallback')
  const [adGateOpen, setAdGateOpen] = useState(false)
  const [viewingSaved, setViewingSaved] = useState(null)
  const aiReqSigRef = useRef('')

  const personality = useMemo(() => computePersonality(answers, input.period), [answers, input.period])
  const courses = useMemo(() => generateCourses(input, personality, tourPlaces), [input, personality, tourPlaces])
  const canStartTest = input.region && Number(input.budget) > 0
  const currentQuestion = QUESTIONS[questionIndex]

  useEffect(() => {
    // 지역이 바뀌면 이전 지역의 AI 플랜은 무효 — 새 플랜을 받기 전까지 규칙 코스로 되돌린다.
    setAiPlans({})
    aiReqSigRef.current = ''
    if (!hasTourApiKey || !input.region) {
      setTourPlaces([])
      return
    }

    let alive = true
    fetchTourPlaces(input.region)
      .then((places) => {
        if (alive) setTourPlaces(places)
      })
      .catch(() => {
        if (alive) setTourPlaces([])
      })

    return () => {
      alive = false
    }
  }, [input.region])

  useEffect(() => {
    if (!['loading', 'courses'].includes(screen)) return

    let alive = true
    let applied = false
    const verifiedPlaces = (tourPlaces || []).filter(isKakaoVerifiedPlace)
    const finishLoading = () => setScreen((s) => (s === 'loading' ? 'courses' : s))

    // 화면 전환 등으로 effect가 같은 조건에서 다시 실행될 때 중복 AI 호출을 막는다.
    // (완료 전 취소되면 아래 cleanup에서 서명을 해제해 재요청을 허용한다 — StrictMode 이중 마운트 대응)
    const reqSig = `${input.region}|${input.budget}|${input.period}|${input.arrivalTime}|${personality?.top || ''}|${verifiedPlaces.length}`
    if (aiReqSigRef.current === reqSig) {
      finishLoading()
      return undefined
    }
    aiReqSigRef.current = reqSig

    setAiPlanSource('loading')
    const courseMetas = courses.map((c) => ({
      key: c.key,
      label: c.label,
      ratios: c.ratios,
      budgetNet: c.budgetNet,
      days: c.days?.length || 1,
      itemsPerDay: (c.days || []).map((d) => d.places.length),
    }))

    fetch('/api/ai-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input, personality, places: verifiedPlaces, courses: courseMetas }),
    })
      .then((response) => (response.ok ? response.json() : { plans: [] }))
      .then((data) => {
        if (!alive) return
        applied = true
        const next = {}
        for (const plan of data.plans || []) {
          if (plan.key) next[plan.key] = plan
        }
        // 화면 전환(loading→courses)으로 effect가 재실행되며 나가는 2차 호출이
        // 일시적 빈 결과(fallback)를 주더라도, 이미 받은 AI 플랜을 덮어쓰지 않는다.
        if (Object.keys(next).length) {
          setAiPlans(next)
          setAiPlanSource(data.source === 'openai' ? 'openai' : 'fallback')
        } else {
          setAiPlanSource((prev) => (prev === 'openai' ? 'openai' : 'fallback'))
        }
        finishLoading()
      })
      .catch(() => {
        if (alive) {
          applied = true
          setAiPlans({})
          setAiPlanSource('fallback')
          finishLoading()
        }
      })

    return () => {
      alive = false
      // 이 실행이 결과를 반영하기 전에 취소됐다면 서명을 풀어 다음 실행이 다시 요청하게 한다.
      if (!applied) aiReqSigRef.current = ''
    }
  }, [screen, input, personality, courses, tourPlaces])

  function goHome() {
    setAnswers({})
    setQuestionIndex(0)
    setActiveCourse(0)
    setViewingSaved(null)
    setScreen('splash')
  }

  function chooseAnswer(key) {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: key }))
    if (questionIndex < QUESTIONS.length - 1) {
      window.setTimeout(() => setQuestionIndex((n) => n + 1), 180)
    } else {
      window.setTimeout(() => setScreen('personality'), 220)
    }
  }

  function showCourses() {
    setActiveCourse(0)
    setScreen('loading')
  }

  // [내 맞춤 코스 보기] 클릭 = AI 코스 생성 호출 시점. 유료화 정책 기획서 3장 기준 광고 게이트.
  function requestCourses() {
    if (getDailyGenCount() < DAILY_FREE_LIMIT) {
      incrementDailyGenCount()
      showCourses()
    } else {
      setAdGateOpen(true)
    }
  }

  function handleAdComplete() {
    incrementDailyGenCount()
    setAdGateOpen(false)
    showCourses()
  }

  // 로딩 안전장치: AI 응답이 12초(서버 wall-clock) 넘게 안 오면 강제로 결과 화면으로.
  useEffect(() => {
    if (screen !== 'loading') return undefined
    const timer = window.setTimeout(() => setScreen((s) => (s === 'loading' ? 'courses' : s)), 13000)
    return () => window.clearTimeout(timer)
  }, [screen])

  return (
    <main className="min-h-[100dvh] bg-screen text-ink sm:bg-[#e7ebeb]">
      <PhoneShell tone={screen === 'splash' ? 'teal' : 'light'}>
        {screen === 'splash' && (
          <Splash onStart={() => setScreen('input')} onViewSaved={() => setScreen('savedList')} hasSaved={getSavedCourses().length > 0} />
        )}
        {screen === 'input' && (
          <InputScreen input={input} setInput={setInput} canContinue={canStartTest} onBack={() => setScreen('splash')} onNext={() => setScreen('test')} />
        )}
        {screen === 'test' && (
          <TestScreen
            question={currentQuestion}
            index={questionIndex}
            picked={answers[currentQuestion.id]}
            onHome={goHome}
            onBack={() => (questionIndex === 0 ? setScreen('input') : setQuestionIndex((n) => n - 1))}
            onPick={chooseAnswer}
          />
        )}
        {screen === 'personality' && <PersonalityScreen personality={personality} onHome={goHome} onNext={requestCourses} />}
        {screen === 'loading' && <LoadingScreen />}
        {screen === 'courses' && (
          <CoursesScreen
            input={input}
            courses={courses}
            tourPlaces={tourPlaces}
            aiPlans={aiPlans}
            aiPlanSource={aiPlanSource}
            active={activeCourse}
            onActive={setActiveCourse}
            onHome={goHome}
            onBack={() => setScreen('personality')}
            shareUrl={buildShareUrl({ input, answers, active: activeCourse })}
          />
        )}
        {screen === 'savedList' && (
          <SavedCoursesScreen
            onOpen={(entry) => {
              setViewingSaved(entry)
              setScreen('savedDetail')
            }}
            onBack={() => setScreen('splash')}
            onHome={goHome}
          />
        )}
        {screen === 'savedDetail' && viewingSaved && (
          <SavedCourseDetailScreen
            entry={viewingSaved}
            onBack={() => setScreen('savedList')}
            onHome={goHome}
            onDelete={() => {
              removeSavedCourse(viewingSaved.id)
              setViewingSaved(null)
              setScreen('savedList')
            }}
          />
        )}
        <AdGateModal open={adGateOpen} onComplete={handleAdComplete} onClose={() => setAdGateOpen(false)} />
      </PhoneShell>
    </main>
  )
}

function PhoneShell({ children, tone }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full bg-screen sm:max-w-[430px] sm:items-stretch sm:justify-center sm:bg-[#dfe5e5] sm:py-6">
      <section
        className={`relative h-[100dvh] min-h-[100dvh] w-full overflow-hidden sm:h-auto sm:min-h-[860px] sm:rounded-[34px] sm:shadow-2xl ${
          tone === 'teal' ? 'bg-[#3FB3B4] text-white' : 'bg-screen text-ink'
        }`}
      >
        {children}
      </section>
    </div>
  )
}

function Splash({ onStart, onViewSaved, hasSaved }) {
  return (
    <div
      className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#3FB3B4] bg-[length:100%_auto] bg-top bg-no-repeat px-7 pb-[calc(20px+env(safe-area-inset-bottom))] pt-[72px] text-white sm:min-h-[860px]"
      style={{ backgroundColor: '#3FB3B4', backgroundImage: `url(${splashBackground})` }}
    >
      {hasSaved && (
        <button
          onClick={onViewSaved}
          className="absolute right-5 top-[max(env(safe-area-inset-top),20px)] z-20 text-[12.5px] font-bold text-white/85 underline underline-offset-2"
        >
          저장한 코스
        </button>
      )}
      <div className="relative z-10 mx-auto rounded-full bg-white/18 px-5 py-2.5 text-[13px] font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-sm">
        AI 여행 코스 추천
      </div>
      <div className="relative z-10 flex flex-1 flex-col items-center pt-[82px] text-center">
        <h1 className="whitespace-pre-line text-[32px] font-extrabold leading-[1.33] drop-shadow-[0_2px_10px_rgba(0,96,98,0.14)]">
          예산만 정하면{'\n'}코스는 똑똑하게
        </h1>
        <p className="mt-6 text-[16px] font-semibold leading-[1.75] text-white/90">
          성향 테스트로 나에게 맞는
          <br />
          여름 여행 코스를 짜드려요
        </p>
      </div>
      <button onClick={onStart} className="relative z-10 h-16 rounded-[17px] bg-white font-extrabold text-teal-deep shadow-[0_12px_26px_rgba(0,102,108,0.18)]">
        시작하기
      </button>
      <p className="relative z-10 mt-5 text-center text-xs font-semibold text-white/78">성향 테스트 미니앱 · 여름 챌린지</p>
    </div>
  )
}

function RegionPicker({ open, onClose, onSelect }) {
  const [sido, setSido] = useState(null)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false) // 전체 시/군/구 보기 토글

  useEffect(() => {
    if (open) {
      setSido(null)
      setQuery('')
      setShowAll(false)
    }
  }, [open])

  if (!open) return null

  const q = query.trim()
  const CURATED = curatedData.curated
  const makeRegionLabel = (region, label) => {
    const sidoName = region.split(' ')[0] || ''
    if (!label) return region
    return label.startsWith(sidoName) ? label : `${sidoName} ${label}`
  }
  const toItem = (sidoName, sg) => {
    const c = CURATED[`${sidoName} ${sg.name}`]
    const region = `${sidoName} ${sg.name}`
    return { key: `${sidoName}-${sg.code}`, region, regionLabel: makeRegionLabel(region, c?.label || ''), sido: sidoName, sg: sg.name, label: c?.label || '', keywords: c?.keywords || [] }
  }
  const allSpotItems = Object.entries(CURATED).flatMap(([region, info]) => {
    const sidoName = region.split(' ')[0] || ''
    const sgName = region.split(' ').slice(1).join(' ')
    return (info.keywords || []).map((spot) => ({
      key: `${region}-${spot}`,
      spot,
      sg: sgName,
      region,
      regionLabel: `${sidoName} ${spot}`,
      label: spot,
      keywords: [spot, info.label || '', region],
    }))
  })
  const searchResults = q
    ? [
        ...allSpotItems.filter(
          (it) => it.region.includes(q) || it.sg.includes(q) || it.spot.includes(q) || it.keywords.some((k) => k.includes(q)),
        ),
        ...regionData.sido.flatMap((s) => s.sigungu.map((sg) => toItem(s.name, sg))),
      ]
        .filter(
          (it) =>
            it.region.includes(q) || it.sg.includes(q) || it.sido?.includes(q) || it.label.includes(q) || it.keywords.some((k) => k.includes(q)),
        )
        .slice(0, 50)
    : []

  // 시/도의 여행지(명소)를 펼친 목록. 각 명소 → 소속 구로 코스 생성.
  // 각 구의 대표 명소(첫 키워드)부터 한 바퀴씩 돌려, 지역별 대표지가 먼저 오게(인기순) 한다.
  const spotItems = []
  if (sido) {
    const prefix = `${sido.name} `
    const curatedKeys = Object.keys(CURATED).filter((k) => k.startsWith(prefix))
    const maxLen = curatedKeys.reduce((m, k) => Math.max(m, (CURATED[k].keywords || []).length), 0)
    const seen = new Set()
    for (let i = 0; i < maxLen; i += 1) {
      for (const key of curatedKeys) {
        const spot = (CURATED[key].keywords || [])[i]
        if (!spot || seen.has(spot)) continue
        seen.add(spot)
        const sgName = key.slice(prefix.length)
        spotItems.push({ key: `${key}-${spot}`, spot, sg: sgName, region: key, regionLabel: `${sido.name} ${spot}` })
      }
    }
  }
  const sigunguItems = sido ? sido.sigungu.map((sg) => toItem(sido.name, sg)).sort((a, b) => (b.label ? 1 : 0) - (a.label ? 1 : 0)) : []
  const spotMode = sido && !showAll && spotItems.length > 0

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="닫기" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-[430px]">
        <div className="animate-fade-slide flex max-h-[82vh] flex-col rounded-t-[24px] bg-white pb-6 shadow-2xl">
          <div className="flex items-center gap-2 px-4 pt-4">
            {sido && !q ? (
              <button
                type="button"
                onClick={() => {
                  setSido(null)
                  setShowAll(false)
                }}
                className="h-9 w-9 rounded-full text-2xl font-bold text-ink-2"
                aria-label="뒤로"
              >
                ‹
              </button>
            ) : (
              <span className="h-9 w-9" />
            )}
            <h3 className="flex-1 text-center text-base font-extrabold">{sido && !q ? `${sido.name} 여행지` : '지역 선택'}</h3>
            <button type="button" onClick={onClose} className="h-9 w-9 rounded-full text-lg font-bold text-ink-3" aria-label="닫기">
              ✕
            </button>
          </div>
          <div className="px-4 pt-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputMode="search"
              placeholder="지역·관광지 검색 (예: 경포대, 성심당)"
              className="h-11 w-full rounded-field border border-line bg-screen px-4 text-sm font-bold outline-none focus:border-teal"
            />
          </div>
          {sido && !q && (
            <p className="px-4 pt-2 text-[11.5px] font-semibold text-ink-3">
              {spotMode ? `${sido.name}에서 가고 싶은 여행지를 골라보세요` : '시/군/구를 직접 선택하세요'}
            </p>
          )}
          <div className="mt-3 flex-1 overflow-y-auto px-4">
            {q ? (
              searchResults.length ? (
                <div className="grid gap-1.5 pb-2">
                  {searchResults.map((it) => (
                    <button
                      key={it.key}
                      type="button"
                      onClick={() => onSelect({ region: it.region, regionLabel: it.regionLabel })}
                      className="flex items-center gap-2 rounded-[12px] border border-line bg-white px-4 py-2.5 text-left hover:bg-screen"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-bold">{it.regionLabel || it.label || it.region}</p>
                        {it.label && <p className="truncate text-[11px] font-semibold text-ink-3">{it.region}</p>}
                      </div>
                      {it.label && <span className="shrink-0 rounded-full bg-teal-tint px-2 py-0.5 text-[10px] font-extrabold text-teal-deep">여행지</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-sm font-semibold text-ink-3">검색 결과가 없어요</p>
              )
            ) : spotMode ? (
              <div className="grid gap-1.5 pb-2">
                {spotItems.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => onSelect({ region: it.region, regionLabel: it.regionLabel })}
                    className="flex items-center gap-2 rounded-[12px] border border-line bg-white px-4 py-2.5 text-left hover:bg-screen"
                  >
                    <p className="min-w-0 flex-1 truncate text-[15px] font-bold">{it.spot}</p>
                    <span className="shrink-0 text-[11px] font-semibold text-ink-3">{it.sg}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-1 w-full rounded-[12px] border border-dashed border-line py-2.5 text-[12.5px] font-bold text-ink-2 hover:bg-screen"
                >
                  전체 시/군/구 보기
                </button>
              </div>
            ) : sido ? (
              <div className="grid gap-1.5 pb-2">
                {spotItems.length > 0 && (
                  <button type="button" onClick={() => setShowAll(false)} className="mb-1 self-start text-[12px] font-extrabold text-teal-deep">
                    ‹ 여행지로 보기
                  </button>
                )}
                {sigunguItems.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => onSelect({ region: it.region, regionLabel: it.regionLabel })}
                    className="flex items-center gap-2 rounded-[12px] border border-line bg-white px-4 py-2.5 text-left hover:bg-screen"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-bold">{it.label || it.sg}</p>
                      {it.label && <p className="truncate text-[11px] font-semibold text-ink-3">{it.sg}</p>}
                    </div>
                    {it.label && <span className="shrink-0 rounded-full bg-teal-tint px-2 py-0.5 text-[10px] font-extrabold text-teal-deep">여행지</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 pb-2">
                {regionData.sido.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => {
                      setSido(s)
                      setShowAll(false)
                    }}
                    className="flex h-12 items-center justify-center rounded-[12px] border border-line bg-white text-[15px] font-extrabold hover:bg-teal-tint"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function InputScreen({ input, setInput, canContinue, onBack, onNext }) {
  const [regionOpen, setRegionOpen] = useState(false)
  return (
    <div className="flex h-[100dvh] min-h-[100dvh] flex-col sm:min-h-[860px]">
      <Header title="여행 정보" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-[calc(204px+env(safe-area-inset-bottom))] pt-3">
        <h2 className="whitespace-pre-line text-[22px] font-extrabold leading-snug">어디로, 얼마로{'\n'}떠나볼까요?</h2>
        <p className="mt-2 text-[13px] font-medium text-ink-2">정보를 입력하면 예산에 맞춰 코스를 짜드려요.</p>
        <Field label="지역">
          <button
            type="button"
            onClick={() => setRegionOpen(true)}
            className={`flex h-[54px] w-full items-center justify-between rounded-field border-[1.5px] bg-white px-4 text-base font-bold shadow-field ${
              input.region ? 'border-teal text-ink' : 'border-line text-ink-3'
            }`}
          >
            <span>{input.regionLabel || input.region || '지역을 선택해주세요'}</span>
            <span className="text-[13px] font-bold text-teal-deep">변경</span>
          </button>
          <RegionPicker
            open={regionOpen}
            onClose={() => setRegionOpen(false)}
            onSelect={({ region, regionLabel }) => {
              setInput({ ...input, region, regionLabel: regionLabel || region })
              setRegionOpen(false)
            }}
          />
        </Field>
        <Field label="여행 기간">
          <ChipGroup value={input.period} options={periods} onChange={(period) => setInput({ ...input, period })} />
        </Field>
        <Field label="도착 예정">
          <ChipGroup value={input.arrivalTime} options={arrivalTimes} onChange={(arrivalTime) => setInput({ ...input, arrivalTime })} />
          <p className="mt-2 text-[12.5px] font-medium text-ink-3">첫날 점심부터 볼지, 저녁부터 가볍게 시작할지 정하는 기준이에요.</p>
        </Field>
        <Field label="인원수">
          <div className="flex h-[54px] items-center justify-between rounded-field border border-line bg-white px-3">
            <span className="text-base font-extrabold">{input.party}명</span>
            <div className="flex gap-2">
              <StepButton onClick={() => setInput({ ...input, party: Math.max(1, input.party - 1) })}>-</StepButton>
              <StepButton fill onClick={() => setInput({ ...input, party: input.party + 1 })}>+</StepButton>
            </div>
          </div>
        </Field>
        <Field label="예산">
          <div className="flex h-[56px] items-center rounded-field border-[1.5px] border-teal bg-white px-4 shadow-field">
            <input
              inputMode="numeric"
              value={formatKRW(input.budget)}
              onChange={(e) => setInput({ ...input, budget: Number(e.target.value.replace(/[^\d]/g, '')) })}
              className="min-w-0 flex-1 bg-transparent text-[24px] font-extrabold outline-none"
            />
            <span className="text-lg font-bold text-ink-2">원</span>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <StepButton onClick={() => setInput({ ...input, budget: Math.max(BUDGET_MIN, input.budget - BUDGET_STEP) })}>-</StepButton>
            <StepButton fill onClick={() => setInput({ ...input, budget: input.budget + BUDGET_STEP })}>+</StepButton>
          </div>
          <p className="mt-2 text-[12.5px] font-medium text-ink-3">교통비를 제외하고, 여행지에서 쓸 전체 인원 합산 금액을 입력해주세요.</p>
        </Field>
      </div>
      <BottomBar ad>
        <PrimaryButton disabled={!canContinue} onClick={onNext}>
          성향 테스트 시작하기
        </PrimaryButton>
      </BottomBar>
    </div>
  )
}

function TestScreen({ question, index, picked, onBack, onHome, onPick }) {
  return (
    <div className="flex min-h-screen flex-col px-5 pb-8 pt-[58px] sm:min-h-[860px]">
      <button onClick={onBack} className="absolute left-4 top-5 h-9 w-9 rounded-full text-xl font-bold text-ink-2">
        ‹
      </button>
      <HomeButton onClick={onHome} className="absolute right-4 top-5" />
      <div className="flex items-center gap-3">
        <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-[#E4EBEB]">
          <div className="h-full rounded-full bg-teal" style={{ width: `${((index + 1) / QUESTIONS.length) * 100}%` }} />
        </div>
        <span className="text-sm font-extrabold">
          <b className="text-teal">{index + 1}</b> / {QUESTIONS.length}
        </span>
      </div>
      <div key={question.id} className="mt-14 animate-fade-slide">
        <p className="text-[13px] font-extrabold tracking-[1.5px] text-teal">{question.tag}</p>
        <h2 className="mt-4 whitespace-pre-line text-[25px] font-extrabold leading-[1.42]">{question.title}</h2>
        <div className="mt-9 grid gap-3">
          {question.options.map((option) => (
            <button
              key={option.key}
              onClick={() => onPick(option.key)}
              className={`flex min-h-[86px] items-center gap-4 rounded-card border px-[18px] py-[19px] text-left transition hover:-translate-y-0.5 ${
                picked === option.key ? 'border-teal bg-teal/15' : 'border-line bg-white'
              }`}
            >
              <span
                className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-sq text-sm font-extrabold ${
                  picked === option.key ? 'bg-teal text-white' : 'bg-[#EEF3F3] text-[#8A999E]'
                }`}
              >
                {option.key}
              </span>
              <span className="whitespace-pre-line text-[15.5px] font-bold leading-snug">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="mt-auto text-center text-xs font-semibold text-ink-3">정답은 없어요. 지금 끌리는 쪽을 골라주세요.</p>
    </div>
  )
}

function PersonalityScreen({ personality, onHome, onNext }) {
  const tone = accentClass[personality.accent]
  const resultImage = personalityImages[personality.top] ?? personalitySight
  return (
    <div className="flex min-h-screen flex-col px-5 pb-[220px] pt-[68px] text-center sm:min-h-[860px]">
      <HomeButton onClick={onHome} className="absolute right-4 top-5" />
      <div className="mx-auto rounded-full bg-teal-tint px-4 py-2 text-[12.5px] font-extrabold text-teal-deep">분석 완료</div>
      <img
        src={resultImage}
        alt="성향 결과 이미지"
        className="mx-auto mt-9 h-[132px] w-[132px] rounded-[30px] object-contain shadow-card-soft"
      />
      <p className="mt-8 text-sm font-bold text-ink-2">당신의 여름 여행 성향은</p>
      <h2 className={`mt-2 text-[30px] font-extrabold ${tone.text}`}>{personality.label}</h2>
      <div className="mt-6 rounded-card bg-white px-5 py-5 text-[14.5px] font-medium leading-relaxed text-[#3E4C51] shadow-card-soft">
        {personality.desc[0]}
        <b className={tone.text}>{personality.desc[1]}</b>
        {personality.desc[2]}
      </div>
      <BudgetPreview ratios={personality.ratios} className="mt-8" />
      <BottomBar ad>
        <PrimaryButton onClick={onNext}>내 맞춤 코스 보기</PrimaryButton>
      </BottomBar>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-5 text-center sm:min-h-[860px]">
      <div className="relative flex h-[132px] w-[132px] items-center justify-center">
        <div className="absolute inset-0 animate-spin095 rounded-full border-[7px] border-[#E1EAEA] border-t-teal" />
        <div className="flex h-[104px] w-[104px] animate-bob-fast items-center justify-center rounded-full bg-white shadow-card-soft">
          <img src={splashTravel} alt="" className="h-[104px] w-[104px] translate-y-1 object-contain" />
        </div>
      </div>
      <h2 className="mt-10 text-[22px] font-extrabold">AI가 코스를 짜는 중...</h2>
      <p className="mt-3 text-[14.5px] font-medium text-ink-2">예산에 맞춰 일정을 설계하고 있어요</p>
      <div className="mt-10 grid w-full max-w-[260px] gap-3 text-left text-sm font-bold">
        <CheckLine done>성향 분석 완료</CheckLine>
        <CheckLine done>지역 장소 데이터 정리</CheckLine>
        <CheckLine>AI가 예산 안에서 일정 설계 중</CheckLine>
      </div>
    </div>
  )
}

function CoursesScreen({ input, courses, tourPlaces, aiPlans, aiPlanSource, active, onActive, onBack, onHome, shareUrl }) {
  const [activeDay, setActiveDay] = useState(0)
  const [shareStatus, setShareStatus] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [overrides, setOverrides] = useState({}) // { [courseKey]: { [slotId]: place } } — 탭별 스왑
  const [removed, setRemoved] = useState({}) // { [courseKey]: { [slotId]: true } } — 유저가 뺀 장소
  const [swapTarget, setSwapTarget] = useState(null) // { slotId, kind } | null
  const activeIndex = Math.min(Math.max(active, 0), courses.length - 1)
  const baseCourse = courses[activeIndex]
  const ai = aiPlans?.[baseCourse.key]
  const hasAiOverride = Boolean(ai)
  // AI가 실제로 설계한 코스면(ai.days) 일정(장소·순서·역할)까지 교체. 코스 메타(예산·성향)는 규칙 것 유지.
  const course = ai
    ? { ...baseCourse, aiPlan: ai, ...(ai.days?.length ? { days: ai.days, places: ai.days.flatMap((d) => d.places) } : {}) }
    : baseCourse
  const tone = accentClass[course.accent]
  const dayPlans = course.days?.length ? course.days : [{ day: 1, title: '1일차', places: course.places }]

  // 유효 코스 = 기본 코스 + 사용자 스왑(오버라이드) − 사용자가 뺀 장소. 미터·리스트·지도 모두 이걸로 재계산.
  const courseOverrides = overrides[course.key] || {}
  const courseRemoved = removed[course.key] || {}
  const applyOverride = (place) => {
    const rep = place.slotId ? courseOverrides[place.slotId] : null
    return rep ? { ...rep, slotId: place.slotId, role: place.role } : place
  }
  const effectiveDays = dayPlans.map((day) => ({
    ...day,
    places: day.places
      .filter((place) => !(place.slotId && courseRemoved[place.slotId]))
      .map(applyOverride)
      .filter(isKakaoVerifiedPlace),
  }))
  const effectivePlaces = effectiveDays.flatMap((day) => day.places)
  const effectiveCourse = { ...course, days: effectiveDays, places: effectivePlaces }
  const currentDay = effectiveDays[Math.min(activeDay, effectiveDays.length - 1)]
  const editedCount = Object.keys(courseOverrides).length
  const removedCount = Object.keys(courseRemoved).length
  const changeNote = [editedCount && `바꾼 ${editedCount}곳`, removedCount && `뺀 ${removedCount}곳`].filter(Boolean).join(' · ')

  const usedNames = new Set(effectivePlaces.map((p) => p.name))
  const verifiedTourPlaces = (tourPlaces || []).filter(isKakaoVerifiedPlace)
  const hasCandidates = (kind) => verifiedTourPlaces.some((p) => p.kind === kind && !usedNames.has(p.name))
  const baseSlotPlace = (slotId) => dayPlans.flatMap((d) => d.places).find((p) => p.slotId === slotId)
  const swapCandidates = swapTarget ? verifiedTourPlaces.filter((p) => p.kind === swapTarget.kind && !usedNames.has(p.name)) : []
  const swapCurrent = swapTarget ? effectivePlaces.find((p) => p.slotId === swapTarget.slotId) : null

  const setSlot = (slotId, place) => setOverrides((prev) => ({ ...prev, [course.key]: { ...(prev[course.key] || {}), [slotId]: place } }))
  const clearSlot = (slotId) =>
    setOverrides((prev) => {
      const next = { ...(prev[course.key] || {}) }
      delete next[slotId]
      return { ...prev, [course.key]: next }
    })
  const removeSlot = (slotId) => {
    setRemoved((prev) => ({ ...prev, [course.key]: { ...(prev[course.key] || {}), [slotId]: true } }))
    clearSlot(slotId) // 뺀 장소의 스왑 기록은 정리
  }
  const restoreRemoved = () => setRemoved((prev) => ({ ...prev, [course.key]: {} }))
  const resetCourse = () => {
    setOverrides((prev) => ({ ...prev, [course.key]: {} }))
    setRemoved((prev) => ({ ...prev, [course.key]: {} }))
  }

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] flex-col sm:min-h-[860px]">
      <Header title="추천 코스" onBack={onBack} onHome={onHome} right={`${input.regionLabel || input.region.split(' ').at(-1)} · ${input.period} · ${input.arrivalTime} 도착`} />
      <div className="px-4 pt-2">
        <div className="grid rounded-[14px] bg-[#E9EEEE] p-1" style={{ gridTemplateColumns: `repeat(${courses.length}, minmax(0, 1fr))` }}>
          {courses.map((item, idx) => (
            <button
              key={item.key}
              onClick={() => {
                setActiveDay(0)
                setShareStatus('')
                onActive(idx)
              }}
              className={`h-9 rounded-sq-lg text-[12.5px] font-extrabold ${activeIndex === idx ? 'bg-white text-ink shadow-seg' : 'text-[#7B8A8F]'}`}
            >
              {idx === 0 ? '맞춤형' : item.key === 'L' ? '호캉스' : item.key === 'F' ? '미식형' : '알뜰형'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-[calc(280px+env(safe-area-inset-bottom))] pt-3">
        <article className="animate-fade-in rounded-card bg-white p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col items-start gap-2">
              <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${tone.chip}`}>{course.label} 코스</span>
              <DataSourceBadge source={course.source} />
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold text-ink-3">예상 비용</p>
              <p className="text-base font-extrabold">{course.budget}</p>
            </div>
          </div>
          <h2 className="mt-4 text-[19px] font-extrabold">{course.title}</h2>
          <div className="mt-2 flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0 rounded-full bg-[#EAF2F1] px-2 py-0.5 text-[10px] font-extrabold text-teal-deep">AI</span>
            <p className="min-h-[2.6em] text-[12px] font-semibold leading-snug text-[#3E4C51]">{course.aiPlan?.summary || '예산에 맞춰 코스를 정리했어요.'}</p>
          </div>
          <RatioBar ratios={course.ratios} className="mt-4" />
          <div className="mt-1.5 flex gap-2.5 text-[10.5px] font-semibold text-ink-3">
            <span>숙박 {course.ratios.stay}%</span>
            <span>식비 {course.ratios.food}%</span>
            <span>관광 {course.ratios.sight}%</span>
          </div>
          <BudgetMeter course={effectiveCourse} />
          {dayPlans.length > 1 && (
            <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${dayPlans.length}, minmax(0, 1fr))` }}>
              {dayPlans.map((day, idx) => (
                <button
                  key={day.day}
                  type="button"
                  onClick={() => setActiveDay(idx)}
                  className={`h-10 rounded-sq-lg text-[13px] font-extrabold ${
                    activeDay === idx ? 'bg-teal text-white shadow-cta' : 'border border-line bg-white text-ink-2'
                  }`}
                >
                  {day.title}
                </button>
              ))}
            </div>
          )}
          <div className="mt-4">
            <div className="flex items-end justify-between gap-2">
              <p className="text-[12.5px] font-extrabold text-ink-3">{currentDay.title} 코스 동선</p>
              <span className="text-[12px] font-bold text-teal-deep">{currentDay.summary}</span>
            </div>
            <div className="mt-3">
              {currentDay.places.length ? (
                currentDay.places.map((place, idx) => (
                  <PlaceRow
                    key={`${place.slotId || place.name}-${idx}`}
                    place={place}
                    index={idx + 1}
                    onSwap={place.slotId && hasCandidates(place.kind) ? () => setSwapTarget({ slotId: place.slotId, kind: place.kind }) : null}
                    onRemove={place.slotId ? () => removeSlot(place.slotId) : null}
                  />
                ))
              ) : (
                <div className="rounded-[13px] bg-screen px-4 py-5 text-center text-[13px] font-bold leading-relaxed text-ink-2">
                  카카오맵에서 확인된 장소를 찾지 못했어요.
                  <br />
                  다른 지역이나 코스 유형을 선택해 주세요.
                </div>
              )}
            </div>
          </div>
          <MapPreview places={currentDay.places} source={effectivePlaces.length ? course.source : 'sample'} className="mt-4" />
        </article>
      </div>
      <BottomBar ad>
        {(editedCount > 0 || removedCount > 0) && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-[12px] bg-amber/10 px-3 py-2">
            <span className="text-[11px] font-semibold leading-snug text-amber-text">{changeNote} · 공유 링크엔 AI 기본 코스가 담겨요</span>
            <button type="button" onClick={resetCourse} className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-teal-deep">
              되돌리기
            </button>
          </div>
        )}
        {shareStatus && <p className="mb-2 text-center text-[12px] font-extrabold text-teal-deep">{shareStatus}</p>}
        {saveStatus && <p className="mb-2 text-center text-[12px] font-extrabold text-teal-deep">{saveStatus}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              saveCourse({ input, course: effectiveCourse })
              setSaveStatus('코스를 저장했어요')
              window.setTimeout(() => setSaveStatus(''), 1800)
            }}
            className="h-[52px] flex-1 rounded-btn border-[1.5px] border-teal bg-white text-[14px] font-extrabold text-teal-deep"
          >
            저장하기
          </button>
          <button
            type="button"
            onClick={async () => {
              const cityName = input.regionLabel || input.region.split(' ').at(-1)
              const shareMessage = buildCourseShareMessage({ input, course, days: effectiveDays, shareUrl })
              if (navigator.share) {
                try {
                  await navigator.share({ title: `${cityName} 여행 코스`, text: shareMessage, url: shareUrl })
                  return
                } catch (err) {
                  if (err?.name === 'AbortError') return // 사용자가 공유 시트 취소
                }
              }
              const copied = await copyTextToClipboard(shareMessage)
              setShareStatus(copied ? '공유 메시지를 복사했어요' : '복사가 막혔어요. 주소창 링크를 복사해주세요')
              window.setTimeout(() => setShareStatus(''), 1800)
            }}
            className="h-[52px] flex-[1.4] rounded-btn bg-teal text-[15px] font-extrabold text-white shadow-cta"
          >
            코스 공유하기
          </button>
        </div>
      </BottomBar>
      <SwapSheet
        open={Boolean(swapTarget)}
        currentPlace={swapCurrent}
        basePlace={swapTarget ? baseSlotPlace(swapTarget.slotId) : null}
        candidates={swapCandidates}
        region={input.region}
        onClose={() => setSwapTarget(null)}
        onSelect={(place) => {
          setSlot(swapTarget.slotId, place)
          setSwapTarget(null)
        }}
        onRevert={() => {
          clearSlot(swapTarget.slotId)
          setSwapTarget(null)
        }}
      />
    </div>
  )
}

function SavedCoursesScreen({ onOpen, onBack, onHome }) {
  const [list, setList] = useState(() => getSavedCourses())

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] flex-col sm:min-h-[860px]">
      <Header title="저장한 코스" onBack={onBack} onHome={onHome} />
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {list.length === 0 ? (
          <div className="mt-16 text-center text-[13.5px] font-semibold text-ink-3">아직 저장한 코스가 없어요.</div>
        ) : (
          <div className="grid gap-3">
            {list.map((entry) => (
              <div key={entry.id} className="rounded-card bg-white p-4 shadow-card">
                <button type="button" onClick={() => onOpen(entry)} className="block w-full text-left">
                  <p className="text-[11px] font-bold text-ink-3">{new Date(entry.savedAt).toLocaleDateString('ko-KR')} 저장</p>
                  <h3 className="mt-1 text-[16px] font-extrabold">{entry.course.title}</h3>
                  <p className="mt-1 text-[12.5px] font-semibold text-ink-2">
                    {entry.regionLabel} · {entry.period} · {entry.course.label}
                  </p>
                  <p className="mt-1 text-[12.5px] font-bold text-teal-deep">{entry.course.budget}</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    removeSavedCourse(entry.id)
                    setList(getSavedCourses())
                  }}
                  className="mt-2 text-[11.5px] font-bold text-ink-3 underline"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SavedCourseDetailScreen({ entry, onBack, onHome, onDelete }) {
  const [activeDay, setActiveDay] = useState(0)
  const course = entry.course
  const tone = accentClass[course.accent] || accentClass.teal
  const dayPlans = course.days?.length ? course.days : [{ day: 1, title: '1일차', places: course.places }]
  const currentDay = dayPlans[Math.min(activeDay, dayPlans.length - 1)]

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] flex-col sm:min-h-[860px]">
      <Header title="저장한 코스" onBack={onBack} onHome={onHome} right={`${entry.regionLabel} · ${entry.period} · ${entry.arrivalTime} 도착`} />
      <div className="flex-1 overflow-y-auto px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-3">
        <article className="animate-fade-in rounded-card bg-white p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col items-start gap-2">
              <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${tone.chip}`}>{course.label} 코스</span>
              <DataSourceBadge source={course.source} />
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold text-ink-3">예상 비용</p>
              <p className="text-base font-extrabold">{course.budget}</p>
            </div>
          </div>
          <h2 className="mt-4 text-[19px] font-extrabold">{course.title}</h2>
          {course.aiPlan?.summary && (
            <div className="mt-2 flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0 rounded-full bg-[#EAF2F1] px-2 py-0.5 text-[10px] font-extrabold text-teal-deep">AI</span>
              <p className="min-h-[2.6em] text-[12px] font-semibold leading-snug text-[#3E4C51]">{course.aiPlan.summary}</p>
            </div>
          )}
          <RatioBar ratios={course.ratios} className="mt-4" />
          <div className="mt-1.5 flex gap-2.5 text-[10.5px] font-semibold text-ink-3">
            <span>숙박 {course.ratios.stay}%</span>
            <span>식비 {course.ratios.food}%</span>
            <span>관광 {course.ratios.sight}%</span>
          </div>
          <BudgetMeter course={course} />
          {dayPlans.length > 1 && (
            <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${dayPlans.length}, minmax(0, 1fr))` }}>
              {dayPlans.map((day, idx) => (
                <button
                  key={day.day}
                  type="button"
                  onClick={() => setActiveDay(idx)}
                  className={`h-10 rounded-sq-lg text-[13px] font-extrabold ${
                    activeDay === idx ? 'bg-teal text-white shadow-cta' : 'border border-line bg-white text-ink-2'
                  }`}
                >
                  {day.title}
                </button>
              ))}
            </div>
          )}
          <div className="mt-4">
            <div className="flex items-end justify-between gap-2">
              <p className="text-[12.5px] font-extrabold text-ink-3">{currentDay.title} 코스 동선</p>
              <span className="text-[12px] font-bold text-teal-deep">{currentDay.summary}</span>
            </div>
            <div className="mt-3">
              {currentDay.places.map((place, idx) => (
                <PlaceRow key={`${place.slotId || place.name}-${idx}`} place={place} index={idx + 1} onSwap={null} onRemove={null} />
              ))}
            </div>
          </div>
          <MapPreview places={currentDay.places} source={course.source} className="mt-4" />
        </article>
      </div>
      <BottomBar>
        <button type="button" onClick={onDelete} className="h-[52px] w-full rounded-btn border-[1.5px] border-line text-[14px] font-extrabold text-ink-2">
          저장 삭제하기
        </button>
      </BottomBar>
    </div>
  )
}

function Header({ title, onBack, onHome, right }) {
  return (
    <header className="flex h-[54px] shrink-0 items-center gap-2.5 px-3.5 pt-[max(env(safe-area-inset-top),8px)]">
      {onBack ? (
        <button onClick={onBack} className="h-9 w-9 rounded-full text-2xl font-bold text-ink-2" aria-label="뒤로">
          ‹
        </button>
      ) : (
        <span className="h-9 w-9" />
      )}
      <h1 className="text-base font-extrabold">{title}</h1>
      {right && <span className="ml-auto max-w-[150px] truncate text-[11.5px] font-bold text-ink-3">{right}</span>}
      {onHome && <HomeButton onClick={onHome} />}
    </header>
  )
}

function HomeButton({ onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="메인화면으로 이동"
      title="메인화면으로"
      className={`flex h-9 w-9 items-center justify-center text-[#9AA5B1] ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-8 w-8"
        aria-hidden="true"
      >
        <path d="M3.4 11.2 12 4 20.6 11.2" />
        <path d="M5.4 9.7 V19.4 H18.6 V9.7" />
        <path d="M9.6 19.4 V14.2 Q9.6 12.4 12 12.4 Q14.4 12.4 14.4 14.2 V19.4" />
      </svg>
    </button>
  )
}

function Field({ label, children }) {
  return (
    <label className="mt-5 block">
      <span className="mb-1.5 block text-[13px] font-extrabold text-ink-2">{label}</span>
      {children}
    </label>
  )
}

function ChipGroup({ value, options, onChange, variant = 'teal' }) {
  const selected = variant === 'coral' ? 'border-coral bg-coral-tint text-coral-deep' : 'border-teal bg-teal text-white'
  return (
    <div className="flex gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`h-11 flex-1 rounded-chip border px-2 text-[13px] font-bold ${
            value === option ? selected : 'border-line bg-white text-ink-2'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function StepButton({ children, fill, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[38px] w-[38px] rounded-sq-lg text-xl font-extrabold ${fill ? 'bg-teal text-white' : 'border border-line text-ink-2'}`}
    >
      {children}
    </button>
  )
}

// 앱인토스 콘솔 승인 전이라 테스트 광고그룹 ID 사용 중. 승인 후 실제 배너 광고그룹 ID로 교체할 것.
const BANNER_AD_GROUP_ID = 'ait-ad-test-banner-id'

// TossAds.*.isSupported()는 토스 앱 밖(일반 브라우저 등)에서 false를 반환하는 대신
// "not a constant handler" 에러를 던진다 — 문서화되지 않은 동작이라 항상 try/catch로 방어한다.
function safeIsTossAdsSupported(fn) {
  try {
    return fn()
  } catch {
    return false
  }
}

let tossAdsInitPromise = null
function ensureTossAdsInitialized() {
  if (!safeIsTossAdsSupported(TossAds.initialize.isSupported)) return Promise.resolve(false)
  if (tossAdsInitPromise) return tossAdsInitPromise
  tossAdsInitPromise = new Promise((resolve) => {
    try {
      TossAds.initialize({
        callbacks: {
          onInitialized: () => resolve(true),
          onInitializationFailed: () => resolve(false),
        },
      })
    } catch {
      resolve(false)
    }
  })
  return tossAdsInitPromise
}

// 앱인토스 WebView 배너 광고. 토스 앱 밖(일반 브라우저 등)에서는 지원되지 않아
// 자동으로 자리표시자만 보여준다 — 승인 후 실제 앱에서 열면 이 자리에 실제 배너가 붙는다.
function AdBanner({ className = '' }) {
  const containerRef = useRef(null)
  const [attached, setAttached] = useState(false)

  useEffect(() => {
    let alive = true
    let result = null
    if (!safeIsTossAdsSupported(TossAds.attachBanner.isSupported)) return undefined

    ensureTossAdsInitialized().then((ok) => {
      if (!alive || !ok || !containerRef.current) return
      try {
        result = TossAds.attachBanner(BANNER_AD_GROUP_ID, containerRef.current, { theme: 'auto' })
        setAttached(true)
      } catch {
        // 배너를 붙일 수 없는 환경 — 자리표시자 유지
      }
    })

    return () => {
      alive = false
      result?.destroy()
    }
  }, [])

  return (
    <div ref={containerRef} className={`h-[96px] w-full overflow-hidden rounded-[10px] ${className}`}>
      {!attached && (
        <div className="flex h-full w-full items-center justify-center bg-[#F4F6F6] text-[11px] font-semibold text-ink-3">
          광고 영역 (토스 앱에서만 표시)
        </div>
      )}
    </div>
  )
}

function BottomBar({ children, ad = false }) {
  return (
    <div className="absolute inset-x-0 bottom-0 border-t border-line-footer bg-screen/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
      {children}
      {ad && <AdBanner className="mt-3" />}
    </div>
  )
}

const AD_GATE_SECONDS = 5

// 목업 광고 게이트: 실제 앱인토스 IAA SDK 연동 전까지, 타이머로 "광고 시청"을 흉내낸다.
function AdGateModal({ open, onComplete, onClose }) {
  const [remaining, setRemaining] = useState(AD_GATE_SECONDS)

  useEffect(() => {
    if (!open) return undefined
    setRemaining(AD_GATE_SECONDS)
    const timer = window.setInterval(() => setRemaining((n) => Math.max(0, n - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [open])

  if (!open) return null

  const canSkip = remaining <= 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6">
      <div className="w-full max-w-[320px] rounded-card bg-white p-6 text-center shadow-card-soft">
        <p className="text-[13px] font-bold text-ink-2">오늘 무료 생성 횟수를 다 쓰셨어요</p>
        <div className="mx-auto my-5 flex h-[120px] w-full items-center justify-center rounded-[16px] bg-[#EEF3F3] text-[13px] font-bold text-ink-3">
          광고 영역 (목업)
        </div>
        <p className="mb-4 text-[12px] text-ink-3">{canSkip ? '광고 시청 완료' : `${remaining}초 후 스킵 가능`}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="h-[44px] flex-1 rounded-btn border border-line text-[13px] font-bold text-ink-2">
            닫기
          </button>
          <button
            type="button"
            disabled={!canSkip}
            onClick={onComplete}
            className="h-[44px] flex-[2] rounded-btn bg-teal text-[13px] font-extrabold text-white disabled:bg-[#DCE2E2] disabled:text-[#9AA6AB]"
          >
            {canSkip ? '코스 생성하기' : '잠시만 기다려주세요'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PrimaryButton({ children, disabled, onClick }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="h-[52px] w-full rounded-btn bg-teal text-[15px] font-extrabold text-white shadow-cta disabled:bg-[#DCE2E2] disabled:text-[#9AA6AB] disabled:shadow-none"
    >
      {children}
    </button>
  )
}

function TravelBadge({ className }) {
  return (
    <div className={`flex items-center justify-center overflow-hidden ${className}`}>
      <div className="relative h-[70%] w-[70%] rounded-[26px] border-2 border-current/20">
        <div className="absolute left-[18%] top-[24%] h-9 w-9 rounded-full bg-coral/80" />
        <div className="absolute bottom-[18%] right-[14%] h-12 w-12 rounded-full bg-current/20" />
        <div className="absolute left-[16%] right-[16%] top-1/2 border-t-2 border-dashed border-current/50" />
        <span className="absolute bottom-3 left-0 right-0 text-center text-[11px] font-extrabold">SUMMER</span>
      </div>
    </div>
  )
}

function DataSourceBadge({ source }) {
  const live = source === 'tourApi'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold ${
        live ? 'bg-teal-tint text-teal-deep' : 'bg-[#EEF3F3] text-ink-3'
      }`}
      title={live ? '관광공사 TourAPI 실시간 장소를 반영했어요' : '실시간 장소를 불러오지 못해 샘플 데이터로 보여드려요'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-teal' : 'bg-[#B6C2C2]'}`} />
      {live ? '실시간 장소 반영' : '샘플 데이터'}
    </span>
  )
}

const BUDGET_TONE = {
  under: { bg: 'bg-teal-tint', accent: 'text-teal-deep', pill: 'bg-teal text-white', bar: 'bg-teal', track: 'bg-[#DCEEEA]', divide: 'border-[#DCEEEA]', label: '예산 안', check: true },
  near: { bg: 'bg-amber/15', accent: 'text-amber-text', pill: 'bg-amber text-[#5A3E08]', bar: 'bg-amber', track: 'bg-[#EFE2C4]', divide: 'border-[#EADFC2]', label: '예산 근처', check: false },
  over: { bg: 'bg-[#FDECEC]', accent: 'text-[#C0362F]', pill: 'bg-[#E5484D] text-white', bar: 'bg-[#E5484D]', track: 'bg-[#F6D9D9]', divide: 'border-[#F3D3D3]', label: '예산 초과', check: false },
}

function BudgetMeter({ course }) {
  const [open, setOpen] = useState(false)
  const net = course.budgetNet || 0
  const targets = course.budgetTargets || { stay: 0, food: 0, sight: 0 }
  const placesOf = (kind) => (course.places || []).filter((p) => p.kind === kind)
  const total = sumCostRange(course.places)
  const state = budgetState(total, net)
  const t = BUDGET_TONE[state]
  const mid = Math.round((total.min + total.max) / 2)

  const axisMax = Math.max(net * 1.35, total.max * 1.05, 1)
  const pos = (v) => `${Math.max(0, Math.min(100, (v / axisMax) * 100))}%`
  const netPct = pos(net)

  const cats = [
    { label: '숙박', target: targets.stay, actual: sumCostRange(placesOf('stay')) },
    { label: '식비', target: targets.food, actual: sumCostRange(placesOf('food')) },
    { label: '관광', target: targets.sight, actual: sumCostRange(placesOf('sight')) },
  ].filter((c) => c.target > 0 || c.actual.max > 0)

  return (
    <section className={`mt-3 overflow-hidden rounded-[14px] ${t.bg}`}>
      <div className="px-3.5 pb-3 pt-3">
        <div className="flex items-center justify-between">
          <span className={`text-[12px] font-extrabold ${t.accent}`}>예산 사용</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold ${t.pill}`}>
            {t.check && (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6.5 5 9l4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {t.label}
          </span>
        </div>
        <p className="mt-2 text-[13px] leading-snug text-ink">
          {state === 'under' ? (
            <>
              <b className="font-extrabold">선택 합계 ~{formatKRW(mid)}원</b> <span className="text-ink-3">/ {formatKRW(net)}원</span> · 여유 ~{formatKRW(Math.max(0, net - mid))}원
            </>
          ) : state === 'over' ? (
            <>
              <b className="font-extrabold">선택 합계 {formatKRW(total.min)}~{formatKRW(total.max)}원</b> · 예산 {formatKRW(net)}원 초과
            </>
          ) : (
            <>
              <b className="font-extrabold">선택 합계 {formatKRW(total.min)}~{formatKRW(total.max)}원</b> · 예산 안에 들 수도, 넘을 수도
            </>
          )}
        </p>
        {state === 'over' && (
          <p className="mt-1.5 text-[11.5px] font-semibold leading-snug text-[#C0362F]">
            이 예산으론 이 지역이 빠듯해요 — {course.days?.length > 1 ? '예산을 올리거나 당일치기를 추천드려요.' : '예산을 조금 더 올려보세요.'}
          </p>
        )}
        <div className="relative mt-2.5 h-2.5">
          <div className={`absolute inset-0 rounded-full ${t.track}`} />
          {state === 'near' ? (
            <>
              <div className="absolute top-0 h-2.5 rounded-full bg-teal" style={{ left: pos(total.min), width: `calc(${netPct} - ${pos(total.min)})` }} />
              <div className="absolute top-0 h-2.5 rounded-full bg-amber" style={{ left: netPct, width: `calc(${pos(total.max)} - ${netPct})` }} />
            </>
          ) : (
            <div className={`absolute top-0 h-2.5 rounded-full ${t.bar}`} style={{ left: pos(total.min), width: `calc(${pos(total.max)} - ${pos(total.min)})` }} />
          )}
          <div className="absolute bg-ink-2" style={{ left: netPct, top: '-3px', width: '2px', height: '16px' }} />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between border-t px-3.5 py-2.5 text-[11.5px] font-bold text-ink-2 ${t.divide}`}
      >
        <span>카테고리별 목표 대비</span>
        <span className="flex items-center gap-1 text-ink-3">
          {open ? '접기' : '자세히'}
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1">
          <div className="grid gap-2.5">
            {cats.map((c) => {
              const aMid = Math.round((c.actual.min + c.actual.max) / 2)
              const over = c.target > 0 && aMid > c.target
              const axis = Math.max(c.target * 1.4, c.actual.max * 1.05, 1)
              const p = (v) => `${Math.max(0, Math.min(100, (v / axis) * 100))}%`
              return (
                <div key={c.label}>
                  <div className="flex justify-between text-[11.5px]">
                    <span className="text-ink-2">{c.label}</span>
                    <span>
                      {formatKRW(aMid)} <span className="text-ink-3">/ 목표 {formatKRW(c.target)}</span>
                    </span>
                  </div>
                  <div className="relative mt-1 h-2 rounded-full bg-white/70">
                    <div className={`absolute top-0 h-2 rounded-full ${over ? 'bg-amber' : 'bg-teal'}`} style={{ width: p(aMid) }} />
                    {c.target > 0 && <div className="absolute bg-ink-2" style={{ left: p(c.target), top: '-2px', width: '2px', height: '12px' }} />}
                  </div>
                </div>
              )
            })}
          </div>
          {course.aiPlan?.strategy?.length ? (
            <div className={`mt-3 grid gap-1.5 border-t pt-2.5 ${t.divide}`}>
              {course.aiPlan.strategy.map((text) => (
                <p key={text} className="text-[11.5px] font-semibold leading-relaxed text-ink-2">· {text}</p>
              ))}
            </div>
          ) : null}
          <div className={`mt-3 flex flex-col gap-1 border-t pt-2.5 text-[10.5px] text-ink-2 ${t.divide}`}>
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-teal align-middle" />예산 안 — 최대치도 예산 이하</span>
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber align-middle" />예산 근처 — 범위가 예산에 걸침 (들 수도, 넘을 수도)</span>
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: '#E5484D' }} />초과 — 최소치도 예산 초과</span>
          </div>
        </div>
      )}
    </section>
  )
}

function SwapSheet({ open, currentPlace, basePlace, candidates, onClose, onSelect, onRevert }) {
  if (!open) return null
  const mid = (p) => {
    const { min, max } = sumCostRange([p])
    return Math.round((min + max) / 2)
  }
  const curMid = currentPlace ? mid(currentPlace) : 0
  const kindLabel = currentPlace?.kind === 'stay' ? '숙소' : currentPlace?.kind === 'food' ? '맛집·카페' : '관광·체험'
  const isEdited = basePlace && currentPlace && basePlace.name !== currentPlace.name
  const kindTone = (kind) =>
    kind === 'stay' ? 'bg-teal-tint text-teal-deep' : kind === 'food' ? 'bg-coral-tint text-coral-deep' : 'bg-amber/15 text-amber-text'

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="닫기" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-[430px]">
        <div className="animate-fade-slide flex max-h-[82vh] flex-col rounded-t-[24px] bg-white pb-6 shadow-2xl">
          <div className="flex items-center gap-2 px-4 pt-4">
            <span className="h-9 w-9" />
            <h3 className="flex-1 text-center text-base font-extrabold">{kindLabel} 바꾸기</h3>
            <button type="button" onClick={onClose} className="h-9 w-9 rounded-full text-lg font-bold text-ink-3" aria-label="닫기">
              ✕
            </button>
          </div>
          <p className="px-4 pb-1 text-center text-[11.5px] font-semibold text-ink-3">고르면 예산 미터에 바로 반영돼요</p>
          <div className="mt-2 flex-1 overflow-y-auto px-4">
            {isEdited && (
              <button
                type="button"
                onClick={onRevert}
                className="mb-2 flex w-full items-center gap-2.5 rounded-[12px] border border-teal bg-teal-tint px-3 py-2.5 text-left"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sq bg-white text-[11px] font-extrabold text-teal-deep">AI</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-teal-deep">AI 추천으로 되돌리기</span>
                <span className="shrink-0 truncate text-[11.5px] font-semibold text-ink-2">{basePlace.name}</span>
              </button>
            )}
            <div className="grid gap-2 pb-2">
              {candidates.map((c) => {
                const d = mid(c) - curMid
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => onSelect(c)}
                    className="flex items-center gap-3 rounded-[12px] border border-line bg-white px-3 py-2.5 text-left hover:bg-screen"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sq text-[12px] font-extrabold ${kindTone(c.kind)}`}>{c.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold">{c.name}</p>
                      <p className="truncate text-[11px] font-semibold text-ink-3">{c.kakaoAddress || c.tag}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[12px] font-bold text-ink-2">{formatPlaceCost(c)}</p>
                      {d !== 0 && (
                        <p className="text-[10.5px] font-extrabold" style={{ color: d < 0 ? '#0E9A8F' : '#C0362F' }}>
                          예산 {d < 0 ? '−' : '+'}
                          {formatKRW(Math.abs(d))}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
              {!candidates.length && <p className="py-8 text-center text-sm font-semibold text-ink-3">이 지역엔 바꿀 후보가 없어요</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BudgetPreview({ ratios, className }) {
  return (
    <div className={className}>
      <p className="mb-3 text-[12.5px] font-extrabold text-ink-3">예산 배분 미리보기</p>
      <RatioBar ratios={ratios} />
      <div className="mt-3 flex justify-center gap-3 text-xs font-extrabold text-ink-2">
        <span>숙박 {ratios.stay}%</span>
        <span>식비 {ratios.food}%</span>
        <span>관광 {ratios.sight}%</span>
      </div>
    </div>
  )
}

function RatioBar({ ratios, className = '' }) {
  return (
    <div className={`h-3 overflow-hidden rounded-full bg-[#EEF3F3] ${className}`}>
      <div className="flex h-full">
        <div className="bg-teal" style={{ width: `${ratios.stay}%` }} />
        <div className="bg-coral" style={{ width: `${ratios.food}%` }} />
        <div className="bg-amber" style={{ width: `${ratios.sight}%` }} />
      </div>
    </div>
  )
}

// Kakao Maps JS SDK를 1회만 로드하는 싱글턴. JS 키는 도메인 등록으로 보호되는 공개키.
let kakaoMapsPromise = null
function loadKakaoMaps() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.kakao?.maps) return Promise.resolve(window.kakao)
  if (kakaoMapsPromise) return kakaoMapsPromise

  const appKey = import.meta.env.VITE_KAKAO_MAP_KEY
  if (!appKey) return Promise.reject(new Error('no kakao map key'))

  kakaoMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`
    script.async = true
    script.onload = () => window.kakao.maps.load(() => resolve(window.kakao))
    script.onerror = () => {
      kakaoMapsPromise = null
      reject(new Error('kakao sdk load failed'))
    }
    document.head.appendChild(script)
  })
  return kakaoMapsPromise
}

function MapPreview({ places, source, className }) {
  const containerRef = useRef(null)
  const [status, setStatus] = useState('idle') // idle | ready | failed
  const points = useMemo(
    () => (places || []).filter((p) => Number(p.mapx) && Number(p.mapy)).slice(0, 5),
    [places],
  )
  const pointsKey = points.map((p) => `${p.mapx},${p.mapy}`).join('|')
  const useRealMap = Boolean(import.meta.env.VITE_KAKAO_MAP_KEY) && points.length > 0

  useEffect(() => {
    if (!useRealMap) return undefined
    let cancelled = false
    setStatus('idle')

    loadKakaoMaps()
      .then((kakao) => {
        if (cancelled || !containerRef.current) return
        const map = new kakao.maps.Map(containerRef.current, {
          center: new kakao.maps.LatLng(points[0].mapy, points[0].mapx),
          level: 6,
        })
        const bounds = new kakao.maps.LatLngBounds()
        points.forEach((place, idx) => {
          const pos = new kakao.maps.LatLng(place.mapy, place.mapx)
          bounds.extend(pos)
          const pin = document.createElement('div')
          pin.textContent = String(idx + 1)
          pin.style.cssText =
            'display:flex;align-items:center;justify-content:center;width:26px;height:26px;' +
            `border-radius:9999px;background:${idx === 0 ? '#FF7060' : '#12B3A6'};color:#fff;` +
            'font-weight:800;font-size:12px;border:2px solid #fff;box-shadow:0 2px 6px rgba(16,23,28,.3);transform:translateY(-13px)'
          new kakao.maps.CustomOverlay({ map, position: pos, content: pin, yAnchor: 1, zIndex: idx === 0 ? 10 : 5 })
        })
        if (points.length > 1) map.setBounds(bounds)
        else map.setLevel(5)
        if (!cancelled) setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('failed')
      })

    return () => {
      cancelled = true
    }
  }, [useRealMap, pointsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (useRealMap && status !== 'failed') {
    return (
      <div className={`relative h-[170px] overflow-hidden rounded-[14px] bg-[#E9F1F0] ${className}`}>
        <div ref={containerRef} className="h-full w-full" />
        {status !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] font-bold text-ink-3">지도 불러오는 중…</div>
        )}
      </div>
    )
  }

  return <MapPlaceholder places={places} source={source} className={className} />
}

function MapPlaceholder({ places, source, className }) {
  return (
    <div className={`relative h-[150px] overflow-hidden rounded-[14px] bg-[#E9F1F0] ${className}`}>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,179,166,0.09)_1px,transparent_1px),linear-gradient(90deg,rgba(18,179,166,0.09)_1px,transparent_1px)] bg-[length:24px_24px]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 320 150" fill="none">
        <path d="M44 104 C96 28 145 126 198 55 S275 70 292 30" stroke="#12B3A6" strokeWidth="3" strokeDasharray="2 8" />
      </svg>
      {places.slice(0, 5).map((place, idx) => (
        <span
          key={place.name}
          className={`absolute flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold text-white shadow-card ${
            idx === 0 ? 'bg-coral' : 'bg-teal'
          }`}
          style={{ left: `${12 + idx * 18}%`, top: `${62 - (idx % 2) * 32}%` }}
        >
          {idx + 1}
        </span>
      ))}
      <p className="absolute bottom-3 left-0 right-0 text-center font-mono text-[11px] font-bold text-ink-3">
        {source === 'tourApi' ? 'TourAPI 실제 데이터 반영' : '지도 미리보기 · 샘플 데이터'}
      </p>
    </div>
  )
}

function PlaceRow({ place, index, onSwap, onRemove }) {
  const kindTone =
    place.kind === 'stay'
      ? 'bg-teal-tint text-teal-deep'
      : place.kind === 'food'
        ? 'bg-coral-tint text-coral-deep'
        : 'bg-amber/15 text-amber-text'
  const detail = place.kakaoAddress || place.tag
  const subDetail = place.kakaoPhone || place.kakaoCategory || ''
  return (
    <div className="flex items-center gap-2.5 border-b border-line-hair2 py-2.5 last:border-0">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sq text-[13px] font-extrabold ${kindTone}`}>{place.icon}</span>
      <a href={place.mapUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {place.role && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${kindTone}`}>{place.role}</span>}
          <p className="truncate text-[14.5px] font-extrabold">{place.name}</p>
        </div>
        <p className="truncate text-[12px] font-semibold text-ink-3">{detail}</p>
        {subDetail && <p className="truncate text-[11px] font-semibold text-ink-muted">{subDetail}</p>}
      </a>
      <div className="shrink-0 text-right">
        <p className="text-[12.5px] font-bold text-ink-2">{formatPlaceCost(place)}</p>
        <div className="mt-1 flex items-center justify-end gap-1">
          {onSwap && (
            <button type="button" onClick={onSwap} className="h-7 rounded-full bg-teal-tint px-2.5 text-[10.5px] font-extrabold text-teal-deep">
              바꾸기
            </button>
          )}
          {onRemove ? (
            <button type="button" onClick={onRemove} className="h-7 rounded-full bg-[#F0F3F3] px-2.5 text-[10.5px] font-extrabold text-ink-2">
              빼기
            </button>
          ) : (
            !onSwap && <p className="text-[10.5px] font-extrabold text-teal-deep">지도</p>
          )}
        </div>
      </div>
    </div>
  )
}

function CheckLine({ children, done }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${done ? 'bg-teal text-white' : 'border-2 border-[#CFDADA]'}`}>
        {done ? '✓' : ''}
      </span>
      <span className={done ? 'text-ink' : 'text-ink-3'}>{children}</span>
    </div>
  )
}
