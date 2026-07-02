import { useEffect, useMemo, useState } from 'react'
import { QUESTIONS } from './data/questions.js'
import { formatKRW } from './lib/budget.js'
import { computePersonality } from './lib/personality.js'
import { generateCourses } from './lib/courses.js'
import { fetchTourPlaces, hasTourApiKey } from './lib/tourApi.js'
import splashTravel from './assets/splash-travel.png'
import personalityFood from './assets/personality-food.png'
import personalitySight from './assets/personality-sight.png'
import personalityStay from './assets/personality-stay.png'

const initialInput = {
  region: '강원 강릉시',
  period: '1박2일',
  party: 2,
  arrivalTime: '오후',
  budget: 150000,
  transit: '자차',
  fareIncluded: true,
}

const periods = ['당일치기', '1박2일', '2박3일 이상']
const arrivalTimes = ['오전', '오후', '저녁']
const transits = ['자차', '대중교통']
const regions = ['강원 강릉시', '부산 해운대구', '전북 전주시', '제주 제주시']
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
    period: params.get('p') || initialInput.period,
    party: parsePositiveNumber(params.get('party'), initialInput.party),
    arrivalTime: params.get('arr') || initialInput.arrivalTime,
    budget: parsePositiveNumber(params.get('b'), initialInput.budget),
    transit: params.get('t') || initialInput.transit,
    fareIncluded: params.get('fi') !== '0',
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
  params.set('p', input.period)
  params.set('party', String(input.party))
  params.set('arr', input.arrivalTime)
  params.set('b', String(input.budget))
  params.set('t', input.transit)
  params.set('fi', input.fareIncluded ? '1' : '0')
  params.set('ans', QUESTIONS.map((question) => answers[question.id] || '').join(''))
  params.set('c', String(active))
  url.search = params.toString()
  return url.toString()
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

  const personality = useMemo(() => computePersonality(answers, input.period), [answers, input.period])
  const courses = useMemo(() => generateCourses(input, personality, tourPlaces), [input, personality, tourPlaces])
  const canStartTest = input.region && Number(input.budget) > 0
  const currentQuestion = QUESTIONS[questionIndex]

  useEffect(() => {
    if (!hasTourApiKey) return

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
    const payloadCourses = courses.map((course) => ({
      key: course.key,
      label: course.label,
      title: course.title,
      budget: course.budget,
      ratios: course.ratios,
      budgetTier: course.budgetTier,
      places: course.places,
      days: course.days,
    }))

    fetch('/api/ai-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input, personality, courses: payloadCourses }),
    })
      .then((response) => (response.ok ? response.json() : { plans: [] }))
      .then((data) => {
        if (!alive) return
        const next = {}
        for (const plan of data.plans || []) {
          if (plan.key) next[plan.key] = plan
        }
        setAiPlans(next)
      })
      .catch(() => {
        if (alive) setAiPlans({})
      })

    return () => {
      alive = false
    }
  }, [screen, input, personality, courses])

  function goHome() {
    setAnswers({})
    setQuestionIndex(0)
    setActiveCourse(0)
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
    setScreen('loading')
    window.setTimeout(() => {
      setActiveCourse(0)
      setScreen('courses')
    }, 1300)
  }

  return (
    <main className="min-h-screen bg-[#e7ebeb] text-ink">
      <PhoneShell tone={screen === 'splash' ? 'teal' : 'light'}>
        {screen === 'splash' && <Splash onStart={() => setScreen('input')} />}
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
        {screen === 'personality' && <PersonalityScreen personality={personality} onHome={goHome} onNext={showCourses} />}
        {screen === 'loading' && <LoadingScreen />}
        {screen === 'courses' && (
          <CoursesScreen
            input={input}
            courses={courses}
            aiPlans={aiPlans}
            active={activeCourse}
            onActive={setActiveCourse}
            onHome={goHome}
            onBack={() => setScreen('personality')}
            shareUrl={buildShareUrl({ input, answers, active: activeCourse })}
          />
        )}
      </PhoneShell>
    </main>
  )
}

function PhoneShell({ children, tone }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] items-stretch justify-center bg-[#dfe5e5] sm:py-6">
      <section
        className={`relative min-h-screen w-full overflow-hidden sm:min-h-[860px] sm:rounded-[34px] sm:shadow-2xl ${
          tone === 'teal' ? 'bg-teal text-white' : 'bg-screen text-ink'
        }`}
      >
        {children}
      </section>
    </div>
  )
}

