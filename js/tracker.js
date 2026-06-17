import { db } from './firebase.js';
import { injectBottomNav } from './app.js';
import { collection, query, where, getDocs, setDoc, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

// Removed onAuthStateChanged to allow shared link bypass

let madrasaId = null;
let studentsData = {};
let subjectsList = [];
let booksList = [];

const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const PRAYER_SCORES = { "Jamaat": 2, "Individual": 1, "Not Prayed": 0 };
let prayerSelections = { fajr: "", dhuhr: "", asr: "", maghrib: "", isha: "" };
let selectedDateStr = "";

// date utils
const offset = new Date().getTimezoneOffset() * 60000;
const todayStr = (new Date(Date.now() - offset)).toISOString().slice(0, 10);
const yday = new Date(Date.now() - offset);
yday.setDate(yday.getDate() - 1);
const yesterdayStr = yday.toISOString().slice(0, 10);

document.addEventListener('DOMContentLoaded', async () => {
    // If a parent is already logged in
    const activeParentId = sessionStorage.getItem('parentStudentId');
    const activeAdmission = sessionStorage.getItem('parentAdmissionNumber');
    madrasaId = sessionStorage.getItem('activeMadrasaId');

    injectBottomNav('tracker');

    setupNetworkStatus();
    syncOfflineRecords();
    setupDateToggle();
    setupSalawat();
    renderPrayersForm();
    setupPrayerModal();

    if (activeParentId && activeAdmission && madrasaId) {
        // Fetch specific student profile and refresh tracker directly
        try {
            const stuSnap = await getDoc(doc(db, "students", activeParentId));
            if (stuSnap.exists()) {
                studentsData[activeParentId] = stuSnap.data();
                document.getElementById('studentSelect').value = activeParentId;
                const trackerContainer = document.getElementById('trackerMainContainer');
                if (trackerContainer) trackerContainer.classList.remove('d-none');
                
                await refreshStudentSummary(activeParentId);
                await loadBooks();
            } else {
                // If student no longer exists, clear session and show modal
                sessionStorage.clear();
                setupSelectionModal();
            }
        } catch(err) {
            console.error("Offline or error loading saved student", err);
            // Show modal if check fails
            setupSelectionModal();
        }
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
                alert("Please verify your Admission Number first.");
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
                if (stuSnap.exists()) {
                    studentsData[data.studentId] = stuSnap.data();
                } else {
                    throw new Error("Student profile could not be found.");
                }

                // 6. Initialize tracker state
                document.getElementById('studentSelect').value = data.studentId;
                
                // Hide modal and show tracker
                selectionModalInstance.hide();
                const trackerContainer = document.getElementById('trackerMainContainer');
                if (trackerContainer) trackerContainer.classList.remove('d-none');
                
                // Load child items
                refreshStudentSummary(data.studentId);
                loadBooks();

            } catch (err) {
                errorMsg.innerText = err.message || "Invalid Admission Number";
                errorMsg.classList.remove('d-none');
            } finally {
                btnVerify.disabled = false;
                btnVerify.innerHTML = 'View Record <i class="bi bi-arrow-right ms-1"></i>';
            }
        });
    }

    // Always show it on load to force selection flow
    selectionModalInstance.show();
}

