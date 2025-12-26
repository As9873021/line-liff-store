// public/liff-shop/member.js

const LIFF_ID = '2008758720-AsQsTKBk';

let currentProfile = { userId: '', displayName: '' };
let memberData = {};
let editingAddressId = null;
let editingStoreId = null;

// 分頁用狀態
let couponPage = 1;
const COUPON_PAGE_SIZE = 5;

let orderPage = 1;
const ORDER_PAGE_SIZE = 5;

async function initMember() {
  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }

  try {
    currentProfile = await liff.getProfile();
  } catch (e) {
    console.warn('getProfile 失敗', e);
  }

  const userId = currentProfile.userId;
  if (!userId) {
    alert('無法取得 LINE 使用者資訊');
    return;
  }

  await loadMemberData(userId);

  const basicSaveBtn = document.getElementById('basicSaveBtn');
  if (basicSaveBtn) {
    basicSaveBtn.addEventListener('click', () => saveBasicInfo(userId));
  }

  const addressInput = document.getElementById('addressInput');
  if (addressInput) {
    addressInput.addEventListener('blur', () => validateAddress());
  }
 // ★ 新增：如果 URL 帶 #orders，自動切換到訂單 tab
  if (window.location.hash === '#orders') {
    switchTab('tab-orders');
  }
}

async function loadMemberData(userId) {
  try {
    const res = await fetch(
      `/api/users/me?userId=${encodeURIComponent(userId)}`
    );
    if (!res.ok) throw new Error('load member failed');
    const data = await res.json();

    memberData = data.user || {};
    const vipLevel = data.vipLevel || 0;
    const coupons = Array.isArray(data.usableCoupons)
      ? data.usableCoupons
      : [];
    const totalSpent = Number(data.totalSpent || 0);
    const nextLevel = data.nextLevel;
    const amountToNext = data.amountToNext;

    // 更新 VIP 卡片（在 basic 分頁裡顯示）
    updateVipCard(vipLevel, totalSpent, nextLevel, amountToNext);

    // 基本資料
    const nameInput = document.getElementById('memberName');
    const phoneInput = document.getElementById('memberPhone');

    if (nameInput) {
      nameInput.value = memberData.name || currentProfile.displayName || '';
    }
    if (phoneInput) {
      phoneInput.value = memberData.phone || '';
    }

    // 地址 / 門市
    renderAddressList();
    renderStoreList();

    // 優惠券：先存起來再做分頁
    memberData._allCoupons = coupons;
    couponPage = 1;
    renderCouponList(coupons);

    // 訂單歷史（分頁）
    orderPage = 1;
    await loadOrderHistory(userId);
  } catch (e) {
    console.error(e);
    alert('載入會員資料失敗：' + e.message);
  }
}


function updateVipCard(vipLevel, totalSpent, nextLevel, amountToNext) {
  const vipLevelEl = document.getElementById('vipLevel');
  const vipDescEl = document.getElementById('vipDesc');
  const totalSpentEl = document.getElementById('totalSpent');
  const progressFillEl = document.getElementById('progressFill');
  const progressLabelEl = document.getElementById('progressLabel');
  const vipHintEl = document.getElementById('vipHint');
  const vipCrownEl = document.querySelector('.vip-icon'); // 皇冠 SVG

  if (vipLevelEl) vipLevelEl.textContent = `VIP${vipLevel}`;

  if (vipDescEl) {
    let desc = '';
    if (vipLevel === 0) desc = '一般會員';
    if (vipLevel === 1) desc = 'VIP1 (95折)';
    if (vipLevel === 2) desc = 'VIP2 (9折)';
    vipDescEl.textContent = desc;
  }

  if (totalSpentEl) totalSpentEl.textContent = `$${totalSpent}`;

  // 進度條
  let maxSpent = 5000;
  let percent = 0;
  if (vipLevel >= 2) {
    percent = 100;
  } else if (vipLevel === 1) {
    maxSpent = 15000;
    percent = Math.min((totalSpent / maxSpent) * 100, 100);
  } else {
    percent = Math.min((totalSpent / 5000) * 100, 100);
  }

  if (progressFillEl) progressFillEl.style.width = percent + '%';
  if (progressLabelEl) {
    progressLabelEl.textContent =
      vipLevel >= 2
        ? '最高等級'
        : `還需 $${Math.max(0, maxSpent - totalSpent)}`;
  }

  if (vipHintEl) {
    if (nextLevel && amountToNext > 0) {
      vipHintEl.textContent = `再消費 $${amountToNext} 升級 VIP${nextLevel}`;
    } else if (vipLevel >= 2) {
      vipHintEl.textContent = '🎉 您已是最高等級 VIP！';
    } else {
      vipHintEl.textContent = '努力消費中...';
    }
  }

  // 依等級調整皇冠顏色與光暈
  if (vipCrownEl) {
    let color = '#e5e7eb'; // VIP0：灰白
    let glow =
      'drop-shadow(0 0 4px rgba(255,255,255,0.7)) ' +
      'drop-shadow(0 0 10px rgba(148,163,184,0.7))';

    if (vipLevel === 1) {
      color = '#ffd700'; // VIP1：金色
      glow =
        'drop-shadow(0 0 4px rgba(255,255,255,0.9)) ' +
        'drop-shadow(0 0 14px rgba(255,215,0,0.9))';
    } else if (vipLevel >= 2) {
      color = '#f97316'; // VIP2+：橘金偏紅
      glow =
        'drop-shadow(0 0 5px rgba(255,255,255,1)) ' +
        'drop-shadow(0 0 18px rgba(249,115,22,1))';
    }

    vipCrownEl.style.color = color;
    vipCrownEl.style.filter = glow;
  }
}


