import JSZip from 'jszip';
import type { AppData, Student } from './types';
import { getExamKeys, normalizeData, subjectsForClass } from './data';
import { calculatePromotionScore } from './calculations';
import { normalizeAcademicSession } from './normalization';

const dataUrlToBlob = async (url: string) => (await fetch(url)).blob();
const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});
export type PromotionRollMode = 'static' | 'dynamic';

let promotionExportInFlight = false;

export async function exportZip(data: AppData, template: string, filenamePrefix = "", backupLabel = 'backup', extraManifest: Record<string, unknown> = {}, singleTemplate = '') {
  const zip = new JSZip();
  const manifest: any = structuredClone(data);
  manifest.backupType = filenamePrefix === 'promote_' ? 'promotion' : backupLabel;
  manifest.createdAt = new Date().toISOString();
  Object.assign(manifest, extraManifest);
  manifest.assets = { photos: {}, schoolLogo: null, logoLeft: null, logoRight: null, watermark: null, qrCenterImage: null };
  for (const student of manifest.students as Student[]) {
    if (student.photo?.startsWith('data:')) {
      const blob = await dataUrlToBlob(student.photo);
      const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const path = `photos/${student.studentId}.${extension}`;
      zip.file(path, blob);
      student.photo = path;
      manifest.assets.photos[student.studentId] = path;
    }
  }
  if (manifest.school.logo?.startsWith('data:')) {
    const blob = await dataUrlToBlob(manifest.school.logo);
    zip.file('assets/school-logo', blob);
    manifest.school.logo = 'assets/school-logo';
    manifest.assets.schoolLogo = 'assets/school-logo';
  }
  for (const field of ['logoLeft','logoRight'] as const) { if (manifest.school[field]?.startsWith('data:')) { const blob=await dataUrlToBlob(manifest.school[field]); const path=`assets/${field}`; zip.file(path,blob); manifest.school[field]=path; manifest.assets[field]=path; } }
  if (manifest.marksheetSettings?.qrSeparateImage?.startsWith('data:')) {
    const blob = await dataUrlToBlob(manifest.marksheetSettings.qrSeparateImage);
    zip.file('assets/qr-center-image', blob);
    manifest.marksheetSettings.qrSeparateImage = 'assets/qr-center-image';
    manifest.assets.qrCenterImage = 'assets/qr-center-image';
  }
  if (manifest.school.watermark?.startsWith('data:')) {
    const blob = await dataUrlToBlob(manifest.school.watermark);
    zip.file('assets/watermark', blob);
    manifest.school.watermark = 'assets/watermark';
    manifest.assets.watermark = 'assets/watermark';
  }
  // Include the default school logo referenced by the untouched HTML template.
  // This keeps the template's existing header and watermark working in a standalone backup.
  try {
    const response = await fetch('/demo-school-logo.svg');
    if (response.ok) zip.file('demo-school-logo.svg', await response.blob());
  } catch { /* The user-uploaded logo, if any, is already included above. */ }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('marksheet-template.html', template);
  if (singleTemplate) zip.file('marksheet-template-single.html', singleTemplate);
  const promotionInfo = (extraManifest.promotion || {}) as { rollAssignmentMode?: PromotionRollMode };
  zip.file('README.txt', filenamePrefix === 'promote_' ? `Marksheet Studio promotion package. Contains selected student details, destination class/session and newly assigned roll numbers (${promotionInfo.rollAssignmentMode || 'dynamic'} mode). The manifest includes the old-to-new roll mapping. Previous examination marks and attendance values are intentionally excluded. Import this ZIP through Import / Export to start the destination class workspace.\n` : 'Marksheet Studio class backup. Contains the class data, marks, attendance, settings, template and referenced image assets. Import this ZIP in Marksheet Studio to restore the class data.\n');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const verified = await JSZip.loadAsync(blob);
  if (!verified.file('manifest.json') || !verified.file('marksheet-template.html') || (singleTemplate && !verified.file('marksheet-template-single.html'))) throw new Error('Backup verification failed: required files are missing.');
  const verifiedManifest = JSON.parse(await verified.file('manifest.json')!.async('text'));
  if (!Array.isArray(verifiedManifest.students) || verifiedManifest.students.length !== data.students.length) throw new Error('Backup verification failed: student record count mismatch.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T','_').replace('Z','');
  const promotionMeta = (extraManifest.promotion || {}) as { fromClass?: string; toClass?: string; toSession?: string };
  a.download = filenamePrefix === 'promote_' && promotionMeta.fromClass && promotionMeta.toClass
    ? `promote_class-${safeName(promotionMeta.fromClass)}-to-${safeName(promotionMeta.toClass)}_session-${safeName(promotionMeta.toSession || data.academicSession)}_${timestamp}.zip`
    : `${filenamePrefix}marksheet-studio_class-${safeName(data.classInfo.className)}${data.classInfo.section ? `_${safeName(data.classInfo.section)}` : ''}_session-${safeName(data.academicSession)}_${backupLabel}_${timestamp}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const safeName = (value: string) => String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';

export function buildPromotionData(
  data: AppData,
  destinationClass: string,
  destinationSession: string,
  selectedStudentIds?: string[],
  rollMode: PromotionRollMode = 'dynamic'
): AppData {
  const allowed = selectedStudentIds ? new Set(selectedStudentIds) : null;
  const promotionExams = data.settings.promotionExams?.length ? data.settings.promotionExams : getExamKeys(data);
  // Rank the complete source class first. Static assignment retains these positions,
  // while dynamic assignment closes gaps after unselected students are removed.
  const ranked = [...data.students].sort((a, b) => {
    const aScore = calculatePromotionScore(data, a, promotionExams);
    const bScore = calculatePromotionScore(data, b, promotionExams);
    const marksDiff = bScore.percentage - aScore.percentage || bScore.obtained - aScore.obtained;
    if (marksDiff) return marksDiff;
    const attendancePct = (student: Student) => student.attendance.workingDays > 0 ? student.attendance.daysPresent / student.attendance.workingDays : 0;
    const attendanceDiff = attendancePct(b) - attendancePct(a);
    if (attendanceDiff) return attendanceDiff;
    const ar = Number(a.roll), br = Number(b.roll);
    if (Number.isFinite(ar) && Number.isFinite(br) && ar !== br) return ar - br;
    return a.roll.localeCompare(b.roll, undefined, { numeric: true });
  });
  const selected = ranked
    .map((student, index) => ({ student, rank: index + 1 }))
    .filter(item => !allowed || allowed.has(item.student.studentId));
  const nextSubjects = subjectsForClass(destinationClass);
  const students = selected.map((item, index) => ({
    ...item.student,
    roll: String(rollMode === 'static' ? item.rank : index + 1),
    attendance: { workingDays: 0, daysPresent: 0, daysAbsent: 0, remarks: '' },
    remarks: { overall: '', attendance: '', subjects: Object.fromEntries(nextSubjects.map(subject => [subject.id, ''])) }
  }));
  const results: AppData['results'] = Object.fromEntries(Object.keys(data.results).map(key => [key, []]));
  const classSubjectConfigs = { ...structuredClone(data.classSubjectConfigs), [destinationClass]: nextSubjects };
  return { ...structuredClone(data), academicSession: normalizeAcademicSession(destinationSession), classInfo: { ...data.classInfo, className: destinationClass, totalWorkingDays: 0 }, subjects: nextSubjects, classSubjectConfigs, students, results };
}

export async function exportPromotionZip(
  data: AppData,
  template: string,
  destinationClass: string,
  destinationSession: string,
  selectedStudentIds?: string[],
  singleTemplate = '',
  rollMode: PromotionRollMode = 'dynamic'
) {
  // A module-level lock complements the UI lock and prevents duplicate downloads
  // if another caller reaches this function during an active promotion export.
  if (promotionExportInFlight) throw new Error('A promotion ZIP is already being generated. Please wait for it to finish.');
  promotionExportInFlight = true;
  try {
    const promotion = buildPromotionData(data, destinationClass, destinationSession, selectedStudentIds, rollMode);
    const rankById = new Map<string, number>();
    [...data.students].sort((a, b) => {
      const aScore = calculatePromotionScore(data, a);
      const bScore = calculatePromotionScore(data, b);
      const marksDiff = bScore.percentage - aScore.percentage || bScore.obtained - aScore.obtained;
      if (marksDiff) return marksDiff;
      const attendancePct = (student: Student) => student.attendance.workingDays > 0 ? student.attendance.daysPresent / student.attendance.workingDays : 0;
      const attendanceDiff = attendancePct(b) - attendancePct(a);
      if (attendanceDiff) return attendanceDiff;
      const ar = Number(a.roll), br = Number(b.roll);
      if (Number.isFinite(ar) && Number.isFinite(br) && ar !== br) return ar - br;
      return a.roll.localeCompare(b.roll, undefined, { numeric: true });
    }).forEach((student, index) => rankById.set(student.studentId, index + 1));
    const rollMapping = promotion.students.map(student => ({
      studentId: student.studentId,
      name: student.name,
      previousRoll: data.students.find(source => source.studentId === student.studentId)?.roll || '',
      newRoll: student.roll,
      rank: rankById.get(student.studentId) || 0
    }));
    await exportZip(promotion, template, 'promote_', 'promotion', {
      promotion: {
        fromClass: data.classInfo.className,
        fromSession: data.academicSession,
        toClass: destinationClass,
        toSession: destinationSession,
        selectedStudentCount: promotion.students.length,
        selectedStudentIds: promotion.students.map(student => student.studentId),
        exams: data.settings.promotionExams,
        rollAssignmentMode: rollMode,
        rollMapping,
        ranking: 'weightage-percentage-desc,weightage-obtained-desc,attendance-percentage-desc,previous-roll-asc'
      }
    }, singleTemplate);
  } finally {
    promotionExportInFlight = false;
  }
}

export async function importZip(file: File): Promise<{ data: AppData; template: string; singleTemplate: string; backupType: string }> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('ZIP does not contain manifest.json.');
  const raw = JSON.parse(await manifestFile.async('text'));
  const { backupType: _backupType, createdAt: _createdAt, promotion: _promotion, assets: _assets, ...appData } = raw;
  const data = normalizeData(appData);
  const assets = raw.assets || {};
  for (const student of data.students) {
    const path = assets.photos?.[student.studentId] || (typeof student.photo === 'string' ? student.photo : '');
    if (path && !path.startsWith('data:') && zip.file(path)) {
      const blob = await zip.file(path)!.async('blob');
      student.photo = await blobToDataUrl(blob);
    }
  }
  for (const field of ['logo', 'logoLeft', 'logoRight', 'watermark'] as const) {
    const path = data.school[field];
    if (path && !path.startsWith('data:') && zip.file(path)) {
      data.school[field] = await blobToDataUrl(await zip.file(path)!.async('blob'));
    }
  }
  const qrImagePath = data.marksheetSettings.qrSeparateImage;
  if (qrImagePath && !qrImagePath.startsWith('data:') && zip.file(qrImagePath)) {
    data.marksheetSettings.qrSeparateImage = await blobToDataUrl(await zip.file(qrImagePath)!.async('blob'));
  }
  // Restore the legacy bundled school logo only for backups that explicitly contain it.
  if (!data.school.logo && zip.file('nps-logo.webp')) {
    data.school.logo = await blobToDataUrl(await zip.file('nps-logo.webp')!.async('blob'));
  }
  const template = zip.file('marksheet-template.html') ? await zip.file('marksheet-template.html')!.async('text') : '';
  const singleTemplate = zip.file('marksheet-template-single.html') ? await zip.file('marksheet-template-single.html')!.async('text') : '';
  return { data, template, singleTemplate, backupType: String(raw.backupType || 'backup') };
}
