export type Student = {
  studentId: string;
  roll: string;
  name: string;
  father: string;
  mother: string;
  dob: string;
  gender: string;
  photo?: string;
  attendance: { workingDays: number; daysPresent: number; daysAbsent: number; remarks: string; hasRecord?: boolean };
  remarks: { overall: string; attendance: string; subjects: Record<string, string> };
};
export type ExamKey = string;
export type ValidationLevel = 'required' | 'recommended' | 'optional';
export type ExamPreset = 'six' | 'four' | 'two' | 'custom';
export type ExamConfig = { name: string; shortName: string; maxMarks: number; weightage: number };
export type NonNumericMarkStatus = { id: string; symbol: string; code: string; meaning: string; displayValue: string; calculationRule: 'exclude' | 'count-as-zero'; active: boolean; isAbsence: boolean };
export type Marks = Record<string, string | number | null> & { studentId: string; roll: string };
export type GradeRule = { grade: string; minPercentage: number; operator?: '>=' | '>' | '<=' | '<' };
export type SignatureBlock = { id: string; label: string; name: string; signatureImage?: string; enabled: boolean; widthMm?: number; heightMm?: number; offsetMm?: number };
export type School = {
  name: string; address: string; affiliation: string; registrationNumber: string;
  established: string; logo?: string; logoLeft?: string; logoRight?: string; watermark?: string; watermarkUseLeftLogo?: boolean; rightLogoUseLeftLogo?: boolean; showLeftLogo?: boolean; showRightLogo?: boolean; showWatermark?: boolean; principalName: string;
  examControllerName: string; classTeacherName: string;
  headerMeta: {
    leftLabel: string; middleLabel: string; rightLabel: string;
    showLeft: boolean; showMiddle: boolean; showRight: boolean;
    managementLine: string; showManagementLine: boolean;
  };
};
export type AppData = {
  schemaVersion: string;
  academicSession: string;
  examType: string;
  qrExamName: string;
  classInfo: { className: string; section: string; classTeacher: string; totalWorkingDays: number };
  school: School;
  subjects: { id: string; name: string; enabled?: boolean }[];
  classSubjectConfigs: Record<string, { id: string; name: string; enabled?: boolean }[]>;
  examPreset: ExamPreset;
  examOrder: ExamKey[];
  exams: Record<ExamKey, ExamConfig>;
  students: Student[];
  results: Record<ExamKey, Marks[]>;
  grading: { passPercentage: number; grades: GradeRule[] };
  marksheetSettings: {
    showPhoto: boolean; showAttendance: boolean; showRemarks: boolean; showGrade: boolean;
    tableOrientation: 'auto' | 'subjects-rows' | 'subjects-columns';
    reportExams: ExamKey[]; calculationExams: ExamKey[]; showTotalColumn: boolean; showSubjectGrade: boolean;
    showMarksRow: boolean; showGradeRow: boolean; showOverallSummary: boolean; marksPrecision: 0 | 1 | 2; watermarkMode: 'repeat' | 'single'; watermarkOpacity: number; watermarkRepeatSize: number; watermarkCenterSize: number;
    headerLayout: 'single-row' | 'two-rows'; headerGapMm: number;
    showIssueDate: boolean; issueDate: string; issueDateFormat: 'DD-MM-YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD'; issueDateLabel: string;
    signatures: SignatureBlock[];
    qrUseSeparateImage: boolean; qrSeparateImage: string; qrSizeMm: number;
  };
  settings: { photoCropOutputScale: 1 | 1.5 | 2 | 3 | 4; showFloatingPreview: boolean; floatingPreviewPosition: 'right-center' | 'right-bottom'; sessionDisplayFormat: 'YYYY-YYYY' | 'YYYY-YY'; sectionEnabled: boolean; allowMultipleClassImport: boolean; allowEditExistingClassConfig: boolean; allowChangeExistingStudentClass: boolean; allowEditActiveClass: boolean; validationLevels: Record<string, ValidationLevel>; promotionExams: ExamKey[]; requiredStudentFields: string[]; recommendedStudentFields: string[]; requiredExamMarks: ExamKey[]; recommendedExamMarks: ExamKey[]; nonNumericMarkStatuses: NonNumericMarkStatus[] };
  remarkRules: {
    overall: { grade: string; text: string }[];
    weakSubjectRules: { id: string; belowPercentage: number; template: string }[];
    weakSubjectBelowPercentage: number;
    weakSubjectTemplate: string;
    attendanceBelowPercentage: number;
    attendanceTemplate: string;
  };
};
