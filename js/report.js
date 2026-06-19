import { db } from './firebase.js';
import { collection, query, where, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

let madrasaId = null;
let studentId = null;
let allRecords = []; // cached records from last 30 days
let chartInstance = null;
let currentFilter = 7; // 7 days or 30 days

document.addEventListener('DOMContentLoaded', async () => {
    madrasaId = localStorage.getItem('activeMadrasaId');
    const urlParams = new URLSearchParams(window.location.search);
    studentId = urlParams.get('s');

    // Parent Route Protection
    const parentStudentId = sessionStorage.getItem('parentStudentId');
    if (parentStudentId && parentStudentId !== studentId) {
        window.location.href = 'parent_dashboard.html';
        return;
    }

    if (!madrasaId || !studentId) {
        Swal.fire({
            title: 'Missing Context',
            text: "Missing student or madrasa context. Returning to tracker.",
            icon: 'error',
            confirmButtonColor: '#155e4d',
            confirmButtonText: 'OK',
            customClass: { popup: 'rounded-4' }
        }).then(() => {
            window.history.back();
        });
        return;
    }

    document.getElementById('btnBack').addEventListener('click', () => {
        window.history.back();
    });

    setupFilters();
    await fetchReportData();
});

function setupFilters() {
    const btnWeek = document.getElementById('filterWeekly');
    const btnMonth = document.getElementById('filterMonthly');

    btnWeek.addEventListener('click', () => {
        if (currentFilter === 7) return;
        btnWeek.classList.add('active');
        btnMonth.classList.remove('active');
        currentFilter = 7;
        renderReport();
    });

    btnMonth.addEventListener('click', () => {
        if (currentFilter === 30) return;
        btnMonth.classList.add('active');
        btnWeek.classList.remove('active');
        currentFilter = 30;
        renderReport();
    });
}

function getDatePastStr(daysAgo) {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localTime = new Date(now.getTime() - offset);
    localTime.setDate(localTime.getDate() - daysAgo);
    return localTime.toISOString().split('T')[0];
}

async function fetchReportData() {
    try {
        // 1. Fetch Student Info
        const studentDoc = await getDoc(doc(db, "students", studentId));
        if (!studentDoc.exists()) {
            throw new Error("Student not found.");
        }
        const student = studentDoc.data();
        document.getElementById('studentName').innerText = student.name || "Unknown";
        document.getElementById('studentAvatar').innerText = (student.name || "?").charAt(0).toUpperCase();

        // 2. Fetch Class Info concurrently
        const classId = student.classId;
        if (classId) {
            getDoc(doc(db, "classes", classId)).then(cDoc => {
                if (cDoc.exists()) {
                    document.getElementById('className').innerText = cDoc.data().name || "Unknown Class";
                }
            });
        }

        // 3. Fetch Records Focus on single query
        const bound30Str = getDatePastStr(30);
        const qRecords = query(
            collection(db, "records"),
            where("madrasaId", "==", madrasaId),
            where("studentId", "==", studentId),
            where("date", ">=", bound30Str)
        );

        let snap;
        try {
            snap = await getDocs(qRecords);
        } catch(err) {
            if (err?.code === 'failed-precondition') {
                const fallbackQuery = query(
                    collection(db, "records"),
                    where("madrasaId", "==", madrasaId),
                    where("studentId", "==", studentId)
                );
                snap = await getDocs(fallbackQuery);
            } else {
                throw err;
            }
        }

        allRecords = [];
        snap.forEach(d => {
            const r = d.data();
            if (r.date >= bound30Str) {
                 allRecords.push(r);
            }
        });

        // Combine offline unsynced tracker data for safety
        const offlineData = JSON.parse(localStorage.getItem('trackerData') || '[]');
        offlineData.forEach(r => {
            if (r.studentId === studentId && r.date >= bound30Str) {
                // filter duplicates
                allRecords = allRecords.filter(rec => !(rec.studentId === r.studentId && rec.date === r.date));
                allRecords.push(r);
            }
        });

        // Safe sort
        allRecords.sort((a,b) => a.date.localeCompare(b.date));

        // Hide loading and show content
        document.getElementById('loadingState').classList.add('d-none');
        document.getElementById('reportContent').classList.remove('d-none');
        
        // Initial Render
        renderReport();

    } catch (err) {
        console.error("Error fetching report", err);
        document.getElementById('loadingState').innerHTML = `<div class="alert alert-danger mx-3">Failed to load report. Please try again or check internet.</div>`;
    }
}

function renderReport() {
    const minDateStr = getDatePastStr(currentFilter);
    const filteredRecords = allRecords.filter(r => r.date >= minDateStr);

    if (filteredRecords.length === 0) {
        document.getElementById('emptyState').classList.remove('d-none');
        document.getElementById('chartBox').classList.add('d-none');
        updateStats([]);
        updatePrayers([]);
        return;
    }

    document.getElementById('emptyState').classList.add('d-none');
    document.getElementById('chartBox').classList.remove('d-none');

    updateStats(filteredRecords);
    updatePrayers(filteredRecords);
    renderChart(filteredRecords, minDateStr);
}

function updateStats(records) {
    let pts = 0, salawat = 0, subPts = 0;
    
    records.forEach(r => {
        pts += Number(r.totalScore) || 0;
        salawat += Number(r.salawatCount) || 0;
        subPts += Number(r.subjectScore) || 0;
    });

    document.getElementById('statPoints').innerText = pts;
    document.getElementById('statSalawat').innerText = salawat;
    document.getElementById('statSubjects').innerText = subPts;
    document.getElementById('statDays').innerText = records.length;
}

function updatePrayers(records) {
    const pKeys = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
    const pNames = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
    const pIcons = ["🌅", "☀️", "🌤", "🌇", "🌙"];

    let html = "";

    pKeys.forEach((k, i) => {
        let jam = 0, ind = 0, qaz = 0, miss = 0;
        records.forEach(r => {
            const p = r.prayers?.[k] || r[k];
            if (p === "Jamaat") jam++;
            else if (p === "Individual") ind++;
            else if (p === "Qaza") qaz++;
            else miss++; // Not Prayed or empty is counted as missed
        });

        html += `
            <div class="prayer-box">
                <div class="fs-4 mb-1">${pIcons[i]}</div>
                <div class="fw-bold mb-2" style="font-size:0.75rem;">${pNames[i]}</div>
                <div class="prayer-counts">
                    <span class="j-count">${jam} Jam</span>
                    <span class="i-count">${ind} Ind</span>
                    <span class="q-count">${qaz} Qaz</span>
                    <span class="m-count">${miss} Mis</span>
                </div>
            </div>
        `;
    });

    document.getElementById('prayersContainer').innerHTML = html;
}

function renderChart(records, minDateStr) {
    // Generate all dates in range to show zeros too
    const datesMap = new Map();
    let curr = new Date();
    const offset = curr.getTimezoneOffset() * 60000;
    
    // We count backwards currentFilter days
    for (let i = currentFilter; i >= 0; i--) {
        const d = new Date(Date.now() - offset - (i * 86400000));
        const dStr = d.toISOString().split('T')[0];
        datesMap.set(dStr, 0);
    }

    // Populate actuals
    records.forEach(r => {
        if (datesMap.has(r.date)) {
            datesMap.set(r.date, (datesMap.get(r.date) || 0) + (Number(r.totalScore) || 0));
        }
    });

    const labels = Array.from(datesMap.keys()).map(d => {
        const parts = d.split('-');
        return `${parts[1]}/${parts[2]}`; // MM/DD
    });
    
    const dataPts = Array.from(datesMap.values());

    const ctx = document.getElementById('trendChart').getContext('2d');
    
    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Points Earned',
                data: dataPts,
                borderColor: '#198754',
                backgroundColor: 'rgba(25, 135, 84, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#198754',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}
