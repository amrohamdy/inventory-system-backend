const ExcelJS = require('exceljs');

/**
 * Generates an Excel workbook buffer from JSON data
 * @param {Array} data Array of objects representing rows
 * @param {Array} columns Array of column definitions: { header: 'Name', key: 'name', width: 20 }
 * @param {String} reportTitle The name of the worksheet tab
 * @param {Object} metadata Optional metadata like filters applied, generatedAt, etc.
 * @returns {Buffer} The Excel file buffer
 */
const generateExcelBuffer = async (data, columns, reportTitle = 'Report', metadata = {}) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = metadata.generatedBy || 'OS&E System';
    workbook.created = metadata.generatedAt ? new Date(metadata.generatedAt) : new Date();

    const sheet = workbook.addWorksheet(reportTitle.substring(0, 31)); // Max 31 chars for tab name

    // Insert Metadata at the top if provided
    let startRow = 1;
    if (Object.keys(metadata).length > 0) {
        sheet.addRow([`Report: ${reportTitle}`]);
        sheet.getRow(startRow).font = { bold: true, size: 14 };
        startRow++;

        sheet.addRow([`Generated At: ${new Date().toLocaleString()}`]);
        startRow++;

        // Add filter summary
        if (metadata.filters) {
            sheet.addRow(['Filters Applied:']);
            startRow++;
            Object.entries(metadata.filters).forEach(([key, value]) => {
                if (value) {
                    sheet.addRow([`${key}: ${value}`]);
                    startRow++;
                }
            });
        }

        sheet.addRow([]); // Blank row before data
        startRow++;
    }

    // Assign columns starting from the data row
    // ExcelJS normally binds columns to row 1 by default, but we can just use the mapping logic manually to offset it.

    // Write Headers
    const headerRow = sheet.getRow(startRow);
    columns.forEach((col, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = col.header;
        cell.font = { bold: true };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };
        // Set column width globally
        sheet.getColumn(index + 1).width = col.width || 15;
    });

    // Write Data
    data.forEach((row, rowIndex) => {
        const dataRow = sheet.getRow(startRow + 1 + rowIndex);
        columns.forEach((col, colIndex) => {
            let val = row[col.key];
            // Format numbers slightly
            if (typeof val === 'number') {
                dataRow.getCell(colIndex + 1).value = val;
                // Add basic comma formatting for numbers larger than 1000
                dataRow.getCell(colIndex + 1).numFmt = '#,##0.00';
            } else {
                dataRow.getCell(colIndex + 1).value = val;
            }
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
};

module.exports = {
    generateExcelBuffer
};
