// مساعد الياسمين لتنسيق اللجان - ملف المنطق الرئيسي (v5.1 - إصلاح الأخطاء)

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded. Multi-format Protocol v5.1 engaged.");

    // --- CSV/Excel Header Keys ---
    const H_NAME = 'اسم الحلقة';
    const H_TEACHER = 'اسم المعلم';
    const H_STUDENTS = 'عدد الطلاب';
    const H_GENDER = 'نوع الحلقة';
    const H_SIZE = 'حجم طلاب الحلقة';
    const E_NAME = 'اسم الممتحن';
    const E_GENDER = 'النوع: ذكر/أنثى';
    const E_TYPE = 'نوع: كبار /أطفال فقط';
    const R_ID = 'أرقام الغرف';
    const R_FLOOR = 'الدور';

    // --- DOM Element References ---
    const processButton = document.getElementById('process-button');
    const foundationReportEl = document.querySelector('#foundation-report-placeholder pre');
    const violationReportEl = document.querySelector('#violation-report-placeholder pre');
    const finalScheduleEl = document.getElementById('final-schedule-placeholder');
    const copyButton = document.getElementById('copy-button');
    const examinersFile = document.getElementById('examiners-file');
    const halaqatFile = document.getElementById('halaqat-file');
    const roomsFile = document.getElementById('rooms-file');
    const maxStudentsInput = document.getElementById('max-students-per-examiner');
    const addShiftButton = document.getElementById('add-shift-button');
    const shiftsContainer = document.getElementById('shifts-container');

    // --- Initial State ---
    function initializeState() {
        foundationReportEl.textContent = 'يرجى رفع الملفات المطلوبة، ضبط الإعدادات، ثم الضغط على زر البدء.';
        violationReportEl.textContent = '---';
        finalScheduleEl.innerHTML = '---';
        processButton.disabled = true;
        maxStudentsInput.value = 50; // Reset on load
        shiftsContainer.innerHTML = ''; // Clear any existing shifts
    }

    // --- Main Logic ---
    processButton.addEventListener('click', handleProcessing);
    copyButton.addEventListener('click', copyTableToClipboard);
    addShiftButton.addEventListener('click', () => addShiftSlot());

    [examinersFile, halaqatFile, roomsFile].forEach(fileInput => {
        fileInput.addEventListener('change', checkFilesSelected);
    });

    initializeState(); // Set the initial state on page load

    async function handleProcessing() {
        try {
            console.log("Processing started...");
            foundationReportEl.textContent = 'جاري قراءة الملفات والإعدادات...';
            violationReportEl.textContent = '---';
            finalScheduleEl.innerHTML = '---';

            const maxStudentsPerExaminer = parseInt(maxStudentsInput.value, 10) || 50;
            const shifts = getShifts();

            if (shifts.length === 0) {
                violationReportEl.textContent = "خطأ: يجب تحديد فترة اختبار واحدة على الأقل.";
                return;
            }

            const files = [examinersFile.files[0], halaqatFile.files[0], roomsFile.files[0]];
            if (files.some(f => !f)) {
                foundationReportEl.textContent = 'خطأ: يرجى التأكد من رفع جميع الملفات الثلاثة.';
                return;
            }

            const [examiners, halaqat, rooms] = await Promise.all(files.map(parseFile));

            const isCapacityValid = runFoundationReport(examiners, halaqat, maxStudentsPerExaminer);
            if (!isCapacityValid) {
                violationReportEl.textContent = "تنبيه: لن يتم التوزيع لأن السعة الإجمالية للممتحنين أقل من عدد الطلاب.";
                return;
            }

            const halaqaDist = runDistributionAlgorithm(examiners, halaqat, maxStudentsPerExaminer);
            if (halaqaDist.violations.length > 0) {
                displayViolations(halaqaDist.violations);
            }

            const finalDist = runRoomAndTimeslotDistribution(halaqaDist.assignments, rooms, shifts);
            if (finalDist.violations.length > 0) {
                displayViolations(finalDist.violations, true);
            }
            
            if (Object.keys(finalDist.assignments).length > 0) {
                 if (halaqaDist.violations.length === 0 && finalDist.violations.length === 0) {
                    violationReportEl.textContent = "لا توجد أخطاء. تم التوزيع بالكامل بنجاح.";
                }
                displayAssignmentsTable(finalDist.assignments, shifts);
            }

        } catch (error) {
            foundationReportEl.textContent = `حدث خطأ أثناء معالجة الملفات: ${error.message}`;
            console.error(error);
        }
    }

    // --- Core Algorithm Functions (Largely Unchanged) ---

    function runFoundationReport(examiners, halaqat, maxStudents) {
        const totalHalaqat = halaqat.length;
        const totalStudents = halaqat.reduce((sum, h) => sum + parseInt(h[H_STUDENTS] || 0), 0);
        const availableCapacity = examiners.length * maxStudents;
        const report = `
## تقرير الإحصائيات الأساسية ##
- إجمالي عدد الحلقات: ${totalHalaqat}
- إجمالي عدد الطلاب: ${totalStudents}
- عدد الممتحنين المتاحين: ${examiners.length}
- السعة لكل ممتحن: ${maxStudents} طالبًا
- السعة الإجمالية المتاحة: ${availableCapacity} طالبًا
**التحقق من الصحة:**
- هل عدد الطلاب الإجمالي (${totalStudents}) ضمن السعة المتاحة (${availableCapacity})؟ ${totalStudents <= availableCapacity ? 'نعم' : 'لا - يوجد نقص في السعة!'}
        `;
        foundationReportEl.textContent = report.trim();
        return totalStudents <= availableCapacity;
    }

    function runDistributionAlgorithm(examiners, halaqat, maxStudents) {
        let assignments = {};
        examiners.forEach(e => { 
            if(e[E_NAME]) assignments[e[E_NAME]] = { student_count: 0, assigned_halaqat: [] }; 
        });
        let violations = [];
        const adultHalaqat = halaqat.filter(h => (h[H_SIZE] || '').trim() === 'كبار');
        const kidHalaqat = halaqat.filter(h => (h[H_SIZE] || '').trim() === 'أطفال فقط');
        const adultPriorityExaminers = examiners.filter(e => (e[E_TYPE] || '').trim() === 'كبار');
        const kidsOnlyExaminers = examiners.filter(e => (e[E_TYPE] || '').trim() === 'أطفال فقط');

        adultHalaqat.sort((a, b) => parseInt(b[H_STUDENTS] || 0) - parseInt(a[H_STUDENTS] || 0));
        kidHalaqat.sort((a, b) => parseInt(b[H_STUDENTS] || 0) - parseInt(a[H_STUDENTS] || 0));

        let unassignedHalaqat = [];

        for (const halaqa of adultHalaqat) {
            if (!assignHalaqaToBestFit(halaqa, adultPriorityExaminers, assignments, maxStudents)) {
                unassignedHalaqat.push(halaqa);
            }
        }
        const allExaminers = [...new Set([...adultPriorityExaminers, ...kidsOnlyExaminers])];
        for (const halaqa of kidHalaqat) {
            if (!assignHalaqaToBestFit(halaqa, allExaminers, assignments, maxStudents)) {
                unassignedHalaqat.push(halaqa);
            }
        }

        if (unassignedHalaqat.length > 0) {
            violations.push("## الانتهاكات (Violations) ##");
            unassignedHalaqat.forEach(h => {
                violations.push(`- تعذر إسناد حلقة "${h[H_NAME]}".`);
            });
        }
        return { assignments, violations };
    }

    function assignHalaqaToBestFit(halaqa, availableExaminers, assignments, maxStudents) {
        const halaqa_students = parseInt(halaqa[H_STUDENTS] || 0);
        const halaqa_gender = (halaqa[H_GENDER] || '').trim().toLowerCase();
        const halaqa_size = (halaqa[H_SIZE] || '').trim().toLowerCase();
        let bestFitExaminerName = null;
        let minLoad = Infinity;

        for (const examiner of availableExaminers) {
            const examiner_name = examiner[E_NAME];
            if (!examiner_name || !assignments[examiner_name]) continue; // Safety check

            const examiner_gender = (examiner[E_GENDER] || '').trim().toLowerCase();
            const examiner_type = (examiner[E_TYPE] || '').trim().toLowerCase();
            const current_load = assignments[examiner_name].student_count;
            const selfAssignmentBlock = halaqa[H_TEACHER] === examiner_name;
            const genderMatch = (halaqa_gender === 'مختلط') || (halaqa_gender === 'ذكور' && examiner_gender === 'ذكر') || (halaqa_gender === 'إناث' && examiner_gender === 'انثى');
            const capacityCheck = (current_load + halaqa_students) <= maxStudents;
            const typeCheck = !(examiner_type === 'أطفال فقط' && halaqa_size === 'كبار');

            if (!selfAssignmentBlock && genderMatch && capacityCheck && typeCheck && current_load < minLoad) {
                minLoad = current_load;
                bestFitExaminerName = examiner_name;
            }
        }

        if (bestFitExaminerName) {
            assignments[bestFitExaminerName].assigned_halaqat.push(halaqa);
            assignments[bestFitExaminerName].student_count += halaqa_students;
            return true;
        }
        return false;
    }

    function runRoomAndTimeslotDistribution(assignments, rooms, shifts) {
        let violations = [];
        const activeExaminers = Object.keys(assignments).filter(name => assignments[name].assigned_halaqat.length > 0);
        if (activeExaminers.length > rooms.length) {
            violations.push(`- خطأ: عدد الممتحنين (${activeExaminers.length}) أكبر من عدد الغرف (${rooms.length}).`);
            return { assignments, violations };
        }

        const availableRooms = [...rooms];
        for (const examinerName of activeExaminers) {
            const room = availableRooms.pop();
            assignments[examinerName].room = room ? `${room[R_ID]} (${room[R_FLOOR]})` : 'غير محدد';
            const slots = {};
            shifts.forEach((shift, i) => {
                slots[`slot${i+1}`] = { name: `${shift.start} - ${shift.end}`, halaqat: [], student_count: 0 };
            });
            const sortedHalaqat = assignments[examinerName].assigned_halaqat.sort((a, b) => parseInt(b[H_STUDENTS] || 0) - parseInt(a[H_STUDENTS]));
            for (const halaqa of sortedHalaqat) {
                const student_count = parseInt(halaqa[H_STUDENTS] || 0);
                if (Object.keys(slots).length > 0) {
                    let bestSlotKey = Object.keys(slots).reduce((best, key) => slots[key].student_count < slots[best].student_count ? key : best);
                    slots[bestSlotKey].halaqat.push(halaqa);
                    slots[bestSlotKey].student_count += student_count;
                }
            }
            assignments[examinerName].slots = slots;
        }
        return { assignments, violations };
    }

    // --- Display and UI Functions ---

    function displayViolations(violations, append = false) {
        if (append && violationReportEl.textContent !== '---' && violationReportEl.textContent.includes("##")) {
             violationReportEl.textContent += '\n' + violations.join('\n');
        } else {
            violationReportEl.textContent = violations.join('\n');
        }
    }

    function displayAssignmentsTable(assignments, shifts) {
        const numSlots = shifts.length > 0 ? shifts.length : 1;
        let tableHTML = `<table><thead><tr><th>اسم الممتحن</th><th>مكان اللجنة</th><th>الفترة</th><th>الحلقات المسندة</th><th>عدد الطلاب</th></tr></thead><tbody>`;
        for (const examinerName in assignments) {
            const data = assignments[examinerName];
            if (data.assigned_halaqat.length > 0) {
                tableHTML += `<tr class="examiner-row"><td rowspan="${numSlots}">${examinerName}</td><td rowspan="${numSlots}">${data.room || 'N/A'}</td>`;
                
                if (Object.keys(data.slots).length > 0) {
                    Object.keys(data.slots).forEach((slotKey, index) => {
                        const slot = data.slots[slotKey];
                        if (index > 0) tableHTML += `<tr class="period-row">`;
                        tableHTML += `<td class="period-row">${slot.name}</td><td>${generateHalaqatList(slot.halaqat)}</td><td>${slot.student_count}</td></tr>`;
                    });
                } else {
                     tableHTML += `<td class="period-row">-</td><td>${generateHalaqatList(data.assigned_halaqat)}</td><td>${data.student_count}</td></tr>`;
                }
            }
        }
        tableHTML += `</tbody></table>`;
        finalScheduleEl.innerHTML = tableHTML;
    }

    function generateHalaqatList(halaqat) {
        if (!halaqat || halaqat.length === 0) return '-';
        return `<ul class="halaqat-list">${halaqat.map(h => `<li>${h[H_NAME]} (${h[H_STUDENTS]} طلاب) [${h[H_SIZE]}]</li>`).join('')}</ul>`;
    }

    function addShiftSlot(start = '', end = '') {
        const shiftId = `shift-${Date.now()}`;
        const shiftEl = document.createElement('div');
        shiftEl.classList.add('shift-slot');
        shiftEl.id = shiftId;
        shiftEl.innerHTML = `
            <input type="time" class="settings-input" value="${start}">
            <span>-</span>
            <input type="time" class="settings-input" value="${end}">
            <button type="button" class="remove-shift-btn" data-target="${shiftId}"><i class="fas fa-trash-alt"></i></button>
        `;
        shiftsContainer.appendChild(shiftEl);
        shiftEl.querySelector('.remove-shift-btn').addEventListener('click', (e) => {
            document.getElementById(e.currentTarget.dataset.target).remove();
        });
    }

    function getShifts() {
        const shifts = [];
        shiftsContainer.querySelectorAll('.shift-slot').forEach(slot => {
            const inputs = slot.querySelectorAll('input[type="time"]');
            if (inputs[0].value && inputs[1].value) {
                shifts.push({ start: inputs[0].value, end: inputs[1].value });
            }
        });
        return shifts;
    }

    function copyTableToClipboard() {
        const content = finalScheduleEl.innerHTML;
        if (!content || content === '---') return;
        const blob = new Blob([content], { type: 'text/html' });
        const item = new ClipboardItem({ 'text/html': blob });
        navigator.clipboard.write([item]).then(() => {
            const originalText = copyButton.querySelector('span').textContent;
            const originalIcon = copyButton.querySelector('i').className;
            copyButton.querySelector('span').textContent = 'تم النسخ!';
            copyButton.querySelector('i').className = 'fas fa-check';
            copyButton.classList.add('success-animation');
            setTimeout(() => {
                copyButton.querySelector('span').textContent = originalText;
                copyButton.querySelector('i').className = originalIcon;
                copyButton.classList.remove('success-animation');
            }, 2000);
        }).catch(err => console.error('Failed to copy: ', err));
    }

    // --- File Parsing ---

    async function parseFile(file) {
        const extension = file.name.split('.').pop().toLowerCase();
        if (extension === 'csv') {
            const text = await file.text();
            return parseCsv(text);
        } else if (extension === 'xlsx' || extension === 'xls') {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            return XLSX.utils.sheet_to_json(worksheet);
        } else {
            throw new Error(`صيغة الملف غير مدعومة: .${extension}`);
        }
    }

    function parseCsv(csvText) {
        const lines = csvText.trim().split(/\r\n|\n/);
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i]) continue;
            const values = lines[i].split(',').map(v => v.trim());
            if (values.length === headers.length) {
                const row = {};
                headers.forEach((header, j) => { row[header] = values[j]; });
                rows.push(row);
            }
        }
        return rows;
    }

    function checkFilesSelected() {
        processButton.disabled = ![examinersFile, halaqatFile, roomsFile].every(f => f.files.length > 0);
    }
});