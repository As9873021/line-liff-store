// public/admin-core.js
window.App = window.App || {};
window.OrdersData = window.OrdersData || { all: [] };

// 這個檔只負責載入訂單給其他模組用，不再處理 tab
App.loadOrders = async function () {
  try {
    const res = await fetch('/api/orders');
    const data = await res.json();
    OrdersData.all = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('loadOrders error', e);
    OrdersData.all = [];
  }

  // 如果有提供 refreshFromData，就把 OrdersData 傳過去
  if (window.Orders && typeof Orders.refreshFromData === 'function') {
    Orders.refreshFromData(OrdersData.all);
  }
  if (window.Accounts && typeof Accounts.refreshFromData === 'function') {
    Accounts.refreshFromData(OrdersData.all);
  }
};

window.addEventListener('DOMContentLoaded', () => {
  // tab 切換交給 admin-orders.js 自己的 bindNavTabs 處理
  if (window.Settings && typeof Settings.init === 'function') {
    Settings.init();
  }
  App.loadOrders();
});
