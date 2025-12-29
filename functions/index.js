// 注意：這需要 Node.js 環境
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// 每天凌晨 00:00 執行
exports.dailyBirthdayCheck = functions.pubsub.schedule('0 0 * * *')
    .timeZone('Asia/Taipei')
    .onRun(async (context) => {
        const users = await admin.firestore().collection('members').get();
        // 篩選今日壽星並發送 LINE Notify 或 Messaging API
        console.log("今日壽星檢查完成");
        return null;
    });