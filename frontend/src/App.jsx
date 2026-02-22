import { useMemo, useRef, useState } from 'react';
import UploadZone from './components/UploadZone';
import PipelineStepper from './components/PipelineStepper';
import OCRPassDebugger from './components/OCRPassDebugger';
import ResultCard from './components/ResultCard';
import JsonInspector from './components/JsonInspector';
import PrescriptionTextViewer from './components/PrescriptionTextViewer';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const API_URL = `${API_BASE_URL}/api/process-prescription`;

const PHASE_STEPS = {
  idle: 0,
  uploading: 1,
  preprocessing: 2,
  ocr: 3,
  nlp: 4,
  matching: 5,
  done: 5,
  error: 0,
};

const PHASE_LABELS = {
  idle: 'Ready for a new analysis',
  uploading: 'Preparing request payload',
  preprocessing: 'Running image preprocessing',
  ocr: 'Extracting prescription text',
  nlp: 'Structuring clinical entities',
  matching: 'Matching against medicine index',
  done: 'Analysis completed',
  error: 'Analysis failed',
};

export default function App() {
  const [phase, setPhase] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [lastInput, setLastInput] = useState(null);

  const activeRequestRef = useRef(null);

  const isProcessing = !['idle', 'done', 'error'].includes(phase);

  const stats = useMemo(() => {
    const medicines = result?.extracted_medicines || [];
    const matched = medicines.filter((item) => item?.matched_medicine).length;

    return {
      total: medicines.length,
      matched,
      unresolved: medicines.length - matched,
    };
  }, [result]);

  const runPipeline = async (input) => {
    if (activeRequestRef.current) {
      activeRequestRef.current.abort();
    }

    const controller = new AbortController();
    activeRequestRef.current = controller;

    setError(null);
    setResult(null);
    setLastInput(input);

    try {
      setPhase('uploading');
      await waitWithAbort(250, controller.signal);

      setPhase('preprocessing');
      await waitWithAbort(300, controller.signal);

      setPhase('ocr');

      const body = {
        ...input,
        options: {
          ocr_passes: 5,
          min_consensus: 3,
          debug_passes: true,
        },
      };

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(data?.message || data?.suggestion || `Request failed (${response.status})`);
      }

      setPhase('nlp');
      await waitWithAbort(240, controller.signal);

      setPhase('matching');
      await waitWithAbort(240, controller.signal);

      setResult(data);
      setPhase('done');
    } catch (err) {
      if (err.name === 'AbortError') {
        setPhase('idle');
        return;
      }

      console.error('[Pipeline Error]', err);
      setError(err.message || 'An unexpected error occurred.');
      setPhase('error');
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
    }
  };

  const cancelPipeline = () => {
    activeRequestRef.current?.abort();
  };

  const retryLastInput = () => {
    if (!lastInput) return;
    runPipeline(lastInput);
  };

  const reset = () => {
    activeRequestRef.current?.abort();
    setPhase('idle');
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen app-background body-font text-slate-900">
      <div className="app-glow app-glow-left" aria-hidden="true" />
      <div className="app-glow app-glow-right" aria-hidden="true" />

      <header className="app-header sticky top-0 z-40">
        <div className="app-container px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-teal-700/80 font-semibold">Medical OCR + Matching</p>
            <h1 className="display-font text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">MedMap AI</h1>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden md:inline-flex status-chip">
              {PHASE_LABELS[phase]}
            </span>

            {isProcessing && (
              <button onClick={cancelPipeline} className="btn-danger" type="button">
                Cancel Run
              </button>
            )}

            {!isProcessing && phase !== 'idle' && (
              <button onClick={reset} className="btn-secondary" type="button">
                New Analysis
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app-container px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {phase === 'idle' && (
          <section className="space-y-6 animate-enter">
            <article className="panel p-6 sm:p-8 lg:p-10">
              <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-8 items-start">
                <div>
                  <span className="inline-flex items-center rounded-full bg-teal-100 text-teal-700 px-3 py-1 text-xs font-semibold tracking-wide">
                    Frontend-only analysis workflow
                  </span>
                  <h2 className="display-font mt-4 text-3xl sm:text-4xl lg:text-5xl leading-tight font-bold text-slate-900">
                    Upload a prescription and get structured medicine matches.
                  </h2>
                  <p className="mt-4 text-slate-600 max-w-2xl text-sm sm:text-base leading-relaxed">
                    The interface adapts based on current pipeline state, removes non-functional controls, and only shows actions you can actually trigger.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <InfoTile label="Indexed Medicines" value="250K+" />
                  <InfoTile label="OCR Passes" value="5" />
                  <InfoTile label="Consensus Min" value="3" />
                  <InfoTile label="Payload" value="Image/Text" />
                </div>
              </div>
            </article>

            <article className="panel p-4 sm:p-6 lg:p-8">
              <UploadZone onSubmit={runPipeline} disabled={isProcessing} />
            </article>
          </section>
        )}

        {isProcessing && (
          <section className="panel p-5 sm:p-8 animate-enter">
            <PipelineStepper currentStep={PHASE_STEPS[phase]} />
          </section>
        )}

        {phase === 'error' && (
          <section className="panel p-6 sm:p-8 animate-enter">
            <div className="max-w-2xl space-y-6">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-rose-700 font-semibold">Pipeline Error</p>
                <h2 className="display-font text-2xl sm:text-3xl font-bold text-slate-900 mt-1">Analysis could not be completed</h2>
                <p className="mt-3 text-slate-700 leading-relaxed text-sm sm:text-base">{error}</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={retryLastInput}
                  disabled={!lastInput}
                >
                  Retry Last Input
                </button>
                <button type="button" className="btn-secondary" onClick={reset}>
                  Start Over
                </button>
              </div>
            </div>
          </section>
        )}

        {phase === 'done' && result && (
          <section className="space-y-6 animate-enter">
            <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
              <article className="panel p-5 sm:p-6">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-semibold">Clinical Summary</p>
                <h2 className="display-font text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
                  {result.medical_condition || 'Condition not inferred'}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Completed in {result.processing_time_ms || 'N/A'} ms.
                </p>
              </article>

              <article className="panel p-5 sm:p-6">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-semibold">Extraction Stats</p>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <MetricCard label="Detected" value={stats.total} />
                  <MetricCard label="Matched" value={stats.matched} />
                  <MetricCard label="Review" value={stats.unresolved} />
                </div>
              </article>
            </div>

            <div className="grid xl:grid-cols-[320px_1fr] gap-6 items-start">
              <aside className="space-y-4 xl:sticky xl:top-28">
                <article className="panel p-4 sm:p-5">
                  <h3 className="section-label">OCR Consensus</h3>
                  <OCRPassDebugger ocrResult={result?.ocr_result} compact={true} />
                </article>

                <article className="panel p-4 sm:p-5">
                  <h3 className="section-label">Prescription Text</h3>
                  <PrescriptionTextViewer text={result?.ocr_result?.final_text} />
                </article>

                <article className="panel p-4 sm:p-5">
                  <h3 className="section-label">Raw Metadata</h3>
                  <JsonInspector data={result} />
                </article>
              </aside>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="display-font text-xl sm:text-2xl font-bold text-slate-900">Detected Medicines</h3>
                  <span className="status-chip">{stats.total} entries</span>
                </div>

                {result.extracted_medicines?.length > 0 ? (
                  <div className="space-y-4">
                    {result.extracted_medicines.map((extraction, index) => (
                      <ResultCard key={index} extraction={extraction} index={index} />
                    ))}
                  </div>
                ) : (
                  <article className="panel p-8 text-center">
                    <h4 className="display-font text-xl font-bold text-slate-900">No medicines detected</h4>
                    <p className="text-slate-600 mt-2 text-sm">
                      {result.suggestion || 'Try a clearer image or provide clean prescription text.'}
                    </p>
                  </article>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="app-container px-4 sm:px-6 pb-8 pt-2">
        <p className="text-xs text-slate-500">
          MedMap AI frontend. Controls shown are context-aware and actionable.
        </p>
      </footer>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-semibold">{label}</p>
      <p className="display-font text-xl font-bold text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold">{label}</p>
      <p className="display-font text-xl font-bold text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function waitWithAbort(ms, signal) {
  if (signal?.aborted) {
    throwAbortError();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function throwAbortError() {
  throw new DOMException('The operation was aborted.', 'AbortError');
}
