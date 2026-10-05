import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../store'
import { InfoDot } from './Learn'
import { LESSONS, TOPICS, lessonById, loadProgress, saveProgress } from '../lessons'
import { onLessonEvent } from '../lesson-events'

// ─────────────────────────────────────────────────────────────────────────────
// LessonPanel — a dockable guide that walks a student through a task and
// verifies each step against real app state.
//
// The central idea: the panel never asserts a step is done. It watches, and
// the step ticks itself off when the student's actual work satisfies check().
// A "Skip" escape hatch exists because a stuck student must never be trapped —
// but skipping is recorded distinctly from completing, so it stays honest.
// ─────────────────────────────────────────────────────────────────────────────

export default function LessonPanel({ open, onClose, activeTab, setActiveTab }) {
  const { state } = useApp()
  const [lessonId, setLessonId] = useState(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [progress, setProgress] = useState(loadProgress)
  const [justAdvanced, setJustAdvanced] = useState(false)
  // True when the step's condition was ALREADY satisfied the moment the step
  // opened — e.g. the student had loaded data before starting the lesson. In
  // that case we must not auto-advance (that was the bug that raced through
  // every step); we show a "you've already done this" confirm instead.
  const [preSatisfied, setPreSatisfied] = useState(false)

  // Context accumulated while a lesson runs: tabs opened, events fired.
  // Kept in a ref so recording into it never triggers a re-render, then
  // mirrored into state via `tick` when we actually need to re-evaluate.
  const ctxRef = useRef({ visited: new Set(), events: new Set() })
  const [tick, setTick] = useState(0)
  const bump = useCallback(() => setTick(t => t + 1), [])
  // Remembers which step we've already made the "was it pre-satisfied?"
  // judgement for, so that judgement happens exactly once per step.
  const stepInitRef = useRef({ key: null, pre: false })

  const lesson = lessonId ? lessonById(lessonId) : null
  const step = lesson?.steps[stepIdx] || null

  // Record tab visits — several steps are satisfied simply by navigating.
  useEffect(() => {
    if (!activeTab) return
    ctxRef.current.visited.add(activeTab)
    bump()
  }, [activeTab, bump])

  // Record app events (query ran, layer added, slider moved...).
  useEffect(() => onLessonEvent(name => {
    ctxRef.current.events.add(name)
    bump()
  }), [bump])

  // The verification loop.
  //
  // Two rules keep this honest:
  //   1. A step that was ALREADY satisfied when it opened never auto-advances.
  //      Otherwise a student who had loaded data first would watch the lesson
  //      skate through three steps without reading any of them.
  //   2. A step marked `manual` never auto-advances — it's a read-and-think
  //      step with nothing to verify.
  // Everything else advances the moment the student's real work satisfies it.
  useEffect(() => {
    if (!lesson || !step) return
    const key = `${lesson.id}:${stepIdx}`

    let ok = false
    try { ok = !!step.check(state, ctxRef.current) } catch { ok = false }

    // First time we've seen this step: decide whether it started already done.
    if (stepInitRef.current.key !== key) {
      stepInitRef.current = { key, pre: ok }
      setPreSatisfied(ok)
      if (ok) return
    }

    if (stepInitRef.current.pre) return  // waiting on the student's Continue
    if (step.manual) return              // nothing to verify
    if (!ok) return

    setJustAdvanced(true)
    const t = setTimeout(() => {
      setJustAdvanced(false)
      advance()
    }, 1100) // pause so the student sees the step tick off and reads the takeaway
    return () => clearTimeout(t)
  }, [state, tick, lesson, step, stepIdx])

  // Move forward one step (or to the wrap-up if this was the last).
  function advance() {
    if (!lesson) return
    if (stepIdx + 1 < lesson.steps.length) {
      setStepIdx(i => i + 1)
    } else {
      setProgress(p => {
        const next = { ...p, [lesson.id]: { done: true, at: Date.now() } }
        saveProgress(next)
        return next
      })
      setStepIdx(lesson.steps.length) // -> wrap-up screen
    }
  }

  // Step backwards. Clearing stepInitRef forces the step we land on to be
  // re-judged for pre-satisfaction, so going back never triggers an instant
  // auto-advance straight forward again.
  function back() {
    if (stepIdx === 0) return
    stepInitRef.current = { key: null, pre: false }
    setJustAdvanced(false)
    setStepIdx(i => i - 1)
  }

  function start(id) {
    stepInitRef.current = { key: null, pre: false }
    setJustAdvanced(false)
    setLessonId(id)
    setStepIdx(0)
    ctxRef.current = { visited: new Set([activeTab]), events: new Set() }
    const first = lessonById(id)?.steps[0]
    if (first?.tab && first.tab !== activeTab) setActiveTab(first.tab)
  }

  function exit() {
    stepInitRef.current = { key: null, pre: false }
    setJustAdvanced(false)
    setLessonId(null)
    setStepIdx(0)
  }

  function skip() {
    stepInitRef.current = { key: null, pre: false }
    setJustAdvanced(false)
    advance()
  }

  // Move the student to the tab a step happens on, but only on their click —
  // yanking the view automatically mid-lesson is disorienting.
  function goToStepTab() {
    if (step?.tab) setActiveTab(step.tab)
  }

  if (!open) return null

  return (
    <aside style={S.panel}>
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={S.badge}>Guided</span>
          <span style={S.headerTitle}>{lesson ? lesson.title : 'Lessons'}</span>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {lesson && (
            <button style={S.iconBtn} onClick={exit} title="Back to lesson list">←</button>
          )}
          <button style={S.iconBtn} onClick={onClose} title="Close">✕</button>
        </div>
      </header>

      <div style={S.body}>
        {!lesson && <LessonList progress={progress} onStart={start} />}

        {lesson && stepIdx < lesson.steps.length && (
          <RunningLesson
            lesson={lesson}
            step={step}
            stepIdx={stepIdx}
            activeTab={activeTab}
            justAdvanced={justAdvanced}
            preSatisfied={preSatisfied}
            onGoToTab={goToStepTab}
            onSkip={skip}
            onBack={back}
            onContinue={() => { stepInitRef.current = { key: null, pre: false }; advance() }}
          />
        )}

        {lesson && stepIdx >= lesson.steps.length && (
          <WrapUp lesson={lesson} onDone={exit} />
        )}
      </div>
    </aside>
  )
}

// ── lesson list ──────────────────────────────────────────────────────────────
function LessonList({ progress, onStart }) {
  return (
    <div>
      <p style={S.intro}>
        Short, hands-on walkthroughs. Each step checks your actual work in the app before moving on.
      </p>
      {TOPICS.map(topic => (
        <div key={topic} style={{ marginBottom: 18 }}>
          <div style={S.topicLabel}>{topic}</div>
          {LESSONS.filter(l => l.topic === topic).map(l => {
            const done = progress[l.id]?.done
            return (
              <button key={l.id} onClick={() => onStart(l.id)} style={S.lessonCard}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ ...S.lessonTitle, color: done ? 'var(--accent2)' : 'var(--txt)' }}>
                    {done ? '✓ ' : ''}{l.title}
                  </span>
                  <span style={S.minutes}>{l.minutes} min</span>
                </div>
                <div style={S.lessonBlurb}>{l.blurb}</div>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── running lesson ───────────────────────────────────────────────────────────
function RunningLesson({ lesson, step, stepIdx, activeTab, justAdvanced, preSatisfied, onGoToTab, onSkip, onBack, onContinue }) {
  const [hintOpen, setHintOpen] = useState(false)
  useEffect(() => { setHintOpen(false) }, [stepIdx])

  const wrongTab = step.tab && step.tab !== activeTab

  return (
    <div>
      {stepIdx === 0 && <p style={S.intro}>{lesson.intro}</p>}

      <div style={S.progressRow}>
        {lesson.steps.map((_, i) => (
          <span key={i} style={{
            ...S.pip,
            background: i < stepIdx ? 'var(--accent2)'
              : i === stepIdx ? 'var(--accent)' : 'var(--bdr3)',
          }} />
        ))}
        <span style={S.stepCount}>Step {stepIdx + 1} of {lesson.steps.length}</span>
      </div>

      <div style={{ ...S.stepCard, borderLeftColor: justAdvanced ? 'var(--accent2)' : 'var(--accent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
          <span style={S.stepTitle}>{step.title}</span>
          {step.concept && <InfoDot concept={step.concept} size={14} />}
        </div>
        <div style={S.instruction}>{step.instruction}</div>

        {wrongTab && (
          <button style={S.goBtn} onClick={onGoToTab}>
            Go to {step.tab} →
          </button>
        )}

        {preSatisfied && !justAdvanced && (
          <div style={S.alreadyBox}>
            <div style={{ marginBottom: 8 }}>
              Looks like you've already done this — read it over, then carry on.
            </div>
            <button style={S.continueBtn} onClick={onContinue}>Continue →</button>
          </div>
        )}

        {step.manual && !preSatisfied && !justAdvanced && (
          <button style={{ ...S.continueBtn, marginTop: 11 }} onClick={onContinue}>
            Got it — continue →
          </button>
        )}

        {justAdvanced && (
          <div style={S.doneBanner}>
            ✓ Done — {step.takeaway}
          </div>
        )}
      </div>

      <div style={S.footRow}>
        {stepIdx > 0 && (
          <button style={{ ...S.linkBtn, color: 'var(--txt2)' }} onClick={onBack}>
            ← Back
          </button>
        )}
        {step.hint && (
          <button style={{ ...S.linkBtn, marginLeft: stepIdx > 0 ? 12 : 0 }} onClick={() => setHintOpen(h => !h)}>
            {hintOpen ? 'Hide hint' : 'Stuck? Show hint'}
          </button>
        )}
        <button style={{ ...S.linkBtn, marginLeft: 'auto', color: 'var(--txt3)' }} onClick={onSkip}>
          Skip step
        </button>
      </div>
      {hintOpen && step.hint && <div style={S.hint}>{step.hint}</div>}
    </div>
  )
}

// ── wrap-up ──────────────────────────────────────────────────────────────────
function WrapUp({ lesson, onDone }) {
  return (
    <div>
      <div style={S.completeMark}>✓ Lesson complete</div>
      <p style={S.intro}>{lesson.wrapUp}</p>
      <div style={S.recapBox}>
        <div style={S.recapLabel}>What you did</div>
        {lesson.steps.map((s, i) => (
          <div key={i} style={S.recapItem}>
            <span style={{ color: 'var(--accent2)' }}>✓</span>
            <span>{s.takeaway}</span>
          </div>
        ))}
      </div>
      <button style={S.primaryBtn} onClick={onDone}>Back to lessons</button>
    </div>
  )
}

// ── styles ───────────────────────────────────────────────────────────────────
// Inline to match the surrounding codebase's approach; all colours come from
// the existing CSS variables so this inherits the app theme automatically.
const S = {
  panel: {
    width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column',
    background: 'var(--bg2)', borderLeft: '1px solid var(--bdr2)', height: '100%', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    padding: '11px 13px', borderBottom: '1px solid var(--bdr2)', flexShrink: 0,
  },
  headerTitle: {
    fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--txt)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  badge: {
    fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--accent)',
    border: '1px solid var(--accent)', borderRadius: 3, padding: '2px 5px', flexShrink: 0,
  },
  iconBtn: {
    background: 'transparent', border: 'none', color: 'var(--txt3)', cursor: 'pointer',
    fontSize: 14, padding: '2px 6px', borderRadius: 4, lineHeight: 1,
  },
  body: { padding: '14px 13px', overflowY: 'auto', flex: 1 },
  intro: { fontSize: 12.5, color: 'var(--txt2)', lineHeight: 1.65, margin: '0 0 16px' },
  topicLabel: {
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.8px',
    color: 'var(--txt3)', marginBottom: 7,
  },
  lessonCard: {
    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
    background: 'var(--bg3)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)',
    padding: '10px 11px', marginBottom: 7, fontFamily: 'inherit',
  },
  lessonTitle: { fontSize: 13, fontFamily: 'var(--font-display)' },
  minutes: { fontSize: 10.5, color: 'var(--txt3)', marginLeft: 'auto', flexShrink: 0 },
  lessonBlurb: { fontSize: 11.5, color: 'var(--txt2)', lineHeight: 1.5, marginTop: 4 },
  progressRow: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12 },
  pip: { width: 18, height: 3, borderRadius: 2, display: 'inline-block' },
  stepCount: { fontSize: 10.5, color: 'var(--txt3)', marginLeft: 'auto' },
  stepCard: {
    background: 'var(--bg3)', border: '1px solid var(--bdr2)', borderLeft: '3px solid var(--accent)',
    borderRadius: 'var(--rl)', padding: '12px 13px', transition: 'border-color 0.3s',
  },
  stepTitle: { fontFamily: 'var(--font-display)', fontSize: 13.5, color: 'var(--txt)' },
  instruction: { fontSize: 12.5, color: 'var(--txt)', lineHeight: 1.65 },
  goBtn: {
    marginTop: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent)',
    color: 'var(--accent)', borderRadius: 'var(--r)', padding: '5px 10px',
    fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit',
  },
  alreadyBox: {
    marginTop: 11, paddingTop: 10, borderTop: '1px solid var(--bdr)',
    fontSize: 11.5, color: 'var(--txt2)', lineHeight: 1.55,
  },
  continueBtn: {
    background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)',
    borderRadius: 'var(--r)', padding: '6px 12px', fontSize: 11.5, cursor: 'pointer',
    fontFamily: 'inherit',
  },
  doneBanner: {
    marginTop: 10, fontSize: 11.5, color: 'var(--accent2)', lineHeight: 1.55,
    borderTop: '1px solid var(--bdr)', paddingTop: 9,
  },
  footRow: { display: 'flex', alignItems: 'center', marginTop: 10 },
  linkBtn: {
    background: 'none', border: 'none', color: 'var(--accent2)', cursor: 'pointer',
    fontSize: 11, padding: 0, fontFamily: 'inherit',
  },
  hint: {
    marginTop: 8, fontSize: 11.5, color: 'var(--txt2)', lineHeight: 1.6,
    background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '8px 10px',
  },
  completeMark: {
    fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--accent2)', marginBottom: 10,
  },
  recapBox: {
    background: 'var(--bg3)', border: '1px solid var(--bdr)', borderRadius: 'var(--rl)',
    padding: '11px 12px', marginBottom: 14,
  },
  recapLabel: {
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.7px',
    color: 'var(--txt3)', marginBottom: 8,
  },
  recapItem: {
    display: 'flex', gap: 7, fontSize: 11.5, color: 'var(--txt2)',
    lineHeight: 1.55, marginBottom: 7,
  },
  primaryBtn: {
    width: '100%', background: 'var(--accent-dim)', border: '1px solid var(--accent)',
    color: 'var(--accent)', borderRadius: 'var(--r)', padding: '8px 12px',
    fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
  },
}
