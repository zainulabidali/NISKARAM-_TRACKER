import { db } from './firebase.js';
import { injectBottomNav } from './app.js';
import { collection, query, where, getDocs, setDoc, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

// Removed onAuthStateChanged to allow shared link bypass

let madrasaId = null;
let studentsData = {};
let subjectsList = [];
let booksList = [];

const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const PRAYER_SCORES = { "Jamaat": 2.0, "Individual": 1.0, "Qaza": 0.5, "Not Prayed": 0.0 };
let prayerSelections = { fajr: "", dhuhr: "", asr: "", maghrib: "", isha: "" };
let selectedDateStr = "";
let isSyncing = false;

// date utils
const offset = new Date().getTimezoneOffset() * 60000;
const todayStr = (new Date(Date.now() - offset)).toISOString().slice(0, 10);
const yday = new Date(Date.now() - offset);
yday.setDate(yday.getDate() - 1);
const yesterdayStr = yday.toISOString().slice(0, 10);

document.addEventListener('DOMContentLoaded', async () => {
    const activeParentId = sessionStorage.getItem('parentStudentId');
    const activeAdmission = sessionStorage.getItem('parentAdmissionNumber');
    madrasaId = sessionStorage.getItem('activeMadrasaId');

    // Dynamic Madrasa Name in header
    const cachedMadrasaName = localStorage.getItem('cachedMadrasaName') || 'Madrasa Tracker';
    const headerTitle = document.querySelector('.app-header h1');
    if (headerTitle) {
        headerTitle.innerHTML = `<i class="bi bi-clipboard-check-fill text-accent me-2"></i>${cachedMadrasaName.toUpperCase()}`;
    }

    injectBottomNav('tracker');

    setupNetworkStatus();
    syncOfflineRecords();
    setupDateToggle();
    setupSalawat();
    
    // Check if we have cached metadata to render the UI shell instantly
    const cachedStudentName = localStorage.getItem('cachedStudentName');
    const cachedClassName = localStorage.getItem('cachedClassName');

    if (activeParentId && activeAdmission && madrasaId && cachedStudentName) {
        // Render UI instantly from cache
        const trackerContainer = document.getElementById('trackerMainContainer');
        if (trackerContainer) trackerContainer.classList.remove('d-none');
        
        const selectEl = document.getElementById('studentSelect');
        if (selectEl) selectEl.value = activeParentId;
        
        document.getElementById('summaryName').innerText = cachedStudentName;
        document.getElementById('summaryClass').innerText = cachedClassName || 'Class';
        document.getElementById('summaryAvatar').innerText = cachedStudentName.charAt(0).toUpperCase();

        document.getElementById('summaryPoints').innerText = localStorage.getItem(`points_${activeParentId}`) || '0';
        document.getElementById('summarySalawat').innerText = localStorage.getItem(`salawat_${activeParentId}`) || '0';

        studentsData[activeParentId] = {
            name: cachedStudentName,
            classId: localStorage.getItem('cachedClassId'),
            madrasaId: madrasaId
        };

        renderPrayersForm();
        setupPrayerModal();

        // Load subjects and books from cache/fetch
        loadSubjects(localStorage.getItem('cachedClassId'));
        loadBooks();
        refreshStudentSummary(activeParentId);
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        const mParam = urlParams.get('m');
        if (mParam) {
            localStorage.setItem('activeMadrasaId', mParam);
            madrasaId = mParam;
        } else {
            madrasaId = localStorage.getItem('activeMadrasaId');
        }

        if (!madrasaId) {
            window.location.href = 'login.html';
            return;
        }

        setupSelectionModal();
        renderPrayersForm();
        setupPrayerModal();
    }

    // Bind View Report Button
    const btnReport = document.getElementById('btnViewReport');
    if (btnReport) {
        btnReport.addEventListener('click', () => {
            const sid = document.getElementById('studentSelect').value;
            if (sid) {
                // Redirect directly to the secure parent dashboard!
                window.location.href = `parent_dashboard.html`;
            } else {
                Swal.fire({
                    title: '⚠️ Verification Required',
                    text: "Please verify your Admission Number first.",
                    icon: 'warning',
                    confirmButtonColor: '#10b981',
                    customClass: { popup: 'rounded-4' }
                });
            }
        });
    }
});

let selectionModalInstance = null;
function setupSelectionModal() {
    selectionModalInstance = new bootstrap.Modal(document.getElementById('studentSelectionModal'));

    const btnVerify = document.getElementById('btnVerifyAdmission');
    if (btnVerify) {
        btnVerify.addEventListener('click', async () => {
            const inputVal = document.getElementById('parentAdmissionInput').value.trim();
            const errorMsg = document.getElementById('modalErrorMsg');
            
            if (!inputVal) {
                errorMsg.innerText = "Please enter an Admission Number.";
                errorMsg.classList.remove('d-none');
                return;
            }

            btnVerify.disabled = true;
            btnVerify.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> Checking...';
            errorMsg.classList.add('d-none');

            try {
                // Get institute ID from URL or active context
                const urlParams = new URLSearchParams(window.location.search);
                const urlInstituteId = urlParams.get('m') || urlParams.get('instituteId') || localStorage.getItem('activeMadrasaId');

                if (!urlInstituteId) {
                    throw new Error("Access denied. Please open the link shared by your Ustad/Madrasa.");
                }

                // 1. Validate Admission Number
                const lookupSnap = await getDoc(doc(db, "admission_numbers", inputVal));
                if (!lookupSnap.exists()) {
                    throw new Error("Admission Number Not Found");
                }

                const data = lookupSnap.data();

                // Validate if student belongs to the shared institute
                if (data.madrasaId !== urlInstituteId) {
                    throw new Error("Admission Number does not belong to this Madrasa.");
                }

                // 4. Save session context
                sessionStorage.setItem('parentStudentId', data.studentId);
                sessionStorage.setItem('parentAdmissionNumber', inputVal);
                sessionStorage.setItem('activeMadrasaId', data.madrasaId);
                madrasaId = data.madrasaId;

                // 5. Fetch student profile
                const stuSnap = await getDoc(doc(db, "students", data.studentId));
                let studentName = "";
                let classId = "";
                if (stuSnap.exists()) {
                    const sData = stuSnap.data();
                    studentsData[data.studentId] = sData;
                    studentName = sData.name || "Student";
                    classId = sData.classId || "";
                } else {
                    throw new Error("Student profile could not be found.");
                }

                // Fetch Class Name
                let className = "Class";
                if (classId) {
                    try {
                        const classSnap = await getDoc(doc(db, "classes", classId));
                        if (classSnap.exists()) {
                            className = classSnap.data().name || "Class";
                        }
                    } catch(e) { console.error(e); }
                }

                // Fetch Madrasa Name
                let madrasaName = "Madrasa Tracker";
                try {
                    const madrasaSnap = await getDoc(doc(db, "madrasas", data.madrasaId));
                    if (madrasaSnap.exists()) {
                        madrasaName = madrasaSnap.data().name || "Madrasa Tracker";
                    }
                } catch(e) { console.error(e); }

                // Cache metadata locally
                localStorage.setItem('cachedStudentId', data.studentId);
                localStorage.setItem('cachedStudentName', studentName);
                localStorage.setItem('cachedClassId', classId);
                localStorage.setItem('cachedClassName', className);
                localStorage.setItem('cachedMadrasaName', madrasaName);
                localStorage.setItem('activeMadrasaId', data.madrasaId);
                localStorage.setItem('cachedAdmissionNumber', inputVal);

                // Update Header Madrasa Name
                const headerTitle = document.querySelector('.app-header h1');
                if (headerTitle) {
                    headerTitle.innerHTML = `<i class="bi bi-clipboard-check-fill text-accent me-2"></i>${madrasaName.toUpperCase()}`;
                }

                // 6. Initialize tracker state
                document.getElementById('studentSelect').value = data.studentId;
                document.getElementById('summaryName').innerText = studentName;
                document.getElementById('summaryClass').innerText = className;
                document.getElementById('summaryAvatar').innerText = studentName.charAt(0).toUpperCase();
                
                // Hide modal and show tracker
                selectionModalInstance.hide();
                const trackerContainer = document.getElementById('trackerMainContainer');
                if (trackerContainer) trackerContainer.classList.remove('d-none');
                
                // Load child items
                loadSubjects(classId);
                loadBooks();
                refreshStudentSummary(data.studentId);

            } catch (err) {
                Swal.fire({
                    title: '❌ Invalid Admission Number',
                    text: err.message || "Please verify and try again.",
                    icon: 'error',
                    confirmButtonColor: '#ef4444',
                    customClass: { popup: 'rounded-4' }
                });
            } finally {
                btnVerify.disabled = false;
                btnVerify.innerHTML = 'View Record <i class="bi bi-arrow-right ms-1"></i>';
            }
        });
    }

    // Always show it on load to force selection flow
    selectionModalInstance.show();
}

function updateSyncStatusDisplay(forceState = null) {
    const statusEl = document.getElementById('syncStatus');
    if (!statusEl) return;

    if (!navigator.onLine) {
        statusEl.innerHTML = `
            <span class="badge bg-warning-subtle text-warning rounded-pill px-3 py-1 shadow-sm d-flex align-items-center gap-1">
                <i class="bi bi-wifi-off"></i> Offline Mode
            </span>
        `;
        return;
    }

    if (forceState) {
        if (forceState === 'syncing') {
            statusEl.innerHTML = `
                <span class="badge bg-info-subtle text-info rounded-pill px-3 py-1 shadow-sm d-flex align-items-center gap-1">
                    <span class="spinner-border spinner-border-sm" role="status" style="width: 10px; height: 10px;"></span> Syncing
                </span>
            `;
        } else if (forceState === 'failed') {
            statusEl.innerHTML = `
                <span class="badge bg-danger-subtle text-danger rounded-pill px-3 py-1 shadow-sm d-flex align-items-center gap-1">
                    <i class="bi bi-x-circle-fill"></i> Sync Failed
                </span>
            `;
        }
        return;
    }

    const offlineQueue = JSON.parse(localStorage.getItem('trackerData') || '[]');
    if (offlineQueue.length > 0) {
        statusEl.innerHTML = `
            <span class="badge bg-warning-subtle text-warning rounded-pill px-3 py-1 shadow-sm d-flex align-items-center gap-1">
                <i class="bi bi-exclamation-circle-fill"></i> Pending Sync (${offlineQueue.length})
            </span>
        `;
    } else {
        statusEl.innerHTML = `
            <span class="badge bg-success-subtle text-success rounded-pill px-3 py-1 shadow-sm d-flex align-items-center gap-1">
                <i class="bi bi-check-circle-fill"></i> Synced
            </span>
        `;
    }
}

function setupNetworkStatus() {
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true
    });

    const updateOnlineStatus = () => {
        updateSyncStatusDisplay();
        if (navigator.onLine) {
            Toast.fire({
                icon: 'success',
                title: 'Connected to Internet'
            });
            syncOfflineRecords();
        } else {
            Toast.fire({
                icon: 'warning',
                title: 'Offline Mode Activated'
            });
        }
    };
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
}

