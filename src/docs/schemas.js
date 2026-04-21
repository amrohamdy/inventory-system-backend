'use strict';

/**
 * Reusable OpenAPI component definitions for the upload-related endpoints in
 * this PR. Only the bits we actually reference are declared here; other
 * modules will add their own schemas when they onboard to Swagger in future
 * batches.
 *
 * @openapi
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: "Access token returned by POST /auth/login. Paste only the raw token (no `Bearer ` prefix)."
 *     basicAuth:
 *       type: http
 *       scheme: basic
 *       description: "Protects the Swagger UI itself when SWAGGER_USER/SWAGGER_PASS are set."
 *
 *   schemas:
 *     ApiSuccess:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string, example: "OK" }
 *         data: { type: object, nullable: true }
 *
 *     ApiError:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: false }
 *         message: { type: string, example: "Something went wrong" }
 *         code:
 *           type: string
 *           nullable: true
 *           example: TOKEN_EXPIRED
 *           description: "Stable machine-readable error code (frontend branches on this, not on `message`)."
 *
 *     LoginRequest:
 *       type: object
 *       required: [email, password, tenantSlug]
 *       properties:
 *         email: { type: string, format: email, example: admin@grandhorizon.com }
 *         password: { type: string, format: password, example: Admin@123 }
 *         tenantSlug: { type: string, example: grand-horizon }
 *
 *     LoginResponse:
 *       allOf:
 *         - $ref: '#/components/schemas/ApiSuccess'
 *         - type: object
 *           properties:
 *             data:
 *               type: object
 *               properties:
 *                 accessToken: { type: string, description: "JWT (15m). Paste into the Authorize dialog." }
 *                 refreshToken: { type: string, description: "Refresh token (7d). Kept in an HttpOnly cookie in the frontend." }
 *                 user:
 *                   $ref: '#/components/schemas/UserProfile'
 *
 *     UserProfile:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         email: { type: string, format: email }
 *         firstName: { type: string }
 *         lastName: { type: string }
 *         role: { type: string, example: ADMIN }
 *         tenantId: { type: string, format: uuid }
 *         tenantName: { type: string, example: "Grand Horizon Hotel" }
 *
 *     RefreshRequest:
 *       type: object
 *       required: [refreshToken]
 *       properties:
 *         refreshToken: { type: string }
 *
 *     Item:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         tenantId: { type: string, format: uuid }
 *         name: { type: string, example: "Hand Towel - Premium" }
 *         barcode: { type: string, nullable: true }
 *         imageUrl:
 *           type: string
 *           nullable: true
 *           description: |
 *             Storage key (under r2 driver) or legacy /uploads/... path (under local driver).
 *             Resolve to a viewable URL via GET /files/signed-url?key=...
 *         unitPrice: { type: number, format: float }
 *         isActive: { type: boolean }
 *
 *     ItemEnvelope:
 *       allOf:
 *         - $ref: '#/components/schemas/ApiSuccess'
 *         - type: object
 *           properties:
 *             data: { $ref: '#/components/schemas/Item' }
 *
 *     Attachment:
 *       type: object
 *       description: "One entry inside MovementDocument.attachmentUrl / StoreIssue.attachmentUrl JSON array."
 *       properties:
 *         key: { type: string, description: "Storage object key" }
 *         url: { type: string, description: "Same as key (kept for back-compat with older frontend code)" }
 *         originalName: { type: string }
 *         mimetype: { type: string }
 *         size: { type: integer }
 *         uploadedBy: { type: string }
 *         uploadedById: { type: string, format: uuid }
 *         uploadedAt: { type: string, format: date-time }
 *
 *     SignedUrlResponse:
 *       allOf:
 *         - $ref: '#/components/schemas/ApiSuccess'
 *         - type: object
 *           properties:
 *             data:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   description: "URL valid for SIGNED_URL_TTL_SECONDS (default 7 days, max allowed by S3 SigV4)."
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *
 *     GrnImport:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         grnNumber: { type: string }
 *         supplierId: { type: string, format: uuid }
 *         locationId: { type: string, format: uuid }
 *         receivingDate: { type: string, format: date-time }
 *         pdfAttachmentUrl: { type: string, nullable: true, description: "Storage key for the invoice file." }
 *         status:
 *           type: string
 *           enum: [DRAFT, VALIDATED, APPROVED, REJECTED, POSTED]
 *
 *   responses:
 *     Unauthorized:
 *       description: Missing or invalid JWT
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ApiError' }
 *
 *     Forbidden:
 *       description: Authenticated but insufficient permissions / cross-tenant attempt
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ApiError' }
 *
 *     BadRequest:
 *       description: Invalid input (missing field, bad file type, file too large, etc.)
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ApiError' }
 *
 *     NotFound:
 *       description: Resource does not exist in the caller's tenant
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ApiError' }
 */

module.exports = {}; // swagger-jsdoc reads the JSDoc above; no runtime exports.
