import { Component } from 'react'

// 안전망 — 렌더링 중 예외가 나면 흰 화면 대신 복구 UI를 보여준다.
// onReset이 있으면(화면 단위 사용) 전체 새로고침 없이 그 자리에서 복구를 시도하고,
// 없으면(최상위 사용) 새로고침 기반 복구로 대체한다.
// 특히 localStorage에 저장된 예전 버전의 코스 데이터가 새 코드와 맞지 않아 렌더가 깨지는
// 경우를 고려해, "저장한 코스 초기화" 옵션도 함께 제공한다.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info)
  }

  recover = () => {
    if (this.props.onReset) {
      this.props.onReset()
      this.setState({ hasError: false })
    } else {
      window.location.reload()
    }
  }

  recoverWithResetSaved = () => {
    try {
      window.localStorage.removeItem('travelapp.savedCourses')
    } catch {
      // localStorage 접근 불가해도 복구는 시도
    }
    this.recover()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const primaryLabel = this.props.onReset ? '홈으로 돌아가기' : '다시 시도'

    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-screen px-8 text-center">
        <p className="text-[17px] font-extrabold text-ink">문제가 발생했어요</p>
        <p className="text-[13px] font-medium text-ink-2">
          일시적인 오류예요. 다시 시도해주세요.
        </p>
        <div className="mt-2 flex w-full max-w-[280px] flex-col gap-2">
          <button
            type="button"
            onClick={this.recover}
            className="h-[48px] w-full rounded-btn bg-teal text-[14px] font-extrabold text-white"
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            onClick={this.recoverWithResetSaved}
            className="h-[48px] w-full rounded-btn border border-line text-[13px] font-bold text-ink-2"
          >
            저장한 코스 초기화 후 {primaryLabel}
          </button>
        </div>
      </div>
    )
  }
}
