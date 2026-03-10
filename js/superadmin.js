import { auth, db } from './firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js';
import { collection, query, getDocs, doc, setDoc, updateDoc, getDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js';

// Re-initialize firebase config to create secondary app for creating users without logging out
const firebaseConfig = {
    apiKey: "AIzaSyDJ3uQLXF2z1EDlPopQwNJSVcGBc-rObHo",
    authDomain: "niskaram-tracker.firebaseapp.com",
    projectId: "niskaram-tracker",
    storageBucket: "niskaram-tracker.firebasestorage.app",
    messagingSenderId: "638791881406",
    appId: "1:638791881406:web:01bfd69062fd193726c4ef"
};
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

const SUPER_ADMIN_UID = 'mt0k0d3UeAgcB8RTzq5k3M97UKa2';

// Protect route
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (user.uid === SUPER_ADMIN_UID) {
            loadMadrasas();
            return;
        } else {
            signOut(auth).then(() => {
                window.location.href = 'login.html';
            });
        }
    } else {
        window.location.href = 'login.html';
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => window.location.href = 'login.html');
});

document.getElementById('refreshBtn').addEventListener('click', loadMadrasas);

async function loadMadrasas() {
    const madrasasList = document.getElementById('madrasasList');
    madrasasList.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>';

    try {
        const q = query(collection(db, "madrasas"));
        const querySnapshot = await getDocs(q);

        madrasasList.innerHTML = '';

        if (querySnapshot.empty) {
            madrasasList.innerHTML = '<div class="alert alert-light text-center">No Madrasas found. Create one above!</div>';
            return;
        }

        querySnapshot.forEach((docSnap) => {
            const m = docSnap.data();
            const isExpired = new Date(m.expiryDate) < new Date();
            const statusBadge = isExpired
                ? '<span class="badge bg-danger">Expired</span>'
                : '<span class="badge bg-success">Active</span>';

            madrasasList.innerHTML += `
        <div class="card p-3 shadow-sm border-0 rounded-4">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <h6 class="mb-0 fw-bold text-dark">${m.name}</h6>
            ${statusBadge}
          </div>
          <p class="mb-1 small text-muted"><i class="bi bi-person me-1"></i> Admin: ${m.adminEmail}</p>
          <p class="mb-3 small text-muted"><i class="bi bi-calendar-x me-1"></i> Expiry: ${m.expiryDate}</p>
          
          <div class="d-flex gap-2 align-items-center mb-3">
             <button class="btn btn-sm btn-outline-primary fw-bold px-3 rounded-pill flex-grow-1 edit-madrasa-btn" data-id="${docSnap.id}" data-name="${m.name}"><i class="bi bi-pencil-square me-1"></i> Edit</button>
             <button class="btn btn-sm btn-outline-info fw-bold px-3 rounded-pill flex-grow-1 view-admin-btn" data-email="${m.adminEmail}"><i class="bi bi-person-badge me-1"></i> Admin</button>
             <button class="btn btn-sm btn-outline-danger fw-bold px-3 rounded-pill flex-grow-1 delete-madrasa-btn" data-id="${docSnap.id}"><i class="bi bi-trash me-1"></i> Delete</button>
          </div>
          
          <div class="d-flex gap-2 align-items-center mt-2 pt-2 border-top">
              <input type="number" id="ext-${docSnap.id}" class="form-control form-control-sm bg-light border-0" placeholder="Ext Days" style="width:100px;">
              <button class="btn btn-sm btn-accent renew-btn fw-bold px-3 rounded-pill" data-id="${docSnap.id}">Extend</button>
              <button class="btn btn-sm ${m.status === 'active' ? 'btn-danger' : 'btn-success'} toggle-status-btn fw-bold px-3 rounded-pill ms-auto" data-id="${docSnap.id}" data-current="${m.status}">
                  ${m.status === 'active' ? 'Deactivate' : 'Activate'}
              </button>
          </div>
        </div>
      `;
        });

        // Setup Delete Madrasa
        document.querySelectorAll('.delete-madrasa-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetBtn = e.target.closest('button');
                const id = targetBtn.getAttribute('data-id');
                if (confirm('Are you sure you want to completely DELETE this Madrasa? This action cannot be undone.')) {
                    await deleteDoc(doc(db, "madrasas", id));
                    loadMadrasas();
                }
            });
        });

        // Setup Edit Madrasa
        document.querySelectorAll('.edit-madrasa-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetBtn = e.target.closest('button');
                const id = targetBtn.getAttribute('data-id');
                const name = targetBtn.getAttribute('data-name');
                if (!window.editMadrasaModalObj) {
                    window.editMadrasaModalObj = new bootstrap.Modal(document.getElementById('editMadrasaModal'));
                }
                document.getElementById('editMadrasaId').value = id;
                document.getElementById('editMadrasaName').value = name;
                window.editMadrasaModalObj.show();
            });
        });

        // Setup View Admin
        document.querySelectorAll('.view-admin-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetBtn = e.target.closest('button');
                const email = targetBtn.getAttribute('data-email');
                if (!window.viewAdminModalObj) {
                    window.viewAdminModalObj = new bootstrap.Modal(document.getElementById('viewAdminModal'));
                }
                document.getElementById('adminEmailDisplay').innerText = email;
                document.getElementById('adminInitial').innerHTML = email.charAt(0).toUpperCase();
                window.viewAdminModalObj.show();
            });
        });

        // Attach event listeners for Extend buttons
        document.querySelectorAll('.renew-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                const days = parseInt(document.getElementById(`ext-${id}`).value);
                if (days && days > 0) {
                    const origText = e.target.innerHTML;
                    e.target.innerHTML = "...";
                    e.target.disabled = true;
                    try {
                        // Logic: add days to current Expiry Date
                        const mDoc = await getDoc(doc(db, "madrasas", id));
                        const currExp = new Date(mDoc.data().expiryDate);
                        currExp.setDate(currExp.getDate() + days);

                        await updateDoc(doc(db, "madrasas", id), {
                            expiryDate: currExp.toISOString().split('T')[0],
                            status: "active"
                        });
                        loadMadrasas();
                    } catch (err) {
                        alert('Error updating: ' + err.message);
                        e.target.innerHTML = origText;
                        e.target.disabled = false;
                    }
                }
            });
        });

        // Attach event listeners for Toggle Status
        document.querySelectorAll('.toggle-status-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                const currentStatus = e.target.getAttribute('data-current');
                const newStatus = currentStatus === 'active' ? 'inactive' : 'active';

                if (confirm(`Are you sure you want to ${newStatus === 'active' ? 'ACTIVATE' : 'DEACTIVATE'} this Madrasa?`)) {
                    await updateDoc(doc(db, "madrasas", id), { status: newStatus });
                    loadMadrasas();
                }
            });
        });
    } catch (error) {
        madrasasList.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
    }
}

