import { db } from './firebase.js';
import { injectBottomNav } from './app.js';
import { collection, query, where, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

let madrasaId = null;
let studentId = null;
let studentData = null;
let classData = null;
let records = [];
let chartInstance = null;

let currentView = 'weekly'; // 'weekly' or 'monthly'

document.addEventListener('DOMContentLoaded', async () => {
    injectBottomNav('home');

    const urlParams = new URLSearchParams(window.location.search);
    studentId = urlParams.get('s');
    madrasaId = localStorage.getItem('activeMadrasaId');

    if (!madrasaId || !studentId) {
        alert("Invalid report parameters.");
        window.location.href = 'home.html';
        return;
    }

    await loadStudentData();
    await loadRecords();

    document.getElementById('loadingIndicator').classList.add('d-none');
    document.getElementById('reportContent').classList.remove('d-none');

    setupToggles();
    setupDownload();

    renderReport();
});

async function loadStudentData() {
    try {
        const docSnap = await getDoc(doc(db, "students", studentId));
        if (docSnap.exists()) {
            studentData = docSnap.data();

            const classSnap = await getDoc(doc(db, "classes", studentData.classId));
            if (classSnap.exists()) {
                classData = classSnap.data();
            }
        } else {
            alert("Student not found.");
            window.location.href = "home.html";
        }
    } catch (err) {
        console.error("Error loading student", err);
    }
}

async function loadRecords() {
    const todayRaw = new Date();
    const offset = todayRaw.getTimezoneOffset() * 60000;
    const localDate = new Date(todayRaw.getTime() - offset);

    // fetch up to 30 days
    const monthlyBound = new Date(localDate);
    monthlyBound.setDate(localDate.getDate() - 30);
    const monthlyBoundStr = monthlyBound.toISOString().split('T')[0];

    try {
        const recQ = query(collection(db, "records"),
            where("studentId", "==", studentId),
            where("date", ">=", monthlyBoundStr));
        const snap = await getDocs(recQ);
        records = [];
        snap.forEach(d => records.push(d.data()));

        // merge offline changes
        const offlineRecords = JSON.parse(localStorage.getItem('trackerData') || '[]');
        offlineRecords.forEach(offRec => {
            if (offRec.studentId === studentId && offRec.date >= monthlyBoundStr) {
                const existingIdx = records.findIndex(r => r.date === offRec.date);
                if (existingIdx >= 0) {
                    records[existingIdx] = offRec;
                } else {
                    records.push(offRec);
                }
            }
        });

    } catch (err) {
        console.error("Error loading records", err);
    }
}

function setupToggles() {
    document.getElementById('btnWeekly').addEventListener('click', (e) => {
        currentView = 'weekly';
        e.target.classList.replace('text-muted', 'bg-primary');
        e.target.classList.add('text-white', 'shadow-sm', 'active');
        const m = document.getElementById('btnMonthly');
        m.classList.replace('bg-primary', 'text-muted');
        m.classList.remove('text-white', 'shadow-sm', 'active');
        renderReport();
    });

    document.getElementById('btnMonthly').addEventListener('click', (e) => {
        currentView = 'monthly';
        e.target.classList.replace('text-muted', 'bg-primary');
        e.target.classList.add('text-white', 'shadow-sm', 'active');
        const w = document.getElementById('btnWeekly');
        w.classList.replace('bg-primary', 'text-muted');
        w.classList.remove('text-white', 'shadow-sm', 'active');
        renderReport();
    });
}

function renderReport() {
    // 1. Calculate boundaries
    const todayRaw = new Date();
    const offset = todayRaw.getTimezoneOffset() * 60000;
    const localDate = new Date(todayRaw.getTime() - offset);
    const todayStr = localDate.toISOString().split('T')[0];

    const bound = new Date(localDate);
    const daysBack = currentView === 'weekly' ? 7 : 30;
    bound.setDate(localDate.getDate() - daysBack);
    const boundStr = bound.toISOString().split('T')[0];

    // 2. Filter records
    const viewRecords = records.filter(r => r.date >= boundStr && r.date <= todayStr);

    // 3. Compute Stats
    let totalPoints = 0;
    let totalSalawat = 0;
    let countJamaath = 0;
    let countIndiv = 0;
    let countSubjects = 0;

    viewRecords.forEach(r => {
        totalPoints += Number(r.totalScore) || 0;
        totalSalawat += Number(r.salawatCount) || 0;
        countSubjects += Number(r.subjectScore) || 0;

        ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
            if (r[p] === 'Jamaat') countJamaath++;
            if (r[p] === 'Individual') countIndiv++;
        });
    });

    // 4. Update DOM Report Card
    document.getElementById('rName').innerText = studentData.name;
    document.getElementById('rAvatar').innerText = studentData.name.charAt(0).toUpperCase();
    document.getElementById('rClass').innerText = classData ? classData.name : 'Class';
    document.getElementById('rTimeframe').innerText = currentView === 'weekly' ? 'Last 7 Days' : 'Last 30 Days';

    document.getElementById('rPoints').innerText = totalPoints;
    document.getElementById('rSalawat').innerText = totalSalawat;
    document.getElementById('rJamaath').innerText = countJamaath;
    document.getElementById('rIndiv').innerText = countIndiv;
    document.getElementById('rSubjects').innerText = countSubjects;

    // 5. Render Chart
    renderChart(boundStr, todayStr, viewRecords);
}

function renderChart(startStr, endStr, viewRecords) {
    if (chartInstance) {
        chartInstance.destroy();
    }

    // Build timeline array
    let labels = [];
    let dataPts = [];

    let curr = new Date(startStr);
    const end = new Date(endStr);

    while (curr <= end) {
        const dStr = curr.toISOString().split('T')[0];
        // short date formatting mm/dd
        labels.push(`${curr.getMonth() + 1}/${curr.getDate()}`);

        const rec = viewRecords.find(r => r.date === dStr);
        dataPts.push(rec ? (Number(rec.totalScore) || 0) : 0);

        curr.setDate(curr.getDate() + 1);
    }

    const ctx = document.getElementById('progressChart').getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Points Earned',
                data: dataPts,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#1d4ed8',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function setupDownload() {
    document.getElementById('btnDownload').addEventListener('click', () => {
        const btn = document.getElementById('btnDownload');
        const origText = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';
        btn.disabled = true;

        const target = document.getElementById('captureArea');
        html2canvas(target, {
            scale: 2,
            backgroundColor: '#f8f9fa',
            logging: false
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = `Report_${studentData.name.replace(/\s+/g, '_')}_${currentView}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

            btn.innerHTML = origText;
            btn.disabled = false;
        }).catch(err => {
            console.error("Canvas error", err);
            alert("Error downloading report.");
            btn.innerHTML = origText;
            btn.disabled = false;
        });
    });
}
