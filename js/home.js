import { db } from './firebase.js';
import { injectBottomNav } from './app.js';
import { collection, query, where, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

let madrasaId = null;
let allStudents = {};
let allRecords = [];
let allClasses = {};

// Initialize Today's Date
const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
document.getElementById('todayDate').innerText = new Date().toLocaleDateString('en-US', options);

document.addEventListener('DOMContentLoaded', async () => {
    injectBottomNav('home');

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
        document.getElementById('madrasaNameDisplay').innerText = 'Madrasa Niskaram Tracker';
        ['todayList', 'weeklyList', 'monthlyList'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = `
                  <div class="text-center py-5">
                    <i class="bi bi-person-lock display-4 text-muted opacity-50 mb-3"></i>
                    <p class="text-muted fw-bold">No Madrasa selected.<br>
                       Please use the link provided by your admin.</p>
                  </div>`;
            }
        });
        return;
    }

    // Load Madrasa Name
    const docSnap = await getDoc(doc(db, "madrasas", madrasaId));
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.status !== 'active') {
            document.getElementById('madrasaNameDisplay').innerText = "Inactive Madrasa";
            return;
        }
        document.getElementById('madrasaNameDisplay').innerText = data.name;
    } else {
        localStorage.removeItem('activeMadrasaId');
        document.getElementById('madrasaNameDisplay').innerText = "Madrasa Not Found";
        return;
    }

    await loadClasses();
    await loadData();
    renderLeaderboards();
    await loadAnnouncementsBanner();
});

async function loadClasses() {
    const classFilter = document.getElementById('classFilter');
    const q = query(collection(db, "classes"), where("madrasaId", "==", madrasaId));
    const snap = await getDocs(q);
    snap.forEach(d => {
        allClasses[d.id] = d.data().name;
        classFilter.innerHTML += `<option value="${d.id}">${d.data().name}</option>`;
    });

    classFilter.addEventListener('change', renderLeaderboards);
}

async function loadData() {
    // Load Students
    const stuQ = query(collection(db, "students"), where("madrasaId", "==", madrasaId));
    const stuSnap = await getDocs(stuQ);
    stuSnap.forEach(d => {
        allStudents[d.id] = { ...d.data(), id: d.id };
    });

    // Calculate Date Boundaries
    const todayRaw = new Date();
    const offset = todayRaw.getTimezoneOffset() * 60000;
    const localDate = new Date(todayRaw.getTime() - offset);
    const todayStr = localDate.toISOString().split('T')[0];

    const weeklyBound = new Date(localDate);
    weeklyBound.setDate(localDate.getDate() - 7);
    const weeklyBoundStr = weeklyBound.toISOString().split('T')[0];

    const monthlyBound = new Date(localDate);
    monthlyBound.setDate(localDate.getDate() - 30);
    const monthlyBoundStr = monthlyBound.toISOString().split('T')[0];

    try {
        const recQ = query(collection(db, "records"),
            where("madrasaId", "==", madrasaId));

        const recSnap = await getDocs(recQ);
        allRecords = [];
        recSnap.forEach(d => {
            if (d.data().date >= monthlyBoundStr) {
                allRecords.push(d.data());
            }
        });
    } catch (err) {
        console.error("Failed to load records from Firestore", err);
        allRecords = [];
    }

    // Merge offline / unsynced records to show on leaderboard immediately
    const offlineRecords = JSON.parse(localStorage.getItem('trackerData') || '[]');
    offlineRecords.forEach(offRec => {
        if (offRec.madrasaId === madrasaId && offRec.date >= monthlyBoundStr) {
            // Check if this record is already in allRecords (to avoid double counting if fetch was fast)
            const id = offRec._id || `${offRec.studentId}_${offRec.date}`;
            const existingIdx = allRecords.findIndex(r => r._id === id || (r.studentId === offRec.studentId && r.date === offRec.date));
            if (existingIdx >= 0) {
                // overwrite with the freshest offline change
                allRecords[existingIdx] = offRec;
            } else {
                allRecords.push(offRec);
            }
        }
    });

    window.todayStrGlobal = todayStr;
    window.weeklyBoundStrGlobal = weeklyBoundStr;
}

