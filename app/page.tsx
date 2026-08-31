'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
      setCopyState('Не удалось скопировать — выделите текст вручную');
    }
  };

  const progress = ((index + 1) / slides.length) * 100;
  const currentChapter = useMemo(() => chapters.findLast((item) => index >= item.start)?.title ?? 'Вход', [index]);

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
          <button className={captions ? 'icon-button active' : 'icon-button'} type="button" onClick={() => setCaptions((value) => !value)} aria-label="Показать или скрыть текст озвучки">
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

        {captions && <div className="captions" role="status" ref={captionsRef}>{slide.voice}</div>}
      </section>

      <footer className={overlayOpen ? 'course-controls is-blocked' : 'course-controls'} aria-hidden={overlayOpen}>
        <button className="nav-button" type="button" onClick={goBack} disabled={index === 0 || overlayOpen} tabIndex={overlayOpen ? -1 : undefined} aria-label="Предыдущий экран">
          <Icon name="back" />
        </button>
        <button className="play-control" type="button" onClick={toggleMedia} disabled={slide.hasAudio === false || overlayOpen} tabIndex={overlayOpen ? -1 : undefined} aria-label={isPlaying ? 'Поставить озвучку на паузу' : playedOnce ? 'Повторить озвучку' : 'Включить озвучку'}>
          <Icon name={isPlaying ? 'pause' : playedOnce ? 'repeat' : 'play'} />
        </button>
        <div className="manual-hint">{nextBlocked ? 'Завершите действие на экране' : slide.hasAudio === false ? 'Текст экрана — на самом экране' : isPlaying ? 'Фраза звучит' : playedOnce ? 'Фраза закончилась — можно повторить' : 'Переход между экранами — вручную'}</div>
        <button className="nav-button next-button" type="button" onClick={() => goTo(index + 1)} disabled={index === slides.length - 1 || nextBlocked || overlayOpen} tabIndex={overlayOpen ? -1 : undefined} aria-label="Следующий экран">
          <Icon name="next" />
        </button>
      </footer>

      {slide.hasAudio !== false && (
        <audio ref={audioRef} key={slide.id} src={asset(`/audio/s${String(index + 1).padStart(2, '0')}.mp3`)} onEnded={onMediaEnded} preload="metadata" />
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

function SlideHeading({ slide }: { slide: Slide }) {
  return (
    <div className="slide-heading" data-slide-focus tabIndex={-1}>
      {slide.kicker && <p className="eyebrow">{slide.kicker}</p>}
      <h1>{slide.title}</h1>
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

function ServiceReview({ slide }: { slide: Slide }) {
  const review = slide.serviceReview;
  if (!review) return null;
  return (
    <aside className="service-review" aria-label="Актуальность сравнения сервисов">
      <div className="service-review-dates">
        <b>Проверено: {review.checkedAt}</b>
        <span>Следующий пересмотр: {review.nextReview}</span>
      </div>
      <div className="service-review-sources">
        <span>Официальные источники</span>
        {review.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}
      </div>
    </aside>
  );
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
          {props.started ? (props.isPlaying ? 'Идёт заставка' : 'Повторить заставку') : 'Начать курс'}
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
      <b>В конце — итоговый кейс из пяти решений. Проходной результат — 4 из 5.</b>
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
      <p>{viewedAll ? 'Все четыре уровня просмотрены — теперь распределите рабочие ситуации.' : 'Сначала откройте все четыре уровня.'}</p>
      <button className="secondary-action" type="button" disabled={!viewedAll} onClick={props.onOpenQuiz}>Проверить себя</button>
    </div>
    {props.quizOpen && <div className="quiz-modal" role="dialog" aria-modal="true" aria-label="Определите уровень искусственного интеллекта">
      <button className="quiz-backdrop" type="button" onClick={props.onCloseQuiz} aria-label="Закрыть проверку" />
      <section className="quiz-dialog level-quiz-dialog">
        <header><div><p className="question-label">Четыре ситуации</p><h2>Выберите подходящий уровень</h2></div><button type="button" onClick={props.onCloseQuiz} aria-label="Закрыть">×</button></header>
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
              {selected && <small>{correct ? 'Верно' : 'Выберите другой уровень'}</small>}
            </article>;
          })}
        </div>
        {allAnswered && <div className={correctAnswers === props.slide.levelQuiz?.length ? 'result-banner success' : 'result-banner retry'}>{correctAnswers === props.slide.levelQuiz?.length ? 'Отлично: все четыре уровня определены верно.' : `Верных ответов: ${correctAnswers} из ${props.slide.levelQuiz?.length}. Исправьте отмеченные строки.`}</div>}
      </section>
    </div>}
  </div>;
}

function SafetyDataSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  return <div className="content-layout compact-content"><SlideHeading slide={props.slide} />
    <div className="safety-columns"><section><h2>Можно использовать</h2><p>План развития · структура презентации · список вопросов · объяснение термина · черновик без реквизитов · повестка встречи</p></section><section className="danger"><h2>Нельзя вводить в публичный сервис</h2><p>ФИО и контакты · счета и договоры · операции клиентов · кадровые сведения · внутренние документы · пароли и токены</p></section></div>
    <StepProgress instruction="Откройте три ситуации — в каждой свой безопасный способ действия." visited={props.visitedPanels.length} total={props.slide.panels?.length ?? 0} doneText="Все три ситуации открыты." />
    <div className="situation-strip">{props.slide.panels?.map((item, idx) => <button type="button" key={item.title} className={idx === props.activePanel ? 'active' : props.visitedPanels.includes(idx) ? 'visited' : ''} onClick={() => props.onPanel(idx)}>{idx + 1}. {item.title}{props.visitedPanels.includes(idx) && <i aria-label="просмотрено"> ✓</i>}</button>)}</div>
    <article className={`situation-result tone-${panel?.tone ?? 'blue'}`}><b>{panel?.title}</b><p>{panel?.body}</p></article>
    {props.visitedPanels.length >= (props.slide.panels?.length ?? 0)
      ? <section className="panel-conclusion"><b>Во всех трёх случаях менялась только тема</b><p>Рабочая тема — можно. Рабочие данные — нельзя. Правило по данным не зависит от того, насколько задача безобидна.</p></section>
      : <Note text={props.slide.note} />}
  </div>;
}

function CauseWheelSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  const total = props.slide.panels?.length ?? 0;
  const allSeen = props.visitedPanels.length >= total;
  return <div className="content-layout"><SlideHeading slide={props.slide} />
    <StepProgress instruction="Нажмите на четыре причины по очереди — у каждой своё исправление." visited={props.visitedPanels.length} total={total} doneText="Все четыре причины разобраны." />
    <div className="cause-layout"><div className="cause-wheel"><strong>Почему результат<br/>оказался плохим?</strong>{props.slide.panels?.map((item, idx) => <button type="button" key={item.title} className={idx === props.activePanel ? 'active' : props.visitedPanels.includes(idx) ? 'visited' : ''} onClick={() => props.onPanel(idx)}>{idx + 1}. {item.title}{props.visitedPanels.includes(idx) && <i aria-label="просмотрено"> ✓</i>}</button>)}</div>
    {allSeen
      ? <article className="cause-detail cause-order"><p>Порядок разбора</p><h2>Проверяйте причины в этом порядке</h2><ol><li>Задача — названо ли конкретное действие и критерий результата</li><li>Контекст — дан ли материал и убрано ли лишнее</li><li>Инструмент — есть ли доступ и умеет ли он нужное</li><li>Проверка — сверили ли числа и ссылки перед передачей</li></ol><b>Первые две причины дают большинство плохих результатов. Начинайте с них.</b></article>
      : <article className="cause-detail"><p>Причина {props.activePanel + 1}</p><h2>{panel?.title}</h2><span>{panel?.body}</span><b>{panel?.example}</b></article>}</div><Note text={props.slide.note} />
  </div>;
}

function FormulaSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  const ready = props.visitedPanels.length === (props.slide.panels?.length ?? 0);
  return <div className="content-layout"><SlideHeading slide={props.slide} />
    <StepProgress instruction="Откройте четыре части — после четвёртой появится собранный запрос." visited={props.visitedPanels.length} total={props.slide.panels?.length ?? 0} doneText="Четыре части открыты — запрос собран." />
    <div className="formula-tabs">{props.slide.panels?.map((item, idx) => <button type="button" key={item.title} className={`formula-${idx}${idx === props.activePanel ? ' active' : ''}${props.visitedPanels.includes(idx) ? ' visited' : ''}`} onClick={() => props.onPanel(idx)}>{item.title}{props.visitedPanels.includes(idx) && <i aria-label="просмотрено"> ✓</i>}</button>)}</div>
    <article className="formula-detail"><div><p>Часть запроса</p><h2>{panel?.title}</h2><span>{panel?.body}</span></div><blockquote>{panel?.example}</blockquote></article>
    {ready ? <div className="assembled-prompt"><b>Четыре части вместе</b><p>Подготовь справку по указанным данным для руководителя. Формат: таблица и три коротких вывода. Проверь расчёты и не добавляй выводов без данных.</p><small>Это и есть готовый запрос. Где его набирать — разберём в главе про сервисы.</small></div> : <Note text="Откройте все четыре части — после этого появится собранный запрос." />}
  </div>;
}

function ExtendedFormulaSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  const total = props.slide.panels?.length ?? 0;
  const allSeen = props.visitedPanels.length >= total;
  return <div className="content-layout"><SlideHeading slide={props.slide} />
    <StepProgress instruction="Откройте шесть частей: четыре базовые и две надстройки для ответственной задачи." visited={props.visitedPanels.length} total={total} doneText="Все шесть частей открыты." />
    <div className="formula-tabs six">{props.slide.panels?.map((item, idx) => <button type="button" key={item.title} className={`${idx === props.activePanel ? 'active ' : ''}${props.visitedPanels.includes(idx) ? 'visited ' : ''}${idx > 3 ? 'extension' : ''}`} onClick={() => props.onPanel(idx)}>{item.title}{props.visitedPanels.includes(idx) && <i aria-label="просмотрено"> ✓</i>}</button>)}</div>
    <article className="formula-detail extended"><div><p>{props.activePanel < 4 ? 'Базовая формула' : 'Надстройка для ответственной задачи'}</p><h2>{panel?.title}</h2><span>{panel?.body}</span></div>{panel?.example && <blockquote>{panel.example}</blockquote>}</article>
    {allSeen
      ? <div className="assembled-prompt"><b>Шесть частей вместе</b><p>Материал для руководителя, который смотрит на цифры. Подготовь сравнение портфеля за два года по приложенным данным. Формат: таблица и три вывода до 120 слов. Считай проценты от 2024 года. Не делай выводов о причинах и не сравнивай без данных.</p><small>Роль и ограничения нужны там, где цена ошибки высока: документ уходит наверх, наружу или под подпись. Для обычного черновика хватает четырёх частей.</small></div>
      : <Note text={props.slide.note} />}
  </div>;
}

function RussianServicesSlide(props: SlideViewProps) {
  const panel = props.slide.panels?.[props.activePanel];
  return <div className="content-layout"><SlideHeading slide={props.slide} />
    <div className="service-pair">{props.slide.panels?.map((item, idx) => <button type="button" key={item.title} className={idx === props.activePanel ? 'service-card active' : 'service-card'} onClick={() => props.onPanel(idx)}><span>{idx === 0 ? 'G' : 'A'}</span><h2>{item.title}</h2><p>{item.body}</p></button>)}</div>
    <div className="service-example"><b>{panel?.title}</b><p>{panel?.example}</p></div>
    <div className="service-links"><a href="https://giga.chat" target="_blank" rel="noreferrer">Открыть GigaChat</a><a href="https://alice.yandex.ru" target="_blank" rel="noreferrer">Открыть Алису</a></div>
    <ServiceReview slide={props.slide} />
    <Note text={props.slide.note} />
  </div>;
}

