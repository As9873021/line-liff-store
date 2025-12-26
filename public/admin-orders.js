// public/admin-orders.js
window.Orders = window.Orders || {};

(function (ns) {
  let orders = [];
  let filtered = [];
  let currentPage = 1;
  const PER_PAGE = 10;

  // 分頁與排序（每月營收）
  const MONTHS_PER_PAGE = 7;
  let monthlyRevenueData = [];
  let monthlyRevenueFiltered = [];
  let monthlyRevenuePage = 1;
  let monthlyStartMonth = null;
  let monthlyEndMonth = null;

  // 訂單排序與視圖
  let orderSort = { key: 'statusPriority', dir: 'desc' }; // 預設：狀態優先度 desc，再時間 desc
  let viewMode = 'detail'; // 'detail' or 'compact'

  ns.topProducts = [];

  function $(id) {
    return document.getElementById(id);
  }

  // 初始化
  ns.init = function () {
    bindNavTabs();
    bindOrderTableHeaderSort();
    bindMonthlyFilters();
    loadStoreSummary();
    loadOrders();
    bindFilters();
    loadStoreViews();
  };

  // 左側 tab 切換
  function bindNavTabs() {
    const tabs = document.querySelectorAll('.nav-item[data-tab]');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        document
          .querySelectorAll('.nav-item')
          .forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        document
          .querySelectorAll('.tab-content')
          .forEach((sec) => {
            sec.style.display = sec.id === 'tab-' + target ? 'block' : 'none';
          });
      });
    });
  }

  // 訂單表頭排序綁定
  function bindOrderTableHeaderSort() {
    const thead = document.querySelector('#ordersTable thead');
    if (!thead) return;

    thead.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort-key]');
      if (!th) return;

      const key = th.getAttribute('data-sort-key');
      if (!key) return;

      // 更新排序方向
      if (orderSort.key === key) {
        orderSort.dir = orderSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        orderSort.key = key;
        orderSort.dir = key === 'createdAt' ? 'desc' : 'asc';
      }

      // 清掉其它欄位的箭頭與 aria-sort
      thead.querySelectorAll('th[data-sort-key]').forEach((h) => {
        h.classList.remove('sort-asc', 'sort-desc');
        h.removeAttribute('aria-sort');
        const icon = h.querySelector('.sort-icon');
        if (icon) icon.textContent = '⇅';
      });

      // 設定目前欄位的箭頭與 aria-sort
      const icon = th.querySelector('.sort-icon');
      if (orderSort.dir === 'asc') {
        th.classList.add('sort-asc');
        th.classList.remove('sort-desc');
        th.setAttribute('aria-sort', 'ascending');
        if (icon) icon.textContent = '▲';
      } else {
        th.classList.add('sort-desc');
        th.classList.remove('sort-asc');
        th.setAttribute('aria-sort', 'descending');
        if (icon) icon.textContent = '▼';
      }

      applyFilter(); // 重新排序＋渲染
    });
  }

  // 狀態優先度（越大越緊急）
  function getStatusPriority(status) {
    switch (status) {
      case 'unpaid':
        return 4;
      case 'paid':
        return 3;
      case 'unshipped':
        return 2;
      case 'shipped':
        return 1;
      case 'done':
        return 0;
      default:
        return 0;
    }
  }

  // 商店設定
  function loadStoreSummary() {
    fetch('/api/store')
      .then((r) => r.json())
      .then((store) => {
        $('summaryProductViews').textContent = store.productPageViews || 0;
        $('storeName').value = store.name || '嘉義牛肉麵';
        $('storeAdminTitle').value = store.adminTitle || '嘉義牛肉麵 後台';
        $('storeSubtitle').value = store.subtitle || '每日現煮牛肉湯';
        $('storeHours').value =
          store.businessHours || '11:00–14:00, 17:00–20:00';
        $('storeTakeout').checked = store.takeoutEnabled !== false;
        $('storeDelivery').checked = !!store.deliveryEnabled;
        $('storeEnableCoupons').checked = store.enableCoupons !== false;
        $('storeEnableVip').checked = store.enableVip !== false;

        const pm = store.paymentMethods || {};
        $('pmCash').checked = pm.cash !== false;
        $('pmLinePay').checked = !!pm.linePay;
        $('pmCard').checked = !!pm.card;
        $('pmHomeDelivery').checked = !!pm.homeDelivery;
        $('pmCod').checked = !!pm.cod;
        $('pmCvsCode').checked = !!pm.cvsCode;

        document.title = store.adminTitle || '嘉義牛肉麵 後台';
        const titleEl = document.querySelector('.brand-text-main');
        if (titleEl) {
          titleEl.textContent = store.adminTitle || '嘉義牛肉麵 後台';
        }
      })
      .catch((err) => {
        console.error('load store error', err);
      });
  }

  // 取得訂單
  function loadOrders() {
    fetch('/api/orders')
      .then((r) => r.json())
      .then((data) => {
        orders = Array.isArray(data) ? data : [];
        filtered = orders.slice();
        currentPage = 1;
        applyFilter(); // 含排序＋渲染
        renderOrdersPager();
        updateRevenueSummary();
        buildTopProducts();
      })
      .catch((err) => {
        console.error('load orders error', err);
        showToast('讀取訂單失敗', 'error');
      });
  }

  // 篩選綁定
  function bindFilters() {
    const searchInput = $('orderSearchInput');
    const statusSelect = $('orderStatusFilter');
    if (searchInput) searchInput.addEventListener('input', ns.onSearchChange);
    if (statusSelect)
      statusSelect.addEventListener('change', ns.onStatusFilterChange);
  }

  ns.onSearchChange = function () {
    applyFilter();
  };

  ns.onStatusFilterChange = function () {
    applyFilter();
  };

  // 出單視圖 / 精簡視圖
  ns.toggleViewMode = function () {
    viewMode = viewMode === 'detail' ? 'compact' : 'detail';
    const btn = $('orderViewToggleBtn');
    if (btn) {
      btn.textContent = viewMode === 'detail' ? '出單視圖' : '精簡視圖';
    }
    renderOrdersTable();
  };

  // 訂單過濾＋排序
  function applyFilter() {
    const keyword = ($('orderSearchInput')?.value || '').trim().toLowerCase();
    const status = $('orderStatusFilter')?.value || 'all';

    filtered = orders.filter((o) => {
      const text = `${o.name || ''} ${o.userId || ''} ${
        o.phone || ''
      }`.toLowerCase();
      if (keyword && !text.includes(keyword)) return false;

      if (status !== 'all') {
        if (o.status !== status) return false;
      }
      // 若不顯示取消單，可在這裡擋掉：
      // if (o.status === 'cancel') return false;

      return true;
    });

    // 狀態優先度
    filtered.forEach((o) => {
      o._statusPriority = getStatusPriority(
        o.status || (o.paid ? 'paid' : 'unpaid')
      );
    });

    filtered.sort((a, b) => {
      let av, bv;
      switch (orderSort.key) {
        case 'createdAt':
          av = new Date(a.createdAt).getTime() || 0;
          bv = new Date(b.createdAt).getTime() || 0;
          break;
        case 'total':
          av = Number(a.total || 0);
          bv = Number(b.total || 0);
          break;
        case 'status':
          av = a._statusPriority;
          bv = b._statusPriority;
          break;
        default:
          av = a._statusPriority;
          bv = b._statusPriority;
      }
      if (av === bv) {
        const at = new Date(a.createdAt).getTime() || 0;
        const bt = new Date(b.createdAt).getTime() || 0;
        return bt - at;
      }
      return orderSort.dir === 'asc' ? av - bv : bv - av;
    });

    currentPage = 1;
    renderOrdersTable();
    renderOrdersPager();
  }

  // 本年度每月營收篩選綁定
  function bindMonthlyFilters() {
    const startEl = $('monthlyStartSelect');
    const endEl = $('monthlyEndSelect');
    const btn = $('monthlyFilterBtn');

    if (!startEl || !endEl || !btn) return;

    btn.addEventListener('click', () => {
      monthlyStartMonth = startEl.value || null;
      monthlyEndMonth = endEl.value || null;
      applyMonthlyFilter();
    });
  }

  // 渲染訂單表格（含出貨單按鈕＋勾選）
  function renderOrdersTable() {
    const tbody = document.querySelector('#ordersTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const start = (currentPage - 1) * PER_PAGE;
    const pageItems = filtered.slice(start, start + PER_PAGE);

    pageItems.forEach((order) => {
      const tr = document.createElement('tr');

      const timeText = order.createdAt
        ? new Date(order.createdAt).toLocaleString('zh-TW')
        : '';

      const customerHtml = `
        <div style="font-weight:600;">${order.name || '-'}</div>
        <div class="small" style="margin-top:2px;color:#6b7280;">
          userId：${order.userId || '-'}
        </div>
        <div class="small" style="margin-top:2px;color:#9ca3af;">
          電話：${order.phone || '-'}
        </div>
      `;

      // 出單視圖 / 精簡視圖
      let itemsHtml = '';
      if (viewMode === 'compact') {
        const count = Array.isArray(order.items) ? order.items.length : 0;
        itemsHtml = `
          <div class="small" style="color:#374151;">
            共 ${count} 項品項
          </div>
        `;
      } else {
        itemsHtml = `
          <div class="small">
            ${(order.items || [])
              .map((i) => {
                const name = i.productName || i.name || '';
                const options = i.options ? `（${i.options}）` : '';
                const qty = i.qty || i.quantity || 0;
                const price = Number(i.price || i.unitPrice || 0);
                const priceText = price
                  ? `NT$ ${price.toLocaleString('zh-TW')}`
                  : '';
                return `
                  <div style="display:flex;justify-content:space-between;gap:8px;">
                    <div>
                      <span>${name}</span>
                      ${
                        options
                          ? `<span style="color:#9ca3af;">${options}</span>`
                          : ''
                      }
                    </div>
                    <div style="white-space:nowrap;color:#374151;">
                      x${qty}${priceText ? ` · ${priceText}` : ''}
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        `;
      }

      const subtotal = Number(order.subtotal || order.total || 0);
      const total = Number(order.total || 0);
      const vipDiscount = Number(order.vipDiscount || 0);
      const couponDiscount = Number(order.couponDiscount || 0);
      const hasDiscount = vipDiscount > 0 || couponDiscount > 0;

      let totalCell = '';
      if (hasDiscount) {
        const discountTextParts = [];
        if (vipDiscount > 0) {
          discountTextParts.push(
            `VIP -NT$ ${vipDiscount.toLocaleString('zh-TW')}`
          );
        }
        if (couponDiscount > 0) {
          discountTextParts.push(
            `券 -NT$ ${couponDiscount.toLocaleString('zh-TW')}`
          );
        }

        totalCell = `
          <div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;">
            <div class="small" style="text-decoration:line-through;color:#9ca3af;">
              NT$ ${subtotal.toLocaleString('zh-TW')}
            </div>
            <span class="badge" style="
              background:#ecfdf3;
              color:#166534;
              border-color:#bbf7d0;
              font-weight:600;
              font-size:13px;
            ">
              NT$ ${total.toLocaleString('zh-TW')}
            </span>
            <div class="small" style="color:#6b7280;">
              ${discountTextParts.join(' · ')}
            </div>
          </div>
        `;
      } else {
        totalCell = `
          <span class="badge" style="
            background:#ecfdf3;
            color:#166534;
            border-color:#bbf7d0;
            font-weight:600;
            font-size:13px;
          ">
            NT$ ${total.toLocaleString('zh-TW')}
          </span>
        `;
      }

      // 付款 / 配送欄 + 出貨單按鈕
      const paymentMethod = order.paymentMethod || '-';
      const deliveryMethod =
        order.deliveryMethod || order.store ? '宅配 / 超商' : '-';

      const paymentHtml = `
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
          <div class="small">
            <span class="badge" style="
              background:#eef2ff;
              color:#3730a3;
              border-color:#c7d2fe;
              font-size:11px;
              padding:2px 6px;
            ">
              ${paymentMethod || '-'}
            </span>
            ${
              deliveryMethod && deliveryMethod !== '-'
                ? `
            <span class="badge" style="
              background:#fef9c3;
              color:#854d0e;
              border-color:#facc15;
              font-size:11px;
              padding:2px 6px;
              margin-left:4px;
            ">
              ${deliveryMethod}
            </span>`
                : ''
            }
          </div>
          <button
  type="button"
  class="btn btn-sm btn-primary"
  onclick="Orders.exportShippingNote('${order.id}')"
>
  📋 出貨單
</button>

        </div>
      `;

      const couponHtml = order.couponCode
        ? `<span class="badge badge-coupon">${order.couponCode}</span>`
        : '<span class="small" style="color:#9ca3af;">—</span>';

      const statusHtml = renderStatusBadge(order);
      const actionsHtml = renderActions(order);

      tr.innerHTML = `
        <td>
          <input type="checkbox" class="order-check" value="${order.id}" />
        </td>
        <td>${timeText}</td>
        <td>${customerHtml}</td>
        <td>${itemsHtml}</td>
        <td style="text-align:right;">${totalCell}</td>
        <td>${paymentHtml}</td>
        <td>${couponHtml}</td>
        <td>${statusHtml}</td>
        <td>${actionsHtml}</td>
      `;

      tbody.appendChild(tr);
    });

    if (!pageItems.length) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td colspan="9" class="small" style="color:#9ca3af;">目前尚無訂單</td>';
      tbody.appendChild(tr);
    }
  }

  function renderStatusBadge(order) {
    const status = order.status || (order.paid ? 'paid' : 'unpaid');
    let text = '未付款';
    let cls = 'badge badge-unpaid';

    if (status === 'paid') {
      text = '已付款';
      cls = 'badge badge-paid';
    } else if (status === 'unshipped') {
      text = '未出貨';
      cls = 'badge badge-mode';
    } else if (status === 'shipped') {
      text = '已出貨';
      cls = 'badge badge-mode';
    } else if (status === 'done') {
      text = '已完成';
      cls = 'badge badge-cancel';
    } else if (status === 'cancel') {
      text = '已取消';
      cls = 'badge badge-cancel';
    }

    return `<span class="${cls}">${text}</span>`;
  }

  // 快速操作（主流程 + 更多操作）
  function renderActions(order) {
    const id = order.id;
    const status = order.status || 'unpaid';

    let primaryLabel = '';
    let primaryNext = null;
    if (status === 'unpaid') {
      primaryLabel = '標記已付款';
      primaryNext = 'paid';
    } else if (status === 'paid') {
      primaryLabel = '標記待出貨';
      primaryNext = 'unshipped';
    } else if (status === 'unshipped') {
      primaryLabel = '標記已出貨';
      primaryNext = 'shipped';
    } else if (status === 'shipped') {
      primaryLabel = '標記已完成';
      primaryNext = 'done';
    } else {
      primaryLabel = '—';
    }

    const moreButtons = [];

    if (status !== 'unpaid') {
      moreButtons.push(
        `<button class="btn btn-sm" type="button" onclick="Orders.updateStatus(${id}, 'unpaid')">設為未付款</button>`
      );
    }
    if (status !== 'paid') {
      moreButtons.push(
        `<button class="btn btn-sm" type="button" onclick="Orders.updateStatus(${id}, 'paid')">設為已付款</button>`
      );
    }
    if (status !== 'unshipped') {
      moreButtons.push(
        `<button class="btn btn-sm" type="button" onclick="Orders.updateStatus(${id}, 'unshipped')">設為未出貨</button>`
      );
    }
    if (status !== 'shipped') {
      moreButtons.push(
        `<button class="btn btn-sm" type="button" onclick="Orders.updateStatus(${id}, 'shipped')">設為已出貨</button>`
      );
    }
    if (status !== 'done') {
      moreButtons.push(
        `<button class="btn btn-sm" type="button" onclick="Orders.updateStatus(${id}, 'done')">設為已完成</button>`
      );
    }

    // 只允許未付款或已取消的訂單可以「移除」
    if (status === 'unpaid' || status === 'cancel') {
      moreButtons.push(
        `<button class="btn btn-sm" type="button" onclick="Orders.remove(${id})">移除訂單</button>`
      );
    }

    const primaryBtn = primaryNext
      ? `<button class="btn btn-sm btn-primary" type="button" onclick="Orders.updateStatus(${id}, '${primaryNext}')">${primaryLabel}</button>`
      : `<button class="btn btn-sm" type="button" disabled>無操作</button>`;

    const dropdownId = `order-actions-${id}`;

    return `
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
        ${primaryBtn}
        <button class="btn btn-sm" type="button"
          onclick="(function(){
            var el=document.getElementById('${dropdownId}');
            if(!el) return;
            el.style.display = el.style.display === 'block' ? 'none' : 'block';
          })()"
        >更多操作 ▾</button>
        <div id="${dropdownId}" style="display:none;margin-top:4px;">
          ${moreButtons.join('<br/>')}
        </div>
      </div>
    `;
  }

  // 訂單分頁
  function renderOrdersPager() {
    const pager = $('ordersPager');
    if (!pager) return;
    pager.innerHTML = '';

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

    const info = document.createElement('div');
    info.className = 'pager-info';
    info.textContent = `${total} 筆，第 ${currentPage}/${totalPages} 頁`;
    pager.appendChild(info);

    for (let p = 1; p <= totalPages; p++) {
      const btn = document.createElement('button');
      btn.className = 'pager-btn' + (p === currentPage ? ' active' : '');
      btn.textContent = p;
      btn.onclick = () => {
        currentPage = p;
        renderOrdersTable();
        renderOrdersPager();
      };
      pager.appendChild(btn);
    }
  }

  // 更新訂單狀態（單筆）
  ns.updateStatus = function (id, status) {
    fetch(`/api/orders/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok') {
          showToast('訂單狀態已更新', 'success');
          loadOrders(); // 成功後重新載入整批訂單
        } else {
          showToast(data.message || '更新訂單失敗', 'error');
        }
      })
      .catch((err) => {
        console.error('update status error', err);
        showToast('更新訂單失敗', 'error');
      });
  };

  // 勾選工具與批次操作
  ns.toggleCheckAll = function (checkbox) {
    const checked = checkbox.checked;
    document.querySelectorAll('.order-check').forEach((cb) => {
      cb.checked = checked;
    });
  };

  ns.getSelectedIds = function () {
    return Array.from(document.querySelectorAll('.order-check:checked')).map(
      (el) => el.value
    );
  };

  // 批次設為已出貨
  ns.bulkShip = function () {
    const ids = ns.getSelectedIds();
    if (!ids.length) {
      showToast('請先勾選要設為已出貨的訂單', 'error');
      return;
    }
    if (!confirm(`確定將 ${ids.length} 筆訂單設為「已出貨」嗎？`)) return;

    fetch('/api/admin/orders/bulk-ship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text();
          console.error('bulk ship error response', text);
          throw new Error('bulk ship failed');
        }
        return r.json();
      })
      .then((data) => {
        if (data.status === 'ok') {
          showToast('批次設為已出貨完成', 'success');
          loadOrders();
        } else {
          showToast(data.message || '批次出貨失敗', 'error');
        }
      })
      .catch((err) => {
        console.error('bulk ship error', err);
        showToast('批次出貨失敗', 'error');
      });
  };

  // 批次標記完成
  ns.bulkComplete = function () {
    const ids = ns.getSelectedIds();
    if (!ids.length) {
      showToast('請先勾選要標記完成的訂單', 'error');
      return;
    }
    if (!confirm(`確定將 ${ids.length} 筆訂單標記為「已完成」嗎？`)) return;

    fetch('/api/admin/orders/bulk-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text();
          console.error('bulk complete error response', text);
          throw new Error('bulk complete failed');
        }
        return r.json();
      })
      .then((data) => {
        if (data.status === 'ok') {
          showToast('批次標記完成已更新', 'success');
          loadOrders();
        } else {
          showToast(data.message || '批次標記完成失敗', 'error');
        }
      })
      .catch((err) => {
        console.error('bulk complete error', err);
        showToast('批次標記完成失敗', 'error');
      });
  };

  // 移除訂單
  ns.remove = function (id) {
    if (
      !confirm('確定要移除這筆訂單嗎？建議僅在客人下錯單、要重新下單時使用。')
    )
      return;

    fetch(`/api/admin/orders/${id}/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text();
          console.error('remove order error response', text);
          throw new Error('remove order failed');
        }
        return r.json();
      })
      .then((data) => {
        if (data.status === 'ok') {
          showToast('訂單已移除', 'success');
          loadOrders();
        } else {
          showToast(data.message || '移除訂單失敗', 'error');
        }
      })
      .catch((err) => {
        console.error('remove order error', err);
        showToast('移除訂單失敗', 'error');
      });
  };

  function updateRevenueSummary() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const monthKey = todayStr.slice(0, 7);

    let todayTotal = 0;
    let monthTotal = 0;

    orders.forEach((o) => {
      const d = new Date(o.createdAt);
      const dateStr = d.toISOString().slice(0, 10);
      const monthStr = dateStr.slice(0, 7);
      const amount = Number(o.total || 0);

      const isPaid =
        o.paid === true ||
        ['paid', 'unshipped', 'shipped', 'done'].includes(o.status);

      if (isPaid) {
        if (dateStr === todayStr) todayTotal += amount;
        if (monthStr === monthKey) monthTotal += amount;
      }
    });

    summaryToday.textContent = `NT$ ${todayTotal.toLocaleString('zh-TW')}`;
    summaryMonth.textContent = `NT$ ${monthTotal.toLocaleString('zh-TW')}`;

    buildDailyRevenueTable();
    prepareMonthlyRevenueData();
    applyMonthlyFilter();
  }

  // 最近七天營收
  function buildDailyRevenueTable() {
    const tbody = document.querySelector('#dailyRevenueTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const map = {};

    orders.forEach((o) => {
      if (!o.paid) return;
      const d = new Date(o.createdAt);
      const key = d.toISOString().slice(0, 10);
      if (!map[key]) map[key] = { date: key, total: 0, count: 0 };
      map[key].total += Number(o.total || 0);
      map[key].count += 1;
    });

    const days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const item = map[key] || { date: key, total: 0, count: 0 };
      days.push(item);
    }

    days.forEach((item) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.date}</td>
        <td>${item.count}</td>
        <td>NT$ ${item.total.toLocaleString('zh-TW')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 本年度每月營收資料
  function prepareMonthlyRevenueData() {
    const map = {};
    const year = new Date().getFullYear().toString();

    orders.forEach((o) => {
      if (!o.paid) return;
      const d = new Date(o.createdAt);
      const key = d.toISOString().slice(0, 7);
      if (!key.startsWith(year)) return;
      if (!map[key]) map[key] = { month: key, total: 0, count: 0 };
      map[key].total += Number(o.total || 0);
      map[key].count += 1;
    });

    const months = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      const key = `${year}-${mm}`;
      const item = map[key] || { month: key, total: 0, count: 0 };
      months.push(item);
    }

    monthlyRevenueData = months;
    monthlyRevenueFiltered = months;
    monthlyRevenuePage = 1;

    fillMonthlySelectOptions(months);
  }

  function applyMonthlyFilter() {
    monthlyRevenueFiltered = monthlyRevenueData.filter((item) => {
      const m = item.month;
      if (monthlyStartMonth && m < monthlyStartMonth) return false;
      if (monthlyEndMonth && m > monthlyEndMonth) return false;
      return true;
    });

    monthlyRevenuePage = 1;
    renderMonthlyRevenueTable();
    renderMonthlyRevenuePager();
  }

  function renderMonthlyRevenueTable() {
    const tbody = document.querySelector('#monthlyRevenueTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const start = (monthlyRevenuePage - 1) * MONTHS_PER_PAGE;
    const pageItems = monthlyRevenueFiltered.slice(start, start + MONTHS_PER_PAGE);

    if (!pageItems.length) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td colspan="3" class="small" style="color:#9ca3af;">無符合條件的月份</td>';
      tbody.appendChild(tr);
      return;
    }

    pageItems.forEach((item) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.month}</td>
        <td>${item.count}</td>
        <td>NT$ ${item.total.toLocaleString('zh-TW')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderMonthlyRevenuePager() {
    const pager = document.getElementById('monthlyRevenuePager');
    if (!pager) return;
    pager.innerHTML = '';

    const total = monthlyRevenueFiltered.length;
    const totalPages = Math.max(1, Math.ceil(total / MONTHS_PER_PAGE));

    const info = document.createElement('div');
    info.className = 'pager-info';
    info.textContent = `${total} 個月份，第 ${monthlyRevenuePage}/${totalPages} 頁`;
    pager.appendChild(info);

    for (let p = 1; p <= totalPages; p++) {
      const btn = document.createElement('button');
      btn.className =
        'pager-btn' + (p === monthlyRevenuePage ? ' active' : '');
      btn.textContent = p;
      btn.onclick = () => {
        monthlyRevenuePage = p;
        renderMonthlyRevenueTable();
        renderMonthlyRevenuePager();
      };
      pager.appendChild(btn);
    }
  }

  function fillMonthlySelectOptions(months) {
    const startEl = $('monthlyStartSelect');
    const endEl = $('monthlyEndSelect');
    if (!startEl || !endEl) return;

    const optionsHtml = ['<option value="">（不限）</option>']
      .concat(months.map((m) => `<option value="${m.month}">${m.month}</option>`))
      .join('');

    startEl.innerHTML = optionsHtml;
    endEl.innerHTML = optionsHtml;
  }

  // Top10 商品
  function buildTopProducts() {
    const map = {};
    orders.forEach((o) => {
      if (!Array.isArray(o.items)) return;
      o.items.forEach((i) => {
        const name = i.productName || i.name;
        if (!name) return;
        const qty = Number(i.qty || i.quantity || 0);
        const price = Number(i.price || i.unitPrice || 0);
        if (!map[name]) map[name] = { name, qty: 0, total: 0 };
        map[name].qty += qty;
        map[name].total += qty * price;
      });
    });

    ns.topProducts = Object.values(map)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);
  }

  function loadStoreViews() {
    // 已透過 /api/store 提供 summaryProductViews
  }

  // 匯出今日營收（呼叫後端產 Excel + 結算）
ns.exportTodayRevenueCsv = async function () {
  try {
    const res = await fetch('/api/export/export-and-settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '匯出失敗');
    }

    window.open(data.downloadUrl, '_blank');
    showToast('營收 Excel 已生成並結算', 'success');
  } catch (e) {
    console.error(e);
    showToast('匯出今日營收失敗', 'error');
  }
};

// 匯出今日揀貨單 Excel（商品彙總）- 改這裡的名稱
ns.exportTodayPackingList = async function () {
  try {
    const res = await fetch('/api/export/today-packing-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('匯出失敗');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '今日揀貨單.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('今日揀貨單已下載', 'success');
  } catch (e) {
    console.error(e);
    showToast('匯出揀貨單失敗', 'error');
  }
};

// 匯出單筆訂單的出貨單
ns.exportShippingNote = async function (orderId) {
  try {
    const payload = { orderId: Number(orderId) };

    const res = await fetch('/api/export/shipping-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('匯出失敗');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shipping_${payload.orderId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('出貨單已下載', 'success');
  } catch (e) {
    console.error(e);
    showToast('出貨單匯出失敗', 'error');
  }
};


  // 全域 Toast
  window.showToast = function (msg, type) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.background = type === 'error' ? '#ef4444' : '#16a34a';
    el.style.display = 'block';
    setTimeout(() => {
      el.style.display = 'none';
    }, 2000);
  };

  document.addEventListener('DOMContentLoaded', ns.init);
})(window.Orders);
