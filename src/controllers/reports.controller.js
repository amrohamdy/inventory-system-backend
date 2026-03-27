const reportsService = require('../services/reports.service');
const excelService = require('../services/excel.service');
const pdfService = require('../services/pdf.service');

const getStockValuation = async (req, res, next) => {
    try {
        const { locationId, categoryId, page, limit } = req.query;
        const result = await reportsService.getStockValuation(req.user.tenantId, {
            locationId,
            categoryId,
            page,
            limit
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
};

const exportStockValuation = async (req, res, next) => {
    try {
        const { locationId, categoryId } = req.query;

        // Fetch ALL data without pagination for export
        const result = await reportsService.getStockValuation(req.user.tenantId, {
            locationId,
            categoryId
        });

        const columns = [
            { header: 'Location', key: 'locationName', width: 25 },
            { header: 'Item Code', key: 'itemCode', width: 15 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Category', key: 'category', width: 20 },
            { header: 'Qty On Hand', key: 'qtyOnHand', width: 15 },
            { header: 'WAC (SAR)', key: 'wacUnitCost', width: 15 },
            { header: 'Total Value (SAR)', key: 'totalValue', width: 20 }
        ];

        const metadata = {
            generatedBy: `${req.user.firstName} ${req.user.lastName}`,
            generatedAt: new Date().toISOString(),
            filters: {
                locationId,
                categoryId
            }
        };

        const buffer = await excelService.generateExcelBuffer(result.data, columns, 'Stock Valuation', metadata);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Stock_Valuation_${new Date().toISOString().split('T')[0]}.xlsx"`);
        res.send(buffer);
    } catch (error) {
        next(error);
    }
};

const getMovementHistory = async (req, res, next) => {
    try {
        const { dateFrom, dateTo, locationId, itemId, movementType, page, limit } = req.query;
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ error: "dateFrom and dateTo are required" });
        }

        const result = await reportsService.getMovementHistory(req.user.tenantId, {
            dateFrom,
            dateTo,
            locationId,
            itemId,
            movementType,
            page,
            limit
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
};

const exportMovementHistory = async (req, res, next) => {
    try {
        const { dateFrom, dateTo, locationId, itemId, movementType } = req.query;
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ error: "dateFrom and dateTo are required" });
        }

        // Fetch ALL data without pagination for export
        const result = await reportsService.getMovementHistory(req.user.tenantId, {
            dateFrom,
            dateTo,
            locationId,
            itemId,
            movementType
        });

        const columns = [
            { header: 'Date', key: 'date', width: 25 },
            { header: 'Type', key: 'movementType', width: 20 },
            { header: 'Ref No', key: 'referenceNo', width: 20 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Location', key: 'locationName', width: 25 },
            { header: 'Qty In', key: 'qtyIn', width: 15 },
            { header: 'Qty Out', key: 'qtyOut', width: 15 },
            { header: 'Unit Cost', key: 'unitCost', width: 15 },
            { header: 'Total Value', key: 'totalValue', width: 15 },
            { header: 'User', key: 'user', width: 25 }
        ];

        const metadata = {
            generatedBy: `${req.user.firstName} ${req.user.lastName}`,
            generatedAt: new Date().toISOString(),
            filters: {
                dateFrom,
                dateTo,
                locationId,
                itemId,
                movementType
            }
        };

        // Format dates nicely for array mapping before excel gen
        const formattedData = result.data.map(d => ({
            ...d,
            date: d.date.toLocaleString()
        }));

        const buffer = await excelService.generateExcelBuffer(formattedData, columns, 'Movement History', metadata);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Movement_History_${new Date().toISOString().split('T')[0]}.xlsx"`);
        res.send(buffer);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getStockValuation,
    exportStockValuation,
    getMovementHistory,
    exportMovementHistory,
    getBreakageReport,
    exportBreakageReport,
    getCountVariances,
    exportCountVariances,
};

// ── M13.3 Breakage & Loss Report ─────────────────────────────────────────────

/**
 * GET /api/reports/breakage
 * Query: dateFrom (req), dateTo (req), locationId (opt)
 */
async function getBreakageReport(req, res, next) {
    try {
        const { dateFrom, dateTo, locationId } = req.query;
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ error: 'dateFrom and dateTo are required' });
        }
        const result = await reportsService.getBreakageReport(req.user.tenantId, {
            dateFrom,
            dateTo,
            locationId,
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/reports/breakage/export
 * Same params → returns xlsx binary
 * Columns: Posting Date | Ref No | Location | Item Code | Item Name | UOM |
 *           Qty (Breakage) | Unit Cost (SAR) | Total Cost (SAR) | Remarks
 */
async function exportBreakageReport(req, res, next) {
    try {
        const { dateFrom, dateTo, locationId } = req.query;
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ error: 'dateFrom and dateTo are required' });
        }

        // Fetch ALL rows (no pagination) using same filters as Generate
        const result = await reportsService.getBreakageReport(req.user.tenantId, {
            dateFrom,
            dateTo,
            locationId,
        });

        const columns = [
            { header: 'Posting Date', key: 'postingDate', width: 22 },
            { header: 'Ref No', key: 'referenceNo', width: 20 },
            { header: 'Location', key: 'locationName', width: 25 },
            { header: 'Item Code', key: 'itemCode', width: 15 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'UOM', key: 'uom', width: 12 },
            { header: 'Qty (Breakage)', key: 'qty', width: 15 },
            { header: 'Unit Cost (SAR)', key: 'unitCost', width: 16 },
            { header: 'Total Cost (SAR)', key: 'totalCost', width: 18 },
            { header: 'Remarks', key: 'remarks', width: 35 },
        ];

        const metadata = {
            generatedBy: `${req.user.firstName} ${req.user.lastName}`,
            generatedAt: new Date().toISOString(),
            filters: { dateFrom, dateTo, locationId: locationId || 'All Locations' },
        };

        // Format postingDate as locale string for readability in Excel
        const formattedData = result.data.map(r => ({
            ...r,
            postingDate: new Date(r.postingDate).toLocaleString(),
        }));

        const buffer = await excelService.generateExcelBuffer(
            formattedData,
            columns,
            'Breakage & Loss',
            metadata,
        );

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="Breakage_Loss_${new Date().toISOString().split('T')[0]}.xlsx"`,
        );
        res.send(buffer);
    } catch (error) {
        next(error);
    }
}

// ── M13.4 Count Variances Report ─────────────────────────────────────────────

/**
 * GET /api/reports/variance
 * Query: dateFrom (req), dateTo (req), locationId (opt)
 */
async function getCountVariances(req, res, next) {
    try {
        const { dateFrom, dateTo, locationId } = req.query;
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ error: 'dateFrom and dateTo are required' });
        }
        const result = await reportsService.getCountVariances(req.user.tenantId, {
            dateFrom,
            dateTo,
            locationId,
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/reports/variance/export
 * Same params → returns xlsx binary
 */
async function exportCountVariances(req, res, next) {
    try {
        const { dateFrom, dateTo, locationId } = req.query;
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ error: 'dateFrom and dateTo are required' });
        }

        const result = await reportsService.getCountVariances(req.user.tenantId, {
            dateFrom,
            dateTo,
            locationId,
        });

        const columns = [
            { header: 'Session No', key: 'sessionNo', width: 20 },
            { header: 'Count Date', key: 'countDate', width: 22 },
            { header: 'Location', key: 'locationName', width: 25 },
            { header: 'Item Code', key: 'itemCode', width: 15 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Category', key: 'category', width: 20 },
            { header: 'Book Qty', key: 'bookQty', width: 15 },
            { header: 'Counted Qty', key: 'countedQty', width: 15 },
            { header: 'Variance Qty', key: 'varianceQty', width: 15 },
            { header: 'WAC (SAR)', key: 'wacUnitCost', width: 16 },
            { header: 'Variance Value (SAR)', key: 'varianceValue', width: 22 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Notes', key: 'notes', width: 35 },
        ];

        const metadata = {
            generatedBy: `${req.user.firstName} ${req.user.lastName}`,
            generatedAt: new Date().toISOString(),
            filters: { dateFrom, dateTo, locationId: locationId || 'All Locations' },
        };

        const formattedData = result.data.map(r => ({
            ...r,
            countDate: new Date(r.countDate).toLocaleString(),
        }));

        // Append Grand Totals row
        formattedData.push({
            sessionNo: `Grand Totals (${result.totals.sessionCount} sessions)`,
            countDate: '',
            locationName: '',
            itemCode: '',
            itemName: '',
            category: '',
            bookQty: result.totals.totalBookQty,
            countedQty: result.totals.totalCountedQty,
            varianceQty: result.totals.totalVarianceQty,
            wacUnitCost: null,
            varianceValue: result.totals.totalVarianceValue,
            status: '',
            notes: '',
        });

        const buffer = await excelService.generateExcelBuffer(
            formattedData,
            columns,
            'Count Variances',
            metadata
        );

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="Count_Variances_${new Date().toISOString().split('T')[0]}.xlsx"`
        );
        res.send(buffer);
    } catch (error) {
        next(error);
    }
}