async function loadSubjects(classId) {
    const container = document.getElementById('subjectsContainer');
    if (!classId) return;
    const q = query(collection(db, "subjects"), where("madrasaId", "==", madrasaId), where("classId", "==", classId));
    try {
        const snap = await getDocs(q);
        subjectsList = [];
        snap.forEach(d => subjectsList.push({ id: d.id, name: d.data().name }));

        if (subjectsList.length === 0) {
            container.innerHTML = '<p class="text-muted small">No subjects found for class.</p>';
        } else {
            container.innerHTML = subjectsList.map(s => `
             <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom border-light">
                 <span class="fw-bold fs-6">${s.name}</span>
                 <input type="checkbox" class="btn-check subject-checkbox" id="subject_${s.id}" value="${s.id}" autocomplete="off">
                 <label class="btn btn-outline-success fw-bold rounded-pill px-4 btn-sm" for="subject_${s.id}"><i class="bi bi-check-lg me-1"></i> Studied</label>
             </div>
          `).join('');
        }
    } catch (err) {
        container.innerHTML = '<p class="text-danger small">Error loading subjects (offline).</p>';
    }

    // Add listeners for real-time progress update
    document.querySelectorAll('.subject-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const subjectScore = document.querySelectorAll('.subject-checkbox:checked').length;
            updateProgress(0, subjectScore, subjectsList.length);
        });
    });
}

