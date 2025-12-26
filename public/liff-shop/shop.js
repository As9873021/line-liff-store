// public/liff-shop/shop.js

const LIFF_ID = '2008758720-AsQsTKBk';

let products = {};
let cart = {};
let currentPage = 0;
const PRODUCTS_PER_PAGE = 6;
let currentProduct = '';
let qty = 1;
let top3Names = [];

let searchKeyword = '';
let currentCategory = 'all';

let salesStats = {};

let settings = {
  mode: 'local',
  allowOrders: false,
  lineLiffId: '',
  baseUrl: ''
};

let isCategoryPanelOpen = false;
let isLoading = true;

// ========= 新增：給 checkout 頁用的購物車（陣列形） =========
function getCheckoutCartArray() {
  return Object.entries(cart)
    .filter(([_, q]) => q > 0)
    .map(([name, q]) => {
      const p = products[name] || {};
      return {
        id: p._id || name,
        name,
        price: p.price || 0,
        qty: q,
        imgUrl: p.image || ''
      };
    });
}

// 同步到 localStorage，讓 checkout.html 讀取
function syncCartToLocalStorage() {
  const arr = getCheckoutCartArray();
  localStorage.setItem('cart', JSON.stringify(arr));
}

// ========= 商店基本設定 =========
async function loadStoreConfig() {
  try {
    const res = await fetch('/api/store');
    const store = await res.json();

    console.log('store from /api/store =', store);

    if (store && store.name) {
      const icon = store.icon || '🛒';

      // tab 標題
      document.title = `${icon} ${store.name}商店`;

      // 綠色那一列「圖案 + 店名」
      const headerSpan = document.getElementById('storeTitle');
      if (headerSpan) {
        headerSpan.innerText = '';
        headerSpan.textContent = `${icon} ${store.name}`;
      }
    }

    // ✅ 別忘了把 store 存到 localStorage（你原本缺這一段的關閉大括號）
    localStorage.setItem('storeConfig', JSON.stringify(store));
  } catch (e) {
    console.error('load store config error', e);
  }
}

// ========= 啟動流程 =========
(async function boot() {
  try {
    await loadStoreConfig();

    try {
      const sRes = await fetch('/api/admin/settings');
      const s = await sRes.json();
      settings = Object.assign(settings, s || {});
    } catch (e) {
      console.error('load settings error', e);
    }

    await initLiff();
  } catch (err) {
    console.error('boot error', err);
    alert('初始化失敗，請稍後再試');
  }
})();

// ========= LIFF 初始化（含頭像 + 顯示 userId） =========
async function initLiff() {
  try {
    await liff.init({ liffId: LIFF_ID });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    // 取得 LINE 個人資料，設定 header 頭像 + 顯示 userId
    try {
      const profile = await liff.getProfile();

      // 設定頭像
      if (profile && profile.pictureUrl) {
        const avatarEl = document.getElementById('memberAvatar');
        if (avatarEl) {
          avatarEl.src = profile.pictureUrl;
        }
      }

      // ✅ 新增：顯示目前登入者的 userId（開發時拿來貼到 .env 當 LINE_OWNER_ID）
      const debugEl = document.getElementById('debugUserId');
      if (debugEl && profile && profile.userId) {
        debugEl.textContent = `你的 LINE userId：${profile.userId}`;
      }
    } catch (e) {
      console.warn('getProfile 失敗', e);
    }

    isLoading = true;
    renderPage();

    const res = await fetch('/api/products');
    products = await res.json();

    renderCategoryList();

    try {
      const oRes = await fetch('/api/orders');
      const orders = await oRes.json();
      salesStats = {};
      (orders || []).forEach(o => {
        (o.items || []).forEach(it => {
          const name = it.productName || '';
          const q = Number(it.qty || 0);
          if (!name) return;
          if (!salesStats[name]) salesStats[name] = 0;
          salesStats[name] += q;
        });
      });
      top3Names = Object.entries(salesStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);
    } catch (e) {
      console.error('load orders failed', e);
    }

    // 從 localStorage 還原購物車（如果有）
    try {
      const saved = localStorage.getItem('cartRaw');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          cart = parsed;
        }
      }
    } catch (e) {
      console.warn('restore cart error', e);
    }

    isLoading = false;
    renderPage();
    updateCartUI();
  } catch (err) {
    console.error('LIFF init error', err);
    alert('LIFF 初始化失敗，請檢查 LIFF ID');
  }
}

