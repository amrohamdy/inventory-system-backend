const stockCountService = require('../services/stockCount.service');
const pdfService = require('../services/pdf.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.createSession = async (req, res, next) => {
    try {
        const { locationId, notes } = req.body;
        const session = await stockCountService.createSession(
            req.user.tenantId,
            locationId,
            req.user.id,
            notes
        );
        res.status(201).json({ status: 'success', data: session });
    } catch (error) {
        next(error);
    }
};

exports.getSessions = async (req, res, next) => {
    try {
        const result = await stockCountService.getSessions(req.user.tenantId, req.query);
        res.status(200).json({ status: 'success', data: result });
    } catch (error) {
        next(error);
    }
};

exports.getSession = async (req, res, next) => {
    try {
        const session = await stockCountService.getSessionById(req.params.id, req.user.tenantId);
        res.status(200).json({ status: 'success', data: session });
    } catch (error) {
        next(error);
    }
};

exports.updateLines = async (req, res, next) => {
    try {
        const { lines } = req.body;
        const session = await stockCountService.updateCountLines(req.params.id, req.user.tenantId, lines);
        res.status(200).json({ status: 'success', data: session });
    } catch (error) {
        next(error);
    }
};

exports.submitForApproval = async (req, res, next) => {
    try {
        const request = await stockCountService.submitForApproval(req.params.id, req.user.tenantId, req.user.id);
        res.status(200).json({ status: 'success', data: request });
    } catch (error) {
        next(error);
    }
};

exports.processApproval = async (req, res, next) => {
    try {
        const { action, comment } = req.body; // action: 'APPROVE' or 'REJECT'
        const isApproved = action === 'APPROVE';
        const result = await stockCountService.processApproval(req.params.id, req.user.tenantId, req.user, comment, isApproved);
        res.status(200).json({ status: 'success', data: result });
    } catch (error) {
        next(error);
    }
};

exports.voidSession = async (req, res, next) => {
    try {
        await stockCountService.voidSession(req.params.id, req.user.tenantId, req.user.id);
        res.status(200).json({ status: 'success', message: 'Session voided successfully' });
    } catch (error) {
        next(error);
    }
};

const buildEvidenceJSON = async (session, tenantId) => {
    let ledgerEntries = [];
    if (session.status === 'POSTED') {
        ledgerEntries = await prisma.inventoryLedger.findMany({
            where: { referenceId: session.id, tenantId }
        });
    }

    const positiveVariances = session.lines.filter(l => Number(l.varianceQty) > 0);
    const negativeVariances = session.lines.filter(l => Number(l.varianceQty) < 0);

    const totalPositiveValue = positiveVariances.reduce((sum, l) => sum + Math.abs(Number(l.varianceValue)), 0);
    const totalNegativeValue = negativeVariances.reduce((sum, l) => sum + Math.abs(Number(l.varianceValue)), 0);

    return {
        sessionInfo: {
            sessionNo: session.sessionNo,
            location: session.location.name,
            status: session.status,
            snapshotAt: session.snapshotAt,
            postedAt: session.postedAt,
            createdBy: `${session.createdByUser.firstName} ${session.createdByUser.lastName}`
        },
        approvalHistory: session.approvalRequest ? session.approvalRequest.steps.map(s => ({
            step: s.stepNumber,
            role: s.requiredRole?.code ?? s.requiredRole,
            status: s.status,
            actedBy: s.actedByUser ? `${s.actedByUser.firstName} ${s.actedByUser.lastName}` : null,
            actedAt: s.actedAt,
            comment: s.comment
        })) : [],
        varianceSummary: {
            itemsCounted: session.lines.filter(l => l.countedQty !== null).length,
            totalItems: session.lines.length,
            overQty: positiveVariances.reduce((sum, l) => sum + Math.abs(Number(l.varianceQty)), 0),
            shortQty: negativeVariances.reduce((sum, l) => sum + Math.abs(Number(l.varianceQty)), 0),
            overValue: totalPositiveValue,
            shortValue: totalNegativeValue,
            netVarianceValue: totalPositiveValue - totalNegativeValue
        },
        lines: session.lines.map(l => ({
            item: l.item.name,
            bookQty: Number(l.bookQty),
            countedQty: l.countedQty ? Number(l.countedQty) : null,
            varianceQty: Number(l.varianceQty),
            unitCost: Number(l.wacUnitCost),
            varianceValue: Number(l.varianceValue)
        })),
        ledgerEntries: ledgerEntries.map(l => ({
            itemId: l.itemId,
            type: l.movementType,
            qtyIn: Number(l.qtyIn),
            qtyOut: Number(l.qtyOut),
            totalValue: Number(l.totalValue)
        }))
    };
};

