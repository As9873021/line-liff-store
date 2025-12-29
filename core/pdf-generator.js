// 建議在 admin-orders.html 中引入此 Script
// <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
// <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js"></script>

export const PDFGenerator = {
    /**
     * 生成單張訂單出貨單
     * @param {Object} orderData - 訂單物件
     */
    generateOrderPDF: (orderData) => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // 1. 設定品牌標題 (韓系極簡風)
        doc.setFontSize(22);
        doc.text("PREMIUM SELECT", 105, 20, { align: "center" });
        
        doc.setFontSize(10);
        doc.text("Official Shipping Manifest", 105, 28, { align: "center" });
        doc.line(20, 35, 190, 35); // 分隔線

        // 2. 訂單基本資訊
        doc.setFontSize(12);
        doc.text(`訂單編號: ${orderData.id}`, 20, 45);
        doc.text(`訂購日期: ${orderData.date}`, 20, 52);
        doc.text(`收件人: ${orderData.customerName}`, 20, 59);
        doc.text(`物流方式: ${orderData.logisticsType}`, 120, 45);
        doc.text(`付款狀態: ${orderData.paymentStatus}`, 120, 52);

        // 3. 商品清單表格 (使用 autoTable)
        const tableBody = orderData.items.map(item => [
            item.name,
            item.spec || "無",
            item.qty,
            `$${item.price}`,
            `$${item.qty * item.price}`
        ]);

        doc.autoTable({
            startY: 70,
            head: [['商品名稱', '規格', '數量', '單價', '小計']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillGray: 20, textColor: 255 },
            styles: { font: 'helvetica', fontSize: 10 }
        });

        // 4. 總計與備註
        const finalY = doc.lastAutoTable.finalY + 10;
        doc.setFontSize(14);
        doc.text(`應收總額: $${orderData.totalPrice}`, 190, finalY, { align: "right" });
        
        doc.setFontSize(10);
        doc.text("感謝您的支持，若有商品疑問請透過 LINE 客服聯繫。", 20, finalY + 20);

        // 5. 下載檔案
        doc.save(`Order_${orderData.id}.pdf`);
    },

    /**
     * 批量生成 PDF (老闆點擊「批量產出」時使用)
     */
    generateBatchPDF: (ordersArray) => {
        ordersArray.forEach(order => {
            PDFGenerator.generateOrderPDF(order);
        });
    }
};