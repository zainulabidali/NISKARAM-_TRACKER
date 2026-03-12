import { db } from './firebase.js';
import { injectBottomNav } from './app.js';
import { collection, query, where, getDocs, doc, getDoc, orderBy, limit, startAfter } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

let madrasaId = null;
let allRecords = [];
let allStudents = {};
let allClasses = {};

const PAGE_SIZE = 100;
let lastVisibleDoc = null;
let hasMoreRecords = false;
let activeClassId = '';

document.addEventListener('DOMContentLoaded', async () => {
    injectBottomNav('history');

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
        renderMessage('No Madrasa selected. Please use the Madrasa link provided by your admin.');
        return;
    }

    try {
        const docSnap = await getDoc(doc(db, 'madrasas', madrasaId));
        if (docSnap.exists() && docSnap.data().status !== 'active') {
            alert("This Madrasa's subscription is inactive.");
            return;
        }
    } catch (e) {
        // keep page usable if status check fails offline
    }

    // Set default date to today based on local timezone
    const offset = new Date().getTimezoneOffset() * 60000;
    const localDate = new Date(Date.now() - offset).toISOString().split('T')[0];
    document.getElementById('dateFilter').value = localDate;

    await loadClasses();
    bindFilters();
    renderMessage('Select a class to load history records.');
});

function bindFilters() {
    document.getElementById('classFilter').addEventListener('change', async (e) => {
        activeClassId = e.target.value;
        await onClassSelectionChanged();
    });

    document.getElementById('studentFilter').addEventListener('change', renderRecords);

    document.getElementById('dateFilter').addEventListener('change', async () => {
        if (!activeClassId) {
            renderMessage('Select a class before loading records.');
            return;
        }
        await loadRecords({ reset: true });
    });
}

async function loadClasses() {
    const classSelect = document.getElementById('classFilter');
    classSelect.innerHTML = '<option value="">Select Class</option>';

    const cSnap = await getDocs(query(collection(db, 'classes'), where('madrasaId', '==', madrasaId)));
    const classes = [];

    cSnap.forEach((d) => {
        const data = d.data();
        allClasses[d.id] = data;
        classes.push({ id: d.id, name: data.name || 'Unnamed Class' });
    });

    classes.sort((a, b) => a.name.localeCompare(b.name));
    classes.forEach((c) => {
        classSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });

    if (classes.length === 0) {
        renderMessage('No classes found for this madrasa.');
    }
}

async function onClassSelectionChanged() {
    resetStudentFilter();
    resetPagination();

    if (!activeClassId) {
        allStudents = {};
        allRecords = [];
        renderMessage('Select a class to load history records.');
        return;
    }

    await loadStudentsForClass(activeClassId);
    await loadRecords({ reset: true });
}

function resetStudentFilter() {
    const stuSelect = document.getElementById('studentFilter');
    stuSelect.innerHTML = '<option value="all">All Students</option>';
}

function resetPagination() {
    lastVisibleDoc = null;
    hasMoreRecords = false;
}