// ========= 會員中心入口：給 header-avatar 用 =========
function openMemberPage() {
  window.location.href = '/liff-shop/member.html';
}

// ========= 類別 / 搜尋 =========
function renderCategoryList() {
  const panel = document.getElementById('categoryList');
  if (!panel) return;

  const set = new Set();
  Object.values(products || {}).forEach(p => {
    const cat = (p && typeof p.category === 'string') ? p.category.trim() : '';
    if (cat) set.add(cat);
  });
  const categories = Array.from(set);

  let html = '';
  html += `
    <div class="category-item ${currentCategory === 'all' ? 'category-item-active' : ''}"
         onclick="changeCategory('all', true)">
      <span>全部商品</span>
    </div>
  `;
  categories.forEach(cat => {
    const safeCat = cat.replace(/"/g, '&quot;');
    html += `
      <div class="category-item ${currentCategory === cat ? 'category-item-active' : ''}"
           onclick="changeCategory('${safeCat}', true)">
        <span>${safeCat}</span>
      </div>
    `;
  });

  panel.innerHTML = html;
}

function toggleCategoryPanel() {
  isCategoryPanelOpen = !isCategoryPanelOpen;
  const panel = document.getElementById('categoryPanel');
  if (!panel) return;
  if (isCategoryPanelOpen) panel.classList.add('open');
  else panel.classList.remove('open');
}

function panelBackgroundClick(e) {
  if (e.target.id === 'categoryPanel') {
    toggleCategoryPanel();
  }
}

function changeCategory(cat, closePanel) {
  currentCategory = cat;
  currentPage = 0;
  renderCategoryList();
  renderPage();
  if (closePanel) toggleCategoryPanel();
}

function fuzzyMatch(text, query) {
  if (!query) return true;
  text = String(text || '').toLowerCase();
  query = String(query || '').toLowerCase();
  let i = 0, j = 0;
  while (i < text.length && j < query.length) {
    if (text[i] === query[j]) j++;
    i++;
  }
  return j === query.length;
}

function getVisibleProductKeys() {
  return Object.keys(products)
    .filter(name => {
      const p = products[name] || {};
      if (p.enabled === false) return false;

      if (currentCategory !== 'all') {
        const cat = (p.category || '').trim();
        if (cat !== currentCategory) return false;
      }

      if (searchKeyword && !fuzzyMatch(name, searchKeyword)) return false;
      return true;
    })
    .sort((a, b) => {
      const pa = products[a] || {};
      const pb = products[b] || {};
      const sa = typeof pa.sort === 'number' ? pa.sort : 9999;
      const sb = typeof pb.sort === 'number' ? pb.sort : 9999;
      return sa - sb;
    });
}

// ========= 產品列表與分頁 =========
function renderPage() {
  const container = document.getElementById('products');
  if (!container) return;

  if (isLoading) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;color:#888;font-size:13px;padding:32px 8px;">
        資料載入中，請稍候…
      </div>
    `;
    const pag = document.getElementById('pagination');
    if (pag) pag.innerHTML = '';
    return;
  }

  const keys = getVisibleProductKeys();
  const start = currentPage * PRODUCTS_PER_PAGE;
  const end = start + PRODUCTS_PER_PAGE;
  const pageProducts = keys.slice(start, end);

  if (!pageProducts.length) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;color:#888;font-size:13px;padding:32px 8px;">
        目前沒有符合條件的商品
      </div>
    `;
    renderPagination(0);
    return;
  }

  container.innerHTML = pageProducts.map(name => {
    const p = products[name];
    const rankIndex = top3Names.indexOf(name);
    const badge = rankIndex >= 0
      ? `<div class="top-badge">TOP${rankIndex + 1}</div>`
      : '';

    const sold = salesStats[name] || 0;
    const stock = (typeof p.stock === 'number') ? p.stock : null;
    const sub = `已售出 ${sold}，${stock != null ? '庫存 ' + stock : '庫存未設定'}`;

    return `
      <div class="product">
        <div class="product-img-wrap" onclick="openDetail('${name}')">
          ${badge}
          <img src="${p.image}" loading="lazy">
        </div>
        <div class="p-info">
          <div>
            <div class="p-name">${name}</div>
            <div class="p-price">$${p.price}</div>
            <div class="p-sub">${sub}</div>
          </div>
          <div class="product-footer-row">
            <span style="font-size:11px;color:#999;">點卡片看詳情</span>
            <button class="quick-add-btn" onclick="quickAdd('${name}', event)">＋</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  renderPagination(keys.length);
}

function renderPagination(totalCount) {
  const el = document.getElementById('pagination');
  if (!el) return;

  if (totalCount === 0) {
    el.innerHTML = '';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PRODUCTS_PER_PAGE));
  if (currentPage > totalPages - 1) currentPage = totalPages - 1;

  let html = '';
  if (currentPage > 0) {
    html += `<button class="page-btn" onclick="changePage(${currentPage - 1})">‹</button>`;
  }

  const startPage = Math.max(0, currentPage - 1);
  const endPage = Math.min(totalPages - 1, currentPage + 1);
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'page-active' : ''}" onclick="changePage(${i})">${i + 1}</button>`;
  }

  if (currentPage < totalPages - 1) {
    html += `<button class="page-btn" onclick="changePage(${currentPage + 1})">›</button>`;
  }
  html += `<span style="margin-left:12px;font-size:13px;color:#888">第${currentPage + 1}/${totalPages}頁</span>`;
  el.innerHTML = html;
}

function changePage(page) {
  currentPage = page;
  renderPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onSearchChange() {
  const input = document.getElementById('searchInput');
  searchKeyword = input ? input.value.trim() : '';
  currentPage = 0;
  renderPage();
}

// ========= 購物車操作 =========
async function quickAdd(name, evt) {
  evt.stopPropagation();
  const p = products[name];
  if (!p) return;

  cart[name] = (cart[name] || 0) + 1;
  updateCartUI();
  syncCartToLocalStorage();
  saveCartRaw();
  await syncCartToServer();
}

function openDetail(name) {
  const p = products[name];
  if (!p) return;
  currentProduct = name;
  qty = 1;

  document.getElementById('detailTitle').textContent = name;
  document.getElementById('detailPrice').textContent = '$' + (p.price || 0);
  document.getElementById('detailImg').src = p.image || '';
  document.getElementById('detailDesc').textContent = p.description || '尚無商品介紹';

  const sold = salesStats[name] || 0;
  const stock = (typeof p.stock === 'number') ? p.stock : null;
  document.getElementById('detailSold').textContent = '已售出：' + sold;
  document.getElementById('detailStock').textContent =
    '剩餘庫存：' + (stock != null ? stock : '未設定');

  document.getElementById('detailSub').textContent =
    `銷售量 ${sold}，${stock != null ? '庫存 ' + stock : '庫存未設定'}`;

  document.getElementById('qtyDisplay').textContent = qty;
  updateDetailSubtotal();

  document.getElementById('detailOverlay').style.display = 'flex';
}

function closeOverlay() {
  document.getElementById('detailOverlay').style.display = 'none';
}

function overlayClick(e) {
  if (e.target.id === 'detailOverlay') closeOverlay();
}

function changeQty(delta) {
  qty = Math.max(1, qty + delta);
  document.getElementById('qtyDisplay').textContent = qty;
  updateDetailSubtotal();
}

function updateDetailSubtotal() {
  const p = products[currentProduct] || {};
  const price = p.price || 0;
  const subtotal = price * qty;
  const el = document.getElementById('detailSubtotal');
  if (el) el.innerHTML = `小計：<span>$${subtotal}</span>`;
}

async function confirmAdd() {
  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }
  cart[currentProduct] = (cart[currentProduct] || 0) + qty;
  updateCartUI();
  syncCartToLocalStorage();
  saveCartRaw();
  closeOverlay();

  await syncCartToServer();
}

function updateCartUI() {
  const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);
  const totalPrice = Object.entries(cart).reduce((sum, [name, q]) => {
    return sum + q * (products[name]?.price || 0);
  }, 0);
  const mainLine = document.getElementById('cartMainLine');
  const subLine = document.getElementById('cartSubLine');
  const btn = document.getElementById('checkoutBtn');

  if (mainLine) {
    mainLine.textContent = `🛒 購物車 (${totalItems}) 總計 $${totalPrice}`;
  }
  if (subLine) {
    subLine.textContent =
      totalItems ? '點此查看 / 編輯購物車' : '購物車目前是空的';
  }
  if (btn) {
    btn.disabled = totalItems === 0;
  }

  const totalTextEl = document.getElementById('cartTotalText');
  if (totalTextEl) totalTextEl.textContent = `小計：$${totalPrice}`;
}