function renderAddressList() {
  const container = document.getElementById('addressListContainer');
  if (!container) return;

  const addresses = Array.isArray(memberData.addresses)
    ? memberData.addresses
    : [];

  if (!addresses.length) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-icon">📭</div><div>尚無地址</div></div>';
    return;
  }

  container.innerHTML = addresses
    .map(
      (addr) => `
    <div class="item-card ${addr.isDefault ? 'default' : ''}">
      <div class="item-header">
        <div>
          <div class="item-label">${addr.label || '地址'}</div>
          <div class="item-text">${addr.address}</div>
        </div>
        <div class="item-badges">
          ${addr.isDefault ? '<span class="badge">預設</span>' : ''}
        </div>
      </div>
      <div class="item-actions">
        <button class="item-btn edit" onclick="editAddress(${addr.id})">編輯</button>
        <button class="item-btn delete" onclick="deleteAddress(${addr.id})">刪除</button>
      </div>
    </div>
  `
    )
    .join('');
}

function renderStoreList() {
  const container = document.getElementById('storeListContainer');
  if (!container) return;

  const stores = Array.isArray(memberData.stores) ? memberData.stores : [];

  if (!stores.length) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-icon">🏪</div><div>尚無取貨門市</div></div>';
    return;
  }

  container.innerHTML = stores
    .map(
      (store) => `
    <div class="item-card ${store.isDefault ? 'default' : ''}">
      <div class="item-header">
        <div>
          <div class="item-label">${store.label || '門市'}</div>
          <div class="item-text">${store.store}</div>
        </div>
        <div class="item-badges">
          ${store.isDefault ? '<span class="badge">預設</span>' : ''}
        </div>
      </div>
      <div class="item-actions">
        <button class="item-btn edit" onclick="editStore(${store.id})">編輯</button>
        <button class="item-btn delete" onclick="deleteStore(${store.id})">刪除</button>
      </div>
    </div>
  `
    )
    .join('');
}

