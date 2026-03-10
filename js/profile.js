import { db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';
import { injectBottomNav } from './app.js';

document.addEventListener('DOMContentLoaded', async () => {
    injectBottomNav('profile');

    const madrasaId = localStorage.getItem('activeMadrasaId');
    const nameEl = document.getElementById('madrasaName');
    const leaveBtn = document.getElementById('leaveMadrasaBtn');

    if (madrasaId) {
        try {
            const docSnap = await getDoc(doc(db, "madrasas", madrasaId));
            if (docSnap.exists()) {
                nameEl.innerText = docSnap.data().name;
                leaveBtn.classList.remove('d-none');
            } else {
                nameEl.innerText = "Madrasa Not Found";
                localStorage.removeItem('activeMadrasaId');
            }
        } catch (e) {
            nameEl.innerText = "Offline Mode";
            leaveBtn.classList.remove('d-none');
        }
    } else {
        nameEl.innerText = "No Madrasa Selected";
    }

    leaveBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to disconnect from this Madrasa?")) {
            localStorage.removeItem('activeMadrasaId');
            window.location.reload();
        }
    });
});
