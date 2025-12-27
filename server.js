const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');
const bodyParser = require('body-parser');
const cors = require('cors');
const ExcelJS = require('exceljs');
const multer = require('multer');
const axios = require('axios');
const exportRoutes = require('./routes/export');

const app = express();

// 一定要先解析 JSON
app.use(express.json());                 // ★ 加這行
app.use(express.urlencoded({ extended: true })); // ★ 這行也放這裡即可，下面那行可以刪掉

app.use(cors());

// 靜態檔與上傳檔
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// 這行就可以拿掉，因為上面已經有了：
// app.use(express.urlencoded({ extended: true }));

// 匯出 API：/api/export/...
app.use('/api/export', exportRoutes);

// 後台入口：/admin 直接開後台主畫面
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-orders.html'));
});

// ====== 共用工具：讀/寫 JSON ======
function loadJson(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', name + '.json'))
  );
}
function saveJson(name, data) {
  fs.writeFileSync(
    path.join(__dirname, 'data', name + '.json'),
    JSON.stringify(data, null, 2)
  );
}

// ====== 共用：套用優惠券規則 ======
function applyCoupon({ userId, amount, code, vipLevel }) {
  if (!code || typeof code !== 'string') {
    return { ok: false, reason: '未輸入優惠碼', discountAmount: 0, coupon: null };
  }

  let coupons = [];
  try {
    coupons = loadJson('coupons');
  } catch {
    coupons = [];
  }
  const now = new Date();
  const coupon = coupons.find((c) => c.code === code.trim());
  if (!coupon) {
    return { ok: false, reason: '優惠碼不存在', discountAmount: 0, coupon: null };
  }

  // 基本狀態
  if (coupon.isActive === false) {
    return { ok: false, reason: '此優惠券已停用', discountAmount: 0, coupon };
  }

  // 有效期間
  if (coupon.validFrom) {
    const vf = new Date(coupon.validFrom);
    if (!isNaN(vf.getTime()) && now < vf) {
      return { ok: false, reason: '活動尚未開始', discountAmount: 0, coupon };
    }
  }
  if (coupon.validUntil) {
    const vu = new Date(coupon.validUntil);
    if (!isNaN(vu.getTime()) && now > vu) {
      return { ok: false, reason: '優惠券已過期', discountAmount: 0, coupon };
    }
  }

  // 總使用上限
  if (typeof coupon.usageLimit === 'number') {
    const used = Number(coupon.usedCount || 0);
    if (used >= coupon.usageLimit) {
      return { ok: false, reason: '此優惠券已達使用上限', discountAmount: 0, coupon };
    }
  }

  // 限制 VIP 等級
  if (Array.isArray(coupon.allowedVipLevels) && coupon.allowedVipLevels.length) {
    const v = Number(vipLevel || 0);
    if (!coupon.allowedVipLevels.includes(v)) {
      return {
        ok: false,
        reason: '您的 VIP 等級不符合此優惠券條件',
        discountAmount: 0,
        coupon,
      };
    }
  }

  // 封鎖 userId
  if (Array.isArray(coupon.blockedUserIds) && coupon.blockedUserIds.length) {
    if (userId && coupon.blockedUserIds.includes(userId)) {
      return {
        ok: false,
        reason: '此帳號不得使用此優惠券',
        discountAmount: 0,
        coupon,
      };
    }
  }

  // 每人使用上限（從 orders.json 內統計該 userId + code）
  if (typeof coupon.perUserLimit === 'number' && userId) {
    let orders = [];
    try {
      orders = loadJson('orders');
    } catch {
      orders = [];
    }
    const usedByUser = orders.filter(
      (o) => o.userId === userId && o.couponCode === coupon.code
    ).length;
    if (usedByUser >= coupon.perUserLimit) {
      return {
        ok: false,
        reason: '此帳號已達此優惠券的使用次數上限',
        discountAmount: 0,
        coupon,
      };
    }
  }

  // 最低金額
  const amt = Number(amount || 0);
  const minAmount = Number(coupon.minAmount || 0);
  if (amt < minAmount) {
    return {
      ok: false,
      reason: `需滿 NT$${minAmount} 才可使用此優惠券`,
      discountAmount: 0,
      coupon,
    };
  }

  // 計算折扣金額
  let discount = 0;
  if (coupon.discountType === 'amount') {
    discount = Number(coupon.discountValue || 0);
  } else if (coupon.discountType === 'percent') {
    // 折扣值 9 = 9 折、8.5 = 8.5 折
    const v = Number(coupon.discountValue) || 0;
    const rate = v / 10; // 9 -> 0.9, 8.5 -> 0.85
    const payRate = Math.min(Math.max(rate, 0), 1); // 安全夾在 0~1
    discount = Math.round(amt * (1 - payRate)); // 折掉的金額

    if (typeof coupon.maxDiscount === 'number' && coupon.maxDiscount > 0) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
  } else {
    return { ok: false, reason: '優惠券折扣類型錯誤', discountAmount: 0, coupon };
  }

  if (discount < 0) discount = 0;
  if (discount === 0) {
    return { ok: false, reason: '折扣金額為 0，無法套用', discountAmount: 0, coupon };
  }
  if (discount > amt) discount = amt;

  return { ok: true, reason: null, discountAmount: discount, coupon };
}


// 這裡不要有 app.use(express.json());

// ... applyCoupon 等共用函式 ...

// ====== LINE 設定 ======
const config = {
  channelSecret:
    process.env.LINE_CHANNEL_SECRET || process.env.CHANNEL_SECRET,
  channelAccessToken:
    process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.ACCESS_TOKEN,
};
const client = new line.Client(config);