function GlobalServicesSlide(props: SlideViewProps) {
  return <div className="content-layout"><SlideHeading slide={props.slide} />
    <div className="service-trio">{props.slide.panels?.map((item) => { const [name,focus] = item.title.split(' · '); return <article key={item.title} className="global-service"><small>{focus}</small><h2>{name}</h2><p>{item.body}</p><b>{item.example}</b></article>; })}</div>
    <ServiceReview slide={props.slide} />
    <Note text={props.slide.note} />
  </div>;
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
        <figcaption>фИИн — единый внутренний интерфейс. Запрос и вложения проходят проверку до отправки во внешнюю модель.</figcaption>
      </figure>
      <div className="gateway-side">
        <StepProgress instruction="Откройте три группы." visited={props.visitedPanels.length} total={props.slide.panels?.length ?? 0} doneText="Все три группы открыты." />
        <div className="gateway-groups">{props.slide.panels?.map((item,idx)=>(
          <button type="button" key={item.title} className={idx===props.activePanel?'active':props.visitedPanels.includes(idx)?'visited':''} onClick={()=>props.onPanel(idx)}>{item.title}{props.visitedPanels.includes(idx)&&<i aria-label="просмотрено"> ✓</i>}</button>
        ))}</div>
        <article className="gateway-detail"><ul>{panel?.bullets?.map(item=><li key={item}>{item}</li>)}</ul></article>
        <p className="gateway-carry">{props.visitedPanels.length>=(props.slide.panels?.length??0)
          ? 'Все три группы про одно: канал меняется, правила — нет. Формула запроса и четыре проверки работают одинаково в любом инструменте. Навык, полученный сегодня, переносится без переучивания.'
          : 'Формула запроса и правила проверки работают одинаково в любом инструменте. Навык, полученный сегодня, переносится без переучивания.'}</p>
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
    ['Готового ответа не существует — он составляется на ходу', 'Модель предсказывает следующее слово по образцам из прочитанных текстов. Примерно как подсказка на клавиатуре телефона, только в несопоставимо большем масштабе.'],
    ['Когда данных не хватает, ответ всё равно будет', 'Она обучена быть полезной — и предпочтёт правдоподобный ответ признанию «не знаю». Проще уверенно ошибиться, чем сказать «не в курсе».'],
    ['Тон при этом не меняется', 'Та же уверенность, та же структура, те же формулировки. Верный ответ и домысел выглядят одинаково.'],
    ['Значит, отличить может только тот, кто знает предмет', 'Не по тону и не по оформлению. Только по существу.'],
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
        <h2>{toneAnswer === null ? 'Видно ли по тексту, какой ответ верный?' : 'Тогда выберите тот, который считаете верным'}</h2>
        <p className="quiz-context">Сотрудник спросил, за сколько дней нужно подать заявление на отпуск вне графика. В четырёх диалогах пришли четыре ответа.</p>
        <div className="choice-list compact">{props.slide.choices?.map((item,idx)=>{const state=props.chosen===idx?(item.correct?'correct':'wrong'):'';return <button key={item.label} type="button" className={`choice confidence-choice ${state}`} disabled={toneAnswer===null} onClick={()=>props.onChoose(idx)}><span>{String.fromCharCode(65+idx)}</span>{item.label}</button>})}</div>
        {toneAnswer === null && <div className="tone-question">
          <p>Прочитайте четыре ответа. Можно ли понять по формулировке, тону или уровню детализации, который из них верный?</p>
          <div className="tone-options">
            <button className="secondary-action" type="button" onClick={()=>setToneAnswer('yes')}>Да, разница заметна</button>
            <button className="secondary-action" type="button" onClick={()=>setToneAnswer('no')}>Нет, они одинаково уверенные</button>
          </div>
        </div>}
        {toneAnswer !== null && !choice && <div className="tone-verdict">
          <b>{toneAnswer === 'no' ? 'Так и есть — по тексту отличить нельзя.' : 'Разница есть, но она не про правду.'}</b>
          <p>{toneAnswer === 'no'
            ? 'Все четыре написаны одинаково уверенно. Но выбрать всё равно придётся: попробуйте.'
            : 'Один из ответов конкретнее остальных — и именно поэтому убедительнее. Конкретность не делает ответ верным. Попробуйте выбрать.'}</p>
        </div>}
        {choice && <div className={choice.correct?'confidence-feedback ok':'confidence-feedback'}>
          <div className="source-quote"><b>Правила внутреннего трудового распорядка, п. 5.4</b><p>«Заявление о предоставлении отпуска вне утверждённого графика подаётся не позднее чем за три рабочих дня до его начала.»</p></div>
          <b>{choice.feedback}</b>
          <p><strong>Проверить ответ по нему самому было невозможно.</strong> Пока не появился документ, это были четыре одинаково убедительных текста — и один шанс из четырёх. Подтвердить можно только внешней проверкой.</p>
          <button className="secondary-action quiz-done" type="button" onClick={props.onCloseQuiz}>Вернуться к материалу</button>
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
      {choice && <button className="secondary-action quiz-done" type="button" onClick={props.onCloseQuiz}>Вернуться к материалу</button>}
    </section>
  </div>;
}

// Вердикт между нажатием «Проверить» и разбором: три состояния по двум числам —
// сколько верных отмечено и сколько отмечено лишних.
function Verdict({ correct, selected, labels, reasons, successText, reviewLabel, extraLead = 'отмечать не нужно', onRetry, onReview }: {
  correct: number[];
  selected: number[];
  labels: string[];
  reasons: string[];
  successText: string;
  reviewLabel: string;
  extraLead?: string;
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
      ? `Не всё. Отмечено ${correct.length - missed.length} из ${correct.length}`
      : 'Почти';
  return (
    <section className={`verdict verdict-${state}`} role="status">
      <b>{title}</b>
      {state === 'exact' && <p>{successText}</p>}
      {extra.map((item) => <p key={item}>Фрагмент {item + 1} {extraLead} — {reasons[item]}</p>)}
      {state === 'partial' && <p>Пропущено: {missed.map((item) => `фрагмент ${item + 1} — ${firstWords(labels[item])}`).join('; ')}</p>}
      {state === 'almost' && missed.length > 0 && <p>Пропущено: {missed.map((item) => `фрагмент ${item + 1}`).join(', ')}</p>}
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

const boundaryKinds = ['Подготовка', 'Окончательное действие'];

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
    ['Отправить этот ответ клиенту от имени банка', 'Окончательное действие'],
    ['Проверить заявку по заданным критериям и выделить риски', 'Подготовка'],
    ['На основании этой проверки одобрить или отклонить заявку', 'Окончательное действие'],
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
      <p className="bridge-line">Допустим, источник есть и факты вы сверили. Значит ли это, что результат можно пускать в дело?</p>
      <SlideHeading slide={props.slide} />
      <div className="pair-legend"><b><i className="dot can" />Можно поручить подготовку</b><b><i className="dot cannot" />Нельзя передавать окончательно</b></div>
      <div className="pair-cards">{pairs.map((pair)=><article key={pair[0]}><p className="can">{pair[0]}</p><i aria-hidden="true">↓</i><p className="cannot">{pair[1]}</p></article>)}</div>
      <p className="autonomy-rule"><span aria-hidden="true">!</span><b>Чем дороже ошибка, тем меньше самостоятельности у модели.</b></p>
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
    return <div className="content-layout boundary-stack paired-question">
      <div className="boundary-body">
        <div className="slide-heading"><p className="eyebrow">Проверьте себя</p><h1>Подготовка или окончательное действие?</h1><p className="slide-intro">Четыре задачи, две пары. Тема внутри пары одна — меняется только окончательность. Выберите ответ для каждой задачи.</p></div>
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
        {checked && <p className={exact?'ok':'retry'}>Верно: 1 и 3 — подготовка, 2 и 4 — окончательное действие.</p>}
        <button className="primary-action" type="button" disabled={!ready} onClick={()=>checked?setPhase(2):setChecked(true)}>{checked?'Перейти к разбору':'Проверить'}</button>
      </div>
    </div>;
  }

  if (phase === 2) return <div className="content-layout boundary-stack boundary-review">
    <div className="boundary-body">
      <div className="slide-heading"><p className="eyebrow">Разбор</p><h1>Почему именно так</h1></div>
      <div className="boundary-review-pairs">
        <article><div><b>Черновик ответа</b><p>ИИ помогает подготовить материал, дальше вы его проверяете и правите. Ничего необратимого пока не произошло.</p></div><PairArc /><div><b>Отправка клиенту</b><p>Действие уже создаёт последствия для банка и клиента. Отозвать отправленное письмо нельзя.</p></div></article>
        <article><div><b>Проверка заявки</b><p>ИИ может собрать информацию, сопоставить с критериями и показать, на что посмотреть.</p></div><PairArc /><div><b>Решение по заявке</b><p>Окончательное решение остаётся за уполномоченным человеком. Обосновывать его тоже придётся вам.</p></div></article>
      </div>
    </div>
    <div className="boundary-foot"><button className="primary-action" type="button" onClick={()=>setPhase(3)}>Дальше</button></div>
  </div>;

  return <div className="content-layout boundary-stack boundary-accent">
    <div className="boundary-body accent-body">
      <div className="accent-group">
        <section className="responsibility-accent"><b>ИИ может подготовить</b><strong>Человек решает, утверждает и отвечает за действие</strong></section>
        <div className="signature-line"><span /><small>подпись</small></div>
      </div>
    </div>
    <div className="boundary-foot">
      <p className="review-rule">Проверочный вопрос: после этого шага что-то станет необратимым? Если да — шаг ваш.</p>
      <button className="primary-action" type="button" onClick={props.onNext}>Дальше</button>
    </div>
  </div>;
}

function BankUseSlide(props: SlideViewProps) {
  const choice = props.chosen === null ? null : props.slide.choices?.[props.chosen];
  return <div className="content-layout"><SlideHeading slide={props.slide}/><div className="bank-use-layout"><section className="question-card"><p className="question-label">Выберите один вариант</p><div className="choice-list">{props.slide.choices?.map((item,idx)=>{const state=props.chosen===idx?(item.correct?'correct':'wrong'):'';return <button type="button" key={item.label} className={`choice ${state}`} onClick={()=>props.onChoose(idx)}><span>{idx+1}</span>{item.label}</button>})}</div>{choice&&<div className={choice.correct?'feedback correct':'feedback wrong'}>{choice.feedback}</div>}</section><div className="portrait-frame"><img src={asset('/media/avatar.png')} alt="Ведущий курса"/><span className="portrait-label">Три запрета здесь — про данные и окончательное действие.</span></div></div></div>;
}

function PromptCompareSlide(props: SlideViewProps) {
  return <div className="content-layout"><SlideHeading slide={props.slide}/><div className="prompt-compare"><article><b>Запрос А</b><code>Напиши справку по этим данным: открыто вкладов 1240 и 1418, с автопролонгацией 812 и 967, закрыто досрочно 428 и 451.</code></article><article className="better"><b>Запрос Б</b><code><mark>Подготовь справку</mark> об изменении портфеля вкладов. <em>Формат: таблица и три коротких вывода.</em> <u>Считай проценты от 2024 года. Не делай выводов о причинах.</u></code></article></div><div className="lesson-bottom"><Note text="Не «чем длиннее», а «чем точнее»: задача, форма результата и границы экономят круги уточнений."/><button className="primary-action" type="button" onClick={props.onOpenQuiz}>Проверить себя</button></div>{props.quizOpen&&<QuestionPopup props={props}/>}</div>;
}

function ModelContextSlide(props: SlideViewProps) {
  return <div className="content-layout"><SlideHeading slide={props.slide}/><div className="knowledge-columns"><section><h2>Может использовать</h2><p>Обучение · текущий запрос · приложенные файлы · сообщения диалога · поиск · память, если включена</p></section><section><h2>Не знает</h2><p>Внутренние документы · текущие показатели · договорённости коллег · ваш процесс и риск-политику · невысказанный смысл</p></section></div><div className="memory-callout"><b>Память работает в обе стороны</b><p>В публичном сервисе не оставляйте в истории того, чего там быть не должно. В корпоративном канале правила определяет банк.</p><button className="primary-action" onClick={props.onOpenQuiz} type="button">Проверить себя</button></div>{props.quizOpen&&<QuestionPopup props={props}/>}</div>;
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
    ['Колонки с досрочно закрытыми вкладами в ответе нет.', 'Часть запроса не выполнена: третья колонка была в задаче, но в ответ не попала.'],
    ['Рост показателей говорит об улучшении работы с вкладчиками.', 'Вывод, которого нет в данных: модель добавила интерпретацию от себя.'],
  ];
  const correctMarks = [2, 3];
  const options = [
    ['Перепиши всё заново, только лучше', 'Модель не знает, что именно «лучше». Ответ изменится случайным образом, а вы потратите ещё круг.'],
    ['Добавь колонку по досрочно закрытым вкладам и убери вывод об улучшении работы — его нет в данных', 'Верно. Обе правки в одном сообщении, каждая названа конкретно, контекст диалога сохраняется.'],
    ['Убери лишнее', 'Модель не знает, что здесь лишнее. Такое уточнение почти всегда приводит к третьему и четвёртому кругу.'],
  ];
  const exact = marks.length === 2 && correctMarks.every((item) => marks.includes(item));

  if (phase === 0) return <div className="content-layout compact-content refinement-slide">
    <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Шаг 1 из 2 · Соберите замечания</p><h1>Сначала прочитайте ответ целиком</h1><p className="slide-intro">Вы просили таблицу по трём показателям за два года и три вывода строго по данным. Отметьте в ответе <strong>оба</strong> места, которые нужно исправить.</p></div>
    <section className="answer-review">
      <header><b>Ответ модели</b><span>по вашему запросу</span></header>
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
      {checked && <p className={exact ? 'ok' : 'retry'}>{exact ? 'Верно: пропущенная колонка и добавленный вывод. Это два замечания к одному ответу.' : 'Отмечены не те места. Правильные подписаны: пропущенная колонка и вывод, которого нет в данных.'}</p>}
      <button className="primary-action" type="button" disabled={!marks.length} onClick={() => checked ? setPhase(1) : setChecked(true)}>{checked ? 'Дальше: отправить уточнение' : 'Проверить'}</button>
    </div>
  </div>;

  if (phase === 1) return <div className="content-layout compact-content refinement-slide">
    <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Шаг 2 из 2 · Одно уточнение</p><h1>Отправьте обе правки одним сообщением</h1><p className="slide-intro">Замечаний два. Выберите уточнение, которое закрывает оба.</p></div>
    <div className="refinement-options">{options.map((item, idx) => {
      const state = option === idx ? (idx === 1 ? 'correct' : 'wrong') : '';
      return <button type="button" key={item[0]} className={`refinement-option ${state}`} onClick={() => setOption(idx)}><span>{String.fromCharCode(65 + idx)}</span><p>{item[0]}</p>{option === idx && <small>{item[1]}</small>}</button>;
    })}</div>
    {option === 1 && <div className="refinement-foot"><button className="primary-action" type="button" onClick={() => setPhase(2)}>Что изменилось в ответе</button></div>}
  </div>;

  return <div className="content-layout compact-content refinement-slide">
    <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Результат</p><h1>Что изменилось после уточнения</h1></div>
    <div className="refinement-compare">
      <section><b>До уточнения</b><p>Две колонки вместо трёх. В конце — вывод об улучшении работы с вкладчиками, которого в данных нет.</p></section>
      <section className="good"><b>После одного уточнения</b><p>Три колонки, как и просили. Выводы только те, что следуют из чисел. Исходные данные заново передавать не пришлось — они остались в диалоге.</p></section>
    </div>
    <section className="refinement-rule">
      <b>Правило</b>
      <p>Дочитайте ответ до конца, соберите все замечания и отправьте их одним сообщением. Два отдельных уточнения дадут тот же результат, но модель обработает диалог дважды. Стереть и начать заново — потерять весь переданный контекст.</p>
      <span>Если после двух-трёх уточнений результат не приближается — вернитесь к формулировке задачи.</span>
    </section>
  </div>;
}

function ServiceCriteriaSlide(props: SlideViewProps) {
  // Экран несёт одну мысль: сначала допуск, потом качество. Три ступени
  // раскрываются по очереди — на экране всегда один блок текста, а не стена.
  const [step, setStep] = useState(0);
  const steps = [
    {
      tag: 'Ступень 1 · отсекает большинство',
      question: 'Разрешён ли сервис банком?',
      lead: 'Работает ли он официально и утверждён ли для рабочих задач.',
      no: 'Нет — задача идёт в утверждённый канал. Дальше вопросов нет.',
      width: '100%',
    },
    {
      tag: 'Ступень 2 · отсекает по данным',
      question: 'Можно ли передать ему данные этой задачи?',
      lead: 'Тот же сервис для одной задачи допустим, для другой — нет. Решает материал, а не сервис.',
      no: 'Нет — обезличить материал, взять внутренний канал или отказаться.',
      width: '80%',
    },
    {
      tag: 'Ступень 3 · выбор из оставшихся',
      question: 'Справится ли он именно с этой задачей?',
      lead: 'Здесь и пригодятся признаки — но только к тем сервисам, что прошли две первые ступени.',
      no: 'Большой документ — смотрите объём. Голос и картинки — форматы. Расчёты и многошаговость — поведение на сложной задаче.',
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
        <p className="gate-scale"><b>Десятки сервисов</b> сверху — <b>единицы</b> внизу</p>
      </div>
      <article className="gate-detail" aria-live="polite">
        <p className="gate-tag">{active.tag}</p>
        <h2>{active.question}</h2>
        <p className="gate-lead">{active.lead}</p>
        <div className="gate-no"><b>{step === 2 ? 'Как выбирать' : 'Если нет'}</b><p>{active.no}</p></div>
      </article>
    </div>
    <p className="gate-rule">Две первые ступени — про допуск, третья — про задачу. Рейтинг и реклама не отвечают ни на одну из них.</p>
  </div>;
}

function ChineseServicesSlide(props: SlideViewProps) {
  const rows=[['DeepSeek','Логика, технические задачи и код','Рассуждение и код'],['Qwen','Текст, изображения, аудио и видео','Мультимодальность'],['Kimi','Исследование, таблица, документ или презентация','Офисные материалы'],['GLM','Большой материал и длинная многошаговая задача','Глубокий анализ']];
  return <div className="content-layout"><SlideHeading slide={props.slide}/><div className="service-table"><header><b>Сервис</b><b>Выбирают, когда нужно</b><b>Сильный фокус</b></header>{rows.map(row=><div key={row[0]}><b>{row[0]}</b><span>{row[1]}</span><span>{row[2]}</span></div>)}</div><ServiceReview slide={props.slide}/><div className="lesson-bottom"><Note text={props.slide.note}/><button className="primary-action" type="button" onClick={props.onOpenQuiz}>Проверить себя</button></div>{props.quizOpen&&<QuestionPopup props={props}/>}</div>;
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
  // число и ссылка попадут в документ как доказательство, общее описание — нет.
  const reviews = [
    ['Не использовать как подтверждённый факт', 'Общее утверждение о порядке. Проверить нужно и его, но оно не станет в вашем документе ни цифрой, ни ссылкой.', 'warn'],
    ['Проверить в первую очередь', 'Конкретное число. Модель могла взять его из общей практики, а не из вашего документа.', 'danger'],
    ['Проверить в первую очередь', 'Ссылка на конкретный пункт. Самое опасное место: выглядит как доказательство, но существование пункта нужно подтвердить.', 'danger'],
    ['Не использовать как подтверждённый факт', 'Общее описание процедуры. Как ориентир годится, ссылаться на него в работе нельзя.', 'warn'],
  ];
  if (phase === 2) return <div className="content-layout compact-content hallucination-review"><div className="slide-heading"><p className="eyebrow">Разбор по фрагментам</p><h1>Проверять нужно не всё подряд</h1></div><div className="review-fragments">{props.slide.choices?.map((item,idx)=><article className={props.selected.includes(idx)?`${reviews[idx][2]} marked`:reviews[idx][2]} key={item.label}><span>{idx+1}</span><div><p>{item.label}</p>{props.selected.includes(idx)&&<em className="you-marked">вы отметили</em>}<b>{reviews[idx][0]}.</b><small>{reviews[idx][1]}</small></div></article>)}</div><div className="review-bottom"><p><b>Ни один из четырёх фрагментов не является подтверждённым фактом.</b> Разница в срочности: число и ссылка вызывают доверие именно своей конкретностью и уходят в документ как доказательство — с них и начинайте.</p><button className="primary-action" type="button" onClick={()=>setPhase(3)}>Дальше</button></div></div>;
  if (phase === 3) return <div className="content-layout compact-content hallucination-term"><div className="slide-heading"><p className="eyebrow">Термин</p><h1>У этого есть название</h1></div><section className="term-accent"><b>Галлюцинация</b><p>Модель заполняет пробел правдоподобным текстом вместо того, чтобы сказать «не знаю».</p></section><div className="term-copy"><p>Это не обман и не сбой. Модель составляет ответ, а не достаёт готовый. Когда нужного факта нет, она достраивает то, что чаще всего встречается в похожих текстах. Так и появляется убедительный «пункт 3.5».</p><p>Термин вам встретится в статьях и интерфейсах сервисов. Он также используется в методических рекомендациях Банка России.</p></div><div className="term-bottom"><p>Чем конкретнее деталь, тем выше цена ошибки — и тем быстрее её нужно проверить.</p><button className="primary-action" type="button" onClick={props.onNext}>Дальше</button></div></div>;
  const labels = props.slide.choices?.map((item)=>item.label) ?? [];
  const notNeeded = [
    'проверить нужно и его, но это общее утверждение о порядке: оно не станет в документе ни цифрой, ни ссылкой',
    '',
    '',
    'проверить нужно и его, но это общее описание процедуры, а не доказательство',
  ];
  return <div className="content-layout compact-content hallucination-task"><SlideHeading slide={props.slide}/><section className="assistant-answer-card"><header><b>Вопрос сотрудника</b><p>В какой срок согласовывается договор с новым контрагентом?</p></header><div className="answer-fragments">{props.slide.choices?.map((item,idx)=>{const selected=props.selected.includes(idx);return <button type="button" key={item.label} disabled={phase===1} className={selected?'selected':''} onClick={()=>props.onToggleMulti(idx)}><span>{idx+1}</span><p>{item.label}</p>{phase===1&&selected&&<em className="you-marked">вы отметили</em>}</button>})}</div>{phase===1
    ? <Verdict correct={props.slide.correctIndexes ?? []} selected={props.selected} labels={labels} reasons={notNeeded} extraLead="проверяется во вторую очередь" successText="Вы выделили именно то, что выглядит доказательством: конкретное число и ссылку на пункт." reviewLabel="Смотреть разбор" onRetry={()=>{props.onResetMulti();setPhase(0);}} onReview={()=>{props.onCheckMulti();setPhase(2);}} />
    : <footer><span><b>Задание:</b> отметьте фрагменты, которые нужно проверить <strong>в первую очередь</strong>. Их может быть несколько.</span><button type="button" disabled={!props.selected.length} onClick={()=>setPhase(1)}>Проверить</button></footer>}</section></div>;
}

function FourChecksSlide(props: SlideViewProps) {
  // Порядок экрана: сначала понятное задание, потом вердикт, потом разбор
  // и только в конце — четыре проверки как памятка. Раньше принципы стояли
  // слева от задания и читались как ребус.
  const [phase,setPhase]=useState<0|1|2>(0);
  const exact = props.selected.length===2&&props.selected.includes(2)&&props.selected.includes(3);
  const checks=[['Источник','Откуда взят важный факт?'],['Числа','База, период и единицы'],['Полнота','Выполнены ли все части запроса?'],['Смысл','Чего модель не могла знать?']];
  const labels=props.slide.choices?.map(item=>item.label)??[];
  const notNeeded=['расчёт верен: 1418 к 1240 — это ровно 14,4%','это корректный расчёт по предоставленным данным','',''];
  return <div className="content-layout compact-content checks-slide">
    <SlideHeading slide={props.slide}/>
    <section className="report-card">
      <header className="report-head">
        <b>Справка о динамике портфеля вкладов</b>
        <span>Модель составила её по вашим данным за 2024 и 2025 годы</span>
      </header>
      <p className="report-task">Все четыре строки звучат одинаково уверенно. <strong>Отметьте те, которых нет в данных</strong> — модель добавила их от себя.</p>
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
        ? <Verdict correct={props.slide.correctIndexes ?? []} selected={props.selected} labels={labels} reasons={notNeeded} successText="Вы отделили расчёт от интерпретации." reviewLabel="Смотреть разбор" onRetry={()=>{props.onResetMulti();setPhase(0);}} onReview={()=>{props.onCheckMulti();setPhase(2);}} />
        : <footer>{!props.checkedMulti
            ? <button type="button" disabled={!props.selected.length} onClick={()=>setPhase(1)}>Проверить</button>
            : <b>{exact?'Верно: числа посчитаны, выводы додуманы.':'Смысловая проверка важнее уверенного тона.'}</b>}</footer>}
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
    {title:'Где дополнительный источник не нужен?',intro:'Отметьте все подходящие задачи. Их несколько.',items:['Вот черновик письма клиенту — перепиши короче и мягче','Вот протокол встречи — выпиши поручения и указанные в нём сроки','Напиши клиенту письмо с нашими действующими ставками по вкладам','Предложи три варианта заголовка для внутренней рассылки'],correct:[0,1,3],reasons:['','','ставок в запросе нет, модель добавит их от себя — нужен источник','']},
    {title:'А где нужен проверяемый источник?',intro:'Отметьте все подходящие задачи. Их несколько.',items:['За сколько дней банк обязан ответить на обращение клиента','Измени тон этого письма на более официальный','Что изменилось в правилах работы с обращениями за последний месяц','Какие документы нужны юридическому лицу для открытия счёта в нашем банке'],correct:[0,2,3],reasons:['','изменение тона новых фактов не добавляет','','']},
  ];
  if (phase === 0) return <div className="content-layout compact-content source-explain"><SlideHeading slide={props.slide}/>
    <div className="source-duo">
      <section className="source-card safe"><h2>Источник уже есть</h2><strong>ИИ обрабатывает то, что вы дали</strong><ul>{noSource.map(item=><li key={item}>{item}</li>)}</ul><footer>→ результат можно сверить</footer></section>
      <section className="source-card risk"><h2>Нужен источник</h2><strong>ИИ должен добавить факты</strong><ul>{needsSource.map(item=><li key={item}>{item}</li>)}</ul><footer>→ факт нужно проверить</footer></section>
    </div>
    <div className="source-bottom"><p>Есть источник — сверяйте с ним. Нет источника — не принимайте факт на веру.</p><button className="primary-action" type="button" onClick={()=>setPhase(1)}>Проверить себя</button></div>
  </div>;
  if (phase === 1 || phase === 2) {
    const idx = phase - 1;
    const question = questions[idx];
    const selected = idx === 0 ? first : second;
    const setSelected = idx === 0 ? setFirst : setSecond;
    const isChecked = checked[idx];
    return <div className="content-layout compact-content source-question"><div className="slide-heading"><p className="eyebrow">Проверьте себя</p><h1>{question.title}</h1><p className="slide-intro">{question.intro}</p></div><div className="source-options">{question.items.map((item,itemIdx)=>{const chosen=selected.includes(itemIdx);const state=isChecked?(question.correct.includes(itemIdx)?'correct':chosen?'wrong':''):chosen?'selected':'';return <button type="button" key={item} disabled={isChecked} className={state} onClick={()=>setSelected(values=>values.includes(itemIdx)?values.filter(value=>value!==itemIdx):[...values,itemIdx])}><span>{chosen?'✓':''}</span><p>{item}</p>{isChecked&&chosen&&<em className="you-marked">вы отметили</em>}</button>})}</div>{isChecked
      ? <Verdict correct={question.correct} selected={selected} labels={question.items} reasons={question.reasons} successText="Вы отделили работу с данным материалом от новых фактов." reviewLabel={phase===1?'Следующий вопрос':'Смотреть разбор'} onRetry={()=>{setSelected([]);setChecked(value=>({...value,[idx]:false}));}} onReview={()=>setPhase(phase===1?2:3)} />
      : <div className="question-actions"><button className="primary-action" type="button" disabled={!selected.length} onClick={()=>setChecked(value=>({...value,[idx]:true}))}>Проверить</button></div>}</div>;
  }
  return <div className="content-layout compact-content source-review">
    <div className="slide-heading"><h1>Почему именно так</h1></div>
    <div className="source-review-layout">
      <figure className="rates-overview"><div><img src={asset('/media/slide-06-invented-rates.png')} alt="Два полных ответа ИИ на один запрос с разными ставками"/></div><figcaption>Один запрос — разные цифры</figcaption></figure>
      <section className="review-summary">
        <div className="summary-group safe"><h2>Источник уже был</h2><p><span>✓</span><b>Черновик письма</b> — материал дан</p><p><span>✓</span><b>Поручения</b> — протокол приложен</p><p><span>✓</span><b>Заголовки</b> — это варианты</p><strong>✕ Ставок в запросе нет → нужен источник</strong></div>
        <div className="summary-group risk"><h2>Факт нужно подтвердить</h2><p><b>Срок ответа</b> → действующая норма</p><p><b>Изменения</b> → актуальный источник</p><p><b>Документы «у нас»</b> → внутренние правила</p><strong>✓ Изменение тона новых фактов не добавляет</strong></div>
        <div className="source-question-accent"><b>Чем я подтвержу этот факт?</b><p>Ответ <strong>«так написал ИИ»</strong> означает: нужен источник.</p></div>
      </section>
    </div>
    <div className="source-review-footer"><p>Поиск и ссылки снижают риск, но не отменяют проверку.</p><button className="primary-action" type="button" onClick={props.onNext}>Дальше</button></div>
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
    else setWrong(card.wrongFeedback ?? 'Не эта зона. Перечитайте материал: что именно в нём может раскрыться при загрузке?');
  };
  return <div className="content-layout compact-content zones-slide">
    <SlideHeading slide={props.slide}/>
    <div className="traffic-zones wide"><span className="green">Зелёная<br/><small>можно в разрешённом сервисе</small></span><span className="yellow">Жёлтая<br/><small>уточнить до загрузки</small></span><span className="red">Красная<br/><small>нельзя</small></span></div>
    {!done ? <section className="zone-practice">
      <header><p>Материал {position + 1} из {cards.length}</p><div className="zone-progress"><span style={{ width: `${(position / cards.length) * 100}%` }} /></div></header>
      <h2>{card.text}</h2>
      <p className="zone-instruction">Выберите зону этого материала.</p>
      <div className="zone-choices">{props.slide.categories?.map((category) => (
        <button type="button" key={category} disabled={Boolean(solved)}
          className={`zone-choice zone-${zoneOf(category)}${solved && card.category === category ? ' picked' : ''}`}
          onClick={() => assign(category)}>{category.split(' ')[0]}</button>
      ))}</div>
      {solved
        ? <div className="zone-feedback correct"><b>Верно</b><p>{solved}</p><button className="primary-action" type="button" onClick={() => { setPosition((value) => value + 1); setSolved(''); setWrong(''); }}>{position === cards.length - 1 ? 'Завершить' : 'Следующий материал'}</button></div>
        : wrong && <div className="zone-feedback wrong"><p>{wrong}</p></div>}
    </section>
    : <section className="zone-complete"><b>{cards.length}/{cards.length}</b><h2>Все материалы разобраны</h2><p>Зелёный материал можно использовать только в разрешённом сервисе. Незнакомый материал по умолчанию жёлтый: до уточнения он не загружается никуда.</p></section>}
    <Note text={props.slide.note}/>
  </div>;
}