function Splash({ onStart }) {
  return (
    <div className="flex min-h-screen flex-col px-6 pb-9 pt-[70px] sm:min-h-[860px]">
      <div className="pointer-events-none absolute -left-10 top-24 h-44 w-44 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -right-12 top-36 h-32 w-32 rounded-full bg-coral/35" />
      <div className="mx-auto rounded-full bg-white/20 px-4 py-2 text-[12.5px] font-bold">AI 여행 코스 추천</div>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <h1 className="whitespace-pre-line text-[31px] font-extrabold leading-tight">예산만 정하면{'\n'}코스는 똑똑하게</h1>
        <p className="mt-5 text-[15px] leading-relaxed text-white/85">
          성향 테스트로 나에게 맞는
          <br />
          여름 여행 코스를 짜드려요
        </p>
        <img
          src={splashTravel}
          alt=""
          className="mt-10 h-[210px] w-[210px] object-contain"
        />
      </div>
      <button onClick={onStart} className="h-14 rounded-btn bg-white font-extrabold text-teal-deep shadow-cta-white">
        시작하기
      </button>
      <p className="mt-4 text-center text-xs font-semibold text-white/75">성향 테스트 미니앱 · 여름 챌린지</p>
    </div>
  )
}

function InputScreen({ input, setInput, canContinue, onBack, onNext }) {
  return (
    <div className="flex min-h-screen flex-col sm:min-h-[860px]">
      <Header title="여행 정보" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 pb-28 pt-5">
        <h2 className="whitespace-pre-line text-2xl font-extrabold leading-snug">어디로, 얼마로{'\n'}떠나볼까요?</h2>
        <p className="mt-3 text-sm font-medium text-ink-2">정보를 입력하면 예산에 맞춰 코스를 짜드려요.</p>
        <Field label="지역">
          <select
            value={input.region}
            onChange={(e) => setInput({ ...input, region: e.target.value })}
            className="h-[54px] w-full rounded-field border-[1.5px] border-teal bg-white px-4 text-base font-bold shadow-field outline-none"
          >
            {regions.map((region) => (
              <option key={region}>{region}</option>
            ))}
          </select>
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
          <div className="flex h-[62px] items-center rounded-field border-[1.5px] border-teal bg-white px-4 shadow-field">
            <input
              inputMode="numeric"
              value={formatKRW(input.budget)}
              onChange={(e) => setInput({ ...input, budget: Number(e.target.value.replace(/[^\d]/g, '')) })}
              className="min-w-0 flex-1 bg-transparent text-[26px] font-extrabold outline-none"
            />
            <span className="text-lg font-bold text-ink-2">원</span>
          </div>
          <p className="mt-2 text-[12.5px] font-medium text-ink-3">전체 인원 합산 금액을 입력해주세요.</p>
        </Field>
        <Field label="이동수단">
          <ChipGroup value={input.transit} options={transits} onChange={(transit) => setInput({ ...input, transit })} />
        </Field>
        <Field label="교통비 포함 여부">
          <ChipGroup
            value={input.fareIncluded ? '예산에 포함' : '별도로 계산'}
            options={['예산에 포함', '별도로 계산']}
            variant="coral"
            onChange={(v) => setInput({ ...input, fareIncluded: v === '예산에 포함' })}
          />
        </Field>
      </div>
      <BottomBar>
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
    <div className="flex min-h-screen flex-col px-5 pb-28 pt-[68px] text-center sm:min-h-[860px]">
      <HomeButton onClick={onHome} className="absolute right-4 top-5" />
      <div className="mx-auto rounded-full bg-teal-tint px-4 py-2 text-[12.5px] font-extrabold text-teal-deep">분석 완료</div>
      <img
        src={resultImage}
        alt="성향 결과 이미지"
        className={`mx-auto mt-9 h-[132px] w-[132px] rounded-full object-cover shadow-card-soft ${tone.bg}`}
      />
      <p className="mt-8 text-sm font-bold text-ink-2">당신의 여름 여행 성향은</p>
      <h2 className={`mt-2 text-[30px] font-extrabold ${tone.text}`}>{personality.label}</h2>
      <div className="mt-6 rounded-card bg-white px-5 py-5 text-[14.5px] font-medium leading-relaxed text-[#3E4C51] shadow-card-soft">
        {personality.desc[0]}
        <b className={tone.text}>{personality.desc[1]}</b>
        {personality.desc[2]}
      </div>
      <BudgetPreview ratios={personality.ratios} className="mt-8" />
      <BottomBar>
        <PrimaryButton onClick={onNext}>내 맞춤 코스 보기</PrimaryButton>
      </BottomBar>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 text-center sm:min-h-[860px]">
      <div className="relative flex h-[120px] w-[120px] items-center justify-center">
        <div className="absolute inset-0 animate-spin095 rounded-full border-[7px] border-[#E1EAEA] border-t-teal" />
        <TravelBadge className="h-24 w-24 animate-bob-fast rounded-full bg-teal-tint text-teal-deep" />
      </div>
      <h2 className="mt-10 text-[22px] font-extrabold">코스를 짜는 중...</h2>
      <p className="mt-3 text-[14.5px] font-medium text-ink-2">예산에 맞춰 정리하고 있어요</p>
      <div className="mt-10 grid w-full max-w-[260px] gap-3 text-left text-sm font-bold">
        <CheckLine done>성향 분석 완료</CheckLine>
        <CheckLine done>지역 장소 데이터 정리</CheckLine>
        <CheckLine>예산 배분 · 동선 설계 중</CheckLine>
      </div>
    </div>
  )
}

