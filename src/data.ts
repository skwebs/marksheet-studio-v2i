import type { AppData, Student, ExamKey, Marks, ExamPreset } from './types';
import { normalizeAcademicSession, normalizeRollNumber } from './normalization';

const getLocalDateInputValue = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };

export const examKeys: ExamKey[] = ['pa1', 'pa2', 'hy', 'pa3', 'pa4', 'final'];
export const examPresets: Record<Exclude<ExamPreset, 'custom'>, ExamKey[]> = { six: [...examKeys], four: ['pa1', 'hy', 'pa3', 'final'], two: ['hy', 'final'] };
export const getExamKeys = (data: Pick<AppData, 'examOrder' | 'exams'>): ExamKey[] => { const ordered = Array.isArray(data.examOrder) ? data.examOrder.filter(key => Boolean(data.exams?.[key])) : []; return ordered.length ? ordered : Object.keys(data.exams || {}); };
export const defaultSubjects = [
  { id: 'hindi', name: 'Hindi' }, { id: 'english', name: 'English' },
  { id: 'maths', name: 'Maths' }, { id: 'science', name: 'Science' },
  { id: 'sst', name: 'Social Science' }, { id: 'computer', name: 'Computer' }
];

/** Subjects follow the school's class-wise curriculum. The computer ID is kept stable for marks compatibility. */
export function subjectsForClass(className: string) {
  const n = Number(String(className).match(/\d+/)?.[0] || 0);
  const common = [
    { id: 'hindi', name: 'Hindi' },
    { id: 'english', name: 'English' },
    { id: 'maths', name: 'Maths' }
  ];
  if (n >= 1 && n <= 3) return [...common, { id: 'evs', name: 'EVS' }];
  if (n >= 4 && n <= 10) return [...common,
    { id: 'science', name: 'Science' },
    { id: 'sst', name: 'Social Science' },
    { id: 'computer', name: n >= 9 ? 'Information Technology' : 'Computer' }
  ];
  return defaultSubjects;
}
export function blankStudent(n: number, subjects = defaultSubjects): Student {
  return {
    studentId: crypto.randomUUID(), roll: String(n), name: '', father: '', mother: '',
    dob: '', gender: '', photo: '',
    attendance: { workingDays: 0, daysPresent: 0, daysAbsent: 0, remarks: '', hasRecord: false },
    remarks: { overall: '', attendance: '', subjects: Object.fromEntries(subjects.map(s => [s.id, ''])) }
  };
}
export function emptyMarks(student: Student, subjects = defaultSubjects): Marks {
  return { studentId: student.studentId, roll: student.roll, ...Object.fromEntries(subjects.map(s => [s.id, null])) };
}
export const DEMO_SCHOOL_LOGO = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20160%20160%22%20role%3D%22img%22%20aria-label%3D%22Demo%20school%20logo%22%3E%3Crect%20width%3D%22160%22%20height%3D%22160%22%20rx%3D%2224%22%20fill%3D%22%23eff6ff%22%2F%3E%3Cpath%20d%3D%22M30%2070%2080%2035l50%2035v55H30z%22%20fill%3D%22%231d4ed8%22%2F%3E%3Cpath%20d%3D%22M48%20125V82h64v43%22%20fill%3D%22%23dbeafe%22%2F%3E%3Cpath%20d%3D%22M69%20125V96h22v29%22%20fill%3D%22%231e40af%22%2F%3E%3Cpath%20d%3D%22M19%2072%2080%2027l61%2045%22%20fill%3D%22none%22%20stroke%3D%22%230f172a%22%20stroke-width%3D%227%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3Cpath%20d%3D%22M56%2058h48%22%20stroke%3D%22%23facc15%22%20stroke-width%3D%226%22%20stroke-linecap%3D%22round%22%2F%3E%3Ccircle%20cx%3D%2280%22%20cy%3D%2277%22%20r%3D%225%22%20fill%3D%22%23facc15%22%2F%3E%3C%2Fsvg%3E';