function renderLeaderboards() {
    const classFilter = document.getElementById('classFilter').value;
    const todayStr = window.todayStrGlobal;
    const weeklyBoundStr = window.weeklyBoundStrGlobal;

    let scoresToday = {};
    let scoresWeekly = {};
    let scoresMonthly = {};
    let salawatToday = {};
    let salawatWeekly = {};
    let salawatMonthly = {};

    Object.keys(allStudents).forEach(sId => {
        if (classFilter === 'all' || allStudents[sId].classId === classFilter) {
            scoresToday[sId] = 0;
            scoresWeekly[sId] = 0;
            scoresMonthly[sId] = 0;
            salawatToday[sId] = 0;
            salawatWeekly[sId] = 0;
            salawatMonthly[sId] = 0;
        }
    });

    allRecords.forEach(r => {
        const sId = r.studentId;
        if (scoresMonthly[sId] !== undefined) {
            const score = Number(r.totalScore) || 0;
            const salawat = Number(r.salawatCount) || 0;
            scoresMonthly[sId] += score;
            salawatMonthly[sId] = (salawatMonthly[sId] || 0) + salawat;
            if (r.date >= weeklyBoundStr) {
                scoresWeekly[sId] += score;
                salawatWeekly[sId] = (salawatWeekly[sId] || 0) + salawat;
            }
            if (r.date === todayStr) {
                scoresToday[sId] += score;
                salawatToday[sId] = (salawatToday[sId] || 0) + salawat;
            }
        }
    });

    const generateHTML = (scoresObj, salawatObj) => {
        const sorted = Object.keys(scoresObj)
            .filter(id => scoresObj[id] > 0 || (salawatObj[id] || 0) > 0)
            .map(id => ({
                id,
                score: scoresObj[id],
                salawat: salawatObj[id] || 0,
                name: allStudents[id].name,
                classId: allStudents[id].classId
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 6);

        if (sorted.length === 0) {
            return `
        <div class="text-center py-5">
           <i class="bi bi-box2 display-4 text-muted opacity-50 mb-3"></i>
           <p class="text-muted fw-bold">No records found yet.</p>
        </div>
      `;
        }

        return sorted.map((s, index) => {
            let rankBadge = '';
            let bgClass = 'bg-transparent';
            let borderClass = 'border-bottom border-light';

            if (index === 0) { rankBadge = '🥇'; bgClass = 'bg-warning bg-opacity-10'; borderClass = 'border border-warning'; }
            else if (index === 1) { rankBadge = '🥈'; bgClass = 'bg-secondary bg-opacity-10'; }
            else if (index === 2) { rankBadge = '🥉'; bgClass = 'bg-danger bg-opacity-10'; }
            else { rankBadge = `#${index + 1}`; }

            const classNameStr = allClasses[s.classId] || "Unknown Class";

            return `
      <a href="report.html?s=${s.id}" class="text-decoration-none">
          <li class="list-group-item py-3 px-3 rounded-4 mb-2 ${bgClass} ${borderClass} shadow-sm profile-hover-card transition-all d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center gap-3">
                    <span class="fs-5 fw-bold text-muted" style="width: 28px; text-align: center;">${rankBadge}</span>
                    <div class="avatar bg-white shadow-sm text-primary fw-bold text-center rounded-circle d-flex align-items-center justify-content-center" style="width:45px;height:45px; font-size:1.1rem;">
                        ${s.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h6 class="fw-bold text-dark mb-0">${s.name}</h6>
                        <small class="text-muted fw-bold">Class: ${classNameStr}</small>
                    </div>
                </div>

                <!-- compact right-aligned stats panel -->
                <div class="d-flex flex-column gap-1 ms-auto text-end" style="background: linear-gradient(135deg, #eef7ff, #f6fbff); border-radius: 10px; padding: 6px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                    <div class="badge fw-bold shadow-sm rounded-pill text-start" style="background: rgba(13,110,253,0.12); color: #0d6efd; font-size: 0.75rem;">
                        🏆 ${s.score}
                    </div>
                    <div class="badge fw-bold shadow-sm rounded-pill text-start" style="background: rgba(13,202,240,0.12); color: #0dcaf0; font-size: 0.75rem;">
                        📿 ${s.salawat}
                    </div>
                </div>
          </li>
      </a>
    `;
        }).join('');
    };

    document.getElementById('todayList').innerHTML = generateHTML(scoresToday, salawatToday);
    document.getElementById('weeklyList').innerHTML = generateHTML(scoresWeekly, salawatWeekly);
    document.getElementById('monthlyList').innerHTML = generateHTML(scoresMonthly, salawatMonthly);
}

// ==========================================
// Global Announcements Banner
// ==========================================
async function loadAnnouncementsBanner() {
    try {
        const q = query(collection(db, "announcements"));
        const snap = await getDocs(q);
        let anns = [];
        snap.forEach(d => {
            anns.push(d.data());
        });
        
        if (anns.length > 0) {
            anns.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
            const latest = anns[0]; // get newest
            const banner = document.getElementById('globalAnnouncementBanner');
            if (banner) {
                banner.innerHTML = `
                    <div class="alert border border-warning shadow-sm rounded-4 d-flex align-items-start gap-3 mb-0" style="background: linear-gradient(to right, #fff8e1, #fffdf7);">
                        <i class="bi bi-megaphone-fill fs-4 text-warning mt-1"></i>
                        <div>
                            <h6 class="fw-bold text-dark mb-1">${latest.title} <span class="badge bg-warning text-dark ms-2 rounded-pill shadow-sm" style="font-size:0.65rem;">Notice</span></h6>
                            <p class="mb-0 small text-secondary">${latest.message}</p>
                        </div>
                    </div>
                `;
                banner.classList.remove('d-none');
            }
        }
    } catch(err) {
        console.error("Failed to load global announcements", err);
    }
}