function CoursesScreen({ input, courses, aiPlans, active, onActive, onBack, onHome, shareUrl }) {
  const [activeDay, setActiveDay] = useState(0)
  const [shareStatus, setShareStatus] = useState('')
  const activeIndex = Math.min(Math.max(active, 0), courses.length - 1)
  const baseCourse = courses[activeIndex]
  const course = aiPlans?.[baseCourse.key] ? { ...baseCourse, aiPlan: aiPlans[baseCourse.key] } : baseCourse
  const tone = accentClass[course.accent]
  const dayPlans = course.days?.length ? course.days : [{ day: 1, title: '1일차', places: course.places }]
  const currentDay = dayPlans[Math.min(activeDay, dayPlans.length - 1)]
  return (
    <div className="flex min-h-screen flex-col sm:min-h-[860px]">
      <Header title="추천 코스" onBack={onBack} onHome={onHome} right={`${input.region.split(' ').at(-1)} · ${input.period} · ${input.arrivalTime} 도착`} />
      <div className="px-5 pt-3">
        <div className="grid grid-cols-3 rounded-[14px] bg-[#E9EEEE] p-1">
          {courses.map((item, idx) => (
            <button
              key={item.key}
              onClick={() => {
                setActiveDay(0)
                setShareStatus('')
                onActive(idx)
              }}
              className={`h-10 rounded-sq-lg text-[13px] font-extrabold ${activeIndex === idx ? 'bg-white text-ink shadow-seg' : 'text-[#7B8A8F]'}`}
            >
              {idx === 0 ? '맞춤형' : item.key === 'L' ? '호캉스' : item.key === 'F' ? '미식형' : '알뜰형'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-28 pt-4">
        <article className="animate-fade-in rounded-card-lg bg-white p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${tone.chip}`}>{course.label} 코스</span>
            <div className="text-right">
              <p className="text-[11px] font-bold text-ink-3">예상 비용</p>
              <p className="text-base font-extrabold">{course.budget}</p>
            </div>
          </div>
          <h2 className="mt-5 text-[21px] font-extrabold">{course.title}</h2>
          <p className="mt-2 text-[13px] font-semibold text-ink-2">
            숙박 {course.ratios.stay}% · 식비 {course.ratios.food}% · 관광 {course.ratios.sight}%
          </p>
          <RatioBar ratios={course.ratios} className="mt-5" />
          <AiPlanSummary plan={course.aiPlan} />
          {dayPlans.length > 1 && (
            <div className="mt-5 grid gap-2" style={{ gridTemplateColumns: `repeat(${dayPlans.length}, minmax(0, 1fr))` }}>
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
          <SlotPreview slots={course.aiPlan?.slots} className="mt-5" />
          <MapPreview places={currentDay.places} source={course.source} className="mt-6" />
          <div className="mt-6 border-t border-line-hair pt-5">
            <div className="flex items-end justify-between gap-3">
              <p className="text-[12.5px] font-extrabold text-ink-3">{currentDay.title} 코스 동선</p>
              <span className="text-[12px] font-bold text-teal-deep">{currentDay.summary}</span>
            </div>
            <div className="mt-3">
              {currentDay.places.map((place, idx) => (
                <PlaceRow key={`${place.name}-${idx}`} place={place} index={idx + 1} region={input.region} />
              ))}
            </div>
          </div>
          <div className="mt-5 rounded-[13px] bg-screen px-4 py-4 text-[13px] font-bold leading-relaxed text-ink-2">
            <span className="text-teal-deep">이동 안내</span> · {course.transit}
          </div>
        </article>
      </div>
      <BottomBar>
        {shareStatus && <p className="mb-2 text-center text-[12px] font-extrabold text-teal-deep">{shareStatus}</p>}
        <PrimaryButton
          onClick={() => {
            navigator.clipboard?.writeText(shareUrl)
            setShareStatus('공유 링크를 복사했어요')
            window.setTimeout(() => setShareStatus(''), 1800)
          }}
        >
          코스 공유하기
        </PrimaryButton>
      </BottomBar>
    </div>
  )
}

function Header({ title, onBack, onHome, right }) {
  return (
    <header className="flex h-[58px] items-center gap-3 px-4 pt-2">
      {onBack ? (
        <button onClick={onBack} className="h-9 w-9 rounded-full text-2xl font-bold text-ink-2" aria-label="뒤로">
          ‹
        </button>
      ) : (
        <span className="h-9 w-9" />
      )}
      <h1 className="text-base font-extrabold">{title}</h1>
      {right && <span className="ml-auto max-w-[170px] truncate text-[12px] font-bold text-ink-3">{right}</span>}
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
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-white text-[17px] font-extrabold text-ink-2 shadow-card-soft ${className}`}
    >
      ⌂
    </button>
  )
}

function Field({ label, children }) {
  return (
    <label className="mt-6 block">
      <span className="mb-2 block text-[13.5px] font-extrabold text-ink-2">{label}</span>
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
          className={`h-[46px] flex-1 rounded-chip border px-2 text-sm font-bold ${
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

function BottomBar({ children }) {
  return <div className="absolute inset-x-0 bottom-0 border-t border-line-footer bg-screen px-5 pb-8 pt-3">{children}</div>
}

function PrimaryButton({ children, disabled, onClick }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="h-14 w-full rounded-btn bg-teal text-base font-extrabold text-white shadow-cta disabled:bg-[#DCE2E2] disabled:text-[#9AA6AB] disabled:shadow-none"
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

function AiPlanSummary({ plan }) {
  if (!plan) return null

  return (
    <section className="mt-5 rounded-[14px] bg-screen px-4 py-4 text-left">
      <p className="text-[12px] font-extrabold text-teal-deep">AI 예산 진단</p>
      <p className="mt-2 text-[14px] font-bold leading-relaxed text-ink">{plan.summary}</p>
      <div className="mt-4 grid gap-2">
        {plan.budgetTable?.map((item) => (
          <div key={item.label} className="flex items-center justify-between rounded-[10px] bg-white px-3 py-2">
            <span className="text-[13px] font-bold text-ink-2">{item.label}</span>
            <span className="text-[13px] font-extrabold text-ink">{formatKRW(item.amount)}원</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-2">
        {plan.strategy?.map((text) => (
          <p key={text} className="rounded-[10px] bg-white px-3 py-2 text-[12.5px] font-semibold leading-relaxed text-ink-2">
            {text}
          </p>
        ))}
      </div>
    </section>
  )
}

function SlotPreview({ slots, className = '' }) {
  if (!slots?.length) return null

  return (
    <section className={className}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12.5px] font-extrabold text-ink-3">AI 추천 흐름</p>
        <span className="text-[11.5px] font-bold text-teal-deep">장소 검증 전 슬롯</span>
      </div>
      <div className="grid gap-2">
        {slots.slice(0, 6).map((slot, idx) => (
          <div key={`${slot.day}-${slot.time}-${idx}`} className="flex items-center gap-3 rounded-[12px] border border-line bg-white px-3 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sq bg-teal-tint text-[12px] font-extrabold text-teal-deep">
              {slot.day}D
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-extrabold text-ink">{slot.time}</p>
              <p className="truncate text-[12.5px] font-semibold text-ink-3">{slot.keyword}</p>
            </div>
            <span className="rounded-full bg-screen px-2 py-1 text-[11px] font-bold text-ink-2">{slot.type}</span>
          </div>
        ))}
      </div>
    </section>
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

function MapPreview({ places, source, className }) {
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

function kakaoMapUrl(place, region) {
  if (place.mapUrl) return place.mapUrl
  const query = [region, place.name].filter(Boolean).join(' ')
  return `https://map.kakao.com/link/search/${encodeURIComponent(query)}`
}

function PlaceRow({ place, index, region }) {
  const kindTone =
    place.kind === 'stay'
      ? 'bg-teal-tint text-teal-deep'
      : place.kind === 'food'
        ? 'bg-coral-tint text-coral-deep'
        : 'bg-amber/15 text-amber-text'
  const detail = place.kakaoAddress || place.tag
  const subDetail = place.kakaoPhone || place.kakaoCategory || ''
  return (
    <a
      href={kakaoMapUrl(place, region)}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 border-b border-line-hair2 py-3 transition hover:bg-screen/80 last:border-0"
    >
      <span className="w-5 text-center text-sm font-extrabold text-ink-muted">{index}</span>
      <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-sq text-sm font-extrabold ${kindTone}`}>{place.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15.5px] font-extrabold">{place.name}</p>
        <p className="truncate text-[12.5px] font-semibold text-ink-3">{detail}</p>
        {subDetail && <p className="truncate text-[11.5px] font-semibold text-ink-muted">{subDetail}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[13px] font-bold text-ink-2">{place.cost}</p>
        <p className="mt-1 text-[11px] font-extrabold text-teal-deep">지도</p>
      </div>
    </a>
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
