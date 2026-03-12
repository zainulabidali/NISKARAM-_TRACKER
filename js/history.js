import { db } from './firebase.js';
import { injectBottomNav } from './app.js';
import { collection, query, where, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

let madrasaId = null;
let allRecords = [];
let allStudents = {};
let allClasses = {};

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
        document.getElementById('recordsContainer').innerHTML = `
          <div class="text-center py-5 bg-white rounded-4 shadow-sm border border-light p-4">
            <i class="bi bi-person-lock display-3 text-muted opacity-25 mb-3"></i>
            <p class="text-muted fw-bold">No Madrasa selected.<br>
               Please use the Madrasa Link provided by your admin.</p>
          </div>`;
        return;
    }

    try {
        const docSnap = await getDoc(doc(db, "madrasas", madrasaId));
        if (docSnap.exists() && docSnap.data().status !== 'active') {
            alert("This Madrasa's subscription is inactive.");
            return;
        }
    } catch (e) { }

    // Set default date to today based on local timezone
    const offset = new Date().getTimezoneOffset() * 60000;
    const localDate = new Date(Date.now() - offset).toISOString().split('T')[0];
    document.getElementById('dateFilter').value = localDate;

    await loadClassesAndStudents();
    await loadRecords();

    // Listeners
    document.getElementById('classFilter').addEventListener('change', renderRecords);
    document.getElementById('studentFilter').addEventListener('change', renderRecords);
    document.getElementById('dateFilter').addEventListener('change', loadRecords);
});

async function loadClassesAndStudents() {
    const cSnap = await getDocs(query(collection(db, "classes"), where("madrasaId", "==", madrasaId)));
    const classSelect = document.getElementById('classFilter');
    cSnap.forEach(d => {
        allClasses[d.id] = d.data();
        classSelect.innerHTML += `<option value="${d.id}">${d.data().name}</option>`;
    });

    const sSnap = await getDocs(query(collection(db, "students"), where("madrasaId", "==", madrasaId)));
    const stuSelect = document.getElementById('studentFilter');
    sSnap.forEach(d => {
        allStudents[d.id] = d.data();
        stuSelect.innerHTML += `<option value="${d.id}">${d.data().name}</option>`;
    });
}

async function loadRecords() {
    const container = document.getElementById('recordsContainer');
    container.innerHTML = `
        <div class="text-center py-5 bg-white rounded-4 shadow-sm border border-light p-4">
           <div class="spinner-border text-primary border-3" role="status" style="width: 3rem; height: 3rem;">
               <span class="visually-hidden">Loading...</span>
           </div>
           <p class="text-muted fw-bold mt-3">Loading records...</p>
        </div>`;

    const dateStr = document.getElementById('dateFilter').value;
    if (!dateStr) {
        container.innerHTML = '<div class="alert alert-light text-center border-0 shadow-sm text-muted">Please select a date.</div>';
        return;
    }

    const q = query(
        collection(db, "records"),
        where("madrasaId", "==", madrasaId),
        where("date", "==", dateStr)
    );

    try {
        const snap = await getDocs(q);
        allRecords = [];
        snap.forEach(d => allRecords.push({ id: d.id, ...d.data() }));
        renderRecords();
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">Error: ${err.message}</div>`;
    }
}

function renderRecords() {
    const container = document.getElementById('recordsContainer');
    const classFilter = document.getElementById('classFilter').value;
    const studentFilter = document.getElementById('studentFilter').value;

    let filtered = allRecords.filter(r => {
        if (classFilter !== 'all' && r.classId !== classFilter) return false;
        if (studentFilter !== 'all' && r.studentId !== studentFilter) return false;
        return true;
    });

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (filtered.length === 0) {
        container.innerHTML = `
        <div class="text-center py-5 bg-white rounded-4 shadow-sm border border-light p-4">
           <div class="display-3 mb-3">⏳</div>
           <p class="text-muted fw-bold">No records found for this date</p>
        </div>
      `;
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

    const rows = filtered.map(r => {
        const studentName = allStudents[r.studentId]?.name || 'Unknown Student';
        const className = allClasses[r.classId]?.name || 'Unknown Class';

        const rawPrayers = r.prayers || {};
        const orderedPrayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

        const prayerIndicators = orderedPrayers.map(p => {
            const status = rawPrayers[p];
            if (!status || status === 'Not Prayed') {
                return '<td class="text-center py-2"><span class="text-danger">✖</span></td>';
            } else if (status === 'Jamaat') {
                return '<td class="text-center py-2"><span class="text-success fw-bold">✔</span></td>';
            } else {
                // Individual
                return '<td class="text-center py-2"><span class="text-warning fw-bold">✔</span></td>';
            }
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

    container.innerHTML = tableHeader + rows + tableFooter;
}