exports.getEvidencePack = async (req, res, next) => {
    try {
        const session = await stockCountService.getSessionById(req.params.id, req.user.tenantId);
        const evidence = await buildEvidenceJSON(session, req.user.tenantId);
        res.status(200).json({ status: 'success', data: evidence });
    } catch (error) {
        next(error);
    }
};

exports.downloadEvidencePdf = async (req, res, next) => {
    try {
        const session = await stockCountService.getSessionById(req.params.id, req.user.tenantId);
        const evidence = await buildEvidenceJSON(session, req.user.tenantId);

        const doc = await pdfService.generateStockCountEvidencePDF(evidence);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=evidence-${session.sessionNo}.pdf`);
        res.setHeader('Content-Length', doc.length);
        res.end(doc);
    } catch (error) {
        next(error);
    }
};
exports.downloadExcel = async (req, res, next) => {
    try {
        const ExcelJS = require('exceljs');
        const session = await stockCountService.getSessionById(req.params.id, req.user.tenantId);

        const wb = new ExcelJS.Workbook();
        wb.creator = 'OSE Inventory System';
        wb.created = new Date();

        const ws = wb.addWorksheet('Stock Count', {
            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
        });

        // ── Title block ──────────────────────────────────────────────────────
        const titleStyle = { font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } }, alignment: { horizontal: 'center', vertical: 'middle' } };
        const metaStyle = { font: { size: 10, color: { argb: 'FF374151' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } } };

        ws.mergeCells('A1:H1');
        ws.getCell('A1').value = 'STOCK COUNT WORKSHEET';
        ws.getCell('A1').style = titleStyle;
        ws.getRow(1).height = 30;

        ws.mergeCells('A2:H2');
        ws.getCell('A2').value = `Session: ${session.sessionNo}  |  Location: ${session.location.name}  |  Date: ${new Date(session.snapshotAt).toLocaleDateString('en-GB')}  |  Status: ${session.status}`;
        ws.getCell('A2').style = { ...metaStyle, alignment: { horizontal: 'center' } };
        ws.getRow(2).height = 20;

        ws.addRow([]);  // spacer row 3

        // ── Header row ───────────────────────────────────────────────────────
        const headerStyle = {
            font: { bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } },
            alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
            border: { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } }
        };
        const physicalHeaderStyle = {
            ...headerStyle,
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } },  // amber for Physical Count column
        };

        const headers = [
            { header: '#', key: 'num', width: 5 },
            { header: 'Item Name', key: 'item', width: 35 },
            { header: 'Barcode', key: 'barcode', width: 18 },
            { header: 'Category', key: 'category', width: 18 },
            { header: 'Book Qty', key: 'bookQty', width: 12 },
            { header: 'Physical Count ✍', key: 'counted', width: 16 },
            { header: 'Variance Qty', key: 'varQty', width: 14 },
            { header: 'Unit Cost (SAR)', key: 'unitCost', width: 16 },
            { header: 'Variance Value', key: 'varValue', width: 16 },
        ];

        ws.columns = headers.map(h => ({ key: h.key, width: h.width }));

        const headerRow = ws.getRow(4);
        headerRow.height = 36;
        headers.forEach((h, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = h.header;
            cell.style = h.key === 'counted' ? physicalHeaderStyle : headerStyle;
        });

        ws.views = [{ state: 'frozen', ySplit: 4 }];

        // ── Data rows ─────────────────────────────────────────────────────────
        const numFmt = '#,##0.00';
        const intFmt = '#,##0';

        const baseRowStyle = { font: { size: 10 }, alignment: { vertical: 'middle' } };
        const countedCellStyle = {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } },  // light amber
            font: { bold: true, size: 10 },
            alignment: { horizontal: 'center', vertical: 'middle' },
            border: { left: { style: 'medium', color: { argb: 'FFD97706' } }, right: { style: 'medium', color: { argb: 'FFD97706' } } }
        };

        session.lines.forEach((line, idx) => {
            const varQty = Number(line.varianceQty || 0);
            const varVal = Number(line.varianceValue || 0);
            const counted = line.countedQty !== null ? Number(line.countedQty) : null;

            const row = ws.addRow({
                num: idx + 1,
                item: line.item.name,
                barcode: line.item.barcode || '',
                category: line.item.category?.name || '',
                bookQty: Number(line.bookQty),
                counted: counted,
                varQty: counted !== null ? varQty : null,
                unitCost: Number(line.wacUnitCost),
                varValue: counted !== null ? varVal : null,
            });

            row.height = 22;

            // Row base style
            row.eachCell({ includeEmpty: true }, (cell, colNum) => {
                cell.style = { ...baseRowStyle };
                cell.border = { bottom: { style: 'dotted', color: { argb: 'FFE5E7EB' } } };
                if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
            });

            // Physical count column style
            row.getCell('counted').style = { ...countedCellStyle };

            // Variance colours
            if (counted !== null && varQty !== 0) {
                const varColor = varQty > 0 ? 'FF065F46' : 'FF991B1B';
                const varBg = varQty > 0 ? 'FFD1FAE5' : 'FFFEE2E2';
                ['varQty', 'varValue'].forEach(k => {
                    row.getCell(k).font = { bold: true, color: { argb: varColor }, size: 10 };
                    row.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: varBg } };
                });
            }

            // Number formats
            row.getCell('bookQty').numFmt = intFmt;
            row.getCell('counted').numFmt = intFmt;
            row.getCell('varQty').numFmt = intFmt;
            row.getCell('unitCost').numFmt = numFmt;
            row.getCell('varValue').numFmt = numFmt;
        });

        // ── Summary row ───────────────────────────────────────────────────────
        ws.addRow([]);
        const pos = session.lines.filter(l => Number(l.varianceQty) > 0);
        const neg = session.lines.filter(l => Number(l.varianceQty) < 0);
        const totalOver = pos.reduce((s, l) => s + Math.abs(Number(l.varianceValue)), 0);
        const totalShort = neg.reduce((s, l) => s + Math.abs(Number(l.varianceValue)), 0);

        const summaryRows = [
            ['', 'Total Items Counted', '', '', '', session.lines.filter(l => l.countedQty !== null).length, '', '', ''],
            ['', 'Total Overages (SAR)', '', '', '', '', '', '', totalOver],
            ['', 'Total Shortages (SAR)', '', '', '', '', '', '', totalShort],
            ['', 'Net Variance (SAR)', '', '', '', '', '', '', totalOver - totalShort],
        ];

        summaryRows.forEach(r => {
            const row = ws.addRow(r);
            row.height = 22;
            row.getCell(2).style = { font: { bold: true, size: 10 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } } };
            row.getCell(9).numFmt = numFmt;
            row.getCell(9).font = { bold: true, size: 10 };
        });

        // ── Send file ─────────────────────────────────────────────────────────
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=StockCount-${session.sessionNo}.xlsx`);
        await wb.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};