async function loadBooks() {
    const container = document.getElementById('booksContainer');
    const q = query(collection(db, "books"), where("madrasaId", "==", madrasaId));
    try {
        const snap = await getDocs(q);
        booksList = [];
        snap.forEach(d => booksList.push({ id: d.id, name: d.data().name }));

        if (booksList.length > 0) {
            document.getElementById('booksCard').style.display = 'block';
            container.innerHTML = booksList.map(s => `
             <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom border-light">
                 <span class="fw-bold fs-6">${s.name}</span>
                 <input type="checkbox" class="btn-check book-checkbox" id="book_${s.id}" value="${s.id}" autocomplete="off">
                 <label class="btn btn-outline-info text-dark fw-bold rounded-pill px-4 btn-sm" for="book_${s.id}"><i class="bi bi-bookmark-check me-1"></i> Read</label>
             </div>
          `).join('');
        }
    } catch (err) {
        console.log('Books offline or missing', err);
    }
}

function setupDateToggle() {
    selectedDateStr = todayStr;
    document.getElementById('selectedDateDisplay').innerText = new Date(selectedDateStr).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    document.getElementById('btnToday').addEventListener('click', (e) => {
        document.getElementById('btnToday').classList.add('active', 'bg-white', 'shadow-sm', 'text-dark');
        document.getElementById('btnToday').classList.remove('text-muted');
        document.getElementById('btnYesterday').classList.remove('active', 'bg-white', 'shadow-sm', 'text-dark');
        document.getElementById('btnYesterday').classList.add('text-muted');

        selectedDateStr = todayStr;
        const dateDisplay = document.getElementById('selectedDateDisplay');
        if (dateDisplay) dateDisplay.innerText = new Date(selectedDateStr).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const selectEl = document.getElementById('studentSelect');
        if (selectEl && selectEl.value) refreshStudentSummary(selectEl.value);
    });

    document.getElementById('btnYesterday').addEventListener('click', (e) => {
        document.getElementById('btnYesterday').classList.add('active', 'bg-white', 'shadow-sm', 'text-dark');
        document.getElementById('btnYesterday').classList.remove('text-muted');
        document.getElementById('btnToday').classList.remove('active', 'bg-white', 'shadow-sm', 'text-dark');
        document.getElementById('btnToday').classList.add('text-muted');

        selectedDateStr = yesterdayStr;
        const dateDisplay = document.getElementById('selectedDateDisplay');
        if (dateDisplay) dateDisplay.innerText = new Date(selectedDateStr).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const selectEl = document.getElementById('studentSelect');
        if (selectEl && selectEl.value) refreshStudentSummary(selectEl.value);
    });
}