async function loadStudentsForClass(classId) {
    const stuSelect = document.getElementById('studentFilter');
    stuSelect.innerHTML = '<option value="all">All Students</option>';

    const sSnap = await getDocs(
        query(
            collection(db, 'students'),
            where('madrasaId', '==', madrasaId),
            where('classId', '==', classId)
        )
    );

    const rows = [];
    allStudents = {};

    sSnap.forEach((d) => {
        const data = d.data();
        allStudents[d.id] = data;
        rows.push({ id: d.id, name: data.name || 'Unknown Student' });
    });

    rows.sort((a, b) => a.name.localeCompare(b.name));
    rows.forEach((s) => {
        stuSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
}

async function fetchRecordsPage(classId, dateStr) {
    const filters = [
        where('madrasaId', '==', madrasaId),
        where('classId', '==', classId),
        where('date', '==', dateStr)
    ];

    try {
        let q = query(
            collection(db, 'records'),
            ...filters,
            orderBy('timestamp', 'desc'),
            limit(PAGE_SIZE)
        );

        if (lastVisibleDoc) {
            q = query(
                collection(db, 'records'),
                ...filters,
                orderBy('timestamp', 'desc'),
                startAfter(lastVisibleDoc),
                limit(PAGE_SIZE)
            );
        }

        return await getDocs(q);
    } catch (err) {
        // Fallback if composite index is not available yet.
        if (err?.code !== 'failed-precondition') {
            throw err;
        }

        let fallbackQ = query(
            collection(db, 'records'),
            ...filters,
            limit(PAGE_SIZE)
        );

        if (lastVisibleDoc) {
            fallbackQ = query(
                collection(db, 'records'),
                ...filters,
                startAfter(lastVisibleDoc),
                limit(PAGE_SIZE)
            );
        }

        return await getDocs(fallbackQ);
    }
}

async function loadRecords({ reset = false } = {}) {
    const container = document.getElementById('recordsContainer');
    const dateStr = document.getElementById('dateFilter').value;

    if (!activeClassId) {
        renderMessage('Select a class before loading records.');
        return;
    }

    if (!dateStr) {
        renderMessage('Please select a date.');
        return;
    }

    if (reset) {
        allRecords = [];
        resetPagination();
    }

    if (reset || allRecords.length === 0) {
        container.innerHTML = `
            <div class="text-center py-5 bg-white rounded-4 shadow-sm border border-light p-4">
               <div class="spinner-border text-primary border-3" role="status" style="width: 3rem; height: 3rem;">
                   <span class="visually-hidden">Loading...</span>
               </div>
               <p class="text-muted fw-bold mt-3">Loading records...</p>
            </div>`;
    }

    try {
        const snap = await fetchRecordsPage(activeClassId, dateStr);

        if (!snap.empty) {
            const pageRows = [];
            snap.forEach((d) => pageRows.push({ id: d.id, ...d.data() }));

            allRecords = reset ? pageRows : allRecords.concat(pageRows);
            lastVisibleDoc = snap.docs[snap.docs.length - 1];
            hasMoreRecords = snap.size === PAGE_SIZE;
        } else {
            if (reset) allRecords = [];
            hasMoreRecords = false;
        }

        renderRecords();
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">Error: ${err.message}</div>`;
    }
}

function renderMessage(message) {
    const container = document.getElementById('recordsContainer');
    container.innerHTML = `
      <div class="text-center py-5 bg-white rounded-4 shadow-sm border border-light p-4">
        <i class="bi bi-funnel display-3 text-muted opacity-25 mb-3"></i>
        <p class="text-muted fw-bold">${message}</p>
      </div>`;
}

function renderRecords() {
    const container = document.getElementById('recordsContainer');
    const studentFilter = document.getElementById('studentFilter').value;

    let filtered = allRecords.filter((r) => {
        if (studentFilter !== 'all' && r.studentId !== studentFilter) return false;
        return true;
    });

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (filtered.length === 0) {
        renderMessage('No records found for this class/date.');
        return;
    }

    const tableHeader = `
        <div class="table-responsive bg-white rounded-4 shadow-sm border-0">
            <table class="table table-sm table-hover mb-0 align-middle" style="font-size: 0.85rem;">
                <thead class="bg-light text-muted small fw-bold">
                    <tr>
                        <th class="ps-3 py-3 border-0">Student Name</th>
                        <th class="py-3 border-0">Class</th>
                        <th class="text-center py-3 border-0">F</th>
                        <th class="text-center py-3 border-0">D</th>
                        <th class="text-center py-3 border-0">A</th>
                        <th class="text-center py-3 border-0">M</th>
                        <th class="text-center py-3 border-0">I</th>
                        <th class="text-center py-3 border-0">Sub</th>
                        <th class="text-center py-3 border-0">Salawat</th>
                        <th class="text-center py-3 pe-3 border-0">Pts</th>
                    </tr>
                </thead>
                <tbody id="recordsTableBody">
    `;

    const tableFooter = `
                </tbody>
            </table>
        </div>
    `;

    const rows = filtered.map((r) => {
        const studentName = allStudents[r.studentId]?.name || 'Unknown Student';
        const className = allClasses[r.classId]?.name || 'Unknown Class';

        const rawPrayers = r.prayers || {};
        const orderedPrayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

        const prayerIndicators = orderedPrayers.map((p) => {
            const status = rawPrayers[p];
            if (!status || status === 'Not Prayed') {
                return '<td class="text-center py-2"><span class="text-danger">&times;</span></td>';
            }
            if (status === 'Jamaat') {
                return '<td class="text-center py-2"><span class="text-success fw-bold">&#10003;</span></td>';
            }
            return '<td class="text-center py-2"><span class="text-warning fw-bold">&#10003;</span></td>';
        }).join('');

        const salawatCount = r.salawatCount || 0;

        return `
            <tr class="border-bottom border-light">
                <td class="ps-3 py-2 fw-bold text-dark">${studentName}</td>
                <td class="py-2 text-muted small">${className}</td>
                ${prayerIndicators}
                <td class="text-center py-2 fw-bold text-accent">${r.subjectScore}</td>
                <td class="text-center py-2 text-info small fw-bold">${salawatCount}</td>
                <td class="text-center py-2 pe-3"><span class="badge rounded-pill bg-success bg-opacity-10 text-success fw-bold px-2">${r.totalScore}</span></td>
            </tr>
        `;
    }).join('');

    const loadMoreHtml = hasMoreRecords
        ? `
          <div class="text-center mt-3">
              <button id="loadMoreHistoryBtn" class="btn btn-outline-primary rounded-pill px-4 fw-bold">
                  Load More
              </button>
          </div>`
        : '';

    container.innerHTML = tableHeader + rows + tableFooter + loadMoreHtml;

    const loadMoreBtn = document.getElementById('loadMoreHistoryBtn');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', async () => {
            loadMoreBtn.disabled = true;
            loadMoreBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Loading...';
            await loadRecords({ reset: false });
        });
    }
}

