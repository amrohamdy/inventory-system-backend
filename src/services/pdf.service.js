const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

/**
 * Generate Evidence PDF for a Breakage document.
 * @param {object} evidence - The output of breakage.service.getEvidence()
 * @returns {Buffer} - PDF buffer
 */
const generateBreakageEvidencePDF = (evidence) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 60, left: 40, right: 40 } });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const { header, lineItems, approvalHistory, attachments, stockImpactSummary } = evidence;

        const PW = doc.page.width - 80;   // usable width
        const ML = 40;                     // left margin
        const NAVY = '#1a3a5c';
        const BLUE = '#2563eb';
        const LGRAY = '#f1f5f9';
        const GRAY = '#64748b';
        const RED = '#dc2626';
        const GREEN = '#16a34a';
        const WHITE = '#ffffff';
        const BDR = '#cbd5e1';

        const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';
        const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GB') : '—';
        const toSAR = (n) => `SAR ${parseFloat(n || 0).toFixed(2)}`;

        // ── PAGE BREAK GUARD ─────────────────────────────────────────────────
        const ensureSpace = (needed) => {
            if (doc.y + needed > doc.page.height - 70) {
                doc.addPage();
            }
        };

        // ── SECTION HEADER ───────────────────────────────────────────────────
        const section = (title) => {
            ensureSpace(30);
            doc.moveDown(0.6);
            doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text(title, ML, doc.y);
            doc.moveDown(0.15);
            doc.strokeColor(BLUE).lineWidth(1.5)
                .moveTo(ML, doc.y).lineTo(ML + PW, doc.y).stroke();
            doc.moveDown(0.4);
        };

        // ── KV ROW ───────────────────────────────────────────────────────────
        const kv = (label, value, x, y, w) => {
            doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(label + ':', x, y, { width: 90 });
            doc.fillColor('#1e293b').fontSize(8.5).font('Helvetica-Bold').text(String(value || '—'), x + 92, y, { width: w - 92 });
        };

        // ════════════════════════════════════════════════════════════════════
        // 1. HEADER BANNER
        // ════════════════════════════════════════════════════════════════════
        doc.fillColor(NAVY).rect(ML, 40, PW, 52).fill();

        // Title
        doc.fillColor(WHITE).fontSize(18).font('Helvetica-Bold')
            .text('BREAKAGE EVIDENCE PACK', ML + 12, 50, { width: PW * 0.6 });

        // Status badge
        const badgeX = ML + PW - 100;
        const statusColor = header.status === 'POSTED' ? GREEN : header.status === 'REJECTED' ? RED : '#f59e0b';
        doc.fillColor(statusColor).roundedRect(badgeX, 55, 90, 20, 4).fill();
        doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold')
            .text(header.status.replace('_', ' '), badgeX, 60, { width: 90, align: 'center' });

        // Doc No & Date
        doc.fillColor('#94a3b8').fontSize(9).font('Helvetica')
            .text(`Doc No: ${header.documentNo}   |   Date: ${fmt(header.documentDate)}`, ML + 12, 74);

        doc.moveDown(2.2);

        // ════════════════════════════════════════════════════════════════════
        // 2. DOCUMENT INFO (two columns)
        // ════════════════════════════════════════════════════════════════════
        section('Document Information');

        const infoY = doc.y;
        const col1X = ML;
        const col2X = ML + PW / 2 + 10;
        const colW = PW / 2 - 10;

        // Left column
        kv('Created By', `${header.createdBy || '—'} (${header.createdByRole || '—'})`, col1X, infoY, colW);
        kv('Email', header.createdByEmail, col1X, infoY + 16, colW);
        kv('Created At', fmtDT(header.createdAt), col1X, infoY + 32, colW);
        kv('Location', stockImpactSummary?.perItem?.[0]?.locationName || '—', col1X, infoY + 48, colW);

        // Right column
        kv('Status', header.status.replace('_', ' '), col2X, infoY, colW);
        kv('Posted At', header.postedAt ? fmtDT(header.postedAt) : 'Not posted', col2X, infoY + 16, colW);
        kv('Reason', header.reason, col2X, infoY + 32, colW);
        if (header.notes) kv('Notes', header.notes, col2X, infoY + 48, colW);

        doc.y = infoY + 68;

        // ════════════════════════════════════════════════════════════════════
        // 3. BROKEN ITEMS TABLE
        // ════════════════════════════════════════════════════════════════════
        section('Broken Items');

        const colWidths = [28, PW * 0.50, PW * 0.22, PW * 0.14];
        const headers = ['#', 'Item Name', 'Barcode', 'Qty'];
        const ROW_H = 20;
        const HDR_H = 22;
        let tableX = ML;
        let tableY = doc.y;

        // Header row
        doc.fillColor(NAVY).rect(tableX, tableY, PW, HDR_H).fill();
        let cx = tableX;
        headers.forEach((h, i) => {
            doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold')
                .text(h, cx + 5, tableY + 6, { width: colWidths[i] - 6, align: i >= 2 ? 'center' : 'left' });
            cx += colWidths[i];
        });
        tableY += HDR_H;

        lineItems.forEach((item, idx) => {
            ensureSpace(ROW_H + 2);
            if (doc.y !== tableY) tableY = doc.y;

            const bg = idx % 2 === 0 ? WHITE : LGRAY;
            doc.fillColor(bg).rect(tableX, tableY, PW, ROW_H).fill();
            // Border bottom
            doc.strokeColor(BDR).lineWidth(0.5)
                .moveTo(tableX, tableY + ROW_H).lineTo(tableX + PW, tableY + ROW_H).stroke();

            cx = tableX;
            const vals = [idx + 1, item.itemName, item.barcode || '—', item.qty];
            vals.forEach((v, i) => {
                doc.fillColor('#1e293b').fontSize(8.5).font(i === 3 ? 'Helvetica-Bold' : 'Helvetica')
                    .text(String(v), cx + 5, tableY + 5, { width: colWidths[i] - 6, align: i >= 2 ? 'center' : 'left', ellipsis: true });
                cx += colWidths[i];
            });

            tableY += ROW_H;
        });

        // Total loss banner
        tableY += 6;
        doc.fillColor(RED).rect(ML + PW - 180, tableY, 180, 26).fill();
        doc.fillColor(WHITE).fontSize(11).font('Helvetica-Bold')
            .text(`TOTAL LOSS: ${toSAR(stockImpactSummary?.totalLossValue)}`, ML + PW - 175, tableY + 6, { width: 170, align: 'center' });
        doc.y = tableY + 36;
        // 5. PHOTOS (embedded images)
        // ════════════════════════════════════════════════════════════════════
        const imageAttachments = attachments.filter(a => {
            const ext = (a.url || a.filename || '').split('.').pop().toLowerCase();
            return ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
        });

        if (imageAttachments.length > 0) {
            section('Photo Evidence');
            const imgW = (PW - 20) / 3;
            const imgH = 120;
            let imgX = ML;
            let imgY = doc.y;
            let imgCount = 0;

            imageAttachments.forEach((att) => {
                try {
                    const filename = (att.url || att.filename || '').split('/').pop();
                    const filePath = path.join(__dirname, '../../uploads/attachments', filename);
                    if (fs.existsSync(filePath)) {
                        if (imgCount > 0 && imgCount % 3 === 0) {
                            imgX = ML;
                            imgY += imgH + 32;
                            ensureSpace(imgH + 32);
                        }
                        doc.image(filePath, imgX, imgY, { width: imgW, height: imgH, fit: [imgW, imgH], align: 'center' });
                        doc.fillColor(GRAY).fontSize(7).font('Helvetica')
                            .text(att.originalName || 'Photo', imgX, imgY + imgH + 2, { width: imgW, align: 'center' });
                        imgX += imgW + 10;
                        imgCount++;
                    }
                } catch { /* skip if image fails */ }
            });
            if (imgCount > 0) doc.y = imgY + imgH + 20;
        }

        // ════════════════════════════════════════════════════════════════════
        // 6. SIGNATURE BLOCK
        // ════════════════════════════════════════════════════════════════════
        // Always place on same page or new page
        const roleMap = { DEPT_MANAGER: 'Head of Department', COST_CONTROL: 'Cost Control', FINANCE_MANAGER: 'Finance Manager' };

        const sigSlots = [
            { label: 'Requested By', name: header.createdBy || '', role: header.createdByRole || '', status: 'CREATED', actedAt: header.createdAt },
            ...approvalHistory.map(s => ({
                label: roleMap[s.role] || s.role,
                name: s.actedBy ? s.actedBy.split(' (')[0] : '',
                role: s.role,
                status: s.status,
                actedAt: s.actedAt,
            })),
        ];

        // Ensure signature fits — min 140px
        ensureSpace(145);
        if (doc.y > doc.page.height - 210) { doc.addPage(); }

        section('Signatures');

        const sigCount = Math.min(sigSlots.length, 4);
        const sigW = PW / sigCount;
        const sigStartY = doc.y;

        sigSlots.slice(0, sigCount).forEach((sig, i) => {
            const sx = ML + i * sigW;
            const sigColor = sig.status === 'APPROVED' || sig.status === 'CREATED' ? GREEN :
                sig.status === 'REJECTED' ? RED : GRAY;

            // Signature line
            doc.strokeColor('#94a3b8').lineWidth(1)
                .moveTo(sx + 8, sigStartY + 60).lineTo(sx + sigW - 12, sigStartY + 60).stroke();

            // Name
            doc.fillColor('#1e293b').fontSize(8.5).font('Helvetica-Bold')
                .text(sig.name || '_______________', sx + 8, sigStartY + 64, { width: sigW - 16, align: 'center' });

            // Role/Position
            doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
                .text(sig.label, sx + 8, sigStartY + 78, { width: sigW - 16, align: 'center' });

            // Status badge
            doc.fillColor(sigColor).fontSize(8).font('Helvetica-Bold')
                .text(sig.status === 'CREATED' ? 'SUBMITTED' : sig.status, sx + 8, sigStartY + 92, { width: sigW - 16, align: 'center' });

            // Date
            doc.fillColor(GRAY).fontSize(7).font('Helvetica')
                .text(sig.actedAt ? fmtDT(sig.actedAt) : '— / — / ——', sx + 8, sigStartY + 104, { width: sigW - 16, align: 'center' });

            // Vertical divider (except last)
            if (i < sigCount - 1) {
                doc.strokeColor(BDR).lineWidth(0.5)
                    .moveTo(sx + sigW, sigStartY + 50).lineTo(sx + sigW, sigStartY + 118).stroke();
            }
        });

        doc.y = sigStartY + 128;

        // ════════════════════════════════════════════════════════════════════
        // 7. FOOTER (every page)
        // ════════════════════════════════════════════════════════════════════
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            const fy = doc.page.height - 28;
            doc.strokeColor(BDR).lineWidth(0.5)
                .moveTo(ML, fy - 6).lineTo(ML + PW, fy - 6).stroke();
            doc.fillColor(GRAY).fontSize(7).font('Helvetica')
                .text(
                    `OS&E Inventory System  |  Breakage Evidence Pack — ${header.documentNo}  |  Generated: ${fmtDT(evidence.generatedAt)}  |  Page ${i - range.start + 1} of ${range.count}`,
                    ML, fy, { width: PW, align: 'center' }
                );
        }

        doc.end();
    });
};


