// public/liff-shop/cart-summary.js

const LIFF_ID = '2008758720-AsQsTKBk';

let cart = [];
let products = {};

// 啟動
(async function init() {
  try {
    // 初始化 LIFF
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    // 載入商品資料
    const res = await fetch('/api/products');
    products = await res.json();

    // 從 localStorage 讀取購物車
    const saved = localStorage.getItem('cart');
    if (saved) {
      try {
        cart = JSON.parse(saved);
      } catch (e) {
        console.error('parse cart error', e);
        cart = [];
      }
    }

    renderCart();
  } catch (err) {
    console.error('init error', err);
    alert('初始化失敗，請稍後再試');
  }
})();

// 渲染購物車
function renderCart() {
  const container = document.getElementById('cartItemsList');
  const totalSection = document.getElementById('totalSection');
  const emptyMessage = document.getElementById('emptyMessage');
  const checkoutBtn = document.getElementById('checkoutBtn');

  if (!cart || cart.length === 0) {
    container.innerHTML = '';
    totalSection.style.display = 'none';
    emptyMessage.style.display = 'block';
    checkoutBtn.disabled = true;
    return;
  }

  let html = '';
  let totalPrice = 0;

  cart.forEach((item, index) => {
    const product = products[item.name] || {};
    const lineTotal = item.price * item.qty;
    totalPrice += lineTotal;

    html += `
      <div class="cart-summary-item">
        <img src="${item.imgUrl || product.image || ''}" 
             class="cart-summary-img" 
             alt="${item.name}">
        <div class="cart-summary-info">
          <div class="cart-summary-name">${item.name}</div>
          <div class="cart-summary-price">單價 $${item.price}</div>
          <div class="cart-summary-qty-controls">
            <button class="cart-summary-qty-btn" onclick="changeQty(${index}, -1)">−</button>
            <span class="cart-summary-qty-value">${item.qty}</span>
            <button class="cart-summary-qty-btn" onclick="changeQty(${index}, 1)">＋</button>
          </div>
          <div class="cart-summary-line-total">小計：$${lineTotal}</div>
        </div>
        <button class="cart-summary-remove" onclick="removeItem(${index})" title="移除">×</button>
      </div>
    `;
  });

  container.innerHTML = html;
  document.getElementById('totalPrice').textContent = `$${totalPrice}`;
  totalSection.style.display = 'block';
  emptyMessage.style.display = 'none';
  checkoutBtn.disabled = false;
}

// 修改數量
async function changeQty(index, delta) {
  if (!cart[index]) return;
  
  cart[index].qty += delta;
  
  if (cart[index].qty <= 0) {
    cart.splice(index, 1);
  }

  saveCart();
  renderCart();
  await syncCartToServer();
}

// 移除商品
async function removeItem(index) {
  if (!confirm('確定要移除此商品嗎？')) return;
  
  cart.splice(index, 1);
  saveCart();
  renderCart();
  await syncCartToServer();
}

// 儲存購物車到 localStorage
function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
  
  // 同步到 cartRaw（給 shop.js 用）
  const cartRaw = {};
  cart.forEach(item => {
    cartRaw[item.name] = item.qty;
  });
  localStorage.setItem('cartRaw', JSON.stringify(cartRaw));
}

// 同步購物車到伺服器
async function syncCartToServer() {
  try {
    if (!liff.isLoggedIn()) return;
    
    const profile = await liff.getProfile();
    const cartRaw = {};
    cart.forEach(item => {
      cartRaw[item.name] = item.qty;
    });

    await fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        userId: profile.userId, 
        cart: cartRaw 
      })
    });
  } catch (e) {
    console.error('sync cart to server error', e);
  }
}

// 返回商品頁
function goBack() {
  window.location.href = '/liff-shop/index.html';
}

// 前往結帳
function proceedToCheckout() {
  if (!cart || cart.length === 0) {
    alert('購物車是空的');
    return;
  }
  
  // 確保購物車已儲存
  saveCart();
  
  // 導向結帳頁
  window.location.href = '/liff-shop/checkout.html';
}

// 綁定到 window
window.changeQty = changeQty;
window.removeItem = removeItem;
window.goBack = goBack;
window.proceedToCheckout = proceedToCheckout;
