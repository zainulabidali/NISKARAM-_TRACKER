// ============================================
// NEW CENTRALIZED RECORDS DASHBOARD MODULE
// ============================================

let activeRecordsClassId = null;
let activeRecordsClassName = null;
let cachedClassStudents = [];
let cachedClassRecords = [];
let recordsState = {
    dateFilterType: 'range', // 'today', 'yesterday', 'custom', 'range'
    singleDate: todayStr,
    startDate: getDateAgo(30),
    endDate: todayStr,
    selectedStudentId: 'all',
    prayerStatus: 'all', // 'all', 'completed', 'missed', 'partial'
    searchQuery: '',
    sortBy: 'date',
    sortDirection: 'desc',
    currentPage: 1,
    pageSize: 10
};

// Expose state and functions globally for event handlers
function sortRecordsTable(col) {
    if (recordsState.sortBy === col) {
        recordsState.sortDirection = recordsState.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        recordsState.sortBy = col;
        recordsState.sortDirection = 'desc';
    }
    
    // Update sort headers UI
    const cols = ['date', 'name', 'admission', 'completion'];
    cols.forEach(c => {
        const el = document.getElementById(`sortCol_${c}`);
        if (el) {
            el.innerHTML = `${c === 'date' ? 'Date' : c === 'name' ? 'Student Name' : c === 'admission' ? 'Admission No' : 'Completion %'} <i class="bi bi-arrow-down-up ms-1" style="font-size: 0.75rem;"></i>`;
        }
    });
    
    const activeEl = document.getElementById(`sortCol_${col}`);
    if (activeEl) {
        const arrow = recordsState.sortDirection === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down';
        activeEl.innerHTML = `${col === 'date' ? 'Date' : col === 'name' ? 'Student Name' : col === 'admission' ? 'Admission No' : 'Completion %'} <i class="bi ${arrow} ms-1" style="font-size: 0.75rem;"></i>`;
    }
    
    refreshClassRecordsUI();
}
window.sortRecordsTable = sortRecordsTable;

function changeRecordsPage(page) {
    recordsState.currentPage = page;
    refreshClassRecordsUI();
}
window.changeRecordsPage = changeRecordsPage;

// Load list of classes for selection screen
async function loadRecordsClasses() {
    activeRecordsClassId = null;
    activeRecordsClassName = null;
    
    document.getElementById('recordsClassListView').classList.remove('d-none');
    document.getElementById('recordsDashboardView').classList.add('d-none');
    
    const grid = document.getElementById('recordsClassListGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>';
    
    try {
        if (!madrasaId) return;
        const q = query(collection(db, "classes"), where("madrasaId", "==", madrasaId));
        const snap = await getDocs(q);
        
        grid.innerHTML = '';
        if (snap.empty) {
            grid.innerHTML = `
                <div class="col-12 text-center py-4">
                    <p class="text-muted fw-bold">No classes found. Add classes in the Classes module first.</p>
                </div>`;
            return;
        }
        
        let classes = [];
        snap.forEach(d => classes.push({ id: d.id, ...d.data() }));
        classes.sort((a, b) => a.name.localeCompare(b.name));
        
        classes.forEach(c => {
            grid.innerHTML += `
                <div class="col-12 col-sm-6 col-md-4">
                    <div class="card p-4 class-card bg-white" onclick="openClassRecords('${c.id}', '${c.name.replace(/'/g, "\\'")}')">
                        <div class="d-flex align-items-center gap-3">
                            <div class="bg-primary bg-opacity-10 text-primary rounded-circle d-inline-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
                                <i class="bi bi-easel fs-4"></i>
                            </div>
                            <div>
                                <h6 class="fw-bold mb-1 text-dark">${c.name}</h6>
                                <small class="text-muted">Click to view records</small>
                            </div>
                        </div>
                    </div>
                </div>`;
        });
    } catch(err) {
        grid.innerHTML = `<div class="col-12 alert alert-danger">Failed to load classes: ${err.message}</div>`;
    }
}
window.loadRecordsClasses = loadRecordsClasses;

async function openClassRecords(classId, className) {
    activeRecordsClassId = classId;
    activeRecordsClassName = className;
    
    document.getElementById('recordsCurrentClassName').innerText = className;
    document.getElementById('recordsClassListView').classList.add('d-none');
    document.getElementById('recordsDashboardView').classList.remove('d-none');
    
    // Set default date range values (last 30 days)
    document.getElementById('recordsFilterStartDate').value = recordsState.startDate;
    document.getElementById('recordsFilterEndDate').value = recordsState.endDate;
    document.getElementById('recordsFilterSingleDate').value = recordsState.singleDate;
    
    // Set default dropdown selections
    document.getElementById('recordsFilterDateRange').value = recordsState.dateFilterType;
    document.getElementById('recordsFilterStudent').value = recordsState.selectedStudentId;
    document.getElementById('recordsFilterPrayerStatus').value = recordsState.prayerStatus;
    document.getElementById('recordsFilterSearch').value = recordsState.searchQuery;
    
    // Populate class in Report Center
    const reportClass = document.getElementById('pdfReportClass');
    if (reportClass) {
        reportClass.innerHTML = `<option value="${classId}">${className}</option>`;
    }
    
    // Fetch data
    await fetchRecordsClassData();
}
window.openClassRecords = openClassRecords;

async function fetchRecordsClassData() {
    const tbody = document.getElementById('recordsHistoryTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" class="text-center py-5">
                    <div class="spinner-border text-primary border-3" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="text-muted fw-bold mt-2">Loading class students & records...</p>
                </td>
            </tr>`;
    }
    
    try {
        if (!madrasaId || !activeRecordsClassId) return;
        
        // 1. Fetch Students
        const stuQ = query(collection(db, "students"), where("madrasaId", "==", madrasaId), where("classId", "==", activeRecordsClassId));
        const stuSnap = await getDocs(stuQ);
        cachedClassStudents = [];
        stuSnap.forEach(d => {
            cachedClassStudents.push({ id: d.id, ...d.data() });
        });
        cachedClassStudents.sort((a, b) => a.name.localeCompare(b.name));
        
        // Populate student filter dropdown
        const stuFilter = document.getElementById('recordsFilterStudent');
        if (stuFilter) {
            stuFilter.innerHTML = '<option value="all">All Students</option>';
            cachedClassStudents.forEach(s => {
                stuFilter.innerHTML += `<option value="${s.id}">${s.name} (${s.admission_number || 'None'})</option>`;
            });
        }
        
        // 2. Fetch Records
        const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("classId", "==", activeRecordsClassId));
        const recSnap = await getDocs(recQ);
        cachedClassRecords = [];
        recSnap.forEach(d => {
            cachedClassRecords.push({ id: d.id, ...d.data() });
        });
        
        // Sync PDF student list scope
        populateReportStudentSelect();
        
        // Refresh UI
        refreshClassRecordsUI();
    } catch(err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="12" class="alert alert-danger text-center">Failed to fetch dashboard data: ${err.message}</td></tr>`;
        }
    }
}