const generateStockCountEvidencePDF = (evidence) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 50, bottom: 50, left: 60, right: 60 },
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const PAGE_W = doc.page.width - 120;
        const BLUE = '#1a4f8a';
        const GREEN = '#166534';
        const RED = '#991b1b';
        const GRAY = '#6b7280';
        const LGRAY = '#f3f4f6';

        // Helper functions
        const toSAR = (n) => `SAR ${parseFloat(n || 0).toFixed(2)}`;
        const sectionHeader = (title, y) => {
            doc.fillColor(BLUE).fontSize(11).font('Helvetica-Bold').text(title, 60, y || doc.y);
            doc.moveDown(0.2);
            doc.strokeColor(BLUE).lineWidth(1).moveTo(60, doc.y).lineTo(60 + PAGE_W, doc.y).stroke();
            doc.moveDown(0.5);
        };
        const row = (label, value, indent = 60) => {
            doc.fillColor(GRAY).fontSize(9).font('Helvetica').text(label + ':', indent, doc.y, { continued: true, width: 160 })
                .fillColor('#111').text(' ' + (value ?? '—'), { width: PAGE_W - 160 });
        };
        const badgeColor = (status) => {
            if (['APPROVED', 'POSTED'].includes(status)) return GREEN;
            if (['REJECTED', 'VOID'].includes(status)) return RED;
            return GRAY;
        };

        // 1. TITLE BLOCK
        doc.rect(60, 45, PAGE_W, 46).fillColor(BLUE).fill();
        doc.fillColor('#fff').fontSize(16).font('Helvetica-Bold')
            .text('STOCK COUNT EVIDENCE PACK', 70, 52, { width: PAGE_W - 120 });
        doc.fillColor('#c7d6ec').fontSize(9).font('Helvetica')
            .text(`Session No: ${evidence.sessionInfo.sessionNo}   |   Status: ${evidence.sessionInfo.status}`, 70, 72);
        doc.moveDown(2.5);

        // 2. HEADER INFORMATION
        sectionHeader('Session Header');
        row('Session No.', evidence.sessionInfo.sessionNo);
        row('Status', evidence.sessionInfo.status);
        row('Location', evidence.sessionInfo.location);
        row('Created By', evidence.sessionInfo.createdBy || '—');
        row('Snapshot At', new Date(evidence.sessionInfo.snapshotAt).toLocaleString('en-GB'));
        row('Posted At', evidence.sessionInfo.postedAt ? new Date(evidence.sessionInfo.postedAt).toLocaleString('en-GB') : 'Not yet posted');
        doc.moveDown(1);

        // 3. VARIANCE SUMMARY
        sectionHeader('Variance Summary');
        row('Items Counted', `${evidence.varianceSummary.itemsCounted} / ${evidence.varianceSummary.totalItems}`);
        row('Total Overage (Qty)', evidence.varianceSummary.overQty);
        row('Total Shortage (Qty)', evidence.varianceSummary.shortQty);
        row('Net Variance Value', toSAR(evidence.varianceSummary.netVarianceValue));

        doc.moveDown(1);

        // 4. LINE ITEMS
        sectionHeader('Count Details');
        const colW = [100, 50, 60, 60, 60, PAGE_W - 330];
        let y = doc.y;

        doc.fillColor(LGRAY).rect(60, y - 2, PAGE_W, 18).fill();
        doc.fillColor('#333').fontSize(9).font('Helvetica-Bold');
        ['Item', 'WAC', 'Book Qty', 'Count Qty', 'Variance', 'Value'].forEach((h, i) => {
            const x = 60 + colW.slice(0, i).reduce((a, b) => a + b, 0);
            doc.text(h, x + 4, y, { width: colW[i] - 4 });
        });
        doc.moveDown(1.2);

        evidence.lines.forEach((line, idx) => {
            y = doc.y;
            doc.fillColor(idx % 2 === 0 ? '#fff' : '#f9fafb').rect(60, y - 2, PAGE_W, 16).fill();
            doc.fillColor('#111').fontSize(9).font('Helvetica');
            [line.item, toSAR(line.unitCost), line.bookQty, line.countedQty ?? '—', line.varianceQty, toSAR(line.varianceValue)].forEach((val, i) => {
                const x = 60 + colW.slice(0, i).reduce((a, b) => a + b, 0);
                doc.text(String(val), x + 4, y, { width: colW[i] - 4 });
            });
            doc.moveDown(1);
        });
        doc.moveDown(0.5);

        // 5. APPROVAL TIMELINE
        if (evidence.approvalHistory.length > 0) {
            sectionHeader('Approval Timeline');
            evidence.approvalHistory.forEach((step) => {
                const statusColor = badgeColor(step.status);
                doc.fillColor(statusColor).fontSize(10).font('Helvetica-Bold')
                    .text(`Step ${step.step}: ${step.role} [${step.status}]`);
                row('Decided By', step.actedBy || 'Pending', 70);
                row('Decision At', step.actedAt ? new Date(step.actedAt).toLocaleString('en-GB') : '—', 70);
                if (step.comment) row('Comment', step.comment, 70);
                doc.moveDown(0.7);
            });
            doc.moveDown(0.5);
        }

        // 6. LEDGER REFERENCE
        if (evidence.ledgerEntries && evidence.ledgerEntries.length > 0) {
            sectionHeader('Ledger Entries');
            evidence.ledgerEntries.forEach((entry, idx) => {
                doc.fillColor('#111').fontSize(9).font('Helvetica-Bold')
                    .text(`Entry ${idx + 1}: ${entry.type}`);
                row('Qty In', entry.qtyIn, 70);
                row('Qty Out', entry.qtyOut, 70);
                row('Total Value', toSAR(entry.totalValue), 70);
                doc.moveDown(0.5);
            });
        }

        doc.end();
    });
};