function PromptBuilderSlide(props: SlideViewProps) {
  // Действие совпадает с результатом: строка кладётся кликом прямо в ту зону,
  // куда она должна попасть. Отдельного ряда кнопок-категорий нет.
  const cards = props.slide.cards ?? [];
  const zones = ['Задача', 'Контекст', 'Формат', 'Проверка'];
  const excluded = 'Исключить: недопустимые данные';
  const { onComplete } = props;
  const [position, setPosition] = useState(0);
  const [filled, setFilled] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const card = cards[position];
  const done = position >= cards.length;
  useEffect(() => { if (done) onComplete(); }, [done, onComplete]);
  const correct = Boolean(picked && card && picked === card.category);
  const assign = (category: string) => { if (!correct && card) setPicked(category); };
  const advance = () => {
    if (!card) return;
    if (card.category !== excluded) setFilled((value) => ({ ...value, [card.category]: card.text }));
    setPicked(null);
    setPosition((value) => value + 1);
  };
  const assembled = zones.map((zone) => filled[zone]).filter(Boolean).join('. ');
  return <div className="content-layout compact-content builder-slide">
    <SlideHeading slide={props.slide}/>
    <div className="builder-zones">{zones.map((zone) => {
      const state = filled[zone] ? 'filled' : picked === zone ? (correct ? 'correct' : 'wrong') : '';
      return <button type="button" key={zone} className={`builder-zone ${state}`} disabled={done || Boolean(filled[zone]) || correct} onClick={() => assign(zone)}>
        <b>{zone}</b>
        <p>{filled[zone] || (done ? '—' : 'нажмите, если строка сюда')}</p>
      </button>;
    })}</div>
    {!done ? <section className="builder-current">
      <header><p>Строка {position + 1} из {cards.length}</p><div className="zone-progress"><span style={{ width: `${(position / cards.length) * 100}%` }} /></div></header>
      <h2>{card.text}</h2>
      {picked && (correct
        ? <div className="builder-feedback correct"><b>Верно</b><p>{card.feedback}</p><button className="primary-action" type="button" onClick={advance}>{position === cards.length - 1 ? 'Показать собранный запрос' : 'Следующая строка'}</button></div>
        : <div className="builder-feedback wrong"><b>Не эта часть</b><p>Это не «{picked.toLowerCase()}». Перечитайте строку: что она задаёт — действие, исходный материал, форму результата или границу? Нажмите другую зону.</p></div>)}
      {!correct && <div className="builder-exclude">
        <p>Если строку вообще нельзя отправлять во внешний сервис:</p>
        <button className="secondary-action" type="button" onClick={() => assign(excluded)}>Исключить: недопустимые данные</button>
      </div>}
    </section>
    : <section className="builder-result">
      <b>Безопасный запрос собран</b>
      <p>{assembled}.</p>
      <small>Пятая строка в запрос не вошла: выгрузка с ФИО и суммами не передаётся во внешний сервис ни в каком виде. Отсекается она не по стилю, а по допустимости данных.</small>
    </section>}
    <Note text={props.slide.note}/>
  </div>;
}