// 先宣告 webhook（前面不要有 JSON parser）
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = Array.isArray(req.body.events) ? req.body.events : [];
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const text = (event.message.text || '').trim();
        if (text === '菜單') {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: '🍜 之後會用這裡給你一個「開啟商店」按鈕',
          });
        } else {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: '輸入「菜單」看菜單',
          });
        }
      }
    }
    res.status(200).end();
  } catch (err) {
    console.error('webhook error', err);
    res.status(200).end();
  }
});


// 後面才開始套 bodyParser / cors / 靜態檔
app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/export', exportRoutes);
// ====== 商店設定 API：讀寫 data/store.json ======

// 取得商店設定
app.get('/api/store', (req, res) => {
  try {
    const store = loadJson('store'); // 讀 data/store.json
    res.json(store);
  } catch (e) {
    console.error('load store.json error:', e);
    res.json({
      name: '嘉義牛肉麵',
      adminTitle: '嘉義牛肉麵 後台',
      subtitle: '每日現煮牛肉湯',
      businessHours: '11:00–14:00, 17:00–20:00',
      takeoutEnabled: true,
      deliveryEnabled: false,
      productPageViews: 0,
      enableCoupons: true,
      enableVip: true,
      icon: '🍜',
      paymentMethods: {
        cash: true,
        linePay: false,
        card: false,
        homeDelivery: true,
        cod: true,
        cvsCode: true,
      },
    });
  }
});

// 更新商店設定（後台商店設定頁呼叫）
app.post('/api/store', (req, res) => {
  try {
    const body = req.body || {};

    const store = {
      name: body.name || '嘉義牛肉麵',
      adminTitle: body.adminTitle || '嘉義牛肉麵 後台',
      subtitle: body.subtitle || '每日現煮牛肉湯',
      businessHours: body.businessHours || '',
      takeoutEnabled: body.takeoutEnabled !== false,
      deliveryEnabled: !!body.deliveryEnabled,
      productPageViews: Number(body.productPageViews || 0),
      enableCoupons: body.enableCoupons !== false,
      enableVip: body.enableVip !== false,
      icon: body.icon || '🍜',
      paymentMethods: {
        cash: !!(body.paymentMethods?.cash),
        linePay: !!(body.paymentMethods?.linePay),
        card: !!(body.paymentMethods?.card),
        homeDelivery: !!(body.paymentMethods?.homeDelivery),
        cod: !!(body.paymentMethods?.cod),
        cvsCode: !!(body.paymentMethods?.cvsCode),
      },
    };

    saveJson('store', store); // 寫回 data/store.json
    res.json({ status: 'ok', store });
  } catch (e) {
    console.error('save store.json error:', e);
    res.status(500).json({ status: 'error', message: '儲存商店設定失敗' });
  }
});

// ====== 客人訂單通知（Messaging API push） ======
const LINE_CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.ACCESS_TOKEN;

// 讀 store 設定（含 bankInfo 跟 paymentMessageTemplates）
function loadStoreConfigSafe() {
  try {
    return loadJson('store'); // 讀 data/store.json
  } catch {
    return {};
  }
}

// 把訂單品項轉成文字清單
function buildItemsText(order) {
  const lines = [];
  (order.items || []).forEach((it) => {
    lines.push(`- ${it.productName} x${it.qty}（$${it.price}）`);
  });
  return lines.join('\n');
}

// 簡單的模板替換：{{key}}
function applyTemplate(template, vars) {
  let text = template || '';
  Object.entries(vars).forEach(([key, value]) => {
    const re = new RegExp(`{{${key}}}`, 'g');
    text = text.replace(re, String(value ?? ''));
  });
  return text;
}

