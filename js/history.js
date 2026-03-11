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

    container.innerHTML = filtered.map(r => {
        const studentName = allStudents[r.studentId]?.name || 'Unknown Student';
        const className = allClasses[r.classId]?.name || 'Unknown Class';

        const rawPrayers = r.prayers || {};
        const orderedPrayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
        
        const emojiMap = {
            fajr: '🌅 Fajr',
            dhuhr: '☀️ Dhuhr',
            asr: '🌤 Asr',
            maghrib: '🌇 Maghrib',
            isha: '🌙 Isha'
        };

        const prayText = orderedPrayers.map(p => {
            if (!rawPrayers[p]) return '';
            const status = rawPrayers[p];
            let col = status === 'Jamaat' ? 'text-success bg-success bg-opacity-10'
                : status === 'Individual' ? 'text-warning bg-warning bg-opacity-10 text-dark' : 'text-danger bg-danger bg-opacity-10';
            const emojiName = emojiMap[p] || p;
            return `<span class="badge rounded-pill fw-bold shadow-sm px-3 py-2 me-1 mb-2 ${col}">${emojiName}</span>`;
        }).filter(html => html !== '').join('');

        let timeStr = 'Offline';
        if (r.timestamp) {
            timeStr = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        
        const salawatCount = r.salawatCount || 0;

        return `
        <div class="card shadow-sm border-0 rounded-4 p-4 bg-white mb-2">
          
          <div class="d-flex justify-content-between align-items-start mb-3">
             <div class="d-flex align-items-center gap-3">
                 <div class="avatar bg-light text-primary fw-bold text-center rounded-circle d-flex align-items-center justify-content-center shadow-sm" style="width:45px;height:45px; font-size:1.1rem; border: 2px solid #e9ecef;">
                     ${studentName.charAt(0).toUpperCase()}
                 </div>
                 <div>
                     <h6 class="fw-bold fs-5 text-dark mb-0">${studentName}</h6>
                     <span class="badge bg-light text-muted fw-bold mt-1 border border-light shadow-sm">${className}</span>
                 </div>
             </div>
             
             <div class="badge rounded-pill py-2 px-3 fw-bold shadow-sm" style="background: linear-gradient(135deg, #22c55e, #16a34a); color: white; font-size: 0.9rem;">
                 🏆 ${r.totalScore} pts
             </div>
          </div>
          
          <div class="d-flex flex-wrap border-bottom border-light pb-2 mb-3 mt-2">
             ${prayText}
          </div>
          
          <div class="d-flex justify-content-between align-items-center">
             <div class="d-flex gap-2">
                 <div class="small fw-bold text-muted bg-light px-2 py-1 rounded-3 border-0 shadow-sm">
                    📚 Subjects: <span class="text-accent ms-1">${r.subjectScore}</span>
                 </div>
                 <div class="small fw-bold text-muted bg-light px-2 py-1 rounded-3 border-0 shadow-sm">
                    📿 Salawat: <span class="text-info ms-1">${salawatCount}</span>
                 </div>
             </div>
             <span class="text-muted opacity-75 fw-bold" style="font-size: 0.75rem;"><i class="bi bi-cloud-check me-1"></i>Saved: ${timeStr}</span>
          </div>
          
        </div>
      `;
    }).join('');
}
