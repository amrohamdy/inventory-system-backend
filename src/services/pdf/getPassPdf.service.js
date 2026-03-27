const PDFDocument = require('pdfkit');
const prisma = require('../../config/database');
const dayjs = require('dayjs');

class GetPassPdfService {
    async generatePdf(passId, tenantId) {
        const getPass = await prisma.getPass.findFirst({
            where: { id: passId, tenantId },
            include: {
                tenant: true,
                department: true,
                createdByUser: true,
                deptApprover: true,
                financeApprover: true,
                securityApprover: true,
                checkoutUser: true,
                lines: {
                    include: {
                        item: true,
                        location: true
                    }
                }
            }
        });

        if (!getPass) throw Object.assign(new Error('Get Pass not found'), { status: 404 });

        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 40, size: 'A4' });
                const buffers = [];

                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => resolve(Buffer.concat(buffers)));
                doc.on('error', reject);

                this.generateHeader(doc, getPass);
                this.generateDetails(doc, getPass);
                this.generateTable(doc, getPass);
                this.generateFooter(doc, getPass);

                doc.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    generateHeader(doc, pass) {
        doc.fontSize(20).text(pass.tenant?.name || 'OSE System', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(16).text('GATE PASS', { align: 'center', underline: true });
        doc.moveDown(1.5);
    }

    generateDetails(doc, pass) {
        const leftCol = 40;
        const rightCol = 300;
        let y = doc.y;

        doc.fontSize(10);
        
        doc.text('Pass No:', leftCol, y);
        doc.font('Helvetica-Bold').text(pass.passNo, leftCol + 80, y);
        doc.font('Helvetica');
        
        doc.text('Status:', rightCol, y);
        doc.font('Helvetica-Bold').text(pass.status.replace('_', ' '), rightCol + 80, y);
        doc.font('Helvetica');

        y += 15;
        doc.text('Type:', leftCol, y);
        doc.text(pass.transferType, leftCol + 80, y);
        
        doc.text('Borrower:', rightCol, y);
        doc.font('Helvetica-Bold').text(pass.borrowingEntity, rightCol + 80, y);
        doc.font('Helvetica');

        y += 15;
        doc.text('Department:', leftCol, y);
        doc.text(pass.department?.name || 'N/A', leftCol + 80, y);
        
        doc.text('Return Date:', rightCol, y);
        const returnDateStr = pass.expectedReturnDate ? dayjs(pass.expectedReturnDate).format('DD MMM YYYY') : 'N/A';
        doc.text(returnDateStr, rightCol + 80, y);

        y += 15;
        doc.text('Created On:', leftCol, y);
        doc.text(dayjs(pass.createdAt).format('DD MMM YYYY HH:mm'), leftCol + 80, y);
        
        if (pass.reason) {
            y += 20;
            doc.text('Reason:', leftCol, y);
            doc.text(pass.reason, leftCol + 80, y, { width: 400 });
        }

        doc.moveDown(2);
    }

    generateTable(doc, pass) {
        const tableTop = doc.y + 10;
        const colStartX = [40, 200, 320, 380, 460];
        
        doc.font('Helvetica-Bold');
        this.generateTableRow(doc, tableTop, colStartX, ['Item Description', 'Source Location', 'Qty', 'Qty Ret', 'Condition Out']);
        doc.moveTo(40, tableTop + 15).lineTo(550, tableTop + 15).stroke();
        
        doc.font('Helvetica');
        let currentY = tableTop + 20;

        pass.lines.forEach(line => {
            if (currentY > 700) {
                doc.addPage();
                currentY = 40;
            }
            const itemNameText = `${line.item.name} ${line.item.barcode ? `(${line.item.barcode})` : ''}`;
            
            // Calculate dynamic height based on the text wrapping constraint (150 width defined in generateTableRow)
            const textHeight = doc.heightOfString(itemNameText, { width: 150 });
            const rowHeight = Math.max(textHeight, 15) + 5; 

            this.generateTableRow(doc, currentY, colStartX, [
                itemNameText,
                line.location.name,
                line.qty.toString(),
                line.qtyReturned.toString(),
                line.conditionOut || '-'
            ]);
            
            // Advance Y by the dynamic row height instead of a static 20px
            currentY += rowHeight;
        });

        doc.moveTo(40, currentY).lineTo(550, currentY).stroke();
        doc.moveDown(2);
    }

    generateTableRow(doc, y, xPositions, array) {
        doc.text(array[0], xPositions[0], y, { width: 150 });
        doc.text(array[1], xPositions[1], y, { width: 110 });
        doc.text(array[2], xPositions[2], y, { width: 50 });
        doc.text(array[3], xPositions[3], y, { width: 70 });
        doc.text(array[4], xPositions[4], y, { width: 90 });
    }

    generateFooter(doc, pass) {
        let currentY = doc.y + 30;
        if (currentY > 600) {
            doc.addPage();
            currentY = 40;
        }

        doc.font('Helvetica-Bold').fontSize(11).text('Approvals & Signatures', 40, currentY);
        doc.moveTo(40, currentY + 15).lineTo(550, currentY + 15).stroke();
        
        currentY += 30;
        doc.font('Helvetica').fontSize(10);

        const sigCols = [40, 220, 400];
        
        // Block 1: Prepared By
        doc.text('Prepared By:', sigCols[0], currentY);
        doc.text(pass.createdByUser ? `${pass.createdByUser.firstName} ${pass.createdByUser.lastName}` : 'System', sigCols[0], currentY + 15);
        doc.text(dayjs(pass.createdAt).format('DD MMM YYYY'), sigCols[0], currentY + 30);

        // Block 2: Dept Approval
        doc.text('Department Head:', sigCols[1], currentY);
        doc.text(pass.deptApprover ? `${pass.deptApprover.firstName} ${pass.deptApprover.lastName}` : 'Pending', sigCols[1], currentY + 15);
        doc.text(pass.deptApprovedAt ? dayjs(pass.deptApprovedAt).format('DD MMM YYYY') : '', sigCols[1], currentY + 30);

        // Block 3: Finance Approval
        doc.text('Finance Manager:', sigCols[2], currentY);
        doc.text(pass.financeApprover ? `${pass.financeApprover.firstName} ${pass.financeApprover.lastName}` : 'Pending', sigCols[2], currentY + 15);
        doc.text(pass.financeApprovedAt ? dayjs(pass.financeApprovedAt).format('DD MMM YYYY') : '', sigCols[2], currentY + 30);

        currentY += 70;

        // Block 4: Security Checkout
        doc.text('Security (Exit Gate):', sigCols[0], currentY);
        doc.text(pass.checkoutUser ? `${pass.checkoutUser.firstName} ${pass.checkoutUser.lastName}` : 'Pending Exit', sigCols[0], currentY + 15);
        doc.text(pass.checkedOutAt ? dayjs(pass.checkedOutAt).format('DD MMM YYYY') : '', sigCols[0], currentY + 30);

        // Block 5: Borrower Signature
        doc.text('Borrower / Receiver:', sigCols[1], currentY);
        doc.text('__________________', sigCols[1], currentY + 30);
    }
}

module.exports = new GetPassPdfService();