function loadRecordDataIntoForm(r) {
    if (r.prayers) {
        prayerSelections.fajr = r.prayers.fajr || "";
        prayerSelections.dhuhr = r.prayers.dhuhr || "";
        prayerSelections.asr = r.prayers.asr || "";
        prayerSelections.maghrib = r.prayers.maghrib || "";
        prayerSelections.isha = r.prayers.isha || "";
    }
    if (r.subjects && r.subjects.length > 0) {
        r.subjects.forEach(subId => {
            const cb = document.getElementById(`subject_${subId}`);
            if (cb) cb.checked = true;
        });
    }
    if (r.books && r.books.length > 0) {
        r.books.forEach(bookId => {
            const cb = document.getElementById(`book_${bookId}`);
            if (cb) cb.checked = true;
        });
    }
    if (r.salawatCount !== undefined) {
        if (document.getElementById('salawatCount')) document.getElementById('salawatCount').value = r.salawatCount;
        if (document.getElementById('salawatDisplay')) document.getElementById('salawatDisplay').innerText = r.salawatCount;
    }
}

function calculateStreak(records) {
    if (!records || records.length === 0) return 0;
    const dates = records.map(r => r.date).sort();
    const uniqueDates = Array.from(new Set(dates));
    
    let streak = 0;
    let today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    let checkDate = new Date(today.getTime() - offset);
    
    while (true) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (uniqueDates.includes(dateStr)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            // Allow active streak if yesterday was logged and today is still pending
            if (streak === 0 && dateStr === new Date(today.getTime() - offset).toISOString().split('T')[0]) {
                checkDate.setDate(checkDate.getDate() - 1);
                continue;
            }
            break;
        }
    }
    return streak;
}

