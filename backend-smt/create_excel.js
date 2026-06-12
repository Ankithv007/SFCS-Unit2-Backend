const ExcelJS = require('exceljs');
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('PO-Details');
sheet.columns = [
  { header: 'PO Number', key: 'po_num', width: 15 },
  { header: 'Item Code', key: 'item_code', width: 15 },
  { header: 'Quantity', key: 'qty', width: 10 },
  { header: 'Unit Price', key: 'price', width: 12 }
];
sheet.addRow({ po_num: 'PO-PROD-2026', item_code: 'MOTHERBOARD-A', qty: 200, price: 45.50 });
sheet.addRow({ po_num: 'PO-PROD-2026', item_code: 'CHIPSET-B', qty: 400, price: 12.25 });
workbook.xlsx.writeFile('test_po.xlsx')
  .then(() => console.log('Excel file created!'))
  .catch(err => console.error(err));