function setupNetworkStatus() {
    const statusEl = document.getElementById('syncStatus');
    const updateOnlineStatus = () => {
        if (navigator.onLine) {
            statusEl.innerHTML = '<i class="bi bi-wifi text-white me-1"></i> Online';
            syncOfflineRecords();
        } else {
            statusEl.innerHTML = '<i class="bi bi-wifi-off text-warning me-1"></i> Offline Mode';
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

async function refreshStudentSummary(studentId) {
    const student = studentsData[studentId];
    if (!student) return;

    // Set Meta
    document.getElementById('summaryName').innerText = student.name;
    document.getElementById('summaryAvatar').innerText = student.name.charAt(0).toUpperCase();

    // Find class
    let className = 'Class';
    if (student.classId) {
        try {
            const classDoc = await getDoc(doc(db, "classes", student.classId));
            if (classDoc.exists()) {
                className = classDoc.data().name || 'Class';
            }
        } catch(e) { console.error("Error fetching class name:", e); }
    }
    document.getElementById('summaryClass').innerText = className;

    // Load Records to calculate points
    let totalScore = 0;
    let totalSalawat = 0;
    let prayersToday = 0;
    let studyToday = 0;

    // Reset all tracking states to Neutral/0 before loading
    prayerSelections = { fajr: "", dhuhr: "", asr: "", maghrib: "", isha: "" };
    
    document.querySelectorAll('.subject-checkbox:checked, .book-checkbox:checked').forEach(cb => cb.checked = false);
    
    if (document.getElementById('salawatCount')) {
        document.getElementById('salawatCount').value = 0;
    }
    if (document.getElementById('salawatDisplay')) {
        document.getElementById('salawatDisplay').innerText = 0;
    }

    const q = query(collection(db, "records"), where("studentId", "==", studentId));
    try {
        const snap = await getDocs(q);
        snap.forEach(d => {
            const r = d.data();
            totalScore += (Number(r.totalScore) || 0);
            totalSalawat += (Number(r.salawatCount) || 0);

            if (r.date === selectedDateStr) {
                prayersToday = Number(r.prayerScore) || 0;
                studyToday = Number(r.subjectScore) || 0;
                
                // Update prayerSelections with previously saved data
                if (r.prayers) {
                    prayerSelections.fajr = r.prayers.fajr || "";
                    prayerSelections.dhuhr = r.prayers.dhuhr || "";
                    prayerSelections.asr = r.prayers.asr || "";
                    prayerSelections.maghrib = r.prayers.maghrib || "";
                    prayerSelections.isha = r.prayers.isha || "";
                }

                // Update Subjects
                if (r.subjects && r.subjects.length > 0) {
                    r.subjects.forEach(subId => {
                        const cb = document.getElementById(`subject_${subId}`);
                        if (cb) cb.checked = true;
                    });
                }

               
               

                // Update Salawat
                if (r.salawatCount !== undefined) {
                    if (document.getElementById('salawatCount')) document.getElementById('salawatCount').value = r.salawatCount;
                    if (document.getElementById('salawatDisplay')) document.getElementById('salawatDisplay').innerText = r.salawatCount;
                }
            }
        });
    } catch (err) {
        console.log('offline/failed summary load');
    }

    document.getElementById('summaryPoints').innerText = totalScore;
    document.getElementById('summarySalawat').innerText = totalSalawat;

    document.getElementById('summaryPoints').innerText = totalScore;
    document.getElementById('summarySalawat').innerText = totalSalawat;

    // Trigger Dynamic Progress Updates
    updateProgress(prayersToday, studyToday, subjectsList.length);

    // Visually update prayer UI
    renderPrayersForm();

    // Load subjects for THIS student's class
    loadSubjects(student.classId);
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
        alert("Wait, please select a student first.");
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
    
    // We still calculate the score using cleanedPrayers to ignore empty states
    for (const key in cleanedPrayers) {
        prayerScore += PRAYER_SCORES[cleanedPrayers[key]] || 0;
    }

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
    const totalScore = prayerScore + subjectScore;

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
    // remove any existing local record for the same id to avoid duplication in local offline queue
    trackerDataArr = trackerDataArr.filter(r => r._id !== recordId);
    trackerDataArr.push({ ...record, _id: recordId });
    localStorage.setItem('trackerData', JSON.stringify(trackerDataArr));

    if (navigator.onLine) {
        try {
            await setDoc(doc(db, "records", recordId), record, { merge: true });
            alert("Record saved successfully!");
            
            // Remove from local queue since it's now online
            let currentOffline = JSON.parse(localStorage.getItem('trackerData') || '[]');
            currentOffline = currentOffline.filter(r => r._id !== recordId);
            localStorage.setItem('trackerData', JSON.stringify(currentOffline));

            // Refresh logic already clears out and sets proper values
            refreshStudentSummary(studentId);
        } catch (err) {
            alert("Error saving online. Saved locally: " + err.message);
        }
    } else {
        alert("Saved offline. Will sync when internet returns.");
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
    
    const countCompletedPrayers = Object.values(prayerSelections).filter(s => s === 'Jamaat' || s === 'Individual').length;
    
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
    let offline = JSON.parse(localStorage.getItem('trackerData') || '[]');
    if (offline.length === 0) return;

    let remaining = [];
    for (let i = 0; i < offline.length; i++) {
        const id = offline[i]._id;
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
    }
}