async function loadTotalsInBackground(studentId) {
    let totalScore = 0;
    let totalSalawat = 0;

    try {
        const q = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("studentId", "==", studentId));
        const snap = await getDocs(q);
        const records = [];
        
        snap.forEach(d => {
            const r = d.data();
            records.push(r);
            totalScore += (Number(r.totalScore) || 0);
            totalSalawat += (Number(r.salawatCount) || 0);
        });

        totalScore = parseFloat(totalScore.toFixed(1));

        // Update UI
        const pointsEl = document.getElementById('summaryPoints');
        const salawatEl = document.getElementById('summarySalawat');
        if (pointsEl) pointsEl.innerText = totalScore;
        if (salawatEl) salawatEl.innerText = totalSalawat;

        // Cache in localStorage
        localStorage.setItem(`points_${studentId}`, totalScore);
        localStorage.setItem(`salawat_${studentId}`, totalSalawat);
        localStorage.setItem(`days_${studentId}`, snap.size);

        // Calculate and cache streak
        const streak = calculateStreak(records);
        localStorage.setItem(`streak_${studentId}`, streak);

    } catch (err) {
        console.error("Failed to load background totals:", err);
    }
}

async function refreshStudentSummary(studentId) {
    const student = studentsData[studentId];
    if (!student) return;

    // Reset all tracking states to Neutral/0 before loading
    prayerSelections = { fajr: "", dhuhr: "", asr: "", maghrib: "", isha: "" };
    document.querySelectorAll('.subject-checkbox:checked, .book-checkbox:checked').forEach(cb => cb.checked = false);
    if (document.getElementById('salawatCount')) document.getElementById('salawatCount').value = 0;
    if (document.getElementById('salawatDisplay')) document.getElementById('salawatDisplay').innerText = 0;

    let prayersToday = 0;
    let studyToday = 0;

    const recordId = `${studentId}_${selectedDateStr}`;
    
    // Check if there is any offline unsynced record in localStorage for this date
    const offlineRecords = JSON.parse(localStorage.getItem('trackerData') || '[]');
    const localRec = offlineRecords.find(r => r._id === recordId || (r.studentId === studentId && r.date === selectedDateStr));

    if (localRec) {
        loadRecordDataIntoForm(localRec);
        prayersToday = Number(localRec.prayerScore) || 0;
        studyToday = Number(localRec.subjectScore) || 0;
    } else {
        try {
            const docSnap = await getDoc(doc(db, "records", recordId));
            if (docSnap.exists()) {
                const r = docSnap.data();
                loadRecordDataIntoForm(r);
                prayersToday = Number(r.prayerScore) || 0;
                studyToday = Number(r.subjectScore) || 0;
            }
        } catch (err) {
            if (err.code !== 'permission-denied') {
                console.error("Offline or error loading selected date record:", err);
            }
        }
    }

    // Trigger Dynamic Progress Updates for today
    updateProgress(prayersToday, studyToday, subjectsList.length);
    renderPrayersForm();

    // Load subjects for student class
    loadSubjects(student.classId);

    // Asynchronously fetch and update background statistics to prevent load blocking
    loadTotalsInBackground(studentId);
}

function setupSalawat() {
    const display = document.getElementById('salawatDisplay');
    const hiddenInput = document.getElementById('salawatCount');

    function updateDisplay() {
        display.innerText = parseInt(hiddenInput.value) || 0;
    }


    // Manual add button
    document.getElementById('salawatManualAddBtn').addEventListener('click', () => {
        const manual = parseInt(document.getElementById('salawatManual').value) || 0;
        if (manual > 0) {
            hiddenInput.value = (parseInt(hiddenInput.value) || 0) + manual;
            document.getElementById('salawatManual').value = '';
            updateDisplay();
        }
    });
}