function PracticeSlide(props: SlideViewProps) {
  // Внешнее действие должно замкнуться: отправили → вернулись → уточнили →
  // сравнили → получили вывод. Без явного возврата практика обрывается на ссылке.
  const { onComplete } = props;
  const [phase, setPhase] = useState<0 | 1 | 2>(0);
  const [change, setChange] = useState('');
  const [extra, setExtra] = useState('');
  useEffect(() => { if (phase === 2) onComplete(); }, [phase, onComplete]);

  const warning = (
    <p className="practice-warning"><span aria-hidden="true">!</span>Открывайте сервис только если он разрешён вашим банком для этой задачи. Ссылка на сервис не является разрешением. Если разрешённого доступа нет — выполните тот же шаг в утверждённом канале.</p>
  );
  const links = (
    <div className="practice-links"><a href="https://giga.chat" target="_blank" rel="noreferrer">Открыть GigaChat</a><a href="https://alice.yandex.ru" target="_blank" rel="noreferrer">Открыть Алису</a></div>
  );

  if (phase === 0) return (
    <div className="content-layout practice-slide compact-content">
      <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Практика · шаг 1 из 2</p><h1>Отправьте первый запрос</h1><p className="slide-intro">Задача учебная: без персональных данных, сведений банка и рабочих файлов.</p></div>
      {warning}
      <div className="practice-grid">
        <ol className="practice-steps">
          <li><span>1</span><p>Откройте разрешённый сервис</p></li>
          <li><span>2</span><p>Скопируйте запрос и отправьте его</p></li>
          <li><span>3</span><p>Прочитайте ответ целиком</p></li>
        </ol>
        <section className="prompt-stack compact-prompts single">
          <article className="prompt-card"><p>Первый запрос</p><pre>{props.slide.prompt}</pre><button type="button" onClick={() => props.onCopy(props.slide.prompt ?? '', 'Запрос скопирован')}>Скопировать запрос</button></article>
          {props.copyState && <div className="copy-status">{props.copyState}</div>}
        </section>
      </div>
      <div className="practice-return">
        {links}
        <p><b>После того как получите ответ — вернитесь в курс.</b> Уточнение и разбор ждут здесь.</p>
        <button className="primary-action" type="button" onClick={() => setPhase(1)}>Я получил ответ — вернуться</button>
      </div>
    </div>
  );

  if (phase === 1) return (
    <div className="content-layout practice-slide compact-content">
      <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Практика · шаг 2 из 2</p><h1>Уточните и сравните два ответа</h1><p className="slide-intro">Отправьте уточнение вторым сообщением в том же диалоге — контекст сохранится.</p></div>
      <div className="practice-grid reflect">
        <section className="prompt-stack compact-prompts single">
          <article className="prompt-card accent"><p>Уточнение</p><pre>{props.slide.promptB}</pre><button type="button" onClick={() => props.onCopy(props.slide.promptB ?? '', 'Уточнение скопировано')}>Скопировать уточнение</button></article>
          {props.copyState && <div className="copy-status">{props.copyState}</div>}
        </section>
        <div className="practice-reflection">
          <p className="reflection-label">Сравните первый и второй ответ. Оба вопроса обязательны.</p>
          <label>Что изменилось после уточнения?
            <select value={change} onChange={(event) => setChange(event.target.value)}>
              <option value="">Выберите</option>
              <option value="better">Стало конкретнее и короче</option>
              <option value="worse">Стало короче, но потерялось нужное</option>
              <option value="same">Не изменилось</option>
            </select>
          </label>
          <label>Остались ли утверждения, которые нельзя проверить?
            <select value={extra} onChange={(event) => setExtra(event.target.value)}>
              <option value="">Выберите</option>
              <option value="yes">Да, остались</option>
              <option value="no">Нет, всё проверяемо</option>
            </select>
          </label>
          {change && extra && <button className="primary-action" type="button" onClick={() => setPhase(2)}>Показать разбор</button>}
        </div>
      </div>
    </div>
  );

  const changeText = change === 'better'
    ? 'Так и должно быть: уточнение сократило объём и убрало непроверяемое, не потребовав пересылать задачу заново.'
    : change === 'worse'
      ? 'Это частая ошибка уточнения: вместе с лишним ушло нужное. Значит, в уточнении не была названа граница — что именно сокращать нельзя. Следующее уточнение сформулируйте точнее.'
      : 'Если ответ не изменился, уточнение было слишком общим либо модель его не увидела как правку. Назовите конкретно, что убрать и что добавить.';
  const extraText = extra === 'no'
    ? 'Хорошо. Но перепроверьте: чаще всего непроверяемым остаётся название внутренней системы, курса или регламента — модель подставляет их «по смыслу».'
    : 'Это и есть главный результат практики. Такие места вы нашли сами — так же их придётся искать в рабочем ответе.';
  return (
    <div className="content-layout practice-slide compact-content">
      <div className="slide-heading" data-slide-focus tabIndex={-1}><p className="eyebrow">Практика завершена</p><h1>Что вы только что сделали</h1></div>
      <div className="practice-conclusion">
        <article><b>Уточнение вместо нового запроса</b><p>{changeText}</p></article>
        <article><b>Проверяемость важнее гладкости</b><p>{extraText}</p></article>
        <article className="rule"><b>Как оценивать улучшение</b><p>Ответ стал лучше не тогда, когда стал красивее, а когда каждое утверждение можно подтвердить источником и в нём выполнены все части запроса. Именно это проверяется на итоговом кейсе.</p></article>
      </div>
      <div className="practice-done"><b>✓ Практика завершена</b><p>Дальше — итоговый кейс из пяти решений.</p></div>
    </div>
  );
}