function saveCartRaw() {
  try {
    localStorage.setItem('cartRaw', JSON.stringify(cart));
  } catch (e) {
    console.warn('save cartRaw error', e);
  }
}

async function syncCartToServer() {
  try {
    if (!liff.isLoggedIn()) return;
    const profile = await liff.getProfile();
    await fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: profile.userId, cart })
    });
  } catch (e) {
    console.error('sync cart error', e);
  }
}

function openCart() {
  document.getElementById('cartOverlay').style.display = 'flex';
  renderCartDetail();
}

function closeCart() {
  document.getElementById('cartOverlay').style.display = 'none';
}

function cartOverlayClick(e) {
  if (e.target.id === 'cartOverlay') {
    closeCart();
  }
}

function renderCartDetail() {
  const container = document.getElementById('cartItemsContainer');
  if (!container) return;

  const entries = Object.entries(cart).filter(([_, q]) => q > 0);
  if (!entries.length) {
    container.innerHTML = `<div class="cart-overlay-empty">購物車內尚無商品</div>`;
    updateCartUI();
    return;
  }

  let html = '';
  entries.forEach(([name, q]) => {
    const p = products[name] || {};
    const price = p.price || 0;
    const line = price * q;
    html += `
      <div class="cart-item-row">
        <div class="cart-item-main">
          <span class="cart-item-name">${name}</span>
          <span class="cart-item-sub">$${price} / 份</span>
        </div>
        <div class="cart-item-qty">
          <button class="cart-qty-btn" onclick="changeCartItemQty('${name}', -1)">−</button>
          <span class="cart-qty-value">${q}</span>
          <button class="cart-qty-btn" onclick="changeCartItemQty('${name}', 1)">＋</button>
        </div>
        <div class="cart-item-price">$${line}</div>
        <button class="cart-item-remove" onclick="removeCartItem('${name}')">×</button>
      </div>
    `;
  });
  container.innerHTML = html;
  updateCartUI();
}