async function notifyCustomerNewOrder(order, orderNo) {
  console.log('notifyCustomerNewOrder called, order =', order, 'orderNo =', orderNo);

  const to = order.lineUserId; // 客人的 LINE userId
if (!to || !LINE_CHANNEL_ACCESS_TOKEN) {
  console.log(
    'notifyCustomerNewOrder skip, to =',
    to,
    'hasToken =',
    !!LINE_CHANNEL_ACCESS_TOKEN
  );
  return;
}

const store = loadStoreConfigSafe();
const templates = store.paymentMessageTemplates || {};
const bankInfo = store.bankInfo || {};

const method = order.paymentMethod || 'cash';
const template =
  templates[method] ||
  '📦 感謝您的訂購\n訂單編號：{{orderNo}}\n付款方式：{{paymentMethod}}\n\n應付金額：{{total}} 元\n\n訂單明細：\n{{items}}';

const text = applyTemplate(template, {
  orderNo,
  total: order.total || 0,
  paymentMethod: method,
  payCode: order.cvsCode || '',
  items: buildItemsText(order),
  bankName: bankInfo.bankName || '',
  bankOwner: bankInfo.bankOwner || '',
  bankAccount: bankInfo.bankAccount || '',
});

  const body = {
    to,
    messages: [{ type: 'text', text }],
  };

  try {
    const resp = await axios.post(
      'https://api.line.me/v2/bot/message/push',
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
    console.log('notifyCustomerNewOrder success, status =', resp.status);
  } catch (e) {
    console.error(
      'notifyCustomerNewOrder error:',
      e.response?.data || e.message
    );
  }
}
// 優惠券即時驗證 API
app.get('/api/coupons/validate', (req, res) => {
  const code = (req.query.code || '').trim();
  const userId = (req.query.userId || '').trim() || null;
  const amount = Number(req.query.amount || 0) || 0;
  const vipLevel = Number(req.query.vipLevel || 0) || 0;

  const result = applyCoupon({ userId, amount, code, vipLevel });
  res.json(result);
});

// 結帳：寫入 orders.json（含 VIP / 優惠券 / 聯絡資料）
app.post('/api/checkout', (req, res) => {
  console.log('checkout req.body =', req.body);

  // 先看現在是測試還是正式
  let settings = {};
  try {
    settings = loadJson('settings');
  } catch {
    settings = { mode: 'local', allowOrders: false };
  }

  if (settings.mode === 'local' && !settings.allowOrders) {
    return res.status(503).json({
      status: 'error',
      message: '目前為測試模式，尚未開放正式下單',
    });
  }

  // ✅ 解構，包含 paymentMethod
  const {
    userId,
    cart,
    name,
    phone,
    address,
    store,
    couponCode,
    paymentMethod, // 新增：從前端送來的付款方式
  } = req.body;

  const products = loadJson('products');
  let subtotal = 0;
  const items = Object.entries(cart || {}).map(([productName, qty]) => {
    const price = products[productName]?.price || 0;
    const subTotal = price * qty;
    subtotal += subTotal;
    return { productName, qty, price, subTotal };
  });

  // users / VIP：讀取或建立會員
  let users = [];
  try {
    users = loadJson('users');
  } catch {
    users = [];
  }
  let user = users.find((u) => u.userId === userId);
  if (!user) {
    user = {
      userId,
      name: name || '',
      phone: phone || '',
      address: address || '',
      totalSpent: 0,
      vipLevel: 0,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
  }

  const vipLevel = Number(user.vipLevel || 0);
  let vipDiscountRate = 0;
  if (vipLevel === 1) vipDiscountRate = 0.05;
  if (vipLevel === 2) vipDiscountRate = 0.1;
  const vipDiscount = Math.round(subtotal * vipDiscountRate);

  // store 設定：是否啟用 VIP / 優惠券
  let storeConfig = {};
  try {
    storeConfig = loadJson('store');
  } catch {
    storeConfig = {};
  }
  const enableVip = storeConfig.enableVip !== false;
  const enableCoupons = storeConfig.enableCoupons !== false;
  const finalVipDiscount = enableVip ? vipDiscount : 0;

  // 先算 VIP 後的基礎金額
  let baseAmount = subtotal - finalVipDiscount;
  if (baseAmount < 0) baseAmount = 0;

  // 套用優惠券（若有）
  let couponDiscount = 0;
  let appliedCoupon = null;
  if (
    enableCoupons &&
    couponCode &&
    typeof couponCode === 'string' &&
    couponCode.trim() !== ''
  ) {
    const { ok, discountAmount, coupon, reason } = applyCoupon({
      userId,
      amount: baseAmount,
      code: couponCode.trim(),
      vipLevel,
    });
    if (ok && coupon) {
      couponDiscount = discountAmount;
      appliedCoupon = coupon.code;

      // 累加 usedCount
      try {
        let coupons = [];
        try {
          coupons = loadJson('coupons');
        } catch {
          coupons = [];
        }
        const idx = coupons.findIndex((c) => c.code === coupon.code);
        if (idx !== -1) {
          coupons[idx].usedCount = (coupons[idx].usedCount || 0) + 1;
          saveJson('coupons', coupons);
        }
      } catch (e) {
        console.error('update coupon usedCount error:', e);
      }
    } else {
      console.log('coupon not applied:', reason);
    }
  }

  let total = baseAmount - couponDiscount;
  if (total < 0) total = 0;

  // 更新會員累積消費與 VIP 等級
  const beforeTotal = Number(user.totalSpent || 0);
  const afterTotal = beforeTotal + total;
  user.totalSpent = afterTotal;
  user.lastOrderAt = new Date().toISOString();

  const vip1Threshold = 5000;
  const vip2Threshold = 15000;
  let newVipLevel = 0;
  if (afterTotal >= vip2Threshold) newVipLevel = 2;
  else if (afterTotal >= vip1Threshold) newVipLevel = 1;
  user.vipLevel = newVipLevel;

  try {
    saveJson('users', users);
  } catch (e) {
    console.error('save users error:', e);
  }

  // 寫入訂單
  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    orders = [];
  }

  const order = {
    id: Date.now(),
    userId,
    name,
    items,
    subtotal,
    vipLevel: newVipLevel,
    vipDiscount: finalVipDiscount,
    couponCode: appliedCoupon,
    couponDiscount,
    total,
    createdAt: new Date().toISOString(),
    note: '',
    phone: phone || '',
    address: address || '',
    store: store || '',
    // ✅ 付款方式寫進訂單，沒傳就預設 'cash'
    paymentMethod: paymentMethod || 'cash',
    status: 'unpaid',
    paid: false,
    settled: false,
  };
  orders.push(order);
  saveJson('orders', orders);

  console.log('checkout saved:', order.id);

  const orderNo = 'C' + String(order.id);

// 在 checkout 這支也推一則通知給客人
notifyCustomerNewOrder(
  {
    lineUserId: userId,
    name,
    phone,
    address,
    paymentMethod: paymentMethod || 'cash',
    items: items.map((it) => ({
      productName: it.productName,
      price: it.price,
      qty: it.qty,
    })),
    total,
  },
  orderNo
).catch((e) => {
  console.error(
    'notifyCustomerNewOrder error:',
    e.response?.data || e.message
  );
});

// ✅ 只回傳一次
res.json({
  status: 'ok',
  orderId: orderNo,
  total,
  vipDiscount: finalVipDiscount,
  couponDiscount,
  vipLevel: newVipLevel,
  totalSpent: user.totalSpent,
});
});

// ====== 前台建立訂單（/api/orders）＋ 後台訂單管理 ======
app.post('/api/orders', (req, res) => {
  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    orders = [];
  }

  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return res
      .status(400)
      .json({ status: 'error', message: 'items is required' });
  }

  const now = new Date();

  const maxId = orders.reduce(
    (max, o) => Math.max(max, Number(o.id || 0)),
    0
  );
  const newId = maxId + 1;

  const order = {
    id: newId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: 'unpaid',
    served: false,
    paid: false,
    note: '',
    lineUserId: body.lineUserId || '',
    lineName: body.lineName || '',
    name: body.name || '',
    phone: body.phone || '',
    address: body.address || '',
    paymentMethod: body.paymentMethod || 'cash',
    items: items.map((it) => ({
      productId: it.productId || '',
      productName: it.name || '',
      price: Number(it.price || 0),
      qty: Number(it.quantity || 0),
    })),
  };

  orders.push(order);
  saveJson('orders', orders);

  const orderNo = 'O' + String(order.id).padStart(6, '0');

  notifyCustomerNewOrder(order, orderNo).catch((e) => {
    console.error(
      'notifyCustomerNewOrder error:',
      e.response?.data || e.message
    );
  });

  res.json({
    status: 'ok',
    orderId: order.id,
    orderNo,
    order,
  });
});

