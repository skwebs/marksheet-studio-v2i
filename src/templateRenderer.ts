import QRCode from 'qrcode';
import type { AppData, Student, ExamKey } from './types';
import { getExamKeys } from './data';
import { hasMark, convertedWeightage, weightageMaximum, calculateStudentPerformance, getConfiguredMarkStatus } from './calculations';
import { normalizeRollNumber, formatAcademicSession } from './normalization';

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const num = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const fmt = (value: number, precision: number = 1) => { if (!Number.isFinite(value)) return '0'; if (precision === 0) return String(Math.round(value)); const factor=10**precision; return (Math.round((value+Number.EPSILON)*factor)/factor).toFixed(precision); };
function getMarks(data: AppData, student: Student, key: ExamKey) {
  return data.results[key]?.find(m => m.studentId === student.studentId || (!!student.roll && normalizeRollNumber(m.roll) === normalizeRollNumber(student.roll)));
}
async function createQrDataUrl(payload: string, data: AppData): Promise<string> {
  const size = 800;
  const qrDataUrl = await QRCode.toDataURL(payload, { width: size, margin: 2, errorCorrectionLevel: 'H', type: 'image/png' });
  const schoolLogo = data.school.logoLeft || data.school.logo || data.school.logoRight || '/demo-school-logo.svg';
  const imageSource = data.marksheetSettings.qrUseSeparateImage && data.marksheetSettings.qrSeparateImage
    ? data.marksheetSettings.qrSeparateImage
    : schoolLogo;
  if (!imageSource) return qrDataUrl;
  return new Promise(resolve => {
    const logo = new Image();
    logo.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) { resolve(qrDataUrl); return; }
        const qr = new Image();
        qr.onload = () => {
          context.drawImage(qr, 0, 0, size, size);
          // Keep a white circular quiet zone around the centre image so the
          // logo is visually distinct without changing the QR payload.
          const outerRadius = 92;
          const logoRadius = 70;
          const center = size / 2;
          context.fillStyle = '#ffffff';
          context.beginPath();
          context.arc(center, center, outerRadius, 0, Math.PI * 2);
          context.fill();

          // Draw the logo with object-fit: cover semantics, clipped to a circle.
          const sourceSize = Math.min(logo.naturalWidth, logo.naturalHeight);
          const sourceX = (logo.naturalWidth - sourceSize) / 2;
          const sourceY = (logo.naturalHeight - sourceSize) / 2;
          const diameter = logoRadius * 2;
          context.save();
          context.beginPath();
          context.arc(center, center, logoRadius, 0, Math.PI * 2);
          context.clip();
          context.drawImage(logo, sourceX, sourceY, sourceSize, sourceSize, center - logoRadius, center - logoRadius, diameter, diameter);
          context.restore();

          // A thin white ring separates the circular logo from nearby QR modules.
          context.beginPath();
          context.arc(center, center, logoRadius + 2, 0, Math.PI * 2);
          context.strokeStyle = '#ffffff';
          context.lineWidth = 4;
          context.stroke();
          resolve(canvas.toDataURL('image/png'));
        };
        qr.onerror = () => resolve(qrDataUrl);
        qr.src = qrDataUrl;
      } catch { resolve(qrDataUrl); }
    };
    logo.onerror = () => resolve(qrDataUrl);
    logo.src = imageSource;
  });
}

function gradeFor(data: AppData, percentage: number) {
  const rules = data.grading.grades;
  return rules.find(g => { const op = g.operator || '>='; if (op === '>') return percentage > g.minPercentage; if (op === '<=') return percentage <= g.minPercentage; if (op === '<') return percentage < g.minPercentage; return percentage >= g.minPercentage; })?.grade ?? '';
}
const getPerformance = calculateStudentPerformance;
function getMarksheetPerformance(data: AppData, student: Student, keys: ExamKey[]) {
  if (keys.length !== 1) return getPerformance(data, student, keys);
  const key = keys[0];
  const maximumForExam = Math.max(0, Number(data.exams[key]?.maxMarks) || 0);
  let obtained = 0;
  let maximum = 0;
  const subjectRows = data.subjects.filter(subject => subject.enabled !== false).map(subject => {
    const raw = getMarks(data, student, key)?.[subject.id];
    const hasValue = hasMark(raw);
    const subjectObtained = hasValue ? num(raw) : 0;
    const subjectMaximum = hasValue ? maximumForExam : 0;
    obtained += subjectObtained; maximum += subjectMaximum;
    return { subject, obtained: subjectObtained, maximum: subjectMaximum, percentage: subjectMaximum ? subjectObtained / subjectMaximum * 100 : 0 };
  });
  return { obtained, maximum, percentage: maximum ? obtained / maximum * 100 : 0, subjectRows };
}
function automaticRemarks(data: AppData, student: Student, percentage: number, keys: ExamKey[] = getExamKeys(data)) {
  const rules = data.remarkRules;
  const overallGrade = gradeFor(data, percentage);
  const overall = (rules.overall || []).find(r => r.grade === overallGrade)?.text;
  const parts: string[] = [];
  if (overall?.trim()) parts.push(overall.trim());
  const performance = getMarksheetPerformance(data, student, keys);
  for (const item of performance.subjectRows) {
    const matchedRule = [...(rules.weakSubjectRules || [{
      id: 'legacy', belowPercentage: rules.weakSubjectBelowPercentage, template: rules.weakSubjectTemplate
    }])].sort((a, b) => b.belowPercentage - a.belowPercentage).find(rule => item.percentage < rule.belowPercentage);
    if (matchedRule?.template.trim()) {
      parts.push(matchedRule.template.replaceAll('{subject}', item.subject.name).replaceAll('{percentage}', fmt(item.percentage)));
    }
  }
  const totalDays = Math.max(0, num(data.classInfo.totalWorkingDays));
  const present = Math.max(0, Math.min(totalDays, num(student.attendance.daysPresent)));
  const attendancePercentage = totalDays ? present / totalDays * 100 : 100;
  if (totalDays > 0 && attendancePercentage < rules.attendanceBelowPercentage) {
    parts.push(rules.attendanceTemplate.replaceAll('{percentage}', fmt(attendancePercentage)));
  }
  return parts.join(' ');
}