async function changeCartItemQty(name, delta) {
  const current = cart[name] || 0;
  const next = current + delta;
  if (next <= 0) {
    delete cart[name];
  } else {
    cart[name] = next;
  }
  renderCartDetail();
  syncCartToLocalStorage();
  saveCartRaw();
  await syncCartToServer();
}

async function removeCartItem(name) {
  delete cart[name];
  renderCartDetail();
  syncCartToLocalStorage();
  saveCartRaw();
  await syncCartToServer();
}

// ========= 結帳 =========
async function checkout() {
  try {
    const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);
    if (!totalItems) {
      alert('購物車是空的，請先選購商品');
      return;
    }

    // 把目前 cart 存到 localStorage，給 checkout.html 讀
    syncCartToLocalStorage();
    saveCartRaw();

    // 導到結帳頁（在同一個 LIFF 內）
    window.location.href = '/liff-shop/checkout.html';
  } catch (e) {
    console.error(e);
    alert('結帳流程初始化失敗，請稍後再試');
  }
}

// ========= 綁到 window 讓 HTML 可以呼叫 =========
window.checkout = checkout;
window.openDetail = openDetail;
window.quickAdd = quickAdd;
window.onSearchChange = onSearchChange;
window.toggleCategoryPanel = toggleCategoryPanel;
window.panelBackgroundClick = panelBackgroundClick;
window.overlayClick = overlayClick;
window.openCart = openCart;
window.closeCart = closeCart;
window.cartOverlayClick = cartOverlayClick;
window.changeCartItemQty = changeCartItemQty;
window.removeCartItem = removeCartItem;
window.confirmAdd = confirmAdd;
window.changePage = changePage;
window.changeCategory = changeCategory;
window.openMemberPage = openMemberPage;
