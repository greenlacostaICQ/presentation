'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chapters, slides, type Slide } from './course-data';

// В обычной сборке пути отдаёт сервер. В офлайн-сборке одним файлом медиа
// подставляется через window.__ASSETS — здесь единственная точка их адресации.
declare global {
  interface Window { __ASSETS?: Record<string, string> }
}
const asset = (path: string) => (typeof window === 'undefined' ? path : window.__ASSETS?.[path] ?? path);

function BrandLogo({ light = false }: { light?: boolean }) {
  return (
    <img
      className={light ? 'brand-logo brand-logo-light' : 'brand-logo'}
      src={asset('/brand/sinara-bank.png')}
      alt="Банк Синара"
    />
  );
}

function AssetCrop({ position, label }: { position: 'cover' | 'main' | 'final' | 'network'; label: string }) {
  return <div className={`asset-crop crop-${position}`} role="img" aria-label={label} />;
}

// Слайды, где озвучка стартует не при входе, а на нужном внутреннем состоянии.
const deferredVoiceSlides = new Set([7]);

// Блокировка перехода «дальше» до выполнения задания на экране.
// Выключено по решению владельца курса: сейчас нужна свободная навигация
// между экранами. Вся логика завершения ниже готова — чтобы включить gate
// (и вместе с ним локальную CTA «Продолжить» и замок в содержании),
// поставьте true.
const GATE_NEXT_UNTIL_DONE = false;

// Справочные экраны: читаются, действия не требуют — переход свободен.
const FREE_SLIDES = new Set([28, 29, 22, 27, 19]);
// Экраны со своей внутренней логикой прохождения: завершение сообщает сам слайд.
const SELF_REPORTED_SLIDES = new Set([3, 5, 6, 7, 10, 15, 16, 25]);

function Icon({ name }: { name: 'play' | 'pause' | 'repeat' | 'back' | 'next' | 'menu' | 'sound' | 'captions' | 'close' }) {
  const symbols = {
    play: '▶',
    pause: 'Ⅱ',
    repeat: '↻',
    back: '←',
    next: '→',
    menu: '☰',
    sound: '♪',
    captions: 'CC',
    close: '×',
  };
  return <span aria-hidden="true">{symbols[name]}</span>;
}

