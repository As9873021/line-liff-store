// routes/export.js - Part 1 (前半段)
const fs = require('fs');
const path = require('path');
const express = require('express');
const ExcelJS = require('exceljs');

const router = express.Router();

function loadJson(name) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, '../data', name + '.json'))
    );
  } catch (e) {
    return [];
  }
}

function saveJson(name, data) {
  try {
    fs.writeFileSync(
      path.join(__dirname, '../data', name + '.json'),
      JSON.stringify(data, null, 2)
    );
    return true;
  } catch (e) {
    console.error('saveJson error:', e);
    return false;
  }
}

function ensureUploadsDir() {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

function isPaidOrder(order) {
  return (
    order.paid === true ||
    ['paid', 'unshipped', 'shipped', 'done'].includes(order.status)
  );
}

// 1. 取得今日營收統計
router.get('/daily-revenue', (req, res) => {
  try {
    const orders = loadJson('orders');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayOrders = orders.filter((order) => {
      if (!order.createdAt) return false;
      const orderDate = new Date(order.createdAt);
      return orderDate >= today && orderDate < tomorrow && isPaidOrder(order);
    });

    const totalRevenue = todayOrders.reduce((sum, order) => {
      const amount = typeof order.total === 'number' ? order.total : 0;
      return sum + amount;
    }, 0);

    const totalItems = todayOrders.reduce((sum, order) => {
      return sum + (Array.isArray(order.items) ? order.items.length : 0);
    }, 0);

    res.json({
      success: true,
      date: today.toISOString().split('T')[0],
      totalRevenue: totalRevenue.toFixed(2),
      totalOrders: todayOrders.length,
      totalItems,
      orders: todayOrders,
    });
  } catch (error) {
    console.error('取得營收數據失敗:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. 匯出今日營收 Excel 並結算（保持不改）
router.post('/export-and-settle', async (req, res) => {
  try {
    const orders = loadJson('orders');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayOrders = orders.filter((order) => {
      if (!order.createdAt) return false;
      const orderDate = new Date(order.createdAt);
      return orderDate >= today && orderDate < tomorrow && isPaidOrder(order);
    });

    if (todayOrders.length === 0) {
      return res.status(400).json({
        success: false,
        error: '今日沒有已支付的訂單',
      });
    }

    const totalRevenue = todayOrders.reduce((sum, order) => {
      const amount = typeof order.total === 'number' ? order.total : 0;
      return sum + amount;
    }, 0);

    const totalItems = todayOrders.reduce((sum, order) => {
      return sum + (Array.isArray(order.items) ? order.items.length : 0);
    }, 0);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('今日營收統計');

    worksheet.columns = [
      { header: '訂單編號', key: 'orderId', width: 15 },
      { header: '客戶名稱', key: 'customerName', width: 12 },
      { header: '聯絡電話', key: 'phone', width: 14 },
      { header: '訂單金額', key: 'amount', width: 12 },
      { header: '商品數量', key: 'itemCount', width: 10 },
      { header: '訂單時間', key: 'orderTime', width: 20 },
      { header: 'VIP折扣', key: 'vipDiscount', width: 10 },
      { header: '優惠券折扣', key: 'couponDiscount', width: 12 },
    ];

    worksheet.mergeCells('A1:H1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `嘉義牛肉麵 - ${today.toLocaleDateString('zh-TW')} 營收統計`;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'center' };
    worksheet.getRow(1).height = 28;

    worksheet.mergeCells('A2:H2');
    const statsCell = worksheet.getCell('A2');
    statsCell.value = `總營收: NT$${totalRevenue.toFixed(2)} | 訂單數: ${todayOrders.length} | 商品數: ${totalItems}`;
    statsCell.font = { size: 12, bold: true, color: { argb: 'FF0070C0' } };
    statsCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
    statsCell.alignment = { horizontal: 'center', vertical: 'center' };
    worksheet.getRow(2).height = 20;

    worksheet.getRow(3).height = 5;

    worksheet.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    worksheet.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    worksheet.getRow(4).alignment = { horizontal: 'center', vertical: 'center' };
    worksheet.getRow(4).height = 22;

    todayOrders.forEach((order, index) => {
      const rowNum = 5 + index;
      const row = worksheet.getRow(rowNum);

      row.values = {
        orderId: order.id ? order.id.toString().slice(-8) : 'N/A',
        customerName: order.name || '未知',
        phone: order.phone || '-',
        amount: (typeof order.total === 'number' ? order.total : 0).toFixed(2),
        itemCount: Array.isArray(order.items) ? order.items.length : 0,
        orderTime: new Date(order.createdAt).toLocaleString('zh-TW'),
        vipDiscount: order.vipDiscount || 0,
        couponDiscount: order.couponDiscount || 0,
      };

      row.getCell(4).numFmt = '#,##0.00';
      row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(7).numFmt = '#,##0.00';
      row.getCell(7).alignment = { horizontal: 'right' };
      row.getCell(8).numFmt = '#,##0.00';
      row.getCell(8).alignment = { horizontal: 'right' };
      row.alignment = { vertical: 'center' };

      if (index % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      }
      row.height = 18;
    });

    const totalRowNum = 5 + todayOrders.length + 1;
    const totalRow = worksheet.getRow(totalRowNum);

    const totalVipDiscount = todayOrders.reduce((sum, order) => sum + (order.vipDiscount || 0), 0);
    const totalCouponDiscount = todayOrders.reduce((sum, order) => sum + (order.couponDiscount || 0), 0);

    totalRow.values = {
      orderId: '',
      customerName: '合計',
      phone: '',
      amount: totalRevenue.toFixed(2),
      itemCount: totalItems,
      orderTime: '',
      vipDiscount: totalVipDiscount.toFixed(2),
      couponDiscount: totalCouponDiscount.toFixed(2),
    };
    totalRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
    totalRow.getCell(4).numFmt = '#,##0.00';
    totalRow.getCell(4).alignment = { horizontal: 'right' };
    totalRow.getCell(7).numFmt = '#,##0.00';
    totalRow.getCell(7).alignment = { horizontal: 'right' };
    totalRow.getCell(8).numFmt = '#,##0.00';
    totalRow.getCell(8).alignment = { horizontal: 'right' };
    totalRow.height = 22;

    const borderStyle = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    for (let row = 1; row <= totalRowNum; row++) {
      for (let col = 1; col <= 8; col++) {
        worksheet.getCell(row, col).border = borderStyle;
      }
    }

    worksheet.views = [{ state: 'frozen', ySplit: 4 }];

    const uploadsDir = ensureUploadsDir();
    const dateStr = today.toISOString().split('T')[0];
    const fileName = `營收統計_${dateStr}.xlsx`;
    const filePath = path.join(uploadsDir, fileName);

    await workbook.xlsx.writeFile(filePath);
    console.log(`✅ Excel 已生成: ${filePath}`);

    const tomorrow2 = new Date(today);
    tomorrow2.setDate(tomorrow2.getDate() + 1);
    const settledOrders = orders.map((order) => {
      if (!order.createdAt) return order;
      const orderDate = new Date(order.createdAt);
      if (orderDate >= today && orderDate < tomorrow2 && isPaidOrder(order)) {
        return { ...order, settled: true, settledAt: new Date().toISOString() };
      }
      return order;
    });

    saveJson('orders', settledOrders);
    console.log(`✅ ${todayOrders.length} 筆訂單已標記為結算`);

    res.json({
      success: true,
      message: '營收匯出並結算成功',
      fileName,
      downloadUrl: `/uploads/${fileName}`,
      data: {
        date: dateStr,
        totalRevenue: totalRevenue.toFixed(2),
        totalOrders: todayOrders.length,
        totalItems,
        totalVipDiscount: totalVipDiscount.toFixed(2),
        totalCouponDiscount: totalCouponDiscount.toFixed(2),
        exportedAt: new Date().toLocaleString('zh-TW'),
      },
    });
  } catch (error) {
    console.error('匯出失敗:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. 出貨清單 CSV (packing-list) - 乾淨版
router.get('/packing-list', (req, res) => {
  const date = req.query.date;
  if (!date) {
    return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  }

  const orders = loadJson('orders');
  const targetOrders = orders.filter((o) => {
    if (!o.createdAt) return false;
    const d = new Date(o.createdAt).toISOString().slice(0, 10);
    return d === date && o.status !== 'cancel';
  });

  const header = ['訂單編號', '客戶名稱', '電話', '地址', '品項', '金額', '狀態'];
  const lines = targetOrders.map((o) => {
    const itemsText = (o.items || []).map((i) => {
      const name = i.productName || i.name || '';
      const qty = i.qty || i.quantity || 0;
      return `${name}x${qty}`;
    }).join(' / ');

    return [
      o.id,
      `"${o.name || ''}"`,
      o.phone || '',
      `"${o.address || ''}"`,
      `"${itemsText}"`,
      o.total || 0,
      o.status || '',
    ].join(',');
  });

  const bom = '\uFEFF';
  const csv = bom + [header, ...lines].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="packing_list_${date}.csv"`);
  res.send(csv);
});

module.exports = router;
// 4. 單筆出貨單 Excel (shipping-note) - 保持不改
router.post('/shipping-note', async (req, res) => {
  const { orderId } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required' });
  }

  const orders = loadJson('orders');
  const order = orders.find((o) => String(o.id) === String(orderId));
  if (!order) {
    return res.status(404).json({ error: 'order not found' });
  }

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('出貨單');

  ws.mergeCells('A1:D1');
  const title = ws.getCell('A1');
  title.value = '嘉義牛肉麵 出貨單';
  title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' },
  };
  ws.getRow(1).height = 26;

  const statusMap = {
    unpaid: '未付款',
    paid: '已付款',
    unshipped: '待出貨',
    shipped: '已出貨',
    done: '已完成',
    cancel: '已取消',
  };

  ws.getRow(3).values = [
    '訂單編號',
    String(order.id),
    '訂單狀態',
    statusMap[order.status] || order.status || '',
  ];

  ws.getRow(4).values = [
    '客戶姓名',
    order.name || '',
    '聯絡電話',
    order.phone || '',
  ];

  const deliveryInfo = order.address || order.store || '';
ws.getRow(5).values = ['收件地址 / 門市', deliveryInfo, '', ''];
ws.mergeCells('B5:D5');
ws.getRow(5).getCell(2).alignment = { vertical: 'middle', wrapText: true };


  [3, 4, 5].forEach((r) => {
  const row = ws.getRow(r);
  row.font = { size: 11 };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 30;  // 增加高度
});

  const headerRowIndex = 7;
  ws.getRow(headerRowIndex).values = ['品名', '數量', '單價', '小計'];
  ws.getRow(headerRowIndex).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(headerRowIndex).alignment = {
    horizontal: 'center',
    vertical: 'middle',
  };
  ws.getRow(headerRowIndex).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4B5563' },
  };
  ws.getRow(headerRowIndex).height = 20;

  let rowIndex = headerRowIndex + 1;
  let total = 0;
  (order.items || []).forEach((i) => {
    const qty = Number(i.qty || i.quantity || 0);
    const price = Number(i.price || i.unitPrice || 0);
    const subtotal = qty * price;
    total += subtotal;

    ws.getRow(rowIndex).values = [
      i.productName || i.name || '',
      qty,
      price,
      subtotal,
    ];
    ws.getRow(rowIndex).alignment = { vertical: 'middle', wrapText: true };
    ws.getRow(rowIndex).height = 25;
    rowIndex++;
  });

  rowIndex += 1;
  ws.getRow(rowIndex).values = ['總計', '', '', total];
  ws.mergeCells(`A${rowIndex}:C${rowIndex}`);
  const totalCell = ws.getCell(`A${rowIndex}`);
  totalCell.alignment = { horizontal: 'right', vertical: 'middle' };
  totalCell.font = { bold: true };
  ws.getCell(`D${rowIndex}`).font = { bold: true };
  ws.getCell(`D${rowIndex}`).numFmt = '#,##0';

 ws.columns = [
  { key: 'col1', width: 20 },
  { key: 'col2', width: 35 },  // 增加第2欄寬度，讓門市地址完整顯示
  { key: 'col3', width: 18 },
  { key: 'col4', width: 15 },
];

  const borderStyle2 = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };
  const lastRow = rowIndex;
  for (let r = headerRowIndex; r <= lastRow; r++) {
    for (let c = 1; c <= 4; c++) {
      ws.getCell(r, c).border = borderStyle2;
    }
  }

  ws.getRow(lastRow + 2).values = ['備註：'];
  ws.mergeCells(`A${lastRow + 2}:D${lastRow + 4}`);

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=shipping_${orderId}.xlsx`
  );

  await workbook.xlsx.write(res);
  res.end();
});

// 5. 今日揀貨單 Excel（商品彙總、美化版、統計今日品項）
router.post('/today-packing-list', async (req, res) => {
  try {
    const orders = loadJson('orders');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayOrders = orders.filter((order) => {
      const orderDate = new Date(order.createdAt);
      const st = order.status || 'unpaid';
      const needShip = ['paid', 'unshipped', 'shipped'].includes(st);
      return orderDate >= today && orderDate < tomorrow && needShip;
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('今日揀貨單');

    // 商品彙總
    const itemMap = new Map();

    todayOrders.forEach((order) => {
      const orderDateStr = new Date(order.createdAt).toLocaleString('zh-TW');
      (order.items || []).forEach((it) => {
        const name = it.productName || it.name;
        if (!name) return;
        const qty = Number(it.qty || it.quantity || 0) || 0;
        const price = Number(it.price || it.unitPrice || 0) || 0;
        const key = name;

        if (!itemMap.has(key)) {
          itemMap.set(key, {
            name,
            qty: 0,
            price,
            amount: 0,
            orders: [],
          });
        }
        const entry = itemMap.get(key);
        entry.qty += qty;
        entry.price = entry.price || price;
        entry.amount += qty * price;
        entry.orders.push(`#${order.id} (${orderDateStr}) x${qty}`);
      });
    });

    // 標題
    sheet.mergeCells('A1:F1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `嘉義牛肉麵 - ${today.toLocaleDateString('zh-TW')} 今日揀貨單`;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' },
    };
    sheet.getRow(1).height = 26;

    // 統計資訊
    const totalQty = Array.from(itemMap.values()).reduce(
      (sum, it) => sum + it.qty,
      0
    );
    const totalAmount = Array.from(itemMap.values()).reduce(
      (sum, it) => sum + it.amount,
      0
    );
    const itemCount = itemMap.size;

    sheet.mergeCells('A2:F2');
    const statsCell = sheet.getCell('A2');
    statsCell.value = `商品種類: ${itemCount} | 總數量: ${totalQty} | 總金額: NT$${totalAmount.toLocaleString('zh-TW')}`;
    statsCell.font = {
      size: 12,
      bold: true,
      color: { argb: 'FF0070C0' },
    };
    statsCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE699' },
    };
    statsCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(2).height = 20;

    sheet.getRow(3).height = 5;

    // 表頭
    sheet.getRow(4).values = ['品名', '數量', '單價', '小計', '來源訂單', '日期'];
    sheet.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    sheet.getRow(4).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    sheet.getRow(4).alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(4).height = 22;

    // 欄寬
    sheet.columns = [
      { key: 'name', width: 30 },
      { key: 'qty', width: 10 },
      { key: 'price', width: 12 },
      { key: 'amount', width: 12 },
      { key: 'orders', width: 45 },
      { key: 'date', width: 18 },
    ];

    // 商品明細
    const year = today.getFullYear();
const month = String(today.getMonth() + 1).padStart(2, '0');
const day = String(today.getDate()).padStart(2, '0');
const dateLabel = `${year}-${month}-${day}`;
    let rowIndex = 5;

    Array.from(itemMap.values()).forEach((item, idx) => {
      const row = sheet.getRow(rowIndex);
      row.values = {
        name: item.name,
        qty: item.qty,
        price: item.price,
        amount: item.amount,
        orders: item.orders.join('\n'),
        date: dateLabel,
      };

      row.getCell('qty').numFmt = '#,##0';
      row.getCell('price').numFmt = '#,##0';
      row.getCell('amount').numFmt = '#,##0';
      row.alignment = { vertical: 'top', wrapText: true };
      row.height = 45;

      if (idx % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' },
        };
      }
      rowIndex++;
    });

    // 合計列
    rowIndex += 1;
    const totalRow = sheet.getRow(rowIndex);
    totalRow.values = {
      name: '合計',
      qty: totalQty,
      price: '',
      amount: totalAmount,
      orders: '',
      date: dateLabel,
    };
    totalRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF70AD47' },
    };
    totalRow.getCell('qty').numFmt = '#,##0';
    totalRow.getCell('amount').numFmt = '#,##0';
    totalRow.height = 22;

    // 邊框
    const borderStyle = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
    for (let r = 4; r <= rowIndex; r++) {
      for (let c = 1; c <= 6; c++) {
        sheet.getCell(r, c).border = borderStyle;
      }
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="today-picking-list.xlsx"'
    );

    await workbook.xlsx.write(res);
  } catch (error) {
    console.error('匯出今日揀貨單失敗:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