function renderPrayersForm() {
    const container = document.getElementById('prayersContainer');

    const getBtnProps = (status, prayer) => {
        let bg = 'bg-light text-dark border';
        let iconColor = 'text-primary';

        if (status === 'Jamaat') {
            bg = 'bg-success text-white border-success';
            iconColor = 'text-white';
        } else if (status === 'Individual') {
            bg = 'bg-warning text-dark border-warning';
            iconColor = 'text-dark';
        } else if (status === 'Qaza') {
            bg = 'bg-info text-white border-info';
            iconColor = 'text-white';
        } else if (status === 'Not Prayed') {
            bg = 'bg-danger text-white border-danger';
            iconColor = 'text-white';
        } else if (status === '') {
            bg = 'bg-light text-dark border'; // Default neutral state
            iconColor = 'text-muted'; // Neutral icon
        }

        let pIcon = 'bi-sun';
        if (prayer === 'fajr') pIcon = 'bi-sunrise';
        if (prayer === 'asr') pIcon = 'bi-cloud-sun';
        if (prayer === 'maghrib') pIcon = 'bi-sunset';
        if (prayer === 'isha') pIcon = 'bi-moon';

        return { bg, pIcon, iconColor };
    };

    container.innerHTML = PRAYERS.map(p => {
        const lowerP = p.toLowerCase();
        // Use an empty string if null/undefined, instead of defaulting to "Jamaat"
        const props = getBtnProps(prayerSelections[lowerP] || "", lowerP);
        return `
            <div class="text-center d-flex flex-column align-items-center" style="min-width: 60px;">
                <button type="button" class="btn ${props.bg} shadow-sm rounded-4 p-3 mb-1 prayer-trigger-btn d-flex align-items-center justify-content-center" 
                        data-prayer="${lowerP}" style="width: 50px; height: 50px;">
                    <i class="bi ${props.pIcon} ${props.iconColor} fs-4"></i>
                </button>
                <span class="small fw-bold text-muted" style="font-size: 0.7rem;">${p}</span>
            </div>
       `;
    }).join('');

    document.querySelectorAll('.prayer-trigger-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const prayer = e.currentTarget.dataset.prayer;
            document.getElementById('activePrayerContext').value = prayer;
            document.getElementById('prayerModalTitle').innerText = prayer.charAt(0).toUpperCase() + prayer.slice(1) + " Prayer";
            const modal = new bootstrap.Modal(document.getElementById('prayerModal'));
            modal.show();
        });
    });
}

function setupPrayerModal() {
    document.querySelectorAll('.prayer-option-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const status = e.currentTarget.dataset.status;
            const activePrayer = document.getElementById('activePrayerContext').value;

            prayerSelections[activePrayer] = status;
            
            // visually update the button
            renderPrayersForm();

            // Update real-time progress
            const subjectScore = document.querySelectorAll('.subject-checkbox:checked').length;
            updateProgress(0, subjectScore, subjectsList.length);

            const modalEl = document.getElementById('prayerModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
        });
    });
}