function refreshClassRecordsUI() {
    const { result, dateFilteredRecords } = getFilteredRecords();
    
    // 1. Calculate class overview metrics
    calculateClassMetrics(cachedClassStudents, cachedClassRecords, dateFilteredRecords);
    
    // 2. Sort records
    const sorted = getSortedRecords(result);
    
    // 3. Render table
    renderDashboardTable(sorted);
}

function getFilteredRecords() {
    let start = null;
    let end = null;
    
    if (recordsState.dateFilterType === 'today') {
        start = todayStr;
        end = todayStr;
    } else if (recordsState.dateFilterType === 'yesterday') {
        start = yesterdayStr;
        end = yesterdayStr;
    } else if (recordsState.dateFilterType === 'custom') {
        start = recordsState.singleDate;
        end = recordsState.singleDate;
    } else if (recordsState.dateFilterType === 'range') {
        start = recordsState.startDate;
        end = recordsState.endDate;
    }
    
    const dateFilteredRecords = cachedClassRecords.filter(r => {
        if (start && r.date < start) return false;
        if (end && r.date > end) return false;
        return true;
    });
    
    let result = [...dateFilteredRecords];
    
    // Filter by Student
    if (recordsState.selectedStudentId !== 'all') {
        result = result.filter(r => r.studentId === recordsState.selectedStudentId);
    }
    
    // Filter by Search Query (Student Name or Admission No)
    if (recordsState.searchQuery.trim() !== '') {
        const queryStr = recordsState.searchQuery.toLowerCase().trim();
        result = result.filter(r => {
            const student = cachedClassStudents.find(s => s.id === r.studentId);
            if (!student) return false;
            return student.name.toLowerCase().includes(queryStr) || 
                   (student.admission_number || '').toLowerCase().includes(queryStr);
        });
    }
    
    // Filter by Prayer Status
    if (recordsState.prayerStatus !== 'all') {
        result = result.filter(r => {
            const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
            const completedCount = keys.filter(k => {
                const val = r[k] || r.prayers?.[k];
                return val === 'Jamaat' || val === 'Individual';
            }).length;
            
            if (recordsState.prayerStatus === 'completed') {
                return completedCount === 5;
            } else if (recordsState.prayerStatus === 'missed') {
                return completedCount === 0;
            } else if (recordsState.prayerStatus === 'partial') {
                return completedCount > 0 && completedCount < 5;
            }
            return true;
        });
    }
    
    return { result, dateFilteredRecords };
}

function getSortedRecords(records) {
    const key = recordsState.sortBy;
    const dir = recordsState.sortDirection === 'asc' ? 1 : -1;
    
    return [...records].sort((a, b) => {
        if (key === 'date') {
            return a.date.localeCompare(b.date) * dir;
        } else if (key === 'name') {
            const stuA = cachedClassStudents.find(s => s.id === a.studentId)?.name || '';
            const stuB = cachedClassStudents.find(s => s.id === b.studentId)?.name || '';
            return stuA.localeCompare(stuB) * dir;
        } else if (key === 'admission') {
            const admA = cachedClassStudents.find(s => s.id === a.studentId)?.admission_number || '';
            const admB = cachedClassStudents.find(s => s.id === b.studentId)?.admission_number || '';
            return admA.localeCompare(admB) * dir;
        } else if (key === 'completion') {
            const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
            const compA = keys.filter(k => { const val = a[k] || a.prayers?.[k]; return val === 'Jamaat' || val === 'Individual'; }).length;
            const compB = keys.filter(k => { const val = b[k] || b.prayers?.[k]; return val === 'Jamaat' || val === 'Individual'; }).length;
            return (compA - compB) * dir;
        }
        return 0;
    });
}