// ── M13.5 Opening-Movement-Closing (OMC) Report  ─────────────────────────────

/**
 * GET /api/reports/omc
 * Query: dateFrom (req), dateTo (req), locationId (req), categoryId (opt)
 */
async function getOmcReport(req, res, next) {
    try {
        const { dateFrom, dateTo, locationId, categoryId } = req.query;
        if (!dateFrom || !dateTo || !locationId) {
            return res.status(400).json({ error: 'dateFrom, dateTo, and locationId are required for OMC' });
        }
        const result = await reportsService.getOmcReport(req.user.tenantId, {
            dateFrom,
            dateTo,
            locationId,
            categoryId,
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/reports/omc/export
 * Same params → returns xlsx binary
 */
async function exportOmcReport(req, res, next) {
    try {
        const { dateFrom, dateTo, locationId, categoryId } = req.query;
        if (!dateFrom || !dateTo || !locationId) {
            return res.status(400).json({ error: 'dateFrom, dateTo, and locationId are required for OMC' });
        }

        const result = await reportsService.getOmcReport(req.user.tenantId, {
            dateFrom,
            dateTo,
            locationId,
            categoryId,
        });

        const columns = [
            { header: 'Item Code', key: 'itemCode', width: 15 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Category', key: 'category', width: 20 },
            { header: 'UOM', key: 'uom', width: 12 },
            { header: 'Opening Qty', key: 'obQty', width: 15 },
            { header: 'Opening Value (SAR)', key: 'obVal', width: 22 },
            { header: 'In Qty', key: 'inQty', width: 15 },
            { header: 'In Value (SAR)', key: 'inVal', width: 18 },
            { header: 'Out Qty', key: 'outQty', width: 15 },
            { header: 'Out Value (SAR)', key: 'outVal', width: 18 },
            { header: 'Closing Qty', key: 'cbQty', width: 15 },
            { header: 'Closing Value (SAR)', key: 'cbVal', width: 22 },
        ];

        let locName = 'Unknown Location';
        try {
            // Optional: resolve location name quickly for metadata if needed, but 'locationId' string is fine for now
            locName = locationId;
        } catch (e) { }

        const metadata = {
            generatedBy: `${req.user.firstName} ${req.user.lastName}`,
            generatedAt: new Date().toISOString(),
            filters: { dateFrom, dateTo, locationId: locName, categoryId },
        };

        const formattedData = [...result.data];

        // Append Grand Totals row
        formattedData.push({
            itemCode: 'Grand Totals',
            itemName: '',
            category: '',
            uom: '',
            obQty: result.totals.totalObQty,
            obVal: result.totals.totalObVal,
            inQty: result.totals.totalInQty,
            inVal: result.totals.totalInVal,
            outQty: result.totals.totalOutQty,
            outVal: result.totals.totalOutVal,
            cbQty: result.totals.totalCbQty,
            cbVal: result.totals.totalCbVal,
        });

        const buffer = await excelService.generateExcelBuffer(
            formattedData,
            columns,
            'OMC Report',
            metadata
        );

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="OMC_Report_${new Date().toISOString().split('T')[0]}.xlsx"`
        );
        res.send(buffer);
    } catch (error) {
        next(error);
    }
}

// ── Generic PDF Export Helper ────────────────────────────────────────────────
async function sendPDF(res, data, columns, title, metadata) {
    const buffer = await pdfService.generateReportPDF(data, columns, title, metadata);
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_${new Date().toISOString().split('T')[0]}.pdf"`);
    res.send(buffer);
}

// ── PDF Export Handlers ──────────────────────────────────────────────────────

async function pdfStockValuation(req, res, next) {
    try {
        const { locationId, categoryId } = req.query;
        const result = await reportsService.getStockValuation(req.user.tenantId, { locationId, categoryId });
        const columns = [
            { header: 'Location', key: 'locationName', width: 25 },
            { header: 'Item Code', key: 'itemCode', width: 15 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Category', key: 'category', width: 20 },
            { header: 'Qty On Hand', key: 'qtyOnHand', width: 15 },
            { header: 'WAC (SAR)', key: 'wacUnitCost', width: 15 },
            { header: 'Total Value (SAR)', key: 'totalValue', width: 20 },
        ];
        const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: { locationId, categoryId } };
        await sendPDF(res, result.data, columns, 'Stock Valuation', metadata);
    } catch (e) { next(e); }
}

async function pdfMovementHistory(req, res, next) {
    try {
        const { dateFrom, dateTo, locationId, itemId, movementType } = req.query;
        if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo are required' });
        const result = await reportsService.getMovementHistory(req.user.tenantId, { dateFrom, dateTo, locationId, itemId, movementType });
        const columns = [
            { header: 'Date', key: 'date', width: 25 },
            { header: 'Type', key: 'movementType', width: 20 },
            { header: 'Ref No', key: 'referenceNo', width: 20 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Location', key: 'locationName', width: 25 },
            { header: 'Qty In', key: 'qtyIn', width: 15 },
            { header: 'Qty Out', key: 'qtyOut', width: 15 },
            { header: 'Unit Cost', key: 'unitCost', width: 15 },
            { header: 'Total Value', key: 'totalValue', width: 15 },
        ];
        const data = result.data.map(d => ({ ...d, date: new Date(d.date).toLocaleString('en-GB') }));
        const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: { dateFrom, dateTo, locationId, movementType } };
        await sendPDF(res, data, columns, 'Movement History', metadata);
    } catch (e) { next(e); }
}

async function pdfBreakageReport(req, res, next) {
    try {
        const { dateFrom, dateTo, locationId } = req.query;
        if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo are required' });
        const result = await reportsService.getBreakageReport(req.user.tenantId, { dateFrom, dateTo, locationId });
        const columns = [
            { header: 'Posting Date', key: 'postingDate', width: 22 },
            { header: 'Ref No', key: 'referenceNo', width: 20 },
            { header: 'Location', key: 'locationName', width: 25 },
            { header: 'Item Code', key: 'itemCode', width: 15 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'UOM', key: 'uom', width: 12 },
            { header: 'Qty', key: 'qty', width: 15 },
            { header: 'Unit Cost (SAR)', key: 'unitCost', width: 16 },
            { header: 'Total Cost (SAR)', key: 'totalCost', width: 18 },
        ];
        const data = result.data.map(r => ({ ...r, postingDate: new Date(r.postingDate).toLocaleString('en-GB') }));
        const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: { dateFrom, dateTo, locationId: locationId || 'All' } };
        await sendPDF(res, data, columns, 'Breakage & Loss', metadata);
    } catch (e) { next(e); }
}

async function pdfCountVariances(req, res, next) {
    try {
        const { dateFrom, dateTo, locationId } = req.query;
        if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo are required' });
        const result = await reportsService.getCountVariances(req.user.tenantId, { dateFrom, dateTo, locationId });
        const columns = [
            { header: 'Session No', key: 'sessionNo', width: 20 },
            { header: 'Count Date', key: 'countDate', width: 22 },
            { header: 'Location', key: 'locationName', width: 25 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Book Qty', key: 'bookQty', width: 15 },
            { header: 'Counted Qty', key: 'countedQty', width: 15 },
            { header: 'Variance Qty', key: 'varianceQty', width: 15 },
            { header: 'Variance Value (SAR)', key: 'varianceValue', width: 22 },
        ];
        const data = result.data.map(r => ({ ...r, countDate: new Date(r.countDate).toLocaleString('en-GB') }));
        const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: { dateFrom, dateTo, locationId: locationId || 'All' } };
        await sendPDF(res, data, columns, 'Count Variances', metadata);
    } catch (e) { next(e); }
}

async function pdfOmcReport(req, res, next) {
    try {
        const { dateFrom, dateTo, locationId, categoryId } = req.query;
        if (!dateFrom || !dateTo || !locationId) return res.status(400).json({ error: 'dateFrom, dateTo, locationId required' });
        const result = await reportsService.getOmcReport(req.user.tenantId, { dateFrom, dateTo, locationId, categoryId });
        const columns = [
            { header: 'Item Code', key: 'itemCode', width: 15 },
            { header: 'Item Name', key: 'itemName', width: 35 },
            { header: 'Category', key: 'category', width: 20 },
            { header: 'Opening Qty', key: 'obQty', width: 15 },
            { header: 'Opening Val', key: 'obVal', width: 18 },
            { header: 'In Qty', key: 'inQty', width: 12 },
            { header: 'In Val', key: 'inVal', width: 15 },
            { header: 'Out Qty', key: 'outQty', width: 12 },
            { header: 'Out Val', key: 'outVal', width: 15 },
            { header: 'Close Qty', key: 'cbQty', width: 15 },
            { header: 'Close Val', key: 'cbVal', width: 18 },
        ];
        const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: { dateFrom, dateTo, locationId, categoryId } };
        await sendPDF(res, result.data, columns, 'OMC Report', metadata);
    } catch (e) { next(e); }
}

// ── Phase 6 Report Handlers (GET + Excel + PDF) ──────────────────────────────

const TRANSFER_COLS = [
    { header: 'Date', key: 'date', width: 22 },
    { header: 'Transfer No', key: 'transferNo', width: 20 },
    { header: 'From', key: 'sourceLocation', width: 25 },
    { header: 'To', key: 'destLocation', width: 25 },
    { header: 'Item Name', key: 'itemName', width: 35 },
    { header: 'Qty', key: 'qty', width: 12 },
    { header: 'Unit Cost', key: 'unitCost', width: 15 },
    { header: 'Total Value', key: 'totalValue', width: 18 },
    { header: 'Status', key: 'status', width: 15 },
];

const BREAKAGE_PL_COLS = [
    { header: 'Month', key: 'month', width: 15 },
    { header: 'Subtype', key: 'subtype', width: 20 },
    { header: 'Document Count', key: 'documentCount', width: 15 },
    { header: 'Total Qty', key: 'totalQty', width: 15 },
    { header: 'Total Value (SAR)', key: 'totalValue', width: 20 },
];

const REQ_FILL_COLS = [
    { header: 'Requisition No', key: 'requisitionNo', width: 20 },
    { header: 'Department', key: 'department', width: 25 },
    { header: 'Requested Qty', key: 'requestedQty', width: 15 },
    { header: 'Issued Qty', key: 'issuedQty', width: 15 },
    { header: 'Fill Rate %', key: 'fillRate', width: 15 },
    { header: 'Days to Fulfill', key: 'daysToFulfill', width: 15 },
    { header: 'Status', key: 'status', width: 15 },
];

const AGING_COLS = [
    { header: 'Item Code', key: 'itemCode', width: 15 },
    { header: 'Item Name', key: 'itemName', width: 35 },
    { header: 'Location', key: 'locationName', width: 25 },
    { header: 'Qty On Hand', key: 'qtyOnHand', width: 15 },
    { header: 'Last Movement', key: 'lastMovement', width: 22 },
    { header: 'Days Since', key: 'daysSince', width: 15 },
    { header: 'Value (SAR)', key: 'totalValue', width: 18 },
];

module.exports = {
    getStockValuation,
    exportStockValuation,
    pdfStockValuation,
    getMovementHistory,
    exportMovementHistory,
    pdfMovementHistory,
    getBreakageReport,
    exportBreakageReport,
    pdfBreakageReport,
    getCountVariances,
    exportCountVariances,
    pdfCountVariances,
    getOmcReport,
    exportOmcReport,
    pdfOmcReport,
    // Phase 6
    getTransferHistoryReport: async (req, res, next) => {
        try { res.json(await reportsService.getTransferHistoryReport(req.user.tenantId, req.query)); }
        catch (e) { next(e); }
    },
    exportTransferHistory: async (req, res, next) => {
        try {
            const result = await reportsService.getTransferHistoryReport(req.user.tenantId, req.query);
            const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: req.query };
            const buffer = await excelService.generateExcelBuffer(result.data || result, TRANSFER_COLS, 'Transfer History', metadata);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="Transfer_History_${new Date().toISOString().split('T')[0]}.xlsx"`);
            res.send(buffer);
        } catch (e) { next(e); }
    },
    pdfTransferHistory: async (req, res, next) => {
        try {
            const result = await reportsService.getTransferHistoryReport(req.user.tenantId, req.query);
            const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: req.query };
            await sendPDF(res, result.data || result, TRANSFER_COLS, 'Transfer History', metadata);
        } catch (e) { next(e); }
    },
    getBreakagePLReport: async (req, res, next) => {
        try { res.json(await reportsService.getBreakagePLReport(req.user.tenantId, req.query)); }
        catch (e) { next(e); }
    },
    exportBreakagePL: async (req, res, next) => {
        try {
            const result = await reportsService.getBreakagePLReport(req.user.tenantId, req.query);
            const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: req.query };
            const buffer = await excelService.generateExcelBuffer(result.data || result, BREAKAGE_PL_COLS, 'Breakage P&L', metadata);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="Breakage_PL_${new Date().toISOString().split('T')[0]}.xlsx"`);
            res.send(buffer);
        } catch (e) { next(e); }
    },
    pdfBreakagePL: async (req, res, next) => {
        try {
            const result = await reportsService.getBreakagePLReport(req.user.tenantId, req.query);
            const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: req.query };
            await sendPDF(res, result.data || result, BREAKAGE_PL_COLS, 'Breakage P&L', metadata);
        } catch (e) { next(e); }
    },
    getRequisitionFillReport: async (req, res, next) => {
        try { res.json(await reportsService.getRequisitionFillReport(req.user.tenantId, req.query)); }
        catch (e) { next(e); }
    },
    exportRequisitionFill: async (req, res, next) => {
        try {
            const result = await reportsService.getRequisitionFillReport(req.user.tenantId, req.query);
            const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: req.query };
            const buffer = await excelService.generateExcelBuffer(result.data || result, REQ_FILL_COLS, 'Requisition Fill Rate', metadata);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="Requisition_Fill_${new Date().toISOString().split('T')[0]}.xlsx"`);
            res.send(buffer);
        } catch (e) { next(e); }
    },
    pdfRequisitionFill: async (req, res, next) => {
        try {
            const result = await reportsService.getRequisitionFillReport(req.user.tenantId, req.query);
            const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: req.query };
            await sendPDF(res, result.data || result, REQ_FILL_COLS, 'Requisition Fill Rate', metadata);
        } catch (e) { next(e); }
    },
    getInventoryAgingReport: async (req, res, next) => {
        try { res.json(await reportsService.getInventoryAgingReport(req.user.tenantId, req.query)); }
        catch (e) { next(e); }
    },
    exportInventoryAging: async (req, res, next) => {
        try {
            const result = await reportsService.getInventoryAgingReport(req.user.tenantId, req.query);
            const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: req.query };
            const buffer = await excelService.generateExcelBuffer(result.data || result, AGING_COLS, 'Inventory Aging', metadata);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="Inventory_Aging_${new Date().toISOString().split('T')[0]}.xlsx"`);
            res.send(buffer);
        } catch (e) { next(e); }
    },
    pdfInventoryAging: async (req, res, next) => {
        try {
            const result = await reportsService.getInventoryAgingReport(req.user.tenantId, req.query);
            const metadata = { generatedBy: `${req.user.firstName} ${req.user.lastName}`, generatedAt: new Date().toISOString(), filters: req.query };
            await sendPDF(res, result.data || result, AGING_COLS, 'Inventory Aging', metadata);
        } catch (e) { next(e); }
    },
};
