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
    container.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>';

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
           <i class="bi bi-clock-history display-3 text-muted opacity-25 mb-3"></i>
           <p class="text-muted fw-bold">No records found for this criteria.</p>
        </div>
      `;
        return;
    }

    container.innerHTML = filtered.map(r => {
        const studentName = allStudents[r.studentId]?.name || 'Unknown Student';
        const className = allClasses[r.classId]?.name || 'Unknown Class';

        const prayText = Object.keys(r.prayers).map(p => {
            let col = r.prayers[p] === 'Jamaat' ? 'text-success border-success bg-success bg-opacity-10'
                : r.prayers[p] === 'Individual' ? 'text-warning border-warning bg-warning bg-opacity-10' : 'text-danger border-danger bg-danger bg-opacity-10';
            return `<span class="badge border me-1 mb-1 shadow-sm px-2 py-1 ${col}">${p}: ${r.prayers[p].charAt(0)}</span>`;
        }).join('');

        let timeStr = 'Offline';
        if (r.timestamp) {
            timeStr = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        return `
        <div class="card shadow-sm border-0 rounded-4 p-3 bg-white">
          <div class="d-flex justify-content-between align-items-center mb-2">
             <div class="fw-bold fs-5 text-dark">${studentName}</div>
             <span class="badge bg-primary rounded-pill py-2 px-3 fw-bold shadow-sm" style="font-size: 0.9rem;">${r.totalScore} pts</span>
          </div>
          <div class="badge bg-light text-dark fw-bold mb-3 d-inline-block p-2 shadow-sm border">${className}</div>
          
          <div class="d-flex flex-wrap border-bottom border-light pb-2 mb-2">
             ${prayText}
          </div>
          
          <div class="small fw-bold text-muted d-flex align-items-center mt-2">
             <i class="bi bi-book-half me-1 text-accent"></i> Subjects Checked: <span class="ms-1 fs-6">${r.subjectScore}</span>
             <span class="ms-auto text-muted opacity-50" style="font-size: 0.75rem;"><i class="bi bi-cloud-check me-1"></i>${timeStr}</span>
          </div>
        </div>
      `;
    }).join('');
}