/** 優惠券：每頁 5 筆分頁 */
function renderCouponList(coupons) {
  const container = document.getElementById('couponListContainer');
  if (!container) return;

  const total = coupons.length;
  if (!total) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-icon">🎟️</div><div>目前沒有可用優惠券</div></div>';
    return;
  }

  const totalPages = Math.ceil(total / COUPON_PAGE_SIZE);
  if (couponPage > totalPages) couponPage = totalPages;
  if (couponPage < 1) couponPage = 1;

  const start = (couponPage - 1) * COUPON_PAGE_SIZE;
  const end = start + COUPON_PAGE_SIZE;
  const pageData = coupons.slice(start, end);

  const listHtml = pageData
    .map((c) => {
      const title = c.name || c.title || c.code;
      const code = c.code;
      const discountText =
        c.discountType === 'percent'
          ? `${c.discountValue || 0} 折`
          : `折抵 $${c.discountValue || 0}`;
      const validUntil = c.validUntil
        ? new Date(c.validUntil).toLocaleDateString('zh-TW')
        : '無期限';

      const vipOnly =
        Array.isArray(c.allowedVipLevels) && c.allowedVipLevels.length
          ? `VIP${c.allowedVipLevels.join('/')} 專屬`
          : '';
         const usedInfo = c.usedCount > 0 ? '（已使用）' : ''; 
      return `
  <div class="coupon-item">
    <div class="coupon-title">${title}${usedInfo}</div>
    <div>
      <span class="coupon-code">${code}</span>
      ${vipOnly ? `<span style="font-size:11px;color:#6b7280;margin-left:4px;">${vipOnly}</span>` : ''}
    </div>
    <div class="coupon-info">
      <span class="coupon-discount">${discountText}</span>
      · 到期：${validUntil}
    </div>
  </div>
`;
    })
    .join('');

  const pagerHtml = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12px;color:#6b7280;">
      <button
        class="item-btn"
        style="max-width:80px;padding:6px 8px;"
        onclick="changeCouponPage(-1)"
        ${couponPage === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}
      >
        上一頁
      </button>
      <span>第 ${couponPage} / ${totalPages} 頁，共 ${total} 張</span>
      <button
        class="item-btn"
        style="max-width:80px;padding:6px 8px;"
        onclick="changeCouponPage(1)"
        ${
          couponPage === totalPages
            ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
            : ''
        }
      >
        下一頁
      </button>
    </div>
  `;

  container.innerHTML = listHtml + pagerHtml;
}

function changeCouponPage(delta) {
  couponPage += delta;
  const coupons = Array.isArray(memberData._allCoupons)
    ? memberData._allCoupons
    : [];
  renderCouponList(coupons);
}

/** 訂單：載入 + 每頁 5 筆分頁 */
async function loadOrderHistory(userId) {
  try {
    const res = await fetch(
      `/api/user-orders?userId=${encodeURIComponent(userId)}`
    );
    if (!res.ok) throw new Error('load orders failed');
    const data = await res.json();
    const orders = Array.isArray(data.orders) ? data.orders : [];

    memberData._allOrders = orders;
    renderOrderList();
  } catch (e) {
    console.error(e);
    const container = document.getElementById('orderListContainer');
    if (container) {
      container.innerHTML =
        '<div class="empty-state"><div style="color:#dc2626;">❌ 載入訂單失敗</div></div>';
    }
  }
}

function renderOrderList() {
  const container = document.getElementById('orderListContainer');
  if (!container) return;

  const orders = Array.isArray(memberData._allOrders)
    ? memberData._allOrders
    : [];

  const total = orders.length;
  if (!total) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-icon">📦</div><div>尚無訂單紀錄</div></div>';
    return;
  }

  const totalPages = Math.ceil(total / ORDER_PAGE_SIZE);
  if (orderPage > totalPages) orderPage = totalPages;
  if (orderPage < 1) orderPage = 1;

  const start = (orderPage - 1) * ORDER_PAGE_SIZE;
  const end = start + ORDER_PAGE_SIZE;
  const pageData = orders.slice(start, end);

  const listHtml = pageData
    .map((order) => {
      const date = new Date(order.createdAt).toLocaleString('zh-TW');
      const items = Array.isArray(order.items)
        ? order.items
            .map(
              (it) =>
                `${it.productName || it.name || ''} x${
                  it.qty || it.quantity || 0
                }`
            )
            .join('，')
        : '';
      const status = order.paid ? 'paid' : 'unpaid';
      const statusText = order.paid ? '✓ 已付款' : '⏳ 待付款';

      return `
  <div class="order-item" onclick="window.location.href='/liff-shop/order-detail.html?id=${order.id}'" style="cursor:pointer;">
    <div class="order-header">
      <span class="order-id">#${order.id}</span>
      <span class="order-status ${status}">${statusText}</span>
    </div>
    <div class="order-time">${date}</div>
    <div class="order-items">${items}</div>
    <div class="order-total">NT$${order.total || 0}</div>
  </div>