export default function Home() {
  const [index, setIndex] = useState(0);
  const [progressRestored, setProgressRestored] = useState(false);
  const [started, setStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [activePanel, setActivePanel] = useState(0);
  const [visitedPanels, setVisitedPanels] = useState<number[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [checkedMulti, setCheckedMulti] = useState(false);
  const [cardPosition, setCardPosition] = useState(0);
  const [classifyScore, setClassifyScore] = useState(0);
  const [classifyFeedback, setClassifyFeedback] = useState('');
  const [caseStep, setCaseStep] = useState(0);
  const [caseScore, setCaseScore] = useState(0);
  const [caseAnswered, setCaseAnswered] = useState(false);
  const [copyState, setCopyState] = useState('');
  const [completed, setCompleted] = useState(false);
  const [playedOnce, setPlayedOnce] = useState(false);
  const [savedCaseScore, setSavedCaseScore] = useState<number | null>(null);
  const [caseMisses, setCaseMisses] = useState<number[]>([]);
  // Дальняя граница пройденного: содержание не должно обходить gate.
  const [maxReached, setMaxReached] = useState(0);
  const [savedCaseMisses, setSavedCaseMisses] = useState<number[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const slideBackRef = useRef<(() => boolean) | null>(null);
  const captionsRef = useRef<HTMLDivElement | null>(null);
  const slide = slides[index];
  const markCompleted = useCallback(() => {
    setCompleted(true);
  }, []);
  const overlayOpen = menuOpen || quizOpen;
  const interactionComplete = useMemo(() => {
    if (FREE_SLIDES.has(slide.id)) return true;
    if (SELF_REPORTED_SLIDES.has(slide.id)) return completed;
    switch (slide.interaction) {
      case 'cover': return started;
      case 'panels': return visitedPanels.length >= (slide.panels?.length ?? 0);
      case 'choice': {
        const hasCorrectAnswer = slide.choices?.some((choice) => choice.correct);
        return chosen !== null && (!hasCorrectAnswer || Boolean(slide.choices?.[chosen]?.correct));
      }
      case 'multi': return checkedMulti;
      case 'classify': return cardPosition >= (slide.cards?.length ?? 0);
      case 'case': return completed;
      default: return true;
    }
  }, [cardPosition, checkedMulti, chosen, completed, slide, started, visitedPanels]);
  // Локальная кнопка «Продолжить» на обязательных экранах: после выполнения
  // задания следующий шаг виден рядом с работой, а не только в общем footer.
  const showContinue = GATE_NEXT_UNTIL_DONE
    && index < slides.length - 1
    && interactionComplete
    && slide.interaction !== 'cover'
    && !FREE_SLIDES.has(slide.id);
  const nextBlocked = GATE_NEXT_UNTIL_DONE
    && index < slides.length - 1 && !interactionComplete;

  // Полоса субтитров не лежит поверх контента: её фактическая высота становится
  // нижним отступом .stage. Высота не фиксирована — текст переносится на узких экранах.
  useEffect(() => {
    const node = captionsRef.current;
    if (!node) {
      document.documentElement.style.setProperty('--captions-space', '0px');
      return;
    }
    const apply = () => document.documentElement.style.setProperty('--captions-space', `${node.offsetHeight + 18}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty('--captions-space', '0px');
    };
  }, [captions, index]);

  // Модалка получает фокус, а элементы под ней исключаются из клавиатурного маршрута.
  useEffect(() => {
    if (!overlayOpen) return;
    const dialog = document.querySelector<HTMLElement>('[aria-modal="true"]');
    if (!dialog) return;
    dialog.tabIndex = -1;
    dialog.focus();
    const keepFocusInDialog = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keepFocusInDialog);
    return () => document.removeEventListener('keydown', keepFocusInDialog);
  }, [overlayOpen]);

  // После смены экрана или карточки фокус возвращается к началу нового шага,
  // а не остаётся на уже исчезнувшем control.
  useEffect(() => {
    if (overlayOpen) return;
    const target = document.querySelector<HTMLElement>('[data-slide-focus]');
    target?.focus({ preventScroll: true });
  }, [cardPosition, caseStep, index, overlayOpen]);

  const registerBack = useCallback((handler: (() => boolean) | null) => {
    slideBackRef.current = handler;
  }, []);

  const resetInteraction = useCallback(() => {
    setActivePanel(0);
    setVisitedPanels([]);
    setChosen(null);
    setSelected([]);
    setCheckedMulti(false);
    setCardPosition(0);
    setClassifyScore(0);
    setClassifyFeedback('');
    setCaseStep(0);
    setCaseScore(0);
    setCaseMisses([]);
    setCaseAnswered(false);
    setCopyState('');
    setCompleted(false);
    setQuizOpen(false);
    setPlayedOnce(false);
  }, []);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem('sinara-ai-course-slide'));
    if (Number.isInteger(saved) && saved >= 0 && saved < slides.length) setIndex(saved);
    const savedScore = window.localStorage.getItem('sinara-ai-course-case-score');
    if (savedScore !== null && Number.isInteger(Number(savedScore))) setSavedCaseScore(Number(savedScore));
    const savedMisses = window.localStorage.getItem('sinara-ai-course-case-misses');
    if (savedMisses) setSavedCaseMisses(savedMisses.split(',').filter(Boolean).map(Number));
    const savedMax = Number(window.localStorage.getItem('sinara-ai-course-max'));
    if (Number.isInteger(savedMax) && savedMax > 0) setMaxReached(Math.min(savedMax, slides.length - 1));
    setProgressRestored(true);
  }, []);

  useEffect(() => {
    if (!progressRestored) return;
    window.localStorage.setItem('sinara-ai-course-slide', String(index));
    setMaxReached((value) => {
      if (index <= value) return value;
      window.localStorage.setItem('sinara-ai-course-max', String(index));
      return index;
    });
    slideBackRef.current = null;
    resetInteraction();
    if (slides[index].interaction === 'panels') setVisitedPanels([0]);
  }, [index, progressRestored, resetInteraction]);

  const playCurrent = useCallback(async () => {
    if (slides[index].hasAudio === false) return;
    try {
      if (slides[index].id === 1 && videoRef.current) {
        await videoRef.current.play();
      } else if (audioRef.current) {
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
      }
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [index]);

  const pauseCurrent = useCallback(() => {
    audioRef.current?.pause();
    videoRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const goTo = useCallback((next: number) => {
    pauseCurrent();
    const safe = Math.max(0, Math.min(slides.length - 1, next));
    setIndex(safe);
    setMenuOpen(false);
    if (started && slides[safe].hasAudio !== false && !deferredVoiceSlides.has(slides[safe].id)) {
      window.setTimeout(() => {
        const media = safe === 0 ? videoRef.current : audioRef.current;
        if (media) media.currentTime = 0;
        media?.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      }, 180);
    }
  }, [pauseCurrent, started]);

  // Стрелка «назад» сначала отматывает внутренние состояния слайда и только потом уходит на предыдущий слайд.
  const goBack = useCallback(() => {
    if (slideBackRef.current?.()) return;
    goTo(index - 1);
  }, [goTo, index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); setQuizOpen(false); return; }
      if (overlayOpen) return;
      if (event.key === 'ArrowRight' && !nextBlocked) goTo(index + 1);
      if (event.key === 'ArrowLeft') goBack();
      if (event.key === ' ' && event.target === document.body) {
        event.preventDefault();
        if (isPlaying) pauseCurrent(); else playCurrent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, goTo, index, isPlaying, nextBlocked, overlayOpen, pauseCurrent, playCurrent]);

  const onMediaEnded = () => {
    setIsPlaying(false);
    setPlayedOnce(true);
  };

  const onVideoEnded = () => {
    setIsPlaying(false);
    setPlayedOnce(true);
    if (index === 0) goTo(1);
  };

  const start = async () => {
    setStarted(true);
    await playCurrent();
  };

  const toggleMedia = async () => {
    if (!started) {
      await start();
      return;
    }
    if (isPlaying) pauseCurrent(); else await playCurrent();
  };

  const copyText = async (text: string, label: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const input = document.createElement('textarea');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      setCopyState(`${label} ✓ Вставьте текст в разрешённый сервис.`);
    } catch {
      setCopyState('Не удалось скопировать, выделите текст вручную');
    }
  };

  const progress = ((index + 1) / slides.length) * 100;
  const currentChapter = useMemo(() => chapters.findLast((item) => index >= item.start)?.title ?? 'Вход', [index]);
  // Последний экран раздела: на кнопке «далее» подписываем, куда ведёт переход.
  const nextChapter = useMemo(() => chapters.find((item) => item.start === index + 1)?.title ?? null, [index]);

  return (
    <main className={`course course-slide-${slide.id}`}>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      <header className={overlayOpen ? 'course-header is-blocked' : 'course-header'} aria-hidden={overlayOpen}>
        <button className="icon-button menu-button" type="button" onClick={() => setMenuOpen(true)} aria-label="Открыть содержание">
          <Icon name="menu" />
        </button>
        <BrandLogo />
        <p className="chapter-name">{currentChapter}</p>
        <div className="header-actions">
          <button className={captions ? 'icon-button active' : 'icon-button'} type="button" disabled={!slide.voice} onClick={() => setCaptions((value) => !value)} aria-label="Показать или скрыть текст озвучки">
            <Icon name="captions" />
          </button>
          <span className="slide-number"><b>{String(index + 1).padStart(2, '0')}</b> / {slides.length}</span>
        </div>
      </header>

      <section className="stage" aria-live="polite">
        <SlideView
          key={slide.id}
          slide={slide}
          started={started}
          isPlaying={isPlaying}
          activePanel={activePanel}
          visitedPanels={visitedPanels}
          chosen={chosen}
          selected={selected}
          checkedMulti={checkedMulti}
          cardPosition={cardPosition}
          classifyScore={classifyScore}
          classifyFeedback={classifyFeedback}
          caseStep={caseStep}
          caseScore={caseScore}
          caseAnswered={caseAnswered}
          copyState={copyState}
          completed={completed}
          savedCaseScore={savedCaseScore}
          savedCaseMisses={savedCaseMisses}
          caseMisses={caseMisses}
          quizOpen={quizOpen}
          exerciseState={{}}
          isSlideCompleted={false}
          onExerciseState={() => {}}
          videoRef={videoRef}
          registerBack={registerBack}
          onPlayVoice={playCurrent}
          onStart={start}
          onVideoEnded={onVideoEnded}
          onOpenQuiz={() => { setChosen(null); setQuizOpen(true); }}
          onCloseQuiz={() => setQuizOpen(false)}
          onPanel={(panel) => {
            setActivePanel(panel);
            setVisitedPanels((values) => values.includes(panel) ? values : [...values, panel]);
          }}
          onChoose={setChosen}
          onToggleMulti={(choice) => setSelected((values) => values.includes(choice) ? values.filter((value) => value !== choice) : [...values, choice])}
          onCheckMulti={() => setCheckedMulti(true)}
          onClassify={(category) => {
            const card = slide.cards?.[cardPosition];
            if (!card) return;
            const correct = card.category === category;
            if (correct) {
              setClassifyScore((value) => value + 1);
              setClassifyFeedback(card.feedback || 'Верно');
              window.setTimeout(() => {
                setCardPosition((value) => value + 1);
                setClassifyFeedback('');
              }, 650);
            } else setClassifyFeedback(`Попробуйте ещё раз. ${card.feedback || ''}`);
          }}
          onCopy={copyText}
          onCaseChoose={(choice) => {
            if (caseAnswered) return;
            const correct = slide.caseSteps?.[caseStep]?.choices[choice]?.correct;
            if (correct) setCaseScore((value) => value + 1);
            else setCaseMisses((values) => values.includes(caseStep) ? values : [...values, caseStep]);
            setChosen(choice);
            setCaseAnswered(true);
          }}
          onCaseNext={() => {
            if (caseStep < (slide.caseSteps?.length ?? 1) - 1) {
              setCaseStep((value) => value + 1);
              setChosen(null);
              setCaseAnswered(false);
            } else {
              window.localStorage.setItem('sinara-ai-course-case-score', String(caseScore));
              window.localStorage.setItem('sinara-ai-course-case-misses', caseMisses.join(','));
              setSavedCaseScore(caseScore);
              setSavedCaseMisses(caseMisses);
              setCompleted(true);
            }
          }}
          onCaseRetry={() => {
            setCaseStep(0);
            setCaseScore(0);
            setCaseMisses([]);
            setChosen(null);
            setCaseAnswered(false);
            setCompleted(false);
          }}
          onComplete={markCompleted}
          onNext={() => goTo(index + 1)}
          onResetMulti={() => { setSelected([]); setCheckedMulti(false); }}
          onGoToCase={() => goTo(slides.findIndex((item) => item.interaction === 'case'))}
        />

        {showContinue && (
          <div className="stage-continue">
            <button className="primary-action" type="button" onClick={() => goTo(index + 1)}>Продолжить</button>
          </div>
        )}

        {copyState && <div className="copy-toast" role="status">{copyState}</div>}

        {captions && slide.voice && <div className="captions" role="status" ref={captionsRef}>{slide.voice}</div>}
      </section>

      <footer className={`course-controls${overlayOpen ? ' is-blocked' : ''}${nextChapter ? ' has-chapter-jump' : ''}`} aria-hidden={overlayOpen}>
        <button className="nav-button" type="button" onClick={goBack} disabled={index === 0 || overlayOpen} tabIndex={overlayOpen ? -1 : undefined} aria-label="Предыдущий экран">
          <Icon name="back" />
        </button>
        <button className="play-control" type="button" onClick={toggleMedia} disabled={slide.hasAudio === false || overlayOpen} tabIndex={overlayOpen ? -1 : undefined} aria-label={isPlaying ? 'Поставить озвучку на паузу' : playedOnce ? 'Повторить озвучку' : 'Включить озвучку'}>
          <Icon name={isPlaying ? 'pause' : playedOnce ? 'repeat' : 'play'} />
        </button>
        <div className="manual-hint">{nextBlocked ? 'Завершите действие на экране' : slide.hasAudio === false ? 'Текст экрана — на самом экране' : isPlaying ? 'Озвучка воспроизводится' : playedOnce ? 'Озвучка завершена' : 'Переключайте экраны стрелками'}</div>
        <button className={nextChapter ? 'nav-button next-button is-chapter-jump' : 'nav-button next-button'} type="button" onClick={() => goTo(index + 1)} disabled={index === slides.length - 1 || nextBlocked || overlayOpen} tabIndex={overlayOpen ? -1 : undefined} aria-label={nextChapter ? `Следующий раздел: ${nextChapter}` : 'Следующий экран'}>
          {nextChapter && (
            <span className="next-chapter">
              <small>Следующий раздел</small>
              <b>«{nextChapter}»</b>
            </span>
          )}
          <span className="next-chapter-arrow"><Icon name="next" /></span>
        </button>
      </footer>

      {slide.hasAudio !== false && (
        <audio ref={audioRef} key={slide.id} src={`${asset(`/audio/s${String(index + 1).padStart(2, '0')}.mp3`)}?v=20260902-3`} onEnded={onMediaEnded} preload="metadata" />
      )}

      {menuOpen && (
        <div className="menu-overlay" role="dialog" aria-modal="true" aria-label="Содержание курса">
          <button className="menu-backdrop" type="button" onClick={() => setMenuOpen(false)} aria-label="Закрыть содержание" />
          <nav className="course-menu">
            <div className="menu-heading">
              <div><p>Содержание</p><h2>Как начать работать с ИИ</h2></div>
              <button className="icon-button" type="button" onClick={() => setMenuOpen(false)} aria-label="Закрыть содержание"><Icon name="close" /></button>
            </div>
            <div className="chapter-list">
              {chapters.map((chapter, chapterIndex) => {
                const end = chapters[chapterIndex + 1]?.start ?? slides.length;
                return (
                  <section key={chapter.title}>
                    <h3>{chapter.title}</h3>
                    {slides.slice(chapter.start, end).map((item, offset) => {
                      const position = chapter.start + offset;
                      const locked = GATE_NEXT_UNTIL_DONE && position > maxReached;
                      return (
                        <button
                          className={`menu-slide${position === index ? ' current' : ''}${locked ? ' locked' : ''}`}
                          type="button"
                          key={item.id}
                          disabled={locked}
                          title={locked ? 'Экран откроется после прохождения предыдущих' : undefined}
                          onClick={() => goTo(position)}
                        >
                          <span>{String(position + 1).padStart(2, '0')}</span>{item.title}
                          {locked && <i aria-label="ещё не открыт">·</i>}
                        </button>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </nav>
        </div>
      )}
    </main>
  );
}

type SlideViewProps = {
  slide: Slide;
  started: boolean;
  isPlaying: boolean;
  activePanel: number;
  visitedPanels: number[];
  chosen: number | null;
  selected: number[];
  checkedMulti: boolean;
  cardPosition: number;
  classifyScore: number;
  classifyFeedback: string;
  caseStep: number;
  caseScore: number;
  caseAnswered: boolean;
  copyState: string;
  completed: boolean;
  savedCaseScore: number | null;
  savedCaseMisses: number[];
  caseMisses: number[];
  quizOpen: boolean;
  exerciseState: Record<string, unknown>;
  isSlideCompleted: boolean;
  onExerciseState: (next: Record<string, unknown>) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  registerBack: (handler: (() => boolean) | null) => void;
  onPlayVoice: () => void;
  onStart: () => void;
  onVideoEnded: () => void;
  onOpenQuiz: () => void;
  onCloseQuiz: () => void;
  onPanel: (panel: number) => void;
  onChoose: (choice: number) => void;
  onToggleMulti: (choice: number) => void;
  onCheckMulti: () => void;
  onClassify: (category: string) => void;
  onCopy: (text: string, label: string) => void;
  onCaseChoose: (choice: number) => void;
  onCaseNext: () => void;
  onCaseRetry: () => void;
  onComplete: () => void;
  onNext: () => void;
  onResetMulti: () => void;
  onGoToCase: () => void;
};

function SlideView(props: SlideViewProps) {
  const { slide } = props;
  if (slide.interaction === 'cover') return <CoverSlide {...props} />;
  if (slide.interaction === 'panels') return <PanelsSlide {...props} />;
  if (slide.interaction === 'choice') return <ChoiceSlide {...props} />;
  if (slide.interaction === 'multi') return <MultiSlide {...props} />;
  if (slide.interaction === 'classify') return <ClassifySlide {...props} />;
  if (slide.interaction === 'practice') return <PracticeSlide {...props} />;
  if (slide.interaction === 'case') return <CaseSlide {...props} />;
  if (slide.interaction === 'guide') return slide.id === 28 ? <ValueSlide {...props} /> : <AskSecuritySlide {...props} />;
  return <FinalSlide {...props} />;
}

function SlideHeading({ slide, children }: { slide: Slide; children?: ReactNode }) {
  return (
    <div className="slide-heading" data-slide-focus tabIndex={-1}>
      {slide.kicker && <p className="eyebrow">{slide.kicker}</p>}
      <h1>{slide.title}</h1>
      {children}
      {slide.intro && <p className="slide-intro">{slide.intro}</p>}
    </div>
  );
}

// Единый индикатор пошагового раскрытия: инструкция + «сколько открыто».
function StepProgress({ instruction, visited, total, doneText }: { instruction: string; visited: number; total: number; doneText?: string }) {
  const done = visited >= total;
  return (
    <div className={done ? 'step-progress is-done' : 'step-progress'} role="status">
      <p>{done && doneText ? doneText : instruction}</p>
      <b>{Math.min(visited, total)} из {total}</b>
    </div>
  );
}

function Note({ text }: { text?: string }) {
  return text ? <aside className="key-note"><span>!</span><p>{text}</p></aside> : null;
}

function CoverSlide(props: SlideViewProps) {
  return (
    <div className="cover-layout">
      <div className="cover-copy">
        <p className="eyebrow">{props.slide.kicker}</p>
        <h1>Как начать<br />работать с ИИ</h1>
        <p className="cover-subtitle">{props.slide.intro}</p>
        <button className="primary-action" type="button" onClick={props.onStart}>
          <Icon name={props.isPlaying ? 'pause' : 'play'} />
          {props.started ? (props.isPlaying ? 'Заставка воспроизводится' : 'Повторить заставку') : 'Начать курс'}
        </button>
        <p className="cover-note"><Icon name="sound" /> {props.slide.note}</p>
      </div>
      <div className="cover-media">
        <div className="video-frame">
          <video
            ref={props.videoRef}
            src={asset('/media/intro-avatar.mp4')}
            poster={asset('/media/avatar.png')}
            playsInline
            preload="metadata"
            onEnded={props.onVideoEnded}
          />
          <div className="video-logo"><BrandLogo light /></div>
          {!props.started && <button type="button" className="video-play" onClick={props.onStart} aria-label="Запустить видео"><Icon name="play" /></button>}
        </div>
        <div className="cover-stat"><b>{slides.length}</b><span>экранов<br />с практикой</span></div>
      </div>
    </div>
  );
}

function PanelsSlide(props: SlideViewProps) {
  if (props.slide.id === 2) return <RouteSlide {...props} />;
  if (props.slide.id === 3) return <LevelsSlide {...props} />;
  if (props.slide.id === 9) return <SafetyDataSlide {...props} />;
  if (props.slide.id === 11) return <CauseWheelSlide {...props} />;
  if (props.slide.id === 14) return <FormulaSlide {...props} />;
  if (props.slide.id === 17) return <ExtendedFormulaSlide {...props} />;
  if (props.slide.id === 20) return <RussianServicesSlide {...props} />;
  if (props.slide.id === 22) return <GlobalServicesSlide {...props} />;
  if (props.slide.id === 24) return <BankGatewaySlide {...props} />;
  const panel = props.slide.panels?.[props.activePanel];
  const network = props.slide.visual === 'network';
  return (
    <div className="content-layout">
      <SlideHeading slide={props.slide} />
      <div className={network ? 'panel-workspace with-visual' : 'panel-workspace'}>
        <div className="panel-tabs" role="tablist" aria-label="Разделы экрана">
          {props.slide.panels?.map((item, idx) => (
            <button
              key={item.title}
              className={idx === props.activePanel ? `panel-tab active tone-${item.tone ?? 'blue'}` : `panel-tab tone-${item.tone ?? 'blue'}`}
              type="button"
              onClick={() => props.onPanel(idx)}
              role="tab"
              aria-selected={idx === props.activePanel}
            >
              <span>{String(idx + 1).padStart(2, '0')}</span>{item.title}
              {(idx === props.activePanel || props.visitedPanels.includes(idx)) && <i aria-label="просмотрено">✓</i>}
            </button>
          ))}
        </div>
        <article className="panel-detail" role="tabpanel">
          <p className="detail-index">{String(props.activePanel + 1).padStart(2, '0')}</p>
          <h2>{panel?.title}</h2>
          {panel?.body && <p>{panel.body}</p>}
          {panel?.bullets && <ul>{panel.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
          {panel?.example && <blockquote>{panel.example}</blockquote>}
        </article>
        {network && <AssetCrop position="network" label="Схема защищённой точки доступа к ИИ" />}
      </div>
    </div>
  );
}

function RouteSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  return <div className="content-layout"><SlideHeading slide={props.slide} />
    <section className="outcomes">
      <p className="outcomes-label">После курса вы сможете</p>
      <ul>{props.slide.outcomes?.map((item) => <li key={item}>{item}</li>)}</ul>
      <b>В конце итоговый кейс из пяти решений. Для зачёта нужно минимум четыре верных ответа и ни одной ошибки в трёх ключевых темах: подходит ли задача, какие данные, кто принимает решение.</b>
    </section>
    <div className="route-line">{props.slide.panels?.map((item, idx) => <button key={item.title} className={idx === props.activePanel ? 'route-stop active' : 'route-stop'} onClick={() => props.onPanel(idx)} type="button"><span>{idx + 1}</span><b>{item.title.replace(/^\d+\.\s*/, '')}</b></button>)}</div>
    <article className="route-detail"><p>Что будет на этом этапе</p><h2>{panel?.title}</h2><span>{panel?.body}</span></article>
  </div>;
}

function LevelsSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const levelNames = props.slide.panels?.map((item) => item.title) ?? [];
  const viewedAll = props.visitedPanels.length === (props.slide.panels?.length ?? 0);
  const allAnswered = Object.keys(answers).length === (props.slide.levelQuiz?.length ?? 0);
  const correctAnswers = props.slide.levelQuiz?.filter((item, idx) => answers[idx] === item.answer).length ?? 0;
  const numerals = ['①', '②', '③', '④'];
  const levelReasons: Record<string, string> = {
    'Искусственный интеллект': 'Это искусственный интеллект: система не создаёт новый материал, а автоматически проверяет операцию по заданному правилу.',
    'Генеративный ИИ': 'Это генеративный ИИ: система создаёт новый материал — изображение.',
    'Языковая модель': 'Это языковая модель: основная работа — преобразование текста.',
    'ИИ-ассистент': 'Это ИИ-ассистент: сервис использует языковую модель и приложенный файл.',
  };

  useEffect(() => {
    if (allAnswered && correctAnswers === (props.slide.levelQuiz?.length ?? 0)) props.onComplete();
  }, [allAnswered, correctAnswers, props.onComplete, props.slide.levelQuiz]);

  return <div className="content-layout compact-content"><SlideHeading slide={props.slide} />
    <div className="levels-layout exact-levels">
      <div className="level-tabs" role="tablist" aria-label="Четыре уровня искусственного интеллекта">
        {props.slide.panels?.map((item, idx) => (
          <button
            key={item.title}
            type="button"
            className={idx === props.activePanel ? 'level-tab active' : 'level-tab'}
            onClick={() => props.onPanel(idx)}
            role="tab"
            aria-selected={idx === props.activePanel}
          >
            <span>{numerals[idx]}</span>
            <b>{item.title}</b>
            {props.visitedPanels.includes(idx) && <i aria-label="просмотрено">✓</i>}
          </button>
        ))}
      </div>
      <article className="level-detail" role="tabpanel" aria-live="polite">
        <p>{numerals[props.activePanel]} Уровень</p>
        <h2>{panel?.title}</h2>
        <div className="level-sections">
          {panel?.sections?.map((section) => (
            <section key={section.label}>
              <h3>{section.label}</h3>
              {section.text && <p>{section.text}</p>}
              {section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
            </section>
          ))}
        </div>
      </article>
    </div>
    <div className="level-actions">
      <p>{viewedAll ? 'Все четыре уровня открыты. Теперь распределите рабочие ситуации.' : 'Откройте все четыре уровня, после этого появится проверка.'}</p>
      <button className="secondary-action" type="button" disabled={!viewedAll} onClick={props.onOpenQuiz}>Проверить себя</button>
    </div>
    {props.quizOpen && <div className="quiz-modal" role="dialog" aria-modal="true" aria-label="Определите уровень искусственного интеллекта">
      <button className="quiz-backdrop" type="button" onClick={props.onCloseQuiz} aria-label="Закрыть проверку" />
      <section className="quiz-dialog level-quiz-dialog">
        <header><div><p className="question-label">Четыре ситуации</p><h2>Определите, какая технология выполняет основную работу в каждой ситуации.</h2></div><button type="button" onClick={props.onCloseQuiz} aria-label="Закрыть">×</button></header>
        <div className="level-quiz-list">
          {props.slide.levelQuiz?.map((item, idx) => {
            const selected = answers[idx];
            const correct = selected === item.answer;
            return <article className={selected ? (correct ? 'answered correct' : 'answered wrong') : ''} key={item.situation}>
              <span>{idx + 1}</span>
              <p>{item.situation}</p>
              <select aria-label={`Уровень для ситуации ${idx + 1}`} value={selected ?? ''} onChange={(event) => setAnswers((current) => ({...current, [idx]: event.target.value}))}>
                <option value="" disabled>Выберите уровень</option>
                {levelNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {selected && <small>{correct ? 'Верно' : levelReasons[item.answer]}</small>}
            </article>;
          })}
        </div>
        {allAnswered && <div className={correctAnswers === props.slide.levelQuiz?.length ? 'result-banner success' : 'result-banner retry'}>{correctAnswers === props.slide.levelQuiz?.length ? 'Верно. Вы различили искусственный интеллект, генеративный ИИ, языковую модель и ИИ-ассистента.' : `Правильно определено ${correctAnswers} из ${props.slide.levelQuiz?.length}. Посмотрите объяснения под ошибочными ответами и исправьте их.`}</div>}
      </section>
    </div>}
  </div>;
}

function SafetyDataSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  return <div className="content-layout compact-content"><SlideHeading slide={props.slide} />
    <div className="safety-columns"><section><h2>Можно передавать</h2><p>План развития · структуру презентации · список вопросов · объяснение термина · черновик без реквизитов · повестка встречи</p></section><section className="danger"><h2>Нельзя передавать</h2><p>ФИО и контакты · счета и договоры · операции клиентов · кадровые сведения · внутренние документы · пароли и токены</p></section></div>
    <StepProgress instruction="Разберите три ситуации и определите безопасный способ работы в каждой." visited={props.visitedPanels.length} total={props.slide.panels?.length ?? 0} doneText="Все три ситуации разобраны." />
    <div className="situation-strip">{props.slide.panels?.map((item, idx) => <button type="button" key={item.title} className={idx === props.activePanel ? 'active' : props.visitedPanels.includes(idx) ? 'visited' : ''} onClick={() => props.onPanel(idx)}>{idx + 1}. {item.title}{props.visitedPanels.includes(idx) && <i aria-label="просмотрено"> ✓</i>}</button>)}</div>
    <article className={`situation-result tone-${panel?.tone ?? 'blue'}`}><b>{panel?.title}</b><p>{panel?.body}</p></article>
    {props.visitedPanels.length >= (props.slide.panels?.length ?? 0)
      ? <section className="panel-conclusion"><b>Главное правило</b><p>В публичный ИИ-сервис можно передать описание задачи, но нельзя копировать реальные рабочие данные. Замените их вымышленными примерами или попросите подготовить пустой шаблон.</p></section>
      : <Note text={props.slide.note} />}
  </div>;
}

function CauseWheelSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  const total = props.slide.panels?.length ?? 0;
  const allSeen = props.visitedPanels.length >= total;
  return <div className="content-layout"><SlideHeading slide={props.slide} />
    <StepProgress instruction="Откройте четыре причины, чтобы понять, где возникла проблема и как её исправить." visited={props.visitedPanels.length} total={total} doneText="Все четыре причины разобраны." />
    <div className="cause-layout"><div className="cause-wheel"><strong>Почему результат<br/>оказался плохим?</strong>{props.slide.panels?.map((item, idx) => <button type="button" key={item.title} className={idx === props.activePanel ? 'active' : props.visitedPanels.includes(idx) ? 'visited' : ''} onClick={() => props.onPanel(idx)}>{idx + 1}. {item.title}{props.visitedPanels.includes(idx) && <i aria-label="просмотрено"> ✓</i>}</button>)}</div>
    {allSeen
      ? <article className="cause-detail cause-order"><p>Порядок разбора</p><h2>Проверяйте причины в этом порядке</h2><ol><li>Задача: сказано ли, что нужно сделать и каким должен быть результат</li><li>Исходные данные: приложен ли нужный материал и убрано ли лишнее</li><li>Сервис: есть ли у него доступ к источнику и нужная функция</li><li>Проверка: сверены ли числа и ссылки на документы</li></ol><b>Сначала проверьте задачу и исходные данные. Затем оцените возможности сервиса и проверьте результат.</b></article>
      : <article className="cause-detail"><p>Причина {props.activePanel + 1}</p><h2>{panel?.title}</h2><span>{panel?.body}</span><b>{panel?.example}</b></article>}</div><Note text={props.slide.note} />
  </div>;
}

function FormulaSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  const ready = props.visitedPanels.length === (props.slide.panels?.length ?? 0);
  return <div className="content-layout"><SlideHeading slide={props.slide} />
    <StepProgress instruction="Откройте четыре части, затем посмотрите готовый запрос." visited={props.visitedPanels.length} total={props.slide.panels?.length ?? 0} doneText="Вы изучили все четыре части." />
    <div className="formula-tabs">{props.slide.panels?.map((item, idx) => <button type="button" key={item.title} className={`formula-${idx}${idx === props.activePanel ? ' active' : ''}${props.visitedPanels.includes(idx) ? ' visited' : ''}`} onClick={() => props.onPanel(idx)}>{item.title}{props.visitedPanels.includes(idx) && <i aria-label="просмотрено"> ✓</i>}</button>)}</div>
    <article className="formula-detail"><div><p>Часть запроса</p><h2>{panel?.title}</h2><span>{panel?.body}</span></div><blockquote>{panel?.example}</blockquote></article>
    {ready ? <div className="assembled-prompt"><b>Четыре части вместе</b><p>Подготовь справку об изменении портфеля вкладов за 2024 и 2025 годы. Данные приложены. Справка нужна руководителю подразделения. Таблица сравнения и три коротких вывода, не более 120 слов. Рассчитай изменение каждого показателя относительно 2024 года. Если данных не хватает, напиши «нет данных», выводов о причинах не делай.</p><small>Запрос готов, а где его набирать, разберём в главе про сервисы.</small></div> : <Note text="Откройте все четыре части, после этого появится собранный запрос." />}
  </div>;
}

function ExtendedFormulaSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  const total = props.slide.panels?.length ?? 0;
  const allSeen = props.visitedPanels.length >= total;
  return <div className="content-layout"><SlideHeading slide={props.slide} />
    <StepProgress instruction="Четыре части вы уже знаете. Здесь к ним добавляются ещё две. Они нужны, когда результат пойдёт руководителю, в официальный документ или клиенту." visited={props.visitedPanels.length} total={total} doneText="Все шесть частей открыты." />
    <div className="formula-tabs six">{props.slide.panels?.map((item, idx) => <button type="button" key={item.title} className={`${idx === props.activePanel ? 'active ' : ''}${props.visitedPanels.includes(idx) ? 'visited ' : ''}${idx > 3 ? 'extension' : ''}`} onClick={() => props.onPanel(idx)}>{item.title}{props.visitedPanels.includes(idx) && <i aria-label="просмотрено"> ✓</i>}</button>)}</div>
    <article className="formula-detail extended"><div><p>{props.activePanel < 4 ? 'Базовая формула' : 'Дополнительная часть запроса'}</p><h2>{panel?.title}</h2><span>{panel?.body}</span></div>{panel?.example && <blockquote>{panel.example}</blockquote>}</article>
    {allSeen
      ? <div className="assembled-prompt"><b>Шесть частей вместе</b><p>Подготовь справку об изменении портфеля вкладов за 2024 и 2025 годы. Данные приложены, их использование в этом сервисе согласовано. Таблица сравнения и три коротких вывода, не более 120 слов. Рассчитай изменение каждого показателя относительно 2024 года. Если данных не хватает, напиши «нет данных». Материал предназначен руководителю подразделения. Особенно важны динамика показателей и отклонения. Не делай выводов о причинах и не сравнивай без данных.</p><small>Добавляйте эти части, если результат используется для решения, внешней коммуникации или официального документа. Для обычного черновика хватает четырёх частей.</small></div>
      : <Note text={props.slide.note} />}
  </div>;
}

// Экраны 22, 23 и 24 показываются одним шаблоном: у каждого сервиса те же
// четыре поля, поэтому их можно сравнивать глазами, а не вычитывать.
function ServiceCards(props: SlideViewProps & { links?: Array<[string, string]>; quiz?: boolean }) {
  const cards = props.slide.panels ?? [];
  return <div className={`content-layout compact-content service-slide cards-${cards.length}`}>
    <SlideHeading slide={props.slide} />
    <div className="service-grid">{cards.map((card) => (
      <article key={card.title} className="service-card-uniform">
        <header><h2>{card.title}</h2>{card.example && <span className="service-tag">{card.example}</span>}</header>
        {card.sections?.map((section) => (
          <div key={section.label} className={section.label === 'На что обратить внимание' ? 'weak' : ''}>
            <b>{section.label}</b>
            <p>{section.text}</p>
          </div>
        ))}
      </article>
    ))}</div>
    {props.links && <div className="service-links">{props.links.map(([label, href]) => (
      <a key={href} className="secondary-action" href={href} target="_blank" rel="noreferrer">{label}</a>
    ))}</div>}
    {props.quiz && <div className="service-links"><button className="primary-action" type="button" onClick={props.onOpenQuiz}>Проверить себя</button></div>}
    <section className="service-compare"><b>Как сравнивать сервисы</b><p>Сравнивайте по трём признакам: какой материал нужен для задачи, какого он объёма и сколько в задаче этапов. Точные ограничения по объёму файлов и форматам смотрите на официальном сайте сервиса: они меняются. Итог проверяйте на типовой задаче вашего подразделения.</p></section>
    <Note text={props.slide.note} />
  </div>;
}

function RussianServicesSlide(props: SlideViewProps) {
  return <ServiceCards {...props} links={[['Открыть GigaChat', 'https://giga.chat'], ['Открыть Алису', 'https://alice.yandex.ru']]} />;
}

function GlobalServicesSlide(props: SlideViewProps) {
  return <ServiceCards {...props} />;
}

function ChineseServicesSlide(props: SlideViewProps) {
  // На экране есть проверочный вопрос: без него данные слайда не показывались.
  return <>
    <ServiceCards {...props} quiz />
    {props.quizOpen && <QuestionPopup props={props} />}
  </>;
}

function BankGatewaySlide(props: SlideViewProps) {
  // Слева — как выглядит фИИн, справа три группы того, что прорабатывается.
  // Схема «сотрудник → квадрат → квадратики» убрана: скриншот показывает
  // продукт лучше, а полоса кнопок под схемой ломала высоту экрана.
  const panel = props.slide.panels?.[props.activePanel];
  return <div className="content-layout compact-content gateway-slide">
    <SlideHeading slide={props.slide} />
    <div className="gateway-layout">
      <figure className="gateway-shot">
        <span className="gateway-frame">
          <img src={asset('/media/ffin.jpg')} alt="Интерфейс фИИн: список чатов, выбор модели, поле запроса и строка о проверке промпта системой безопасности" />
        </span>
        <figcaption>В тестовой версии проверяется возможность контролировать запросы и вложения до передачи модели.</figcaption>
      </figure>
      <div className="gateway-side">
        <StepProgress instruction="Что проверяется в тестовой версии. Откройте три группы." visited={props.visitedPanels.length} total={props.slide.panels?.length ?? 0} doneText="Все три группы открыты." />
        <div className="gateway-groups">{props.slide.panels?.map((item,idx)=>(
          <button type="button" key={item.title} className={idx===props.activePanel?'active':props.visitedPanels.includes(idx)?'visited':''} onClick={()=>props.onPanel(idx)}>{item.title}{props.visitedPanels.includes(idx)&&<i aria-label="просмотрено"> ✓</i>}</button>
        ))}</div>
        <article className="gateway-detail"><ul>{panel?.bullets?.map(item=><li key={item}>{item}</li>)}</ul></article>
        <p className="gateway-carry">{props.visitedPanels.length>=(props.slide.panels?.length??0)
          ? 'Правила составления запросов и проверки ответов действуют и во внутреннем интерфейсе.'
          : 'Правила составления запросов и проверки ответов действуют и во внутреннем интерфейсе.'}</p>
      </div>
    </div>
    <Note text={props.slide.note} />
  </div>;
}

function ChoiceSlide(props: SlideViewProps) {
  if (props.slide.id === 4) return <ConfidenceSlide {...props} />;
  if (props.slide.id === 7) return <BoundarySlide {...props} />;
  if (props.slide.id === 8) return <BankUseSlide {...props} />;
  if (props.slide.id === 12) return <PromptCompareSlide {...props} />;
  if (props.slide.id === 13) return <ModelContextSlide {...props} />;
  if (props.slide.id === 16) return <RefinementSlide {...props} />;
  if (props.slide.id === 19) return <ServiceCriteriaSlide {...props} />;
  if (props.slide.id === 21) return <ChineseServicesSlide {...props} />;
  return (
    <div className={props.slide.visual === 'avatar' ? 'content-layout portrait-slide' : 'content-layout'}>
      <SlideHeading slide={props.slide} />
      <div className="lesson-layout">
        <section className="lesson-card">
          <p className="question-label">Сначала разберите принцип</p>
          <ol className="lesson-points">
            {props.slide.lessonPoints?.map((point, idx) => <li key={point}><span>{idx + 1}</span><p>{point}</p></li>)}
          </ol>
          {props.slide.callout && <aside className="lesson-callout"><b>Проверить ответ может только специалист</b><p>{props.slide.callout}</p></aside>}
          <button className="primary-action lesson-quiz-button" type="button" onClick={props.onOpenQuiz}>Проверить себя</button>
        </section>
        {props.slide.visual === 'avatar' ? (
          <div className="portrait-frame"><img src={asset('/media/avatar.png')} alt="Ведущий курса" /><span className="portrait-label">ИИ помогает готовить.<br /><b>Решение принимает человек.</b></span></div>
        ) : props.slide.visual === 'answer-flow' ? (
          <AnswerFlow />
        ) : (
          <div className="principle-visual"><p>Ключевой принцип</p><b>{props.slide.note}</b><span>{String(props.slide.id).padStart(2, '0')}</span></div>
        )}
      </div>
      {props.quizOpen && <QuestionPopup props={props} />}
    </div>
  );
}

function ConfidenceSlide(props: SlideViewProps) {
  const points = [
    ['Модель составляет ответ во время диалога, на основе запроса и доступной информации', 'Модель предсказывает следующее слово по образцам из прочитанных текстов. Примерно как подсказка на клавиатуре телефона, только в несопоставимо большем масштабе.'],
    ['Если данных недостаточно, модель может всё равно сформировать ответ', 'Она может заполнить пробел правдоподобной, но неверной версией.'],
    ['Тон ответа не показывает, верен ли он', 'Правильный ответ и ошибка могут звучать одинаково уверенно.'],
    ['Ключевые факты должен проверить специалист или сотрудник, у которого есть надёжный источник', 'Проверяйте ответ по существу, а не по тону и оформлению.'],
  ];
  const choice = props.chosen === null ? null : props.slide.choices?.[props.chosen];
  // Порядок вопроса: сначала четыре ответа без источника — иначе задание
  // сводится к сопоставлению с цитатой. Источник раскрывается после выбора.
  const [toneAnswer, setToneAnswer] = useState<'yes' | 'no' | null>(null);
  return <div className="content-layout compact-content confidence-slide">
    <SlideHeading slide={props.slide} />
    <div className="confidence-layout">
      <section className="confidence-points">{points.map((point, idx) => <article key={point[0]}><span>{idx + 1}</span><div><h2>{point[0]}</h2><p>{point[1]}</p></div></article>)}</section>
      <figure className="confidence-visual"><img src={asset('/media/slide-04-answer-flow.png')} alt="Схема: запрос и контекст формируют ответ, который может быть фактом или правдоподобным предположением и требует сверки с источником" /></figure>
    </div>
    <section className="expert-accent"><b>ИИ ускоряет работу специалиста</b><p>Он не заменяет знание предмета и не делает неспециалиста экспертом.</p></section>
    <div className="confidence-action"><button className="primary-action" type="button" onClick={props.onOpenQuiz}>Проверить себя</button></div>
    {props.quizOpen && <div className="quiz-modal" role="dialog" aria-modal="true" aria-label="Проверка уверенного ответа">
      <button className="quiz-backdrop" type="button" onClick={props.onCloseQuiz} aria-label="Закрыть вопрос" />
      <section className="quiz-dialog confidence-quiz"><header><p className="question-label">Проверьте себя</p><button type="button" onClick={props.onCloseQuiz} aria-label="Закрыть">×</button></header>
        <h2>{toneAnswer === null ? 'Можно ли определить правильный ответ только по формулировке и тону?' : 'Выберите ответ и проверьте его по документу'}</h2>
        <p className="quiz-context">Сотрудник спросил, за сколько дней нужно подать заявление на отпуск вне графика. В четырёх диалогах пришли четыре ответа.</p>
        <div className="choice-list compact">{props.slide.choices?.map((item,idx)=>{const state=props.chosen===idx?(item.correct?'correct':'wrong'):'';return <button key={item.label} type="button" className={`choice confidence-choice ${state}`} disabled={toneAnswer===null} onClick={()=>props.onChoose(idx)}><span>{String.fromCharCode(65+idx)}</span>{item.label}</button>})}</div>
        {toneAnswer === null && <div className="tone-question">
          <p>Прочитайте четыре ответа. Можно ли понять по формулировке, тону или уровню детализации, который из них верный?</p>
          <div className="tone-options">
            <button className="secondary-action" type="button" onClick={()=>setToneAnswer('yes')}>Да, один ответ выглядит убедительнее</button>
            <button className="secondary-action" type="button" onClick={()=>setToneAnswer('no')}>Нет, все ответы звучат одинаково уверенно</button>
          </div>
        </div>}
        {toneAnswer !== null && !choice && <div className="tone-verdict">
          <b>{toneAnswer === 'no' ? 'По формулировке определить правильный ответ нельзя.' : 'Один ответ подробнее других, но подробность не подтверждает его правильность.'}</b>
          <p>{toneAnswer === 'no'
            ? 'Выберите вариант, чтобы затем проверить его по документу.'
            : 'Выберите вариант и сравните его с источником.'}</p>
        </div>}
        {choice && <div className={choice.correct?'confidence-feedback ok':'confidence-feedback'}>
          <div className="source-quote"><b>Правила внутреннего трудового распорядка, п. 5.4</b><p>«Заявление о предоставлении отпуска вне утверждённого графика подаётся не позднее чем за три рабочих дня до его начала.»</p></div>
          <b>{choice.feedback}</b>
          <p><strong>Без документа определить правильный ответ было невозможно.</strong> Важные факты нужно подтверждать источником.</p>
          <button className="secondary-action quiz-done" type="button" onClick={props.onCloseQuiz}>Вернуться к объяснению</button>
        </div>}
      </section>
    </div>}
  </div>;
}

function QuestionPopup({ props }: { props: SlideViewProps }) {
  const choice = props.chosen === null ? null : props.slide.choices?.[props.chosen];
  return <div className="quiz-modal" role="dialog" aria-modal="true" aria-label="Проверка понимания">
    <button className="quiz-backdrop" type="button" onClick={props.onCloseQuiz} aria-label="Закрыть вопрос" />
    <section className="quiz-dialog"><header><p className="question-label">Проверьте себя</p><button type="button" onClick={props.onCloseQuiz} aria-label="Закрыть">×</button></header>
      <h2>{props.slide.prompt}</h2><div className="choice-list">{props.slide.choices?.map((item, idx) => { const state = props.chosen === idx ? (item.correct ? 'correct' : 'wrong') : ''; return <button key={item.label} className={`choice ${state}`} type="button" onClick={() => props.onChoose(idx)}><span>{String.fromCharCode(65 + idx)}</span>{item.label}</button>; })}</div>
      {choice && <div className={choice.correct ? 'feedback correct' : 'feedback wrong'}>{choice.feedback}</div>}
      {choice && <button className="secondary-action quiz-done" type="button" onClick={props.onCloseQuiz}>Вернуться к объяснению</button>}
    </section>
  </div>;
}

// Вердикт между нажатием «Проверить» и разбором: три состояния по двум числам —
// сколько верных отмечено и сколько отмечено лишних.
function Verdict({ correct, selected, labels, reasons, successText, reviewLabel, extraLead = 'отмечать не нужно', extraTitle, extraNote, numbered = true, onRetry, onReview }: {
  correct: number[];
  selected: number[];
  labels: string[];
  reasons: string[];
  successText: string;
  reviewLabel: string;
  extraLead?: string;
  // Свой заголовок и своё пояснение к лишней отметке, когда общей формулировки мало.
  extraTitle?: string;
  extraNote?: string;
  // Фрагменты пронумерованы графикой — тогда вердикт называет номер, иначе сам вариант.
  numbered?: boolean;
  onRetry: () => void;
  onReview: () => void;
}) {
  const missed = correct.filter((item) => !selected.includes(item));
  const extra = selected.filter((item) => !correct.includes(item));
  const state = extra.length ? 'almost' : missed.length ? 'partial' : 'exact';
  const firstWords = (text: string) => `${text.split(/\s+/).slice(0, 5).join(' ')}…`;
  const title = state === 'exact'
    ? '✓ Верно'
    : state === 'partial'
      ? (missed.length > 1 ? 'Вы пропустили нужные варианты' : 'Вы пропустили нужный вариант')
      : (extraTitle ?? (extra.length > 1 ? 'Вы отметили лишние варианты' : 'Вы отметили лишний вариант'));
  return (
    <section className={`verdict verdict-${state}`} role="status">
      <b>{title}</b>
      {state === 'exact' && <p>{successText}</p>}
      {extra.map((item) => <p key={item}>{numbered
        ? (extraNote ? `Фрагмент ${item + 1}. ${extraNote}` : `Фрагмент ${item + 1} ${extraLead}, ${reasons[item]}`)
        : `«${firstWords(labels[item])}»: ${reasons[item]}`}</p>)}
      {missed.map((item) => <p key={`missed-${item}`}>Вы пропустили: {numbered ? `фрагмент ${item + 1}: ${firstWords(labels[item])}` : `«${firstWords(labels[item])}»`}{reasons[item] ? `. ${reasons[item]}` : ''}</p>)}
      <div className="verdict-actions">
        {state !== 'exact' && <button className="primary-action" type="button" onClick={onRetry}>Попробовать ещё раз</button>}
        <button className={state === 'exact' ? 'primary-action' : 'secondary-action'} type="button" onClick={onReview}>{reviewLabel}</button>
      </div>
    </section>
  );
}

function AnswerFlow() {
  return (
    <div className="answer-flow" role="img" aria-label="Запрос и контекст создают несколько вероятных продолжений, из которых формируется ответ для проверки специалистом">
      <p>Как формируется ответ</p>
      <div className="flow-inputs"><span>Ваш запрос</span><i>+</i><span>Доступный контекст</span></div>
      <div className="flow-arrow">↓</div>
      <div className="flow-candidates"><span>Вариант A</span><span>Вариант B</span><span>Вариант C</span></div>
      <small>несколько вероятных продолжений</small>
      <div className="flow-arrow">↓</div>
      <div className="flow-output"><span>Выбранный ответ</span><b>Звучит уверенно</b></div>
      <div className="flow-check">Проверка специалистом</div>
    </div>
  );
}

function PairArc() {
  return (
    <svg className="pair-arc" viewBox="0 0 60 44" aria-hidden="true">
      <path d="M4 34 C 16 6, 44 6, 56 34" />
      <path d="M48.9 30.4 L56 34 L58.3 26.3" />
    </svg>
  );
}

const boundaryKinds = ['Подготовка', 'Решение сотрудника'];

function BoundarySlide(props: SlideViewProps) {
  const { registerBack, onPlayVoice, started } = props;
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);
  const voiceStarted = useRef(false);
  const { onComplete } = props;
  useEffect(() => { if (phase === 3) onComplete(); }, [phase, onComplete]);
  const pairs = [
    ['Составить черновик ответа клиенту', 'Отправить ответ клиенту'],
    ['Подготовить расчёт или черновик справки', 'Подтвердить цифры в отчётности'],
    ['Выделить вопросы и риски в заявке', 'Принять решение по заявке'],
    ['Подготовить проект памятки', 'Утвердить и опубликовать документ'],
  ];
  const tasks = [
    ['Составить черновик ответа на обращение клиента', 'Подготовка'],
    ['Отправить этот ответ клиенту от имени банка', 'Решение сотрудника'],
    ['Проверить заявку по заданным критериям и выделить риски', 'Подготовка'],
    ['На основании этой проверки одобрить или отклонить заявку', 'Решение сотрудника'],
  ];

  // Стрелка «назад» отматывает состояния слайда и только с первого уходит на слайд 6.
  useEffect(() => {
    registerBack(() => {
      if (phase === 0) return false;
      setPhase((value) => (value - 1) as 0 | 1 | 2);
      return true;
    });
    return () => registerBack(null);
  }, [phase, registerBack]);

  // Голос слайда звучит только на разборе и акценте.
  useEffect(() => {
    if (phase < 2 || voiceStarted.current || !started) return;
    voiceStarted.current = true;
    onPlayVoice();
  }, [phase, started, onPlayVoice]);

  if (phase === 0) return <div className="content-layout boundary-stack boundary-explain">
    <div className="boundary-body">
      <SlideHeading slide={props.slide}>
        <p className="bridge-line">Можно ли использовать результат сразу после проверки фактов?</p>
      </SlideHeading>
      <div className="pair-legend"><b><i className="dot can" />ИИ может подготовить материал</b><b><i className="dot cannot" />Решение принимает сотрудник</b></div>
      <div className="pair-cards">{pairs.map((pair)=><article key={pair[0]}><p className="can">{pair[0]}</p><i aria-hidden="true">↓</i><p className="cannot">{pair[1]}</p></article>)}</div>
      <p className="autonomy-rule"><span aria-hidden="true">!</span><b>Чем серьёзнее последствия ошибки, тем больше решений и проверок выполняет сотрудник.</b></p>
    </div>
    <div className="boundary-foot"><button className="primary-action" type="button" onClick={()=>setPhase(1)}>Проверить себя</button></div>
  </div>;

  if (phase === 1) {
    const ready = tasks.every((_, idx) => answers[idx]);
    const exact = tasks.every((task, idx) => answers[idx] === task[1]);
    const renderTask = (idx: number) => {
      const task = tasks[idx];
      return <article key={task[0]}><span>{idx + 1}</span><p>{task[0]}</p><div className="segmented">{boundaryKinds.map((kind)=>{const picked=answers[idx]===kind;const state=checked?(picked?(kind===task[1]?'correct':'wrong'):''):picked?'selected':'';return <button type="button" key={kind} disabled={checked} aria-pressed={picked} className={state} onClick={()=>setAnswers(v=>({...v,[idx]:kind}))}>{kind}</button>})}</div></article>;
    };
    return <div className="content-layout compact-content boundary-stack paired-question">
      <div className="boundary-body">
        <div className="slide-heading"><p className="eyebrow">Проверьте себя</p><h1>Что может подготовить ИИ, а что должен решить сотрудник?</h1><p className="slide-intro">Распределите четыре задачи. Для каждой выберите «Подготовка» или «Решение сотрудника».</p></div>
        <div className="paired-question-list">
          <p className="pair-divider">Пара 1</p>
          {renderTask(0)}
          {renderTask(1)}
          <p className="pair-divider">Пара 2</p>
          {renderTask(2)}
          {renderTask(3)}
        </div>
      </div>
      <div className="boundary-foot">
        {checked && <p className={exact?'ok':'retry'}>{exact ? 'Верно. Подготовку материала можно поручить ИИ, а решение и действие остаются за сотрудником.' : 'Исправьте задачи, отмеченные красным. Подготовку материала можно поручить ИИ, решение и действие остаются за сотрудником.'}</p>}
        <button className="primary-action" type="button" disabled={!ready} onClick={()=>checked?(exact?setPhase(2):setChecked(false)):setChecked(true)}>{checked?(exact?'Посмотреть разбор':'Исправить'):'Проверить'}</button>
      </div>
    </div>;
  }

  if (phase === 2) return <div className="content-layout compact-content boundary-stack boundary-review">
    <div className="boundary-body">
      <div className="slide-heading"><p className="eyebrow">Разбор</p><h1>Почему эти задачи относятся к разным категориям</h1></div>
      <div className="boundary-review-pairs">
        <article><div><b>Черновик ответа</b><p>ИИ готовит черновик, который сотрудник проверяет и исправляет до отправки. На этом этапе окончательное решение ещё не принято.</p></div><PairArc /><div><b>Отправка клиенту</b><p>После отправки письмо создаёт последствия для банка и клиента, поэтому решение об отправке принимает сотрудник.</p></div></article>
        <article><div><b>Проверка заявки</b><p>ИИ может собрать информацию, сопоставить её с критериями и выделить риски. Итоговую оценку делает сотрудник.</p></div><PairArc /><div><b>Решение по заявке</b><p>Уполномоченный сотрудник принимает решение и отвечает за его обоснование.</p></div></article>
      </div>
    </div>
    <div className="boundary-foot"><button className="primary-action" type="button" onClick={()=>setPhase(3)}>Показать правило</button></div>
  </div>;

  return <div className="content-layout boundary-stack boundary-accent">
    <div className="boundary-body accent-body">
      <div className="accent-group">
        <section className="responsibility-accent"><b>ИИ готовит материал</b><strong>Сотрудник принимает решение, утверждает результат и отвечает за действие</strong></section>
        <div className="signature-line"><span /><small>решение сотрудника</small></div>
      </div>
    </div>
    <div className="boundary-foot">
      <p className="review-rule">Если после этого шага возникает обязательство перед клиентом, банком или регулятором, решение принимает сотрудник.</p>
      <button className="primary-action" type="button" onClick={props.onNext}>Следующий экран</button>
    </div>
  </div>;
}

function BankUseSlide(props: SlideViewProps) {
  const choice = props.chosen === null ? null : props.slide.choices?.[props.chosen];
  return <div className="content-layout"><SlideHeading slide={props.slide}/><div className="bank-use-layout"><section className="question-card"><p className="question-label">Выберите один вариант</p><div className="choice-list">{props.slide.choices?.map((item,idx)=>{const state=props.chosen===idx?(item.correct?'correct':'wrong'):'';return <button type="button" key={item.label} className={`choice ${state}`} onClick={()=>props.onChoose(idx)}><span>{idx+1}</span>{item.label}</button>})}</div>{choice&&<div className={choice.correct?'feedback correct':'feedback wrong'}>{choice.feedback}</div>}</section><div className="portrait-frame"><img src={asset('/media/avatar.png')} alt="Ведущий курса"/><span className="portrait-label">Остальные варианты нарушают правила работы с данными или передают ИИ окончательное решение.</span></div></div></div>;
}

function PromptCompareSlide(props: SlideViewProps) {
  return <div className="content-layout"><SlideHeading slide={props.slide}/><p className="slide-intro">Оба запроса содержат одинаковые данные. Во втором дополнительно указаны формат результата, объём и ограничения.</p><div className="prompt-compare"><article><b>Запрос А</b><code>Напиши справку по этим данным.<br/>2024 год: открыто вкладов 1240, с автопролонгацией 812, закрыто досрочно 428.<br/>2025 год: открыто вкладов 1418, с автопролонгацией 967, закрыто досрочно 451.</code></article><article className="better"><b>Запрос Б</b><code>Подготовь справку об изменении портфеля вкладов.<br/>
    2024 год: открыто вкладов 1240, с автопролонгацией 812, закрыто досрочно 428.<br/>2025 год: открыто вкладов 1418, с автопролонгацией 967, закрыто досрочно 451.<br/><br/><mark>Верни таблицу со столбцами: «Показатель», «2024», «2025», «Изменение в штуках», «Изменение в %».</mark><br/><em>После таблицы сформулируй три кратких вывода о динамике. Не делай предположений о причинах изменений.</em></code></article></div><div className="lesson-bottom"><Note text="Точный запрос помогает получить нужный результат быстрее. Когда в запросе заранее указаны формат и ограничения, ответ реже приходится переделывать."/><button className="primary-action" type="button" onClick={props.onOpenQuiz}>Проверить себя</button></div>{props.quizOpen&&<QuestionPopup props={props}/>}</div>;
}

function ModelContextSlide(props: SlideViewProps) {
  return <div className="content-layout"><SlideHeading slide={props.slide}/><div className="knowledge-columns"><section><h2>Может использовать</h2><p>Знания, полученные при обучении, текущий запрос, приложенные файлы, сообщения диалога, поиск и память, если она включена</p></section><section><h2>Не знает</h2><p>Внутренние документы · текущие показатели · договорённости коллег · ваш процесс и внутренние правила принятия решений · то, что вы не написали и чего нет в доступных источниках</p></section></div><div className="memory-callout"><b>История диалога может хранить переданные данные</b><p>Не вводите в публичный сервис то, что запрещено передавать или хранить вне банка. В корпоративном канале правила определяет банк.</p><button className="primary-action" onClick={props.onOpenQuiz} type="button">Проверить себя</button></div>{props.quizOpen&&<QuestionPopup props={props}/>}</div>;
}

function RefinementSlide(props: SlideViewProps) {
  // Сначала пользователь сам находит, что не так с ответом, и только потом
  // выбирает уточнение: иначе «одно сообщение вместо пяти» остаётся лозунгом.
  const { onComplete } = props;
  const [phase, setPhase] = useState<0 | 1 | 2>(0);
  const [marks, setMarks] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const [option, setOption] = useState<number | null>(null);
  useEffect(() => { if (phase === 2) onComplete(); }, [phase, onComplete]);
  const fragments = [
    ['Открыто вкладов: 1240 в 2024 году и 1418 в 2025 году.', ''],
    ['Доля автопролонгации: 65,5% и 68,2%.', ''],
    ['Итог: оба показателя выросли.', 'В запросе было три показателя, а модель подвела итог по двум. Досрочно закрытые вклады в ответ не попали.'],
    ['Рост показателей говорит об улучшении работы с вкладчиками.', 'Этого вывода нет в исходных данных. Модель добавила его от себя.'],
  ];
  const correctMarks = [2, 3];
  const options = [
    ['Перепиши всё заново, только лучше', 'Модель не знает, что для вас значит «лучше». Ответ изменится непредсказуемо, и потребуется ещё одна доработка.'],
    ['Добавь строку по досрочно закрытым вкладам и убери вывод об улучшении работы с вкладчиками, его нет в данных', 'Верно. Обе правки названы конкретно и отправлены одним сообщением.'],
    ['Убери лишнее', 'Модель не знает, что здесь лишнее. После такого уточнения обычно требуется ещё несколько доработок.'],
  ];
  const exact = marks.length === 2 && correctMarks.every((item) => marks.includes(item));

  if (phase === 0) return <div className="content-layout compact-content refinement-slide">
    <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Шаг 1 из 2 · Найдите ошибки</p><h1>Сравните ответ модели с тем, что вы просили</h1><p className="slide-intro">Две строки не соответствуют запросу. Отметьте их.</p></div>
    <section className="answer-review">
      <div className="answer-request"><b>Ваш запрос</b><p>Сравни портфель вкладов за 2024 и 2025 годы по трём показателям: открыто вкладов, доля автопролонгации, закрыто досрочно. По каждому показателю дай одну строку. Выводы делай строго по данным.</p></div>
      <header><b>Ответ модели</b><span>что пришло в ответ</span></header>
      {fragments.map((fragment, idx) => {
        const marked = marks.includes(idx);
        const state = checked ? (correctMarks.includes(idx) ? 'correct' : marked ? 'wrong' : '') : marked ? 'selected' : '';
        return <button type="button" key={fragment[0]} disabled={checked} className={state} onClick={() => setMarks((values) => values.includes(idx) ? values.filter((value) => value !== idx) : [...values, idx])}>
          <i aria-hidden="true">{marked ? '✓' : ''}</i>
          <p>{fragment[0]}</p>
          {checked && fragment[1] && <small>{fragment[1]}</small>}
        </button>;
      })}
    </section>
    <div className="refinement-foot">
      {checked && <p className={exact ? 'ok' : 'retry'}>{exact ? 'Верно. Один показатель из запроса пропущен, и один вывод добавлен от себя.' : 'Отмечены другие строки. Правильные подписаны ниже.'}</p>}
      <button className="primary-action" type="button" disabled={!marks.length} onClick={() => checked ? setPhase(1) : setChecked(true)}>{checked ? 'Перейти к уточнению' : 'Проверить'}</button>
    </div>
  </div>;

  if (phase === 1) return <div className="content-layout compact-content refinement-slide">
    <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Шаг 2 из 2 · Одно уточнение</p><h1>Что отправить модели, чтобы она исправила обе ошибки?</h1><p className="slide-intro">Ошибок две: один показатель пропущен и один вывод добавлен без данных. Выберите сообщение, которое исправляет обе.</p></div>
    <div className="refinement-options">{options.map((item, idx) => {
      const state = option === idx ? (idx === 1 ? 'correct' : 'wrong') : '';
      return <button type="button" key={item[0]} className={`refinement-option ${state}`} onClick={() => setOption(idx)}><span>{String.fromCharCode(65 + idx)}</span><p>{item[0]}</p>{option === idx && <small>{item[1]}</small>}</button>;
    })}</div>
    {option === 1 && <div className="refinement-foot"><button className="primary-action" type="button" onClick={() => setPhase(2)}>Что изменилось в ответе</button></div>}
  </div>;

  return <div className="content-layout compact-content refinement-slide">
    <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Результат</p><h1>Как изменился ответ после уточнения</h1></div>
    <div className="refinement-compare">
      <section><b>До уточнения</b><p>В ответе было два показателя из трёх, а в конце стоял вывод об улучшении работы с вкладчиками, которого нет в исходных данных.</p></section>
      <section className="good"><b>После одного уточнения</b><p>Модель добавила строку по третьему показателю и убрала неподтверждённый вывод. Исходные данные уже были в диалоге, поэтому отправлять их заново не потребовалось.</p></section>
    </div>
    <section className="refinement-rule">
      <b>Правило</b>
      <p>Дочитайте ответ до конца, соберите все замечания и отправьте их одним сообщением. Одно сообщение помогает модели увидеть полный список исправлений и снижает риск пропустить часть замечаний. Не начинайте новый диалог без необходимости: в текущем уже есть исходные данные и предыдущий ответ.</p>
      <span>Если после двух или трёх конкретных уточнений результат не улучшается, вернитесь к исходному запросу и сформулируйте задачу заново.</span>
    </section>
  </div>;
}

function ServiceCriteriaSlide(props: SlideViewProps) {
  // Экран несёт одну мысль: сначала допуск, потом качество. Три ступени
  // раскрываются по очереди — на экране всегда один блок текста, а не стена.
  const [step, setStep] = useState(0);
  const steps = [
    {
      tag: 'Шаг 1. Проверьте разрешение банка',
      question: 'Разрешил ли банк этот сервис?',
      lead: 'Список разрешённых сервисов утверждает банк. Если сервиса в списке нет, для рабочей задачи он не подходит.',
      no: 'Если банк не разрешил сервис, не используйте его для рабочей задачи.',
      width: '100%',
    },
    {
      tag: 'Шаг 2. Проверьте допустимость данных',
      question: 'Можно ли передать этому сервису данные вашей задачи?',
      lead: 'Разрешение на сервис не означает разрешения на любые данные. Перед загрузкой проверьте, можно ли передавать этому сервису материалы такой категории.',
      no: 'Не загружайте материал. Используйте разрешённый внутренний сервис, подготовьте безопасную версию по утверждённой процедуре или выполните задачу без ИИ. Если категория материала неизвестна, обратитесь в информационную безопасность через утверждённый в банке канал обращения.',
      width: '80%',
    },
    {
      tag: 'Шаг 3. Проверьте возможности сервиса',
      question: 'Подойдёт ли сервис для этой задачи?',
      lead: 'Заранее это неизвестно. Сравните разрешённые сервисы по трём признакам: какой материал нужен, какого он объёма и сколько в задаче этапов. Затем проверьте на типовой задаче вашего подразделения.',
      no: 'Для большого документа проверьте допустимый объём на сайте сервиса. Для изображений, аудио и видео проверьте поддержку формата. Для расчётов сверьте результат с известным ответом.',
      width: '60%',
    },
  ];
  const active = steps[step];
  return <div className="content-layout compact-content gate-slide">
    <SlideHeading slide={props.slide}/>
    <div className="gate-layout">
      <div className="gate-stack">
        {steps.map((item, idx) => (
          <button type="button" key={item.question} style={{ width: item.width }}
            className={`gate-bar${idx === step ? ' active' : ''}${idx < step ? ' passed' : ''}`}
            onClick={() => setStep(idx)}>
            <span>{idx + 1}</span>{item.question}
          </button>
        ))}
        <p className="gate-scale">Порядок проверки <b>одинаковый</b> для любого сервиса</p>
      </div>
      <article className="gate-detail" aria-live="polite">
        <p className="gate-tag">{active.tag}</p>
        <h2>{active.question}</h2>
        <p className="gate-lead">{active.lead}</p>
        <div className="gate-no"><b>{step === 2 ? 'Как выбирать' : 'Если нет'}</b><p>{active.no}</p></div>
      </article>
    </div>
    <p className="gate-rule">Первые два шага определяют, можно ли использовать сервис. Третий помогает выбрать подходящий.</p>
  </div>;
}

function MultiSlide(props: SlideViewProps) {
  if (props.slide.id === 5) return <HallucinationSlide {...props} />;
  if (props.slide.id === 18) return <FourChecksSlide {...props} />;
  const correct = props.slide.correctIndexes ?? [];
  const exact = props.selected.length === correct.length && correct.every((value) => props.selected.includes(value));
  return (
    <div className="content-layout">
      <SlideHeading slide={props.slide} />
      <div className="multi-grid">
        {props.slide.choices?.map((item, idx) => {
          const selected = props.selected.includes(idx);
          const checkedClass = props.checkedMulti ? (item.correct ? 'correct' : selected ? 'wrong' : '') : '';
          return (
            <button key={item.label} type="button" className={`select-card ${selected ? 'selected' : ''} ${checkedClass}`} onClick={() => !props.checkedMulti && props.onToggleMulti(idx)}>
              <span className="check-box">{selected ? '✓' : ''}</span>
              <p>{item.label}</p>
              {props.checkedMulti && <small>{item.feedback}</small>}
            </button>
          );
        })}
      </div>
      {!props.checkedMulti ? (
        <button className="secondary-action" type="button" onClick={props.onCheckMulti} disabled={!props.selected.length}>Проверить выбор</button>
      ) : (
        <div className={exact ? 'result-banner success' : 'result-banner retry'}>{exact ? 'Верно. Вы выделили именно проверяемые детали.' : 'Посмотрите разбор и запомните принцип, а не номера ответов.'}</div>
      )}
      <Note text={props.slide.note} />
    </div>
  );
}

function HallucinationSlide(props: SlideViewProps) {
  // 0 — задание, 1 — вердикт, 2 — разбор, 3 — термин.
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0);
  const { onComplete } = props;
  useEffect(() => { if (phase === 3) onComplete(); }, [phase, onComplete]);
  // Ни один фрагмент не является подтверждённым фактом. Различается срочность:
  // число и ссылка выглядят как доказательство, общее описание — нет.
  const reviews = [
    ['Утверждение пока не подтверждено источником', 'Это общее описание порядка. Его нужно проверить, но оно не выглядит как конкретное доказательство.', 'warn'],
    ['Проверить в первую очередь', 'Здесь указан конкретный срок. Проверьте его по документу, прежде чем использовать в работе.', 'danger'],
    ['Проверить в первую очередь', 'Этот фрагмент проверяют первым: ссылка на конкретный пункт выглядит как доказательство.', 'danger'],
    ['Утверждение пока не подтверждено источником', 'Это общее описание процедуры. Его нужно проверить по источнику, прежде чем использовать в работе.', 'warn'],
  ];
  if (phase === 2) return <div className="content-layout compact-content hallucination-review"><div className="slide-heading"><p className="eyebrow">Разбор по фрагментам</p><h1>С чего начинать проверку</h1></div><div className="review-fragments">{props.slide.choices?.map((item,idx)=><article className={props.selected.includes(idx)?`${reviews[idx][2]} marked`:reviews[idx][2]} key={item.label}><span>{idx+1}</span><div><p>{item.label}</p>{props.selected.includes(idx)&&<em className="you-marked">вы отметили</em>}<b>{reviews[idx][0]}.</b><small>{reviews[idx][1]}</small></div></article>)}</div><div className="review-bottom"><p><b>Ни один из четырёх фрагментов не подтверждён источником.</b> Число и ссылка могут быть восприняты как доказательство, поэтому сначала проверьте их.</p><button className="primary-action" type="button" onClick={()=>setPhase(3)}>Перейти к термину</button></div></div>;
  if (phase === 3) return <div className="content-layout compact-content hallucination-term"><div className="slide-heading"><p className="eyebrow">Термин</p><h1>Как называется такая ошибка</h1></div><section className="term-accent"><b>Галлюцинация</b><p>Правдоподобная, но неподтверждённая или выдуманная деталь в ответе ИИ.</p></section><div className="term-copy"><p>Это типичная ошибка генеративной модели. Она возникает, когда модель заполняет пробел подходящим по смыслу текстом. Когда нужного факта нет, она достраивает то, что чаще всего встречается в похожих текстах. Так и появляется убедительный «пункт 3.5».</p></div><div className="term-bottom"><p>Сначала проверяйте конкретные числа и ссылки, потому что именно они выглядят как доказательство.</p><button className="primary-action" type="button" onClick={props.onNext}>Следующий экран</button></div></div>;
  const labels = props.slide.choices?.map((item)=>item.label) ?? [];
  const notNeeded = [
    'проверить нужно и его, но это общее утверждение о порядке: оно не станет в документе ни цифрой, ни ссылкой',
    '',
    '',
    'проверить нужно и его, но это общее описание процедуры, а не доказательство',
  ];
  return <div className="content-layout compact-content hallucination-task"><SlideHeading slide={props.slide}/><section className="assistant-answer-card"><header><b>Вопрос сотрудника</b><p>В какой срок согласовывается договор с новым контрагентом?</p></header><div className="answer-fragments">{props.slide.choices?.map((item,idx)=>{const selected=props.selected.includes(idx);return <button type="button" key={item.label} disabled={phase===1} className={selected?'selected':''} onClick={()=>props.onToggleMulti(idx)}><span>{idx+1}</span><p>{item.label}</p>{phase===1&&selected&&<em className="you-marked">вы отметили</em>}</button>})}</div>{phase===1
    ? <Verdict correct={props.slide.correctIndexes ?? []} selected={props.selected} labels={labels} reasons={notNeeded} extraTitle="Вы отметили лишний фрагмент" extraNote="Его тоже нужно проверить, но во вторую очередь: это общее описание процесса, а не конкретное доказательство." successText="Верно. Конкретное число и ссылка на документ выглядят убедительно, поэтому их проверяют первыми." reviewLabel="Посмотреть разбор" onRetry={()=>{props.onResetMulti();setPhase(0);}} onReview={()=>{props.onCheckMulti();setPhase(2);}} />
    : <footer><span><b>Задание:</b> отметьте два фрагмента, которые выглядят как доказательство: их проверяют <strong>первыми</strong>.</span><button type="button" disabled={!props.selected.length} onClick={()=>setPhase(1)}>Проверить</button></footer>}</section></div>;
}

function FourChecksSlide(props: SlideViewProps) {
  // Порядок экрана: сначала понятное задание, потом вердикт, потом разбор
  // и только в конце — четыре проверки как памятка. Раньше принципы стояли
  // слева от задания и читались как ребус.
  const [phase,setPhase]=useState<0|1|2>(0);
  const exact = props.selected.length===2&&props.selected.includes(2)&&props.selected.includes(3);
  const checks=[['Источники','чем подтверждается важный факт?'],['Расчёты','правильно ли выбраны база, период и единицы?'],['Полнота','выполнены ли все части запроса?'],['Выводы','есть ли в ответе утверждения, которых нет в исходных данных?']];
  const labels=props.slide.choices?.map(item=>item.label)??[];
  const notNeeded=['это корректный расчёт: рост с 1240 до 1418 составляет 14,4%','это корректный расчёт по предоставленным данным','',''];
  return <div className="content-layout compact-content checks-slide">
    <SlideHeading slide={props.slide}/>
    <section className="report-card">
      <header className="report-head">
        <b>Справка о динамике портфеля вкладов</b>
        <span>Исходные данные: открыто вкладов 1240 в 2024 году и 1418 в 2025, доля автопролонгации 65,5% и 68,2%</span>
      </header>
      <p className="report-task">Все четыре строки звучат одинаково уверенно. <strong>Отметьте два вывода, которые нельзя сделать на основании предоставленных данных.</strong></p>
      <div className="report-rows">
        {props.slide.choices?.map((item,idx)=>{
          const selected=props.selected.includes(idx);
          const state=props.checkedMulti?(item.correct?'correct':selected?'wrong':''):selected?'selected':'';
          return <button type="button" key={item.label} disabled={phase>0} className={state} onClick={()=>!props.checkedMulti&&props.onToggleMulti(idx)}>
            <i className="report-box" aria-hidden="true">{selected?'✓':''}</i>
            <p>{item.label}</p>
            {phase>0&&selected&&<em className="you-marked">вы отметили</em>}
            {props.checkedMulti&&<small>{item.feedback}</small>}
          </button>;
        })}
      </div>
      {phase===1
        ? <Verdict correct={props.slide.correctIndexes ?? []} selected={props.selected} labels={labels} reasons={notNeeded} extraTitle="Вы отметили строку, которая подтверждается исходными данными" successText="Верно. Расчёты подтверждаются данными, а выводы о качестве и эффективности не подтверждаются." reviewLabel="Посмотреть разбор" onRetry={()=>{props.onResetMulti();setPhase(0);}} onReview={()=>{props.onCheckMulti();setPhase(2);}} />
        : <footer>{!props.checkedMulti
            ? <button type="button" disabled={!props.selected.length} onClick={()=>setPhase(1)}>Проверить</button>
            : <b>{exact?'Верно. Расчёты подтверждаются данными, а выводы о качестве и эффективности не подтверждаются.':'Уверенный тон не заменяет проверку выводов по исходным данным.'}</b>}</footer>}
    </section>
    <div className="check-principles">
      <p className="checks-label">По этим четырём пунктам проверяется любой ответ</p>
      <div>{checks.map((item,idx)=><article key={item[0]}><span>{idx+1}</span><div><b>{item[0]}</b><p>{item[1]}</p></div></article>)}</div>
    </div>
  </div>;
}

function ClassifySlide(props: SlideViewProps) {
  if (props.slide.id === 6) return <SourceFactSlide {...props} />;
  if (props.slide.id === 10) return <DataZonesSlide {...props} />;
  if (props.slide.id === 15) return <PromptBuilderSlide {...props} />;
  const cards = props.slide.cards ?? [];
  const card = cards[props.cardPosition];
  const done = props.cardPosition >= cards.length;
  return (
    <div className="content-layout">
      <SlideHeading slide={props.slide} />
      <div className="classify-board">
        <div className="classify-progress"><span style={{ width: `${(props.cardPosition / cards.length) * 100}%` }} /></div>
        {!done ? (
          <>
            <article className="active-card"><p>Карточка {props.cardPosition + 1} из {cards.length}</p><h2>{card.text}</h2></article>
            <div className="category-buttons">
              {props.slide.categories?.map((category) => <button type="button" key={category} onClick={() => props.onClassify(category)}>{category}</button>)}
            </div>
            {props.classifyFeedback && <div className={props.classifyFeedback.startsWith('Верно') || props.classifyFeedback === card.feedback ? 'inline-feedback correct' : 'inline-feedback wrong'}>{props.classifyFeedback}</div>}
          </>
        ) : (
          <div className="classification-complete"><b>{props.classifyScore}/{cards.length}</b><h2>Все карточки распределены</h2><p>Вы применили правило к каждому примеру.</p></div>
        )}
      </div>
      <Note text={props.slide.note} />
    </div>
  );
}

function SourceFactSlide(props: SlideViewProps) {
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0);
  const { onComplete } = props;
  useEffect(() => { if (phase === 3) onComplete(); }, [phase, onComplete]);
  const [first, setFirst] = useState<number[]>([]);
  const [second, setSecond] = useState<number[]>([]);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const noSource = ['Сократить или переписать текст','Изменить тон или структуру','Выписать поручения из документа'];
  const needsSource = ['Даты, суммы, ставки','Нормы и последние изменения','Продукты и процессы «у нас»'];
  const questions = [
    {title:'В каких задачах ИИ не нужно добавлять новые факты?',intro:'Отметьте три задачи из четырёх.',items:['Вот черновик письма клиенту. Перепиши его короче и мягче','Вот протокол встречи. Выпиши поручения и указанные в нём сроки','Напиши клиенту письмо с нашими действующими ставками по вкладам','Предложи три варианта заголовка для внутренней рассылки'],correct:[0,1,3],reasons:['Для сокращения письма новые факты не нужны: исходный текст уже дан.','Для списка поручений новые факты не нужны: они уже есть в протоколе.','Для действующих ставок нужен актуальный источник.','Для заголовков новые факты не нужны.']},
    {title:'В каких задачах нужен дополнительный источник?',intro:'Отметьте три задачи из четырёх.',items:['За сколько дней банк обязан ответить на обращение клиента','Измени тон этого письма на более официальный','Что изменилось в правилах работы с обращениями за последний месяц','Какие документы нужны юридическому лицу для открытия счёта в нашем банке'],correct:[0,2,3],reasons:['Для срока ответа нужна действующая норма.','Для изменения тона новые факты не нужны.','Для последних изменений нужен актуальный источник.','Для перечня документов нужны действующие правила банка.']},
  ];
  if (phase === 0) return <div className="content-layout compact-content source-explain"><SlideHeading slide={props.slide}/>
    <div className="source-duo">
      <section className="source-card safe"><h2>ИИ работает с предоставленным материалом</h2><ul>{noSource.map(item=><li key={item}>{item}</li>)}</ul><footer>→ результат можно сверить</footer></section>
      <section className="source-card risk"><h2>ИИ должен добавить новые факты</h2><ul>{needsSource.map(item=><li key={item}>{item}</li>)}</ul><footer>→ факт нужно проверить</footer></section>
    </div>
    <div className="source-bottom"><p>Если источник есть, сверяйте с ним. Если источника нет, не принимайте факт на веру.</p><button className="primary-action" type="button" onClick={()=>setPhase(1)}>Проверить себя</button></div>
  </div>;
  if (phase === 1 || phase === 2) {
    const idx = phase - 1;
    const question = questions[idx];
    const selected = idx === 0 ? first : second;
    const setSelected = idx === 0 ? setFirst : setSecond;
    const isChecked = checked[idx];
    return <div className="content-layout compact-content source-question"><div className="slide-heading"><p className="eyebrow">Проверьте себя</p><h1>{question.title}</h1><p className="slide-intro">{question.intro}</p></div><div className="source-options">{question.items.map((item,itemIdx)=>{const chosen=selected.includes(itemIdx);const state=isChecked?(question.correct.includes(itemIdx)?'correct':chosen?'wrong':''):chosen?'selected':'';return <button type="button" key={item} disabled={isChecked} className={state} onClick={()=>setSelected(values=>values.includes(itemIdx)?values.filter(value=>value!==itemIdx):[...values,itemIdx])}><span>{chosen?'✓':''}</span><p>{item}</p>{isChecked&&chosen&&<em className="you-marked">вы отметили</em>}</button>})}</div>{isChecked
      ? <Verdict correct={question.correct} selected={selected} labels={question.items} reasons={question.reasons} numbered={false} successText="Верно. Вы определили, где ИИ работает с готовым материалом, а где добавляет новые факты." reviewLabel={phase===1?'Следующий вопрос':'Посмотреть разбор'} onRetry={()=>{setSelected([]);setChecked(value=>({...value,[idx]:false}));}} onReview={()=>setPhase(phase===1?2:3)} />
      : <div className="question-actions"><button className="primary-action" type="button" disabled={!selected.length} onClick={()=>setChecked(value=>({...value,[idx]:true}))}>Проверить</button></div>}</div>;
  }
  return <div className="content-layout compact-content source-review">
    <div className="slide-heading"><h1>Почему для одних задач достаточно исходного материала, а для других нужен источник</h1></div>
    <div className="source-review-layout">
      <figure className="rates-overview"><div><img src={asset('/media/slide-06-invented-rates.png')} alt="Два полных ответа ИИ на один запрос с разными ставками"/></div><figcaption>Один и тот же вопрос без источника даёт разные цифры</figcaption></figure>
      <section className="review-summary">
        <div className="summary-group safe"><h2>Источник уже был</h2><p><span>✓</span><b>Черновик письма:</b> материал предоставлен</p><p><span>✓</span><b>Поручения:</b> протокол приложен</p><p><span>✓</span><b>Заголовки:</b> это варианты формулировок</p><strong>Для ставок нужен дополнительный источник</strong></div>
        <div className="summary-group risk"><h2>Факт нужно подтвердить</h2><p><b>Срок ответа:</b> действующая норма</p><p><b>Изменения:</b> актуальный источник</p><p><b>Документы банка:</b> внутренние правила</p><strong>Изменение тона не добавляет новых фактов</strong></div>
        <div className="source-question-accent"><b>Чем подтверждается этот факт?</b><p>Ответ ИИ сам по себе не является источником. Найдите документ, данные или ссылку.</p></div>
      </section>
    </div>
    <div className="source-review-footer"><p>Даже если сервис показывает ссылки, откройте источник и убедитесь, что он подтверждает утверждение.</p><button className="primary-action" type="button" onClick={props.onNext}>Следующий экран</button></div>
  </div>;
}

function DataZonesSlide(props: SlideViewProps) {
  // По одному материалу за раз: у каждого свой разбор, поэтому общий feedback
  // («пограничный материал — жёлтый») здесь был бы прямой дезинформацией.
  const cards = props.slide.cards ?? [];
  const { onComplete } = props;
  const [position, setPosition] = useState(0);
  const [wrong, setWrong] = useState('');
  const [solved, setSolved] = useState('');
  const card = cards[position];
  const done = position >= cards.length;
  useEffect(() => { if (done) onComplete(); }, [done, onComplete]);
  const zoneOf = (category: string) => category.startsWith('Зелёная') ? 'green' : category.startsWith('Красная') ? 'red' : 'yellow';
  const assign = (category: string) => {
    if (!card || solved) return;
    if (card.category === category) setSolved(card.feedback || 'Верно');
    else setWrong(card.wrongFeedback ?? 'Правильная категория указана ниже. Проверьте, что именно в материале может раскрыться при загрузке.');
  };
  return <div className="content-layout compact-content zones-slide">
    <SlideHeading slide={props.slide}/>
    <div className="traffic-zones wide"><span className="green">Зелёная<br/><small>можно использовать в разрешённом сервисе</small></span><span className="yellow">Жёлтая<br/><small>сначала нужно получить согласование</small></span><span className="red">Красная<br/><small>нельзя передавать во внешний ИИ-сервис</small></span></div>
    {!done ? <section className="zone-practice">
      <header><p>Пример {position + 1} из {cards.length}</p><div className="zone-progress"><span style={{ width: `${(position / cards.length) * 100}%` }} /></div></header>
      <h2>{card.text}</h2>
      <p className="zone-instruction">К какой категории относятся эти данные?</p>
      <div className="zone-choices">{props.slide.categories?.map((category) => (
        <button type="button" key={category} disabled={Boolean(solved)}
          className={`zone-choice zone-${zoneOf(category)}${solved && card.category === category ? ' picked' : ''}`}
          onClick={() => assign(category)}>{category.split(' ')[0]}</button>
      ))}</div>
      {solved
        ? <div className="zone-feedback correct"><b>Верно</b><p>{solved}</p><button className="primary-action" type="button" onClick={() => { setPosition((value) => value + 1); setSolved(''); setWrong(''); }}>{position === cards.length - 1 ? 'Завершить' : 'Следующий пример'}</button></div>
        : wrong && <div className="zone-feedback wrong"><p>{wrong}</p></div>}
    </section>
    : <section className="zone-complete"><b>{cards.length}/{cards.length}</b><h2>Все примеры разобраны</h2><p>Зелёные данные — используйте только в разрешённых сервисах.</p><p>Жёлтые данные — сначала согласуйте передачу.</p><p>Красные данные — не передавайте во внешние ИИ-сервисы.</p><p>Если сомневаетесь — выбирайте жёлтую категорию.</p></section>}
    <Note text={props.slide.note}/>
  </div>;
}

function PromptBuilderSlide(props: SlideViewProps) {
  // Проверяется тот навык, который нужен в работе: посмотреть на свой запрос
  // и увидеть, чего в нём нет. Перебрать варианты наугад нельзя — после ответа
  // сразу виден разбор, а следующий раунд открывается кнопкой.
  const { onComplete } = props;
  const parts = ['Задача', 'Контекст', 'Формат', 'Проверка'];
  const rounds = [
    {
      task: 'Сравнить вклад и накопительный счёт для новых сотрудников.',
      lines: [
        ['Задача', 'Составь сравнение вклада и накопительного счёта'],
        ['Контекст', 'Для новых сотрудников, по приложенным опубликованным условиям'],
        ['Проверка', 'Не добавляй условий из других источников. Ставки не округляй'],
      ],
      missing: 'Формат',
      why: 'Без формата модель не знает, нужен вам абзац, таблица или подробный документ.',
      fix: 'Таблица из четырёх строк и три предложения, до 120 слов.',
    },
    {
      task: 'Справка об изменении портфеля вкладов за 2024 и 2025 годы.',
      lines: [
        ['Задача', 'Подготовь справку об изменении портфеля вкладов за 2024 и 2025 годы'],
        ['Контекст', 'Данные за 2024 и 2025 годы приложены. Справка для руководителя отделения.'],
        ['Формат', 'Таблица сравнения и ровно три коротких вывода, до 120 слов'],
      ],
      missing: 'Проверка',
      why: 'Не сказано, относительно какого года считать изменение и что делать при нехватке данных. Без правила проверки модель может выбрать неверную базу расчёта или добавить неподтверждённый вывод.',
      fix: 'Рассчитай изменение каждого показателя относительно 2024 года. Если данных не хватает, напиши «нет данных» и не делай выводов о причинах.',
    },
    {
      task: 'Памятка по правилам рабочей переписки.',
      lines: [
        ['Задача', 'Составь памятку по правилам рабочей переписки'],
        ['Формат', 'Заголовок и пять шагов, каждый шаг не длиннее двух предложений'],
        ['Проверка', 'Не добавляй правил, которых нет в исходном материале'],
      ],
      missing: 'Контекст',
      why: 'Не сказано, для кого памятка и на каком материале её строить. Без исходного материала модель не сможет определить, какие правила действительно существуют.',
      fix: 'Для новых сотрудников, по приложенным открытым правилам рабочей переписки.',
    },
  ];
  const [round, setRound] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const done = round >= rounds.length;
  useEffect(() => { if (done) onComplete(); }, [done, onComplete]);
  if (done) return <div className="content-layout compact-content missing-slide">
    <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Вы нашли недостающую часть во всех трёх запросах</p><h1>Перед отправкой проверяйте запрос по этим четырём частям</h1></div>
    <div className="missing-summary">
      {[['Задача', 'что нужно сделать, одно действие'],
        ['Контекст', 'для кого, зачем и на каком материале'],
        ['Формат', 'структура, объём и стиль результата'],
        ['Проверка', 'что проверить и что делать, если данных не хватает']].map((item) => (
        <article key={item[0]}><b>{item[0]}</b><p>{item[1]}</p></article>
      ))}
    </div>
    <section className="missing-extra">
      <b>После проверки структуры убедитесь, что этому сервису можно передавать такие данные</b>
      <p>Выгрузку с ФИО и суммами передавать нельзя, как бы аккуратно ни был составлен запрос.</p>
    </section>
  </div>;
  const current = rounds[round];
  const correct = answer === current.missing;
  return <div className="content-layout compact-content missing-slide">
    <div className="slide-heading" data-slide-focus tabIndex={-1}>
      <p className="eyebrow">Запрос {round + 1} из 3</p>
      <h1>Какой части не хватает в этом запросе?</h1>
      <p className="slide-intro">Задача: {current.task}</p>
    </div>
    <div className="missing-request">
      {current.lines.map((line) => <article key={line[1]}><b>{line[0]}</b><p>{line[1]}</p></article>)}
      <article className="gap"><b>?</b><p>здесь пусто</p></article>
    </div>
    <div className="missing-options">{parts.map((part) => {
      const state = answer === null ? '' : part === current.missing ? 'correct' : answer === part ? 'wrong' : '';
      return <button type="button" key={part} className={`missing-option ${state}`} disabled={correct} onClick={() => setAnswer(part)}>{part}</button>;
    })}</div>
    {answer && <div className={correct ? 'missing-feedback correct' : 'missing-feedback wrong'}>
      <b>{correct ? `Верно. В запросе не хватает части «${current.missing}».` : `Не то. Часть «${answer}» в запросе есть. Не хватает части «${current.missing}».`}</b>
      <p>{current.why}</p>
      <div className="missing-fix"><span>Чего не хватало</span><p>{current.fix}</p></div>
      <button className="primary-action" type="button" onClick={() => { setRound((value) => value + 1); setAnswer(null); }}>
        {round === rounds.length - 1 ? 'Показать итог' : 'Следующий запрос'}
      </button>
    </div>}
  </div>;
}

function PracticeSlide(props: SlideViewProps) {
  // Внешнее действие должно замкнуться: отправили → вернулись → уточнили →
  // сравнили → получили вывод. Без явного возврата практика обрывается на ссылке.
  const { onComplete } = props;
  const [phase, setPhase] = useState<0 | 1 | 2>(0);
  const [change, setChange] = useState('');
  const [extra, setExtra] = useState('');
  // Вторая ветка для тех, у кого нет доступа к разрешённому сервису: без неё
  // экран становится тупиком и практику пройти нельзя.
  const [sample, setSample] = useState<0 | 1 | 2>(0);
  useEffect(() => { if (phase === 2) onComplete(); }, [phase, onComplete]);

  const sampleFirst = `Неделя 1 | Разобраться с постановкой задачи | Составить три запроса из четырёх частей: задача, контекст, формат, проверка
Неделя 2 | Научиться проверять ответ | Проверить пять ответов по источникам, расчётам, полноте и выводам
Неделя 3 | Освоить уточнения | Собрать замечания к ответу и отправить их одним сообщением
Неделя 4 | Определять категорию данных | Разобрать пять рабочих материалов и определить их категорию
Неделя 5 | Пройти курс «Основы работы с ИИ» в корпоративной системе обучения | Завершить курс и сдать тест
Неделя 6 | Применить формулу к своей задаче | Подготовить черновик по разрешённому материалу
Неделя 7 | Проверить результат по регламенту 4.2 | Сверить черновик с требованиями регламента
Неделя 8 | Собрать типовые запросы | Составить личный набор из пяти запросов
Неделя 9 | Оценить экономию времени | Сравнить время на задачу до и после
Неделя 10 | Разобрать сложный случай | Взять задачу из нескольких этапов
Неделя 11 | Поделиться практикой | Показать коллегам два своих запроса
Неделя 12 | Подвести итоги | Отобрать задачи, где ИИ действительно помогает

Как понять, что план выполнен. Сотрудник самостоятельно составляет запрос из четырёх частей. Сотрудник находит в ответе места, которые нужно подтвердить источником. Сотрудник верно определяет категорию данных до загрузки материала.`;

  const sampleSecond = `Неделя 1 | Разобраться с постановкой задачи | Составить три запроса из четырёх частей | Три запроса сохранены, в каждом есть задача, контекст, формат и проверка
Неделя 2 | Научиться проверять ответ | Проверить пять ответов по источникам, расчётам, полноте и выводам | По каждому ответу выписано, что подтверждено данными, а что нет
Неделя 3 | Освоить уточнения | Собрать замечания и отправить их одним сообщением | В диалоге видно одно уточнение вместо нескольких
Неделя 4 | Определять категорию данных | Разобрать пять материалов и определить категорию | По каждому материалу назван цвет категории и основание
Неделя 5 | Применить формулу к своей задаче | Подготовить черновик по разрешённому материалу | Черновик готов, источник материала указан
Неделя 6 | Собрать типовые запросы | Составить личный набор из пяти запросов | Набор сохранён и применён хотя бы один раз
Неделя 7 | Разобрать сложный случай | Взять задачу из нескольких этапов | Каждый этап выполнен отдельным запросом
Неделя 8 | Подвести итоги | Отобрать задачи, где ИИ действительно помогает | Список задач составлен, по каждой указан результат

Как проверить выполнение: по каждой строке указан признак, по которому видно, что работа сделана.`;

  const sampleButton = (label: string, value: 1 | 2) => (
    <button className="secondary-action" type="button" onClick={() => setSample(value)}>{label}</button>
  );

  if (phase === 0) return (
    <div className="content-layout practice-slide compact-content">
      <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Практика · шаг 1 из 2</p><h1>Учебный запрос</h1><p className="slide-intro">Это учебный запрос. Отправлять его в реальный сервис не нужно: ответ модели показан здесь.</p></div>
      <div className="practice-grid">
        <ol className="practice-steps">
          <li><span>1</span><p>Прочитайте учебный запрос</p></li>
          <li><span>2</span><p>Откройте учебный ответ модели</p></li>
          <li><span>3</span><p>Перейдите к уточнению</p></li>
        </ol>
        <section className="prompt-stack compact-prompts single">
          <article className="prompt-card"><p>Учебный запрос</p><pre>{props.slide.prompt}</pre></article>
        </section>
      </div>
      {sample === 1 && <div className="quiz-modal" role="dialog" aria-modal="true" aria-label="Учебный ответ модели">
        <button className="quiz-backdrop" type="button" onClick={() => setSample(0)} aria-label="Закрыть учебный ответ" />
        <section className="quiz-dialog sample-dialog"><header><p className="question-label">Учебный ответ модели</p><button type="button" onClick={() => setSample(0)} aria-label="Закрыть">×</button></header>
          <p className="sample-lead">Ниже приведён пример учебного ответа модели.</p>
          <pre>{sampleFirst}</pre>
          <button className="secondary-action quiz-done" type="button" onClick={() => setSample(0)}>Вернуться к практике</button>
        </section>
      </div>}
      <div className="practice-return">
        {sampleButton('Показать учебный ответ модели', 1)}
        <p><b>В ответе есть места, которые нельзя проверить.</b> Дальше вы уточните запрос и сравните ответы.</p>
        <button className="primary-action" type="button" onClick={() => setPhase(1)}>Перейти к уточнению</button>
      </div>
    </div>
  );

  if (phase === 1) return (
    <div className="content-layout practice-slide compact-content">
      <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Практика · шаг 2 из 2</p><h1>Одно уточнение вместо нового запроса</h1><p className="slide-intro">Уточнение отправляют вторым сообщением в том же диалоге, поэтому исходные данные передавать заново не нужно.</p></div>
      <div className="practice-grid reflect">
        <section className="prompt-stack compact-prompts single">
          <article className="prompt-card accent"><p>Уточнение</p><pre>{props.slide.promptB}</pre></article>
        </section>
        <div className="practice-reflection">
          <p className="reflection-label">Откройте ответ модели после уточнения и сравните его с первым.</p>
          {sampleButton('Показать ответ модели после уточнения', 2)}
          <label>Что изменилось после уточнения?
            <select value={change} onChange={(event) => setChange(event.target.value)}>
              <option value="">Выберите</option>
              <option value="better">Ответ стал короче и лучше соответствует требованиям</option>
              <option value="worse">Ответ стал короче, но часть нужной информации пропала</option>
              <option value="same">Ответ не изменился</option>
            </select>
          </label>
          {change && <button className="primary-action" type="button" onClick={() => setPhase(2)}>Посмотреть разбор</button>}
        </div>
      </div>
      {sample === 2 && <div className="quiz-modal" role="dialog" aria-modal="true" aria-label="Ответ модели после уточнения">
        <button className="quiz-backdrop" type="button" onClick={() => setSample(0)} aria-label="Закрыть учебный ответ" />
        <section className="quiz-dialog sample-dialog"><header><p className="question-label">Ответ модели после уточнения</p><button type="button" onClick={() => setSample(0)} aria-label="Закрыть">×</button></header>
          <p className="sample-lead">Ниже приведён пример учебного ответа модели после уточнения.</p>
          <pre>{sampleSecond}</pre>
          <button className="secondary-action quiz-done" type="button" onClick={() => setSample(0)}>Вернуться к практике</button>
        </section>
      </div>}
    </div>
  );

  const changeText = change === 'better'
    ? 'Так и должно быть: уточнение сократило ответ, убрало непроверяемые места и не потребовало пересылать задачу заново.'
    : change === 'worse'
      ? 'Нет. Основные этапы сохранены, а для каждого добавлен способ проверки выполнения.'
      : 'Нет. Ответ сократился до восьми строк, из него удалены неподтверждённые названия и добавлена колонка проверки.';
  return (
    <div className="content-layout practice-slide compact-content">
      <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Практика завершена</p><h1>Что вы только что сделали</h1></div>
      <div className="practice-conclusion">
        <article><b>Уточнение вместо нового запроса</b><p>{changeText}</p></article>
        <article><b>Проверяйте содержание, а не только качество текста</b><p>В первом ответе были названия курса и регламента, которых не было в задании. Модель подставила их по смыслу. Такие места нужно находить в любом рабочем ответе.</p></article>
        <article className="rule"><b>Когда ответ можно использовать</b><p>Ответ можно использовать, если выполнены все требования запроса, а важные факты, расчёты и выводы подтверждены исходными данными. Именно это проверяется на итоговом кейсе.</p></article>
      </div>
      <div className="practice-done"><b>✓ Практика завершена</b><p>Переходите к итоговому кейсу.</p></div>
    </div>
  );
}

function CaseSlide(props: SlideViewProps) {
  const steps = props.slide.caseSteps ?? [];
  const step = steps[props.caseStep];
  const [caseParts,setCaseParts]=useState<Record<number,string>>({});
  const [caseFind,setCaseFind]=useState<number[]>([]);
  const [caseSpecialFeedback,setCaseSpecialFeedback]=useState('');
  const [caseAttempts,setCaseAttempts]=useState(0);
  // «Пройти ещё раз» сбрасывает счёт в Home, но локальные ответы шагов 3 и 4
  // жили дальше: шаг оставался заполненным и заблокированным, а балл терялся.
  const restarted = props.caseStep === 0 && !props.caseAnswered && props.chosen === null;
  const [wasRestarted, setWasRestarted] = useState(restarted);
  if (restarted !== wasRestarted) {
    setWasRestarted(restarted);
    if (restarted) {
      setCaseParts({});
      setCaseFind([]);
      setCaseSpecialFeedback('');
      setCaseAttempts(0);
    }
  }
  if (props.completed) {
    // Шаги 1, 2 и 5 критические: задача, данные и окончательное решение.
    // Ошибка в любом из них — не зачёт, сколько бы ни набрано в сумме.
    const principles = [
      'подходит ли задача для ИИ: подготовка или окончательное действие',
      'какие данные можно использовать и в каком сервисе',
      'из каких четырёх частей состоит запрос',
      'что именно проверяется в готовом ответе',
      'кто принимает решение и публикует результат',
    ];
    const criticalMissed = props.caseMisses.filter((step) => step === 0 || step === 1 || step === 4);
    const passed = props.caseScore >= 4 && criticalMissed.length === 0;
    const flawless = props.caseScore === 5;
    return (
      <div className="case-result">
        <BrandLogo />
        <p className="eyebrow">Итоговый кейс завершён</p>
        <b>{props.caseScore}/5</b>
        <h1>{flawless ? 'Все пять решений приняты правильно' : passed ? 'Кейс засчитан. Один принцип нужно повторить' : 'Кейс нужно пройти ещё раз'}</h1>
        <p>{flawless
          ? 'Вы приняли безопасные решения на всех пяти этапах.'
          : passed
            ? 'Кейс засчитан. Один принцип нужно повторить.'
            : criticalMissed.length
              ? 'Ошибка в одном из ключевых правил: подходит ли задача, какие данные, кто принимает решение. Такое решение нужно принять верно, поэтому кейс придётся пройти ещё раз.'
              : 'Набрано меньше четырёх верных решений из пяти, кейс нужно пройти ещё раз.'}</p>
        {props.caseMisses.length > 0 && <div className="case-misses">
          <b>Вернитесь к этим принципам</b>
          <ul>{props.caseMisses.slice().sort((a, b) => a - b).map((step) => <li key={step} className={step === 0 || step === 1 || step === 4 ? 'critical' : ''}>Шаг {step + 1}: {principles[step]}{(step === 0 || step === 1 || step === 4) && <em> · критический</em>}</li>)}</ul>
        </div>}
        <button className="primary-action" type="button" onClick={flawless ? props.onNext : props.onCaseRetry}>{flawless ? 'Перейти к пяти правилам' : 'Пройти ещё раз'}</button>
      </div>
    );
  }
  if (props.caseStep === 2) {
    const parts = [
      ['Составь памятку для новых сотрудников','Задача'],
      ['По приложенным опубликованным правилам рабочей переписки, для новых сотрудников','Контекст'],
      ['Заголовок, пять шагов и три вопроса; каждый шаг до двух предложений','Формат'],
      ['Не добавляй правил, которых нет в исходном материале','Проверка'],
    ];
    const zones=['Задача','Контекст','Формат','Проверка'];
    const filled=parts.every((_,idx)=>caseParts[idx]);
    const exact=parts.every((part,idx)=>caseParts[idx]===part[1]);
    return <div className="content-layout case-slide compact-content"><SlideHeading slide={{...props.slide, intro: undefined}}/>
      <section className="case-situation"><b>Ситуация</b><p>{props.slide.intro}</p></section>
      <div className="case-route">{steps.map((_,idx)=><span key={idx} className={idx<props.caseStep?'done':idx===props.caseStep?'active':''}>{idx+1}</span>)}</div>
      <section className="case-card special-case">
        <p className="question-label">Шаг 3 из 5 · Соберите запрос</p>
        <h2>Под каждым фрагментом запроса выберите его часть: задача, контекст, формат или проверка</h2>
        <div className="case-part-list">{parts.map((part,idx)=>{
          const picked=caseParts[idx];
          const state=props.caseAnswered?(picked===part[1]?'correct':'wrong'):picked?'picked':'';
          return <article key={part[0]} className={state}>
            <p>{part[0]}</p>
            <div className="part-options">{zones.map(zone=>(
              <button type="button" key={zone} disabled={props.caseAnswered} aria-pressed={picked===zone}
                className={props.caseAnswered?(zone===part[1]?'right':picked===zone?'wrong':''):picked===zone?'on':''}
                onClick={()=>setCaseParts(v=>({...v,[idx]:zone}))}>{zone}</button>))}</div>
            {props.caseAnswered && picked!==part[1] && <small>Это <b>{part[1]}</b></small>}
          </article>;})}</div>
        <div className="case-special-actions">
          {!props.caseAnswered
            ? <button type="button" disabled={!filled} onClick={()=>props.onCaseChoose(exact?0:1)}>{filled?'Проверить':'Выберите часть для каждого фрагмента'}</button>
            : <>
                <p className={exact?'ok':'retry'}>{exact?'Верно. Задача, контекст, формат и проверка составляют один запрос.':'Совпало не всё. Правильные части подписаны под фрагментами.'}</p>
                <button type="button" onClick={props.onCaseNext}>Следующий шаг</button>
              </>}
        </div>
      </section>
    </div>;
  }

  if (props.caseStep === 3) {
    // Сверять черновик не с чем, если исходных правил нет на экране: слева
    // источник, справа черновик. После второй неудачи разбор открывается сам.
    const source = [
      'Тема письма отражает его содержание.',
      'В конце письма указывают следующий шаг и что требуется от адресата.',
      'Срок ответа согласуется индивидуально, единого норматива нет.',
    ];
    const fragments = [
      ['Всегда отвечайте на письмо в течение одного часа.', 'Этого правила нет в приложенных материалах: в них сказано, что срок согласуется индивидуально.'],
      ['Используйте понятную тему, отражающую содержание.', 'Соответствует первому правилу.'],
      ['Обозначьте следующий шаг и действие адресата.', 'Соответствует второму правилу, изменена только формулировка.'],
      ['Сотрудник обязан указывать точный срок в каждом письме.', 'В правилах срок согласуется, а модель сделала его обязательным.'],
    ];
    const answer = [0, 3];
    const exact = caseFind.length === 2 && answer.every((item) => caseFind.includes(item));
    const revealed = props.caseAnswered || caseAttempts >= 2;
    const check = () => {
      if (props.caseAnswered) return;
      if (exact) { setCaseSpecialFeedback('Верно. Вы нашли выдуманное правило и требование, которого нет в исходном материале.'); props.onCaseChoose(0); return; }
      const next = caseAttempts + 1;
      setCaseAttempts(next);
      setCaseSpecialFeedback(next >= 2
        ? 'Разбор открыт под строками. Посмотрите и нажмите «Следующий шаг».'
        : 'Сравните каждое утверждение с исходными правилами: одно правило выдумано, другое подано строже источника.');
      if (next >= 2) props.onCaseChoose(1);
    };
    return <div className="content-layout case-slide compact-content">
      <SlideHeading slide={{...props.slide, intro: undefined}}/>
      <section className="case-situation"><b>Ситуация</b><p>{props.slide.intro}</p></section>
      <div className="case-route">{steps.map((_,idx)=><span key={idx} className={idx<props.caseStep?'done':idx===props.caseStep?'active':''}>{idx+1}</span>)}</div>
      <section className="case-card special-case">
        <p className="question-label">Шаг 4 из 5 · Проверьте черновик</p>
        <h2>Модель подготовила памятку по приложенным правилам. В ней есть два утверждения, которых нет в исходном материале. Отметьте их</h2>
        <div className="case-check-layout">
          <aside className="case-source">
            <b>Правила, которые вы приложили к запросу</b>
            <ul>{source.map((item) => <li key={item}>{item}</li>)}</ul>
          </aside>
          <div className="case-draft">
            <b>Памятка, которую подготовила модель</b>
            <div className="case-fragments">{fragments.map((fragment, idx) => {
              const picked = caseFind.includes(idx);
              const state = revealed ? (answer.includes(idx) ? 'correct' : picked ? 'wrong' : '') : picked ? 'selected' : '';
              return <button type="button" key={fragment[0]} className={state} disabled={revealed}
                onClick={() => setCaseFind((values) => values.includes(idx) ? values.filter((value) => value !== idx) : [...values, idx])}>
                <span>{idx + 1}</span>{fragment[0]}
                {revealed && <small>{fragment[1]}</small>}
              </button>;
            })}</div>
          </div>
        </div>
        <div className="case-special-actions">
          {!props.caseAnswered && <button type="button" disabled={caseFind.length !== 2} onClick={check}>{caseFind.length === 2 ? 'Проверить' : 'Отметьте два утверждения'}</button>}
          {caseSpecialFeedback && <p className={props.caseAnswered && exact ? 'ok' : 'retry'}>{caseSpecialFeedback}</p>}
          {props.caseAnswered && <button type="button" onClick={props.onCaseNext}>Следующий шаг</button>}
        </div>
      </section>
    </div>;
  }

  const choice = props.chosen === null ? null : step.choices[props.chosen];
  return (
    <div className="content-layout compact-content case-slide">
      <SlideHeading slide={{...props.slide, intro: undefined}} />
      <section className="case-situation"><b>Ситуация</b><p>{props.slide.intro}</p></section>
      <div className="case-route">{steps.map((_, idx) => <span key={idx} className={idx < props.caseStep ? 'done' : idx === props.caseStep ? 'active' : ''}>{idx + 1}</span>)}</div>
      <section className="case-card">
        <p className="question-label">Шаг {props.caseStep + 1} из 5</p>
        <h2>{step.title}</h2>
        <p>{step.prompt}</p>
        <div className="choice-list compact">
          {step.choices.map((item, idx) => <button key={item.label} className={`choice ${props.caseAnswered && props.chosen === idx ? (item.correct ? 'correct' : 'wrong') : ''}`} type="button" disabled={props.caseAnswered} onClick={() => props.onCaseChoose(idx)}><span>{String.fromCharCode(65 + idx)}</span>{item.label}</button>)}
        </div>
        {choice && <div className={choice.correct ? 'feedback correct' : 'feedback wrong'}>{choice.feedback}</div>}
        {props.caseAnswered && <button className="secondary-action" type="button" onClick={props.onCaseNext}>{props.caseStep === 4 ? 'Показать результат' : 'Следующий шаг'}</button>}
      </section>
    </div>
  );
}

function FinalSlide(props: SlideViewProps) {
  const caseScore = props.savedCaseScore;
  // «Курс завершён» — это статус, а не подпись экрана: он появляется только
  // после зачёта по итоговому кейсу.
  const criticalMissed = props.savedCaseMisses.filter((step) => step === 0 || step === 1 || step === 4);
  const passed = caseScore !== null && caseScore >= 4 && criticalMissed.length === 0;
  const status = caseScore === null ? 'Чтобы завершить курс, пройдите итоговый кейс' : passed ? 'Курс завершён' : 'Итоговый кейс пока не засчитан';
  return (
    <div className="final-layout">
      <div className="final-copy">
        <p className={caseScore === null ? 'eyebrow pending' : passed ? 'eyebrow' : 'eyebrow failed'}>{status}</p>
        <h1>{props.slide.title}</h1>
        <div className="rules-list">{props.slide.panels?.map((panel) => <article key={panel.title}><b>{panel.title}</b><p>{panel.body}</p></article>)}</div>
        <div className={caseScore === null ? 'final-score pending' : passed ? 'final-score' : 'final-score failed'}>
          {caseScore === null
            ? <><span>В нём пять решений, прохождение занимает около трёх минут.</span><button className="primary-action" type="button" onClick={props.onGoToCase}>Пройти итоговый кейс</button></>
            : passed
              ? <><span>Итоговый кейс пройден: <b>{caseScore}</b> из 5.</span>{caseScore < 5 && <button className="secondary-action" type="button" onClick={props.onGoToCase}>Пройти ещё раз</button>}</>
              : <><span>Итоговый кейс: <b>{caseScore}</b> из 5. {criticalMissed.length ? 'Ошибка в одном из ключевых правил: подходит ли задача, какие данные, кто принимает решение.' : 'Для зачёта нужно четыре верных решения из пяти.'}</span><button className="primary-action" type="button" onClick={props.onGoToCase}>Пройти кейс повторно</button></>}
        </div>
        <small>{props.slide.note}</small>
      </div>
      <div className="final-visual">
        <div className="final-next">
          <p><b>Что сделать сегодня.</b> Возьмите задачу без рабочих данных: план, структуру или список вопросов. Составьте запрос из четырёх частей: задача, контекст, формат, проверка.</p>
          <p><b>Что сделать на этой неделе.</b> Проверьте один ответ по источникам, расчётам, полноте и выводам и найдите в нём утверждение, которое требует источника.</p>
          <p className="security-line"><b>Сомневаетесь в материале</b>: обратитесь в информационную безопасность через утверждённый в банке канал обращения, до загрузки.</p>
        </div>
        <div className="final-avatar"><img src={asset('/media/avatar.png')} alt="Ведущий курса"/><p>ИИ готовит материал.<br/><b>Решение, согласование и публикация остаются за сотрудником.</b></p></div>
      </div>
    </div>
  );
}

// Экран 28 · зачем это вам: одна задача недели в двух режимах.
// Время показано полосами, а не таблицей: разницу видно, а не вычитывают.
function ValueSlide(props: SlideViewProps) {
  const rows = [
    { step: 'Прочитать и выбрать главное', usual: 25, ai: 3 },
    { step: 'Написать первый вариант', usual: 30, ai: 2 },
    { step: 'Дополнительно проверить ответ ИИ по исходным правилам', usual: 0, ai: 8 },
  ];
  const max = 30;
  const bar = (value: number) => `${Math.max(value / max * 100, value ? 4 : 0)}%`;
  return (
    <div className="content-layout compact-content value-slide">
      <SlideHeading slide={props.slide} />
      <div className="value-layout">
        <section className="time-chart">
          <header><span /><b>Как обычно</b><b>С ассистентом</b></header>
          {rows.map((row) => (
            <article key={row.step}>
              <p>{row.step}</p>
              <div className="bar usual"><i style={{ width: bar(row.usual) }} /><span>{row.usual ? `${row.usual} мин` : '0 мин'}</span></div>
              <div className="bar ai"><i style={{ width: bar(row.ai) }} /><span>{row.ai} мин</span></div>
            </article>
          ))}
          <footer><p>Итого</p><b>55 минут</b><b className="win">13 минут</b></footer>
        </section>
        <section className="value-copy">
          <p className="value-lead">Восемь из тринадцати минут уходят на проверку. Без неё черновик нельзя использовать в работе.</p>
          <p>Ассистент подготовил черновик, но сотрудник выбирает содержание, согласует текст и отвечает за отправку.</p>
          <div className="value-not-done">
            <b>Что он не сделал</b>
            <ul>
              <li>не решил, какие правила важны для новичков</li>
              <li>не согласовал текст</li>
              <li>не отправил его</li>
            </ul>
            <span>Эти три решения остаются за сотрудником.</span>
          </div>
        </section>
      </div>
      <Note text={props.slide.note} />
    </div>
  );
}

// Экран 29 · когда спрашивать у информационной безопасности.
function AskSecuritySlide(props: SlideViewProps) {
  return (
    <div className="content-layout compact-content ask-slide">
      <SlideHeading slide={props.slide} />
      <div className="ask-columns">
        <section className="ask-card safe">
          <h2>Отдельное согласование не требуется</h2>
          <p>Если материал создан без рабочих данных, а сервис разрешён банком. В материале нет ни имён, ни счетов, ни договоров, ни внутренних документов, ни цифр вашего подразделения.</p>
          <ul>
            <li>структура и план</li>
            <li>список вопросов</li>
            <li>объяснение термина</li>
            <li>черновик без реквизитов</li>
          </ul>
          <footer>→ можно использовать сразу</footer>
        </section>
        <section className="ask-card risk">
          <h2>Спросить обязательно, если</h2>
          <ul>
            <li>материал внутренний, даже без грифа</li>
            <li>есть суммы, даты и вид операции, даже без имени клиента</li>
            <li>вы не знаете, откуда файл взялся</li>
          </ul>
          <footer>→ до загрузки, а не после</footer>
        </section>
      </div>
      <div className="ask-channel"><b>Как получить согласование</b><span>Обратитесь в информационную безопасность через утверждённый в банке канал обращения, до загрузки, а не после.</span></div>
      <Note text={props.slide.note} />
    </div>
  );
}
