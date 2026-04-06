function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rowsToExcelXml({ worksheetName, headers, rows }) {
  const xmlRows = [];
  xmlRows.push('<Row>' + headers.map((header) => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`).join('') + '</Row>');
  rows.forEach((row) => {
    xmlRows.push('<Row>' + row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join('') + '</Row>');
  });
  return `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${escapeXml(worksheetName || 'Sheet1')}"><Table>${xmlRows.join('')}</Table></Worksheet></Workbook>`;
}

function sendExcelXml(res, filename, xml) {
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(xml);
}

module.exports = { rowsToExcelXml, sendExcelXml };