app.get('/api/orders', (req, res) => {
  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    orders = [];
  }
  res.json(orders);
});

app.patch('/api/orders/:id', (req, res) => {
  const orderId = Number(req.params.id);
  const { served, paid, note } = req.body;

  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    return res
      .status(500)
      .json({ status: 'error', message: 'orders file error' });
  }

  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) {
    return res
      .status(404)
      .json({ status: 'error', message: 'order not found' });
  }

  if (typeof served === 'boolean') orders[idx].served = served;
  if (typeof paid === 'boolean') orders[idx].paid = paid;
  if (typeof note === 'string') orders[idx].note = note;

  orders[idx].updatedAt = new Date().toISOString();

  saveJson('orders', orders);
  res.json({ status: 'ok', order: orders[idx] });
});

// 單一訂單狀態（含安全規則 + 付款累積 VIP）
app.post('/api/orders/:id/status', (req, res) => {
  const orderId = Number(req.params.id);
  const { status } = req.body;

  console.log('UPDATE STATUS API', orderId, status);

  const allowed = ['unpaid', 'paid', 'unshipped', 'shipped', 'done', 'cancel'];
  if (!allowed.includes(status)) {
    console.log('BAD STATUS', status);
    return res
      .status(400)
      .json({ status: 'error', message: 'invalid status' });
  }

  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    return res
      .status(500)
      .json({ status: 'error', message: 'orders file error' });
  }

  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) {
    return res
      .status(404)
      .json({ status: 'error', message: 'order not found' });
  }

  const order = orders[idx];
  const currentStatus = order.status || 'unpaid';

  if (
    status === 'shipped' &&
    !['paid', 'unshipped'].includes(currentStatus)
  ) {
    return res.status(400).json({
      status: 'error',
      message: '只有已付款或待出貨訂單可以設為已出貨',
    });
  }

  if (status === 'done' && currentStatus !== 'shipped') {
    return res.status(400).json({
      status: 'error',
      message: '只有已出貨訂單可以標記為完成',
    });
  }

  if (
    status === 'cancel' &&
    !['unpaid', 'cancel'].includes(currentStatus)
  ) {
    return res.status(400).json({
      status: 'error',
      message: '只有未付款或已取消訂單可以移除',
    });
  }

  const beforeStatus = currentStatus;

  order.status = status;
  if (status === 'paid') {
    order.paid = true;
  } else if (status === 'unpaid') {
    order.paid = false;
  }
  order.updatedAt = new Date().toISOString();

  const justPaid = beforeStatus !== 'paid' && status === 'paid';
  console.log('justPaid?', justPaid, 'before =', beforeStatus, 'after =', status);

  if (justPaid && order.userId) {
    console.log('start VIP accumulate for userId =', order.userId);
    try {
      let users = [];
      try {
        users = loadJson('users');
      } catch {
        users = [];
      }

      let user = users.find((u) => u.userId === order.userId);
      if (!user) {
        user = {
          userId: order.userId,
          name: order.name || '',
          totalSpent: 0,
          vipLevel: 0,
        };
        users.push(user);
      }

      const vipLevel = Number(user.vipLevel || 0);

      let orderTotal = 0;
      if (typeof order.total === 'number') {
        orderTotal = order.total;
      } else {
        const subtotal = Number(order.subtotal || 0);
        const vipDiscount = Number(order.vipDiscount || 0);
        const couponDiscount = Number(order.couponDiscount || 0);
        orderTotal = subtotal - vipDiscount - couponDiscount;
      }
      if (orderTotal < 0) orderTotal = 0;

      const beforeTotal = Number(user.totalSpent || 0);
      const afterTotal = beforeTotal + orderTotal;
      user.totalSpent = afterTotal;

      let newVipLevel = vipLevel;
      if (afterTotal >= 15000) {
        newVipLevel = 2;
      } else if (afterTotal >= 5000) {
        newVipLevel = 1;
      } else {
        newVipLevel = 0;
      }
      user.vipLevel = newVipLevel;

      saveJson('users', users);
      console.log(
        'VIP updated on paid:',
        order.userId,
        'orderTotal =', orderTotal,
        'totalSpent =', afterTotal,
        'vipLevel =', newVipLevel
      );
    } catch (e) {
      console.error('update VIP on paid error:', e);
    }
  }

  saveJson('orders', orders);
  res.json({ status: 'ok', order });
});

