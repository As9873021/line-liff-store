// admin-settings.js
window.Settings = window.Settings || {};

(function (ns) {
  // 從後端 settings.json 來，而不是 localStorage
  let currentSettings = null; // { mode, allowOrders, lineLiffId, baseUrl, extra: [...] }

  ns.init = async function () {
    await loadFromServer();
    renderMode();
    renderSettingsTable();
  };

  // 切換模式（local / public）
  ns.changeMode = function (value) {
    const mode = value === 'public' ? 'public' : 'local';
    if (!currentSettings) currentSettings = {};
    currentSettings.mode = mode;
    renderMode();
    saveToServer(true); // 改成 showAlert = true，比較有感
  };

  // 新增一列整合設定
  ns.addSettingRow = function () {
    if (!currentSettings) currentSettings = {};
    if (!Array.isArray(currentSettings.extra)) currentSettings.extra = [];
    currentSettings.extra.push({ name: '', note: '', value: '' });
    renderSettingsTable();
    saveToServer(true); // 也順便存一下，並且跳提示
  };

  // 儲存某一列
  ns.saveRow = function (idx) {
    if (!currentSettings || !Array.isArray(currentSettings.extra)) return;
    const row = currentSettings.extra[idx];
    if (!row) return;

    const inputs = document.querySelectorAll(
      `[data-settings-idx="${idx}"]`
    );
    inputs.forEach((input) => {
      const field = input.getAttribute('data-settings-field');
      if (field) row[field] = input.value;
    });

    saveToServer(true); // showAlert = true
  };

  // 刪除某一列
  ns.removeRow = function (idx) {
    if (!currentSettings || !Array.isArray(currentSettings.extra)) return;
    if (!confirm('確定要刪除這筆設定嗎？')) return;
    currentSettings.extra.splice(idx, 1);
    renderSettingsTable();
    saveToServer(true);
  };

  // ====== 私有函式 ======

  async function loadFromServer() {
    try {
      const res = await fetch('/api/admin/settings');
      currentSettings = await res.json();
    } catch (e) {
      console.error('load settings error', e);
      currentSettings = {
        mode: 'local',
        allowOrders: false,
        lineLiffId: '',
        baseUrl: '',
        extra: [],
      };
    }
  }

  function saveToServer(showAlert) {
    if (!currentSettings) return;
    fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentSettings),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok') {
          if (showAlert) alert('設定已儲存');
        } else {
          alert('儲存設定失敗');
        }
      })
      .catch((e) => {
        console.error('save settings error', e);
        alert('儲存設定失敗');
      });
  }

  function renderMode() {
    const mode = (currentSettings && currentSettings.mode) || 'local';
    const select = document.getElementById('modeSelect');
    const badge = document.getElementById('modeBadge');
    if (select) select.value = mode;
    if (badge) {
      if (mode === 'public') {
        badge.textContent = '正式公開模式';
        badge.classList.remove('badge-mode-local');
        badge.classList.add('badge-mode');
      } else {
        badge.textContent = '本機測試模式';
        badge.classList.remove('badge-mode');
        badge.classList.add('badge-mode-local');
      }
    }
  }

  function renderSettingsTable() {
    const tbody = document.getElementById('settingsTableBody');
    if (!tbody) return;
    const list =
      (currentSettings && Array.isArray(currentSettings.extra)
        ? currentSettings.extra
        : []);
    tbody.innerHTML = '';
    list.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input class="input" value="${row.name || ''}"
                   data-settings-field="name" data-settings-idx="${idx}"></td>
        <td><input class="input" value="${row.note || ''}"
                   data-settings-field="note" data-settings-idx="${idx}"></td>
        <td><input class="input" value="${row.value || ''}"
                   data-settings-field="value" data-settings-idx="${idx}"></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-sm" onclick="Settings.saveRow(${idx})">儲存</button>
          <button class="btn btn-sm btn-danger" onclick="Settings.removeRow(${idx})">刪除</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
})(window.Settings);