document.getElementById('createMadrasaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('createBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';

    const name = document.getElementById('mName').value;
    const email = document.getElementById('mEmail').value;
    const password = document.getElementById('mPassword').value;
    const startDate = document.getElementById('mStartDate').value;
    const validityDays = parseInt(document.getElementById('mValidity').value);

    // Calculate expiry
    const sDateObj = new Date(startDate);
    sDateObj.setDate(sDateObj.getDate() + validityDays);
    const expiryDate = sDateObj.toISOString().split('T')[0];

    try {
        // 1. Generate new ID for Madrasa using standard collection append (without saving yet)
        const newMadrasaRef = doc(collection(db, "madrasas"));
        const madrasaId = newMadrasaRef.id;

        // 2. Create User via Secondary App to prevent logging out
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUserId = userCredential.user.uid;

        // 3. Save Admin document
        await setDoc(doc(db, "admins", newUserId), {
            email: email,
            madrasaId: madrasaId,
            isSuperAdmin: false,
            createdAt: new Date().toISOString()
        });

        // 4. Save Madrasa Document
        await setDoc(newMadrasaRef, {
            name: name,
            adminId: newUserId,
            adminEmail: email,
            expiryDate: expiryDate,
            status: "active",
            startDate: new Date().toISOString()
        });

        // Sign out secondary auth to be safe
        await signOut(secondaryAuth);

        alert("Madrasa created successfully!");
        e.target.reset();
        loadMadrasas();
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Create Madrasa & Admin';
    }
});

document.getElementById('saveMadrasaEditBtn')?.addEventListener('click', async () => {
    const id = document.getElementById('editMadrasaId').value;
    const name = document.getElementById('editMadrasaName').value;
    const btn = document.getElementById('saveMadrasaEditBtn');
    btn.disabled = true;
    btn.innerText = 'Saving...';

    try {
        await updateDoc(doc(db, "madrasas", id), { name });
        window.editMadrasaModalObj.hide();
        loadMadrasas();
    } catch (e) {
        alert("Error updating Madrasa: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save Changes';
    }
});