function CaseSlide(props: SlideViewProps) {
  const steps = props.slide.caseSteps ?? [];
  const step = steps[props.caseStep];
  const [caseParts,setCaseParts]=useState<Record<number,string>>({});
  const [caseFind,setCaseFind]=useState<number[]>([]);
  const [caseSpecialFeedback,setCaseSpecialFeedback]=useState('');
  if (props.completed) {
    // Шаги 1, 2 и 5 критические: задача, данные и окончательное решение.
    // Ошибка в любом из них — не зачёт, сколько бы ни набрано в сумме.
    const principles = [
      'подходит ли задача для ИИ: подготовка или окончательное действие',
      'какие данные допустимы и в каком канале',
      'из каких четырёх частей состоит запрос',
      'что именно проверяется в готовом ответе',
      'кто принимает окончательное решение и публикует результат',
    ];
    const criticalMissed = props.caseMisses.filter((step) => step === 0 || step === 1 || step === 4);
    const passed = props.caseScore >= 4 && criticalMissed.length === 0;
    const flawless = props.caseScore === 5;
    return (
      <div className="case-result">
        <BrandLogo />
        <p className="eyebrow">Итоговый кейс завершён</p>
        <b>{props.caseScore}/5</b>
        <h1>{flawless ? 'Курс усвоен' : passed ? 'Зачёт — с одной оговоркой' : 'Кейс нужно пройти ещё раз'}</h1>
        <p>{flawless
          ? 'Вы приняли безопасные решения на всех пяти этапах.'
          : passed
            ? 'Проходной результат набран, но один принцип применён неверно. Он не относится к критическим, поэтому кейс засчитан.'
            : criticalMissed.length
              ? 'Ошибка на критическом шаге: это данные, допустимость задачи или окончательное решение. Такой шаг нельзя пройти «в сумме» — его нужно принять верно.'
              : 'Набрано меньше четырёх верных решений из пяти.'}</p>
        {props.caseMisses.length > 0 && <div className="case-misses">
          <b>Вернитесь к этим принципам</b>
          <ul>{props.caseMisses.slice().sort((a, b) => a - b).map((step) => <li key={step} className={step === 0 || step === 1 || step === 4 ? 'critical' : ''}>Шаг {step + 1} — {principles[step]}{(step === 0 || step === 1 || step === 4) && <em> · критический</em>}</li>)}</ul>
        </div>}
        <button className="primary-action" type="button" onClick={props.onCaseRetry}>Пройти ещё раз</button>
      </div>
    );
  }
  if (props.caseStep === 2) {
    const parts = [
      ['Составь памятку для новых сотрудников по приложенным правилам','Задача'],
      ['Открытые правила рабочей переписки; аудитория — новые сотрудники','Контекст'],
      ['Заголовок, пять шагов и три вопроса; каждый шаг до двух предложений','Формат'],
      ['Не добавляй правил, которых нет в исходном материале','Проверка'],
    ];
    const zones=['Задача','Контекст','Формат','Проверка'];
    const filled=parts.every((_,idx)=>caseParts[idx]);
    const exact=parts.every((part,idx)=>caseParts[idx]===part[1]);
    return <div className="content-layout case-slide compact-content"><SlideHeading slide={props.slide}/>
      <div className="case-route">{steps.map((_,idx)=><span key={idx} className={idx<props.caseStep?'done':idx===props.caseStep?'active':''}>{idx+1}</span>)}</div>
      <section className="case-card special-case">
        <p className="question-label">Шаг 3 из 5 · Соберите запрос</p>
        <h2>Определите, какой частью запроса является каждая строка</h2>
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
            ? <button type="button" disabled={!filled} onClick={()=>props.onCaseChoose(exact?0:1)}>{filled?'Проверить':'Отметьте все четыре строки'}</button>
            : <>
                <p className={exact?'ok':'retry'}>{exact?'Верно: задача, контекст, формат и проверка — четыре части одного запроса.':'Не всё совпало. Правильные части подписаны под строками.'}</p>
                <button type="button" onClick={props.onCaseNext}>Следующий шаг</button>
              </>}
        </div>
      </section>
    </div>;
  }

  if (props.caseStep === 3) {
    const fragments=['Всегда отвечайте на рабочее письмо в течение одного часа.','Используйте понятную тему, отражающую содержание письма.','Кратко обозначьте следующий шаг и ожидаемое действие адресата.','Сотрудник обязан указывать точный срок ответа в каждом письме.'];
    const check=()=>{const exact=caseFind.length===2&&caseFind.includes(0)&&caseFind.includes(3);if(exact){setCaseSpecialFeedback('Верно: добавленное правило и рекомендация, превращённая в обязанность.');if(!props.caseAnswered)props.onCaseChoose(0);}else setCaseSpecialFeedback('Найдите два места: выдуманное правило и рекомендацию, поданную как обязанность.');};
    return <div className="content-layout case-slide compact-content"><SlideHeading slide={props.slide}/><div className="case-route">{steps.map((_,idx)=><span key={idx} className={idx<props.caseStep?'done':idx===props.caseStep?'active':''}>{idx+1}</span>)}</div><section className="case-card special-case"><p className="question-label">Шаг 4 из 5 · Проверьте черновик</p><h2>Отметьте два места, которые нельзя оставлять без сверки</h2><div className="case-fragments">{fragments.map((fragment,idx)=><button type="button" key={fragment} className={caseFind.includes(idx)?'selected':''} onClick={()=>setCaseFind(values=>values.includes(idx)?values.filter(v=>v!==idx):[...values,idx])}><span>{idx+1}</span>{fragment}</button>)}</div><div className="case-special-actions"><button type="button" onClick={check}>Проверить</button>{caseSpecialFeedback&&<p className={props.caseAnswered?'ok':'retry'}>{caseSpecialFeedback}</p>}{props.caseAnswered&&<button type="button" onClick={props.onCaseNext}>Следующий шаг</button>}</div></section></div>;
  }
  const choice = props.chosen === null ? null : step.choices[props.chosen];
  return (
    <div className="content-layout case-slide">
      <SlideHeading slide={props.slide} />
      <div className="case-route">{steps.map((_, idx) => <span key={idx} className={idx < props.caseStep ? 'done' : idx === props.caseStep ? 'active' : ''}>{idx + 1}</span>)}</div>
      <section className="case-card">
        <p className="question-label">Шаг {props.caseStep + 1} из 5</p>
        <h2>{step.title}</h2>
        <p>{step.prompt}</p>
        <div className="choice-list compact">
          {step.choices.map((item, idx) => <button key={item.label} className={`choice ${props.caseAnswered && props.chosen === idx ? (item.correct ? 'correct' : 'wrong') : ''}`} type="button" onClick={() => props.onCaseChoose(idx)}><span>{String.fromCharCode(65 + idx)}</span>{item.label}</button>)}
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
  const status = caseScore === null ? 'До завершения остался итоговый кейс' : passed ? 'Курс завершён' : 'Кейс нужно повторить';
  return (
    <div className="final-layout">
      <div className="final-copy">
        <p className={caseScore === null ? 'eyebrow pending' : passed ? 'eyebrow' : 'eyebrow failed'}>{status}</p>
        <h1>{props.slide.title}</h1>
        <div className="rules-list">{props.slide.panels?.map((panel) => <article key={panel.title}><b>{panel.title}</b><p>{panel.body}</p></article>)}</div>
        <div className={caseScore === null ? 'final-score pending' : passed ? 'final-score' : 'final-score failed'}>
          {caseScore === null
            ? <><span>Итоговый кейс ещё не пройден — пять решений, около трёх минут.</span><button className="primary-action" type="button" onClick={props.onGoToCase}>Пройти итоговый кейс</button></>
            : passed
              ? <><span>Итоговый кейс: <b>{caseScore}</b> из 5 — зачёт.</span><button className="secondary-action" type="button" onClick={props.onGoToCase}>Пройти ещё раз</button></>
              : <><span>Итоговый кейс: <b>{caseScore}</b> из 5. {criticalMissed.length ? 'Ошибка на критическом шаге — данные, допустимость задачи или окончательное решение.' : 'Для зачёта нужно 4 из 5.'}</span><button className="primary-action" type="button" onClick={props.onGoToCase}>Пройти кейс ещё раз</button></>}
        </div>
        <small>{props.slide.note}</small>
      </div>
      <div className="final-visual">
        <div className="final-next">
          <p><b>Что сделать сегодня.</b> Возьмите задачу без рабочих данных — план, структуру, список вопросов — и напишите запрос по формуле: задача, контекст, формат, проверка.</p>
          <p><b>Что сделать на этой неделе.</b> Проверьте один ответ по четырём пунктам и найдите в нём место, которое требует источника.</p>
          <p className="security-line"><b>Сомневаетесь в материале</b> — обратитесь в информационную безопасность через утверждённый в банке канал обращения, до загрузки.</p>
        </div>
        <div className="final-avatar"><img src={asset('/media/avatar.png')} alt="Ведущий курса"/><p>ИИ ускоряет подготовку.<br/><b>Окончательное решение принимает человек.</b></p></div>
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
    { step: 'Проверить, что ничего не выдумано', usual: 0, ai: 8 },
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
              <div className="bar usual"><i style={{ width: bar(row.usual) }} /><span>{row.usual ? `${row.usual} мин` : '—'}</span></div>
              <div className="bar ai"><i style={{ width: bar(row.ai) }} /><span>{row.ai} мин</span></div>
            </article>
          ))}
          <footer><p>Итого</p><b>55 минут</b><b className="win">13 минут</b></footer>
        </section>
        <section className="value-copy">
          <p className="value-lead">Восемь минут из тринадцати уходит на проверку. Это не потеря времени — это то, чему учит четвёртый шаг курса.</p>
          <p>Ассистент сделал черновик. Правила по-прежнему ваши, подпись — тоже.</p>
          <div className="value-not-done">
            <b>Что он не сделал</b>
            <ul>
              <li>не решил, какие правила важны для новичков</li>
              <li>не согласовал текст</li>
              <li>не отправил его</li>
            </ul>
            <span>Это три места, где нужны вы.</span>
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
          <h2>Спрашивать не нужно, если</h2>
          <p>В материале нет ни имён, ни счетов, ни договоров, ни внутренних документов, ни цифр вашего подразделения.</p>
          <ul>
            <li>структура и план</li>
            <li>список вопросов</li>
            <li>объяснение термина</li>
            <li>черновик без реквизитов</li>
          </ul>
          <footer>→ можно использовать, если сервис разрешён банком</footer>
        </section>
        <section className="ask-card risk">
          <h2>Спросить обязательно, если</h2>
          <ul>
            <li>материал внутренний, даже без грифа</li>
            <li>есть суммы, даты и вид операции — даже без имени клиента</li>
            <li>вы не знаете, откуда файл взялся</li>
          </ul>
          <footer>→ до загрузки, а не после</footer>
        </section>
      </div>
      <div className="ask-channel"><b>Куда идти</b><span>Обратитесь в информационную безопасность через утверждённый в банке канал обращения — до загрузки, а не после. Пока ответа нет, материал не загружается.</span></div>
      <Note text={props.slide.note} />
    </div>
  );
}
