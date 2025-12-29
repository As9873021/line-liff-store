export const AutomationEngine = {
    // 偵測棄單 (假設傳入購物車最後更新時間)
    isAbandoned: (lastActiveTime) => {
        const hours24 = 24 * 60 * 60 * 1000;
        return (Date.now() - lastActiveTime) > hours24;
    },

    // 庫存回填判斷 (0 -> 有貨)
    shouldNotifyStock: (oldStock, newStock) => {
        return oldStock === 0 && newStock > 0;
    },

    // 生日判斷
    isBirthdayToday: (birthdayString) => {
        const today = new Date().toISOString().slice(5, 10); // MM-DD
        return birthdayString.includes(today);
    }
};