// 單筆移除訂單（軟刪除）
app.post('/api/admin/orders/:id/remove', (req, res) => {
  const orderId = Number(req.params.id);

  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    return res
      .status(500)
      .json({ status: 'error', message: 'orders file error' });
  }

  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) {
    return res
      .status(404)
      .json({ status: 'error', message: 'order not found' });
  }

  const order = orders[idx];
  const currentStatus = order.status || 'unpaid';

  if (!['unpaid', 'cancel'].includes(currentStatus)) {
    return res.status(400).json({
      status: 'error',
      message: '只有未付款或已取消訂單可以移除',
    });
  }

  order.status = 'cancel';
  order.updatedAt = new Date().toISOString();
  saveJson('orders', orders);
  res.json({ status: 'ok', order });
});

// 更新某 userId 聯絡資料（後台帳號管理用，同步 orders + users）
app.post('/api/accounts/:userId/contact', (req, res) => {
  const userIdFromPath = req.params.userId;
  const { phone, address, store, vipLevel, blacklisted } = req.body;
  
  if (!userIdFromPath) {
    return res
      .status(400)
      .json({ status: 'error', message: 'userId is required' });
  }

  // 1. 更新 orders.json
  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    return res
      .status(500)
      .json({ status: 'error', message: 'orders file error' });
  }

  let updated = 0;
  orders = orders.map((o) => {
    if (o.userId === userIdFromPath) {
      if (typeof phone === 'string') o.phone = phone;
      if (typeof address === 'string') o.address = address;
      if (typeof store === 'string') o.store = store;

      if (
        vipLevel !== undefined &&
        vipLevel !== null &&
        !Number.isNaN(Number(vipLevel))
      ) {
        o.vipLevel = Number(vipLevel);
      }

      if (typeof blacklisted === 'boolean') {
        o.blacklisted = blacklisted;
      }

      updated += 1;
    }
    return o;
  });

  if (!updated) {
    return res
      .status(404)
      .json({ status: 'error', message: 'no order for this userId' });
  }

  saveJson('orders', orders);

  // 2. 同步更新 users.json
  let users = [];
  try {
    users = loadJson('users');
  } catch {
    users = [];
  }

  let user = users.find(u => u.userId === userIdFromPath);
  if (user) {
    if (typeof phone === 'string') user.phone = phone;
    
    if (
      vipLevel !== undefined &&
      vipLevel !== null &&
      !Number.isNaN(Number(vipLevel))
    ) {
      user.vipLevel = Number(vipLevel);
    }

    user.updatedAt = new Date().toISOString();
    saveJson('users', users);
  }

  res.json({ status: 'ok', updatedCount: updated, orders });
});


// 批次設為已出貨
app.post('/api/admin/orders/bulk-ship', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length) {
    return res
      .status(400)
      .json({ status: 'error', message: 'ids is required' });
  }

  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    return res
      .status(500)
      .json({ status: 'error', message: 'orders file error' });
  }

  let updated = 0;
  const now = new Date().toISOString();

  orders.forEach((o) => {
    if (!ids.includes(Number(o.id))) return;
    const currentStatus = o.status || 'unpaid';

    // 只允許已付款或待出貨改成已出貨
    if (!['paid', 'unshipped'].includes(currentStatus)) return;

    o.status = 'shipped';
    o.updatedAt = now;
    updated += 1;
  });

  saveJson('orders', orders);
  res.json({ status: 'ok', updated });
});

// 批次標記完成（只允許已出貨）
app.post('/api/admin/orders/bulk-complete', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length) {
    return res
      .status(400)
      .json({ status: 'error', message: 'ids is required' });
  }

  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    return res
      .status(500)
      .json({ status: 'error', message: 'orders file error' });
  }

  let updated = 0;
  const now = new Date().toISOString();

  orders.forEach((o) => {
    if (!ids.includes(Number(o.id))) return;
    const currentStatus = o.status || 'unpaid';

    // 只允許已出貨改成已完成
    if (currentStatus !== 'shipped') return;

    o.status = 'done';
    o.updatedAt = now;
    updated += 1;
  });

  saveJson('orders', orders);
  res.json({ status: 'ok', updated });
});

// ====== 後台整合設定 API（LIFF / 模式 等） ======
app.get('/api/admin/settings', (req, res) => {
  try {
    const s = loadJson('settings');   // data/settings.json
    res.json(s);
  } catch {
    // 第一次還沒有檔案時的預設值
    res.json({
      mode: 'local',        // local / public
      allowOrders: false,   // 是否允許真正建立訂單
      lineLiffId: '',
      baseUrl: '',
      extra: [],            // 給設定頁下面那張表用
    });
  }
});

app.post('/api/admin/settings', (req, res) => {
  const body = req.body || {};
  const settings = {
    mode: body.mode === 'public' ? 'public' : 'local',
    allowOrders: !!body.allowOrders,
    lineLiffId: body.lineLiffId || '',
    baseUrl: body.baseUrl || '',
    extra: Array.isArray(body.extra) ? body.extra : [],
  };
  try {
    saveJson('settings', settings);   // 寫到 data/settings.json
    res.json({ status: 'ok', settings });
  } catch (e) {
    console.error('save settings error:', e);
    res
      .status(503)
      .json({ status: 'error', message: 'save settings failed' });
  }
});

// 商店總設定 API
app.get('/api/store', (req, res) => {
  try {
    const store = loadJson('store');   // 讀 data/store.json
    res.json(store);
  } catch {
    res.json({
      name: '嘉義牛肉麵',
      adminTitle: '嘉義牛肉麵 後台',
      subtitle: '每日現煮牛肉湯',
      businessHours: '11:00–14:00, 17:00–20:00',
      takeoutEnabled: true,
      deliveryEnabled: false,
      productPageViews: 0,
      enableCoupons: true,
      enableVip: true,
      icon: '🛒',
      paymentMethods: {
        cash: true,
        linePay: true,
        card: false,
        homeDelivery: false,
        cod: false,
        cvsCode: false,
      },
    });
  }
});