document.getElementById('trackerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';

    const selectEl = document.getElementById('studentSelect');
    const studentId = selectEl ? selectEl.value : null;

    if (!studentId || !studentsData[studentId]) {
        Swal.fire({
            title: '⚠️ Student Required',
            text: "Wait, please select a student first.",
            icon: 'warning',
            confirmButtonColor: '#10b981',
            customClass: { popup: 'rounded-4' }
        });
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        return;
    }

    // Phase 7: Warn if any prayer is missing status selection
    const missingPrayers = Object.keys(prayerSelections).filter(k => prayerSelections[k] === "");
    if (missingPrayers.length > 0) {
        Swal.fire({
            title: '⚠️ Missing Prayer Selection',
            text: "Please select prayer status before submitting.",
            icon: 'warning',
            confirmButtonColor: '#10b981',
            customClass: { popup: 'rounded-4' }
        });
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        return;
    }

    const classId = studentsData[studentId].classId;

    const cleanedPrayers = {};
    for (const key in prayerSelections) {
        if (prayerSelections[key]) {
            cleanedPrayers[key] = prayerSelections[key];
        }
    }

    let prayerScore = 0;
    for (const key in cleanedPrayers) {
        prayerScore += PRAYER_SCORES[cleanedPrayers[key]] || 0;
    }
    prayerScore = parseFloat(prayerScore.toFixed(1));

    let subjectScore = 0;
    let subjectData = [];
    document.querySelectorAll('.subject-checkbox:checked').forEach(cb => {
        subjectScore += 1;
        subjectData.push(cb.value);
    });

    let booksData = [];
    document.querySelectorAll('.book-checkbox:checked').forEach(cb => {
        booksData.push(cb.value);
    });

    const salawatCount = parseInt(document.getElementById('salawatCount').value) || 0;
    const totalScore = parseFloat((prayerScore + subjectScore).toFixed(1));

    const recordId = `${studentId}_${selectedDateStr}`;

    const record = {
        madrasaId,
        studentId,
        classId,
        date: selectedDateStr,
        prayers: cleanedPrayers,
        subjectScore,
        prayerScore,
        totalScore,
        salawatCount,
        subjects: subjectData,
        books: booksData,
        timestamp: new Date().toISOString()
    };

    let trackerDataArr = JSON.parse(localStorage.getItem('trackerData') || '[]');
    trackerDataArr = trackerDataArr.filter(r => r._id !== recordId);
    trackerDataArr.push({ ...record, _id: recordId });
    localStorage.setItem('trackerData', JSON.stringify(trackerDataArr));
    
    updateSyncStatusDisplay('syncing');

    if (navigator.onLine) {
        try {
            await setDoc(doc(db, "records", recordId), record, { merge: true });
            
            // Remove from local queue
            let currentOffline = JSON.parse(localStorage.getItem('trackerData') || '[]');
            currentOffline = currentOffline.filter(r => r._id !== recordId);
            localStorage.setItem('trackerData', JSON.stringify(currentOffline));

            updateSyncStatusDisplay();

            // Fire detailed success animations and toasts (Phase 5 & 8)
            const isFullCompletion = Object.values(cleanedPrayers).filter(val => val === 'Jamaat' || val === 'Individual' || val === 'Qaza').length === 5;
            let achievementHtml = "";
            if (isFullCompletion) {
                achievementHtml += `
                    <div class="badge bg-success-subtle text-success rounded-pill px-3 py-1 mt-2 shadow-sm d-inline-flex align-items-center gap-1">
                        🏆 Full Prayer Completion
                    </div>
                `;
            } else {
                achievementHtml += `
                    <div class="badge bg-primary-subtle text-primary rounded-pill px-3 py-1 mt-2 shadow-sm d-inline-flex align-items-center gap-1">
                        🌟 Daily Log Registered
                    </div>
                `;
            }

            const currentStreak = parseInt(localStorage.getItem(`streak_${studentId}`)) || 0;
            if (currentStreak > 0) {
                achievementHtml += `
                    <div class="mt-3 text-center text-muted small fw-bold">
                        🔥 Streak: <span class="text-danger">${currentStreak + 1} Days</span>
                    </div>
                `;
            }

            Swal.fire({
                title: '🎉 Congratulations!',
                html: `
                    <p class="fs-5 fw-semibold text-success mb-2">Prayer Record Saved</p>
                    <p class="text-muted small">Your daily prayer tracking has been registered.</p>
                    <div class="d-flex justify-content-around p-3 bg-light rounded-3 mt-3 border">
                        <div>
                            <span class="d-block text-muted small text-uppercase fw-bold" style="font-size: 0.65rem;">Points Earned</span>
                            <span class="fs-4 fw-bold text-success">${totalScore}</span>
                        </div>
                        <div style="width: 1px; background-color: #e2e8f0;"></div>
                        <div>
                            <span class="d-block text-muted small text-uppercase fw-bold" style="font-size: 0.65rem;">Salawat Count</span>
                            <span class="fs-4 fw-bold text-primary">${salawatCount}</span>
                        </div>
                    </div>
                    <div class="text-center mt-3">${achievementHtml}</div>
                `,
                icon: 'success',
                confirmButtonText: 'Continue',
                confirmButtonColor: '#10b981',
                customClass: { popup: 'rounded-4 border-0 shadow-lg' },
                timer: 4500,
                timerProgressBar: true
            });

            refreshStudentSummary(studentId);
        } catch (err) {
            updateSyncStatusDisplay('failed');
            Swal.fire({
                title: '⚠️ Save Warning',
                text: "Error saving online. Saved locally: " + err.message,
                icon: 'warning',
                confirmButtonColor: '#10b981',
                customClass: { popup: 'rounded-4' }
            });
        }
    } else {
        updateSyncStatusDisplay();
        Swal.fire({
            title: '📶 Saved Offline',
            text: "Your record is saved locally and will sync automatically when internet returns.",
            icon: 'info',
            confirmButtonColor: '#10b981',
            customClass: { popup: 'rounded-4' }
        });
        refreshStudentSummary(studentId);
    }

    btn.disabled = false;
    btn.innerHTML = originalHtml;
});

