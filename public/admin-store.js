// admin-store.js

window.Store = (function () {
  const ns = {};
  let current = null;

  function id(id) {
    return document.getElementById(id);
  }

  ns.load = async function () {
    try {
      const res = await fetch('/api/store');
      current = await res.json();
    } catch (e) {
      console.error('load store error', e);
      current = {};
    }

    // 基本欄位還原
    const storeName = id('storeName');
    const storeAdminTitle = id('storeAdminTitle');
    const storeSubtitle = id('storeSubtitle');
    const storeHours = id('storeHours');
    const storeTakeout = id('storeTakeout');
    const storeDelivery = id('storeDelivery');
    const storeEnableCoupons = id('storeEnableCoupons');
    const storeEnableVip = id('storeEnableVip');

    if (storeName) storeName.value = current.name || '';
    if (storeAdminTitle) storeAdminTitle.value = current.adminTitle || '';
    if (storeSubtitle) storeSubtitle.value = current.subtitle || '';
    if (storeHours) storeHours.value = current.businessHours || '';

    if (storeTakeout) storeTakeout.checked = current.takeoutEnabled !== false;
    if (storeDelivery) storeDelivery.checked = !!current.deliveryEnabled;
    if (storeEnableCoupons) storeEnableCoupons.checked = current.enableCoupons !== false;
    if (storeEnableVip) storeEnableVip.checked = current.enableVip !== false;

    // 付款方式還原
    const pm = current.paymentMethods || {};
    const pmCash = id('pmCash');
    const pmLinePay = id('pmLinePay');
    const pmCard = id('pmCard');
    const pmHomeDelivery = id('pmHomeDelivery');
    const pmCod = id('pmCod');
    const pmCvsCode = id('pmCvsCode');

    if (pmCash) pmCash.checked = pm.cash !== false;
    if (pmLinePay) pmLinePay.checked = !!pm.linePay;
    if (pmCard) pmCard.checked = !!pm.card;
    if (pmHomeDelivery) pmHomeDelivery.checked = !!pm.homeDelivery;
    if (pmCod) pmCod.checked = !!pm.cod;
    if (pmCvsCode) pmCvsCode.checked = !!pm.cvsCode;

    // ✅ 商店圖標多選還原
    const iconOptions = document.querySelectorAll('.store-icon-option');
    const currentIcons = (current.icon || '')
      .split(' ')
      .map(s => s.trim())
      .filter(Boolean); // 例如 ["🐷","🍜"]

    iconOptions.forEach(opt => {
      opt.checked = currentIcons.includes(opt.value);
    });

    // 統計資訊
    const viewsEl = id('summaryProductViews');
    if (viewsEl) {
      viewsEl.textContent = (current.productPageViews || 0).toLocaleString();
    }

    // 後台左上角標題
    const brandTitle = document.querySelector('.brand-text-main');
    if (brandTitle) {
      brandTitle.textContent = current.adminTitle || 'LIFF 商店後台';
      document.title = current.adminTitle || 'LIFF 商店後台';
    }
  };

  ns.save = async function () {
    const btn = id('storeSaveBtn');
    if (btn) btn.disabled = true;

    const storeName = id('storeName');
    const storeAdminTitle = id('storeAdminTitle');
    const storeSubtitle = id('storeSubtitle');
    const storeHours = id('storeHours');
    const storeTakeout = id('storeTakeout');
    const storeDelivery = id('storeDelivery');
    const storeEnableCoupons = id('storeEnableCoupons');
    const storeEnableVip = id('storeEnableVip');

    const pmCash = id('pmCash');
    const pmLinePay = id('pmLinePay');
    const pmCard = id('pmCard');
    const pmHomeDelivery = id('pmHomeDelivery');
    const pmCod = id('pmCod');
    const pmCvsCode = id('pmCvsCode');

    // ✅ 把有勾的圖標串起來（中間用空白分隔）
    const iconOptions = document.querySelectorAll('.store-icon-option');
    const icons = Array.from(iconOptions)
      .filter(opt => opt.checked)
      .map(opt => opt.value)
      .join(' '); // 例如 "🐷 🍜"

    const payload = {
      name: storeName ? storeName.value.trim() : '',
      adminTitle: storeAdminTitle ? storeAdminTitle.value.trim() : '',
      subtitle: storeSubtitle ? storeSubtitle.value.trim() : '',
      businessHours: storeHours ? storeHours.value.trim() : '',
      takeoutEnabled: storeTakeout ? storeTakeout.checked : true,
      deliveryEnabled: storeDelivery ? storeDelivery.checked : false,
      enableCoupons: storeEnableCoupons ? storeEnableCoupons.checked : true,
      enableVip: storeEnableVip ? storeEnableVip.checked : true,
      icon: icons || (current && current.icon) || '🛒',
      paymentMethods: {
        cash: pmCash ? pmCash.checked : true,
        linePay: pmLinePay ? pmLinePay.checked : false,
        card: pmCard ? pmCard.checked : false,
        homeDelivery: pmHomeDelivery ? pmHomeDelivery.checked : false,
        cod: pmCod ? pmCod.checked : false,
        cvsCode: pmCvsCode ? pmCvsCode.checked : false,
      },
      productPageViews: current?.productPageViews || 0,
    };

    try {
      const res = await fetch('/api/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.status === 'ok') {
        current = data.store;
        alert('商店設定已儲存');

        const viewsEl = id('summaryProductViews');
        if (viewsEl) {
          viewsEl.textContent = (current.productPageViews || 0).toLocaleString();
        }

        const brandTitle = document.querySelector('.brand-text-main');
        if (brandTitle) {
          brandTitle.textContent = current.adminTitle || 'LIFF 商店後台';
          document.title = current.adminTitle || 'LIFF 商店後台';
        }
      } else {
        alert(data.message || 'unknown error');
      }
    } catch (e) {
      console.error('save store error', e);
      alert('儲存失敗');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (id('storeName')) {
      ns.load();
    }
  });

  return ns;
})();
