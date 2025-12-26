const LIFF_ID = '2008758720-AsQsTKBk';

let currentProfile = null;
let orderData = null;

async function init() {
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

  const userId = currentProfile?.userId;
  if (!userId) {
    showError('無法取得使用者資訊');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('id');

  if (!orderId) {
    showError('缺少訂單編號');
    return;
  }

  await loadOrderDetail(userId, orderId);
}

async function loadOrderDetail(userId, orderId) {
  try {
    const res = await fetch(`/api/user-orders?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error('載入訂單失敗');

    const data = await res.json();
    const orders = data.orders || [];
    
    const order = orders.find(o => String(o.id) === String(orderId));
    
    if (!order) {
      showError('找不到此訂單，或您無權查看');
      return;
    }

    orderData = order;
    renderOrderDetail();
    
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    
  } catch (e) {
    console.error(e);
    showError('載入訂單失敗，請稍後再試');
  }
}

function renderOrderDetail() {
  const container = document.getElementById('content');
  
  const statusMap = {
    unpaid: { text: '未付款', class: 'status-unpaid' },
    paid: { text: '已付款', class: 'status-paid' },
    unshipped: { text: '待出貨', class: 'status-paid' },
    shipped: { text: '已出貨', class: 'status-shipped' },
    done: { text: '已完成', class: 'status-done' },
    cancel: { text: '已取消', class: 'status-unpaid' },
  };

  const status = orderData.status || (orderData.paid ? 'paid' : 'unpaid');
  const statusInfo = statusMap[status] || { text: '未知', class: 'status-unpaid' };

  const createdAt = orderData.createdAt 
    ? new Date(orderData.createdAt).toLocaleString('zh-TW')
    : '-';

  const subtotal = orderData.subtotal || orderData.total || 0;
  const vipDiscount = orderData.vipDiscount || 0;
  const couponDiscount = orderData.couponDiscount || 0;
  const total = orderData.total || 0;

  const paymentMethodMap = {
    cash: '現金',
    linePay: 'LINE Pay',
    homeDelivery: '宅配（先付款）',
    cod: '貨到付款',
    cvsCode: '超商代碼繳費',
    card: '信用卡',
  };
  const paymentMethod = paymentMethodMap[orderData.paymentMethod] || orderData.paymentMethod || '現金';
  
  const deliveryInfo = orderData.address || orderData.store || '-';
  const customerName = orderData.name || '-';
  const customerPhone = orderData.phone || '-';

  // 商品列表
  const itemsHtml = (orderData.items || []).map(item => {
    const name = item.productName || item.name || '';
    const qty = item.qty || item.quantity || 0;
    const price = item.price || item.unitPrice || 0;
    const itemTotal = qty * price;

    return `
      <div class="item-row">
        <div>
          <div class="item-name">${name}</div>
          <div class="item-detail">單價 $${price} × ${qty}</div>
        </div>
        <div class="item-price">
          <div class="price-main">$${itemTotal}</div>
        </div>
      </div>
    `;
  }).join('');

  // 訂單狀態歷程
  const timeline = generateTimeline(orderData);

  // 按鈕區
  let buttonsHtml = '<button class="btn btn-primary" onclick="goBack()">返回</button>';
  
  if (status === 'unpaid' || status === 'cancel') {
    buttonsHtml += '<button class="btn btn-secondary" onclick="reorder()">重新下單</button>';
  }
  
  if (status === 'unpaid') {
    buttonsHtml += '<button class="btn btn-danger" onclick="cancelOrder()">取消訂單</button>';
  }

  container.innerHTML = `
    <!-- 基本資訊卡片 -->
    <div class="card">
      <div class="header">
        <div class="order-id">訂單 #${orderData.id}</div>
        <div class="status-badge ${statusInfo.class}">${statusInfo.text}</div>
      </div>

      <div class="section-title">📦 訂單資訊</div>
      <div class="info-row">
        <span class="info-label">訂單編號</span>
        <span class="info-value">${orderData.id}</span>
      </div>
      <div class="info-row">
        <span class="info-label">建立時間</span>
        <span class="info-value">${createdAt}</span>
      </div>
      <div class="info-row">
        <span class="info-label">訂單狀態</span>
        <span class="info-value">${statusInfo.text}</span>
      </div>
    </div>

    <!-- 收件人資訊 -->
    <div class="card">
      <div class="section-title">👤 收件人資訊</div>
      <div class="info-row">
        <span class="info-label">姓名</span>
        <span class="info-value">${customerName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">電話</span>
        <span class="info-value">${customerPhone}</span>
      </div>
      <div class="info-row">
        <span class="info-label">地址 / 門市</span>
        <span class="info-value">${deliveryInfo}</span>
      </div>
      <div class="info-row">
        <span class="info-label">付款方式</span>
        <span class="info-value">${paymentMethod}</span>
      </div>
    </div>

    <!-- 商品明細 -->
    <div class="card">
      <div class="section-title">🛒 商品明細</div>
      ${itemsHtml}
    </div>

        <!-- 金額明細 -->
    <div class="card">
      <div class="section-title">💰 金額明細</div>
      <div class="total-row">
        <span>商品小計</span>
        <span>$${subtotal}</span>
      </div>
      ${vipDiscount > 0 ? `
      <div class="total-row discount-row">
        <span>VIP 折扣（VIP${orderData.vipLevel || 0}）</span>
        <span>-$${vipDiscount}</span>
      </div>` : ''}
      ${couponDiscount > 0 ? `
      <div class="total-row discount-row">
        <span>優惠券折扣${orderData.couponCode ? `（${orderData.couponCode}）` : ''}</span>
        <span>-$${couponDiscount}</span>
      </div>` : ''}
      <div class="total-row final">
        <span>實付金額</span>
        <span>$${total}</span>
      </div>
    </div>

    <!-- 訂單狀態歷程 -->
    <div class="card">
      <div class="section-title">📋 訂單狀態歷程</div>
      <div class="timeline">
        ${timeline}
      </div>
    </div>

    <!-- 操作按鈕 -->
    <div class="card">
      ${buttonsHtml}
    </div>
  `;
}

function generateTimeline(order) {
  const status = order.status || (order.paid ? 'paid' : 'unpaid');
  const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleString('zh-TW') : '-';
  const updatedAt = order.updatedAt ? new Date(order.updatedAt).toLocaleString('zh-TW') : createdAt;

  const steps = [
    { key: 'created', title: '訂單建立', time: createdAt, active: true },
    { key: 'paid', title: '已付款', time: status === 'paid' || status === 'unshipped' || status === 'shipped' || status === 'done' ? updatedAt : null, active: ['paid', 'unshipped', 'shipped', 'done'].includes(status) },
    { key: 'shipped', title: '已出貨', time: status === 'shipped' || status === 'done' ? updatedAt : null, active: ['shipped', 'done'].includes(status) },
    { key: 'done', title: '已完成', time: status === 'done' ? updatedAt : null, active: status === 'done' },
  ];

  if (status === 'cancel') {
    return `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-title">訂單建立</div>
        <div class="timeline-time">${createdAt}</div>
      </div>
      <div class="timeline-item">
        <div class="timeline-line"></div>
        <div class="timeline-dot" style="background:#dc2626;box-shadow:0 0 0 2px #dc2626;"></div>
        <div class="timeline-title">訂單已取消</div>
        <div class="timeline-time">${updatedAt}</div>
      </div>
    `;
  }

  return steps.map((step, idx) => {
    const isLast = idx === steps.length - 1;
    return `
      <div class="timeline-item">
        ${!isLast ? '<div class="timeline-line"></div>' : ''}
        <div class="timeline-dot ${step.active ? '' : 'inactive'}"></div>
        <div class="timeline-title">${step.title}</div>
        <div class="timeline-time">${step.time || '-'}</div>
      </div>
    `;
  }).join('');
}

function showError(message) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="error">${message}</div>
      <button class="btn btn-secondary" onclick="goBack()" style="margin-top:16px;">返回</button>
    </div>
  `;
  document.getElementById('content').style.display = 'block';
}

function goBack() {
  if (liff.isInClient()) {
    liff.closeWindow();
  } else {
    window.history.back();
  }
}

async function cancelOrder() {
  if (!confirm('確定要取消此訂單嗎？取消後無法恢復。')) return;

  try {
    const res = await fetch(`/api/orders/${orderData.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancel' }),
    });

    const data = await res.json();
    
    if (data.status === 'ok') {
      alert('訂單已取消');
      window.location.reload();
    } else {
      alert('取消訂單失敗：' + (data.message || '未知錯誤'));
    }
  } catch (e) {
    console.error(e);
    alert('取消訂單失敗，請稍後再試');
  }
}

async function reorder() {
  if (!confirm('要將此訂單的商品重新加入購物車嗎？')) return;

  try {
    const cart = (orderData.items || []).map(item => ({
      name: item.productName || item.name,
      price: item.price || item.unitPrice || 0,
      qty: item.qty || item.quantity || 0,
      image: item.image || '',
    }));

    localStorage.setItem('cart', JSON.stringify(cart));
    alert('商品已加入購物車');
    window.location.href = '/liff-shop/checkout.html';
  } catch (e) {
    console.error(e);
    alert('重新下單失敗');
  }
}

window.goBack = goBack;
window.cancelOrder = cancelOrder;
window.reorder = reorder;

document.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error);
});