`;

    })
    .join('');

  const pagerHtml = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12px;color:#6b7280;">
      <button
        class="item-btn"
        style="max-width:80px;padding:6px 8px;"
        onclick="changeOrderPage(-1)"
        ${orderPage === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}
      >
        上一頁
      </button>
      <span>第 ${orderPage} / ${totalPages} 頁，共 ${total} 筆訂單</span>
      <button
        class="item-btn"
        style="max-width:80px;padding:6px 8px;"
        onclick="changeOrderPage(1)"
        ${
          orderPage === totalPages
            ? 'disabled style="opacity:0.5;cursor:not-allowed;"'
            : ''
        }
      >
        下一頁
      </button>
    </div>
  `;

  container.innerHTML = listHtml + pagerHtml;
}

function changeOrderPage(delta) {
  orderPage += delta;
  renderOrderList();
}

// ===== 分頁切換（tabs） =====

function switchTab(tabName) {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabButtons.forEach((btn) => btn.classList.remove('active'));
  tabPanes.forEach((pane) => pane.classList.remove('active'));

  // ★ 改這裡：如果有 event 才用 event.target，否則自動找對應按鈕
  if (typeof event !== 'undefined' && event && event.target) {
    event.target.classList.add('active');
  } else {
    // 程式碼呼叫時，自動找到對應按鈕並高亮
    const targetBtn = Array.from(tabButtons).find(btn => 
      btn.getAttribute('onclick')?.includes(tabName)
    );
    if (targetBtn) targetBtn.classList.add('active');
  }

  const pane = document.getElementById(tabName);
  if (pane) pane.classList.add('active');
}


// ===== 基本資料 =====

async function saveBasicInfo(userId) {
  const name = document.getElementById('memberName').value.trim();
  const phone = document.getElementById('memberPhone').value.trim();

  if (!name) {
    alert('請輸入姓名');
    return;
  }
  if (phone && !/^09\d{8}$/.test(phone)) {
    alert('請輸入正確的手機號碼（09 開頭共 10 碼），或留空');
    return;
  }

  try {
    const res = await fetch('/api/users/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        name,
        phone,
        addresses: memberData.addresses || [],
        stores: memberData.stores || [],
      }),
    });
    if (!res.ok) throw new Error('save failed');
    await res.json();
    alert('✓ 已儲存基本資料');
  } catch (e) {
    console.error(e);
    alert('儲存失敗，請稍後再試');
  }
}

// ===== 地址管理 =====

function openAddressModal(id = null) {
  editingAddressId = id;
  const modal = document.getElementById('addressModal');
  const title = document.getElementById('addressModalTitle');
  const labelInput = document.getElementById('addressLabel');
  const addressInput = document.getElementById('addressInput');
  const isDefaultCheckbox = document.getElementById('addressIsDefault');

  title.textContent = id ? '編輯地址' : '新增地址';
  labelInput.value = '';
  addressInput.value = '';
  isDefaultCheckbox.checked = false;

  if (id) {
    const addresses = Array.isArray(memberData.addresses)
      ? memberData.addresses
      : [];
    const addr = addresses.find((a) => a.id === id);
    if (addr) {
      labelInput.value = addr.label || '';
      addressInput.value = addr.address || '';
      isDefaultCheckbox.checked = Boolean(addr.isDefault);
    }
  }

  modal.classList.add('active');
}

function closeAddressModal() {
  document.getElementById('addressModal').classList.remove('active');
  editingAddressId = null;
}