/**
 * Generic Report PDF Generator
 * Mirrors the ExcelService pattern: takes data + column definitions + title + metadata
 * and produces a clean A4 landscape PDF with styled table.
 *
 * @param {Array} data        - Array of row objects (same shape as excel export)
 * @param {Array} columns     - Column defs [{header, key, width}]
 * @param {String} title      - Report title
 * @param {Object} metadata   - {generatedBy, generatedAt, filters: {}}
 * @returns {Promise<Buffer>}
 */
const generateReportPDF = (data, columns, title = 'Report', metadata = {}) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            layout: 'landscape',
            margins: { top: 40, bottom: 40, left: 40, right: 40 },
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const PAGE_W = doc.page.width - 80;
        const BLUE = '#1a4f8a';
        const GRAY = '#6b7280';
        const LGRAY = '#f3f4f6';

        // ── 1. Title Bar ──────────────────────────────────────────────────
        doc.rect(40, 35, PAGE_W, 40).fillColor(BLUE).fill();
        doc.fillColor('#fff').fontSize(14).font('Helvetica-Bold')
            .text(title.toUpperCase(), 50, 43, { width: PAGE_W - 20 });
        doc.fillColor('#c7d6ec').fontSize(8).font('Helvetica')
            .text(`Generated: ${metadata.generatedAt ? new Date(metadata.generatedAt).toLocaleString('en-GB') : new Date().toLocaleString('en-GB')}  |  By: ${metadata.generatedBy || 'System'}`, 50, 60);
        doc.moveDown(2.5);

        // ── 2. Filters Summary ────────────────────────────────────────────
        if (metadata.filters && Object.keys(metadata.filters).length > 0) {
            doc.fillColor(GRAY).fontSize(8).font('Helvetica-Bold').text('Filters:', 40, doc.y);
            const filterText = Object.entries(metadata.filters)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k}: ${v}`)
                .join('  |  ');
            doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(filterText);
            doc.moveDown(0.8);
        }

        // ── 3. Calculate column widths ────────────────────────────────────
        const totalExcelW = columns.reduce((s, c) => s + (c.width || 15), 0);
        const colWidths = columns.map(c => ((c.width || 15) / totalExcelW) * PAGE_W);
        const ROW_H = 18;
        const HEADER_H = 22;
        const maxRowsPerPage = Math.floor((doc.page.height - doc.y - 60) / ROW_H);

        // ── 4. Table Header ───────────────────────────────────────────────
        const drawTableHeader = (y) => {
            doc.fillColor(BLUE).rect(40, y, PAGE_W, HEADER_H).fill();
            let x = 40;
            columns.forEach((col, i) => {
                doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold')
                    .text(col.header, x + 3, y + 5, { width: colWidths[i] - 6, ellipsis: true });
                x += colWidths[i];
            });
            return y + HEADER_H;
        };

        let tableY = drawTableHeader(doc.y);
        let rowCount = 0;

        // ── 5. Data Rows ──────────────────────────────────────────────────
        const formatVal = (val) => {
            if (val === null || val === undefined) return '—';
            if (typeof val === 'number') return val.toLocaleString('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            if (val instanceof Date) return val.toLocaleString('en-GB');
            return String(val);
        };

        data.forEach((row, idx) => {
            // Page break check
            if (tableY + ROW_H > doc.page.height - 50) {
                doc.addPage();
                tableY = drawTableHeader(40);
                rowCount = 0;
            }

            // Zebra striping
            const bg = idx % 2 === 0 ? '#fff' : LGRAY;
            doc.fillColor(bg).rect(40, tableY, PAGE_W, ROW_H).fill();

            let x = 40;
            columns.forEach((col, i) => {
                const val = row[col.key];
                doc.fillColor('#111').fontSize(7.5).font('Helvetica')
                    .text(formatVal(val), x + 3, tableY + 4, { width: colWidths[i] - 6, ellipsis: true });
                x += colWidths[i];
            });

            // Light grid line
            doc.strokeColor('#e5e7eb').lineWidth(0.5)
                .moveTo(40, tableY + ROW_H).lineTo(40 + PAGE_W, tableY + ROW_H).stroke();

            tableY += ROW_H;
            rowCount++;
        });

        // ── 6. Summary line ───────────────────────────────────────────────
        doc.moveDown(0.5);
        doc.fillColor(GRAY).fontSize(8).font('Helvetica')
            .text(`Total Rows: ${data.length}`, 40, tableY + 8);

        // ── 7. Footer ─────────────────────────────────────────────────────
        const footerY = doc.page.height - 35;
        doc.strokeColor(GRAY).lineWidth(0.5)
            .moveTo(40, footerY - 6).lineTo(40 + PAGE_W, footerY - 6).stroke();
        doc.fillColor(GRAY).fontSize(7).font('Helvetica')
            .text(
                `OS&E Inventory System  |  ${title}  |  ${new Date().toLocaleString('en-GB')}`,
                40, footerY, { width: PAGE_W, align: 'center' }
            );

        doc.end();
    });
};

/**
 * Generate PDF for a Saved Stock Report (Variance & Approval)
 * @param {object} report - The output of stockReport.service.getSavedReportById()
 * @returns {Buffer} - PDF buffer
 */
const generateStockReportVariancePDF = (report) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 60, left: 40, right: 40 }, bufferPages: true });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const PW = doc.page.width - 80;
        const ML = 40;
        const NAVY = '#1a3a5c';
        const BLUE = '#2563eb';
        const LGRAY = '#f1f5f9';
        const GRAY = '#64748b';
        const RED = '#dc2626';
        const GREEN = '#16a34a';
        const WHITE = '#ffffff';
        const BDR = '#cbd5e1';

        const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GB') : '—';
        const toSAR = (n) => `SAR ${parseFloat(n || 0).toFixed(2)}`;

        const ensureSpace = (needed) => {
            if (doc.y + needed > doc.page.height - 70) doc.addPage();
        };

        const section = (title) => {
            ensureSpace(30);
            doc.moveDown(0.6);
            doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text(title, ML, doc.y);
            doc.moveDown(0.15);
            doc.strokeColor(BLUE).lineWidth(1.5).moveTo(ML, doc.y).lineTo(ML + PW, doc.y).stroke();
            doc.moveDown(0.4);
        };

        const kv = (label, value, x, y, w) => {
            doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(label + ':', x, y, { width: 90 });
            doc.fillColor('#1e293b').fontSize(8.5).font('Helvetica-Bold').text(String(value || '—'), x + 92, y, { width: w - 92, ellipsis: true });
        };

        // 1. HEADER BANNER
        doc.fillColor(NAVY).rect(0, 0, doc.page.width, 60).fill();
        doc.fillColor(WHITE).fontSize(18).font('Helvetica-Bold').text('STOCK REPORT VARIANCE', ML, 20, { align: 'left' });

        let statusColor = GRAY;
        if (report.status === 'APPROVED' || report.status === 'POSTED') statusColor = GREEN;
        if (report.status === 'REJECTED') statusColor = RED;

        doc.fillColor(statusColor).rect(ML + PW - 100, 18, 100, 24).fill();
        doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold').text(report.status, ML + PW - 100, 24, { width: 100, align: 'center' });

        doc.y = 80;

        // 2. REPORT DETAILS
        section('Report Details');
        let detailsY = doc.y;
        const colW = PW / 2;
        kv('Report No', report.reportNo, ML, detailsY, colW);
        kv('Year', report.createdAt ? new Date(report.createdAt).getFullYear() : '—', ML + colW, detailsY, colW);
        detailsY += 16;
        kv('Location / Dept', report.location?.name || '—', ML, detailsY, PW);
        detailsY += 16;
        kv('Created Date', fmtDT(report.createdAt), ML, detailsY, colW);
        kv('Total Items', report.lines.length, ML + colW, detailsY, colW);
        doc.y = detailsY + 24;

        if (report.notes) {
            kv('Notes', report.notes, ML, doc.y, PW);
            doc.y += 20;
        }

        // 3. ITEMS TABLE
        section(`Inventory Count Details (${report.lines.length} Items)`);

        const cols = [
            { label: 'Item Name', w: PW * 0.35, align: 'left', key: 'name' },
            { label: 'System Qty', w: PW * 0.13, align: 'center', key: 'book' },
            { label: 'Counted Qty', w: PW * 0.13, align: 'center', key: 'count' },
            { label: 'Variance Qty', w: PW * 0.13, align: 'center', key: 'varQty' },
            { label: 'Unit Price', w: PW * 0.11, align: 'right', key: 'price' },
            { label: 'Variance Val', w: PW * 0.15, align: 'right', key: 'varVal' },
        ];

        let tableY = doc.y;

        const drawHeader = (startY) => {
            doc.fillColor(NAVY).rect(ML, startY, PW, 24).fill();
            let x = ML;
            cols.forEach(c => {
                doc.fillColor(WHITE).fontSize(8).font('Helvetica-Bold')
                    .text(c.label, x + 4, startY + 6, { width: c.w - 8, align: c.align });
                x += c.w;
            });
            return startY + 24;
        };

        tableY = drawHeader(tableY);
        let totalVarQty = 0;
        let totalVarVal = 0;

        report.lines.forEach((line, idx) => {
            const openQty = Number(line.openingQty || 0);
            const openVal = Number(line.openingValue || 0);
            const bookQty = Number(line.closingQty || 0);
            const bookVal = Number(line.closingValue || 0);
            const countQty = Number(line.inwardQty || 0);
            const countVal = Number(line.inwardValue || 0);

            // Use the exactly saved variance values to prevent unitPrice 0 bugs
            const varQty = Number(line.outwardQty || (countQty - bookQty));
            const varVal = Number(line.outwardValue || 0);
            const unitPrice = Math.abs(varQty) > 0 ? Math.abs(varVal / varQty) : (countQty > 0 ? (countVal / countQty) : (openQty > 0 ? (openVal / openQty) : 0));

            ensureSpace(20);
            if (doc.y > doc.page.height - 80) {
                doc.addPage();
                tableY = drawHeader(40);
                doc.y = tableY;
            } else {
                tableY = doc.y;
            }

            totalVarQty += varQty;
            totalVarVal += varVal;

            const bg = idx % 2 === 0 ? '#ffffff' : LGRAY;
            doc.fillColor(bg).rect(ML, tableY, PW, 20).fill();

            let x = ML;
            // Item Name
            doc.fillColor('#111827').fontSize(7.5).font('Helvetica')
                .text(line.item.name, x + 4, tableY + 5, { width: cols[0].w - 8, ellipsis: true, align: 'left' });
            x += cols[0].w;
            // System Qty (book)
            doc.fillColor(GRAY).fontSize(8).font('Helvetica')
                .text(bookQty.toString(), x + 4, tableY + 5, { width: cols[1].w - 8, align: 'center' });
            x += cols[1].w;
            // Counted Qty
            doc.fillColor('#111827').fontSize(8).font('Helvetica-Bold')
                .text(countQty.toString(), x + 4, tableY + 5, { width: cols[2].w - 8, align: 'center' });
            x += cols[2].w;
            // Variance Qty
            let varColor = varQty < 0 ? RED : varQty > 0 ? GREEN : GRAY;
            doc.fillColor(varColor).fontSize(8).font('Helvetica-Bold')
                .text(varQty.toString(), x + 4, tableY + 5, { width: cols[3].w - 8, align: 'center' });
            x += cols[3].w;
            // Unit Price
            doc.fillColor(GRAY).fontSize(8).font('Helvetica')
                .text(unitPrice.toFixed(2), x + 4, tableY + 5, { width: cols[4].w - 8, align: 'right' });
            x += cols[4].w;
            // Variance Value
            doc.fillColor(varColor).fontSize(8).font('Helvetica-Bold')
                .text(varVal.toFixed(2), x + 4, tableY + 5, { width: cols[5].w - 8, align: 'right' });

            doc.strokeColor('#e5e7eb').lineWidth(0.5)
                .moveTo(ML, tableY + 20).lineTo(ML + PW, tableY + 20).stroke();
            doc.y = tableY + 20;
        });

        // Totals Row
        doc.y += 2;
        tableY = doc.y;
        doc.fillColor('#1e293b').rect(ML, tableY, PW, 24).fill();
        doc.fillColor(WHITE).fontSize(8.5).font('Helvetica-Bold');
        doc.text('TOTALS', ML + 4, tableY + 6, { width: cols[0].w + cols[1].w + cols[2].w - 8, align: 'right' });

        let tVarColor = totalVarQty < 0 ? '#fca5a5' : totalVarQty > 0 ? '#86efac' : WHITE;
        doc.fillColor(tVarColor).text(totalVarQty.toFixed(0), ML + cols[0].w + cols[1].w + cols[2].w + 4, tableY + 6, { width: cols[3].w - 8, align: 'center' });

        let tValColor = totalVarVal < 0 ? '#fca5a5' : totalVarVal > 0 ? '#86efac' : WHITE;
        doc.fillColor(tValColor).text(toSAR(totalVarVal), ML + PW - cols[5].w + 4, tableY + 6, { width: cols[5].w - 8, align: 'right' });

        doc.y = tableY + 36;

        // 4. SIGNATURES
        const history = report.approvalRequest?.steps || [];
        const sigSlots = [
            { label: 'Prepared By', name: `${report.createdByUser?.firstName || ''} ${report.createdByUser?.lastName || ''}`.trim() || 'System User', role: 'Preparer', status: 'SUBMITTED', actedAt: report.createdAt },
            ...history.map(s => ({
                label: s.role === 'DEPT_MANAGER' ? 'Head of Department' : s.role === 'COST_CONTROL' ? 'Cost Control' : 'Finance Manager',
                name: s.actedByUser ? `${s.actedByUser.firstName} ${s.actedByUser.lastName}` : s.actedBy?.split(' (')[0] || '',
                role: s.role,
                status: s.status,
                actedAt: s.actedAt,
            })),
        ];

        ensureSpace(145);
        if (doc.y > doc.page.height - 210) doc.addPage();

        doc.moveDown(2); // Provide spacing between table totals and signatures without a titled section

        const sigCount = Math.min(sigSlots.length, 4);
        const sigW = PW / sigCount;
        const sigStartY = doc.y;

        sigSlots.slice(0, sigCount).forEach((sig, i) => {
            const sx = ML + i * sigW;
            const sigColor = ['APPROVED', 'SUBMITTED', 'POSTED'].includes(sig.status) ? GREEN : sig.status === 'REJECTED' ? RED : GRAY;

            // Role/Position first for title context under line
            doc.strokeColor('#94a3b8').lineWidth(1)
                .moveTo(sx + 8, sigStartY + 60).lineTo(sx + sigW - 12, sigStartY + 60).stroke();

            doc.fillColor('#1e293b').fontSize(8.5).font('Helvetica-Bold')
                .text(sig.name || '_______________', sx + 8, sigStartY + 64, { width: sigW - 16, align: 'center', ellipsis: true });

            doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
                .text(sig.label, sx + 8, sigStartY + 78, { width: sigW - 16, align: 'center' });

            doc.fillColor(sigColor).fontSize(8).font('Helvetica-Bold')
                .text(sig.status, sx + 8, sigStartY + 92, { width: sigW - 16, align: 'center' });

            doc.fillColor(GRAY).fontSize(7).font('Helvetica')
                .text(sig.actedAt ? fmtDT(sig.actedAt) : '— / — / ——', sx + 8, sigStartY + 104, { width: sigW - 16, align: 'center' });

            if (i < sigCount - 1) {
                doc.strokeColor(BDR).lineWidth(0.5)
                    .moveTo(sx + sigW, sigStartY + 50).lineTo(sx + sigW, sigStartY + 118).stroke();
            }
        });

        // FOOTER
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            const fy = doc.page.height - 28;
            doc.strokeColor(BDR).lineWidth(0.5).moveTo(ML, fy - 6).lineTo(ML + PW, fy - 6).stroke();
            doc.fillColor(GRAY).fontSize(7).font('Helvetica')
                .text(`OS&E Inventory System  |  Stock Report Variance — ${report.reportNo}  |  Generated: ${new Date().toLocaleString('en-GB')}  |  Page ${i - range.start + 1} of ${range.count}`, ML, fy, { width: PW, align: 'center' });
        }

        doc.end();
    });
};

/**
     * Generate PDF for an Asset Transfer(Asset Loan)
    * @param { object } loan - The output of assetLoan.service.getLoanById()
        * @returns { Buffer } - PDF buffer
            */
const generateAssetTransferPDF = (loan) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 60, left: 40, right: 40 }, bufferPages: true });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const PW = doc.page.width - 80;
        const ML = 40;
        const NAVY = '#1a3a5c';
        const BLUE = '#2563eb';
        const LGRAY = '#f1f5f9';
        const GRAY = '#64748b';
        const RED = '#dc2626';
        const GREEN = '#16a34a';
        const WHITE = '#ffffff';
        const BDR = '#cbd5e1';

        const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GB') : '—';
        const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';

        const ensureSpace = (needed) => {
            if (doc.y + needed > doc.page.height - 70) doc.addPage();
        };

        const section = (title) => {
            ensureSpace(30);
            doc.moveDown(0.6);
            doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text(title, ML, doc.y);
            doc.moveDown(0.15);
            doc.strokeColor(BLUE).lineWidth(1.5).moveTo(ML, doc.y).lineTo(ML + PW, doc.y).stroke();
            doc.moveDown(0.4);
        };

        const kv = (label, value, x, y, w) => {
            doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(label + ':', x, y, { width: 90 });
            doc.fillColor('#1e293b').fontSize(8.5).font('Helvetica-Bold').text(String(value || '—'), x + 92, y, { width: w - 92, ellipsis: true });
        };

        // 1. HEADER BANNER
        doc.fillColor(NAVY).rect(0, 0, doc.page.width, 60).fill();
        doc.fillColor(WHITE).fontSize(18).font('Helvetica-Bold').text('ASSET TRANSFER REPORT', ML, 20, { align: 'left' });

        let statusColor = GRAY;
        if (loan.status === 'RETURNED') statusColor = GREEN;
        if (loan.status === 'NOT_RETURNED') statusColor = RED;
        if (loan.status === 'OUT_ON_LOAN') statusColor = '#f59e0b'; // Amber

        doc.fillColor(statusColor).rect(ML + PW - 100, 18, 100, 24).fill();
        doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold').text(loan.status.replace(/_/g, ' '), ML + PW - 100, 24, { width: 100, align: 'center' });

        doc.y = 80;

        // 2. TRANSFER DETAILS
        section('Transfer Details');
        let detailsY = doc.y;
        const colW = PW / 2;

        kv('Transfer No', loan.loanNo, ML, detailsY, colW);
        kv('Transfer Type', loan.status === 'NOT_RETURNED' ? 'Permanent' : 'Temporary', ML + colW, detailsY, colW);
        detailsY += 16;

        kv('Borrowing Entity', loan.borrowingEntity, ML, detailsY, colW);
        kv('From Location', loan.location?.name || '—', ML + colW, detailsY, colW);
        detailsY += 16;

        kv('Item Name', loan.item?.name || '—', ML, detailsY, colW);
        kv('Quantity', Number(loan.qty).toString(), ML + colW, detailsY, colW);
        detailsY += 16;

        kv('Out Date', fmtD(loan.outDate), ML, detailsY, colW);
        kv('Expected Return', loan.expectedReturnDate ? fmtD(loan.expectedReturnDate) : 'N/A', ML + colW, detailsY, colW);
        detailsY += 16;

        kv('Created By', `${loan.createdByUser?.firstName || ''} ${loan.createdByUser?.lastName || ''}`.trim() || 'System User', ML, detailsY, colW);
        kv('Created At', fmtDT(loan.createdAt), ML + colW, detailsY, colW);
        detailsY += 24;
        doc.y = detailsY;

        if (loan.notes) {
            kv('Notes', loan.notes, ML, doc.y, PW);
            doc.y += 24;
        }

        // 3. ITEM PHOTO (IF ANY)
        if (loan.photoUrl || loan.item?.imageUrl) {
            section('Item Photo');
            const imgW = 120;
            const imgH = 120;
            let imgY = doc.y;
            try {
                const imgPathUrl = loan.photoUrl || loan.item?.imageUrl;
                if (imgPathUrl) {
                    const filename = imgPathUrl.split('/').pop();
                    const filePath = path.join(__dirname, '../../uploads', imgPathUrl.includes('attachments') ? 'attachments' : 'items', filename);
                    if (fs.existsSync(filePath)) {
                        doc.image(filePath, ML, imgY, { width: imgW, height: imgH, fit: [imgW, imgH], align: 'left' });
                        doc.y = imgY + imgH + 20;
                    }
                }
            } catch { /* ignore */ }
        }

        // 4. SIGNATURES (CIRCULAR APPROVAL)
        // Asset Loans do not formally exist in ApprovalRequest yet, but we need a signature block starting with Department Manager.
        const sigSlots = [
            { label: 'Prepared By (Store)', name: `${loan.createdByUser?.firstName || ''} ${loan.createdByUser?.lastName || ''}`.trim() || 'System', role: 'Preparer', actedAt: loan.createdAt },
            { label: 'Department Manager', name: '', role: 'Dept. Manager', actedAt: null },
            { label: 'Cost Control / Security', name: '', role: 'Cost Control', actedAt: null },
            { label: 'Receiving Entity', name: loan.borrowingEntity, role: 'Receiver', actedAt: null }
        ];

        ensureSpace(145);
        if (doc.y > doc.page.height - 210) doc.addPage();

        doc.moveDown(2);
        section('Approval Workflow & Signatures');

        const sigCount = sigSlots.length;
        const sigW = PW / sigCount;
        const sigStartY = doc.y + 10;

        sigSlots.forEach((sig, i) => {
            const sx = ML + i * sigW;

            // Signature line
            doc.strokeColor('#94a3b8').lineWidth(1)
                .moveTo(sx + 8, sigStartY + 60).lineTo(sx + sigW - 12, sigStartY + 60).stroke();

            // Name
            doc.fillColor('#1e293b').fontSize(8.5).font('Helvetica-Bold')
                .text(sig.name || '_______________', sx + 8, sigStartY + 64, { width: sigW - 16, align: 'center', ellipsis: true });

            // Role/Position
            doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
                .text(sig.label, sx + 8, sigStartY + 78, { width: sigW - 16, align: 'center' });

            // Date
            doc.fillColor(GRAY).fontSize(7).font('Helvetica')
                .text(sig.actedAt ? fmtD(sig.actedAt) : 'Date: ___/___/20__', sx + 8, sigStartY + 90, { width: sigW - 16, align: 'center' });

            if (i < sigCount - 1) {
                doc.strokeColor(BDR).lineWidth(0.5)
                    .moveTo(sx + sigW, sigStartY + 50).lineTo(sx + sigW, sigStartY + 118).stroke();
            }
        });

        doc.y = sigStartY + 140;

        // FOOTER
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            const fy = doc.page.height - 28;
            doc.strokeColor(BDR).lineWidth(0.5).moveTo(ML, fy - 6).lineTo(ML + PW, fy - 6).stroke();
            doc.fillColor(GRAY).fontSize(7).font('Helvetica')
                .text(`OS&E Inventory System  |  Asset Transfer — ${loan.loanNo}  |  Generated: ${fmtDT(new Date())}  |  Page ${i - range.start + 1} of ${range.count}`, ML, fy, { width: PW, align: 'center' });
        }

        doc.end();
    });
};

module.exports = { generateBreakageEvidencePDF, generateStockCountEvidencePDF, generateReportPDF, generateStockReportVariancePDF, generateAssetTransferPDF };
