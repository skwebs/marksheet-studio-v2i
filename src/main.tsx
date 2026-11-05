import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import { Archive, BookOpen, Check, ChevronDown, Download, FileSpreadsheet, FileUp, ImagePlus, Printer, School, Settings, Users, ClipboardList, CalendarCheck, Eye, Save, Trash2, Upload, Plus, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ArrowRightLeft, X, Github, Globe, Mail, Code2, Lock, Unlock, Layers, Search, PanelLeftClose, PanelLeftOpen, Menu, RotateCcw } from 'lucide-react';
import { loadData, saveData, listWorkspaces, loadWorkspace, loadWorkspaceSnapshot, saveWorkspace, moveStudentBetweenWorkspaces, renameClassWorkspace, workspaceId, deleteWorkspace, archiveWorkspace, restoreWorkspace } from './db';
import { normalizeRollNumber, normalizeAcademicSession, formatAcademicSession } from './normalization';
import { blankStudent, createDefaultData, emptyMarks, examPresets, getExamKeys, normalizeData, subjectsForClass } from './data';
import { calculatePromotionScore, getDataReadiness, getValidationLevel, getConfiguredMarkStatus } from './calculations';
import { exportZip, exportPromotionZip, importZip, type PromotionRollMode } from './backup';
import { renderMarksheet } from './templateRenderer';
import { createStandaloneMarksheetHtml, createStandaloneMarksheetZip, standaloneFileName } from './standaloneHtml';
import { exportMarksheets, type MarksheetExportFormat } from './marksheetExport';
import type { AppData, ExamKey, Student } from './types';
import './style.css';

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file);
});

type CropDraft = { studentId: string; src: string; fileName: string };
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> };
function StudentPhotoCropModal({
  draft, outputScale, onCancel, onApply, onUseOriginal, onSelectNewImage
}: {
  draft: CropDraft;
  outputScale: 1 | 1.5 | 2 | 3 | 4;
  onCancel: () => void;
  onApply: (studentId: string, imageDataUrl: string) => void;
  onUseOriginal: (studentId: string, imageDataUrl: string) => void;
  onSelectNewImage: (file: File) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stateRef = useRef({
    x: 0, y: 0, scale: 1, minScale: 1, quarterTurns: 0, fineRotation: 0,
    pointers: new Map<number, { x: number; y: number }>(),
    drag: null as null | { startX: number; startY: number; imageX: number; imageY: number },
    pinch: null as null | { distance: number; zoom: number }
  });
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fineRotation, setFineRotation] = useState(0);
  const [error, setError] = useState('');

  const WIDTH = 400;
  const HEIGHT = 460;
  const rotation = () => stateRef.current.quarterTurns * 90 + stateRef.current.fineRotation;
  const requiredScale = (angle: number) => {
    const rad = angle * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const image = imageRef.current!;
    return Math.max(
      (cos * WIDTH + sin * HEIGHT) / image.naturalWidth,
      (sin * WIDTH + cos * HEIGHT) / image.naturalHeight
    );
  };
  const clamp = () => {
    const state = stateRef.current;
    const image = imageRef.current;
    if (!image) return;
    const imageW = image.naturalWidth * state.scale;
    const imageH = image.naturalHeight * state.scale;
    const rad = rotation() * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const halfW = (Math.abs(cos) * WIDTH + Math.abs(sin) * HEIGHT) / 2;
    const halfH = (Math.abs(sin) * WIDTH + Math.abs(cos) * HEIGHT) / 2;
    const maxX = Math.max(0, imageW / 2 - halfW);
    const maxY = Math.max(0, imageH / 2 - halfH);
    const centerX = state.x + imageW / 2;
    const centerY = state.y + imageH / 2;
    const dx = WIDTH / 2 - centerX;
    const dy = HEIGHT / 2 - centerY;
    const localX = Math.max(-maxX, Math.min(maxX, cos * dx + sin * dy));
    const localY = Math.max(-maxY, Math.min(maxY, -sin * dx + cos * dy));
    const correctedX = cos * localX - sin * localY;
    const correctedY = sin * localX + cos * localY;
    state.x = WIDTH / 2 - correctedX - imageW / 2;
    state.y = HEIGHT / 2 - correctedY - imageH / 2;
  };
  const draw = () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#17191f';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (image && image.complete && image.naturalWidth > 0) {
      const state = stateRef.current;
      const imageW = image.naturalWidth * state.scale;
      const imageH = image.naturalHeight * state.scale;
      ctx.save();
      ctx.translate(state.x + imageW / 2, state.y + imageH / 2);
      ctx.rotate(rotation() * Math.PI / 180);
      ctx.drawImage(image, -imageW / 2, -imageH / 2, imageW, imageH);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);
    const corner = 22;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    const corners: [number, number, number, number][] = [[0,0,1,1],[WIDTH,0,-1,1],[0,HEIGHT,1,-1],[WIDTH,HEIGHT,-1,-1]];
    corners.forEach(([x,y,sx,sy]) => {
      ctx.beginPath();
      ctx.moveTo(x + sx * corner, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * corner);
      ctx.stroke();
    });
  };
  const render = () => {
    clamp();
    draw();
  };
  const setZoomAt = (nextZoom: number, anchorX = WIDTH / 2, anchorY = HEIGHT / 2) => {
    const image = imageRef.current;
    if (!image) return;
    const state = stateRef.current;
    const next = Math.max(1, Math.min(20, nextZoom));
    const oldScale = state.scale;
    const newScale = state.minScale * next;
    const imageW = image.naturalWidth * oldScale;
    const imageH = image.naturalHeight * oldScale;
    const centerX = state.x + imageW / 2;
    const centerY = state.y + imageH / 2;
    const rad = -rotation() * Math.PI / 180;
    const dx = anchorX - centerX;
    const dy = anchorY - centerY;
    const localX = Math.cos(rad) * dx - Math.sin(rad) * dy;
    const localY = Math.sin(rad) * dx + Math.cos(rad) * dy;
    const ratio = newScale / oldScale;
    const scaledX = localX * ratio;
    const scaledY = localY * ratio;
    const forward = rotation() * Math.PI / 180;
    const nextCenterX = anchorX - (Math.cos(forward) * scaledX - Math.sin(forward) * scaledY);
    const nextCenterY = anchorY - (Math.sin(forward) * scaledX + Math.cos(forward) * scaledY);
    state.scale = newScale;
    state.x = nextCenterX - image.naturalWidth * newScale / 2;
    state.y = nextCenterY - image.naturalHeight * newScale / 2;
    render();
    setZoom(next);
  };
  const rotate = (quarterTurn: number, fine = stateRef.current.fineRotation) => {
    const image = imageRef.current;
    if (!image) return;
    const state = stateRef.current;
    const previousZoom = state.scale / state.minScale;
    const imageW = image.naturalWidth * state.scale;
    const imageH = image.naturalHeight * state.scale;
    const centerX = state.x + imageW / 2;
    const centerY = state.y + imageH / 2;
    state.quarterTurns += quarterTurn;
    state.fineRotation = fine;
    state.minScale = requiredScale(rotation());
    state.scale = state.minScale * Math.max(1, previousZoom);
    state.x = centerX - image.naturalWidth * state.scale / 2;
    state.y = centerY - image.naturalHeight * state.scale / 2;
    render();
    setFineRotation(state.fineRotation);
    setZoom(state.scale / state.minScale);
  };
  useEffect(() => {
    setLoaded(false);
    setError('');
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      const state = stateRef.current;
      state.quarterTurns = 0;
      state.fineRotation = 0;
      state.minScale = requiredScale(0);
      state.scale = state.minScale;
      state.x = (WIDTH - image.naturalWidth * state.scale) / 2;
      state.y = (HEIGHT - image.naturalHeight * state.scale) / 2;
      setLoaded(true);
      setZoom(1);
      setFineRotation(0);
      requestAnimationFrame(draw);
    };
    image.onerror = () => setError('Unable to load this image. Please select another photo.');
    image.src = draft.src;
    return () => { image.onload = null; image.onerror = null; };
  }, [draft.src]);
  useEffect(() => { if (loaded) draw(); }, [loaded]);
  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height };
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pos = pointerPosition(event);
    const state = stateRef.current;
    state.pointers.set(event.pointerId, pos);
    if (state.pointers.size === 1) {
      state.drag = { startX: pos.x, startY: pos.y, imageX: state.x, imageY: state.y };
      state.pinch = null;
    } else if (state.pointers.size === 2) {
      const points = [...state.pointers.values()];
      state.drag = null;
      state.pinch = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), zoom: state.scale / state.minScale };
    }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    if (!state.pointers.has(event.pointerId)) return;
    event.preventDefault();
    const pos = pointerPosition(event);
    state.pointers.set(event.pointerId, pos);
    if (state.pointers.size === 1 && state.drag) {
      state.x = state.drag.imageX + pos.x - state.drag.startX;
      state.y = state.drag.imageY + pos.y - state.drag.startY;
      render();
    } else if (state.pointers.size === 2 && state.pinch) {
      const points = [...state.pointers.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const midpointX = (points[0].x + points[1].x) / 2;
      const midpointY = (points[0].y + points[1].y) / 2;
      if (state.pinch.distance > 0) setZoomAt(state.pinch.zoom * distance / state.pinch.distance, midpointX, midpointY);
    }
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.delete(event.pointerId);
    if (state.pointers.size === 1) {
      const [pos] = [...state.pointers.values()];
      state.drag = { startX: pos.x, startY: pos.y, imageX: state.x, imageY: state.y };
      state.pinch = null;
    } else {
      state.drag = null;
      state.pinch = null;
    }
  };
  const reset = () => {
    const image = imageRef.current;
    if (!image) return;
    const state = stateRef.current;
    state.quarterTurns = 0;
    state.fineRotation = 0;
    state.minScale = requiredScale(0);
    state.scale = state.minScale;
    state.x = (WIDTH - image.naturalWidth * state.scale) / 2;
    state.y = (HEIGHT - image.naturalHeight * state.scale) / 2;
    render();
    setZoom(1);
    setFineRotation(0);
  };
  const apply = () => {
    const image = imageRef.current;
    if (!image || !loaded) return;
    try {
      const output = document.createElement('canvas');
      output.width = Math.round(WIDTH * outputScale);
      output.height = Math.round(HEIGHT * outputScale);
      const ctx = output.getContext('2d');
      if (!ctx) throw new Error('Canvas is unavailable in this browser.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, output.width, output.height);
      const state = stateRef.current;
      const imageW = image.naturalWidth * state.scale;
      const imageH = image.naturalHeight * state.scale;
      ctx.save();
      ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
      ctx.translate(state.x + imageW / 2, state.y + imageH / 2);
      ctx.rotate(rotation() * Math.PI / 180);
      ctx.drawImage(image, -imageW / 2, -imageH / 2, imageW, imageH);
      ctx.restore();
      onApply(draft.studentId, output.toDataURL('image/jpeg', 0.92));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to crop this image.');
    }
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!loaded) return;
    const step = event.shiftKey ? 20 : 4;
    const zoomStep = event.shiftKey ? 0.2 : 0.05;
    const state = stateRef.current;
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft': state.x += step; break;
      case 'ArrowRight': state.x -= step; break;
      case 'ArrowUp': state.y += step; break;
      case 'ArrowDown': state.y -= step; break;
      case '+': case '=': setZoomAt(state.scale / state.minScale + zoomStep); break;
      case '-': case '_': setZoomAt(state.scale / state.minScale - zoomStep); break;
      case '[': rotate(-1); break;
      case ']': rotate(1); break;
      case '0': reset(); break;
      default: handled = false;
    }
    if (handled) { event.preventDefault(); if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) render(); }
  };

  return <div className="crop-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
    <section className="crop-modal crop-modal-canvas" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <header className="crop-modal-header">
        <div><h2 id="crop-title">Crop student photo</h2><p>Portrait ratio 20:23 · Only the final photo area is shown. Move or zoom the image inside the frame.</p></div>
        <button className="icon-btn" type="button" aria-label="Close crop dialog" onClick={onCancel}>✕</button>
      </header>
      <div className="crop-canvas-wrap">
        <canvas ref={canvasRef} className="student-crop-canvas" width={WIDTH} height={HEIGHT}
          aria-label="Photo crop area. Drag to move, pinch or use the wheel to zoom. Arrow keys move; plus and minus zoom; bracket keys rotate; zero resets."
          tabIndex={0} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp} onLostPointerCapture={onPointerUp} onKeyDown={handleKeyDown}
          onWheel={e => { if (!loaded) return; e.preventDefault(); const rect=e.currentTarget.getBoundingClientRect(); setZoomAt(stateRef.current.scale/stateRef.current.minScale*(e.deltaY<0?1.08:1/1.08),(e.clientX-rect.left)*WIDTH/rect.width,(e.clientY-rect.top)*HEIGHT/rect.height); }}/>
        {!loaded && <div className="crop-canvas-loading">Loading photo…</div>}
      </div>
      <div className="crop-source-actions">
        <div className="crop-source-copy"><strong>Photo source</strong><span>{draft.fileName || 'Current student photo'}</span></div>
        <label className="btn"><ImagePlus size={15}/> Select new image<input hidden type="file" accept="image/*" onChange={async e => { const file=e.currentTarget.files?.[0]; if(file){try{await file.arrayBuffer();onSelectNewImage(file);}catch{setError('Could not read this image file.');}}e.currentTarget.value='';}}/></label>
      </div>
      <div className="crop-controls crop-canvas-controls">
        <section className="crop-control-panel crop-zoom-panel">
          <div className="crop-control-heading"><strong>Image zoom</strong><strong>{Math.round(zoom*100)}%</strong></div>
          <input aria-label="Image zoom" type="range" min="1" max="20" step="0.01" value={zoom} disabled={!loaded} onChange={e=>setZoomAt(Number(e.target.value))}/>
          <div className="crop-control-foot"><span>100%</span><span>2000%</span></div>
        </section>
        <section className="crop-control-panel crop-rotation-row" aria-label="Image rotation controls">
          <button type="button" className="btn crop-rotate-left" aria-label="Rotate 90 degrees left" title="Rotate 90° left" disabled={!loaded} onClick={()=>rotate(-1)}>↶</button>
          <div className="crop-fine-rotation">
            <div className="crop-control-heading"><strong>Rotate</strong><strong>{fineRotation}°</strong></div>
            <input aria-label="Fine rotation" type="range" min="-45" max="45" step="1" value={fineRotation} disabled={!loaded} onChange={e=>rotate(0,Number(e.target.value))}/>
          </div>
          <button type="button" className="btn crop-rotate-right" aria-label="Rotate 90 degrees right" title="Rotate 90° right" disabled={!loaded} onClick={()=>rotate(1)}>↷</button>
        </section>
      </div>
      <p className="crop-output-note">Drag with one finger or mouse · Pinch with two fingers · Mouse wheel to zoom · Arrow keys to move · + / − to zoom · [ / ] rotate · 0 reset</p>
      {error && <p className="crop-error" role="alert">{error}</p>}
      <footer className="crop-modal-footer crop-modal-footer-split"><button className="btn" type="button" onClick={()=>onUseOriginal(draft.studentId,draft.src)}>Use original image (skip crop)</button><div className="crop-footer-right"><button className="btn" type="button" onClick={onCancel}>Cancel</button><button className="btn btn-primary" type="button" disabled={!loaded} onClick={apply}>Apply cropped photo</button></div></footer>
    </section>
  </div>;
}