async function validateAddress() {
  const addressInput = document.getElementById('addressInput');
  const address = addressInput.value.trim();
  const suggestionsDiv = document.getElementById('addressSuggestions');

  if (!address) {
    suggestionsDiv.style.display = 'none';
    return;
  }

  try {
    const res = await fetch('/api/address/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    const data = await res.json();

    if (data.status === 'ok' && data.suggestions && data.suggestions.length) {
      suggestionsDiv.innerHTML = data.suggestions
        .map(
          (s) =>
            `<div class="suggestion-item" onclick="selectAddressSuggestion('${s.replace(
              /'/g,
              "\\'"
            )}')">${s}</div>`
        )
        .join('');
      suggestionsDiv.style.display = 'block';
    } else {
      suggestionsDiv.style.display = 'none';
    }
  } catch (e) {
    console.warn('address validate error:', e);
  }
}

function selectAddressSuggestion(address) {
  document.getElementById('addressInput').value = address;
  document.getElementById('addressSuggestions').style.display = 'none';
}

function saveAddress() {
  const label = document.getElementById('addressLabel').value.trim();
  const address = document.getElementById('addressInput').value.trim();
  const isDefault = document.getElementById('addressIsDefault').checked;

  if (!address) {
    alert('請輸入地址');
    return;
  }

  let addresses = Array.isArray(memberData.addresses)
    ? [...memberData.addresses]
    : [];

  if (editingAddressId) {
    const idx = addresses.findIndex((a) => a.id === editingAddressId);
    if (idx !== -1) {
      addresses[idx] = {
        id: editingAddressId,
        label,
        address,
        isDefault,
      };
    }
  } else {
    addresses.push({
      id: Date.now(),
      label,
      address,
      isDefault,
    });
  }

  if (isDefault) {
    addresses = addresses.map((a) => ({
      ...a,
      isDefault:
        a.id === (editingAddressId || addresses[addresses.length - 1].id),
    }));
  }

  memberData.addresses = addresses;
  renderAddressList();
  closeAddressModal();
}

function editAddress(id) {
  openAddressModal(id);
}

function deleteAddress(id) {
  if (!confirm('確定要刪除此地址嗎？')) return;

  const addresses = Array.isArray(memberData.addresses)
    ? memberData.addresses.filter((a) => a.id !== id)
    : [];

  memberData.addresses = addresses;
  renderAddressList();
}

// ===== 取貨門市管理 =====

function openStoreModal(id = null) {
  editingStoreId = id;
  const modal = document.getElementById('storeModal');
  const title = document.getElementById('storeModalTitle');
  const labelInput = document.getElementById('storeLabel');
  const storeInput = document.getElementById('storeInput');
  const isDefaultCheckbox = document.getElementById('storeIsDefault');

  title.textContent = id ? '編輯取貨門市' : '新增取貨門市';
  labelInput.value = '';
  storeInput.value = '';
  isDefaultCheckbox.checked = false;

  if (id) {
    const stores = Array.isArray(memberData.stores) ? memberData.stores : [];
    const store = stores.find((s) => s.id === id);
    if (store) {
      labelInput.value = store.label || '';
      storeInput.value = store.store || '';
      isDefaultCheckbox.checked = Boolean(store.isDefault);
    }
  }

  modal.classList.add('active');
}

function closeStoreModal() {
  document.getElementById('storeModal').classList.remove('active');
  editingStoreId = null;
}

function saveStore() {
  const label = document.getElementById('storeLabel').value.trim();
  const store = document.getElementById('storeInput').value.trim();
  const isDefault = document.getElementById('storeIsDefault').checked;

  if (!store) {
    alert('請輸入取貨門市');
    return;
  }

  let stores = Array.isArray(memberData.stores)
    ? [...memberData.stores]
    : [];

  if (editingStoreId) {
    const idx = stores.findIndex((s) => s.id === editingStoreId);
    if (idx !== -1) {
      stores[idx] = {
        id: editingStoreId,
        label,
        store,
        isDefault,
      };
    }
  } else {
    stores.push({
      id: Date.now(),
      label,
      store,
      isDefault,
    });
  }

  if (isDefault) {
    stores = stores.map((s) => ({
      ...s,
      isDefault:
        s.id === (editingStoreId || stores[stores.length - 1].id),
    }));
  }

  memberData.stores = stores;
  renderStoreList();
  closeStoreModal();
}

function editStore(id) {
  openStoreModal(id);
}

function deleteStore(id) {
  if (!confirm('確定要刪除此取貨門市嗎？')) return;

  const stores = Array.isArray(memberData.stores)
    ? memberData.stores.filter((s) => s.id !== id)
    : [];

  memberData.stores = stores;
  renderStoreList();
}

// ===== 返回 =====

function goBack() {
  window.location.href = '/liff-shop/index.html';
}

window.goBack = goBack;

// 將分頁相關函式掛到 window，給 HTML onclick 用
window.changeCouponPage = changeCouponPage;
window.changeOrderPage = changeOrderPage;
window.switchTab = switchTab;

document.addEventListener('DOMContentLoaded', () => {
  initMember().catch(console.error);
});
