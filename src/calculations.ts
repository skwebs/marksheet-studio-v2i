import type { AppData, ExamKey, Student } from './types';
import { getExamKeys } from './data';
import { normalizeRollNumber } from './normalization';

export const hasMark = (value: unknown): boolean => value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '') && Number.isFinite(Number(value));
export function getConfiguredMarkStatus(data: AppData, value: unknown, includeInactive = true) {
  const normalized = String(value ?? '').trim().toLocaleLowerCase();
  if (!normalized) return undefined;
  return (data.settings.nonNumericMarkStatuses || []).find(item => (includeInactive || item.active) && [item.code, item.displayValue, item.symbol].some(candidate => String(candidate || '').trim().toLocaleLowerCase() === normalized));
}
export const isNumericMark = hasMark;
export const numericMark = (value: unknown): number => hasMark(value) ? Number(value) : 0;
export const roundMarks = (data: AppData, value: number): number => {
  const precision = Math.max(0, Math.min(2, Number(data.marksheetSettings.marksPrecision ?? 1)));
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
export const weightageMaximum = (data: AppData, key: ExamKey): number => Math.max(0, roundMarks(data, Number(data.exams[key]?.weightage) || 0));
export const convertedWeightage = (data: AppData, key: ExamKey, actualMarks: unknown): number => {
  const actualMaximum = Number(data.exams[key]?.maxMarks) || 0;
  const contribution = Number(data.exams[key]?.weightage) || 0;
  if (!hasMark(actualMarks) || actualMaximum <= 0 || contribution < 0) return 0;
  return roundMarks(data, (Number(actualMarks) / actualMaximum) * contribution);
};
export function calculateStudentPerformance(data: AppData, student: Student, keys: ExamKey[] = getExamKeys(data)) {
  const subjects = data.subjects.filter(subject => subject.enabled !== false);
  let obtained = 0;
  let maximum = 0;
  const subjectRows = subjects.map(subject => {
    let subjectObtained = 0;
    let subjectMaximum = 0;
    for (const key of keys) {
      const markRow = data.results[key]?.find(mark => mark.studentId === student.studentId || (!!student.roll && normalizeRollNumber(mark.roll) === normalizeRollNumber(student.roll)));
      const raw = markRow?.[subject.id];
      if (hasMark(raw)) {
        subjectObtained += convertedWeightage(data, key, raw);
        subjectMaximum += weightageMaximum(data, key);
      } else if (getConfiguredMarkStatus(data, raw)?.calculationRule === 'count-as-zero') {
        subjectMaximum += weightageMaximum(data, key);
      }
    }
    obtained += subjectObtained;
    maximum += subjectMaximum;
    return { subject, obtained: subjectObtained, maximum: subjectMaximum, percentage: subjectMaximum ? subjectObtained / subjectMaximum * 100 : 0 };
  });
  return { obtained, maximum, percentage: maximum ? obtained / maximum * 100 : 0, subjectRows };
}
export function calculatePromotionScore(data: AppData, student: Student, keys: ExamKey[] = data.settings.promotionExams?.length ? data.settings.promotionExams : getExamKeys(data)) {
  const performance = calculateStudentPerformance(data, student, keys);
  return { obtained: performance.obtained, maximum: performance.maximum, percentage: performance.percentage };
}
export function getValidationLevel(data: AppData, key: string): 'required' | 'recommended' | 'optional' {
  const level = data.settings.validationLevels?.[key];
  if (level === 'required' || level === 'recommended' || level === 'optional') return level;
  return 'optional';
}

export function getDataReadiness(data: AppData, studentIds?: string[]) {
  const students = studentIds ? data.students.filter(student => studentIds.includes(student.studentId)) : data.students;
  const studentFields = [
    ['roll', 'Roll'], ['name', 'Student name'], ['father', 'Father name'], ['mother', 'Mother name'],
    ['dob', 'Date of birth'], ['gender', 'Gender'], ['photo', 'Student photo']
  ] as const;
  const missingRequiredStudents = students.filter(student => studentFields.some(([field]) =>
    getValidationLevel(data, `student.${field}`) === 'required' && !String((student as any)[field] ?? '').trim()
  ));
  const missingRecommendedStudents = students.flatMap(student => studentFields
    .filter(([field]) => getValidationLevel(data, `student.${field}`) === 'recommended' && !String((student as any)[field] ?? '').trim())
    .map(([field]) => ({ student, field })));

  const missingRequiredItems: Array<{ key: string; label: string; detail?: string }> = [];
  const missingRecommendedItems: Array<{ key: string; label: string; detail?: string }> = [];
  const check = (key: string, label: string, present: boolean, detail?: string) => {
    if (present) return;
    const item = { key, label, ...(detail ? { detail } : {}) };
    const level = getValidationLevel(data, key);
    if (level === 'required') missingRequiredItems.push(item);
    else if (level === 'recommended') missingRecommendedItems.push(item);
  };

  // School identity and the school metadata that is actually enabled for printing.
  check('school.name', 'School name', Boolean(String(data.school.name ?? '').trim()));
  check('school.address', 'School address', Boolean(String(data.school.address ?? '').trim()));
  check('school.established', 'Established year', data.school.headerMeta?.showLeft === false || !data.school.headerMeta?.showLeft || Boolean(String(data.school.established ?? '').trim()));
  check('school.affiliation', 'Affiliation', data.school.headerMeta?.showMiddle === false || !data.school.headerMeta?.showMiddle || Boolean(String(data.school.affiliation ?? '').trim()));
  check('school.registrationNumber', 'Registration number', data.school.headerMeta?.showRight === false || !data.school.headerMeta?.showRight || Boolean(String(data.school.registrationNumber ?? '').trim()));
  check('school.headerLeftLabel', 'Header left label', data.school.headerMeta?.showLeft === false || !data.school.headerMeta?.showLeft || Boolean(data.school.headerMeta?.leftLabel?.trim()));
  check('school.headerMiddleLabel', 'Header middle label', data.school.headerMeta?.showMiddle === false || !data.school.headerMeta?.showMiddle || Boolean(data.school.headerMeta?.middleLabel?.trim()));
  check('school.headerRightLabel', 'Header right label', data.school.headerMeta?.showRight === false || !data.school.headerMeta?.showRight || Boolean(data.school.headerMeta?.rightLabel?.trim()));
  check('school.managementLine', 'Management line', !data.school.headerMeta?.showManagementLine || Boolean(data.school.headerMeta?.managementLine?.trim()));
  check('school.logoLeft', 'Left school logo', data.school.showLeftLogo === false || Boolean(data.school.logoLeft || data.school.logo));
  check('school.logoRight', 'Right school logo', data.school.showRightLogo === false || data.school.rightLogoUseLeftLogo !== false || Boolean(data.school.logoRight));
  check('school.watermark', 'Watermark image', data.school.showWatermark === false || data.school.watermarkUseLeftLogo !== false || Boolean(data.school.watermark));

  // Session/class/exam metadata and academic configuration.
  check('exam.type', 'Examination type', Boolean(String(data.examType ?? '').trim()));
  check('exam.session', 'Academic session', Boolean(String(data.academicSession ?? '').trim()));
  check('exam.class', 'Class', Boolean(String(data.classInfo.className ?? '').trim()));
  check('exam.section', 'Section', !data.settings.sectionEnabled || Boolean(String(data.classInfo.section ?? '').trim()));
  const activeExams = getExamKeys(data);
  const reportExams = (data.marksheetSettings.reportExams?.length ? data.marksheetSettings.reportExams : activeExams).filter(key => activeExams.includes(key));
  const calculationExams = reportExams;
  const relevantExams = [...new Set([...reportExams, ...calculationExams])];
  check('exam.names', 'Examination names', relevantExams.every(key => Boolean(data.exams[key]?.name?.trim() && data.exams[key]?.shortName?.trim())));
  check('exam.maximumMarks', 'Examination maximum marks', relevantExams.every(key => Number(data.exams[key]?.maxMarks) > 0));
  check('academic.subjects', 'Subject names', data.subjects.some(subject => subject.enabled !== false) && data.subjects.filter(subject => subject.enabled !== false).every(subject => Boolean(subject.name.trim())));
  check('academic.gradingScale', 'Grading scale', data.grading.grades.length > 0 && data.grading.grades.every(rule => Boolean(rule.grade.trim())));

  const requiredMarksMissing: Array<{ student: Student; exam: string; subject: string }> = [];
  const recommendedMarksMissing: Array<{ student: Student; exam: string; subject: string }> = [];
  for (const student of students) for (const exam of relevantExams) for (const subject of data.subjects.filter(item => item.enabled !== false)) {
    const mark = data.results[exam]?.find(row => row.studentId === student.studentId)?.[subject.id];
    if (!hasMark(mark) && !getConfiguredMarkStatus(data, mark)) {
      if (data.settings.requiredExamMarks.includes(exam)) requiredMarksMissing.push({ student, exam, subject: subject.name });
      else if (data.settings.recommendedExamMarks.includes(exam)) recommendedMarksMissing.push({ student, exam, subject: subject.name });
    }
  }

  // Attendance is validated only when it is part of the generated marksheet.
  check('attendance.workingDays', 'Total working days', !data.marksheetSettings.showAttendance || Number(data.classInfo.totalWorkingDays) > 0);
  check('attendance.presentDays', 'Student attendance entries', !data.marksheetSettings.showAttendance || students.every(student => Number.isFinite(Number(student.attendance?.daysPresent))));
  check('additional.issueDate', 'Issue date', !data.marksheetSettings.showIssueDate || Boolean(data.marksheetSettings.issueDate));
  check('additional.remarks', 'Remarks configuration', !data.marksheetSettings.showRemarks || Boolean(data.remarkRules.overall.length || String(data.remarkRules.weakSubjectTemplate ?? '').trim() || String(data.remarkRules.attendanceTemplate ?? '').trim()));

  for (const signature of data.marksheetSettings.signatures.filter(item => item.enabled)) {
    check('signature.label', `Signature designation · ${signature.label || 'unnamed block'}`, Boolean(signature.label.trim()));
    check('signature.name', `Signature name · ${signature.label || 'designation'}`, Boolean(signature.name.trim()));
    check('signature.image', `Signature image · ${signature.label || 'designation'}`, Boolean(signature.signatureImage));
  }

  return {
    missingRequiredStudents, missingRecommendedStudents, missingRequiredItems, missingRecommendedItems,
    requiredMarksMissing, recommendedMarksMissing, totalStudents: students.length
  };
}
