// public/liff-shop/checkout.js

const LIFF_ID = '2008758720-AsQsTKBk';

let cart = [];
let availablePayments = [];   // 從設定讀取的可用付款方式
let storeConfig = {};        // 商店設定
let availableCoupons = [];   // 此用戶可用的優惠券（前端估算用）
let currentProfile = { userId: '', displayName: '' };
let currentVipLevel = 0;     // 從 /api/users/me 取得的 VIP 等級
let userAddresses = [];      // 會員已有地址清單
let userStores = [];         // 會員已有取貨門市清單

// 付款方式代碼常數，要跟後端 / store.paymentMethods 一致
const PAYMENT_TYPE = {
  HOME: 'homeDelivery',
  COD: 'cod',
  CVS_CODE: 'cvsCode',
};

async function init() {
  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }

  // 先取得 LINE Profile，之後要用 userId 抓優惠券 / 會員資料
  try {
    currentProfile = await liff.getProfile();
  } catch (e) {
    console.warn('getProfile 失敗', e);
  }

  const userId = currentProfile.userId || '';

  // 讀取會員資料，拿 vipLevel + 基本資料 + 多地址 / 多門市
  if (userId) {
    try {
      const res = await fetch(`/api/users/me?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await res.json();
        currentVipLevel = Number(data.vipLevel || 0);

        const user = data.user || {};
        userAddresses = Array.isArray(user.addresses) ? user.addresses : [];
        userStores = Array.isArray(user.stores) ? user.stores : [];

        const nameInput = document.getElementById('name');
        const phoneInput = document.getElementById('phone');

        if (nameInput) {
          nameInput.value = user.name || currentProfile.displayName || '';
        }
        if (phoneInput && user.phone) {
          phoneInput.value = user.phone;
        }

        // 渲染地址 / 門市選單
        renderAddressOptions();
        renderStoreOptions();

        console.log('checkout vipLevel =', currentVipLevel);
      } else {
        currentVipLevel = 0;
      }
    } catch (e) {
      console.warn('載入會員資料失敗，當作一般會員', e);
      currentVipLevel = 0;
    }
  }

  // 讀取商店設定（付款方式）
  try {
    const storeRes = await fetch('/api/store');
    const store = await storeRes.json();
    storeConfig = store || {};
    availablePayments = extractPaymentMethods(store.paymentMethods);
    renderPaymentOptions();
  } catch (err) {
    console.warn('載入付款方式設定失敗，使用預設', err);
    availablePayments = ['cash', 'linePay'];
    renderPaymentOptions();
  }

  // 付款方式改變時，切換顯示欄位
  const paymentSelect = document.getElementById('payment');
  if (paymentSelect) {
    paymentSelect.addEventListener('change', updateContactFieldsByPayment);
  }

  // 讀取「此用戶可用的優惠券」（前端只拿來列出與粗估）
  try {
    // 如果後台關掉「啟用優惠券功能」，就不要顯示也不要載入
    if (storeConfig && storeConfig.enableCoupons === false) {
      console.log('enableCoupons = false，結帳頁不顯示優惠券');
      availableCoupons = [];

      const couponSelect = document.getElementById('coupon');
      const couponLabel = document.querySelector('label[for="coupon"]');
      if (couponSelect) couponSelect.style.display = 'none';
      if (couponLabel) couponLabel.style.display = 'none';
    } else {
      const couponRes = await fetch('/api/coupons');
      const allCoupons = (await couponRes.json()) || [];
      console.log('allCoupons =', allCoupons);

      // 讀取全部訂單，用來判斷每個 user 已用過幾次（perUserLimit）
      let orders = [];
      try {
        const oRes = await fetch('/api/orders');
        orders = (await oRes.json()) || [];
      } catch {
        orders = [];
      }
      console.log('orders =', orders);

      const now = new Date();

      availableCoupons = allCoupons.filter((c) => {
        if (c.isActive === false) return false;

        if (c.validFrom) {
          const vf = new Date(c.validFrom);
          if (!isNaN(vf.getTime()) && now < vf) return false;
        }
        if (c.validUntil) {
          const vu = new Date(c.validUntil);
          if (!isNaN(vu.getTime()) && now > vu) return false;
        }

        if (typeof c.perUserLimit === 'number' && c.perUserLimit > 0) {
          const usedCount = orders.filter(
            (o) =>
              o.userId === currentProfile.userId &&
              o.couponCode === c.code
          ).length;
          if (usedCount >= c.perUserLimit) return false;
        }

        // ★ VIP 等級限制
        if (Array.isArray(c.allowedVipLevels) && c.allowedVipLevels.length) {
          if (!c.allowedVipLevels.includes(currentVipLevel)) return false;
        }

        return true;
      });

      console.log('availableCoupons =', availableCoupons);

      renderCouponOptions();
    }
  } catch (e) {
    console.warn('載入優惠券失敗', e);
    availableCoupons = [];
    renderCouponOptions();
  }

  // 讀取購物車（由 shop.js 存在 localStorage 的陣列）
  const raw = localStorage.getItem('cart');
  if (!raw) {
    alert('購物車是空的，將返回商品頁');
    goBack();
    return;
  }
  try {
    cart = JSON.parse(raw);
  } catch (e) {
    alert('購物車資料有誤，請重新選購');
    goBack();
    return;
  }
  if (!cart.length) {
    alert('購物車是空的，將返回商品頁');
    goBack();
    return;
  }

  // 初次渲染 summary（會同時更新底部金額）
  renderOrderSummary();

  // 選擇優惠券時，要重新計算 summary / 底部金額
  const couponSelect = document.getElementById('coupon');
  if (couponSelect) {
    couponSelect.addEventListener('change', recalcSummary);
  }

  // 底部主 CTA（電腦 + 手機共用）
  const mobileSubmitBtn = document.getElementById('mobileSubmitBtn');
  if (mobileSubmitBtn) {
    mobileSubmitBtn.addEventListener('click', submitOrder);
  }

  // 依目前付款方式更新顯示欄位
  updateContactFieldsByPayment();
}

/** 從設定物件抽取「啟用的」付款方式 */
function extractPaymentMethods(paymentMethodsObj) {
  if (!paymentMethodsObj || typeof paymentMethodsObj !== 'object') {
    return ['cash'];
  }
  return Object.keys(paymentMethodsObj).filter(
    (key) => paymentMethodsObj[key] === true
  );
}

/** 動態生成付款方式選項 */
function renderPaymentOptions() {
  const paymentSelect = document.getElementById('payment');
  if (!paymentSelect) return;

  const paymentLabels = {
    cash: '現金',
    linePay: 'LINE Pay',
    homeDelivery: '宅配（先付款）',
    cod: '貨到付款（COD）',
    cvsCode: '超商代碼繳費',
    card: '信用卡',
    bankTransfer: '銀行轉帳',
  };

  let html = '<option value="">請選擇付款方式</option>';
  availablePayments.forEach((method) => {
    const label = paymentLabels[method] || method;
    html += `<option value="${method}">${label}</option>`;
  });

  paymentSelect.innerHTML = html;
}

/** 付款方式改變時，切換顯示「地址 / 取貨門市」 */
function updateContactFieldsByPayment() {
  const payment = document.getElementById('payment')?.value || '';
  const rowAddress = document.getElementById('row-address');
  const rowStore = document.getElementById('row-store');

  if (!rowAddress || !rowStore) return;

  // 預設全部隱藏
  rowAddress.style.display = 'none';
  rowStore.style.display = 'none';

  // 宅配：姓名 / 電話 / 地址
  if (payment === PAYMENT_TYPE.HOME) {
    rowAddress.style.display = '';
  }

  // 貨到付款：姓名 / 電話 / 取貨門市
  if (payment === PAYMENT_TYPE.COD) {
    rowStore.style.display = '';
  }

  // 超商代碼繳費：姓名 / 電話 / 取貨門市
  if (payment === PAYMENT_TYPE.CVS_CODE) {
    rowStore.style.display = '';
  }
}

/** 渲染地址下拉選單 */
function renderAddressOptions() {
  const addrSelect = document.getElementById('address');
  if (!addrSelect) return;

  let html = '<option value="">-- 選擇地址 --</option>';
  userAddresses.forEach((addr) => {
    const label = addr.label ? `${addr.label} (${addr.address})` : addr.address;
    html += `<option value="${addr.address}">${label}</option>`;
  });

  addrSelect.innerHTML = html;

  // 預設選第一個或設為預設的
  if (userAddresses.length) {
    const defaultAddr = userAddresses.find((a) => a.isDefault);
    if (defaultAddr) {
      addrSelect.value = defaultAddr.address;
    } else {
      addrSelect.value = userAddresses[0].address;
    }
  }
}

/** 渲染取貨門市下拉選單 */
function renderStoreOptions() {
  const storeSelect = document.getElementById('store');
  if (!storeSelect) return;

  let html = '<option value="">-- 選擇門市 --</option>';
  userStores.forEach((store) => {
    const label = store.label ? `${store.label} (${store.store})` : store.store;
    html += `<option value="${store.store}">${label}</option>`;
  });

  storeSelect.innerHTML = html;

  // 預設選第一個或設為預設的
  if (userStores.length) {
    const defaultStore = userStores.find((s) => s.isDefault);
    if (defaultStore) {
      storeSelect.value = defaultStore.store;
    } else {
      storeSelect.value = userStores[0].store;
    }
  }
}

/** 動態生成優惠券選項（使用 code 當 value） */
function renderCouponOptions() {
  const sel = document.getElementById('coupon');
  if (!sel) return;

  let html = '<option value="">不使用優惠券</option>';
  availableCoupons.forEach((c) => {
    const name = c.name || c.title || '';
    const displayText = name ? `${c.code}（${name}）` : c.code;
    html += `<option value="${c.code}">${displayText}</option>`;
  });

  sel.innerHTML = html;
}

/** 重新計算購物車 summary + 底部預估金額，包含 VIP 折扣顯示 */
function recalcSummary() {
  const el = document.getElementById('orderSummary');
  if (!el) return;

  // 1) 計算小計
  let subtotal = 0;
  const lines = cart
    .map((item) => {
      const sub = Number(item.price || 0) * Number(item.qty || 0);
      subtotal += sub;
      return `
      <div class="summary-row">
        <span>${item.name} x ${item.qty}</span>
        <span>$${sub}</span>
      </div>
    `;
    })
    .join('');

  // 2) VIP 折扣（需同時啟用 VIP 功能才生效）
  let vipDiscount = 0;
  const enableVip = !storeConfig || storeConfig.enableVip !== false;
  if (enableVip) {
    if (currentVipLevel === 1) {
      vipDiscount = Math.round(subtotal * 0.05);
    } else if (currentVipLevel === 2) {
      vipDiscount = Math.round(subtotal * 0.1);
    }
  }

  // 3) 優惠券折扣
  const couponCode = document.getElementById('coupon')?.value || '';
  let couponDiscount = 0;
  if (couponCode) {
    const c = availableCoupons.find((x) => x.code === couponCode);
    if (c) {
      if (c.discountType === 'amount') {
        couponDiscount = Number(c.discountValue || 0);
      } else if (c.discountType === 'percent') {
        const v = Number(c.discountValue || 0);
        const rate = v / 10;
        const payRate = Math.min(Math.max(rate, 0), 1);
        couponDiscount = Math.round(subtotal * (1 - payRate));
      }
      if (couponDiscount > subtotal) couponDiscount = subtotal;
    }
  }

  let finalTotal = subtotal - vipDiscount - couponDiscount;
  if (finalTotal < 0) finalTotal = 0;

  const hasCouponApplied = couponDiscount > 0;
  const hasVip = enableVip && vipDiscount > 0;

  const summaryNote =
    hasCouponApplied || hasVip
      ? '預估實付金額（已套用折扣）'
      : '預估實付金額';

  el.innerHTML = `
    ${lines}
    <div class="summary-row">
      <span>小計</span>
      <span>$${subtotal}</span>
    </div>
    ${enableVip ? `
    <div class="summary-row">
      <span>VIP 折扣${hasVip ? `（VIP${currentVipLevel}）` : ''}</span>
      <span>-$${vipDiscount}</span>
    </div>` : ''}
    <div class="summary-row">
      <span>優惠券折扣</span>
      <span>-$${couponDiscount}</span>
    </div>
    <div class="summary-row summary-total">
      <span>${summaryNote}</span>
      <span>$${finalTotal}</span>
    </div>
  `;

  const mobileTotalEl = document.getElementById('mobileTotal');
  if (mobileTotalEl) {
    mobileTotalEl.textContent = `$${finalTotal}`;
  }

  const mobileLabelEl = document.querySelector('.checkout-mobile-label');
  if (mobileLabelEl) {
    mobileLabelEl.textContent =
      hasCouponApplied || hasVip
        ? '預估金額（已套用折扣）'
        : '預估金額';
  }
}

function renderOrderSummary() {
  recalcSummary();
}

async function submitOrder() {
  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const payment = document.getElementById('payment').value;
  const couponCode = document.getElementById('coupon').value || '';

  let address = '';
  let store = '';

  // 驗證基本資訊
  if (!name) {
    alert('請輸入姓名');
    return;
  }
  if (!/^09\d{8}$/.test(phone)) {
    alert('請輸入正確的手機號碼（09 開頭共 10 碼）');
    return;
  }
  if (!payment) {
    alert('請選擇付款方式');
    return;
  }

  // 根據付款方式驗證地址 / 門市
  if (payment === PAYMENT_TYPE.HOME) {
    address = document.getElementById('address').value || '';
    const customAddr = document.getElementById('addressCustom').value.trim();
    if (customAddr) {
      address = customAddr;  // 自訂地址優先
    }
    if (!address) {
      alert('宅配請選擇或輸入地址');
      return;
    }
  } else if (payment === PAYMENT_TYPE.COD || payment === PAYMENT_TYPE.CVS_CODE) {
    store = document.getElementById('store').value || '';
    const customStore = document.getElementById('storeCustom').value.trim();
    if (customStore) {
      store = customStore;  // 自訂門市優先
    }
    if (!store) {
      alert('請選擇或輸入取貨門市');
      return;
    }
  }

  const cartObj = {};
  cart.forEach((i) => {
    cartObj[i.name] = i.qty;
  });

  const payload = {
    userId: currentProfile.userId || '',
    cart: cartObj,
    name,
    phone,
    address,
    store,
    couponCode,
    paymentMethod: payment,   // 把付款方式帶給後端
  };

  console.log('checkout payload', payload);

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error('checkout error', res.status);
      const errText = await res.text().catch(() => '');
      console.log('checkout error body:', errText);
      alert('下單失敗，請稍後再試');
      return;
    }

    const data = await res.json();
    const vipDiscount = Number(data.vipDiscount || 0);
    const couponDiscount = Number(data.couponDiscount || 0);

    // 成功下單後，同步更新會員基本資料
    if (currentProfile.userId) {
      try {
        const addresses = userAddresses.length
          ? userAddresses.map((a) => ({
              ...a,
              isDefault:
                a.address === address && payment === PAYMENT_TYPE.HOME,
            }))
          : [];

        const stores = userStores.length
          ? userStores.map((s) => ({
              ...s,
              isDefault:
                s.store === store &&
                (payment === PAYMENT_TYPE.COD ||
                  payment === PAYMENT_TYPE.CVS_CODE),
            }))
          : [];

        // 如果是新地址 / 門市，追加進去
        if (address && !addresses.find((a) => a.address === address)) {
          addresses.push({
            id: Date.now(),
            label: '',
            address,
            isDefault: payment === PAYMENT_TYPE.HOME,
          });
        }
        if (store && !stores.find((s) => s.store === store)) {
          stores.push({
            id: Date.now(),
            label: '',
            store,
            isDefault:
              payment === PAYMENT_TYPE.COD || payment === PAYMENT_TYPE.CVS_CODE,
          });
        }

        await fetch('/api/users/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentProfile.userId,
            name,
            phone,
            addresses: addresses.length ? addresses : undefined,
            stores: stores.length ? stores : undefined,
            lastUsedAddressId: address
              ? userAddresses.find((a) => a.address === address)?.id
              : null,
            lastUsedStoreId: store
              ? userStores.find((s) => s.store === store)?.id
              : null,
          }),
        });

        userAddresses = addresses;
        userStores = stores;
      } catch (e) {
        console.warn('更新會員基本資料失敗（不影響下單）', e);
      }
    }

    let msg = `下單成功！訂單編號：${data.orderId || ''}\n實際金額：$${data.total}`;
    if (vipDiscount > 0) {
      msg += `\nVIP 折扣已為您省下 $${vipDiscount}`;
    }
    if (couponDiscount > 0) {
      msg += `\n優惠券折扣已為您省下 $${couponDiscount}`;
    }
    alert(msg);

    localStorage.removeItem('cart');
    localStorage.removeItem('cartRaw');

    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      window.location.href = '/liff-shop/index.html';
    }
  } catch (err) {
    console.error(err);
    alert('下單失敗，請檢查網路或稍後再試');
  }
}

function goBack() {
  window.location.href = '/liff-shop/cart-summary.html';
}

window.goBack = goBack;

document.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error);
});