function calculateClassMetrics(filteredStudents, filteredRecords, dateFilteredRecords) {
    const totalStudents = filteredStudents.length;
    const totalRecords = dateFilteredRecords.length;
    
    let totalCompleted = 0;
    let totalMissed = 0;
    
    dateFilteredRecords.forEach(r => {
        const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
        keys.forEach(k => {
            const val = r[k] || r.prayers?.[k];
            if (val === 'Jamaat' || val === 'Individual') {
                totalCompleted++;
            } else {
                totalMissed++;
            }
        });
    });
    
    const avgCompletion = totalRecords > 0 ? Math.round((totalCompleted / (totalRecords * 5)) * 100) : 0;
    
    let daysCount = 1;
    if (recordsState.dateFilterType === 'today' || recordsState.dateFilterType === 'yesterday') {
        daysCount = 1;
    } else if (recordsState.dateFilterType === 'custom') {
        daysCount = 1;
    } else if (recordsState.dateFilterType === 'range') {
        const start = new Date(recordsState.startDate);
        const end = new Date(recordsState.endDate);
        daysCount = Math.round((end - start) / 86400000) + 1;
        if (isNaN(daysCount) || daysCount < 1) daysCount = 1;
    }
    
    const totalExpectedRecords = totalStudents * daysCount;
    const attendancePct = totalExpectedRecords > 0 ? Math.min(Math.round((totalRecords / totalExpectedRecords) * 100), 100) : 0;
    
    document.getElementById('metricTotalStudents').innerText = totalStudents;
    document.getElementById('metricTotalRecords').innerText = totalRecords;
    document.getElementById('metricTotalCompleted').innerText = totalCompleted;
    document.getElementById('metricTotalMissed').innerText = totalMissed;
    document.getElementById('metricAvgCompletion').innerText = `${avgCompletion}%`;
    document.getElementById('metricAttendanceRate').innerText = `${attendancePct}%`;
}