app.post('/api/store', (req, res) => {
  const body = req.body || {};

  const store = {
    name: body.name || '',
    adminTitle: body.adminTitle || '',
    subtitle: body.subtitle || '',
    businessHours: body.businessHours || '',
    takeoutEnabled: !!body.takeoutEnabled,
    deliveryEnabled: !!body.deliveryEnabled,
    productPageViews: Number(body.productPageViews || 0) || 0,
    enableCoupons: !!body.enableCoupons,
    enableVip: !!body.enableVip,
    icon: body.icon || '🛒',
    paymentMethods: {
      cash: !!(body.paymentMethods && body.paymentMethods.cash),
      linePay: !!(body.paymentMethods && body.paymentMethods.linePay),
      card: !!(body.paymentMethods && body.paymentMethods.card),
      homeDelivery: !!(body.paymentMethods && body.paymentMethods.homeDelivery),
      cod: !!(body.paymentMethods && body.paymentMethods.cod),
      cvsCode: !!(body.paymentMethods && body.paymentMethods.cvsCode),
    },
  };

  try {
    saveJson('store', store);          // 寫回 data/store.json
    res.json({ status: 'ok', store });
  } catch (e) {
    console.error('save store error:', e);
    res.status(503).json({ status: 'error', message: 'save store failed' });
  }
});



// 前台：商品頁瀏覽次數 +1
app.post('/api/store/views/products', (req, res) => {
  let store;
  try {
    store = loadJson('store');
  } catch {
    store = {};
  }
  store.productPageViews = (store.productPageViews || 0) + 1;
  saveJson('store', store);
  res.json({ status: 'ok', views: store.productPageViews });
});
// ====== 購物車同步 API：存到 data/carts.json ======
app.post('/api/cart', (req, res) => {
  const body = req.body || {};
  const userId = body.userId || '';
  const cart = body.cart || {};

  if (!userId) {
    return res
      .status(400)
      .json({ status: 'error', message: 'missing userId' });
  }

  let carts;
  try {
    carts = loadJson('carts'); // 讀 data/carts.json，如果不存在會 throw
  } catch {
    carts = {};                // 第一次沒有檔案就用空物件
  }

  carts[userId] = cart;

  try {
    saveJson('carts', carts);  // 寫回 data/carts.json
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('save carts error:', e);
    res.status(503).json({ status: 'error', message: 'save cart failed' });
  }
});

// ====== 優惠券 API（後台管理用）=====
app.get('/api/coupons', (req, res) => {
  try {
    const coupons = loadJson('coupons');
    res.json(coupons);
  } catch {
    res.json([]);
  }
});

app.post('/api/coupons', (req, res) => {
  const coupons = req.body;
  if (!Array.isArray(coupons)) {
    return res
      .status(400)
      .json({ status: 'error', message: 'invalid coupons' });
  }

  // 基本驗證
  for (const c of coupons) {
    if (!c.code || typeof c.code !== 'string') {
      return res
        .status(400)
        .json({ status: 'error', message: '每筆優惠券都要有代碼' });
    }
    if (!['amount', 'percent'].includes(c.discountType)) {
      return res
        .status(400)
        .json({ status: 'error', message: `優惠券 ${c.code} 折扣類型錯誤` });
    }
    if (c.discountValue < 0) {
      return res
        .status(400)
        .json({ status: 'error', message: `優惠券 ${c.code} 折扣值不可小於 0` });
    }
    if (c.minAmount < 0) {
      return res
        .status(400)
        .json({ status: 'error', message: `優惠券 ${c.code} 最低金額不可小於 0` });
    }
    if (c.validFrom && c.validUntil) {
      const vf = new Date(c.validFrom);
      const vu = new Date(c.validUntil);
      if (!isNaN(vf.getTime()) && !isNaN(vu.getTime()) && vf > vu) {
        return res.status(400).json({
          status: 'error',
          message: `優惠券 ${c.code} 的開始時間不得晚於結束時間`,
        });
      }
    }
  }

  try {
    saveJson('coupons', coupons);
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('save coupons error:', e);
    res
      .status(503)
      .json({ status: 'error', message: 'save coupons failed' });
  }
});