function App() {
  const [data, setData] = useState<AppData>(createDefaultData());
  const [classNameDraft, setClassNameDraft] = useState(data.classInfo.className);
  const exams = getExamKeys(data);
  const readiness = getDataReadiness(data);
  const isClassConfigurationLocked = data.students.length > 0 && !data.settings.allowEditExistingClassConfig;
  const [section, setSection] = useState('students');
  const [exam, setExam] = useState<ExamKey>('pa1');
  const [template, setTemplate] = useState('');
  const [singleTemplate, setSingleTemplate] = useState('');
  const [status, setStatus] = useState('Loading local data…');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [busy, setBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [watermarkAppearanceLocked, setWatermarkAppearanceLocked] = useState(true);
  const [exportFormat, setExportFormat] = useState<MarksheetExportFormat>('pdf');
  const [exportSelection, setExportSelection] = useState<'all' | 'selected' | 'current'>('all');
  const [exportSelectedIds, setExportSelectedIds] = useState<string[]>([]);
  const [exportPdfMode, setExportPdfMode] = useState<'combined' | 'individual'>('combined');
  const [exportProgress, setExportProgress] = useState<{ completed: number; total: number } | null>(null);
  const exportCancelledRef = useRef(false);
  const [importMode, setImportMode] = useState<'students' | ExamKey>('students');
  const [sheetPicker, setSheetPicker] = useState<{ file: File; kind: 'attendance' | 'students' | 'marks'; mode: 'students' | ExamKey; sheetNames: string[] } | null>(null);
  const [headerMapping, setHeaderMapping] = useState<{ file: File; kind: 'attendance' | 'students' | 'marks'; mode: 'students' | ExamKey; sheetName: string; matrix: unknown[][]; headerRows: Array<{ index: number; headers: string[] }>; headerRow: number; fields: string[]; selected: Record<string, string> } | null>(null);
  const [selectedUploadExams, setSelectedUploadExams] = useState<ExamKey[]>(['pa1']);
  const saveSequence = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [workspaces, setWorkspaces] = useState<Array<{id:string;data:AppData;updatedAt:string;archived:boolean}>>([]);
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [newWorkspaceClass, setNewWorkspaceClass] = useState('');
  const [newWorkspaceSession, setNewWorkspaceSession] = useState(data.academicSession);
  const [newWorkspaceSection, setNewWorkspaceSection] = useState('');
  const [sidebarMode, setSidebarMode] = useState<'expanded'|'collapsed'|'hidden'>(() => {
    try { const stored = localStorage.getItem('ms-v2-sidebar-mode'); return stored === 'collapsed' || stored === 'hidden' ? stored : 'expanded'; } catch { return 'expanded'; }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const workspaceCreationRef = useRef(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [promotionClass, setPromotionClass] = useState('');
  const [promotionSession, setPromotionSession] = useState('');
  const [promotionRollMode, setPromotionRollMode] = useState<PromotionRollMode>('dynamic');
  const [selectedPromotionIds, setSelectedPromotionIds] = useState<string[]>([]);
  const selectAllPromotionRef = useRef<HTMLInputElement | null>(null);
  const promotionGenerationRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistData = (nextData: AppData) => {
    const pending = saveQueueRef.current.catch(() => undefined).then(() => saveData(nextData));
    saveQueueRef.current = pending;
    return pending;
  };
  const persistWorkspace = (nextData: AppData) => {
    const pending = saveQueueRef.current.catch(() => undefined).then(() => saveWorkspace(nextData));
    saveQueueRef.current = pending;
    return pending;
  };
  const promotionRanked = [...data.students].map(student => ({ student, score: calculatePromotionScore(data, student), attendance: student.attendance.workingDays > 0 ? student.attendance.daysPresent / student.attendance.workingDays * 100 : 0 })).sort((a,b) => b.score.percentage-a.score.percentage || b.score.obtained-a.score.obtained || b.attendance-a.attendance || a.student.roll.localeCompare(b.student.roll, undefined, {numeric:true}));
  const allPromotionSelected = data.students.length > 0 && selectedPromotionIds.length === data.students.length;
  const somePromotionSelected = selectedPromotionIds.length > 0 && !allPromotionSelected;
  useEffect(() => { if (selectAllPromotionRef.current) selectAllPromotionRef.current.indeterminate = somePromotionSelected; }, [somePromotionSelected]);
  useEffect(() => {
    setSelectedUploadExams(current => { const valid = current.filter(key => exams.includes(key)); return valid.length ? valid : [exams[0]]; });
    if (!exams.includes(exam)) setExam(exams[0]);
  }, [data.examOrder.join('|')]);
  useEffect(() => {
    let registerServiceWorker: (() => void) | undefined;
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      registerServiceWorker = () => { void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('PWA service worker registration failed:', error)); };
      if (document.readyState === 'complete') registerServiceWorker();
      else window.addEventListener('load', registerServiceWorker, { once: true });
    }
    const onInstallPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { if (registerServiceWorker) window.removeEventListener('load', registerServiceWorker); window.removeEventListener('beforeinstallprompt', onInstallPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem('ms-v2-sidebar-mode', sidebarMode); } catch { /* Storage preference is optional. */ }
  }, [sidebarMode]);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 721px)');
    const closeOnDesktop = () => { if (media.matches) setMobileSidebarOpen(false); };
    media.addEventListener('change', closeOnDesktop);
    return () => media.removeEventListener('change', closeOnDesktop);
  }, []);
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileSidebarOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileSidebarOpen]);
  const installApp = async () => {
    if (!installPrompt) return;
    try { await installPrompt.prompt(); await installPrompt.userChoice; }
    catch (error) { console.warn('PWA installation prompt was not completed:', error); }
    finally { setInstallPrompt(null); }
  };
  useEffect(() => {
    Promise.all([loadData(), fetch('/marksheet-multi-exam.html').then(r => r.text()), fetch('/marksheet-single-exam.html').then(r => r.text())]).then(async ([saved, html, singleHtml]) => {
      const initial = saved ? normalizeData(saved) : createDefaultData();
      setData(initial);
      setWorkspaces(await listWorkspaces());
      setTemplate(html); setSingleTemplate(singleHtml); setStatus(saved ? 'Loaded from this browser' : 'Ready · data saves locally');
    }).catch(() => setStatus('Ready · local data not loaded')).finally(() => setIsBootstrapping(false));
  }, []);
  useEffect(() => {
    setClassNameDraft(data.classInfo.className);
  }, [data.classInfo.className]);
  useEffect(() => {
    if (!template) return;
    const sequence = ++saveSequence.current;
    setStatus('Editing…');
    const id = window.setTimeout(() => {
      saveTimerRef.current = null;
      setStatus('Saving…');
      persistData(data).then(async () => { setWorkspaces(await listWorkspaces()); if (sequence === saveSequence.current) setStatus('Saved locally'); }).catch(error => { if (sequence === saveSequence.current) setStatus(error instanceof Error ? error.message : 'Save failed — retry by editing or pressing Ctrl+S'); });
    }, 500);
    saveTimerRef.current = id;
    return () => { window.clearTimeout(id); if (saveTimerRef.current === id) saveTimerRef.current = null; };
  }, [data, template]);
  const switchWorkspace = async (id: string) => {
    const workspaceMeta = workspaces.find(item => item.id === id);
    if (workspaceMeta?.archived) { alert('Restore this archived workspace before opening it.'); return; }
    try {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveSequence.current += 1;
      await persistData(data);
      const workspace = await loadWorkspace(id);
      if (!workspace) { alert('The selected class workspace could not be found.'); return; }
      const normalized = normalizeData(workspace);
      await persistData(normalized);
      setData(normalized);
      setSelectedStudent(normalized.students[0]?.studentId || '');
      setMobileSidebarOpen(false);
      setNotice(`Opened Class ${normalized.classInfo.className}, session ${formatAcademicSession(normalized.academicSession, normalized.settings.sessionDisplayFormat)}.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not switch workspace. The current workspace was retained.');
    }
  };
  const commitActiveClassChange = async () => {
    const nextClass = classNameDraft.trim();
    const previousClass = data.classInfo.className;
    if (data.students.length > 0 && !data.settings.allowEditActiveClass) { setClassNameDraft(previousClass); return; }
    if (!nextClass || nextClass === previousClass) { setClassNameDraft(previousClass); return; }
    const nextData: AppData = {
      ...data,
      classInfo: { ...data.classInfo, className: nextClass },
      // Preserve the current subject/result structure during a workspace rename.
      classSubjectConfigs: { ...data.classSubjectConfigs, [nextClass]: data.subjects }
    };
    const destinationId = workspaceId(nextData);
    const existingDestination = await loadWorkspaceSnapshot(destinationId);
    if (existingDestination) {
      alert(`Class ${nextClass} already has a saved workspace for session ${formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat)}. Open it using Saved class workspaces instead of overwriting it.`);
      setClassNameDraft(previousClass);
      return;
    }
    if (!confirm(`Change the active workspace class from ${previousClass} to ${nextClass}? All students, marks, attendance, subjects and settings in this workspace will remain together. Another saved workspace will not be overwritten.`)) {
      setClassNameDraft(previousClass);
      return;
    }
    if (saveTimerRef.current !== null) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    saveSequence.current += 1;
    await persistData(data);
    const result = await renameClassWorkspace(data, nextData);
    if (result === 'exists') {
      alert(`Class ${nextClass} already has a saved workspace. No data was changed.`);
      setClassNameDraft(previousClass);
      return;
    }
    setData(nextData);
    setClassNameDraft(nextClass);
    setWorkspaces(await listWorkspaces());
    setNotice(result === 'renamed' ? `Active workspace renamed to Class ${nextClass}. Student records and results were preserved.` : `Active class changed to ${nextClass}. Review the class subjects before entering new marks.`);
  };
  const moveStudentToClass = async (studentId: string) => {
    if (!data.settings.allowChangeExistingStudentClass) {
      alert('Enable Allow changing class of existing students in School Profile → Class configuration first.');
      return;
    }
    const student = data.students.find(item => item.studentId === studentId);
    if (!student) return;
    const destinationClass = prompt(`Move ${student.name || `Roll ${student.roll}`} to which class?`, '');
    const nextClass = destinationClass?.trim();
    if (!nextClass || nextClass === data.classInfo.className) return;
    if (!confirm(`Move ${student.name || `Roll ${student.roll}`} (Roll ${student.roll}) from Class ${data.classInfo.className} to Class ${nextClass} for session ${formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat)}? Their current-session marks, attendance, photo and remarks will move with the student. Previous-session workspaces will remain unchanged.`)) return;
    const destinationInfo = { ...data.classInfo, className: nextClass };
    const destinationId = workspaceId({ ...data, classInfo: destinationInfo });
    const destinationSnapshot = await loadWorkspaceSnapshot(destinationId);
    if (destinationSnapshot?.archived) {
      alert(`Class ${nextClass} has an archived workspace for this session. Restore it in Workspace Manager before moving a student there.`);
      return;
    }
    const existingWorkspace = destinationSnapshot?.data;
    const destinationBase = existingWorkspace ? normalizeData(existingWorkspace) : {
      ...data,
      classInfo: destinationInfo,
      subjects: data.classSubjectConfigs[nextClass] || subjectsForClass(nextClass),
      students: [],
      results: Object.fromEntries(Object.keys(data.results).map(key => [key, []])) as AppData['results'],
      classSubjectConfigs: { ...data.classSubjectConfigs, [nextClass]: data.classSubjectConfigs[nextClass] || subjectsForClass(nextClass) }
    };
    if (destinationBase.students.some(item => item.studentId === studentId)) {
      alert(`This student already exists in Class ${nextClass}, session ${formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat)}. No records were changed.`);
      return;
    }
    if (destinationBase.students.some(item => normalizeRollNumber(item.roll) === normalizeRollNumber(student.roll))) {
      alert(`Roll ${student.roll} is already used in Class ${nextClass}, session ${formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat)}. Change the roll in one class before moving this student.`);
      return;
    }
    const sourceMarks = Object.fromEntries(Object.keys(data.results).map(key => {
      const row = (data.results[key] || []).find(mark => mark.studentId === studentId || (!mark.studentId && normalizeRollNumber(mark.roll) === normalizeRollNumber(student.roll)));
      return [key, row ? { ...row, studentId, roll: student.roll } : null];
    })) as Record<string, (AppData['results'][string][number] | null)>;
    const destinationResults = { ...destinationBase.results };
    Object.entries(sourceMarks).forEach(([key, row]) => {
      if (!row) return;
      const rows = destinationResults[key] || [];
      destinationResults[key] = [...rows.filter(mark => mark.studentId !== studentId && mark.roll !== student.roll), row];
    });
    const destinationData: AppData = { ...destinationBase, students: [...destinationBase.students, student], results: destinationResults };
    const sourceData: AppData = {
      ...data,
      students: data.students.filter(item => item.studentId !== studentId),
      results: Object.fromEntries(Object.keys(data.results).map(key => [key, (data.results[key] || []).filter(mark => mark.studentId !== studentId && mark.roll !== student.roll)])) as AppData['results']
    };
    try {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveSequence.current += 1;
      await persistData(data);
      const moved = await moveStudentBetweenWorkspaces(sourceData, destinationData, studentId, destinationSnapshot?.updatedAt ?? null);
      if (!moved) { alert('The destination workspace changed or already contains this student. Refresh the workspace list and try again. No records were moved.'); return; }
      setData(sourceData);
      if (selectedStudent === studentId) setSelectedStudent(sourceData.students[0]?.studentId || '');
      setWorkspaces(await listWorkspaces());
      setNotice(`Moved ${student.name || `Roll ${student.roll}`} to Class ${nextClass}. Current-session marks and attendance moved with the student; previous-session records were preserved.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not move the student. The original record was retained.');
    }
  };
  const activeWorkspaceId = workspaceId(data);
  const removeSavedWorkspace = async (workspaceIdToDelete: string) => {
    const target = workspaces.find(item => item.id === workspaceIdToDelete);
    if (!target) return;
    if (target.id === activeWorkspaceId) {
      alert('The active workspace cannot be deleted. Switch to another workspace first.');
      return;
    }
    const classLabel = String(target.data.classInfo.className || '').trim() || '(missing class name)';
    const sessionLabel = String(target.data.academicSession || '').trim() || '(missing session)';
    const count = target.data.students.length;
    if (!confirm(`Permanently delete this saved workspace?\n\nClass: ${classLabel}\nSession: ${sessionLabel}\nStudents: ${count}\n\nThis removes its student details, marks, attendance and settings from this browser. Export a ZIP backup first if needed.`)) return;
    try {
      const removed = await deleteWorkspace(target.id, activeWorkspaceId);
      if (!removed) { alert('Workspace could not be found. Refresh the page and try again.'); return; }
      setWorkspaces(await listWorkspaces());
      setNotice(`Deleted saved workspace: Class ${classLabel}, session ${sessionLabel}.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not delete this workspace.');
    }
  };
  const openWorkspaceDialog = () => {
    setMobileSidebarOpen(false);
    setNewWorkspaceClass('');
    setNewWorkspaceSession(data.academicSession);
    setNewWorkspaceSection(data.settings.sectionEnabled ? data.classInfo.section : '');
    setWorkspaceDialogOpen(true);
  };
  const createNewWorkspace = async () => {
    if (workspaceCreationRef.current) return;
    workspaceCreationRef.current = true;
    try {
      const className = newWorkspaceClass.trim();
      const session = normalizeAcademicSession(newWorkspaceSession.trim());
      const sectionValue = data.settings.sectionEnabled ? newWorkspaceSection.trim() : '';
      if (!className) { alert('Enter a class name.'); return; }
      if (!session) { alert('Enter an academic session.'); return; }
      const classSubjects = data.classSubjectConfigs[className]?.length
        ? data.classSubjectConfigs[className]
        : subjectsForClass(className);
      const nextWorkspace: AppData = {
        ...data,
        academicSession: session,
        classInfo: { ...data.classInfo, className, section: sectionValue, classTeacher: '', totalWorkingDays: 0 },
        subjects: classSubjects,
        classSubjectConfigs: { ...data.classSubjectConfigs, [className]: classSubjects },
        students: [],
        results: Object.fromEntries(Object.keys(data.results).map(key => [key, []])) as AppData['results']
      };
      const id = workspaceId(nextWorkspace);
      const existing = await loadWorkspaceSnapshot(id);
      if (existing) {
        alert(`A workspace for Class ${className}${sectionValue ? `-${sectionValue}` : ''}, session ${formatAcademicSession(session, data.settings.sessionDisplayFormat)} already exists. Open or restore it instead.`);
        return;
      }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveSequence.current += 1;
      await persistData(data);
      await persistWorkspace(nextWorkspace);
      await persistData(nextWorkspace);
      setData(nextWorkspace);
      setSelectedStudent('');
      setSection('students');
      setWorkspaces(await listWorkspaces());
      setWorkspaceDialogOpen(false);
      setNotice(`Created and opened Class ${className}${sectionValue ? `-${sectionValue}` : ''}, session ${formatAcademicSession(session, data.settings.sessionDisplayFormat)}. Student records and marks start empty; school and exam configuration were copied from the previous workspace.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not create the workspace.');
    } finally {
      workspaceCreationRef.current = false;
    }
  };
  const archiveSavedWorkspace = async (id: string) => {
    const target = workspaces.find(item => item.id === id);
    if (!target || target.archived) return;
    const label = `Class ${target.data.classInfo.className}${target.data.classInfo.section ? `-${target.data.classInfo.section}` : ''} · ${formatAcademicSession(target.data.academicSession, data.settings.sessionDisplayFormat)}`;
    if (!confirm(`Archive ${label}? Its students, marks, attendance and settings will be preserved. You can restore it later.`)) return;
    try {
      const archived = await archiveWorkspace(id, activeWorkspaceId);
      if (!archived) { alert('The active workspace cannot be archived, or the workspace could not be found.'); return; }
      setWorkspaces(await listWorkspaces());
      setNotice(`${label} was archived. No data was deleted.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not archive this workspace.');
    }
  };
  const restoreArchivedWorkspace = async (id: string) => {
    try {
      const restored = await restoreWorkspace(id);
      if (!restored) { alert('The archived workspace could not be found.'); return; }
      setWorkspaces(await listWorkspaces());
      setNotice('Workspace restored. It is now available in the workspace selector.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not restore this workspace.');
    }
  };
  const filteredWorkspaces = workspaces
    .filter(item => {
      const query = workspaceSearch.trim().toLocaleLowerCase();
      if (!query) return true;
      return [item.data.classInfo.className, item.data.classInfo.section, item.data.academicSession]
        .some(value => String(value || '').toLocaleLowerCase().includes(query));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const currentStudent = data.students.find(s => s.studentId === (selectedStudent || data.students[0]?.studentId));
  const activeTemplate = data.marksheetSettings.reportExams?.length === 1 && singleTemplate ? singleTemplate : template;
  const setSchool = (field: 'name' | 'address' | 'established' | 'registrationNumber' | 'affiliation', value: string) => setData(d => ({ ...d, school: { ...d.school, [field]: value } }));
  const updateStudent = (id: string, field: string, value: any) => {
    if (field === 'roll') {
      const duplicate = data.students.some(student => student.studentId !== id && normalizeRollNumber(student.roll) === normalizeRollNumber(value));
      if (duplicate) { setNotice(`Roll ${value} is already used in Class ${data.classInfo.className}, session ${formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat)}. The composite key is session + class + roll.`); return; }
    }
    setData(d => ({ ...d, students: d.students.map(s => s.studentId === id ? { ...s, [field]: value } : s) }));
  };
  const addStudent = () => {
    let nextRoll = 1; while (data.students.some(student => normalizeRollNumber(student.roll) === normalizeRollNumber(nextRoll))) nextRoll++;
    const s = blankStudent(nextRoll, data.subjects);
    setData(d => ({ ...d, students: [...d.students, s], results: Object.fromEntries(Object.keys(d.results).map(k => [k, [...(d.results[k] || []), emptyMarks(s, d.subjects)]])) as AppData['results'] }));
    setSelectedStudent(s.studentId);
  };
  const deleteStudent = (id: string) => {
    if (!confirm('Delete this student and their marks?')) return;
    setData(d => ({ ...d, students: d.students.filter(s => s.studentId !== id), results: Object.fromEntries(Object.keys(d.results).map(k => [k, (d.results[k] || []).filter(m => m.studentId !== id)])) as AppData['results'] }));
    if (selectedStudent === id) setSelectedStudent('');
  };
  const resetMarks = async () => {
    if (!confirm(`Reset all examination marks for Class ${data.classInfo.className}, session ${formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat)}? Student details, photos, roll numbers and attendance will be preserved.`)) return;
    try {
      setBusy(true);
      await exportZip(data, template, '', 'pre-reset', {}, singleTemplate);
      if (!confirm('The verified class backup download has been started. Confirm that you have saved the ZIP file before clearing marks.')) return;
      const cleared = { ...data, results: Object.fromEntries(Object.keys(data.results).map(key => [key, []])) as AppData['results'] };
      await persistData(cleared); setData(cleared); setNotice('All examination marks were reset. Student details and attendance were preserved.');
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not create and verify the backup. Marks were not reset.'); }
    finally { setBusy(false); }
  };
  const resetStudents = async () => {
    if (!confirm(`Reset all student records for Class ${data.classInfo.className}, session ${formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat)}? This also removes their marks, attendance and photos. School profile and marksheet settings will remain.`)) return;
    try {
      setBusy(true);
      await exportZip(data, template, '', 'pre-reset', {}, singleTemplate);
      if (!confirm('The verified class backup download has been started. Confirm that you have saved the ZIP file before deleting student records.')) return;
      const phrase = prompt(`Type RESET CLASS ${data.classInfo.className} to permanently remove this class/session student data.`);
      if (phrase !== `RESET CLASS ${data.classInfo.className}`) { setNotice('Student reset cancelled. No records were deleted.'); return; }
      const cleared: AppData = { ...data, students: [], results: Object.fromEntries(Object.keys(data.results).map(key => [key, []])) as AppData['results'], classInfo: { ...data.classInfo, totalWorkingDays: 0 } };
      await persistData(cleared); setData(cleared); setSelectedStudent(''); setNotice('Student records, marks and attendance were reset. School and marksheet settings were preserved.');
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not create and verify the backup. Student data was not reset.'); }
    finally { setBusy(false); }
  };
  const openPromotion = () => {
    if (!data.settings.promotionExams.length) { alert('Select at least one examination in Settings → Promotion result calculation.'); return; }
    const currentClassNumber = Number(String(data.classInfo.className).match(/\d+/)?.[0]);
    const suggestedClass = Number.isFinite(currentClassNumber) && currentClassNumber > 0 ? String(currentClassNumber + 1) : '';
    const years = data.academicSession.match(/(\d{4})\s*[-–/]\s*(\d{2,4})/);
    const suggestedSession = years ? formatAcademicSession(`${Number(years[1]) + 1}-${String(Number(years[2].length === 2 ? `20${years[2]}` : years[2]) + 1)}`, data.settings.sessionDisplayFormat) : formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat);
    setPromotionClass(suggestedClass);
    setPromotionSession(suggestedSession);
    setSelectedPromotionIds(data.students.map(student => student.studentId));
    setPromotionRollMode('dynamic');
    setPromotionOpen(true);
  };
  const generatePromotion = async () => {
    if (!promotionClass.trim() || !promotionSession.trim()) { alert('Destination class and academic session are required.'); return; }
    if (!selectedPromotionIds.length) { alert('Select at least one student to promote.'); return; }
    // Guard against rapid repeated clicks while ZIP creation is still running.
    if (promotionGenerationRef.current) return;
    promotionGenerationRef.current = true;
    const selectedRanked = promotionRanked.filter(item => selectedPromotionIds.includes(item.student.studentId));
    try {
      setBusy(true);
      const destinationSession = normalizeAcademicSession(promotionSession.trim());
      await exportPromotionZip(data, template, promotionClass.trim(), destinationSession, selectedPromotionIds, singleTemplate, promotionRollMode);
      setPromotionOpen(false);
      setNotice(`One promotion ZIP generated for ${selectedRanked.length} selected student(s), Class ${promotionClass}, session ${formatAcademicSession(normalizeAcademicSession(promotionSession), data.settings.sessionDisplayFormat)}. ${promotionRollMode === 'static' ? 'Static' : 'Dynamic'} roll assignment was applied. Marks and attendance were excluded.`);
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not generate promotion ZIP.'); }
    finally { promotionGenerationRef.current = false; setBusy(false); }
  };
  const changeExamPreset = (preset: AppData['examPreset']) => {
    const nextOrder = preset === 'custom' ? exams : examPresets[preset];
    if (!nextOrder.length) return;
    setData(d => { const defaults = createDefaultData(); const nextConfigs = { ...d.exams }; const nextResults = { ...d.results }; nextOrder.forEach(key => { if (!nextConfigs[key]) nextConfigs[key] = defaults.exams[key]; if (!nextResults[key]) nextResults[key] = d.students.map(student => emptyMarks(student, d.subjects)); }); return { ...d, examPreset: preset, examOrder: [...nextOrder], exams: nextConfigs, results: nextResults, marksheetSettings: { ...d.marksheetSettings, reportExams: d.marksheetSettings.reportExams.filter(key => nextOrder.includes(key)).length ? d.marksheetSettings.reportExams.filter(key => nextOrder.includes(key)) : [nextOrder[0]], calculationExams: d.marksheetSettings.reportExams.filter(key => nextOrder.includes(key)).length ? d.marksheetSettings.reportExams.filter(key => nextOrder.includes(key)) : [nextOrder[0]] }, settings: { ...d.settings, promotionExams: d.settings.promotionExams.filter(key => nextOrder.includes(key)).length ? d.settings.promotionExams.filter(key => nextOrder.includes(key)) : [...nextOrder] } }; });
    if (!nextOrder.includes(exam)) setExam(nextOrder[0]);
  };
  const addCustomExam = () => {
    const key = `custom_${crypto.randomUUID()}`;
    const label = `Custom Exam ${Object.keys(data.exams).filter(item => item.startsWith('custom_')).length + 1}`;
    setData(d => ({ ...d, examPreset: 'custom', examOrder: [...d.examOrder, key], exams: { ...d.exams, [key]: { name: label, shortName: label, maxMarks: 100, weightage: 100 } }, results: { ...d.results, [key]: d.students.map(student => emptyMarks(student, d.subjects)) }, marksheetSettings: { ...d.marksheetSettings, reportExams: [...d.marksheetSettings.reportExams, key], calculationExams: [...d.marksheetSettings.calculationExams, key] }, settings: { ...d.settings, promotionExams: [...d.settings.promotionExams, key], recommendedExamMarks: [...d.settings.recommendedExamMarks, key] } }));
    setExam(key);
  };
  const moveExam = (key: ExamKey, direction: -1 | 1) => setData(d => { const order = [...d.examOrder]; const index = order.indexOf(key); const next = index + direction; if (index < 0 || next < 0 || next >= order.length) return d; [order[index], order[next]] = [order[next], order[index]]; return { ...d, examPreset: 'custom', examOrder: order }; });
  const removeExam = (key: ExamKey) => {
    if (exams.length <= 1) { alert('At least one examination must remain configured.'); return; }
    if (!confirm(`Remove ${data.exams[key].name} and its stored marks from this workspace? This cannot be undone without a backup.`)) return;
    setData(d => { const nextExams = { ...d.exams }; const nextResults = { ...d.results }; delete nextExams[key]; delete nextResults[key]; const order = d.examOrder.filter(item => item !== key); return { ...d, examPreset: 'custom', examOrder: order, exams: nextExams, results: nextResults, marksheetSettings: { ...d.marksheetSettings, reportExams: d.marksheetSettings.reportExams.filter(item => item !== key), calculationExams: d.marksheetSettings.calculationExams.filter(item => item !== key) }, settings: { ...d.settings, promotionExams: d.settings.promotionExams.filter(item => item !== key), requiredExamMarks: d.settings.requiredExamMarks.filter(item => item !== key), recommendedExamMarks: d.settings.recommendedExamMarks.filter(item => item !== key) } }; });
    if (exam === key) setExam(exams.find(item => item !== key) || '');
  };
  const handleStudentGridKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>, row: number, col: number) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      setStatus('Saving…');
      persistData(data).then(() => setStatus('Saved locally')).catch(() => setStatus('Save failed — retry'));
      return;
    }
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.shiftKey || event.key === 'ArrowUp' ? -1 : 1;
      const targetRow = row + direction;
      if (targetRow >= 0 && targetRow < data.students.length) {
        document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-student-row="${targetRow}"][data-student-col="${col}"]`)?.focus();
      } else if (direction > 0 && row === data.students.length - 1 && event.key === 'Enter') {
        addStudent();
        window.setTimeout(() => document.querySelector<HTMLInputElement>(`[data-student-row="${data.students.length}"][data-student-col="0"]`)?.focus(), 0);
      }
    }
  };
  const handleMarksGridKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (event.key !== 'Enter' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const direction = event.shiftKey || event.key === 'ArrowUp' ? -1 : 1;
    const targetRow = row + direction;
    if (targetRow < 0 || targetRow >= data.students.length) return;
    document.querySelector<HTMLInputElement>(`[data-mark-row="${targetRow}"][data-mark-col="${col}"]`)?.focus();
  };
  const downloadStudentTemplate = () => {
    const headers = data.settings.sectionEnabled ? ['Session','Class','Section','Roll','Name','Father','Mother','Gender'] : ['Session','Class','Roll','Name','Father','Mother','Gender'];
    const example = data.settings.sectionEnabled
      ? [formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat), data.classInfo.className, data.classInfo.section, '1', 'Aarav Kumar', 'Rajesh Kumar', 'Sunita Devi', 'Male']
      : [formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat), data.classInfo.className, '1', 'Aarav Kumar', 'Rajesh Kumar', 'Sunita Devi', 'Male'];
    const csv = [headers, example].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'students-template.csv'; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadAttendanceTemplate = () => {
    const headers = ['Session', 'Class', 'Roll', 'Name', 'Present day'];
    const row = [
      formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat),
      data.classInfo.className,
      '01',
      'Aarav Kumar',
      Math.max(0, Math.min(Number(data.classInfo.totalWorkingDays) || 0, (Number(data.classInfo.totalWorkingDays) || 0) - 2))
    ];
    downloadCsv('attendance-template.csv', [headers, row]);
  };
  const importAttendanceSpreadsheet = async (file?: File) => {
    if (!file) return;
    try {
      const workingDays = Number(data.classInfo.totalWorkingDays);
      if (!Number.isInteger(workingDays) || workingDays <= 0) {
        throw new Error('Set a valid Total class working days value in the Attendance header before importing attendance.');
      }
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheetName = workbook.SheetNames.find(name => name.trim().toLowerCase() === 'attendance') || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) throw new Error('The workbook has no worksheet.');
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
      const normalizeHeader = (value: unknown) => String(value ?? '').replace(/^\uFEFF/, '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
      const aliases = {
        roll: ['roll', 'rollno', 'rollnumber'],
        present: ['presentday', 'presentdays', 'dayspresent', 'present'],
        name: ['name', 'studentname'],
        session: ['session', 'academicsession'],
        className: ['class', 'classname', 'grade'],
        section: ['section', 'sec']
      };
      const headerIndex = matrix.findIndex(row => {
        const values = row.map(normalizeHeader);
        return aliases.roll.some(alias => values.includes(alias)) && aliases.present.some(alias => values.includes(alias));
      });
      if (headerIndex < 0) throw new Error('Could not detect attendance headers. Required columns: Roll and Present day.');
      const headers = (matrix[headerIndex] as unknown[]).map((value, index) => String(value ?? '').trim() || `__column_${index}`);
      const rows = matrix.slice(headerIndex + 1)
        .map((values, index) => ({ rowNumber: headerIndex + index + 2, values: values as unknown[] }))
        .filter(item => item.values.some(value => String(value ?? '').trim() !== ''));
      if (!rows.length) throw new Error('No attendance rows found below the header.');
      const key = (record: Record<string, unknown>, names: string[]) => {
        const wanted = names.map(normalizeHeader);
        const found = Object.keys(record).find(name => wanted.includes(normalizeHeader(name)));
        return found ? record[found] : '';
      };
      const normalizedText = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
      const issues: string[] = [];
      const seen = new Set<string>();
      const parsed: Array<{ student: Student; present: number; rowNumber: number }> = [];
      for (const item of rows) {
        const record = Object.fromEntries(headers.map((header, index) => [header, item.values[index] ?? ''])) as Record<string, unknown>;
        const roll = String(key(record, aliases.roll) ?? '').trim();
        if (!roll) { issues.push(`Row ${item.rowNumber}: Roll is required.`); continue; }
        const normalizedRoll = normalizeRollNumber(roll);
        if (!normalizedRoll) { issues.push(`Row ${item.rowNumber}: Roll "${roll}" is invalid.`); continue; }
        if (seen.has(normalizedRoll)) { issues.push(`Row ${item.rowNumber}: Duplicate roll ${roll} (leading zeros are ignored).`); continue; }

        const sessionValue = String(key(record, aliases.session) ?? '').trim();
        if (sessionValue && normalizeAcademicSession(sessionValue) !== normalizeAcademicSession(data.academicSession)) {
          issues.push(`Row ${item.rowNumber}: Session ${sessionValue} does not match active session ${normalizeAcademicSession(data.academicSession)}.`);
          continue;
        }
        const classValue = String(key(record, aliases.className) ?? '').trim();
        if (classValue && normalizedText(classValue) !== normalizedText(data.classInfo.className)) {
          issues.push(`Row ${item.rowNumber}: Class ${classValue} does not match active class ${data.classInfo.className}.`);
          continue;
        }
        const sectionValue = String(key(record, aliases.section) ?? '').trim();
        if (sectionValue && normalizedText(sectionValue) !== normalizedText(data.classInfo.section)) {
          issues.push(`Row ${item.rowNumber}: Section ${sectionValue} does not match active section ${data.classInfo.section || '(blank)'}.`);
          continue;
        }

        const matchingStudents = data.students.filter(candidate => normalizeRollNumber(candidate.roll) === normalizedRoll);
        if (matchingStudents.length > 1) { issues.push(`Row ${item.rowNumber}: Roll ${roll} is ambiguous because multiple students have equivalent roll numbers (leading zeros ignored).`); continue; }
        const student = matchingStudents[0];
        if (!student) { issues.push(`Row ${item.rowNumber}: Roll ${roll} does not exist in the active class.`); continue; }

        const incomingName = String(key(record, aliases.name) ?? '').trim();
        if (incomingName && normalizedText(incomingName) !== normalizedText(student.name)) {
          issues.push(`Row ${item.rowNumber}: Roll ${roll} belongs to ${student.name}, not ${incomingName}.`);
          continue;
        }
        const rawPresent = key(record, aliases.present);
        if (rawPresent === '' || rawPresent === null || rawPresent === undefined) {
          issues.push(`Row ${item.rowNumber}: Present day is required.`);
          continue;
        }
        const present = Number(rawPresent);
        if (!Number.isInteger(present) || present < 0 || present > workingDays) {
          issues.push(`Row ${item.rowNumber}: Present day must be a whole number between 0 and ${workingDays}.`);
          continue;
        }
        seen.add(normalizedRoll);
        parsed.push({ student, present, rowNumber: item.rowNumber });
      }

      if (!parsed.length) {
        throw new Error(`No valid attendance rows were found.\n\n${issues.slice(0, 25).join('\n')}${issues.length > 25 ? `\n…and ${issues.length - 25} more issue(s).` : ''}`);
      }
      if (issues.length) {
        const continueWithValid = confirm(
          `Attendance validation completed.\n\nValid rows: ${parsed.length}\nRows with errors: ${issues.length}\n\n${issues.slice(0, 12).join('\n')}${issues.length > 12 ? `\n…and ${issues.length - 12} more issue(s).` : ''}\n\nImport only the valid rows? Invalid rows will be skipped.`
        );
        if (!continueWithValid) return;
      }

      const hasExistingAttendance = (student: Student) =>
        Boolean(student.attendance.hasRecord || Number(student.attendance.daysPresent) > 0);
      const conflicts = parsed.filter(item => hasExistingAttendance(item.student));
      let importRows = parsed;
      let skippedExisting = 0;
      if (conflicts.length) {
        const choice = prompt(
          `Existing attendance values were found for ${conflicts.length} imported student(s).\n\n1 = Replace existing attendance for these students\n2 = Skip students that already have attendance\n\nEnter 1 or 2:`,
          '1'
        );
        if (choice === null) return;
        if (choice.trim() === '2') {
          const conflictIds = new Set(conflicts.map(item => item.student.studentId));
          importRows = parsed.filter(item => !conflictIds.has(item.student.studentId));
          skippedExisting = parsed.length - importRows.length;
        } else if (choice.trim() !== '1') {
          alert('Invalid choice. No attendance data was changed.');
          return;
        }
      }
      if (!importRows.length) {
        alert('All valid rows already contain attendance and were skipped. No data was changed.');
        return;
      }

      const preview = importRows.slice(0, 10)
        .map(item => `${item.student.roll} · ${item.student.name}: ${item.present}/${workingDays}`)
        .join('\n');
      if (!confirm(
        `Attendance import preview\n\nClass: ${data.classInfo.className}${data.settings.sectionEnabled && data.classInfo.section ? `-${data.classInfo.section}` : ''}\nSession: ${formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat)}\nWorking days (from attendance header): ${workingDays}\nStudents to update: ${importRows.length}\nInvalid rows skipped: ${issues.length}\nExisting rows skipped: ${skippedExisting}\n\n${preview}${importRows.length > 10 ? `\n…and ${importRows.length - 10} more student(s).` : ''}\n\nContinue?`
      )) return;

      const attendanceById = new Map(importRows.map(item => [item.student.studentId, item.present]));
      const next: AppData = {
        ...data,
        students: data.students.map(student => {
          if (!attendanceById.has(student.studentId)) return student;
          const present = attendanceById.get(student.studentId)!;
          return {
            ...student,
            attendance: {
              ...student.attendance,
              workingDays,
              daysPresent: present,
              daysAbsent: Math.max(0, workingDays - present),
              hasRecord: true
            }
          };
        })
      };
      await persistData(next);
      setData(next);
      setWorkspaces(await listWorkspaces());
      setNotice(`Attendance import completed. Updated ${importRows.length} student(s); ${issues.length} invalid row(s) and ${skippedExisting} existing record(s) were skipped.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to import attendance file.');
    }
  };
  const setMark = (studentId: string, subjectId: string, value: string) => {
    const trimmed = value.trim();
    let parsed: string | number | null = trimmed === '' ? null : Number(trimmed);
    const max = data.exams[exam].maxMarks;
    if (trimmed !== '' && !Number.isFinite(Number(trimmed))) {
      const status = getConfiguredMarkStatus(data, trimmed, false);
      // Keep partial text while typing; final/import validation reports unsupported codes.
      parsed = status ? status.code : trimmed;
    }
    if (typeof parsed === 'number' && (!Number.isFinite(parsed) || parsed < 0 || parsed > max)) return;
    setData(d => ({ ...d, results: { ...d.results, [exam]: d.results[exam].map(m => m.studentId === studentId ? { ...m, [subjectId]: parsed } : m) } }));
  };
  const setExamAbsent = (studentId: string, absent: boolean) => {
    const absentStatus = data.settings.nonNumericMarkStatuses.find(item => item.active && item.isAbsence);
    if (absent && !absentStatus) { alert('Configure an active Absent status in School Profile first.'); return; }
    const existing = data.results[exam].find(row => row.studentId === studentId);
    const hasExistingMarks = data.subjects.some(subject => subject.enabled !== false && existing?.[subject.id] !== null && existing?.[subject.id] !== undefined && String(existing?.[subject.id]).trim() !== '');
    if (absent && hasExistingMarks && !confirm('Marking the entire examination absent will replace all existing subject values for this student with the configured absence value. Continue?')) return;
    const subjectUpdates: Record<string, string | number | null> = {};
    for (const subject of data.subjects.filter(item => item.enabled !== false)) {
      subjectUpdates[subject.id] = absent ? (absentStatus?.code ?? null) : null;
    }
    setData(d => ({
      ...d,
      results: {
        ...d.results,
        [exam]: d.results[exam].map(row =>
          row.studentId === studentId ? { ...row, ...subjectUpdates } : row
        ),
      },
    }));
  };
  const downloadCsv = (filename: string, rows: unknown[][]) => { const csv = rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n'); const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const a=document.createElement('a');a.href=url;a.download=filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000); };
  const downloadExamSample = (key: ExamKey) => { const subjects=data.subjects.filter(s=>s.enabled!==false); const header=['Session','Exam','Class',...(data.settings.sectionEnabled?['Section']:[]),'Roll',...subjects.map(s=>s.name)]; const rows=[header,[formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat),data.exams[key].shortName,data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'1',...subjects.map(()=>2)],[formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat),data.exams[key].shortName,data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'2',...subjects.map(()=>3)]]; downloadCsv(`${key}-marks-sample.csv`,rows); };
  const downloadCombinedSample = () => { const subjects=data.subjects.filter(s=>s.enabled!==false); const wb=XLSX.utils.book_new(); const examHeaders=['Session','Exam','Class',...(data.settings.sectionEnabled?['Section']:[]),'Roll',...subjects.map(s=>s.name)]; const examRows:unknown[][]=[examHeaders]; exams.forEach(k=>{examRows.push([formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat),data.exams[k].shortName,data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'1',...subjects.map(()=>Math.min(3,data.exams[k].maxMarks))]);examRows.push([formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat),data.exams[k].shortName,data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'2',...subjects.map(()=>Math.min(4,data.exams[k].maxMarks))]);}); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(examRows),'Exam Marks'); const studentHeaders=['Session','Class',...(data.settings.sectionEnabled?['Section']:[]),'Roll','Name','Father','Mother','Gender']; const studentRows=[studentHeaders,[formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat),data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'1','Aarav Kumar','Rajesh Kumar','Sunita Devi','Male'],[formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat),data.classInfo.className,...(data.settings.sectionEnabled?[data.classInfo.section]:[]),'2','Priya Kumari','Sanjay Kumar','Meena Devi','Female']]; XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(studentRows),'Students'); XLSX.writeFile(wb,'marksheet-studio-combined-sample.xlsx'); };
  const importSpreadsheet = async (file?: File, selectedMode: 'students' | ExamKey = importMode) => {
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const preferredSheet = selectedMode === 'students' ? 'students' : 'exam marks';
      const selectedSheetName = wb.SheetNames.find(name => name.trim().toLowerCase() === preferredSheet) || wb.SheetNames[0];
      const firstSheet = wb.Sheets[selectedSheetName];
      if (!firstSheet) throw new Error('The workbook has no worksheet.');
      const matrix = XLSX.utils.sheet_to_json<any[]>(firstSheet, { header: 1, defval: '', blankrows: true });
      const normalizeHeader = (value: unknown) => String(value ?? '').toLowerCase().trim().replace(/[ _-]/g, '');
      const requiredHeaderSets = selectedMode === 'students'
        ? [['roll','rollno','rollnumber'], ['name','studentname']]
        : [['roll','rollno','rollnumber']];
      const headerIndex = matrix.findIndex(row => {
        const values = row.map(normalizeHeader);
        return requiredHeaderSets.every(aliases => aliases.some(alias => values.includes(alias))) && (selectedMode === 'students' ? values.some(v => ['name','studentname'].includes(v)) : values.some(v => data.subjects.some(subject => normalizeHeader(subject.name) === v || normalizeHeader(subject.id) === v)));
      });
      if (headerIndex < 0) throw new Error('Could not detect the column header row. Required columns include Roll and Name (student import), or Roll and Exam (result import). A Class column is recommended.');
      const headers = (matrix[headerIndex] as unknown[]).map((value, index) => String(value ?? '').trim() || `__column_${index}`);
      const rows = matrix.slice(headerIndex + 1).filter(row => row.some(value => String(value ?? '').trim() !== '')).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as Record<string, any>);
      if (!rows.length) throw new Error('No data rows found below the detected header row.');
      const normalizeKey = (value: string) => value.toLowerCase().trim().replace(/[ _-]/g, '');
      const key = (obj: Record<string, any>, names: string[]) => {
        const wanted = names.map(normalizeKey);
        const found = Object.keys(obj).find(k => wanted.includes(normalizeKey(k)));
        return found ? obj[found] : '';
      };
      const examFromValue = (value: unknown): ExamKey | undefined => {
        const v = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const configuredMatch = data.examOrder.find(key => {
          const config = data.exams[key];
          return [key, config?.shortName, config?.name].some(label => String(label || '').toLowerCase().replace(/[^a-z0-9]/g, '') === v);
        });
        if (configuredMatch) return configuredMatch;
        const aliases: Record<string, ExamKey> = {
          pa1: 'pa1', pai: 'pa1', periodicassessment1: 'pa1', periodicassessmenti: 'pa1', periodicassessmentone: 'pa1',
          pa2: 'pa2', paii: 'pa2', periodicassessment2: 'pa2', periodicassessmentii: 'pa2', periodicassessmenttwo: 'pa2',
          hy: 'hy', halfyearly: 'hy', halfyearexam: 'hy', halfyearexamination: 'hy',
          pa3: 'pa3', paiii: 'pa3', periodicassessment3: 'pa3', periodicassessmentiii: 'pa3',
          pa4: 'pa4', paiv: 'pa4', periodicassessment4: 'pa4', periodicassessmentiv: 'pa4',
          final: 'final', finalexam: 'final', finalexamination: 'final'
        };
        const alias = aliases[v];
        return alias && data.examOrder.includes(alias) ? alias : undefined;
      };
      if (selectedMode === 'students') {
        const imported = rows.map((r, i) => {
          const s = blankStudent(i + 1, data.subjects);
          s.roll = String(key(r, ['roll','rollno','rollnumber']) ?? '').trim();
          s.name = String(key(r, ['name','studentname']) ?? '').trim();
          s.father = String(key(r, ['father','fathername']) ?? '').trim();
          s.mother = String(key(r, ['mother','mothername']) ?? '').trim();
          s.dob = String(key(r, ['dob','dateofbirth']) ?? '').trim();
          const rawGender = String(key(r, ['gender','sex']) ?? '').trim();
          const genderKey = rawGender.toLowerCase();
          s.gender = !rawGender ? '' : ['m','male','boy'].includes(genderKey) ? 'Male' : ['f','female','girl'].includes(genderKey) ? 'Female' : ['other','others'].includes(genderKey) ? 'Other' : rawGender;
          return { student: s, session: normalizeAcademicSession(String(key(r, ['session','academicsession']) ?? '').trim() || data.academicSession), className: String(key(r, ['class','classname','grade']) ?? '').trim(), section: String(key(r, ['section','sec']) ?? '').trim(), row: headerIndex + i + 2 };
        });
        const errors: string[] = [];
        imported.forEach(item => { if (!item.student.roll) errors.push(`Row ${item.row}: Roll is required.`); if (!item.student.name) errors.push(`Row ${item.row}: Name is required.`); });
        const invalidRows = new Set<number>();
        imported.forEach(item => { if (!item.student.roll || !item.student.name) invalidRows.add(item.row); });
        const valid = imported.filter(item => !invalidRows.has(item.row));
        if (!valid.length) throw new Error(`No valid student rows found.\n${errors.slice(0, 15).join('\n')}`);
        const compositeKeys = new Set<string>();
        valid.forEach(item => {
          const composite = `${normalizeAcademicSession(item.session || data.academicSession)}|${item.className || data.classInfo.className}|${normalizeRollNumber(item.student.roll)}`;
          if (compositeKeys.has(composite)) throw new Error(`Duplicate composite key found: session + class + roll (${composite.replace(/\|/g, ' / ')}).`);
          compositeKeys.add(composite);
        });
        const groupMap = new Map<string, typeof valid>();
        valid.forEach(item => {
          const groupSession = normalizeAcademicSession(item.session || data.academicSession);
          const groupClass = item.className || data.classInfo.className;
          const groupSection = data.settings.sectionEnabled ? (item.section || '') : '';
          const groupKey = [groupSession, groupClass, groupSection].join('|');
          groupMap.set(groupKey, [...(groupMap.get(groupKey) || []), item]);
        });
        const groups = [...groupMap.entries()];
        const classNames = [...new Set(valid.map(item => item.className || data.classInfo.className))];
        if (classNames.length > 1 && !data.settings.allowMultipleClassImport) {
          throw new Error(`Multiple classes detected in this file: ${classNames.join(', ')}.\n\nThe setting "Allowed multiple class import" is currently unchecked. Enable it in Settings to permit multi-class imports, or split the file into one class per file.`);
        }
        if (classNames.length > 1 && !confirm(`Multiple classes detected.\n\n${classNames.map(name => `Class ${name}: ${valid.filter(item => (item.className || data.classInfo.className) === name).length} student(s)`).join('\n')}\n\nEach class will be saved in a separate workspace. Continue?`)) return;
        const hasDifferentClass = classNames.some(name => name !== data.classInfo.className);
        if (classNames.length === 1 && hasDifferentClass && !confirm(`Class mismatch detected.\n\nSelected in app: Class ${data.classInfo.className}\nFound in file: Class ${classNames[0]}\n\nThe class in the file has priority. Import into Class ${classNames[0]}?`)) return;
        let hasStudentConflicts = false;
        for (const [groupKey, groupRows] of groups) {
          const [session, className, sectionValue] = groupKey.split('|');
          const existingWorkspace = await loadWorkspace(workspaceId({ ...data, academicSession: session, classInfo: { ...data.classInfo, className, section: sectionValue } }));
          const existingRolls = new Set((existingWorkspace?.students || (className === data.classInfo.className && normalizeAcademicSession(session) === normalizeAcademicSession(data.academicSession) ? data.students : [])).map(st => normalizeRollNumber(st.roll)));
          if (groupRows.some(item => existingRolls.has(normalizeRollNumber(item.student.roll)))) { hasStudentConflicts = true; break; }
        }
        let strategy = '1';
        if (hasStudentConflicts) {
          const strategyRaw = prompt('Existing student conflicts detected. Choose import policy:\n1 = Preserve existing values and add new students (default)\n2 = Update matching student details\n3 = Replace the student list for each imported class (backup required)\n4 = Skip rows matching existing students', '1') || '1';
          strategy = ['1','2','3','4'].includes(strategyRaw) ? strategyRaw : '1';
        }
        const prepared: AppData[] = [];
        let inserted = 0, updated = 0, preserved = 0, skipped = 0;
        for (const [groupKey, groupRows] of groups) {
          const [session, className, sectionValue] = groupKey.split('|');
          const subjects = subjectsForClass(className);
          const groupBase = await loadWorkspace(workspaceId({ ...data, academicSession: session, classInfo: { ...data.classInfo, className, section: sectionValue } }));
          const base = normalizeData(groupBase || { ...data, academicSession: session, classInfo: { ...data.classInfo, className, section: sectionValue }, subjects, students: [], results: Object.fromEntries(exams.map(k=>[k,[]])) });
          const existingRollKeys = base.students.map(st => normalizeRollNumber(st.roll)).filter(Boolean);
          if (new Set(existingRollKeys).size !== existingRollKeys.length) throw new Error(`Class ${className}, session ${session} already contains duplicate roll numbers after leading-zero normalization. Resolve those student records before importing.`);
          const existingByRoll = new Map<string, Student>(base.students.filter(st => st.roll.trim()).map(st => [normalizeRollNumber(st.roll), st] as [string, Student]));
          const incoming = groupRows.map(item => item.student);
          const seen = new Set<string>();
          for (const student of incoming) { const k = normalizeRollNumber(student.roll); if (seen.has(k)) throw new Error(`Duplicate roll ${student.roll} found in Class ${className}, session ${session}.`); seen.add(k); }
          const conflicts = incoming.filter(st => existingByRoll.has(normalizeRollNumber(st.roll)));
          if (strategy === '3' && conflicts.length) {
            await exportZip(base, template, '', 'pre-replace', {}, singleTemplate);
            if (!confirm(`A pre-replacement backup download was started for Class ${className}, session ${session}. Confirm it is saved before replacing this class roster.`)) throw new Error('Replacement cancelled.');
          }
          const importedStudents: Student[] = [];
          for (const student of incoming) {
            const existing = existingByRoll.get(normalizeRollNumber(student.roll));
            if (!existing) { importedStudents.push(student); inserted++; continue; }
            if (strategy === '4') { skipped++; importedStudents.push(existing); continue; }
            if (strategy === '1') { preserved++; importedStudents.push(existing); continue; }
            const updatedStudent = { ...existing, ...student, studentId: existing.studentId, photo: existing.photo, attendance: existing.attendance, remarks: existing.remarks };
            importedStudents.push(updatedStudent); updated++;
          }
          const finalStudents = strategy === '3' ? incoming.map(st => { const old = existingByRoll.get(normalizeRollNumber(st.roll)); return old ? { ...st, studentId: old.studentId, photo: old.photo, attendance: old.attendance, remarks: old.remarks } : st; }) : [...base.students.filter(old => !incoming.some(st => normalizeRollNumber(st.roll) === normalizeRollNumber(old.roll))), ...importedStudents];
          const nextResults = Object.fromEntries(Object.keys(base.results).map(k => [k, finalStudents.map(st => { const old = (base.results[k] || []).find(m => m.studentId === st.studentId); return { ...emptyMarks(st, subjects), ...(old || {}), studentId: st.studentId, roll: st.roll }; })])) as AppData['results'];
          const next = normalizeData({ ...base, academicSession: session, classInfo: { ...base.classInfo, className, section: sectionValue }, subjects, students: finalStudents, results: nextResults });
          await persistWorkspace(next); prepared.push(next);
        }
        const active = prepared.find(item => item.classInfo.className === data.classInfo.className && normalizeAcademicSession(item.academicSession) === normalizeAcademicSession(data.academicSession)) || prepared[0];
        await persistData(active); setData(active); setSelectedStudent(active.students[0]?.studentId || ''); setWorkspaces(await listWorkspaces());
        setNotice(`Student import completed across ${prepared.length} class/session workspace(s). Added ${inserted}, updated ${updated}, preserved ${preserved}, skipped ${skipped}.`);
      } else {
        if (!selectedUploadExams.length) throw new Error('Select at least one exam checkbox before importing results.');
        const selected: ExamKey[] = selectedUploadExams;
        const hasExamColumn = rows.some(r => String(key(r, ['exam','examname','examtype','assessment']) ?? '').trim() !== '');
        if (!hasExamColumn && selected.length !== 1) throw new Error('This file has no Exam column. Select exactly one exam, or add an Exam column with PA1, PA2, HY, PA3, PA4, or FINAL values.');
        const groupMap = new Map<string, Array<{ row: Record<string, any>; rowNumber: number }>>();
        rows.forEach((row, index) => {
          const session = normalizeAcademicSession(String(key(row, ['session','academicsession']) ?? '').trim() || data.academicSession);
          const className = String(key(row, ['class','classname','grade']) ?? '').trim() || data.classInfo.className;
          const sectionValue = data.settings.sectionEnabled ? (String(key(row, ['section','sec']) ?? '').trim() || data.classInfo.section || '') : '';
          const groupKey = [session, className, sectionValue].join('|');
          groupMap.set(groupKey, [...(groupMap.get(groupKey) || []), { row, rowNumber: headerIndex + index + 2 }]);
        });
        const groups = [...groupMap.entries()];
        const classes = [...new Set(groups.map(([group]) => group.split('|')[1]))];
        if (classes.length === 1 && classes[0] !== data.classInfo.className && !confirm(`Class mismatch detected.\n\nSelected in app: Class ${data.classInfo.className}\nFound in file: Class ${classes[0]}\n\nThe class in the file has priority. The result file will be applied to the saved Class ${classes[0]} workspace.`)) return;
        if (classes.length > 1 && !data.settings.allowMultipleClassImport) throw new Error(`Multiple classes detected: ${classes.join(', ')}. Enable "Allowed multiple class import" in Settings or split the file by class.`);
        if (classes.length > 1 && !confirm(`Multiple classes detected in result file:\n${classes.map(name => `Class ${name}: ${rows.filter(r => String(key(r,['class','classname','grade']) || data.classInfo.className).trim()===name).length} row(s)`).join('\n')}\n\nEach class will be imported into its own saved workspace. Continue?`)) return;
        const strategyRaw = prompt('How should existing examination marks be handled?\n1 = Preserve existing marks (default)\n2 = Update matching marks from this file\n3 = Replace selected exam data for these class/session groups (backup required)\n4 = Skip rows that already have marks', '2') || '2';
        const strategy = ['1','2','3','4'].includes(strategyRaw) ? strategyRaw : '2';
        let totalValid = 0, totalUpdated = 0, totalSkipped = 0, totalIssues = 0;
        const issueLines: string[] = [];
        const prepared: AppData[] = [];
        for (const [groupKey, groupRows] of groups) {
          const [session, className, sectionValue] = groupKey.split('|');
          const workspaceKey = workspaceId({ ...data, academicSession: session, classInfo: { ...data.classInfo, className, section: sectionValue } });
          const stored = await loadWorkspace(workspaceKey);
          const target = normalizeData(stored || (className === data.classInfo.className && normalizeAcademicSession(session) === normalizeAcademicSession(data.academicSession)
            ? data
            : { ...data, academicSession: session, classInfo: { ...data.classInfo, className, section: sectionValue }, subjects: subjectsForClass(className), students: [], results: Object.fromEntries(exams.map(k=>[k,[]])) }));
          if (!stored && (className !== data.classInfo.className || normalizeAcademicSession(session) !== normalizeAcademicSession(data.academicSession))) throw new Error(`Class ${className}, session ${session} has no saved student workspace. Import student details or open that workspace before importing results.`);
          const planned = Object.fromEntries(getExamKeys(target).map(key => [key, []])) as AppData['results'];
          const seenResultRows = new Set<string>();
          const foundExams = new Set<ExamKey>();
          for (const { row, rowNumber } of groupRows) {
            const rowExam: ExamKey | undefined = hasExamColumn ? examFromValue(key(row, ['exam','examname','examtype','assessment'])) : selected[0];
            if (!rowExam) { issueLines.push(`Row ${rowNumber}: Unknown or missing exam name.`); continue; }
            if (!selected.includes(rowExam)) { totalSkipped++; continue; }
            foundExams.add(rowExam);
            const roll = String(key(row, ['roll','rollno','rollnumber']) ?? '').trim();
            if (!roll) { issueLines.push(`Row ${rowNumber}: Roll is required.`); continue; }
            const matchingStudents = target.students.filter(st => normalizeRollNumber(st.roll) === normalizeRollNumber(roll));
            if (matchingStudents.length > 1) { issueLines.push(`Row ${rowNumber}: Roll ${roll} is ambiguous because multiple students have equivalent roll numbers (leading zeros ignored).`); continue; }
            const student = matchingStudents[0];
            if (!student) { issueLines.push(`Row ${rowNumber}: Student roll ${roll || '(blank)'} was not found in Class ${className}.`); continue; }
            const uniqueRowKey = `${rowExam}:${student.studentId}`;
            if (seenResultRows.has(uniqueRowKey)) { issueLines.push(`Row ${rowNumber}: Duplicate result row for ${rowExam.toUpperCase()}, roll ${roll}.`); continue; }
            seenResultRows.add(uniqueRowKey);
            const existing = target.results[rowExam].find(mark => mark.studentId === student.studentId) || emptyMarks(student, target.subjects);
            const next: any = { ...existing, studentId: student.studentId, roll: student.roll };
            let rowValid = true;
            target.subjects.forEach(subject => {
              const rawValue = key(row, [subject.id, subject.name, `${subject.name} marks`, `${subject.name} mark`]);
              if (rawValue === '' || rawValue === null || rawValue === undefined) return;
              const textValue = String(rawValue).trim();
              if (textValue === '') return;
              const value = Number(textValue);
              if (Number.isFinite(value)) {
                if (value < 0 || value > target.exams[rowExam].maxMarks) { issueLines.push(`Row ${rowNumber} (${rowExam.toUpperCase()}, roll ${roll}): ${subject.name} must be between 0 and ${target.exams[rowExam].maxMarks}.`); rowValid = false; }
                else next[subject.id] = value;
              } else {
                const status = getConfiguredMarkStatus(target, textValue, false);
                if (!status) { issueLines.push(`Row ${rowNumber} (${rowExam.toUpperCase()}, roll ${roll}): ${subject.name} value "${textValue}" is not a configured non-numeric marks value.`); rowValid = false; }
                else next[subject.id] = status.code;
              }
            });
            if (!rowValid) continue;
            if (target.results[rowExam].some(mark => mark.studentId === student.studentId)) totalUpdated++;
            planned[rowExam].push(next); totalValid++;
          }
          if (hasExamColumn) selected.filter(k => !foundExams.has(k)).forEach(k => issueLines.push(`Class ${className}: No rows for selected exam ${target.exams[k].name} were found.`));
          if (strategy === '3') {
            await exportZip(target, template, '', 'pre-replace', {}, singleTemplate);
            if (!confirm(`A verified backup download was started for Class ${className}, session ${session}. Confirm that it is saved before replacing selected exam data.`)) throw new Error('Result replacement cancelled.');
          }
          const nextResults = { ...target.results };
          for (const examKey of selected) {
            const incoming = planned[examKey];
            if (strategy === '3') nextResults[examKey] = [];
            const incomingById = new Map(incoming.map(mark => [mark.studentId, mark] as [string, (typeof incoming)[number]]));
            nextResults[examKey] = nextResults[examKey].map(old => {
              const incomingMark = incomingById.get(old.studentId);
              if (!incomingMark) return old;
              if (strategy === '4') { totalSkipped++; return old; }
              if (strategy === '1') {
                const preserved = { ...old } as typeof old;
                target.subjects.forEach(subject => { if (preserved[subject.id] === null || preserved[subject.id] === undefined || preserved[subject.id] === '') preserved[subject.id] = incomingMark[subject.id] ?? null; });
                totalSkipped++;
                return preserved;
              }
              return { ...old, ...incomingMark };
            });
            incoming.forEach(mark => {
              const exists = nextResults[examKey].some(old => old.studentId === mark.studentId);
              if (!exists) nextResults[examKey].push(mark);
            });
          }
          const next = { ...target, results: nextResults };
          await persistWorkspace(next); prepared.push(next);
        }
        if (!totalValid) throw new Error(`No valid result rows were imported.\n${issueLines.slice(0, 15).join('\n')}`);
        const active = prepared.find(item => item.classInfo.className === data.classInfo.className && normalizeAcademicSession(item.academicSession) === normalizeAcademicSession(data.academicSession)) || prepared[0];
        await persistData(active); setData(active); setWorkspaces(await listWorkspaces());
        totalIssues = issueLines.length;
        setNotice(`Result import completed for ${prepared.length} class/session workspace(s). Valid rows: ${totalValid}; existing rows reviewed: ${totalUpdated}; skipped: ${totalSkipped}; issues: ${totalIssues}.`);
        if (issueLines.length) alert(`Some result rows need attention:\n\n${issueLines.slice(0, 15).join('\n')}${issueLines.length>15?'\n…':''}`);
      }
    } catch (e) { alert(e instanceof Error ? e.message : 'Unable to import file.'); }
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const restored = await importZip(file);
      const incoming = restored.data;
      const existing = await loadWorkspace(workspaceId(incoming));
      const previewText = `Backup preview\n\nType: ${restored.backupType}\nClass: ${incoming.classInfo.className}${incoming.classInfo.section ? `-${incoming.classInfo.section}` : ''}\nSession: ${formatAcademicSession(incoming.academicSession, incoming.settings.sessionDisplayFormat)}\nStudents: ${incoming.students.length}\nExaminations: ${incoming.examOrder.map(key => incoming.exams[key]?.shortName || key).join(', ')}\nSubjects: ${incoming.subjects.length}\nExisting workspace conflict: ${existing ? `YES (${existing.students.length} current students)` : 'No'}\nTemplate included: ${restored.template ? 'Yes' : 'No'}\nSingle-exam template included: ${restored.singleTemplate ? 'Yes' : 'No'}\n\n${existing ? 'This will replace the matching class/session workspace. Other workspaces will be retained.' : 'This will create/open this class/session workspace.'}`;
      if (!confirm(previewText + '\n\nContinue with restore?')) return;
      if (restored.template) setTemplate(restored.template);
      if (restored.singleTemplate) setSingleTemplate(restored.singleTemplate);
      await persistData(incoming); setData(incoming); setSelectedStudent(incoming.students[0]?.studentId || ''); setWorkspaces(await listWorkspaces()); setNotice(existing ? 'Backup restored. The matching class/session workspace was replaced; other workspaces were retained.' : 'Backup restored as a new class/session workspace.');
    } catch (e) { alert(e instanceof Error ? e.message : 'Unable to restore ZIP.'); }
  };
  const uploadAsset = async (file: File | undefined, kind: 'logoLeft' | 'logoRight' | 'watermark') => {
    if (!file) return;
    const image = await fileToDataUrl(file);
    setData(d => ({ ...d, school: { ...d.school, [kind]: image, ...(kind === 'logoLeft' ? { logo: image } : {}) } }));
  };
  const openCombinedDocument = (pages: string[], mode: 'preview' | 'print') => {
    const parsed = pages.map(html => new DOMParser().parseFromString(html, 'text/html'));
    const first = parsed[0];
    if (!first) throw new Error('No marksheets were generated.');
    const head = first.head.innerHTML;
    const pageMarkup = parsed.map(doc => {
      const sheet = doc.querySelector<HTMLElement>('.sheet');
      if (!sheet) throw new Error('The supplied HTML template does not contain the expected .sheet element.');
      return `<div class="generated-page">${sheet.outerHTML}</div>`;
    }).join('');
    const combined = `<!doctype html><html lang="en"><head>${head}<style>
      @page{size:A4 portrait;margin:0}
      html,body{margin:0!important;padding:0!important;width:210mm!important}
      .generated-page{width:210mm;height:297mm;overflow:hidden;position:relative;break-after:page;page-break-after:always}
      .generated-page:last-child{break-after:auto;page-break-after:auto}
      .generated-page .sheet{width:210mm!important;height:296mm!important;max-height:296mm!important;min-height:296mm!important;margin:0!important;overflow:hidden!important;break-inside:avoid!important;page-break-inside:avoid!important;box-shadow:none!important}
      @media screen{body{width:auto!important;min-width:0!important;background:#e0e0e0!important}.generated-page{margin:10px auto;width:210mm;height:297mm;background:#fff;box-shadow:0 1px 6px #0003}.generated-page .sheet{margin:0!important}}
      @media print{html,body{background:#fff!important}.generated-page{margin:0!important;box-shadow:none!important}.generated-page .sheet{margin:0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body class="A4 ${mode === 'print' ? 'print-document' : 'preview-document'}">${pageMarkup}</body></html>`;
    return combined;
  };
  const waitForDocumentReady = async (win: Window) => {
    await new Promise<void>(resolve => {
      if (win.document.readyState === 'complete') resolve();
      else win.addEventListener('load', () => resolve(), { once: true });
    });
    try { await (win.document as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* fonts are optional */ }
    await Promise.all([...win.document.images].map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
      window.setTimeout(resolve, 4000);
    })));
  };
  const studentHasNumericReportMark = (student: Student) => {
    const reportKeys = (data.marksheetSettings.reportExams?.length ? data.marksheetSettings.reportExams : exams).filter(key => exams.includes(key));
    return reportKeys.some(key => {
      const row = data.results[key]?.find(mark => mark.studentId === student.studentId);
      return data.subjects.some(subject => { const value=row?.[subject.id]; return value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)); });
    });
  };
  const confirmOutputReadiness = (action: string, studentIds?: string[]) => {
    const targetReadiness = studentIds ? getDataReadiness(data, studentIds) : readiness;
    const requiredFieldLabels: Record<string, string> = {
      roll: 'Roll number', name: 'Student name', father: 'Father name', mother: 'Mother name',
      dob: 'Date of birth', gender: 'Gender', photo: 'Student photo'
    };
    const groupStudentIssues = (recommended: boolean) => {
      const grouped = new Map<string, { student: Student; details: string[]; marks: Map<string, string[]> }>();
      const ensure = (student: Student) => {
        let entry = grouped.get(student.studentId);
        if (!entry) { entry = { student, details: [], marks: new Map() }; grouped.set(student.studentId, entry); }
        return entry;
      };
      const fields = Object.keys(requiredFieldLabels) as Array<keyof typeof requiredFieldLabels>;
      for (const student of targetReadiness.totalStudents ? (studentIds ? data.students.filter(item => studentIds.includes(item.studentId)) : data.students) : []) {
        for (const field of fields) {
          const level = getValidationLevel(data, `student.${field}`);
          const missing = !String((student as any)[field] ?? '').trim();
          if (missing && level === (recommended ? 'recommended' : 'required')) ensure(student).details.push(requiredFieldLabels[field]);
        }
      }
      const marks = recommended ? targetReadiness.recommendedMarksMissing : targetReadiness.requiredMarksMissing;
      for (const item of marks) {
        const entry = ensure(item.student);
        const examName = data.exams[item.exam]?.shortName || item.exam;
        const current = entry.marks.get(examName) || [];
        current.push(item.subject);
        entry.marks.set(examName, current);
      }
      return [...grouped.values()];
    };
    const requiredStudents = groupStudentIssues(false);
    const blocking = requiredStudents.length + targetReadiness.missingRequiredItems.length;
    const formatStudentGroups = (groups: ReturnType<typeof groupStudentIssues>) => groups.map(({ student, details, marks }) => {
      const lines = [`Roll ${student.roll || '—'} · ${student.name || 'Unnamed student'}`];
      if (details.length) lines.push(`  Missing details: ${details.join(', ')}`);
      for (const [examName, subjects] of marks) lines.push(`  ${examName}: ${subjects.join(', ')} marks missing`);
      return lines.join('\n');
    });
    if (blocking) {
      const sections = formatStudentGroups(requiredStudents);
      const otherItems = targetReadiness.missingRequiredItems.map(item => `${item.label}${item.detail ? ` · ${item.detail}` : ''} missing`);
      const examples = [...sections, ...otherItems.map(item => `Other required information\n  ${item}`)];
      const totalMissing = targetReadiness.missingRequiredStudents.length + targetReadiness.requiredMarksMissing.length + targetReadiness.missingRequiredItems.length;
      const visible = examples.slice(0, 12);
      alert(`${action} is blocked because required data is incomplete.\n\n${requiredStudents.length} student(s) have missing required data · ${targetReadiness.requiredMarksMissing.length} required mark(s) missing · ${targetReadiness.missingRequiredItems.length} other required item(s) missing.\n\n${visible.join('\n\n')}${examples.length > visible.length ? `\n\n…and ${examples.length - visible.length} more student/item group(s).` : ''}\n\nTotal missing entries: ${totalMissing}.`);
      return false;
    }
    const recommendedStudents = groupStudentIssues(true);
    const recommendedOther = targetReadiness.missingRecommendedItems.map(item => `${item.label}${item.detail ? ` · ${item.detail}` : ''}`);
    const recommendedCount = targetReadiness.missingRecommendedStudents.length + targetReadiness.recommendedMarksMissing.length + recommendedOther.length;
    if (recommendedCount) {
      const entries = [...formatStudentGroups(recommendedStudents), ...recommendedOther.map(item => `Other recommended information\n  ${item}`)];
      const visibleEntries = entries.slice(0, 20);
      const remaining = entries.length - visibleEntries.length;
      const details = visibleEntries.join('\n\n') + (remaining > 0 ? `\n\n…and ${remaining} more student/item group(s).` : '');
      if (!confirm(`${recommendedStudents.length} student(s) have recommended information missing · ${recommendedCount} recommended item(s) total. These do not block output.\n\n${details}\n\nContinue to ${action.toLowerCase()}?`)) return false;
    }
    return true;
  };
  const preview = async () => {
    if (!activeTemplate || !currentStudent) { alert('Add or import at least one student first.'); return; }
    if (!studentHasNumericReportMark(currentStudent)) { alert('This student has no numeric marks in the selected examination(s). A marksheet will not be generated.'); return; }
    if (!confirmOutputReadiness('Preview', [currentStudent.studentId])) return;
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to preview the marksheet.'); return; }
    try {
      const html = await renderMarksheet(activeTemplate, data, currentStudent);
      win.document.open(); win.document.write(html); win.document.close();
    } catch (e) { win.close(); alert(e instanceof Error ? e.message : 'Unable to generate marksheet preview.'); }
  };
  const previewAll = async () => {
    if (!activeTemplate || !data.students.length) { alert('Add or import students first.'); return; }
    const eligibleStudents = data.students.filter(studentHasNumericReportMark);
    if (!eligibleStudents.length) { alert('No marksheets can be generated: no student has numeric marks in the selected examination(s).'); return; }
    if (eligibleStudents.length !== data.students.length && !confirm(`${data.students.length - eligibleStudents.length} student(s) have no numeric marks in the selected examination(s) and will be skipped. Continue with ${eligibleStudents.length} marksheet(s)?`)) return;
    if (!confirmOutputReadiness('Preview all', eligibleStudents.map(student=>student.studentId))) return;
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to preview marksheets.'); return; }
    try {
      setBusy(true);
      const rendered = await Promise.all(eligibleStudents.map(s => renderMarksheet(activeTemplate, data, s)));
      win.document.open(); win.document.write(openCombinedDocument(rendered, 'preview')); win.document.close();
      await waitForDocumentReady(win);
    } catch (e) { win.close(); alert(e instanceof Error ? e.message : 'Unable to generate class preview.'); }
    finally { setBusy(false); }
  };
  const printAll = async () => {
    if (!activeTemplate || !data.students.length) { alert('Add or import students first.'); return; }
    const eligibleStudents = data.students.filter(studentHasNumericReportMark);
    if (!eligibleStudents.length) { alert('No marksheets can be generated: no student has numeric marks in the selected examination(s).'); return; }
    if (eligibleStudents.length !== data.students.length && !confirm(`${data.students.length - eligibleStudents.length} student(s) have no numeric marks in the selected examination(s) and will be skipped. Continue with ${eligibleStudents.length} marksheet(s)?`)) return;
    if (!confirmOutputReadiness('Print all', eligibleStudents.map(student=>student.studentId))) return;
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to print marksheets.'); return; }
    try {
      setBusy(true);
      const rendered = await Promise.all(eligibleStudents.map(s => renderMarksheet(activeTemplate, data, s)));
      win.document.open(); win.document.write(openCombinedDocument(rendered, 'print')); win.document.close();
      await waitForDocumentReady(win);
      win.focus();
      win.print();
    } catch (e) { win.close(); alert(e instanceof Error ? e.message : 'Unable to generate class marksheets.'); }
    finally { setBusy(false); }
  };
  const downloadMarksheets = async () => {
    if (!activeTemplate || !data.students.length) { alert('Add students before downloading marksheets.'); return; }
    const targets = exportSelection === 'current'
      ? data.students.filter(student => student.studentId === (selectedStudent || currentStudent?.studentId))
      : exportSelection === 'selected'
        ? data.students.filter(student => exportSelectedIds.includes(student.studentId))
        : data.students;
    if (!targets.length) { alert('Select at least one student to download.'); return; }
    const eligibleTargets = targets.filter(studentHasNumericReportMark);
    if (!eligibleTargets.length) { alert('No marksheets can be generated: the selected student(s) have no numeric marks in the selected examination(s).'); return; }
    if (eligibleTargets.length !== targets.length && !confirm(`${targets.length - eligibleTargets.length} selected student(s) have no numeric marks in the selected examination(s) and will be skipped. Continue with ${eligibleTargets.length} marksheet(s)?`)) return;
    if (!confirmOutputReadiness('Download marksheets', eligibleTargets.map(student => student.studentId))) return;
    exportCancelledRef.current = false;
    setBusy(true);
    setExportProgress({ completed: 0, total: eligibleTargets.length });
    try {
      const pages: Array<{ html: string; student: Student }> = [];
      for (const student of eligibleTargets) {
        if (exportCancelledRef.current) throw new DOMException('Export cancelled.', 'AbortError');
        pages.push({ html: await renderMarksheet(activeTemplate, data, student), student });
      }
      await exportMarksheets(pages, {
        format: exportFormat,
        pdfMode: exportPdfMode,
        onProgress: (completed, total) => setExportProgress({ completed, total }),
        isCancelled: () => exportCancelledRef.current
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        alert(error instanceof Error ? error.message : 'Unable to export marksheets.');
      }
    } finally {
      setBusy(false);
      setExportProgress(null);
      exportCancelledRef.current = false;
    }
  };
  const importHeaderAliases: Record<string, string[]> = {
    Roll: ['roll','rollno','rollnumber'], Name: ['name','studentname'], Father: ['father','fathername'], Mother: ['mother','mothername'],
    DOB: ['dob','dateofbirth'], Gender: ['gender','sex'],
    Session: ['session','academicsession'], Class: ['class','classname','grade'], Section: ['section','sec'],
    Exam: ['exam','examname','examtype','assessment'], 'Present day': ['presentday','presentdays','dayspresent','present','attendance'],
    'Working days': ['workingdays','totalworkingdays','totaldays']
  };
  const normalizeImportHeader = (value: unknown) => String(value ?? '').replace(/^\uFEFF/, '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const makeSingleSheetFile = (matrix: unknown[][], name = 'prepared-import.xlsx') => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(matrix), 'Import');
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    return new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };
  const continueImportFromSheet = async (file: File, kind: 'attendance' | 'students' | 'marks', mode: 'students' | ExamKey, sheetName: string) => {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) throw new Error(`Worksheet "${sheetName}" was not found.`);
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
      if (!matrix.length) throw new Error('The selected worksheet is empty.');
      const fields = kind === 'attendance'
        ? ['Roll','Present day','Working days','Name','Session','Class','Section']
        : kind === 'students'
          ? ['Session','Class','Section','Roll','Name','Father','Mother','DOB','Gender']
          : ['Session','Exam','Class','Section','Roll', ...data.subjects.filter(subject => subject.enabled !== false).flatMap(subject => [subject.name, subject.id])];
      const required = kind === 'attendance' ? ['Roll','Present day'] : kind === 'students' ? ['Roll','Name'] : ['Roll'];
      const aliasesFor = (field: string) => {
        const subject = data.subjects.find(item => item.name === field || item.id === field);
        return subject ? [normalizeImportHeader(subject.name), normalizeImportHeader(subject.id), `${normalizeImportHeader(subject.name)}marks`, `${normalizeImportHeader(subject.name)}mark`] : (importHeaderAliases[field] || [normalizeImportHeader(field)]).map(normalizeImportHeader);
      };
      const headerIndex = matrix.findIndex(row => {
        const values = row.map(normalizeImportHeader);
        const requiredMatch = required.every(field => aliasesFor(field).some(alias => values.includes(alias)));
        const dataMatch = kind !== 'students' || aliasesFor('Name').some(alias => values.includes(alias));
        const marksMatch = kind !== 'marks' || data.subjects.some(subject => [normalizeImportHeader(subject.name), normalizeImportHeader(subject.id)].some(alias => values.includes(alias)));
        return requiredMatch && dataMatch && marksMatch;
      });
      // A selected worksheet is normalized to a one-sheet workbook. The existing import
      // validators remain the single source of truth for class, roll, marks and conflicts.
      if (headerIndex >= 0) {
        const normalizedMatrix = matrix.map(row => [...row]);
        const headerRow = normalizedMatrix[headerIndex] || [];
        headerRow.forEach((value, column) => {
          const normalized = normalizeImportHeader(value);
          const canonical = fields.find(field => aliasesFor(field).includes(normalized));
          if (canonical) headerRow[column] = canonical;
        });
        await (kind === 'attendance' ? importAttendanceSpreadsheet(makeSingleSheetFile(normalizedMatrix)) : importSpreadsheet(makeSingleSheetFile(normalizedMatrix), mode));
        return;
      }
      const headerRows = matrix.map((row, index) => ({ index, headers: row.map((value, column) => String(value ?? '').trim() || `Column ${column + 1}`) }))
        .filter(item => item.headers.some((_, column) => String(matrix[item.index]?.[column] ?? '').trim() !== '')).slice(0, 30);
      if (!headerRows.length) throw new Error('No non-empty rows were found in the selected worksheet.');
      const best = headerRows.reduce((winner, item) => {
        const score = fields.filter(field => aliasesFor(field).some(alias => item.headers.some(header => normalizeImportHeader(header) === alias))).length;
        const previous = fields.filter(field => aliasesFor(field).some(alias => winner.headers.some(header => normalizeImportHeader(header) === alias))).length;
        return score > previous ? item : winner;
      }, headerRows[0]);
      const autoSelected: Record<string, string> = {};
      for (const field of fields) autoSelected[field] = best.headers.find(header => aliasesFor(field).includes(normalizeImportHeader(header))) || '';
      if (kind === 'marks') {
        for (const subject of data.subjects.filter(item => item.enabled !== false)) {
          const field = subject.name;
          autoSelected[field] = best.headers.find(header => aliasesFor(field).includes(normalizeImportHeader(header))) || '';
        }
      }
      setHeaderMapping({ file, kind, mode, sheetName, matrix, headerRows, headerRow: best.index, fields: kind === 'marks' ? ['Session','Exam','Class','Section','Roll', ...data.subjects.filter(item => item.enabled !== false).map(item => item.name)] : fields, selected: autoSelected });
    } catch (error) { alert(error instanceof Error ? error.message : 'Unable to inspect the selected import worksheet.'); }
  };
  const beginSpreadsheetImport = async (file: File | undefined, kind: 'attendance' | 'students' | 'marks', mode: 'students' | ExamKey = importMode) => {
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      if (!workbook.SheetNames.length) throw new Error('The workbook contains no worksheets.');
      if (workbook.SheetNames.length > 1) { setSheetPicker({ file, kind, mode, sheetNames: workbook.SheetNames }); return; }
      await continueImportFromSheet(file, kind, mode, workbook.SheetNames[0]);
    } catch (error) { alert(error instanceof Error ? error.message : 'Unable to read the import file.'); }
  };
  const applyHeaderMapping = async () => {
    const pending = headerMapping;
    if (!pending) return;
    const selected = Object.entries(pending.selected).filter(([, source]) => Boolean(source));
    const required = pending.kind === 'attendance' ? ['Roll','Present day'] : pending.kind === 'students' ? ['Roll','Name'] : ['Roll'];
    if (required.some(field => !pending.selected[field]) || (pending.kind === 'marks' && !pending.fields.some(field => data.subjects.some(subject => subject.name === field) && pending.selected[field]))) {
      alert('Map all required fields. Marks import also requires at least one subject column.'); return;
    }
    if (new Set(selected.map(([, source]) => source)).size !== selected.length) { alert('Each destination field must use a different source column.'); return; }
    const headers = pending.headerRows.find(item => item.index === pending.headerRow)?.headers || [];
    const sourceIndexes = selected.map(([field, source]) => ({ field, index: headers.indexOf(source) })).filter(item => item.index >= 0);
    const output: unknown[][] = [sourceIndexes.map(item => item.field)];
    pending.matrix.slice(pending.headerRow + 1).forEach(row => {
      if (!row.some(value => String(value ?? '').trim() !== '')) return;
      output.push(sourceIndexes.map(item => row[item.index] ?? ''));
    });
    if (output.length < 2) { alert('No data rows were found below the selected header row.'); return; }
    const prepared = makeSingleSheetFile(output);
    setHeaderMapping(null);
    if (pending.kind === 'attendance') await importAttendanceSpreadsheet(prepared);
    else await importSpreadsheet(prepared, pending.mode);
  };
  const downloadSelectedHtml = async () => {
    if (!activeTemplate || !currentStudent) { alert('Add or import at least one student first.'); return; }
    if (!confirmOutputReadiness('Download standalone HTML', [currentStudent.studentId])) return;
    try {
      setBusy(true);
      const rendered = await renderMarksheet(activeTemplate, data, currentStudent);
      const standalone = await createStandaloneMarksheetHtml(rendered, currentStudent.name);
      const blob = new Blob([standalone], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = standaloneFileName(currentStudent.roll, currentStudent.name);
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice(`Standalone HTML marksheet downloaded for ${currentStudent.name}.`);
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not create standalone HTML marksheet.'); }
    finally { setBusy(false); }
  };
  const downloadAllHtmlZip = async () => {
    if (!activeTemplate || !data.students.length) { alert('Add students before exporting standalone HTML.'); return; }
    const eligible = data.students.filter(studentHasNumericReportMark);
    if (!eligible.length) { alert('No marksheets can be generated because no student has numeric marks in the selected examinations.'); return; }
    if (eligible.length !== data.students.length && !confirm(`${data.students.length - eligible.length} student(s) without numeric marks will be skipped. Continue with ${eligible.length} marksheet(s)?`)) return;
    if (!confirmOutputReadiness('Download standalone HTML marksheets', eligible.map(student => student.studentId))) return;
    try {
      setBusy(true);
      const entries = await Promise.all(eligible.map(async student => {
        const rendered = await renderMarksheet(activeTemplate, data, student);
        const html = await createStandaloneMarksheetHtml(rendered, student.name);
        return { fileName: standaloneFileName(student.roll, student.name), html };
      }));
      const blob = await createStandaloneMarksheetZip(entries);
      const url = URL.createObjectURL(blob);
      const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `marksheets-${safe(data.classInfo.className)}-${safe(data.academicSession)}.zip`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice(`Generated ${entries.length} standalone HTML marksheet(s) in a ZIP file.`);
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not generate standalone HTML ZIP.'); }
    finally { setBusy(false); }
  };
  const saveJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `class-${data.classInfo.className}-${data.classInfo.section}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const importJson = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = normalizeData(JSON.parse(await file.text()));
      if (!confirm('Replace current local dataset with this JSON file?')) return;
      setData(parsed); setNotice('JSON data imported.');
    } catch (e) { alert(e instanceof Error ? e.message : 'Invalid JSON file.'); }
  };
  const updateValidationLevel = (key: string, level: 'required' | 'recommended' | 'optional') => setData(d => {
    const validationLevels = { ...d.settings.validationLevels, [key]: level };
    if (key.startsWith('student.')) {
      const field = key.slice('student.'.length);
      return { ...d, settings: {
        ...d.settings, validationLevels,
        requiredStudentFields: level === 'required' ? [...d.settings.requiredStudentFields.filter(item => item !== field), field] : d.settings.requiredStudentFields.filter(item => item !== field),
        recommendedStudentFields: level === 'recommended' ? [...d.settings.recommendedStudentFields.filter(item => item !== field), field] : d.settings.recommendedStudentFields.filter(item => item !== field)
      } };
    }
    return { ...d, settings: { ...d.settings, validationLevels } };
  });
  const toggleReportExam = (key: ExamKey, checked: boolean) => setData(d => {
    const current = d.marksheetSettings.reportExams.filter(item => d.examOrder.includes(item));
    if (!checked && current.length <= 1) { alert('At least one examination must remain selected for the marksheet.'); return d; }
    const next = checked ? (() => { const ordered = [...current]; const keyOrder = d.examOrder.indexOf(key); const insertAt = ordered.findIndex(item => d.examOrder.indexOf(item) > keyOrder); if (insertAt < 0) ordered.push(key); else ordered.splice(insertAt, 0, key); return ordered; })() : current.filter(item => item !== key);
    return { ...d, marksheetSettings: { ...d.marksheetSettings, reportExams: next, calculationExams: [...next] } };
  });
  const moveReportExam = (key: ExamKey, direction: -1 | 1) => setData(d => {
    const order = [...d.marksheetSettings.reportExams]; const index = order.indexOf(key); const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return d;
    [order[index], order[target]] = [order[target], order[index]];
    return { ...d, marksheetSettings: { ...d.marksheetSettings, reportExams: order } };
  });
  const validationRow = (key: string, label: string) => <label className="student-validation-row" key={key}>
    <span>{label}</span>
    <select value={getValidationLevel(data, key)} onChange={e => updateValidationLevel(key, e.target.value as 'required' | 'recommended' | 'optional')}>
      <option value="required">Required</option><option value="recommended">Recommended</option><option value="optional">Optional</option>
    </select>
  </label>;
  const toggleSidebarCollapse = () => setSidebarMode(current => current === 'expanded' ? 'collapsed' : 'expanded');
  const hideDesktopSidebar = () => setSidebarMode('hidden');
  const showDesktopSidebar = () => setSidebarMode('expanded');
  const selectSection = (nextSection: string) => {
    setSection(nextSection);
    setMobileSidebarOpen(false);
  };
  const nav = [
    ['workspaces','Workspaces',Layers], ['students','Students',Users], ['school','School profile',School], ['marks','Exam marks',ClipboardList],
    ['attendance','Attendance & remarks',CalendarCheck], ['backup','Import / Export',Archive], ['help','Help & Guides',BookOpen], ['about','About',Code2]
  ] as const;
  return <div className={`app-shell${sidebarMode === 'collapsed' ? ' sidebar-collapsed' : ''}${sidebarMode === 'hidden' ? ' sidebar-hidden' : ''}${mobileSidebarOpen ? ' mobile-sidebar-open' : ''}`}>
    {mobileSidebarOpen && <button type="button" className="sidebar-backdrop" aria-label="Close navigation menu" onClick={() => setMobileSidebarOpen(false)} />}
    <aside id="app-sidebar" className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-mark"><img src="/icons/icon-192x192.png" alt="Marksheet Studio" /></div>
          <div className="brand-copy"><strong>Marksheet Studio</strong><small>Student results & marksheets</small></div>
          <button type="button" className="sidebar-header-toggle" title="Hide sidebar" aria-label="Hide sidebar" onClick={hideDesktopSidebar}><PanelLeftClose size={17}/></button>
        </div>
      </div>
      <div className="sidebar-scroll-content">
        <div className="sidebar-header sidebar-workspace-header">
        <div className="session-card">
          <div className="session-controls">
            <label className="session-field"><span>ACADEMIC SESSION</span><input value={formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat)} disabled={data.students.length>0} title={data.students.length>0 ? "Create a backup and reset students before changing the session." : "Academic session"} onChange={e=>setData(d=>({...d,academicSession:e.target.value}))} onBlur={()=>setData(d=>({...d,academicSession:normalizeAcademicSession(d.academicSession)}))}/></label>
            <div className="class-select"><label>Class</label><input value={classNameDraft} disabled={data.students.length > 0 && !data.settings.allowEditActiveClass} title={data.students.length === 0 ? "No student records exist; you can edit the class directly." : data.settings.allowEditActiveClass ? "Edit the active workspace class. Press Enter or leave the field to save." : "This class contains student records. Enable Allow editing class with existing students in School Profile to unlock this field."} onChange={e=>setClassNameDraft(e.target.value)} onBlur={()=>void commitActiveClassChange()} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/></div>
          </div>
          {data.settings.sectionEnabled && <div className="session-section-field"><label>Section</label><input value={data.classInfo.section} disabled={data.students.length>0} title={data.students.length>0 ? "Reset students before changing the section." : "Section"} onChange={e=>setData(d=>({...d,classInfo:{...d.classInfo,section:e.target.value}}))}/></div>}
          <small className="class-lock-note">{data.students.length === 0 ? 'No student records exist; class settings are editable.' : data.settings.allowEditActiveClass ? 'Class changes rename this workspace.' : 'Class is locked while student records exist.'}</small>
        </div>
        <div className="workspace-switcher">
          <label htmlFor="workspace-select">Active workspace</label>
          <select id="workspace-select" value={activeWorkspaceId} onChange={e=>{const id=e.target.value;if(id) void switchWorkspace(id);}}>
            {workspaces.filter(w=>!w.archived).map(w=><option key={w.id} value={w.id}>{String(w.data.classInfo.className||'').trim() ? `Class ${w.data.classInfo.className}${w.data.classInfo.section ? `-${w.data.classInfo.section}` : ''}` : 'Invalid workspace · missing class'} · {formatAcademicSession(w.data.academicSession, data.settings.sessionDisplayFormat)}</option>)}
          </select>
          <button type="button" className="workspace-create-shortcut" onClick={openWorkspaceDialog}><Plus size={14}/> Create workspace</button>
        </div>
        </div>
        <nav className="sidebar-nav">{nav.map(([id,label,Icon])=><button key={id} title={label} aria-label={label} className={section===id?'nav-item active':'nav-item'} onClick={()=>selectSection(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>
      </div>
      <div className="sidebar-bottom"><span className="status-dot"/><span>{status}</span></div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="topbar-title">
          <button type="button" className="sidebar-toggle desktop-sidebar-toggle" aria-controls="app-sidebar" aria-expanded={sidebarMode !== "hidden"} title={sidebarMode === 'expanded' ? 'Collapse sidebar' : sidebarMode === 'collapsed' ? 'Expand sidebar' : 'Show sidebar'} aria-label={sidebarMode === 'expanded' ? 'Collapse sidebar' : sidebarMode === 'collapsed' ? 'Expand sidebar' : 'Show sidebar'} onClick={sidebarMode === 'hidden' ? showDesktopSidebar : toggleSidebarCollapse}>
            {sidebarMode === 'expanded' ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}
          </button>
          <button type="button" className="sidebar-toggle mobile-sidebar-toggle" aria-controls="app-sidebar" aria-expanded={mobileSidebarOpen} title="Open navigation" aria-label="Open navigation" onClick={()=>setMobileSidebarOpen(true)}><Menu size={19}/></button>
          <div><div className="eyebrow">CLASS DATA MANAGEMENT</div><h1>{nav.find(n=>n[0]===section)?.[1] || 'Students'}</h1></div>
        </div>
        <div className="top-actions">
          <button className="btn topbar-new-workspace" onClick={openWorkspaceDialog}><Plus size={15}/> New workspace</button>
          {installPrompt && <button className="btn" onClick={()=>void installApp()}><Download size={16}/> Install app</button>}
          <span className="save-status"><Check size={15}/>{status}</span>
          <button className="btn btn-primary" onClick={preview}><Eye size={16}/> Preview selected</button>
        </div>
      </header>
      {notice && <div className="notice"><Check size={16}/>{notice}<button onClick={()=>setNotice('')}>Dismiss</button></div>}
      {section==='workspaces' && <section className="panel workspace-manager">
        <div className="panel-heading">
          <div><h2>Workspace Manager</h2><p>Manage separate class and academic-session workspaces. Each workspace keeps its own students, marks, attendance and class configuration.</p></div>
          <button type="button" className="btn btn-primary" onClick={openWorkspaceDialog}><Plus size={15}/> Create workspace</button>
        </div>
        <div className="workspace-manager-toolbar">
          <label className="workspace-search"><Search size={16}/><input value={workspaceSearch} onChange={e=>setWorkspaceSearch(e.target.value)} placeholder="Search class, section or session…" aria-label="Search workspaces"/></label>
          <span className="muted">{workspaces.filter(item=>!item.archived).length} active · {workspaces.filter(item=>item.archived).length} archived</span>
        </div>
        <div className="workspace-list">
          {filteredWorkspaces.map(item => {
            const isActive = item.id === activeWorkspaceId;
            const classLabel = `Class ${item.data.classInfo.className || '(unnamed)'}${item.data.classInfo.section ? ` · Section ${item.data.classInfo.section}` : ''}`;
            return <article className={`workspace-card${isActive ? ' current' : ''}${item.archived ? ' archived' : ''}`} key={item.id}>
              <div className="workspace-card-icon"><Layers size={20}/></div>
              <div className="workspace-card-main">
                <div className="workspace-card-title"><h3>{classLabel}</h3>{isActive && <span className="workspace-status active">Current</span>}{item.archived && <span className="workspace-status archived">Archived</span>}</div>
                <p>Session {formatAcademicSession(item.data.academicSession, data.settings.sessionDisplayFormat)} · {item.data.students.length} students · Updated {new Date(item.updatedAt).toLocaleDateString()}</p>
              </div>
              <div className="workspace-card-actions">
                {item.archived
                  ? <button type="button" className="btn" onClick={()=>void restoreArchivedWorkspace(item.id)}><RotateCcw size={14}/> Restore</button>
                  : isActive
                    ? <button type="button" className="btn" disabled><Check size={14}/> Current workspace</button>
                    : <><button type="button" className="btn btn-primary" onClick={()=>void switchWorkspace(item.id)}>Open</button><button type="button" className="btn" onClick={()=>void archiveSavedWorkspace(item.id)}><Archive size={14}/> Archive</button></>}
                <button type="button" className="icon-btn danger" title={`Delete ${classLabel}`} aria-label={`Delete ${classLabel}`} disabled={isActive} onClick={()=>void removeSavedWorkspace(item.id)}><Trash2 size={16}/></button>
              </div>
            </article>;
          })}
          {!filteredWorkspaces.length && <div className="empty">{workspaceSearch ? 'No workspaces match your search.' : 'No saved workspaces found. Create your first workspace to get started.'}</div>}
        </div>
        <div className="panel-subsection workspace-guidance"><h3>How workspaces work</h3><p>Creating a workspace copies the active school's profile, exam setup, marksheet design and general settings. The new class starts with an empty student list, empty marks and zero working days. Existing workspaces are not changed. Archived workspaces retain all data and can be restored later.</p></div>
      </section>}
      {section==='students' && <section className="panel">
        <div className="panel-heading"><div><h2>Students</h2><p>{data.students.length} student records · Session {formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat)} · Class {data.classInfo.className}{data.settings.sectionEnabled && data.classInfo.section ? ` · Section ${data.classInfo.section}` : ''} · Changes auto-save</p></div><div className="row-actions"><button className="btn" onClick={addStudent}>+ Add student</button><button className="btn" onClick={openPromotion} disabled={busy || !data.students.length}>Promote students</button><button className="btn btn-danger" onClick={resetStudents} disabled={busy}>Reset students</button><button className="btn" onClick={downloadStudentTemplate}><Download size={15}/> Template</button><label className="btn"><FileUp size={16}/> Import Excel/CSV<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>{void beginSpreadsheetImport(e.target.files?.[0], 'students', 'students'); e.currentTarget.value='';}}/></label></div></div>
        <div className="data-readiness"><div><strong>Data readiness</strong><span>{readiness.totalStudents} students · {readiness.missingRequiredStudents.length} missing required student record(s) · {readiness.requiredMarksMissing.length} required mark(s) missing · {readiness.missingRequiredItems.length} other required item(s) missing · {readiness.missingRecommendedStudents.length + readiness.recommendedMarksMissing.length + readiness.missingRecommendedItems.length} recommended item(s) missing</span></div><span className={readiness.missingRequiredStudents.length || readiness.requiredMarksMissing.length || readiness.missingRequiredItems.length ? 'readiness-warning' : 'readiness-ready'}>{readiness.missingRequiredStudents.length || readiness.requiredMarksMissing.length || readiness.missingRequiredItems.length ? 'Needs attention' : 'Required data complete'}</span></div><div className="table-wrap"><table className="data-table student-table"><colgroup><col className="col-roll"/><col className="col-student-name"/><col className="col-parent"/><col className="col-parent"/><col className="col-gender"/><col className="col-photo"/><col className="col-actions"/></colgroup><thead><tr><th>Roll</th><th>Student name</th><th>Father</th><th>Mother</th><th>Gender</th><th>Photo</th><th></th></tr></thead><tbody>{data.students.map((s,rowIndex)=><tr key={s.studentId}><td><input data-student-row={rowIndex} data-student-col={0} onKeyDown={e=>handleStudentGridKeyDown(e,rowIndex,0)} className="cell-input roll" value={s.roll} onChange={e=>updateStudent(s.studentId,'roll',e.target.value)}/></td><td><input data-student-row={rowIndex} data-student-col={1} onKeyDown={e=>handleStudentGridKeyDown(e,rowIndex,1)} className="cell-input name" value={s.name} onChange={e=>updateStudent(s.studentId,'name',e.target.value)}/></td><td><input data-student-row={rowIndex} data-student-col={2} onKeyDown={e=>handleStudentGridKeyDown(e,rowIndex,2)} className="cell-input parent-input" value={s.father} onChange={e=>updateStudent(s.studentId,'father',e.target.value)}/></td><td><input data-student-row={rowIndex} data-student-col={3} onKeyDown={e=>handleStudentGridKeyDown(e,rowIndex,3)} className="cell-input parent-input" value={s.mother} onChange={e=>updateStudent(s.studentId,'mother',e.target.value)}/></td><td><select data-student-row={rowIndex} data-student-col={4} onKeyDown={e=>handleStudentGridKeyDown(e,rowIndex,4)} className="cell-input gender-input" value={s.gender} onChange={e=>updateStudent(s.studentId,'gender',e.target.value)}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></select></td><td><div className="photo-actions"><button type="button" className="photo-button" title={s.photo ? 'Open existing photo in cropper' : 'Upload student photo'} onClick={()=>{if(s.photo){setCropDraft({studentId:s.studentId,src:s.photo,fileName: s.name ? `${s.name} — current photo` : 'Current photo'});}else{document.getElementById(`photo-upload-${s.studentId}`)?.click();}}}>{s.photo ? <img src={s.photo} alt="Student photo" /> : <ImagePlus size={17}/>}</button><label className="photo-new-button" title="Select a new image">New<input id={`photo-upload-${s.studentId}`} hidden type="file" accept="image/*" onChange={async e=>{const f=e.currentTarget.files?.[0];if(f){try{setCropDraft({studentId:s.studentId,src:await fileToDataUrl(f),fileName:f.name});}catch{alert('Could not read this image file.');}}e.currentTarget.value='';}}/></label></div></td><td><div className="row-actions"><button type="button" className="icon-btn" title={data.settings.allowChangeExistingStudentClass ? "Move student to another class" : "Enable Allow changing class of existing students in School Profile first"} disabled={!data.settings.allowChangeExistingStudentClass} onClick={()=>void moveStudentToClass(s.studentId)}><ArrowRightLeft size={15}/></button><button className="icon-btn danger" title="Delete student" onClick={()=>deleteStudent(s.studentId)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table>{!data.students.length&&<div className="empty">No students yet. Add a student or import an Excel/CSV file.</div>}</div>
      </section>}
      {section==='students' && promotionOpen && <section className="panel promotion-panel"><div className="panel-heading"><div><h2>Promotion preview</h2><p>Students are ranked by converted weightage percentage, then obtained weightage, attendance and previous roll. New roll numbers follow this order.</p></div><button className="btn" onClick={()=>setPromotionOpen(false)}>Close</button></div><div className="form-grid"><label className="field"><span>Destination class</span><input value={promotionClass} onChange={e=>setPromotionClass(e.target.value)}/></label><label className="field"><span>New academic session</span><input value={promotionSession} onChange={e=>setPromotionSession(e.target.value)}/></label><label className="field"><span>New roll assignment</span><select value={promotionRollMode} onChange={e=>setPromotionRollMode(e.target.value as PromotionRollMode)}><option value="dynamic">Dynamic — selected students get consecutive rolls</option><option value="static">Static — preserve full-class ranking positions</option></select><small>Static mode keeps gaps for unselected students. Dynamic mode renumbers selected students from 1.</small></label></div><div className="data-readiness"><label><input ref={selectAllPromotionRef} type="checkbox" checked={allPromotionSelected} onChange={e=>setSelectedPromotionIds(e.target.checked?data.students.map(student=>student.studentId):[])}/> <strong>Select all students</strong></label><span>{selectedPromotionIds.length} of {data.students.length} selected</span></div><div className="table-wrap"><table className="data-table promotion-table"><thead><tr><th>Select</th><th>Rank</th><th>Old roll</th><th>New roll</th><th>Student</th><th>Weightage score</th><th>Percentage</th><th>Attendance</th></tr></thead><tbody>{promotionRanked.map((item,index)=><tr key={item.student.studentId}><td><input type="checkbox" checked={selectedPromotionIds.includes(item.student.studentId)} onChange={e=>setSelectedPromotionIds(previous=>e.target.checked?[...previous,item.student.studentId]:previous.filter(id=>id!==item.student.studentId))}/></td><td>{index+1}</td><td>{item.student.roll}</td><td>{selectedPromotionIds.includes(item.student.studentId) ? (promotionRollMode === 'static' ? index + 1 : promotionRanked.filter((rankedItem, rankedIndex) => rankedIndex <= index && selectedPromotionIds.includes(rankedItem.student.studentId)).length) : '—'}</td><td>{item.student.name}</td><td>{item.score.obtained.toFixed(data.marksheetSettings.marksPrecision)} / {item.score.maximum.toFixed(data.marksheetSettings.marksPrecision)}</td><td>{item.score.percentage.toFixed(2)}%</td><td>{item.attendance.toFixed(1)}%</td></tr>)}</tbody></table></div><div className="row-actions"><button className="btn" onClick={()=>setPromotionOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || !selectedPromotionIds.length || !promotionClass.trim() || !promotionSession.trim()} onClick={generatePromotion}>Generate one promote_ ZIP ({selectedPromotionIds.length})</button></div><small className="muted">The generated ZIP contains selected student details and photos, destination class/session, roll assignment mode and an old-to-new roll mapping. Examination marks and attendance values are excluded.</small></section>}
      {section==='school' && <section className="panel"><div className="panel-heading"><div><h2>School profile</h2><p>These details populate your existing HTML template.</p></div></div>
        <details className="settings-group"><summary><span>Non-Numeric Marks Values</span><small>Configure accepted codes, meanings, marksheet display and calculation rules</small></summary>
          <div className="panel-subsection"><p>Enter a configured shortcut in a marks cell (for example, -) and leave the cell to commit it as its configured code. Multi-character shortcuts are matched as a complete sequence. Numeric marks remain numeric. Unknown text is flagged; imports reject unconfigured text.</p>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Shortcut</th><th>Code</th><th>Meaning</th><th>Display</th><th>Calculation</th><th>Exam absence</th><th>Active</th><th></th></tr></thead><tbody>{data.settings.nonNumericMarkStatuses.map((item,index)=><tr key={item.id}><td><input className="cell-input" aria-label="Shortcut symbol" value={item.symbol} onChange={e=>setData(d=>({...d,settings:{...d.settings,nonNumericMarkStatuses:d.settings.nonNumericMarkStatuses.map(x=>x.id===item.id?{...x,symbol:e.target.value}:x)}}))}/></td><td><input className="cell-input" value={item.code} onChange={e=>setData(d=>({...d,settings:{...d.settings,nonNumericMarkStatuses:d.settings.nonNumericMarkStatuses.map(x=>x.id===item.id?{...x,code:e.target.value}:x)}}))}/></td><td><input className="cell-input" value={item.meaning} onChange={e=>setData(d=>({...d,settings:{...d.settings,nonNumericMarkStatuses:d.settings.nonNumericMarkStatuses.map(x=>x.id===item.id?{...x,meaning:e.target.value}:x)}}))}/></td><td><input className="cell-input" value={item.displayValue} onChange={e=>setData(d=>({...d,settings:{...d.settings,nonNumericMarkStatuses:d.settings.nonNumericMarkStatuses.map(x=>x.id===item.id?{...x,displayValue:e.target.value}:x)}}))}/></td><td><select className="cell-input" value={item.calculationRule} onChange={e=>setData(d=>({...d,settings:{...d.settings,nonNumericMarkStatuses:d.settings.nonNumericMarkStatuses.map(x=>x.id===item.id?{...x,calculationRule:e.target.value as 'exclude'|'count-as-zero'}:x)}}))}><option value="exclude">Exclude from total</option><option value="count-as-zero">Count as zero</option></select></td><td><input type="checkbox" aria-label="Use as exam-wide absence status" checked={item.isAbsence} onChange={e=>setData(d=>({...d,settings:{...d.settings,nonNumericMarkStatuses:d.settings.nonNumericMarkStatuses.map(x=>x.id===item.id?{...x,isAbsence:e.target.checked}:x)}}))}/></td><td><input type="checkbox" checked={item.active} onChange={e=>setData(d=>({...d,settings:{...d.settings,nonNumericMarkStatuses:d.settings.nonNumericMarkStatuses.map(x=>x.id===item.id?{...x,active:e.target.checked}:x)}}))}/></td><td><button type="button" className="icon-btn danger" title="Remove status" onClick={()=>{const used=Object.values(data.results).some(rows=>rows.some(row=>Object.entries(row).some(([key,value])=>key!=='studentId'&&key!=='roll'&&[item.code,item.displayValue].some(candidate=>String(value??'').trim().toLowerCase()===candidate.trim().toLowerCase()))));if(used){alert('This status is used in saved marks. Deactivate it instead of deleting it so historical results remain interpretable.');return;}setData(d=>({...d,settings:{...d.settings,nonNumericMarkStatuses:d.settings.nonNumericMarkStatuses.filter(x=>x.id!==item.id)}}));}}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div>
          <button type="button" className="btn" onClick={()=>setData(d=>({...d,settings:{...d.settings,nonNumericMarkStatuses:[...d.settings.nonNumericMarkStatuses,{id:crypto.randomUUID(),symbol:'',code:'',meaning:'',displayValue:'',calculationRule:'exclude',active:true,isAbsence:false}]}}))}><Plus size={15}/> Add non-numeric value</button>
          <small className="muted">Exclude: does not contribute to obtained or maximum marks. Count as zero: contributes zero obtained marks while retaining the subject's maximum marks. Deactivating a code preserves historical entries but prevents new use/import.</small></div>
        </details>
        <details className="settings-group"><summary><span>School identity & header</span><small>School details, QR exam label and header information</small></summary>
        <div className="form-grid">
          {([['name','School name'],['address','School address']] as [('name'|'address'),string][]).map(([field,label])=><label className="field" key={field}><span>{label}</span><input value={data.school[field] || ''} onChange={e=>setSchool(field,e.target.value)}/></label>)}
          <label className="field"><span>Exam type (shown in QR code)</span><input value={data.examType} placeholder="HALF-YEAR EXAMINATION" onChange={e=>setData(d=>({...d,examType:e.target.value}))}/><small className="setting-help">This saved value is used as the exam label in both single-exam and multi-exam QR codes. Leave blank to use the selected exam names automatically.</small></label>
          <label className="field"><span>QR exam label (compact)</span><input value={data.qrExamName || ''} placeholder="e.g. HY" onChange={e=>setData(d=>({...d,qrExamName:e.target.value}))}/><small className="setting-help">Independent short label stored in the QR payload. Example: NPS | HY | 2026-27.</small></label>
        </div>
        <div className="panel-subsection"><h3>Marksheet header information</h3><p>Configure the three optional columns in the existing first row above the school banner. The center column stays aligned to the page center; blank columns do not add fixed row height.</p>
          <div className="form-grid three">
            <label className="field section-toggle"><span>Show left information</span><input type="checkbox" checked={data.school.headerMeta?.showLeft !== false} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,showLeft:e.target.checked}}}))}/></label>
            <label className="field"><span>Left label</span><input value={data.school.headerMeta?.leftLabel ?? ''} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,leftLabel:e.target.value}}}))}/></label>
            <label className="field"><span>Left value · Established</span><input value={data.school.established || ''} onChange={e=>setSchool('established',e.target.value)}/></label>
            <label className="field section-toggle"><span>Show middle information</span><input type="checkbox" checked={data.school.headerMeta?.showMiddle !== false} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,showMiddle:e.target.checked}}}))}/></label>
            <label className="field"><span>Middle label</span><input value={data.school.headerMeta?.middleLabel ?? ''} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,middleLabel:e.target.value}}}))}/></label>
            <label className="field"><span>Middle value · Affiliation</span><input value={data.school.affiliation || ''} onChange={e=>setSchool('affiliation',e.target.value)}/></label>
            <label className="field section-toggle"><span>Show right information</span><input type="checkbox" checked={data.school.headerMeta?.showRight !== false} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,showRight:e.target.checked}}}))}/></label>
            <label className="field"><span>Right label</span><input value={data.school.headerMeta?.rightLabel ?? ''} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,rightLabel:e.target.value}}}))}/></label>
            <label className="field"><span>Right value · Registration number</span><input value={data.school.registrationNumber || ''} onChange={e=>setSchool('registrationNumber',e.target.value)}/></label>
          </div>
          <div className="form-grid">
            <label className="field section-toggle"><span>Show third school-banner line</span><input type="checkbox" checked={data.school.headerMeta?.showManagementLine === true} onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,showManagementLine:e.target.checked}}}))}/></label>
            <label className="field"><span>Third school-banner line (HTML supported)</span><textarea rows={3} value={data.school.headerMeta?.managementLine ?? ''} placeholder="Management / Foundation information" onChange={e=>setData(d=>({...d,school:{...d.school,headerMeta:{...d.school.headerMeta,managementLine:e.target.value}}}))}/><small className="setting-help">Supports safe formatting: &lt;strong&gt;, &lt;em&gt;, &lt;u&gt;, &lt;span&gt;, &lt;br&gt;. Scripts and unsafe attributes are removed.</small></label>
          </div>
        </div>
<div className="settings-group-footer"><div role="button" tabIndex={0} className="btn settings-group-close-bottom" aria-label="Collapse this settings section" onClick={e=>{const group=e.currentTarget.closest('details');if(group)group.open=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const group=e.currentTarget.closest('details');if(group)group.open=false;}}}><X size={14}/><span>Close section</span></div></div>
        </details>
        <details className="settings-group"><summary><span>School images & watermark</span><small>Logos, watermark image, mode and appearance</small></summary>
        <div className="panel-subsection"><h3>School images</h3><div className="form-grid three"><label className="field section-toggle"><span>Show left logo</span><input type="checkbox" checked={data.school.showLeftLogo !== false} onChange={e=>setData(d=>({...d,school:{...d.school,showLeftLogo:e.target.checked}}))}/></label><label className="field upload-field"><span>Top-left logo</span><label className="upload-box"><Upload size={16}/> Upload left logo<input hidden type="file" accept="image/*" onChange={e=>{uploadAsset(e.target.files?.[0],'logoLeft');e.currentTarget.value='';}}/></label>{(data.school.logoLeft||data.school.logo)&&<img className="asset-preview" src={data.school.logoLeft||data.school.logo} alt="Left logo preview"/>}</label><label className="field section-toggle"><span>Show right logo</span><input type="checkbox" checked={data.school.showRightLogo !== false} onChange={e=>setData(d=>({...d,school:{...d.school,showRightLogo:e.target.checked}}))}/></label><label className="field section-toggle"><span>Use left logo on right</span><input type="checkbox" checked={data.school.rightLogoUseLeftLogo !== false} onChange={e=>setData(d=>({...d,school:{...d.school,rightLogoUseLeftLogo:e.target.checked}}))}/></label>{data.school.rightLogoUseLeftLogo === false && <label className="field upload-field"><span>Top-right logo</span><label className="upload-box"><Upload size={16}/> Upload right logo<input hidden type="file" accept="image/*" onChange={e=>{uploadAsset(e.target.files?.[0],'logoRight');e.currentTarget.value='';}}/></label>{data.school.logoRight&&<img className="asset-preview" src={data.school.logoRight} alt="Right logo preview"/>}</label>}<label className="field section-toggle"><span>Show watermark</span><input type="checkbox" checked={data.school.showWatermark !== false} onChange={e=>setData(d=>({...d,school:{...d.school,showWatermark:e.target.checked}}))}/></label><label className="field section-toggle"><span>Use left logo as watermark</span><input type="checkbox" checked={data.school.watermarkUseLeftLogo !== false} onChange={e=>setData(d=>({...d,school:{...d.school,watermarkUseLeftLogo:e.target.checked}}))}/></label>{data.school.watermarkUseLeftLogo === false && <label className="field upload-field"><span>Watermark image</span><label className="upload-box"><Upload size={16}/> Upload watermark<input hidden type="file" accept="image/*" onChange={e=>{uploadAsset(e.target.files?.[0],'watermark');e.currentTarget.value='';}}/></label>{data.school.watermark&&<img className="asset-preview" src={data.school.watermark} alt="Watermark preview"/>}</label>}</div></div>
        <div className="panel-subsection"><div className="flex items-center justify-between gap-3"><h3>Watermark appearance</h3><button type="button" className="btn" onClick={()=>setWatermarkAppearanceLocked(value=>!value)} aria-pressed={watermarkAppearanceLocked} title={watermarkAppearanceLocked?'Unlock watermark appearance settings':'Lock watermark appearance settings'}>{watermarkAppearanceLocked?<Lock size={14}/>:<Unlock size={14}/>} {watermarkAppearanceLocked?'Locked':'Unlock active'}</button></div><p className="setting-help">{watermarkAppearanceLocked?'Appearance settings are locked to prevent accidental changes. Unlock to edit opacity, display mode or size.':'Appearance settings are unlocked. Lock them again after editing.'}</p><label className="field"><span>Display mode</span><select disabled={watermarkAppearanceLocked} value={data.marksheetSettings.watermarkMode} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,watermarkMode:e.target.value as 'repeat'|'single'}}))}><option value="repeat">Repeated pattern</option><option value="single">Single centered image</option></select></label><label className="field"><span>Opacity: {data.marksheetSettings.watermarkOpacity}%</span><input disabled={watermarkAppearanceLocked} type="range" min="0" max="100" value={data.marksheetSettings.watermarkOpacity} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,watermarkOpacity:Number(e.target.value)}}))}/></label>{data.marksheetSettings.watermarkMode==='repeat'?<label className="field"><span>Repeated tile size: {data.marksheetSettings.watermarkRepeatSize}px</span><input disabled={watermarkAppearanceLocked} type="range" min="24" max="180" step="4" value={data.marksheetSettings.watermarkRepeatSize} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,watermarkRepeatSize:Number(e.target.value)}}))}/></label>:<label className="field"><span>Centered image size: {data.marksheetSettings.watermarkCenterSize}px</span><input disabled={watermarkAppearanceLocked} type="range" min="120" max="900" step="20" value={data.marksheetSettings.watermarkCenterSize} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,watermarkCenterSize:Number(e.target.value)}}))}/></label>}<button type="button" className="btn" disabled={watermarkAppearanceLocked} onClick={()=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,watermarkOpacity:10,watermarkRepeatSize:60,watermarkCenterSize:420}}))}>Reset watermark opacity & size</button></div>
<div className="settings-group-footer"><div role="button" tabIndex={0} className="btn settings-group-close-bottom" aria-label="Collapse this settings section" onClick={e=>{const group=e.currentTarget.closest('details');if(group)group.open=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const group=e.currentTarget.closest('details');if(group)group.open=false;}}}><X size={14}/><span>Close section</span></div></div>
        </details>
        <details className="settings-group"><summary><span>QR code image</span><small>Use the school logo by default or upload a separate centre image</small></summary>
          <div className="panel-subsection"><p>The QR code uses the school logo in its centre by default. Enable the checkbox only when you want a dedicated QR image.</p><label className="field"><span>QR size (mm)</span><input type="number" min="25" max="50" step="1" value={data.marksheetSettings.qrSizeMm || 35} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,qrSizeMm:Math.max(25,Math.min(50,Number(e.target.value)||35))}}))}/><input aria-label="QR size slider" type="range" min="25" max="50" step="1" value={Math.max(25,Math.min(50,data.marksheetSettings.qrSizeMm || 35))} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,qrSizeMm:Number(e.target.value)}}))}/><small>Controls the printed QR frame size independently of the student-details row.</small></label>
            <label className="toggle-label"><input type="checkbox" checked={data.marksheetSettings.qrUseSeparateImage} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,qrUseSeparateImage:e.target.checked}}))}/> <strong>Use separate image for QR code</strong></label>
            {data.marksheetSettings.qrUseSeparateImage ? <div className="form-grid"><label className="field upload-field"><span>Separate QR centre image</span><label className="upload-box"><Upload size={16}/> Upload QR image<input hidden type="file" accept="image/*" onChange={async e=>{const file=e.currentTarget.files?.[0];if(file){try{const image=await fileToDataUrl(file);setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,qrSeparateImage:image}}));}catch{alert('Could not read QR image.');}}e.currentTarget.value='';}}/></label>{data.marksheetSettings.qrSeparateImage && <div className="signature-asset-preview"><img className="asset-preview" src={data.marksheetSettings.qrSeparateImage} alt="QR centre image preview"/><button className="icon-btn danger" type="button" onClick={()=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,qrSeparateImage:''}}))}>Remove image</button></div>}</label></div> : <div className="signature-asset-preview"><img className="asset-preview" src={data.school.logoLeft || data.school.logo || data.school.logoRight || '/demo-school-logo.svg'} alt="School logo used in QR code"/><small className="muted">Current school logo will be used. Upload a school logo in School images if needed.</small></div>}
          </div>
          <div className="settings-group-footer"><div role="button" tabIndex={0} className="btn settings-group-close-bottom" aria-label="Collapse this settings section" onClick={e=>{const group=e.currentTarget.closest('details');if(group)group.open=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const group=e.currentTarget.closest('details');if(group)group.open=false;}}}><X size={14}/><span>Close section</span></div></div>
        </details>
        <details className="settings-group"><summary><span>Class permissions & import</span><small>Control class configuration, student transfers, sidebar class editing and multi-class import</small></summary>
        <div className="panel-subsection"><h3>Academic session display</h3><p>Session values are stored and matched canonically as YYYY-YYYY. This option changes only how sessions are displayed and exported.</p><label className="field"><span>Display format</span><select value={data.settings.sessionDisplayFormat} onChange={e=>setData(d=>({...d,settings:{...d.settings,sessionDisplayFormat:e.target.value as 'YYYY-YYYY'|'YYYY-YY'}}))}><option value="YYYY-YYYY">YYYY-YYYY (2026-2027)</option><option value="YYYY-YY">YYYY-YY (2026-27)</option></select></label></div>
        <div className="class-config-permission"><label className="toggle-label"><input type="checkbox" checked={data.settings.allowEditExistingClassConfig} onChange={e=>setData(d=>({...d,settings:{...d.settings,allowEditExistingClassConfig:e.target.checked}}))}/> <strong>Enable editing for existing classes</strong></label><small>{isClassConfigurationLocked ? 'Configuration is protected. Enable this option to edit validation rules, exam setup, subjects and grading configuration. Student records, marks and attendance remain editable under their existing rules.' : data.students.length ? 'Class configuration editing is enabled.' : 'No student records exist yet; class configuration is editable.'}</small></div>
        <div className="class-config-permission"><label className="toggle-label"><input type="checkbox" checked={data.settings.allowChangeExistingStudentClass} onChange={e=>setData(d=>({...d,settings:{...d.settings,allowChangeExistingStudentClass:e.target.checked}}))}/> <strong>Allow changing class of existing students</strong></label><small>{data.settings.allowChangeExistingStudentClass ? 'Enabled. A Move class action appears in each student row. It moves only that student and their current-session marks, attendance, photo and remarks to the destination class. Previous-session workspaces remain unchanged.' : 'Disabled by default. Student class changes are blocked until this permission is enabled. This permission is separate from class configuration editing.'}</small></div>
        <div className="class-config-permission"><label className="toggle-label"><input type="checkbox" checked={data.settings.allowEditActiveClass} onChange={e=>setData(d=>({...d,settings:{...d.settings,allowEditActiveClass:e.target.checked}}))}/> <strong>Allow editing class when student records exist</strong></label><small>{data.settings.allowEditActiveClass ? 'Enabled. The Class field in the sidebar can be changed even when this workspace contains students. The complete workspace is renamed; its student records, marks, attendance and settings stay together. An existing destination workspace cannot be overwritten.' : 'Disabled by default. Empty workspaces remain editable automatically. When student records exist, the sidebar Class field is locked until this option is enabled.'}</small></div>
        <label className="field section-toggle"><span>Allowed multiple class import</span><span className="setting-help">Unchecked by default. When enabled, a file containing multiple classes is split into separate saved class workspaces after explicit confirmation.</span><input type="checkbox" checked={data.settings.allowMultipleClassImport} onChange={e=>setData(d=>({...d,settings:{...d.settings,allowMultipleClassImport:e.target.checked}}))}/></label>
<div className="settings-group-footer"><div role="button" tabIndex={0} className="btn settings-group-close-bottom" aria-label="Collapse this settings section" onClick={e=>{const group=e.currentTarget.closest('details');if(group)group.open=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const group=e.currentTarget.closest('details');if(group)group.open=false;}}}><X size={14}/><span>Close section</span></div></div>
        </details>
        <details className="settings-group"><summary><span>Student photo crop settings</span><small>Set the saved image resolution used by the photo cropper</small></summary>
          <div className="panel-subsection">
            <h3>Crop output resolution</h3>
            <p>This setting controls the pixel dimensions of cropped student photos. It is saved with the workspace and is not shown inside the cropper.</p>
            <label className="field compact"><span>Output resolution</span>
              <select value={data.settings.photoCropOutputScale ?? 1} onChange={e=>setData(d=>({...d,settings:{...d.settings,photoCropOutputScale:Number(e.target.value) as 1|1.5|2|3|4}}))}>
                <option value="1">Standard · 400 × 460 px</option>
                <option value="1.5">High · 600 × 690 px</option>
                <option value="2">Very high · 800 × 920 px</option>
                <option value="3">Ultra · 1200 × 1380 px</option>
                <option value="4">Maximum · 1600 × 1840 px</option>
              </select>
            </label>
            <small className="setting-help">Higher resolutions create larger photo files and use more local storage. Existing student photos are not changed; the selected resolution applies to newly cropped photos.</small>
          </div>
          <div className="settings-group-footer"><div role="button" tabIndex={0} className="btn settings-group-close-bottom" aria-label="Collapse this settings section" onClick={e=>{const group=e.currentTarget.closest('details');if(group)group.open=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const group=e.currentTarget.closest('details');if(group)group.open=false;}}}><X size={14}/><span>Close section</span></div></div>
        </details>
        <fieldset className="class-config-fieldset" disabled={isClassConfigurationLocked}>
        <details className="settings-group"><summary><span>Student data & validation</span><small>Sections and Required / Recommended / Optional rules</small></summary>
        <div className="panel-subsection"><h3>Floating marksheet preview</h3>
          <label className="field section-toggle"><span>Show floating preview button</span><input type="checkbox" checked={data.settings.showFloatingPreview !== false} onChange={e=>setData(d=>({...d,settings:{...d.settings,showFloatingPreview:e.target.checked}}))}/></label>
          <label className="field compact"><span>Button position</span><select value={data.settings.floatingPreviewPosition || 'right-bottom'} disabled={data.settings.showFloatingPreview === false} onChange={e=>setData(d=>({...d,settings:{...d.settings,floatingPreviewPosition:e.target.value as 'right-center'|'right-bottom'}}))}><option value="right-bottom">Right bottom</option><option value="right-center">Right center</option></select></label>
          <small className="setting-help">The button opens the existing marksheet preview and stays fixed while the workspace scrolls. It is not included in printed marksheets.</small>
        </div>
        <div className="panel-subsection"><h3>Student data settings</h3>
          <label className="field section-toggle"><span>Enable Sections</span><span className="setting-help">When disabled, Section is hidden from student entry and templates. Extra Section columns in imported files are ignored.</span><input type="checkbox" checked={data.settings.sectionEnabled} onChange={e=>{const enabled=e.target.checked;if(!enabled && data.classInfo.section.trim() && data.students.length && !confirm('Disable sections? The current section value will be cleared from the active class view. Existing backup data is not deleted.')) return;setData(d=>({...d,settings:{...d.settings,sectionEnabled:enabled},classInfo:{...d.classInfo,section:enabled?d.classInfo.section:''}}));}} /></label>
          <div className="field"><span>Student data validation</span><div className="student-validation-grid">{[['student.roll','Roll'],['student.name','Student name'],['student.father','Father name'],['student.mother','Mother name'],['student.dob','Date of birth'],['student.gender','Gender'],['student.photo','Student photo']].map(([key,label])=>validationRow(key,label))}</div></div>
          <div className="field"><span>School data validation</span><div className="student-validation-grid">{[['school.name','School name'],['school.address','School address'],['school.established','Established year'],['school.affiliation','Affiliation'],['school.registrationNumber','Registration number'],['school.headerLeftLabel','Header left label'],['school.headerMiddleLabel','Header middle label'],['school.headerRightLabel','Header right label'],['school.managementLine','Management line'],['school.logoLeft','Left school logo'],['school.logoRight','Right school logo'],['school.watermark','Watermark image']].map(([key,label])=>validationRow(key,label))}</div></div>
          <div className="field"><span>Examination data validation</span><div className="student-validation-grid">{[['exam.type','Examination type'],['exam.session','Academic session'],['exam.class','Class'],['exam.section','Section'],['exam.names','Examination names'],['exam.maximumMarks','Maximum marks']].map(([key,label])=>validationRow(key,label))}</div></div>
          <div className="field"><span>Academic data validation</span><div className="student-validation-grid">{[['academic.subjects','Subject names'],['academic.gradingScale','Grading scale']].map(([key,label])=>validationRow(key,label))}</div><div className="student-validation-grid">{exams.map(k=><label className="student-validation-row" key={`marks-${k}`}><span>{data.exams[k].shortName} marks</span><select value={data.settings.requiredExamMarks.includes(k)?'required':data.settings.recommendedExamMarks.includes(k)?'recommended':'optional'} onChange={e=>setData(d=>({...d,settings:{...d.settings,requiredExamMarks:e.target.value==='required'?[...d.settings.requiredExamMarks.filter(x=>x!==k),k]:d.settings.requiredExamMarks.filter(x=>x!==k),recommendedExamMarks:e.target.value==='recommended'?[...d.settings.recommendedExamMarks.filter(x=>x!==k),k]:d.settings.recommendedExamMarks.filter(x=>x!==k)}}))}><option value="required">Required</option><option value="recommended">Recommended</option><option value="optional">Optional</option></select></label>)}</div></div>
          <div className="field"><span>Attendance data validation</span><div className="student-validation-grid">{[['attendance.workingDays','Total working days'],['attendance.presentDays','Student present days']].map(([key,label])=>validationRow(key,label))}</div></div>
          <div className="field"><span>Additional information validation</span><div className="student-validation-grid">{[['additional.issueDate','Issue date'],['additional.remarks','Remarks configuration']].map(([key,label])=>validationRow(key,label))}</div></div>
          <div className="field"><span>Signature section validation</span><div className="student-validation-grid">{[['signature.label','Designation label'],['signature.name','Person name'],['signature.image','Signature image']].map(([key,label])=>validationRow(key,label))}</div></div>
          <small>Required information blocks marksheet output. Recommended information shows a warning. Optional information never blocks output. Examination date and achievements are not configurable fields in this project version, so they are not included in validation.</small>
        </div>
<div className="settings-group-footer"><div role="button" tabIndex={0} className="btn settings-group-close-bottom" aria-label="Collapse this settings section" onClick={e=>{const group=e.currentTarget.closest('details');if(group)group.open=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const group=e.currentTarget.closest('details');if(group)group.open=false;}}}><X size={14}/><span>Close section</span></div></div>
        </details>
        <details className="settings-group"><summary><span>Examination configuration</span><small>Exam structure, order, maximum marks, weightage and promotion scoring</small></summary>
        <div className="panel-subsection"><h3>Exam configuration</h3><p>Choose a six-, four-, two-exam structure, or configure a custom examination list. Reordering changes the display order only; existing marks remain attached to their examination.</p><div className="form-grid"><label className="field"><span>Examination structure</span><select value={data.examPreset} onChange={e=>changeExamPreset(e.target.value as AppData['examPreset'])}><option value="six">Six exams · PA1, PA2, HY, PA3, PA4, Final</option><option value="four">Four exams · PA1, HY, PA3, Final</option><option value="two">Two exams · HY, Final</option><option value="custom">Custom examination list</option></select></label><div className="field"><span>Custom exams</span><button className="btn" type="button" onClick={addCustomExam}>+ Add custom exam</button></div></div><div className="exam-config-list">{exams.map((k,i)=><div className="exam-config-row exam-config-row-expanded" key={k}><div className="exam-config-order"><strong>{i+1}.</strong><div><button type="button" className="icon-btn" title="Move exam up" disabled={i===0} onClick={()=>moveExam(k,-1)}><ArrowUp size={14}/></button><button type="button" className="icon-btn" title="Move exam down" disabled={i===exams.length-1} onClick={()=>moveExam(k,1)}><ArrowDown size={14}/></button></div></div><label className="field"><span>Exam name</span><input value={data.exams[k].name} onChange={e=>setData(d=>({...d,exams:{...d.exams,[k]:{...d.exams[k],name:e.target.value}}}))}/></label><label className="field"><span>Short name</span><input value={data.exams[k].shortName} onChange={e=>setData(d=>({...d,exams:{...d.exams,[k]:{...d.exams[k],shortName:e.target.value}}}))}/></label><label className="field"><span>Maximum marks</span><input type="number" min="0.01" step="0.01" value={data.exams[k].maxMarks} onChange={e=>setData(d=>({...d,exams:{...d.exams,[k]:{...d.exams[k],maxMarks:Math.max(0.01,Number(e.target.value)||0.01)}}}))}/></label><label className="field"><span>Weightage contribution</span><input type="number" min="0" step="0.01" value={data.exams[k].weightage} onChange={e=>setData(d=>({...d,exams:{...d.exams,[k]:{...d.exams[k],weightage:Math.max(0,Number(e.target.value)||0)}}}))}/></label><label className="field"><span>Completeness</span><select value={data.settings.requiredExamMarks.includes(k)?'required':data.settings.recommendedExamMarks.includes(k)?'recommended':'optional'} onChange={e=>setData(d=>({...d,settings:{...d.settings,requiredExamMarks:e.target.value==='required'?[...d.settings.requiredExamMarks.filter(x=>x!==k),k]:d.settings.requiredExamMarks.filter(x=>x!==k),recommendedExamMarks:e.target.value==='recommended'?[...d.settings.recommendedExamMarks.filter(x=>x!==k),k]:d.settings.recommendedExamMarks.filter(x=>x!==k)}}))}><option value="required">Required</option><option value="recommended">Recommended</option><option value="optional">Optional</option></select></label><button type="button" className="icon-btn danger" title="Remove exam" disabled={exams.length<=1} onClick={()=>removeExam(k)}><Trash2 size={15}/></button></div>)}</div><div className="panel-subsection"><h4>Promotion result calculation</h4><p>Promotion ranking uses the selected examinations' converted weightage. Missing marks are excluded from the available maximum, matching marksheet calculation rules.</p><div className="upload-exam-options">{exams.map(k=><label className="upload-exam-option" key={`promotion-${k}`}><input type="checkbox" checked={data.settings.promotionExams.includes(k)} onChange={e=>setData(d=>({...d,settings:{...d.settings,promotionExams:e.target.checked?[...d.settings.promotionExams,k]:d.settings.promotionExams.filter(x=>x!==k)}}))}/><span>{data.exams[k].shortName}</span></label>)}</div>{!data.settings.promotionExams.length&&<small className="setting-warning">Select at least one exam for promotion ranking.</small>}</div><label className="field"><span>Fractional marks precision</span><select value={data.marksheetSettings.marksPrecision} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,marksPrecision:Number(e.target.value) as 0|1|2}}))}><option value="0">Integer (nearest whole number)</option><option value="1">One decimal place</option><option value="2">Two decimal places</option></select><small>Each exam contribution is rounded to this precision before totals are calculated.</small></label></div>
<div className="settings-group-footer"><div role="button" tabIndex={0} className="btn settings-group-close-bottom" aria-label="Collapse this settings section" onClick={e=>{const group=e.currentTarget.closest('details');if(group)group.open=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const group=e.currentTarget.closest('details');if(group)group.open=false;}}}><X size={14}/><span>Close section</span></div></div>
        </details>
        <details className="settings-group"><summary><span>Subjects & grading</span><small>Class subjects, grade thresholds and grade order</small></summary>
        <div className="panel-subsection"><h3>Subjects for class {data.classInfo.className}</h3><p>Subject IDs stay stable when you rename a subject. Removing a subject can hide its existing marks, so review before removing.</p><div className="subject-editor">{data.subjects.map((s,i)=><div className="subject-edit-row" key={s.id}><span className="subject-index">{i+1}</span><input aria-label={`Subject ${i+1} name`} value={s.name} onChange={e=>setData(d=>({...d,subjects:d.subjects.map(x=>x.id===s.id?{...x,name:e.target.value}:x),classSubjectConfigs:{...d.classSubjectConfigs,[d.classInfo.className]:d.subjects.map(x=>x.id===s.id?{...x,name:e.target.value}:x)}}))}/><button type="button" className="icon-btn danger" title="Remove subject" onClick={()=>{if(confirm(`Remove ${s.name || `Subject ${i+1}`} from the active subject list? Existing marks may remain in the saved data but will not appear in the marksheet.`))setData(d=>({...d,subjects:d.subjects.filter(x=>x.id!==s.id),classSubjectConfigs:{...d.classSubjectConfigs,[d.classInfo.className]:d.subjects.filter(x=>x.id!==s.id)}}));}}><Trash2 size={16}/></button></div>)}<button className="btn" type="button" onClick={()=>setData(d=>{const added={id:`custom-${crypto.randomUUID()}`,name:''};const subjects=[...d.subjects,added];return {...d,subjects,classSubjectConfigs:{...d.classSubjectConfigs,[d.classInfo.className]:subjects}}})}><Plus size={15}/> Add subject</button></div></div>
        <div className="panel-subsection"><h3>Grading scale</h3><p>Rules are evaluated from top to bottom. Use the arrow buttons to set priority; ensure the rules cover every percentage without unintended overlaps.</p><div className="grade-editor">{data.grading.grades.map((g,i)=><div className="grade-edit-row" key={`${g.grade}-${i}`}><input aria-label="Grade label" value={g.grade} onChange={e=>setData(d=>({...d,grading:{...d.grading,grades:d.grading.grades.map((x,j)=>j===i?{...x,grade:e.target.value}:x)},remarkRules:{...d.remarkRules,overall:d.remarkRules.overall.map(r=>r.grade===g.grade?{...r,grade:e.target.value}:r)}}))}/><select aria-label="Grade operator" value={g.operator || '>='} onChange={e=>setData(d=>({...d,grading:{...d.grading,grades:d.grading.grades.map((x,j)=>j===i?{...x,operator:e.target.value as '>='|'>'|'<='|'<' }:x)}}))}><option value=">=">≥</option><option value=">">&gt;</option><option value="<=">≤</option><option value="<">&lt;</option></select><input aria-label="Grade threshold percentage" type="number" min="0" max="100" step="0.01" value={g.minPercentage} onChange={e=>setData(d=>({...d,grading:{...d.grading,grades:d.grading.grades.map((x,j)=>j===i?{...x,minPercentage:Number(e.target.value)}:x)}}))}/><span>%</span><button type="button" className="icon-btn" disabled={i===0} title="Move grade up" onClick={()=>setData(d=>{const a=[...d.grading.grades];[a[i-1],a[i]]=[a[i],a[i-1]];return {...d,grading:{...d.grading,grades:a}}})}><ArrowUp size={14}/></button><button type="button" className="icon-btn" disabled={i===data.grading.grades.length-1} title="Move grade down" onClick={()=>setData(d=>{const a=[...d.grading.grades];[a[i],a[i+1]]=[a[i+1],a[i]];return {...d,grading:{...d.grading,grades:a}}})}><ArrowDown size={14}/></button><button type="button" className="icon-btn danger" disabled={data.grading.grades.length<=1} title="Remove grade" onClick={()=>setData(d=>({...d,grading:{...d.grading,grades:d.grading.grades.filter((_,j)=>j!==i)},remarkRules:{...d.remarkRules,overall:d.remarkRules.overall.filter(r=>r.grade!==g.grade)}}))}><Trash2 size={16}/></button></div>)}<button className="btn" type="button" onClick={()=>setData(d=>({...d,grading:{...d.grading,grades:[...d.grading.grades,{grade:'',operator:'>=',minPercentage:0}]}}))}><Plus size={15}/> Add grade</button></div></div>
<div className="settings-group-footer"><div role="button" tabIndex={0} className="btn settings-group-close-bottom" aria-label="Collapse this settings section" onClick={e=>{const group=e.currentTarget.closest('details');if(group)group.open=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const group=e.currentTarget.closest('details');if(group)group.open=false;}}}><X size={14}/><span>Close section</span></div></div>
        </details>
        <details className="settings-group"><summary><span>Marksheet layout & columns</span><small>Orientation, exam header visibility, calculation inclusion and display rows</small></summary>
        <div className="panel-subsection"><h3>Marksheet layout</h3><label className="field"><span>Table orientation</span><select value={data.marksheetSettings.tableOrientation} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,tableOrientation:e.target.value as 'auto'|'subjects-rows'|'subjects-columns'}}))}><option value="auto">Automatic (single exam = subjects as columns)</option><option value="subjects-rows">Subjects as rows</option><option value="subjects-columns">Subjects as columns</option></select></label><div className="panel-subsection"><h4>Examinations shown in marksheet headers</h4><p>Tick the examinations to display. Selected examinations receive sequential order numbers; use the arrows to rearrange the printed column order.</p></div><div className="report-exam-order-list">{exams.map(k=>{const orderIndex=data.marksheetSettings.reportExams.indexOf(k);const selected=orderIndex>=0;return <div className="report-exam-order-row" key={k}><label className="upload-exam-option"><input type="checkbox" checked={selected} onChange={e=>toggleReportExam(k,e.target.checked)}/><span>{selected ? `${data.exams[k].shortName} — ${orderIndex+1}` : data.exams[k].shortName}</span></label>{selected?<div className="row-actions"><button type="button" className="icon-btn" title="Move selected exam earlier in marksheet" disabled={orderIndex===0} onClick={()=>moveReportExam(k,-1)}><ArrowUp size={14}/></button><button type="button" className="icon-btn" title="Move selected exam later in marksheet" disabled={orderIndex===data.marksheetSettings.reportExams.length-1} onClick={()=>moveReportExam(k,1)}><ArrowDown size={14}/></button></div>:<span className="report-order-empty">Not included</span>}</div>})}</div><small className="setting-help">Order numbers are assigned only to selected examinations. Reorder selected examinations with the arrow buttons. Hidden examinations retain their marks and remain available to promotion calculations.</small><div className="upload-exam-options">{([{field:'showTotalColumn',label:'Show per-subject Total',checked:data.marksheetSettings.showTotalColumn},{field:'showSubjectGrade',label:'Show subject Grade',checked:data.marksheetSettings.showSubjectGrade},{field:'showMarksRow',label:'Show Marks row',checked:data.marksheetSettings.showMarksRow},{field:'showGradeRow',label:'Show Grade row',checked:data.marksheetSettings.showGradeRow},{field:'showOverallSummary',label:'Show overall summary',checked:data.marksheetSettings.showOverallSummary}] as const).map(({field,label,checked})=><label className="upload-exam-option" key={field}><input type="checkbox" checked={checked} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,[field]:e.target.checked}}))}/><span>{label}</span></label>)}</div></div>
<div className="settings-group-footer"><div role="button" tabIndex={0} className="btn settings-group-close-bottom" aria-label="Collapse this settings section" onClick={e=>{const group=e.currentTarget.closest('details');if(group)group.open=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const group=e.currentTarget.closest('details');if(group)group.open=false;}}}><X size={14}/><span>Close section</span></div></div>
        </details>
        <details className="settings-group"><summary><span>Issue date & signatures</span><small>Printed issue date, designation labels, names and signature images</small></summary>
        <div className="panel-subsection"><h3>Issue date</h3><p>Configure the date displayed alongside the signature blocks on the marksheet.</p><label className="field section-toggle"><span>Show issue date</span><span className="setting-help">Display or hide the issue date on the printed marksheet.</span><input type="checkbox" checked={data.marksheetSettings.showIssueDate} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,showIssueDate:e.target.checked}}))}/></label><div className="form-grid"><label className="field"><span>Report card header layout</span><select value={data.marksheetSettings.headerLayout || 'two-rows'} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,headerLayout:e.target.value as 'single-row'|'two-rows'}}))}><option value="two-rows">Two rows</option><option value="single-row">Single row (side by side)</option></select><small className="setting-help">Single row places the report title and academic session on the same horizontal line, centered together.</small></label><label className="field"><span>Single-row horizontal gap: {data.marksheetSettings.headerGapMm ?? 4} mm</span><input type="number" min="0" max="20" step="1" value={data.marksheetSettings.headerGapMm ?? 4} disabled={data.marksheetSettings.headerLayout !== 'single-row'} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,headerGapMm:Math.max(0,Math.min(20,Number(e.target.value)||0))}}))}/></label></div><div className="form-grid"><label className="field"><span>Issue date</span><input type="date" value={data.marksheetSettings.issueDate} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,issueDate:e.target.value}}))}/><span className="setting-help">Defaults to today's date. Change it when issuing or reprinting a marksheet.</span></label><label className="field"><span>Date format</span><select value={data.marksheetSettings.issueDateFormat} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,issueDateFormat:e.target.value as AppData['marksheetSettings']['issueDateFormat']}}))}><option value="DD-MM-YYYY">DD-MM-YYYY</option><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></select></label><label className="field"><span>Date label</span><input value={data.marksheetSettings.issueDateLabel} placeholder="Date" onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,issueDateLabel:e.target.value}}))}/></label></div></div>
        <div className="panel-subsection"><h3>Signature and designation blocks</h3><p>Enabled blocks stay in one row at the bottom. Names and signature images are optional; labels appear below aligned dividers.</p><div className="signature-settings">{data.marksheetSettings.signatures.map((sig,i)=><div className="signature-setting-card" key={sig.id}><div className="signature-setting-top"><label className="toggle-label"><input type="checkbox" checked={sig.enabled} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,enabled:e.target.checked}:x)}}))}/> Show on marksheet</label><div className="row-actions"><button className="icon-btn" disabled={i===0} title="Move left" onClick={()=>setData(d=>{const a=[...d.marksheetSettings.signatures];[a[i-1],a[i]]=[a[i],a[i-1]];return {...d,marksheetSettings:{...d.marksheetSettings,signatures:a}}})}><ArrowLeft size={15}/></button><button className="icon-btn" disabled={i===data.marksheetSettings.signatures.length-1} title="Move right" onClick={()=>setData(d=>{const a=[...d.marksheetSettings.signatures];[a[i],a[i+1]]=[a[i+1],a[i]];return {...d,marksheetSettings:{...d.marksheetSettings,signatures:a}}})}><ArrowRight size={15}/></button><button className="icon-btn danger" disabled={data.marksheetSettings.signatures.length<=1} title="Remove signature block" onClick={()=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.filter(x=>x.id!==sig.id)}}))}><Trash2 size={15}/></button></div></div><label className="field"><span>Designation label</span><input value={sig.label} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,label:e.target.value}:x)}}))}/></label><label className="field"><span>Person name (optional)</span><input value={sig.name} placeholder="Leave blank for handwritten name" onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,name:e.target.value}:x)}}))}/></label><label className="field"><span>Signature image (transparent PNG supported)</span><label className="upload-box"><Upload size={16}/> Upload / replace signature<input hidden type="file" accept="image/png,image/*" onChange={async e=>{const file=e.currentTarget.files?.[0];if(file){try{const image=await fileToDataUrl(file);setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,signatureImage:image}:x)}}));}catch{alert('Could not read signature image.');}}e.currentTarget.value='';}}/></label>{sig.signatureImage&&<div className="signature-asset-preview"><img src={sig.signatureImage} alt={`${sig.label} preview`} style={{width:`${sig.widthMm??32}mm`,height:`${sig.heightMm??10}mm`,maxWidth:'100%',objectFit:'contain'}}/><button className="icon-btn danger" onClick={()=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,signatureImage:''}:x)}}))}>Remove image</button></div>}</label><div className="signature-controls-grid"><label className="field"><span>Signature width: {sig.widthMm??32} mm</span><div className="signature-range-control"><span aria-hidden="true">−</span><input aria-label="Signature width in millimetres" type="range" min="15" max="60" step="1" value={sig.widthMm??32} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,widthMm:Number(e.target.value)}:x)}}))}/><span aria-hidden="true">+</span></div></label><label className="field"><span>Signature height: {sig.heightMm??10} mm</span><div className="signature-range-control"><span aria-hidden="true">−</span><input aria-label="Signature height in millimetres" type="range" min="5" max="20" step="1" value={sig.heightMm??10} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,heightMm:Number(e.target.value)}:x)}}))}/><span aria-hidden="true">+</span></div></label></div><label className="field"><span>Signature position: {Math.max(-20, Math.min(20, sig.offsetMm ?? 0))} mm</span><div className="signature-range-control"><span aria-hidden="true">−</span><input aria-label="Signature vertical position in millimetres" type="range" min="-20" max="20" step="1" value={Math.max(-20, Math.min(20, sig.offsetMm ?? 0))} onChange={e=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,offsetMm:Number(e.target.value)}:x)}}))}/><span aria-hidden="true">+</span></div><div className="row-actions"><small className="setting-help">Left (−) moves the signature image down; right (+) moves it up. The name, divider, designation and footer stay fixed.</small><button type="button" className="btn" onClick={()=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:d.marksheetSettings.signatures.map(x=>x.id===sig.id?{...x,offsetMm:0}:x)}}))}>Reset position</button></div></label></div>)}</div><button className="btn" type="button" disabled={data.marksheetSettings.signatures.length>=4} onClick={()=>setData(d=>({...d,marksheetSettings:{...d.marksheetSettings,signatures:[...d.marksheetSettings.signatures,{id:crypto.randomUUID(),label:'',name:'',enabled:true,widthMm:32,heightMm:10,offsetMm:0}]}}))}><Plus size={15}/> Add signature block ({data.marksheetSettings.signatures.length}/4)</button></div>
<div className="settings-group-footer"><div role="button" tabIndex={0} className="btn settings-group-close-bottom" aria-label="Collapse this settings section" onClick={e=>{const group=e.currentTarget.closest('details');if(group)group.open=false;}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const group=e.currentTarget.closest('details');if(group)group.open=false;}}}><X size={14}/><span>Close section</span></div></div>
        </details>
        </fieldset>
      </section>}
      {section==='marks' && <section className="panel"><div className="panel-heading"><div><h2>Exam marks</h2><p>Enter marks in the selected exam. Values above the configured maximum are rejected.</p></div><div className="row-actions"><button className="btn" onClick={()=>{const roll=prompt('Enter the student roll number to mark absent for this examination:');if(roll){const match=data.students.filter(st=>st.roll.trim().toLowerCase()===roll.trim().toLowerCase());if(match.length!==1)alert(match.length?'More than one student has this roll number.':'Student roll not found.');else setExamAbsent(match[0].studentId,true);}}} disabled={!data.students.length}>Mark exam absent</button><button className="btn btn-danger" onClick={resetMarks} disabled={busy || !data.students.length}>Reset marks</button><label className="btn"><FileSpreadsheet size={16}/> Import exam Excel/CSV<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>{setImportMode(exam);void beginSpreadsheetImport(e.target.files?.[0], 'marks', exam); e.currentTarget.value='';}}/></label></div></div>
        <div className="upload-exam-selector"><strong>Exams affected by the next upload</strong><div className="upload-exam-options">{exams.map(k=><label key={k} className="upload-exam-option"><input type="checkbox" checked={selectedUploadExams.includes(k)} onChange={e=>setSelectedUploadExams(prev=>e.target.checked?[...prev,k]:prev.filter(x=>x!==k))}/><span>{data.exams[k].shortName}</span></label>)}</div><small>Only checked exams can be changed. If the file includes an Exam column, rows are grouped by that value. Without an Exam column, select exactly one exam.</small></div>
        <div className="exam-tabs">{exams.map(k=><button key={k} className={exam===k?'exam-tab active':'exam-tab'} onClick={()=>{setExam(k);setSelectedUploadExams(prev=>prev.length<=1?[k]:prev);}}>{data.exams[k].shortName}<small>Max {data.exams[k].maxMarks}</small></button>)}</div>
        <div className="table-wrap"><table className="data-table marks-table"><thead><tr><th>Roll</th><th>Student</th>{data.subjects.filter(subject=>subject.enabled!==false).map(s=><th key={s.id}>{s.name}</th>)}</tr></thead><tbody>{data.students.map((s,rowIndex)=>{const markRow=data.results[exam].find(m=>m.studentId===s.studentId);const activeSubjects=data.subjects.filter(subject=>subject.enabled!==false);return <tr key={s.studentId}><td>{s.roll}</td><td>{s.name || 'Unnamed student'}</td>{activeSubjects.map((sub,colIndex)=>{const raw=markRow?.[sub.id]??'';return <td key={sub.id}><input data-mark-row={rowIndex} data-mark-col={colIndex} onKeyDown={e=>handleMarksGridKeyDown(e,rowIndex,colIndex)} aria-label={`${s.name} ${sub.name} ${exam}`} className="mark-input" type="text" inputMode="decimal" max={data.exams[exam].maxMarks} value={raw} onChange={e=>setMark(s.studentId,sub.id,e.target.value)} onBlur={e=>{const current=e.currentTarget.value.trim();if(!current)return;const status=getConfiguredMarkStatus(data,current,false);if(status){setMark(s.studentId,sub.id,status.code);return;}if(!Number.isFinite(Number(current)))alert(`"${current}" is not configured. Add it in School Profile → Non-Numeric Marks Values.`);}}/></td>})}</tr>})}</tbody></table>{!data.students.length&&<div className="empty">Add students before entering marks.</div>}</div>
      </section>}
      {section==='attendance' && <section className="panel">
        <div className="panel-heading"><div><h2>Attendance & automatic remarks</h2><p>Set working days once for the whole class. Import columns: Session, Class, Roll, Name and Present day. Only Roll and Present day are required; supplied optional details must match.</p></div><div className="row-actions"><button className="btn" onClick={downloadAttendanceTemplate}><Download size={15}/> Attendance template</button><label className="btn"><FileSpreadsheet size={16}/> Import attendance Excel/CSV<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>{void beginSpreadsheetImport(e.target.files?.[0], 'attendance');e.currentTarget.value='';}}/></label></div></div>
        <div className="form-grid">
          <label className="field"><span>Total class working days</span><input type="number" min="0" value={data.classInfo.totalWorkingDays} onChange={e=>setData(d=>{const total=Math.max(0,Number(e.target.value)||0);return {...d,classInfo:{...d.classInfo,totalWorkingDays:total},students:d.students.map(st=>({...st,attendance:{...st.attendance,workingDays:total,daysPresent:Math.min(total,Math.max(0,st.attendance.daysPresent||0)),daysAbsent:Math.max(0,total-Math.min(total,Math.max(0,st.attendance.daysPresent||0)))}}))}})}/></label>
          <div className="field"><span>Attendance rule</span><p className="muted">Attendance below {data.remarkRules.attendanceBelowPercentage}% will add an automatic remark. No individual attendance remarks are required.</p></div>
        </div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Roll</th><th>Student</th><th>Present days</th><th>Absent days (auto)</th><th>Attendance %</th></tr></thead><tbody>{data.students.map(s=>{
          const totalDays=Math.max(0,data.classInfo.totalWorkingDays||0);
          const present=Math.min(totalDays,Math.max(0,Number(s.attendance.daysPresent)||0));
          const absent=Math.max(0,totalDays-present);
          const pct=totalDays ? present/totalDays*100 : 0;
          return <tr key={s.studentId}><td>{s.roll}</td><td>{s.name}</td><td><input aria-label={`Present days for ${s.name}`} className="mark-input" type="number" min="0" max={totalDays} value={s.attendance.daysPresent} onChange={e=>{const value=Math.min(totalDays,Math.max(0,Number(e.target.value)||0));setData(d=>({...d,students:d.students.map(st=>st.studentId===s.studentId?{...st,attendance:{...st.attendance,daysPresent:value,workingDays:d.classInfo.totalWorkingDays,daysAbsent:Math.max(0,d.classInfo.totalWorkingDays-value),hasRecord:true}}:st)}));}}/></td><td>{absent}</td><td>{totalDays ? `${pct.toFixed(1)}%` : '—'}</td></tr>;
        })}</tbody></table>{!data.students.length&&<div className="empty">Add students before entering attendance.</div>}</div>
        <fieldset className="class-config-fieldset" disabled={isClassConfigurationLocked}><div className="panel-subsection"><h3>Automatic remark rules</h3><p>Remarks are generated during marksheet preview. They are not manually entered for individual students.</p>
          <h4>Overall remarks by grade</h4>
          <p className="muted">The remark matching the student's final overall grade is added automatically.</p>
          <div className="form-grid three">{[...data.grading.grades].sort((a,b)=>b.minPercentage-a.minPercentage).map(gradeRule=>{
            const rule = data.remarkRules.overall.find(r=>r.grade===gradeRule.grade);
            return <div className="remark-card" key={gradeRule.grade}>
              <label className="field"><span>Grade · {gradeRule.grade}</span><input value={`${gradeRule.minPercentage}% and above`} readOnly /></label>
              <label className="field"><span>Remark text</span><input value={rule?.text || ''} placeholder={`Remark for grade ${gradeRule.grade}`} onChange={e=>setData(d=>{
                const existing=d.remarkRules.overall.some(r=>r.grade===gradeRule.grade);
                const overall=existing?d.remarkRules.overall.map(r=>r.grade===gradeRule.grade?{...r,text:e.target.value}:r):[...d.remarkRules.overall,{grade:gradeRule.grade,text:e.target.value}];
                return {...d,remarkRules:{...d.remarkRules,overall}};
              })}/></label>
            </div>;
          })}</div>
          <div className="panel-subsection"><div className="section-heading"><div><strong>Weak subject remarks</strong><small className="muted">Add one or more percentage breakpoints. The highest matching breakpoint is used.</small></div><button type="button" className="btn" onClick={()=>setData(d=>({...d,remarkRules:{...d.remarkRules,weakSubjectRules:[...d.remarkRules.weakSubjectRules,{id:crypto.randomUUID(),belowPercentage:60,template:'Needs more practice in {subject}.'}]}}))}><Plus size={14}/> Add breakpoint</button></div><div className="form-grid two">{data.remarkRules.weakSubjectRules.map(rule=><div className="remark-card" key={rule.id}><div className="section-heading"><strong>Breakpoint</strong><button type="button" className="icon-btn danger" aria-label="Remove breakpoint" disabled={data.remarkRules.weakSubjectRules.length===1} onClick={()=>setData(d=>({...d,remarkRules:{...d.remarkRules,weakSubjectRules:d.remarkRules.weakSubjectRules.filter(item=>item.id!==rule.id)}}))}><Trash2 size={14}/></button></div><label className="field"><span>Below percentage (%)</span><input type="number" min="0" max="100" value={rule.belowPercentage} onChange={e=>setData(d=>({...d,remarkRules:{...d.remarkRules,weakSubjectRules:d.remarkRules.weakSubjectRules.map(item=>item.id===rule.id?{...item,belowPercentage:Math.max(0,Math.min(100,Number(e.target.value)||0))}:item)}}))}/></label><label className="field"><span>Remark template</span><input value={rule.template} onChange={e=>setData(d=>({...d,remarkRules:{...d.remarkRules,weakSubjectRules:d.remarkRules.weakSubjectRules.map(item=>item.id===rule.id?{...item,template:e.target.value}:item)}}))}/><small className="muted">Use {'{subject}'} for subject name and {'{percentage}'} for percentage.</small></label></div>)}</div></div><div className="form-grid two"><label className="field"><span>Low attendance threshold (%)</span><input type="number" min="0" max="100" value={data.remarkRules.attendanceBelowPercentage} onChange={e=>setData(d=>({...d,remarkRules:{...d.remarkRules,attendanceBelowPercentage:Number(e.target.value)}}))}/><span>Attendance remark template</span><input value={data.remarkRules.attendanceTemplate} onChange={e=>setData(d=>({...d,remarkRules:{...d.remarkRules,attendanceTemplate:e.target.value}}))}/><small className="muted">Use {'{percentage}'} for attendance percentage.</small></label></div>
        </div></fieldset>
      </section>}
      {section==='backup' && <section className="panel"><div className="panel-heading"><div><h2>Import & export</h2><p>ZIP is the complete backup format. JSON is the manifest inside the ZIP.</p></div></div>
        <div className="backup-grid"><div className="backup-card"><Archive size={26}/><h3>Export complete ZIP</h3><p>Includes all class data, exam setup, settings, student photos, school assets and both marksheet templates.</p><button className="btn btn-primary" onClick={()=>exportZip(data,template,'','backup',{},singleTemplate)}><Download size={16}/> Export ZIP backup</button></div>
        <div className="backup-card"><FileUp size={26}/><h3>Restore ZIP backup</h3><p>Restore a complete class backup or import a promote_ ZIP for the next session. Photos and required assets are included.</p><label className="btn"><Upload size={16}/> Choose ZIP<input hidden type="file" accept=".zip" onChange={e=>importBackup(e.target.files?.[0])}/></label></div>
        <div className="backup-card"><FileSpreadsheet size={26}/><h3>Import student Excel/CSV</h3><p>Imports student details and validates class/session identity before applying changes.</p><label className="btn"><Upload size={16}/> Choose Excel/CSV<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={e=>{setImportMode('students');void beginSpreadsheetImport(e.target.files?.[0], 'students', 'students'); e.currentTarget.value='';}}/></label></div>
        <div className="backup-card"><FileUp size={26}/><h3>Import JSON manifest</h3><p>For advanced use or recovery from a standalone manifest.</p><label className="btn"><Upload size={16}/> Choose JSON<input hidden type="file" accept=".json" onChange={e=>importJson(e.target.files?.[0])}/></label></div></div>
        <div className="panel-subsection"><h3>Print</h3><p className="muted">Uses the uploaded HTML design unchanged as the source template, with runtime data substitution.</p><div className="row-actions"><label className="field compact"><span>Student to preview</span><select value={selectedStudent} onChange={e=>setSelectedStudent(e.target.value)}><option value="">First student</option>{data.students.map(s=><option key={s.studentId} value={s.studentId}>{s.roll} · {s.name}</option>)}</select></label><button className="btn" onClick={preview} disabled={busy}><Eye size={16}/> Preview selected</button><button className="btn" onClick={previewAll} disabled={busy}><Eye size={16}/> Preview all ({data.students.length})</button><button className="btn btn-primary" onClick={printAll} disabled={busy}><Printer size={16}/> Print all ({data.students.length})</button></div></div>
         <div className="panel-subsection"><h3>Standalone HTML export</h3><p className="muted">Exports self-contained HTML marksheets with required styles, fonts, QR codes and image assets embedded. Downloaded files can be opened and printed offline.</p><div className="row-actions"><label className="field compact"><span>Student</span><select value={selectedStudent} onChange={e=>setSelectedStudent(e.target.value)}><option value="">First student</option>{data.students.map(student=><option key={student.studentId} value={student.studentId}>{student.roll} · {student.name}</option>)}</select></label><button className="btn" type="button" onClick={downloadSelectedHtml} disabled={busy || !data.students.length}><Code2 size={16}/> Download selected HTML</button><button className="btn" type="button" onClick={downloadAllHtmlZip} disabled={busy || !data.students.length}><Archive size={16}/> Download all HTML (ZIP)</button></div></div>
         <div className="panel-subsection marksheet-download-panel"><h3>Download marksheets</h3><p className="muted">Exports the same rendered marksheet design shown in Preview. A4 portrait, 300 DPI image capture.</p>
           <div className="form-grid three">
             <label className="field"><span>Students</span><select value={exportSelection} onChange={e=>setExportSelection(e.target.value as 'all'|'selected'|'current')}><option value="all">All students</option><option value="selected">Selected students</option><option value="current">Currently selected student</option></select></label>
             <label className="field"><span>Format</span><select value={exportFormat} onChange={e=>setExportFormat(e.target.value as MarksheetExportFormat)}><option value="pdf">PDF</option><option value="png">PNG image</option><option value="jpg">JPEG image</option></select></label>
             {exportFormat==='pdf' && <label className="field"><span>Multiple PDF output</span><select value={exportPdfMode} onChange={e=>setExportPdfMode(e.target.value as 'combined'|'individual')}><option value="combined">One combined PDF</option><option value="individual">Individual PDFs in ZIP</option></select></label>}
           </div>
           {exportSelection==='selected' && <div className="export-student-picker"><div className="row-actions"><strong>Select students ({exportSelectedIds.length})</strong><button className="btn" type="button" onClick={()=>setExportSelectedIds(data.students.map(student=>student.studentId))}>Select all</button><button className="btn" type="button" onClick={()=>setExportSelectedIds([])}>Clear</button></div><div className="export-student-list">{data.students.map(student=><label key={student.studentId}><input type="checkbox" checked={exportSelectedIds.includes(student.studentId)} onChange={e=>setExportSelectedIds(previous=>e.target.checked?[...previous,student.studentId]:previous.filter(id=>id!==student.studentId))}/><span>{student.roll} · {student.name || 'Unnamed student'}</span></label>)}</div></div>}
           <div className="row-actions"><button className="btn btn-primary" onClick={()=>void downloadMarksheets()} disabled={busy || !data.students.length}><Download size={16}/> Download {exportSelection==='all'?'marksheets':exportSelection==='current'?'marksheet':'selected marksheets'}</button>{exportProgress && <><span className="muted">Rendering {exportProgress.completed} of {exportProgress.total}</span><button className="btn" onClick={()=>{exportCancelledRef.current=true;}}>Cancel</button></>}</div>
         </div>
      </section>}
      {section==='about' && <section className="panel developer-about"><div className="panel-heading"><div><h2>About Marksheet Studio</h2><p>Application information and developer details.</p></div></div><div className="developer-about-content"><div className="developer-app-summary"><img src="/icons/icon-192x192.png" alt="Marksheet Studio V2"/><div><h3>Marksheet Studio V2</h3><p>Student Result &amp; Marksheet Management</p><span>Version 2.0.0</span></div></div><div className="developer-profile-card"><div className="developer-avatar" aria-label="Satish Kumar Sharma initials">SKS</div><div className="developer-profile-copy"><span className="developer-eyebrow">CREATOR &amp; DEVELOPER</span><h3>Satish Kumar Sharma</h3><p>Building practical digital solutions for education and productivity.</p></div></div><div className="developer-links"><a href="https://isatish.in" target="_blank" rel="noopener noreferrer"><Globe size={17}/> Website <span>isatish.in</span></a><a href="https://github.com/skwebs" target="_blank" rel="noopener noreferrer"><Github size={17}/> GitHub <span>github.com/skwebs</span></a><a href="mailto:contact@isatish.in"><Mail size={17}/> Email <span>contact@isatish.in</span></a></div><p className="developer-copyright">© 2026 Satish Kumar Sharma. All rights reserved.</p></div></section>}
      {section==='help' && <section className="panel"><div className="panel-heading"><div><h2>Help & Guides</h2><p>Practical instructions and sample files for the complete marksheet workflow.</p></div></div><div className="help-grid">{[['Getting started','Create or select a workspace for the required class and academic session, complete School Profile, add students, configure exams and subjects, enter marks, then preview and print.'],['Workspaces','Use Workspace Manager to create, search, switch, archive, restore or delete class/session workspaces. A new workspace copies school profile, exam and marksheet configuration but starts with no students, marks or attendance. Switching workspaces keeps each class/session data separate.'],['School profile','Enter school identity and configure the three optional header information columns, school-banner management line, left/right logos, watermark, grading, signatures and marksheet layout.'],['Students','Add students manually or import a CSV/XLSX. Roll and student name are required by the importer; Gender is optional. Existing class changes are separately controlled by Allow changing class of existing students. Changing one student\'s class moves that student\'s current-session enrollment, marks and attendance to the destination class. Previous-session workspaces are preserved.'],['Exam configuration','Choose six, four, two or custom examinations. Each exam has its own raw maximum and weightage contribution. Configure which exams appear on marksheets, review their automatic order numbers, and use arrow controls to reorder selected columns. Hidden columns retain their marks and promotion-calculation availability.'],['Marks entry','Select an exam tab and enter numeric marks or a configured non-numeric status. Values above the configured maximum are rejected. Exam-wide absence marks every enabled subject Ab; individual subject statuses can also be entered. Multi-exam uploads are grouped by the Exam column and selected exam checkboxes.'],['Attendance & remarks','Set total working days once in the attendance header. Import Excel/CSV using Session, Class, Roll, Name and Present day. Roll and Present day are required; Session, Class and Name are optional but are checked when supplied. Working days are taken from the attendance header. Invalid rows can be reviewed while valid rows are imported; existing attendance can be replaced or skipped. Roll numbers with leading zeros are matched automatically.'],['Data validation & class editing','Configure Required, Recommended or Optional independently for student, school, examination, academic, attendance, additional and signature information. Required gaps block marksheet output; recommended gaps prompt for confirmation. Existing class configuration editing, individual student class transfers, and active workspace class-name editing are three separate permissions. Empty workspaces allow Class editing by default. When student records exist, the sidebar Class field is locked unless Allow editing class when student records exist is enabled; changing it safely renames the active workspace without overwriting another workspace.'] ,['Marksheet generation','Choose report exams, table orientation and display options. A student receives a marksheet only when at least one numeric mark exists in the selected report examinations. Students absent in every selected subject/exam are skipped. Required data blocks output; recommended missing data requires confirmation.'],['QR code','Scan the QR code with a phone camera or QR reader to read the student result summary. The centre image uses the school logo by default; enable Use separate image for QR code in School Profile to upload another image.'],['Installable app (PWA)','On supported browsers, use the Install app button or the browser menu to install Marksheet Studio. The application shell and downloaded assets are cached for offline use after the first successful online load; data remains in this browser’s IndexedDB.'],['Backup & restore','ZIP backups include all class data, exam configuration, settings, assets and both marksheet templates. Restore shows a class/session conflict preview before replacing the matching workspace.']].map(([title,body])=><article className="help-card" key={title}><h3>{title}</h3><p>{body}</p></article>)}</div><div className="panel-subsection"><h3>Sample Excel / CSV files</h3><p>Download these CSV templates, open them in Excel or LibreOffice, replace the sample rows, and save as CSV or XLSX.</p><div className="help-downloads"><button className="btn" onClick={downloadStudentTemplate}><Download size={15}/> Student details (Gender optional)</button><button className="btn" onClick={downloadAttendanceTemplate}><Download size={15}/> Attendance template</button>{exams.map(k=><button className="btn" key={k} onClick={()=>downloadExamSample(k)}><Download size={15}/> {data.exams[k].shortName} marks</button>)}<button className="btn btn-primary" onClick={downloadCombinedSample}><Download size={15}/> Combined exam sample</button></div><small className="muted">Marks files use Session, Exam, Class, optional Section, Roll and subject columns. Each row represents one student in one examination.</small></div></section>}
      {data.settings.showFloatingPreview !== false && <button type="button" className={`floating-marksheet-preview ${data.settings.floatingPreviewPosition === 'right-center' ? 'floating-preview-center' : 'floating-preview-bottom'}`} onClick={() => { void preview(); }} aria-label="Preview marksheet"><Eye size={17}/><span>Preview marksheet</span></button>}
      <footer className="app-footer"><span>Local-first · no server database</span><span>{data.students.length} students · {data.subjects.length} subjects · {exams.length} exams</span><span className="footer-developer-credit">Developed by <strong>Satish Kumar Sharma</strong></span></footer>
    </main>
    {workspaceDialogOpen && <div className="workspace-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setWorkspaceDialogOpen(false);}}>
      <section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title">
        <header className="workspace-modal-header"><div><h2 id="workspace-modal-title">Create new workspace</h2><p>Set the class identity for a separate student result workspace.</p></div><button type="button" className="icon-btn" aria-label="Close dialog" onClick={()=>setWorkspaceDialogOpen(false)}><X size={18}/></button></header>
        <div className="workspace-modal-fields">
          <label className="field"><span>Academic session *</span><input value={newWorkspaceSession} onChange={event=>setNewWorkspaceSession(event.target.value)} placeholder="2026-2027"/></label>
          <label className="field"><span>Class *</span><input value={newWorkspaceClass} onChange={event=>setNewWorkspaceClass(event.target.value)} placeholder="e.g. 8"/></label>
          {data.settings.sectionEnabled && <label className="field"><span>Section (optional)</span><input value={newWorkspaceSection} onChange={event=>setNewWorkspaceSection(event.target.value)} placeholder="e.g. A"/></label>}
        </div>
        <div className="workspace-copy-note"><Check size={16}/><span>School profile, exam configuration, marksheet settings and grading rules will be copied. Students, marks, attendance and working days will start empty.</span></div>
        <footer className="workspace-modal-footer"><button type="button" className="btn" onClick={()=>setWorkspaceDialogOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" onClick={()=>void createNewWorkspace()} disabled={!newWorkspaceClass.trim() || !newWorkspaceSession.trim()}><Plus size={15}/> Create and open</button></footer>
      </section>
    </div>}
    {sheetPicker && <div className="crop-modal-backdrop" role="presentation"><section className="crop-modal" role="dialog" aria-modal="true" aria-labelledby="sheet-picker-title"><header className="crop-modal-header"><div><h2 id="sheet-picker-title">Select worksheet</h2><p>This workbook contains multiple worksheets. Select the sheet containing the import data.</p></div><button className="icon-btn" type="button" onClick={() => setSheetPicker(null)} aria-label="Close">✕</button></header><div style={{padding:'16px 20px'}}><label className="field"><span>Worksheet</span><select id="import-sheet-select" defaultValue={sheetPicker.sheetNames.find(name => name.trim().toLowerCase() === (sheetPicker.kind === 'attendance' ? 'attendance' : sheetPicker.kind === 'students' ? 'students' : 'exam marks')) || sheetPicker.sheetNames[0]}>{sheetPicker.sheetNames.map(name=><option key={name} value={name}>{name}</option>)}</select></label></div><footer className="crop-modal-footer"><button className="btn" type="button" onClick={() => setSheetPicker(null)}>Cancel</button><button className="btn btn-primary" type="button" onClick={async () => { const pending = sheetPicker; const select = document.getElementById('import-sheet-select') as HTMLSelectElement | null; const name = select?.value || pending.sheetNames[0]; setSheetPicker(null); await continueImportFromSheet(pending.file, pending.kind, pending.mode, name); }}>Continue</button></footer></section></div>}
    {headerMapping && <div className="crop-modal-backdrop" role="presentation"><section className="crop-modal" role="dialog" aria-modal="true" aria-labelledby="header-map-title"><header className="crop-modal-header"><div><h2 id="header-map-title">Map import columns</h2><p>Worksheet: {headerMapping.sheetName}. Select the header row and map source columns to application fields.</p></div><button className="icon-btn" type="button" onClick={() => setHeaderMapping(null)} aria-label="Close">✕</button></header><div style={{padding:'16px 20px',display:'grid',gap:12,maxHeight:'60vh',overflowY:'auto'}}><label className="field"><span>Header row</span><select value={headerMapping.headerRow} onChange={e=>{const index=Number(e.target.value);setHeaderMapping(current=>current?{...current,headerRow:index,selected:{}}:current);}}>{headerMapping.headerRows.map(row=><option key={row.index} value={row.index}>Row {row.index+1}: {row.headers.filter(Boolean).slice(0,5).join(' · ')}</option>)}</select></label>{headerMapping.fields.map(field=><label className="field" key={field}><span>{field}</span><select value={headerMapping.selected[field] || ''} onChange={e=>setHeaderMapping(current=>current?{...current,selected:{...current.selected,[field]:e.target.value}}:current)}><option value="">Not mapped</option>{(headerMapping.headerRows.find(row=>row.index===headerMapping.headerRow)?.headers || []).map((header,index)=><option key={`${header}-${index}`} value={header}>{header}</option>)}</select></label>)}</div><footer className="crop-modal-footer"><button className="btn" type="button" onClick={()=>setHeaderMapping(null)}>Cancel</button><button className="btn btn-primary" type="button" onClick={()=>void applyHeaderMapping()}>Continue import</button></footer></section></div>}
    {isBootstrapping && <div className="app-splash" role="status" aria-live="polite"><div className="app-splash-card"><img src="/icons/icon-192x192.png" alt="Marksheet Studio V2 logo"/><h1>Marksheet Studio V2</h1><p>Student Results &amp; Marksheet Management</p><span className="splash-developer-credit">Developed by Satish Kumar Sharma</span><span className="splash-loading"><span className="splash-spinner" aria-hidden="true"/>Preparing your workspace…</span></div></div>}
    {cropDraft && <StudentPhotoCropModal draft={cropDraft} outputScale={([1,1.5,2,3,4].includes(data.settings.photoCropOutputScale) ? data.settings.photoCropOutputScale : 1) as 1|1.5|2|3|4} onCancel={() => setCropDraft(null)} onSelectNewImage={async file => { try { const src = await fileToDataUrl(file); setCropDraft(prev => prev ? { ...prev, src, fileName: file.name } : prev); } catch { alert('Could not read this image file.'); } }} onUseOriginal={(studentId, imageDataUrl) => { updateStudent(studentId, 'photo', imageDataUrl); setCropDraft(null); setNotice('Original photo saved without cropping.'); }} onApply={(studentId, imageDataUrl) => { updateStudent(studentId, 'photo', imageDataUrl); setCropDraft(null); setNotice('Student photo cropped and saved.'); }} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
