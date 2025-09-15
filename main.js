// مساعد الياسمين لتنسيق اللجان - ملف المنطق الرئيسي (v3 - بروتوكول محدث)

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed. Protocol v3 engaged.");

    // --- CSV Header Keys ---
    const H_NAME = 'اسم الحلقة';
    const H_TEACHER = 'اسم المعلم';
    const H_STUDENTS = 'عدد الطلاب';
    const H_GENDER = 'نوع الحلقة';
    const H_SIZE = 'حجم طلاب الحلقة'; // New
    const E_NAME = 'اسم الممتحن';
    const E_GENDER = 'النوع: ذكر/أنثى';
    const E_TYPE = 'نوع: كبار /أطفال فقط'; // New
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

    // --- Initial State ---
    foundationReportEl.textContent = 'يرجى رفع الملفات المطلوبة والضغط على زر البدء.';
    violationReportEl.textContent = '---';
    finalScheduleEl.innerHTML = '---';
    processButton.disabled = true; // Initially disable the button

    // --- Main Logic ---
    processButton.addEventListener('click', handleProcessing);
    copyButton.addEventListener('click', copyTableToClipboard);

    examinersFile.addEventListener('change', checkFilesSelected);
    halaqatFile.addEventListener('change', checkFilesSelected);
    roomsFile.addEventListener('change', checkFilesSelected);

    async function handleProcessing() {
        // showLoadingOverlay(); // Removed
        try {
            console.log("Processing started...");
            foundationReportEl.textContent = 'جاري قراءة الملفات...';
            violationReportEl.textContent = '---';
            finalScheduleEl.innerHTML = '---';
            await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing delay

            const files = [document.getElementById('examiners-file').files[0], document.getElementById('halaqat-file').files[0], document.getElementById('rooms-file').files[0]];
            if (files.some(f => !f)) {
                foundationReportEl.textContent = 'خطأ: يرجى التأكد من رفع جميع الملفات الثلاثة.';
                return;
            }

            const [examinersCsv, halaqatCsv, roomsCsv] = await Promise.all(files.map(readFileAsText));
            const examiners = parseCsv(examinersCsv);
            const halaqat = parseCsv(halaqatCsv);
            const rooms = parseCsv(roomsCsv);

            const isCapacityValid = runFoundationReport(examiners, halaqat);
            if (!isCapacityValid) {
                violationReportEl.textContent = "تنبيه: لن يتم التوزيع لأن السعة الإجمالية للممتحنين أقل من عدد الطلاب.";
                return;
            }

            const halaqaDist = runDistributionAlgorithm(examiners, halaqat);
            if (halaqaDist.violations.length > 0) {
                displayViolations(halaqaDist.violations);
                // Do not return; allow displaying partial assignments if any
            }

            const finalDist = runRoomAndTimeslotDistribution(halaqaDist.assignments, rooms);
            if (finalDist.violations.length > 0) {
                displayViolations(finalDist.violations);
            }
            
            if (Object.keys(finalDist.assignments).length > 0) {
                 if (halaqaDist.violations.length === 0) {
                    violationReportEl.textContent = "لا توجد أخطاء. تم التوزيع بالكامل بنجاح.";
                }
                displayAssignmentsTable(finalDist.assignments);
            }

        } catch (error) {
            foundationReportEl.textContent = `حدث خطأ أثناء معالجة الملفات: ${error.message}`;
            console.error(error);
        } finally {
            // hideLoadingOverlay(); // Removed
        }
    }

    function runFoundationReport(examiners, halaqat) {
        console.log("Running Foundation Report...");
        const totalHalaqat = halaqat.length;
        const totalStudents = halaqat.reduce((sum, h) => sum + parseInt(h[H_STUDENTS] || 0), 0);
        const availableCapacity = examiners.length * 50;

        const genderDistribution = halaqat.reduce((dist, h) => {
            const gender = (h[H_GENDER] || '').trim().toLowerCase();
            if (gender === 'ذكور') dist.male++;
            else if (gender === 'إناث') dist.female++;
            else dist.mixed++;
            return dist;
        }, { male: 0, female: 0, mixed: 0 });

        const sizeDistribution = halaqat.reduce((dist, h) => {
            const size = (h[H_SIZE] || '').trim().toLowerCase();
            if (size === 'كبار') dist.adults++;
            else if (size === 'أطفال فقط') dist.kids++;
            return dist;
        }, { adults: 0, kids: 0 });

        const report = `
## تقرير الإحصائيات الأساسية ##
- إجمالي عدد الحلقات: ${totalHalaqat} (ذكور: ${genderDistribution.male}, إناث: ${genderDistribution.female}, مختلط: ${genderDistribution.mixed})
- توزيع الحلقات: ${sizeDistribution.adults} كبار, ${sizeDistribution.kids} أطفال
- إجمالي عدد الطلاب: ${totalStudents}
- عدد الممتحنين المتاحين: ${examiners.length}
- السعة الإجمالية المتاحة: ${availableCapacity} طالبًا
**التحقق من الصحة (Validation Gate):**
- هل عدد الطلاب الإجمالي (${totalStudents}) ضمن السعة المتاحة (${availableCapacity})؟ ${totalStudents <= availableCapacity ? 'نعم' : 'لا - يوجد نقص في السعة!'}
        `;
        foundationReportEl.textContent = report.trim();
        return totalStudents <= availableCapacity;
    }

    function runDistributionAlgorithm(examiners, halaqat) {
        console.log("Running New Distribution Algorithm (v3)...");
        let assignments = {};
        examiners.forEach(e => { assignments[e[E_NAME]] = { student_count: 0, assigned_halaqat: [] }; });
        let violations = [];
        
        // 1. Data Segregation
        const adultHalaqat = halaqat.filter(h => (h[H_SIZE] || '').trim() === 'كبار');
        const kidHalaqat = halaqat.filter(h => (h[H_SIZE] || '').trim() === 'أطفال فقط');
        
        const adultPriorityExaminers = examiners.filter(e => (e[E_TYPE] || '').trim() === 'كبار');
        const kidsOnlyExaminers = examiners.filter(e => (e[E_TYPE] || '').trim() === 'أطفال فقط');

        // Sort all by size for optimized packing
        adultHalaqat.sort((a, b) => parseInt(b[H_STUDENTS] || 0) - parseInt(a[H_STUDENTS] || 0));
        kidHalaqat.sort((a, b) => parseInt(b[H_STUDENTS] || 0) - parseInt(a[H_STUDENTS] || 0));

        let unassignedHalaqat = [];

        // 2. Pass 1: Assign Adult Halaqat to Adult-Priority Examiners
        console.log(`Pass 1: Assigning ${adultHalaqat.length} adult halaqat...`);
        for (const halaqa of adultHalaqat) {
            const wasAssigned = assignHalaqaToBestFit(halaqa, adultPriorityExaminers, assignments);
            if (!wasAssigned) {
                unassignedHalaqat.push(halaqa);
            }
        }

        // 3. Pass 2: Assign Kid Halaqat to ALL Examiners
        console.log(`Pass 2: Assigning ${kidHalaqat.length} kid halaqat...`);
        const allExaminers = [...adultPriorityExaminers, ...kidsOnlyExaminers];
        for (const halaqa of kidHalaqat) {
            const wasAssigned = assignHalaqaToBestFit(halaqa, allExaminers, assignments);
            if (!wasAssigned) {
                unassignedHalaqat.push(halaqa);
            }
        }

        if (unassignedHalaqat.length > 0) {
            violations.push("## الانتهاكات (Violations) ##");
            unassignedHalaqat.forEach(h => {
                violations.push(`- تعذر إسناد حلقة "${h[H_NAME]}". السبب المحتمل: لا يوجد ممتحن متاح يفي بشروط الجنس/النوع/السعة/عدم المراقبة الذاتية.`);
            });
        }
        
        return { assignments, violations };
    }

    function assignHalaqaToBestFit(halaqa, availableExaminers, assignments) {
        const halaqa_students = parseInt(halaqa[H_STUDENTS] || 0);
        const halaqa_gender = (halaqa[H_GENDER] || '').trim().toLowerCase();
        const halaqa_size = (halaqa[H_SIZE] || '').trim().toLowerCase();

        let bestFitExaminerName = null;
        let minLoad = Infinity;

        for (const examiner of availableExaminers) {
            const examiner_name = examiner[E_NAME];
            const examiner_gender = (examiner[E_GENDER] || '').trim().toLowerCase();
            const examiner_type = (examiner[E_TYPE] || '').trim().toLowerCase();
            const current_load = assignments[examiner_name].student_count;

            // --- CDE Checks ---
            const selfAssignmentBlock = halaqa[H_TEACHER] === examiner_name;
            const genderMatch = (halaqa_gender === 'مختلط') || (halaqa_gender === 'ذكور' && examiner_gender === 'ذكر') || (halaqa_gender === 'إناث' && examiner_gender === 'انثى');
            const capacityCheck = (current_load + halaqa_students) <= 50;
            const typeCheck = !(examiner_type === 'أطفال فقط' && halaqa_size === 'كبار');

            if (!selfAssignmentBlock && genderMatch && capacityCheck && typeCheck) {
                if (current_load < minLoad) {
                    minLoad = current_load;
                    bestFitExaminerName = examiner_name;
                }
            }
        }

        if (bestFitExaminerName) {
            assignments[bestFitExaminerName].assigned_halaqat.push(halaqa);
            assignments[bestFitExaminerName].student_count += halaqa_students;
            console.log(`Assigned "${halaqa[H_NAME]}" to "${bestFitExaminerName}"`);
            return true;
        }
        
        console.warn(`Could not assign "${halaqa[H_NAME]}"`);
        return false;
    }

    function runRoomAndTimeslotDistribution(assignments, rooms) {
        console.log("Running Room and Timeslot Distribution...");
        let violations = [];
        const activeExaminers = Object.keys(assignments).filter(name => assignments[name].assigned_halaqat.length > 0);
        
        if (activeExaminers.length > rooms.length) {
            violations.push(`- خطأ في توزيع الغرف: عدد الممتحنين (${activeExaminers.length}) أكبر من عدد الغرف المتاحة (${rooms.length}).`);
            return { assignments, violations };
        }

        const availableRooms = [...rooms];
        for (const examinerName of activeExaminers) {
            const room = availableRooms.pop(); // Simple assignment
            assignments[examinerName].room = `${room[R_ID]} (${room[R_FLOOR]})`;
            
            const slots = {
                slot1: { name: "9:00 - 11:00", halaqat: [], student_count: 0 },
                slot2: { name: "11:00 - 1:00", halaqat: [], student_count: 0 }
            };

            // Sort halaqat by student count to balance slots
            const sortedHalaqat = assignments[examinerName].assigned_halaqat.sort((a, b) => parseInt(b[H_STUDENTS]) - parseInt(a[H_STUDENTS]));
            
            for (const halaqa of sortedHalaqat) {
                const student_count = parseInt(halaqa[H_STUDENTS]);
                // Add to the slot with fewer students to keep them balanced
                if (slots.slot1.student_count <= slots.slot2.student_count) {
                    slots.slot1.halaqat.push(halaqa);
                    slots.slot1.student_count += student_count;
                } else {
                    slots.slot2.halaqat.push(halaqa);
                    slots.slot2.student_count += student_count;
                }
            }
            assignments[examinerName].slots = slots;
        }
        return { assignments, violations };
    }

    function displayViolations(violations) {
        violationReportEl.textContent = violations.join('\n');
    }

    function displayAssignmentsTable(assignments) {
        let tableHTML = `<table>
            <thead>
                <tr>
                    <th>اسم الممتحن</th>
                    <th>مكان اللجنة</th>
                    <th>الفترة</th>
                    <th>الحلقات المسندة</th>
                    <th>عدد الطلاب</th>
                </tr>
            </thead>
            <tbody>`;
        for (const examinerName in assignments) {
            const data = assignments[examinerName];
            if (data.assigned_halaqat.length > 0) {
                const slot1 = data.slots.slot1;
                const slot2 = data.slots.slot2;
                
                // Examiner Row
                tableHTML += `<tr class="examiner-row">
                                <td rowspan="2">${examinerName}</td>
                                <td rowspan="2">${data.room || 'N/A'}</td>`;
                
                // Slot 1 Row
                tableHTML += `<td class="period-row">${slot1.name}</td>
                            <td>${generateHalaqatList(slot1.halaqat)}</td>
                            <td>${slot1.student_count}</td></tr>`;
                
                // Slot 2 Row
                tableHTML += `<tr class="period-row">
                            <td>${slot2.name}</td>
                            <td>${generateHalaqatList(slot2.halaqat)}</td>
                            <td>${slot2.student_count}</td></tr>`;
            }
        }
        tableHTML += `</tbody></table>`;
        finalScheduleEl.innerHTML = tableHTML;
    }

    function generateHalaqatList(halaqat) {
        if (halaqat.length === 0) return '-';
        let listHTML = '<ul class="halaqat-list">';
        halaqat.forEach(h => {
            listHTML += `<li>${h[H_NAME]} (${h[H_STUDENTS]} طلاب) [${h[H_SIZE]}]</li>`;
        });
        listHTML += '</ul>';
        return listHTML;
    }

    function copyTableToClipboard() {
        const content = finalScheduleEl.innerHTML;
        if (!content || content === '---') {
            // alert('لا يوجد جدول لنسخه.'); // Removed alert
            return;
        }
        const blob = new Blob([content], { type: 'text/html' });
        const item = new ClipboardItem({ 'text/html': blob });
        navigator.clipboard.write([item]).then(() => {
            const originalButtonText = copyButton.querySelector('span').textContent;
            const originalButtonIcon = copyButton.querySelector('i').className;

            copyButton.querySelector('span').textContent = 'تم النسخ!';
            copyButton.querySelector('i').className = 'fas fa-check';
            copyButton.classList.add('success-animation'); // Add animation class

            setTimeout(() => {
                copyButton.querySelector('span').textContent = originalButtonText;
                copyButton.querySelector('i').className = originalButtonIcon;
                copyButton.classList.remove('success-animation'); // Remove animation class
            }, 2000); // Revert after 2 seconds
        }).catch(err => {
            console.error('Failed to copy: ', err);
            alert('فشل النسخ. يرجى محاولة النسخ واللصق يدويًا.'); // Keep alert for actual errors
        });
    }

    function readFileAsText(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsText(file, 'UTF-8'); }); }
    function parseCsv(csvText) { const lines = csvText.trim().split(/\r\n|\n/); const headers = lines[0].split(',').map(h => h.trim()); const rows = []; for (let i = 1; i < lines.length; i++) { const values = lines[i].split(',').map(v => v.trim()); if (values.length === headers.length) { const row = {}; headers.forEach((header, j) => { row[header] = values[j]; }); rows.push(row); } } return rows; }


    function checkFilesSelected() {
        const allFilesSelected = examinersFile.files.length > 0 && halaqatFile.files.length > 0 && roomsFile.files.length > 0;
        processButton.disabled = !allFilesSelected;
    }
 });