function renderDashboardTable(records) {
    const tbody = document.getElementById('recordsHistoryTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const totalCount = records.length;
    const totalPages = Math.ceil(totalCount / recordsState.pageSize) || 1;
    
    if (recordsState.currentPage > totalPages) {
        recordsState.currentPage = totalPages;
    }
    
    const startIndex = (recordsState.currentPage - 1) * recordsState.pageSize;
    const endIndex = Math.min(startIndex + recordsState.pageSize, totalCount);
    
    const summaryText = document.getElementById('recordsTableSummaryText');
    if (summaryText) {
        summaryText.innerText = `Showing ${totalCount > 0 ? startIndex + 1 : 0} - ${endIndex} of ${totalCount} records`;
    }
    
    renderTablePagination(totalPages);
    
    if (totalCount === 0) {
        tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-muted fw-bold">No history records found matching this criteria.</td></tr>`;
        return;
    }
    
    const paginatedRecords = records.slice(startIndex, endIndex);
    
    paginatedRecords.forEach(r => {
        const student = cachedClassStudents.find(s => s.id === r.studentId);
        const studentName = student ? student.name : 'Unknown Student';
        const admissionNo = student ? (student.admission_number || 'None') : 'None';
        const className = activeRecordsClassName || 'Class';
        
        const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
        const completedCount = keys.filter(k => {
            const val = r[k] || r.prayers?.[k];
            return val === 'Jamaat' || val === 'Individual';
        }).length;
        const completionPct = Math.round((completedCount / 5) * 100);
        
        const getStatusBadge = (val) => {
            if (val === 'Jamaat') return `<span class="badge bg-success bg-opacity-10 text-success fw-bold py-1 px-2 rounded-pill" style="font-size: 0.75rem;"><i class="bi bi-people-fill me-1"></i>Jam</span>`;
            if (val === 'Individual') return `<span class="badge bg-warning bg-opacity-10 text-warning fw-bold py-1 px-2 rounded-pill" style="font-size: 0.75rem;"><i class="bi bi-person-fill me-1"></i>Ind</span>`;
            if (val === 'Incorrect') return `<span class="badge bg-secondary bg-opacity-10 text-secondary fw-bold py-1 px-2 rounded-pill" style="font-size: 0.75rem;"><i class="bi bi-exclamation-triangle me-1"></i>Inc</span>`;
            if (val === 'Not Prayed') return `<span class="badge bg-danger bg-opacity-10 text-danger fw-bold py-1 px-2 rounded-pill" style="font-size: 0.75rem;"><i class="bi bi-x-circle me-1"></i>Mis</span>`;
            return `<span class="text-muted">—</span>`;
        };
        
        const fVal = r.fajr || r.prayers?.fajr;
        const dVal = r.dhuhr || r.prayers?.dhuhr;
        const aVal = r.asr || r.prayers?.asr;
        const mVal = r.maghrib || r.prayers?.maghrib;
        const iVal = r.isha || r.prayers?.isha;
        
        const studiedQuran = r.subjects?.includes('quran') || r.subjects?.some(s => s.toLowerCase().includes('quran')) ? 'Yes' : 'No';
        const salawat = r.salawatCount || 0;
        let remarks = [];
        if (studiedQuran === 'Yes') remarks.push('Quran');
        if (salawat > 0) remarks.push(`Salawat: ${salawat}`);
        if (r.subjectScore > 0) remarks.push(`Subj: ${r.subjectScore}`);
        const remarksStr = remarks.length > 0 ? remarks.join(', ') : 'None';
        
        tbody.innerHTML += `
            <tr class="border-bottom border-light">
                <td class="fw-bold text-dark">${r.date}</td>
                <td><span class="fw-bold text-primary">${studentName}</span></td>
                <td class="text-muted fw-bold">${admissionNo}</td>
                <td><span class="badge bg-light text-dark border">${className}</span></td>
                <td class="text-center">${getStatusBadge(fVal)}</td>
                <td class="text-center">${getStatusBadge(dVal)}</td>
                <td class="text-center">${getStatusBadge(aVal)}</td>
                <td class="text-center">${getStatusBadge(mVal)}</td>
                <td class="text-center">${getStatusBadge(iVal)}</td>
                <td class="text-center"><strong class="${completionPct >= 80 ? 'text-success' : completionPct >= 50 ? 'text-warning' : 'text-danger'}">${completionPct}%</strong></td>
                <td class="text-muted small">${remarksStr}</td>
                <td class="text-center">
                    <div class="d-flex justify-content-center gap-1">
                        <button class="btn btn-sm btn-outline-success rounded-pill px-2 py-0" onclick="openEditRecordModalFromTable('${r.id}', '${r.studentId}')" title="Edit Record"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-sm btn-outline-danger rounded-pill px-2 py-0" onclick="deleteClassRecord('${r.id}')" title="Delete Record"><i class="bi bi-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });
}

function renderTablePagination(totalPages) {
    const list = document.getElementById('recordsTablePagination');
    if (!list) return;
    list.innerHTML = '';
    
    if (totalPages <= 1) return;
    
    list.innerHTML += `
        <li class="page-item ${recordsState.currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changeRecordsPage(${recordsState.currentPage - 1}); return false;">&laquo;</a>
        </li>
    `;
    
    for (let i = 1; i <= totalPages; i++) {
        list.innerHTML += `
            <li class="page-item ${recordsState.currentPage === i ? 'active' : ''}">
                <a class="page-link" href="#" onclick="changeRecordsPage(${i}); return false;">${i}</a>
            </li>
        `;
    }
    
    list.innerHTML += `
        <li class="page-item ${recordsState.currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changeRecordsPage(${recordsState.currentPage + 1}); return false;">&raquo;</a>
        </li>
    `;
}

async function deleteClassRecord(recordId) {
    if (confirm("Are you sure you want to permanently delete this prayer record?")) {
        try {
            await deleteDoc(doc(db, "records", recordId));
            
            // Reload local cache
            const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("classId", "==", activeRecordsClassId));
            const recSnap = await getDocs(recQ);
            cachedClassRecords = [];
            recSnap.forEach(d => {
                cachedClassRecords.push({ id: d.id, ...d.data() });
            });
            
            refreshClassRecordsUI();
        } catch(e) {
            alert("Error deleting record: " + e.message);
        }
    }
}
window.deleteClassRecord = deleteClassRecord;

// Bind Filters UI Actions
function initRecordsRedesignListeners() {
    // 1. Date Filter Range type selector
    document.getElementById('recordsFilterDateRange').addEventListener('change', (e) => {
        recordsState.dateFilterType = e.target.value;
        recordsState.currentPage = 1;
        
        const singleCol = document.getElementById('filterSingleDateCol');
        const startCol = document.getElementById('filterStartDateCol');
        const endCol = document.getElementById('filterEndDateCol');
        
        if (recordsState.dateFilterType === 'custom') {
            singleCol.classList.remove('d-none');
            startCol.classList.add('d-none');
            endCol.classList.add('d-none');
        } else if (recordsState.dateFilterType === 'range') {
            singleCol.classList.add('d-none');
            startCol.classList.remove('d-none');
            endCol.classList.remove('d-none');
        } else {
            singleCol.classList.add('d-none');
            startCol.classList.add('d-none');
            endCol.classList.add('d-none');
        }
        
        refreshClassRecordsUI();
    });
    
    // Date input listeners
    document.getElementById('recordsFilterSingleDate').addEventListener('change', (e) => {
        recordsState.singleDate = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    document.getElementById('recordsFilterStartDate').addEventListener('change', (e) => {
        recordsState.startDate = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    document.getElementById('recordsFilterEndDate').addEventListener('change', (e) => {
        recordsState.endDate = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    
    // Student dropdown listener
    document.getElementById('recordsFilterStudent').addEventListener('change', (e) => {
        recordsState.selectedStudentId = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    
    // Prayer status select listener
    document.getElementById('recordsFilterPrayerStatus').addEventListener('change', (e) => {
        recordsState.prayerStatus = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    
    // Search text input listener
    document.getElementById('recordsFilterSearch').addEventListener('input', (e) => {
        recordsState.searchQuery = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    
    // Reset filters button click
    document.getElementById('recordsFilterResetBtn').addEventListener('click', () => {
        recordsState.dateFilterType = 'range';
        recordsState.singleDate = todayStr;
        recordsState.startDate = getDateAgo(30);
        recordsState.endDate = todayStr;
        recordsState.selectedStudentId = 'all';
        recordsState.prayerStatus = 'all';
        recordsState.searchQuery = '';
        recordsState.sortBy = 'date';
        recordsState.sortDirection = 'desc';
        recordsState.currentPage = 1;
        
        document.getElementById('recordsFilterDateRange').value = 'range';
        document.getElementById('recordsFilterSingleDate').value = todayStr;
        document.getElementById('recordsFilterStartDate').value = recordsState.startDate;
        document.getElementById('recordsFilterEndDate').value = todayStr;
        document.getElementById('recordsFilterStudent').value = 'all';
        document.getElementById('recordsFilterPrayerStatus').value = 'all';
        document.getElementById('recordsFilterSearch').value = '';
        
        document.getElementById('filterSingleDateCol').classList.add('d-none');
        document.getElementById('filterStartDateCol').classList.remove('d-none');
        document.getElementById('filterEndDateCol').classList.remove('d-none');
        
        refreshClassRecordsUI();
    });
    
    // Back to Class list view button
    document.getElementById('btnBackToClasses').addEventListener('click', () => {
        loadRecordsClasses();
    });

    // Record Update modal save logic
    document.getElementById('saveRecordEditBtn').onclick = async () => {
        const recordId = document.getElementById('editRecordId').value;
        const studentId = document.getElementById('editHistoryStudentId').value;
        const subjectScore = parseInt(document.getElementById('editSubjectScore').value) || 0;
        const salawatCount = parseInt(document.getElementById('editSalawatCount').value) || 0;
        
        const prayers = {};
        let prayerScore = 0;
        const PRAYER_SCORES = { "Jamaat": 2, "Individual": 1, "Incorrect": 0, "Not Prayed": 0 };
        
        const selects = document.querySelectorAll('.prayer-edit-select');
        selects.forEach(s => {
            const key = s.dataset.key;
            const val = s.value;
            prayers[key] = val;
            prayerScore += PRAYER_SCORES[val] || 0;
        });
        
        const totalScore = prayerScore + subjectScore;
        
        const btn = document.getElementById('saveRecordEditBtn');
        btn.disabled = true;
        btn.innerText = "Updating...";
        
        try {
            const recordRef = doc(db, "records", recordId);
            const recordCheck = await getDoc(recordRef);
            
            const payload = {
                prayers,
                prayerScore,
                subjectScore,
                totalScore,
                salawatCount,
                timestamp: new Date().toISOString()
            };
            
            if (recordCheck.exists()) {
                await updateDoc(recordRef, payload);
            } else {
                // If it is a quick add, create full record doc
                const dateStr = recordId.split('_')[1];
                await setDoc(recordRef, {
                    madrasaId,
                    studentId,
                    classId: activeRecordsClassId,
                    date: dateStr,
                    ...payload
                });
            }
            
            bootstrap.Modal.getInstance(document.getElementById('recordEditModal')).hide();
            
            // Reload local cache
            const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("classId", "==", activeRecordsClassId));
            const recSnap = await getDocs(recQ);
            cachedClassRecords = [];
            recSnap.forEach(d => {
                cachedClassRecords.push({ id: d.id, ...d.data() });
            });
            
            refreshClassRecordsUI();
        } catch(err) {
            alert("Failed to update record: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerText = "Update Record";
        }
    };
    
    // PDF Report type dynamic fields
    document.getElementById('pdfReportType').addEventListener('change', updateReportPeriodInputs);
    document.getElementById('pdfReportScope').addEventListener('change', (e) => {
        const studentCol = document.getElementById('pdfReportStudentCol');
        if (e.target.value === 'single') {
            studentCol.classList.remove('d-none');
            populateReportStudentSelect();
        } else {
            studentCol.classList.add('d-none');
        }
    });
    
    // Report Center Buttons
    document.getElementById('btnPreviewReport').addEventListener('click', () => triggerReportAction('preview'));
    document.getElementById('btnPrintReportCenter').addEventListener('click', () => triggerReportAction('print'));
    document.getElementById('btnDownloadReport').addEventListener('click', () => triggerReportAction('download'));
    
    document.getElementById('btnPrintFromPreview').addEventListener('click', () => {
        bootstrap.Modal.getInstance(document.getElementById('pdfPreviewModal')).hide();
        triggerReportAction('print');
    });
    document.getElementById('btnDownloadFromPreview').addEventListener('click', () => {
        bootstrap.Modal.getInstance(document.getElementById('pdfPreviewModal')).hide();
        triggerReportAction('download');
    });
    
    // Set initial dynamic fields for period selector
    updateReportPeriodInputs();
}

// PDF REPORT CENTER LOGIC
function populateReportStudentSelect() {
    const studentSelect = document.getElementById('pdfReportStudent');
    if (!studentSelect) return;
    studentSelect.innerHTML = '';
    cachedClassStudents.forEach(s => {
        studentSelect.innerHTML += `<option value="${s.id}">${s.name} (${s.admission_number || 'None'})</option>`;
    });
}

function updateReportPeriodInputs() {
    const type = document.getElementById('pdfReportType').value;
    const label = document.getElementById('pdfPeriodLabel');
    const container = document.getElementById('pdfPeriodInputs');
    if (!container) return;
    
    if (type === 'daily') {
        label.innerText = "Select Date";
        container.innerHTML = `<input type="date" id="pdfPeriodDaily" class="form-control bg-light border-0 shadow-sm fw-bold" value="${todayStr}">`;
    } else if (type === 'weekly') {
        label.innerText = "Select Date in Week";
        container.innerHTML = `<input type="date" id="pdfPeriodWeekly" class="form-control bg-light border-0 shadow-sm fw-bold" value="${todayStr}">`;
    } else if (type === 'monthly') {
        label.innerText = "Select Month & Year";
        
        let monthOptions = '';
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const currMonth = new Date().getMonth();
        months.forEach((m, idx) => {
            monthOptions += `<option value="${idx}" ${idx === currMonth ? 'selected' : ''}>${m}</option>`;
        });
        
        let yearOptions = '';
        const currYear = new Date().getFullYear();
        for (let y = currYear - 3; y <= currYear + 3; y++) {
            yearOptions += `<option value="${y}" ${y === currYear ? 'selected' : ''}>${y}</option>`;
        }
        
        container.innerHTML = `
            <div class="d-flex gap-2">
                <select id="pdfPeriodMonth" class="form-select bg-light border-0 shadow-sm fw-bold w-50">
                    ${monthOptions}
                </select>
                <select id="pdfPeriodYear" class="form-select bg-light border-0 shadow-sm fw-bold w-50">
                    ${yearOptions}
                </select>
            </div>`;
    }
}

async function triggerReportAction(action) {
    const type = document.getElementById('pdfReportType').value;
    const scope = document.getElementById('pdfReportScope').value;
    
    let startStr = '';
    let endStr = '';
    let periodStr = '';
    
    if (type === 'daily') {
        const inputVal = document.getElementById('pdfPeriodDaily').value;
        if (!inputVal) { alert("Please select a date."); return; }
        startStr = inputVal;
        endStr = inputVal;
        periodStr = new Date(inputVal).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
    } else if (type === 'weekly') {
        const inputVal = document.getElementById('pdfPeriodWeekly').value;
        if (!inputVal) { alert("Please select a date in the week."); return; }
        const baseDate = new Date(inputVal);
        const day = baseDate.getDay();
        const sun = new Date(baseDate);
        sun.setDate(baseDate.getDate() - day);
        const sat = new Date(baseDate);
        sat.setDate(baseDate.getDate() + (6 - day));
        
        startStr = sun.toISOString().split('T')[0];
        endStr = sat.toISOString().split('T')[0];
        periodStr = `Week of ${sun.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} to ${sat.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    } else if (type === 'monthly') {
        const m = parseInt(document.getElementById('pdfPeriodMonth').value);
        const y = parseInt(document.getElementById('pdfPeriodYear').value);
        
        const pad = (n) => String(n).padStart(2, '0');
        startStr = `${y}-${pad(m+1)}-01`;
        const lastDay = new Date(y, m + 1, 0).getDate();
        endStr = `${y}-${pad(m+1)}-${pad(lastDay)}`;
        
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        periodStr = `${monthNames[m]} ${y}`;
    }
    
    // Retrieve Institution Name
    let instName = "Niskaram Madrasa Tracker";
    try {
        const mDoc = await getDoc(doc(db, "madrasas", madrasaId));
        if (mDoc.exists()) {
            instName = mDoc.data().name || instName;
        }
    } catch(e) {}
    
    if (scope === 'all') {
        generateAllStudentsReport(action, instName, periodStr, startStr, endStr);
    } else {
        const studentId = document.getElementById('pdfReportStudent').value;
        if (!studentId) { alert("Please select a student."); return; }
        generateSingleStudentReport(action, instName, studentId, periodStr, startStr, endStr);
    }
}

function generateAllStudentsReport(action, instName, periodStr, startStr, endStr) {
    const reportRecords = cachedClassRecords.filter(r => r.date >= startStr && r.date <= endStr);
    
    let html = `
        <div class="print-header">
            <h1 class="print-title">${instName}</h1>
            <p class="print-subtitle"><strong>All Students Performance Report</strong></p>
            <p class="print-subtitle">Class: <strong>${activeRecordsClassName}</strong> | Period: <strong>${periodStr}</strong> | Generated: ${todayStr}</p>
        </div>
        
        <table class="print-table">
            <thead>
                <tr>
                    <th style="width: 50px;">S.No</th>
                    <th style="width: 120px;">Admission No</th>
                    <th style="text-align: left;">Student Name</th>
                    <th>Completed</th>
                    <th>Missed</th>
                    <th>Completion %</th>
                    <th>Attendance %</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    let overallCompleted = 0;
    let overallMissed = 0;
    let totalPctSum = 0;
    
    // Period Expected Days
    const start = new Date(startStr);
    const end = new Date(endStr);
    let calendarDays = Math.round((end - start) / 86400000) + 1;
    if (isNaN(calendarDays) || calendarDays < 1) calendarDays = 1;
    
    const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const pStats = { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
    
    cachedClassStudents.forEach((student, idx) => {
        const studentRecs = reportRecords.filter(r => r.studentId === student.id);
        
        let completed = 0;
        let missed = 0;
        
        studentRecs.forEach(r => {
            keys.forEach(k => {
                const val = r[k] || r.prayers?.[k];
                if (val === 'Jamaat' || val === 'Individual') {
                    completed++;
                    pStats[k]++;
                } else {
                    missed++;
                }
            });
        });
        
        overallCompleted += completed;
        overallMissed += missed;
        
        const totalPrayersCount = studentRecs.length * 5;
        const completionPct = totalPrayersCount > 0 ? Math.round((completed / totalPrayersCount) * 100) : 0;
        totalPctSum += completionPct;
        
        const attendancePct = Math.min(Math.round((studentRecs.length / calendarDays) * 100), 100);
        
        html += `
            <tr>
                <td>${idx + 1}</td>
                <td>${student.admission_number || 'None'}</td>
                <td style="text-align: left; font-weight: bold;">${student.name}</td>
                <td>${completed}</td>
                <td>${missed}</td>
                <td class="${completionPct >= 80 ? 'print-badge-completed' : completionPct >= 50 ? 'print-badge-incorrect' : 'print-badge-missed'}">${completionPct}%</td>
                <td>${attendancePct}%</td>
            </tr>
        `;
    });
    
    const averageCompletion = cachedClassStudents.length > 0 ? Math.round(totalPctSum / cachedClassStudents.length) : 0;
    
    html += `
            </tbody>
        </table>
        
        <h4 style="margin-top: 30px; color: #1f7a63; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Prayer-wise Summary Statistics</h4>
        <table class="print-table" style="margin-top: 10px;">
            <thead>
                <tr>
                    <th>Fajr</th>
                    <th>Dhuhr</th>
                    <th>Asr</th>
                    <th>Maghrib</th>
                    <th>Isha</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>${pStats.fajr} completed</td>
                    <td>${pStats.dhuhr} completed</td>
                    <td>${pStats.asr} completed</td>
                    <td>${pStats.maghrib} completed</td>
                    <td>${pStats.isha} completed</td>
                </tr>
            </tbody>
        </table>

        <div style="margin-top: 25px; background-color: #f9f9f9; padding: 15px; border-radius: 8px; border: 1px solid #eee;">
            <h5 style="margin-top:0; color:#333; font-weight:bold;">Overall Summary Totals</h5>
            <div style="display:flex; justify-content:space-between; font-size:10pt;">
                <div>Total Students: <strong>${cachedClassStudents.length}</strong></div>
                <div>Total Logs Registered: <strong>${reportRecords.length}</strong></div>
                <div>Total Completed Prayers: <strong class="print-badge-completed">${overallCompleted}</strong></div>
                <div>Total Missed Prayers: <strong class="print-badge-missed">${overallMissed}</strong></div>
                <div>Average Class Completion: <strong>${averageCompletion}%</strong></div>
            </div>
        </div>
        
        <div style="margin-top: 60px; display: flex; justify-content: space-between; font-size: 10pt;">
            <div>Report Evaluator Signature: ______________________</div>
            <div>Date: _______________</div>
        </div>
    `;
    
    handleReportOutput(action, html, `All_Students_Report_${activeRecordsClassName}`);
}

async function generateSingleStudentReport(action, instName, studentId, periodStr, startStr, endStr) {
    const student = cachedClassStudents.find(s => s.id === studentId);
    if (!student) { alert("Student not found."); return; }
    
    const studentRecs = cachedClassRecords.filter(r => r.studentId === studentId && r.date >= startStr && r.date <= endStr);
    studentRecs.sort((a, b) => a.date.localeCompare(b.date));
    
    // Period Expected Days
    const start = new Date(startStr);
    const end = new Date(endStr);
    let calendarDays = Math.round((end - start) / 86400000) + 1;
    if (isNaN(calendarDays) || calendarDays < 1) calendarDays = 1;
    
    let completed = 0;
    let missed = 0;
    const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    
    let tableRows = '';
    studentRecs.forEach(r => {
        const getStatusSymbol = (k) => {
            const val = r[k] || r.prayers?.[k];
            if (val === 'Jamaat') { completed++; return 'Jam (Y)'; }
            if (val === 'Individual') { completed++; return 'Ind (Y)'; }
            if (val === 'Incorrect') { missed++; return 'Inc (N)'; }
            if (val === 'Not Prayed') { missed++; return 'Mis (N)'; }
            missed++;
            return '—';
        };
        
        const fStatus = getStatusSymbol('fajr');
        const dStatus = getStatusSymbol('dhuhr');
        const aStatus = getStatusSymbol('asr');
        const mStatus = getStatusSymbol('maghrib');
        const iStatus = getStatusSymbol('isha');
        
        const studiedQuran = r.subjects?.includes('quran') || r.subjects?.some(s => s.toLowerCase().includes('quran')) ? 'Y' : '—';
        const salawat = r.salawatCount || 0;
        const subjScore = r.subjectScore || 0;
        
        tableRows += `
            <tr>
                <td style="font-weight:bold;">${r.date}</td>
                <td>${fStatus}</td>
                <td>${dStatus}</td>
                <td>${aStatus}</td>
                <td>${mStatus}</td>
                <td>${iStatus}</td>
                <td>${studiedQuran}</td>
                <td>${salawat}</td>
                <td>${subjScore}</td>
                <td><strong>${r.totalScore || 0}</strong></td>
            </tr>
        `;
    });
    
    const totalPrayersCount = studentRecs.length * 5;
    const completionPct = totalPrayersCount > 0 ? Math.round((completed / totalPrayersCount) * 100) : 0;
    const attendancePct = Math.min(Math.round((studentRecs.length / calendarDays) * 100), 100);
    const accumulatedPoints = studentRecs.reduce((sum, r) => sum + (Number(r.totalScore) || 0), 0);
    
    // Rank logic
    let classRank = '-';
    try {
        const allStudentScores = {};
        cachedClassStudents.forEach(s => allStudentScores[s.id] = 0);
        
        // Accumulate points for all students in class in this period
        const periodRecords = cachedClassRecords.filter(r => r.date >= startStr && r.date <= endStr);
        periodRecords.forEach(r => {
            if (allStudentScores[r.studentId] !== undefined) {
                allStudentScores[r.studentId] += Number(r.totalScore) || 0;
            }
        });
        
        const ranking = Object.entries(allStudentScores).sort((a, b) => b[1] - a[1]);
        const rankIndex = ranking.findIndex(entry => entry[0] === studentId) + 1;
        if (rankIndex > 0) classRank = `#${rankIndex}`;
    } catch(e) {}

    let performanceSummary = "Weak consistency. Needs improvement in regular tracking.";
    if (completionPct >= 80 && attendancePct >= 80) {
        performanceSummary = "Excellent dedication! Maintaining highly regular prayer consistency.";
    } else if (completionPct >= 60 && attendancePct >= 60) {
        performanceSummary = "Good effort. Stable prayer attendance. Keep practicing.";
    }
    
    let html = `
        <div class="print-header">
            <h1 class="print-title">${instName}</h1>
            <p class="print-subtitle"><strong>Student Performance Report Card</strong></p>
            <p class="print-subtitle">Period: <strong>${periodStr}</strong> | Generated: ${todayStr}</p>
        </div>
        
        <div style="background-color: #fcfcfc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
            <div class="row" style="display:flex; flex-wrap:wrap; font-size:10pt;">
                <div style="flex:1; min-width:200px;">
                    <div>Student Name: <strong>${student.name}</strong></div>
                    <div>Admission No: <strong>${student.admission_number || '-'}</strong></div>
                    <div>Class: <strong>${activeRecordsClassName}</strong></div>
                </div>
                <div style="flex:1; min-width:200px; border-left:1px solid #e2e8f0; padding-left:20px;">
                    <div>Class Rank: <strong>${classRank}</strong></div>
                    <div>Prayer Completion: <strong>${completionPct}%</strong></div>
                    <div>Attendance Rate: <strong>${attendancePct}%</strong></div>
                    <div>Accumulated Points: <strong>${accumulatedPoints} pts</strong></div>
                </div>
            </div>
        </div>
        
        <h4 style="color:#1f7a63; border-bottom:1px solid #ddd; padding-bottom:5px; margin-top:25px;">Prayer Log Details</h4>
        <table class="print-table" style="margin-top: 10px; font-size: 8.5pt;">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Fajr</th>
                    <th>Dhuhr</th>
                    <th>Asr</th>
                    <th>Maghrib</th>
                    <th>Isha</th>
                    <th>Quran</th>
                    <th>Salawat</th>
                    <th>Subjects</th>
                    <th>Points</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows || '<tr><td colspan="10" class="text-center py-3 text-muted">No records found for this student in the selected period.</td></tr>'}
            </tbody>
        </table>
        
        <div style="margin-top: 20px; font-size: 8pt; color: #555;">
            * Legend: <strong>Jam (Y)</strong>: Prayed in Congregation, <strong>Ind (Y)</strong>: Prayed Individually, <strong>Inc (N)</strong>: Mistakenly Prayed, <strong>Mis (N)</strong>: Missed, <strong>—</strong>: No Entry.
        </div>
        
        <div style="margin-top: 20px; background-color: #f9f9f9; padding: 10px 15px; border-radius: 6px; border:1px solid #eee; font-size:9pt;">
            <strong>Teacher Performance Evaluation Summary:</strong><br/>
            <span class="text-muted">${performanceSummary}</span>
        </div>
        
        <div style="margin-top: 60px; display: flex; justify-content: space-between; font-size: 10pt;">
            <div>Class Teacher Signature: ______________________</div>
            <div>Parent Signature: ______________________</div>
        </div>
    `;
    
    handleReportOutput(action, html, `Student_Report_${student.name.replace(/\s+/g, '_')}`);
}

function handleReportOutput(action, html, filename) {
    if (action === 'preview') {
        const previewContent = document.getElementById('pdfPreviewContent');
        if (previewContent) {
            previewContent.innerHTML = html;
            const modal = new bootstrap.Modal(document.getElementById('pdfPreviewModal'));
            modal.show();
        }
    } else if (action === 'print' || action === 'download') {
        // Setup print container
        const existing = document.getElementById('printReportContainer');
        if (existing) existing.remove();
        
        const container = document.createElement('div');
        container.id = 'printReportContainer';
        container.innerHTML = html;
        document.body.appendChild(container);
        
        // Add printing layout class to body
        document.body.classList.add('printing-report');
        
        if (action === 'download') {
            console.log("Downloading report as PDF via Print Dialog.");
        }
        
        window.print();
        
        document.body.classList.remove('printing-report');
        container.remove();
    }
}