// 取得目前使用者的會員資料 + VIP 狀態 + 可用優惠券
app.get('/api/users/me', (req, res) => {
  const userId = (req.query.userId || '').trim();
  if (!userId) {
    return res
      .status(400)
      .json({ status: 'error', message: 'userId is required' });
  }

  let users = [];
  try {
    users = loadJson('users');
  } catch {
    users = [];
  }

  let user = users.find((u) => u.userId === userId);
  if (!user) {
    user = {
      userId,
      name: '',
      phone: '',
      addresses: [],
      stores: [],
      lastUsedAddressId: null,
      lastUsedStoreId: null,
      totalSpent: 0,
      vipLevel: 0,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveJson('users', users);
  }

  const vipLevel = Number(user.vipLevel || 0);
  const totalSpent = Number(user.totalSpent || 0);

  // 可用優惠券（簡化版：只過濾時間 / 啟用狀態 / VIP 等級）
  let usableCoupons = [];
  try {
    const coupons = loadJson('coupons');
    const now = new Date();
    usableCoupons = coupons.filter((c) => {
      if (c.isActive === false) return false;

      if (c.validFrom) {
        const vf = new Date(c.validFrom);
        if (!isNaN(vf.getTime()) && now < vf) return false;
      }
      if (c.validUntil) {
        const vu = new Date(c.validUntil);
        if (!isNaN(vu.getTime()) && now > vu) return false;
      }

      if (Array.isArray(c.allowedVipLevels) && c.allowedVipLevels.length) {
        if (!c.allowedVipLevels.includes(vipLevel)) return false;
      }
      return true;
    });
  } catch {
    usableCoupons = [];
  }

  // 計算下一級 VIP 所需
  let nextLevel = null;
  let amountToNext = 0;
  if (vipLevel < 1 && totalSpent < 5000) {
    nextLevel = 1;
    amountToNext = 5000 - totalSpent;
  } else if (vipLevel < 2 && totalSpent < 15000) {
    nextLevel = 2;
    amountToNext = 15000 - totalSpent;
  }

  res.json({
    status: 'ok',
    user,
    vipLevel,
    totalSpent,
    usableCoupons,
    nextLevel,
    amountToNext,
  });
});

// 取得所有會員資料（給後台帳號管理用）
app.get('/api/users/all', (req, res) => {
  let users = [];
  try {
    users = loadJson('users');
  } catch {
    users = [];
  }
  res.json(users);
});


// 更新 / 建立會員基本資料（姓名 / 電話 / 多地址 / 多門市）
app.post('/api/users/me', (req, res) => {
  const {
    userId,
    name,
    phone,
    address,
    store,
    addresses,
    stores,
    lastUsedAddressId,
    lastUsedStoreId,
  } = req.body || {};

  if (!userId) {
    return res
      .status(400)
      .json({ status: 'error', message: 'userId is required' });
  }

  let users = [];
  try {
    users = loadJson('users');
  } catch {
    users = [];
  }

  let user = users.find((u) => u.userId === userId);
  if (!user) {
    user = {
      userId,
      name: '',
      phone: '',
      addresses: [],
      stores: [],
      lastUsedAddressId: null,
      lastUsedStoreId: null,
      totalSpent: 0,
      vipLevel: 0,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
  }

  // 更新基本資訊
  if (typeof name === 'string' && name.trim()) {
    user.name = name.trim();
  }
  if (typeof phone === 'string' && phone.trim()) {
    user.phone = phone.trim();
  }

  // 處理地址陣列（新格式：[{ id, label, address, isDefault }]）
  let addrList = Array.isArray(user.addresses) ? user.addresses : [];

  if (Array.isArray(addresses)) {
    addrList = addresses
      .map((a) => ({
        id: a.id || Date.now(),
        label: (a.label || '').trim(),
        address: (a.address || '').trim(),
        isDefault: Boolean(a.isDefault),
      }))
      .filter((a) => a.address);
  } else if (typeof address === 'string' && address.trim()) {
    const trimAddr = address.trim();
    if (!addrList.find((a) => a.address === trimAddr)) {
      addrList.push({
        id: Date.now(),
        label: '',
        address: trimAddr,
        isDefault: false,
      });
    }
  }

  // 處理取貨門市陣列（新格式：[{ id, label, store, isDefault }]）
  let storeList = Array.isArray(user.stores) ? user.stores : [];

  if (Array.isArray(stores)) {
    storeList = stores
      .map((s) => ({
        id: s.id || Date.now(),
        label: (s.label || '').trim(),
        store: (s.store || '').trim(),
        isDefault: Boolean(s.isDefault),
      }))
      .filter((s) => s.store);
  } else if (typeof store === 'string' && store.trim()) {
    const trimStore = store.trim();
    if (!storeList.find((s) => s.store === trimStore)) {
      storeList.push({
        id: Date.now(),
        label: '',
        store: trimStore,
        isDefault: false,
      });
    }
  }

  user.addresses = addrList;
  user.stores = storeList;

  // 記錄上次使用的地址 / 門市
  if (typeof lastUsedAddressId !== 'undefined' && lastUsedAddressId !== null) {
    user.lastUsedAddressId = lastUsedAddressId;
  }
  if (typeof lastUsedStoreId !== 'undefined' && lastUsedStoreId !== null) {
    user.lastUsedStoreId = lastUsedStoreId;
  }

  user.updatedAt = new Date().toISOString();

  saveJson('users', users);
  res.json({ status: 'ok', user });
});

// 取使用者的訂單歷史
app.get('/api/user-orders', (req, res) => {
  const userId = (req.query.userId || '').trim();
  if (!userId) {
    return res
      .status(400)
      .json({ status: 'error', message: 'userId is required' });
  }

  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    orders = [];
  }

  const userOrders = orders
    .filter((o) => o.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ status: 'ok', orders: userOrders });
});

// 地址驗證 / 自動補全
app.post('/api/address/validate', (req, res) => {
  const { address } = req.body || {};
  if (!address || typeof address !== 'string') {
    return res
      .status(400)
      .json({ status: 'error', message: 'address is required' });
  }

  try {
    const trimmed = address.trim();
    if (trimmed.length < 5) {
      return res.json({
        status: 'error',
        message: '地址長度至少 5 個字',
        suggestions: [],
      });
    }

    // 簡化版：直接返回輸入的地址
    res.json({
      status: 'ok',
      address: trimmed,
      suggestions: [trimmed],
    });
  } catch (e) {
    console.error('address validate error:', e);
    res.json({
      status: 'error',
      message: '地址驗證失敗',
      suggestions: [],
    });
  }
});
// ====== 上傳資料夾（營收 Excel + 商品圖片用）======
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// ====== 商品圖片上傳設定 ======
const productImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = 'product-' + Date.now();
    cb(null, base + ext);
  },
});
const uploadProductImage = multer({
  storage: productImageStorage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
}).single('image');

