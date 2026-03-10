import { db } from './firebase.js';
import { injectBottomNav } from './app.js';
import { collection, query, where, getDocs, setDoc, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

let madrasaId = null;
let studentsData = {};
let subjectsList = [];
let booksList = [];

const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const PRAYER_SCORES = { "Jamaat": 2, "Individual": 1, "Not Prayed": 0 };
let prayerSelections = { fajr: "Jamaat", dhuhr: "Jamaat", asr: "Jamaat", maghrib: "Jamaat", isha: "Jamaat" };
let selectedDateStr = "";

// date utils
const offset = new Date().getTimezoneOffset() * 60000;
const todayStr = (new Date(Date.now() - offset)).toISOString().slice(0, 10);
const yday = new Date(Date.now() - offset);
yday.setDate(yday.getDate() - 1);
const yesterdayStr = yday.toISOString().slice(0, 10);

document.addEventListener('DOMContentLoaded', async () => {
    injectBottomNav('tracker');

    const urlParams = new URLSearchParams(window.location.search);
    const mParam = urlParams.get('m');

    if (mParam) {
        localStorage.setItem('activeMadrasaId', mParam);
        madrasaId = mParam;
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        madrasaId = localStorage.getItem('activeMadrasaId');
    }

    if (!madrasaId) {
        // Show friendly message — tracker requires a madrasa context
        document.getElementById('classSelect').innerHTML = '<option>— No Madrasa —</option>';
        document.getElementById('classSelect').disabled = true;
        const selectEl = document.getElementById('studentSelect');
        if (selectEl && !selectEl.value) {
            document.getElementById('studentSelect').disabled = true;
        }

        const trackerForm = document.getElementById('trackerForm');
        if (trackerForm) trackerForm.classList.add('d-none');

        const notice = document.createElement('div');
        notice.className = 'alert alert-light border shadow-sm text-center text-muted fw-bold mt-3';
        notice.innerHTML = '<i class="bi bi-person-lock me-2"></i>Please use the Madrasa Link provided by your admin.';
        document.querySelector('.container')?.prepend(notice);
        return;
    }

    // Check active status to be safe
    try {
        const docSnap = await getDoc(doc(db, "madrasas", madrasaId));
        if (docSnap.exists() && docSnap.data().status !== 'active') {
            alert("This Madrasa's subscription is inactive.");
            return;
        }
    } catch (e) { /* ignore offline read errors for this check */ }

    setupNetworkStatus();
    syncOfflineRecords();

    setupDateToggle();

    await loadClasses();
    await loadStudents();
    await loadSubjects();
    await loadBooks();

    setupSalawat();
    renderPrayersForm();
    setupPrayerModal();
    restoreSelections();

    // Initialize Modal setup if no student is selected yet
    setupSelectionModal();
});

let selectionModalInstance = null;
function setupSelectionModal() {
    selectionModalInstance = new bootstrap.Modal(document.getElementById('studentSelectionModal'));

    // Bind Continue Button
    const btnContinue = document.getElementById('btnContinueTracker');
    if (btnContinue) {
        btnContinue.addEventListener('click', () => {
            const selectEl = document.getElementById('studentSelect');
            if (selectEl && selectEl.value) {
                selectionModalInstance.hide();
                const trackerContainer = document.getElementById('trackerMainContainer');
                if (trackerContainer) trackerContainer.classList.remove('d-none');
                refreshStudentSummary(selectEl.value);
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

async function loadClasses() {
    const selectModal = document.getElementById('classSelectModal');
    const q = query(collection(db, "classes"), where("madrasaId", "==", madrasaId));
    try {
        const snap = await getDocs(q);
        snap.forEach(d => {
            selectModal.innerHTML += `<option value="${d.id}">${d.data().name}</option>`;
        });
    } catch (err) {
        console.error("Classes load error", err);
    }

    selectModal.addEventListener('change', (e) => {
        localStorage.setItem("selectedClass", e.target.value);
        populateStudentsDropdown(e.target.value);
    });
}

async function loadStudents() {
    const q = query(collection(db, "students"), where("madrasaId", "==", madrasaId));
    try {
        const snap = await getDocs(q);
        snap.forEach(d => {
            studentsData[d.id] = d.data();
        });
    } catch (err) {
        console.error(err);
    }
}

async function loadSubjects() {
    const container = document.getElementById('subjectsContainer');
    const q = query(collection(db, "subjects"), where("madrasaId", "==", madrasaId));
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

function populateStudentsDropdown(classId) {
    const container = document.getElementById('studentCardsContainerModal');
    const badge = document.getElementById('studentCountBadgeModal');
    const hiddenSelect = document.getElementById('studentSelect');
    const continueBtn = document.getElementById('btnContinueTracker');

    if (container) container.innerHTML = '';
    if (hiddenSelect) hiddenSelect.value = '';
    if (continueBtn) continueBtn.classList.add('d-none');

    if (!classId) {
        if (badge) badge.innerText = "0";
        if (container) container.innerHTML = '<div class="text-muted small p-4 text-center bg-white shadow-sm rounded-4 border border-light">Please select a class first.</div>';
        return;
    }

    let count = 0;
    Object.keys(studentsData).forEach(id => {
        if (studentsData[id].classId === classId) {
            count++;
            const name = studentsData[id].name;
            const letter = name.charAt(0).toUpperCase();

            const card = document.createElement('div');
            card.className = "card border border-light shadow-sm rounded-4 text-start student-card bg-white";
            card.style.cursor = "pointer";
            card.dataset.id = id;
            card.innerHTML = `
                <div class="card-body p-3 d-flex align-items-center gap-3">
                    <div class="avatar bg-primary text-white rounded-circle d-flex align-items-center justify-content-center fw-bold shadow-sm" style="width: 45px; height: 45px; font-size: 1.1rem;">${letter}</div>
                    <div class="h6 mb-0 fw-bold text-dark flex-grow-1">${name}</div>
                    <i class="bi bi-circle text-muted fs-4 check-icon"></i>
                </div>
            `;

            card.addEventListener('click', () => {
                // reset all cards visually
                document.querySelectorAll('.student-card').forEach(c => {
                    c.classList.remove('border-primary', 'bg-primary', 'bg-opacity-10');
                    c.classList.add('border-light', 'bg-white');
                    c.querySelector('.check-icon').classList.replace('bi-check-circle-fill', 'bi-circle');
                    c.querySelector('.check-icon').classList.replace('text-primary', 'text-muted');
                });
                // activate this card
                card.classList.remove('border-light', 'bg-white');
                card.classList.add('border-primary', 'bg-primary', 'bg-opacity-10');
                card.querySelector('.check-icon').classList.replace('bi-circle', 'bi-check-circle-fill');
                card.querySelector('.check-icon').classList.replace('text-muted', 'text-primary');

                if (hiddenSelect) hiddenSelect.value = id;
                localStorage.setItem("selectedStudent", id);
                if (continueBtn) continueBtn.classList.remove('d-none');
            });

            if (container) container.appendChild(card);
        }
    });

    if (badge) badge.innerText = count;

    if (count === 0 && container) {
        container.innerHTML = '<div class="text-muted small p-4 text-center bg-white shadow-sm rounded-4 border border-light">No students in this class.</div>';
    }
}

function restoreSelections() {
    const classId = localStorage.getItem("selectedClass");
    if (classId) {
        const selectModal = document.getElementById('classSelectModal');
        if (selectModal) selectModal.value = classId;
        populateStudentsDropdown(classId);

        setTimeout(() => {
            const studentId = localStorage.getItem("selectedStudent");
            if (studentId) {
                const card = document.querySelector(`.student-card[data-id="${studentId}"]`);
                if (card) {
                    card.click();
                    // We DO NOT close the modal or reveal the container here.
                    // The user must explicitly press 'Continue to Tracker'.
                }
            }
        }, 500);
    }
}

async function refreshStudentSummary(studentId) {
    const student = studentsData[studentId];
    if (!student) return;

    // Set Meta
    document.getElementById('summaryName').innerText = student.name;
    document.getElementById('summaryAvatar').innerText = student.name.charAt(0).toUpperCase();

    // Find class
    const classSelect = document.getElementById('classSelectModal');
    let className = 'Class';
    for (let o of classSelect.options) {
        if (o.value === student.classId) className = o.text;
    }
    document.getElementById('summaryClass').innerText = className;

    // Load Records to calculate points
    let totalScore = 0;
    let totalSalawat = 0;
    let prayersToday = 0;
    let studyToday = 0;

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
            }
        });
    } catch (err) {
        console.log('offline/failed summary load');
    }

    document.getElementById('summaryPoints').innerText = totalScore;
    document.getElementById('summarySalawat').innerText = totalSalawat;

    // Progress Bar Calcs
    const maxPrayers = 5;
    const maxStudy = subjectsList.length || 1;

    const pPct = Math.min(100, Math.round((prayersToday / maxPrayers) * 100));
    const sPct = Math.min(100, Math.round((studyToday / maxStudy) * 100));
    const tPct = Math.min(100, Math.round(((prayersToday + studyToday) / (maxPrayers + maxStudy)) * 100));

    document.getElementById('progPrayers').style.background = `conic-gradient(#3b82f6 ${pPct}%, #e5e7eb 0)`;
    document.getElementById('progPrayers').innerText = `${pPct}%`;

    document.getElementById('progStudy').style.background = `conic-gradient(#f59e0b ${sPct}%, #e5e7eb 0)`;
    document.getElementById('progStudy').innerText = `${sPct}%`;

    const progTotal = document.querySelector('.progress-circle.text-success');
    progTotal.style.background = `conic-gradient(#10b981 ${tPct}%, #e5e7eb 0)`;
    progTotal.innerText = `${tPct}%`;
}

function setupSalawat() {
    const display = document.getElementById('salawatDisplay');
    const hiddenInput = document.getElementById('salawatCount');

    function updateDisplay() {
        display.innerText = parseInt(hiddenInput.value) || 0;
    }

    // Quick-add buttons
    document.querySelectorAll('.salawat-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            hiddenInput.value = (parseInt(hiddenInput.value) || 0) + parseInt(btn.dataset.add);
            updateDisplay();
        });
    });

    // Reset button
    document.getElementById('salawatResetBtn').addEventListener('click', () => {
        hiddenInput.value = 0;
        updateDisplay();
    });

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
        const props = getBtnProps(prayerSelections[lowerP] || "Jamaat", lowerP);
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

    let prayerScore = 0;
    let prayerData = {};
    let prayersRecordFormat = { fajr: "", dhuhr: "", asr: "", maghrib: "", isha: "" };

    PRAYERS.forEach(p => {
        const lowerP = p.toLowerCase();
        const val = prayerSelections[lowerP];
        prayerData[p] = val;
        prayersRecordFormat[lowerP] = val;
        prayerScore += PRAYER_SCORES[val];
    });

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
    const totalScore = prayerScore + subjectScore + Math.floor(salawatCount / 100);

    const recordId = `${studentId}_${selectedDateStr}`;

    const record = {
        madrasaId,
        studentId,
        classId,
        date: selectedDateStr,
        prayers: prayerData,
        ...prayersRecordFormat,
        subjectScore,
        prayerScore,
        totalScore,     // Salawat does NOT affect this score
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
            document.querySelectorAll('.subject-checkbox:checked, .book-checkbox:checked').forEach(cb => cb.checked = false);
            document.getElementById('salawatCount').value = 0;
            document.getElementById('salawatDisplay').innerText = 0;
            prayerSelections = { fajr: "Jamaat", dhuhr: "Jamaat", asr: "Jamaat", maghrib: "Jamaat", isha: "Jamaat" };
            renderPrayersForm();
            refreshStudentSummary(studentId);
        } catch (err) {
            alert("Error saving online. Saved locally: " + err.message);
        }
    } else {
        alert("Saved offline. Will sync when internet returns.");
        document.querySelectorAll('.subject-checkbox:checked, .book-checkbox:checked').forEach(cb => cb.checked = false);
        document.getElementById('salawatCount').value = 0;
        document.getElementById('salawatDisplay').innerText = 0;
        prayerSelections = { fajr: "Jamaat", dhuhr: "Jamaat", asr: "Jamaat", maghrib: "Jamaat", isha: "Jamaat" };
        renderPrayersForm();
        refreshStudentSummary(studentId);
    }

    btn.disabled = false;
    btn.innerHTML = originalHtml;
});

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
