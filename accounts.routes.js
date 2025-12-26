// accounts.routes.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// 讀取 orders.json 的共用函式
function readOrders() {
  const file = path.join(__dirname, 'data', 'orders.json');
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8') || '[]';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 寫回 orders.json 的共用函式
function writeOrders(list) {
  const file = path.join(__dirname, 'data', 'orders.json');
  fs.writeFileSync(file, JSON.stringify(list || [], null, 2), 'utf8');
}

// 更新指定 userId 的聯絡資訊
router.post('/accounts/:userId/contact', async (req, res) => {
  const { userId } = req.params;
  const { phone, address, store } = req.body;

  if (!userId) {
    return res.status(400).json({ status: 'error', message: '缺少 userId' });
  }

  try {
    const orders = readOrders();
    let touched = 0;

    const updated = orders.map(o => {
      if (o.userId === userId) {
        touched += 1;
        return {
          ...o,
          phone: phone || '',
          address: address || '',
          store: store || ''
        };
      }
      return o;
    });

    if (!touched) {
      return res.status(404).json({
        status: 'error',
        message: '找不到對應 userId 的訂單'
      });
    }

    writeOrders(updated);

    return res.json({
      status: 'ok',
      updatedCount: touched,
      orders: updated
    });
  } catch (err) {
    console.error('update contact error', err);
    return res.status(500).json({
      status: 'error',
      message: '伺服器錯誤'
    });
  }
});

module.exports = router;