function sanitizeSchoolBannerHtml(input: string): string {
  const parsed = new DOMParser().parseFromString(`<div>${input}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  if (!root) return '';
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'BR', 'SMALL', 'SUB', 'SUP']);
  const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON']);
  const clean = (node: Element) => {
    [...node.children].forEach(child => {
      if (blockedTags.has(child.tagName)) { child.remove(); return; }
      clean(child);
      if (!allowedTags.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        return;
      }
      [...child.attributes].forEach(attr => {
        if (attr.name.toLowerCase() !== 'style') child.removeAttribute(attr.name);
      });
      const style = child.getAttribute('style');
      if (style) {
        const safe = style.split(';').map(rule => rule.trim()).filter(rule => /^(color|font-weight|font-style|text-decoration|font-size)\s*:\s*(#[0-9a-f]{3,8}|[a-z]{3,20}|[0-9.]+(px|pt|em|rem|%)|bold|normal|italic|underline|none)\s*$/i.test(rule));
        if (safe.length) child.setAttribute('style', safe.join('; ')); else child.removeAttribute('style');
      }
    });
  };
  clean(root);
  return root.innerHTML;
}

export async function renderMarksheet(sourceHtml: string, data: AppData, student: Student): Promise<string> {
  const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
  if (doc.getElementById('examTitle')) return renderModernTemplate(doc, data, student);
  const setExactText = (oldText: string, newText: string) => {
    const el = [...doc.querySelectorAll('body *')].find(node => node.children.length === 0 && node.textContent?.trim() === oldText);
    if (el) el.textContent = newText;
  };
  const classLabel = `${data.classInfo.className}${data.settings?.sectionEnabled && data.classInfo.section ? `-${data.classInfo.section}` : ''}`;

  const setTextByIdOrLegacyText = (id: string, legacyTexts: string[], value: string) => {
    const target = doc.getElementById(id);
    if (target) target.textContent = value;
    else {
      const oldText = legacyTexts.find(text => [...doc.querySelectorAll('body *')].some(node => node.children.length === 0 && node.textContent?.trim() === text));
      if (oldText) setExactText(oldText, value);
    }
  };
  setTextByIdOrLegacyText('schoolEstablished', ['Estd. : 2017', 'Estd. : 2020'], `Estd. : ${data.school.established || ''}`);
  setTextByIdOrLegacyText('schoolRegistrationNumber', ['Reg. No. 054631', 'Reg. No. DEMO-0001'], `Reg. No. ${data.school.registrationNumber || ''}`);
  setTextByIdOrLegacyText('schoolName', ['NATIONAL PUBLIC SCHOOL', 'DEMO PUBLIC SCHOOL'], data.school.name || '');
  setTextByIdOrLegacyText('schoolAddress', ['SINHPUR, KANHAULI, VAISHALI', 'DEMO CITY, INDIA'], data.school.address || '');

  // The supplied template's actual student table has three cells per row: label, colon, value.
  for (const row of doc.querySelectorAll<HTMLTableRowElement>('.student-details tr')) {
    const label = row.querySelector('th')?.textContent?.trim();
    const valueCell = row.cells[2];
    if (!valueCell) continue;
    if (label === 'Name') valueCell.textContent = student.name || '';
    else if (label === 'Class') valueCell.textContent = classLabel;
    else if (label === 'Roll No.') valueCell.textContent = student.roll || '';
    else if (label === "Mother's Name") valueCell.textContent = student.mother || '';
    else if (label === "Father's Name") valueCell.textContent = student.father || '';
  }

  const selectedKeys = (data.marksheetSettings.reportExams?.length ? data.marksheetSettings.reportExams : getExamKeys(data)).filter(k => getExamKeys(data).includes(k));
  const reportKeys = selectedKeys.length ? selectedKeys : [getExamKeys(data)[0]];
  const titleKey: ExamKey = ['final','hy','pa4','pa3','pa2','pa1'].find(key => reportKeys.includes(key)) || reportKeys[reportKeys.length - 1] || getExamKeys(data)[0];
  const reportTitle = data.exams[titleKey].name.toUpperCase();
  const titleStrip = doc.querySelector<HTMLElement>('.w-full.text-center.border-t');
  const titleRows = titleStrip?.querySelectorAll<HTMLElement>(':scope > div');
  if (titleRows?.[0]) titleRows[0].textContent = `REPORT CARD [${reportTitle || data.examType || data.exams[titleKey]?.name.toUpperCase() || titleKey.toUpperCase()}]`;
  if (titleRows?.[1]) titleRows[1].innerHTML = `SESSION <strong>${esc(formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat))}</strong>`;
  if (titleStrip && titleRows?.[0] && titleRows?.[1]) {
    const single = data.marksheetSettings.headerLayout === 'single-row';
    titleStrip.style.display = 'flex'; titleStrip.style.flexDirection = single ? 'row' : 'column';
    titleStrip.style.flexWrap = 'nowrap'; titleStrip.style.alignItems = 'center'; titleStrip.style.justifyContent = 'center';
    titleStrip.style.columnGap = `${Math.max(0, Math.min(20, Number(data.marksheetSettings.headerGapMm ?? 4)))}mm`;
    titleRows[0].style.margin = '0'; titleRows[1].style.margin = '0';
    titleRows[0].style.whiteSpace = single ? 'nowrap' : 'normal'; titleRows[1].style.whiteSpace = single ? 'nowrap' : 'normal';
  }

  // Resolve uploaded assets as data URLs so they also work in a new preview/print window.
  const leftLogo = data.school.logoLeft || data.school.logo || '';
  const rightLogo = data.school.rightLogoUseLeftLogo !== false ? leftLogo : (data.school.logoRight || '');
  const logoImages = [...doc.querySelectorAll<HTMLImageElement>('img[alt="logo"], img[alt="Demo school logo"], img[alt="Education illustration"], img[alt="beti bachao beti padhao"]')];
  if (logoImages[0]) { if (data.school.showLeftLogo === false || !leftLogo) logoImages[0].remove(); else logoImages[0].src = leftLogo; }
  if (logoImages[1]) { if (data.school.showRightLogo === false || !rightLogo) logoImages[1].remove(); else logoImages[1].src = rightLogo; }
  const watermark = data.school.watermarkUseLeftLogo !== false ? leftLogo : (data.school.watermark || '');
  const watermarkStyle = doc.createElement('style');
  const mode = data.marksheetSettings.watermarkMode || 'repeat';
  const opacity = Math.max(0, Math.min(100, Number(data.marksheetSettings.watermarkOpacity ?? 10))) / 100;
  const size = mode === 'single' ? Number(data.marksheetSettings.watermarkCenterSize ?? 420) : Number(data.marksheetSettings.watermarkRepeatSize ?? 60);
  watermarkStyle.textContent = data.school.showWatermark !== false && watermark ? `.main-content::before{content:"";background-image:url("${watermark}")!important;background-repeat:${mode==='single'?'no-repeat':'repeat'}!important;background-position:center!important;background-size:${mode==='single'?`min(${size}px,90%) auto`:`${size}px ${size}px`}!important;opacity:${opacity}!important;}` : `.main-content::before{content:none!important;background-image:none!important;}`;
  doc.head.append(watermarkStyle);
  const photo = doc.querySelector<HTMLImageElement>('img[alt="student image"]');
  if (photo) {
    if (student.photo) photo.src = student.photo;
    else photo.removeAttribute('src');
  }

  const precision = data.marksheetSettings.marksPrecision ?? 1;
  const fmtMarks = (value: number) => fmt(value, precision);
  const reportExams = reportKeys;
  const calculationExams = reportExams;
  const calcKeys = calculationExams.length ? calculationExams : reportExams;
  const usesOriginalMarks = reportExams.length === 1;
  const calculationUsesOriginalMarks = calcKeys.length === 1;
  const examMax = (key: ExamKey) => usesOriginalMarks ? Math.max(0, Number(data.exams[key]?.maxMarks) || 0) : weightageMaximum(data, key);
  const convertMark = (key: ExamKey, value: number) => usesOriginalMarks ? value : convertedWeightage(data, key, value);
  const calculationMax = (key: ExamKey) => calculationUsesOriginalMarks ? Math.max(0, Number(data.exams[key]?.maxMarks) || 0) : weightageMaximum(data, key);
  const convertCalculationMark = (key: ExamKey, value: number) => calculationUsesOriginalMarks ? value : convertedWeightage(data, key, value);
  const orientation = data.marksheetSettings.tableOrientation === 'auto'
    ? (reportExams.length === 1 ? 'subjects-columns' : 'subjects-rows')
    : data.marksheetSettings.tableOrientation;
  const table = doc.querySelector<HTMLTableElement>('table.table');
  if (table) {
    const head = doc.createElement('thead');
    const body = doc.createElement('tbody');
    const foot = doc.createElement('tfoot');
    table.replaceChildren(head, body, foot);
    table.classList.add('result-table-dynamic');
    const th = (label: string) => { const el = doc.createElement('th'); el.textContent = label; el.className = 'px-3 py-2'; return el; };
    const td = (label: string) => { const el = doc.createElement('td'); el.textContent = label; el.className = 'px-3 py-2'; return el; };
    const tr = () => { const el = doc.createElement('tr'); el.className = 'border-b border-gray-300'; return el; };
    const totals = Object.fromEntries(getExamKeys(data).map(k=>[k,0])) as Record<ExamKey, number>;
    let allObtained = 0;
    let allMaximum = 0;
    const perSubject = data.subjects.filter(subject => subject.enabled !== false).map(subject => {
      const rawExamValues = Object.fromEntries(reportExams.map(key => [key, getMarks(data, student, key)?.[subject.id] ?? null])) as Record<ExamKey, string | number | null>;
      const examValues = Object.fromEntries(reportExams.map(key => [key, hasMark(rawExamValues[key]) ? num(rawExamValues[key]) : null])) as Record<ExamKey, number | null>;
      const convertedValues = Object.fromEntries(reportExams.map(key=>[key, examValues[key] === null ? null : convertMark(key, examValues[key] ?? 0)])) as Record<ExamKey, number|null>;
      const calculationValues = Object.fromEntries(calcKeys.map(key => { const raw = getMarks(data, student, key)?.[subject.id]; const value = hasMark(raw) ? num(raw) : null; return [key, value]; })) as Record<ExamKey, number|null>;
      const convertedCalculationValues = Object.fromEntries(calcKeys.map(key => [key, calculationValues[key] === null ? null : convertCalculationMark(key, calculationValues[key] ?? 0)])) as Record<ExamKey, number|null>;
      const obtained = calcKeys.reduce((sum, key) => sum + (convertedCalculationValues[key] ?? 0), 0);
      const maximum = calcKeys.reduce((sum, key) => { const raw=getMarks(data,student,key)?.[subject.id]; return sum + (calculationValues[key] !== null || getConfiguredMarkStatus(data,raw)?.calculationRule === 'count-as-zero' ? calculationMax(key) : 0); }, 0);
      reportExams.forEach(key => { totals[key] += convertedValues[key] ?? 0; });
      allObtained += obtained;
      allMaximum += maximum;
      return { subject, examValues, rawExamValues, convertedValues, obtained, maximum, grade: gradeFor(data, maximum ? obtained / maximum * 100 : 0) };
    });

    if (orientation === 'subjects-columns') {
      const header = tr();
      header.append(th('#'));
      perSubject.forEach(item => header.append(th(item.subject.name)));
      head.append(header);
      const fullMarksRow = tr(); fullMarksRow.append(th('Full Marks'));
      perSubject.forEach(() => { const cell = td(fmtMarks(examMax(reportExams[0]))); cell.classList.add('static-print'); fullMarksRow.append(cell); });
      body.append(fullMarksRow);
      if (data.marksheetSettings.showMarksRow !== false) {
        const row = tr(); row.append(th('Obtained Marks'));
        perSubject.forEach(item => { const raw=item.rawExamValues[reportExams[0]]; const status=getConfiguredMarkStatus(data,raw); row.append(td(status ? status.displayValue : item.examValues[reportExams[0]] === null ? '—' : fmtMarks(item.convertedValues[reportExams[0]] ?? 0))); });
        body.append(row);
      }
      if (data.marksheetSettings.showGradeRow !== false && data.marksheetSettings.showSubjectGrade !== false) {
        const row = tr(); row.append(th('Grade'));
        perSubject.forEach(item => {
          const value = item.examValues[reportExams[0]];
          const pct = value === null ? null : (examMax(reportExams[0]) ? (item.convertedValues[reportExams[0]] ?? 0) / examMax(reportExams[0]) * 100 : 0);
          const gradeCell = td(pct === null ? '—' : gradeFor(data, pct)); gradeCell.classList.add('data-scaled'); row.append(gradeCell);
        });
        body.append(row);
      }
    } else {
      const header = tr();
      header.append(th('Subject'));
      reportExams.forEach(key => header.append(th(`${data.exams[key].shortName} (${fmtMarks(examMax(key))})`)));
      if ((reportExams.length > 1 || calcKeys.length > 1) && data.marksheetSettings.showTotalColumn !== false) header.append(th(`Total (${fmtMarks(calcKeys.reduce((sum, key) => sum + calculationMax(key), 0))})`));
      if (data.marksheetSettings.showSubjectGrade !== false) header.append(th('Grade'));
      head.append(header);
      perSubject.forEach(item => {
        const row = tr(); row.append(th(item.subject.name));
        reportExams.forEach(key => { const raw=item.rawExamValues[key]; const status=getConfiguredMarkStatus(data,raw); row.append(td(status ? status.displayValue : item.examValues[key] === null ? '—' : fmtMarks(item.convertedValues[key] ?? 0))); });
        if ((reportExams.length > 1 || calcKeys.length > 1) && data.marksheetSettings.showTotalColumn !== false) row.append(td(fmtMarks(item.obtained)));
        if (data.marksheetSettings.showSubjectGrade !== false) { const gradeCell = td(item.maximum ? item.grade : '—'); gradeCell.classList.add('data-scaled'); row.append(gradeCell); }
        body.append(row);
      });
      const footer = tr(); footer.append(th('Total'));
      reportExams.forEach(key => { const cell = th(fmtMarks(totals[key])); cell.classList.add('data-scaled'); footer.append(cell); });
      if ((reportExams.length > 1 || calcKeys.length > 1) && data.marksheetSettings.showTotalColumn !== false) footer.append(th(fmtMarks(allObtained)));
      if (data.marksheetSettings.showSubjectGrade !== false) { const gradeCell = th(gradeFor(data, allMaximum ? allObtained / allMaximum * 100 : 0)); gradeCell.classList.add('data-scaled'); footer.append(gradeCell); }
      foot.append(footer);
    }
    if (orientation === 'subjects-columns') {
      foot.remove();
    }
  }
  const reportPerformance = getMarksheetPerformance(data, student, calcKeys);
  const allObtained = reportPerformance.obtained;
  const allMaximum = reportPerformance.maximum;
  const performance = reportPerformance;

  // Target the summary table directly. The previous broad selector accidentally matched the student table and overwrote Class.
  const summaryTable = doc.querySelector<HTMLTableElement>('.px-4.py-2 > table');
  const summaryCells = summaryTable?.rows[1]?.cells;
  if (data.marksheetSettings.showOverallSummary === false && summaryTable?.parentElement) summaryTable.parentElement.setAttribute('hidden', 'hidden');
  const totalDays = Math.max(0, num(data.classInfo.totalWorkingDays));
  const present = Math.max(0, Math.min(totalDays, num(student.attendance.daysPresent)));
  const absent = Math.max(0, totalDays - present);
  if (summaryCells) {
    if (summaryCells[0]) summaryCells[0].textContent = `${fmtMarks(allObtained)}/${fmtMarks(allMaximum)}`;
    if (summaryCells[1]) summaryCells[1].textContent = `${allMaximum ? (allObtained / allMaximum * 100).toFixed(1) : '0.0'} %`;
    if (summaryCells[2]) summaryCells[2].textContent = `${fmt(present)}/${fmt(totalDays)}`;
    if (summaryCells[3]) summaryCells[3].textContent = gradeFor(data, allMaximum ? allObtained / allMaximum * 100 : 0);
  }

  const remarksContainer = [...doc.querySelectorAll('body div')].find(el => el.children.length === 2 && el.children[0].textContent?.trim() === 'Remarks :');
  if (remarksContainer?.children[1]) remarksContainer.children[1].textContent = ` ${automaticRemarks(data, student, performance.percentage, calcKeys)}`;

  // Render configured grade rules as a compact reference table.
  const gradingTable = [...doc.querySelectorAll('table')].find(t => t.textContent?.includes('Grading System'));
  if (gradingTable) {
    const sorted = data.grading.grades;
    gradingTable.replaceChildren();
    const headRow = doc.createElement('tr');
    const headCell = doc.createElement('th'); headCell.colSpan = 2; headCell.textContent = 'Grading System'; headCell.className = 'border border-black px-1 text-center'; headRow.append(headCell); gradingTable.append(headRow);
    sorted.forEach(rule => {
      const row = doc.createElement('tr'); const gradeCell = doc.createElement('th'); const descCell = doc.createElement('td');
      gradeCell.textContent = rule.grade; gradeCell.className = 'border border-black px-1';
      const op = rule.operator || '>='; descCell.textContent = `${op} ${rule.minPercentage}%`;
      descCell.className = 'border border-black px-1'; row.append(gradeCell,descCell); gradingTable.append(row);
    });
  }

  const signatureFooter = doc.querySelector('.signature-footer');
  if (signatureFooter) {
    const legacyPage = signatureFooter.closest<HTMLElement>('.sheet') || signatureFooter.closest<HTMLElement>('.main-content') || signatureFooter.parentElement as HTMLElement | null;
    if (legacyPage) {
      legacyPage.style.position = 'relative';
      (signatureFooter as HTMLElement).style.position = 'absolute'; (signatureFooter as HTMLElement).style.left = '0';
      (signatureFooter as HTMLElement).style.right = '0'; (signatureFooter as HTMLElement).style.bottom = '2.5mm';
      (signatureFooter as HTMLElement).style.margin = '0'; (signatureFooter as HTMLElement).style.boxSizing = 'border-box';
    }
    signatureFooter.replaceChildren();
    const blocks = (data.marksheetSettings.signatures || []).filter(sig => sig.enabled).slice(0, 4);
    (signatureFooter as HTMLElement).style.gridTemplateColumns = `repeat(${Math.max(1, blocks.length)}, minmax(0, 1fr))`;
    blocks.forEach((sig, index) => {
      const block = doc.createElement('div'); block.className = 'signature-block';
      const top = doc.createElement('div'); top.className = 'signature-top';
      if (sig.signatureImage) {
        const img = doc.createElement('img'); img.src = sig.signatureImage; img.alt = `${sig.label} signature`; img.className = 'signature-image';
        img.style.background = 'transparent'; img.style.transform = `translateY(${-Math.max(-20, Math.min(20, Number(sig.offsetMm) || 0))}mm)`; top.append(img);
      } else {
        const blank = doc.createElement('div'); blank.className = 'signature-image-placeholder'; top.append(blank);
      }
      const name = doc.createElement('div'); name.className = 'signature-name';
      const nameText = sig.name || '';
      name.textContent = nameText;
      top.append(name);
      const line = doc.createElement('div'); line.className = 'signature-divider';
      const label = doc.createElement('div'); label.className = 'signature-label'; label.textContent = sig.label;
      block.append(top, line, label); signatureFooter.append(block);
    });
    if (!blocks.length) signatureFooter.setAttribute('hidden', 'hidden'); else signatureFooter.removeAttribute('hidden');
  }

  // Generate a compact, self-contained per-student QR payload. Avoid duplicating
  // marks in both subject and exam objects: QR codes have a strict capacity limit.
  const qrImage = doc.querySelector<HTMLImageElement>('img[src*="sample-qr-code.png"]');
  if (qrImage) {
    const finalPercentage = allMaximum ? allObtained / allMaximum * 100 : 0;
    const compactText = (value: unknown, max = 160) => String(value ?? '').trim().slice(0, max);
    const sessionLabel = formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat);
    const schoolInitials = compactText(data.school.name, 80).split(/\s+/).filter(Boolean).map(word => word[0]).join('').toUpperCase() || 'SCH';
    const qrLabel = compactText(data.qrExamName?.trim() || data.examType?.trim() || reportTitle || 'EXAM', 40);
    const subjectTokens = performance.subjectRows.map((item: any) => `${item.subject.shortName?.trim() || item.subject.name.trim().split(/\s+/).map((word: string) => word[0]).join('').slice(0,3).toUpperCase()}${fmtMarks(item.obtained)}`);
    const subjectLines: string[] = [];
    for (let i = 0; i < subjectTokens.length; i += 3) subjectLines.push(subjectTokens.slice(i, i + 3).join(' '));
    const qrPayload = [
      `${schoolInitials}|${qrLabel}|${compactText(sessionLabel, 20)}`,
      compactText(student.name, 100),
      `Cls:${compactText(data.classInfo.className, 12)} Roll:${compactText(student.roll, 20)}`,
      ...subjectLines,
      `Ob M:${fmtMarks(allObtained)}/${fmtMarks(allMaximum)}|${finalPercentage.toFixed(2)}%`,
      `Gd:${gradeFor(data, finalPercentage)}`,
      `Attd:${fmt(present)}/${fmt(totalDays)}|${totalDays ? (present / totalDays * 100).toFixed(2) : '0.00'}%`
    ].join('\n');
    try {
      qrImage.src = await createQrDataUrl(qrPayload, data);
      qrImage.alt = `QR code for ${student.name}`;
      qrImage.style.width = '100%';
      qrImage.style.height = '100%';
      qrImage.style.objectFit = 'contain';
      const qrFrame = qrImage.parentElement as HTMLElement | null;
      const qrSize = Math.max(25, Math.min(50, Number(data.marksheetSettings.qrSizeMm) || 35));
      if (qrFrame) { qrFrame.style.width = `${qrSize}mm`; qrFrame.style.height = `${qrSize}mm`; qrFrame.style.padding = '0.8mm'; qrFrame.style.boxSizing = 'border-box'; qrFrame.style.flex = '0 0 auto'; }
    } catch (error) {
      console.error('Could not generate the student QR code. Readable payload length:', qrPayload.length, error);
      throw new Error('Could not generate the student QR code. Shorten the school name or automatic remark text.');
    }
  }

  // Return an actual newline, never the visible two-character sequence "\\n".
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

async function renderModernTemplate(doc: Document, data: AppData, student: Student): Promise<string> {
  const modernSettings = data.marksheetSettings;
  // The supplied HTML is a visual template only. Its embedded demo controller is
  // deliberately removed so sample values can never overwrite application data.
  doc.querySelectorAll('script:not([src])').forEach(script => script.remove());
  const setText = (id: string, value: unknown) => {
    const el = doc.getElementById(id);
    if (el) el.textContent = String(value ?? '');
  };
  const hide = (el: Element | null | undefined, hidden = true) => {
    if (!el) return;
    if (hidden) el.setAttribute('hidden', 'hidden');
    else el.removeAttribute('hidden');
  };
  const precision = Math.max(0, Math.min(3, Number(data.marksheetSettings.marksPrecision ?? 1)));
  const fmtMarks = (value: number) => { if (!Number.isFinite(value)) return '0'; const factor = 10 ** precision; const rounded = Math.round((value + Number.EPSILON) * factor) / factor; return precision === 0 ? String(rounded) : rounded.toFixed(precision); };
  const classLabel = `${data.classInfo.className}${data.settings?.sectionEnabled && data.classInfo.section ? `-${data.classInfo.section}` : ''}`;
  const reportKeys = (data.marksheetSettings.reportExams?.length ? data.marksheetSettings.reportExams : getExamKeys(data))
    .filter((key): key is ExamKey => getExamKeys(data).includes(key as ExamKey));
  const keys: ExamKey[] = reportKeys.length ? reportKeys : getExamKeys(data).slice(0, 1);
  const calculationKeys: ExamKey[] = (data.marksheetSettings.calculationExams?.length ? data.marksheetSettings.calculationExams : keys).filter(key => getExamKeys(data).includes(key));
  const calcKeys: ExamKey[] = calculationKeys.length ? calculationKeys : keys;
  const calcUsesOriginalMarks = calcKeys.length === 1;
  const isMulti = doc.getElementById('marksTableFoot') !== null;
  const enabledSubjects = data.subjects.filter(subject => subject.enabled !== false);
  // A single-exam report is a standalone assessment and must show the original
  // marks scale. Weightage conversion is reserved for combined/multi-exam reports.
  const usesOriginalMarks = keys.length === 1;
  const maxFor = (key: ExamKey) => usesOriginalMarks
    ? Math.max(0, Number(data.exams[key]?.maxMarks) || 0)
    : weightageMaximum(data, key);
  const getRawExamMark = (key: ExamKey, subjectId: string): string | number | null => {
    const record = data.results[key]?.find(item => item.studentId === student.studentId || (!item.studentId && normalizeRollNumber(item.roll) === normalizeRollNumber(student.roll)));
    return record?.[subjectId] ?? null;
  };
  const getExamMarks = (key: ExamKey, subjectId: string): number | null => {
    const record = data.results[key]?.find(item => item.studentId === student.studentId || (!item.studentId && normalizeRollNumber(item.roll) === normalizeRollNumber(student.roll)));
    const raw = record?.[subjectId];
    if (!hasMark(raw)) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return usesOriginalMarks ? value : convertedWeightage(data, key, value);
  };
  const getCalculationExamMarks = (key: ExamKey, subjectId: string): number | null => {
    const record = data.results[key]?.find(item => item.studentId === student.studentId || (!item.studentId && normalizeRollNumber(item.roll) === normalizeRollNumber(student.roll)));
    const raw = record?.[subjectId];
    if (!hasMark(raw)) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return calcUsesOriginalMarks ? value : convertedWeightage(data, key, value);
  };
  const calcMaximumFor = (key: ExamKey) => calcUsesOriginalMarks ? Math.max(0, Number(data.exams[key]?.maxMarks) || 0) : weightageMaximum(data, key);
  const gradeForPercentage = (percentage: number) => data.grading.grades.find(rule => {
    const op = rule.operator || '>=';
    if (op === '>') return percentage > rule.minPercentage;
    if (op === '<=') return percentage <= rule.minPercentage;
    if (op === '<') return percentage < rule.minPercentage;
    return percentage >= rule.minPercentage;
  })?.grade || '';
  const rows = enabledSubjects.map(subject => {
    const examMarks = keys.map(key => getExamMarks(key, subject.id));
    const calculationMarks = calcKeys.map(key => getCalculationExamMarks(key, subject.id));
    const obtained = calculationMarks.reduce<number>((sum, mark) => sum + (mark ?? 0), 0);
    const maximum = calcKeys.reduce((sum, key, index) => sum + (calculationMarks[index] !== null || getConfiguredMarkStatus(data, getRawExamMark(key, subject.id))?.calculationRule === 'count-as-zero' ? calcMaximumFor(key) : 0), 0);
    const rawExamMarks = keys.map(key => getRawExamMark(key, subject.id));
    return { subject, examMarks, rawExamMarks, obtained, maximum, percentage: maximum ? obtained / maximum * 100 : 0 };
  });
  const grandObtained = rows.reduce((sum, row) => sum + row.obtained, 0);
  const grandMaximum = rows.reduce((sum, row) => sum + row.maximum, 0);
  const percentage = grandMaximum ? grandObtained / grandMaximum * 100 : 0;
  const overallGrade = gradeForPercentage(percentage);
  const workingDays = Math.max(0, Number(student.attendance.workingDays || data.classInfo.totalWorkingDays) || 0);
  const presentDays = Math.max(0, Math.min(workingDays, Number(student.attendance.daysPresent) || 0));
  const attendancePercentage = workingDays ? presentDays / workingDays * 100 : 0;
  const automaticRemarkParts: string[] = [];
  const gradeRemark = data.remarkRules.overall.find(rule => rule.grade === overallGrade)?.text;
  if (gradeRemark) automaticRemarkParts.push(gradeRemark);
  if (student.remarks.attendance?.trim()) automaticRemarkParts.push(student.remarks.attendance.trim());
  rows.forEach(row => {
    const subjectRemark = student.remarks.subjects?.[row.subject.id]?.trim();
    if (subjectRemark) automaticRemarkParts.push(subjectRemark);
    const matchedWeakRule = [...(data.remarkRules.weakSubjectRules || [{
      id: 'legacy', belowPercentage: data.remarkRules.weakSubjectBelowPercentage, template: data.remarkRules.weakSubjectTemplate
    }])].sort((a, b) => b.belowPercentage - a.belowPercentage).find(rule => row.percentage < rule.belowPercentage);
    if (row.maximum && matchedWeakRule?.template.trim()) {
      automaticRemarkParts.push(matchedWeakRule.template.replaceAll('{subject}', row.subject.name).replaceAll('{percentage}', fmtMarks(row.percentage)));
    }
  });
  if (workingDays && attendancePercentage < data.remarkRules.attendanceBelowPercentage) {
    automaticRemarkParts.push(data.remarkRules.attendanceTemplate.replaceAll('{percentage}', fmtMarks(attendancePercentage)));
  }
  const remarks = student.remarks.overall?.trim() || automaticRemarkParts.join(' ');

  // School identity: both emblems use the configured school logo, never a demo asset.
  const leftLogo = data.school.logoLeft || data.school.logo || '';
  const rightLogo = data.school.rightLogoUseLeftLogo !== false ? leftLogo : (data.school.logoRight || '');
  const logoImages = [
    doc.getElementById('schoolLogoLeft') as HTMLImageElement | null,
    doc.getElementById('schoolLogoRight') as HTMLImageElement | null
  ].filter((image): image is HTMLImageElement => image !== null);
  // Compatibility with older custom templates that use the historical alt labels.
  if (!logoImages.length) logoImages.push(...doc.querySelectorAll<HTMLImageElement>('img[alt="National Public School Logo"], img[alt="School Emblem"], img[alt="Beti Bachao Beti Padhao"]'));
  logoImages.forEach((image, index) => {
    const isLeft = index === 0;
    const logo = isLeft ? leftLogo : rightLogo;
    const enabled = isLeft ? data.school.showLeftLogo !== false : data.school.showRightLogo !== false;
    if (logo && enabled) { image.src = logo; image.removeAttribute('hidden'); }
    else { image.removeAttribute('src'); image.setAttribute('hidden', 'hidden'); }
    hide(image.parentElement, !logo || !enabled);
    image.alt = `${data.school.name || 'School'} logo`;
  });
  const schoolName = doc.querySelector('.school-name');
  const schoolAddress = doc.querySelector('.school-address');
  if (schoolName) schoolName.textContent = data.school.name || '';
  if (schoolAddress) { schoolAddress.textContent = data.school.address || ''; hide(schoolAddress, !data.school.address); }
  // Three optional metadata columns. Labels and values are entirely data-driven.
  const meta = data.school.headerMeta;
  const metadataItems = [
    { id: 'Left', label: meta?.leftLabel || '', value: data.school.established, enabled: meta?.showLeft !== false },
    { id: 'Middle', label: meta?.middleLabel || '', value: data.school.affiliation, enabled: meta?.showMiddle !== false },
    { id: 'Right', label: meta?.rightLabel || '', value: data.school.registrationNumber, enabled: meta?.showRight !== false }
  ];
  metadataItems.forEach(item => {
    setText(`schoolMeta${item.id}Label`, item.label);
    setText(`schoolMeta${item.id}Value`, item.value);
    const cell = doc.getElementById(`schoolMeta${item.id}`);
    hide(cell, !item.enabled || !String(item.value || '').trim());
    hide(cell?.querySelector('.meta-separator'), !String(item.label || '').trim() || !String(item.value || '').trim());
  });
  const metaRow = doc.getElementById('schoolHeaderMeta');
  const visibleMetaItems = metadataItems.filter(item => item.enabled && String(item.value || '').trim());
  hide(metaRow, visibleMetaItems.length === 0);
  const hasMiddleMeta = visibleMetaItems.some(item => item.id === 'Middle');
  const hasLeftMeta = visibleMetaItems.some(item => item.id === 'Left');
  const hasRightMeta = visibleMetaItems.some(item => item.id === 'Right');
  metaRow?.classList.toggle('meta-without-middle', !hasMiddleMeta);
  metaRow?.classList.toggle('meta-one-side', !hasMiddleMeta && (hasLeftMeta !== hasRightMeta));

  const managementLine = doc.getElementById('schoolManagementLine');
  if (managementLine) {
    managementLine.innerHTML = sanitizeSchoolBannerHtml(String(meta?.managementLine || ''));
    hide(managementLine, meta?.showManagementLine !== true || !String(meta?.managementLine || '').trim());
  }

  setText('examTitle', data.examType || 'REPORT CARD');
  setText('academicSession', formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat));
  const modernTitle = doc.getElementById('examTitle');
  const modernSession = doc.getElementById('academicSession');
  const modernHeader = modernTitle?.parentElement?.parentElement;
  if (modernHeader && modernTitle && modernSession) {
    const titleLine = modernTitle.parentElement as HTMLElement;
    const sessionLine = modernSession.parentElement as HTMLElement;
    const single = data.marksheetSettings.headerLayout === 'single-row';
    modernHeader.style.display = 'flex'; modernHeader.style.flexDirection = single ? 'row' : 'column';
    modernHeader.style.flexWrap = 'nowrap'; modernHeader.style.alignItems = 'center'; modernHeader.style.justifyContent = 'center';
    modernHeader.style.columnGap = `${Math.max(0, Math.min(20, Number(data.marksheetSettings.headerGapMm ?? 4)))}mm`;
    titleLine.style.margin = '0'; sessionLine.style.margin = '0';
    titleLine.style.whiteSpace = single ? 'nowrap' : 'normal'; sessionLine.style.whiteSpace = single ? 'nowrap' : 'normal';
  }
  setText('stuName', student.name);
  setText('stuClass', classLabel);
  setText('stuRoll', student.roll);
  setText('stuMother', student.mother);
  setText('stuFather', student.father);
  doc.title = `Marksheet - ${data.school.name} - ${student.name}`;

  // Photo and watermark are optional configured assets.
  const photo = doc.getElementById('studentPhoto') as HTMLImageElement | null;
  if (photo) {
    if (student.photo && data.marksheetSettings.showPhoto !== false) photo.src = student.photo;
    else photo.removeAttribute('src');
    hide(photo.closest('.shrink-0'), !student.photo || data.marksheetSettings.showPhoto === false);
  }
  const watermark = data.school.watermarkUseLeftLogo !== false ? leftLogo : (data.school.watermark || '');
  const watermarkMode = data.marksheetSettings.watermarkMode || 'repeat';
  const watermarkOpacity = Math.max(0, Math.min(100, Number(data.marksheetSettings.watermarkOpacity ?? 8))) / 100;
  const watermarkSize = watermarkMode === 'single'
    ? Math.max(120, Number(data.marksheetSettings.watermarkCenterSize ?? 360))
    : Math.max(24, Number(data.marksheetSettings.watermarkRepeatSize ?? 60));
  const watermarkStyle = doc.createElement('style');
  watermarkStyle.textContent = watermark
    ? `.main-content::before{content:"";background-image:url("${watermark}")!important;background-repeat:${watermarkMode === 'repeat' ? 'repeat' : 'no-repeat'}!important;background-position:center!important;background-size:${watermarkMode === 'repeat' ? `${watermarkSize}px ${watermarkSize}px` : `min(${watermarkSize}px,90%) auto`}!important;opacity:${watermarkOpacity}!important;}`
    : `.main-content::before{content:none!important;background-image:none!important;}`;
  doc.head.append(watermarkStyle);

  // Result table: single-exam reports use original marks; combined reports use converted contributions.
  const table = doc.querySelector<HTMLTableElement>('table.w-full.table-fixed');
  const head = doc.getElementById('marksTableHead') || table?.querySelector('thead');
  const body = doc.getElementById('marksTableBody');
  const foot = doc.getElementById('marksTableFoot');
  const makeCell = (tag: 'th' | 'td', value: string, className = '') => {
    const cell = doc.createElement(tag); cell.textContent = value; if (className) cell.className = className; return cell;
  };
  if (head && body) {
    head.replaceChildren(); body.replaceChildren(); foot?.replaceChildren();
    if (isMulti) {
      const header = doc.createElement('tr');
      header.append(makeCell('th', 'Subjects', 'w-44 py-2 px-3 text-left'));
      keys.forEach(key => header.append(makeCell('th', `${data.exams[key].shortName} (${fmtMarks(maxFor(key))})`, 'py-2 px-2')));
      if ((keys.length > 1 || calcKeys.length > 1) && data.marksheetSettings.showTotalColumn !== false) {
        const totalMaximum = calcKeys.reduce((sum, key) => sum + calcMaximumFor(key), 0);
        header.append(makeCell('th', `Total (${fmtMarks(totalMaximum)})`, 'bg-blue-100/50 text-blue-950'));
      }
      if (data.marksheetSettings.showSubjectGrade !== false) header.append(makeCell('th', 'Grade'));
      head.append(header);
      const totals = Object.fromEntries(keys.map(key => [key, 0])) as Record<ExamKey, number>;
      rows.forEach(row => {
        const tr = doc.createElement('tr'); tr.append(makeCell('td', row.subject.name, 'py-1.5 px-3 text-left'));
        row.examMarks.forEach((mark, index) => {
          const key = keys[index];
          // getExamMarks already returns converted weightage; never convert twice.
          const converted = mark;
          totals[key] += converted ?? 0;
          const status = getConfiguredMarkStatus(data, row.rawExamMarks[index]);
          tr.append(makeCell('td', status ? status.displayValue : converted === null ? '—' : fmtMarks(converted), 'py-1.5 px-2 data-scaled'));
        });
        if ((keys.length > 1 || calcKeys.length > 1) && data.marksheetSettings.showTotalColumn !== false) tr.append(makeCell('td', fmtMarks(row.obtained), 'data-scaled bg-blue-50/40 text-blue-950'));
        if (data.marksheetSettings.showSubjectGrade !== false) tr.append(makeCell('td', row.maximum ? gradeForPercentage(row.percentage) : '—', 'data-scaled text-emerald-800'));
        body.append(tr);
      });
      if (foot) {
        const totalRow = doc.createElement('tr'); totalRow.append(makeCell('th', 'Grand Total', 'py-1.5 px-3 text-left'));
        keys.forEach(key => totalRow.append(makeCell('th', fmtMarks(totals[key]), 'data-scaled')));
        if ((keys.length > 1 || calcKeys.length > 1) && data.marksheetSettings.showTotalColumn !== false) totalRow.append(makeCell('th', fmtMarks(grandObtained), 'data-scaled bg-blue-100/60 text-blue-950'));
        if (data.marksheetSettings.showSubjectGrade !== false) totalRow.append(makeCell('th', overallGrade, 'data-scaled text-emerald-800'));
        foot.append(totalRow);
      }
    } else {
      const header = doc.createElement('tr'); header.append(makeCell('th', '#', 'py-2 px-2'));
      rows.forEach(row => header.append(makeCell('th', row.subject.name, 'py-2 px-1')));
      head.append(header);
      const fullMarksRow = doc.createElement('tr'); fullMarksRow.append(makeCell('th', 'Full Marks', 'py-2 px-2'));
      rows.forEach(row => fullMarksRow.append(makeCell('td', fmtMarks(maxFor(keys[0])), 'py-2 px-1 static-print')));
      const marksRow = doc.createElement('tr'); marksRow.append(makeCell('th', 'Obtained Marks', 'py-2 px-2'));
      rows.forEach(row => { const status=getConfiguredMarkStatus(data,row.rawExamMarks[0]); marksRow.append(makeCell('td',status?status.displayValue:row.examMarks[0]===null?'—':fmtMarks(row.examMarks[0]!), 'py-2 px-1 data-scaled')); });
      body.append(fullMarksRow);
      if (data.marksheetSettings.showMarksRow !== false) body.append(marksRow);
      if (data.marksheetSettings.showGradeRow !== false && data.marksheetSettings.showSubjectGrade !== false) {
        const gradeRow = doc.createElement('tr'); gradeRow.append(makeCell('th', 'Grade', 'py-2 px-2'));
        rows.forEach(row => gradeRow.append(makeCell('td', row.examMarks[0] === null ? '—' : gradeForPercentage(row.percentage), 'py-2 px-1 data-scaled')));
        body.append(gradeRow);
      }
    }
  }

  // Grading scale must reflect configured rules, in their configured priority order.
  const gradingScale = [...doc.querySelectorAll('div')].find(el => el.children.length >= 3 && el.textContent?.trim().startsWith('Grading Scale'));
  if (gradingScale) {
    gradingScale.replaceChildren();
    const label = doc.createElement('span'); label.className = 'font-bold text-slate-900 uppercase'; label.textContent = 'Grading Scale :'; gradingScale.append(label);
    data.grading.grades.forEach(rule => {
      const item = doc.createElement('span');
      const strong = doc.createElement('strong'); strong.textContent = rule.grade;
      item.append(strong, doc.createTextNode(` (${rule.operator || '>='}${fmtMarks(rule.minPercentage)}%)`)); gradingScale.append(item);
    });
  }

  // Summary cards and visibility follow the marksheet configuration.
  setText('summaryMarks', `${fmtMarks(grandObtained)}/${fmtMarks(grandMaximum)}`);
  const summaryMarksLabel = doc.querySelector('#summaryMarks')?.previousElementSibling;
  if (summaryMarksLabel) summaryMarksLabel.textContent = 'Obtained Marks';
  const summaryPercentageLabel = doc.querySelector('#summaryPercentage')?.previousElementSibling;
  if (summaryPercentageLabel) summaryPercentageLabel.textContent = 'Percentage';
  setText('summaryPercentage', `${percentage.toFixed(1)}%`);
  setText('summaryAttendance', `${fmtMarks(presentDays)}/${fmtMarks(workingDays)}`);
  setText('summaryGrade', overallGrade);
  ['summaryMarks', 'summaryPercentage', 'summaryAttendance', 'summaryGrade'].forEach(id => {
    doc.getElementById(id)?.classList.add('data-scaled');
  });
  setText('teacherRemarks', remarks);
  const summary = doc.getElementById('summaryMarks')?.closest('.grid.grid-cols-2');
  hide(summary, data.marksheetSettings.showOverallSummary === false);
  hide(doc.getElementById('summaryAttendance')?.parentElement, data.marksheetSettings.showAttendance === false);
  hide(doc.getElementById('summaryGrade')?.parentElement, data.marksheetSettings.showGrade === false);
  hide(doc.getElementById('teacherRemarks')?.parentElement, data.marksheetSettings.showRemarks === false);

  // Subject performance chart uses the same selected-exam total maximum as the marksheet total column.
  // Do not reduce the chart maximum when an individual subject has missing exam entries.
  const chartMaximum = calcKeys.reduce((sum, key) => sum + calcMaximumFor(key), 0);
  setText('marksChartScale', 'Marks obtained / total marks');
  setText('marksChartAverage', `${percentage.toFixed(1)}%`);
  setText('marksChartCaption', `${rows.length} subjects · performance across configured calculation exams`);
  const chart = doc.getElementById('marksChart');
  if (chart) {
    chart.replaceChildren();
    rows.forEach(row => {
      const hasNumericMarks = row.rawExamMarks.some(value => hasMark(value));
      const chartPercentage = hasNumericMarks && chartMaximum > 0 ? (row.obtained / chartMaximum) * 100 : null;
      const item = doc.createElement('div'); item.className = 'marks-chart__item';
      const value = doc.createElement('div'); value.className = 'marks-chart__value'; value.textContent = hasNumericMarks ? `${fmtMarks(row.obtained)}/${fmtMarks(chartMaximum)}` : '—';
      const track = doc.createElement('div'); track.className = 'marks-chart__track'; track.setAttribute('role', 'img');
      track.setAttribute('aria-label', chartPercentage === null ? `${row.subject.name}: no numeric marks entered` : `${row.subject.name}: ${fmtMarks(row.obtained)} out of ${fmtMarks(chartMaximum)} (${chartPercentage.toFixed(1)}%)`);
      if (chartPercentage !== null) {
        const bar = doc.createElement('div'); bar.className = 'marks-chart__bar'; bar.style.setProperty('--bar-height', `${Math.max(0, Math.min(100, chartPercentage))}%`); track.append(bar);
      } else track.classList.add('marks-chart__track--empty');
      const subject = doc.createElement('div'); subject.className = 'marks-chart__subject'; subject.textContent = row.subject.name;
      item.append(value, track, subject); chart.append(item);
    });
  }

  // Compact, readable QR payload. Keep it aligned with the selected exams and
  // the same marks precision used throughout the marksheet.
  const qr = doc.querySelector<HTMLImageElement>('img[alt="Verification QR Code"]');
  if (qr) {
    const sessionLabel = formatAcademicSession(data.academicSession, data.settings.sessionDisplayFormat);
    const schoolInitials = (data.school.name || '')
      .trim().split(/\s+/).filter(Boolean).map(word => word[0]).join('').toUpperCase() || 'NPS';
    const examLabels: Record<ExamKey, string> = {
      pa1: 'PA1', pa2: 'PA2', hy: 'HY', pa3: 'PA3', pa4: 'PA4', final: 'Final'
    };
    const examLabel = data.examType?.trim() || keys.map(key => examLabels[key] || data.exams[key]?.shortName || key.toUpperCase()).join('+');
    const subjectAbbreviations: Record<string, string> = {
      hindi: 'Hi', english: 'En', math: 'Ma', maths: 'Ma', mathematics: 'Ma',
      science: 'Sc', 'social science': 'SS', 'social studies': 'SS',
      computer: 'Co', 'computer science': 'Co'
    };
    const abbreviateSubject = (name: string) => {
      const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
      return subjectAbbreviations[normalized] || name.trim().split(/\s+/).map(word => word.slice(0, 1)).join('').slice(0, 3).toUpperCase() || 'Sub';
    };
    const subjectTokens = rows.map(row => `${abbreviateSubject(row.subject.name)}:${fmtMarks(row.obtained)}/${fmtMarks(row.maximum)}`);
    const subjectLines: string[] = [];
    for (let i = 0; i < subjectTokens.length; i += 3) subjectLines.push(subjectTokens.slice(i, i + 3).join(' '));
    const qrLabel = String(data.qrExamName || '').trim() || examLabel;
    const qrPayload = [
      `${schoolInitials}|${qrLabel}|${sessionLabel}`,
      student.name || '—',
      `Cls:${classLabel} Roll:${student.roll || '—'}`,
      ...subjectLines,
      `Ob M:${fmtMarks(grandObtained)}/${fmtMarks(grandMaximum)}|${percentage.toFixed(2)}%`,
      `Gd:${overallGrade || '—'}`,
      `Attd:${fmtMarks(presentDays)}/${fmtMarks(workingDays)}|${attendancePercentage.toFixed(2)}%`
    ].join('\n');
    qr.src = await createQrDataUrl(qrPayload, data);
    qr.alt = `Readable result QR code for ${student.name}`;
    qr.style.imageRendering = 'pixelated';
    const qrFrame = qr.parentElement as HTMLElement | null;
    const qrSize = Math.max(25, Math.min(50, Number(data.marksheetSettings.qrSizeMm) || 35));
    if (qrFrame) {
      qrFrame.style.width = `${qrSize}mm`;
      qrFrame.style.height = `${qrSize}mm`;
      qrFrame.style.padding = '0.8mm';
      qrFrame.style.boxSizing = 'border-box';
      qrFrame.style.flex = '0 0 auto';
    }
    qr.style.width = '100%'; qr.style.height = '100%'; qr.style.maxWidth = '100%'; qr.style.objectFit = 'contain';
  }

  // Signature row: only configured/enabled School Profile blocks are rendered.
  // Names and transparent PNGs sit above each divider; labels share one baseline.
  const issueDate = doc.getElementById('issueDate');
  const signatureRow = issueDate?.parentElement?.parentElement;
  if (signatureRow) {
    signatureRow.replaceChildren();
    signatureRow.className = 'w-full flex justify-around items-end flex-nowrap flex-shrink-0 px-4 pt-2 pb-1 gap-x-3';
    const pageContent = signatureRow.closest<HTMLElement>('.sheet') || signatureRow.closest<HTMLElement>('.main-content');
    if (pageContent) {
      pageContent.style.position = 'relative';
      signatureRow.style.position = 'absolute'; signatureRow.style.left = '0'; signatureRow.style.right = '0';
      signatureRow.style.bottom = '2.5mm'; signatureRow.style.width = '100%'; signatureRow.style.margin = '0';
      signatureRow.style.boxSizing = 'border-box';
    }
    const dateBlock = doc.createElement('div'); dateBlock.className = 'flex flex-col items-center'; dateBlock.style.width = '18%'; dateBlock.style.minWidth = '18%'; dateBlock.style.flexShrink = '0';
    if (modernSettings.showIssueDate !== false) {
      const dateValue = doc.createElement('div'); dateValue.className = 'font-bold text-base data pb-1'; dateValue.style.whiteSpace = 'nowrap'; dateValue.style.flexShrink = '0'; dateValue.style.fontSize = '14px'; dateValue.style.letterSpacing = 'normal'; const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(modernSettings.issueDate || '')) ? String(modernSettings.issueDate) : (() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; })(); const [yyyy, mm, dd] = selectedDate.split('-'); const dateFormat = modernSettings.issueDateFormat || 'DD-MM-YYYY'; dateValue.textContent = dateFormat === 'YYYY-MM-DD' ? `${yyyy}-${mm}-${dd}` : dateFormat === 'DD/MM/YYYY' ? `${dd}/${mm}/${yyyy}` : `${dd}-${mm}-${yyyy}`;
      const dateLine = doc.createElement('div'); dateLine.className = 'w-full font-bold text-xs uppercase tracking-wider border-t-2 border-dashed border-slate-700 pt-1 text-center'; dateLine.style.whiteSpace = 'nowrap'; dateLine.textContent = modernSettings.issueDateLabel?.trim() || 'Date';
      dateBlock.append(dateValue, dateLine); signatureRow.append(dateBlock);
    }
    const signatures = (data.marksheetSettings.signatures || []).filter(signature => signature.enabled && signature.label.trim()).slice(0, 4);
    signatures.forEach(signature => {
      const block = doc.createElement('div'); block.className = 'flex flex-col items-center'; block.style.width = `${Math.min(24, 92 / (signatures.length + (modernSettings.showIssueDate !== false ? 1 : 0))) }%`; 
      const signatureWidthMm = Math.min(60, Math.max(15, Number(signature.widthMm) || 32));
      const signatureHeightMm = Math.min(20, Math.max(5, Number(signature.heightMm) || 10));
      const signatureHeightPx = signatureHeightMm * 3.7795;
      const content = doc.createElement('div'); content.className = 'w-full flex flex-col items-center justify-end'; content.style.minHeight = `${Math.max(46, signatureHeightPx + 16)}px`; content.style.position = 'relative'; content.style.overflow = 'visible';
      if (signature.signatureImage) {
        const image = doc.createElement('img'); image.src = signature.signatureImage; image.alt = `${signature.label} signature`; image.className = 'object-contain mb-0.5'; image.style.width = `${signatureWidthMm}mm`; image.style.height = `${signatureHeightMm}mm`; image.style.maxWidth = '100%'; image.style.objectFit = 'contain'; image.style.background = 'transparent'; image.style.position = 'relative'; image.style.zIndex = '1'; image.style.transform = `translateY(${-Math.max(-20, Math.min(20, Number(signature.offsetMm) || 0))}mm)`; content.append(image);
      } else {
        const spacer = doc.createElement('div'); spacer.style.width = `${signatureWidthMm}mm`; spacer.style.height = `${signatureHeightMm}mm`; content.append(spacer);
      }
      if (signature.name.trim()) {
        const name = doc.createElement('div'); name.className = 'font-semibold text-[10px] text-center leading-tight'; name.textContent = signature.name; content.append(name);
      }
      const divider = doc.createElement('div'); divider.className = 'w-full border-t-2 border-dashed border-slate-700 mt-0.5';
      const label = doc.createElement('div'); label.className = 'w-full font-bold text-xs uppercase tracking-wider pt-1 text-center'; label.textContent = signature.label;
      block.append(content, divider, label); signatureRow.append(block);
    });
    hide(signatureRow, modernSettings.showIssueDate === false && signatures.length === 0);
  }

  // The supplied contact strip contains hard-coded phone numbers not stored in
  // School Profile. Do not print those demo contacts on real student records.
  const contactStrip = [...doc.querySelectorAll('body > section .bg-slate-800')].find(el => el.textContent?.includes('9128289100') || el.textContent?.includes('9973757920'));
  if (contactStrip) contactStrip.remove();

  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