async function updateProgress(prayerScore, subjectScore, totalSubjects) {
    const maxPrayers = 10; // 5 prayers * 2 pts max each (Jamaat)
    // Actually the user said: "There are 5 daily prayers. Prayer progress = (completed prayers / 5) * 100"
    // And "Total progress = (prayerScore + subjectScore) / (5 + totalSubjects) * 100"
    // Wait, the calculation rules in the prompt:
    // Prayers: (completed prayers / 5) * 100
    // Study: (subjects studied / total subjects) * 100
    // Total: (completed prayers + subjectScore) / (5 + totalSubjects) * 100
    // Wait, the example for Total says: "Total = (prayerScore + subjectScore) / (5 + totalSubjects) * 100"
    // where PrayerScore = 3, SubjectScore = 2, TotalSubjects = 4 -> 5/9 = 55%.
    // In the example, prayerScore seems to be the "count" of completed prayers, not the points.
    
    const countCompletedPrayers = Object.values(prayerSelections).filter(s => s === 'Jamaat' || s === 'Individual' || s === 'Qaza').length;
    
    const pPct = Math.round((countCompletedPrayers / 5) * 100);
    const sPct = totalSubjects > 0 ? Math.round((subjectScore / totalSubjects) * 100) : 0;
    const tPct = Math.round(((countCompletedPrayers + subjectScore) / (5 + totalSubjects)) * 100);

    const progPrayers = document.getElementById('progPrayers');
    if (progPrayers) {
        progPrayers.style.background = `conic-gradient(#3b82f6 ${pPct}%, #e5e7eb 0)`;
        progPrayers.innerText = `${pPct}%`;
    }

    const progStudy = document.getElementById('progStudy');
    if (progStudy) {
        progStudy.style.background = `conic-gradient(#f59e0b ${sPct}%, #e5e7eb 0)`;
        progStudy.innerText = `${sPct}%`;
    }

    const progTotal = document.querySelector('.progress-circle.text-success');
    if (progTotal) {
        progTotal.style.background = `conic-gradient(#10b981 ${tPct}%, #e5e7eb 0)`;
        progTotal.innerText = `${tPct}%`;
    }
}

async function syncOfflineRecords() {
    if (isSyncing) return;
    isSyncing = true;
    updateSyncStatusDisplay('syncing');

    try {
        let offline = JSON.parse(localStorage.getItem('trackerData') || '[]');
        let legacy = JSON.parse(localStorage.getItem('offlinePrayerRecords') || '[]');
        
        // Merge legacy records if any exist
        if (legacy && Array.isArray(legacy) && legacy.length > 0) {
            legacy.forEach(rec => {
                const rId = rec._id || `${rec.studentId}_${rec.date}`;
                if (rId && !offline.some(o => (o._id === rId || (o.studentId === rec.studentId && o.date === rec.date)))) {
                    offline.push({ ...rec, _id: rId });
                }
            });
        }

        if (offline.length === 0) {
            localStorage.removeItem('trackerData');
            localStorage.removeItem('offlinePrayerRecords');
            updateSyncStatusDisplay();
            return;
        }

        let remaining = [];
        for (let i = 0; i < offline.length; i++) {
            const id = offline[i]._id || `${offline[i].studentId}_${offline[i].date}`;
            const rec = { ...offline[i] };
            delete rec._id; // strip internal mapping

            try {
                await setDoc(doc(db, "records", id), rec, { merge: true });
                console.log("Synced offline record: " + id);
            } catch (err) {
                console.error("Failed to sync", err);
                remaining.push(offline[i]);
            }
        }

        if (remaining.length === 0) {
            localStorage.removeItem('trackerData');
            localStorage.removeItem('offlinePrayerRecords');
        } else {
            localStorage.setItem('trackerData', JSON.stringify(remaining));
            localStorage.removeItem('offlinePrayerRecords');
        }
        updateSyncStatusDisplay();
    } catch (err) {
        console.error("Offline sync error", err);
        updateSyncStatusDisplay('failed');
    } finally {
        isSyncing = false;
    }
}
