export const AutomationEngine = {
    // 棄單挽回邏輯：偵測 24h 未結帳
    checkAbandonedCart: (cartTime) => {
        const now = new Date().getTime();
        return (now - cartTime) > 24 * 60 * 60 * 1000;
    },
    // 回購提醒邏輯：自定義天數
    checkRepurchase: (lastOrderDate, cycleDays) => {
        const gap = new Date().getTime() - new Date(lastOrderDate).getTime();
        return gap >= cycleDays * 24 * 60 * 60 * 1000;
    },
    // 到貨通知自動推播
    notifyBackInStock: (productId, subscribers) => {
        console.log(`自動推播：商品 ${productId} 已補貨，發送給 ${subscribers.length} 人`);
    }
};