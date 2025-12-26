// admin-accounts.js
window.Accounts = window.Accounts || {};

(function (ns) {
  let accounts = [];
  let filtered = [];
  let currentPage = 1;
  const PER_PAGE = 10;

  let currentUserId = null;

  let sortKey = 'totalSpent';
  let sortDir = 'desc';

  function $(id) {
    return document.getElementById(id);
  }

  ns.init = function () {
    bindSearch();
    bindHeaderSort();
    loadFromOrders();
  };

  function bindSearch() {
    const input = $('accountSearchInput');
    if (input) {
      input.oninput = onSearchChange;
    }
  }

  function bindHeaderSort() {
    const thead = document.querySelector('#accountsTable thead');
    if (!thead) return;
    thead.addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable');
      if (!th) return;
      const key = th.getAttribute('data-sort-key');
      if (!key) return;

      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = key === 'userId' || key === 'name' ? 'asc' : 'desc';
      }
      applySort();
      currentPage = 1;
      renderTable();
      renderPager();
      updateSortHeaderStyles();
    });
  }

  function updateSortHeaderStyles() {
    const ths = document.querySelectorAll('#accountsTable thead th.sortable');
    ths.forEach((th) => {
      th.classList.remove('sort-asc', 'sort-desc');
      const key = th.getAttribute('data-sort-key');
      if (key === sortKey) {
        th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  ns.reload = function () {
    loadFromOrders();
  };

  function loadFromOrders() {
    Promise.all([
      fetch('/api/orders').then(r => r.json()),
      fetch('/api/users/all').then(r => r.json()).catch(() => [])
    ])
      .then(([orders, users]) => {
        const map = new Map();

        (users || []).forEach(u => {
          if (!u.userId) return;
          map.set(u.userId, {
            userId: u.userId,
            name: u.name || '',
            phone: u.phone || '',
            address: (u.addresses && u.addresses[0]?.address) || '',
            store: (u.stores && u.stores[0]?.store) || '',
            totalSpent: u.totalSpent || 0,
            vipLevel: u.vipLevel || 0,
            orderCount: 0,
            lastOrderAt: null,
            blacklisted: false,
            coupons: [],
          });
        });

        (orders || []).forEach(o => {
          if (!o.userId) return;
          const key = o.userId;
          const existing = map.get(key) || {
            userId: o.userId,
            name: o.name || '',
            phone: o.phone || '',
            address: o.address || '',
            store: o.store || '',
            totalSpent: 0,
            vipLevel: o.vipLevel || 0,
            orderCount: 0,
            lastOrderAt: null,
            blacklisted: false,
            coupons: [],
          };

          const amount = typeof o.total === 'number' ? o.total : 0;
          existing.totalSpent += amount;
          existing.orderCount += 1;

          const t = new Date(o.createdAt);
          if (!existing.lastOrderAt || t > new Date(existing.lastOrderAt)) {
            existing.lastOrderAt = o.createdAt;
          }

          if (typeof o.vipLevel === 'number') {
            existing.vipLevel = Math.max(existing.vipLevel, o.vipLevel);
          }
          if (o.blacklisted === true) {
            existing.blacklisted = true;
          }
          if (o.couponCode) {
            existing.coupons.push({
              code: o.couponCode,
              createdAt: o.createdAt,
              orderId: o.id,
              total: o.total || 0,
            });
          }

          map.set(key, existing);
        });

        accounts = Array.from(map.values()).map(acc => {
          acc.coupons.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          return acc;
        });

        filtered = accounts.slice();
        applySort();
        currentPage = 1;
        renderTable();
        renderPager();
        updateSortHeaderStyles();
      })
      .catch(err => {
        console.error('load accounts error', err);
        if (window.showToast) showToast('讀取帳號資料失敗', 'error');
      });
  }

  function applySort() {
    const cmp = (a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);

      if (va == null && vb != null) return 1;
      if (va != null && vb == null) return -1;
      if (va == null && vb == null) return 0;

      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    };

    accounts.sort(cmp);
    filtered.sort(cmp);
  }

  function getSortValue(acc, key) {
    switch (key) {
      case 'userId':
        return (acc.userId || '').toLowerCase();
      case 'name':
        return (acc.name || '').toLowerCase();
      case 'vipLevel':
        return acc.vipLevel || 0;
      case 'orderCount':
        return acc.orderCount || 0;
      case 'totalSpent':
        return acc.totalSpent || 0;
      case 'lastOrderAt':
        return acc.lastOrderAt ? new Date(acc.lastOrderAt).getTime() : null;
      default:
        return null;
    }
  }

  function vipBadge(acc) {
    const level = acc.vipLevel || 0;
    let text = '一般會員';
    let cls = 'badge badge-vip-0';

    if (level === 1) {
      text = 'VIP 銅卡';
      cls = 'badge badge-vip-1';
    } else if (level === 2) {
      text = 'VIP 金卡';
      cls = 'badge badge-vip-2';
    }
    return `<span class="${cls}">${text}</span>`;
  }

  function blackBadge(acc) {
    if (!acc.blacklisted) return '';
    return '<span class="badge badge-unpaid" style="margin-left:4px;">黑名單</span>';
  }

  function renderTable() {
    const tbody = document.querySelector('#accountsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const start = (currentPage - 1) * PER_PAGE;
    const pageItems = filtered.slice(start, start + PER_PAGE);

    pageItems.forEach((acc) => {
      const tr = document.createElement('tr');

      const totalText = `NT$ ${Number(acc.totalSpent || 0).toLocaleString()}`;
      const lastText = acc.lastOrderAt
        ? new Date(acc.lastOrderAt).toLocaleString('zh-TW')
        : '';
      const shortId =
        (acc.userId || '').length > 8
          ? '...' + acc.userId.slice(-8)
          : acc.userId || '';
      const blackChecked = acc.blacklisted ? 'checked' : '';

      tr.innerHTML = `
        <td style="white-space:nowrap;" title="${acc.userId}">
          ${shortId}
        </td>
        <td>
          <div style="font-weight:600;">
            ${acc.name || '-'}${blackBadge(acc)}
          </div>
          <div class="small" style="margin-top:2px;color:#6b7280;">
            累積消費 ${totalText}
          </div>
        </td>
        <td>${acc.phone || '-'}</td>
        <td>${acc.address || '-'}</td>
        <td>
          ${vipBadge(acc)}
        </td>
        <td>${acc.orderCount || 0}</td>
        <td>${lastText}</td>
        <td>
          <label class="small" style="display:inline-flex;align-items:center;gap:4px;">
            <input
              type="checkbox"
              data-user-id="${acc.userId}"
              data-role="blackToggle"
              ${blackChecked}
            />
            黑
          </label>
        </td>
        <td style="text-align:right;">
          <button class="btn btn-sm" onclick="Accounts.openDetail('${acc.userId}')">
            查看 / 編輯
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    if (!pageItems.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="9" class="small" style="color:#9ca3af;">尚無帳號資料</td>`;
      tbody.appendChild(tr);
    }

    bindInlineBlackToggle();
  }

  function bindInlineBlackToggle() {
    const tbody = document.querySelector('#accountsTable tbody');
    if (!tbody) return;

    tbody.querySelectorAll('input[data-role="blackToggle"]').forEach((chk) => {
      chk.onchange = () => {
        const userId = chk.getAttribute('data-user-id');
        const blacklisted = chk.checked;
        updateBlacklistedOnly(userId, blacklisted);
      };
    });
  }

  function updateBlacklistedOnly(userId, blacklisted) {
    const acc = accounts.find((a) => a.userId === userId);
    if (!acc) return;

    const payload = {
      phone: acc.phone || '',
      address: acc.address || '',
      store: acc.store || '',
      vipLevel: acc.vipLevel || 0,
      blacklisted,
    };

    fetch(`/api/accounts/${encodeURIComponent(userId)}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok') {
          acc.blacklisted = blacklisted;
          applySort();
          renderTable();
          renderPager();
          if (window.showToast) showToast('黑名單狀態已更新', 'success');
        } else {
          if (window.showToast) showToast('更新黑名單狀態失敗', 'error');
        }
      })
      .catch((err) => {
        console.error('update blacklist error', err);
        if (window.showToast) showToast('更新黑名單狀態失敗', 'error');
      });
  }

  function renderPager() {
    const pager = $('accountsPager');
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
        renderTable();
        renderPager();
      };
      pager.appendChild(btn);
    }
  }

  function onSearchChange() {
    const keyword = ($('accountSearchInput')?.value || '').trim().toLowerCase();

    filtered = accounts.filter((acc) => {
      const text = [
        acc.userId || '',
        acc.name || '',
        acc.phone || '',
        acc.address || '',
      ]
        .join(' ')
        .toLowerCase();
      return !keyword || text.includes(keyword);
    });

    applySort();
    currentPage = 1;
    renderTable();
    renderPager();
  }

  ns.onSearchChange = onSearchChange;

  ns.openDetail = function (userId) {
    const acc = accounts.find((a) => a.userId === userId);
    if (!acc) return;
    currentUserId = userId;

    const overlay = $('accountOverlay');
    if (!overlay) return;

    const body = $('accountDetailBody');
    if (body) {
      const couponLines = (acc.coupons || []).slice(0, 5).map((c) => {
        const dateText = c.createdAt
          ? new Date(c.createdAt).toLocaleString('zh-TW')
          : '';
        const totalText = `NT$ ${Number(c.total || 0).toLocaleString()}`;
        return `· ${c.code}（${dateText}，${totalText}）`;
      });

      const couponHtml =
        couponLines.length > 0
          ? couponLines.join('<br>')
          : '（尚未使用優惠券）';

      body.innerHTML = `
  <div style="font-weight:650;font-size:16px;">
    ${acc.name || '-'}${blackBadge(acc)}
  </div>
  <div class="small" style="margin-top:4px;color:#6b7280;">
     使用者 ID：${acc.userId}
  </div>
  <div class="small" style="margin-top:6px;">${vipBadge(acc)}</div>
  <div class="small" style="margin-top:6px;color:#6b7280;">
    累積消費 NT$ ${Number(acc.totalSpent || 0).toLocaleString()} · 共 ${acc.orderCount || 0} 筆訂單
  </div>
  <div class="small" style="margin-top:4px;color:#9ca3af;">
    最後下單時間：${acc.lastOrderAt ? new Date(acc.lastOrderAt).toLocaleString('zh-TW') : '-'}
  </div>
  <div class="small" style="margin-top:8px;color:#6b7280;">
    最近優惠券使用紀錄：
  </div>
  <div class="small" style="margin-top:4px;color:#4b5563;">
    ${couponHtml}
  </div>
`;
    }

    const accPhone = $('accPhone');
    const accAddress = $('accAddress');
    const accStore = $('accStore');
    const accVipLevel = $('accVipLevel');
    const accBlacklisted = $('accBlacklisted');

    if (accPhone) accPhone.value = acc.phone || '';
    if (accAddress) accAddress.value = acc.address || '';
    if (accStore) accStore.value = acc.store || '';
    if (accVipLevel) accVipLevel.value = String(acc.vipLevel || 0);
    if (accBlacklisted) accBlacklisted.checked = !!acc.blacklisted;

    overlay.style.display = 'flex';
  };

  ns.closeDetail = function () {
    const overlay = $('accountOverlay');
    if (overlay) overlay.style.display = 'none';
    currentUserId = null;
  };

  ns.resetContact = function () {
    if (!currentUserId) return;
    const acc = accounts.find((a) => a.userId === currentUserId);
    if (!acc) return;

    const accPhone = $('accPhone');
    const accAddress = $('accAddress');
    const accStore = $('accStore');
    const accVipLevel = $('accVipLevel');
    const accBlacklisted = $('accBlacklisted');

    if (accPhone) accPhone.value = acc.phone || '';
    if (accAddress) accAddress.value = acc.address || '';
    if (accStore) accStore.value = acc.store || '';
    if (accVipLevel) accVipLevel.value = String(acc.vipLevel || 0);
    if (accBlacklisted) accBlacklisted.checked = !!acc.blacklisted;
  };

  ns.saveContact = function () {
    if (!currentUserId) return;

    const acc = accounts.find((a) => a.userId === currentUserId);
    if (!acc) return;

    const accPhone = $('accPhone');
    const accAddress = $('accAddress');
    const accStore = $('accStore');
    const accVipLevel = $('accVipLevel');
    const accBlacklisted = $('accBlacklisted');

    const phone = accPhone ? accPhone.value.trim() : '';
    const address = accAddress ? accAddress.value.trim() : '';
    const store = accStore ? accStore.value.trim() : '';
    const vipLevel = Number(accVipLevel?.value || '0');
    const blacklisted = !!accBlacklisted?.checked;

    fetch(`/api/accounts/${encodeURIComponent(currentUserId)}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, address, store, vipLevel, blacklisted }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok') {
          acc.phone = phone;
          acc.address = address;
          acc.store = store;
          acc.vipLevel = vipLevel;
          acc.blacklisted = blacklisted;
          applySort();
          renderTable();
          renderPager();
          if (window.showToast) showToast('帳號資料已更新', 'success');
          ns.closeDetail();
        } else {
          if (window.showToast) showToast('更新帳號資料失敗', 'error');
        }
      })
      .catch((err) => {
        console.error('save contact error', err);
        if (window.showToast) showToast('更新帳號資料失敗', 'error');
      });
  };

  ns.exportCsv = function () {
    const rows = [];
    rows.push([
      'userId',
      '名稱',
      '電話',
      '地址',
      '7-11 店名',
      'VIP 等級',
      '黑名單',
      '訂單數',
      '累積消費',
      '最後下單時間',
    ]);

    filtered.forEach((acc) => {
      rows.push([
        acc.userId || '',
        acc.name || '',
        acc.phone || '',
        acc.address || '',
        acc.store || '',
        acc.vipLevel || 0,
        acc.blacklisted ? 'Y' : 'N',
        acc.orderCount || 0,
        acc.totalSpent || 0,
        acc.lastOrderAt
          ? new Date(acc.lastOrderAt).toLocaleString('zh-TW')
          : '',
      ]);
    });

    const bom = '\uFEFF';
    const csv = bom + rows
      .map((cols) =>
        cols
          .map((v) => {
            const s = String(v ?? '');
            if (s.includes('"') || s.includes(',') || s.includes('\n')) {
              return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
          })
          .join(',')
      )
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `accounts_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    if (window.showToast) showToast('帳號 CSV 已匯出', 'success');
  };

  document.addEventListener('DOMContentLoaded', ns.init);
})(window.Accounts);

