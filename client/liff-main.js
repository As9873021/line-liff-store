import { initializeApp } from "https://www.gstatic.com/firebasejs/9/firebase-app.js";
import { getFirestore, doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/9/firebase-firestore.js";
import { firebaseConfig, lineConfig } from "../core/firebase-config.js";

// 1. 初始化
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function initLiff() {
    try {
        await liff.init({ liffId: lineConfig.liffId });
        if (!liff.isLoggedIn()) {
            liff.login();
        } else {
            const profile = await liff.getProfile();
            loadUserData(profile.userId); // 載入會員資料（含歷史規格）
        }
    } catch (err) {
        console.error("LIFF 初始化失敗", err);
    }
}

// 2. 核心功能：讀取商品與渲染
async function loadProducts() {
    const querySnapshot = await getDocs(collection(db, "products"));
    const productList = document.getElementById('productList');
    
    querySnapshot.forEach((doc) => {
        const p = doc.data();
        // 渲染韓系極簡商品卡片
        productList.innerHTML += `
            <div class="product-card group cursor-pointer" onclick="location.href='product.html?id=${doc.id}'">
                <div class="aspect-square bg-gray-100 rounded-xl overflow-hidden mb-3">
                    <img src="${p.imageUrl}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500">
                </div>
                <h3 class="text-[13px] font-medium truncate">${p.name}</h3>
                <p class="text-sm font-bold mt-1">$${p.price}</p>
            </div>
        `;
    });
}

// 3. 核心功能：雙眼規格記憶檢查
function renderSpecs(allSpecs, lastBoughtSpec) {
    const grid = document.getElementById('specGrid');
    allSpecs.forEach(spec => {
        const isLast = spec === lastBoughtSpec;
        grid.innerHTML += `
            <div class="border p-2 text-center rounded-lg text-sm transition ${isLast ? 'border-black bg-black text-white' : 'hover:border-gray-400'} relative">
                ${spec}
                ${isLast ? '<span class="absolute -top-1 -right-1">⭐</span>' : ''}
            </div>
        `;
    });
}

// 啟動
initLiff();
loadProducts();