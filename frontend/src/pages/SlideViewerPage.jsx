import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import { getMaterialPreviewBytes } from '../api/materials';
import { extractErrorMessage } from '../utils/errors';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Просмотр презентации (.pptx) по слайдам. Источник — тот же PDF, который
// бэкенд уже делает для предпросмотра офисных файлов (/materials/{id}/preview,
// конвертация LibreOffice с кэшем в хранилище). Страница PDF = слайд; на экране
// один слайд, вписанный в окно.
// Клавиши: вперёд — → ↓ пробел Enter PageDown; назад — ← ↑ Tab PageUp;
// Home / End — первый / последний. Esc не трогаем (браузер выходит им из
// полноэкранного режима).
const NEXT_KEYS = ['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown'];
const PREV_KEYS = ['ArrowLeft', 'ArrowUp', 'Tab', 'PageUp'];

function SlideViewerPage() {
  const { materialId } = useParams();
  const [params] = useSearchParams();
  const title = params.get('title') || '';
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const renderTask = useRef(null);

  useEffect(() => {
    if (title) document.title = title;
    let cancelled = false;
    getMaterialPreviewBytes(materialId)
      .then(data => pdfjsLib.getDocument({ data }).promise)
      .then(doc => { if (!cancelled) setPdf(doc); })
      .catch(err => { if (!cancelled) setError(extractErrorMessage(err, 'Не удалось открыть презентацию')); });
    return () => { cancelled = true; };
  }, [materialId, title]);

  const render = useCallback(async () => {
    if (!pdf || !stageRef.current || !canvasRef.current) return;
    const p = await pdf.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const box = stageRef.current.getBoundingClientRect();
    const scale = Math.min(box.width / base.width, box.height / base.height);
    const dpr = window.devicePixelRatio || 1;
    const vp = p.getViewport({ scale: scale * dpr });
    const canvas = canvasRef.current;
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
    canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
    if (renderTask.current) renderTask.current.cancel();
    renderTask.current = p.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    try { await renderTask.current.promise; } catch { /* отменён следующим слайдом */ }
  }, [pdf, page]);

  useEffect(() => { render(); }, [render]);
  useEffect(() => {
    window.addEventListener('resize', render);
    return () => window.removeEventListener('resize', render);
  }, [render]);

  const total = pdf ? pdf.numPages : 0;
  const go = useCallback((delta) => {
    setPage(n => Math.min(Math.max(n + delta, 1), total || 1));
  }, [total]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (NEXT_KEYS.includes(e.key)) { e.preventDefault(); go(1); }
      else if (PREV_KEYS.includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === 'Home') { e.preventDefault(); setPage(1); }
      else if (e.key === 'End') { e.preventDefault(); setPage(total || 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, total]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  return (
    <div className="slides">
      <div className="slides__stage" ref={stageRef} onClick={() => go(1)}>
        {error && <div className="slides__msg">{error}</div>}
        {!error && !pdf && <div className="slides__msg">{'Готовим презентацию...'}</div>}
        <canvas ref={canvasRef} className="slides__canvas" />
      </div>
      <div className="slides__bar">
        <span className="slides__title">{title}</span>
        <div className="slides__nav">
          <button type="button" onClick={() => go(-1)} disabled={page <= 1} aria-label="prev">‹</button>
          <span className="slides__count">{total ? `${page} / ${total}` : ''}</span>
          <button type="button" onClick={() => go(1)} disabled={!total || page >= total} aria-label="next">›</button>
        </div>
        <button type="button" className="slides__full" onClick={toggleFullscreen}>{'На весь экран'}</button>
      </div>
    </div>
  );
}

export default SlideViewerPage;
