// admin-coupons.js
window.Coupons = window.Coupons || {};

(function (ns) {
  let coupons = [];
  let filtered = [];
  let editingIndex = null; // 在 coupons 陣列中的 index

  function $(id) {
    return document.getElementById(id);
  }

  ns.init = function () {
    bindToolbar();
    load();
  };

  function bindToolbar() {
    const toolbar = document.querySelector('.coupon-toolbar');
    if (!toolbar) return;

    const addBtn = toolbar.querySelector('button.btn.btn-primary');
    const loadBtn = toolbar.querySelector('button.btn.btn-secondary');
    const saveBtn = toolbar.querySelector('button.btn.btn-success');

    if (addBtn) addBtn.onclick = add;
    if (loadBtn) loadBtn.onclick = load;
    if (saveBtn) saveBtn.onclick = save;

    // 搜尋 input
    let searchInput = $('couponSearchInput');
    if (!searchInput) {
      searchInput = document.createElement('input');
      searchInput.id = 'couponSearchInput';
      searchInput.className = 'input input-compact';
      searchInput.placeholder = '搜尋代碼 / 名稱';
      searchInput.style.maxWidth = '220px';
      searchInput.oninput = applyFilter;
      toolbar.insertBefore(searchInput, addBtn);
    }

    // 只看啟用 checkbox
    let activeOnlyLabel = document.createElement('label');
    activeOnlyLabel.className = 'small';
    activeOnlyLabel.style.display = 'inline-flex';
    activeOnlyLabel.style.alignItems = 'center';
    activeOnlyLabel.style.gap = '4px';
    activeOnlyLabel.style.marginLeft = '4px';

    const activeOnly = document.createElement('input');
    activeOnly.type = 'checkbox';
    activeOnly.id = 'couponActiveOnly';
    activeOnly.onchange = applyFilter;

    activeOnlyLabel.appendChild(activeOnly);
    activeOnlyLabel.appendChild(document.createTextNode('只看啟用中'));
    toolbar.insertBefore(activeOnlyLabel, addBtn);
  }

  function load() {
    fetch('/api/coupons')
      .then((r) => r.json())
      .then((data) => {
        coupons = Array.isArray(data) ? data : [];
        applyFilter();
        if (window.showToast) showToast('優惠券已載入', 'success');
      })
      .catch((err) => {
        console.error('load coupons error', err);
        if (window.showToast) showToast('讀取優惠券失敗', 'error');
      });
  }

  function applyFilter() {
    const keyword = ($('couponSearchInput')?.value || '').trim().toLowerCase();
    const activeOnly = $('couponActiveOnly')?.checked;

    filtered = coupons.filter((c) => {
      const text = `${c.code || ''} ${c.name || ''}`.toLowerCase();
      if (keyword && !text.includes(keyword)) return false;

      if (activeOnly) {
        const now = new Date();
        if (!c.isActive) return false;
        if (c.validUntil && now > new Date(c.validUntil)) return false;
      }

      return true;
    });

    renderTable();
  }

  function getStatusBadge(coupon) {
    const now = new Date();
    const validFrom = coupon.validFrom ? new Date(coupon.validFrom) : null;
    const validUntil = coupon.validUntil ? new Date(coupon.validUntil) : null;

    let text = '未啟用';
    let cls = 'badge';

    const isActive = !!coupon.isActive;
    const isExpired = validUntil && now > validUntil;
    const isFuture = validFrom && now < validFrom;

    if (!isActive) {
      text = '停用';
      cls += ' badge-unpaid';
    } else if (isExpired) {
      text = '已過期';
      cls += ' badge-cancel';
    } else {
      let near = false;
      if (validUntil) {
        const diff = (validUntil - now) / (1000 * 60 * 60 * 24);
        if (diff >= 0 && diff <= 3) near = true;
      }
      if (near) {
        text = '即將到期';
        cls += ' badge-cancel';
      } else if (isFuture) {
        text = '尚未開始';
        cls += ' badge-mode';
      } else {
        text = '啟用中';
        cls += ' badge-paid';
      }
    }

    if (
      typeof coupon.usageLimit === 'number' &&
      (coupon.usedCount || 0) >= coupon.usageLimit
    ) {
      text = '已用完';
      cls = 'badge badge-cancel';
    }

    return `<span class="${cls}">${text}</span>`;
  }

  function formatDateTimeLocal(value) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  // 產生優惠碼
  function generateCouponCode(length = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // 折扣百分比提示
  function updatePercentHint() {
    const typeEl = $('cDetailType');
    const valueEl = $('cDetailValue');
    const hintEl = $('cDetailPercentHint');
    if (!typeEl || !valueEl || !hintEl) return;

    if (typeEl.value !== 'percent') {
      hintEl.textContent = '目前為金額折抵，此欄代表折抵金額（元）。';
      return;
    }

    const v = Number(valueEl.value);
    if (!valueEl.value || Number.isNaN(v)) {
      hintEl.textContent = '填 9 代表 9 折、8.5 代表 8.5 折。';
      return;
    }

    const rate = v / 10; // 9 -> 0.9
    const percent = Math.round(rate * 100); // 90
    hintEl.textContent = `折扣值 ${v} ＝ 約 ${percent}% 價格（約 ${v} 折）。`;
  }

  // ====== 主表：只顯示重點欄位 + 詳細按鈕 ======
  function renderTable() {
    const tbody = document.querySelector('#couponsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    filtered.forEach((c, idxFiltered) => {
      const tr = document.createElement('tr');

      const used = c.usedCount || 0;
      const limit = typeof c.usageLimit === 'number' ? c.usageLimit : null;
      const usedText = limit ? `${used} / ${limit}` : `${used}`;

      const originalIndex = coupons.indexOf(c);
      const disableDiscountEdit = (c.usedCount || 0) > 0;

      tr.innerHTML = `
        <td>${idxFiltered + 1}</td>
        <td><input type="text" value="${c.code || ''}" data-field="code" /></td>
        <td><input type="text" value="${c.name || ''}" data-field="name" /></td>
        <td>
          <select data-field="discountType" ${disableDiscountEdit ? 'disabled' : ''}>
            <option value="amount" ${c.discountType === 'amount' ? 'selected' : ''}>金額折抵</option>
            <option value="percent" ${c.discountType === 'percent' ? 'selected' : ''}>百分比</option>
          </select>
        </td>
        <td>
          <input type="number"
                 value="${c.discountValue ?? ''}"
                 data-field="discountValue"
                 ${disableDiscountEdit ? 'disabled' : ''} />
        </td>
        <td><input type="number" value="${c.minAmount ?? ''}" data-field="minAmount" /></td>
        <td>${usedText}</td>
        <td style="white-space:nowrap;">
          ${getStatusBadge(c)}
        </td>
        <td style="text-align:center;">
          <input type="checkbox" ${c.isActive ? 'checked' : ''} data-field="isActive" />
        </td>
        <td style="text-align:right;">
          <button class="btn btn-sm" type="button"
                  onclick="Coupons.openDetail(${originalIndex})">
            詳細
          </button>
        </td>
      `;

      tr.dataset.index = originalIndex;
      tbody.appendChild(tr);
    });

    if (!filtered.length) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td colspan="10" class="small" style="color:#9ca3af;">目前沒有符合條件的優惠券</td>`;
      tbody.appendChild(tr);
    }
  }

  // ====== 新增一筆（自動產生優惠碼） ======
  function add() {
    const now = new Date();
    const from = new Date(now);
    const until = new Date(now);
    until.setDate(until.getDate() + 7);

    coupons.unshift({
      code: generateCouponCode(),
      name: '',
      discountType: 'amount',
      discountValue: 0,
      minAmount: 0,
      validFrom: from.toISOString(),
      validUntil: until.toISOString(),
      usageLimit: null,
      usedCount: 0,
      isActive: true,
      perUserLimit: null,
      allowedVipLevels: [],
      blockedUserIds: [],
    });

    applyFilter();

    const table = document.querySelector('#couponsTable');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ====== 存主表 ======
  function save() {
    const tbody = document.querySelector('#couponsTable tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.forEach((tr) => {
      const idx = Number(tr.dataset.index);
      if (Number.isNaN(idx)) return;
      const c = { ...(coupons[idx] || {}) };

      tr.querySelectorAll('input,select').forEach((el) => {
        const field = el.dataset.field;
        if (!field) return;

        if (el.type === 'checkbox') {
          c[field] = el.checked;
        } else if (el.type === 'number') {
          const val = el.value.trim();
          const num = val === '' ? null : Number(val);
          c[field] = Number.isNaN(num) ? null : num;
        } else {
          c[field] = el.value.trim();
        }
      });

      coupons[idx] = c;
    });

    fetch('/api/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(coupons),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok') {
          if (window.showToast) showToast('優惠券已儲存', 'success');
          load();
        } else {
          if (window.showToast) showToast('儲存優惠券失敗', 'error');
        }
      })
      .catch((err) => {
        console.error('save coupons error', err);
        if (window.showToast) showToast('儲存優惠券失敗', 'error');
      });
  }

  // ====== 詳細彈窗：開啟 / 關閉 / 儲存 ======
  ns.openDetail = function (index) {
    const coupon = coupons[index];
    if (!coupon) return;
    editingIndex = index;

    const overlay = $('couponOverlay');
    if (!overlay) return;

    $('cDetailCode').value = coupon.code || '';
    $('cDetailName').value = coupon.name || '';
    $('cDetailType').value = coupon.discountType || 'amount';
    $('cDetailValue').value = coupon.discountValue ?? '';
    $('cDetailMinAmount').value = coupon.minAmount ?? '';
    $('cDetailPerUserLimit').value =
      coupon.perUserLimit != null ? coupon.perUserLimit : '';

    $('cDetailFrom').value = coupon.validFrom
      ? formatDateTimeLocal(coupon.validFrom)
      : '';
    $('cDetailUntil').value = coupon.validUntil
      ? formatDateTimeLocal(coupon.validUntil)
      : '';

    $('cDetailUsageLimit').value =
      coupon.usageLimit != null ? coupon.usageLimit : '';

    $('cDetailVipLevels').value = Array.isArray(coupon.allowedVipLevels)
      ? coupon.allowedVipLevels.join(',')
      : '';

    $('cDetailBlockedUsers').value = Array.isArray(coupon.blockedUserIds)
      ? coupon.blockedUserIds.join(',')
      : '';

    $('cDetailActive').checked = coupon.isActive !== false;

    const statusText = $('cDetailStatusText');
    if (statusText) {
      statusText.textContent = `已使用次數：${coupon.usedCount || 0}`;
    }

    const hint = $('cDetailUsageHint');
    if (hint) {
      if (
        typeof coupon.usageLimit === 'number' &&
        (coupon.usedCount || 0) >= coupon.usageLimit
      ) {
        hint.textContent = '此優惠券已達總使用上限，將不再可用。';
      } else {
        hint.textContent = '';
      }
    }

    // 綁定折扣提示事件（只綁一次）
    const typeEl = $('cDetailType');
    const valueEl = $('cDetailValue');
    if (typeEl && !typeEl._bindPercentHint) {
      typeEl.addEventListener('change', updatePercentHint);
      typeEl._bindPercentHint = true;
    }
    if (valueEl && !valueEl._bindPercentHint) {
      valueEl.addEventListener('input', updatePercentHint);
      valueEl._bindPercentHint = true;
    }

    // 打開時先更新一次提示
    updatePercentHint();

    overlay.style.display = 'flex';
  };

  ns.closeDetail = function () {
    const overlay = $('couponOverlay');
    if (overlay) overlay.style.display = 'none';
    editingIndex = null;
  };

  ns.saveDetail = function () {
    if (editingIndex == null) {
      ns.closeDetail();
      return;
    }
    const idx = editingIndex;
    const c = { ...(coupons[idx] || {}) };

    c.name = $('cDetailName').value.trim();
    c.discountType = $('cDetailType').value === 'percent' ? 'percent' : 'amount';

    const dv = $('cDetailValue').value.trim();
    c.discountValue = dv === '' ? 0 : Number(dv) || 0;

    const min = $('cDetailMinAmount').value.trim();
    c.minAmount = min === '' ? 0 : Number(min) || 0;

    const perUser = $('cDetailPerUserLimit').value.trim();
    c.perUserLimit =
      perUser === '' ? null : Number(perUser) >= 0 ? Number(perUser) : null;

    const from = $('cDetailFrom').value.trim();
    const until = $('cDetailUntil').value.trim();
    c.validFrom = from ? new Date(from).toISOString() : null;
    c.validUntil = until ? new Date(until).toISOString() : null;

    const usageLimit = $('cDetailUsageLimit').value.trim();
    c.usageLimit =
      usageLimit === '' ? null : Number(usageLimit) >= 0 ? Number(usageLimit) : null;

    const vipStr = $('cDetailVipLevels').value.trim();
    c.allowedVipLevels = vipStr
      ? vipStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((v) => Number(v) || 0)
      : [];

    const blockedStr = $('cDetailBlockedUsers').value.trim();
    c.blockedUserIds = blockedStr
      ? blockedStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    c.isActive = $('cDetailActive').checked;

    coupons[idx] = c;
    ns.closeDetail();
    applyFilter();
  };

  ns.add = add;
  ns.save = save;
  ns.load = load;

  document.addEventListener('DOMContentLoaded', ns.init);
})(window.Coupons);
