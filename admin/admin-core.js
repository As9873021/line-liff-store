import { initializeApp } from "https://www.gstatic.com/firebasejs/9/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc } from "https://www.gstatic.com/firebasejs/9/firebase-firestore.js";
import { firebaseConfig, systemConfig } from "../core/firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 1. 登入邏輯
const loginBtn = document.getElementById('loginBtn');
if(loginBtn) {
    loginBtn.onclick = async () => {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        try {
            await signInWithEmailAndPassword(auth, email, password);
            location.href = 'dashboard.html';
        } catch (err) {
            document.getElementById('errMsg').innerText = "帳號或密碼錯誤";
            document.getElementById('errMsg').classList.remove('hidden');
        }
    };
}

// 2. 圖片處理 (Cloudinary 上傳)
export const uploadImage = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', systemConfig.cloudinary.uploadPreset);
    
    const res = await fetch(`https://api.cloudinary.com/v1_1/${systemConfig.cloudinary.cloudName}/image/upload`, {
        method: 'POST',
        body: formData
    });
    const data = await res.json();
    return data.secure_url; // 回傳優化後的網址
};

// 3. 權限檢查：未登入者自動踢回登入頁
onAuthStateChanged(auth, (user) => {
    if (!user && !window.location.href.includes('admin-login.html')) {
        window.location.href = 'admin-login.html';
    }
});