// 商品圖片上傳 API
app.post('/api/admin/products/upload-image', (req, res) => {
  console.log('hit /api/admin/products/upload-image');
  uploadProductImage(req, res, (err) => {
    if (err) {
      console.error('upload image error:', err);
      return res
        .status(400)
        .json({ status: 'error', message: '圖片上傳失敗' });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ status: 'error', message: '沒有收到圖片檔案' });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ status: 'ok', url });
  });
});

// ====== 產品分類 API（後台用）======

// 取得所有分類
app.get('/api/admin/product-categories', (req, res) => {
  try {
    const cats = loadJson('product-categories'); // data/product-categories.json
    res.json(cats);
  } catch {
    res.json([]);
  }
});

// 儲存分類（整包覆蓋）
app.post('/api/admin/product-categories', (req, res) => {
  const categories = req.body;
  if (!Array.isArray(categories)) {
    return res
      .status(400)
      .json({ status: 'error', message: 'invalid categories' });
  }
  try {
    saveJson('product-categories', categories);
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('save product-categories error:', e);
    res
      .status(503)
      .json({ status: 'error', message: 'save product-categories failed' });
  }
});

// ====== 商品 API（後台用）======

// 取得全部商品（物件形式：{ name: { price, stock, ... } })
app.get('/api/admin/products', (req, res) => {
  try {
    const products = loadJson('products'); // data/products.json
    res.json(products);
  } catch {
    res.json({});
  }
});

// 儲存全部商品（整包覆蓋）
app.post('/api/admin/products', (req, res) => {
  const products = req.body;
  if (!products || typeof products !== 'object' || Array.isArray(products)) {
    return res
      .status(400)
      .json({ status: 'error', message: 'invalid products payload' });
  }

  // 基本驗證
  for (const [name, p] of Object.entries(products)) {
    if (!name || typeof p !== 'object' || p == null) {
      return res
        .status(400)
        .json({ status: 'error', message: `invalid product: ${name}` });
    }
    if (typeof p.price === 'undefined') {
      return res
        .status(400)
        .json({ status: 'error', message: `商品 ${name} 缺少 price` });
    }
  }

  try {
    saveJson('products', products);
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('save products error:', e);
    res
      .status(503)
      .json({ status: 'error', message: 'save products failed' });
  }
});

// 單一商品更新
app.post('/api/admin/products/:name', (req, res) => {
  const nameFromPath = decodeURIComponent(req.params.name || '').trim();
  if (!nameFromPath) {
    return res
      .status(400)
      .json({ status: 'error', message: 'product name is required' });
  }

  let products;
  try {
    products = loadJson('products');
  } catch {
    products = {};
  }

  const old = products[nameFromPath] || {};
  const body = req.body || {};

  const updated = {
    price: Number(body.price ?? old.price ?? 0),
    stock: Number(
      body.stock !== undefined ? body.stock : old.stock ?? 0
    ),
    sort: Number(body.sort !== undefined ? body.sort : old.sort ?? 0),
    category: (body.category ?? old.category ?? '').trim(),
    image: body.image ?? old.image ?? '',
    enabled:
      typeof body.enabled === 'boolean'
        ? body.enabled
        : typeof old.enabled === 'boolean'
        ? old.enabled
        : true,
  };

  products[nameFromPath] = updated;

  try {
    saveJson('products', products);
    res.json({ status: 'ok', product: { name: nameFromPath, ...updated } });
  } catch (e) {
    console.error('save single product error:', e);
    res
      .status(503)
      .json({ status: 'error', message: 'save product failed' });
  }
});

// 刪除商品
app.delete('/api/admin/products/:name', (req, res) => {
  const nameFromPath = decodeURIComponent(req.params.name || '').trim();
  if (!nameFromPath) {
    return res
      .status(400)
      .json({ status: 'error', message: 'product name is required' });
  }

  let products;
  try {
    products = loadJson('products');
  } catch {
    products = {};
  }

  if (!products[nameFromPath]) {
    return res
      .status(404)
      .json({ status: 'error', message: 'product not found' });
  }

  delete products[nameFromPath];

  try {
    saveJson('products', products);
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('delete product error:', e);
    res
      .status(503)
      .json({ status: 'error', message: 'delete product failed' });
  }
});

// Top10 熱銷商品
app.get('/api/admin/products/top10', (req, res) => {
  let orders = [];
  try {
    orders = loadJson('orders');
  } catch {
    orders = [];
  }

  // key: productName, value: { qty, amount }
  const countMap = new Map();

  orders.forEach((order) => {
    if (!Array.isArray(order.items)) return;
    order.items.forEach((it) => {
      const name = it.productName || it.name;
      if (!name) return;
      const qty = Number(it.qty || it.quantity || 0) || 0;
      const price = Number(it.price || 0) || 0;
      const prev = countMap.get(name) || { qty: 0, amount: 0 };
      prev.qty += qty;
      prev.amount += qty * price;
      countMap.set(name, prev);
    });
  });

  const list = Array.from(countMap.entries())
    .map(([name, v]) => ({
      name,
      qty: v.qty,
      amount: v.amount,
    }))
    .sort((a, b) => b.qty - a.qty || b.amount - a.amount)
    .slice(0, 10);

  res.json({ status: 'ok', items: list });
});



// ====== 前台商品列表 API（給 liff-shop 用） ======
app.get('/api/products', (req, res) => {
  try {
    const products = loadJson('products'); // 讀 data/products.json
    res.json(products);
  } catch (e) {
    console.error('load products error:', e);
    res
      .status(500)
      .json({ status: 'error', message: 'load products failed' });
  }
});

// ====== Health check ======
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