export function createDefaultData(): AppData {
  const students: Student[] = [];
  const results = Object.fromEntries(examKeys.map(k => [k, [] as Marks[]])) as Record<ExamKey, Marks[]>;
  return {
    schemaVersion: '1.0.0',
    academicSession: '2026-2027',
    examType: 'HALF-YEAR EXAMINATION',
    qrExamName: 'HY EXAM',
    classInfo: { className: '6', section: '', classTeacher: '', totalWorkingDays: 120 },
    school: {
      name: 'Demo Public School', address: 'Demo City, India',
      affiliation: 'Demo Education Board', registrationNumber: 'DEMO-0001', established: '2020',
      logo: DEMO_SCHOOL_LOGO, logoLeft: '', logoRight: '', watermark: '', watermarkUseLeftLogo: true, rightLogoUseLeftLogo: true, showLeftLogo: true, showRightLogo: true, showWatermark: true, principalName: '', examControllerName: '', classTeacherName: '',
      headerMeta: { leftLabel: 'Established', middleLabel: 'Affiliation', rightLabel: 'Registration No.', showLeft: true, showMiddle: true, showRight: true, managementLine: '', showManagementLine: false }
    },
    subjects: subjectsForClass('6'),
    classSubjectConfigs: { '6': subjectsForClass('6') },
    examPreset: 'six',
    examOrder: [...examKeys],
    exams: {
      pa1: { name: 'Periodic Assessment I', shortName: 'PA-I', maxMarks: 40, weightage: 5 },
      pa2: { name: 'Periodic Assessment II', shortName: 'PA-II', maxMarks: 40, weightage: 5 },
      hy: { name: 'Half-Yearly Examination', shortName: 'Half-Yearly', maxMarks: 80, weightage: 40 },
      pa3: { name: 'Periodic Assessment III', shortName: 'PA-III', maxMarks: 40, weightage: 5 },
      pa4: { name: 'Periodic Assessment IV', shortName: 'PA-IV', maxMarks: 40, weightage: 5 },
      final: { name: 'Final Examination', shortName: 'Final', maxMarks: 80, weightage: 40 }
    },
    students, results,
    grading: { passPercentage: 33, grades: [
      { minPercentage: 90, operator: '>=', grade: 'A+' }, { minPercentage: 80, operator: '>=', grade: 'A' },
      { minPercentage: 70, operator: '>=', grade: 'B+' }, { minPercentage: 60, operator: '>=', grade: 'B' },
      { minPercentage: 50, operator: '>=', grade: 'C+' }, { minPercentage: 40, operator: '>=', grade: 'C' },
      { minPercentage: 30, operator: '>=', grade: 'D' }, { minPercentage: 0, operator: '>=', grade: 'E' }
    ] },
    marksheetSettings: { showPhoto: true, showAttendance: true, showRemarks: true, showGrade: true, tableOrientation: 'auto', reportExams: ['pa1','pa2','hy'], calculationExams: ['pa1','pa2','hy'], showTotalColumn: true, showSubjectGrade: true, showMarksRow: true, showGradeRow: true, showOverallSummary: true, marksPrecision: 0, watermarkMode: 'repeat', watermarkOpacity: 10, watermarkRepeatSize: 60, watermarkCenterSize: 420, headerLayout: 'two-rows', headerGapMm: 4, showIssueDate: true, issueDate: getLocalDateInputValue(), issueDateFormat: 'DD-MM-YYYY', issueDateLabel: 'Date', qrUseSeparateImage: false, qrSeparateImage: '', qrSizeMm: 35, signatures: [
      { id: 'class-teacher', label: 'Class Teacher', name: '', enabled: true, widthMm: 32, heightMm: 10, offsetMm: 0 },
      { id: 'exam-controller', label: 'Exam Controller', name: '', enabled: true, widthMm: 32, heightMm: 10, offsetMm: 0 },
      { id: 'principal', label: 'Principal', name: '', enabled: true, widthMm: 32, heightMm: 10 }
    ] },
    settings: { photoCropOutputScale: 1, showFloatingPreview: true, floatingPreviewPosition: 'right-bottom', sessionDisplayFormat: 'YYYY-YYYY', sectionEnabled: false, allowMultipleClassImport: false, allowEditExistingClassConfig: false, allowChangeExistingStudentClass: false, allowEditActiveClass: false, validationLevels: { 'student.roll':'required', 'student.name':'required', 'student.father':'recommended', 'student.mother':'recommended', 'student.dob':'optional', 'student.gender':'optional', 'student.photo':'optional', 'school.name':'required', 'school.address':'recommended', 'school.established':'optional', 'school.affiliation':'optional', 'school.registrationNumber':'optional', 'school.headerLeftLabel':'optional', 'school.headerMiddleLabel':'optional', 'school.headerRightLabel':'optional', 'school.managementLine':'optional', 'school.logoLeft':'optional', 'school.logoRight':'optional', 'school.watermark':'optional', 'exam.type':'recommended', 'exam.session':'required', 'exam.class':'required', 'exam.section':'optional', 'exam.names':'required', 'exam.maximumMarks':'required', 'academic.subjects':'required', 'academic.gradingScale':'required', 'attendance.workingDays':'optional', 'attendance.presentDays':'optional', 'additional.issueDate':'optional', 'additional.remarks':'optional', 'signature.label':'required', 'signature.name':'optional', 'signature.image':'optional' }, promotionExams: [...examKeys], requiredStudentFields: ['roll', 'name'], recommendedStudentFields: ['father','mother'], requiredExamMarks: [], recommendedExamMarks: ['pa1','pa2','hy'], nonNumericMarkStatuses: [{ id: 'absent', symbol: '-', code: 'Ab', meaning: 'Absent', displayValue: 'Ab', calculationRule: 'exclude', active: true, isAbsence: true }] },
    remarkRules: {
      overall: [
        { grade: 'A+', text: 'Outstanding overall performance.' },
        { grade: 'A', text: 'Excellent overall performance.' },
        { grade: 'B+', text: 'Very good overall performance.' },
        { grade: 'B', text: 'Good performance. Keep working consistently.' },
        { grade: 'C+', text: 'Satisfactory performance; more practice will help.' },
        { grade: 'C', text: 'Fair performance. Continue regular practice.' },
        { grade: 'D', text: 'Needs improvement. Please work harder.' },
        { grade: 'E', text: 'Needs significant improvement and additional support.' }
      ],
      weakSubjectRules: [{ id: 'weak-40', belowPercentage: 40, template: 'Needs more effort in {subject}.' }],
      weakSubjectBelowPercentage: 40,
      weakSubjectTemplate: 'Needs more effort in {subject}.',
      attendanceBelowPercentage: 75,
      attendanceTemplate: 'Attendance is low ({percentage}%). Regular attendance is advised.'
    }
  };
}
export function normalizeData(input: any): AppData {
  if (!input || typeof input !== 'object' || !Array.isArray(input.students)) throw new Error('Backup JSON must contain a students array.');
  const base = createDefaultData();
  const students = input.students.map((raw: any, i: number) => ({
    ...blankStudent(i + 1), ...raw,
    studentId: String(raw.studentId || crypto.randomUUID()),
    roll: String(raw.roll ?? ''),
    attendance: { ...blankStudent(i + 1).attendance, ...(raw.attendance || {}) },
    remarks: { ...blankStudent(i + 1).remarks, ...(raw.remarks || {}), subjects: { ...blankStudent(i + 1).remarks.subjects, ...(raw.remarks?.subjects || {}) } }
  }));
  const className = String(input.classInfo?.className ?? base.classInfo.className);
  const expectedSubjects = subjectsForClass(className);
  const incomingSubjects = Array.isArray(input.subjects) ? input.subjects : [];
  const subjectIdsMatch = incomingSubjects.length > 0;
  const result: AppData = {
    ...base, ...input,
    academicSession: normalizeAcademicSession(input.academicSession ?? base.academicSession),
    examType: String(input.examType || base.examType),
    qrExamName: String(input.qrExamName ?? base.qrExamName),
    classInfo: { ...base.classInfo, ...(input.classInfo || {}) },
    school: { ...base.school, ...(input.school || {}), headerMeta: { ...base.school.headerMeta, ...(input.school?.headerMeta || {}) }, logoLeft: input.school?.logoLeft || input.school?.logo || '', watermarkUseLeftLogo: input.school?.watermarkUseLeftLogo ?? !Boolean(input.school?.watermark), rightLogoUseLeftLogo: input.school?.rightLogoUseLeftLogo ?? true },
    subjects: subjectIdsMatch ? incomingSubjects.map((subject: any) => ({ id: String(subject.id || crypto.randomUUID()), name: String(subject.name || ''), ...(subject.enabled === undefined ? {} : { enabled: Boolean(subject.enabled) }) })) : expectedSubjects,
    classSubjectConfigs: { ...(input.classSubjectConfigs || {}), [className]: subjectIdsMatch ? incomingSubjects.map((subject: any) => ({ id: String(subject.id || crypto.randomUUID()), name: String(subject.name || ''), ...(subject.enabled === undefined ? {} : { enabled: Boolean(subject.enabled) }) })) : expectedSubjects },
    examPreset: (['six','four','two','custom'].includes(input.examPreset) ? input.examPreset : 'six') as ExamPreset,
    examOrder: Array.isArray(input.examOrder) && input.examOrder.length ? input.examOrder.map(String).filter((key: string) => Boolean(input.exams?.[key])) : (Object.keys(input.exams || {}).length ? Object.keys(input.exams) : [...examKeys]),
    exams: Object.fromEntries([...new Set([...(Array.isArray(input.examOrder) ? input.examOrder : []), ...Object.keys(input.exams || {})])].map((k: string) => { const old = input.exams?.[k] || {}; const fallback = (base.exams as Record<string, any>)[k] || { name: k, shortName: k.toUpperCase(), maxMarks: 100, weightage: 100 }; const isLegacy = old.weightage === undefined && old.maxMarks !== undefined; const legacyContribution = Number(old.maxMarks); return [k, { ...fallback, ...old, name: String(old.name ?? fallback.name), shortName: String(old.shortName ?? fallback.shortName), maxMarks: isLegacy ? fallback.maxMarks : Number(old.maxMarks ?? fallback.maxMarks), weightage: isLegacy ? legacyContribution : Number(old.weightage ?? fallback.weightage) }]; })) as AppData['exams'],
    students,
    results: Object.fromEntries([...new Set([...(Array.isArray(input.examOrder) ? input.examOrder : []), ...Object.keys(input.exams || {}), ...Object.keys(input.results || {})])].map((k: string) => [k, Array.isArray(input.results?.[k]) ? input.results[k] : []])) as AppData['results'],
    grading: { ...base.grading, ...(input.grading || {}), grades: Array.isArray(input.grading?.grades) && input.grading.grades.length ? input.grading.grades.map((g: any) => ({ grade: String(g.grade || ''), minPercentage: Number(g.minPercentage) || 0, operator: ['>=','>','<=','<'].includes(g.operator) ? g.operator : '>=' })) : base.grading.grades },
    marksheetSettings: { ...base.marksheetSettings, ...(input.marksheetSettings || {}), signatures: Array.isArray(input.marksheetSettings?.signatures) && input.marksheetSettings.signatures.length ? input.marksheetSettings.signatures.slice(0,4).map((sig: any, i: number) => ({ id: String(sig.id || `signature-${i+1}`), label: String(sig.label || ['Class Teacher','Exam Controller','Principal','Director'][i] || 'Designation'), name: String(sig.name || ''), signatureImage: String(sig.signatureImage || ''), enabled: sig.enabled !== false, widthMm: Math.min(60, Math.max(15, Number(sig.widthMm) || 32)), heightMm: Math.min(20, Math.max(5, Number(sig.heightMm) || 10)), offsetMm: Math.max(-20, Math.min(20, Number(sig.offsetMm) || 0)) })) : base.marksheetSettings.signatures.map((sig, i) => ({ ...sig, name: String([input.classInfo?.classTeacher || input.school?.classTeacherName || '', input.school?.examControllerName || '', input.school?.principalName || ''][i] || '') })), marksPrecision: [0,1,2].includes(Number(input.marksheetSettings?.marksPrecision)) ? Number(input.marksheetSettings.marksPrecision) as 0|1|2 : 0, watermarkMode: input.marksheetSettings?.watermarkMode === 'single' ? 'single' : 'repeat', watermarkOpacity: Number(input.marksheetSettings?.watermarkOpacity ?? 10), watermarkRepeatSize: Number(input.marksheetSettings?.watermarkRepeatSize ?? 60), watermarkCenterSize: Number(input.marksheetSettings?.watermarkCenterSize ?? 420), headerLayout: input.marksheetSettings?.headerLayout === 'single-row' ? 'single-row' : 'two-rows', headerGapMm: Math.max(0, Math.min(20, Number(input.marksheetSettings?.headerGapMm ?? 4))), showIssueDate: input.marksheetSettings?.showIssueDate !== false, issueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(input.marksheetSettings?.issueDate || '')) ? String(input.marksheetSettings.issueDate) : getLocalDateInputValue(), issueDateFormat: ['DD-MM-YYYY','DD/MM/YYYY','YYYY-MM-DD'].includes(input.marksheetSettings?.issueDateFormat) ? input.marksheetSettings.issueDateFormat : 'DD-MM-YYYY', issueDateLabel: String(input.marksheetSettings?.issueDateLabel ?? 'Date'), qrUseSeparateImage: input.marksheetSettings?.qrUseSeparateImage === true, qrSeparateImage: String(input.marksheetSettings?.qrSeparateImage || ''), qrSizeMm: Math.max(25, Math.min(50, Number(input.marksheetSettings?.qrSizeMm) || 35)), reportExams: Array.isArray(input.marksheetSettings?.reportExams) ? input.marksheetSettings.reportExams.filter((key: unknown): key is ExamKey => typeof key === 'string' && Boolean(input.exams?.[key])) : base.marksheetSettings.reportExams, calculationExams: Array.isArray(input.marksheetSettings?.reportExams) ? input.marksheetSettings.reportExams.filter((key: unknown): key is ExamKey => typeof key === 'string' && Boolean(input.exams?.[key])) : [...base.marksheetSettings.reportExams] },
    settings: { ...base.settings, ...(input.settings || {}), photoCropOutputScale: ([1, 1.5, 2, 3, 4].includes(input.settings?.photoCropOutputScale) ? input.settings.photoCropOutputScale : 1), showFloatingPreview: input.settings?.showFloatingPreview !== false, floatingPreviewPosition: input.settings?.floatingPreviewPosition === 'right-center' ? 'right-center' : 'right-bottom', sessionDisplayFormat: input.settings?.sessionDisplayFormat === 'YYYY-YY' ? 'YYYY-YY' : 'YYYY-YYYY', allowMultipleClassImport: input.settings?.allowMultipleClassImport === true, allowEditExistingClassConfig: input.settings?.allowEditExistingClassConfig === true, allowChangeExistingStudentClass: input.settings?.allowChangeExistingStudentClass === true, allowEditActiveClass: input.settings?.allowEditActiveClass === true, validationLevels: { ...base.settings.validationLevels, ...(input.settings?.validationLevels || {}) }, promotionExams: Array.isArray(input.settings?.promotionExams) ? input.settings.promotionExams.filter((key: string) => Boolean(input.exams?.[key])) : (Array.isArray(input.examOrder) ? input.examOrder : [...examKeys]), requiredStudentFields: Array.isArray(input.settings?.requiredStudentFields) ? input.settings.requiredStudentFields.map(String) : ['roll','name'], recommendedStudentFields: Array.isArray(input.settings?.recommendedStudentFields) ? input.settings.recommendedStudentFields.map(String) : ['father','mother'], requiredExamMarks: Array.isArray(input.settings?.requiredExamMarks) ? input.settings.requiredExamMarks.filter((key: string) => Boolean(input.exams?.[key])) : [], recommendedExamMarks: Array.isArray(input.settings?.recommendedExamMarks) ? input.settings.recommendedExamMarks.filter((key: string) => Boolean(input.exams?.[key])) : (Array.isArray(input.marksheetSettings?.reportExams) ? input.marksheetSettings.reportExams.filter((key: string) => Boolean(input.exams?.[key])) : ['pa1','pa2','hy'].filter(key => Boolean(input.exams?.[key]))), nonNumericMarkStatuses: Array.isArray(input.settings?.nonNumericMarkStatuses) ? input.settings.nonNumericMarkStatuses.map((item: any, index: number) => ({ id: String(item.id || `status-${index+1}`), symbol: String(item.symbol ?? (item.code === 'Ab' ? '-' : '')).trim(), code: String(item.code || '').trim(), meaning: String(item.meaning || ''), displayValue: String(item.displayValue || item.code || '').trim(), calculationRule: item.calculationRule === 'count-as-zero' ? 'count-as-zero' : 'exclude', active: item.active !== false, isAbsence: item.isAbsence === true || (item.isAbsence === undefined && String(item.meaning || '').toLowerCase() === 'absent') })).filter((item: any) => item.code) : base.settings.nonNumericMarkStatuses },
    remarkRules: {
      ...base.remarkRules,
      ...(input.remarkRules || {}),
      overall: Array.isArray(input.remarkRules?.overall) && input.remarkRules.overall.length
        ? input.remarkRules.overall.map((rule: any) => {
            if (typeof rule.grade === 'string') return { grade: rule.grade, text: String(rule.text || '') };
            // Backward compatibility: convert previous percentage-based rules to the matching grade.
            const threshold = Number(rule.minPercentage) || 0;
            const matchingGrade = [...(input.grading?.grades || base.grading.grades)]
              .sort((a: any, b: any) => Number(b.minPercentage) - Number(a.minPercentage))
              .find((g: any) => threshold >= Number(g.minPercentage))?.grade || 'E';
            return { grade: String(matchingGrade), text: String(rule.text || '') };
          })
        : base.remarkRules.overall,
      weakSubjectRules: Array.isArray(input.remarkRules?.weakSubjectRules)
        ? input.remarkRules.weakSubjectRules
            .map((rule: any, index: number) => ({
              id: String(rule.id || `weak-${index + 1}`),
              belowPercentage: Math.max(0, Math.min(100, Number(rule.belowPercentage) || 0)),
              template: String(rule.template || '')
            }))
            .sort((a: any, b: any) => a.belowPercentage - b.belowPercentage)
        : [{
            id: 'weak-legacy',
            belowPercentage: Math.max(0, Math.min(100, Number(input.remarkRules?.weakSubjectBelowPercentage ?? base.remarkRules.weakSubjectBelowPercentage))),
            template: String(input.remarkRules?.weakSubjectTemplate ?? base.remarkRules.weakSubjectTemplate)
          }]
    }
  };
  // Migrate legacy student validation arrays into the unified field-level model.
  if (!input.settings?.validationLevels) {
    for (const field of ['roll','name','father','mother','dob','gender','photo']) {
      result.settings.validationLevels[`student.${field}`] = result.settings.requiredStudentFields.includes(field)
        ? 'required'
        : result.settings.recommendedStudentFields.includes(field) ? 'recommended' : 'optional';
    }
  }
  const activeExamKeys = getExamKeys(result);
  result.marksheetSettings.reportExams = result.marksheetSettings.reportExams.filter(key => activeExamKeys.includes(key));
  result.marksheetSettings.calculationExams = (result.marksheetSettings.calculationExams || result.marksheetSettings.reportExams).filter(key => activeExamKeys.includes(key));
  if (!result.marksheetSettings.calculationExams.length && activeExamKeys.length) result.marksheetSettings.calculationExams = [...result.marksheetSettings.reportExams];
  if (!result.marksheetSettings.reportExams.length && activeExamKeys.length) result.marksheetSettings.reportExams = [activeExamKeys[0]];
  result.settings.promotionExams = result.settings.promotionExams.filter(key => activeExamKeys.includes(key));
  result.settings.requiredExamMarks = result.settings.requiredExamMarks.filter(key => activeExamKeys.includes(key));
  result.settings.recommendedExamMarks = result.settings.recommendedExamMarks.filter(key => activeExamKeys.includes(key));
  result.students = result.students.map((student: Student) => {
    const totalDays = Math.max(0, Number(result.classInfo.totalWorkingDays) || 0);
    const present = Math.min(totalDays, Math.max(0, Number(student.attendance.daysPresent) || 0));
    return { ...student, attendance: { ...student.attendance, workingDays: totalDays, daysPresent: present, daysAbsent: Math.max(0, totalDays - present) } };
  });
  for (const key of getExamKeys(result)) {
    const legacyMax = Number(input.exams?.[key]?.maxMarks);
    const wasLegacyConfig = input.exams?.[key]?.weightage === undefined && Number.isFinite(legacyMax) && legacyMax > 0;
    if (wasLegacyConfig && legacyMax !== result.exams[key].maxMarks) {
      const scale = result.exams[key].maxMarks / legacyMax;
      result.results[key] = (result.results[key] || []).map((mark: any) => Object.fromEntries(Object.entries(mark).map(([field, value]) => [field, field === 'studentId' || field === 'roll' || value === null || value === '' || !Number.isFinite(Number(value)) ? value : Number(value) * scale])) as Marks);
    }
    const existing = new Map((result.results[key] || []).map((m: any) => [String(m.studentId || `roll:${normalizeRollNumber(m.roll)}`), m]));
    result.results[key] = students.map((s: Student) => {
      const m: any = existing.get(s.studentId) || existing.get(`roll:${normalizeRollNumber(s.roll)}`) || {};
      return { ...emptyMarks(s, result.subjects), ...m, studentId: s.studentId, roll: s.roll };
    });
  }
  return result;
}
