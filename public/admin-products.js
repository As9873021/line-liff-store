// admin-products.js

// 一定要先準備全域命名空間
window.Products = window.Products || {};

// 立即函式，接收全域 Products 物件
(function (ns) {
  // 內部用的原始資料與列表
  let products = {};
  let list = [];
  let currentPage = 1;
  const PER_PAGE = 8;

  // 搜尋 / 篩選用
  let keyword = '';
  let categoryFilter = '';
  // 分類清單
  let categoryOptions = [];

  function $(id) {
    return document.getElementById(id);
  }

  ns.init = function () {
    loadCategories();
    bindSearch();
    loadProducts();
    bindForm();
    renderTopProducts();
  };

  function bindSearch() {
    const searchInput = $('productSearchInput');
    const categoryInput = $('productCategoryFilter');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        keyword = searchInput.value.trim().toLowerCase();
        currentPage = 1;
        rebuildList();
        renderList();
        renderPager();
      });
    }
    if (categoryInput) {
      categoryInput.addEventListener('input', () => {
        categoryFilter = categoryInput.value.trim().toLowerCase();
        currentPage = 1;
        rebuildList();
        renderList();
        renderPager();
      });
    }
  }

  function loadCategories() {
    fetch('/api/admin/product-categories')
      .then((r) => r.json())
      .then((cats) => {
        categoryOptions = Array.isArray(cats) ? cats : [];
        ns.categories = categoryOptions; // 掛到全域方便查看
        renderCategorySelect();
        renderCategoryManager();
      })
      .catch((err) => {
        console.error('load categories error', err);
      });
  }

  function renderCategorySelect() {
    const sel = $('pCategorySelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">自訂 / 不選</option>';
    categoryOptions.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
  }

  // 商品分類管理：顯示所有分類 + 刪除按鈕
  function renderCategoryManager() {
    const container = $('productCategoriesManager');
    if (!container) return;
    container.innerHTML = '';

    if (!categoryOptions.length) {
      const empty = document.createElement('div');
      empty.className = 'small';
      empty.style.color = '#9ca3af';
      empty.textContent =
        '目前尚未建立任何分類，請在「新增 / 編輯商品」中輸入分類名稱。';
      container.appendChild(empty);
      return;
    }

    const listEl = document.createElement('div');
    listEl.style.display = 'flex';
    listEl.style.flexWrap = 'wrap';
    listEl.style.gap = '6px';

    categoryOptions.forEach((cat) => {
      const pill = document.createElement('div');
      pill.style.display = 'inline-flex';
      pill.style.alignItems = 'center';
      pill.style.gap = '6px';
      pill.style.padding = '4px 8px';
      pill.style.borderRadius = '999px';
      pill.style.border = '1px solid #d1d5db';
      pill.style.background = '#f9fafb';
      pill.style.fontSize = '12px';
      pill.style.color = '#374151';

      const label = document.createElement('span');
      label.textContent = cat;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '刪除';
      btn.className = 'btn btn-sm';
      btn.style.fontSize = '11px';
      btn.style.padding = '2px 8px';
      btn.onclick = () => deleteCategory(cat);

      pill.appendChild(label);
      pill.appendChild(btn);
      listEl.appendChild(pill);
    });

    container.appendChild(listEl);
  }

  // 刪除分類：從清單移除，並把所有商品中此分類清空
  function deleteCategory(cat) {
    if (!cat) return;
    const ok = window.confirm(
      `確定要刪除分類「${cat}」嗎？\n此動作會：\n1. 從分類清單移除\n2. 將所有商品中這個分類清空（不會刪除商品）`
    );
    if (!ok) return;

    // 1) 更新分類清單
    categoryOptions = categoryOptions.filter((c) => c !== cat);

    // 2) 清空所有商品中的該分類
    Object.keys(products).forEach((name) => {
      if (products[name] && products[name].category === cat) {
        products[name].category = '';
      }
    });

    // 3) 儲存分類與商品，然後重新渲染
    Promise.all([
      fetch('/api/admin/product-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryOptions),
      }),
      fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(products),
      }),
    ])
      .then(async ([catRes, prodRes]) => {
        const catOk = catRes.ok;
        const prodOk = prodRes.ok;
        if (!catOk || !prodOk) {
          throw new Error('儲存分類或商品時發生錯誤');
        }
        if (window.showToast) {
          showToast(`分類「${cat}」已刪除，相關商品分類已清空`, 'success');
        }
        ns.categories = categoryOptions;
        ns.raw = products;
        rebuildList();
        renderCategorySelect();
        renderCategoryManager();
        renderList();
        renderPager();
      })
      .catch((err) => {
        console.error('delete category error', err);
        if (window.showToast) showToast('刪除分類失敗', 'error');
      });
  }

  // 讀取商品，並同步到全域 Products
  function loadProducts() {
    fetch('/api/admin/products')
      .then((r) => r.json())
      .then((data) => {
        products = data || {};
        ns.raw = products;          // 原始 map 掛出去
        rebuildList();              // 會更新 list + ns.list
        currentPage = 1;
        renderList();
        renderPager();
      })
      .catch((err) => {
        console.error('load products error', err);
        if (window.showToast) showToast('讀取商品失敗', 'error');
      });
  }

  // 重建列表（套用搜尋 / 篩選 / 排序），並寫回 ns.list
  function rebuildList() {
    list = Object.keys(products).map((name) => ({
      name,
      ...products[name],
    }));

    // 套用搜尋 / 分類篩選
    list = list.filter((p) => {
      const nameText = (p.name || '').toLowerCase();
      const catText = (p.category || '').toLowerCase();
      if (keyword && !nameText.includes(keyword) && !catText.includes(keyword)) {
        return false;
      }
      if (categoryFilter && !catText.includes(categoryFilter)) {
        return false;
      }
      return true;
    });

    // 排序
    list.sort((a, b) => {
      const sa = typeof a.sort === 'number' ? a.sort : 9999;
      const sb = typeof b.sort === 'number' ? b.sort : 9999;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });

    ns.list = list; // 讓外面看得到目前列表
    renderCategoryListInForm();
  }

  function bindForm() {
    const saveBtn = $('pSaveBtn');
    const resetBtn = $('pResetBtn');
    if (saveBtn) saveBtn.onclick = saveProduct;
    if (resetBtn) resetBtn.onclick = resetProductForm;

    const imageInput = $('pImage');
    if (imageInput) {
      imageInput.addEventListener('input', updatePreview);
    }

    const categorySelect = $('pCategorySelect');
    const categoryInput = $('pCategory');

    if (categorySelect && categoryInput) {
      categorySelect.addEventListener('change', () => {
        if (categorySelect.value) {
          categoryInput.value = categorySelect.value;
          renderCategoryListInForm();
        }
      });
    }

    if (categoryInput) {
      categoryInput.addEventListener('input', () => {
        renderCategoryListInForm();
      });
    }
  }

  function updatePreview() {
    const preview = $('pPreview');
    const url = ($('pImage')?.value || '').trim();
    if (!preview) return;

    if (url) {
      preview.style.backgroundImage = `url(${url})`;
      preview.style.backgroundSize = 'cover';
      preview.style.backgroundPosition = 'center';
      preview.textContent = '';
    } else {
      preview.style.backgroundImage = '';
      preview.textContent = '🍜';
    }
  }

  function renderList() {
    const container = $('productsList');
    if (!container) return;
    container.innerHTML = '';

    const start = (currentPage - 1) * PER_PAGE;
    const pageItems = list.slice(start, start + PER_PAGE);

    pageItems.forEach((p) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.padding = '10px 10px';
      row.style.borderRadius = '12px';
      row.style.border = '1px solid #e5e7eb';
      row.style.background = '#ffffff';
      row.style.boxShadow = '0 4px 10px rgba(15,23,42,.04)';
      row.style.gap = '12px';
      row.style.cursor = 'pointer';
      row.onmouseenter = () => {
        row.style.background = '#f9fafb';
      };
      row.onmouseleave = () => {
        row.style.background = '#ffffff';
      };
      row.onclick = (e) => {
        if (e.target.dataset && e.target.dataset.clickOnly) return;
        fillForm(p);
      };

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '10px';
      left.style.flex = '1';

      const thumb = document.createElement('div');
      thumb.style.width = '42px';
      thumb.style.height = '42px';
      thumb.style.borderRadius = '12px';
      thumb.style.overflow = 'hidden';
      thumb.style.background = '#e5e7eb';
      thumb.style.flexShrink = '0';
      if (p.image) {
        thumb.style.backgroundImage = `url(${p.image})`;
        thumb.style.backgroundSize = 'cover';
        thumb.style.backgroundPosition = 'center';
      } else {
        thumb.style.display = 'flex';
        thumb.style.alignItems = 'center';
        thumb.style.justifyContent = 'center';
        thumb.style.fontSize = '20px';
        thumb.style.color = '#9ca3af';
        thumb.textContent = '🍜';
      }

      const info = document.createElement('div');
      const title = document.createElement('div');
      title.style.fontWeight = '600';
      title.textContent = p.name;

      const meta = document.createElement('div');
      meta.className = 'small';
      meta.style.marginTop = '2px';
      const priceText = `NT$ ${Number(p.price || 0).toLocaleString()}`;
      const sortText = typeof p.sort === 'number' ? p.sort : '—';
      const catText = p.category ? ` · 分類 ${p.category}` : '';
      meta.textContent = `${priceText} · 排序 ${sortText}${catText}`;

      info.appendChild(title);
      info.appendChild(meta);

      left.appendChild(thumb);
      left.appendChild(info);

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '8px';

      const badge = document.createElement('span');
      badge.className = 'badge ' + (p.enabled === false ? '' : 'badge-paid');
      badge.textContent = p.enabled === false ? '停用' : '啟用';
      badge.style.cursor = 'pointer';
      badge.title = '點擊切換啟用 / 停用';
      badge.dataset.clickOnly = '1';
      badge.onclick = (e) => {
        e.stopPropagation();
        toggleEnabled(p.name);
      };

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-sm';
      editBtn.textContent = '編輯';
      editBtn.dataset.clickOnly = '1';
      editBtn.onclick = (e) => {
        e.stopPropagation();
        fillForm(p);
      };

      right.appendChild(badge);
      right.appendChild(editBtn);

      row.appendChild(left);
      row.appendChild(right);

      container.appendChild(row);
    });

    if (!pageItems.length) {
      const empty = document.createElement('div');
      empty.className = 'small';
      empty.style.color = '#9ca3af';
      empty.textContent = '目前尚未建立任何商品';
      container.appendChild(empty);
    }
  }

  function renderPager() {
    const pager = $('productsPager');
    if (!pager) return;
    pager.innerHTML = '';

    const total = list.length;
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
        renderList();
        renderPager();
      };
      pager.appendChild(btn);
    }

    ns.total = total;
    ns.currentPage = currentPage;
    ns.totalPages = totalPages;
  }

  // 切換到「新增 / 編輯商品」分頁
  function switchToEditTab() {
    const btns = document.querySelectorAll('.product-subtab-btn');
    const sections = {
      list: document.getElementById('productSection-list'),
      edit: document.getElementById('productSection-edit'),
      top10: document.getElementById('productSection-top10'),
    };
    const target = 'edit';

    btns.forEach((b) => {
      if (b.getAttribute('data-section') === target) {
        b.classList.add('btn-primary');
      } else {
        b.classList.remove('btn-primary');
      }
    });
    Object.keys(sections).forEach((key) => {
      if (sections[key]) {
        sections[key].style.display = key === target ? 'block' : 'none';
      }
    });
  }

  // 編輯區：顯示同分類商品列表
  function renderCategoryListInForm() {
    const catInput = $('pCategory');
    const container = $('pCategoryList');
    if (!catInput || !container) return;

    const cat = (catInput.value || '').trim().toLowerCase();
    if (!cat) {
      container.textContent = '（請先輸入分類）';
      return;
    }

    const sameCat = Object.keys(products)
      .map((name) => ({ name, ...products[name] }))
      .filter((p) => (p.category || '').toLowerCase() === cat)
      .sort((a, b) => {
        const sa = typeof a.sort === 'number' ? a.sort : 9999;
        const sb = typeof b.sort === 'number' ? b.sort : 9999;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name, 'zh-Hant');
      });

    if (!sameCat.length) {
      container.textContent = '（此分類目前沒有其他商品）';
      return;
    }

    container.textContent = sameCat.map((p) => p.name).join('、');
  }

  function fillForm(p) {
    switchToEditTab();

    $('pName').value = p.name || '';
    $('pPrice').value = p.price || '';
    $('pStock').value = p.stock || '';
    $('pImage').value = p.image || '';
    $('pSort').value = p.sort ?? '';
    $('pEnabled').checked = p.enabled !== false;
    $('pCategory').value = p.category || '';
    $('pName').dataset.editing = '1';

    if (categoryOptions.length && p.category) {
      const sel = $('pCategorySelect');
      if (sel) sel.value = categoryOptions.includes(p.category) ? p.category : '';
    }

    updatePreview();
    renderCategoryListInForm();
  }

  function resetProductForm() {
    $('pName').value = '';
    $('pPrice').value = '';
    $('pStock').value = '';
    $('pImage').value = '';
    $('pSort').value = '';
    $('pCategory').value = '';
    $('pEnabled').checked = true;
    delete $('pName').dataset.editing;
    const sel = $('pCategorySelect');
    if (sel) sel.value = '';
    updatePreview();
    renderCategoryListInForm();
  }

  function saveProduct() {
    const nameInput = $('pName');
    const name = nameInput.value.trim();
    const price = Number($('pPrice').value || 0);
    const stock = Number($('pStock').value || 0);
    const image = $('pImage').value.trim();
    const sort = $('pSort').value === '' ? null : Number($('pSort').value);
    const enabled = $('pEnabled').checked;
    const category = $('pCategory').value.trim();

    if (!name) {
      if (window.showToast) showToast('請輸入商品名稱', 'error');
      nameInput.focus();
      return;
    }

    const key = name;
    products[key] = {
      price,
      stock,
      image,
      sort,
      enabled,
      category,
    };

    // 新分類寫回清單
    if (category && !categoryOptions.includes(category)) {
      categoryOptions.push(category);
      categoryOptions.sort((a, b) => a.localeCompare(b, 'zh-Hant'));
      renderCategorySelect();
      renderCategoryManager();
      fetch('/api/admin/product-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryOptions),
      }).catch((err) => {
        console.error('save categories error', err);
      });
    }

    fetch('/api/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(products),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok') {
          if (window.showToast) showToast('商品已儲存', 'success');
          resetProductForm();
          loadProducts(); // 重新拉最新資料並更新 ns
        } else {
          if (window.showToast) showToast('儲存商品失敗', 'error');
        }
      })
      .catch((err) => {
        console.error('save product error', err);
        if (window.showToast) showToast('儲存商品失敗', 'error');
      });
  }

  function toggleEnabled(productName) {
    const key = productName;
    const current = products[key];
    if (!current) return;

    current.enabled = current.enabled === false ? true : false;

    fetch('/api/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(products),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok') {
          if (window.showToast) {
            showToast(
              current.enabled ? '已啟用商品' : '已停用商品',
              'success'
            );
          }
          rebuildList();
          renderList();
          renderPager();
        } else {
          if (window.showToast) showToast('切換啟用狀態失敗', 'error');
        }
      })
      .catch((err) => {
        console.error('toggle enabled error', err);
        if (window.showToast) showToast('切換啟用狀態失敗', 'error');
      });
  }

  function renderTopProducts() {
    const tbody = document.querySelector('#topProductsTable tbody');
    if (!tbody) return;

    function draw() {
      tbody.innerHTML = '';
      const top = (window.Orders && window.Orders.topProducts) || [];
      top.slice(0, 10).forEach((p, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>${p.name}</td>
          <td>${p.qty}</td>
          <td>NT$ ${p.total.toLocaleString()}</td>
        `;
        tbody.appendChild(tr);
      });
      if (!top.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="4" class="small" style="color:#9ca3af;">尚無銷售統計資料</td>`;
        tbody.appendChild(tr);
      }
    }

    draw();
    setInterval(draw, 30000);
  }

  document.addEventListener('DOMContentLoaded', ns.init);
})(window.Products);
